# CP-05 原生生命周期只读消费者（A17）

基线A16已独立APPROVED并隔离集成至7f6bed2；本契约限定A17本地增量。

## 1. 范围

范围：ActiveSessions.tsx/.test.tsx与usePollingAssessment.ts/.test.tsx四文件；统一createLifecycleAdapter，Dashboard与分析读取消费真实iOS App状态。现有createWebLifecycleAdapter保留平台API兼容；不改store、VoiceInterface、auth/API、平台实现、依赖锁/CI。通话启动/Room留A18单独处理，不能宣称整个原生采音链路完成。

## 2. 生命周期与读取归属

Dashboard与hook每effect自有实例，先subscribe再snapshot，cleanup先标失效再unsubscribe/dispose。初始native pending/失败hidden时不GET；成功active且Web不hidden后一次合格resume触发读取，其他合格事件与在途合并，不同时用whenReady和resume发重复请求。原生inactive覆盖DOM visible/pageshow/online，暂停旧读代际和timer/槽位；active后新读不被旧挂起阻塞，旧成功/失败/finally不污染。Web/SSR/Tauri沿用unknown/null、退避和清理语义。

## 3. 公共兼容与副作用边界

已有hook lifecycleOptions注入兼容，可映射到新factory webOptions；生产不传platform/app假值。有效origin、principal/revision/session/pollVersion/effect守卫不弱化；原生初始化迟到或旧effect不得发新账号请求。已有Dashboard确认结束/恢复意图绑定与写前门禁保持，生命周期事件不自动重放结束/恢复/start/token/dispatch/retryAnalysis，暂停只读不误取消已发送POST。

## 4. 验收

新流程验收先覆盖最小时序：初始化pending/active/inactive/失败；query前后原生事件；旧请求成功/失败/挂起；账号/revision/StrictMode释放后旧回调；初次读失败后有效原生事件可恢复；多消费者实例相互释放不删除别方监听。产品单测使用注入假App/事件，不能用DOM模拟冒充native状态；实际默认factory入口也要验证。保留既有全量七门禁和双浏览器；不连接真实服务或Xcode/签名。

所有订阅闭包需有本effect独立活性标记，不能只依赖下轮挂载又变true的共享mountedRef。调用resume/刷新前继续核对来源快照；后台取消旧读取不reset整store。原37项native adapter测试和A15读取语义保持，产品基线509，构建脚本18、双浏览器22，完整七门禁不减少。

用户授权顺利时连续推进，本轮不自动push/远端merge/deploy，不运行Xcode、真实Provider/IdP或模拟器设备操作。
