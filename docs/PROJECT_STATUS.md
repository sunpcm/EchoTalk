# EchoTalk 当前状态

> 最后核对：2026-11-14，P1 Provider 触控目标修复已由 Harness 完成本机验证；既有 main CI 与本轮本机结果
> 分别列于"当前验证基线"。本文只回答"现在实现了什么、验证到哪一步、有哪些已知限制"。
> 未完成工作只在根目录 [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；
> 逐轮实施记录在 [`history/`](./history/)，不在本文追加。

## 当前功能

| 领域           | 当前实现                                                                             | 状态与边界                                                                                           |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离      | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收                                    |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                    | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明                                           |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束 | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭                                          |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态                      | 自动化覆盖状态机；语法为 demo 规则，真实发音 Provider 未验收                                         |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态   | 已实现                                                                                               |
| 自适应课程     | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                  | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务                                             |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast   | 已实现；密钥轮换和 Provider 连通性需按环境验收                                                       |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                  | 已实现 Web 流程；原生端文件选择未验收                                                                |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、键盘焦点、44px 触控目标             | Provider 高度修复已通过本机双浏览器验证；大字号深色 Provider 文字可读性仍有 P2，边框与读屏实测未完成 |
| 周度学习       | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3                | **部分实现**：练习时长、掌握度环比、发音趋势、下周重点均未实现                                       |
| iOS            | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                              | 真机全链路、原生登录与发布未验收                                                                     |
| macOS          | 仅 `tools/macos-m1-native-probe` 探测工程                                            | **未实现**正式客户端，等待 CP-03 设备证据                                                            |
| 数字人         | 只有待办                                                                             | **未实现**                                                                                           |

## 当前验证基线

当前基线为 Harness 实时回读的既有 main Linux CI（非本机亲跑）。main 仍为
[`f19b6aee9da0d210bfaf2719ebe9d41e639294fc`](https://github.com/sunpcm/EchoTalk/commit/f19b6aee9da0d210bfaf2719ebe9d41e639294fc)，
tree `96beba24bcc6df4e2db1dfc0d0d2748a5713f158`，未观察到增量；main CI
[`43484069428`](https://github.com/sunpcm/EchoTalk/actions/runs/43484069428) attempt1 五作业均 completed/success。
计数来自 [frontend job 132087746583](https://github.com/sunpcm/EchoTalk/actions/runs/43484069428/job/132087746583)
与 [backend job 132087746452](https://github.com/sunpcm/EchoTalk/actions/runs/43484069428/job/132087746452) 原始日志回读。

| 测试树 / 门禁  | 当前 main CI 结果（Linux）                      | 日志     |
| -------------- | ----------------------------------------------- | -------- |
| Vitest         | 1227 passed（51 个文件）                        | frontend |
| Playwright E2E | 234 passed（4.5m）                              | frontend |
| Fake API 契约  | 108 passed                                      | frontend |
| API 类型生成器 | 8 passed                                        | frontend |
| 构建脚本       | 21 passed                                       | frontend |
| backend pytest | 841 passed，3 warnings，80.59% 覆盖率（59.97s） | backend  |

旧 `58254b98`、D1 与相应 CI 回执继续保存在 [history/2026-11.md](./history/2026-11.md)。
下列 P1 结果绑定基于该 main 的本地冻结候选，不预告本轮尚未发布的 PR/main CI。

P1 冻结候选由 Harness/macOS 亲跑 15 项门禁全部 exit 0：Vitest 1227/51、Fake API 108、类型生成器 8、
构建脚本 21、pytest 841/3 warnings/80.59%；完整 E2E **234 passed / 0 failed**（Chromium 117/WebKit 117，
retry/skip/flaky 0，Playwright **54.409s**、命令 **55.39s**）。所有正式测试字节保全，无新增测试计数。
Provider 原生 select 在三主题 × 两字号 × 双浏览器矩阵 12/12 通过，三个控件普通字号高 44px、200% 高 66px，
min-height 44px、appearance none；箭头可见，标签/focus/Tab/selectOption、无垂直裁切和横向溢出通过。
这些是本轮本机回执，非实施节点亲跑，也不是新 PR/main CI；P1 发布后完整回执由 Harness 补充。
冻结源码 SHA、原版 RED、变异与完整门禁明细见 [history/2026-11.md](./history/2026-11.md)。

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
- 历史失败继续保留：D1 本机首轮 232/2、T1 首轮 233/1，其中 Provider 336×23px 已在 P1 修复并通过本机
  验证；`weekly-progress.spec.ts:97` 概览失败提示的根因仍未明确，W1 尚未实施。WP 定向重放 10/10 与本轮
  完整 E2E 234/0 均不抹去首次失败或证明该问题已修复，详见 [history/2026-11.md](./history/2026-11.md)。
- P2：200% 大字号、深色主题的 Provider 文字在暗底可读性差，原版截图同样存在；本轮未修复，不能把高度、
  箭头与裁切检查通过当作深色文字可读性已验收。真实设备与 OS 原生下拉弹窗仍未验收。
- 真实方向键选择仍未验证：同一 Space/ArrowDown/Enter 私有探针在基线与候选双浏览器均未改值，
  不能认定为本轮引入；focus/Tab/selectOption 已通过，原生 popup 实际操作仍未验。详见本月 history。
- 云端独立评审另报告 Linux E2E 233/1（WebKit 主题用例）并做 1 worker 90/90 定向重放；来源为用户
  转交的云端报告、非本轮亲跑，当次无 trace 无法追认根因。本机原版自然失败已定位为 >300ms 点击前提
  缺口、测试已确定性修正，见 [history/2026-11.md](./history/2026-11.md)。
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
