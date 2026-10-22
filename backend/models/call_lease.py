"""通话租约 ORM 模型：call_leases 表。"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class CallLeaseState(str, enum.Enum):
    """通话租约状态。"""

    held = "held"
    free = "free"


class CallLease(Base):
    """单端通话租约表（一用户一行）。"""

    __tablename__ = "call_leases"
    __table_args__ = (
        CheckConstraint(
            "generation >= 0",
            name="ck_call_leases_generation_non_negative",
        ),
        CheckConstraint(
            "state IN ('held', 'free')",
            name="ck_call_leases_state",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    generation: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
    )
    state: Mapped[str] = mapped_column(
        String(16),
        default=CallLeaseState.free.value,
        nullable=False,
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 关系
    user: Mapped["User"] = relationship("User", backref="call_lease")  # noqa: F821
    session: Mapped["Session | None"] = relationship("Session")  # noqa: F821
