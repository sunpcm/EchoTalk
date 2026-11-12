# EchoTalk 当前状态

> 最后核对：2026-11-12，A5 已由 PR #148 合入
> `main@0ea16a455bd8ed6fd9a209e337f92615b5e594d0`。A4a 已在该 main 上完成本地实施快照与
> 独立评审；最终交付 PR CI 尚未运行。
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

当前 Linux 测试基线来自 A5（PR #148）最终 head
`ae13222d52f8d43e6392f3f648f02b5d6860677b` 的
[CI run 43145122085](https://github.com/sunpcm/EchoTalk/actions/runs/43145122085) 与
[PR Guard run 43145122060](https://github.com/sunpcm/EchoTalk/actions/runs/43145122060)，六项成功。
该 head 与 squash 后 `main@0ea16a4` 的完整树一致。A4a 已基于该 main 完成本地复验，
表内仅 Vitest 行使用 A4a 本地口径；其余行绑定 A5 最终 head 的 Linux CI，不将本地结果冒充 CI。

| 测试树 / 门禁  | 最近实测结果（各行来源见下文）                    | 日志     |
| -------------- | ------------------------------------------------- | -------- |
| Vitest         | 1203 passed（49 个文件；A4a 本地复验，见下节）    | frontend |
| Playwright E2E | 234 passed（0 skip、无 retry）                    | frontend |
| Fake API 契约  | 108 passed                                        | frontend |
| API 类型生成器 | 8 passed                                          | frontend |
| 构建脚本       | 21 passed                                         | frontend |
| backend pytest | 809 passed，3 warnings，80.19% 覆盖率（59% 门禁） | backend  |

这些结果都不能代替真实 LiveKit、第三方 Provider、真实 IdP、iOS/macOS 设备或生产部署验收。
命令见 [Agent 评审手册 §2 与 §20](./agent-review-loop.md)。

历史基线继续按快照绑定：PR #140 head `ed3ac8ba` 的 Fake API 为 75 passed；A3 原 head
`437f6ff8` 为 103 passed；修正提交 `45e5212` 的本地快照为 108 passed，但本机 macOS E2E
为 233/1，Linux ARM64 两轮为 233/1、232/2，均不能计为通过。这些记录只属于各自快照，
不替换上表绑定 A3 最终 head 的 Linux CI。

### A3（PR #141）合并收口

A3 最终 head `b1d375611d10f0380bc30f42af486c404b1c21c0` 的 Linux CI 与 PR Guard 均成功，
随后由 PR #141 squash 合入 `main@a7841b7486b14af01e535e5e3f4e0472c621d198`。A3 整卡已关闭
并从根目录 `TODO.md` 移出。PR #144 重复草稿保持关闭，其旧回执只绑定 `ed9439a`，不影响本轮
最终证据。本次只关闭自动化契约核对；真实 Provider、IdP、LiveKit、设备、语音链路和生产部署
仍未验收。

### A4a（只读 data 层）本地实施与独立评审完成

A4a 在 `main@0ea16a4` 上新增最小只读查询 controller、React hook、契约文档与 42 项不依赖业务
组件的契约测试；全量 Vitest 为 1203 passed / 49 files，独立探针 4/4 通过，lint、typecheck 与
build 的本地门禁通过。A4a 未引入依赖、未迁移组件；最终交付 PR 的 Linux CI 仍待运行。

### A5（导航切片）已合入最新 main

A5 将 `appView` 移入独立导航切片，并与会话切片组合在同一个物理原子容器；会话模块不再暴露
页面概念，也未引入 Router。PR #148 已将该切片合入
`main@0ea16a455bd8ed6fd9a209e337f92615b5e594d0`；合并前的详细本地与 PR 证据继续由
[A5 验证记录](./verification/cross-platform/A5-NAVIGATION-SLICE.md)承担，不改变表中其他
测试树的来源区分；表内 Linux 计数已由主控回读 PR #148 原始日志复核。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、Compose 就绪门禁、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，
  避免运行时安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，
  并在运行 E2E 前核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- 前端 lint 有 132 条 warning（0 error），主要是 `Unexpected any`。
- 输入框与卡片边框对比度约 1.2，低于非文字组件 3.0 的要求；会话中界面的 LiveKit 控制条未在真实连接下验收。
- 本机 E2E 开工基线为 233 passed / 1 failed，仍是已记录的 WebKit Provider select 高度
  336×23px 问题，没有新增失败；最终 A3 基线以 Linux CI 为准。
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
