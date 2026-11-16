# EchoTalk 当前状态

> 最后核对：2026-11-16。PR177–187（LGR/TS/READ/ST/A11Y/READ2/ST2/ACT/DASH/CPB/EV）已按门禁逐包合并（主代码终点 EV main `bf4becd`，PR CI 43737757005 / mainCI 43738720996）；DOC（PR188 纯 MD 收口）已发布 main `0a4b6fdf`（mainCI 43744058036）。截至本次文档核对，A19 RoomSession 所有权收窄为本机候选（源码独立 APPROVED R1，尚未发布），其发布与 CI 回执由 PR 正文另给，避免自引用。
> 未完成工作只在根目录 [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；逐轮实施记录在 [`history/`](./history/)。

## 当前功能

| 领域                   | 当前实现                                                                                                            | 状态与边界                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 认证与用户边界         | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离                                     | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收                         |
| 实时对话               | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                                                   | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明                                |
| 会话生命周期           | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束                                | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭                               |
| 启动编排（H1）         | 原runStartup抽为延迟ports的factory；同步门禁、动态依赖与cleanup所有权保留，resume未合并                             | 已合并PR174、最终mainCI成功；旧测试零改、新15条同层测试及四项有效变异保留，真实依赖仍未验 |
| Room 所有权收窄（A19） | RoomContextSync 移除无用 onRoom/onRoomRef、roomRef 改必传，render 期绑定与 stop 语义保留                            | 源码独立 APPROVED R1；初始 Web 快照门禁经审计非泄漏保留；尚未发布                         |
| 会话分析               | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态；可替换评估提供方与内部coverage                     | 源码APPROVED R0；仍为文本demo规则，真实发音 Provider 未验收                               |
| 契约同源（G3）         | Python单源、离线JSON/TS及调用方引用；9码安全发送、开放接收、5码诊断、5项分析目录、3项人工不可重试                   | 已合并PR172、最终mainCI首轮成功；重试与wire语义保留                                       |
| 结果可信度             | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态                                  | 已实现                                                                                    |
| 自适应课程             | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                                                 | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务                                  |
| BYOK                   | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast                                  | 已实现；密钥轮换和 Provider 连通性需按环境验收                                            |
| DocTalk                | 文档输入、Prompt 构建、文档会话入口                                                                                 | 已实现 Web 流程；原生端文件选择未验收                                                     |
| 前端体验               | Dashboard、课程推荐、每日进度、评估反馈、三主题、键盘焦点、44px 触控目标、设置抽屉标题"设置"、活动行可见 ID 前 8 位 | 设置可读性已发布（PR179）；装饰卡/全产品 AA、真实设备读屏未验                             |
| 周度学习               | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3                                               | **部分实现**：练习时长、掌握度环比、发音趋势、下周重点均未实现                            |
| iOS                    | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                                                             | 真机全链路、原生登录与发布未验收                                                          |
| macOS                  | 仅 `tools/macos-m1-native-probe` 探测工程                                                                           | **未实现**正式客户端，等待 CP-03 设备证据                                                 |
| 数字人                 | 只有待办                                                                                                            | **未实现**                                                                                |

## 当前验证基线

最终代码冻结点为 EV main `bf4becd`（PR187，PR CI 43737757005 / mainCI 43738720996 首轮 success）；归档 SHA/CRC、
原生 results.json、trace/retry 计数与 Linux CI 日志回读详见 [EV 首失败取证](./history/2026-11-16-e2e-first-failure-evidence.md)。
下表 macOS 为父 Harness 亲跑（EV 源码）、Linux 为 CI 日志回读（CPB main `53d2a409`），分列；相对 CPB source 仅 EV 两配置差异，
410 个 17 门禁 source manifest 同字节。

| 测试树 / 门禁       | macOS 父 Harness 亲跑（EV 源码） | Linux CI 日志回读（CPB main 53d2a409）  |
| ------------------- | -------------------------------- | --------------------------------------- |
| Vitest              | 1260 passed / 55 文件            | 1260 passed / 55 文件                   |
| Playwright E2E      | 258，C129/W129，retry0           | 258，C129/W129，retry/skip/flaky0，4.7m |
| Fake API 契约       | 125 passed                       | 125 passed                              |
| API 类型生成器      | 10 passed                        | 10 passed                               |
| 构建脚本            | 21 passed                        | 21 passed                               |
| 完整 backend pytest | 962 / 3 warnings / 80.63%        | 962 / 3 warnings / 80.63% / 50.50s      |

A19 本机候选（父 Harness macOS 亲跑，17 门禁全 success，未跑 CI）：Vitest 1264/56、Fake 125、types 10、build 21、
pytest 962/3w/80.63%、E2E 258 C129/W129 retry/skip/flaky0，详见 [history](./history/2026-11-16-a19-room-ownership-maintenance.md)。

EV 默认 trace/screenshot 策略本机受控对照（未覆盖策略、retries0，负 2 trace2/PNG2/JSON 正 2 trace0/失败 PNG0，从未上传真实归档），
705 源文件逐字节恢复；历史 GC60 自然未复现、根因未知，不宣称修复。已发布 ACT/DASH/ST2 计数见各自 history。
命令见 [Agent 评审手册 §2](./agent-review-loop.md)。这些结果不替代真实 LiveKit、第三方 Provider、真实 IdP、iOS/macOS
设备或生产部署验收。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、Compose 就绪门禁、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，避免运行时
  安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，并在运行 E2E 前
  核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- 前端 lint 有 132 条 warning（0 error），主要是 `Unexpected any`。
- I1方案A已实施、源码APPROVED R0，文本demo仍无真实音频输入契约；真实音频来源/权限/保留、
  Provider/LiveKit/IdP、设备、整栈及部署仍未验。
- G2 Fake 默认租约仍disabled/503；成功Cloud租约和Provider验证仅显式合成fixture，不代表真实撤销/验证；
  保留 `analysis-success-*`、`grammar-only-*` 两条具名 UUID 例外，避免扩大冻结 fixture 范围，UUID/schema 校验未放宽。
- 设置功能输入边界已由 READ 提升至 3:1、禁用 select 文字至 4.943；装饰卡边框不统一套 3:1，
  不宣称全产品 AA；会话中界面 LiveKit 控制条未在真实连接下验收。
- READ2/ST/A11Y 首轮 CI 历史 flaky/首失败仍保留，不因后续 main 绿而追认已解决：READ2 PR182 session-flow GC
  257pass+1flaky/retry1；ST PR180 沿用旧 `a11y-focus-touch.spec.ts:64` seen>=6 得 5（1 retry），与 READ PR179
  同源旧用例 flaky；真实触发因果仍未知，PR181 修正后其 PR/main 首轮全 258/0，已修确定前提缺口而非证得根因。
- 历史首失败与因果未知继续保留：theme-storage 两次 233/1 warm/cool、weekly-grammar 5/1、启动视图测试前提
  （ST）历史根因未知，不写"历史根因已成立"或"不是环境偶发"。
- CI 首失败取证（EV）只补证据保存（retain-on-failure/only-on-failure + list,json reporter + artifact 上传），
  不修复也不宣称修复 GC；历史 GC60 自然未复现、根因未知；首次 YAML require 根路径 module-not-found 失败保留（工具/环境证据）。
- 真实方向键选择仍未验证：focus/Tab/selectOption 已通过，原生 popup 实际操作仍未验。
- 根目录 `README.md` 仍含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准。

## 历史与决策

| 内容                                                                         | 位置                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Room 所有权收窄（A19，源码 APPROVED R1，尚未发布）                           | [验收记录](./history/2026-11-16-a19-room-ownership-maintenance.md)                                                                                                                                  |
| CI 首失败取证（EV，源码 APPROVED；已发布 main bf4becd，mainCI 首五 success） | [验收记录](./history/2026-11-16-e2e-first-failure-evidence.md)                                                                                                                                      |
| Compose 启动门禁方案 B（CPB，已发布 PR186/main 53d2a409）                    | [验收记录](./history/2026-11-15-compose-startup-gates.md)                                                                                                                                           |
| Dashboard 抽取（DASH，源码 APPROVED，三树计数相对 ACT 零变化）               | [验收记录](./history/2026-11-15-dashboard-extraction.md)                                                                                                                                            |
| 遗留产品润色（ACT，三处产品修复 + R2-10 剩余 UI，本机 17 门禁）              | [验收记录](./history/2026-11-15-legacy-product-polish.md)                                                                                                                                           |
| Token 失败自动清理测试前提（ST2，已发布 PR183/main 7780c718）                | [验收记录](./history/2026-11-15-session-token-error-test-barrier.md)                                                                                                                                |
| 主题按钮大字号重排（READ2，已发布 PR182/main 3d246c3）                       | [验收记录](./history/2026-11-15-theme-swatch-reflow.md)                                                                                                                                             |
| 键盘焦点遍历可靠性（A11Y，已发布 PR181/main cf104bb）                        | [验收记录](./history/2026-11-15-dashboard-focus-test-reliability.md)                                                                                                                                |
| 启动视图测试前提（ST，已发布 PR180/main f915157）                            | [验收记录](./history/2026-11-15-session-start-test-barrier.md)                                                                                                                                      |
| 设置可读性（READ，已发布 PR179/main c9f3131a）                               | [验收记录](./history/2026-11-15-settings-readability.md)                                                                                                                                            |
| theme-storage 冷启动/水合/零写（TS，已发布 PR178）                           | [验收记录](./history/2026-11-15-theme-storage-reliability.md)                                                                                                                                       |
| I1评估提供方设计与实施（源码APPROVED R0，已发布main76d9d6ba）                | [ASSESSMENT_PROVIDER_DESIGN.md](./ASSESSMENT_PROVIDER_DESIGN.md)；[设计记录](./history/2026-11-15-i1-assessment-provider-design.md)；[实施记录](./history/2026-11-15-i1-provider-implementation.md) |
| 遗留台账对账（LGR，纯文档）                                                  | [对账记录](./history/2026-11-15-legacy-reconciliation.md)                                                                                                                                           |
| H1设计与实施（已发布，保留首失败）                                           | [CONVERSATION_STARTUP_EXTRACTION_DESIGN.md](./CONVERSATION_STARTUP_EXTRACTION_DESIGN.md)；[实施记录](./history/2026-11-15-h1-startup-implementation.md)                                             |
| G3同源契约本机验收补齐与历史草稿                                             | [history/2026-11-15-g3-contract-implementation.md](./history/2026-11-15-g3-contract-implementation.md)                                                                                              |
| 2026 年 11 月各轮实施记录与当时基线                                          | [history/2026-11.md](./history/2026-11.md)                                                                                                                                                          |
| 2026 年 10 月各轮实施记录                                                    | [history/2026-10.md](./history/2026-10.md)                                                                                                                                                          |
| 已合并与明确未采纳的方案                                                     | [history/decisions.md](./history/decisions.md)                                                                                                                                                      |
| 已完成的待办事项                                                             | [history/todo-done.md](./history/todo-done.md)                                                                                                                                                      |
| 评审手册的单轮回执                                                           | [history/review-loop-receipts.md](./history/review-loop-receipts.md)                                                                                                                                |

历史文件只追加、不改写；其中的计数和结论只属于当时的提交。
