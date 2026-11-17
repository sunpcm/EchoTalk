# EchoTalk 当前状态

> 最后核对：2026-11-17。本页以 main `da37683e6579e479f0ab46315555b24c850360da` 的精简状态页为骨架，
> 并入 B1 `46ef95494b23c3dcdc05a0ddbc18f03856c2462e` 已验收的功能事实。SGEC-OFF 已通过 PR194 合入
> main `d33f236`；真实 Provider、BKT、人工 gold 与教学质量仍未验收。未完成与待决策事项只在根目录
> [`TODO.md`](../TODO.md)。
>
> PR #197 / RC1 的完整 E2E 322（Chromium 161 + WebKit 161）与更早 main 的 321+1 flaky 均为历史快照。
> CGC 的初始 C0 目标 18、80 次重复与完整 E2E 324 也是前一阶段历史，不能代替 R2 最终结果。R2
> 揭示并修复了 DOM module script 页面执行错误未传给 helper 的问题：错误传播 RED 为
> `4=2 GC pass/2 error reject fail`，补显式 `pageerror` 首错误重抛和本人 listener 卸载后 GREEN
> `20/20`；三个场景在双浏览器各 20 次共 `120/120`，单 result、retry 0、零 skip/flaky，类型/ESLint 0。
> 三变体私有对照使用同一最新 spec，共 `6=4 pass/2 expected fail`：旧 async helper 仅 GC 一项精确
> Promise GC fail，C0 模块 helper 仅错误传播一项报 `resolved instead of rejected`，final helper 两项
> 均 pass；全部 retry 0，源码 SHA 未变。backend 与前端非 E2E 全量的保护输入未变，沿用本卡已实跑
> 结果。完整双浏览器 E2E 为 `326/326 = Chromium 163 + WebKit 163`，每项单一 passed result、retry 0、
> 零 skip/flaky/unexpected，约 5.3 分钟且 exit 0；12 项行为门禁全 0。最终第 13 项 format、独立
> Review、正常 commit/push、PR CI、merge/main CI 与用户验收以主控同卡实际回执为准，本文不自批。
> 两次自建合成库中，初始 55434 为非白名单自建库、最终 55433 为白名单库，均已清理，当前无本卡活动
> PG。
> 技术实现与合成验收完成，不等于人工 gold、真实 Provider 或生产验收；历史表只属各自原时点。
> 最终 format/Review/提交/推送/新 head CI/合并以主控同卡回执为准；本文不自批 Independent Review，
> 也不预填远端 CI 通过。
> B1 的完整历史与逐卡数字只保存在
> [B1 实施历史快照](./history/b1-implementation-2026-11-16.md)。

## 文档职责与更新规则

当前页面维护当前功能、发布时点验证基线、已知限制与历史索引；未完成事项维护在根目录
[`TODO.md`](../TODO.md)，逐轮记录维护在 `docs/history/`。历史计数只属于各自原时点。B1 原始的
完整职责说明与逐卡证据见 [B1 实施历史快照](./history/b1-implementation-2026-11-16.md)。

## 当前功能

| 领域                        | 当前实现                                                                                                                                                                                                         | 状态与边界                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 认证与用户边界              | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离                                                                                                                                  | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收                                                                               |
| 实时对话                    | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                                                                                                                                                | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明                                                                                      |
| 会话生命周期                | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束                                                                                                                             | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭                                                                                     |
| 启动编排（H1）              | 原runStartup抽为延迟ports的factory；同步门禁、动态依赖与cleanup所有权保留，resume未合并                                                                                                                          | 已合并PR174、最终mainCI成功；H1当轮旧测试零改、新15条同层测试及四项有效变异保留，真实依赖仍未验                                                 |
| Room 所有权收窄（A19）      | 移除无用 onRoom/onRoomRef，roomRef 改必传；RoomContextSync 仅在 Room 提交后由 useLayoutEffect 发布引用，替换/退出时清理                                                                                          | B1 da185dc 保持 commit 后发布；初始 Web 快照门禁经审计非泄漏保留，不由 render 阶段直接赋值                                                      |
| 生命周期测试边界（A18）     | 移除产品测试注入 setter 与 start/resume 重复的测试选项 plumbing，测试平台假对象移入 test-only fixture                                                                                                            | 已发布 PR191 main `0422c9e`；平台判定仍经 detectPlatform()，未统一 runner                                                                       |
| 会话分析                    | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态；可替换评估提供方与内部coverage                                                                                                                  | 源码APPROVED R0；仍为文本demo规则，真实发音 Provider 未验收                                                                                     |
| 场景目标                    | 版本化目录；创建事务 catalog/snapshot；append-only run/results；精确 transcript evidence 顺序与 digest；evaluator v2 与确定性四终态；课程 opt-in 预览；owner-scoped GET；受控 pending/running 轮询；无百分比汇总 | PR #197 RC1 修复两个 bot 报告的真实判定问题；目标 87、独立 22 与完整 E2E 322 通过。父项未勾；用户 Review、人工 gold、真实教学质量和生产仍未验收 |
| 契约同源（G3）              | Python单源、离线JSON/TS及调用方引用；9码安全发送、开放接收、5码诊断、5项分析目录、3项人工不可重试                                                                                                                | 已合并PR172、最终mainCI首轮成功；重试与wire语义保留                                                                                             |
| 结果可信度                  | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态                                                                                                                               | 已实现                                                                                                                                          |
| SGEC 纯离线契约（SGEC-OFF） | 严格结构校验 + 固定合成 fixture CLI（validator/CLI/测试/合成 fixture），不接真实 Provider/BKT                                                                                                                    | 已发布 PR194，main `d33f236`；真实 Provider、BKT、人工 gold 与教学质量仍未验收                                                                  |
| 自适应课程                  | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                                                                                                                                              | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务                                                                                        |
| BYOK                        | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast                                                                                                                               | 已实现；密钥轮换和 Provider 连通性需按环境验收                                                                                                  |
| DocTalk                     | 文档输入、Prompt 构建、文档会话入口                                                                                                                                                                              | 已实现 Web 流程；原生端文件选择未验收                                                                                                           |
| 前端体验                    | Dashboard、课程推荐、每日进度、评估反馈、三主题、键盘焦点、44px 触控目标、设置抽屉标题"设置"、活动行可见 ID 前 8 位                                                                                              | 设置可读性已发布（PR179）；装饰卡/全产品 AA、真实设备读屏未验                                                                                   |
| 周度学习                    | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3；可 opt-in 返回“已记录会话时长”                                                                                                            | **部分实现**：已记录时长只表示会话经过时长，不等于有效说话时长；掌握度环比、发音趋势与下周重点未实现                                            |
| iOS                         | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                                                                                                                                                          | 真机全链路、原生登录与发布未验收                                                                                                                |
| macOS                       | macOS 产物构建与同步脚本、`tools/macos-m1-native-probe` 探测工程                                                                                                                                                 | 纯脚本已完成；正式客户端、壳、Tauri 选型、设备与签名未验收                                                                                      |
| 数字人                      | 只有待办                                                                                                                                                                                                         | **未实现**                                                                                                                                      |

## 当前验证基线

以下数字只绑定各自已发布提交，是 main 发布时点基线，不是本次 B1 主集成工作树的新结果。
SGEC-OFF 已通过 [PR194](https://github.com/sunpcm/EchoTalk/pull/194) 合入 main `d33f236`，对应 mainCI
`43818985856` 首五 success；B1 在合入前的候选亲跑、goals 四卡门禁与各历史卡计数只保存在
[B1 实施历史快照](./history/b1-implementation-2026-11-16.md)。

| 测试树 / 门禁       | main 发布时点证据          |
| ------------------- | -------------------------- |
| Vitest              | 1270 passed / 57 文件      |
| Playwright E2E      | 258，actual0，7.4m         |
| Fake API 契约       | 125 passed                 |
| API 类型生成器      | 10 passed                  |
| 构建脚本            | 21 passed                  |
| 完整 backend pytest | 962 / 3w / 80.63% / 59.50s |

PR #197 / RC1 主集成的前端、后端、目标、独立回归、完整双浏览器 E2E 与既有合成门禁已有历史证据。
最终 format/Review/提交、PR、新 head CI、合并与总体放行仍以主控同卡回执为准。所有数字都不能证明
真实 LiveKit、IdP、Provider、设备、数据库生产数据或部署已验收。

### CGC Chromium Promise GC 测试夹具修复（2026-11-17 当前任务）

本任务基线为 `73ab94db07c23f93ec23a56b6cab883b6beb590a`，分支
`codex/chromium-promise-gc-20261117`，只改
`apps/vite-app/e2e/session-flow.spec.ts`、`apps/vite-app/e2e/helpers/show-ended-session.ts` 与
`apps/vite-app/e2e/promise-gc.spec.ts`。根因是 Chrome 151/V8 inspector 以弱句柄持有
`page.evaluate` 的协议结果 Promise；原 async helper 在 Zustand setter 后两层 `queueMicrotask` 处强制
GC 时精确报 `Resulting promise was garbage collected`，UI 原文案仍可见。修复只把 helper 改为由 DOM
加载器持有的 module script，静态导入同一 `appStore`、设置同一对象，并用 `JSON.stringify(sessionId)`
编码；产品源码、公共 Playwright config、CI、依赖和迁移均未改。

| 证据 / 范围       | CGC 当前结果                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| C0 历史（非当前） | 两文件 `18=17 passed/1 failed` 后 `18/18`；unsupported + GC 两个场景 `80/80`；完整 E2E `324/324`。这些均只属 R2 前阶段   |
| R2 RED            | 错误传播用例 `4=2 GC pass/2 error reject fail`；Chromium/WebKit 均报 `Received promise resolved instead of rejected`     |
| R2 GREEN          | `20/20`；真实 `setState` 抛错被 helper reject，成功/失败路径 listener 数量均守恒                                         |
| R2 无重试重复     | unsupported + GC + 执行错误传播，3 场景 × Chromium/WebKit × 20 = `120/120`；单 result、retry 0、0 skip/flaky             |
| 原断言保全        | 原 8 case、35 个 `expect` 与 fixture 保持；GC 由新 spec 包裹真实 `setState` 触发，不进入 helper                          |
| R2 三变体私有对照 | 同一最新 spec `6=4 pass/2 expected fail`：旧 async 仅 GC fail、C0 模块 helper 仅错误传播 fail、final 2/2 pass；retry 0   |
| 静态与保护面      | e2e 显式 TypeScript/ESLint 0、无 disable；三源码/测试精确 R2 SHA；822 个保护文件、3 项 env metadata、20 份旧迁移字节保持 |
| backend           | 保护输入未变，沿用本卡已实跑 `1351 passed / 3 warnings / 0 skip`，raw coverage `81.92254049994635%`                      |
| 前端非 E2E 门禁   | 保护输入未变，沿用本卡已实跑 quality 132 warnings / 0 errors / 0 new；Vitest 1429/73；build 47、Fake 141、API 10         |
| 完整双浏览器 E2E  | `326/326 = Chromium 163 + WebKit 163`；单一 passed result/retry 0/零 skip/flaky/unexpected，约 5.3m、exit 0              |
| 行为门禁          | 机器汇总 12 项行为门禁全 0                                                                                               |
| 合成 PG 清理      | 初始 55434 为非白名单自建库、最终 55433 为白名单库；二者均 `stop 0 / auto-remove`，当前无本卡活动 PG                     |
| 最终交付          | 第 13 项 format/Review、commit/push、PR CI/merge/main CI 与用户 Review 以主控同卡实际回执为准，本文不自批                |

主控私有失败与纠偏均保留在本轮证据，不用最终绿色覆盖：初私有因果 r0 的 oracle 失败、首次私有
TypeScript 检查的路径/扩展配置纠正、lint 两次把 `use` 前缀 fixture 参数误识别为 Hook、以及首次
PG 55434 因不在测试白名单而被拒绝后出现的 `3 fail / 162 error / 1186 pass` 与清理重建。之后 fixture
参数仅局部改名为
`provideLaunchOptions`，逆向 SHA 已证明 helper、原断言和运行逻辑未随之变化。主控最终已清理
两次自建合成库：初始 55434 为非白名单自建库，最终白名单库为
`127.0.0.1:55433/echotalk_b1_test`；二者均为 `stop 0 / auto-remove`，当前无本卡活动 PG。
最终完整双浏览器 E2E 已通过 `326 = Chromium 163 + WebKit 163`，每项单一 passed result、retry 0、
零 skip/flaky/unexpected，约 5.3 分钟且 exit 0；12 项行为门禁全 0。最终第 13 项 format、独立 Review、
正常 commit/push、PR CI、merge/main CI 与用户验收以主控同卡实际回执为准，本文不自批用户验收。

### PR #197 / RC1 合入历史验证（2026-11-17）

以下记录 PR #197 / RC1 合并工作树的历史集成证据，不替代 CGC 当前结果或最终同卡回执；历史表保持原时点数字。

| 门禁 / 范围             | 本轮证据                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| source / RC1            | `backend/services/goal_rules.py` SHA-256 `b8c40614...`；PR #197 修复两个 bot 报告的真实判定问题；evaluator `deterministic-goal-v2` |
| quality                 | 0；诊断多重集 132 warning / 0 error / 0 新增，与 `80df811` 基线完全一致                                                            |
| 前端 Vitest             | 1429 passed / 73 files                                                                                                             |
| backend                 | 1351 passed / 3 warnings / 0 skipped；raw coverage 81.99763973822552%                                                              |
| build / Fake / API 类型 | build 47、Fake 141、API 类型 runner 10                                                                                             |
| 目标判定                | 87/87：67 纯规则 + 20 持久化 worker                                                                                                |
| 独立回归                | 22/22                                                                                                                              |
| 旧 v1 加载负对照        | 75 passed / 12 项具体 AssertionError / 0 error / 0 skip                                                                            |
| 去版本 guard 变异       | 1 selected / 1 项具体 AssertionError；driver 0                                                                                     |
| 完整 E2E                | exit 0；322 = Chromium 161 + WebKit 161；每项单一 passed result、retry 0、0 skip/flaky/unexpected                                  |
| 行为门禁                | 12/12 为 0；四文档后的主控 format 为第 13 项，本文不提前自批                                                                       |
| 合成 PG                 | `stop 0`、`auto_removed=true`                                                                                                      |

RC1 保持旧 pending v1 的 header/evidence 原样，由既有版本 guard 判 `not_assessed`；旧成功 v1 不重判。
goal/material 版本、schema 与 20 份旧迁移保持。旧 v1 加载负对照与去版本 guard 变异均为负向验证，
不是产品失败遗留；两项 driver 均为 0。TDD 的 R0/R1 实际失败、fixture 返修和后续转绿保留在主控本地
证据，不用最终绿色覆盖历史。有效旧门禁变异仍分别杀死 module tracker（5 项失败）、Room render
（1 项失败）、theme guard（1 项失败）与 Compose body（2 项失败）路径；未选中测试不计覆盖。

当前工作树与此前已发布 `80df811` 独立基线必须分开：后者 backend 为 1326 passed、raw coverage
81.7332474226804%，其 [CI run 43908155993](https://github.com/sunpcm/EchoTalk/actions/runs/43908155993)
attempt 2 的五个作业成功。该运行最初一次 mac 容量取消属于资源排队事件，不是代码失败；尝试次数和
五作业结果分别记录，不把历史运行并入当前 head。历史 R2 `307 passed / 15 failed` 与早先 R0 原计划
322 项在约 40 项后受控停止的事实继续保留。

合成 PG 已由主控运行 `ev-RC1-stop-pg` 清理并以 exit 0 结束；同卡回执核验精确 ID、双 owner、
loopback 与合成身份，`auto_removed: true`，其他资源未动。当前没有保留的本轮活动 PG，也没有据此产生
真实数据、真实环境或生产验收结论。v2 通过仅证明确定性规则和持久化生命周期，不证明人工 gold、
真实教学质量、真实 Provider/IdP/LiveKit、设备、部署或用户验收。当前 12 个行为门禁全 0；
四文档后的主控 format 是第 13 项，最终交付状态仍以主控同卡回执为准。

## B1 历史完成卡索引（原时点）

> 以下保留 B1 `46ef95494b23c3dcdc05a0ddbc18f03856c2462e` 原有 H3 标题与锚点，便于既有文档链接继续指向当时事实。每一节只给当前读取所需的边界；
> 完整正文、计数、失败、PG 清理与 Review 回执统一保存在
> [B1 实施历史快照](./history/b1-implementation-2026-11-16.md)。本索引不是合并后新验证结果。
>
> 旧 `FINAL_READY` 显式 ID 只在自然标题 slug 无法兼容时保留，并贴近对应历史小节；
> 不表示相应父项或真实环境验收已经完成。

### G-VIEW 目标预览与结果展示（FINAL_READY）

goals 链在该卡时点的设计、数据层、接线、判定/导出或展示事实已归档；当前父项仍待用户 Review、人工 gold、真实教学质量与外部环境验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#g-view-目标预览与结果展示final_ready)。

### G-EVAL 场景目标自动判定、持久化与导出（FINAL_READY）

goals 链在该卡时点的设计、数据层、接线、判定/导出或展示事实已归档；当前父项仍待用户 Review、人工 gold、真实教学质量与外部环境验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#g-eval-场景目标自动判定持久化与导出final_ready)。

### G-WIRE 首期课程目标与会话创建接线（`FINAL_READY`）

goals 链在该卡时点的设计、数据层、接线、判定/导出或展示事实已归档；当前父项仍待用户 Review、人工 gold、真实教学质量与外部环境验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#g-wire-首期课程目标与会话创建接线final_ready)。

### G-CONTRACT 场景目标实施合同（历史快照；已 `APPROVED` 并发布 `882a1a9`）

goals 链在该卡时点的设计、数据层、接线、判定/导出或展示事实已归档；当前父项仍待用户 Review、人工 gold、真实教学质量与外部环境验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#g-contract-场景目标实施合同历史快照已-approved-并发布-882a1a9)。

<a id="goal-data-goal-a-持久化与合成-pg-数据层final_ready"></a>

### GOAL-DATA goal A 持久化与合成 PG 数据层（历史快照；已 `APPROVED` 并发布 `353e0c9`）

goals 链在该卡时点的设计、数据层、接线、判定/导出或展示事实已归档；当前父项仍待用户 Review、人工 gold、真实教学质量与外部环境验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#goal-data-goal-a-持久化与合成-pg-数据层历史快照已-approved-并发布-353e0c9)。

### HHTTP-CLOSE 历史宿主 HTTP 待办核销（`FINAL_READY`）

只用后来的 host-gateway 合成拓扑核销历史宿主 HTTP 两条记录；原失败文字保留，不代表原 Compose、真实外链或父项通过。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#hhttp-close-历史宿主-http-待办核销final_ready)。

### I18N-DESIGN 正式 i18n 迁移设计（`FINAL_READY`）

该卡保存设计结论与未决业务口径；路线、fallback、指标窗口或历史快照策略仍以用户最新确认状态为准。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#i18n-design-正式-i18n-迁移设计final_ready)。

### GOAL-DESIGN 场景 goals 与 Task Completion 设计（`FINAL_READY`）

该卡保存设计结论与未决业务口径；路线、fallback、指标窗口或历史快照策略仍以用户最新确认状态为准。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#goal-design-场景-goals-与-task-completion-设计final_ready)。

### WR-DESIGN 周报剩余指标设计（`FINAL_READY`）

该卡保存设计结论与未决业务口径；路线、fallback、指标窗口或历史快照策略仍以用户最新确认状态为准。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#wr-design-周报剩余指标设计final_ready)。

### WDI 周报时长真实本地组合补验（`FINAL_READY`）

该卡完成本地组合验证或状态核对，范围仅限原时点的合成/文档证据，不延伸为真实外部链路或当前合并结果。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#wdi-周报时长真实本地组合补验final_ready)。

### TDOC 剩余待办与项目状态核对（`FINAL_READY`）

该卡完成本地组合验证或状态核对，范围仅限原时点的合成/文档证据，不延伸为真实外部链路或当前合并结果。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#tdoc-剩余待办与项目状态核对final_ready)。

<a id="wd-ui-周报已记录会话时长前端显示与浏览器验收final_ready"></a>

### WD-UI 周报“已记录会话时长”前端显示与浏览器验收（历史快照，原时点 `FINAL_READY`）

“已记录会话时长”合同、opt-in 聚合或前端显示按原时点归档；它不等于有效说话时长，其他周报指标仍待决策。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#wd-ui-周报已记录会话时长前端显示与浏览器验收历史快照原时点-final_ready)。

<a id="wd-api-周报已记录会话时长opt-in-聚合与兼容解析final_readyui-未实施"></a>

### WD-API 周报“已记录会话时长”opt-in 聚合与兼容解析（历史快照；后续 `APPROVED@9179050`）

“已记录会话时长”合同、opt-in 聚合或前端显示按原时点归档；它不等于有效说话时长，其他周报指标仍待决策。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#wd-api-周报已记录会话时长opt-in-聚合与兼容解析历史快照后续-approved9179050)。

### WD-DESIGN 已确认周报时长合同（设计 `FINAL_READY`；API/UI 未实施）

“已记录会话时长”合同、opt-in 聚合或前端显示按原时点归档；它不等于有效说话时长，其他周报指标仍待决策。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#wd-design-已确认周报时长合同设计-final_readyapiui-未实施)。

<a id="cp04e-认证退出与活动-room-组合补验final_ready"></a>

### CP04E 认证退出与活动 Room 组合补验（2026-11-15 历史快照；`FINAL_READY`）

对应认证退出、身份切换、Dashboard/通话占用或布局可见性的本地子卡已完成；CP-04/CP-05 父项的真实 IdP、设备、媒体与 production 条件仍待。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#cp04e-认证退出与活动-room-组合补验2026-11-15-历史快照final_ready)。

### CP04I 真实入口换号与迟到响应组合（FINAL_READY）

对应认证退出、身份切换、Dashboard/通话占用或布局可见性的本地子卡已完成；CP-04/CP-05 父项的真实 IdP、设备、媒体与 production 条件仍待。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#cp04i-真实入口换号与迟到响应组合final_ready)。

### CP05L Dashboard 生命周期实际组合缺口（FINAL_READY）

对应认证退出、身份切换、Dashboard/通话占用或布局可见性的本地子卡已完成；CP-04/CP-05 父项的真实 IdP、设备、媒体与 production 条件仍待。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#cp05l-dashboard-生命周期实际组合缺口final_ready)。

### CP02I 通话占用本地组合补验（FINAL_READY）

对应认证退出、身份切换、Dashboard/通话占用或布局可见性的本地子卡已完成；CP-04/CP-05 父项的真实 IdP、设备、媒体与 production 条件仍待。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#cp02i-通话占用本地组合补验final_ready)。

### CP05K 会话界面动态桌面与键盘覆盖（FINAL_READY）

对应认证退出、身份切换、Dashboard/通话占用或布局可见性的本地子卡已完成；CP-04/CP-05 父项的真实 IdP、设备、媒体与 production 条件仍待。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#cp05k-会话界面动态桌面与键盘覆盖final_ready)。

### CP05D 设置抽屉动态可见性

对应认证退出、身份切换、Dashboard/通话占用或布局可见性的本地子卡已完成；CP-04/CP-05 父项的真实 IdP、设备、媒体与 production 条件仍待。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#cp05d-设置抽屉动态可见性)。

### R2-11 会话中界面本地子卡（FINAL_READY）

本地会话中界面子卡已完成并归档；真实 LiveKit 人工媒体与设备验收仍未完成，父项保持未勾。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#r2-11-会话中界面本地子卡final_ready)。

### R2-10 硬编码文案收口（FINAL_READY）

硬编码文案、设置标题与活动记录去 UUID 的技术收口已完成并归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#r2-10-硬编码文案收口final_ready)。

### SGEC-OFF 严格离线校验与合成评测（FINAL_READY）

严格离线校验与固定合成评测已实现并随 PR194 合入 main `d33f236`；真实 Provider、BKT、人工 gold 与真实教学质量仍待。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#sgec-off-严格离线校验与合成评测final_ready)。

### R2-UI 设置标题与活动记录去 UUID（FINAL_READY）

对应 R2 本地 UI/生命周期门禁已完成并归档；真实媒体、设备和生产边界不连带核销。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#r2-ui-设置标题与活动记录去-uuidfinal_ready)。

### R2-LIVE 活动会话生命周期实时门禁（FINAL_READY）

对应 R2 本地 UI/生命周期门禁已完成并归档；真实媒体、设备和生产边界不连带核销。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#r2-live-活动会话生命周期实时门禁final_ready)。

### DEC-A R2 与 SGEC 设计口径回写（FINAL_READY）

该卡保存 R2/SGEC 或路线图的历史口径修正与证据索引，不改变后续产品政策。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#dec-a-r2-与-sgec-设计口径回写final_ready)。

### RDOC 路线图历史快照口径修正（FINAL_READY）

该卡保存 R2/SGEC 或路线图的历史口径修正与证据索引，不改变后续产品政策。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#rdoc-路线图历史快照口径修正final_ready)。

### A18P2 启动/恢复生命周期减重与实例隔离（FINAL_READY）

启动/恢复生命周期或 Room 快照所有权的技术维护已完成；真实设备与外部链路仍按父项边界保留。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a18p2-启动恢复生命周期减重与实例隔离final_ready)。

### A19 P2 Room 快照与引用所有权（FINAL_READY）

启动/恢复生命周期或 Room 快照所有权的技术维护已完成；真实设备与外部链路仍按父项边界保留。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a19-p2-room-快照与引用所有权final_ready)。

<a id="a82c-native-room-夹具就绪证据与文档核销final_ready本地夹具就绪子项完成"></a>

### A82C Native Room 夹具就绪证据与文档核销（历史快照；当时 FINAL_READY）

Native Room 夹具/语音连接策略文档证据按原时点归档，不表示真机或真实 LiveKit 验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a82c-native-room-夹具就绪证据与文档核销历史快照当时-final_ready)。

### A84C LiveKit 语音连接策略文档收口（2026-11-14 历史快照；当时 FINAL_READY）

Native Room 夹具/语音连接策略文档证据按原时点归档，不表示真机或真实 LiveKit 验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a84c-livekit-语音连接策略文档收口2026-11-14-历史快照当时-final_ready)。

### RF04E 已有远端 CI 证据核对（2026-11-14 历史快照）

三条历史 main push、iOS failure 传播反证与 required-check 未核边界存档；不同提交和历史运行的数字不能相加。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#rf04e-已有远端-ci-证据核对2026-11-14-历史快照)。

### CF20 Chromium 焦点就绪竞态回归（2026-11-14 历史快照；最终 Review/发布见主控回执）

对应 Chromium 焦点就绪或 WebKit 周语法重复稳定性证据按原时点归档；历史根因与当前全树结果分别核验。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#cf20-chromium-焦点就绪竞态回归2026-11-14-历史快照最终-review发布见主控回执)。

### WG20（WebKit 周语法重复稳定性补验）历史快照；最终回执与用户 Review 待

原时点技术验收、失败与边界保存在新历史快照；不得外推为合并后当前结果。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#wg20webkit-周语法重复稳定性补验历史快照最终回执与用户-review-待)。

### R2-13（历史快照：组件目录按页面边界归位）本地实施/验收完成；用户 Review 待

按页面边界的组件目录归位与 Dashboard 抽取已完成；正式桌面客户端仍受 CP-03 设备证据阻断。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#r2-13历史快照组件目录按页面边界归位本地实施验收完成用户-review-待)。

### R2-12（macOS 构建产物与同步脚本）本地实施/验收完成；用户 Review 待

macOS 构建产物与同步脚本已完成；正式壳、Tauri 选型、签名与真机未验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#r2-12macos-构建产物与同步脚本本地实施验收完成用户-review-待)。

### R2-14（Compose 系统就绪与一次性迁移）当次快照；用户 Review 待

公开 PG system-ready 与一次性迁移 DAG 的本地合成合同已实现；真实迁移容器、整栈启动、生产与外部依赖仍未验收。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#r2-14compose-系统就绪与一次性迁移当次快照用户-review-待)。

### A3（Fake API 契约校验，PR #141/#147）合并收口

对应 Fake API、只读 data 层、导航切片或分层依赖门禁的合入/技术验收事实已归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a3fake-api-契约校验pr-141147合并收口)。

### A4a（只读 data 层，PR #149）合并收口

对应 Fake API、只读 data 层、导航切片或分层依赖门禁的合入/技术验收事实已归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a4a只读-data-层pr-149合并收口)。

### A4b（WeeklyGrammar 数据查询迁移，PR #151）合并收口

对应 Fake API、只读 data 层、导航切片或分层依赖门禁的合入/技术验收事实已归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a4bweeklygrammar-数据查询迁移pr-151合并收口)。

### A4c（WeeklyProgress 数据查询迁移，PR #152）合并收口

对应 Fake API、只读 data 层、导航切片或分层依赖门禁的合入/技术验收事实已归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a4cweeklyprogress-数据查询迁移pr-152合并收口)。

### A4d（DailyProgress 数据查询迁移，PR #153）合并收口

对应 Fake API、只读 data 层、导航切片或分层依赖门禁的合入/技术验收事实已归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a4ddailyprogress-数据查询迁移pr-153合并收口)。

### A4e（ActiveSessions 只读迁移，PR #154）合并收口

对应 Fake API、只读 data 层、导航切片或分层依赖门禁的合入/技术验收事实已归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a4eactivesessions-只读迁移pr-154合并收口)。

### A6（分层依赖门禁，PR #155）代码验收完成

对应 Fake API、只读 data 层、导航切片或分层依赖门禁的合入/技术验收事实已归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a6分层依赖门禁pr-155代码验收完成)。

### A5（导航切片，PR #148）合并收口

对应 Fake API、只读 data 层、导航切片或分层依赖门禁的合入/技术验收事实已归档。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#a5导航切片pr-148合并收口)。

### B1（学习事件台账）与 WPH 历史收口快照；用户 Review 待

B1 §9 七项业务政策已于 2026-11-12 确认；本地四迁移、ledger、冻结 `bkt-v1`、隐私导出/整账号删除与合成 PG 验证已完成。B2 的生产维护窗口/停写、真实 DDL 与数据切换、备份复活/法定特殊保留、真实环境仍未完成；本次合并集成本地验证已完成，最终以同卡回执为准。

详细历史见 [B1 对应小节](./history/b1-implementation-2026-11-16.md#b1学习事件台账与-wph-历史收口快照用户-review-待)。

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
- 上述 READ2/ST/A11Y 条目保留 CGC 前的原时点文字与 trace。后续 CGC 仅确认并修复
  `session-flow` helper 的 Chrome 151 Promise GC 夹具机制；其他历史 flaky 的首失败、自然未复现和未改动
  fixture 继续按原事实保留，不把控制实验外推成所有历史事件均已解释或修复。
- 真实方向键选择仍未验证：focus/Tab/selectOption 已通过，原生 popup 实际操作仍未验。
- 根目录 `README.md` 仍含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准。

## 历史与决策

| 内容                                                                         | 位置                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Room 所有权收窄（A19，已发布 PR190 main015）                                 | [验收记录](./history/2026-11-16-a19-room-ownership-maintenance.md)                                                                                                                                  |
| 生命周期测试边界（A18，已发布 PR191）                                        | [验收记录](./history/2026-11-16-a18-lifecycle-testing-boundary.md)                                                                                                                                  |
| SGEC 纯离线契约实施（SGEC-OFF，PR194/main d33f236）                          | [实施记录](./history/2026-11-16-sgec-offline-implementation.md)                                                                                                                                     |
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
| B1 完整原状态快照（绑定 HEAD `46ef954`，只代表原时点）                       | [B1 实施历史快照](./history/b1-implementation-2026-11-16.md)                                                                                                                                        |
| 2026 年 11 月各轮实施记录与当时基线                                          | [history/2026-11.md](./history/2026-11.md)                                                                                                                                                          |
| 2026 年 10 月各轮实施记录                                                    | [history/2026-10.md](./history/2026-10.md)                                                                                                                                                          |
| 已合并与明确未采纳的方案                                                     | [history/decisions.md](./history/decisions.md)                                                                                                                                                      |
| 已完成的待办事项                                                             | [history/todo-done.md](./history/todo-done.md)                                                                                                                                                      |
| 评审手册的单轮回执                                                           | [history/review-loop-receipts.md](./history/review-loop-receipts.md)                                                                                                                                |

历史文件只追加、不改写；其中的计数和结论只属于当时的提交。
