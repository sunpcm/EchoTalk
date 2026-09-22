"""Persistent analysis job state for completed practice sessions."""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


def utc_now() -> datetime:
    """Return an aware UTC timestamp for persisted job state."""
    return datetime.now(timezone.utc)


class AnalysisJobStatus(str, enum.Enum):
    """Allowed states for a session analysis job."""

    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class AnalysisJob(Base):
    """One durable, retryable analysis job per practice session."""

    __tablename__ = "analysis_jobs"
    __table_args__ = (
        Index("ix_analysis_jobs_claimable", "status", "next_retry_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    status: Mapped[AnalysisJobStatus] = mapped_column(
        Enum(AnalysisJobStatus, name="analysis_job_status_enum"),
        default=AnalysisJobStatus.pending,
        nullable=False,
    )
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    session: Mapped["Session"] = relationship(back_populates="analysis_job")  # noqa: F821
