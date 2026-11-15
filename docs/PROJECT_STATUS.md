# EchoTalk 当前状态

> 最后核对：2026-11-15；I1设计PR175已发布main312a8f8，实施PR176已发布main76d9d6ba（source7f272cd/CImerge5e5c1f8）；I1实施源码APPROVED R0。
> 已发布设计main、本机I1实施候选与已发布实施main76d9d6ba分列；首轮CI/Guard与mainCI回执已记录，不预填后续整包/发布结论。
> 未完成工作只在根目录 [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；
> 逐轮实施记录在 [`history/`](./history/)，不在本文追加。

## 当前功能

| 领域           | 当前实现                                                                                          | 状态与边界                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离                   | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收                                    |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                                 | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明                                           |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束              | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭                                          |
| 启动编排（H1） | 原runStartup抽为延迟ports的factory；同步门禁、动态依赖与cleanup所有权保留，resume未合并           | 已合并PR174、最终mainCI成功；旧测试零改、新15条同层测试及四项有效变异保留，真实依赖仍未验            |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态；可替换评估提供方与内部coverage   | 源码APPROVED R0；仍为文本demo规则，真实发音 Provider 未验收                                          |
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

已验证发布基线：设计[PR175](https://github.com/sunpcm/EchoTalk/pull/175)合并至
[312a8f8](https://github.com/sunpcm/EchoTalk/commit/312a8f802b73f5fcb1e285a52c9dce2b1b497bad)；实施[PR176](https://github.com/sunpcm/EchoTalk/pull/176)
source `7f272cdb8845822010ae6658c8e1fc3a3913ec22` / CImerge `5e5c1f8466649248428ded72db979f73eb2172c7` / main
[76d9d6ba](https://github.com/sunpcm/EchoTalk/commit/76d9d6ba8c3ad72cf2c0671344ff48b617faea0f)、tree `019b24392f3c16ce5bfa34dff38b412935bfa938`。
实施 PR 与 Guard CI 首轮六 success（[PR CI 43686352704](https://github.com/sunpcm/EchoTalk/actions/runs/43686352704)、
[Guard 43686352698](https://github.com/sunpcm/EchoTalk/actions/runs/43686352698)），[mainCI43686992533](https://github.com/sunpcm/EchoTalk/actions/runs/43686992533)首轮五 success。
下表左列为已发布实施 main76d9d6ba（Linux CI），右列为本轮 LGR fresh（Harness/macOS，17 门禁全 success），二者同计数、不同耗时，均非实施方执行。

| 测试树 / 门禁      | 已发布实施 main76d9d6ba CI（Linux）        | 本轮 LGR fresh（Harness/macOS）                    |
| ------------------ | ------------------------------------------ | -------------------------------------------------- |
| Vitest             | 1249 passed / 53文件                       | 1249 passed / 53文件（13.29s）                     |
| Playwright E2E     | 234，C117/W117，retry/skip/flaky0（4.5m）  | 234，C117/W117，retry/skip/flaky0（54.74s）        |
| Fake API契约       | 125 passed                                 | 125 passed（6.67s）                                |
| API类型生成器      | 10 passed                                  | 10 passed（5.07s）                                 |
| 构建脚本           | 21 passed                                  | 21 passed（13.59s）                                |
| 完整backend pytest | 957 passed / 3 warnings / 80.63%（73.52s） | 957 passed / 3 warnings / 80.63%（70.48s，74.89s） |

本轮 LGR fresh macOS 17 项现存门禁全 success（上表六项 + lint/typecheck/build/check-api-types/openapi/providers/
backend-format/backend-lint/format/agent-contract/agent-types），source 前后字节不变。I1 实施候选当时 15 门禁
pytest 80.83s，本轮 LGR 17 门禁 pytest 70.48s，不把 I1 80.83s 冒成本轮 70.48s；不预填本 LGR 未来 PR/main。
I1 源码 APPROVED R0 已实有，接口/coverage/5项变异与来源/首失败见[实施记录](./history/2026-11-15-i1-provider-implementation.md)。

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
- I1方案A已实施、源码APPROVED R0，文本demo仍无真实音频输入契约；真实音频来源/权限/保留、Provider/LiveKit/IdP、设备、整栈及部署仍未验。
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

| 内容                                                          | 位置                                                                                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
