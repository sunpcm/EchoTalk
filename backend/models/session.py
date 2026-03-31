"""会话相关 ORM 模型：sessions 表与 transcripts 表。"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Enum, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class SessionMode(str, enum.Enum):
    """练习模式。"""

    pronunciation = "pronunciation"
    free_talk = "free_talk"
    conversation = "conversation"
    scenario = "scenario"
    exam_prep = "exam_prep"
    doc_chat = "doc_chat"  # Phase 7: 文档对话模式


class SessionStatus(str, enum.Enum):
    """会话状态。"""

    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class TierUsed(str, enum.Enum):
    """本次会话使用的管线等级。"""

    free = "free"
    pro = "pro"
    premium = "premium"


class TranscriptRole(str, enum.Enum):
    """转录角色。"""

    user = "user"
    assistant = "assistant"


class Session(Base):
    """练习会话表。"""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    mode: Mapped[SessionMode] = mapped_column(
        Enum(SessionMode, name="session_mode_enum"), nullable=False
    )
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, name="session_status_enum"),
        default=SessionStatus.active,
        nullable=False,
    )
    scenario_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tier_used: Mapped[TierUsed | None] = mapped_column(
        Enum(TierUsed, name="tier_used_enum"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # 关系
    user: Mapped["User"] = relationship(back_populates="sessions")  # noqa: F821
    transcripts: Mapped[list["Transcript"]] = relationship(
        back_populates="session",
        order_by="Transcript.timestamp_ms",
        lazy="selectin",
    )
    context: Mapped["SessionContext | None"] = relationship(
        "SessionContext", back_populates="session", uselist=False, lazy="selectin"
    )


class Transcript(Base):
    """会话转录记录表。"""

    __tablename__ = "transcripts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False
    )
    role: Mapped[TranscriptRole] = mapped_column(
        Enum(TranscriptRole, name="transcript_role_enum"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Phase 3: 情绪状态快照（anxiety_level, cognitive_load, hesitation_rate, wpm）
    emotion_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # 关系
    session: Mapped["Session"] = relationship(back_populates="transcripts")


class SessionContext(Base):
    """会话上下文扩展表（一对一关联 sessions）。用于存储 doc_chat 等模式的文档/Prompt。"""

    __tablename__ = "session_contexts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), unique=True, nullable=False
    )
    custom_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str] = mapped_column(String(50), default="text/markdown")

    # 关系
    session: Mapped["Session"] = relationship(back_populates="context")
