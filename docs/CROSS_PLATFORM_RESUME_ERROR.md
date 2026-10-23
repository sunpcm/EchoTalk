# CP-05 恢复失败与取消的终态区分（A23）

## 1. 基线与范围

基于A22本地隔离集成。RESUME-ERR-01已由真实store和双浏览器复现：getSessionDetail返回503后store同步发布idle，ActiveSessions订阅立即作废本次reqId，随后resumeSession返回false无法进入组件错误分支。全局安全错误仍显示、同目标确认可再次点击、无自动Token/写，所以不是完全不可恢复；需恢复预期的专用错误与重试呈现。

仅允许ActiveSessions.tsx、其test.tsx及新e2e/session-resume-error.spec.ts，必要时可最小修改store/conversation.ts及其test.ts（须保持所有调用者既有boolean语义并解释必要性）。不改现有E2E/Fake API、布局/i18n/认证/API/平台适配器/依赖/后端或Cloud门禁；不放宽既有测试/守卫。不要凭error非空字符串或所有idle都相同来猜取消。

## 2. 行为

当前精确账号/认证代际、当前意图的恢复正常失败（能力检查、详情读取/校验、健康检查、Token读取/校验等）必须释放在途状态，保留正确的可见UUID和确认意图、显示本地安全resumeError及启用专用重试和取消。专用重试只因用户明确点击而重试同一目标；一次点击只有一套顺序调用，在途重复点击不重复调用。不泄漏原始接口/Provider错误。失败不自动Token/dispatch/lease/创建/结束/媒体；前序失败不进入后续步骤。新失败/成功后按钮与错误状态一致，取消不产生写，成功仍原会话连接流程。

显式goHome/reset/endSession、用户取消、生命周期后台/离线、认证变化、卸载/StrictMode等造成的失效必须继续立即释放UI槽位，不能等待旧Promise；允许后续合法显式操作。旧请求晚失败/晚成功/旧timer/回调不能清理新意图或污染错误、Token、会话与媒体。不能简单删idle订阅、不能取消所有代际保护来让专用retry出现；区分正常失败与取消要有实际操作归属证据。健康重渲染和无关store通知不取消操作。

## 3. 时序验收

新增至少一项真实store的默认双浏览器详情503→专用安全错误/完整目标/44px重试→再次显式点击→同记录再次GET（无Token/写）→成功或可恢复错误，不能spy替换resumeSession冒充真实通知联动。补充产品单测覆盖其他前序失败、重试单次/取消零副作用；goHome/reset和生命周期/认证取消后立即新操作，旧Promise晚成败不污染新操作；正常失败的同步idle通知不得吞错。已有全部测试/56默认E2E保留，不能使用任意sleep替代可观测状态。

完整七门禁、独立审查/变异/本地隔离集成。每次浏览器output独立且截图testInfo.outputPath。真实OS/Provider/数据库/依赖安装/Xcode/设备/签名/push/deploy不在范围，不宣称三端完成。
