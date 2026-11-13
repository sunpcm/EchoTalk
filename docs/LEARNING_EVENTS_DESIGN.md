# EchoTalk 学习事件台账设计（B1 Approved Design）

> 历史交付：本设计随 PR #150 交付并合入，当时仅完成设计，主控独立审阅 APPROVED。
> 当前批次状态：用户已于 2026-11-12 确认 §6、§7 和 §9 的实施政策；B1-0～B1-5 于
> 2026-11-13 完成本地实施、主控代码/测试 Review 与文档收口。用户 Review、生产切换、真实数据和
> 真实外部依赖仍未验收，当前停在 B1-5 用户 Review。
> 历史 B1-1/B1-2 状态：B1-1 的 `LearningEvent` ORM/注册、`b1_learning_events` 迁移及 schema
> 回归已在专用合成 PostgreSQL 验证；B1-2 已实现 §3–§5 的同事务事件写入、幂等、用户锁与 BKT
> 合成隔离，主控独立代码 Review 为 APPROVED。历史 B1-2 目标套件为
> `116 passed / 0 skip / exit 0`；完整 backend 为
> `844 passed / 3 warnings / 0 skip`、覆盖率 `80.82%`。
> 历史 B1-3 状态：主控代码/测试 Review 为 APPROVED；目标套件为
> `147 passed / 0 failed / 0 skip / exit 0`；完整 backend 为
> `878 passed / 3 warnings / 0 skip`、覆盖率 `80.51%`，前端未改。E2E 首轮为
> `232 passed / 2 failed / 0 skip / 0 retry / exit 1`；DocTalk 定向为
> `3 passed / 0 failed / 0 skip / 0 retry / exit 0`；再次全量为
> `233 passed / 1 failed / 0 skip / 0 retry / exit 1`；
> DocTalk 首轮失败原因未确认；再次全量中 WebKit Provider select 仍按实测失败保留。不能归因于
> 环境、历史基线或回归，也不能称全树全绿。
> 历史 B1-4 状态：本人数据结构化 JSON 导出已实现，主控代码/测试 Review 为 APPROVED，产品返修
> 使用 `1/2`。主控代跑的目标套件为 `20 passed / 0 skip / exit 0`，完整 backend 为
> `898 passed / 3 warnings / 0 skip`、覆盖率 `80.86%`、exit 0；完整双浏览器 E2E 为
> `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败是同名范围外遗留的 WebKit
> Provider select `336x23 < 44px`。这些数字只属于 B1-4 当时基线。
> 当前 B1-5 状态：本平台整账号硬删除及 `DELETE /api/user/account` 已实现，主控代码/测试 Review
> 为 APPROVED，产品返修使用 `1/2`。目标套件为 `36 passed / 0 skip / exit 0`，完整 backend 为
> `934 passed / 3 warnings / 0 skip / 81.64% / exit 0`；Fake API 为
> `113 passed / 0 skip / exit 0`。完整双浏览器 E2E 仍保留同名范围外遗留的
> `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败是 WebKit 三 Provider select
> `336x23 < 44px`，不能写成全树全绿。用户 Review 仍待；提交/推送状态以同卡最终交付回执为准，
> 不开 PR、不合并、不部署。生产库未执行 DDL、切换或真实数据处理。
> 范围是分析结果事件、写入幂等、派生校验、本人数据导出和本平台整账号删除；音频采集及真实
> 外部服务接入不在本项内。

## 1. 结论与边界

- 新建只追加的 `learning_events`。正常业务不得更新或删除；本平台整账号删除按 §7 显式硬删，
  “只追加”不能豁免该例外。
- 切换后，每个成功分析 Job 写一条 `analysis_completed`；每个可映射到现有技能的发音对齐项或语法错误再写
  observation。这样全合成、无发音、无语法错误也可审计，但“没报错”不会被伪造成“答对”。
- 评估结果、事件、`knowledge_states` 更新和 Job `succeeded` 必须同一事务提交；异常或取消整体回滚。
- 历史会话没有观察级事件，不能补录，也不能从旧 `knowledge_states` 反推出事件。真实趋势从切换后开始，旧状态只能作为明确标注的时点基线。
- 当前发音是 `demo_mock`，语法是 `demo_rule`，均标为合成
  [analysis_service.py#L149](../backend/services/analysis_service.py#L149)、
  [analysis_service.py#L237](../backend/services/analysis_service.py#L237)。本文不声称已有真实信号。

## 2. B1-0 设计前代码事实（历史快照）

本节记录设计方案形成前的既有行为，用于解释为什么需要 §3–§5；这些不是 B1-2 的当前实现。

1. Job 对 `session_id` 唯一；领取时递增 `attempt_count`，成功后不能回 pending [analysis.py#L42](../backend/models/analysis.py#L42)、
   [analysis_jobs.py#L74](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_jobs.py#L74)。
2. `SKIP LOCKED` 只防止同一 Job 被并发领取，不保证同一用户的不同 Job 串行 [analysis_jobs.py#L113](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_jobs.py#L113)、
   [test_analysis_jobs.py#L198](../backend/tests/test_analysis_jobs.py#L198)。
3. 执行事务先锁 Job，再写结果、更新知识状态并置 succeeded；异常后原事务回滚，另事务记失败 [analysis_jobs.py#L158](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_jobs.py#L158)、
   [analysis_jobs.py#L223](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_jobs.py#L223)。
4. 外部取消会回滚未提交结果，Job 暂时保持 running，之后走 stale recovery
   [test_analysis_worker.py#L972](../backend/tests/test_analysis_worker.py#L972)。
5. 发音和语法当前都以“该 session 已有结果”为幂等条件；同一 Job 重复执行不会重复插入 [analysis_service.py#L110](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_service.py#L110)、
   [analysis_service.py#L212](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_service.py#L212)、[test_analysis_worker.py#L1234](../backend/tests/test_analysis_worker.py#L1234)。
6. BKT 只读 `is_synthetic=false`；发音按 JSON 数组顺序更新，语法查询当前没有 `ORDER BY` [analysis_service.py#L298](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_service.py#L298)、
   [analysis_service.py#L303](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_service.py#L303)、
   [analysis_service.py#L291](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_service.py#L291)。
7. `knowledge_states` 读取没有 `FOR UPDATE`；同用户不同 Job 可能覆盖状态或并发创建，最终由 `(user_id, skill_id)` 唯一约束兜底
   [analysis_service.py#L326](https://github.com/sunpcm/EchoTalk/blob/b6a5cdde5249dccd4583397ddccddf2668ef5379/backend/services/analysis_service.py#L326)、
   [knowledge.py#L113](../backend/models/knowledge.py#L113)。
8. B1-0 设计前 Alembic head 为 `c06_transcript_events`，其父为 `c05_query_indexes`；转录
   `event_id` 只做会话内去重，不是观察或 BKT 顺序
   [c06_transcript_events.py#L16](../backend/alembic/versions/c06_transcript_events.py#L16)、
   [session.py#L128](../backend/models/session.py#L128)。

**历史 B1-2 实现路径（主控独立代码 Review APPROVED）**：
[`execute_claimed_job`](../backend/services/analysis_jobs.py) 在同一事务调用
[`write_learning_events`](../backend/services/learning_events.py)。writer 在用户行锁下校验 Job/Session/User
与全部候选来源归属，按发音数组顺序和语法 `(skill_tag, error_type)` 顺序规范观察；完成与观察
事件按规范幂等键写入，冲突时按全局键重读并校验完整载荷。`occurred_at` 使用
`sessions.ended_at`，仅对新插入、非合成且映射到有效技能的观察按 `apply_seq` 更新 BKT，计算与完成
事件共享冻结的 `bkt-v1` 四参数。上述行为已由历史 B1-2 的专用合成 PostgreSQL 目标套件与独立探针
覆盖，并继续作为 B1-3 切换门控下的写入契约。

## 3. 事件模型与幂等键

| `event_type`                | 数量                | 语义                                                     |
| --------------------------- | ------------------- | -------------------------------------------------------- |
| `analysis_completed`        | 切换后成功 Job 1 条 | 评估覆盖、mapped/unmapped 计数、合成摘要、BKT 版本与参数 |
| `pronunciation_observation` | 0..N                | 一个可映射到 `skills.id` 的发音对齐项                    |
| `grammar_observation`       | 0..N                | 一条已持久化的语法错误，只表示检测到错误                 |
| `baseline_snapshot`         | 切换时每技能 0..1   | `source=legacy_unknown` 的旧状态时点锚点，不是历史观察   |

核心字段：

- `apply_seq`：identity 主键，在用户锁内按写入顺序分配；同一用户按它升序重放。全局可有空洞，不表示跨用户提交顺序，也不替代业务时间。
- `idempotency_key`：全表唯一，不含 `attempt_count`。
- `user_id/session_id/analysis_job_id`：追踪 Job；基线只有 `user_id`。发音/语法原始结果外键二选一，原始表继续保存完整正文。
- `skill_id`、`source_ordinal`、`observation_correct`、`observation_code`：标准化观察；`source_ordinal` 固定为该评估批次内的原数组/规范列表位置。无法映射的原结果不入事件，只在完成事件 `details.unmapped` 计数。
- `source/provider/model_version/confidence/is_synthetic`：逐观察冻结来源事实。当前 BKT 不用 confidence，但后续阈值策略需要它。
- `algorithm_version/algorithm_params`：只写完成事件；任何参数或公式变化必须使用新版本。`details.coverage` 还须保存两个方向各自的 source/provider/model_version/is_synthetic/status，确保零观察时来源仍可审计。
- 完成与观察的 `occurred_at` 取非空 `sessions.ended_at`；基线取经批准切换事务的 `cutover_at`。`recorded_at` 和业务时间都不用于 BKT 排序 [session.py#L100](../backend/models/session.py#L100)。
- `p_mastery_snapshot/cutover_revision` 只用于基线；基线固定 `source=legacy_unknown`、`details.legacy_synthetic_impact=unknown`，只作重算起点，不能伪装成真实观察。`details.schema_version=1`，且不含原文、音频、Provider 原始响应、提示词或凭据。

不复制 `original`、`corrected`、`phoneme_alignment`、`elsa_response`、`provider_response_ref`。它们已由来源行持有，后两项对当前趋势无必要，复制只会扩大隐私和 retention 面。

```text
analysis_completed        job:{analysis_job_id}:completed
pronunciation_observation job:{analysis_job_id}:pron:{source_ordinal}
grammar_observation       job:{analysis_job_id}:grammar:{source_ordinal}
baseline_snapshot         baseline:{cutover_revision}:{user_id}:{skill_id}
```

同 Job 的 restart、stale recovery 和按现有规则允许的 failed retry 复用同一键；`attempt_count`
只属于执行状态。本版不开放成功 Job 的重新分析，失败重试和只读重算仍支持。若未来开放重新分析，
必须另批定义新的 analysis run/job 身份、批次替代/并存和趋势去重口径；当前
`analysis_jobs.session_id` 唯一约束不支持这种语义。

## 4. 同事务写入与确定性 BKT 顺序

1. 锁定并验证 running Job，读取 Session，执行评估并 flush `pronunciation_assessments` / `grammar_errors`；此时来源行仍未提交。随后 `SELECT ... FOR UPDATE` 锁 Session 的 `users.id` 到 commit。
   用户锁覆盖“插入事件—读状态—写状态—commit”；只锁 `knowledge_states` 行不够，因为首次创建时两事务都看不见目标行。
2. 在用户锁下、插事件前于同一事务校验：`job.id` 为当前 running Job、`session.id == job.session_id`、
   `session.user_id == locked_user_id`，且每个候选 assessment/grammar 的 `session_id == session.id`。
   任一不符或查询不到就 fail closed；事件只能使用本次校验过的 user/session/job/source ID。独立 FK
   只证明对象存在，不能证明同一用户、Session 或 Job 关系；当前草案没有约束这些交叉关系。
3. 在锁内 canonicalize 观察顺序：发音保持 `phoneme_alignment` 数组顺序；语法显式查询后按
   `(skill_id, error_type)` 排序。当前每技能至多一条 [analysis_service.py#L219](../backend/services/analysis_service.py#L219)；
   未来同技能多条时 adapter 须提供稳定 source key，不得靠随机 UUID；该顺序仅是批次内顺序。
4. 先插完成事件，再按 canonical 顺序逐条插 observation，使用
   `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING apply_seq`。冲突行须校验
   user/session/job/source、来源标记与载荷一致；不能证明已有写入完整提交时 fail closed，不重复记 BKT。
5. 只对本次新插入、非合成且技能有效的 observation，按 `apply_seq` 升序调用 BKT；现有四参数
   `p_init=.1 / p_transit=.2 / p_slip=.1 / p_guess=.2` 冻结为 `bkt-v1`
   [bkt_model.py#L16](../backend/services/knowledge/bkt_model.py#L16)。
6. 同事务置 Job `succeeded` 后 commit。任一步失败会回滚评估结果、事件、派生状态和成功状态。

同一用户的第二事务必须等第一事务释放用户锁，其事件不可能插到前者的用户级 `apply_seq` 区间中；
全局 sequence、`recorded_at`、随机 UUID 都不能单独代表 BKT 提交顺序。Job 成功前重试会回滚原事务并正常再写一次；成功 Job 不能再领取，因此不以 `attempt_count` 去重。

负向验收须覆盖事件用户与 Session 用户交叉、事件 Session 与 Job Session 不匹配、assessment 或 grammar
来自另一 Session 及其混搭；任一案例都必须无事件、无 BKT 写集且 Job 不得 succeeded，不能只验证 UUID 存在。

## 5. 合成、缺失信号与失败

| 场景                   | 事件结果                                     | BKT                                   |
| ---------------------- | -------------------------------------------- | ------------------------------------- |
| 发音真实、语法合成     | 两类事件均写，逐事件保留标记                 | 只用真实发音                          |
| 发音合成、语法真实     | 两类事件均写，逐事件保留标记                 | 只用真实语法                          |
| 全合成                 | 写完成事件及全部 mapped observation          | 不读、不创建、不更新状态              |
| 发音未配置/不可用      | 完成事件标 `pronunciation=not_called`        | 只处理其他真实观察                    |
| 语法已评估但无错误     | 完成事件标 `grammar=evaluated`、0 条语法观察 | 不伪造正确观察                        |
| 有转录但无 mapped 观察 | 写完成事件及 unmapped 计数                   | Job 可成功，无 BKT                    |
| 无用户转录             | 分析返回空，Job 失败                         | 事务回滚，无完成事件                  |
| 异常/外部取消          | 当前事务回滚                                 | 按现有失败/stale recovery；无部分事件 |

合成标记必须逐事件保存，不能只在会话或 Job 放总开关；否则部分合成方向会被误排除。派生必须同时约束
`event_type IN ('pronunciation_observation','grammar_observation')` 与 `is_synthetic=false`。完成事件和基线永不作为观察计入趋势。
实现时需把“未调用”“已评估零错误”“评估失败”拆成明确 coverage 状态，不能仅用 `assessment is None`
推断。
零语法错误没有持久化来源行：校验可以确认 coverage 结构与类型，并在来源存在时比对完成事件与来源事实，
但不能独立证明“零错误”或虚构 Provider 来源事实。

## 6. 旧状态切换、重算与校验

旧 `knowledge_states` 只是累积后的当前值，不能还原历史观察或顺序
[knowledge.py#L94](../backend/models/knowledge.py#L94)。用户于 2026-11-12 确认采用时点基线锚定：

1. 在维护模式停止旧分析写入后，为每个既有 `(user_id, skill_id)` 写
   `baseline_snapshot(source=legacy_unknown)`。它可能含未知历史合成影响，只保持掌握度连续并支持
   后续增量校验；它不产生历史趋势，也不能被描述为已证明的真实观察。旧历史趋势不可恢复。
2. 固定顺序为“建表 → 停旧写入并写基线 → 部署事件写入门控 → 恢复流量”。不能先写新事件再补基线，
   也不能让旧 worker 与基线快照并发更新。部署后每个提交成功的 Job 必须恰有一条完成事件。
3. 切换时仍为 `pending` 的 Job，以及按现有重试规则可处理的 `failed` Job，恢复后统一走新事务：
   评估、事件、BKT 状态和 Job `succeeded` 原子提交；每次重试复用同一幂等键。`occurred_at` 取真实
   `sessions.ended_at`，可能早于切换时间，BKT 按处理时 `apply_seq` 排序。该行为只称为“切换后处理
   历史会话”，不得宣称为历史回填、历史观察恢复或历史状态回放。
4. 切换前已经成功的旧 Job 不回填事件。历史会话没有观察级事件，不能从旧 `knowledge_states`
   反推，也不能把旧状态描述成真实历史趋势。

生产维护窗口、真实数据切换和生产发布不在本次 B1-0 文档卡内；未来执行必须另行通过生产变更门禁。

重算校验使用单一一致快照：`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`。事务首条查询
先绑定 `SELECT COALESCE(MAX(apply_seq), 0) FROM learning_events` 的固定 `watermark`；随后同一事务只扫描
`apply_seq <= watermark` 的事件，并在同一快照读取 `knowledge_states`、成功 Job 和来源关系。遇到基线即以
该技能快照为起点，遇到完成事件加载算法版本/参数，非合成 observation 按 `apply_seq` 更新技能，无基线技能
从 `p_init` 开始。最后逐技能比较重算值与状态快照，建议 `abs(diff) <= 1e-9`。快照后并发提交不可见，
不能把其事件/状态组合差异判成坏数据；普通 `READ COMMITTED` 逐语句查询不足以保证同一时点。

校验还须检查幂等键唯一、切换后每个成功 Job 恰有一条完成事件、来源标记和归属一致、全合成未改状态、
同用户 `apply_seq` 区间无交错，以及切点后的状态变化均能由基线加观察重算得到。失败只报告，不覆盖生产状态；
没有对应事件的状态写入和无完成事件的成功 Job 才是异常。

B1-3 实现采用数据库单例控制行和五阶段状态：
`prepared → legacy_writes_stopped → baselines_written → events_enabled → traffic_resumed`。控制行保存
`revision`、当前阶段、获准切点 `cutover_at`、基线数量与 SHA-256 摘要；只有 `traffic_resumed` 放行业务写入。
`stop_legacy_writes` 只记录维护人员对旧 worker 停写的显式确认，`cutover_at` 仍为空；锁和数据库时钟都不能
证明未知旧进程已经退出。

维护人员必须从停旧 worker 起维持全停写，直到 `traffic_resumed`。部署代码不会启动进程；数据库门控、
表锁和显式停写声明都不证明未知进程已经退出，不能把“部署了切换代码”写成“worker 已停”或“流量已恢复”。
实际 Job 领取函数 `claim_next_job` 本身没有 gate，因此全部新旧 worker 都必须保持停止到
`traffic_resumed`；显式停写声明、数据库锁和表锁都不能代替停进程。

写入基线的事务按固定顺序取得控制行 `FOR UPDATE`、`analysis_jobs` 表 `EXCLUSIVE` 锁和
`knowledge_states` 表 `SHARE ROW EXCLUSIVE` 锁。它等旧事务排空后重新检查 running Job 和异常既有事件，
读取固定状态集，再用数据库时钟固定 `cutover_at` 并写基线。Job 表使用 `SHARE ROW EXCLUSIVE` 会与旧 worker
已取得的行锁兼容，无法形成完整排空门，因此不能替代 `EXCLUSIVE`。事件 writer 和已领取 Job 的执行入口
统一先取控制行共享锁，再依次锁 Job 行和 User 行；直接 writer 也必须经过门控。

只读校验入口由 `services.learning_event_replay.validate_learning_event_replay` 提供。小型维护 CLI 仅接受
仓库已有的合成 PostgreSQL 白名单，不读取 `.env`、不猜默认库，也不会输出 DSN、来源原文或 Provider 响应：

```bash
cd backend
PYTHONPATH=. python -m scripts.learning_events_maintenance validate
PYTHONPATH=. python -m scripts.learning_events_maintenance baseline --revision <id>
PYTHONPATH=. python -m scripts.learning_events_maintenance baseline --revision <id> --confirm-write
```

`validate` 在一致时返回 0，发现不一致时返回 1；参数、配置或合成库白名单不符合时返回 2。`baseline`
默认只预览且零写，只有显式 `--confirm-write` 才进入写入事务，失败整体回滚。CLI 只接受仓库已批准的
合成库白名单，不隐式读取 `.env`，也不猜默认应用库。

## 7. 来源关系与保留策略

- `pronunciation_assessments` 1→0..N 发音事件；`grammar_errors` 1→0..1 语法事件。
- 切换后 `analysis_jobs` 1→1 完成事件 + 0..N 观察事件；`knowledge_states` 继续保存当前派生值。
- 迁移草案使用 `ON DELETE RESTRICT`，普通业务删除不能静默打断来源链。账号删除例外由 §7 规定的
  本平台整账号显式事务按依赖顺序处理。

用户于 2026-11-12 确认以下数据生命周期政策：

1. 账户存续期保留学习事件明细；不引入固定 TTL，也不做快照裁剪。完整明细支持长期趋势和一致重算。
2. 唯一首批业务删除例外是本平台“注销整个账号”。注销后在本平台业务库硬删该用户的事件、转录、
   分析结果、评估记录和 `knowledge_states` 等派生状态，不匿名化保留副本。
3. 整账号注销不操作外部 IdP，本版不增加单会话删除入口。备份和法定/特殊保留的生产方案另定；
   在方案落地前不得宣称已完成生产级不可恢复删除。
4. 本人数据以结构化 JSON 导出。导出至少包含事件、知识状态和本人已有转录与评估，并保留来源、
   合成标记、算法/模型/schema 版本等审计事实；排除密钥、内部提示词和 Provider 完整原始响应。
5. 本版不开放成功后重新分析；失败重试和只读重算继续支持。`bkt-v1` 冻结现有四参数，新算法版本
   不得原地改写旧事件。

B1-4 已按上述政策实现只读 `GET /api/user/data-export`。响应是固定 `schema_version=1` 的 JSON
附件，顶层仅含 `schema_version`、`exported_at`、`sessions`、`transcripts`、
`pronunciation_assessments`、`grammar_assessments`、`learning_events` 和 `knowledge_states`。
各节使用显式白名单投影：Session 只暴露解释子记录所需的最小元数据；排除 API Key、认证身份、
内部 prompt/文档、音频内容、Provider 完整原始响应/引用、幂等键及未列明的内部字段。未知
provider/model/schema 版本保留为 `null`，不补造旧历史或伪版本。

导出服务不复用认证调用方的数据库事务，而是在独立会话中开启单一
`REPEATABLE READ READ ONLY` 快照，从同一时点读取全部各节；认证事务内首次映射、尚未提交的用户
不被强制提交，也不把该新用户的本人空导出误判为越权。查询后验证 Event/Session、
Event/AnalysisJob/来源评估与 Skill 引用关系，并验证 knowledge state 归属；六类 Job/来源交叉
归属在失败时关闭。空账户返回空数组，部分数据只导出实际存在的内容，不补造关联行。顺序固定为
Session 开始时间、Transcript 时间、Assessment 创建时间、Event `apply_seq` 和 KnowledgeState
`skill_id`，并带稳定标识作为次序兜底。

完整模型构造后才整体缓冲序列化；失败返回不带成功头、下载头或半文件的通用 500。所有响应
`float` 边界均拒绝 `NaN` 与 `±Inf`，合法的 JSON `null` 仍表示为 `None/null`。成功响应只使用
`application/json`、`no-store`、固定附件文件名与 `nosniff`。本卡没有新增 UI、依赖、分页、异步
任务或配额；完整导出在内存中同步缓冲，内存占用和快照持续时间会随账户数据增长，是已登记风险。

B1-5 已按上述政策实现 `DELETE /api/user/account`。请求仅使用经 Bearer 映射的本人 ID，不接受
客户端替换身份；身份验签不读业务库，control gate 在本地 User 映射和 flush 前取得，随后复用同一
已验证身份。路由在同一调用方事务中显式删除 `users`、`user_profiles`、`user_settings`（含加密 Key
副本）、`sessions`、`transcripts`、`session_contexts`、`analysis_jobs`、
`pronunciation_assessments`、`grammar_errors`、`learning_events`、`knowledge_states` 和
`call_leases`，不匿名化或保留副本；全局 `skills` 与控制行保留。成功固定返回
`200 {"status":"deleted"}`，且只在 commit 完成后发送；异常整体 rollback 并返回不泄漏数据的通用
500。

删除前先校验跨用户/跨来源归属和原控制数量、摘要及 canonical baseline 完整性，坏关系不通过
`SET NULL`、删除或重算被“漂白”。合法删除后按剩余真实 `baseline_snapshot` 事件重算全局数量与摘要，
保留 singleton、revision、cutover_at、phase 和既有 gate；无 control 时使用 SREX 表锁并重读封闭
prepare 窗口，不重新从 `knowledge_states` 锚定。旧 Job、stale recovery、worker 与晚到写入不能复活
已删除数据。外部 IdP 不受本接口操作，本版没有 tombstone 或身份封禁；未来登录可依原自动映射机制
重新创建空账号。生产数据、生产备份、法定/特殊保留和外部 IdP 均不在当前授权内，因此不能宣称
生产级不可恢复删除。

整账号事务与全局控制锁的扫描成本会随账户数据增长；本版没有新增限额或异步删除。切换期间
`claim_next_job` 本身仍无 gate，全部新旧 worker 必须保持停止到 `traffic_resumed`；数据库锁和部署
代码都不能证明未知旧进程已经退出。

## 8. 单条线性 Alembic 形状（本轮专用合成库已验证）

父 revision 固定为 `c06_transcript_events`，实际新增文件为
`backend/alembic/versions/b1_learning_events.py`。本轮主控已从空合成库 upgrade 至
`b1_learning_events`，验证 current、downgrade 回 `c06_transcript_events` 后清除表/索引/identity，
并 reupgrade 至 b1；生产库未执行迁移。

```python
"""add append-only learning event ledger"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b1_learning_events"
down_revision = "c06_transcript_events"
branch_labels = depends_on = None

def upgrade() -> None:
    op.create_table(
        "learning_events",
        sa.Column("apply_seq", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True)),
        sa.Column("analysis_job_id", postgresql.UUID(as_uuid=True)),
        sa.Column("pronunciation_assessment_id", postgresql.UUID(as_uuid=True)),
        sa.Column("grammar_error_id", postgresql.UUID(as_uuid=True)),
        sa.Column("skill_id", sa.String(50)), sa.Column("source_ordinal", sa.Integer()),
        sa.Column("observation_correct", sa.Boolean()), sa.Column("observation_code", sa.String(64)),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("provider", sa.String(50)), sa.Column("model_version", sa.String(100)),
        sa.Column("confidence", sa.Float()), sa.Column("is_synthetic", sa.Boolean()),
        sa.Column("algorithm_version", sa.String(64)),
        sa.Column("algorithm_params", postgresql.JSONB()),
        sa.Column("p_mastery_snapshot", sa.Float()), sa.Column("cutover_revision", sa.String(100)),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
        sa.Column("details", postgresql.JSONB(), server_default=sa.text("'{\"schema_version\": 1}'::jsonb"), nullable=False),
        sa.CheckConstraint("event_type IN ('analysis_completed','pronunciation_observation',"
                           "'grammar_observation','baseline_snapshot')", name="ck_learning_events_type"),
        sa.CheckConstraint("confidence IS NULL OR confidence BETWEEN 0 AND 1",
                           name="ck_learning_events_confidence"),
        sa.CheckConstraint("p_mastery_snapshot IS NULL OR p_mastery_snapshot BETWEEN 0 AND 1",
                           name="ck_learning_events_snapshot"),
        sa.CheckConstraint(
            """(event_type='analysis_completed' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NULL AND skill_id IS NULL AND source_ordinal IS NULL
            AND observation_correct IS NULL AND observation_code IS NULL AND provider IS NULL
            AND model_version IS NULL AND confidence IS NULL AND is_synthetic IS NULL
            AND algorithm_version IS NOT NULL AND algorithm_params IS NOT NULL
            AND p_mastery_snapshot IS NULL AND cutover_revision IS NULL)
            OR (event_type='pronunciation_observation' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NOT NULL
            AND grammar_error_id IS NULL AND skill_id IS NOT NULL
            AND source_ordinal IS NOT NULL AND source_ordinal >= 0
            AND observation_correct IS NOT NULL AND observation_code IS NOT NULL
            AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
            AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL AND cutover_revision IS NULL)
            OR (event_type='grammar_observation' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NOT NULL AND skill_id IS NOT NULL
            AND source_ordinal IS NOT NULL AND source_ordinal >= 0
            AND observation_correct IS FALSE AND observation_code IS NOT NULL
            AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
            AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL AND cutover_revision IS NULL)
            OR (event_type='baseline_snapshot' AND session_id IS NULL
            AND analysis_job_id IS NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NULL AND skill_id IS NOT NULL AND source_ordinal IS NULL
            AND observation_correct IS NULL AND observation_code IS NULL AND provider IS NULL
            AND model_version IS NULL AND confidence IS NULL AND is_synthetic IS NULL
            AND algorithm_version IS NULL AND algorithm_params IS NULL
            AND source='legacy_unknown' AND p_mastery_snapshot IS NOT NULL AND cutover_revision IS NOT NULL)""",
            name="ck_learning_events_shape",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["analysis_job_id"], ["analysis_jobs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["pronunciation_assessment_id"],
                                ["pronunciation_assessments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["grammar_error_id"], ["grammar_errors.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("apply_seq"),
        sa.UniqueConstraint("idempotency_key", name="uq_learning_events_idempotency_key"),
    )
    op.create_index("ix_learning_events_user_seq", "learning_events", ["user_id", "apply_seq"])
    op.create_index("ix_learning_events_user_skill_seq", "learning_events",
                    ["user_id", "skill_id", "apply_seq"],
                    postgresql_where=sa.text("event_type IN ('pronunciation_observation','grammar_observation')"))
    op.create_index("ix_learning_events_session_seq", "learning_events", ["session_id", "apply_seq"])
    op.create_index("uq_learning_events_completed_job", "learning_events", ["analysis_job_id"],
                    unique=True,
                    postgresql_where=sa.text("event_type='analysis_completed'"))
def downgrade() -> None:
    op.drop_table("learning_events")
```

CHECK 审计：两个观察分支都显式要求 `source_ordinal IS NOT NULL`；语法正确性使用 `IS FALSE`，
因此 NULL 不会穿透。`confidence` 与 `p_mastery_snapshot` 是可空字段，但各自的范围 CHECK 已用
`IS NULL OR` 保护；其余非空要求均以 `IS NOT NULL` 或分支内 `IS NULL` 表达。

兼容审计：两个 observation 分支均允许 `model_version=NULL`。既有
`a5c6d7e8f901_add_assessment_provenance` 只为旧行回填 `legacy_mock`/`legacy_rule` source，
未回填 model_version；旧 pending 也可能已有被 `_detect_grammar_errors` 复用的 legacy_rule。
事件必须保留该未知事实，不得写入 `unknown` 等伪版本。

B1-3 新增迁移 `b1_learning_event_cutover`，父 revision 为 `b1_learning_events`。它只新增
`learning_event_cutover` 单例表，未改写既有 17 份迁移；表包含阶段形状 CHECK、基线数量检查和
`baseline_digest` 的 64 位十六进制形状要求。专用合成 PostgreSQL 已从既有 head upgrade 到
`b1_learning_event_cutover`，再 downgrade 回 `b1_learning_events`、reupgrade 与 roundtrip，均 exit 0；
既有事件保留，ORM 与真实 PG schema compare 零差异。既有 17 份迁移未改，执行到的 18 份迁移 pin 也未变。

## 9. 已确认政策与实施门禁

用户于 2026-11-12 明确确认以下七项，本文后续实现不得改变其语义：

1. 切换保留旧掌握度时点基线，固定 `source=legacy_unknown`；旧历史趋势不可恢复。
2. 旧 `pending` 和按现有重试规则可处理的 `failed` Job 在切换后统一走新事务；成功旧 Job 不回填。
   `occurred_at` 取真实 `sessions.ended_at`，BKT 按 `apply_seq` 处理顺序。
3. 账户存续期保留明细，仅账号删除是业务删除例外；不设固定 TTL，不做快照裁剪。
4. 本平台整账号注销联动硬删业务库事件、转录、分析、评估和派生状态；不匿名化，不操作外部 IdP，
   不增加单会话删除。备份及特殊保留的生产方案另定。
5. 本人数据以结构化 JSON 导出事件、状态及本人已有转录和评估；排除密钥、内部提示词、Provider
   完整原始响应，保留来源、合成标记和版本。
6. 本版不开放成功后的重新分析；失败重试与只读重算保留。
7. 现有四参数冻结为 `bkt-v1`；新版本不改写旧事件。

B1-0～B1-5 已于 2026-11-13 完成本地实施、主控代码/测试 Review 与完成项归档；历史 B1-1～B1-4
的具名数字继续只属于各自卡。B1-5 的目标套件为 `36 passed / 0 skip / exit 0`，完整 backend 为
`934 passed / 3 warnings / 0 skip / 81.64% / exit 0`，是完整树的子集关系；Vitest 保持
`1206 passed / 49 files`，Fake API 为 `113 passed / 0 skip / exit 0`，build-script 21、API 类型
8、iOS 脚本 Node runner 37 均 exit 0。lint 为 `132 warning / 0 error`，warning 行清单与 B1-4
逐行相同。完整双浏览器 E2E 保留
`233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败仍是同名范围外 WebKit 三 Provider
select `336x23 < 44px`；聚合入口不覆盖该原始失败。

B1-5 第一次完整 format 曾因 Node `fake-api-test.mjs` 返回 exit 1；该文件与六份收口 MD 已由现有
Prettier 纯格式化，最终完整 format 以主控补跑回执为准，不能提前写成全绿。OpenAPI/TypeScript
只新增 DELETE path 与一个响应 schema，旧 path/schema 逐值未变；18 份既有迁移字节未改，无新 DDL、
依赖、产品 UI 或 workflow 变更。目标数据库语义均以独立合成 PostgreSQL 验证，临时 PG 已停止并
自动移除。

主控代码/测试 Review 为 APPROVED，产品返修使用 `1/2`；用户 Review 仍待。代码 Review APPROVED
不等于用户验收或全 E2E 通过。提交/推送状态以同卡最终交付回执为准，当前文档不预填 SHA，不开 PR、
不合并、不部署。生产库未执行 DDL、切换、真实数据处理或不可恢复删除；真实 Provider/IdP/LiveKit、
设备、原生 iOS、远端 CI、生产备份与法定/特殊保留均未验收，音频采集与真实外部服务不在本范围。
任务分支 push 不触发远端 CI。
