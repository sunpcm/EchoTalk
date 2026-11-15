# EchoTalk 当前状态

> 最后核对：2026-11-15；H1 PR174已发布main0f7a5e5，最终mainCI首轮成功；I1仅设计、未实施。
> 已发布H1 Linux与本机I1冻结代码验证分列；本机源码14门禁成功不等于未来I1接口已通过验收。
> 未完成工作只在根目录 [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；
> 逐轮实施记录在 [`history/`](./history/)，不在本文追加。

## 当前功能

| 领域           | 当前实现                                                                                          | 状态与边界                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离                   | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收                                    |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                                 | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明                                           |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束              | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭                                          |
| 启动编排（H1） | 原runStartup抽为延迟ports的factory；同步门禁、动态依赖与cleanup所有权保留，resume未合并           | 已合并PR174、最终mainCI成功；旧测试零改、新15条同层测试及四项有效变异保留，真实依赖仍未验            |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态                                   | 自动化覆盖状态机；语法为 demo 规则，真实发音 Provider 未验收                                         |
| 契约同源（G3） | Python单源、离线JSON/TS及调用方引用；9码安全发送、开放接收、5码诊断、5项分析目录、3项人工不可重试 | 已合并PR172、最终mainCI首轮成功；重试与wire语义保留                                                  |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态                | 已实现                                                                                               |
| 自适应课程     | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                               | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务                                             |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast                | 已实现；密钥轮换和 Provider 连通性需按环境验收                                                       |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                               | 已实现 Web 流程；原生端文件选择未验收                                                                |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、键盘焦点、44px 触控目标                          | Provider 高度修复已通过本机双浏览器验证；大字号深色 Provider 文字可读性仍有 P2，边框与读屏实测未完成 |
| 周度学习       | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3                             | **部分实现**：练习时长、掌握度环比、发音趋势、下周重点均未实现                                       |
| iOS            | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                                           | 真机全链路、原生登录与发布未验收                                                                     |
| macOS          | 仅 `tools/macos-m1-native-probe` 探测工程                                                         | **未实现**正式客户端，等待 CP-03 设备证据                                                            |
| 数字人         | 只有待办                                                                                          | **未实现**                                                                                           |

## 当前验证基线

已验证发布基线：[PR174](https://github.com/sunpcm/EchoTalk/pull/174)合并至
[0f7a5e5](https://github.com/sunpcm/EchoTalk/commit/0f7a5e57f809f8566efc39ca582bdc95fc260dfc)，tree `eeb37709c6e8802092eb8a25ba8fb5b799965d39`；
[mainCI43677877043](https://github.com/sunpcm/EchoTalk/actions/runs/43677877043) attempt1五作业success，source/CImerge/main等树。
PR CI43677251600与Guard43677251555首轮六检查success；下表Linux列为Harness回读main，I1列为Harness亲跑macOS，非实施方执行。

| 测试树 / 门禁      | 已发布H1 main0f7a5e5 CI（Linux）              | I1设计本机冻结基线（Harness/macOS）                    |
| ------------------ | --------------------------------------------- | ------------------------------------------------------ |
| Vitest             | 1249 passed / 53文件                          | 1249 passed / 53文件                                   |
| Playwright E2E     | 234，C117/W117，实际retry/skip/flaky0（4.0m） | 234，C117/W117，实际retry/skip/flaky0（80.394227s）    |
| Fake API契约       | 125 passed                                    | 125 passed                                             |
| API类型生成器      | 10 passed                                     | 10 passed                                              |
| 构建脚本           | 21 passed                                     | 21 passed                                              |
| 完整backend pytest | 895 passed / 3 warnings / 79.68%（52.49s）    | 895 passed / 3 warnings / 79.71%（75.46s，命令80.30s） |

I1源码/全部测试零改，Harness本轮14源码门禁success、前后字节稳定；最后五MD格式/Markdown/范围由Harness停写后独立验。
H1 PR与本机覆盖率79.71%，Linux main79.68%，差0.03个百分点未归因，59%门禁不变；不能把PR/本机值抄到main。
I1仅交[评估提供方设计](./ASSESSMENT_PROVIDER_DESIGN.md)，接口/coverage/未来变异尚未实现；来源与计划见[I1记录](./history/2026-11-15-i1-assessment-provider-design.md)。

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
- H1历史本机E2E首233/1、唯一完整重放233/1，均theme-storage:24 warm/cool；本轮I1冻结代码234通过不定位根因或证明稳定性，历史不改写。
- I1具体方案待用户确认，文本demo无真实音频输入契约；真实音频来源/权限/保留、Provider/LiveKit/IdP、设备、整栈及部署仍未验。
- G2 Fake 默认租约仍disabled/503；成功Cloud租约和Provider验证仅显式合成fixture，不代表真实撤销/验证。
  保留两条UUID偏差：assessment `$.session_id` 绑定 `analysis-success-*`，grammar `$[0].session_id` 绑定
  `grammar-only-*` 等具名合成场景及关联ID断言，避免扩大冻结fixture范围；UUID/schema校验未放宽。
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
- G2已补对比度测试的确定输入/就绪前提；三格受控对照未复现CI RED。b8的[mainCI43594803847](https://github.com/sunpcm/EchoTalk/actions/runs/43594803847)
  230pass/1flaky/3fail及后端841/3warnings/80.59%（50.85s）保留；历史因果未知，本机360/234不证明稳定性，详见[G2记录](./history/2026-11-14-g2-theme-contrast-ci.md)。
- 根目录 `README.md` 仍含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准。

## 历史与决策

| 内容                                | 位置                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1评估提供方设计（未实施）          | [ASSESSMENT_PROVIDER_DESIGN.md](./ASSESSMENT_PROVIDER_DESIGN.md)；[本轮记录](./history/2026-11-15-i1-assessment-provider-design.md)                     |
| H1设计与实施（已发布，保留首失败）  | [CONVERSATION_STARTUP_EXTRACTION_DESIGN.md](./CONVERSATION_STARTUP_EXTRACTION_DESIGN.md)；[实施记录](./history/2026-11-15-h1-startup-implementation.md) |
| G3同源契约本机验收补齐与历史草稿    | [history/2026-11-15-g3-contract-implementation.md](./history/2026-11-15-g3-contract-implementation.md)                                                  |
| G2 主题对比度 CI 收尾与当前验收     | [history/2026-11-14-g2-theme-contrast-ci.md](./history/2026-11-14-g2-theme-contrast-ci.md)                                                              |
| 2026 年 11 月各轮实施记录与当时基线 | [history/2026-11.md](./history/2026-11.md)                                                                                                              |
| 2026 年 10 月各轮实施记录           | [history/2026-10.md](./history/2026-10.md)                                                                                                              |
| 已合并与明确未采纳的方案            | [history/decisions.md](./history/decisions.md)                                                                                                          |
| 已完成的待办事项                    | [history/todo-done.md](./history/todo-done.md)                                                                                                          |
| 评审手册的单轮回执                  | [history/review-loop-receipts.md](./history/review-loop-receipts.md)                                                                                    |

历史文件只追加、不改写；其中的计数和结论只属于当时的提交。
