# EchoTalk 学习事件台账设计（B1 Approved Design）

> 历史交付：本设计随 PR #150 交付并合入，当时仅完成设计，主控独立审阅 APPROVED。
> 当前政策：用户已于 2026-11-12 确认 §6、§7 和 §9 的实施政策；设计已定稿，B1 已拆卡并进入实施。
> 当前实现状态：B1-1 的 `LearningEvent` ORM/注册、`b1_learning_events` 迁移及 schema 回归已
> 在专用合成 PostgreSQL 验证。B1-2 已实现 §3–§5 的同事务事件写入、幂等、用户锁与 BKT 合成
> 隔离，独立代码 Review 为 APPROVED；专用合成 PostgreSQL 目标套件 `116 passed / 0 skip /
exit 0`，完整 backend `844 passed / 3 warnings / 0 skip`、覆盖率 `80.82%`。15 项完整门禁中
> 14 项 `exit 0`，E2E `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败仍是既有
> WebKit Provider select `336×23 < 44px`，DocTalk 通过，不能称本机全树全绿。当前停在 B1-2
> Review，用户审阅仍待；B1-3～B1-5 尚未实施。生产库未执行 DDL、切换或真实数据处理。
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

**当前实现路径（2026-11-12，B1-2 独立代码 Review APPROVED）**：
[`execute_claimed_job`](../backend/services/analysis_jobs.py) 在同一事务调用
[`write_learning_events`](../backend/services/learning_events.py)。writer 在用户行锁下校验 Job/Session/User
与全部候选来源归属，按发音数组顺序和语法 `(skill_tag, error_type)` 顺序规范观察；完成与观察
事件按规范幂等键写入，冲突时按全局键重读并校验完整载荷。`occurred_at` 使用
`sessions.ended_at`，仅对新插入、非合成且映射到有效技能的观察按 `apply_seq` 更新 BKT，计算与完成
事件共享冻结的 `bkt-v1` 四参数。上述行为已由专用合成 PostgreSQL 目标套件与独立探针覆盖；当前停在
B1-2 Review，用户审阅仍待。

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

导出、整账号硬删及其 API 尚未实现。实现时必须保持跨用户隔离、事务原子性和失败回滚，并用合成
PostgreSQL 验证；生产数据、生产备份和外部 IdP 均不在当前授权内。

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

政策确认不等于整批实施完成。B1-1 的 ORM、迁移和 schema 回归，以及 B1-2 的同事务事件写入与 BKT
隔离均已实现；B1-2 独立代码 Review APPROVED，专用合成 PostgreSQL 目标套件 `116 passed / 0 skip /
exit 0`，完整门禁与唯一既有 E2E 失败的边界见 [PROJECT_STATUS 的 B1 小节](./PROJECT_STATUS.md)。
当前停在 B1-2 Review，用户审阅仍待；B1-3～B1-5 的基线工具、JSON 导出和整账号删除尚未实施。生产库
未执行 DDL，也没有生产切换、真实数据处理或上线证据。其顺序、依赖和验收见 [`TODO.md`](../TODO.md)；
生产切换和真实数据留待后续明确授权，音频采集及真实外部服务不在本范围。
