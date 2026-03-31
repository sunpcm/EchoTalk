# EchoTalk Phase 7 技术方案设计：自定义文档语音对话功能 (DocTalk)

> **版本**: v2 (优化版)
> **基于**: 对 `agent.py`、`llm_service.py`、`models/session.py`、`routers/sessions.py` 等核心源码的深度审计

---

## 1. 需求背景

允许用户上传自定义 Markdown 文档（如简历、论文、学习资料），并附带自定义的 Prompt（如"以此简历内容对我进行面试"、"和我讨论这篇论文的创新点"），AI 会根据这些上下文与用户进行实时的 WebRTC 语音对话。

---

## 2. 核心交互流程

1. **上传与配置**：用户进入「文档对话」专属页面，上传 `.md` / `.txt` 文件或直接粘贴文本内容，并输入/选择互动 Prompt。
2. **创建会话**：前端将文件内容和 Prompt 发送至后端，后端创建一个 `doc_chat` 模式的会话，文档上下文存入关联表。
3. **语音接入**：用户进入 LiveKit 房间，Agent 被 dispatch 加入。
4. **Agent 初始化**：Agent 读取该会话绑定的文档内容与 Prompt，与情绪感知系统协调，构建**持久化的文档上下文层**注入 LLM。
5. **语音对练**：双方就该文档进行深度讨论。会话结束后，依然走现有的发音评估流程。

---

## 3. 技术推荐方案 (最佳实践)

由于当前生态以文本为主的大模型（如 DeepSeek/Qwen 等）大多支持 32K~128K 超长上下文，我们推荐采用 **上下文直接注入 (Full Context Injection)** 作为默认方案，而非强制使用 RAG。

- **推荐理由**：
  - **不丢失信息点**：对于简历面试来说，遗漏任何一项经历都可能造成逻辑脱节，RAG 的 Top-K 检索可能会漏掉关键细节，全文注入更准确。
  - **开发成本极低**：省去文件切片（Chunking）、向量化（Embedding）的过程，系统响应更快。
  - **兼容性设计**：如果在后续迭代中引入超长文稿（解析 PDF），可再复用 Phase 4 的 ChromaDB 进行向量化检索降级。

---

## 4. 后端设计 (Backend)

### 4.1 数据模型变更 (PostgreSQL)

#### 4.1.1 扩展 `SessionMode` 枚举（复用现有体系，不新增冗余字段）

现有代码库中已存在规范的 `SessionMode` 枚举（`models/session.py`），包含 `pronunciation`、`free_talk`、`conversation`、`scenario`、`exam_prep`。**不应新增** `session_type: Mapped[str]` 硬编码字段，而是直接在枚举中扩充：

```python
class SessionMode(str, enum.Enum):
    """练习模式。"""
    pronunciation = "pronunciation"
    free_talk = "free_talk"
    conversation = "conversation"
    scenario = "scenario"
    exam_prep = "exam_prep"
    doc_chat = "doc_chat"  # Phase 7: 文档对话模式
```

> **注意**: 由于 `sessions.mode` 字段使用 PostgreSQL `Enum` 类型 (`session_mode_enum`)，Alembic 迁移时需要手动追加枚举值：
>
> ```sql
> ALTER TYPE session_mode_enum ADD VALUE 'doc_chat';
> ```

#### 4.1.2 新建 `SessionContext` 关联表（避免主表膨胀）

为避免大量文本（文档全文可达数万字符）拖慢 `sessions` 主表的列表 / 聚合查询性能，将文档上下文抽离为**独立的一对一关联表**：

```python
# models/session.py 新增

class SessionContext(Base):
    """会话上下文扩展表（一对一关联 sessions）。用于存储 doc_chat 等模式的文档/Prompt。"""

    __tablename__ = "session_contexts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), unique=True, nullable=False
    )
    custom_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str] = mapped_column(
        String(50), default="text/markdown"
    )  # 预留: text/markdown | text/plain | application/pdf

    session: Mapped["Session"] = relationship(back_populates="context")
```

在 `Session` 模型中添加反向关系：

```python
class Session(Base):
    # ... 现有字段 ...
    context: Mapped["SessionContext | None"] = relationship(
        back_populates="session", uselist=False, lazy="selectin"
    )
```

### 4.2 API 接口设计

#### 方案选择：复用 `POST /api/sessions` 而非新建独立端点

现有的 `POST /api/sessions` 接口只接收 `{ "mode": "..." }`。为保持接口体系统一，**不新建** `/api/sessions/doc-chat`，而是**扩展现有接口**，当 `mode=doc_chat` 时要求额外的 `doc_context` 字段：

**Request Body（扩展后）**:

```json
{
  "mode": "doc_chat",
  "doc_context": {
    "content_type": "text/markdown",
    "raw_text": "# 个人简历\n\n## 工作经历\n...",
    "prompt": "你现在是一名资深HR，根据这份简历对我进行面试，一次只问一个问题。"
  }
}
```

**Schema 变更 (`schemas/session.py`)**:

```python
class DocContext(BaseModel):
    """文档对话上下文。"""
    content_type: str = "text/markdown"  # 预留 PDF 等扩展
    raw_text: str  # 文档原文
    prompt: str  # 用户自定义指令

class SessionCreate(BaseModel):
    """创建会话请求体。"""
    mode: str
    doc_context: DocContext | None = None  # 仅 mode=doc_chat 时必填
```

**路由逻辑 (`routers/sessions.py`) 变更**:

```python
@router.post("/sessions", response_model=SessionResponse)
async def create_session(body: SessionCreate, ...):
    # ... 原有 mode 校验 ...

    # doc_chat 模式: 校验 doc_context 必填
    if mode == SessionMode.doc_chat:
        if not body.doc_context or not body.doc_context.raw_text.strip():
            raise HTTPException(status_code=400, detail="doc_chat 模式必须提供文档内容")
        if len(body.doc_context.raw_text) > 50000:
            raise HTTPException(status_code=400, detail="文档内容超过 50,000 字符限制")

    session = Session(...)
    db.add(session)
    await db.flush()

    # 创建关联的 SessionContext
    if mode == SessionMode.doc_chat and body.doc_context:
        ctx = SessionContext(
            session_id=session.id,
            custom_prompt=body.doc_context.prompt,
            document_content=body.doc_context.raw_text,
            content_type=body.doc_context.content_type,
        )
        db.add(ctx)
        await db.flush()

    await db.refresh(session)
    return session
```

### 4.3 Agent 逻辑适配 — 解决情绪感知 Prompt 覆盖问题 ⚠️

#### 问题分析

这是本方案中**最关键的技术隐患**。

现有 `EchoTalkAgent.on_user_turn_completed` 钩子（`agent.py:269`）在情绪模式切换时会调用：

```python
await self.update_instructions(build_dynamic_prompt(emotion.anxiety_level))
```

而 `build_dynamic_prompt()` (`llm_service.py:49`) 当前签名为：

```python
def build_dynamic_prompt(anxiety_level: float, weak_skills: list[str] | None = None) -> str:
```

它会从零构建一个全新的 System Prompt，**完全不知道**文档上下文的存在。一旦用户开口说话触发情绪分析导致模式切换，所有注入的简历/论文内容会被**瞬间抹除**。

#### 解决方案：三层 Prompt 架构

将 System Prompt 拆分为三个独立层次，每次 `update_instructions` 时按层合并：

```
┌──────────────────────────────────────────┐
│ Layer 1: 基础角色指令 (Role Instruction)    │  ← build_dynamic_prompt 管理
│   情绪感知 + 教学模式 + 薄弱技能            │
├──────────────────────────────────────────┤
│ Layer 2: 文档上下文 (Document Context)      │  ← 会话生命周期内不变
│   用户自定义 Prompt + 文档原文               │
├──────────────────────────────────────────┤
│ Layer 3: 通用指令 (General Guidelines)      │  ← 始终追加
│   对话风格 + 语言规范                       │
└──────────────────────────────────────────┘
```

**`llm_service.py` 重构**:

```python
def build_dynamic_prompt(
    anxiety_level: float,
    weak_skills: list[str] | None = None,
    custom_prompt: str | None = None,
    document_content: str | None = None,
) -> str:
    """
    根据实时情绪、薄弱技能、以及可选的文档上下文构建动态 System Prompt。

    Phase 7 新增: custom_prompt / document_content 参数。
    Agent 将这两个值作为实例属性持久化，确保每次 update_instructions 时都传入。
    """
    parts: list[str] = []

    # ── Layer 1: 基础角色指令 ──
    parts.append("You are a friendly and patient AI English speaking coach.\n")

    if custom_prompt:
        # doc_chat 模式: 用户自定义角色覆盖默认角色描述
        parts.append(f"[Custom Role Instruction]\n{custom_prompt}\n")
    else:
        parts.append(
            "[Role] Help the user practice spoken English "
            "through natural conversation.\n"
        )

    parts.append(
        "[Error Correction Strategy] Use implicit recasting (Recast): "
        "do NOT directly point out grammar or pronunciation mistakes. "
        "Instead, naturally repeat the correct form in your response.\n"
    )

    # 情绪指令（保持原逻辑不变）
    parts.append(f"[Emotion Awareness] Current user anxiety index: {anxiety_level:.2f}\n")
    if anxiety_level > 0.6:
        parts.append(
            "- The user appears anxious or struggling. "
            "Switch to ENCOURAGEMENT MODE:\n"
            "  * Use simpler vocabulary and shorter sentences\n"
            "  * Give more positive feedback and affirmation\n"
            "  * Avoid complex grammar terminology\n"
            "  * Use recasting gently, do not overwhelm\n"
            "  * Slow down the pace of conversation\n"
        )
    else:
        parts.append(
            "- The user is comfortable. Use normal teaching mode:\n"
            "  * You may introduce moderate challenges\n"
            "  * Use recasting naturally in your responses\n"
        )

    if weak_skills:
        skills_str = ", ".join(weak_skills)
        parts.append(f"[Weak Skills] Focus practice on: {skills_str}\n")

    # ── Layer 2: 文档上下文（持久层，不受情绪切换影响） ──
    if document_content:
        parts.append(
            "\n[Reference Document] The following document is the core context "
            "for this conversation. Base your questions and responses on it:\n"
            f"<document>\n{document_content}\n</document>\n"
        )

    # ── Layer 3: 通用指令 ──
    parts.append(
        "[Guidelines]\n"
        "- Keep responses concise (2-4 sentences) "
        "to maintain conversational flow\n"
        "- Adjust language complexity to match the user's level\n"
        "- If the user speaks in Chinese, gently guide them "
        "back to English\n"
        "- Ask follow-up questions to keep the conversation going"
    )

    return "\n".join(parts)
```

**`EchoTalkAgent` 类重构**:

```python
class EchoTalkAgent(Agent):
    def __init__(
        self,
        session_id: str,
        custom_prompt: str | None = None,
        document_content: str | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._session_id = session_id
        self._emotion_analyzer = EmotionAnalyzer()
        self._current_mode = "normal"

        # Phase 7: 持久化文档上下文，确保每次 update_instructions 时不丢失
        self._custom_prompt = custom_prompt
        self._document_content = document_content

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        text = new_message.text_content
        if not text:
            return

        emotion = self._emotion_analyzer.record_utterance(text, time.time())

        new_mode = "encouragement" if emotion.anxiety_level > 0.6 else "normal"
        if new_mode != self._current_mode:
            self._current_mode = new_mode
            # ✅ 关键修复: 每次更新 instructions 时都携带文档上下文
            await self.update_instructions(
                build_dynamic_prompt(
                    emotion.anxiety_level,
                    custom_prompt=self._custom_prompt,
                    document_content=self._document_content,
                )
            )

        asyncio.ensure_future(
            save_transcript(self._session_id, "user", text, emotion_state=emotion.to_dict())
        )
```

**`entrypoint` 函数中查询文档上下文**:

在 `entrypoint()` 现有的 `_fetch_user_settings` 之后，新增一个数据库查询以获取 `SessionContext`：

```python
async def _fetch_session_context(session_id: str) -> SessionContext | None:
    """根据 session_id 查询文档对话上下文。"""
    async with async_session_maker() as db:
        stmt = select(SessionContext).where(
            SessionContext.session_id == uuid.UUID(session_id)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

# 在 entrypoint 中:
session_context = await _fetch_session_context(session_id)

custom_prompt = session_context.custom_prompt if session_context else None
document_content = session_context.document_content if session_context else None

# 构建初始 System Prompt（含文档上下文）
initial_prompt = build_dynamic_prompt(
    anxiety_level=0.0,  # 初始无焦虑
    custom_prompt=custom_prompt,
    document_content=document_content,
)

agent = EchoTalkAgent(
    session_id=session_id,
    custom_prompt=custom_prompt,
    document_content=document_content,
    instructions=initial_prompt,  # ← 替代原来的 SYSTEM_PROMPT
    **plugins,
)
```

### 4.4 延迟优化：文档作为首条 User Message（可选增强）

在实时语音对话中，每一轮交互都会携带完整的 System Prompt 进行推理。如果文档超过 ~8K Token，长 System Prompt 会显著增加首字输出延迟（TTFT）。

**可选优化策略**：将 `<document>` 内容从 System Prompt 中抽出，改为作为**首条 User Message 历史记录**注入到对话上下文中：

```
messages = [
  { "role": "system", "content": "你是一名资深面试官..." },         # 仅保留角色指令
  { "role": "user", "content": "<document>简历内容...</document>" }, # 文档作为首条历史
  { "role": "assistant", "content": "好的，我已仔细阅读..." },      # 模拟确认
  ... 后续真实对话 ...
]
```

这样部分模型（尤其 DeepSeek-V3）可以对历史消息进行 KV Cache 命中，从而降低后续轮次的推理延迟。

> **MVP 阶段建议**：先用 System Prompt 注入（实现简单），如实测发现延迟 > 1.5 秒或 TTFT 劣化，再迁移到首条消息方案。

---

## 5. 前端设计 (Frontend - React 19 + Zustand)

### 5.1 路由与页面 (Dashboard 视图拓展)

在 `apps/vite-app/src` 中拓展 Dashboard 的状态机视图。
在现有 `appView` Zustand Store 中新增 `"doc-chat-setup"` 状态：

```typescript
type AppView = "dashboard" | "session" | "doc-chat-setup";
```

用户从 Dashboard 点击「文档对话」入口 → 进入 `doc-chat-setup` → 上传文件并填写 Prompt → 调用接口创建会话 → 切换到 `session` 进入 LiveKit 语音。

### 5.2 组件拆分

```
src/components/doc-chat/
  ├── DocChatSetup.tsx        # 页面容器：编排上传 + Prompt + 开始按钮
  ├── DocUploadCard.tsx       # 文件上传/粘贴区域
  ├── PromptBuilder.tsx       # Prompt 预设选择 + 自定义编辑
  └── DocChatStartButton.tsx  # 创建会话 + 进入语音
```

- **`DocUploadCard.tsx`**:
  - 支持拖拽或点击选择 `.md` / `.txt` 文件
  - 使用原生 `FileReader` 在浏览器端读取为字符串文本（不上传文件到服务器）
  - 提供 `Textarea` 允许直接粘贴或编辑内容
  - 实时显示字符数 / 预估 Token 数

- **`PromptBuilder.tsx`**:
  - 提供场景快捷按钮作为 Prompt 预设（"模拟面试"、"论文研讨"、"自由讨论"）
  - 点击预设自动填充 Textarea，用户可二次编辑
  - i18n key: `zhCN.docChat.presets.*`

- **`DocChatStartButton.tsx`**:
  - 校验文档内容非空且不超限
  - 调用后端 `POST /api/sessions`（`mode: "doc_chat"`）
  - 取回 `session_id` 后进入现有的 Token 签发 + Dispatch 流程

### 5.3 数据交互限制

- **前端硬限制**：Markdown 文本不超过 **50,000 字符**（约 30-40 KB / ~15K Token），与后端校验保持一致。
- **实时反馈**：文件选择后即时计算字符数，超限时禁用「开始对话」按钮并显示红色提示。
- **后端双重校验**：路由层对 `doc_context.raw_text` 长度再次校验，防止绕过前端限制。

### 5.4 i18n 规范

新增 `zhCN.docChat` 命名空间：

```json
{
  "docChat": {
    "title": "文档对话",
    "uploadHint": "上传 .md 或 .txt 文件，或直接粘贴内容",
    "promptLabel": "对话指令",
    "presets": {
      "interview": "模拟面试",
      "paper": "论文研讨",
      "free": "自由讨论"
    },
    "charCount": "{{count}} / {{max}} 字符",
    "charOverLimit": "文档内容超过字符限制",
    "startButton": "开始对话",
    "emptyDocError": "请先上传或粘贴文档内容"
  }
}
```

---

## 6. 架构影响与兼容性分析

| 现有模块                       | 影响程度 | 变更说明                                                              |
| ------------------------------ | -------- | --------------------------------------------------------------------- |
| `models/session.py`            | ⚠️ 中    | 扩展 `SessionMode` 枚举 + 新增 `SessionContext` 表 + Alembic 迁移     |
| `schemas/session.py`           | ⚠️ 中    | 新增 `DocContext` Schema，扩展 `SessionCreate`                        |
| `routers/sessions.py`          | ⚠️ 中    | `create_session` 增加 `doc_chat` 分支逻辑                             |
| `services/llm_service.py`      | ⚠️ 中    | `build_dynamic_prompt` 新增 `custom_prompt` / `document_content` 参数 |
| `livekit_agent/agent.py`       | ⚠️ 中    | `EchoTalkAgent` 持久化文档上下文 + `entrypoint` 新增 DB 查询          |
| `routers/assessment.py`        | ✅ 无    | 发音评估管线不受影响，会话结束时正常触发                              |
| `services/emotion_analyzer.py` | ✅ 无    | 纯文本分析逻辑不变                                                    |
| 前端 LiveKit 语音组件          | ✅ 无    | 复用现有 LiveKit 接入流程                                             |

---

## 7. 实施路径 (Phase 7 拆解)

### Step 1 - 数据层与迁移

- 在 `SessionMode` 枚举中追加 `doc_chat`
- 新建 `SessionContext` 模型与表
- 编写 Alembic 迁移脚本（含 `ALTER TYPE ... ADD VALUE`）

### Step 2 - 后端 API 扩展

- 扩展 `SessionCreate` Schema，新增 `DocContext`
- 修改 `create_session` 路由，处理 `doc_chat` 模式的关联数据插入
- 后端字符数校验（50,000 上限）

### Step 3 - Agent 核心重构（解决 Prompt 覆盖问题）

- 重构 `build_dynamic_prompt`，支持三层 Prompt 架构
- 重构 `EchoTalkAgent.__init__`，持久化 `_custom_prompt` 和 `_document_content`
- 修改 `on_user_turn_completed` 中的 `update_instructions` 调用
- `entrypoint` 增加 `_fetch_session_context` 数据库查询

### Step 4 - 前端页面开发

- 新增 `doc-chat-setup` 视图状态
- 开发 `DocUploadCard` / `PromptBuilder` / `DocChatStartButton` 组件
- 补充 i18n 语言包

### Step 5 - 集成测试与验收

- 使用一份真实的《后端开发简历.md》进行完整流程验证
- 验证情绪模式切换后文档上下文**不被丢失**
- 验证前后端字符数限制生效
- 验证 `standard` 模式（非 doc_chat）的回归无影响
