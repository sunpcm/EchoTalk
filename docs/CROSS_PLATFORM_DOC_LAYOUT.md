# CP-05 DocTalk设置页响应式与触控（A25）

## 1. 范围与基线

基于A24本地隔离集成，仅DocChatSetup.tsx与PromptBuilder.tsx的return/JSX布局可改，可新增e2e/doc-layout.spec.ts。不改任何return前状态/回调/提交/预设内容定义，不改DocUploadCard（含A24读取）、i18n/API/store/auth/platform/依赖/Fake API/已有测试。新testid如必要应对应真实语义元素，不为旧定位器创建伪元素。

双浏览器各4个基线观察：普通字号返回按钮36高、预设约26高；320px/200%字号返回按钮覆盖真实标题文字。未复现基线横向document溢出，667横屏与960桌面文字未被覆盖。测文字Range而非全宽heading块框，避免假阳性。

## 2. 可操作性

320x568、667x320、640x480、960x720与根字号100/200%组合下，返回控件与标题/副标题文字不重叠，内容/控件不横向越界；保留标题语义、文档/Prompt输入完整可见、普通纵向滚动可达。返回/开始/三个预设及既有上传选择触控区域至少44x44 CSSpx，可经Tab正常到达并有可见焦点。预设标签与说明可折行但不截断关键含义，不降低字号/删文案或overflow-x:hidden/clip制造通过。正常桌面窗口缩小也可用，不重做整个视觉系统。

## 3. 不变量与验收

所有点击/disabled/aria-pressed/文本值、字符上限、回调及提交/返回行为保持；切换预设/编辑/Tab/缩放/resize不创建会话/申请Token/dispatch/lease/结束/媒体或上传。布局变化不能丢文档/Prompt草稿；键盘编辑输入不被快捷键抢占。仅用户明确点开始或返回沿原流程，不能为布局改业务状态。

新增默认真实Chromium/WebKit几何、文字与按钮不重叠/触控、窄屏大字号/横屏/桌面缩小、可滚动输入/状态保留/键盘与零隐式写。606产品和62旧默认E2E均保留不skip/弱化。对比两源码return前字节、完整七门禁、独立审查/两行为变异及隔离集成。每次Playwright独立output/截图testInfo.outputPath。

真实OS键盘/非零safe-area/iOS真机/Provider/数据库/Xcode/签名发布不在本增量，不安装/扩权限/push/deploy；浏览器resize不冒充OS键盘验收。
