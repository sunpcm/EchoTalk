"""Pydantic schema for the authenticated user's structured data export."""

import uuid
from typing import Literal

from pydantic import BaseModel, FiniteFloat

from schemas.scenario_goals import GoalDefinition
from schemas.time import UtcDatetime


class SessionExport(BaseModel):
    """Minimal session metadata needed to interpret exported child rows."""

    id: uuid.UUID
    mode: str
    status: str
    started_at: UtcDatetime
    ended_at: UtcDatetime | None


class TranscriptExport(BaseModel):
    """Transcript fields safe and necessary for a user data export."""

    id: int
    session_id: uuid.UUID
    event_id: uuid.UUID | None
    role: str
    content: str
    timestamp_ms: int


class PhonemeAlignmentExport(BaseModel):
    """One explicitly projected phoneme-alignment item."""

    position: int
    phoneme: str
    expected: str | None
    actual: str | None
    type: str


class PronunciationAssessmentExport(BaseModel):
    """Pronunciation assessment fields without provider response internals."""

    id: uuid.UUID
    session_id: uuid.UUID
    overall_score: FiniteFloat
    phoneme_alignment: list[PhonemeAlignmentExport]
    source: str
    provider: str | None
    model_version: str | None
    is_synthetic: bool
    confidence: FiniteFloat | None
    created_at: UtcDatetime


class GrammarAssessmentExport(BaseModel):
    """Grammar error and correction fields for the authenticated user."""

    id: uuid.UUID
    session_id: uuid.UUID
    skill_tag: str
    original: str
    corrected: str
    error_type: str
    source: str
    provider: str | None
    model_version: str | None
    is_synthetic: bool
    confidence: FiniteFloat | None
    created_at: UtcDatetime


class BktAlgorithmParams(BaseModel):
    """The frozen four-parameter BKT algorithm definition."""

    p_init: FiniteFloat
    p_transit: FiniteFloat
    p_slip: FiniteFloat
    p_guess: FiniteFloat


class CoverageDirection(BaseModel):
    """One audited source direction from an analysis-completed event."""

    status: str | None
    source: str | None
    provider: str | None
    model_version: str | None
    is_synthetic: bool | None


class EventCoverage(BaseModel):
    """Pronunciation and grammar coverage metadata."""

    pronunciation: CoverageDirection | None
    grammar: CoverageDirection | None


class EventUnmappedCounts(BaseModel):
    """Counts of observations not mapped into the ledger."""

    pronunciation: int | None
    grammar: int | None


class LearningEventDetails(BaseModel):
    """Whitelisted nested event metadata."""

    schema_version: int | None
    coverage: EventCoverage | None
    unmapped: EventUnmappedCounts | None
    legacy_synthetic_impact: str | None


class LearningEventExport(BaseModel):
    """One immutable learning event with safe nested JSON projections."""

    apply_seq: int
    event_type: str
    session_id: uuid.UUID | None
    analysis_job_id: uuid.UUID | None
    pronunciation_assessment_id: uuid.UUID | None
    grammar_error_id: uuid.UUID | None
    skill_id: str | None
    source_ordinal: int | None
    observation_correct: bool | None
    observation_code: str | None
    source: str
    provider: str | None
    model_version: str | None
    confidence: FiniteFloat | None
    is_synthetic: bool | None
    algorithm_version: str | None
    algorithm_params: BktAlgorithmParams | None
    p_mastery_snapshot: FiniteFloat | None
    cutover_revision: str | None
    occurred_at: UtcDatetime
    recorded_at: UtcDatetime
    details: LearningEventDetails


class KnowledgeStateExport(BaseModel):
    """One user-owned BKT mastery state."""

    skill_id: str
    p_mastery: FiniteFloat
    updated_at: UtcDatetime


class UserDataExport(BaseModel):
    """Stable version-1 structured export returned as a JSON attachment."""

    schema_version: Literal[1]
    exported_at: UtcDatetime
    sessions: list[SessionExport]
    transcripts: list[TranscriptExport]
    pronunciation_assessments: list[PronunciationAssessmentExport]
    grammar_assessments: list[GrammarAssessmentExport]
    learning_events: list[LearningEventExport]
    knowledge_states: list[KnowledgeStateExport]


class SessionGoalExport(BaseModel):
    """One session snapshot with its complete immutable goal definitions."""

    session_id: uuid.UUID
    material_id: str
    material_version: int
    goals: list[GoalDefinition]


class UserDataExportV2(BaseModel):
    """Explicit opt-in version-2 export with effective session goals."""

    schema_version: Literal[2]
    exported_at: UtcDatetime
    sessions: list[SessionExport]
    transcripts: list[TranscriptExport]
    pronunciation_assessments: list[PronunciationAssessmentExport]
    grammar_assessments: list[GrammarAssessmentExport]
    learning_events: list[LearningEventExport]
    knowledge_states: list[KnowledgeStateExport]
    session_goals: list[SessionGoalExport]


class GoalEvidenceRef(BaseModel):
    """One frozen student transcript reference (id + digest, no body)."""

    model_config = {"extra": "forbid"}

    transcript_id: str
    sha256: str


class GoalRunExport(BaseModel):
    """One frozen evaluation run header with its evidence references."""

    model_config = {"extra": "forbid"}

    id: uuid.UUID
    session_id: uuid.UUID
    revision: int
    status: str
    evaluator_version: str
    evidence: list[GoalEvidenceRef]
    attempt_count: int
    last_error_code: str | None
    last_error: str | None
    next_retry_at: UtcDatetime | None
    started_at: UtcDatetime | None
    finished_at: UtcDatetime | None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class GoalResultExport(BaseModel):
    """One append-only terminal result for a goal."""

    model_config = {"extra": "forbid"}

    id: uuid.UUID
    run_id: uuid.UUID
    goal_id: str
    goal_version: int
    result: str
    created_at: UtcDatetime


class UserDataExportV3(BaseModel):
    """Explicit opt-in version-3 export with goal runs/results references."""

    schema_version: Literal[3]
    exported_at: UtcDatetime
    sessions: list[SessionExport]
    transcripts: list[TranscriptExport]
    pronunciation_assessments: list[PronunciationAssessmentExport]
    grammar_assessments: list[GrammarAssessmentExport]
    learning_events: list[LearningEventExport]
    knowledge_states: list[KnowledgeStateExport]
    session_goals: list[SessionGoalExport]
    goal_runs: list[GoalRunExport]
    goal_results: list[GoalResultExport]
