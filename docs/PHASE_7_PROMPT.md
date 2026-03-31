请阅读最新的 `DEVELOPMENT_PLAN.md` 以及新添加的 `EchoTalk Phase 7 技术方案设计` 文档。
我们现在准备实施 Phase 7: DocTalk (文档对话功能)。

请**仅执行**技术方案中的 **Step 1 (数据层与迁移)** 和 **Step 2 (后端 API 扩展)**。
**绝对不要**修改 `agent.py` 或 `llm_service.py`。

**Task 1: 数据库模型扩展 (`backend/models/session.py`)**

1. 在 `SessionMode` 枚举中追加 `"doc_chat"`。
2. 创建 `SessionContext` 模型（与 `Session` 一对一关联）。字段包括：`id` (BigInteger, PK), `session_id` (UUID, FK, unique, nullable=False), `custom_prompt` (Text, nullable=True), `document_content` (Text, nullable=True), `content_type` (String(50), default="text/markdown")。
3. 在 `Session` 模型中添加反向关系 `context: Mapped["SessionContext | None"]`。

**Task 2: Alembic 迁移脚本 (⚠️ 极高危：必须遵循)**

1. 生成 Alembic 迁移脚本。
2. **致命错误预防**：PostgreSQL 绝对不允许在事务块 (transaction block) 内执行 `ALTER TYPE ... ADD VALUE`。你**必须手动修改**生成的迁移脚本中的 `upgrade()` 函数，将 Enum 的更新放在事务外执行。
   请严格使用以下代码结构：
   ` ` `python
def upgrade() -> None:
    # 1. 必须在事务块外部执行 ENUM 更新
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE session_mode_enum ADD VALUE IF NOT EXISTS 'doc_chat'")
    # 2. 正常进行表的创建
    op.create_table('session_contexts', ...)
` ` `

**Task 3: API Schemas (`backend/schemas/session.py`)**

1. 新增 `DocContext` schema (包含 `content_type` 默认 "text/markdown", `raw_text` 字符串, `prompt` 字符串)。
2. 修改 `SessionCreate` schema，新增字段 `doc_context: DocContext | None = None`。

**Task 4: API 路由改造 (`backend/routers/sessions.py`)**

1. 在 `create_session` 接口中，如果 `mode == SessionMode.doc_chat`:
   - 校验必须提供 `doc_context` 且 `doc_context.raw_text` 不能为空白，否则抛出 400 错误。
   - 校验 `len(doc_context.raw_text) <= 50000`，超限抛出 400 错误。
2. 在创建并 flush `Session` 后，如果 `mode == SessionMode.doc_chat` 且存在 `doc_context`，则创建关联的 `SessionContext` 并 flush。

请执行上述任务，完成后运行 `black` 和 `flake8`。应用数据库迁移 (`alembic upgrade head`) 并向我汇报结果。在得到我的明确批准前，绝不要进入 Step 3。
