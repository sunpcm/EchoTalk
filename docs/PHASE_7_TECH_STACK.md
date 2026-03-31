# Phase 7 DocTalk 文档对话功能 - 技术栈与架构文档

## 1. 核心目标

Phase 7 为 EchoTalk 引入**文档对话 (DocTalk)** 功能：用户可上传自定义 Markdown/TXT 文档（如简历、论文、学习资料），附带自定义 Prompt，AI 基于文档内容进行实时 WebRTC 语音对话。核心技术挑战在于解决情绪模式切换时文档上下文被覆盖的问题。

## 2. 新增与修改目录结构

```text
backend/
├── alembic/versions/
│   └── 91e80e32b8c6_phase7_add_doc_chat_mode_and_session_.py  # Alembic 迁移
├── models/
│   ├── __init__.py          # 导出 SessionContext
│   └── session.py           # 扩展 SessionMode 枚举 + 新增 SessionContext 模型
├── schemas/
│   └── session.py           # 新增 DocContext Schema, 扩展 SessionCreate
├── routers/
│   └── sessions.py          # create_session 增加 doc_chat 分支逻辑
├── services/
│   └── llm_service.py       # build_dynamic_prompt 重构为三层架构
└── livekit_agent/
    └── agent.py             # EchoTalkAgent 持久化文档上下文 + _fetch_session_context

apps/vite-app/src/
├── i18n/
│   └── zh-CN.ts             # 新增 docChat 命名空间
├── lib/
│   └── api.ts               # 新增 DocContext 接口, 扩展 createSession
├── store/
│   └── conversation.ts      # AppView 扩展 "doc-chat-setup", startSession 支持 docContext
├── components/
│   └── doc-chat/             # [新增目录]
│       ├── DocUploadCard.tsx  # 文件上传/粘贴 + 字符计数
│       ├── PromptBuilder.tsx  # Prompt 预设 + 自定义编辑
│       └── DocChatSetup.tsx   # 页面容器
└── App.tsx                   # 三向视图分发 (dashboard / doc-chat-setup / session)
```

## 3. 数据层设计

### 3.1 SessionMode 枚举扩展

在 `models/session.py` 的 `SessionMode` 枚举中追加 `doc_chat` 值：

```python
class SessionMode(str, enum.Enum):
    pronunciation = "pronunciation"
    free_talk = "free_talk"
    conversation = "conversation"
    scenario = "scenario"
    exam_prep = "exam_prep"
    doc_chat = "doc_chat"  # Phase 7
```

Alembic 迁移使用 `ALTER TYPE session_mode_enum ADD VALUE 'doc_chat'` 追加 PostgreSQL 枚举值。

### 3.2 SessionContext 一对一关联表

为避免大量文本（文档全文可达数万字符）拖慢 `sessions` 主表的查询性能，将文档上下文抽离为独立的一对一关联表：

```python
class SessionContext(Base):
    __tablename__ = "session_contexts"

    id: Mapped[int]                     # BigInteger 主键
    session_id: Mapped[uuid.UUID]       # FK → sessions.id, unique
    custom_prompt: Mapped[str | None]   # 用户自定义对话指令
    document_content: Mapped[str | None] # 文档原文 (≤ 50,000 字符)
    content_type: Mapped[str]           # 默认 "text/markdown"
```

`Session` 模型通过 `lazy="selectin"` 的反向关系 `context` 关联。

## 4. 三层 Prompt 架构 (核心)

### 4.1 问题背景

Phase 3 的情绪感知系统在 `on_user_turn_completed` 钩子中，当焦虑模式切换时会调用 `self.update_instructions(build_dynamic_prompt(anxiety_level))`。原实现从零构建全新 System Prompt，文档上下文会被**瞬间抹除**。

### 4.2 解决方案：三层合并

```
┌──────────────────────────────────────────┐
│ Layer 1: 角色与情绪 (Role Instruction)    │  ← 动态变化
│   基础角色 + 情绪模式 + 薄弱技能         │
│   + [Custom Role Instruction] (如有)     │
├──────────────────────────────────────────┤
│ Layer 2: 文档上下文 (Document Context)    │  ← 会话生命周期内不变
│   <document>原文</document>              │
├──────────────────────────────────────────┤
│ Layer 3: 通用指令 (General Guidelines)    │  ← 始终追加
│   对话风格 + 语言规范                     │
└──────────────────────────────────────────┘
```

### 4.3 `llm_service.py` — `build_dynamic_prompt` 函数

函数签名扩展为：

```python
def build_dynamic_prompt(
    anxiety_level: float,
    weak_skills: list[str] | None = None,
    custom_prompt: str | None = None,
    document_content: str | None = None,
) -> str:
```

组装顺序：

1. 基础角色描述 (Role + Error Correction Strategy)
2. 情绪指令 (Emotion Awareness + 鼓励/正常模式切换)
3. 薄弱技能 (Weak Skills, 如有)
4. `[Custom Role Instruction]` (如有 `custom_prompt`)
5. `[Reference Document]` + `<document>...</document>` (如有 `document_content`)
6. `[Guidelines]` (始终追加)

### 4.4 `agent.py` — `EchoTalkAgent` 持久化

```python
class EchoTalkAgent(Agent):
    def __init__(self, session_id, custom_prompt=None, document_content=None, **kwargs):
        self._custom_prompt = custom_prompt          # 持久化
        self._document_content = document_content    # 持久化

    async def on_user_turn_completed(self, turn_ctx, new_message):
        # 情绪模式切换时，始终携带文档上下文
        await self.update_instructions(
            build_dynamic_prompt(
                emotion.anxiety_level,
                custom_prompt=self._custom_prompt,       # ✅ 不丢失
                document_content=self._document_content, # ✅ 不丢失
            )
        )
```

### 4.5 `agent.py` — `entrypoint` 初始化链路

1. `_fetch_session_context(session_id)` 查询 `SessionContext` 表
2. 提取 `custom_prompt` 和 `document_content`
3. `build_dynamic_prompt(anxiety_level=0.0, custom_prompt=..., document_content=...)` 构建初始 Prompt
4. 传入 `EchoTalkAgent(instructions=initial_prompt, custom_prompt=..., document_content=...)`

## 5. 后端 API 扩展

### 5.1 Schema 变更

```python
class DocContext(BaseModel):
    content_type: str = "text/markdown"
    raw_text: str       # 文档原文
    prompt: str         # 用户自定义指令

class SessionCreate(BaseModel):
    mode: str
    doc_context: DocContext | None = None  # 仅 mode=doc_chat 时必填
```

### 5.2 路由逻辑

`POST /api/sessions` 在 `mode=doc_chat` 时：

- 校验 `doc_context` 非空且 `raw_text` 不为空
- 校验 `raw_text` 长度 ≤ 50,000 字符
- 创建 `Session` 后关联创建 `SessionContext`

## 6. 前端实现

### 6.1 Zustand 视图状态扩展

```typescript
type AppView = "dashboard" | "session" | "doc-chat-setup";
```

`startSession` 签名扩展为 `(mode: string, docContext?: DocContext) => Promise<void>`，透传至 `createSession` API 调用。

### 6.2 纯客户端文档读取策略

`DocUploadCard` 使用浏览器原生 `FileReader` 读取 `.txt/.md` 文件为字符串，**不上传文件到服务器**。文件内容填充到 textarea 供用户二次编辑，最终随 API 请求以 JSON 字符串形式发送。

### 6.3 组件核心逻辑

- **`DocUploadCard`**: 点击选择文件 → `FileReader.readAsText` → 填充 textarea；实时统计字符数，超过 50,000 显示红色警告并触发拦截
- **`PromptBuilder`**: 三个预设按钮（模拟面试 / 论文研讨 / 自由讨论），点击自动填充 i18n Prompt 模板，用户可二次编辑
- **`DocChatSetup`**: 组合以上组件，管理 `rawText` / `prompt` 局部状态；底部「开始对话」按钮在字符数为 0 或超限时 `disabled`；点击后组装 `DocContext` payload 调用 `startSession("doc_chat", docContext)`

### 6.4 Dashboard 入口

在首页 Dashboard 中新增一个渐变色 DocTalk 入口卡片，点击后将 `appView` 切换为 `"doc-chat-setup"`。App 组件三向视图分发：`dashboard` → Dashboard, `doc-chat-setup` → DocChatSetup, `session` → VoiceInterface。

## 7. 涉及技术栈

### 后端

- **SQLAlchemy (Async)**: `SessionContext` 一对一关联表、`selectin` 懒加载
- **Alembic**: `ALTER TYPE ... ADD VALUE` 枚举扩展迁移
- **LiveKit Agents SDK**: `Agent.update_instructions()` 动态 Prompt 注入

### 前端

- **Zustand**: 视图状态机扩展 + `startSession` 签名扩展
- **FileReader API**: 浏览器端文档读取，零服务端上传
- **Tailwind CSS v4**: 全新组件样式（渐变卡片、虚线上传区域）
