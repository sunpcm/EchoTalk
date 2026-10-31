# EchoTalk TODO

> 当前唯一待办清单。完成事项应直接勾选；新增待办需写明验收条件，避免继续散落到阶段文档和源码注释中。

## MVP 产品化修复（RF-01～RF-12）

> 权威边界与验收细则见
> [MVP 技术债修复与重构方案](./docs/MVP_REFACTORING_REMEDIATION_PLAN.md)。
> 执行顺序固定为“可靠性修复 → 架构减法 → 内部重构 → 受控升级”；只有对应自动化、
> 迁移、运行时和外部边界证据齐全后才能勾选。

### 执行基线

- 基线：`origin/main@30f51f3175de20bc827ebdf29789ad934096133d`
- 分支：`codex/mvp-remediation`
- Worktree：
  `/Users/sunpcm/Documents/Codex/2026-09-08/new-chat/work/EchoTalk-mvp-remediation`
- 初始前端基线：冻结锁安装成功；格式检查失败；Lint/Typecheck 通过但复用了旧 worktree
  Turbo 缓存；Vitest 71 项通过但包含 6 个 “no tests” 伪任务；Playwright 仅有 1 个
  `expect(true)` 占位测试。
- 初始后端基线：Pytest 113 项通过并有 8 个 warning；Black 有 9 个文件待格式化；
  Flake8 报告 38 项；当前依赖未锁定且一次安装解析出 176 个包。
- 初始运行时基线：`docker compose config --quiet` 因干净检出缺少强制 `.env`
  失败；尚无 PostgreSQL 空库迁移门禁。

### Phase 0：可信质量基线

- [ ] **RF-04 CI 真实性**：真实 Web + Fake API E2E 覆盖健康检查、创建/结束会话、
      分析成功、分析失败与失败后退出；统一 Ruff；PostgreSQL 空库迁移与合理覆盖率进入
      CI；聚合 `CI` 仅在必要任务全部成功后通过。当前本地配置已将 `test-frontend` 对齐
      10 项真实质量门禁，并在 backend job 增加 tracked OpenAPI schema 漂移检查。A64 的
      PR #109 已有真实远端 Linux 证据：精确 head
      `b7585d140ecc6ad4f45580fabe71e32c9c51466b`、merge
      `c704925bc9150d153fc951c2727e7472dad00d78` 的 run 41220439360 中，
      `test-frontend`、`test-backend` 与聚合 `CI` 三 job 均 success，前端旧 8 项门禁为
      854 Vitest/18 build-script/61 Fake API/Chromium+WebKit 148，后端为空库迁移至
      `c06_transcript_events` 后 529 passed、82.49%；见
      [CI 质量门禁验证](./docs/verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。
      旧远端证据不包含 A67 新增的 OpenAPI schema 与 TypeScript 类型生成两层门禁，这两层
      尚未在远端当前树执行，且 A65–A69 未 push；因此 RF-04 整项继续保持未勾选。

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

### Phase 4：架构减法

- [ ] **RF-05 精简基础设施**：确认调用证据后删除无价值的 Redis/Celery/周报骨架和
      Chroma/重型 ML 依赖；确定性课程推荐保持业务用例，并记录镜像体积与冷启动对比。
- [ ] **RF-06 清理前端模板**：引用审计后删除无调用者的 Webpack、UI 模板、Changesets、
      Plop 和一次性脚本；根包元数据、workspace、Turbo、Docker 和 Capacitor 保持一致。
      本地已完成根包项目语义与一次性诊断脚本清理（A47）：根目录 `package.json` 规范声明 `name: "echotalk"`、准确 `description`、显式声明 `private: true` 并删除无目标的无效 `main: "index.js"`；引用审计确认根目录 `test_api_err.ts` 仅在手册中有说明且无任何自动化测试或工程调用，完成安全删除并同步更新评审手册；保留 Webpack/ui-lib/Plop/Changesets 等工具与模板链条；见 [RF-06 根元数据与一次性诊断清理验证](./docs/verification/cross-platform/RF-06-ROOT-CLEANUP.md)；前端模板深度精简仍待后续推进，整项保持未勾选。

### Phase 5：依赖、迁移和运行时统一

- [ ] **RF-07 可复现依赖**：后端成为真实 uv 项目并提交完整 `uv.lock`；API、Agent、
      Dev 依赖分组；CI/Docker frozen 安装；Python 3.12、Node 22 与固定 pnpm 版本统一。
      本地已完成后端 Python 3.12 标准 uv 项目化（`echotalk-backend`，`.python-version` 3.12），
      生成并本地集成完整 192 包 `uv.lock`，严格保留 172 项 baseline 版本及 LiveKit 7 项 exact SDK 版本；
      A37 完成依赖分组裁定落地（先拆 Dev 四项，运行时保持共用）：26 项保留默认 runtime，`ruff`、`pytest`、`pytest-asyncio`、`pytest-cov` 迁入 `[dependency-groups].dev`；
      `requirements.txt` 作为锁导出的单一 runtime-only 兼容入口（跨平台导出 184 条，本机安装 165 包，排除四项开发工具）；
      CI 安装显式指定 `--group dev`，Docker 配方统一补 `--no-dev`，保持环境与生产镜像最小化；
      全新隔离环境 `.review/rf07-a37-dev-venv` (172包) 与 `.review/rf07-a37-runtime-venv` (165包，0 dev工具) 经受控离线护栏工具核验通过；
      旧 `backend/.venv` 及 A36 `.review/rf07-venv` 保持只读；
      当前 API/Agent 进一步分组、Linux/Docker 实际构建及跨平台验收尚待完成，整项保持未勾选。
- [ ] **RF-08 迁移与时间语义**：移除 lifespan Mock 播种；参考数据显式且幂等；
      timezone-aware UTC、必要索引和有界分页完成；空库及现有数据库副本迁移均通过。
      本地已完成启动播种子项显式幂等化（A38）：lifespan 仅保留安全配置验证并移除隐式写库播种；
      新增 `seed_reference_data.py` 显式播种模块与 CLI 入口，严格复用 `models.knowledge.SEED_SKILLS`（10 项），
      使用 PostgreSQL 原生 `INSERT ... ON CONFLICT DO NOTHING` 保持已有记录不变；强制校验显式 `DATABASE_URL`，
      禁止回退 `.env`，模块导入及 `--help` 零 DB 访问，错误路径严格脱敏；回归测试在隔离 test schema 下验证并发与幂等；
      上线前运维需显式执行播种命令（见 [RF-08 启动参考数据显式幂等化验证](./docs/verification/cross-platform/RF-08-REFERENCE-SEED.md)）；
      本地已完成时间列 timezone-aware UTC 语义统一（A39）：ORM 模型七列（users.created_at、sessions.started_at/ended_at、user_settings.updated_at、knowledge_states.updated_at、pronunciation_assessments.created_at、grammar_errors.created_at）显式声明 DateTime(timezone=True)，保留既有 nullable 属性；新建纯 stdlib time_utils.utc_now 并替换全量 datetime.utcnow()；schemas/time.py 声明 UtcDatetime 拒绝 naive 输入并将偏移归一至 UTC，响应 JSON 显式时区；c04_utc_timestamps 迁移脚本经 Codex 独立审查通过（SHA256: 3cb19d3f39c166f7e5e93587779d99240a8e2ac90cdbc1edf4c476d80425f612）且在专用测试库合成副本完成演练；新增 test_utc_timestamps.py 覆盖元数据、归一化、PG 真实读写与写入路径，既有测试消除弃用警告（见 [RF-08 七列 UTC 时间语义验证](./docs/verification/cross-platform/RF-08-UTC-TIMESTAMPS.md)）；
      本地已完成必要查询索引方案与迁移声明（A40）：新增三项非唯一 B-tree 索引（sessions(user_id, started_at DESC, id DESC) 名 ix_sessions_user_started_id、transcripts(session_id, timestamp_ms) 名 ix_transcripts_session_timestamp、grammar_errors(session_id, created_at) 名 ix_grammar_errors_session_created）；模型元数据与 Alembic c05_query_indexes 脚本对齐，降级严格逆序 drop；复用 assessment(session_id) 与 knowledge(user_id, skill_id) 已有唯一约束/索引避免冗余；保留 grammar_errors 既有 partial 索引；新迁移经 Codex 独立静态审查，专用测试库空副本与 25 万行合成副本 upgrade/downgrade/re-upgrade 通过，自然 EXPLAIN 均使用目标新索引（不代表真实环境性能验收）（见 [RF-08 三项必要查询索引验证](./docs/verification/cross-platform/RF-08-QUERY-INDEXES.md)）；
      本地已完成会话游标分页与每日聚合方案（A41）：`GET /api/sessions` 与 `GET /api/sessions/active` 升级为 `{ items, next_cursor }`，严格仅读取 5 个必要列，彻底杜绝 ORM selectin 级联查询与正文加载；游标采用标准库 canonical URL-safe base64、严格整型版本与端点/用户/窗口上下文严格比对校验，每页数据库查询始终强制 `user_id == current_user.id` 过滤（自包含无状态校验，非 HMAC 签名凭证，不提供抗恶意改写完整性保证，格式或上下文不符返回 422）；新增 `GET /api/sessions/daily-progress` 单 SQL 服务端聚合；前端 `DailyProgress` 并行双只读请求与自然日 DST 兼容时间窗，跨午夜清空旧数据与生命周期挂起作废在途；`ActiveSessions` 仅显式点击加载更多，结束/恢复操作与加载更多互锁，生命周期挂起作废在途；Fake API 与 E2E 测试严格对齐后端契约与边界校验（见 [RF-08 会话游标分页与每日聚合验证](./docs/verification/cross-platform/RF-08-PAGINATION-DAILY-PROGRESS.md)）；
      有界分页已完成本地代码与测试闭环，真实环境性能与生产迁移待后续完成，整项保持未勾选。

### Phase 6：内部边界

- [ ] **RF-09 LiveKit Agent 拆分**：Orchestrator、CredentialResolver、ProviderRegistry、
      TranscriptSink 和 ErrorMapper 边界落地；无 `sys.path` 注入、导入时 dotenv、敏感
      环境变量临时删除或 SDK 私有属性访问；后台写入可排空、可观测、可重试。
      本地已完成 Agent 安全错误映射与出口边界落地（A42）：建立单一安全边界 `AgentErrorMapper`，
      固化 9 项错误码全集与静态安全本地化文本映射，阻断异常正文、密钥与 URL 向客户端回显；
      运行时错误严格分类（401/403 映射为 ERR_CUSTOM_RUNTIME_AUTH，不可恢复错误映射为 ERR_CUSTOM_RUNTIME，
      可恢复与基础轨交 SDK 原生处理）；最终发送入口接入安全 mapper，publish 异常脱敏且保持断连；
      清理入口日志中私有 `ctx._info.url` 读取与 raw identity 输出；离线 Mock 与 Canary 审查回归通过；
      本地已完成转录事件稳定标识与数据库幂等落地（A43）：基于 c06_transcript_events 迁移建立 (session_id, event_id) 复合唯一约束（普通 NULL 语义保留历史兼容，禁止 NULLS NOT DISTINCT）；ORM 模型声明 event_id 与同名约束；save_transcript 支持原子幂等 INSERT ON CONFLICT DO NOTHING，首写 metadata 严格保持，重放一致性校验（相同 role/content/emotion 及显式时间戳返回原记录，冲突 payload 安全拒绝，未传时间戳允许时钟前进），commit 成功确认失败重试保证单条；两生产入口基于 SDK ChatMessage.id 稳定派生 UUID5，缺失/非法拒绝写入零降级；真实 PostgreSQL 并发 Barrier、跨 session 隔离、多 NULL 及每日聚合不重复回归通过；
      本地已完成有界内存 TranscriptSink 与故障会话终止（A44）：建立会话级独立有界队列（256 pending + 1 inflight），同步非阻塞接纳，拒绝空白/非法角色/坏 UUID 事件；深拷贝快照与未显式时间戳严格保持 None；每事件最多 3 次写入尝试（1 首次 + 2 重试），单次 2.0s 合作式超时，(0.25, 1.0) 秒退避；满队列或重试耗尽同步停止接纳，至多触发一次异步故障通知（自定义轨 ERR_CUSTOM_RUNTIME / 基础轨 ERR_SYSTEM_RUNTIME），保持安全错误分类与会话终止；8.0s 总排空预算，超时或取消强制收束自有 worker/writer/notify 任务，记账恒等式 accepted == succeeded + failed + pending + inflight 严格保持；双入口接线共享同一 job sink 并通过 ctx.add_shutdown_callback 注册生命周期；修复 A43 P2 并发 Barrier 实际连接 PID 观测；离线矩阵与真实 PostgreSQL 确认丢包重发回归通过（见 [RF-09 有界内存 TranscriptSink 验证](./docs/verification/cross-platform/RF-09-TRANSCRIPT-SINK.md)）；
      本地已完成自定义凭据解析边界落地（A45）：将 PluginInitError 抽离至无 SDK/网络依赖的统一异常模块 plugin_errors，plugin_factory 保持完全向后兼容导出与异常捕获兼容；新增独立纯净 CredentialResolver，封装 ResolvedCustomCredentials 不可变快照，明文密钥 repr=False 并在 repr/str 中脱敏掩码，禁止记录明文、密文与 key_version；严格保证 6 项必填预检顺序（3 provider -> 3 key），未齐备前零解密、零 factory 构造；按 STT/LLM/TTS 顺序依次解密，任一解密失败立即抛出静态安全 ERR_CUSTOM_KEY_INVALID，终止后续解密，底层异常脱敏不泄露；透传各 key_version（含 None legacy 值），支持 custom model 与 default fallback；agent.\_build_custom_plugins 接入统一 resolver，消除重复预检解密逻辑，原敏感系统环境变量防护与 finally 恢复保持原语义；基础轨 entrypoint 零 resolver/零 decrypt/零 encrypted 访问，自定义轨安全断连错误码保持不变（见 [RF-09 自定义凭据解析边界验证](./docs/verification/cross-platform/RF-09-CREDENTIAL-RESOLVER.md)）；
      本地已完成自定义插件显式凭据构造与零进程环境改写落地（A46）：彻底移除 agent.py 中 import os、\_SENSITIVE_ENV_VARS 常量定义及 \_build_custom_plugins 内对 os.environ 的临时 pop/update 改写逻辑；基于 PluginFactory 既有 API Key 强校验（拒绝 None/空/空白/换行/CR/null/非 str 并返回 clean key），实现显式传参直连 SDK 构造器，杜绝降级回退读取系统环境变量；每个 SDK constructor 调用瞬间及返回后环境严格不变；测试适配精确 patch.dict 隔离环境，消除 A45 P2 遗留的环境恢复风险；覆盖五敏感 env 均存在/部分缺失、成功/异常/invalid role key/并发与嵌套构造、三 role 归属互不串扰、VAD 纯 mock 无网络及全链路 Canary 脱敏审计（见 [RF-09 自定义插件显式凭据构造验证](./docs/verification/cross-platform/RF-09-EXPLICIT-KEYS.md)）；
      本地已完成 ProviderRegistry 插件集构造收口边界落地（A48）：新增独立 pure-boundary ProviderRegistry，提供 from_custom(resolved: ResolvedCustomCredentials) 与 from_system_defaults() 统一收口自定义轨与基础轨插件集构造逻辑；仅接收已解密不可变快照，杜绝接触 ORM、零自行解密、零环境改写且零配置兜底；实际构造严格委托 PluginFactory，保持 STT → LLM → TTS → VAD 顺序与任一失败快速短路；agent.py 移除未使用的 PluginFactory 导入，\_build_custom_plugins 与 entrypoint 统一委托 ProviderRegistry；基础轨零用户凭据与解密访问；既有测试适配 ProviderRegistry patch 路径且断言不削减；真实新增 14 函数/19 用例，模块有运行时 snapshot 依赖（import 用于 isinstance 校验），基础轨零 resolver 调用/零解密；Canary 新测试只验证 repr 且 env 新测试仅前后，构造中 env 与日志原 A46 回归承担；变异测试（wrong-role key 与漏构造 role）及全链路回归通过（见 [RF-09 ProviderRegistry 插件集构造验证](./docs/verification/cross-platform/RF-09-PROVIDER-REGISTRY.md)）；
      本地已完成 AgentJobOrchestrator 生命周期边界落地（A51）：新增独立 `job_orchestrator.py`，承载单次 Job 的连接、等待参与者、TranscriptSink 实例与单一 shutdown callback 管理、AgentSession 事件接线与启动及未成功时清理；entrypoint 保留 DB 配置查询、双轨分支、ProviderRegistry 与 EchoTalkAgent 构造；显式传入工厂与回调保留测试 patch 路径；零反向 import agent、零 DB/config/凭据读取；每 job 独立状态隔离，模式读取时点不漂移；失败与取消正确收束自有 Sink；全链路回归通过（见 [RF-09 AgentJobOrchestrator 生命周期边界验证](./docs/verification/cross-platform/RF-09-JOB-ORCHESTRATOR.md)）；
      本地已完成安全错误发送与断连出口收敛（A56）：新增纯标准库 + `AgentErrorMapper` 依赖的独立 `error_delivery.py`（`send_error_and_disconnect`），消除 `agent._send_error_and_disconnect` 与 `job_orchestrator._default_send_error` 重复的错误映射、JSON 载荷构造、`publish_data` 与 `disconnect` 实现；保留两个旧包装函数签名、默认值与可 patch 兼容委托；保持 `echotalk-agent` 安全日志文本、普通 publish 异常仅告警仍断连、disconnect 异常原样传播及 publish 阶段 `CancelledError` 原样传播不擅自断连；全链路回归通过（见 [RF-09 安全错误发送出口收敛验证](./docs/verification/cross-platform/RF-09-SHARED-ERROR-DELIVERY.md)）；
      本地已完成运行时错误通知任务所有权与关闭收束（A57）：消除 `AgentJobOrchestrator` 中未被追踪的 `asyncio.ensure_future`，每个编排器实例独立追踪自有运行时错误通知任务，完成回调自动移除任务并安全检索异常（仅写静态安全警告，杜绝异常正文/密钥/room 原文或 traceback 泄露，`CancelledError` 安全检索无 unretrieved 告警）；单一组合 shutdown callback（`orchestrator.close`）替代原 `sink.close` 注册，同步标记 `closing` 阻断迟到错误回调，按命名类常量 `ERROR_TASK_DRAIN_TIMEOUT_SECONDS = 2.0` 合作式排空并在超时或取消时强制 cancel + await 收束，保留 `TranscriptSink` 8.0s 排空预算与原 `bool` 返回值语义，排除当前任务自身防 `disconnect` 重入自锁；`setup`/`start` 失败与取消均完整清理，全链路回归通过（见 [RF-09 运行时错误通知任务生命周期验证](./docs/verification/cross-platform/RF-09-ERROR-TASK-LIFECYCLE.md)）；
      本地已完成公共 Sink 通知重入边界落地（A58）：在 `TranscriptSink` 建立小型公共行为查询 `is_failure_notification_task(task=None) -> bool`，只返回目标任务（默认当前任务）是否为本 Sink 的故障通知任务，不暴露内部 Task 对象，不改变 Sink 内部状态；`AgentJobOrchestrator._close_sink` 接入该公共行为查询，彻底消除对 `sink._notify_task` 私有属性的耦合；保持 `TranscriptSink` 原 close 流程、8.0s 排空预算、状态记账与 A57 错误通知 2.0s 预算完全不变；真实 Sink 故障通知回调触发“通知→disconnect→Orchestrator.close→Sink.close”重入经真实用例验证无自锁、无自取消且所有自有任务完全收束；关闭 A57 遗留两项文字 P2（`PROJECT_STATUS` 修正新增测试数实际为 12，核验并记录 `test_error_task_lifecycle.py` 装饰器真实文件情况）；全链路回归通过（见 [RF-09 公共 Sink 通知重入边界验证](./docs/verification/cross-platform/RF-09-SINK-REENTRY-BOUNDARY.md)）；
      本地已完成重入回归测试有界失败与资源清理落地（A59）：为 `test_sink_reentry_boundary.py`、`test_error_task_lifecycle.py` 与 `test_transcript_sink.py` 建立独立外部完成观察预算与轻量等待 helper（`_wait_bounded` / `_poll_bounded`，2.0s 预算），`_wait_bounded` 改为显式持有 Task 并通过 `asyncio.wait(timeout)` 观察，到期不在观察函数中无限等待取消完成（规避底层 shield 延迟响应取消导致测试卡死无法进入 finally），由 finally 接管，新建观察 Task 自动登记与回收；建立协调任务收束机制（`_cancel_and_wait_tasks` / `_cleanup_test_resources`），在 `finally` 块中释放自建 gate（`allow_reentrant_close`、`disconnect_entered` 等），一次性收集测试装置拥有的外部 Task、Orchestrator 共享 `_sink_close_task` 与错误任务以及 Sink worker/notify/close 任务，统一发起取消解开 shield 依赖并收束，检索所有（含早已完成）任务异常，对最终 pending 明确报错并给出任务名称；多资源清理保证前项失败不跳过后续资源；严格区分“真实正常关闭”与“强制清场”，移除测试 helper 篡改 `sink._closed=True` / `sink._accepting=False` 伪造终态的做法；重入调用直接在通知原 Task 中 await 保持 Task 身份，断言通知 Task 身份与非取消回退；修正并统一文档与注释中显式 `task=None` 语义（明确与无参调用一致均指当前任务，纠正任何情况下均 False 的错误表述并在矩阵中覆盖）；新增 2 项负向测试（验证通知未到达在短预算内超时并收束任务，及模拟重入查询失效关闭互等死锁并收束清场）与 2 项故障路径验证（验证延迟响应取消外部完成观察预算先到期抛错及步骤失败时清理其余自有资源）；使重入回归在变异场景下确定性失败退出 (exit 1) 而非挂起 900 秒（单个观察预算 0.05s~2.0s，整套变异回归在约 22 秒内产生 4 项预期失败并退出，见 [RF-09 重入回归测试有界失败与资源清理验证](./docs/verification/cross-platform/RF-09-BOUNDED-REENTRY-TESTS.md)）；
      sys.path/dotenv/环境变量清理及真实 SDK 联调仍待完成，整项保持未勾选。
- [ ] **RF-10 Provider Registry**：能力、模型、凭据、验证、超时、重试与错误映射统一；
      非敏感设置不解密旧凭据；多 Provider 验证并行且有总超时。
      本地已完成 LLM 静态元数据单一来源收敛（A50）：新增纯标准库不可变 `provider_catalog.py`（MappingProxyType 与 frozen dataclass 双重保护），收敛 `plugin_factory`（`LLM_PROVIDER_BASE_URL`、`_SYSTEM_LLM_KEY_FIELD`）、`llm_service`（`PROVIDER_CONFIG`）与 `validation_service`（`validate_llm_key`）三处重复定义；保持 SiliconFlow 与 OpenRouter 两 Provider 顺序、URL、Header 与变量类型；未知 provider 与空 key 零外部网络请求；携带 A49 遗留 P2 合法空嵌套 message 回退至 JSON 字符串；见 [RF-10 LLM 静态元数据单一来源验证](./docs/verification/cross-platform/RF-10-LLM-CATALOG.md)；
      本地已完成 STT/TTS 静态元数据单一来源收敛（A53）：在不可变 `provider_catalog.py` 中补齐现有 Deepgram 与 Cartesia 静态元数据（`STTProviderMetadata`、`TTSProviderMetadata`、`STT_PROVIDER_CATALOG`、`TTS_PROVIDER_CATALOG`），收敛 `plugin_factory`（`SUPPORTED_STT_PROVIDERS`、`SUPPORTED_TTS_PROVIDERS`）与 `validation_service`（`validate_stt_key`、`validate_tts_key`）来源；保持 Deepgram（Token 认证）与 Cartesia（X-API-Key 与 Cartesia-Version 头）精确 URL 与 Headers；Catalog 保持纯标准库不可变且不驻留凭据，每次请求独立生成 Headers 防污染；未知 provider 与空 key 保持零外部网络请求；见 [RF-10 STT/TTS 静态元数据单一来源验证](./docs/verification/cross-platform/RF-10-SPEECH-CATALOG.md)；
      本地已完成用户设置惰性解密与非敏感更新解耦（A54）：修复设置更新无条件解密三路旧凭据缺陷，确立仅在 role 发生变化且需要沿用旧 key 时才按需解密该 role 旧密文；未变化 role（含主题/模型偏好/自定义模式等非敏感配置更新及同 provider 原值重复提交）零读取、零解密、零拨测，避免因旧密文版本漂移或损坏导致非敏感设置更新失败；显式提供新 key 仅拨测新 key 绝不解密旧密文；严格保持 STT→LLM→TTS 校验顺序与 422 失败响应形状；见 [RF-10 用户设置凭据惰性解密验证](./docs/verification/cross-platform/RF-10-LAZY-KEY-DECRYPTION.md)；
      本地已完成多 Provider 有界并行验证与统一总预算控制（A55）：`ProviderValidationService.validate_parallel` 以 `TOTAL_TIMEOUT_SECONDS = 10.0` 整批并发执行需拨测的独立 role，单请求 `REQUEST_TIMEOUT_SECONDS = 8.0` 保持；总预算到期保留已完成真实结果，未完成 role 标为 `timeout` 并强制 cancel 与 await 收束全部 pending task，意外异常先清理在途任务再原样抛出；设置路由仅调度 changed 且同时具备 provider/key 的 role，严格保持 A54 惰性解密边界与 STT→LLM→TTS 响应/错误字段顺序；`validate_all` 复用同一有界并行入口并保持 `bool` 返回兼容；见 [RF-10 多 Provider 有界并行验证](./docs/verification/cross-platform/RF-10-BOUNDED-PARALLEL-VALIDATION.md)；
      本地已完成用户设置业务服务边界抽离（A60）：把 `backend/routers/user.py` 中的设置响应构建、权限判断、按变更凭据验证与更新/加密业务逻辑抽入独立纯净服务 `backend/services/user_settings_service.py`；HTTP 路由保留认证依赖、当前用户限定数据库查询/创建/flush/refresh 与对原 helper 签名（`get_key_status`、`_decrypt_and_rotate`、`_as_validation_result`、`_build_user_settings_response`、`_validate_custom_mode_permission`、`_validate_provider_keys`、`_apply_settings_update`）及测试 patch（`routers.user.decrypt_api_key`、`encrypt_api_key`、`ProviderValidationService`）的薄兼容委托；路由在调用服务时显式从当前命名空间注入依赖，服务导入期零路由反向依赖、零模块默认值绑定及零全局可变状态；A54 惰性解密与 A55 有界并行边界与响应脱敏完全保持；新增 `test_user_settings_service.py` 覆盖状态三态映射、响应脱敏、权限校验、零副作用、密钥旋转、失败顺序、字段写入及生产路由直接消费与 patch 兼容回归（见 [RF-10 用户设置业务服务边界验证](./docs/verification/cross-platform/RF-10-SETTINGS-SERVICE.md)）；真实外部 Provider 拨测与前端展示元数据统一仍待完成，整项保持未勾选。
- [x] **RF-11 前端 API 与状态模型**：OpenAPI 生成类型/客户端；Transport 统一认证、
      超时、取消、Header 合并和错误解析；会话使用判别联合/Reducer；大组件按行为拆分。
      以下 A49–A64 条目保留各轮当时的“仍待完成/未勾选”边界；最终完成状态以上方勾选、
      A65–A69 验收结果及本节末“本地代码验收完成”边界为准。
      本地已完成异常 HTTP 错误体健壮解析（A49）：修复 request 对 detail:[null]、非数组/非法 loc 及非 string msg/errors 引发 TypeError 与 HTTP status 丢失缺陷；实现局部健壮类型守卫（isRecord/getFirstTruthyString），严格保护 ApiError.status 与原始 data 结构；未通过数组类型收窄的非法或缺省 loc 安全回退 Unknown，杜绝调用任何对象方法，正常 string/number 数组安全 join；保持 detail 字符串、空字符串与 detail.message 原 truthy 语义，完整保持既有有效分支优先级；401 在解析前严格按原 reqRevision 失效，迟到 401 保护生效，请求仅发送一次无重放；诊断日志零正文/密钥泄露；覆盖 422/401/500/502 异常形状、空值边界与非 JSON 表驱动回归通过（见 [RF-11 异常 HTTP 错误体健壮解析验证](./docs/verification/cross-platform/RF-11-ERROR-BODY-GUARDS.md)）；
      本地已完成设置保存载荷行为抽取（A61）：将 `SettingsDrawer.handleSave` 中构建 `UserSettingsUpdate` 请求体的纯计算抽取为独立纯函数 `buildSettingsUpdate`（`settingsPayload.ts`）；模块仅 import type，零 React/DOM/store 依赖，零网络/日志/持久化与明文密钥保存；严格保证 `is_custom_mode: false` 时仅输出该字段且不包含任何 provider/model/key 字段；`is_custom_mode: true` 时按原顺序携带 `stt_provider`/`llm_provider`/`tts_provider`，`llmModel.trim()` 非空才携带 `llm_model`，三路 key 仅 trim 后非空才携带，不引入清空语义且不带额外字段；`SettingsDrawer` 真实消费新模块并验证完整更新 payload；直接单测覆盖开/关、单/多 key、空白截断、冻结入参不变性与独立实例隔离，修复 `test_user_settings_service` 遗留的 overrides 清理及 RF-10 文档笔误（见 [RF-11 设置保存载荷行为抽取验证](./docs/verification/cross-platform/RF-11-SETTINGS-PAYLOAD.md)）；
      本地已完成 API 错误消息解析纯计算边界抽离（A62）：将 `apps/vite-app/src/lib/api.ts` 中错误响应体解析为错误消息的纯计算抽离为独立纯函数 `getApiErrorMessage`（`apiErrorMessage.ts`）；模块零网络/DOM/store/全局可变状态依赖，零反向依赖；原 `ApiError` 导出与构造签名 100% 保持；原 `request` 移除旧错误解析私有副本并真实消费新函数；逐项严格保持 FastAPI detail 字符串（含合法空字符串）、422 验证异常首项判定与 loc 安全拼接（缺失/非法安全回退 Unknown）、detail.errors 首项非空采纳（首项空不扫描后项）、detail.message 非空采纳、合法空嵌套 message/空对象回退 JSON.stringify 兜底及序列化异常安全回退默认文案；外层 errors/message 保持原优先级与语义；401 在读取 JSON 前按原 revision 失效、非 JSON 解析回退 `{}` 及写请求单次调用防重放等时序完全不改；直接单测全面覆盖有效/异常结构、合法空值与冻结入参不变性，通过 spy 与可证伪替身证实公共 API 消费者出错时真正委托新模块且保持 status/data（见 [RF-11 API 错误消息解析边界抽离验证](./docs/verification/cross-platform/RF-11-API-ERROR-MESSAGE.md)）；关闭 A61 文字 P2 两项笔误；前端 API 类型生成与会话状态模型重构仍待完成，整项保持未勾选。
      本地已完成 API 请求 Header 合并边界抽离（A63）：将 `apps/vite-app/src/lib/api.ts` 的 `request` 内默认 `Content-Type`、认证 `Authorization` 与调用方 Header 合并逻辑原样抽为同步纯函数 `buildApiRequestHeaders`（`apiRequestHeaders.ts`）；模块无网络/异步/DOM/store/日志/全局可变状态与反向依赖，直接单测覆盖空入参、对象、数组、`Headers`、既有 `Content-Type`、显式 `Authorization`、无 token、自定义 Header 保留、冻结输入不变性、多值语义与实例隔离；原 `request` 真实消费新模块，认证 revision/token 校验、baseUrl/path、请求选项、错误处理、401 时序及单请求行为保持不变，并通过公共消费者 spy 回归证明 Header 构造委托、最终 Headers 与一次 fetch；前端 API 类型生成、会话状态模型、超时与取消仍待完成，整项保持未勾选（见 [RF-11 API 请求 Header 合并边界抽离验证](./docs/verification/cross-platform/RF-11-REQUEST-HEADERS.md)）。
      本地已完成 Transport 请求超时与取消边界（A64）：新增纯计算模块 `apps/vite-app/src/lib/apiRequestTimeout.ts`，以既有前端 10s 门禁为普通请求默认预算，对会触发后端最多 10s 并行 Provider 校验的 `updateUserSettings` 显式采用 15s；运行时非法预算安全回退 10s；组合调用方 `AbortSignal` 与内部超时，已取消 signal 在 fetch 前零网络短路，超时与调用方取消使用独立的 `ApiRequestTimeoutError` / `ApiRequestAbortedError`、稳定错误分类与无正文诊断事件；外部取消优先，不自动重试或重放写请求；认证 revision/token/revision 二次校验、Header 构造、HTTP 错误/ApiError、401 失效、非 JSON 回退与单请求时序保持不变；直接单测与公共 API 消费回归覆盖预算、组合 signal、两类失败、非法值、隔离性及一次 fetch；前端 API 类型生成、会话状态模型与其他 Transport 收敛仍待完成，整项保持未勾选（见 [RF-11 Transport 请求超时与取消边界验证](./docs/verification/cross-platform/RF-11-REQUEST-TIMEOUT.md)）。
      本地已完成会话状态判别联合与 Reducer 边界（A65，独立 Review APPROVED）：新增纯 `conversationState.ts`，以 `checking_health`、`creating_session`、`fetching_token`、`credentials_ready`、`active`、`ending`、结束与失败 phase 收敛会话真值，旧 `connecting + null token` 启动过渡态保留为明确内部阶段并兼容投影为原扁平字段；生产 store 的真实创建/取令牌/激活/结束/失败/重置迁移统一消费纯构造、守卫、Reducer 与原子投影，公开 `setState` 测试夹具经同一归一化层处理，完整凭据才可进入连接就绪或 active；`VoiceInterface` 改为类型收窄渲染并保持 Room key/props、文案和 DOM，`ActiveSessions` 启动判定复用同一模型；既有 sessionGen、认证 revision/principal、生命周期所有权与迟到结果隔离保留。A65 定格于本地单提交 `356f69e9ceecf8868b6f11db7b53d566032bb2f6`，main 精确 fast-forward 并完成全量复验：876 Vitest、148 双浏览器 E2E、529 backend，三项有效变异均被真实断言杀死并完整还原源码（见 [RF-11 会话状态模型验证](./docs/verification/cross-platform/RF-11-STATE-MODEL.md)）。
      本地已完成公共网络函数取消入口（A66，独立 Review APPROVED）：新增只含末位可选 `readonly signal?: AbortSignal | null` 的 `ApiRequestOptions`，为实际 22 个网络函数补齐 options，同时保留 owner、docContext、takeover、params 等原参数位置与默认值；仅把 signal 写入单请求 `RequestInit`，不扩展 headers/timeout/RequestInit，也不把 options 混入 body 或 owner 判定；继续复用 A64 组合 signal、普通请求 10s 与设置更新 15s 预算，预取消零 fetch、在途取消至多一次且不重放，认证 revision、HTTP/401、错误解析与并发请求隔离保持。A66 定格于本地单提交 `fedc5f39d659bf591a7c8b42b087d46a13eb4349`，main 精确 fast-forward 并完成全量复验：22 个公开 API/24 个 request 分支覆盖末位 signal，907 Vitest、148 双浏览器 E2E、529 backend，两项有效变异被杀死并完整还原源码。UI 生命周期主动 abort 全部 store 不在本交付中（见 [RF-11 公共 API 取消入口验证](./docs/verification/cross-platform/RF-11-PUBLIC-CANCELLATION.md)）。
      本地已实现并验证离线 OpenAPI 导出与 TypeScript 类型生成（A67，独立 Review APPROVED）：新增真实 `main.app.openapi()` 隔离子进程导出；导入 config 前以 Pydantic 文档化 `_env_file=None`/`_secrets_dir=None` 构造控制禁用 dotenv/file-secret 读取，再按真实 settings source hook 签名仅保留 init/env；TMP/TEMP 与 XDG 受控但不重设 `HOME`，DNS/socket 失败关闭；真实子进程 120 秒超时，异常仅输出阶段/类型，确定性 JSON 原子写入。真实 schema 当前含 22 条路径、27 个模型且 `--check` 通过；`openapi-typescript@7.13.0` 已从该 schema 真实生成 `api.generated.ts`，Node 生成器 8 项、离线导出 pytest 11 项及完整前端 quality10 均通过；Vitest 为 907/32 files、Node 构建测试 18 项、Fake API 61 项、Chromium+WebKit E2E 148 项。后端专用测试库全量 pytest 为 540 passed/3 warnings、覆盖率 79.41%；新增导出工具主要在隔离子进程中执行，不计入父 pytest coverage，既有 59% 门禁不变。lock 已按精确 override 受控重生成并通过冻结安装：既有 packages 的 version/integrity 与既有 resolved snapshots/importer 不变，新增 17 个 packages、18 个 snapshots 及 vite-app 的精确 devDependency；唯一既有 package 元数据变化是已批准的 Webpack 插件 peer range 原生记录为 `0.21.3`。六类生产 DTO 已消费 generated component；两项 schema/types stale 变异均被真实断言杀死并完整还原源码，六 DTO 精确键、双向兼容及 `api.ts` 去类型 JS 字节等同基线通过。A67 定格于本地单提交 `1321bbe43ac540cacb75ea3845ac381076a7c637`，main 精确 fast-forward；未 push/部署，远端 CI、真实 IdP/Provider/LiveKit/设备未验（见 [RF-11 OpenAPI 类型生成验证](./docs/verification/cross-platform/RF-11-OPENAPI-TYPES.md)）。
      本地已完成 VoiceInterface 行为拆分（A68-B，独立 Review APPROVED）：主入口只保留 phase 选择与 Room key/props；`RoomSession` 承接 principal/revision 绑定、原生 pending/ready/timeout、Web 初始/订阅后快照、`RoomContextSync` 稳定 cleanup、LiveKit callbacks 与 dispatch 迟到/重入核验；`ActiveConversation` 承接活动 UI、LiveKit hooks、agent_error 和显式结束停轨；`EndedConversation` 承接本地取消、分析轮询/失败/重试及 assessment reset；状态视图保留原文案、classes、DOM、testid 与 store action，`stopRoomLocalTracks` 移入纯 `roomAudio` 并从原入口兼容导出。12 个交付文件独立 APPROVED，本地单提交 `0902aee45fc2de6d1050fd4610b8c9c9835108de`；frontend10 全绿（Vitest 908/32 files、build-script 18、Fake API 61、typegen 8、双浏览器 E2E 148），专用 PostgreSQL pytest 540 passed/79.41%，13 个迁移函数体与 Room 资源 effect 等价核验、两项 cleanup/reentry 变异 killed 且精确还原，恢复后 908 项复验通过；A68 main 全量复验也已通过（见 [RF-11 VoiceInterface 行为拆分验证](./docs/verification/cross-platform/RF-11-VOICE-COMPONENTS.md)）。
      本地已完成 SettingsDrawer 行为拆分（A69-B，独立 Review APPROVED）：公共入口只保留公共 props、打开 fetch、loading/saving/store error、外壳和模块组装；新增 `useSettingsDialog` 独占原生 dialog/焦点/滚动/键盘/backdrop 清理，`useSettingsForm` 在 `open=false` 仍挂载并独占草稿、后端对象引用水合、内存 key、显式保存及本地提示，`SettingsAppearance` 与 `SettingsProviderFields` 承接稳定视图。既有 `buildSettingsUpdate`、Provider 选项/顺序/默认、免费账号 custom 约束、主题 local-first、原文案/DOM/classes/label/id 与网络语义保持；本地 toast timer 绑定打开周期和操作序号，重复错误各享完整 3 秒、成功 2 秒，close/reopen/卸载后的旧成功/失败及 stale 结果静默，新周期保存可恢复，且不自动取消/重发 PUT。r1 修复 `installStore` 实际 action 所有权、Provider 三种真实 fixture，并恢复 logout 失败提示持久语义。A69 定格于本地单提交 `0936ea335dff8fdce8d307da10461ed2b8dec6a5`；main 全量复验通过 frontend10（Vitest 917/32 files、build-script 18、Fake API 61、typegen 8、双浏览器 E2E 148）、backend 540 passed/3 warnings/79.41%、4 项独立真实组件/store 消费探针及两项有效通知变异，源码已还原（见 [RF-11 SettingsDrawer 行为拆分验证](./docs/verification/cross-platform/RF-11-SETTINGS-COMPONENTS.md)）。
      RF-11 计划中的 schema 生成链路、统一 Transport（认证/超时/取消/Header/错误/origin）、state 模型及 VoiceInterface/SettingsDrawer 行为边界均已完成本地代码验收，故整项勾选为“本地代码验收完成”。该勾选不表示 UI 主动 abort 已接入全部 store，也不表示生成类型已替代其余手写 domain 适配，或真实 IdP/Provider/LiveKit/设备/远端新 CI 已验收；这些边界继续独立保留。

### Phase 7：受控升级

- [ ] **RF-12 独立 SDK 升级**：仅在 RF-01、RF-04、RF-07、RF-09 完成后，分别升级并
      提交 LiveKit Agents、OpenAI SDK、Vite、Vitest 和 TypeScript；保留回滚边界；真实
      语音、Provider 与 iOS 真机等外部验证在获得凭据/设备后补证，未验证前不得完成。

## P0 — 安全边界

- [x] 独立 Vite 7.x 安全补丁（[#92](https://github.com/sunpcm/EchoTalk/pull/92)）：
      声明和所有锁定实例统一为 7.3.7，冻结安装和 CI 通过；不代表 RF-12 整体完成。

- [x] 后端用真实 JWT 校验替换 `get_current_user` Mock；验收：无效或过期 Token 返回 401。
- [x] 前端从 Auth 模块获取 Bearer Token，移除固定的 `mock-token`；验收：登录态变化能正确影响 API 请求。

## P1 — 功能完整性

周度学习报告目前仅返回 `status: "skeleton"`，以下维度应分别实现并验证：

- [ ] 统计最近 7 天练习时长与会话次数。
- [ ] 计算各技能 `p_mastery` 环比趋势。
- [ ] 按会话聚合发音准确率趋势。
- [ ] 统计语法错误 Top 3 并生成改善建议。
- [ ] 基于 RAG/Krashen i+1 生成下周学习重点。
- [ ] 汇总平均焦虑指数与语速趋势。
- [ ] 接入正式 i18n 框架，用语言包替换当前 TypeScript 字符串对象。
- [ ] 实现数字人前端与音视频同步，并补充独立设计和验收标准。
- [ ] 在完整后端与 LiveKit 环境补验 Session、评估页面及深色主题可读性。

## P2 — 质量与维护

- [x] 每日进度与技能掌握度进度条提供可访问名称、范围和值（[#90](https://github.com/sunpcm/EchoTalk/pull/90)）；
      回归覆盖每日 0/5/20/25 完成量，超目标时数值封顶、文本保留实际总量。

- [x] 清点主题 token：保留 Webpack 正在使用的 `brand-*`，处理未使用的 `scrollbar-thumb`、`header-bg`（A32 本地独立评审通过）；
      删除无运行时引用的 2 个主题 token 并修复 ActiveSessions 确认面板背景透明与边框继承缺陷，双浏览器逐主题 computed 变量解析验证通过，见 [主题 token 审计与确认面板验证](./docs/verification/cross-platform/CP-05-THEME-TOKENS.md)。
- [x] 将 Vite 入口的 `<html lang="en">` 改为 `zh-CN`。
- [x] 将主题保存到后端 `user_settings.theme`，支持跨设备水合（A28 本地独立评审通过）；
      客户端 local-first、认证与代际绑定、单在途意图串行合并与水合竞争防护经本地回归通过；
      不代表真实双物理设备验收，见 [主题同步验证](./docs/verification/cross-platform/CP-05-THEME-SYNC.md)。
      A31 补充浏览器 localStorage 异常容错（SecurityError/QuotaExceededError 读写安全回退、
      不阻断 UI/store 与后台 PUT 同步、成功水合不误判 API 失败、恢复后正常持久化），
      见 [主题缓存容错验证](./docs/verification/cross-platform/CP-05-THEME-STORAGE.md)。
- [x] 统一主题按钮边框宽度，消除选中时 1px 布局抖动（A28 本地独立评审通过）；
      主题单选按钮统一使用 2px 固定边框，窄屏、默认与 200% 字号下选择前后内容位移为 0，见 [验证](./docs/verification/cross-platform/CP-05-THEME-SYNC.md)。
- [x] 为颜色过渡和抽屉动画支持 `prefers-reduced-motion`（A27 本地独立评审通过）；
      CSS 媒体查询支持 reduce 与 no-preference 真实浏览器 computed、抽屉动画消除与
      loading spinner 保留，零 JS 注入与零隐式业务写。见 [验证](./docs/verification/cross-platform/CP-05-REDUCED-MOTION.md)。
- [x] 按主要容器补齐主题颜色过渡，避免子元素瞬间切色（A35 本地独立评审通过）；
      为 #root 注入 theme-transitions 作用域，补齐主要容器、卡片、设置抽屉及显式文本 250ms ease 颜色过渡，
      保持 box-shadow 150ms 与 hover 能力，兼容 reduce 偏好与 WAAPI 插值中间态验证，见 [主要容器主题过渡验证](./docs/verification/cross-platform/CP-05-THEME-TRANSITIONS.md)。
- [ ] 移除 LiveKit 消息访问处的 SDK 类型忽略，改用类型收窄或兼容适配层。

## 三端交付计划（Web / macOS / iOS）

> 制定日期：2026-10-21；初始分析基线：`main@66a64fe`；执行准备基线：远端 `main@a8f0895`。
> 以用户已确认可运行的 iOS 为起点；完整闭环、异常恢复和 Release 分发分别记录验收结果。
> 架构、默认策略与证据规范见 [跨平台架构与交付门禁](./docs/CROSS_PLATFORM_ARCHITECTURE.md)。
> 本节替代原 Phase 9 移动端计划；任务完成状态只在此维护。

### 范围与推进规则

- 本轮交付 Web、iOS 和 macOS；Android、Windows、实时跨设备语音接力、离线 AI 不在本轮范围。
- 共用 React 页面、API 和后端；保留 Capacitor iOS，macOS 先验证再确定包装方案。
- 首版默认以前台练习为目标；中断时停止或暂停采音，回前台核对状态，并由用户确认恢复采音。
- 历史、报告和设置跨端同步；同一账号同时只允许一端通话，另一端须显式接管，不静默踢出已有端。
- CP 编号表示验收门禁。CP-00 通过后，CP-01、CP-02 后端与 CP-03 最小验证可并行；接口稳定后再并行开展认证、会话恢复和独立 UI 适配，最终串行集成验收。
- 现有 RF 任务保持独立状态；跨端工作不顺带升级 SDK、清理基础设施或重写全部前端状态。
- 真实 IdP、设备或签名条件缺失时，继续无依赖工作；相关外部验收保留未完成，不以 Mock 通过替代。

### CP-00：基线与验收准备

- [x] 记录当前前后端检查结果、iOS 运行方式和设备/OS；验收：区分既有失败、本轮回归、模拟器与真机证据。
- [x] 建立三端验收矩阵和证据目录；验收：覆盖登录、语音、结束、分析、报告、设置、DocTalk 与异常恢复，记录结果及复现步骤，不记录凭据或用户原始音频。
- [x] 核实测试数据库隔离；验收：后端集成测试仅连接明确的独立测试库，设备测试使用专用测试账号。

CP-00 自动化准备已于 2026-10-21 独立评审通过；已补录 iPhone 17 Pro / iOS 26.0 模拟器安装证据；真机、真实链路及发布验收仍未通过。

### CP-01：平台边界与配置（首个代码阶段）

- [ ] 在 `apps/vite-app/src/platform/` 建立薄适配接口；验收：环境、认证、生命周期能力具有明确边界，Web 默认实现可运行，尚未支持的能力显式返回不可用。
- [x] Web生命周期事件薄适配器：无副作用工厂、订阅清理/恢复快照、SSR降级与原生能力不可用经独立验收；未接业务与原生事件，见[验证](./docs/verification/cross-platform/CP-01-WEB-LIFECYCLE.md)。
- [x] 集中 API/LiveKit 地址选择，修正 `/api/api`，生产原生配置限制 HTTPS/WSS；验收：Origin 与含 `/api` 地址、尾斜杠、非法配置、Web 同源、原生直连/代理均有回归覆盖。
- [x] 增加可复现的 iOS build + sync 命令，隔离平台/环境产物并校验 Turbo 缓存输入；验收：Web/iOS 连续切换构建不会复用错误配置，Release 不含开发 Token 或开发 API 地址。

- [x] Dashboard生命周期只读发现接线：恢复前台/网络时刷新，后台离线门禁、旧请求与账号隔离通过本地独立验收；不代表恢复通话，见[验证](./docs/verification/cross-platform/CP-01-LIFECYCLE-DISCOVERY.md)。

### CP-02：会话可靠性与恢复契约

- [x] 结束接口幂等，客户端结束时立即停止采音；验收：响应丢失后重试、重复点击和并发结束均返回一致最终状态，不重复创建分析任务。
- [x] 创建会话支持请求幂等标识；验收：同一用户同一请求重试返回原会话，不同请求正常创建，复用标识但请求体不同被拒绝。
- [x] 共享 Dashboard 只读活动会话发现增量；验收：加载/空/列表/失败重试、精确账号与代际隔离及未知模式回退通过本地独立评审。仅发现记录，不代表房间在线或可恢复，见 [发现验证](./docs/verification/cross-platform/CP-02-DISCOVERY.md)。
- [x] 客户端通话能力发现与开始门禁；验收：严格协议/no-store、失败及Cloud不可用时不创建会话，认证失效释放旧启动且可显式重试，本地回归通过；尚未支持Cloud占用客户端/恢复/接管。
- [x] 客户端占用API原语：claim/heartbeat/release及token/dispatch可选owner头；精确schema/关联校验、默认不接管和不重放经本地独立验收。仅API层，Cloud开始门禁保留，见[验证](./docs/verification/cross-platform/CP-02-LEASE-API.md)。
- [x] 独立客户端占用控制器：显式claim、心跳/到期watchdog、同tuple释放重试、代际/身份隔离与清理通过本地独立验收；未接UI/媒体/Cloud门禁，见[验证](./docs/verification/cross-platform/CP-02-LEASE-CONTROLLER.md)。
- [x] Dashboard显式结束已发现的活动记录：确认/取消、失败同ID重试、认证意图代际与在途保护通过本地独立验收；不表示其他端媒体停止，见[验证](./docs/verification/cross-platform/CP-02-DISCOVERY-END.md)。
- [x] ActiveSessions文件头已随显式恢复开发同步更新为发现/结束/恢复，关闭P2过期注释。
- [x] disabled模式已有会话显式恢复：确认后重新核验身份/能力/详情/Token且零create，store及UI取消/代际隔离经本地独立验收，见[验证](./docs/verification/cross-platform/CP-02-EXPLICIT-RECOVERY.md)。
- [ ] 完善Cloud占用下恢复入口与真实媒体/三端恢复验收；验收：刷新或重启后可选择恢复/结束，已结束会话不能重连，不持久化 LiveKit Token。
- [ ] 明确并落实单设备会话占用、过期释放及显式接管；验收：双端竞争不造成隐式踢人，旧设备失去占用后不能自动抢回，会话中断后的遗留状态有回收路径。
- [x] Agent调度HTTP失败本地闭环：当前失败停止本地音轨、清Token/卸载房间并展示安全提示；单次调度、来源/代际隔离及失败后显式操作经独立验收，见[验证](./docs/verification/cross-platform/CP-02-AGENT-DISPATCH.md)。真实媒体、连接离线及Token过期恢复仍待下项。
- [x] 连接失败与Web中断本地闭环：SDK错误/断开、后台离线同步停止音轨，旧回调与监听隔离、无自动重连和显式新操作经独立验收，见[验证](./docs/verification/cross-platform/CP-02-CONNECTION-FAILURE.md)。
- [ ] 完成真实网络离线、Token失效与原生系统中断验收；验收：API 502、离线、Token 失效不再只写 console 或长期显示假在线。

Cloud 占用后端协议已于 2026-10-21 通过本地独立评审（`d76da01`）：专用 PostgreSQL、模拟媒体、失败回滚与迁移往返通过。恢复/接管 UI、真实 Cloud 撤销及三端旧 SDK 重连尚未验收，`CALL_LEASE_MODE` 默认保持 `disabled`。

### CP-03：macOS 最小验证与方案定案

- [ ] 比较 Web/可安装 Web、Apple Silicon 上运行 iOS App、独立 Tauri macOS；验收：记录目标芯片/OS、发布渠道、桌面能力需求和维护取舍。
- [ ] 对候选方案做最小语音与授权回跳验证；验收：麦克风授权、双向音频、耳机切换、断网重连、休眠唤醒、文件选择和系统认证回跳有设备证据。
- [ ] 形成 macOS 方案决策；验收：若需独立客户端且 Tauri 验证通过，再维护正式桌面工程；验证失败则分析具体失败点再评估替代方案，不无条件迁移 iOS 或引入 Electron。

### CP-04：三端真实登录与凭据生命周期

- [x] 共享客户端本地认证生命周期：账号清理、迟到响应/401隔离、StrictMode在途callback单次交换和来源归属通过独立评审及隔离集成；详见 [CP-04 本地验证规范](./docs/verification/cross-platform/CP-04.md)。仅此本地增量完成，以下真实三端验收项仍待完成。

- [ ] 保留 Web OIDC Code + PKCE，接入原生系统认证会话及冷/热启动回跳；验收：state/nonce/PKCE、取消、重复回调、错误回调和退出均正确处理。
- [ ] 原生长期凭据使用 Keychain，补齐续期、撤销及 401 恢复；验收：并发请求只触发一次续期，失败后受控退出，不盲目重放创建/结束等写请求，不在 Web Storage 保存原生长期凭据。
- [ ] 配置各客户端的 IdP 回调白名单与 API audience；验收：三端同一账号映射同一本地用户；核实 IdP 是否使用 pairwise subject，禁止靠 email 自动合并账号。
- [ ] 登录失效/退出时停止音频并清理用户相关内存及本地恢复提示；验收：切换账号不显示上一账号的会话、设置或报告。

### CP-05：生命周期与响应式体验

- [x] 回答推荐全文换行、44px触控及复制反馈归属：620产品/18构建脚本/104默认双浏览器、8独立时序/12独立浏览器及两有效变异通过；见[验证](./docs/verification/cross-platform/CP-05-ANSWER-RECOMMENDATIONS.md)。真实系统剪贴板权限仍待验。

- [x] DocTalk设置页标题/返回重排、44px触控及窄屏大字号：606产品/18构建脚本/82默认双浏览器、22独立浏览器和两有效变异通过，见[验证](./docs/verification/cross-platform/CP-05-DOC-LAYOUT.md)。OS键盘与硬件safe-area仍待验。

- [x] DocTalk本地文件导入保稿、UTF-8/长度校验与迟到读取隔离：606产品/18构建脚本/62默认双浏览器、11独立时序+18浏览器探针及两有效变异通过，见[验证](./docs/verification/cross-platform/CP-05-DOC-IMPORT.md)。真机文件选择器验收项继续保留。

- [x] 活动列表响应式、完整确认ID与44px触控：578产品/18构建脚本/56默认双浏览器、22独立布局探针和两有效变异通过；见[验证](./docs/verification/cross-platform/CP-05-ACTIVITY-LAYOUT.md)。
- [x] 恢复失败与真正取消按会话代际区分，专用错误/完整目标/显式重试恢复；588产品/18构建脚本/60默认双浏览器、12独立失败路径+2时序探针及两有效变异通过，见[验证](./docs/verification/cross-platform/CP-05-RESUME-ERROR.md)。

- [x] 设置抽屉命名模态、完整键盘到达/焦点恢复、44px触控与窄屏横屏大字号：578产品/26浏览器探针+3资源单测/38默认E2E通过；见[验证](./docs/verification/cross-platform/CP-05-SETTINGS-DRAWER.md)。真实OS键盘和非零safe-area仍待验，全局布局项继续保留。

- [x] 活动列表区分尚未查询与确认空，精确身份查询事实及迟到隔离：574产品/14独立探针/22双浏览器通过；同步修正分析hook旧Web注释，见[验证](./docs/verification/cross-platform/CP-05-DISCOVERY-QUERY-STATE.md)。

- [x] Room原生就绪挂载门禁、10秒安全退出、后台同步停轨与健康渲染保护：565产品/20独立探针/双浏览器22项及iOS build+sync通过；见[验证](./docs/verification/cross-platform/CP-05-NATIVE-ROOM.md)，真实系统音频中断/路由仍待验。

- [x] 开始/显式恢复原生就绪门禁、10秒安全退出与旧意图隔离：547产品/30独立探针/双浏览器22项；见[验证](./docs/verification/cross-platform/CP-05-NATIVE-STARTUP.md)。Room后续已由A19本地接线，真实OS仍待验。

- [x] 活动列表与分析页消费iOS原生生命周期：525产品、35独立探针、双浏览器22项通过；见[验证](./docs/verification/cross-platform/CP-05-NATIVE-CONSUMERS.md)，通话启动/Room仍待接线。

- [x] iOS原生生命周期薄适配器与统一工厂：509产品/22独立探针/双浏览器22项、本地iOS build+sync通过，见[验证](./docs/verification/cross-platform/CP-05-NATIVE-ADAPTER.md)；业务消费者仍待接线。

- [x] 分析页Web后台/离线暂停与恢复安全轮询：472产品、27独立探针、双浏览器22项通过；见[本地验证](./docs/verification/cross-platform/CP-05-ANALYSIS.md)，原生OS仍待验。

- [ ] Web visibility/online 与原生前后台/唤醒统一进入恢复流程；验收：重新校验身份、服务端状态和 LiveKit 连接，回前台立即刷新分析，避免并行轮询或重复 dispatch。
- [ ] 完善 iOS 音频中断与路由变化；验收：来电、锁屏、蓝牙插拔后无假在线或意外采音，恢复遵守用户选择；后台持续通话另立后续范围。
- [ ] 完善手机动态视口、键盘避让、safe area 与触控目标；验收：窄屏/横屏/大字号无关键按钮遮挡，设置面板按可用空间适配。
- [ ] 完善桌面窗口缩放、宽屏布局、键盘导航和关闭会话行为；验收：缩小窗口可用，快捷键不抢输入焦点，关闭窗口不遗留采音。
- [ ] 真机验收 DocTalk 文件导入；验收：`.txt/.md` 可选、取消不丢草稿，读取失败、空文件、编码问题和超限有提示；仅在 Web 文件接口不满足时增加原生插件。

### CP-06：自动化与真实链路回归

- [x] 本地双浏览器门禁：保留完整质量检查，Chromium/WebKit各11项，覆盖分析/恢复/401边界、0skip；CI安装接线已更新，见[验证](./docs/verification/cross-platform/CP-06-WEBKIT.md)。
- [ ] 取得Linux CI双浏览器实际通过证据并完成真实链路回归；验收：Chromium/WebKit 均覆盖登录边界、会话恢复和分析状态；Mock 测试与真实 Provider 验收分别报告。本地 CI 已对齐 8 项门禁接线（含直接 Vitest、构建脚本及 Fake API 原生子进程测试，经 turbo --force），见 [CI 质量门禁验证](./docs/verification/cross-platform/CP-06-CI-QUALITY-GATES.md)；真实 Linux CI 证据仍待远端完成。
- [ ] 接入 macOS runner 的 iOS 构建和所选 macOS 方案构建；验收：普通 PR 可无发布密钥验证编译，签名仅在受控发布任务使用。
- [ ] 完成三端真实链路矩阵；验收：真实 IdP → 创建 → LiveKit/Agent 双向语音 → 结束 → 分析 → 报告，并验证拒绝权限、弱网、中断、重启、双端冲突和账号切换。
- [ ] 补充按版本/平台关联的诊断信息；验收：可定位 API、LiveKit、Agent 错误，不采集 Token、密钥或默认上传文档/对话正文。本地一期已通过独立评审，完成控制台结构化脱敏诊断（严格白名单 record、8项冻结事件、版本与平台自动关联、status/agent_code白名单过滤、控制台敏感parsed/canary彻底消除，见 [本地安全诊断一期验证](./docs/verification/cross-platform/CP-06-SAFE-DIAGNOSTICS.md)）；三端真实异常联动仍待外部验收；本计划不要求新增遥测上报，整项保持未勾选。

### CP-07：发布候选与交付

- [ ] Web 验证真实 HTTPS/WSS、API 兼容和回滚；验收：保留上一可用版本，新旧客户端均通过关键接口验证。
- [ ] iOS 完成 Release Archive、签名、权限/隐私材料与 TestFlight 验收；验收：使用生产构建配置完成完整闭环。
- [ ] macOS 按 CP-03 决策交付；验收：独立包完成签名及渠道所需公证/审核、全新安装验证；Web 方案则验证目标浏览器及安装入口。
- [ ] 记录各端版本、最低支持 OS、已知限制与回滚步骤；验收：发布候选通过不等于已对外发布，部署、上传和商店提交由用户确认发布边界后执行。

### 后续候选（不阻断本轮）

- [x] 将回答推荐scope键的id/text直接拼接替换为无歧义元组编码，并覆盖分隔符外部ID（A33 本地独立完成，见 [回答推荐作用域编码验证](./docs/verification/cross-platform/CP-05-ANSWER-SCOPE.md)）；消除冒号等外部ID边界碰撞。

- [ ] 在回归保护下简化Room初始Web快照与RoomContextSync引用所有权，移除多余可选回调并补并发渲染/SDK身份变化测试（A19 P2）。

- [ ] 在回归保护下减少start/resume重复生命周期逻辑及全局测试注入入口；A18维护候选，不阻断本地增量。

- [x] 修正分析hook头部旧Web措辞；列表原生状态未就绪区分尚未查询与已确认空，A20已关闭A17 P2。

- [x] Fake API严格解析带项目后缀的analysis-success/failure与grammar路径并补真实Node子进程回归（test:fake-api），同时修复Fake API缺失必需theme字段的schema问题（A29本地独立评审通过）。

- [ ] Android / Windows：产品确认进入范围后独立做平台最小验证。
- [ ] 后台持续语音、实时跨设备接力、桌面托盘/全局快捷键与自动更新：有明确需求后单独设计和验收。

## 维护规则

- `README.md` 只记录已验证现状，不承载待办。
- `docs/PHASE_*_TECH_STACK.md` 记录已实现架构，`docs/PHASE_*_MANUAL_TEST.md` 记录验收步骤。
- 已完成任务应同步删除对应源码 `TODO` 注释；重大取舍写入相关技术文档。
