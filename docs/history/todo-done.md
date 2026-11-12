# EchoTalk 已完成事项归档

> 已勾选事项与纯历史段落自根目录 `TODO.md` 搬运（2026-11-10），保留原标题分组与原文，除相对链接改为从本目录出发外未改动内容。未完成事项仍只在 [TODO.md](../../TODO.md)。

## 2026-11-12 B1 学习事件实施（B1-1）

- [x] **B1-1 模型、新增迁移与约束**（依赖 B1-0）：新增 `LearningEvent` ORM 并注册，新增以
      `c06_transcript_events` 为父 revision 的 `b1_learning_events` 迁移，落实 identity
      `apply_seq`、事件形状 CHECK、幂等键唯一、完成 Job 唯一、来源外键 `ON DELETE RESTRICT`
      和四个查询索引；16 个旧迁移未改动。pronunciation/grammar observation 允许
      `model_version=NULL`，兼容既有 `legacy_mock`/`legacy_rule` 回填与旧 pending 来源，不写伪版本。
      主控 RED 实跑为 4 failed/0 skipped、exit 1，失败均对应缺失 ORM/迁移/表。实现节点未连接
      PG、未执行迁移或测试。随后主控在本轮专用合成 PostgreSQL 完成空库 upgrade 至 b1、PG schema
      GREEN `4 passed / 0 skip / exit 0`、current/downgrade 回 c06 后清除表/索引/identity、
      reupgrade 至 b1 exit 0，以及独立真实 PG 与 ORM 元数据 compare 零差异 exit 0。ORM 的
      `idempotency_key` 唯一约束与 migration 同名一致；`JSONB(none_as_null=True)` 将 Python
      `None` 绑定为 SQL `NULL`。既有 worker PostgreSQL fixture 原固定 `c06_transcript_events`，
      主控实跑得到 `1 error` RED 后，已改为读取仓库 Alembic 源码 `get_current_head()` 并严格比较
      数据库 `alembic_version`；原 DB/user/PG15.19/DSN guard 不变。本轮最终门禁、backend 813、
      本机 E2E `233 passed / 1 failed / exit 1` 及唯一既有 WebKit 失败见
      [PROJECT_STATUS B1 小节](../../docs/PROJECT_STATUS.md)，不能称本机全树全绿。生产库未执行。
      无业务写入、切换、导出、删除、依赖或 UI 变更。

## 2026-11-12 架构演进 A6（分层依赖 lint 规则）

- [x] **A6 分层依赖的 lint 规则**（Sonnet；依赖 A4 完成）：用 ESLint 限制 `platform` 不得依赖
      `lib`/`store`/`components`，`lib` 不得依赖 `store`/`components`，data 层不得依赖 `components`。
      验收：规则为 error 级；现有代码零违规或逐条修正；故意加一条反向 import 时 lint 失败。
      结果：零依赖error规则覆盖既定三组禁止边，清理入口移至store且顺序/断言不变；
      现有7违规归零，主控22项/补充19项分层检查、真实逆向import失败并恢复，
      四份AST与144份保护文件保全；代码`87e0fd5`（PR #155）六CI确认
      Vitest1206/49、Linux E2E234、pytest809/80.19%、Fake108/gen8/build21。
      追加本机首轮232/2、后续旧新完整各233/1与Linux234分开记录；
      DocTalk80次及完整对照未复现，P2待查观察保留，不计本机通过，详见当前状态及PR。

## 2026-11-12 架构演进 A4e（ActiveSessions 只读列表迁移）

- [x] **A4e ActiveSessions 只读列表迁移到 data 层**（Sonnet；依赖 A4a 已确认）：迁移
      `active-sessions/useActiveSessionList.ts`，结束/恢复写操作归属与互锁保持。验收：原
      `ActiveSessions.test.tsx` 与相关 E2E **零改动**通过；读侧不再自行维护请求 id、认证订阅与
      生命周期门禁；关键防线做 3 处以上真实变异并列出是否被原测试捕获。
      结果：真实Data controller持有请求归属/分页/去重/tombstone，6份UI/写流程/订阅中枢逐字不变；
      146份原测试/fixture/config零改。R1修复取消/失败后的旧cursor复用；主控9项与补充独立13项
      对照通过，原AS116三处变异均被捕获，额外cursor私有变异抓到两项回归。代码head
      `fb47cf4`（PR #154）六CI原始日志确认1206/49、Linux234（0 skip/retry）、
      pytest809/80.19%、Fake108/gen8/build21；无依赖/HTTP/数据库变化，真实服务/设备未验。

## 2026-11-12 架构演进 A4d（DailyProgress 数据查询迁移）

- [x] **A4d DailyProgress 单组件迁移**：专用Data hook实际消费controller，首屏summary+rows
      原子Page、单套认证/lifecycle/午夜+100ms，保留原读取时点、非物理取消和挂起错误策略。
      原DP23/data45、146份测试/fixture/config及全渲染分支AST不变；代码head `05e76fe`（PR #153）
      六项CI原始日志确认Vitest1206/49、Linux E2E234（0 skip/retry）、pytest809/80.19%、
      Fake108/gen8/build21。四处真实变异均被原DP断言捕获，私有行为8/8、重入4/4通过。
      无用户可见行为、依赖或数据库变化，真实外部服务与设备未验证。

## 2026-11-12 架构演进 A4c（WeeklyProgress 数据查询迁移）

- [x] **A4c WeeklyProgress 单组件迁移**：两个真实 controller 共享单套 auth/lifecycle/focus/clock，
      上游 weekly 提交后才允许 history，组件只渲染与事件转发。原 WP31/data45、146份
      测试/fixture/config和界面AST不变；代码 head `a350dd5`（PR #152）六项CI原始日志确认
      Vitest1206/49、Linux E2E234（0 skip/retry）、pytest809/80.19%、Fake108/gen8/build21。
      auth revision、重复cursor、日窗口下界三处真实变异均被原WP捕获；额外行为探针6/6。
      无用户可见行为、依赖或数据库变化，真实外部服务与设备未验证。

## 2026-11-12 架构演进 A4b（WeeklyGrammar 数据查询迁移）

- [x] **A4b WeeklyGrammar 单组件迁移**：组件只渲染/转发 retry，认证、生命周期、请求槽、timer
      与过期响应判断由 data controller/hook 承担。原 JSX/文案/ARIA/class 保持；146 个
      测试/fixture/config 文件 SHA256 不变。代码 head `496326c`（PR #151）六项 CI 与原始日志已核实：
      Vitest1206/49、E2E234（0 skip/retry）、pytest809/80.19%、Fake108/gen8/build21。
      auth revision、suspend 门禁、分钟检查三处真实变异均被原 WG14 项测试捕获；R1 分钟相位
      探针真实 RED→GREEN，源码恢复。未新增依赖、未改变产品行为或数据库；真实服务/设备未验。

## 2026-11-12 架构演进 A4a（只读 data 层本地收口）

> 本节的完成指契约、最小 controller/hook、契约测试、本地门禁与独立评审已收口；最终仍以交付
> PR 的 Linux 检查为准。

- [x] **A4a 前端 data 层契约与契约测试**：新增最小只读查询 controller、React hook、契约文档
      与 45 项不依赖业务组件的契约测试。按用户确认的方案 A 保留四区块 per-query 差异；未新增
      依赖、未迁移组件。GitHub P2 的官方 RED 为新增 3 项失败、原 42 项通过，无显式 key 策略的
      默认键补充纠错后，45 项契约、全量 Vitest 1206/49 与独立探针 7/7 通过；
      lint/typecheck/build 强制执行、0 cache 通过，原 42 项测试内容逐字保留。五个
      `prefer-const` 机械修正和 Prettier 前后 555 个断言/行为调用 AST 相同；契约中的 93 个
      `a7841b7` 永久链接保留。A4a 尚无最终合并回执，Linux/PR CI 未覆盖本次纠错；该本地收口
      不替代 CI 或真实外部环境验收。

## 2026-11-12 架构演进 B1（学习事件台账设计交付）

> 本节的完成只指设计文档已获主控 APPROVED 并完成归档。建表、代码、迁移执行及删除政策均未开始。

- [x] **B1 学习事件台账设计**：新增 [学习事件台账设计](../../docs/LEARNING_EVENTS_DESIGN.md)，
      定义只追加 `learning_events`、分析 Job 写入时机与幂等键、合成标记与派生排除、
      `knowledge_states` 重算校验、现有评估结果关系、保留选项和单条线性 Alembic 草案。
      草案父 revision `c06_transcript_events` 已核对存在，唯一 Python Markdown 草案经
      `ast.parse` 成功。结果：无表、无迁移文件、无 DDL 或代码/测试/依赖变更；legacy 基线、
      旧 pending/failed Job、retention、未来重分析身份和 `bkt-v1` 参数仍待用户政策确认，
      A4a 方案 A 不属于 B1 授权。

## 2026-11-12 架构演进 A5（导航切片收口）

> 本节的完成指本地实施、机械测试归属与文档已收口；最终仍以交付 PR 的 Linux 检查为准。

- [x] **A5 导航状态移出会话 store**：`appView` 已迁入独立导航切片，并与会话切片组合在同一
      物理原子容器，不引入 Router。本轮 Vitest 1161/45 通过；lint 与 typecheck `--force`
      成功且 0 cache（132 warnings / 0 errors）。8 份既有测试的 340 个 case 与 1624 个 expect
      相关调用 AST 保持不变，DocChatSetup 仅拆 `store` mock 与 `beforeEach` 所有权，契约和
      行为未改变。新交付 PR 尚未创建，E2E、backend 与 Linux CI 以该 PR 最终检查为准，旧
      PR #145 的 Fake API 75 等结果只属于历史。

## 2026-11-12 架构演进 A3（最终合入收口）

> 下方 2026-11-12 补充说明是合入前快照；A3 最终状态以本节为准。

- [x] **A3 Fake API 接受 OpenAPI 契约校验**：PR #141 最终 head
      `b1d375611d10f0380bc30f42af486c404b1c21c0` 已通过 Linux CI run `43134694256` 与
      PR Guard run `43134694336`，记录 Vitest 1156（44 个文件）、Fake API 108、E2E 234
      （0 skip/retry）、生成器 8、构建脚本 21、pytest 809/80.19%。随后以 squash commit
      `a7841b7486b14af01e535e5e3f4e0472c621d198` 合入 main，整卡已从 `TODO.md` 移出。
      真实 Provider、IdP、LiveKit、设备、语音链路与生产部署仍未验收；下方原 A3 条目及
      Fake API 103、本机 E2E 233/1 等失败历史保持原样。

> 2026-11-12 补充：下方 A3 条目保留原 head `437f6ff` 的当时记录。独立 Review 发现 Unicode 长度边界问题，
> 修正候选与最新 main 的整合尚待目标 CI，当前状态以 [TODO.md](../../TODO.md) 未勾选项为准。

## 2026-11-11 架构演进 A1（会话准入纯抽取）

- [x] **A1 后端会话准入规则收拢**：将 `backend/routers/sessions.py` 中 `get_session_token`
      两分支重复的「用户不存在/未配置密钥/密钥未验证/套餐限制」准入，与
      `get_session_token`/`dispatch_agent` disabled 分支两处「已结束会话」状态校验，收拢到
      `backend/services/session_admission.py`（`verify_session_admission`、
      `get_active_session_or_raise`），路由仅编排，HTTP 码与 detail 逐字不变，`dispatch_agent`
      沿用原有准入范围。结果：收敛既有重复检查，保留检查顺序及两条路由不同的已结束文案；
      验证记录见 [2026-11 实施记录](./2026-11.md)。

## 2026-11-11 架构演进 A2（前端 API 类型统一由 OpenAPI 派生）

- [x] **A2 前端 API 类型收口**：将 `apps/vite-app/src/lib/api.ts` 中已有 OpenAPI schema
      的业务类型改为 `ApiSchemas[...]` 派生，保留既有 required、nullable 与 union 收窄；
      `TokenResponse`、`HealthReadyResponse`、`ApiRequestOptions` 及未建模端点响应维持原声明。
      结果：Node 22 类型检查与生成类型字节检查通过，运行时、生成文件、后端、测试、fixture、
      依赖和锁文件零改动；验证记录见 [2026-11 实施记录](./2026-11.md)。

## 2026-11-11 架构演进 A3（Fake API 成功响应契约核对）

- [x] **A3 Fake API 成功响应契约核对**：在 `apps/vite-app/scripts/fake-api-test.mjs`
      保留既有 75 项行为断言，新增真实子进程 HTTP 成功响应套件，并以
      `backend/openapi.json` 对当前 26 个 operation 做覆盖分类和字段校验；新增零依赖、
      测试侧 OpenAPI 子集校验器，未知关键字、断链 `$ref` 与无法校验的约束失败关闭。
      结果：固定列出 5 个 Fake API 缺失 operation、4 个空 schema 成功响应与 3 个精确偏差；
      缺失项由真实 Fake fallback 守护，并补齐全部标准 HTTP 方法、自有属性、日期和未知能力
      回归；主审实跑 103 passed（75 既有 + 28 新增，0 skip/cancel），独立边界探针
      10/10 通过，四处真实变异全部被新增用例抓到并逐字恢复源码。
      未改 Fake API、产品运行时代码、OpenAPI、生成文件、依赖或锁文件；完整记录见
      [2026-11 实施记录](./2026-11.md)。

## 2026-11-06 候选任务（无 Provider Key 前提，未开工）

- [x] **会后分析按来源门控**（方案 C-1，#120；2026-11-09 本地验收：pytest 809、Vitest 1142、E2E 180，变异 7/7 被杀；
      语法仍为 demo 规则，BKT 需 SGEC 落地后才有真实信号；无发音且无语法错误时的文案已于 2026-11-10 定为中性空态，见 [云端评审](../../docs/reviews/2026-11-cloud-review.md) §3.1）：BKT 只吃 `is_synthetic=False` 的观察；
      `USE_MOCK_ELSA=False` 时发音标为不可用、语法独立完成，不再整个 Job 失败；须同时处理
      发音缺失时 assessment 接口 404、前端 `Promise.all` 整体报错与纯语法重跑幂等。验收：
      pytest 覆盖全合成、两种方向的混合来源、两路真实、无发音、无转录、重跑，前端覆盖部分结果。
- [x] **livekit-agents 安全升级到 1.6.10**（方案 A-2，GHSA-q77r-q2p5-68vf；2026-11-09 本地验收：
      uv 0.9.18 重锁 107 包、export 一致，pytest 794 passed / 78.88%，脱敏变异 7 例被杀；
      错误 Key 握手冒烟与真实语音未验，远端 CI 待跑）：agents 与四个
      插件 `==1.6.10`、`livekit==1.1.14`、`livekit-api>=1.2.0`，uv 重生成 lock 与 export，
      不混入 OpenAI 3、Turn Detector 或模型更换；保留 #125 脱敏钩子；验收：三测试树通过；
      本地 LiveKit dev + 故意错误的 Key 触发 Deepgram/Cartesia 握手失败，日志无 Canary 明文
      （无需真实 Key，外网访问与服务启动需用户另行授权）；离线回归、错误 Key 冒烟、真实语音分开报告。
- [x] **python-jose 迁移 PyJWT**（方案 B；2026-11-09 本地验收：lock 107→102 移除 python-jose/ecdsa/rsa/pyasn1/six，
      pytest 801 passed，auth 变异 4/5 被杀、1 例等价；遗留两项已于同日补齐：下限上调至 2.13.0（PyJWK alg 绑定起始版本）、防御分支回归）：改 `auth.py` 与测试，并在 API 依赖组显式声明 PyJWT、
      删除 `python-jose`，同步 lock/export；与 1.6.10 升级共用依赖文件，须顺序生成。验收：补伪造
      HS256 + RSA `kid` 回归，401/503 语义不变。
- [x] **核销 LiveKit 消息路径 SDK 类型忽略**（P2 既有项；2026-11-09 按 1.6.10 源码取证：消息路径只用公开类型字段
      `ConversationItemAddedEvent.item`→`ChatMessage.role/text_content: str | None`，无 type: ignore；未跑类型检查器）：当前消息路径已用公开属性和类型收窄，
      唯一命中 `log_redaction.py` 的 `method-assign` 不在范围内；待 1.6.10 固定后取得类型证据再勾选。

## 2026-11-07 遗留问题（已核实，未修复）

- [x] **无 Key 运行时验收忽略长期进程退出码**（#128 Codex P2，已在 #128 修复：`stop()` 断言
      `long_process_exit_nonzero`，`exercise()` 断言 `process_exit_nonzero`，`test_runtime.py` 已覆盖）：
      `tools/keyfree-runtime/runtime.py` 的 `stop()` 只断言 `Running is False`，
      `exercise()` 只把三个 Worker 与 API 的退出码追加到 `process_exits`，仍写
      `status: "passed"`；只有 gateway 与 oneshot 校验退出码。验收：生成成功回执前统一要求
      全部长期进程 `ExitCode == 0`，补 runtime unittest：任一进程非零退出时回执不为 passed。

## 2026-11-04 补充轮：WebKit 首导航与 Worker 停机

- [x] 修复 macOS WebKit 首导航停滞：现场确认 AppKit 原生窗口动画线程累积、dispatch
      队列饱和；仅 Darwin WebKit 通过可执行包装器转发同锁 SDK 默认参数并追加进程偏好。
      未改 HTTPS/H2、load/30s、retry、排序或页面动画，未持久化系统偏好。见 `ui/REVIEW-r1.md`。
- [x] 设置零隐式写保护监听真实 `/api/user/settings`，原零写断言后由真实 UI Save 作正对照；
      隐式保存变异两浏览器 Expected0/Received1。重新启用原生窗口动画的变异也真实复现
      WebKit 第64例 goto 超时；两项均完整恢复，恢复后 WebKit87 无重试通过，首次失败与 trace 保留。
- [x] Worker 有界优雅停机：新程序三个 Worker 与 API 均 exit0；真 PID1 的 SIGINT、在途
      drain、超时取消/回滚及停止后不再领取均已验。旧过期恢复与幂等保持，范围见 `worker/REVIEW-runtime-r1.md`。
- [x] 新 integration 实跑完整19项全部 process/gate0：frontend10、backend5、runtime3 加
      wrapper 语法；1098 Vitest、21 build-script、69 Fake API、8 types、730 pytest/3 warnings，
      覆盖率78.43%、59%门禁保持，runtime 单测19项。UI lane 与最终集成两轮双浏览器均
      174全过、retries0，见 `final-quality-checks-r1/summary.json`与 `ui/root-fix-quality-checks-r1/summary.json`。
- [x] 本轮 runtime 与最后产品测试 PG/网络已按归属清理：
      `product-cleanup-checks-r1/summary.json`为 exit0，`setup/product-pg-cleanup.json`为 removed=true；
      `resource-cleanup-final.json`中本轮剩余容器/网络为空，镜像、证据与 worktree 保留。

## 2026-11-04 至 11-05 七天语法与宿主 HTTP（本地收口，停在 Review）

Dashboard 已实现截至 `end_date` 的滚动七个本地自然日真实语法记录卡片。该窗口不是
从周一开始的 ISO/自然周；服务端按认证用户、completed 会话的 `started_at` 半开区间及
既有非合成、非 demo 语法记录一次性有界聚合，客户端展示总记录数、固定六类中的最多三项、
固定复习提示和合法空态。未接分析触发、写请求、Token、采音或个性化生成。

本地实测为 1133 Vitest、21 build-script、72 Fake API、8 types runner、178
Chromium/WebKit（retries 0）、773 pytest（3 warnings、覆盖率 78.48%、59% 门禁）和
31 runtime unittest；frontend10、backend5、runtime3 与 wrapper 语法均通过。宿主
`host-gateway` 精确隔离拓扑下 health 200、匿名 401、缺 Key readiness 503，16 次实际
HTTP 得到 21 条语法记录及 Top 3 `other:7`、`article_usage:5`、`verb_tense_past:5`，
历史 55 行分 4 页，25 小时 DST 日通过。旧 internal-only 拓扑的宿主 18800 不可达历史
保留，新网关结果不外推到原 Compose。API/UI/runtime 三个范围 Review 均 APPROVED；
本节点停在 Review，后续以主控最终报告为准。当前仍为未提交 dirty 候选，无
commit/push/pull/rebase/merge/部署，当前候选远端 CI、真实 Provider/IdP/LiveKit、语音、
设备、签名与 native 编译均未验，next2 未融合。完整分项见
[RF-08 七天语法 Top 3 验收手册](../../docs/verification/cross-platform/RF-08-WEEKLY-GRAMMAR.md)。

## 2026-11-04 七天概览与隔离运行时收口（上一轮历史）

- [x] 七天概览与按日历史代码独立 Review APPROVED；14 份前端文件与主控原生生成的
      schema 已机械组合，槽位守卫变异被真实 deferred 断言杀死并完整恢复，详见 `ui/REVIEW-r1.md`。
- [x] 最终功能检查 16 项通过：前端除 format/E2E 的 8 项、backend5、runtime3；
      1098 Vitest、21 build-script、69 Fake API、8 types、678 pytest/3 warnings，
      后端覆盖率 78.67%，59% 门禁不变；runtime 单测 19 项，见 `final-functional-checks-r1/summary.json`。
- [x] 最终 Chromium/WebKit 共 174 cases：173 clean + 1 flaky 后重试通过，process/gate
      均为 0；8 条新增 weekly 用例在两引擎全过。多轮首次超时和 trace 保留，见
      `final-e2e-checks-r1/summary.json`及对应 `01-e2e/command.log`，不称 174 clean。
- [x] C1/C2 及最终 154 份后端输入的新 API/Agent 镜像完整性、隔离服务与真实 HTTP
      已验；最终镜像与配对测量分开。配对收益仅来自 `runtime/paired-comparison-r1.json`：
      API 0.1803%、Agent 0.2728%，不外推冷启动收益。详细分项见 `docs/PROJECT_STATUS.md`。
- [x] C1/C2/final 自建运行资源清理通过；文档读取时产品 PG 清理也已通过，
      `setup/product-pg-cleanup.json`为 removed=true，`resource-cleanup-final.json`中本轮
      containers/networks 均为空。清理按本轮资源归属，不表示全机无其他任务。
- [x] 最终 root format 与 `git diff --check`已真实通过，见 `final-format-checks-r1/summary.json`；
      与 16 项功能检查及 E2E 构成原 15 项 + runtime3 全部通过，仍保留 1 flaky。
      此次状态文字由主控复制后还会最后 format 复核，最新文字与回执以总报告为准。
      `final-quality-checks-r1`首次仅 `docs/agent-review-loop.md`与
      `docs/verification/cross-platform/RF-08-WEEKLY-PROGRESS.md`格式失败，历史保留。
- [x] **P2：settings WebKit 首次导航超时已在补充轮关闭**：上一轮首个用例的
      beforeEach `page.goto('/')`首试30秒超时、retry通过，当时根因未定；现已有本机
      动画线程阻塞、进程偏好正负对照及两轮174无重试通过证据，见顶部补充轮。旧失败与 trace 全部保留，未弱化断言。
- [x] 补验 Worker 优雅 SIGTERM 停机：上一轮三个 Worker exit137、API exit0 的历史保留；
      补充轮新程序三个 Worker exit0及在途/超时取消均已验证，见顶部补充轮。

## 2026-11-03 无 Key 工作与当时验收边界（历史）

- [x] A 诊断局部验证：最近 50 条内存白名单记录、账号清理、用户主动预览/复制/清空，
      无上传或持久化；主控 Vitest 1034、Chromium/WebKit 合计 166 通过，
      `auth-buffer` / `copy-order` 两个真实变异均 killed 且已还原。详见
      [诊断导出验证](../../docs/verification/cross-platform/CP-06-DIAGNOSTIC-EXPORT.md)。
- [x] C 后端无 Key 验收：真实 Linux arm64 API/Agent 角色镜像、frozen export、ASGI
      health/无 Key 拒绝、全新 PostgreSQL 空库迁移、合成 `c03 → c06` 的 UTC 微秒/
      索引/event/seed、真实分析 Worker 无 Key 安全失败均通过。镜像约 API 1.545 GB、
      Agent 1.936 GB；没有旧版同环境 before，不计算优化百分比或冷启动收益，不代表
      原 Compose 整栈已验。详见 [Linux 运行时记录](../../docs/verification/cross-platform/RF-07-LINUX-RUNTIME.md)。
- [x] Web Docker production guard 真实复验：P1 绕过入口已最小修复；主控三构建结果为
      OIDC exit0、dev/oidc-token exit1，两个负向均命中 production guard，原坏 dev exit0
      记录保留。这不代替缺 OIDC 运行态或原 Compose 整栈验收。
- [x] B r1 本地四项检查：修复 Node runner 被 Vitest 误收集，文件已改名
      `ios-ci-test.mjs`；主控格式、actionlint、Node 28 项、macOS 聚合检查通过，B 已停写。
- [x] B 子集无签名 arm64 Simulator 真实编译及静态产物校验通过，见
      [CI 41581791010 / job 125738079003](https://github.com/sunpcm/EchoTalk/actions/runs/41581791010/job/125738079003)；
      frontend/backend/macOS/iOS/CI 五 jobs 已全绿；built-not-run，不代表最终 A head，旧 r0/r1 失败保留。
- [x] 主控最终组合完整 frontend10/backend5 已通过，补充 format/Node 28/双浏览器几何验证通过。

## 2026-11-02 练习前置检查与探针 CI（最终组合检查通过）

- [x] 完整 frontend10/backend5：Vitest 1003、Chromium/WebKit 全 E2E 160、pytest 644
      全部通过；后端覆盖率 78.61%、3 warnings，59% 门禁保持。
- [x] 组合探针 actionlint、assets、Node 240 通过；54 份源/SDK/静态输入与 B 线实际编译
      输入完全一致。B 线真实 Rust 57、无签名 arm64 `.app` 及 Mach-O/plist 通过的证据
      继续有效，本次未在 A 重编译，原生 App 未运行。
- [x] 独立 HTTP 9 场景及浏览器初始化 2 个控制场景通过；HTTP 检查零解密、零外网。
      此前两项关键变异均被真实断言杀死，源码已还原。
- [x] 该轮远端 CI：2026-11-03 主控确认 PR #117 已合并，旧 PR 及对应 main 运行均已全绿。

## MVP 产品化修复（RF-01～RF-12）

### Phase 1：分析可靠性

- [x] **RF-01 持久化分析状态机**：PostgreSQL Job 支持原子领取、幂等、超时恢复、
      有限重试和人工重试；状态 API 与前端明确展示四种状态；任意状态均可返回主页；
      重复消费、Worker 崩溃和最终失败均有测试。

### Phase 2：模拟结果隔离

- [x] **RF-02 评估来源可信**：评估带来源、Provider、模型版本、Synthetic 与置信度；
      Synthetic 不更新真实知识状态；生产缺 Provider 时返回 `unsupported`；API、迁移、
      前端和测试同步。

### Phase 3：鉴权与密钥生命周期

- [x] **RF-03 真实鉴权和版本化密钥**：采用单一明确的 AuthProvider 方案；移除生产
      Mock 用户和固定 Token；资源归属、过期/伪造 Token、认证密钥与凭据加密密钥分离、
      旧密文读取/重加密、Provider 错误分类和日志脱敏均有测试。
      2026-11-01 A81 b/r0 对该已完成项补漏：停止在 LLM 成功日志记录回复正文、停止把
      SDK `APIError` 原文写入日志或 502，停止在 disabled dispatch 日志格式化异常对象；
      为真实 service/router 增加合成 canary 回归。A81 已独立 Review APPROVED，以正常
      hook 单提交 `bbde1ff20ea961375401c714d36a65ffc268b1d7` 精确 fast-forward 本地 main，
      完成完整 15 项门禁；四类实际输出变异均由新增回归杀死并精确还原。

### Phase 6：内部边界

- [x] **RF-11 前端 API 与状态模型**：OpenAPI 生成类型/客户端；Transport 统一认证、
      超时、取消、Header 合并和错误解析；会话使用判别联合/Reducer；大组件按行为拆分。
      以下 A49–A64 条目保留各轮当时的“仍待完成/未勾选”边界；最终完成状态以上方勾选、
      A65–A69 验收结果及本节末“本地代码验收完成”边界为准。
      本地已完成异常 HTTP 错误体健壮解析（A49）：修复 request 对 detail:[null]、非数组/非法 loc 及非 string msg/errors 引发 TypeError 与 HTTP status 丢失缺陷；实现局部健壮类型守卫（isRecord/getFirstTruthyString），严格保护 ApiError.status 与原始 data 结构；未通过数组类型收窄的非法或缺省 loc 安全回退 Unknown，杜绝调用任何对象方法，正常 string/number 数组安全 join；保持 detail 字符串、空字符串与 detail.message 原 truthy 语义，完整保持既有有效分支优先级；401 在解析前严格按原 reqRevision 失效，迟到 401 保护生效，请求仅发送一次无重放；诊断日志零正文/密钥泄露；覆盖 422/401/500/502 异常形状、空值边界与非 JSON 表驱动回归通过（见 [RF-11 异常 HTTP 错误体健壮解析验证](../../docs/verification/cross-platform/RF-11-ERROR-BODY-GUARDS.md)）；
      本地已完成设置保存载荷行为抽取（A61）：将 `SettingsDrawer.handleSave` 中构建 `UserSettingsUpdate` 请求体的纯计算抽取为独立纯函数 `buildSettingsUpdate`（`settingsPayload.ts`）；模块仅 import type，零 React/DOM/store 依赖，零网络/日志/持久化与明文密钥保存；严格保证 `is_custom_mode: false` 时仅输出该字段且不包含任何 provider/model/key 字段；`is_custom_mode: true` 时按原顺序携带 `stt_provider`/`llm_provider`/`tts_provider`，`llmModel.trim()` 非空才携带 `llm_model`，三路 key 仅 trim 后非空才携带，不引入清空语义且不带额外字段；`SettingsDrawer` 真实消费新模块并验证完整更新 payload；直接单测覆盖开/关、单/多 key、空白截断、冻结入参不变性与独立实例隔离，修复 `test_user_settings_service` 遗留的 overrides 清理及 RF-10 文档笔误（见 [RF-11 设置保存载荷行为抽取验证](../../docs/verification/cross-platform/RF-11-SETTINGS-PAYLOAD.md)）；
      本地已完成 API 错误消息解析纯计算边界抽离（A62）：将 `apps/vite-app/src/lib/api.ts` 中错误响应体解析为错误消息的纯计算抽离为独立纯函数 `getApiErrorMessage`（`apiErrorMessage.ts`）；模块零网络/DOM/store/全局可变状态依赖，零反向依赖；原 `ApiError` 导出与构造签名 100% 保持；原 `request` 移除旧错误解析私有副本并真实消费新函数；逐项严格保持 FastAPI detail 字符串（含合法空字符串）、422 验证异常首项判定与 loc 安全拼接（缺失/非法安全回退 Unknown）、detail.errors 首项非空采纳（首项空不扫描后项）、detail.message 非空采纳、合法空嵌套 message/空对象回退 JSON.stringify 兜底及序列化异常安全回退默认文案；外层 errors/message 保持原优先级与语义；401 在读取 JSON 前按原 revision 失效、非 JSON 解析回退 `{}` 及写请求单次调用防重放等时序完全不改；直接单测全面覆盖有效/异常结构、合法空值与冻结入参不变性，通过 spy 与可证伪替身证实公共 API 消费者出错时真正委托新模块且保持 status/data（见 [RF-11 API 错误消息解析边界抽离验证](../../docs/verification/cross-platform/RF-11-API-ERROR-MESSAGE.md)）；关闭 A61 文字 P2 两项笔误；前端 API 类型生成与会话状态模型重构仍待完成，整项保持未勾选。
      本地已完成 API 请求 Header 合并边界抽离（A63）：将 `apps/vite-app/src/lib/api.ts` 的 `request` 内默认 `Content-Type`、认证 `Authorization` 与调用方 Header 合并逻辑原样抽为同步纯函数 `buildApiRequestHeaders`（`apiRequestHeaders.ts`）；模块无网络/异步/DOM/store/日志/全局可变状态与反向依赖，直接单测覆盖空入参、对象、数组、`Headers`、既有 `Content-Type`、显式 `Authorization`、无 token、自定义 Header 保留、冻结输入不变性、多值语义与实例隔离；原 `request` 真实消费新模块，认证 revision/token 校验、baseUrl/path、请求选项、错误处理、401 时序及单请求行为保持不变，并通过公共消费者 spy 回归证明 Header 构造委托、最终 Headers 与一次 fetch；前端 API 类型生成、会话状态模型、超时与取消仍待完成，整项保持未勾选（见 [RF-11 API 请求 Header 合并边界抽离验证](../../docs/verification/cross-platform/RF-11-REQUEST-HEADERS.md)）。
      本地已完成 Transport 请求超时与取消边界（A64）：新增纯计算模块 `apps/vite-app/src/lib/apiRequestTimeout.ts`，以既有前端 10s 门禁为普通请求默认预算，对会触发后端最多 10s 并行 Provider 校验的 `updateUserSettings` 显式采用 15s；运行时非法预算安全回退 10s；组合调用方 `AbortSignal` 与内部超时，已取消 signal 在 fetch 前零网络短路，超时与调用方取消使用独立的 `ApiRequestTimeoutError` / `ApiRequestAbortedError`、稳定错误分类与无正文诊断事件；外部取消优先，不自动重试或重放写请求；认证 revision/token/revision 二次校验、Header 构造、HTTP 错误/ApiError、401 失效、非 JSON 回退与单请求时序保持不变；直接单测与公共 API 消费回归覆盖预算、组合 signal、两类失败、非法值、隔离性及一次 fetch；前端 API 类型生成、会话状态模型与其他 Transport 收敛仍待完成，整项保持未勾选（见 [RF-11 Transport 请求超时与取消边界验证](../../docs/verification/cross-platform/RF-11-REQUEST-TIMEOUT.md)）。
      本地已完成会话状态判别联合与 Reducer 边界（A65，独立 Review APPROVED）：新增纯 `conversationState.ts`，以 `checking_health`、`creating_session`、`fetching_token`、`credentials_ready`、`active`、`ending`、结束与失败 phase 收敛会话真值，旧 `connecting + null token` 启动过渡态保留为明确内部阶段并兼容投影为原扁平字段；生产 store 的真实创建/取令牌/激活/结束/失败/重置迁移统一消费纯构造、守卫、Reducer 与原子投影，公开 `setState` 测试夹具经同一归一化层处理，完整凭据才可进入连接就绪或 active；`VoiceInterface` 改为类型收窄渲染并保持 Room key/props、文案和 DOM，`ActiveSessions` 启动判定复用同一模型；既有 sessionGen、认证 revision/principal、生命周期所有权与迟到结果隔离保留。A65 定格于本地单提交 `356f69e9ceecf8868b6f11db7b53d566032bb2f6`；三项有效变异是 lane 私有验证，均在提交前被真实断言杀死并完整还原源码，main 未重跑。该提交精确 fast-forward 后，main 按 A65 当时范围完成原 8 项前端门禁与 529 backend pytest，其中 Vitest 876、双浏览器 E2E 148；当时尚无 A67 才新增的 OpenAPI schema 门禁，也不把其他轮次或 lane 的 Ruff 结果追加为本次 main 事实（见 [RF-11 会话状态模型验证](../../docs/verification/cross-platform/RF-11-STATE-MODEL.md)）。
      本地已完成公共网络函数取消入口（A66，独立 Review APPROVED）：新增只含末位可选 `readonly signal?: AbortSignal | null` 的 `ApiRequestOptions`，为实际 22 个网络函数补齐 options，同时保留 owner、docContext、takeover、params 等原参数位置与默认值；仅把 signal 写入单请求 `RequestInit`，不扩展 headers/timeout/RequestInit，也不把 options 混入 body 或 owner 判定；继续复用 A64 组合 signal、普通请求 10s 与设置更新 15s 预算，预取消零 fetch、在途取消至多一次且不重放，认证 revision、HTTP/401、错误解析与并发请求隔离保持。A66 定格于本地单提交 `fedc5f39d659bf591a7c8b42b087d46a13eb4349`；22 个公开 API/24 个 request 分支由 907 Vitest 与 148 双浏览器 E2E 覆盖，两项有效变异仅由 lane 私有验证执行并已完整还原，main 未重跑。该提交精确 fast-forward 后，main 按 A66 当时范围完成原 8 项前端门禁与 529 backend pytest；当时尚无 A67 才新增的 OpenAPI schema 门禁，也不把其他轮次或 lane 的 Ruff 结果追加为本次 main 事实。UI 生命周期主动 abort 全部 store 不在本交付中（见 [RF-11 公共 API 取消入口验证](../../docs/verification/cross-platform/RF-11-PUBLIC-CANCELLATION.md)）。
      本地已实现并验证离线 OpenAPI 导出与 TypeScript 类型生成（A67，独立 Review APPROVED）：新增真实 `main.app.openapi()` 隔离子进程导出；导入 config 前以 Pydantic 文档化 `_env_file=None`/`_secrets_dir=None` 构造控制禁用 dotenv/file-secret 读取，再按真实 settings source hook 签名仅保留 init/env；TMP/TEMP 与 XDG 受控但不重设 `HOME`，DNS/socket 失败关闭；真实子进程 120 秒超时，异常仅输出阶段/类型，确定性 JSON 原子写入。真实 schema 当前含 22 条路径、27 个模型且 `--check` 通过；`openapi-typescript@7.13.0` 已从该 schema 真实生成 `api.generated.ts`，Node 生成器 8 项、离线导出 pytest 11 项及完整前端 quality10 均通过；Vitest 为 907/32 files、Node 构建测试 18 项、Fake API 61 项、Chromium+WebKit E2E 148 项。后端专用测试库全量 pytest 为 540 passed/3 warnings、覆盖率 79.41%；新增导出工具主要在隔离子进程中执行，不计入父 pytest coverage，既有 59% 门禁不变。lock 已按精确 override 受控重生成并通过冻结安装：既有 packages 的 version/integrity 与既有 resolved snapshots/importer 不变，新增 17 个 packages、18 个 snapshots 及 vite-app 的精确 devDependency；唯一既有 package 元数据变化是已批准的 Webpack 插件 peer range 原生记录为 `0.21.3`。六类生产 DTO 已消费 generated component；两项 schema/types stale 变异是 lane 私有验证，均在合并前被真实断言杀死并完整还原源码，main 只重跑 frontend10、OpenAPI schema、Ruff 与 backend 标准门禁；正常 hook 通过且批准文件 hash 一致，六 DTO 精确键、双向兼容及 `api.ts` 去类型 JS 字节等同基线通过。A67 定格于本地单提交 `1321bbe43ac540cacb75ea3845ac381076a7c637`，main 精确 fast-forward；未 push/部署，远端 CI、真实 IdP/Provider/LiveKit/设备未验（见 [RF-11 OpenAPI 类型生成验证](../../docs/verification/cross-platform/RF-11-OPENAPI-TYPES.md)）。
      本地已完成 VoiceInterface 行为拆分（A68-B，独立 Review APPROVED）：主入口只保留 phase 选择与 Room key/props；`RoomSession` 承接 principal/revision 绑定、原生 pending/ready/timeout、Web 初始/订阅后快照、`RoomContextSync` 稳定 cleanup、LiveKit callbacks 与 dispatch 迟到/重入核验；`ActiveConversation` 承接活动 UI、LiveKit hooks、agent_error 和显式结束停轨；`EndedConversation` 承接本地取消、分析轮询/失败/重试及 assessment reset；状态视图保留原文案、classes、DOM、testid 与 store action，`stopRoomLocalTracks` 移入纯 `roomAudio` 并从原入口兼容导出。12 个交付文件独立 APPROVED，本地单提交 `0902aee45fc2de6d1050fd4610b8c9c9835108de`；lane 私有验证完成 13 个迁移函数体与 Room 资源 effect 等价核验、两项 cleanup/reentry 变异并精确还原；恢复后 908 项 Vitest 复验通过。main 标准全量复验执行 frontend10、OpenAPI schema、Ruff 与 backend，正常 hook 通过且批准文件 hash 一致；私有等价核验与变异未在 main 重跑（见 [RF-11 VoiceInterface 行为拆分验证](../../docs/verification/cross-platform/RF-11-VOICE-COMPONENTS.md)）。
      本地已完成 SettingsDrawer 行为拆分（A69-B，独立 Review APPROVED）：公共入口只保留公共 props、打开 fetch、loading/saving/store error、外壳和模块组装；新增 `useSettingsDialog` 独占原生 dialog/焦点/滚动/键盘/backdrop 清理，`useSettingsForm` 在 `open=false` 仍挂载并独占草稿、后端对象引用水合、内存 key、显式保存及本地提示，`SettingsAppearance` 与 `SettingsProviderFields` 承接稳定视图。既有 `buildSettingsUpdate`、Provider 选项/顺序/默认、免费账号 custom 约束、主题 local-first、原文案/DOM/classes/label/id 与网络语义保持；本地 toast timer 绑定打开周期和操作序号，重复错误各享完整 3 秒、成功 2 秒，close/reopen/卸载后的旧成功/失败及 stale 结果静默，新周期保存可恢复，且不自动取消/重发 PUT。r1 修复 `installStore` 实际 action 所有权、Provider 三种真实 fixture，并恢复 logout 失败提示持久语义。A69 定格于本地单提交 `0936ea335dff8fdce8d307da10461ed2b8dec6a5`；lane 私有验证执行 4 项真实组件/store 消费探针及两项有效通知变异，源码已还原。main 标准全量复验执行 frontend10（Vitest 917/32 files、build-script 18、Fake API 61、typegen 8、双浏览器 E2E 148）、OpenAPI schema、Ruff 与 backend（540 passed/3 warnings/79.41%），正常 hook 通过且批准文件 hash 一致；main 未重跑私有探针/变异（见 [RF-11 SettingsDrawer 行为拆分验证](../../docs/verification/cross-platform/RF-11-SETTINGS-COMPONENTS.md)）。
      RF-11 计划中的 schema 生成链路、统一 Transport（认证/超时/取消/Header/错误/origin）、state 模型及 VoiceInterface/SettingsDrawer 行为边界均已完成本地代码验收，故整项勾选为“本地代码验收完成”。该勾选不表示 UI 主动 abort 已接入全部 store，也不表示生成类型已替代其余手写 domain 适配，或真实 IdP/Provider/LiveKit/设备/远端新 CI 已验收；这些边界继续独立保留。

## P0 — 安全边界

- [x] 独立 Vite 7.x 安全补丁（[#92](https://github.com/sunpcm/EchoTalk/pull/92)）：
      声明和所有锁定实例统一为 7.3.7，冻结安装和 CI 通过；不代表 RF-12 整体完成。
- [x] 后端用真实 JWT 校验替换 `get_current_user` Mock；验收：无效或过期 Token 返回 401。
- [x] 前端从 Auth 模块获取 Bearer Token，移除固定的 `mock-token`；验收：登录态变化能正确影响 API 请求。

## P1 — 功能完整性

- [x] 统计最近七个本地自然日的 completed 会话次数：按既有 `started_at` 半开区间分桶，
      含零值桶、认证用户隔离和时区/DST；支持按日显式分页只读历史，不产生新评分。
- [x] 统计截至 `end_date` 的滚动七个本地自然日语法错误记录 Top 3 并展示固定改善提示
      （非个性化生成）：按错误记录条数计数，固定六类且未知项合并为 `other`，以 count
      降序、规范 tag 升序稳定排序后最多返回三项；当前生产分析链仍为 demo，真实记录为空
      时返回合法空态，不声称零错误或分析完成。

## P2 — 质量与维护

- [x] 每日进度与技能掌握度进度条提供可访问名称、范围和值（[#90](https://github.com/sunpcm/EchoTalk/pull/90)）；
      回归覆盖每日 0/5/20/25 完成量，超目标时数值封顶、文本保留实际总量。
- [x] 清点主题 token：保留 Webpack 正在使用的 `brand-*`，处理未使用的 `scrollbar-thumb`、`header-bg`（A32 本地独立评审通过）；
      删除无运行时引用的 2 个主题 token 并修复 ActiveSessions 确认面板背景透明与边框继承缺陷，双浏览器逐主题 computed 变量解析验证通过，见 [主题 token 审计与确认面板验证](../../docs/verification/cross-platform/CP-05-THEME-TOKENS.md)。
- [x] 将 Vite 入口的 `<html lang="en">` 改为 `zh-CN`。
- [x] 将主题保存到后端 `user_settings.theme`，支持跨设备水合（A28 本地独立评审通过）；
      客户端 local-first、认证与代际绑定、单在途意图串行合并与水合竞争防护经本地回归通过；
      不代表真实双物理设备验收，见 [主题同步验证](../../docs/verification/cross-platform/CP-05-THEME-SYNC.md)。
      A31 补充浏览器 localStorage 异常容错（SecurityError/QuotaExceededError 读写安全回退、
      不阻断 UI/store 与后台 PUT 同步、成功水合不误判 API 失败、恢复后正常持久化），
      见 [主题缓存容错验证](../../docs/verification/cross-platform/CP-05-THEME-STORAGE.md)。
- [x] 统一主题按钮边框宽度，消除选中时 1px 布局抖动（A28 本地独立评审通过）；
      主题单选按钮统一使用 2px 固定边框，窄屏、默认与 200% 字号下选择前后内容位移为 0，见 [验证](../../docs/verification/cross-platform/CP-05-THEME-SYNC.md)。
- [x] 为颜色过渡和抽屉动画支持 `prefers-reduced-motion`（A27 本地独立评审通过）；
      CSS 媒体查询支持 reduce 与 no-preference 真实浏览器 computed、抽屉动画消除与
      loading spinner 保留，零 JS 注入与零隐式业务写。见 [验证](../../docs/verification/cross-platform/CP-05-REDUCED-MOTION.md)。
- [x] 按主要容器补齐主题颜色过渡，避免子元素瞬间切色（A35 本地独立评审通过）；
      为 #root 注入 theme-transitions 作用域，补齐主要容器、卡片、设置抽屉及显式文本 250ms ease 颜色过渡，
      保持 box-shadow 150ms 与 hover 能力，兼容 reduce 偏好与 WAAPI 插值中间态验证，见 [主要容器主题过渡验证](../../docs/verification/cross-platform/CP-05-THEME-TRANSITIONS.md)。
- [x] 移除生产 LiveKit SDK 消息访问路径的 SDK 类型忽略（2026-11-09 核销，证据同上方候选项），改用类型收窄或兼容适配层；
      验收只限定真实生产消息读取及消费路径，并取得当前 SDK 类型与调用证据。无关测试文件中的
      类型忽略不构成本项产品缺陷，也不能据此勾选本项。

## 三端交付计划（Web / macOS / iOS）

### CP-00：基线与验收准备

- [x] 记录当前前后端检查结果、iOS 运行方式和设备/OS；验收：区分既有失败、本轮回归、模拟器与真机证据。
- [x] 建立三端验收矩阵和证据目录；验收：覆盖登录、语音、结束、分析、报告、设置、DocTalk 与异常恢复，记录结果及复现步骤，不记录凭据或用户原始音频。
- [x] 核实测试数据库隔离；验收：后端集成测试仅连接明确的独立测试库，设备测试使用专用测试账号。

### CP-01：平台边界与配置（首个代码阶段）

- [x] Web生命周期事件薄适配器：无副作用工厂、订阅清理/恢复快照、SSR降级与原生能力不可用经独立验收；未接业务与原生事件，见[验证](../../docs/verification/cross-platform/CP-01-WEB-LIFECYCLE.md)。
- [x] 集中 API/LiveKit 地址选择，修正 `/api/api`，生产原生配置限制 HTTPS/WSS；验收：Origin 与含 `/api` 地址、尾斜杠、非法配置、Web 同源、原生直连/代理均有回归覆盖。
- [x] 增加可复现的 iOS build + sync 命令，隔离平台/环境产物并校验 Turbo 缓存输入；验收：Web/iOS 连续切换构建不会复用错误配置，Release 不含开发 Token 或开发 API 地址。
- [x] Dashboard生命周期只读发现接线：恢复前台/网络时刷新，后台离线门禁、旧请求与账号隔离通过本地独立验收；不代表恢复通话，见[验证](../../docs/verification/cross-platform/CP-01-LIFECYCLE-DISCOVERY.md)。

### CP-02：会话可靠性与恢复契约

- [x] 结束接口幂等，客户端结束时立即停止采音；验收：响应丢失后重试、重复点击和并发结束均返回一致最终状态，不重复创建分析任务。
- [x] 创建会话支持请求幂等标识；验收：同一用户同一请求重试返回原会话，不同请求正常创建，复用标识但请求体不同被拒绝。
- [x] 共享 Dashboard 只读活动会话发现增量；验收：加载/空/列表/失败重试、精确账号与代际隔离及未知模式回退通过本地独立评审。仅发现记录，不代表房间在线或可恢复，见 [发现验证](../../docs/verification/cross-platform/CP-02-DISCOVERY.md)。
- [x] 客户端通话能力发现与开始门禁；验收：严格协议/no-store、失败及Cloud不可用时不创建会话，认证失效释放旧启动且可显式重试，本地回归通过；尚未支持Cloud占用客户端/恢复/接管。
- [x] 客户端占用API原语：claim/heartbeat/release及token/dispatch可选owner头；精确schema/关联校验、默认不接管和不重放经本地独立验收。仅API层，Cloud开始门禁保留，见[验证](../../docs/verification/cross-platform/CP-02-LEASE-API.md)。
- [x] 独立客户端占用控制器：显式claim、心跳/到期watchdog、同tuple释放重试、代际/身份隔离与清理通过本地独立验收；未接UI/媒体/Cloud门禁，见[验证](../../docs/verification/cross-platform/CP-02-LEASE-CONTROLLER.md)。
- [x] Dashboard显式结束已发现的活动记录：确认/取消、失败同ID重试、认证意图代际与在途保护通过本地独立验收；不表示其他端媒体停止，见[验证](../../docs/verification/cross-platform/CP-02-DISCOVERY-END.md)。
- [x] ActiveSessions文件头已随显式恢复开发同步更新为发现/结束/恢复，关闭P2过期注释。
- [x] disabled模式已有会话显式恢复：确认后重新核验身份/能力/详情/Token且零create，store及UI取消/代际隔离经本地独立验收，见[验证](../../docs/verification/cross-platform/CP-02-EXPLICIT-RECOVERY.md)。
- [x] Agent调度HTTP失败本地闭环：当前失败停止本地音轨、清Token/卸载房间并展示安全提示；单次调度、来源/代际隔离及失败后显式操作经独立验收，见[验证](../../docs/verification/cross-platform/CP-02-AGENT-DISPATCH.md)。真实媒体、连接离线及Token过期恢复仍待下项。
- [x] 连接失败与Web中断本地闭环：SDK错误/断开、后台离线同步停止音轨，旧回调与监听隔离、无自动重连和显式新操作经独立验收，见[验证](../../docs/verification/cross-platform/CP-02-CONNECTION-FAILURE.md)。

### CP-04：三端真实登录与凭据生命周期

- [x] 共享客户端本地认证生命周期：账号清理、迟到响应/401隔离、StrictMode在途callback单次交换和来源归属通过独立评审及隔离集成；详见 [CP-04 本地验证规范](../../docs/verification/cross-platform/CP-04.md)。仅此本地增量完成，以下真实三端验收项仍待完成。

### CP-05：生命周期与响应式体验

- [x] 回答推荐全文换行、44px触控及复制反馈归属：620产品/18构建脚本/104默认双浏览器、8独立时序/12独立浏览器及两有效变异通过；见[验证](../../docs/verification/cross-platform/CP-05-ANSWER-RECOMMENDATIONS.md)。真实系统剪贴板权限仍待验。
- [x] DocTalk设置页标题/返回重排、44px触控及窄屏大字号：606产品/18构建脚本/82默认双浏览器、22独立浏览器和两有效变异通过，见[验证](../../docs/verification/cross-platform/CP-05-DOC-LAYOUT.md)。OS键盘与硬件safe-area仍待验。
- [x] DocTalk本地文件导入保稿、UTF-8/长度校验与迟到读取隔离：606产品/18构建脚本/62默认双浏览器、11独立时序+18浏览器探针及两有效变异通过，见[验证](../../docs/verification/cross-platform/CP-05-DOC-IMPORT.md)。真机文件选择器验收项继续保留。
- [x] 活动列表响应式、完整确认ID与44px触控：578产品/18构建脚本/56默认双浏览器、22独立布局探针和两有效变异通过；见[验证](../../docs/verification/cross-platform/CP-05-ACTIVITY-LAYOUT.md)。
- [x] 恢复失败与真正取消按会话代际区分，专用错误/完整目标/显式重试恢复；588产品/18构建脚本/60默认双浏览器、12独立失败路径+2时序探针及两有效变异通过，见[验证](../../docs/verification/cross-platform/CP-05-RESUME-ERROR.md)。
- [x] 设置抽屉命名模态、完整键盘到达/焦点恢复、44px触控与窄屏横屏大字号：578产品/26浏览器探针+3资源单测/38默认E2E通过；见[验证](../../docs/verification/cross-platform/CP-05-SETTINGS-DRAWER.md)。真实OS键盘和非零safe-area仍待验，全局布局项继续保留。
- [x] 活动列表区分尚未查询与确认空，精确身份查询事实及迟到隔离：574产品/14独立探针/22双浏览器通过；同步修正分析hook旧Web注释，见[验证](../../docs/verification/cross-platform/CP-05-DISCOVERY-QUERY-STATE.md)。
- [x] Room原生就绪挂载门禁、10秒安全退出、后台同步停轨与健康渲染保护：565产品/20独立探针/双浏览器22项及iOS build+sync通过；见[验证](../../docs/verification/cross-platform/CP-05-NATIVE-ROOM.md)，真实系统音频中断/路由仍待验。
- [x] 开始/显式恢复原生就绪门禁、10秒安全退出与旧意图隔离：547产品/30独立探针/双浏览器22项；见[验证](../../docs/verification/cross-platform/CP-05-NATIVE-STARTUP.md)。Room后续已由A19本地接线，真实OS仍待验。
- [x] 活动列表与分析页消费iOS原生生命周期：525产品、35独立探针、双浏览器22项通过；见[验证](../../docs/verification/cross-platform/CP-05-NATIVE-CONSUMERS.md)，通话启动/Room仍待接线。
- [x] iOS原生生命周期薄适配器与统一工厂：509产品/22独立探针/双浏览器22项、本地iOS build+sync通过，见[验证](../../docs/verification/cross-platform/CP-05-NATIVE-ADAPTER.md)；业务消费者仍待接线。
- [x] 分析页Web后台/离线暂停与恢复安全轮询：472产品、27独立探针、双浏览器22项通过；见[本地验证](../../docs/verification/cross-platform/CP-05-ANALYSIS.md)，原生OS仍待验。

### CP-06：自动化与真实链路回归

- [x] 本地双浏览器门禁：保留完整质量检查，Chromium/WebKit各11项，覆盖分析/恢复/401边界、0skip；CI安装接线已更新，见[验证](../../docs/verification/cross-platform/CP-06-WEBKIT.md)。

### 后续候选（不阻断本轮）

- [x] 将回答推荐scope键的id/text直接拼接替换为无歧义元组编码，并覆盖分隔符外部ID（A33 本地独立完成，见 [回答推荐作用域编码验证](../../docs/verification/cross-platform/CP-05-ANSWER-SCOPE.md)）；消除冒号等外部ID边界碰撞。
- [x] 强化 `SettingsDrawer`/`useSettingsForm` 的 LLM 模型水合回归：真实组件与 Hook 必须先
      断言初始缺省值，再覆盖 `llm_model: null` 到既有默认值、`null` 后切到合法自定义模型文本
      的实际水合与消费断言；另需证明合法默认值切换会被真实读取路径消费。不得只断言配置文档
      字符串或静态映射。A80 b/r0 已补齐真实组件与 Hook 消费回归，并在隔离测试文件用合法
      替代 LLM 默认证明初始草稿和空值水合确实读取 metadata 来源；生产行为未改，当前停在
      Review，主 Agent 受控检查与 main 复验结果尚不在本项冒认。
- [x] 修正分析hook头部旧Web措辞；列表原生状态未就绪区分尚未查询与已确认空，A20已关闭A17 P2。
- [x] Fake API严格解析带项目后缀的analysis-success/failure与grammar路径并补真实Node子进程回归（test:fake-api），同时修复Fake API缺失必需theme字段的schema问题（A29本地独立评审通过）。

## RESTORE-20261107 文档收口

本段替换 delivery r0 候选追加，不改写上方从
`42c61bb08f5e234989198ef46ed7534a80c70796` 恢复的原文。上方历史 CI 与已验记录只属于
当时提交。本候选没有 push，也没有本轮远端 CI。这里的 Node 回归不能代替 native
App、Xcode、Rust 构建或设备验收。真实 Provider、IdP、LiveKit、语音、生产部署和原
Compose 整栈未验。根格式与保全回执见主控交付报告，这里不预告根格式通过。

本段不关闭上面尚未勾选的 Android、Windows、后台持续语音及其他需求，也不写入主
checkout 未提交的 TODO 候选或 `docs/triage/`。

本轮只收口被误回退后已恢复的交付记录。主控在 `echotalk_restore_test` 上迁移到
`c06_transcript_events` 后，backend pytest 为 794 passed、3 warnings、覆盖率
78.84%，59% 门禁保持。资源身份和验收见 `docs/agent-review-loop.md` §19。
