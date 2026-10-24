# CP-05 活动会话列表响应式与触控（A22）

## 1. 范围与事实

基于A21@2ce9b9e，仅ActiveSessions.tsx的render/JSX布局和必要i18n/zh-CN.ts可改，可新增e2e/activity-layout.spec.ts。不改render前请求/认证/生命周期/确认状态逻辑，不改store/API/platform、依赖锁、Fake API或已有测试。双浏览器8项观察确认：320px根字号200%下document宽约445px，卡片溢出、ID宽0、按钮到屏外；普通字号操作高约20–24px。窄屏普通字号未必溢出，勿扩大事实。

## 2. 布局与可操作性

320x568、667x320横屏、640x480桌面缩小、960x720及根字号200%组合下，活动卡片/列表/确认结束与恢复面板不得横向越界或把控件挤出viewport。按可用宽度折行/分组，ID/模式/开始时间保持可辨；列表ID可合理折行或有可见截断，但不能被缩成0宽。确认目标完整UUID必须可见、可换行，不能仅title/aria或截断代替可视核对。窄屏和大字号标签/说明/错误完整可读，不能用overflow-x:hidden/clip遮盖缺失或降低字号来制造绿灯。

列表恢复/结束、确认/取消/重试（含读取失败重试）点击区域至少44x44 CSSpx，互不覆盖，可经正常纵向滚动达到；键盘Tab也能到达操作，焦点样式保留。桌面紧凑可用，不强制全局重设计。日期完整可读，保持现有格式和用户语义。

## 3. 不变量

仅呈现改变，所有原onClick/disabled/确认目标、单次写、在途门禁、角色/账号代际、生命周期取消、尚未查询状态及错误安全文案保持。不能为缩短文案隐去关键不可撤销/麦克风提示，不改变API/模式能力门禁/请求数。打开/取消确认、缩放/resize/Tab不得发结束/创建/恢复/dispatch/lease写或启动媒体，真正确认仍原流程。

## 4. 验收

新增默认Chromium/WebKit真实几何和可见性E2E，以合法UUID/现有API schema的隔离route fixture显示列表；覆盖窄屏/大字号/横屏/桌面、结束和恢复完整目标、取消及失败重试按钮44px、键盘到达与无隐式写。既有所有产品回归与38默认浏览器保留、不skip/弱化。比较render前源码不变量，完整format/lint/typecheck/product/build-script/build/e2e七门禁，独立review与集成。

每次Playwright运行使用独立output证据目录；截图用testInfo.outputPath，避免新运行清掉旧失败上下文。真实OS键盘/safe-area/媒体、发布不在本增量，不安装/扩权限/真实服务/Xcode/设备/push/deploy。
