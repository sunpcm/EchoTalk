"""知识追踪相关 ORM 模型：skills 表与 knowledge_states 表。"""

import uuid
from datetime import datetime

from sqlalchemy import Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base

# 种子数据：Phase 2 初始 10 个技能
SEED_SKILLS = [
    {
        "id": "article_usage",
        "name": "Article Usage (a/an/the)",
        "category": "grammar",
        "description": "冠词使用",
    },
    {
        "id": "verb_tense_past",
        "name": "Past Tense",
        "category": "grammar",
        "description": "过去时态",
    },
    {
        "id": "verb_tense_present",
        "name": "Present Tense",
        "category": "grammar",
        "description": "现在时态",
    },
    {
        "id": "subject_verb_agreement",
        "name": "Subject-Verb Agreement",
        "category": "grammar",
        "description": "主谓一致",
    },
    {
        "id": "preposition",
        "name": "Preposition Usage",
        "category": "grammar",
        "description": "介词使用",
    },
    {
        "id": "vowel_sounds",
        "name": "Vowel Sounds",
        "category": "pronunciation",
        "description": "元音发音",
    },
    {
        "id": "consonant_clusters",
        "name": "Consonant Clusters",
        "category": "pronunciation",
        "description": "辅音连缀",
    },
    {
        "id": "word_stress",
        "name": "Word Stress",
        "category": "pronunciation",
        "description": "单词重音",
    },
    {
        "id": "linking_sounds",
        "name": "Linking Sounds",
        "category": "pronunciation",
        "description": "连读",
    },
    {
        "id": "th_sounds",
        "name": "TH Sounds (θ / ð)",
        "category": "pronunciation",
        "description": "TH 发音",
    },
]


class Skill(Base):
    """技能定义表。"""

    __tablename__ = "skills"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 关系
    knowledge_states: Mapped[list["KnowledgeState"]] = relationship(
        back_populates="skill"
    )


class KnowledgeState(Base):
    """用户技能掌握度状态表（BKT 知识追踪）。"""

    __tablename__ = "knowledge_states"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    skill_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("skills.id"), nullable=False
    )
    p_mastery: Mapped[float] = mapped_column(Float, default=0.1)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "skill_id", name="uq_user_skill"),)

    # 关系
    skill: Mapped["Skill"] = relationship(back_populates="knowledge_states")
