"""发音评估与语法错误 ORM 模型：pronunciation_assessments 表与 grammar_errors 表。"""

import uuid
from datetime import datetime

from sqlalchemy import Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class PronunciationAssessment(Base):
    """发音评估结果表。"""

    __tablename__ = "pronunciation_assessments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False
    )
    overall_score: Mapped[float] = mapped_column(Float, nullable=False)
    phoneme_alignment = mapped_column(JSON, nullable=False)
    elsa_response = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    # 关系
    session: Mapped["Session"] = relationship()  # noqa: F821


class GrammarError(Base):
    """语法错误记录表。"""

    __tablename__ = "grammar_errors"

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
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    # 关系
    session: Mapped["Session"] = relationship()  # noqa: F821
