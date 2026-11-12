"""Append-only learning event ledger ORM model."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class LearningEvent(Base):
    """One immutable user learning event in apply-order."""

    __tablename__ = "learning_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('analysis_completed','pronunciation_observation',"
            "'grammar_observation','baseline_snapshot')",
            name="ck_learning_events_type",
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name="ck_learning_events_confidence",
        ),
        CheckConstraint(
            "p_mastery_snapshot IS NULL OR p_mastery_snapshot BETWEEN 0 AND 1",
            name="ck_learning_events_snapshot",
        ),
        CheckConstraint(
            """
            (event_type='analysis_completed' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NULL AND skill_id IS NULL AND source_ordinal IS NULL
            AND observation_correct IS NULL AND observation_code IS NULL AND provider IS NULL
            AND model_version IS NULL AND confidence IS NULL AND is_synthetic IS NULL
            AND algorithm_version IS NOT NULL AND algorithm_params IS NOT NULL
            AND p_mastery_snapshot IS NULL AND cutover_revision IS NULL)
            OR (event_type='pronunciation_observation' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NOT NULL
            AND grammar_error_id IS NULL AND skill_id IS NOT NULL
            AND source_ordinal IS NOT NULL AND source_ordinal >= 0
            AND observation_correct IS NOT NULL AND observation_code IS NOT NULL
            AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
            AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL
            AND cutover_revision IS NULL)
            OR (event_type='grammar_observation' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NOT NULL AND skill_id IS NOT NULL
            AND source_ordinal IS NOT NULL AND source_ordinal >= 0
            AND observation_correct IS FALSE AND observation_code IS NOT NULL
            AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
            AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL
            AND cutover_revision IS NULL)
            OR (event_type='baseline_snapshot' AND session_id IS NULL
            AND analysis_job_id IS NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NULL AND skill_id IS NOT NULL AND source_ordinal IS NULL
            AND observation_correct IS NULL AND observation_code IS NULL AND provider IS NULL
            AND model_version IS NULL AND confidence IS NULL AND is_synthetic IS NULL
            AND algorithm_version IS NULL AND algorithm_params IS NULL
            AND source='legacy_unknown' AND p_mastery_snapshot IS NOT NULL
            AND cutover_revision IS NOT NULL)
            """,
            name="ck_learning_events_shape",
        ),
        UniqueConstraint(
            "idempotency_key",
            name="uq_learning_events_idempotency_key",
        ),
        Index("ix_learning_events_user_seq", "user_id", "apply_seq"),
        Index(
            "ix_learning_events_user_skill_seq",
            "user_id",
            "skill_id",
            "apply_seq",
            postgresql_where=text(
                "event_type IN ('pronunciation_observation','grammar_observation')"
            ),
        ),
        Index("ix_learning_events_session_seq", "session_id", "apply_seq"),
        Index(
            "uq_learning_events_completed_job",
            "analysis_job_id",
            unique=True,
            postgresql_where=text("event_type='analysis_completed'"),
        ),
    )

    apply_seq: Mapped[int] = mapped_column(
        BigInteger,
        Identity(),
        primary_key=True,
        autoincrement=True,
    )
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    analysis_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analysis_jobs.id", ondelete="RESTRICT"),
        nullable=True,
    )
    pronunciation_assessment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pronunciation_assessments.id", ondelete="RESTRICT"),
        nullable=True,
    )
    grammar_error_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("grammar_errors.id", ondelete="RESTRICT"),
        nullable=True,
    )
    skill_id: Mapped[str | None] = mapped_column(
        String(50),
        ForeignKey("skills.id", ondelete="RESTRICT"),
        nullable=True,
    )
    source_ordinal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    observation_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    observation_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_synthetic: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    algorithm_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    algorithm_params: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True),
        nullable=True,
    )
    p_mastery_snapshot: Mapped[float | None] = mapped_column(Float, nullable=True)
    cutover_revision: Mapped[str | None] = mapped_column(String(100), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        nullable=False,
    )
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        server_default=text("""'{"schema_version": 1}'::jsonb"""),
        nullable=False,
    )
