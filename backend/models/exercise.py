"""发音评估与语法错误 ORM 模型：pronunciation_assessments 表与 grammar_errors 表。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class PronunciationAssessment(Base):
    """发音评估结果表。"""

    __tablename__ = "pronunciation_assessments"
    __table_args__ = (
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_pronunciation_assessments_confidence",
        ),
        Index(
            "ix_pronunciation_assessments_real_created_at",
            "created_at",
            postgresql_where=text("is_synthetic = false"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), unique=True, nullable=False
    )
    overall_score: Mapped[float] = mapped_column(Float, nullable=False)
    phoneme_alignment = mapped_column(JSON, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    provider_response_ref: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )
    elsa_response = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    # 关系
    session: Mapped["Session"] = relationship()  # noqa: F821


class GrammarError(Base):
    """语法错误记录表。"""

    __tablename__ = "grammar_errors"
    __table_args__ = (
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_grammar_errors_confidence",
        ),
        Index(
            "ix_grammar_errors_real_session_id",
            "session_id",
            postgresql_where=text("is_synthetic = false"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False
    )
    skill_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    original: Mapped[str] = mapped_column(Text, nullable=False)
    corrected: Mapped[str] = mapped_column(Text, nullable=False, default="")
    error_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    # 关系
    session: Mapped["Session"] = relationship()  # noqa: F821
