# EchoTalk 当前状态与变更决策

> 本文是 EchoTalk “当前已经实现什么、最近改变了什么、明确没有采纳什么”的权威入口。
> 未完成工作维护在根目录 [`TODO.md`](../TODO.md)；具体架构和人工验收步骤仍由各阶段技术文档负责。

## 维护基线

- 最近本地核对日期：2026-10-21；以下 main/CI 记录保留为历史发布证据，本轮本地三端增量未推送或部署。
- 代码基线：`main@286a3db68ba2b43e76df5df3b9f7d24444a3a796`（#92 合并后）；
  本轮进度条修复见 [#90](https://github.com/sunpcm/EchoTalk/pull/90)
- 自动化证据：[#92 CI run 39348513442](https://github.com/sunpcm/EchoTalk/actions/runs/39348513442)；
  [#90 检查记录](https://github.com/sunpcm/EchoTalk/pull/90/checks)
- 证据范围：上述 CI 已验证格式、Lint、TypeScript、前端构建、Vitest、Playwright、Ruff、
  PostgreSQL 空库迁移和后端覆盖率测试。它不能代替真实 LiveKit、第三方 Provider、移动端真机
  或生产部署验收；这些边界应在对应验收文档或 `TODO.md` 中单独记录。

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
