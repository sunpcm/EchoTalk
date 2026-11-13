# EchoTalk 当前状态

> 最后核对：2026-11-13，I2（分析任务最小可观测性）已完成本地实施与 Harness/macOS 亲跑，见下方
> "当前验证基线"。本文只回答"现在实现了什么、验证到哪一步、有哪些已知限制"。
> 未完成工作只在根目录 [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；
> 逐轮实施记录在 [`history/`](./history/)，不在本文追加。

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

当前基线为本轮 I2 的 Harness/macOS 亲跑（非 Linux CI）。本机结果绑定对应提交与子树；
CI 回执以对应 PR 的最终 head 为准。

| 测试树 / 门禁  | 最近实测结果（I2 Harness/macOS，非 Linux CI）                             | 日志     |
| -------------- | ------------------------------------------------------------------------- | -------- |
| Vitest         | 1227 passed（51 个文件）                                                  | frontend |
| Playwright E2E | 233 passed / 1 failed（Chromium 117/0、WebKit 116/1，retry/skip/flaky 0） | frontend |
| Fake API 契约  | 108 passed                                                                | frontend |
| API 类型生成器 | 8 passed                                                                  | frontend |
| 构建脚本       | 21 passed                                                                 | frontend |
| backend pytest | 841 passed，3 warnings，80.59% 覆盖率（59% 门禁）                         | backend  |

E2E 唯一失败为既有 a11y Provider 336×23px 高度问题（无新增失败）；前端 lint 132 warnings / 0 error。
本地文档收口时 I2 专属 Linux CI 尚未运行，最终回执以对应 PR 为准。最近已核 Linux 基线为 G1
（PR #163，source head `f1bff3431d69c486768c914e3babd565ec8fb284`），
[CI 43428362306](https://github.com/sunpcm/EchoTalk/actions/runs/43428362306) 与
[PR Guard 43428362337](https://github.com/sunpcm/EchoTalk/actions/runs/43428362337)，Vitest 1227/51、
E2E 234（Chromium 117/WebKit 117，实际 retry/skip/flaky 0，CI 配置 retries 2）、
pytest 813/3 warnings/80.23%、108/8/21。

这些结果都不能代替真实 LiveKit、第三方 Provider、真实 IdP、iOS/macOS 设备或生产部署验收。
命令见 [Agent 评审手册 §2 与 §20](./agent-review-loop.md)。A1–A6、B1、F1–F4、G1、H2、I2 的逐卡收口与历史快照
基线已移入 [history/2026-11.md](./history/2026-11.md)。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、Compose 就绪门禁、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，
  避免运行时安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，
  并在运行 E2E 前核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- 前端 lint 有 132 条 warning（0 error），主要是 `Unexpected any`。
- 输入框与卡片边框对比度约 1.2，低于非文字组件 3.0 的要求；会话中界面的 LiveKit 控制条未在真实连接下验收。
- 本机 E2E 开工基线为 233 passed / 1 failed，仍是已记录的 WebKit Provider select 高度
  336×23px 问题，没有新增失败；最终基线以对应 PR 的 Linux CI 回执为准。
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
