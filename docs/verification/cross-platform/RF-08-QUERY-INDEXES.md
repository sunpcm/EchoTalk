# RF-08 三项必要查询索引验证记录

> 对应待办：[TODO.md](../../../TODO.md) RF-08 迁移与时间语义。
> 本次范围：数据模型元数据与 Alembic `c05_query_indexes` 迁移脚本编写；包含三项高频查询非唯一 B-tree 索引定义、既有唯一索引复用说明、实际查询模式匹配证据与回滚契约。

---

## 1. 背景与方案契约

- **契约决策**：落实已批准的组合方案，为高频会话、转录及语法错误查询补齐三项必要非唯一 B-tree 索引，与既有唯一约束形成无冗余覆盖。
- **审查与验证边界**：
  - 新迁移脚本 `backend/alembic/versions/c05_query_indexes.py` 严格遵循下接 `c04_utc_timestamps` 的单链结构。
  - 本轮遵循评审/实施分离规范：实施方仅负责 ORM 模型元数据声明、Alembic 迁移脚本编写与静态语法/门禁检查；不私自执行/导入未获独立审查的新迁移，不探测数据库凭据。
  - 迁移脚本提交固定 SHA 后，由 Codex 独立执行静态审查并在专用测试库合成副本完成 `upgrade` / `downgrade` / `re-upgrade` 演练，以及多用户/多 session 自然 planner 的 `EXPLAIN (ANALYZE, BUFFERS)` 验证。
  - 本批不改动 API 路由、分页、统计、前端逻辑或业务行为，整项在 `TODO.md` 中保持未勾选。

---

## 2. 索引设计与查询模式对齐

### 2.1 新增三项非唯一 B-tree 索引

| 索引名称                            | 目标表           | 索引列及方向                          | 对应现有业务查询与证据                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ix_sessions_user_started_id`       | `sessions`       | `(user_id, started_at DESC, id DESC)` | `routers/sessions.py` 中 `list_active_sessions` (`WHERE user_id = :uid AND status = 'active' ORDER BY started_at DESC, id DESC`) 及 `list_sessions` (`WHERE user_id = :uid ORDER BY started_at DESC`)。提供稳定 keyset 排序覆盖；不添加 `active` 部分索引，避免高频状态变更带来写放大风险。 |
| `ix_transcripts_session_timestamp`  | `transcripts`    | `(session_id, timestamp_ms)`          | `routers/conversation.py` 中会话历史加载 (`WHERE session_id = :sid ORDER BY timestamp_ms`) 及 `Session.transcripts` 关系关联 (`order_by="Transcript.timestamp_ms"`)。支持先按会话过滤再排序，实际合成计划使用位图索引过滤并对小结果集排序。                                                 |
| `ix_grammar_errors_session_created` | `grammar_errors` | `(session_id, created_at)`            | `routers/assessment.py` 中语法错误查询 (`WHERE session_id = :sid ORDER BY created_at`)。由于现有端点未带 `is_synthetic = false` 谓词，既有 partial 索引无法命中，因此需要此全量复合索引。                                                                                                   |

### 2.2 既有索引与约束复用（不重复建索引）

1. **`pronunciation_assessments(session_id)`**：
   - 模型字段 `session_id` 已声明 `unique=True`（生成唯一约束/索引 `uq_pronunciation_assessments_session_id`）。
   - 查询 `WHERE session_id = :sid` 已被该唯一索引完全覆盖，无需也不得重复建立非唯一索引。
2. **`knowledge_states(user_id, skill_id)`**：
   - 模型已声明 `UniqueConstraint("user_id", "skill_id", name="uq_user_skill")`。
   - 联合查询与写入已由该复合唯一索引覆盖，无需建立冗余索引。
3. **`grammar_errors` 既有部分索引保留**：
   - 既有 `ix_grammar_errors_real_session_id (session_id WHERE is_synthetic = false)` 完整保留，服务于真实评估的筛选分析；新全量索引覆盖一般业务查询。

---

## 3. 实施清单

### 3.1 ORM 模型元数据声明

- **`backend/models/session.py`**：
  - 导入 `Index` 与 `text`；
  - `Session.__table_args__` 追加 `Index("ix_sessions_user_started_id", "user_id", text("started_at DESC"), text("id DESC"))`，保留原有 `uq_sessions_user_idempotency_key` 约束；
  - `Transcript.__table_args__` 追加 `Index("ix_transcripts_session_timestamp", "session_id", "timestamp_ms")`。
- **`backend/models/exercise.py`**：
  - `GrammarError.__table_args__` 追加 `Index("ix_grammar_errors_session_created", "session_id", "created_at")`，保留既有 `ck_grammar_errors_confidence` 检查约束与 `ix_grammar_errors_real_session_id` 部分索引。

### 3.2 Alembic 迁移脚本 (`backend/alembic/versions/c05_query_indexes.py`)

- `revision = "c05_query_indexes"`，`down_revision = "c04_utc_timestamps"`；
- `upgrade()`：
  - 使用 `op.create_index` 与 `sa.text` 明确创建上述 3 项非唯一 B-tree 索引；
  - 纯事务性 DDL，不使用并发建索引（CONCURRENTLY）或 autocommit，便于专用测试库完整回滚。
- `downgrade()`：
  - 严格逆序执行 `op.drop_index`（先 drop `grammar_errors`，次 `transcripts`，后 `sessions`）；
  - 不删除其它索引/约束/表或影响数据。

---

## 4. 质量门禁与验证

- **代码与格式门禁**：
  - 后端 Ruff 格式与 Lint 检查通过；
  - 前端 8 项质量门禁（Format、Lint、Typecheck、Vitest、Build Script、Fake API、Build、E2E）全部通过。
- **后续独立验收职责**：
  - 本轮不直接执行新迁移或运行后端 pytest；
  - 待 Codex 独立审查固定提交后，由架构 Agent 在独立测试库完成 `c05` 迁移升级/回滚验证及 294+ 项后端 pytest 测试与 EXPLAIN 查询计划验收。

---

## 5. 待完成边界（RF-08 持续推进）

- 真实线上生产数据库在业务低峰期的并发建索引（`CREATE INDEX CONCURRENTLY`）锁等待、空间占用与流量分流策略评估；
- 列表接口有界分页改造（Session 历史列表 keyset 分页等）；
- RF-08 整体在 `TODO.md` 中继续保持未勾选。

## 6. Codex 独立迁移与查询计划核验

新迁移先经独立静态审查并固定 SHA256 `b411e206c8165011b4bfdfeef45566ce2541d3ed4d2aa3dfca79f5557e3489ee`。仅在专用测试库的空副本及合成多用户副本演练升级、降级、再次升级，所有行数、列、默认值、既有索引和约束保持。合成副本含 50,000 会话、100,000 转录及 100,000 语法错误，不含真实用户数据。随后在经核全空的专用测试库副本通过实际 Alembic c04→c05 路径核验仅新增三项索引。

自然 planner（未关闭 Seq Scan）选择三个目标新索引。同一合成场景的共享缓冲区访问总数（hit + read）：会话 252→53、转录 935→23、语法错误 1640→23。转录与语法错误计划仍采用 Bitmap Scan 后的小结果集排序，并非消除所有 Sort。旧无新索引计划均未满足目标索引判据，构成三项真实前后对照。原始计划仅保留本地 `.review/`。这些数值是本机合成样本，不能推算真实生产延迟、冷启动或镜像体积收益。

完整后端回归由 Codex 在已审 c05 专用副本及 A37 Dev 隔离解释器中独立执行：294 项 pytest 通过，覆盖率 74.03%，0 项 utcnow 弃用警告（保留 3 项其它既有警告）；88 个 Python 文件 Ruff 格式与 lint 通过。
