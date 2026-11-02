# RF-08 七列 Timezone-Aware UTC 时间语义验证记录

> 对应待办：[TODO.md](../../../TODO.md) RF-08 迁移与时间语义。
> 本次范围：应用层与 API 层统一 aware UTC，基于已独立审查通过的 `c04_utc_timestamps` 迁移 schema，完成七列模型、写入路径、Pydantic 响应类型以及专用测试库回归。

---

## 1. 背景与用户裁定

- **权威决策**：按 UTC 解释历史数据旧值，API 全面返回显式 UTC 格式（ISO 8601 带 `Z` 或 `+00:00`）。
- **审查与演练**：Alembic 迁移脚本 `backend/alembic/versions/c04_utc_timestamps.py`（SHA256: `3cb19d3f39c166f7e5e93587779d99240a8e2ac90cdbc1edf4c476d80425f612`）已由 Codex 独立完成静态审查与多时区（新加坡、洛杉矶、UTC）双向 SQL 演练，且保持只读。
- **边界说明**：本次验证仅在专用测试数据库（`echotalk_cp00_test`）的合成副本上执行，未访问或修改生产/真实外部数据库；真实上线需要协调 Alembic 迁移与 asyncpg prepared statement 缓存重建。

---

## 2. 实施清单

### 2.1 纯标准库时间工具 (`backend/time_utils.py`)

- 提供 `utc_now() -> datetime`，采用 `datetime.now(timezone.utc)`。
- 零第三方依赖、无导入期 I/O、无配置/环境或本地时区假设。

### 2.2 共享 UTC 响应模型类型 (`backend/schemas/time.py`)

- 定义 `UtcDatetime = Annotated[AwareDatetime, AfterValidator(_normalize_to_utc)]`：
  - 严格拒绝 naive `datetime` 及无时区 ISO 字符串；
  - 接受任意带时区 offset 的输入，并自动通过 `.astimezone(timezone.utc)` 归一化为 UTC；
  - 保证 JSON 序列化格式带明确时区标识（`Z`），OpenAPI 规范保持 `type: string, format: date-time`。

### 2.3 ORM 模型七列统一 `DateTime(timezone=True)`

1. `users.created_at` (`DateTime(timezone=True)`, `default=utc_now`, `nullable=False`)
2. `sessions.started_at` (`DateTime(timezone=True)`, `default=utc_now`, `nullable=False`)
3. `sessions.ended_at` (`DateTime(timezone=True)`, `nullable=True`)
4. `user_settings.updated_at` (`DateTime(timezone=True)`, `default=utc_now`, `onupdate=utc_now`, `nullable=False`)
5. `knowledge_states.updated_at` (`DateTime(timezone=True)`, `default=utc_now`, `nullable=False`)
6. `pronunciation_assessments.created_at` (`DateTime(timezone=True)`, `default=utc_now`, `nullable=False`)
7. `grammar_errors.created_at` (`DateTime(timezone=True)`, `default=utc_now`, `nullable=False`)

_注：已为 aware UTC 的 `AnalysisJob` 与 `CallLease` 保持不变。_

### 2.4 API 路由与服务写入统一

- `backend/routers/sessions.py`：创建会话 `started_at` 与结束会话 `ended_at` 统一使用 `utc_now()`。
- `backend/services/analysis_service.py`：更新知识状态 `updated_at` 统一使用 `utc_now()`。
- `backend/schemas/session.py` 与 `backend/schemas/assessment.py`：所有相关响应模型对齐 `UtcDatetime`。

---

## 3. 质量门禁与测试覆盖

- **新测试套件**：`backend/tests/test_utc_timestamps.py`
  - 7 列 ORM 定义检查（`type.timezone is True`、原 `nullable` 属性、default 与 onupdate 行为）；
  - `UtcDatetime` 针对 naive 输入的拒绝、非 UTC 偏移的自动归一化以及 JSON 显式 UTC；
  - 专用测试库（PostgreSQL）中 7 列的真实写入与读取，验证读出对象具备 `tzinfo` 且时间匹配；
  - 真实库中 `UserSettings.updated_at` 的 onupdate 触发验证。
- **既有测试修复**：
  - `backend/tests/test_assessment.py`、`test_call_leases.py`、`test_session_active_discovery.py` 同步移除 naive UTC fixtures 与 `datetime.utcnow()` 弃用警告。
- **门禁状态**：
  - 后端 Ruff 格式与 Lint 100% 通过；
  - 后端全部 pytest 回归通过，0 项 utcnow 弃用警告（保持 3 项既有非 UTC 警告：1 项 Starlette testclient 与 2 项 JWT 测试密钥长度警告）；
  - 前端 8 项质量门禁（Format、Lint、Typecheck、Vitest、Build Script、Fake API、Build、E2E）全部通过。

---

## 4. 待完成边界（RF-08 持续推进）

- 真实生产/预发数据库迁移与连接池缓存协同演练；
- 高频查询必要复合索引设计与验证；
- 列表接口有界分页改造。
- 当前整项在 `TODO.md` 中继续保持未勾选。
