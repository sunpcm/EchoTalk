"""
ORM 模型统一导出。
Alembic 的 env.py 通过导入此模块来发现所有表的 metadata。
"""

from models.base import Base
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.session import Session, Transcript
from models.user import User, UserProfile

__all__ = [
    "Base",
    "User",
    "UserProfile",
    "Session",
    "Transcript",
    "Skill",
    "KnowledgeState",
    "PronunciationAssessment",
    "GrammarError",
]
