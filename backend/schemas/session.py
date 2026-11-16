"""会话相关 Pydantic 请求/响应模型。"""

from collections.abc import Mapping
from datetime import date as CalendarDate
from typing import Annotated, Any
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from schemas.scenario_goals import MATERIAL_ID_PATTERN
from schemas.time import UtcDatetime


class DocContext(BaseModel):
    """文档对话上下文。"""

    content_type: str = "text/markdown"
    raw_text: str
    prompt: str


class GoalBindingRef(BaseModel):
    """Client-selected immutable goal catalog reference."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    material_id: Annotated[
        str,
        StringConstraints(strict=True, pattern=MATERIAL_ID_PATTERN),
    ]
    material_version: int = Field(gt=0)


class SessionCreate(BaseModel):
    """创建会话请求体。

    未携带 binding 的 legacy 请求继续忽略顶层额外字段。只有显式非 null
    binding 才启用严格顶层输入，避免改变旧客户端语义。
    """

    mode: str
    doc_context: DocContext | None = None  # 仅 mode=doc_chat 时必填
    goal_binding: GoalBindingRef | None = None

    @model_validator(mode="before")
    @classmethod
    def _validate_explicit_goal_binding(cls, value: Any) -> Any:
        if not isinstance(value, Mapping):
            return value
        if value.get("goal_binding") is None:
            return value

        expected = {"mode", "doc_context", "goal_binding"}
        unexpected = sorted(str(key) for key in set(value).difference(expected))
        if unexpected:
            raise ValueError(
                "goal_binding requests reject extra fields: " + ", ".join(unexpected)
            )
        if value.get("mode") != "scenario":
            raise ValueError("goal_binding is only valid for mode=scenario")
        return value


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


class WeeklyProgressDay(BaseModel):
    """一个本地自然日对应的 UTC 半开窗口及可选的已记录会话时长。"""

    date: CalendarDate
    start: UtcDatetime
    end: UtcDatetime
    completed_sessions: int = Field(ge=0)
    recorded_duration_ms: int | None = Field(default=None, ge=0)
    duration_unavailable_count: int | None = Field(default=None, ge=0)


class WeeklyProgressResponse(BaseModel):
    """按本地日期升序排列的固定七日统计，包含零桶。"""

    days: list[WeeklyProgressDay] = Field(min_length=7, max_length=7)


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
