# EchoTalk 当前状态

> 最后核对：2026-11-15；theme-storage（TS）已发布 PR178 至 main `94037c0`（PR/Guard 首6 success、mainCI 首5 success）；READ 源码 APPROVED R2、PR/CI 待建。
> 已发布 TS/CI234 与本机 READ 候选 258 分列；不预填 READ PR/CI 或发布终点 SHA。
> 未完成工作只在根目录 [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；逐轮实施记录在 [`history/`](./history/)。

## 当前功能

| 领域           | 当前实现                                                                                          | 状态与边界                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离                   | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收                         |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                                 | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明                                |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束              | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭                               |
| 启动编排（H1） | 原runStartup抽为延迟ports的factory；同步门禁、动态依赖与cleanup所有权保留，resume未合并           | 已合并PR174、最终mainCI成功；旧测试零改、新15条同层测试及四项有效变异保留，真实依赖仍未验 |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态；可替换评估提供方与内部coverage   | 源码APPROVED R0；仍为文本demo规则，真实发音 Provider 未验收                               |
| 契约同源（G3） | Python单源、离线JSON/TS及调用方引用；9码安全发送、开放接收、5码诊断、5项分析目录、3项人工不可重试 | 已合并PR172、最终mainCI首轮成功；重试与wire语义保留                                       |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态                | 已实现                                                                                    |
| 自适应课程     | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                               | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务                                  |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast                | 已实现；密钥轮换和 Provider 连通性需按环境验收                                            |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                               | 已实现 Web 流程；原生端文件选择未验收                                                     |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、键盘焦点、44px 触控目标                          | 设置功能输入边界/禁用文字可读性已本机验收（未发布）；装饰卡/全产品 AA、真实设备读屏未验   |
| 周度学习       | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3                             | **部分实现**：练习时长、掌握度环比、发音趋势、下周重点均未实现                            |
| iOS            | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                                           | 真机全链路、原生登录与发布未验收                                                          |
| macOS          | 仅 `tools/macos-m1-native-probe` 探测工程                                                         | **未实现**正式客户端，等待 CP-03 设备证据                                                 |
| 数字人         | 只有待办                                                                                          | **未实现**                                                                                |

## 当前验证基线

theme-storage（TS）已发布 [PR178](https://github.com/sunpcm/EchoTalk/pull/178) 至 main `94037c0`；[PR CI43704920189](https://github.com/sunpcm/EchoTalk/actions/runs/43704920189) /
[Guard43704920061](https://github.com/sunpcm/EchoTalk/actions/runs/43704920061) 首轮六 success（E2E 4.4m、pytest 46.52s），[mainCI43706220054](https://github.com/sunpcm/EchoTalk/actions/runs/43706220054)
首轮五 success（E2E 3.8m、pytest 60.31s，实际 checkout `94037` 由 Harness 回读（非实施者））。
下表左列为已发布 TS main `94037c0`（Linux CI，E2E234），右列为本机 READ 候选（继承 TS 后完整 258，未发布）。

| 测试树 / 门禁      | 已发布 TS main94037c0（Linux，E2E234）    | 本机 READ 候选 258（继承 TS，未发布） |
| ------------------ | ----------------------------------------- | ------------------------------------- |
| Vitest             | 1249 passed / 53文件                      | 1249 passed / 53文件                  |
| Playwright E2E     | 234，C117/W117，retry/skip/flaky0（3.8m） | 258，C129/W129，retry/skip/flaky0     |
| Fake API契约       | 125 passed                                | 125 passed                            |
| API类型生成器      | 10 passed                                 | 10 passed                             |
| 构建脚本           | 21 passed                                 | 21 passed                             |
| 完整backend pytest | 957 / 3 warnings / 80.63%（60.31s）       | 957 / 3 warnings / 80.63%（77.15s）   |

READ 候选 24 测试（48 启/禁用阶段），before/after 各 48 条计算样式与截图；功能输入边界 1.148→3.646、
禁用 select 文字 3.124→4.943；四变异目标 RED/恢复 GREEN，R0/R1/R2 首失败保留。命令见 [Agent 评审手册 §2](./agent-review-loop.md)，
详见 [设置可读性验收记录](./history/2026-11-15-settings-readability.md)。这些结果不替代真实 LiveKit、第三方 Provider、
真实 IdP、iOS/macOS 设备或生产部署验收；READ PR/CI 待建，不预填。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、Compose 就绪门禁、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，避免运行时
  安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，并在运行 E2E 前
  核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- 前端 lint 有 132 条 warning（0 error），主要是 `Unexpected any`。
- I1方案A已实施、源码APPROVED R0，文本demo仍无真实音频输入契约；真实音频来源/权限/保留、
  Provider/LiveKit/IdP、设备、整栈及部署仍未验。
- G2 Fake 默认租约仍disabled/503；成功Cloud租约和Provider验证仅显式合成fixture，不代表真实撤销/验证。
  保留两条UUID偏差：assessment `$.session_id` 绑定 `analysis-success-*`，grammar `$[0].session_id` 绑定
  `grammar-only-*` 等具名合成场景及关联ID断言，避免扩大冻结fixture范围；UUID/schema校验未放宽。
- 设置功能输入边界已由 READ 提升至 3:1（1.148→3.646）、禁用 select 文字至 4.943（3.124）；装饰卡边框
  不统一套 3:1，不宣称全产品 AA；会话中界面 LiveKit 控制条未在真实连接下验收。
- READ2：主题选择 radio 内容/色点在 200% 根字号下于按钮内重排/溢出（390/1280、正常/200 字号，本机前后观察，本轮未修）；保留 44px/原颜色/角色/事件与业务；原生/OS 下拉边界归入未验/非范围。
- 真实方向键选择仍未验证：同一 Space/ArrowDown/Enter 私有探针在基线与候选双浏览器均未改值，不能认定
  为本轮引入；focus/Tab/selectOption 已通过，原生 popup 实际操作仍未验。详见本月 history。
- 根目录 `README.md` 仍含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准。

## 历史与决策

| 内容                                                          | 位置                                                                                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设置可读性（READ，本机验收未发布）                            | [验收记录](./history/2026-11-15-settings-readability.md)                                                                                                                                            |
| theme-storage 冷启动/水合/零写（TS，已发布 PR178/CI234）      | [验收记录](./history/2026-11-15-theme-storage-reliability.md)                                                                                                                                       |
| I1评估提供方设计与实施（源码APPROVED R0，已发布main76d9d6ba） | [ASSESSMENT_PROVIDER_DESIGN.md](./ASSESSMENT_PROVIDER_DESIGN.md)；[设计记录](./history/2026-11-15-i1-assessment-provider-design.md)；[实施记录](./history/2026-11-15-i1-provider-implementation.md) |
| 遗留台账对账（LGR，纯文档）                                   | [对账记录](./history/2026-11-15-legacy-reconciliation.md)                                                                                                                                           |
| H1设计与实施（已发布，保留首失败）                            | [CONVERSATION_STARTUP_EXTRACTION_DESIGN.md](./CONVERSATION_STARTUP_EXTRACTION_DESIGN.md)；[实施记录](./history/2026-11-15-h1-startup-implementation.md)                                             |
| G3同源契约本机验收补齐与历史草稿                              | [history/2026-11-15-g3-contract-implementation.md](./history/2026-11-15-g3-contract-implementation.md)                                                                                              |
| G2 主题对比度 CI 收尾与当前验收                               | [history/2026-11-14-g2-theme-contrast-ci.md](./history/2026-11-14-g2-theme-contrast-ci.md)                                                                                                          |
| 2026 年 11 月各轮实施记录与当时基线                           | [history/2026-11.md](./history/2026-11.md)                                                                                                                                                          |
| 2026 年 10 月各轮实施记录                                     | [history/2026-10.md](./history/2026-10.md)                                                                                                                                                          |
| 已合并与明确未采纳的方案                                      | [history/decisions.md](./history/decisions.md)                                                                                                                                                      |
| 已完成的待办事项                                              | [history/todo-done.md](./history/todo-done.md)                                                                                                                                                      |
| 评审手册的单轮回执                                            | [history/review-loop-receipts.md](./history/review-loop-receipts.md)                                                                                                                                |

历史文件只追加、不改写；其中的计数和结论只属于当时的提交。
