# CP-05 原生 Room 挂载与音轨中断（A19）

## 1. 范围

基于A18@1875c45，修改VoiceInterface.tsx及其测试，可为安全文案修改zh-CN.ts；不改store/platform/API/auth/后端/依赖锁/生成工程。继承A12 dispatch、A13连接中断、A18启动归属契约。真实OS、签名、Provider仍另行验收。

## 2. 挂载门禁与归属

Room消费统一createLifecycleAdapter。异步native监听仅在effect中建立，不在render创建/释放监听。每个sessionId/sessionGen及精确principal(issuer+subject)/revision拥有自己的adapter、订阅和timer；连接资格变化、卸载与取消释放自身资源。旧setup/ready/error/event/timeout/cleanup不得影响新归属或触发dispatch。

原生首次注册/状态pending期间不得挂载audio=true的LiveKitRoom，不把初始hidden当确定后台。原生whenReady后重新核验snapshot/auth/gen/token/state才能挂载；失败或hidden/offline关闭。pending最多10秒后failConnection、清token及资源，安全提示，不自动重试。Web/Tauri无需额外native等待，unknown/null兼容，初始hidden/offline绝不短暂挂载Room。无条件hooks顺序与StrictMode清理保持正确。

## 3. 连通后中断

挂载门禁与Room中断共享同一生命周期事实源及明确资源所有权，不创建第二个pending native来源使刚建立的Room立即误断。subscribe-before-snapshot，消除就绪到Room挂载/roomRef绑定/订阅的空窗；丢失就绪或前后台条件时不能遗留可采音Room。

当前归属下原生inactive、Webhidden/suspend、offline必须同步stop所属Room全部本地track，再failConnection并清token/unmount。回到active/online只更新事实，不能自动重连、采音、dispatch/end/lease或其他写。SDK失败、结束、换身份及代际保护不弱化；同gen dispatch最多一次。精确身份变化后旧回调静默，不停止新Room或写新store。

## 4. 最小时序验收

保留旧Web/SDK/dispatch回归，增加真实默认factory+假App插件路径，不能只Mock DOM冒充native。覆盖pending零挂载/零dispatch、active后挂载一次、inactive阻DOM恢复、注册/读取失败、10秒永挂退出、取消和换session/gen/issuer/revision、旧ready/timer/listener迟到、StrictMode释放延迟handle、就绪与Room绑定间inactive、已连接inactive同步stop（测试监听回调返回前）、前台零自动副作用、显式回首页再进入成功。保留unknown/null Web兼容。测试fixture匹配真实导出接口，不能删除断言或绕过质量门禁。

## 5. 验收边界

完整七项format/lint/typecheck/product test/build-script test/build/Chromium+WebKit E2E；检查串行，冻结交付后独立review及集成复验。仅本地Mock测试；不新增安装、不Xcode/设备操作/真实服务、不push/部署。
