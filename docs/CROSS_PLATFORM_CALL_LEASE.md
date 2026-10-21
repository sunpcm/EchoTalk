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
