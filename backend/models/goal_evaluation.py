"""Append-only goal evaluation runs and per-goal results."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from time_utils import utc_now


class GoalRunStatus(str, enum.Enum):
    """Execution progress of one goal evaluation run."""

    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class GoalResult(str, enum.Enum):
    """Terminal adjudication for one goal."""

    achieved = "achieved"
    not_achieved = "not_achieved"
    unknown = "unknown"
    not_assessed = "not_assessed"


class GoalRun(Base):
    """One frozen evaluation run per session revision."""

    __tablename__ = "goal_runs"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "revision",
            name="uq_goal_runs_session_revision",
        ),
        ForeignKeyConstraint(
            ["session_id"],
            ["session_goal_snapshots.session_id"],
            name="fk_goal_runs_session_id",
            ondelete="CASCADE",
        ),
        Index("ix_goal_runs_claimable", "status", "next_retry_at", "created_at"),
        CheckConstraint(
            "revision > 0",
            name="ck_goal_runs_revision_positive",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_goal_runs_attempt_count_nonnegative",
        ),
        CheckConstraint(
            "jsonb_typeof(evidence) = 'array'",
            name="ck_goal_runs_evidence_array",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
    )
    revision: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default=text("1"),
        nullable=False,
    )
    status: Mapped[GoalRunStatus] = mapped_column(
        Enum(GoalRunStatus, name="goal_run_status_enum"),
        default=GoalRunStatus.pending,
        server_default=GoalRunStatus.pending.value,
        nullable=False,
    )
    evaluator_version: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB(astext_type=Text()),
        nullable=False,
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default=text("0"),
        nullable=False,
    )
    last_error_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    last_error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=text("now()"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        server_default=text("now()"),
        nullable=False,
    )


class GoalEvaluationResult(Base):
    """One append-only, immutable terminal result for a goal."""

    __tablename__ = "goal_results"
    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "goal_id",
            name="uq_goal_results_run_goal",
        ),
        ForeignKeyConstraint(
            ["run_id"],
            ["goal_runs.id"],
            name="fk_goal_results_run_id",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "goal_version > 0",
            name="ck_goal_results_goal_version_positive",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
    )
    goal_id: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    goal_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    result: Mapped[GoalResult] = mapped_column(
        Enum(GoalResult, name="goal_result_enum"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=text("now()"),
        nullable=False,
    )
