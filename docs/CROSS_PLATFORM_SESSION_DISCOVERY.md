# CP-02 活动会话发现：本地增量契约

此增量仅消费既有 GET /api/sessions/active。响应为 SessionListItem[]，后端已按 started_at/id 降序；客户端保留顺序。数据库 active 不等于媒体在线、持有占用或可以恢复。

共享 Dashboard 展示当前已认证账号活动记录：加载、空列表、成功、失败及显式重试。列表只含会话ID、开始时间及已知模式的本地化标签；未知模式用通用标签，不回显任意服务端错误/正文。说明“尚未结束的记录不代表正在通话；恢复与接管暂未开放”。失败可重试，不自动轮询、签Token、dispatch、结束、claim或请求麦克风；无恢复/接管/结束按钮。不持久化列表、Token或本地提示，不改变既有开始入口。

认证loading/anonymous/misconfigured不发列表请求、不保留上一账号数据。按已有AuthSnapshot的精确issuer+subject及auth revision隔离：退出/换号应立即清空；即使同账号退出重登，旧请求/失败/finally也不能覆盖新请求。卸载后旧请求不得写状态；React StrictMode正常可用。一个已挂载实例同时最多一个有效请求；重试期间禁重复提交。不得修改现有auth.ts安全契约来适配组件。

新增API封装沿用既有request，不回退完整历史接口；401沿用已有按请求代际失效逻辑。组件测试须覆盖真实deferred时序，而非只测试最终静态渲染：初次/空/列表/失败重试、乱序/卸载、换号或退出的迟到成功及失败、同principal不同revision；保留既有认证与App测试。API测试确认精确路径及认证头、401边界，不访问真实网络。

只证明共享客户端本地发现流程；真实IdP、WebKit/真机、原生回跳、媒体恢复/接管、心跳及CP-02整体仍未验收。

## 2. Dashboard显式结束既有活动会话

本节推进上文“无结束按钮”的首轮边界：现在允许用户显式结束其列表中的指定活动记录；仍无恢复/接管按钮，不获取Token、不调度/采音、不解除Cloud开始门禁。仅调用已有endSession(sessionId)，服务端鉴权/幂等/Cloud撤销规则保持。结束记录不代表本机可强制停止所有既有远端媒体，界面不得承诺远端音轨已释放。

每行提供本地化“结束记录”，首次点击只显示内联确认，明确展示目标ID与“将结束此会话的服务端记录，无法撤销；不保证其他端音频已停止”；确认和取消按钮可访问且语义明确。不使用window.confirm。取消无请求；确认前重新校验当前认证principal/revision、目标仍属于当前列表、尚未有结束在途，并满足§1及生命周期契约§5的前台/在线提示门禁。不是hidden且不是offline才允许发送，unknown/null沿用未知语义。

一个挂载实例最多一个有效结束请求，确认/重试按钮在途禁重复，其他行不能替换在途目标。结束前作废当前列表请求，结束在途暂停列表刷新且不排队；不因suspend/offline释放结束槽位或自动重发已发送POST（结果未知），恢复只读发现不能重放结束。结束和列表拥有独立操作归属。请求只发一次，不自动补偿或重试。

仅收到id与目标匹配且status=completed的Session响应才确认成功；成功移除对应行、清确认/错误，保留其他记录，不切分析视图或修改conversation store。旧列表/结束成功、失败或finally不能恢复已结束记录、清理新操作或污染新账号。失败保留目标和安全本地化错误，让用户显式重试相同ID，或取消退出确认；不回显服务端异常/正文。重试前身份及网络门禁仍须满足，不支持因列表更新而自动改目标。

认证失效/换号/同账号revision变化与卸载立即清除确认和结束错误、作废旧操作；重新认证的新操作可推进，即使旧POST仍pending。旧请求不再影响新状态，但已经发出的服务端写入不能撤销，不声称取消了远端请求。StrictMode清理不泄漏监听，不持久化任何ID/Token/动作。

实现只改ActiveSessions.tsx、对应测试、i18n/zh-CN.ts。覆盖确认/取消、精确ID/单次POST、双击/跨行去重、失败同ID重试、离线/后台门禁、结束在途生命周期不重发、旧列表复活、身份/revision/卸载与新旧finally隔离、异常响应及既有发现/开始门禁。所有新增文案进入i18n。

## 3. 显式恢复已有会话（disabled本地阶段）

本节推进首轮“无恢复按钮”边界：Dashboard每条记录可选择“恢复练习”，展示目标ID及本地化“恢复后将连接语音服务并请求麦克风权限”的内联确认；选择/取消不请求Token、不切语音视图、不调用媒体。保留结束入口，两种确认互斥；结束在途、恢复/新建启动在途时不能开启另一动作或替换目标。纠正组件头部过期只读描述及列表说明，仍明确记录不证明在线、接管未开放。

确认意图绑定选择时精确principal/revision及sessionId；确认前检查目标仍在当前列表、当前身份/revision、挂载、没有结束在途，visibility不是hidden且online不是false。通过后只调用新增store动作resumeSession(sessionId, origin)，origin为必需的{principal:AuthPrincipal,revision:number}，由选择意图提供而非确认时重新取账号。store独立校验origin与当前认证、UUID、idle和前台/在线提示，非法/缺失输入失败关闭不发API。unknown/null保留未知语义。

store与startSession共享一个启动槽位和sessionGen，恢复也在途去重。固定顺序：getCallCapabilities→getSessionDetail(目标ID)→checkHealthReady→getSessionToken(同ID，不传owner)。只有disabled允许继续；Cloud或能力不兼容/失败受控本地化提示并回idle/dashboard，不回退disabled。详情只接受对象、id与目标UUID大小写等价、status严格active且ended_at严格null；已结束、错ID或非法响应不取Token、不创建会话。详情中的user_id不是OIDC subject，不做错误的跨标识相等比较，服务端鉴权决定归属。Token结果必须为非空字符串token和ws_url才发布。

每一步调用前后检查sessionGen、精确principal/revision及恢复生命周期有效性。恢复在途期间认证变化、reset/goHome/end、suspend/offline使旧操作失效并立即释放启动槽位、清Token/URL/本地恢复ID，回idle/dashboard；迟到成功/失败/finally不得清掉新启动或进入媒体。订阅/适配器必须清理，旧cleanup不能清新tracker；旧请求仍pending时新显式恢复或新建可推进。生命周期只约束恢复启动阶段，不在本轮宣称支持原生后台音频管理。

有效Token完成后才原子发布sessionId、token、wsUrl、connectionState=connecting及appView=session，并沿用现有VoiceInterface连接/dispatch；之前不因恢复写入sessionId，以免恢复失败/取消误结束服务端记录。恢复不调用create/end/claim/heartbeat/release/dispatch，不修改旧VoiceInterface；自动dispatch仅现有Room连接成功后的行为，不在store触发。没有自动重试、自动恢复、补偿结束或Token持久化。仅用户再次明确确认才能重试；网络/接口错误只用本地化通用提示，不回显任意响应。既有startSession/end及Cloud开始门禁保持。

仅改store/conversation.ts及测试、ActiveSessions.tsx及测试、i18n/zh-CN.ts；不新增依赖/原生工程，不改API/auth/VoiceInterface。验证成功恢复同ID且零create、选择/取消零请求、Cloud/已结束/非法详情无Token、失效各异步阶段与新操作推进、旧finally隔离、起停互斥、生命周期与身份意图门禁、异常Token、既有结束和所有测试树。真实媒体、麦克风/旧端行为/IdP仍需外部环境另验，本地Fake API不代表三端恢复验收完成。
