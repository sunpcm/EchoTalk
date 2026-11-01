# CP-02/CP-05 Web连接失败与中断（A13）

## 1. 范围

延续A12，补齐当前已有Token的connecting/active通话在SDK报错（包括Token被拒）、断开以及Web后台/离线时的本地安全关闭。只用现有API/store/platform适配器；Cloud门禁、默认disabled、后端、锁文件和原生插件不变。真实Token过期/网络/媒体及iOS/macOS系统中断仍需外部验收。

## 2. 当前失败关闭

当前Room的onError、onDisconnected（不论undefined/CLIENT_INITIATED/其他reason，只要客户端状态仍connecting/active且有Token）、Web suspend/pagehide或online=false，立即停止该Room本地音轨（不等待disconnect），清Token/URL并卸载Room。初次进入已有Token的Room若Web快照hidden/offline也失败关闭，不短暂保留可采音Room。unknown/null不当作离线。结束/退出正常清理后的SDK回调应由状态/归属门禁忽略，不把服务端会话伪称已结束。

进入独立connection_failed或等价明确本地状态，显示“语音连接已中断，音频已停止”的本地化提示；Token被拒、连接失败、网络/后台事件可共用安全通用提示，不显示SDK原始message/reason，不记录原始Error。提供返回主页按钮和说明“返回后可明确恢复已有记录”。禁止window.location.reload、自动重连/重拉Token/dispatch/创建/结束/释放租约/分析轮询、轮询式重试或持久化媒体Token。在线/pageshow/resume不能自动恢复采音；用户返回主页后再次显式开始/确认恢复才可继续。

## 3. 来源与资源归属

所有回调绑定创建该Room时的sessionId、sessionGen及精确认证principal/revision；发送或修改前核对组件存活、当前state/token及来源，身份/代际变化、结束/返回主页/卸载后旧事件不得污染新操作或停止新Room音轨。A12 dispatch Promise在connection_failed后必须失效，后来的成功/失败不能改为active/dispatch_failed或重连。保留A12单次调度、同步set之后发送前门禁和所有既有安全断言。

Web lifecycle只在已有Token的Room生命周期订阅，复用createWebLifecycleAdapter，正确subscribe/dispose及StrictMode/监听清理；组件未挂载时没有全局监听和导入副作用。事件时捕获并停止该Room的轨道，不用可变引用误停新Room。初次快照、同步订阅/通知重入、旧onConnected/onError/onDisconnected和迟到dispatch均须覆盖。已存在的DataChannel agent_error失败UI/分析边界保持，不借此重做功能。

## 4. 验收

SDK onError、断开全部原因、offline/pagehide/hidden及初始hidden/offline的停止/清Token/UI；恢复在线/前台零自动网络或挂房间；当前正常连接/dispatch成功保持；结束/退出/新会话/同subject异issuer/同principal新revision/卸载与StrictMode监听隔离；未挂载不监听；失败后明确返回主页再新启动/恢复可用。保留完整产品/构建脚本、7项质量/E2E门禁，独立模拟Room/DOM事件探针及有效变异；模拟验证不冒充物理音频或系统生命周期。

## 5. 连续推进规则

用户2026-10-22要求顺利时直接衔接下一里程碑，不逐里程碑汇报；更新日志/文档留待集中查看。沿用agy实施、Codex独立评审，发现新产品/权限/模型决策或无法继续的阻塞才交互。每独立任务仍新账本10次，不限时、保留无进展2及所有交付门禁；通过不自动授予push/远端merge/deploy权限。连续推进不减少独立验收，不自动修改全局skill。

## 6. 同 principal 认证刷新后的当前中断

认证刷新与媒体资源生命周期分开处理。同一 Room 的 `sessionId/sessionGen` 和精确
principal 不变时，已交付的同 principal 认证通知只更新新 callback 可用的 revision；
刷新本身不得替换 Room、停止健康本地音轨或重发 dispatch。通知到达前，旧 revision 已捕获的
SDK callback 继续拒绝；通知到达后，新的 `onConnected/onError/onDisconnected` 与
Web suspend/offline 使用新 ownership。物理生命周期 adapter 可以保持稳定，但每次认证
通知交付都必须建立新的业务监听归属；通知前保存的旧业务监听函数永久失效，不能因同一
principal 的新 revision 已交付而重新获得停轨或失败关闭权限。

当前 SDK 错误/断连及当前后台/离线事件仍按 §2 立即停止本 Room 全部本地音轨、清除
Token/URL、卸载 Room 并进入 `connection_failed`。旧 revision、旧会话、身份变化、结束、
取消、返回主页或卸载后的迟到事件仍零状态改写、零跨 Room 停轨和零网络写请求；恢复
在线/前台仍不得自动连接、dispatch、取 Token 或结束会话。

Web 的订阅后 hidden/offline 快照是立即失败事实。native 初始 adapter 在监听注册或
`getState` 尚未完成时会保守返回 hidden，该值是“尚未就绪”门禁，不是真实后台；业务订阅
后不能据此提前关闭。只有 native 能力就绪或 `whenReady` 后复核到真实 hidden/offline 才
停止音轨；pending 仍由原 10 秒预算和真实 lifecycle event 安全关闭。
