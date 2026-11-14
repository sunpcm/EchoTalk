# EchoTalk 当前状态

> 最后核对：2026-11-14，P1 已合并，W1 测试前提修正已由 Harness 完成独立代码验收与本机验证；
> 已发布 main CI 与 W1 本机结果分别列于"当前验证基线"。本文只回答"现在实现了什么、验证到哪一步、有哪些已知限制"。
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

当前 main 基线已合入 P1：
[`6606107b669a9efe49ac271d16b7375fff6d7144`](https://github.com/sunpcm/EchoTalk/commit/6606107b669a9efe49ac271d16b7375fff6d7144)，
tree `9451ff084b461558309f88b336fd00c07165440c`；main CI
[`43573445537`](https://github.com/sunpcm/EchoTalk/actions/runs/43573445537) attempt1 五作业 success。
P1 [PR #167](https://github.com/sunpcm/EchoTalk/pull/167)（source `18348daba65ad345fc2337dccee394bc3b30b531`）的
[PR CI 43572873254](https://github.com/sunpcm/EchoTalk/actions/runs/43572873254) 与
[Guard 43572873219](https://github.com/sunpcm/EchoTalk/actions/runs/43572873219) 首次六检查 success。
下表是 Harness 实时回读 [frontend job 132382512493](https://github.com/sunpcm/EchoTalk/actions/runs/43573445537/job/132382512493)
及 [backend job 132382512440](https://github.com/sunpcm/EchoTalk/actions/runs/43573445537/job/132382512440) 的原始日志，非本机亲跑。

| 测试树 / 门禁  | 当前 main CI 结果（Linux）                                | 日志     |
| -------------- | --------------------------------------------------------- | -------- |
| Vitest         | 1227 passed（51 个文件）                                  | frontend |
| Playwright E2E | 234 passed（Chromium 117/WebKit 117，retry 标记 0，3.5m） | frontend |
| Fake API 契约  | 108 passed                                                | frontend |
| API 类型生成器 | 8 passed                                                  | frontend |
| 构建脚本       | 21 passed                                                 | frontend |
| backend pytest | 841 passed，3 warnings，80.59% 覆盖率（40.85s）           | backend  |

W1 冻结候选由 Harness/macOS 亲跑 15 门禁全部 exit 0：Vitest 1227/51、Fake108/类型8/构建21、
pytest 841/3 warnings/80.59%，source 前后稳定。完整 E2E **234/0**（C117/W117，实际 retry/skip/flaky0，
Playwright **51.519538s**、命令 **52.42s**）；全文件 4 用例 × 双浏览器 × repeat50/workers4 为
**400/400**（C200/W200，retry/skip/flaky0，**216.198592s**），正式用例仍4、全局234。
真实初始 load 被图像拖迟的独立反事实中，候选 C/W 2/2：首个503在 native pageshow 后才结算，原错误提示、
显式重试、50行及请求数2保全；错误提示/重试故障变异也由保留的目标断言捕获。此为修正单次503夹具与初始
pageshow竞争的本机证据，不是 W1 新 PR/main CI。实施方未跑浏览器；项目 tsconfig 仍仅 include src。
P1 此前本机234/0、Provider高度/键盘边界，W1完整时序、变异及耗时，旧582/f19/D1回执均见
[history/2026-11.md](./history/2026-11.md)。

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
- W1 已修复可重复的单次503夹具与初始pageshow竞争，未改产品；原版自然100/100未复现，D1那一次无trace，
  不能追认同因。D1首232/2、T1首233/1、WP旧10/10及P1全部键盘首失败保留；Provider高度已由P1修复，
  本机234/0不抹去这些历史，详见 [history/2026-11.md](./history/2026-11.md)。
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
