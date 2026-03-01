"""会话相关 Pydantic 请求/响应模型。"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SessionCreate(BaseModel):
    """创建会话请求体。"""

    mode: str  # "conversation", "pronunciation", "free_talk", "scenario", "exam_prep"


class TranscriptResponse(BaseModel):
    """转录记录响应。"""

    id: int
    session_id: UUID
    role: str
    content: str
    audio_url: str | None = None
    timestamp_ms: int

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    """会话详情响应（含转录记录）。"""

    id: UUID
    user_id: UUID
    mode: str
    status: str
    started_at: datetime
    ended_at: datetime | None = None
    transcripts: list[TranscriptResponse] = []

    model_config = {"from_attributes": True}


class SessionListItem(BaseModel):
    """会话列表项（不含转录记录）。"""

    id: UUID
    mode: str
    status: str
    started_at: datetime
    ended_at: datetime | None = None

    model_config = {"from_attributes": True}
