"""Build a complete, fully buffered user data export from one database snapshot."""

import uuid
from typing import Any, Sequence

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from database import async_session_maker
from models.analysis import AnalysisJob
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.session import Session, Transcript
from schemas.user_data_export import (
    BktAlgorithmParams,
    CoverageDirection,
    EventCoverage,
    EventUnmappedCounts,
    GrammarAssessmentExport,
    KnowledgeStateExport,
    LearningEventDetails,
    LearningEventExport,
    PhonemeAlignmentExport,
    PronunciationAssessmentExport,
    SessionExport,
    TranscriptExport,
    UserDataExport,
)
from time_utils import utc_now

SessionFactory = async_sessionmaker[AsyncSession]


class UserDataExportIntegrityError(RuntimeError):
    """Raised when a row cannot be proven to belong to the current user."""


def get_user_data_export_session_factory() -> SessionFactory:
    """Provide a fresh session independent from the authentication transaction."""
    return async_session_maker


def serialize_user_data_export(export: UserDataExport) -> str:
    """Serialize only after the complete model has been constructed."""
    return export.model_dump_json()


def _require_mapping(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise UserDataExportIntegrityError("Expected JSON object")
    return value


def _project_phoneme_alignment(value: Any) -> list[PhonemeAlignmentExport]:
    if not isinstance(value, list):
        raise UserDataExportIntegrityError("Expected phoneme alignment list")

    projected: list[PhonemeAlignmentExport] = []
    for raw_item in value:
        item = _require_mapping(raw_item)
        projected.append(
            PhonemeAlignmentExport(
                position=item.get("position"),
                phoneme=item.get("phoneme"),
                expected=item.get("expected"),
                actual=item.get("actual"),
                type=item.get("type"),
            )
        )
    return projected


def _project_coverage_direction(value: Any) -> CoverageDirection | None:
    if value is None:
        return None
    direction = _require_mapping(value)
    return CoverageDirection(
        status=direction.get("status"),
        source=direction.get("source"),
        provider=direction.get("provider"),
        model_version=direction.get("model_version"),
        is_synthetic=direction.get("is_synthetic"),
    )


def _project_event_details(value: Any) -> LearningEventDetails:
    details = _require_mapping(value)
    raw_coverage = details.get("coverage")
    coverage: EventCoverage | None = None
    if raw_coverage is not None:
        coverage_map = _require_mapping(raw_coverage)
        coverage = EventCoverage(
            pronunciation=_project_coverage_direction(
                coverage_map.get("pronunciation")
            ),
            grammar=_project_coverage_direction(coverage_map.get("grammar")),
        )

    raw_unmapped = details.get("unmapped")
    unmapped: EventUnmappedCounts | None = None
    if raw_unmapped is not None:
        unmapped_map = _require_mapping(raw_unmapped)
        unmapped = EventUnmappedCounts(
            pronunciation=unmapped_map.get("pronunciation"),
            grammar=unmapped_map.get("grammar"),
        )

    return LearningEventDetails(
        schema_version=details.get("schema_version"),
        coverage=coverage,
        unmapped=unmapped,
        legacy_synthetic_impact=details.get("legacy_synthetic_impact"),
    )


def _project_algorithm_params(value: Any) -> BktAlgorithmParams | None:
    if value is None:
        return None
    params = _require_mapping(value)
    return BktAlgorithmParams(
        p_init=params.get("p_init"),
        p_transit=params.get("p_transit"),
        p_slip=params.get("p_slip"),
        p_guess=params.get("p_guess"),
    )


async def _validate_relationships(
    db: AsyncSession,
    *,
    event_rows: Sequence[Any],
    knowledge_rows: Sequence[Any],
    owned_session_ids: set[uuid.UUID],
) -> None:
    event_session_ids = {
        row.session_id for row in event_rows if row.session_id is not None
    }
    if not event_session_ids.issubset(owned_session_ids):
        raise UserDataExportIntegrityError("Event session ownership mismatch")

    job_ids = {
        row.analysis_job_id for row in event_rows if row.analysis_job_id is not None
    }
    if job_ids:
        jobs = {
            row.id: row.session_id
            for row in (
                await db.execute(
                    select(AnalysisJob.id, AnalysisJob.session_id).where(
                        AnalysisJob.id.in_(job_ids)
                    )
                )
            ).all()
        }
        if any(
            row.analysis_job_id is not None
            and jobs.get(row.analysis_job_id) != row.session_id
            for row in event_rows
        ):
            raise UserDataExportIntegrityError("Event job ownership mismatch")

    pronunciation_ids = {
        row.pronunciation_assessment_id
        for row in event_rows
        if row.pronunciation_assessment_id is not None
    }
    if pronunciation_ids:
        pronunciation_sessions = {
            row.id: row.session_id
            for row in (
                await db.execute(
                    select(
                        PronunciationAssessment.id,
                        PronunciationAssessment.session_id,
                    ).where(PronunciationAssessment.id.in_(pronunciation_ids))
                )
            ).all()
        }
        if any(
            row.pronunciation_assessment_id is not None
            and pronunciation_sessions.get(row.pronunciation_assessment_id)
            != row.session_id
            for row in event_rows
        ):
            raise UserDataExportIntegrityError(
                "Event pronunciation-assessment ownership mismatch"
            )

    grammar_ids = {
        row.grammar_error_id for row in event_rows if row.grammar_error_id is not None
    }
    if grammar_ids:
        grammar_sessions = {
            row.id: row.session_id
            for row in (
                await db.execute(
                    select(GrammarError.id, GrammarError.session_id).where(
                        GrammarError.id.in_(grammar_ids)
                    )
                )
            ).all()
        }
        if any(
            row.grammar_error_id is not None
            and grammar_sessions.get(row.grammar_error_id) != row.session_id
            for row in event_rows
        ):
            raise UserDataExportIntegrityError("Event grammar ownership mismatch")

    skill_ids = {
        row.skill_id
        for row in (*event_rows, *knowledge_rows)
        if row.skill_id is not None
    }
    if skill_ids:
        existing_skills = set(
            (await db.execute(select(Skill.id).where(Skill.id.in_(skill_ids))))
            .scalars()
            .all()
        )
        if existing_skills != skill_ids:
            raise UserDataExportIntegrityError("Unknown skill reference")


async def build_user_data_export(
    *,
    session_factory: SessionFactory,
    user_id: uuid.UUID,
) -> UserDataExport:
    """Read all export sections from one repeatable-read, read-only snapshot."""
    async with session_factory() as db:
        await db.execute(
            text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        )

        session_rows = (
            await db.execute(
                select(
                    Session.id,
                    Session.mode,
                    Session.status,
                    Session.started_at,
                    Session.ended_at,
                )
                .where(Session.user_id == user_id)
                .order_by(Session.started_at, Session.id)
            )
        ).all()
        owned_session_ids = {row.id for row in session_rows}

        transcript_rows = (
            await db.execute(
                select(
                    Transcript.id,
                    Transcript.session_id,
                    Transcript.event_id,
                    Transcript.role,
                    Transcript.content,
                    Transcript.timestamp_ms,
                )
                .join(Session, Session.id == Transcript.session_id)
                .where(Session.user_id == user_id)
                .order_by(
                    Session.started_at,
                    Transcript.timestamp_ms,
                    Transcript.id,
                )
            )
        ).all()

        pronunciation_rows = (
            await db.execute(
                select(
                    PronunciationAssessment.id,
                    PronunciationAssessment.session_id,
                    PronunciationAssessment.overall_score,
                    PronunciationAssessment.phoneme_alignment,
                    PronunciationAssessment.source,
                    PronunciationAssessment.provider,
                    PronunciationAssessment.model_version,
                    PronunciationAssessment.is_synthetic,
                    PronunciationAssessment.confidence,
                    PronunciationAssessment.created_at,
                )
                .join(
                    Session,
                    Session.id == PronunciationAssessment.session_id,
                )
                .where(Session.user_id == user_id)
                .order_by(
                    PronunciationAssessment.created_at,
                    PronunciationAssessment.id,
                )
            )
        ).all()

        grammar_rows = (
            await db.execute(
                select(
                    GrammarError.id,
                    GrammarError.session_id,
                    GrammarError.skill_tag,
                    GrammarError.original,
                    GrammarError.corrected,
                    GrammarError.error_type,
                    GrammarError.source,
                    GrammarError.provider,
                    GrammarError.model_version,
                    GrammarError.is_synthetic,
                    GrammarError.confidence,
                    GrammarError.created_at,
                )
                .join(Session, Session.id == GrammarError.session_id)
                .where(Session.user_id == user_id)
                .order_by(GrammarError.created_at, GrammarError.id)
            )
        ).all()

        event_rows = (
            await db.execute(
                select(
                    LearningEvent.apply_seq,
                    LearningEvent.event_type,
                    LearningEvent.session_id,
                    LearningEvent.analysis_job_id,
                    LearningEvent.pronunciation_assessment_id,
                    LearningEvent.grammar_error_id,
                    LearningEvent.skill_id,
                    LearningEvent.source_ordinal,
                    LearningEvent.observation_correct,
                    LearningEvent.observation_code,
                    LearningEvent.source,
                    LearningEvent.provider,
                    LearningEvent.model_version,
                    LearningEvent.confidence,
                    LearningEvent.is_synthetic,
                    LearningEvent.algorithm_version,
                    LearningEvent.algorithm_params,
                    LearningEvent.p_mastery_snapshot,
                    LearningEvent.cutover_revision,
                    LearningEvent.occurred_at,
                    LearningEvent.recorded_at,
                    LearningEvent.details,
                )
                .where(LearningEvent.user_id == user_id)
                .order_by(LearningEvent.apply_seq)
            )
        ).all()

        knowledge_rows = (
            await db.execute(
                select(
                    KnowledgeState.skill_id,
                    KnowledgeState.p_mastery,
                    KnowledgeState.updated_at,
                )
                .where(KnowledgeState.user_id == user_id)
                .order_by(KnowledgeState.skill_id)
            )
        ).all()

        await _validate_relationships(
            db,
            event_rows=event_rows,
            knowledge_rows=knowledge_rows,
            owned_session_ids=owned_session_ids,
        )

        return UserDataExport(
            schema_version=1,
            exported_at=utc_now(),
            sessions=[
                SessionExport(
                    id=row.id,
                    mode=row.mode.value,
                    status=row.status.value,
                    started_at=row.started_at,
                    ended_at=row.ended_at,
                )
                for row in session_rows
            ],
            transcripts=[
                TranscriptExport(
                    id=row.id,
                    session_id=row.session_id,
                    event_id=row.event_id,
                    role=row.role.value,
                    content=row.content,
                    timestamp_ms=row.timestamp_ms,
                )
                for row in transcript_rows
            ],
            pronunciation_assessments=[
                PronunciationAssessmentExport(
                    id=row.id,
                    session_id=row.session_id,
                    overall_score=row.overall_score,
                    phoneme_alignment=_project_phoneme_alignment(row.phoneme_alignment),
                    source=row.source,
                    provider=row.provider,
                    model_version=row.model_version,
                    is_synthetic=row.is_synthetic,
                    confidence=row.confidence,
                    created_at=row.created_at,
                )
                for row in pronunciation_rows
            ],
            grammar_assessments=[
                GrammarAssessmentExport(
                    id=row.id,
                    session_id=row.session_id,
                    skill_tag=row.skill_tag,
                    original=row.original,
                    corrected=row.corrected,
                    error_type=row.error_type,
                    source=row.source,
                    provider=row.provider,
                    model_version=row.model_version,
                    is_synthetic=row.is_synthetic,
                    confidence=row.confidence,
                    created_at=row.created_at,
                )
                for row in grammar_rows
            ],
            learning_events=[
                LearningEventExport(
                    apply_seq=row.apply_seq,
                    event_type=row.event_type,
                    session_id=row.session_id,
                    analysis_job_id=row.analysis_job_id,
                    pronunciation_assessment_id=row.pronunciation_assessment_id,
                    grammar_error_id=row.grammar_error_id,
                    skill_id=row.skill_id,
                    source_ordinal=row.source_ordinal,
                    observation_correct=row.observation_correct,
                    observation_code=row.observation_code,
                    source=row.source,
                    provider=row.provider,
                    model_version=row.model_version,
                    confidence=row.confidence,
                    is_synthetic=row.is_synthetic,
                    algorithm_version=row.algorithm_version,
                    algorithm_params=_project_algorithm_params(row.algorithm_params),
                    p_mastery_snapshot=row.p_mastery_snapshot,
                    cutover_revision=row.cutover_revision,
                    occurred_at=row.occurred_at,
                    recorded_at=row.recorded_at,
                    details=_project_event_details(row.details),
                )
                for row in event_rows
            ],
            knowledge_states=[
                KnowledgeStateExport(
                    skill_id=row.skill_id,
                    p_mastery=row.p_mastery,
                    updated_at=row.updated_at,
                )
                for row in knowledge_rows
            ],
        )
