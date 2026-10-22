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
