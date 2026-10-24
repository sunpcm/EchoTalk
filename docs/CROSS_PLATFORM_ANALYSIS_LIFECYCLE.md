# CP-05 分析轮询生命周期（A15）

## 1. 范围

在已有评估页usePollingAssessment接入现有Web生命周期适配器，暂停后台/离线读轮询，恢复前台/网络时立即重新查询状态与结果，避免并行轮询及旧响应写入新账号/会话。只改hook/assessment store及其测试，不改产品UI/后端/API/auth/platform/依赖/锁/浏览器配置；不进入Cloud/原生或真实Provider。

## 2. 调度规则

非空sessionId且认证快照authenticated/principal有效时才自动读取。初始visibility非hidden且online非false才执行，unknown/null允许原有读取；suspend/pagehide或online=false立即作废本轮读取/清timer并释放槽位。保留已展示数据，不清空评估/grammar/knowledge或伪造分析完成/失败。恢复事件仅visible且非offline，connectivity仅online true且非hidden时立即读一次；重复合格事件和timer在当前有效请求在途时合并，不排队、不自动重放写请求。后台/离线旧请求即使永不返回，恢复后新读取也可立即推进；旧成功/失败/finally不得清新槽位、写错误/数据或启动额外timer/knowledge请求。

pending/running仍按现有1s、2s、4s、最多5s的串行退避轮询；succeeded取得结果后只调用一次当前来源knowledge读取并停止timer，failed停止timer。普通网络/协议错误保留store现有错误展示，停止自动循环；后续用户显式操作或新的合格resume/online事件可重新读取，不无条件无限重试。foreground只GET，不自动retryAnalysis POST/创建/Token/dispatch/采音。

## 3. 读取归属与清理

每一读取绑定sessionId、独立本地effect/请求代际、认证精确principal(issuer+subject)/revision及生命周期。sessionId/pollVersion变化、卸载、StrictMode旧effect清理、账号/revision变化、后台/离线使旧读取失效；旧结果不能影响新请求，不能通过重用cancelledRef在新effect设false后复活旧回调。认证事件失效立即释放旧循环，不自动用新身份重放旧意图；同principal新revision也失效。本轮auth变化后的重新进入/显式操作由现有AuthGate/挂载处理。

assessment store现有reset递增总generation保护保持，retryFailedAnalysis POST行为和去重/账号清理不弱化。为hook取消读返回可增加向后兼容的可选isCurrent/shouldApply predicate参数到refreshAnalysis与fetchKnowledgeStates：读取发送前、status后启动结果GET前、结果/失败写入前和knowledge前后都核验；不传参数保持现有公共调用兼容。predicate失效则不发后续请求、不写旧数据/错误，也不抛出未处理拒绝。不能为取消读而reset整个store或取消仍在途的用户retry POST；不用全局可变owner抢其他调用，不新建请求缓存/自动重试写请求。

复用createWebLifecycleAdapter，先subscribe再getSnapshot消除空窗；effect清理标记失效并unsubscribe/dispose/clear timer，初始无session不监听、不发请求，无模块导入副作用。读取success后的同步store通知可能取消/换号，必须再次核验后才发knowledge/排timer。类型和公共方法参数向后兼容。

## 4. 验收

fake timers+deferred覆盖初始组合/未知、前后台/网络恢复合并、pending退避、终态停止、挂起旧请求不阻新循环、旧成功/失败/finally隔离、切session/pollVersion/StrictMode/卸载/精确auth变化、成功同步通知取消后零knowledge、store两阶段status/结果/knowledge取消无写入、retry POST不受读暂停误取消。增加真正hook测试文件，0收集不算通过。保留全量产品/构建脚本/双浏览器及7项门禁，独立探针和有效变异验证。模拟DOM事件不冒充原生OS/真实网络/Provider。

用户要求顺利连续推进，更新日志/文档后集中查看；独立10次账本与不限时/无进展2保持，不自动push/远端merge/deploy。
