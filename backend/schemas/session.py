"""会话相关 Pydantic 请求/响应模型。"""

from uuid import UUID

from pydantic import BaseModel

from schemas.time import UtcDatetime


class DocContext(BaseModel):
    """文档对话上下文。"""

    content_type: str = "text/markdown"
    raw_text: str
    prompt: str


class SessionCreate(BaseModel):
    """创建会话请求体。"""

    mode: str
    doc_context: DocContext | None = None  # 仅 mode=doc_chat 时必填


class TranscriptResponse(BaseModel):
    """转录记录响应。"""

    id: int
    session_id: UUID
    role: str
    content: str
    audio_url: str | None = None
    timestamp_ms: int
    emotion_state: dict | None = None  # Phase 3: 情绪状态快照

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    """会话详情响应（含转录记录）。"""

    id: UUID
    user_id: UUID
    mode: str
    status: str
    started_at: UtcDatetime
    ended_at: UtcDatetime | None = None
    transcripts: list[TranscriptResponse] = []

    model_config = {"from_attributes": True}


class SessionListItem(BaseModel):
    """会话列表项（不含转录记录）。"""

    id: UUID
    mode: str
    status: str
    started_at: UtcDatetime
    ended_at: UtcDatetime | None = None

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    """会话分页列表响应。"""

    items: list[SessionListItem]
    next_cursor: str | None = None


class DailyProgressResponse(BaseModel):
    """每日进度聚合统计响应。"""

    completed_sessions: int
    total_turns: int


class AnalysisStatusResponse(BaseModel):
    """Public state for one session's durable analysis job."""

    session_id: UUID
    status: str
    attempt_count: int
    error_code: str | None = None
    retryable: bool
    started_at: UtcDatetime | None = None
    finished_at: UtcDatetime | None = None
    updated_at: UtcDatetime
