# EchoTalk 当前状态

> 最后核对：2026-11-11，PR #140 head `ed3ac8bafd294b3823b48613935dcf7db5149dc9`
> （已并入现 `main@196f2ba`；PR #139、#140 均已合并）。
> 本文只回答"现在实现了什么、验证到哪一步、有哪些已知限制"。未完成工作只在根目录
> [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；逐轮实施记录在
> [`history/`](./history/)，不在本文追加。

## 当前功能

| 领域           | 当前实现                                                                             | 状态与边界                                                        |
| -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离      | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收 |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                    | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明        |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束 | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭       |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态                      | 自动化覆盖状态机；语法为 demo 规则，真实发音 Provider 未验收      |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态   | 已实现                                                            |
| 自适应课程     | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                  | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务          |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast   | 已实现；密钥轮换和 Provider 连通性需按环境验收                    |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                  | 已实现 Web 流程；原生端文件选择未验收                             |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、键盘焦点、44px 触控目标             | 三主题文字对比度有 E2E 回归；边框对比度与读屏实测未完成           |
| 周度学习       | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3                | **部分实现**：练习时长、掌握度环比、发音趋势、下周重点均未实现    |
| iOS            | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                              | 真机全链路、原生登录与发布未验收                                  |
| macOS          | 仅 `tools/macos-m1-native-probe` 探测工程                                            | **未实现**正式客户端，等待 CP-03 设备证据                         |
| 数字人         | 只有待办                                                                             | **未实现**                                                        |

## 当前验证基线

当前远端测试基线来自 PR #140（head `ed3ac8bafd294b3823b48613935dcf7db5149dc9`）的
[GitHub Actions run 43031742949](https://github.com/sunpcm/EchoTalk/actions/runs/43031742949)；以下数字绑定该
PR head 的 CI 日志，不表示在现 main 上直接执行。2026-11-10 的旧基线（`ee5018a`/`22eaf82`）仅作为当时
[2026-11 云端评审](./reviews/2026-11-cloud-review.md)的记录，不与当前状态混用。

对应 job 日志：[frontend 130560259103](https://github.com/sunpcm/EchoTalk/actions/runs/43031742949/job/130560259103)、
[backend 130560258676](https://github.com/sunpcm/EchoTalk/actions/runs/43031742949/job/130560258676)。

| 测试树 / 门禁            | PR #140 实际结果                                  | 日志     |
| ------------------------ | ------------------------------------------------- | -------- |
| Vitest                   | 1156 passed（44 个文件，0 skip）                  | frontend |
| Playwright E2E           | 234 passed（Chromium + WebKit，Fake API，0 skip） | frontend |
| API 类型生成器           | 8 passed                                          | frontend |
| 构建脚本                 | 21 passed                                         | frontend |
| Fake API 契约            | 75 passed                                         | frontend |
| backend pytest           | 809 passed，3 warnings，80.19% 覆盖率（59% 门禁） | backend  |
| Alembic                  | 空库迁移通过，至 `c06_transcript_events`          | backend  |
| schema / metadata / Ruff | 相关步骤通过                                      | backend  |

PR #140 的 CI 与 [PR Guard run 43031743003](https://github.com/sunpcm/EchoTalk/actions/runs/43031743003)
共六项检查全部成功：`test-frontend`、`test-backend`、`test-ios-build`、`test-macos-probe`、
`mass-deletion-guard` 与聚合 `CI`。

这些结果都不能代替真实 LiveKit、第三方 Provider、真实 IdP、iOS/macOS 设备或生产部署验收。
命令见 [Agent 评审手册 §2 与 §20](./agent-review-loop.md)；当前数字对应上文 PR #140 run/job 日志。

A3 的历史候选快照补充 OpenAPI 契约校验，并修正 Unicode 长度边界。修正提交 `45e5212`
的本地代码快照上 Fake API 为 108 passed（0 skip）；此前 103 仅属于 PR #141 原 head。
本地 macOS 和 Linux ARM64 完整 E2E 均有失败，不能计为通过。这些历史计数和本地失败只对应
各自快照，不替换上表已绑定来源的 PR #140 远端基线。

### A3 Unicode/OpenAPI 候选验证（PR #144）

A3 候选 [PR #144](https://github.com/sunpcm/EchoTalk/pull/144) 的 head 为
`ed9439a3d342bc3815f82ce1408fe6a71ebc5eac`。该 head 的
[CI run 43079241779](https://github.com/sunpcm/EchoTalk/actions/runs/43079241779) 与
[PR Guard run 43079241710](https://github.com/sunpcm/EchoTalk/actions/runs/43079241710)
均 completed/success；以下数值只绑定该 head 的两份 job 日志：

- [frontend job 130727099367](https://github.com/sunpcm/EchoTalk/actions/runs/43079241779/job/130727099367)：
  Vitest 1156 passed（44 files）、Fake API 108/108、API 类型生成 8 passed、构建脚本 21 passed、
  lint 132 warnings/0 errors、Playwright E2E 234/234（0 skip，日志无 Retry 标记）。
- [backend job 130727098626](https://github.com/sunpcm/EchoTalk/actions/runs/43079241779/job/130727098626)：
  pytest collected 809/passed 809、覆盖率 80.19%；套件包含单元、mock 与专用 PostgreSQL
  集成测试。

Unicode 两文件补丁与 main 整合候选已通过独立内容 Review；现停 Review，是否接续原 PR #141
分支或采用该候选路线仍待用户决定。原 PR #141 当前仍为 OPEN，分支保持
`437f6ff8cae70e15ce9549fcc7843008986d8b43`，未改动且未合并。上表全部数字只对应 PR #140
head `ed3ac8bafd294b3823b48613935dcf7db5149dc9`，其中 Fake API 75 passed 等历史计数不得
转记为 PR #144 候选结果。上述 CI 只绑定 `ed9439a`；本次改动仅收口文档状态，运行时代码不变。
后续提交的 CI 结果以对应 head 的 GitHub Checks 为准。候选尚未合并、部署，远端 CI 通过不等于
整卡验收或真实外部服务验收。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、Compose 就绪门禁、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，
  避免运行时安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，
  并在运行 E2E 前核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- 前端 lint 有 132 条 warning（0 error），主要是 `Unexpected any`。
- 输入框与卡片边框对比度约 1.2，低于非文字组件 3.0 的要求；会话中界面的 LiveKit 控制条未在真实连接下验收。
- macOS 本地 WebKit 已知一例 Provider select 高度为 23px，本地与远端表现不同；PR #140 说明已记录该事实，
  不构成该轮 CI 失败。
- 根目录 `README.md` 仍含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准。

## 历史与决策

| 内容                                | 位置                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| 2026 年 11 月各轮实施记录与当时基线 | [history/2026-11.md](./history/2026-11.md)                           |
| 2026 年 10 月各轮实施记录           | [history/2026-10.md](./history/2026-10.md)                           |
| 已合并与明确未采纳的方案            | [history/decisions.md](./history/decisions.md)                       |
| 已完成的待办事项                    | [history/todo-done.md](./history/todo-done.md)                       |
| 评审手册的单轮回执                  | [history/review-loop-receipts.md](./history/review-loop-receipts.md) |

历史文件只追加、不改写；其中的计数和结论只属于当时的提交。

## 文档职责与更新规则

- `README.md`：项目入口、快速启动和稳定概览。
- `docs/PROJECT_STATUS.md`（本文）：当前功能、当前验证基线和已知限制；可以覆盖更新，目标不超过 150 行。
- `docs/ARCHITECTURE.md`：运行时、数据所有权、部署拓扑与架构风险。
- `TODO.md`：唯一未完成事项清单，必须带验收条件；勾选后移入 `docs/history/todo-done.md`。
- `docs/history/`：按月的实施记录与决策流水。一轮工作结束时在当月文件**顶部**追加一节，
  写明日期、PR 或提交、行为变化、验证证据和仍未覆盖的边界。
- `docs/PHASE_*_TECH_STACK.md` 与 `docs/PHASE_*_MANUAL_TEST.md`：阶段实现细节与人工验收步骤。

以下变更必须在同一个 PR 中更新本文的"当前功能"或"当前验证基线"：

1. 新增、删除或改变用户可见功能。
2. 改变认证、密钥、数据所有权、生产配置或外部 Provider 边界。
3. 改变 CI 能证明的范围，或完成此前只能人工验证的事项。

不要把"代码存在"、"CI 通过"和"生产已验证"混为同一状态。
