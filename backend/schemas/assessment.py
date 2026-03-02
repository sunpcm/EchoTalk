"""发音评估与知识追踪的 Pydantic 响应模型。"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class PhonemeAlignmentItem(BaseModel):
    """音素对齐条目。"""

    position: int
    phoneme: str
    expected: str | None
    actual: str | None
    type: str  # "correct" | "substitution" | "deletion" | "insertion"


class AssessmentResponse(BaseModel):
    """GET /api/assessments/{session_id} 响应。"""

    id: uuid.UUID
    session_id: uuid.UUID
    overall_score: float
    phoneme_alignment: list[PhonemeAlignmentItem]
    elsa_response: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class GrammarErrorResponse(BaseModel):
    """语法错误响应项。"""

    id: uuid.UUID
    session_id: uuid.UUID
    skill_tag: str
    original: str
    corrected: str
    error_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class KnowledgeStateResponse(BaseModel):
    """知识状态响应（含技能信息）。"""

    id: uuid.UUID
    user_id: uuid.UUID
    skill_id: str
    skill_name: str
    skill_category: str
    p_mastery: float
    updated_at: datetime


class SkillResponse(BaseModel):
    """技能定义响应。"""

    id: str
    name: str
    category: str
    description: str | None = None

    model_config = {"from_attributes": True}
