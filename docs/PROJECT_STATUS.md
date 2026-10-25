# EchoTalk 当前状态与变更决策

> 本文是 EchoTalk “当前已经实现什么、最近改变了什么、明确没有采纳什么”的权威入口。
> 未完成工作维护在根目录 [`TODO.md`](../TODO.md)；具体架构和人工验收步骤仍由各阶段技术文档负责。

## 维护基线

- 最近本地核对日期：2026-10-24；以下 main/CI 记录保留为历史发布证据，本轮本地三端增量未推送或部署。
- 代码基线：`main@286a3db68ba2b43e76df5df3b9f7d24444a3a796`（#92 合并后）；
  本轮进度条修复见 [#90](https://github.com/sunpcm/EchoTalk/pull/90)
- 自动化证据：[#92 CI run 39348513442](https://github.com/sunpcm/EchoTalk/actions/runs/39348513442)；
  [#90 检查记录](https://github.com/sunpcm/EchoTalk/pull/90/checks)
- 证据范围：上述 CI 已验证格式、Lint、TypeScript、前端构建、Vitest、Playwright、Ruff、
  PostgreSQL 空库迁移和后端覆盖率测试。它不能代替真实 LiveKit、第三方 Provider、移动端真机
  或生产部署验收；这些边界应在对应验收文档或 `TODO.md` 中单独记录。

## 2026-10-25 本地主要容器主题颜色过渡实施记录（A35）

基于 TODO.md P2“按主要容器补齐主题颜色过渡，避免子元素瞬间切色”契约完成本地实施。在复用既有三主题设计 Token 及 body 250ms ease 规范的基础上，为覆盖在 body 之上的应用主要容器、卡片、设置抽屉及显式语义文本补齐平滑的主题颜色过渡，消除切换主题时子元素的瞬间切色现象。

- 本地实现与过渡作用域：在 `index.html` 的既有 `#root` 上添加 `theme-transitions` 单个 scope class（不改动首帧主题脚本、head 或 DOM 结构）；在 `styles.css` 中为 `.theme-transitions` 作用域内的核心语义类（`.bg-bg`, `.bg-surface`, `.bg-surface-alt`, `.card`, `dialog.settings-drawer`, 粘性 header, `.text-text-default`, `.text-text-muted`, `.text-text-faint`, `.border-border-default` 等）声明 `0.25s ease` 颜色过渡；不影响 Webpack 或非应用 DOM，不引入全局 `transition: all` 或布局/尺寸过渡。
- 组合类保护与 hover 能力：针对使用 `transition-shadow` 的两处既有容器（`App.tsx` DocTalk 按钮与 `RecommendedScenarios.tsx` 卡片），组合 `transition-colors` 并在 `styles.css` 中声明复合过渡（保留 `box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)` 与颜色 `0.25s ease`），卡片 hover 阴影过渡保留原时长与 easing。
- 减少动态效果与双浏览器验证：完全继承 A27 的 `prefers-reduced-motion: reduce` 规则（过渡时间降为 0s，立即生效，drawer 动画为 none，功能性 spinner 保留）；新增 `e2e/theme-transitions.spec.ts` 双浏览器回归，通过 Web Animations API 真实捕获 CSSTransition 并在 125ms 中点证实插值中间态；窄屏与 200% 字号由 Codex 独立探针补验，0 溢出且主要根容器几何保持，仅发单次精确 PUT，0 pageerror。
- 契约与记录见 [主要容器主题过渡验证](./verification/cross-platform/CP-05-THEME-TRANSITIONS.md)。未推送、未部署、无真实外部 Provider 或多设备联调，不代表三端整体完成。

## 2026-10-25 本地安全诊断一期实施记录（A34）

基于 TODO.md CP-06“补充按版本/平台关联的诊断信息；验收：可定位 API、LiveKit、Agent 错误，不采集 Token、密钥或默认上传文档/对话正文”完成本地一期实施。新增结构化脱敏日志辅助模块 `diagnostics.ts`，统一按纯净白名单 record 记录关键异常，彻底消除此前在控制台直接输出未经脱敏外部 parsed 对象的缺陷。

- 本地实现与白名单脱敏契约：record 输出严格限定字段集合（`schema_version: 1`、`app_version` 取自 package.json、`platform` 取自 `detectPlatform()` 并安全回退 `"unknown"`、8 个冻结 `event` 枚举）；从零显式构造，严禁 spread 未知字段或正则脱敏；`status` 仅允许 100..599 整数且仅限 `api_http_failed`；`agent_code` 严格限制为 5 项白名单，敏感 token、恶意注入及未知非字符串一律安全映射为 `"unknown"`，绝不原样回显；控制台按 warn/log/error 分级输出；helper 本身故障局部隔离，绝不阻断业务逻辑；成功 API 请求零新增日志。
- 接线与原语义保持：`api.ts` 接入 `api_network_failed`（仅真实 fetch reject）与 `api_http_failed`（仅 status，不输出路径/头/正文），原 401 代际失效、错误解析与 `ApiError.data` 逐字节保持；`VoiceInterface.tsx` 替换 6 处自由日志（特别消除 `agent_error` 输出 parsed 对象风险），原状态转换、音轨停止、`setAgentError` 与 UI 错误卡片渲染保持原样。
- 质量验证覆盖：单测 `diagnostics.test.ts` 覆盖严格字段集合、平台检测与回退、所有 8 项枚举与日志级别、status 整数范围、`agent_code` 严格白名单与脱敏、序列化 canary 缺失保证及 console 异常隔离；`api.test.ts` 追加 7 项真实请求入口回归；`VoiceInterface.test.tsx` 追加 7 项真实入口回归（包含捕获 `useDataChannel` 注册真实回调并输入带敏感 canary 的 payload 验证脱敏输出与原 UI 终态）；`e2e/diagnostics.spec.ts` 双浏览器真实页面回归受控 HTTP 503 注入，验证安全 record 产生、全量控制台无敏感 canary 泄露、页面重试可恢复、0 pageerror 及零业务写。
- 契约与记录见 [本地安全诊断一期验证](./verification/cross-platform/CP-06-SAFE-DIAGNOSTICS.md)。未实现遥测上报，未连接真实外部 Provider 或多物理端联调，CP-06 整体继续推进。

## 2026-10-25 本地回答推荐作用域无歧义编码实施记录（A33）

基于 TODO.md A26 P2 后续候选“将回答推荐scope键的id/text直接拼接替换为无歧义元组编码，并覆盖分隔符外部ID”完成实施。消除直接冒号拼接导致外部包含冒号的合法 ID 与文本发生碰撞的缺陷（如 `id='seg', text='What:is your hobby?'` 与 `id='seg:What', text='is your hobby?'`），将 `AnswerRecommendations.tsx` 中的 `currentScopeKey` 编码升级为无歧义二元组 `JSON.stringify([latestQuestionSegment.id ?? "", latestQuestionSegment.text.trim()])`。

- 本地实现与作用域隔离：采用标准 JSON 序列化二元组，保持原 `isWaiting` 与 `null` 门禁，保持默认空 ID 与空白 trim 语义；同问题健康重渲染保留复制反馈，原 1500ms 定时器到期准时清除且不被重渲染重置计时，卸载清理机制不变；其他产品逻辑、布局、文案均逐字节保持。
- 质量验证覆盖：单测 `AnswerRecommendations.test.tsx` 新增 5 项真实回归用例（覆盖冒号边界碰撞切题即时清除、旧 pending 复制切题后延迟完成不污染新题目、冒号碰撞交叉竞争下新题目反馈不被旧回调/旧定时器篡改、同 tuple 重渲染不重置 1500ms 计时、缺少 ID/引号/反斜杠/Unicode/空白 trim 边界）；`e2e/answer-recommendations.spec.ts` 复用现有隔离 fixture 与 hook stub 新增双浏览器回归，覆盖冒号边界碰撞切题及迟到 clipboard 场景，断言新题目可再次成功复制、0 pageerror 及零会话/令牌/租约/调度隐式业务写。
- 契约与记录见 [回答推荐作用域编码验证](./verification/cross-platform/CP-05-ANSWER-SCOPE.md)。未推送、未部署、无真实外部 Provider 或多设备联调，不代表三端整体完成。

## 2026-10-25 本地主题 Token 引用清点与确认面板修复实施记录（A32）

基于 TODO.md P2“清点主题 token：保留 Webpack 正在使用的 brand-_，处理未使用的 scrollbar-thumb、header-bg”完成实施。经运行时引用审计，删除 `packages/configs/tailwind-config/theme-tokens.css` 中无运行时引用的 `--scrollbar-thumb` 与 `--header-bg` 在三主题下的定义（总 6 行）；保留 Webpack 应用正在活跃消费的 `brand-_`及全部其他主题 token。同时修复`ActiveSessions.tsx`确认面板因类名拼写缺失桥接导致的背景透明与边框继承缺陷，将结束/恢复两面板的`bg-surface-subtle`修复为既有`bg-surface-alt`，两面板及取消按钮的 `border-border-subtle`修复为既有`border-border-soft`（共 4 处元素替换）。

- 本地实现与样式修复：删除 2 个未被消费的主题 token；采用既有桥接语义色修复两面板弱背景与软边框，不添加 alias 掩盖拼写，不引入 transition 或动画，保留 44px 触控与全部已有业务交互；不改变 DOM 结构与文案。
- 质量验证覆盖：新增 `apps/vite-app/e2e/theme-tokens.spec.ts` 双浏览器真实页面回归，结合既有 active fixture 与主题选择器，逐主题（warm/cool/dark）验证结束与恢复两面板的 computed `backgroundColor` 与 `borderColor` 精确匹配真实 CSS 变量 `--surface-alt` 与 `--border-soft`，断言背景非透明；覆盖 390px 窄屏与 200% 根字号布局无横向溢出；验证取消后原列表可再次操作、确认前与取消零业务写、全流程 0 pageerror。
- 契约与记录见 [主题 Token 审计与确认面板验证](./verification/cross-platform/CP-05-THEME-TOKENS.md)。未推送、未部署、无真实外部 Provider 或多设备联调，不代表三端整体完成。

## 2026-10-25 本地主题缓存异常容错实施记录（A31）

基于 TODO.md P2“主题保存后端支持跨设备水合”与既有 CP-05-THEME-SYNC 契约完成浏览器 localStorage 异常容错实施。针对浏览器隐私模式、跨域限制或存储配额已满时 `localStorage` 抛出 `SecurityError` 或 `QuotaExceededError` 的场景，提供安全回退与持久化恢复能力，防止阻断 store 冷导入、UI 即时渲染或将成功后端水合误报为 API 失败。

- 本地实现与容错：`readStoredTheme` 对属性 getter 与 `getItem` 实施窄范围 `try/catch`，异常时安全回退 `"warm"` 默认主题；封装内部 `safeSetStoredTheme`，`setTheme` 写缓存失败不阻断 store/DOM 更新与认证状态下的后台 300ms 防抖 PUT 调度；`fetchSettings` 水合成功时写缓存失败被内部隔离，store 正常水合并清除 `loading`，`error` 保持为 `null` 且不误发额外 PUT；真正 API 失败原有错误报告不受影响；Storage 恢复后下一次显式选择正常持久化；仅拦截 `localStorage`，严格避免破坏 `sessionStorage` 中的认证凭据。
- 质量验证覆盖：单测 `settings.test.ts` 新增 12 项回归用例（覆盖 getter/getItem 抛错、非法值/空值、配额溢出与安全异常、默认值回退、匿名零请求、认证 PUT 不受阻、水合写缓存失败不误判、真实 API 报错完整保留、恢复后再次选择持久化）；新增 `e2e/theme-storage.spec.ts` 双浏览器真实页面回归，覆盖冷启动 getter 抛错安全回退、切主题写配额超限与恢复持久化、后端水合写缓存失败无报错，全流程 0 pageerror。
- 契约与记录见 [主题缓存容错验证](./verification/cross-platform/CP-05-THEME-STORAGE.md)。未推送、未部署、无真实外部 Provider 或多设备联调，不代表三端整体完成。

## 2026-10-24 本地 CI 质量门禁接线实施记录（A30）

基于 TODO.md RF-04 CI 真实性与 CP-06 完整质量门禁要求，完成本地 `.github/workflows/ci.yml` 的 `test-frontend` steps 顺序与命令对齐实施。将 CI 执行步骤对齐本地 8 项真实质量门禁（Format、Lint、Typecheck、直接 Vitest 单测、18 项构建脚本测试、Fake API 原生子进程测试、Build 以及双浏览器 E2E）。通过精确 `--filter vite-app` 入口排除根目录测试占位任务，并通过 `turbo --force` 避免 CI 缓存回放；保持依赖冻结安装、Playwright 安装步骤与 working-directory、Node 22 / pnpm 10.26.0、test-backend 与 ci 聚合 job 成功断言全部不变。

- 本地配置与命令映射见 [CI 质量门禁验证](./verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。
- 本节仅记录本地配置与实施事实，不宣称独立评审或验收结论；未触发远端 GitHub Actions，不把本地门禁通过当做远端 Linux CI 已通过。

## 2026-10-24 本地 Fake API 契约与真实进程回归增量（A29）

基于 TODO.md P2“Fake API严格解析带项目后缀的analysis-success grammar路径并补回归”及真实 `lib/api.ts` 的 `UserSettingsResponse.theme` 必需三值枚举契约完成实施。修复了 Mock 缺少 theme 字段的问题，重构了 assessment 与 grammar 的严格完整 pathname 锚定匹配，支持项目后缀 slug 并拒绝假命中；支持 `E2E_API_PORT=0` 并新增 Node 原生 `node:test` 真实子进程回归测试套件。本地增量经本地门禁与评审核验通过；无真实外部 Provider 或生产部署。

- 本地质量验证：新增真实 runner `pnpm test:fake-api`（`node --test scripts/fake-api-test.mjs`），覆盖 8 个测试套件/27 项断言，包括动态端口绑定、稳定就绪消息、无需认证的健康检查、401 缺/错 token、theme 必填三值枚举、带项目后缀的 assessment 与精确 session_id、带项目后缀的 grammar 与精确空数组返回、12 类负向 404 路由测试，以及有界子进程退出与清理保护。
- 门禁扩展与 E2E 保持：quality 门禁正式由 7 项扩展为 8 项（含 `fake-api-test`），648 项 Vitest、18 项构建脚本测试、120 项 Chromium/WebKit 双浏览器 E2E（0 skip / 0 failure）全部通过。
- 契约与记录见 [Fake API 契约验证](./verification/cross-platform/CP-06-FAKE-API-CONTRACTS.md)。真实 Provider、真实 LiveKit 及多设备仍待后续外部验收，不代表三端整体完成。

## 2026-10-24 本地主题持久化可靠性与稳定选择器增量

基于 TODO.md P2“主题保存后端支持跨设备水合”与“统一主题按钮边框宽度，消除选中时 1px 布局抖动”契约完成客户端本地实施。保持 local-first 体验，完善了认证代际与精确身份绑定、单在途串行意图合并、水合竞争防护及 2px 固定边框无抖动选择器。本地增量经 Codex 独立评审 APPROVED；无真实设备或 Provider 联调，未推送或部署。

- 本地质量验证：单元测试 648 项全部通过（相对基线 620 增加 28 项真实异步回归测试），覆盖匿名/未认证门禁、嵌套选择防覆盖（TH-01）、水合时序基准防回滚（TH-02）、fetch 槽位隔离与身份复核（TH-03）、过期 sequence 零发布与负向断言恢复（TH-04）、两门状态机防抖（TH-05）、换号同步拦截与旧 finally 隔离（TH-07）、跨身份 sequence 隔离水合与解死锁（TH-08）、通用保存操作所有权与换号防重入解死锁（TH-09）、未认证发送前门禁失败关闭（TH-10）、同账号 revision 变动物理串行占用与旧请求不发布（TH-11）、取消分支意图归属保护不误清他人新意图（TH-12）等。
- 双浏览器 E2E 覆盖：Chromium 与 WebKit 双浏览器共 120 项全部通过（新增 6 项），验证仅向后端 PUT `{ theme }`、防抖末值合并、独立 BrowserContext 水合（共享本地模拟服务状态，明确非真实双设备）、后端失败本地保持与再次选择恢复，以及在窄屏、默认和 200% 大字号下三个主题按钮统一 2px 固定边框且下方内容位移差为 0px。
- Codex 独立完整七门禁通过：648 产品 / 18 构建脚本 / 120 双浏览器、专用 PostgreSQL 269 项（73.72%）；另有 20 项私有时序与 8 项独立浏览器几何探针、两项有效变异通过。
- 契约与本地记录见[主题持久化验证](./verification/cross-platform/CP-05-THEME-SYNC.md)。真实跨物理设备与外部 IdP 仍待环境验收，CP-05 整体继续推进。

## 2026-10-24 本地颜色过渡与设置抽屉减少动态效果增量

基于 TODO.md P2“为颜色过渡和抽屉动画支持 prefers-reduced-motion”契约完成纯 CSS 媒体查询适配，零新增 JS 运行时监听或依赖。Codex 已独立验收；本轮从 PR #98 已合并的 `main@80fb8ec` 开始，仅本地提交/集成，未 push 或部署。

- Codex 独立质量验证：全量 7 项门禁通过，620 项产品 Vitest、18 项构建脚本测试、114 项双浏览器（Chromium/WebKit 各 57 项，含新增 10 项 prefers-reduced-motion 专用测试）通过。
- 另有 4 项独立双浏览器探针、2 项有效变异及专用 PostgreSQL 后端 269 项（73.72% 覆盖率）通过；既有迁移仅恢复空的专用测试库至 `c03_call_leases`，无本轮 schema 改动。
- 覆盖 reduce 与 no-preference 偏好下 body computed transition、抽屉 slideInRight 动画消除、实时动态切换偏好、功能性 loading spinner 动画保留、外观主题切换语义以及零隐式业务写请求。
- 契约与验收见[减少动态效果验证](./verification/cross-platform/CP-05-REDUCED-MOTION.md)。真实 OS 系统级联动与硬件屏幕阅读器仍待设备验收，CP-05 整体继续推进。

## 2026-10-21 本地认证里程碑

共享客户端的认证快照、精确账号身份、账号切换清理、异步数据代际与401请求绑定已通过独立评审，并在隔离分支 `codex/cross-platform-integration` 完成本地集成。代码提交 `e1018b9`，集成提交 `727e067`；未合入主 checkout，未 push、未运行本轮远端 CI、未部署。

- 本地验收：200项产品测试、27项独立竞态探针、18项构建隔离测试、6项 Chromium/Fake API E2E，以及格式/lint/类型/Vite与Webpack构建通过。
- 6个关键门禁变异均被产品断言杀死，恢复原字节后200项测试再次通过。
- 同一在途 OIDC code/state 只交换一次，即使期间退出/新登录也不重新消费旧state；旧callback不覆盖新身份或SDK凭据，正常新UserLoaded仍可恢复登录。
- 集成后端源码与本轮已通过269项专用PostgreSQL测试的指纹一致，覆盖率73.72%。本次前端增量未修改后端。
- 真实IdP、原生系统认证回跳/Keychain、自动续期、WebKit/真机和Cloud真实媒体接管仍未验收；**CP-04整体仍未完成**。见[本地认证验证规范](./verification/cross-platform/CP-04.md)及[跨平台计划](./CROSS_PLATFORM_ARCHITECTURE.md)。
- 按用户要求在此里程碑停止后续派发，复盘自动评审流程；原始报告、用量与证据只保存在本地 `.review/reports/workflow-pilot-auth/`。

## 2026-10-21 本地活动会话发现里程碑

共享 Dashboard 已消费既有 `GET /api/sessions/active`，展示当前账号尚未结束的记录、加载/空状态和失败显式重试；退出、换号、同账号重新登录以及迟到成功/失败/finally按身份和代际隔离。未知模式使用安全通用标签，不回显服务端错误详情。代码 `5a60333` 已通过独立评审并快进本地隔离集成分支；未推送、未部署、未运行远端 CI。

- 独立本地验收：228项产品Vitest、18项构建隔离测试、5项私有边界探针、既有6项与新增2项 Chromium/Fake API E2E、格式/lint/类型及Vite/Webpack构建通过；专用PostgreSQL后端269项、覆盖率73.72%通过。
- 窄屏390px截图已检查；本地集成全部批准文件hash与实施验收源码一致，后端源码与测试版本一致。
- 活动记录不等于媒体在线或持有占用；本轮不获取媒体Token，不恢复采音，不接管、不发心跳、不自动轮询或持久化列表。真实IdP/WebKit/原生回跳/iOS真机/Cloud媒体仍未验收，**CP-02整体仍未完成**。
- 到此停止下一批派发，按用户约定评估新版review-loop。完整证据仅存本地 `.review/reports/workflow-discovery/`；工作流变更不等于已证明节省Codex额度。

## 2026-10-22 本地通话能力门禁增量

客户端每次开始练习（含DocTalk）先读取已认证的`GET /api/call-capabilities`，严格验证协议1的精确两字段并禁用缓存。只有disabled进入既有health/create/token；查询失败、接口缺失、不兼容协议或livekit_cloud模式均失败关闭并允许用户显式重试。认证事件及异步完成边界会释放失效启动，旧回调不覆盖新启动，同principal更新不打断已启动的正常通话。代码`0753dab`已独立评审并快进本地隔离集成分支，未推送/部署。

- 本地独立证据：252产品测试、18构建脚本测试、20私有探针、既有6项与新增6项Chromium/Fake API用例，格式/lint/类型/双构建通过；3个关键变异被产品断言拦截，原字节恢复后重验通过。
- 专用测试容器恢复并核验空schema后，沿既有授权恢复已审查迁移；后端269项、覆盖率73.72%通过，原始环境失败记录保留。未访问应用/生产库或真实Provider。
- 新版skill的正式预检、解析和账本入口已用于本轮；新发现的5类工作流问题只存本地`.review/reports/workflow-capabilities/issues.md`，本轮未再改全局skill。文档见[能力门禁验证](./verification/cross-platform/CP-02-CAPABILITIES.md)。
- Cloud客户端claim/heartbeat/接管/媒体恢复、真实IdP/原生凭据/真机和三端真实链路仍未完成。发布前需服务端能力接口先就绪，旧服务端缺端点时新客户端会阻止开始；本次未发布，CP-02整体不勾选。

## 2026-10-22 本地客户端占用API前置增量

代码`03d50e0`已独立APPROVED并集成本地隔离分支：claim/heartbeat/release与token/dispatch可选owner头、输入/精确响应关联校验、默认不接管及无自动重放。仅两个API产品/测试文件，未接store/UI或解除Cloud门禁，默认disabled保持。

- 独立280产品测试、18构建测试、30私有探针、3变异、12项实施源码Chromium/Fake API及集成6项通过；后端269项/73.72%，专用库身份/ready/schema通过，本次不迁移。
- 新版skill7306f2b的文件清单预检/事件摘要已实接，agy一次模型尝试527.85活动秒，无产品返工；四项问题/局限只记本地。Token口径见[验证记录](./verification/cross-platform/CP-02-LEASE-API.md)，不声称已证明净节省。
- 集成7项固定门禁通过，未推送、部署或真实Provider联调。占用状态机/心跳/恢复/显式接管与原生链路仍待实现，CP-02整体未完成。此处停止下一模型派发。

## 2026-10-22 两条独立客户端前置工作线集成

A独立通话占用控制器`deacf3e`与B Web生命周期适配器`418d2cd`已分别APPROVED并串行合入本地组合`8c38a01`。两条agy在不同worktree实际并行，累计约560秒执行重叠；共享服务与集成串行，不能据此直接宣称净提速/节约。

- A修复旧挂起请求/Promise清理代际泄漏及实际写前取消守卫；B修复无监听期间旧快照与重订阅恢复失真。各有一次独立返工，原失败证据保留。
- 组合336产品Vitest、18构建隔离、40私有探针（A29/B11）、两线21项Chromium/Fake API及集成既有6项、6个有效变异、格式/lint/类型/双构建通过；后端269/73.72%与受保护schema前检通过。冗余候选变异未计入杀死数。
- 契约与验收见[占用控制器](./verification/cross-platform/CP-02-LEASE-CONTROLLER.md)、[Web生命周期](./verification/cross-platform/CP-01-WEB-LIFECYCLE.md)。未接conversation/UI、未开启Cloud开始门禁，无真实Provider/原生媒体验收，不代表CP-01/02/05整体完成。
- 本轮实际接入skill c133e3f的父/子运行摘要，问题及完整证据仅存`.review/reports/workflow-parallel-a8/`。Codex当前及中断turn的完整用量留待自然结束后提取，不伪造即时总额，不报告未经对照的省额比例。

## 当前功能

| 领域           | 当前实现                                                                           | 状态与边界                                                 |
| -------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离    | 代码和自动化已落地；真实 IdP 联调仍需环境验收              |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                  | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明 |
| 会话分析       | 持久化分析状态、发音评估、语法检测、BKT 知识追踪、失败/重试状态                    | 自动化覆盖核心状态机；真实发音 Provider 仍需外部验收       |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态 | 已实现                                                     |
| 自适应课程     | 读取薄弱技能，通过 ChromaDB/Krashen i+1 生成课程推荐                               | 存在真实 API 调用链；ChromaDB 客户端按进程复用             |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast | 已实现；密钥轮换和 Provider 连通性需按环境验收             |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                | 已实现 Web 流程；移动端文件选择仍在 TODO                   |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、关键组件键盘与可访问性支持        | 已实现；完整无障碍审计仍未完成                             |
| 周度学习报告   | 仅保留骨架，没有 API、调度器或任务队列调用入口                                     | **未实现，不可对外宣称可用**                               |
| 数字人和移动端 | 方案或待办存在，但没有完成可交付闭环                                               | **未实现**                                                 |

## 2026-10-20 PR 评审与处理

| PR                                                | 处理决定     | 内容与边界                                                                                              |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| [#92](https://github.com/sunpcm/EchoTalk/pull/92) | 已合并       | Vite 7.3.1 → 精确 7.3.7；只改声明和锁文件，其他依赖不变，未迁移 Vite 8                                  |
| [#90](https://github.com/sunpcm/EchoTalk/pull/90) | 修复后纳入   | DailyProgress 和 SkillTree 增加进度条角色、名称、范围和值；每日超过 20 时数值封顶，文本仍保留实际完成量 |
| [#91](https://github.com/sunpcm/EchoTalk/pull/91) | 重复，不纳入 | 与 #90 修改相同组件；#90 还包含每日进度测试和可读值文本，统一维护一份实现                               |

评审复现：原 #90 在完成 25 条转录时生成 `aria-valuenow=25`、`aria-valuemax=20`，
违反 [WAI-ARIA 数值范围约束](https://www.w3.org/TR/wai-aria-1.2/#aria-valuenow)。
修复后读数为 20，`aria-valuetext` 仍为 `25 / 20`，视觉条保持 100%，实际统计口径不变。
回归覆盖 0、5、20、25 四种完成量；补测技能树空列表，保留两类技能掌握度断言。

验证分层：#92 的前端、后端和聚合 CI 均通过，包括 Node 22 前端、PostgreSQL 空库迁移及
后端测试；#90 的最终检查见上方 PR 记录。安全补丁的本地验证还包括 102 项 Vitest、
6 项 Fake API E2E、HTTPS/模拟麦克风/WSS/代理和合成文件访问限制探针。
这些证据不代表真实 LiveKit、Provider、Windows/NTFS 漏洞复现、屏幕阅读器或 iOS 真机验收。

本次 Vite 安全补丁独立于 RF-12 大版本迁移；RF-12 的其他依赖升级和外部验收仍未完成。
回滚 #92 会恢复已知有漏洞的 Vite 7.3.1；如需回滚，应同步恢复 manifest/lockfile 并限制开发服务访问。

## 2026-10-17 变更记录

本轮对全部开放 PR 使用最新 `main`、文件重叠、生产调用链和 CI 结果进行复核。

### 已合并

| PR                                                | 合并内容                                   | 价值                                                                      |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| [#67](https://github.com/sunpcm/EchoTalk/pull/67) | ORM 模型包内改用相对导入                   | 降低包路径耦合                                                            |
| [#68](https://github.com/sunpcm/EchoTalk/pull/68) | LLM client/chat completion 单元测试        | 补充 Provider 配置和异常回归覆盖                                          |
| [#69](https://github.com/sunpcm/EchoTalk/pull/69) | 拆分用户设置响应、权限、Key 校验和更新逻辑 | 降低路由函数复杂度                                                        |
| [#71](https://github.com/sunpcm/EchoTalk/pull/71) | 将可选 `pronouncing` 导入移出逐词热路径    | 减少重复导入开销                                                          |
| [#73](https://github.com/sunpcm/EchoTalk/pull/73) | 进程内复用 ChromaDB client                 | 优化真实课程推荐调用链                                                    |
| [#74](https://github.com/sunpcm/EchoTalk/pull/74) | 转录持久化测试                             | 覆盖空输入、时间戳、角色、非法值和 DB 异常                                |
| [#78](https://github.com/sunpcm/EchoTalk/pull/78) | LiveKit PluginFactory 统一 API Key 校验    | 拒绝空值、错误类型和换行/null 等危险字符                                  |
| [#79](https://github.com/sunpcm/EchoTalk/pull/79) | CORS 安全校验                              | 评审中追加 Origin 结构校验，拒绝 path/query/userinfo/非法端口和不支持协议 |
| [#83](https://github.com/sunpcm/EchoTalk/pull/83) | LiveKit 消息类型收窄                       | 移除不安全的类型忽略后再读取 assistant 文本                               |
| [#84](https://github.com/sunpcm/EchoTalk/pull/84) | AnswerRecommendations 可访问性和复制反馈   | 评审中修复答案截断与剪贴板失败静默问题；定向测试 4/4 通过                 |
| [#86](https://github.com/sunpcm/EchoTalk/pull/86) | PhonemeVisualizer 键盘和辅助技术支持       | 增加可访问名称，并避免视觉 tooltip 重复朗读                               |
| [#87](https://github.com/sunpcm/EchoTalk/pull/87) | 焦点样式和禁用原因提示                     | 补齐键盘焦点与本地化说明                                                  |

### 未采纳

| PR                                                | 决策         | 原因                                                                                                   |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| [#82](https://github.com/sunpcm/EchoTalk/pull/82) | 关闭，不合并 | 周报代码超过 500 行，但没有 API、调度器或任务队列调用链，合并后仍不可达且只返回 partial 状态           |
| [#85](https://github.com/sunpcm/EchoTalk/pull/85) | 关闭，不合并 | 同时修改 14 个文件，与 #50/#51/#52/#59/#87 大量重叠，无法干净 rebase，并把已有本地化文案改回硬编码中文 |
| [#88](https://github.com/sunpcm/EchoTalk/pull/88) | 关闭，不合并 | 与 #86 重复；#86 的辅助技术语义更清晰，避免未关联 tooltip 的重复暴露                                   |

“未采纳”只表示不接受该 PR 的当前实现，不代表永久否定需求。仍有价值的需求应缩小范围、补齐调用链和验收标准后重新提交。

## 已知限制和近期风险

- CI 使用的部分 GitHub Actions 仍基于已弃用的 Node 20 runtime，当前被 runner 强制运行在 Node 24。
- `ubuntu-latest` 即将迁移到 Ubuntu 26，应固定或验证 runner 版本，避免工具链突然变化。
- 前端仍存在少量 `Unexpected any` 告警，应在独立维护 PR 中消除。
- 根目录 `README.md` 包含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准，并应在后续 PR 中修正 README。

## 文档职责与更新规则

- `README.md`：项目入口、快速启动和稳定概览，不维护逐项决策流水账。
- `docs/PROJECT_STATUS.md`：当前功能事实、最近合并/拒绝决策、验证边界和已知风险。
- `TODO.md`：唯一未完成事项清单，必须带验收条件。
- `docs/PHASE_*_TECH_STACK.md`：具体阶段的实现细节。
- `docs/PHASE_*_MANUAL_TEST.md`：不能由 CI 覆盖的人工验收步骤。

以下变更必须在同一个 PR 中更新本文：

1. 新增、删除或改变用户可见功能。
2. 改变认证、密钥、数据所有权、生产配置或外部 Provider 边界。
3. 接受或拒绝会影响架构方向的大型实现。
4. 改变 CI 能证明的范围，或完成此前只能人工验证的事项。

更新时必须写明日期、PR、行为变化、验证证据和仍未覆盖的边界；不要把“代码存在”、
“CI 通过”和“生产已验证”混为同一状态。

## 2026-10-22 Dashboard生命周期发现接线

产品`fbbd78e`独立APPROVED并快进隔离集成：ActiveSessions恢复前台/联网刷新只读列表，挂起/离线作废旧请求且释放槽位，旧成功/失败/finally不污染恢复后请求，认证/StrictMode/卸载隔离通过。仅两个产品文件，Cloud开始门禁与disabled默认保持。

355产品、18构建测试、10私有探针、6既有及3新增Chromium/Fake API、2有效变异通过；源码恢复后完整质量复验通过。后端269/73.72%及专用库前检通过，无迁移。独立验证与边界见[生命周期发现接线](./verification/cross-platform/CP-01-LIFECYCLE-DISCOVERY.md)。

使用skill2dcd162、agy一次676.84活动秒，无独立产品返工；评审结果分类、实施夹具及宿主中断恢复观察记本地issues.md。不据此声称净省额。未推送/部署/真实Provider联调，原生恢复/通话接管仍待实现；本里程碑停止下一模型派发。

## 2026-10-22 活动会话显式结束本地里程碑

产品`d07f9e7`独立APPROVED并快进隔离集成：Dashboard内联确认结束指定记录、失败同ID显式重试；确认意图绑定选择时身份/revision，后台离线不重放POST，旧列表/结束/finally隔离。仅三个产品文件，API/auth/store与Cloud门禁保持。

371产品、18构建、17私有探针、6既有+2新增Chromium（另320px1项）、2有效变异、完整前端quality以及专用测试库269/73.72%通过；无迁移。最终集成门禁以本地completion为准，验证细节见[显式结束入口](./verification/cross-platform/CP-02-DISCOVERY-END.md)。

3次模型尝试累计927.13活动秒，含两次拒绝记录；版本变化另被预检阻断。确认来源代际缺口及i18n返工已关闭，P2文件头注释下轮维护。所有新问题与原始证据存本地，不自动升级全局skill、不声称净省额。未push/deploy/真实Provider联调，恢复/接管和原生媒体验收未完成，停止下一派发。

## 2026-10-22 已有会话显式恢复本地里程碑

产品`ca7ecb0`独立APPROVED并快进隔离集成：活动列表确认恢复已有记录，disabled能力门禁后重新核验active详情、健康与新Token，不创建新会话。旧store/组件回调归属隔离，后台/离线/reset/goHome取消后控件立即释放且新操作可推进，真正end POST在途规则保持；Cloud恢复/开始门禁继续保留。

403产品/18构建/39私有探针/10浏览器/2有效变异及完整quality通过；后端本任务269/73.72%无变更证据复用，无迁移。验证和边界见[显式恢复](./verification/cross-platform/CP-02-EXPLICIT-RECOVERY.md)，最终集成状态以本地completion为准。

本任务6次、2552.22活动秒，含拒绝、超时与集中返工；用户中途正式改10次/不限时，保留历史且最终交付无拒绝。新问题仅记本地，不外推省额。未推送/部署/真实Provider或原生媒体联调，不代表三端整体完成；停止下一派发评估工作流。

## 2026-10-22 A12 Agent调度失败本地里程碑

此前三端至A11已通过PR96合入远端main@344e317；本轮从该合并基线继续，产品cdbe479通过独立APPROVED。调度失败停止本地音轨、清Token/卸载房间，显示安全错误并允许返回主页后显式恢复；同session/gen单次调度、同步通知后的发送前门禁及迟到结果隔离通过。

419产品/18构建脚本/21独立模拟Room探针/6既有Chromium、2有效变异和完整7门禁通过，详见[调度失败验证](./verification/cross-platform/CP-02-AGENT-DISPATCH.md)。后端未改，本轮未跑数据库，不冒充真实媒体、原生或Provider验收。仅本地提交与隔离集成，不push/deploy，Cloud严格接管和连接离线/Token失效仍待完成。

本轮skill cd09a3a、3次尝试/1400.71活动秒；初次模型识别失败、同步可重入缺口、报告指纹与评审入口问题均记本地日志。未证明净Codex额度收益，不自动优化全局skill；在本小里程碑停止下一模型派发。

## 2026-10-22 A13 Web连接中断本地增量

产品97e4c75独立APPROVED：SDK错误/断开及Web后台离线时停止本地音轨、清Token/卸载Room，安全提示与显式恢复，无reload/自动重连；SDK/effect清理、来源认证/代际与同步空窗经过独立验证。441产品/18构建、49私有探针、6既有Chromium和2有效变异及完整7门禁通过，详见[验证](./verification/cross-platform/CP-02-CONNECTION-FAILURE.md)。真实媒体、原生和Cloud仍未验。

同会话两次CLI终止ERROR保留，原模型同账本冷启动后完整交付恢复；不修改错误结果。账本和单调时间差异、探针语法错误及四类产品返工均记本地。用户最新要求连续推进，已授权并完成匹配WebKit下载/启动冒烟，下一步补CP-06双浏览器门禁；不自动改skill或推送部署。

## 2026-10-22 A14双浏览器本地门禁

产品be242b2独立APPROVED：默认Chromium/WebKit各11项共22 E2E，含5类新增真实UI恢复/401边界；保留全部质量门禁并更新CI安装接线。独立441产品/18构建、5项Fake API进程探针、2有效变异及完整7门禁通过。详见[验证](./verification/cross-platform/CP-06-WEBKIT.md)。无产品/依赖/锁变更，Linux CI、真实IdP/媒体/原生未验，P2 fixture grammar后缀已记TODO。

中断后原流SUCCESS但无OS退出码，正式记录未知退出而不伪造0；同账本冷启动补完整交付且源码不变。2次尝试、问题/用量口径记本地日志；继续后续任务，不自动推送部署。

## 2026-10-23 A15分析轮询本地增量

产品0edf750独立APPROVED：状态/结果/knowledge整个读取周期合并重复事件，后台离线立即取消读代际、释放槽位，恢复新查询不被旧挂起阻塞；认证/会话/pollVersion及同步通知隔离保持。472产品/18构建、27私有探针、22双浏览器与两个有效变异通过；完整集成门禁证据见[验证](./verification/cross-platform/CP-05-ANALYSIS.md)。本轮数据库、原生及真实Provider未验。

两次agy尝试，1044.37账本活动秒；同会话最后total408174，续跑不累加，非Codex节省证明。用户关于20–30分钟任务减少无变化轮询的建议记入本地问题和流程文档，待后续评估，不自动改全局skill。继续已授权@capacitor/app@8.1.2原生生命周期任务，仅本地build+sync，不Xcode/签名/真实服务或push/deploy。

## 2026-10-23 A16原生生命周期适配器

产品bcf008c独立APPROVED：统一factory/iOS官方App状态监听、异步就绪/事件版本/失败恢复/释放边界；509产品/18构建、22独立探针、22双浏览器、两个有效变异及完整门禁通过。固定App8.1.2新增依赖，iOS development与production示例模式build+sync生成插件SPM与AppPlugin注册，保留原production webDir。见[验证](./verification/cross-platform/CP-05-NATIVE-ADAPTER.md)。消费者尚未迁移，原生OS/真实Provider/Xcode/签名未验，不冒充三端完成。

用户要求先优化工作流后继续：skill a42fde9两端本地同步，66项离线回归及结构校验通过；项目固定诊断入口跨cwd一致，证据复用三种错误输入拒绝。A16同账本5次尝试，网络reset保留，CLI1.4.6漂移模型前拦截后受限接纳，同模型冷启动完整补交；报告P2实际路径在本验证文档纠正。新问题/用量原始记录仅本地，未证明净省额，不自动push/deploy；继续只读消费者接线。

## 2026-10-23 A17原生只读消费者

产品d1a69d1独立APPROVED：活动列表与分析轮询默认factory接原生App事件，pending/失败/后台关闭读取，恢复只GET，局部effect和旧响应/槽位守卫保持。独立525产品/18构建、35私有探针、22双浏览器与两个有效变异通过，见[验证](./verification/cross-platform/CP-05-NATIVE-CONSUMERS.md)。仅四文件，无依赖/后端改动，通话启动/Room、真实OS/Provider仍未验；仅本地隔离集成，不push/deploy。

skill a42fde9新矩阵用于本轮，agy一次651.89账本活动秒、完整无拒权交付；独立探针API名错误和P2未查询空态/旧注释已记录，未发现需产品返工的P0/P1。精确Codex净额度收益未测，外部累计不能当省额；继续下一通话生命周期阶段，原生就绪永久挂起的可达退出先落实设计。

## 2026-10-23 A18原生启动与显式恢复

产品91f80d2独立APPROVED：先保留槽位再等原生就绪，pending零外部调用，10秒安全退出、取消释放与旧setup/ready/Token隔离；同意图认证失效卡槽位及初始化同步重入P1已关闭。547产品/18构建、30独立探针、22双浏览器与两个有效变异通过，见[验证](./verification/cross-platform/CP-05-NATIVE-STARTUP.md)。通话Room尚未接原生、真实OS/Provider/Xcode/签名未验，整体CP-05仍未完成。

skill a42fde9在本轮继续应用，3次尝试，r1新版checkpoint事件未知被失败关闭；同模型冷启动补完整交付，保留旧流与检查hash，独立七门禁不减。夹具缺字段、时序返工、测试全局注入/重复逻辑维护候选及格式兼容新问题已记本地；收益未作对照，不报Codex净节省率。不push/deploy，下一本地增量为Room原生挂载与音轨中断。

## 2026-10-23 A19原生Room挂载与同步停轨

产品fdf3d5e独立APPROVED：native就绪前零采音Room，10秒失败退出，后台/离线同步stop本地音轨，旧回调隔离及前台不自动写。565产品/18构建、20独立探针、22双浏览器、两个有效变异及iOS development/production示例build+sync通过，见[验证](./verification/cross-platform/CP-05-NATIVE-ROOM.md)。三项P1独立复现后关闭，健康重渲染不会误停麦克风。真实OS音频中断/路由、Provider、Xcode/签名、Cloud接管仍待验。

同账本5次/3421.81活动秒；评审文件跨允许目录拒权、旧上下文误读旧报告、503与EOF保留。原模型冷启动补完整交付，hash保护8份旧检查，独立门禁不减；工作流新问题本地记录，未证明净Codex省额，不自动改全局skill或push/deploy。

## 2026-10-23 A20活动列表查询事实

产品9273c95独立APPROVED：尚未查询不误报空，成功事实绑定精确principal/revision，取消及旧响应隔离，同账号后台保留已知列表；分析hook仅更新过期注释。574产品/18构建、14私有探针、22双浏览器及两个有效变异通过，见[验证](./verification/cross-platform/CP-05-DISCOVERY-QUERY-STATE.md)。四文件，无后端/依赖改动，不改变结束/恢复语义。

首轮650.89活动秒，完整无拒权交付；本轮未发现需产品返工P0/P1，交接观察与契约适用边界记本地issues。外部累计237606不能换算Codex净省额。不push/deploy，真实OS音频/认证、Cloud及发布仍待独立验收。

## 2026-10-23 A21设置抽屉可用性

产品797f8e4独立APPROVED：原生dialog背景保护、安全聚焦/返回、完整双向Tab到达Save、44触控及可滚动动态视口，正常重渲染不丢草稿。578产品/18构建、38默认双浏览器、26独立浏览器与3资源所有权单测、两有效变异通过；见[验证](./verification/cross-platform/CP-05-SETTINGS-DRAWER.md)。键盘仅封闭却Save不可达的P1经集中返工关闭；真实系统键盘/硬件safe-area和全局响应式仍未验。

skill1c1b68d实际接入12/15必读路径预检，同源CLI目录及专用handoff读取成功，两次1105.32活动秒，完整无拒权交付。原始失败与评审夹具/路径/附属artifact问题保留日志，不自动改skill或推送部署。本地工作无需用户参与；真实环境公开配置与设备人工验收稍后独立交互。

## 2026-10-24 A22活动列表响应式与触控

产品9d40cc7独立APPROVED：窄屏/横屏/桌面缩小/200%根字号卡片与确认不横向溢出，完整确认UUID可见换行、操作44px。render前逻辑逐字节未改。578产品/18构建脚本/56默认双浏览器、22独立布局探针和两有效变异通过；见[验证](./verification/cross-platform/CP-05-ACTIVITY-LAYOUT.md)。另发现既有恢复失败错误呈现P2：24私有用例中2失败，在A21基线同样复现，原确认可重试且零Token/写，已排下一修复。未把失败算通过，真实OS/Provider/发布仍待验。

## 2026-10-24 A23恢复失败与取消终态

产品8b2df80独立APPROVED：通过sessionGen区分当前恢复正常失败与真正取消，专用安全错误/完整目标/44px重试及取消可用；reset/goHome等立即释放，旧请求不污染新意图。首轮共享error清理导致同步reset后旧错误回写的P1已删除触发路径，嵌套测试伪标识移除；旧E2E仅两处精确定位器迁移并增强断言。588产品/18构建脚本/60默认双浏览器、12独立真实store失败路径+2时序探针、原始2浏览器反例及两有效变异通过；见[验证](./verification/cross-platform/CP-05-RESUME-ERROR.md)。checkpoint交付流拒收后同模型冷启动短交付恢复，旧失败保留。仍仅本地隔离集成，真实OS/Provider/发布未验。

## 2026-10-24 A24 DocTalk本地文件导入可靠性

产品ce0e0b4独立APPROVED：仅支持既有文本扩展名，UTF-8含BOM、50k既有长度及保守字节界限；失败保稿/安全错误、再选恢复，旧读取不能覆盖新选择/编辑/已提交父value或卸载后状态。提交至passive清理间隙P1、未实际执行旧回调的测试缺口、BOM重复去除正文三项集中关闭。606产品/18构建脚本/62默认双浏览器、11独立时序+18真实浏览器与两有效变异通过；见[验证](./verification/cross-platform/CP-05-DOC-IMPORT.md)。两次Flash完整交付，无拒权/未知流，问题记录未触发全局skill扩展。仍仅本地隔离集成，真机OS选择器/Provider/发布未验。

## 2026-10-24 A25 DocTalk设置页响应式与触控

产品6604516独立APPROVED：窄屏返回与标题/副标题重排，全部动作至少44px，桌面窗口缩小/横屏/200%字号可读且草稿保留；两组件return前与A24文件读取哈希完全保持。首轮固定rem留白造成标题32px内部溢出的P1已关闭；606产品/18构建脚本/82默认双浏览器、22独立浏览器与两有效变异通过，见[验证](./verification/cross-platform/CP-05-DOC-LAYOUT.md)。首轮CLI配置拒读记录保留，权限不变，正式恢复后同Flash冷启动完整交付。仍仅本地隔离集成，不等同真机键盘/safe-area或发布验收。

## 2026-10-24 A29 独立验收与本地集成

Fake API 主题必需字段及 success/failure 项目后缀 assessment/grammar 严格路由修复经 Codex 独立评审 APPROVED；新增 Node 真实子进程 runner，使本地完整 quality 为 8 项。648 产品 / 18 构建 / 53 Fake API Node / 120 双浏览器与专用 PostgreSQL 269 通过，另 33 独立 HTTP、生命周期故障探针及两有效变异通过。启动失败/挂起 body/并发终止与断言异常清理均有本地证据。后续继续补齐 CI 显式执行步骤；远端 CI、真实链路与发布仍分别验收，未推送或部署。

## 2026-10-25 A30 CI 真实测试入口

Codex 独立评审 APPROVED：前端 CI 显式执行 Vitest、构建脚本与 Fake API Node 测试，lint/typecheck/build 强制执行；后端、触发器及聚合成功断言保持不变。648 产品 / 18 构建 / 53 Fake API Node / 120 双浏览器和专用 PostgreSQL 269 通过，YAML 语义不变量及两有效变异通过。见[验证](./verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。这仅完成本地配置与验证，远端 Linux CI、RF-04 整体验收及发布仍待执行；未推送或部署。

## 2026-10-25 A31 独立验收

Codex 独立评审 APPROVED：660 产品 / 18 构建脚本 / 53 Fake API Node / 126 双浏览器与专用 PostgreSQL 269（覆盖率73.72%）及 Ruff 通过；另35独立 Storage/时序探针、4独立双浏览器和2有效变异通过。Storage 访问失败安全回退，不阻断本地主题/认证同步或成功水合；恢复缓存后实际reload仍保留选择。测试维护P2与原报告计数偏差留存本地issues，未改skill、推送或部署。

## 2026-10-25 A32 独立验收

Codex 独立评审 APPROVED：103份运行源码引用审计、6项独立双浏览器与2有效变异通过，产品仅6处颜色utility替换、6行无用token定义删除，其他业务逻辑逐字节未变。完整8项门禁660单测/18构建脚本/53 Fake API Node/134双浏览器，专用PostgreSQL 269（73.72%）及Ruff通过。测试中主题PUT断言仅检查含theme的P2精度问题保留本地issues；实际源码没有新增写路径。未推送/部署，真实环境与远端CI仍待验。

## 2026-10-25 A33 独立验收

Codex 独立评审 APPROVED：无歧义tuple编码隔离冒号边界碰撞，665单测/18构建脚本/53 Fake API Node/138双浏览器及269专用库后端（73.72%）与Ruff通过；5独立时序探针含真实旧timer调用，2有效变异通过。新增测试旧timer空回调/剪贴板断言精度P2已记录，不将其计为实际覆盖；产品只改一行编码和注释。未推送、部署或连接真实外部环境。

## 2026-10-25 A34 独立验收

Codex 独立评审 APPROVED：698单测/18构建脚本/53 Fake API Node/140双浏览器及269专用库后端（73.72%）与Ruff通过。另40独立API/真实DataChannel/日志边界探针与2独立双浏览器通过，验证完整console参数白名单、敏感canary缺失、API503后重试恢复与零新增业务写；放宽错误码白名单及恢复raw payload日志两变异分别导致1/2项产品测试失败。全部冻结源码/测试字节恢复后全门禁通过。

r0直接grep拒权后早停，用户明确重新授权原范围读取，r1完成源码和8项门禁但流ERROR；原失败保留，同模型r2冷启动只补完整交付，绑定复用源码和8日志hash，3次尝试/1395.31活动秒。独立验收未省略，不改skill、权限配置或真实环境；本地console一期不隐含遥测上报要求，CP06三端真实联动仍待验。

## 2026-10-25 A35 独立验收

Codex 独立评审 APPROVED：698单测/18构建脚本/53 Fake API Node/144双浏览器与专用PostgreSQL 269（73.72%）及Ruff通过；另10项独立双浏览器覆盖普通/reduce computed、真实背景与文字插值、warm→dark→cool、390px/200%字号、完整根容器几何、精确主题PUT与零业务写。根scope缺失及reduce时长破坏两有效变异各导致1项产品测试失败，逐字节/整树恢复后完整8门禁通过。

新增E2E未实际设置窄屏/200%，spinner为条件分支，均不计作该新增用例实际覆盖；前者由独立探针实测补足，后者由保留的A27专门回归验证，原报告/失败批次留存本地issues，不改skill。scope只含CSS/既有HTML属性与两处class组合，业务逻辑未改；真实设备视觉仍待验，未推送或部署。
