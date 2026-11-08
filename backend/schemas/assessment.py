"""发音评估与知识追踪的 Pydantic 响应模型。"""

import enum
import uuid

from pydantic import BaseModel, Field

from schemas.time import UtcDatetime


class WeeklyGrammarSkillTag(str, enum.Enum):
    """七天语法统计的六类固定归类。"""

    article_usage = "article_usage"
    verb_tense_past = "verb_tense_past"
    verb_tense_present = "verb_tense_present"
    subject_verb_agreement = "subject_verb_agreement"
    preposition = "preposition"
    other = "other"


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
    source: str
    provider: str | None = None
    model_version: str | None = None
    is_synthetic: bool
    confidence: float | None = None
    provider_response_ref: str | None = None
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class GrammarErrorResponse(BaseModel):
    """语法错误响应项。"""

    id: uuid.UUID
    session_id: uuid.UUID
    skill_tag: str
    original: str
    corrected: str
    error_type: str
    source: str
    provider: str | None = None
    model_version: str | None = None
    is_synthetic: bool
    confidence: float | None = None
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class WeeklyGrammarItem(BaseModel):
    """七天语法聚合中的一个技能标签计数项。"""

    skill_tag: WeeklyGrammarSkillTag
    count: int = Field(ge=1)


class WeeklyGrammarSummary(BaseModel):
    """GET /api/assessments/weekly-grammar 响应。"""

    start: UtcDatetime
    end: UtcDatetime
    total_errors: int = Field(ge=0)
    items: list[WeeklyGrammarItem] = Field(max_length=3)


class KnowledgeStateResponse(BaseModel):
    """知识状态响应（含技能信息）。"""

    id: uuid.UUID
    user_id: uuid.UUID
    skill_id: str
    skill_name: str
    skill_category: str
    p_mastery: float
    updated_at: UtcDatetime


class SkillResponse(BaseModel):
    """技能定义响应。"""

    id: str
    name: str
    category: str
    description: str | None = None

    model_config = {"from_attributes": True}
