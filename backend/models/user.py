"""用户相关 ORM 模型：users 表、user_profiles 表与 user_settings 表。"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import ARRAY, Boolean, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class SubscriptionTier(str, enum.Enum):
    """用户订阅等级。"""

    free = "free"
    pro = "pro"
    premium = "premium"


class STTProvider(str, enum.Enum):
    """STT 服务提供商。"""

    deepgram = "deepgram"


class LLMProvider(str, enum.Enum):
    """LLM 服务提供商。"""

    siliconflow = "siliconflow"
    openrouter = "openrouter"


class TTSProvider(str, enum.Enum):
    """TTS 服务提供商。"""

    cartesia = "cartesia"


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
    settings: Mapped["UserSettings | None"] = relationship(
        back_populates="user", uselist=False, lazy="selectin"
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


class UserSettings(Base):
    """用户服务配置表（一对一）。存储双轨制开关与加密后的自定义 API Key。"""

    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    is_custom_mode: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    # 提供商选择
    stt_provider: Mapped[STTProvider | None] = mapped_column(
        Enum(STTProvider, name="stt_provider_enum"), nullable=True
    )
    llm_provider: Mapped[LLMProvider | None] = mapped_column(
        Enum(LLMProvider, name="llm_provider_enum"), nullable=True
    )
    llm_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tts_provider: Mapped[TTSProvider | None] = mapped_column(
        Enum(TTSProvider, name="tts_provider_enum"), nullable=True
    )

    # 加密后的 API Key（Fernet token）
    encrypted_stt_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_llm_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_tts_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # 关系
    user: Mapped["User"] = relationship(back_populates="settings")
