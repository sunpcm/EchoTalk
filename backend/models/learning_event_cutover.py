"""Persistent singleton controlling the learning-event cutover."""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class LearningEventCutover(Base):
    """The single approved cutover point and event-gate phase."""

    __tablename__ = "learning_event_cutover"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_learning_event_cutover_singleton"),
        CheckConstraint(
            "phase IN ('prepared','legacy_writes_stopped','baselines_written',"
            "'events_enabled','traffic_resumed')",
            name="ck_learning_event_cutover_phase",
        ),
        CheckConstraint(
            "baseline_count >= 0",
            name="ck_learning_event_cutover_baseline_count",
        ),
        CheckConstraint(
            """
            (phase IN ('prepared','legacy_writes_stopped')
             AND cutover_at IS NULL AND baseline_count = 0
             AND baseline_digest IS NULL)
            OR
            (phase IN ('baselines_written','events_enabled','traffic_resumed')
             AND cutover_at IS NOT NULL
             AND baseline_digest IS NOT NULL
             AND baseline_digest ~ '^[0-9a-f]{64}$')
            """,
            name="ck_learning_event_cutover_phase_shape",
        ),
        UniqueConstraint(
            "revision",
            name="uq_learning_event_cutover_revision",
        ),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    revision: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    phase: Mapped[str] = mapped_column(String(32), nullable=False)
    cutover_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    baseline_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    baseline_digest: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
