# CP-02 Cloud 单端通话契约（2026-10-21）

## 1. 范围和前提

用户已决定：同账号同时一端通话，另一端须明确接管；首版以LiveKit Cloud为严格接管目标，自建模式暂不开放接管。本轮只实现后端协议及模拟Cloud/真实专用PostgreSQL测试，不访问真实Cloud或Provider，不等同真实媒体验收通过。

新增`CALL_LEASE_MODE`仅允许`disabled`（默认）或`livekit_cloud`。disabled保持既有token/dispatch/end行为，三个新占用写接口返回503 `call_leases_disabled`。启用Cloud模式必须为无凭据/query/fragment的HTTPS/WSS `*.livekit.cloud`地址并具备非空服务端LiveKit key/secret；配置错误拒绝启动，错误不回显值。自建URL不能开启该模式，不增加依赖。

正式启用前还须：所有后端升级并停止旧协议签发；维护窗口撤销/清理既有旧房间及旧Token；确认后端与Cloud UTC时钟偏差不超过5秒。当前无真实环境，这些前提未验证，默认模式保持disabled。不能把本地测试说成存量客户端已完成严格切换。

## 2. 占用模型和并发

新增`call_leases`表，一用户一行，`user_id`主键/FK；包含`session_id`（nullable FK）、`device_id`（nullable UUID）、`generation`（非负BigInteger，初始0）、`state`（held/free）、`expires_at`（nullable timezone-aware UTC）。保留已释放的最后session/device/generation，便于重复release幂等；free不表示仍占用。递增generation永不复用，不存LiveKit Token、用户正文或硬件指纹。单条线性迁移以`c02_create_idempotency`为父，降级仅删除新表。

所有Cloud模式的claim/heartbeat/release/token/dispatch/end先按同一顺序锁当前User行（FOR UPDATE NOWAIT），再访问lease及Session行；需Session行锁时统一User→lease→Session。结构化SQLSTATE55P03映射409 `call_lease_busy`，不使用字符串模糊匹配，不在失效事务中继续查询。不同用户互不串行，同账号并发无进程内锁依赖。禁用模式不加此新锁。

租约TTL固定90秒，客户端未来建议20秒心跳。过期拒绝heartbeat/token/dispatch；保留旧owner记录用于安全撤销，不假定过期已令Cloud断开。相同owner显式claim可恢复/续期；不同owner即使过期也必须明确takeover，不能隐式踢人。请求必须校验session属于当前用户；claim/heartbeat/token/dispatch只接受active会话。

## 3. 新接口

- `POST /api/sessions/{session_id}/call/claim`：body `{device_id: UUID, takeover: boolean=false}`。无占用/free时分配新generation；同session/device的held重复claim保持generation并续期；其他held owner（含同设备不同session、过期owner）在takeover=false时409 `call_in_use`，只返回当前用户的冲突session_id/过期时间用于提示，不泄露其他用户或Token。
- takeover=true：先成功撤销旧owner的Cloud参与者Token，再把row更新为新session/device、generation+1、held及新expires_at；任何撤销错误/超时均502 `call_provider_unavailable`，不更新owner/generation、不授予新占用。失败后旧owner仍是数据库合法owner，允许用户重试；媒体可能已断开，但绝不能先授予新owner再补撤销。
- `POST .../call/heartbeat`：body `{device_id: UUID, generation: positive int}`。只有匹配held owner且未过期可续期；旧代际/不同设备409 `call_lease_lost`，过期409 `call_lease_expired`；绝不自动重新claim。
- `POST .../call/release`：同heartbeat body。匹配owner时先撤销Cloud Token再置free/清除expires_at；同tuple已free重复release返回200；旧tuple在新owner已接管后409，不能释放新owner。允许释放已过期/已结束的本用户会话。

claim/heartbeat成功响应仅`session_id,device_id,generation,state,expires_at`；release响应`released:true,generation`。非法typed body/header为422，缺认证401，非本用户session404。新业务错误detail为`{code,message,...}`，不回显SDK错误/凭据。端点返回成功前显式commit；commit失败不可返回200。保留现有get_db的其余使用者，不依赖新版本FastAPI scope参数（requirements仍允许旧版本）。

## 4. Token、dispatch、end门禁

Cloud模式的现有token与dispatch接口要求`X-Call-Device-Id`、`X-Call-Generation`，校验当前session/device/generation且未过期；缺头409 `call_lease_required`、失去占用409、过期409，不能签Token或dispatch。默认CORS显式允许这两个头，不放宽Origins/通配符。原有鉴权、订阅/设置校验及非本人404保持。Cloud模式Token identity固定`<user UUID>:<generation>`，room仍为session UUID，TTL不超过60秒且不超过租约剩余有效期（剩余不足1秒拒绝签发）；不持久化Token。Agent现有逻辑按room查配置，不按participant identity解析用户，不需改worker。

Cloud模式end先按统一锁顺序处理；如该session持有当前held占用，先撤销Cloud Token/置free，再执行既有完成、结束时间、单一分析job事务并显式commit。撤销失败整个请求回滚（状态/结束时间/job/lease不部分提交），前端本地仍已停止音频，可显式重试。重复completed end继续返回原结果，不新增job；结束其他本用户旧session不影响当前另一session的占用。禁用模式end保持原行为。

## 5. Cloud撤销及事务取舍

使用现有SDK RemoveParticipant(RoomParticipantIdentity(room=旧session UUID,identity=旧user:generation,revoke_token_ts=floor(UTC now)+30))。显式cutoff避开Cloud默认一分钟缓冲；在§1时钟前提及3秒请求deadline内覆盖旧token/刷新token，下一generation identity不同不会被旧cutoff影响。SDK API field已在本机livekit-api1.1.0协议中存在，不升级依赖。API确认成功才继续；任何错误（含not-found）都按撤销未确认处理，不猜测成功。严格模式仅接受Cloud。

初版在单用户行锁内等待最多3秒的Cloud撤销；dispatch的Cloud操作也必须有聚合3秒超时，禁止锁内自动重试。这样“先移除旧能力、后原子提交新owner”，失败回滚不会给两个owner发能力，也避免额外outbox/常驻worker。代价是该用户短暂忙碌；NOWAIT快速拒绝同账号竞争，后续若实测吞吐有问题再引入持久化接管状态/短事务。不把网络无界等待放进事务。请求取消/失败必须rollback释放锁，Provider上下文正确关闭。

官方依据：[参与者管理](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)、[Token撤销](https://docs.livekit.io/frontends/reference/tokens-grants/)。真实Cloud撤销、时钟前提及旧SDK自动重连仍需后续设备证据；当前仅可裁定本地协议正确性。

## 6. 必须验证

真实专用PostgreSQL和ASGI覆盖：disabled旧行为；模式配置拒绝自建/缺凭据；认证/所有权；首次/重复claim；无显式接管拒绝（含过期）；显式接管顺序和generation；相同用户双设备竞争只有一owner；不同用户不互斥；旧heartbeat/token/dispatch/release不能抢回；TTL/过期和续期；release重试；end成功/重试单job及Cloud失败回滚；Cloud超时/异常无新授予；精确revoke字段/身份/时间、Token解码TTL及room/identity；commit失败不返回成功；CORS新头/未知头。模拟Cloud在list/remove/dispatch处不得真实联网。新增迁移先独立评审再应用测试库，禁止自行运行Alembic。

## 7. 客户端协议发现（后续恢复 UI 的前置）

增加已认证的只读 `GET /api/call-capabilities`，成功响应精确为 `{"protocol_version":1,"call_lease_mode":"disabled"}` 或 `{"protocol_version":1,"call_lease_mode":"livekit_cloud"}`，模式取服务端当前 `CALL_LEASE_MODE`。响应 `Cache-Control: no-store`，不得返回 LiveKit URL、key/secret、用户标识、Token、其他环境配置或用户数据。

该接口复用现有认证依赖，缺少/无效认证401；不访问媒体 SDK，不创建、释放或更新会话/租约，不增加数据库迁移和构建变量。`disabled` 同样可以发现，保持旧 token/dispatch/end 行为。不得因能力查询失败而在客户端静默假定 disabled；后续客户端在显式开始或恢复前读取，失败受控提示并允许用户重试。前端接入另轮实施，本接口通过不表示三端恢复/接管 UI 已完成，也不改变默认模式。

本地验收覆盖：真实路由注册，两种模式的精确响应，认证401，禁止响应额外字段及no-store，不调用媒体服务、不写DB；既有后端全量测试保持通过。

## 8. 共享客户端能力发现与开始门禁（本地阶段）

每次用户显式开始练习（含DocTalk）先读取`GET /api/call-capabilities`，成功响应只接受对象、精确两字段、`protocol_version === 1`及`call_lease_mode`为`disabled`或`livekit_cloud`。使用现有认证request，并设置fetch的`cache: "no-store"`，不持久化、不跨开始请求缓存能力，也不因失败回退disabled。未知版本/模式、字段缺失/额外字段、错误类型、HTTP失败均受控失败关闭。

当前客户端尚未实现claim/heartbeat/token-generation及接管UI，只有disabled可进入既有health→create→token流程。livekit_cloud显示通用本地化“当前客户端尚未支持此通话模式”，不得调用health/create/token/dispatch或采音；未来占用客户端实现后另轮解除此临时门禁。能力查询失败或不兼容显示通用本地化提示，留在dashboard并恢复可开始状态，由用户显式重试；不回显任意服务端报错，不改变服务端默认模式。

开始在途去重涵盖能力查询，重复点击不能创建并行启动。reset/goHome/end/退出换号使旧能力结果失效；沿用精确认证身份和authRevision，旧请求在身份或revision变化后不得继续health/create/token或回填状态。每一步异步边界均核验本轮启动归属；不修改既有auth.ts安全底座，不盲目重放任何写请求。没有有效认证快照时不发起开始；已有显式dev认证边界保持，测试应初始化真实边界或按真实快照语义mock，不通过弱化生产认证修复fixture。

此增量仅建立协议发现与开始门禁；不新增会话恢复、占用写接口、后台采音、Keychain、Provider访问或依赖。不代表CP-02整体或三端真实链路完成。旧端不提供能力端点时同样失败关闭，发布需服务端先升级；本轮不发布。


## 9. 共享客户端占用API层（本地前置增量）

本增量仅添加可独立测试的API原语，不接入conversation/UI，不解除§8的Cloud开始门禁，不改变默认disabled，不持久化设备ID/代际/媒体Token，不启用心跳定时器或自动接管。

`claimCallLease(sessionId, deviceId, takeover=false)`、`heartbeatCallLease(sessionId, owner)`、`releaseCallLease(sessionId, owner)`复用既有认证request；owner为`{device_id,generation}`。claim只在显式布尔true参数时发takeover=true；默认false。每次调用只发送一次请求，无网络/401/409/502重试、无补偿claim或自动release。

新增原语在fetch前校验session/device为标准带连字符UUID（大小写等价，不限制UUID版本），generation为JS正安全整数；运行时takeover必须为boolean。输入非法不发网络请求。请求只序列化契约字段，不携带调用方额外属性。

claim/heartbeat成功只接受精确五字段`session_id,device_id,generation,state,expires_at`：UUID合法且与请求对应（大小写等价），generation为正安全整数，state严格held，expires_at为合法日历日期/时间及明确时区的ISO时间戳（Z或±HH:MM）。heartbeat还须generation与请求一致；不根据本机时钟判远端租约是否过期，时序判断留后续状态机。release成功只接受精确`released:true,generation`且代际匹配。无效/缺失/额外字段或响应错配均失败关闭，不发布占用结果。

`getSessionToken(sessionId, owner?)`及`dispatchAgent(sessionId, owner?)`新增可选owner参数；不传owner保留既有调用行为，传owner时校验session/device/generation并仅附加`X-Call-Device-Id`和十进制`X-Call-Generation`，复用Authorization，不把owner放URL/query/body。owner对象被错误传入null或非法字段时不得静默走无占用路径。无跨请求全局owner缓存；后续无owner请求不能继承前次头。

业务失败继续使用ApiError的status/data原样保留结构化detail.code及冲突字段，HTTP401沿既有reqRevision失效规则，不盲目重放写请求。本轮不新增面向用户的业务错误文案，不把API层通过宣称为Cloud通话或恢复完成。

本地验证：三个POST的路径/method/精确body/认证、默认与显式接管、owner头及无owner隔离、所有成功响应校验、非法输入无fetch、业务409/502/503与401不重放、网络/JSON解析失败不自动补偿。既有disabled开始流程及全部测试树保持。
