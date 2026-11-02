# CP-06 Chromium / WebKit本地门禁（A14）

## 1. 范围和边界

在现有Playwright项目中增加WebKit（Desktop Safari设备预设），默认E2E同时执行Chromium和WebKit。沿用锁定依赖/既有Node22/pnpm，禁止升级锁文件或改产品源码来迎合测试。匹配的WebKit运行包安装已获用户明确授权，webkit-2336空白页本地启动通过；不等同Safari/WKWebView实机或原生麦克风/Provider。

CI保留现有job/check名与完整前后端门禁，只将前端Playwright安装扩展为chromium webkit，保持执行所有项目。不可skip/only/fixme/静默按环境省略WebKit或用旧executablePath。Linux WebKit实际CI运行须后续远端证据，不因本地macOS测试就宣称通过。当前不push/merge/deploy。

## 2. Fake API与新测试

Fake API增加真实鉴权GET /api/sessions/active与GET /api/sessions及/api/sessions/daily-progress，路由在UUID详情前，返回游标分页包封`{ items, next_cursor }`与单次聚合数据，稳定排序。仅本机测试服务，无业务API/数据库变更，不增加测试控制端点/生产开关。新测试每次创建唯一fixture ID，禁止依赖全局会话数量、项目运行顺序或跨测试全局开关，兼容fullyParallel和双浏览器。原有6测试保留，不删质量断言。

新增有实际UI操作的恢复/登录边界测试，至少以下5类在两浏览器默认执行：

1. 活动记录显示、点恢复出现该ID确认及采音说明，确认前/取消后零capabilities/detail/token/create/dispatch/end请求；列表请求允许。
2. 明确确认后capabilities失败：安全通用错误，零Token/创建/dispatch/结束/租约，不回显原始错误；只有再次明确重试才增加请求，无自动循环。
3. Cloud能力明确不可用，零detail/token/create/dispatch/租约，原默认门禁不松动。
4. disabled确认后重新查询详情，已结束记录拒绝，零Token/创建/dispatch；证明不能靠列表缓存恢复。
5. 恢复前能力401或等价未认证边界失败关闭，零创建/Token/dispatch及后续副作用。不是模拟真实OIDC交换，报告明确证据边界。

使用真实页面+本机Fake API，必要错误情形可用每page独立route fixture控制，记录是浏览器路由fixture而不冒称后端真协议验收。新恢复测试必须通过真实UI点选/确认，不直接改store状态或直接调resumeSession代替用户动作。可以经request fixture准备独立活动记录；准备动作和被测页面的请求计数须区分。记录具体ID/请求method+path+次数/最终UI，不使用恒真或仅截图断言。

## 3. 验收

全部Chromium/WebKit执行并明确分项计数，0skip；本地服务只监听127.0.0.1:4173/18181，结束关闭。既有419以后全部产品测试、18构建脚本、格式/lint/typecheck/双构建门禁保留。独立核查测试实际收集及两个项目、新恢复先后/禁止副作用断言、CI完整jobs/版本边界。有效变异应破坏被测行为并由实际失败捕获，恢复后完整复验。

用户要求顺利时连续推进，普通问题记录日志/文档并预算内修复，不逐里程碑停；需要新决策/权限或无法推进阻塞才交互。当前scope不扩真实IdP/Cloud/签名/发布。
