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
