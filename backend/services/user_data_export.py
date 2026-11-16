"""Build a complete, fully buffered user data export from one database snapshot."""

import hashlib
import uuid
from typing import Any, Sequence

from pydantic import ValidationError
from sqlalchemy import and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from database import async_session_maker
from models.analysis import AnalysisJob
from models.exercise import GrammarError, PronunciationAssessment
from models.goal_evaluation import GoalEvaluationResult, GoalRun
from models.knowledge import KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.scenario_goals import GoalCatalogVersion, SessionGoalSnapshot
from models.session import Session, Transcript, TranscriptRole
from schemas.scenario_goals import GoalDefinition
from schemas.user_data_export import (
    BktAlgorithmParams,
    CoverageDirection,
    EventCoverage,
    EventUnmappedCounts,
    GoalEvidenceRef,
    GoalResultExport,
    GoalRunExport,
    GrammarAssessmentExport,
    KnowledgeStateExport,
    LearningEventDetails,
    LearningEventExport,
    PhonemeAlignmentExport,
    PronunciationAssessmentExport,
    SessionExport,
    SessionGoalExport,
    TranscriptExport,
    UserDataExport,
    UserDataExportV2,
    UserDataExportV3,
)
from time_utils import utc_now

SessionFactory = async_sessionmaker[AsyncSession]


class UserDataExportIntegrityError(RuntimeError):
    """Raised when a row cannot be proven to belong to the current user."""


def get_user_data_export_session_factory() -> SessionFactory:
    """Provide a fresh session independent from the authentication transaction."""
    return async_session_maker


def serialize_user_data_export(
    export: UserDataExport | UserDataExportV2,
) -> str:
    """Serialize only after the complete model has been constructed."""
    return export.model_dump_json()


def _require_mapping(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise UserDataExportIntegrityError("Expected JSON object")
    return value


def _project_goal_definitions(
    value: Any,
    *,
    material_id: str,
) -> list[GoalDefinition]:
    if not isinstance(value, list) or not value:
        raise UserDataExportIntegrityError("Expected non-empty goal definition list")

    projected: list[GoalDefinition] = []
    seen_goal_ids: set[str] = set()
    expected_prefix = f"{material_id}:"
    for index, raw_goal in enumerate(value):
        try:
            goal = GoalDefinition.model_validate(raw_goal)
        except ValidationError as exc:
            raise UserDataExportIntegrityError(
                f"Invalid goal definition at index {index}"
            ) from exc
        if not goal.goal_id.startswith(expected_prefix):
            raise UserDataExportIntegrityError("Goal material prefix mismatch")
        if goal.goal_id in seen_goal_ids:
            raise UserDataExportIntegrityError("Duplicate exported goal id")
        seen_goal_ids.add(goal.goal_id)
        projected.append(goal)
    return projected


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


async def _validate_goal_evidence(
    db: AsyncSession,
    goal_run_rows: Sequence[Any],
    user_id: uuid.UUID,
) -> None:
    """Prove every frozen evidence reference belongs to the user's session."""
    for run_row in goal_run_rows:
        evidence = run_row.evidence
        if not isinstance(evidence, list):
            raise UserDataExportIntegrityError("Goal evidence is not an array")
        for item in evidence:
            if not isinstance(item, dict):
                raise UserDataExportIntegrityError(
                    "Goal evidence reference is malformed"
                )
            raw_id = item.get("transcript_id")
            expected_digest = item.get("sha256")
            try:
                transcript_id = int(raw_id)
            except (TypeError, ValueError):
                raise UserDataExportIntegrityError(
                    "Goal evidence transcript id is malformed"
                )
            row = (
                await db.execute(
                    select(Transcript.id, Transcript.role, Transcript.content).where(
                        Transcript.id == transcript_id,
                        Transcript.session_id == run_row.session_id,
                    )
                )
            ).one_or_none()
            if row is None:
                raise UserDataExportIntegrityError("Goal evidence transcript missing")
            _transcript_id, role, content = row
            if role != TranscriptRole.user:
                raise UserDataExportIntegrityError(
                    "Goal evidence transcript is not student"
                )
            if hashlib.sha256(content.encode("utf-8")).hexdigest() != expected_digest:
                raise UserDataExportIntegrityError("Goal evidence digest mismatch")


def _validate_goal_results(
    goal_run_rows: Sequence[Any],
    goal_result_rows: Sequence[Any],
    session_goal_rows: Sequence[Any],
) -> None:
    """Prove goal results match the frozen catalog and terminal completeness."""
    frozen_by_session: dict[uuid.UUID, dict[str, int]] = {}
    for row in session_goal_rows:
        goals = row.goals
        if not isinstance(goals, list):
            raise UserDataExportIntegrityError("Session goal catalog is not an array")
        frozen: dict[str, int] = {}
        for raw in goals:
            goal = GoalDefinition.model_validate(raw)
            if goal.goal_id in frozen:
                raise UserDataExportIntegrityError("Duplicate frozen goal id")
            frozen[goal.goal_id] = goal.goal_version
        frozen_by_session[row.session_id] = frozen

    run_status = {row.id: row.status.value for row in goal_run_rows}
    results_by_run: dict[uuid.UUID, dict[str, int]] = {}
    for row in goal_result_rows:
        if row.run_id not in run_status:
            raise UserDataExportIntegrityError("Goal result references unknown run")
        results_by_run.setdefault(row.run_id, {})[row.goal_id] = row.goal_version

    for run_row in goal_run_rows:
        frozen = frozen_by_session.get(run_row.session_id)
        if frozen is None:
            raise UserDataExportIntegrityError("Goal run has no frozen session goals")
        results = results_by_run.get(run_row.id, {})
        if run_row.status.value in ("pending", "running"):
            if results:
                raise UserDataExportIntegrityError(
                    "Progress goal run already has results"
                )
            continue
        if set(results) != set(frozen):
            raise UserDataExportIntegrityError("Terminal goal run result set mismatch")
        for goal_id, goal_version in frozen.items():
            if results[goal_id] != goal_version:
                raise UserDataExportIntegrityError("Goal result version mismatch")


async def build_user_data_export(
    *,
    session_factory: SessionFactory,
    user_id: uuid.UUID,
    include_session_goals: bool = False,
    include_goal_evaluations: bool = False,
) -> UserDataExport | UserDataExportV2 | UserDataExportV3:
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

        if include_goal_evaluations:
            include_session_goals = True

        session_goal_rows: Sequence[Any] = ()
        if include_session_goals:
            session_goal_rows = (
                await db.execute(
                    select(
                        SessionGoalSnapshot.session_id,
                        SessionGoalSnapshot.material_id,
                        SessionGoalSnapshot.material_version,
                        GoalCatalogVersion.goals,
                    )
                    .join(
                        Session,
                        Session.id == SessionGoalSnapshot.session_id,
                    )
                    .join(
                        GoalCatalogVersion,
                        and_(
                            GoalCatalogVersion.material_id
                            == SessionGoalSnapshot.material_id,
                            GoalCatalogVersion.material_version
                            == SessionGoalSnapshot.material_version,
                        ),
                    )
                    .where(Session.user_id == user_id)
                    .order_by(Session.started_at, SessionGoalSnapshot.session_id)
                )
            ).all()

        goal_run_rows: Sequence[Any] = ()
        goal_result_rows: Sequence[Any] = ()
        if include_goal_evaluations:
            goal_run_rows = (
                await db.execute(
                    select(
                        GoalRun.id,
                        GoalRun.session_id,
                        GoalRun.revision,
                        GoalRun.status,
                        GoalRun.evaluator_version,
                        GoalRun.evidence,
                        GoalRun.attempt_count,
                        GoalRun.last_error_code,
                        GoalRun.last_error,
                        GoalRun.next_retry_at,
                        GoalRun.started_at,
                        GoalRun.finished_at,
                        GoalRun.created_at,
                        GoalRun.updated_at,
                    )
                    .join(Session, Session.id == GoalRun.session_id)
                    .where(Session.user_id == user_id)
                    .order_by(GoalRun.created_at, GoalRun.id)
                )
            ).all()
            goal_result_rows = (
                await db.execute(
                    select(
                        GoalEvaluationResult.id,
                        GoalEvaluationResult.run_id,
                        GoalEvaluationResult.goal_id,
                        GoalEvaluationResult.goal_version,
                        GoalEvaluationResult.result,
                        GoalEvaluationResult.created_at,
                    )
                    .join(GoalRun, GoalRun.id == GoalEvaluationResult.run_id)
                    .join(Session, Session.id == GoalRun.session_id)
                    .where(Session.user_id == user_id)
                    .order_by(
                        GoalEvaluationResult.created_at,
                        GoalEvaluationResult.id,
                    )
                )
            ).all()
            await _validate_goal_evidence(db, goal_run_rows, user_id)
            _validate_goal_results(goal_run_rows, goal_result_rows, session_goal_rows)

        await _validate_relationships(
            db,
            event_rows=event_rows,
            knowledge_rows=knowledge_rows,
            owned_session_ids=owned_session_ids,
        )

        export_sections = {
            "sessions": [
                SessionExport(
                    id=row.id,
                    mode=row.mode.value,
                    status=row.status.value,
                    started_at=row.started_at,
                    ended_at=row.ended_at,
                )
                for row in session_rows
            ],
            "transcripts": [
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
            "pronunciation_assessments": [
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
            "grammar_assessments": [
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
            "learning_events": [
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
            "knowledge_states": [
                KnowledgeStateExport(
                    skill_id=row.skill_id,
                    p_mastery=row.p_mastery,
                    updated_at=row.updated_at,
                )
                for row in knowledge_rows
            ],
        }
        exported_at = utc_now()
        session_goal_exports = [
            SessionGoalExport(
                session_id=row.session_id,
                material_id=row.material_id,
                material_version=row.material_version,
                goals=_project_goal_definitions(
                    row.goals,
                    material_id=row.material_id,
                ),
            )
            for row in session_goal_rows
        ]
        if include_goal_evaluations:
            return UserDataExportV3(
                schema_version=3,
                exported_at=exported_at,
                session_goals=session_goal_exports,
                goal_runs=[
                    GoalRunExport(
                        id=row.id,
                        session_id=row.session_id,
                        revision=row.revision,
                        status=row.status.value,
                        evaluator_version=row.evaluator_version,
                        evidence=[
                            GoalEvidenceRef(
                                transcript_id=item["transcript_id"],
                                sha256=item["sha256"],
                            )
                            for item in row.evidence
                        ],
                        attempt_count=row.attempt_count,
                        last_error_code=row.last_error_code,
                        last_error=row.last_error,
                        next_retry_at=row.next_retry_at,
                        started_at=row.started_at,
                        finished_at=row.finished_at,
                        created_at=row.created_at,
                        updated_at=row.updated_at,
                    )
                    for row in goal_run_rows
                ],
                goal_results=[
                    GoalResultExport(
                        id=row.id,
                        run_id=row.run_id,
                        goal_id=row.goal_id,
                        goal_version=row.goal_version,
                        result=row.result.value,
                        created_at=row.created_at,
                    )
                    for row in goal_result_rows
                ],
                **export_sections,
            )
        if include_session_goals:
            return UserDataExportV2(
                schema_version=2,
                exported_at=exported_at,
                session_goals=session_goal_exports,
                **export_sections,
            )
        return UserDataExport(
            schema_version=1,
            exported_at=exported_at,
            **export_sections,
        )
