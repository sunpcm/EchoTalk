# EchoTalk 当前状态

> 最后核对：2026-11-15。当前卡 A19 P2 为 `FINAL_READY`：R1 修正共享快照测试夹具后，13 项门禁
> 组合均 `exit 0`，完整 Vitest 为 `1211 passed / 49 files / 0 skip`，三项有效私有行为变异均被
> 对应断言杀死。A82C、A84C、CF20、RF04E 与 WG20 均绑定各自时点的历史快照；其测试数字、失败
> 记录和 Review/提交状态不能转作 A19 P2 的当前结果。R2-13、R2-12、R2-14 以及 A6、B1、独立
> WPH 的数字同样绑定各自当时快照。最终文档 format、独立 Review、提交和当前任务分支推送见主控
> 同卡回执；用户 Review 待。
> 正式 macOS 客户端、Tauri 选型、native 认证、设备与签名均未创建或验收。
> 本文只回答"现在实现了什么、验证到哪一步、有哪些已知限制"。未完成工作只在根目录
> [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；逐轮实施记录在
> [`history/`](./history/)，不在本文追加。

## 当前功能

| 领域           | 当前实现                                                                                      | 状态与边界                                                              |
| -------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离               | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收       |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                             | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明              |
| 启动与系统就绪 | 公开 `/api/health/system-ready` 只读检查共享 PG；Compose 先迁移后启动并校验 API 健康          | 本地合成合同已验收；原整栈、生产 rollout 和真实外部依赖未验收           |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束          | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭             |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态                               | 自动化覆盖状态机；语法为 demo 规则，真实发音 Provider 未验收            |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态            | 已实现                                                                  |
| 本人数据导出   | `GET /api/user/data-export` 输出固定 v1 JSON，显式白名单并读取单一一致只读快照                | 已实现；代码/测试 Review APPROVED，用户 Review 待、无导出 UI            |
| 本人账号删除   | `DELETE /api/user/account` 在受控事务硬删本人 12 类业务数据，保留控制行和他人数据             | 已实现；代码/测试 Review APPROVED，用户 Review 待；生产不可恢复性未验收 |
| 自适应课程     | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                           | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务                |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast            | 已实现；密钥轮换和 Provider 连通性需按环境验收                          |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                           | 已实现 Web 流程；原生端文件选择未验收                                   |
| 前端体验       | Dashboard 已独立，课程推荐、每日进度、评估反馈按页面边界归位；三主题、键盘焦点、44px 触控目标 | 三主题文字对比度有 E2E 回归；边框对比度与读屏实测未完成                 |
| 周度学习       | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3                         | **部分实现**：练习时长、掌握度环比、发音趋势、下周重点均未实现          |
| iOS            | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                                       | 真机全链路、原生登录与发布未验收                                        |
| macOS          | 共享 Vite 静态产物 `dist/macos/<mode>`、manifest、sync 前校验和 Turbo `ANALYZE` 缓存          | 纯脚本已实现；正式客户端、壳、Tauri 选型、native 认证、设备与签名未验   |
| 数字人         | 只有待办                                                                                      | **未实现**                                                              |

## 当前验证基线

### A19 P2 Room 快照与引用所有权（FINAL_READY）

- 只读基线：唯一实施 worktree 为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，基线为
  `a0a54292da5352dd25e83de2840a4bd5f28341a4`。允许写集只为任务卡列出的两个平台/组件文件、
  两份对应测试及四份文档；不改后端、依赖、锁、迁移、服务或业务协议。
- Web 初始门禁：新增无订阅纯读取 `getWebLifecycleSnapshot`，每次实际调用都读取当前
  visibility/online；visible、hidden/offline 与 unknown/null 契约不变，读取本身不注册监听。
  `RoomSession` 不再为初始检查创建临时生命周期 adapter，也不再冻结首次快照。
- Room 所有权：`RoomContextSync` 只接收必需 `roomRef`，删除无人消费的可选 `onRoom` 和可选
  `roomRef`，且不再在 render 阶段写引用。所有权只在已提交的 layout effect 中发布；Room 替换
  或卸载时仍同步停止旧 Room 的本地音轨，并在引用仍属于该 Room 时清空。同步生命周期 callback、
  迟到 callback 隔离、A77 timer 所有权和 ActiveConversation 的第二清理链未改。
- 回归场景：A19P2 覆盖后续实际 render 读取 hidden、并发 render 已创建但未提交 Room、SDK Room
  commit 替换、StrictMode effect replay 与健康重渲染。首轮 TESTS RED 精准选中 5 项，结果为
  `2 passed / 3 failed`，其余 102 项未选；校验期间不用固定 sleep、retry、skip、延长 timeout 或
  直接调用内部 helper 制造行为结果。
- RCA 证据：修正测试夹具后，两文件为
  `107 total / 106 passed / 1 failed / 0 skip / exit 1`，唯一失败是并发所有权场景。主控私有 load
  反事实仅移除 render 写 `roomRef` 的块后，同一用例 `1 passed / exit 0`；恢复原杠杆后再次
  `1 failed / exit 1`，全程两个生产文件 hash 未改。该因果只绑定本卡新场景，不反推或改写 A82
  旧失败根因。
- 首轮 GREEN 历史：实现后两文件为 `107 total / 106 passed / 1 failed / 0 skip`，新并发等 5 项已
  通过，唯一失败是既有 CON-04 订阅后快照夹具；完整 Vitest 为
  `1210 passed / 1 failed / 1211 total / 0 skip`。全仓 format 当时
  `exit 1`，仅指向 `RoomSession.tsx`、`VoiceInterface.test.tsx` 与
  `docs/history/todo-done.md`。这些结果作为返修前历史保留，不覆盖原始 r0 与 ev。
- R1 修正：CON-04 的纯 getter 与 adapter 改为共享同一 `readSnapshot` 读取事实和计数；纯 getter
  使用仅覆盖本用例的 `mockImplementationOnce`，防止跨例泄漏。只迁移该既有 `it` 的非断言
  setup 与陈旧注释，四条原 `expect` 链字节未变；订阅后安全复核、产品门禁与断言均未放宽。
- 最终门禁：13 项门禁组合全部 `exit 0`。完整 Vitest 为
  `1211 passed / 49 files / 0 skip`；R1 后两文件默认配置正向复验为 `107 passed / 0 skip`。
- 浏览器与后端：完整 E2E 为 `248 passed = Chromium 124 + WebKit 124`，每项测试恰有一个
  result，`retry / skip / flaky / unexpected` 均为 `0`；backend 为
  `941 passed / 3 warnings / 0 skip`，raw coverage 为 `81.54086265607265%`。
- 辅助门禁：build-script `47`、Fake API `116`、API 类型 runner `8`、iOS 侧仅 Node runner
  `37`，均通过；iOS 计数不代表真实 iOS 设备验收。lint 为 `132 warning / 0 error / 0 new`，
  文件、消息、规则多重集保持，行号允许随修改移位。
- 变异与保护：三项有效私有行为变异均为 `exit 1` 并被对应断言杀死，分别是 render 提前发布、
  冻结 SDK ownership 依赖与冻结 Web 首次快照；最初一轮私有 Vite 路径解析失败未形成行为变异，
  不计有效杀死。两个旧测试文件共 `530` 条既有 `expect` 语句 AST 保持，仅 CON-04 发生非断言
  arrange 迁移；`682` 个保护文件未改。
- 交付边界：A19P2 只进入当前任务分支的最终提交与推送；不开 PR、不合并、不部署。最终文档
  format、独立 Review、提交和推送以主控同卡回执为准，用户 Review 待。真实设备、真实
  LiveKit/Provider/IdP、远端新 CI、部署和生产链路均未验收。

### A82C Native Room 夹具就绪证据与文档核销（历史快照；当时 FINAL_READY）

- 只读基线：唯一实施 worktree 为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，起始 HEAD/base 均为
  `18801fcb48a36d9ec751c948ff2ed34417794a19`，文档写入前工作树 clean。本轮仅允许修改
  `TODO.md`、`docs/PROJECT_STATUS.md`、`docs/history/todo-done.md` 与
  `docs/verification/cross-platform/CP-06-NATIVE-FIXTURE-READINESS.md` 四份文档。
- 历史证据链：主控已独立重读旧 A82
  [integration.json](/Users/sunpcm/code/EchoTalk/.review/reports/workflow-eval-r2/a82/reviewer/integration.json)
  的 15 份 `main_checks` 原始日志，SHA 全部匹配；旧提交
  `d8c9ff9d8f69ef0d55add4c955bb096b790f6e2c` 与当时 `APPROVED`、正常 hook 单提交、main
  精确 fast-forward、完整门禁均属于已核验历史，不是 A82C 当前定向验证或当前门禁结果。
- 隔离依赖与 PG：主控已恢复隔离 worktree/依赖，并以本轮新建的 empty tmpfs PostgreSQL `15.19`
  监听 `127.0.0.1:55433`；18 份既有迁移全部重放成功，`exit 0`。该 PG 当前仍由持续批次独占使用，
  整批结束才清理；本文不把迁移成功单独表述为测试或质量门禁通过。
- 当前卡只核销 Native Room 本地夹具就绪子项。既有两处跨异步 native/DOM 就绪用例先保存当前
  DOM 实例，再等待同一实例的 callback map 项及所需字段登记；目标用例仍在同一 native callback
  返回前读取 `stopCalledDuringCallback`，证明本地轨同步停止未被等待延后。本卡产品与测试字节仍
  零改，也不修改依赖、锁、迁移、服务或共享工具；权威实施边界见
  [CP-06 Native Room 回归夹具就绪](./verification/cross-platform/CP-06-NATIVE-FIXTURE-READINESS.md)。
- 源码审计：当前两条目标与旧 A82 完整 callback 并非完全相同；差异仅为 `6` 处
  `useConversationStore → useAppStore` 的 typed store facade 标识。当前 `conversation.ts` 明确
  以同一物理容器提供 typed facade；除上述标识外，guards 与 callback 返回前同步停轨断言一致。
  因此不得表述为“整段 AST 完全相同”。
- 当前门禁证据：主控机器回执为
  [verified-summary.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/continuation-20261115/A82C/reviewer/verified-summary.json)
  与
  [full-gates.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/continuation-20261115/A82C/reviewer/full-gates.json)。
  `full-gates.json` 的 `quality`、`vitest`、`build-script`、`fake`、`api-check`、`api-test`、
  `e2e`、`backend-format`、`backend-lint`、`schema`、`metadata`、`backend-test`、`format`
  共 13 项分组均为 `exit 0`。
- 当前完整测试树：Vitest 为 `1206 passed / 49 files / 0 skip`；完整双浏览器 E2E 为
  `248 passed = Chromium 124 + WebKit 124`，每个 test 恰有一个 passed result，
  `retry / skip / flaky / unexpected` 均为 `0`；backend 为
  `941 passed / 3 warnings / 0 skip`，raw coverage 为 `81.69693530079455%`。build-script 为
  `47`、Fake API 为 `116`、API 类型 runner 为 `8`；iOS 侧仅运行 Node runner `37`，不代表
  真实 iOS。lint 为 `132 warnings / 0 errors / 0 new`，且与 A84C 逐诊断精确一致。
- 当前 Native 定向证据：两条目标在 `20` 个独立进程中执行，每个进程均为 `retry=0`；每次恰选中
  `2` 项并全部通过，共 `40 passed`。每次另有 `84` 项未选，不计入目标覆盖率；该 `40` 是定向
  执行结果，不与 Vitest `1206` 相加。
- 语义边界：已观察到的直接事实是 callback map 项尚未就绪；显式等待只移除这一夹具竞态。
  触发旧失败的完整因果仍未独立证明，有限次重复通过也不能替代因果或概率证据，更不能据此宣称
  真实设备故障已修复。
- 外部边界：真实 LiveKit/Provider、IdP、设备、远端新 CI、部署与生产链路仍未验证；本子项不关闭
  RF-07、RF-09、RF-12 或其他 RF 总项，也不启动 A19/A18。当前停在 `FINAL_READY`，不推进产品或
  下一卡。
  独立Review/提交发布见主控同卡回执，用户Review待。

### A84C LiveKit 语音连接策略文档收口（2026-11-14 历史快照；当时 FINAL_READY）

- 只读基线：worktree 为 `/private/tmp/echotalk-b1-implementation-20261112`，分支
  `codex/B1-learning-events-20261112`，起始 HEAD/base 均为
  `44cb125493af4e46e38f7199e197b3cc9bd87bd3`，文档写入前工作树 clean。本轮只允许修改
  `TODO.md`、`docs/PROJECT_STATUS.md`、`docs/history/todo-done.md` 与
  `docs/verification/cross-platform/RF-10-SESSION-CONNECT-POLICY.md` 四份文档；交付报告写在
  `/private/tmp/A84C-implementation.md`。
- 历史事实：A84 r0 在源码内记录的“停在 Review”是旧交付时点，其后旧独立评审已正式
  APPROVED。旧快照为 `fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d`，最终提交为
  `42c251b3470aa5f7e9cfe5a1fb2655dc8f9b5aa9`；7 个变异均有效、lane/main 15 项复验通过。
  回执见 [review-final.md](/Users/sunpcm/code/EchoTalk/.review/reports/workflow-eval-r2/a84/reviewer/review-final.md)
  与 [milestone-summary.md](/Users/sunpcm/code/EchoTalk/.review/reports/workflow-eval-r2/a84/reviewer/milestone-summary.md)。
  该提交不是 A84C 的 `44cb125…` base 的祖先，因此旧 Review/提交/门禁结果不能转写为 A84C
  快照结果。
- A84C 快照测试与质量门禁：`A84C-full-gates.json` 的 13 个键分组执行均为 `exit 0`。最终
  Review/提交发布见主控同卡回执，用户 Review 待。证据见
  [A84C-full-gates.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/A84C-full-gates.json)。
  Vitest 为
  `1206 passed / 49 files`；完整双浏览器 E2E 为 `248 passed = Chromium 124 + WebKit 124`，
  每个 test 恰有一个 passed result，失败/跳过/flaky/retry 均为 0，`workers=1`；backend 为
  `941 passed / 3 warnings / 0 skip`，原生覆盖率 `rawCoverage=81.54086265607265%`；
  build-script 为 `47`、Fake API 为 `116`、API 类型 runner 为 `8`、非 native iOS Node runner
  为 `37`，均通过；lint 为 `132 warning / 0 error / 0 new`，逐诊断与 CF20 一致。
- A84C 快照针对性测试只运行当时三份相关文件，共 `29 passed`。旧 A84 的 `37` 目标包含另一文件，
  两者不混算或相加；该 `29` 是当时完整 backend `941` 的子集。
- A84C 快照专用 empty tempfs PostgreSQL 已按 `15.19` 启动并真跑 18 份既有迁移，`exit 0`；主控随后
  完成精确 container ID、双 owner 与 `127.0.0.1` 核验，stop `exit 0`，并验证
  `auto-remove=true`，资源不再保留。
- A84C 快照实际 SDK 为 `livekit-agents 1.6.10`，`pyproject.toml`、`uv.lock`、`requirements.txt`
  与 installed 四处一致，该快照无需升级或安装。旧 A84 的 `livekit-agents 1.4.3` 只属于更早的
  历史快照。A84C 快照三个 STT/LLM/TTS role 为 `10s / 3 / 2s`，独立不可恢复错误阈值仍为 3；窄适配器每次
  创建全新 SDK 选项，真实 entrypoint 通过零参数 wrapper 延迟读取快照时 `AgentSession`，通用
  orchestrator 注入合同未改。
- A84C 快照冷导入使用当时生产零参数 factory。在合法且各 role 不同的 Catalog 替代快照下创建 2 个
  未 start 的 SDK Session，真实公开 `conn_options` 的 9 个 role 字段与独立错误阈值均正确；两个
  对象隔离，修改第二个不污染第一个，当时 `AgentSession` 绑定被实际消费，`finally` 已关闭全部
  Session，asyncio 任务回到基线；真实 App 的 config/database 未被导入。
- 网络证据须区分能力探测与服务连接：导入 `urllib3._has_ipv6` 时曾有 1 次 `bind(::1, 0)`
  能力探测被拒；两次探针审计计数归类失败 `exit 1` 均保留，根因已由调用栈和本机源码证明。
  分阶段审计显示 Session 构造/关闭阶段零新增 IO，全程零 outbound connect、DNS、send、
  `Session.start` 与真实 dotenv 读取；正向 probe `exit 0`。不能把上述 1 次被阻断能力探测写成
  0 次“导入联网尝试”，也不能把它混同 0 次服务连接。
- 旧 7 个变异继续绑定历史回执。主控已逐个实核其原始 `check.log` SHA、kill marker 与变异前后
  源码指纹，并写
  [A84C-historical-mutations-verified.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/A84C-historical-mutations-verified.json)；
  这些结果仍只属于历史，不与 A84C 快照新增两项变异混算。A84C 快照只针对 `agent.py` 当时变化新验 2 个私有
  入口变异：删除 `conn_options` 被 `POLICY_CONSUMPTION_FAILED` 杀死；捕获旧构造绑定被
  `DYNAMIC_BINDING_FAILED` 杀死；两者均 `exit 1`，源码未改。
- 与旧
  [audit-r0.json](/Users/sunpcm/code/EchoTalk/.review/reports/workflow-eval-r2/a84/reviewer/audit-r0.json)
  逐文件比对，A84C 快照的 Catalog、session policy 和三份相关测试共 5 个源码/测试文件 hash 不变；
  `agent.py` 只多日志脱敏 import 与入口调用 3 行，Session factory 边界 AST 未变。
- A84C 快照的真实 Provider、IdP、
  LiveKit/Worker、设备、远端新 CI、生产部署和 RF-12 前置仍未由此关闭；RF-10 整项继续未勾选。
  独立Review/提交发布见主控同卡回执，用户Review待。

### RF04E 已有远端 CI 证据核对（2026-11-14 历史快照）

- 只读基线：worktree 为 `/private/tmp/echotalk-b1-implementation-20261112`，分支
  `codex/B1-learning-events-20261112`，起始 HEAD `4ec1a4d2c89ec453a833bb06034e6a806e0c9ee1`；
  文档写入前工作树 clean。`42c61bb`、`6bda2cd`、`ef6cb53` 是历史 main push attempt 1，
  `5c28e1b` 的 #128 聚合失败是可核实的历史反证；完整远端矩阵与来源链接集中在
  [CP-06 CI 质量门禁验证](./verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。
- 原始 R0 的完整 13 项本地门禁中 12 项 `exit 0`，`e2e` 为 `exit 1`，聚合也为 `exit 1`。Vitest
  为 `1206 passed / 49 files`；backend 为 `941 passed / 3 warnings / 0 skip`，原生 coverage JSON
  的 `percent_covered=81.55505107832009`，记为 `81.56% raw coverage`；build-script `47`、Fake API
  `116`、API 类型 runner `8`、非 native iOS Node runner `37` 均通过；lint 为
  `132 warning / 0 error / 0 new`，逐诊断与父基线精确相同。
- 首轮全量双浏览器 E2E 为 `245 passed / 1 failed / exit 1`，配置为 `--retries=0 --workers=1`。
  失败是 Chromium 的 `a11y-focus-touch.spec.ts:86`，第 93 行实际 `seen.length` 为 `5 < 6`。
  `error-context` 中七天区块仍为 loading；该当时快照尚未证明其与环境、产品或历史回归原因的关系，
  本轮不修改产品、源码、测试或断言。
- 追加的 `retain-on-failure` trace 零重试完整双浏览器 E2E 已结束 `exit 0`：原始 JSON 主控机器核验
  为 `246 passed`（Chromium `123` + WebKit `123`）；失败、跳过、flaky 和 retry 均为 0。每个
  test 恰有 1 个 passed result；诊断运行全局 `workers=1`，两个 project 的 `retries=0`。证据为
  `RF04E-e2e-diagnostic-results.json`、`RF04E-diagnostic-verified.json` 与
  `ev/ev-RF04E-e2e-diagnostic-full.txt`。这是追加诊断，不覆盖原始 R0 的 `245 passed / 1 failed`
  与 `exit 1`；该诊断当时未复现焦点失败，原因也仍未证明，不能写成已修复。
- RF04E 快照专用 empty tempfs PostgreSQL 已由主控核验精确 container ID、两个 owner 与 loopback 后停止，
  `stop_exit=0`，并确认 `AutoRemove=true`；683 份保护文件未改。该保全与其余 12 项门禁成功都不能
  覆盖原始 E2E/聚合 `exit 1`，因此该历史快照的本地结果不能概括为全绿。
- 原始证据保留在
  `/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/ev/ev-RF04E-full-e2e.txt`
  及同目录对应聚合记录；追加诊断证据见上述三个文件。远端历史正向 run 不复用本次本地失败，也不
  把本次失败写成远端 CI 结果；
  本轮核对时的起始树 `4ec1a4d` 的 run count 为 `0`，required check、PR fail-block 与真实
  Provider/IdP/LiveKit、设备、生产链路仍未验。最终 Review 与提交/发布见主控同卡回执；
  用户 Review 待。
- CF20 根因与验证转入下方独立历史快照；本段继续只绑定原始 R0 的 `245 passed / 1 failed` 与追加
  诊断的 `246 passed / 0 failed`，两者均不概括 CF20 快照的定向稳定性或完整 E2E。

### CF20 Chromium 焦点就绪竞态回归（2026-11-14 历史快照；最终 Review/发布见主控回执）

- 主控受控对照确认根因是测试就绪竞态：`weekly-progress` 请求 held 时七天区块保持 loading，
  原焦点遍历稳定得到 `5 < 6`；同一请求放行后 7 个日期按钮真实挂载，焦点序列为 `12`、包含
  “文档对话”且没有不可见焦点。`CF20-regression-RED-ports-clear` 的 3 次 Chromium RED 均在
  原 `seen >= 6` 处失败，`0 skip / 0 retry / exit 1`。更早的 `CF20-regression-RED` 因端口占用
  得到 0 tests，保留为执行失败记录，不混入任何正式通过数；占用者没有直接证据，保持未知。
- 本卡只读基线为 worktree `/private/tmp/echotalk-b1-implementation-20261112`、分支
  `codex/B1-learning-events-20261112`、base/HEAD
  `c5f9c7274ac85f6fb77212b8944c97e6edae41df`。仓库写集恰为 `TODO.md`、
  `apps/vite-app/e2e/a11y-focus-touch.spec.ts`、`docs/PROJECT_STATUS.md` 与
  `docs/history/todo-done.md`；不沿用上方 RF04E 历史快照的 base。
- CF20 快照实现只改 `apps/vite-app/e2e/a11y-focus-touch.spec.ts`，新增共享
  `waitForDashboardWeeklyProgress` 及其唯一 `toHaveCount(7)` 等待。正常 dashboard 用例与受控慢
  请求用例共同消费该 helper；慢请求用例在请求 held、真实 UI 往返完成后先证明 `ready === false`，
  再显式放行请求、等待 helper settle，随后原样执行 `tabThrough` 和原三条焦点断言。没有固定
  sleep、`test.step`、第二份 count7、产品 instrumentation 或算法变更；原共享 `openDashboard`
  和 Fake API 数据未改，weekly-progress route gate 是本次回归明确新增。
- 主控在私有副本只删除共享 helper 内唯一等待；Chromium 3 + WebKit 3 共 6 次均在
  `expect(ready).toBe(false)` 得到 `true`，`retry=0 / exit 1`，跟踪 spec 未变。该变异证明回归
  依赖真实异步就绪契约；`finally` 对正常路径和变异路径均幂等 release 并收束 readiness。
- 正式 `CF20-stability-20` 机器核验为原焦点与慢请求两个用例在 Chromium、WebKit 各重复 20 次，
  共 `80 passed / 0 failed / 0 skip / 0 flaky / 0 retry / exit 0`。每个 test 恰有 1 个 passed
  result；两个 project 均为 `repeatEach=20 / retries=0`，全局 `workers=1`。运行期间 spec 冻结
  hash 全程一致。
- 完整双浏览器 E2E 机器核验为 `248 passed = Chromium 124 + WebKit 124`，
  `0 failed / 0 skip / 0 flaky / 0 retry / exit 0`；每个 test 恰有 1 个 passed result。证据为
  `CF20-full-e2e-results.json`、`CF20-full-e2e-verified.json` 及对应主控日志。
- frontend 强制 lint、typecheck、build 均 `exit 0`；Vitest 为 `1206 passed / 49 files`，
  build-script `47 passed`，Fake API `116 passed`，API 类型 runner `8 passed`，均 `0 skip`。
  lint 为 `132 warning / 0 error / 0 new`，逐诊断精确等于父基线。
- backend 为 `941 passed / 3 warnings / 0 skip`，本轮实算 raw coverage
  `81.58342792281498%`；非 native iOS Node runner 为 `37 passed / 0 skip / exit 0`。这些数字
  绑定该历史快照的主控回执，不改写上方 RF04E 或 WG20 的历史 coverage。
- CF20 快照专用 PG 已按精确 container ID、两个 owner 与 `127.0.0.1` 核验后停止，
  `stop_exit=0`，并确认 `auto-remove`。原 dashboard 目标 body 去除新增
  `waitForDashboardWeeklyProgress(page)` 调用后与基线逐字等同；683 份保护文件全部未变。
- 该快照完整 13 项门禁及聚合 `exit 0`（后端、前端、浏览器与最终格式分组执行）。
  独立Review/提交发布见主控同卡回执，用户Review待。

### WG20（WebKit 周语法重复稳定性补验）历史快照；最终回执与用户 Review 待

- 只读基线：worktree 为
  `/private/tmp/echotalk-b1-implementation-20261112`，分支
  `codex/B1-learning-events-20261112`，起始 HEAD 为
  `0e69b3fa70dca61d0b8ba9ae7a7d29dc92cda91b`，起始工作树 clean。源码 `354` 文件 SHA 冻结
  未变；`apps/vite-app/playwright.config.ts`、根 `package.json`、`AGENTS.md` 和
  `docs/agent-review-loop.md` 这四个文件分别与父提交中的对应 Git blob 逐字节相同。
- 主控实跑完整 13 项门禁及聚合均 `exit 0`。Vitest 为 `1206 passed / 49 files`；backend 为
  `941 passed / 3 warnings / 0 skip`，原生 coverage JSON 的
  `percent_covered=81.55505107832009`，记为 `81.56% raw coverage`；完整双浏览器 E2E 为
  `246 passed / 0 failed / 0 skip / 0 retry`，其中 Chromium `123`、WebKit `123`
  （`--retries=0 --workers=1`）。Node 构建脚本 `47 passed`、Fake API `116 passed`、API 类型
  runner `8 passed`、非 native iOS 脚本 `37 passed`，均 `0 fail / 0 skip` 且 `exit 0`。
- 目标 WebKit 补验使用该快照 HEAD、macOS WebKit 与 Fake API 夹具，两个周语法用例各重复 20 次，
  共 `40 passed / 0 failed / 0 skip / 0 flaky / 0 unexpected`；所有 `result.retry=0`，每个
  test 恰有 1 个 result，耗时 `52.763s`，配置为
  `repeatEach=20 / retries=0 / workers=1`。未能发现该快照夹具重复失败，不靠放宽断言或增加重试。
- WG20 快照 PostgreSQL 为当时自建 empty tempfs PG `15.19`，仅监听 `127.0.0.1:55433`，18 份迁移
  `exit 0`。精确容器 ID、两个 owner 与 loopback 已核验后停库，停库 `exit 0`，并确认
  `AutoRemove=true`；该快照 PG 已清理，未启动其他卡环境。
- lint 为 `132 warning / 0 error`；逐项诊断与 R213 父基线字节完全一致，新增诊断 `0`。当前失败
  夹具在失败阶段会持续返回 `503`，直到测试显式放行；该快照中 `retry` 等同 `refresh`，认证快照
  变化可能触发额外读取。历史“无重试 5 次失败 1 次”保留，“认证刷新耗掉唯一一次 503”仍是未经
  证明的假说，不能把该快照夹具写成当时唯一一次 `503`。
- 该快照只做补验和文档收口，没有产品修改或源码修复。重复通过只证明该快照 HEAD/夹具在 macOS
  WebKit + Fake API 下的稳定性，不证明历史根因，也不替代真实后端身份、真实 Provider/IdP/
  LiveKit、设备、远端 CI、生产或部署验收。证据位于
  `/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/`：
  `WG20-full-gates.json`、`WG20-repeat-results.json`、`WG20-repeat-verified.json`、
  `WG20-full-coverage.json`、`WG20-lint-comparison.json`、`WG20-pg-ready.json`、
  `WG20-pg-cleanup.json`、`WG20-baseline-source-sha256.json`、
  `WG20-baseline-config-sha256.json` 与 `ev/ev-WG20-*`。最终 Review、提交和推送状态以主控
  回执为准，本文不预填成功；用户 Review 待。

### R2-13（历史快照：组件目录按页面边界归位）本地实施/验收完成；用户 Review 待

- `Dashboard` 已从 `App.tsx` 抽为独立组件，函数体、参数和三行常量初始化保持原逻辑；38 个文件
  按页面边界完成 `git mv`，其中 29 个文件字节不变，9 个仅修改模块路径或目录注释。12 个测试文件
  随之移动，`src` 测试文件保持 49 个一一对应，Vitest、backend 与 E2E 三测试树计数不变。
- Vitest 为 `1206 passed / 49 files`；backend 为
  `941 passed / 3 warnings / 0 skip / 81.56% raw coverage`；双浏览器 E2E 为
  `246 passed / 0 failed / 0 skip / 0 retry / exit 0`（`--retries=0 --workers=1`）。
- Node 构建测试为 `47 passed`，Fake API 为 `116 passed`，API 类型 runner 为 `8 passed`，非 native
  iOS 脚本 runner 为 `37 passed`。lint 为 `132 warning / 0 error`，逐诊断不增；完整 13 项门禁及
  聚合均为 `exit 0`。
- 私有结构检查为 `43/43`，2 个变异均已处理；80 个增改删路径冻结且未漂移。主控独立代码 Review
  为 APPROVED，正式产品返修 `0/2`。
- 本轮未验证生产、真实 Provider/IdP/LiveKit、native 设备或部署；远端 CI 未执行，因为现有 workflow
  仅由 `main`/`master` push 和 PR 触发，本卡不开 PR。提交/推送状态以主控最终回执为准，本文不预填
  成功。旧 docs 历史路径引用保持原样，待用户裁定的生命周期项只同步当前源码路径，不改待裁定状态
  或产品逻辑。

### R2-12（macOS 构建产物与同步脚本）本地实施/验收完成；用户 Review 待

- `build.mjs --platform macos` 生成共享 Vite 静态产物 `dist/macos/<mode>` 与 manifest；
  `sync-macos.mjs` 在调用任何外部工具前校验来源产物、平台和 mode。新增 Turbo 任务把 `ANALYZE`
  显式纳入环境输入并缓存 `stats.html`，同时保留 Vite 的 `ANALYZE` 配置和输出语义。本卡只交付纯
  脚本，不创建 `src-tauri/` 或正式壳，也不确认为 Tauri 选型。
- R1 独立代码 Review 为 APPROVED，8 文件 hash 未漂移；R1 format、quality、build-script 均为
  `0`。build-script 为 `47/47`，其中新增 `26`、`0 skip`；iOS 脚本为 `37/37`；私有控制为
  `26 pass`，`4` 个变异均被杀死。
- R0 其余十个门禁均为 `0`：Vitest `1206 passed / 49 files`，Fake API `116 passed`，API 类型
  `8 passed`，backend `941 passed / 3 warnings / 0 skip / 81.56% raw coverage`，E2E
  `246 passed / 0 failed / 0 skip / 0 retry`，schema、metadata 与 Ruff 均 `exit 0`。lint 为
  `132 warning / 0 error`，逐诊断与父基线相同。
- R0 聚合为 `1`，原因是 Turbo 缓存缺陷；R1 三个受影响门禁聚合为 `0`，按门禁汇总的 13 项均记录
  为 `0`。上述结果不是一次从空缓存开始的完整全零重跑。
- 三种 mode 的实际 TSC/Vite 静态构建均为 `0`；验证使用不带 dotenv 的合成源码副本和公开
  `example.test` 配置，产物 app hash 与 R1 相同。缺 native config 时的实际 CLI 预期为 `exit 1`，
  未调用 Tauri。
- 风险：旧默认 build task 仍使用 `$ANALYZE`；本卡不改，也不宣称旧任务缺陷已复现，缓存策略另行
  复核。
- 当前边界仅为 macOS 静态构建产物和同步前校验。正式壳、Tauri 选型、native 认证、真实设备、
  签名、公证与发布均未创建或验收。提交/推送状态以主控最终回执为准，本文不预填成功。

### R2-14（Compose 系统就绪与一次性迁移）当次快照；用户 Review 待

- 公开 `GET /api/health/system-ready` 不依赖用户身份，只使用共享 PostgreSQL 执行 `SELECT 1`；
  成功为 typed `200 {"status":"ready"}`，连接、查询、超时或释放失败为通用 typed
  `503 {"status":"not_ready"}`。连接 Context 完整释放后才响应；数据库操作预算为 `0.5s`，为当次
  asyncpg 约 `2s` 的 graceful close 留余量，完整响应目标 `<3s`。旧 `/api/health/ready` 的认证、
  用户配置判断和 OpenAPI 语义未改。
- Compose 的 `echotalk-migrate` 使用 API 角色、同一 `DATABASE_URL` 和既有环境边界执行
  `alembic upgrade head`，`restart: "no"` 且依赖 PostgreSQL `service_healthy`；API、Agent、
  analysis-worker 依赖迁移成功，Web 依赖 API `service_healthy`。API healthcheck 使用镜像已有
  Python 标准库和 `ProxyHandler({})` 绕过环境代理，HTTP timeout `4`、容器 timeout `5s`，不嵌入
  Token。完整合同见 [COMPOSE_STARTUP_CONTRACT.md](./COMPOSE_STARTUP_CONTRACT.md)。
- 当次快照的完整 13 项门禁及聚合 `exit 0`；backend `941 passed / 3 warnings / 0 skip / 81.57% raw Total
coverage`，Vitest `1206 passed / 49 files`，Fake API `116 passed / 0 skip`，双浏览器
  `246 passed / 0 failed / 0 skip / 0 retry / exit 0`（`--retries=0 --workers=1`）；build-script
  `21`、API 类型 runner `8`、非 native iOS 脚本 runner `37` 均 `exit 0`；lint 为
  `132 warning / 0 error`，逐诊断与父基线相同。
- Compose 原生 config 与迁移依赖图 `exit 0`，未解析 `env_file`、镜像或启动原整栈。健康探针实际
  Python 命令五类均符合预期：ready `exit 0`，unready、wrong-body、timeout 为 `exit 1`，
  `HTTP_PROXY` trap 被绕过且代理收到 0 请求。独立自有 PG pause 返回 `503`、耗时 `2.518465s`、
  checkedout 为 0；unpause 后 `200`，用户数不变；完整连接释放后再注入异常仍为 `503`。
- 真实路由无 Bearer/错误 Bearer 均 `200`，旧 ready 错误 Bearer 为 `401`。18 份旧迁移 SHA 未变，
  本卡新增 migration 为 0。源码 10 文件与主控
  `R214-R1-code-frozen-sha256.json` 逐项一致。
- 缺 route 的初始 backend `6 failed / 0 skip / exit 1` 是功能实施前的有效 TDD RED（当时新功能
  尚未实现，尚未进入真实 PG 故障验证）；`ModuleNotFound` 导入错误、延迟 `IncludedRouter` 的
  route 枚举及 format 问题属于夹具/格式。R0 真实自有 PG pause 在 4.5s 外层请求超时且未返回
  `503`，是有效产品失败证据；R1 新增的约 2s-cleanup 模拟用例在 3.5s 硬期限命中，是模拟回归
  RED；随后 R1 真实自有 PG pause 以 `2.518465s` 返回 `503`，为成功验证。R2-14 正式产品返修
  使用 `1/2`；最终 Review/发布见主控同卡回执，用户 Review 待。

以下 A6 Linux 测试基线继续作为已合并历史快照，绑定代码
`87e0fd5432fe649e3ee91e8851c61c7d281986cc`：
[CI 43180144291](https://github.com/sunpcm/EchoTalk/actions/runs/43180144291) 与
[PR Guard 43180144203](https://github.com/sunpcm/EchoTalk/actions/runs/43180144203) 六项成功。
主控已亲读原始日志；后续仅 Markdown 归档，最终 head 的门禁与合并回执见 PR。

| 测试树 / 门禁  | A6 历史快照（本轮 B1 结果另见下文）               | 日志     |
| -------------- | ------------------------------------------------- | -------- |
| Vitest         | 1206 passed（49 个文件；含原 45 项契约）          | frontend |
| Playwright E2E | 234 passed（0 skip、无 retry）                    | frontend |
| Fake API 契约  | 108 passed                                        | frontend |
| API 类型生成器 | 8 passed                                          | frontend |
| 构建脚本       | 21 passed                                         | frontend |
| backend pytest | 809 passed，3 warnings，80.19% 覆盖率（59% 门禁） | backend  |

表内旧计数只绑定 A6 历史快照，不能与下方 B1 本轮结果混用；两者都不能代替真实 LiveKit、
第三方 Provider、真实 IdP、iOS/macOS 设备或生产部署验收。
命令见 [Agent 评审手册 §2 与 §20](./agent-review-loop.md)。

历史基线继续按快照绑定：B1 source `3b418e8` 的 [CI run 43152122060](https://github.com/sunpcm/EchoTalk/actions/runs/43152122060)
与 [PR Guard run 43152122194](https://github.com/sunpcm/EchoTalk/actions/runs/43152122194) 为 Vitest
1161/45、E2E 234、pytest 809/80.19%、Fake API 108、类型生成器 8、构建脚本 21；PR #140 head `ed3ac8ba` 的 Fake API 为 75 passed；A3 原 head
`437f6ff8` 为 103 passed；修正提交 `45e5212` 的本地快照为 108 passed，但本机 macOS E2E
为 233/1，Linux ARM64 两轮为 233/1、232/2，均不能计为通过。这些记录只属于各自快照，
不替换上表绑定 A6 代码 `87e0fd5` 的 Linux CI。

### A3（Fake API 契约校验，PR #141/#147）合并收口

Fake API 的成功响应与缺失 operation 受仓内 OpenAPI 校验，既有偏差精确固定；A3 该轮为 108 项
通过；历史 B1-4 Fake API 为 `110 passed / 0 skip / exit 0`，历史 B1-5 为
`113 passed / 0 skip / exit 0`，见本文
[B1 小节](#b1学习事件台账与-wph-历史收口快照用户-review-待)。
最终实现 source `b1d3756` 合入 `main@a7841b7`，文档后由PR #147收口；历史及偏差清单见归档。

### A4a（只读 data 层，PR #149）合并收口

最小 controller/hook、契约及45项独立契约测试已合并；未引入依赖。默认键补修的三项官方
RED→GREEN与私有7探针证据见历史。source `250a582` 六项CI后合入整树一致的 `main@3daa0a4`。

### A4b（WeeklyGrammar 数据查询迁移，PR #151）合并收口

组件仅渲染与 retry 转发，认证、生命周期、请求槽与 timer 移入 data controller/hook；原
JSX/文案/ARIA/class 和 146 个测试/fixture/config 文件保持不变。原 WG14、data45、全量
Vitest1206/49、Linux E2E234（0 skip/retry）与 pytest809/80.19% 通过；三处真实变异均被原 WG
断言捕获。最终 source `7659808` 六项 CI 后合入 `main@2598867`。真实服务/设备边界仍未验证。

### A4c（WeeklyProgress 数据查询迁移，PR #152）合并收口

两个 controller 共用一套订阅；原 WP31、data45、146 份测试/fixture/config 与界面 AST 保持。
主控全量 Vitest1206/49、六项 CI、Linux E2E234（0 skip/retry）、pytest809/80.19% 通过；
额外 React/jsdom 探针6/6，认证 revision、重复 cursor、日窗口下界三处变异均被原 WP 断言捕获；
最终 source `d47c3aa` 的 CI `43162885071` 与 PR Guard `43162885101` 成功后，以整树一致的
`main@5c7ab36` 合入。只做行为等价抽取，未改变依赖、HTTP、数据库或外部服务边界；
真实服务/设备仍未验证。

### A4d（DailyProgress 数据查询迁移，PR #153）合并收口

保留单套认证/lifecycle/午夜+100ms、原读取时点与summary+rows原子发布；146原测试/渲染AST不变。
私有8行为/4重入、4原DP变异、1206/49、Linux234、pytest809/80.19%通过；source130bbb6六CI后合入整树一致maina1afaca。真实服务/设备未验。

### A4e（ActiveSessions 只读迁移，PR #154）合并收口

Data controller持有分页/请求归属/tombstone，UI/写流程/单订阅中枢与146原测试逐字保全。
R1统一内部cursor，取消/失败组合的两项回归RED→GREEN；主控9项、补充13项/DP6与3原AS变异通过。
代码fb47cf4六CI原始日志确认1206/49、Linux234零skip/retry、pytest809/80.19%、108/8/21。
最终b69c527六CI通过并已真实合入；本机233/1仍为既有WebKit高度差异，不计为通过。

### A6（分层依赖门禁，PR #155）代码验收完成

零依赖error规则落实三组禁止边；用户清理整体移至store，四份完整AST仅import/mock路径规范化后相同，
其余144份测试/fixture/config逐字保全。真实依赖7→0，主控22项、补充19项及真实逆向import失败验证通过。
force lint/typecheck/build零缓存、1206/49及上述六CI通过；全批冷启动总审APPROVED。
重构前后7份构建产物逐字节相同；无用户行为、HTTP、文案、依赖或数据库结构变化。
额外本机首轮全量232/2仍记失败：已知WebKit336×23px及一次DocTalk标题未出现。旧新普通/8会话预置
合计80次零重试定向均通过，旧新完整重放各233/1、DocTalk均通过，唯一失败仍为上述高度；
首次232/2独立保留为P2待查观察，根因未明，不归因基线、环境或本卡回归，本机全树均不计通过。
真实Provider/LiveKit/IdP、设备与生产环境未验；B1-1 已交付 ORM、新增迁移、schema 回归与
worker head fixture 适配，最终本机门禁和专用合成 PostgreSQL 结果见本文 B1 小节。

### A5（导航切片，PR #148）合并收口

导航与会话切片组合在同一原子容器，未引入Router；18文件的340个case与1624个expect相关调用
AST保持。最终source `ae13222` 六项CI后合入 `main@0ea16a4`，详细过程见历史与验证文档。

### B1（学习事件台账）与 WPH 历史收口快照；用户 Review 待

**WPH 历史快照（2026-11-13，后续 R2-14 之前）：** B1-5 之后的独立小修复已恢复设置抽屉三个
Provider select 的
44px 触控高度与可靠可见焦点。真实 RED 为 Chromium `7 passed`、WebKit `7 failed`，定向 GREEN 为
`14 passed / exit 0`；该轮修复后完整双浏览器 E2E 为
`246 passed / 0 failed / 0 skip / 0 retry / exit 0`，完整 backend 为
`934 passed / 3 warnings / 0 skip / 81.45% / exit 0`，Fake API `113 passed / 0 skip`。该轮全部
13 项完整门禁及聚合均 `exit 0`；
Chromium/WebKit 最终检查均为三个控件各 `336x44`、`appearance:auto`、2px solid outline。主控
代码/测试 Review 与真实截图 Review 均 APPROVED，P0/P1 未关闭为 0，正式返修 `0/2`。整卡 Review
与提交/推送以同卡最终回执为准；用户 Review 待。上述 backend/Fake/E2E 数字只属于 WPH 当时
快照，后续 R2-14 的当次快照见上方 R2-14 小节。

历史交付：B1 新增并独立归档 `docs/LEARNING_EVENTS_DESIGN.md`，当时定义只追加事件、Job 写入
幂等、合成结果排除、`knowledge_states` 重算校验、来源关系、保留选项及一条以
`c06_transcript_events` 为父 revision 的 Markdown Alembic 草案。主控完成设计审阅并 APPROVED；
Python 草案经 `ast.parse` 成功，父 revision 已核对存在。PR #150 的六项 CI 已通过，原始日志确认
Vitest 1161/45、E2E 234、pytest 809/80.19%，且已合入 `main@4ee8b35`。该段只描述当时的设计
交付，不表示表、代码或迁移已经实施。

2026-11-12 用户已确认七项政策：以 `legacy_unknown` 保存切换基线并明确旧趋势不可恢复；旧
`pending` 和可重试 `failed` Job 切换后走新事务且不回填成功旧 Job；存续期保留明细且不设固定
TTL/快照裁剪；本平台整账号注销硬删业务库事件、转录、分析和派生状态，不匿名化、不操作外部
IdP、不增加单会话删除；本人结构化 JSON 导出保留来源/合成/版本并排除密钥、内部提示词和
Provider 完整原始响应；本版不开放成功后的重新分析；现有四参数冻结为 `bkt-v1` 且新版本不改写
旧事件。备份/法定特殊保留的生产方案和音频采集仍另批处理。

主控已在专用合成 PostgreSQL 中重放现有迁移至 `c06_transcript_events`，并验证以下历史基线：
Vitest 1206 passed/49 files、backend 809 passed/3 warnings/80.19%、Fake API 108 passed、
类型生成器 8 passed、构建脚本 21 passed 且相关命令均 exit 0；本机全量 E2E 为 233 passed/
1 failed、exit 1，唯一失败是既有 WebKit select `336×23 < 44`。上述旧数字只属于该历史基线，
不与本轮新增结果相加或替代。
**历史 B1-1** 随后完成 RED（主控实跑 4 failed/0 skipped、exit 1）并新增 `LearningEvent` ORM/注册、
`b1_learning_events` 迁移与 schema/约束回归；两个 observation 分支兼容 `model_version=NULL`，
16 个旧迁移未改动。主控随后在本轮专用合成 PostgreSQL 完成空库 upgrade 至 b1、PG schema
GREEN `4 passed / 0 skip / exit 0`、current/downgrade 回 c06 后清除表/索引/identity、reupgrade
至 b1 exit 0，以及独立真实 PG 与 ORM 元数据 compare 零差异 exit 0。ORM 的 `idempotency_key`
唯一约束与 migration 同名一致；`algorithm_params` 使用 `JSONB(none_as_null=True)`，将 Python
`None` 绑定为 SQL `NULL`。既有 worker PostgreSQL fixture 原固定 `c06_transcript_events`，主控实跑
得到 `1 error` RED 后，已改为读取仓库 Alembic 源码 `get_current_head()` 并严格比较数据库
`alembic_version`；原 DB/user/PG15.19/DSN guard 不变。

**历史 B1-2** 已实现同事务事件写入、幂等、用户锁与 BKT 合成隔离，主控独立代码 Review 结论为
APPROVED。历史 B1-2 专用合成 PostgreSQL 目标套件为 `116 passed / 0 skip / exit 0`；完整 backend 为
`844 passed / 3 warnings / 0 skip`、覆盖率 `80.82%`。Vitest `1206 passed / 49 files`、
build-script `21`、Fake API `108`、API 类型生成器 `8` 均 `exit 0`；强制 lint/typecheck/build
`exit 0`，lint 为 `132 warning / 0 error`；Ruff 格式/规则、schema 与 metadata 导出校验均
`exit 0`。15 项完整门禁中 14 项 `exit 0`，Chromium+WebKit 零 retry 为
`233 passed / 1 failed / 0 skip / exit 1`，唯一失败仍是与既有基线相同的 WebKit Provider select
`336×23 < 44px`，DocTalk 通过，不能称本机全树全绿；聚合入口 `exit 0` 不表示 E2E 通过。

独立探针确认用户锁、实际 `apply_seq` 相反观察、原始 ordinal、缺观察拒绝、未知模型 `NULL`、
不复制 alignment、三类完成冲突，以及 10 条观察/3 个知识状态/知识状态单次读取/unmapped 计数均
`exit 0`。17 个既有迁移字节未改动。B1-0 的 `809 passed / 80.19%` 和 B1-1 的 `813` 是历史基线；
历史 B1-2 backend 为 `844 passed / 80.82%`，历史 Vitest 为 `1206 passed / 49 files`。

历史 B1-3（当时）的代码/测试 Review 由主控独立审阅为 APPROVED，目标套件为
`147 passed / 0 failed / 0 skip / exit 0`；完整 backend 为 `878 passed / 3 warnings / 0 skip`、
覆盖率 `80.51%`、exit 0。Vitest 保持 `1206 passed / 49 files`，Fake API `108`、构建脚本 `21`、
API 类型测试 `8`，lint 为 `132 warning / 0 error / 0 new warning`；除 E2E 外所列完整门禁均
exit 0。前端自 `f6007a2` 未改，前端/Fake API/契约/配置均未改。代码 Review 通过不代表完整 E2E
或用户验收通过。

历史 B1-3 E2E 首轮为 `232 passed / 2 failed / 0 skip / 0 retry / exit 1`，失败分别是 WebKit Provider select
`336×23 < 44` 与 WebKit readiness 引导 textarea 超时；随后 DocTalk 定向为
`3 passed / 0 failed / 0 skip / 0 retry / exit 0`，再次全量为
`233 passed / 1 failed / 0 skip / 0 retry / exit 1`，DocTalk 通过、只剩同一 WebKit Provider
select 失败。首轮失败与 DocTalk 定向结果均保留；DocTalk 首轮失败原因未确认，不能归因于环境、
历史基线或回归，也不能把最终 E2E 写成全树全绿。

新迁移 `b1_learning_event_cutover` 在专用合成 PostgreSQL 中 upgrade 至该 revision、downgrade 回
`b1_learning_events`、reupgrade 与 roundtrip 均 exit 0；既有事件保留，ORM 与真实 PG schema compare
零差异，既有 17 份迁移与执行到的 18 份迁移 pin 均未变。门控、整包快照、只读、CLI 导入隔离及
八项既往回归缺口探针退出符合预期；READ COMMITTED 反例 mutation 被杀死。早期 R2 的 8 个失败中有
4 个是 fixture 状态缺失错误，修正冻结 R1 的合法 fixture 后才形成 8 个真实目标失败；
10 deselected、exit 1 的 RED 历史不应被写成原先 8 个均为语义 RED。

五阶段切换期间，实际 Job 领取函数 `claim_next_job` 本身没有 gate，因此全部新旧 worker 必须保持
停止到 `traffic_resumed`。部署代码只提供门控，不会启动 worker；显式停写声明、数据库锁和表锁
都不能证明未知旧进程已退出。CLI 只接受已批准的合成库白名单，不隐式读取 `.env`，结果码/用法按
0/1/2 区分；baseline 默认 preview 零写，只有显式确认参数才进入写入事务。零语法错误没有持久来源
行，校验只能检查 coverage 结构与类型，并在来源存在时比对事实，不能独证“零错误”或虚构 Provider
事实。

**历史 B1-4** 的本人数据结构化 JSON 导出已实现，主控独立代码/测试 Review 为 APPROVED，产品返修使用
`1/2`；用户 Review 仍待。下列结果均由主控代跑，实施节点没有冒领测试或数据库执行。初始 backend
基线为 `878 passed / 3 warnings / 0 skip / 80.51% / exit 0`；首轮 RED backend 为
`10 failed / 0 skip / exit 1`，首轮 RED Fake API 为 `106 passed / 4 failed / 0 skip / exit 1`。
R1 非有限值 RED 为 `9 failed / 11 passed / 0 skip / exit 1`，覆盖真实 PG/HTTP 六例和全部 10 个
float 字段的模型矩阵；修后目标为 `20 passed / 0 skip / exit 0`。完整 backend 为
`898 passed / 3 warnings / 0 skip / 80.86% / exit 0`，20 项目标是 898 项的子集，不能相加。
Vitest 为 `1206 passed / 49 files / exit 0`，Fake API 为 `110 passed / 0 skip / exit 0`，构建脚本
为 21、API 类型测试为 8、均 exit 0。format、lint、typecheck、build、backend Ruff format/lint、
OpenAPI schema、provider metadata 和 TS 漂移检查均 exit 0；lint 为 132 warnings/0 errors，warning
行清单与 B1-3 相同，无新增。

完整双浏览器 E2E 的原始结果必须保留为
`233 passed / 1 failed / 0 skip / 0 retry / exit 1`。唯一失败是
`[webkit] e2e/a11y-focus-touch.spec.ts:94:5`：设置抽屉三个 Provider select 为
`336x23 < 44px`，断言位于第 127 行。对应 UI/样式、E2E 用例/配置相对父提交未改，保留同名范围外
遗留；不能归因于未经证实的环境原因，也不能称全树全绿。`run-gates.py` 会容忍 `e2e=1` 并返回 0，
因此聚合 exit 0 不能代表真实 E2E 通过，也不能覆盖原始 exit 1。

专用 `postgres:15.19-alpine` 使用 `127.0.0.1:55433/echotalk_b1_test`。主控从空库重放 18 份既有
迁移成功，迁移字节不变且没有新增 DDL。API 仅新增 `GET /api/user/data-export` 和 13 个 Pydantic
schemas；旧 OpenAPI path/schema 逐值未变，A3 固定的 missing/unmodeled/deviation 清单逐字未改。
OpenAPI 与 TypeScript 由主控原生生成器产出，生成物本身不替代 Fake API 成功响应契约。

导出响应固定 `schema_version=1`，只含 `schema_version`、`exported_at`、sessions、transcripts、
pronunciation assessments、grammar assessments、learning events 与 knowledge states。各节显式
白名单排除密钥、认证身份、内部 prompt/文档、音频、Provider 完整原始响应/引用、幂等键及未列明
字段；Session 仅保留解释子记录所需的最小元数据。独立导出会话使用单一
`REPEATABLE READ READ ONLY` 快照，不复用认证调用方事务，也不通过强制提交 auth 事务解决首次用户
映射；本人空导出仍正常返回空数组。服务验证 Event/Session、Event/AnalysisJob/来源评估及 Skill
关系，并只读取本人数据；空数据返回空数组，部分数据不补造，未知版本保留 `null`。NaN/±Inf 等非有限
float 失败关闭，合法 `None` 保留 `null`。完整模型构造后整体缓冲序列化，成功响应仅带 JSON、
`no-store`、固定附件名和 `nosniff`；失败返回无成功/下载头的通用 500。

主控独立探针确认六类 Job/来源跨归属失败关闭、真实 SQL 列白名单、服务端只读事务拒写、事件与
knowledge state 同快照、后段查询失败无成功头，以及 dev Bearer 缺失/错误和首次映射用户空导出。
READ COMMITTED mutation 被真实并发后提交事件泄漏断言杀死，产品文件未变；修后非有限值探针均为
500 且无下载头。同步导出会完整缓冲在内存中，内存占用和快照持续时间随账户数据增长；本卡没有新增
阈值、分页、异步任务、UI 或真实依赖。

**历史 B1-5（当时）** 已实现本平台整账号硬删除。`DELETE /api/user/account` 仅使用 Bearer 映射的本人 ID，
先完成无业务库读取的身份验签，再取得 learning-event control gate，最后复用同一身份完成本地 User
映射/flush。服务在调用方同一事务显式删除 12 类本人数据：users、user_profiles、user_settings、
sessions、transcripts、session_contexts、analysis_jobs、pronunciation_assessments、
grammar_errors、learning_events、knowledge_states 和 call_leases；全局 skills、控制行及其他用户
数据保留。成功固定返回 `200 {"status":"deleted"}` 且只在 commit 完成后发送；异常整体 rollback，
日志和正文只保留通用错误。重复删除幂等，旧 Job、stale recovery、worker 与晚到写入不能复活数据。

删除前验证原控制数量、摘要、canonical baseline 与跨归属关系，坏数据失败关闭，不通过删除或
`SET NULL` 漂白。删除合法 baseline 后按剩余真实事件更新全局数量/摘要，保留 singleton、revision、
cutover_at、phase 和既有 gate；无 control 时用 SREX 表锁封闭 prepare 窗口，不重新从
`knowledge_states` 锚定。`claim_next_job` 本身仍无 gate，全部新旧 worker 必须保持停止到
`traffic_resumed`；部署代码、数据库锁和表锁不能证明未知旧进程已经退出。

主控当时实测 B1-5 目标为 `36 passed / 0 skip / exit 0`，完整 backend 为
`934 passed / 3 warnings / 0 skip / 81.64% / exit 0`，36 项是完整树子集，不能相加。Vitest
`1206 passed / 49 files`，Fake API `113 passed / 0 skip / exit 0`，build-script 21、API 类型 8、
iOS 脚本 Node runner 37 均 exit 0；lint 为 `132 warning / 0 error`，warning 行清单与 B1-4 逐行
相同。独立合成 PG 正常探针覆盖 12 表删除/他人逐值保留、坏 baseline、跨 user lease、双删除、
首次 cutover、真实 Bearer、未链接旧 User 和 worker 锁序；两项运行时变异被真实 count/死锁断言
杀死。临时 PG 已停止并自动移除。

第一次完整 format 按原始事实返回 exit 1，唯一问题是 `apps/vite-app/scripts/fake-api-test.mjs`；
该文件与六份收口 MD 已由现有 Prettier 纯格式化，主控仍须补跑完整 format 后以最终回执为准。
OpenAPI/TypeScript 只新增 DELETE path 和一个响应 schema，旧 path/schema 逐值未变；18 份既有迁移
字节未变，无新 DDL、依赖、产品 UI 或 workflow。主控代码/测试 Review 为 APPROVED，产品返修使用
`1/2`；用户 Review 仍待。B1-0～B1-5 已完成本地实施与完成项归档，不启动下一卡。提交/推送状态以
同卡最终交付回执为准，当前不预填 SHA；不开 PR、不合并、不部署。生产 DDL/切换/部署、真实数据、
真实不可恢复删除、真实 Provider/LiveKit/IdP/设备、原生 iOS、远端 CI、备份与法定/特殊保留均未
验收。仓库 CI 仅在 `main`/`master` push 与 PR 上触发，任务分支 push 不触发远端 CI。设计与完成记录见
[`LEARNING_EVENTS_DESIGN.md`](./LEARNING_EVENTS_DESIGN.md) 和
[`history/todo-done.md`](./history/todo-done.md)。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、生产 Compose rollout、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，
  避免运行时安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，
  并在运行 E2E 前核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- R2-12 本轮前端 lint warning/error 数量与 R2-12 小节一致，主要是 `Unexpected any`。
- 输入框与卡片边框对比度约 1.2，低于非文字组件 3.0 的要求；会话中界面的 LiveKit 控制条未在真实连接下验收。
- 历史 B1-5 的完整双浏览器 E2E 当时为
  `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败是设置抽屉三个 Provider select
  的 `336x23 < 44px`；该历史快照及当时范围外判断继续保留。后续独立 WPH 已完成修复，其历史快照
  与 R2-14 当次快照的 E2E 数量分别在各自小节集中记录，不能把这些后续结果回写成当时已通过。
- Compose 的一次性迁移、公开 system-ready 和容器依赖门控已经形成本地合同并通过原生 config、
  HTTP 探针和独立自有 PG 验证；原 Compose 整栈、镜像、真实 `.env`、生产 rollout、真实
  Provider/IdP/LiveKit 与设备未验收，不能把本地门禁写成生产就绪。
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
