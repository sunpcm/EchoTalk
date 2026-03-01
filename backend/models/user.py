"""用户相关 ORM 模型：users 表与 user_profiles 表。"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import ARRAY, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class SubscriptionTier(str, enum.Enum):
    """用户订阅等级。"""

    free = "free"
    pro = "pro"
    premium = "premium"


class User(Base):
    """用户主表。"""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subscription_tier: Mapped[SubscriptionTier] = mapped_column(
        Enum(SubscriptionTier, name="subscription_tier_enum"),
        default=SubscriptionTier.free,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    # 关系
    profile: Mapped["UserProfile | None"] = relationship(
        back_populates="user", uselist=False, lazy="selectin"
    )
    sessions: Mapped[list["Session"]] = relationship(  # noqa: F821
        back_populates="user", lazy="selectin"
    )


class UserProfile(Base):
    """用户配置表（一对一）。"""

    __tablename__ = "user_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    native_language: Mapped[str | None] = mapped_column(
        String(10), nullable=True
    )  # e.g. 'zh-CN'
    target_level: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # e.g. 'B2', 'IELTS 7'
    learning_goals = mapped_column(
        ARRAY(Text), nullable=True
    )  # e.g. ['job_interview', 'daily_chat']
    total_practice_minutes: Mapped[int] = mapped_column(Integer, default=0)

    # 关系
    user: Mapped["User"] = relationship(back_populates="profile")
