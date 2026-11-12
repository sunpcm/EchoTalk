# EchoTalk 学习事件台账设计（B1 Approved Design）

> 状态：主控已完成独立设计审阅并 APPROVED，等待用户政策确认。本文只定义设计，不表示表、写入代码、基线或删除政策已实施。
> 范围是分析结果事件、写入幂等、派生校验、保留选项和一条迁移草案；音频采集及真实外部服务接入不在本项内。

## 1. 结论与边界

- 新建只追加的 `learning_events`。正常业务不得更新或删除；用户删除、法定删除或匿名化尚未批准，“只追加”不能豁免这些要求。
- 切换后，每个成功分析 Job 写一条 `analysis_completed`；每个可映射到现有技能的发音对齐项或语法错误再写
  observation。这样全合成、无发音、无语法错误也可审计，但“没报错”不会被伪造成“答对”。
- 评估结果、事件、`knowledge_states` 更新和 Job `succeeded` 必须同一事务提交；异常或取消整体回滚。
- 历史会话没有观察级事件，不能补录，也不能从旧 `knowledge_states` 反推出事件。真实趋势从切换后开始，旧状态只能作为明确标注的时点基线。
- 当前发音是 `demo_mock`，语法是 `demo_rule`，均标为合成
  [analysis_service.py#L149](../backend/services/analysis_service.py#L149)、
  [analysis_service.py#L237](../backend/services/analysis_service.py#L237)。本文不声称已有真实信号。

## 2. 当前代码事实

1. Job 对 `session_id` 唯一；领取时递增 `attempt_count`，成功后不能回 pending [analysis.py#L42](../backend/models/analysis.py#L42)、
   [analysis_jobs.py#L74](../backend/services/analysis_jobs.py#L74)。
2. `SKIP LOCKED` 只防止同一 Job 被并发领取，不保证同一用户的不同 Job 串行 [analysis_jobs.py#L113](../backend/services/analysis_jobs.py#L113)、
   [test_analysis_jobs.py#L198](../backend/tests/test_analysis_jobs.py#L198)。
3. 执行事务先锁 Job，再写结果、更新知识状态并置 succeeded；异常后原事务回滚，另事务记失败 [analysis_jobs.py#L158](../backend/services/analysis_jobs.py#L158)、
   [analysis_jobs.py#L223](../backend/services/analysis_jobs.py#L223)。
4. 外部取消会回滚未提交结果，Job 暂时保持 running，之后走 stale recovery
   [test_analysis_worker.py#L972](../backend/tests/test_analysis_worker.py#L972)。
5. 发音和语法当前都以“该 session 已有结果”为幂等条件；同一 Job 重复执行不会重复插入 [analysis_service.py#L110](../backend/services/analysis_service.py#L110)、
   [analysis_service.py#L212](../backend/services/analysis_service.py#L212)、[test_analysis_worker.py#L1234](../backend/tests/test_analysis_worker.py#L1234)。
6. BKT 只读 `is_synthetic=false`；发音按 JSON 数组顺序更新，语法查询当前没有 `ORDER BY` [analysis_service.py#L298](../backend/services/analysis_service.py#L298)、
   [analysis_service.py#L303](../backend/services/analysis_service.py#L303)、
   [analysis_service.py#L291](../backend/services/analysis_service.py#L291)。
7. `knowledge_states` 读取没有 `FOR UPDATE`；同用户不同 Job 可能覆盖状态或并发创建，最终由 `(user_id, skill_id)` 唯一约束兜底
   [analysis_service.py#L326](../backend/services/analysis_service.py#L326)、
   [knowledge.py#L113](../backend/models/knowledge.py#L113)。
8. 当前 Alembic head 为 `c06_transcript_events`，其父为 `c05_query_indexes`；转录 `event_id` 只做会话内去重，不是观察或 BKT 顺序
   [c06_transcript_events.py#L16](../backend/alembic/versions/c06_transcript_events.py#L16)、
   [session.py#L128](../backend/models/session.py#L128)。

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

同 Job 的 restart、stale recovery 和 failed retry 复用同一键。`attempt_count` 只属于执行状态。
将来“重新分析”必须建立新的 analysis run/job 身份，并另批新旧批次并存、替代或只选最新；当前
`analysis_jobs.session_id` 唯一约束不支持这种语义，不能把同 Job retry 偷换成重新分析。

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
5. 只对本次新插入、非合成且技能有效的 observation，按 `apply_seq` 升序调用 BKT；参数
   `p_init=.1 / p_transit=.2 / p_slip=.1 / p_guess=.2`，建议版本 `bkt-v1` [bkt_model.py#L16](../backend/services/knowledge/bkt_model.py#L16)。
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
[knowledge.py#L94](../backend/models/knowledge.py#L94)。切换方案：

1. **推荐：时点基线锚定。** 在维护模式停止旧分析写入后，为每个既有 `(user_id, skill_id)` 写
   `baseline_snapshot(source=legacy_unknown)`。它可能含未知历史合成影响，只保持掌握度连续并支持校验增量；
   不产生历史趋势，也不能被描述为已证明的真实观察。
2. **从 `p_init` 重建。** 切点清空状态并从 `0.1` 重放新事件；语义简单，但现有用户会看到回退，历史仍不可恢复。
3. **仅外部保留旧值。** 不把切换值写入事件表。实现少，但重算起点无法自证，后续版本迁移易漂移。

推荐顺序是“建表 → 停旧写入并经批准写基线 → 部署事件写入门控 → 恢复流量”。不能先写新事件再补基线，
也不能让旧 worker 与基线快照并发更新。方案及维护窗口仍需用户批准；部署后每个提交成功的 Job 才必须
有一条完成事件，历史已成功 Job 明确不在回填范围。

旧 pending/failed Job 的产品口径仍未批准，但若它不允许生成事件，就绝不能再走旧路径更新 BKT。
待选定项是：(a) 切换前停止领取并排空可执行旧 Job，或显式停用剩余旧 Job，之后只有事件写入门控可恢复处理；
(b) 批准切换后首批分析旧 Job，并让每次重试走同一事件/BKT 事务。`occurred_at` 仍取真实
`sessions.ended_at`，可能早于切换时间，BKT 仍按处理时 `apply_seq` 排序；这只能称为“切换后处理历史会话”，
不得宣称为历史回填、历史观察恢复或历史状态回放。

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
- 迁移草案使用 `ON DELETE RESTRICT`，普通删除不能静默打断来源链。用户删除或匿名化须在政策批准后走
  显式事务；若采用级联硬删，还必须处理派生状态、导出与法务保留。

| 选项                                                             | 优点               | 代价                                   |
| ---------------------------------------------------------------- | ------------------ | -------------------------------------- |
| A. 账户存续期保留明细；账户/法定删除时显式删或匿名化（推荐评估） | 长期趋势与完整重算 | 存储、隐私面最大，需批准删除与导出规则 |
| B. 明细保存固定窗口，之后只留周/月快照                           | 隐私和容量较好     | 旧历史不能精确重算，快照需另批实施     |
| C. 固定短窗口后硬删                                              | 实现最简单         | 长期趋势能力基本失效                   |

A 的含义是“日常只追加，仅已批准例外可删/匿名化”，不是“永久不删”。事件本身仍有用户 ID、技能、
置信度和时间，删除策略必须同时覆盖原始分析、转录和其他关联数据。保留时长、匿名化、删除后是否重建
状态、法务保留是否覆盖普通删除、是否导出原始评估和事件，均待用户决定。

## 8. 单条线性 Alembic 草案（不执行）

父 revision 固定为当前 head `c06_transcript_events`。以下仅是 Markdown 草案，没有创建迁移文件。

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
            AND model_version IS NOT NULL AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
            AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL AND cutover_revision IS NULL)
            OR (event_type='grammar_observation' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NOT NULL AND skill_id IS NOT NULL
            AND source_ordinal IS NOT NULL AND source_ordinal >= 0
            AND observation_correct IS FALSE AND observation_code IS NOT NULL
            AND model_version IS NOT NULL AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
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

## 9. Review 门禁与待用户决定

- 是否批准“时点基线 + 维护窗口切换”（接受 `legacy_unknown` 可能带有未知历史合成影响），或选择清空旧状态、仅外部保留旧值。
- 旧 pending/failed Job 选切点前排空/停用或批准切点后首批分析（允许 `occurred_at < cutover_at`，但不称历史回填）；若不入事件则不得更新 BKT，已完成会话绝不回填。
- retention 选 A/B/C，以及用户删除、法定删除、匿名化、导出和法律保留边界。
- 是否允许未来重新分析；若允许，另定新 run 身份、批次替代/并存和趋势去重口径。
- 是否批准把当前四参数冻结为 `bkt-v1`；参数或公式变化不得改写旧事件。
- 本设计通过 Review 和用户确认后，才进入表、代码、迁移执行和测试实施。
