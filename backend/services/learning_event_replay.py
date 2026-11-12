"""Read-only consistency validation of learning events and mastered state."""

import hashlib
import json
import math
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Mapping

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.learning_event_cutover import LearningEventCutover
from models.session import Session
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.learning_event_canonical import (
    CanonicalObservation,
    build_canonical_observations,
)

TOLERANCE = 1e-9
_PARAMETER_NAMES = ("p_init", "p_transit", "p_slip", "p_guess")
_OBSERVATION_TYPES = {"pronunciation_observation", "grammar_observation"}
_EVENT_TYPES_WITH_SCHEMA_VERSION = {
    "analysis_completed",
    *_OBSERVATION_TYPES,
    "baseline_snapshot",
}
_COVERAGE_FIELDS = (
    "status",
    "source",
    "provider",
    "model_version",
    "is_synthetic",
)


@dataclass(frozen=True, slots=True)
class ReplayIssue:
    code: str
    user_id: uuid.UUID | None = None
    skill_id: str | None = None


@dataclass(frozen=True, slots=True)
class ReplayReport:
    watermark: int
    issues: tuple[ReplayIssue, ...]
    isolation_level: str
    read_only: bool


def _issue(
    issues: set[tuple[str, uuid.UUID | None, str | None]],
    code: str,
    user_id: uuid.UUID | None = None,
    skill_id: str | None = None,
) -> None:
    issues.add((code, user_id, skill_id))


def _normalize_algorithms(
    algorithm_versions: Mapping[str, Mapping[str, float]],
) -> dict[str, BKTParams]:
    normalized: dict[str, BKTParams] = {}
    for version, raw in algorithm_versions.items():
        if set(raw) != set(_PARAMETER_NAMES):
            continue
        try:
            normalized[version] = BKTParams(
                **{name: float(raw[name]) for name in _PARAMETER_NAMES}
            )
        except (TypeError, ValueError):
            continue
    return normalized


def _params_match(actual: object, expected: BKTParams) -> bool:
    if not isinstance(actual, dict) or set(actual) != set(_PARAMETER_NAMES):
        return False
    try:
        return all(
            math.isclose(
                float(actual[name]),
                getattr(expected, name),
                abs_tol=TOLERANCE,
                rel_tol=0.0,
            )
            for name in _PARAMETER_NAMES
        )
    except (TypeError, ValueError):
        return False


def _canonical_key_matches(event: LearningEvent) -> bool:
    if event.event_type == "analysis_completed":
        expected = f"job:{event.analysis_job_id}:completed"
    elif event.event_type == "pronunciation_observation":
        expected = f"job:{event.analysis_job_id}:pron:{event.source_ordinal}"
    elif event.event_type == "grammar_observation":
        expected = f"job:{event.analysis_job_id}:grammar:{event.source_ordinal}"
    elif event.event_type == "baseline_snapshot":
        expected = f"baseline:{event.cutover_revision}:{event.user_id}:{event.skill_id}"
    else:
        return False
    return event.idempotency_key == expected


def _schema_version_matches(details: object) -> bool:
    return (
        isinstance(details, dict)
        and type(details.get("schema_version")) is int
        and details["schema_version"] == 1
    )


def _source_facts(source: object) -> tuple[object, object, object, object]:
    return (
        source.source,
        source.provider,
        source.model_version,
        source.is_synthetic,
    )


def _coverage_direction_matches(
    direction: object,
    *,
    expected_status: str,
    source_facts: set[tuple[object, object, object, object]] | None,
    require_absent_source: bool,
) -> bool:
    if (
        not isinstance(direction, dict)
        or set(direction) != set(_COVERAGE_FIELDS)
        or direction.get("status") != expected_status
    ):
        return False
    actual_facts = (
        direction.get("source"),
        direction.get("provider"),
        direction.get("model_version"),
        direction.get("is_synthetic"),
    )
    if any(
        value is not None and not isinstance(value, str) for value in actual_facts[:3]
    ):
        return False
    if actual_facts[3] is not None and type(actual_facts[3]) is not bool:
        return False
    if source_facts is None:
        return not require_absent_source or all(value is None for value in actual_facts)
    return actual_facts in source_facts


def _coverage_matches(
    details: object,
    *,
    assessment: PronunciationAssessment | None,
    grammar_errors: list[GrammarError],
) -> bool:
    if not isinstance(details, dict):
        return False
    coverage = details.get("coverage")
    if not isinstance(coverage, dict) or set(coverage) != {"pronunciation", "grammar"}:
        return False
    pronunciation_facts = None if assessment is None else {_source_facts(assessment)}
    grammar_facts = {_source_facts(error) for error in grammar_errors} or None
    return _coverage_direction_matches(
        coverage.get("pronunciation"),
        expected_status="evaluated" if assessment is not None else "not_called",
        source_facts=pronunciation_facts,
        require_absent_source=True,
    ) and _coverage_direction_matches(
        coverage.get("grammar"),
        expected_status="evaluated",
        source_facts=grammar_facts,
        require_absent_source=False,
    )


def _baseline_digest(
    rows: list[tuple[uuid.UUID, str, float | None]],
) -> str:
    canonical = [
        {
            "user_id": str(user_id),
            "skill_id": skill_id,
            "p_mastery": p_mastery,
        }
        for user_id, skill_id, p_mastery in sorted(
            rows,
            key=lambda row: (row[0], row[1]),
        )
    ]
    payload = json.dumps(
        canonical,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _source_matches(
    event: LearningEvent,
    source: GrammarError | PronunciationAssessment,
) -> bool:
    return (
        event.source == source.source
        and event.provider == source.provider
        and event.model_version == source.model_version
        and event.is_synthetic == source.is_synthetic
    )


def _expected_reference(
    observation: CanonicalObservation,
) -> tuple[str, uuid.UUID]:
    if observation.pronunciation_assessment_id is not None:
        return ("pronunciation", observation.pronunciation_assessment_id)
    return ("grammar", observation.grammar_error_id)


def _actual_reference(
    event: LearningEvent,
) -> tuple[str, uuid.UUID] | None:
    if event.pronunciation_assessment_id is not None:
        return ("pronunciation", event.pronunciation_assessment_id)
    if event.grammar_error_id is not None:
        return ("grammar", event.grammar_error_id)
    return None


def _observation_matches(
    event: LearningEvent,
    expected: CanonicalObservation,
    ended_at: object,
) -> bool:
    """Compare one observation against the writer's frozen payload shape."""
    return (
        event.idempotency_key == expected.idempotency_key
        and event.event_type == expected.event_type
        and event.skill_id == expected.skill_id
        and event.source_ordinal == expected.source_ordinal
        and event.observation_correct == expected.observation_correct
        and event.observation_code == expected.observation_code
        and event.source == expected.source
        and event.provider == expected.provider
        and event.model_version == expected.model_version
        and event.confidence == expected.confidence
        and event.is_synthetic == expected.is_synthetic
        and event.occurred_at == ended_at
    )


def _reference_sort_key(reference: tuple[str, uuid.UUID]) -> tuple[str, str]:
    return (reference[0], str(reference[1]))


async def validate_learning_event_replay(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    algorithm_versions: Mapping[str, Mapping[str, float]],
) -> ReplayReport:
    """Validate one fixed ledger snapshot without repairing any row."""
    issues: set[tuple[str, uuid.UUID | None, str | None]] = set()
    algorithms = _normalize_algorithms(algorithm_versions)

    async with session_factory() as db:
        # Transaction control is issued before the first data query.  The
        # watermark therefore fixes the same MVCC snapshot later used for all
        # event, Job, source and knowledge-state reads.
        await db.execute(
            text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        )
        watermark = int(
            await db.scalar(
                text("SELECT COALESCE(MAX(apply_seq), 0) FROM learning_events")
            )
            or 0
        )
        isolation_level, read_only_value = (
            await db.execute(
                text(
                    "SELECT current_setting('transaction_isolation'), "
                    "current_setting('transaction_read_only')"
                )
            )
        ).one()

        cutover = await db.get(LearningEventCutover, 1)
        events = list(
            (
                await db.execute(
                    select(LearningEvent)
                    .where(LearningEvent.apply_seq <= watermark)
                    .order_by(LearningEvent.apply_seq)
                )
            )
            .scalars()
            .all()
        )
        states = list((await db.execute(select(KnowledgeState))).scalars().all())

        session_ids = {
            value
            for event in events
            for value in (event.session_id,)
            if value is not None
        }
        job_ids = {
            event.analysis_job_id
            for event in events
            if event.analysis_job_id is not None
        }

        post_cutover_jobs = []
        if cutover is not None and cutover.cutover_at is not None:
            post_cutover_jobs = list(
                (
                    await db.execute(
                        select(AnalysisJob).where(
                            AnalysisJob.status == AnalysisJobStatus.succeeded
                        )
                    )
                )
                .scalars()
                .all()
            )
            post_cutover_jobs = [
                job
                for job in post_cutover_jobs
                if job.finished_at is None or job.finished_at >= cutover.cutover_at
            ]
        for job in post_cutover_jobs:
            job_ids.add(job.id)

        jobs = (
            {
                job.id: job
                for job in (
                    (
                        await db.execute(
                            select(AnalysisJob).where(AnalysisJob.id.in_(job_ids))
                        )
                    )
                    .scalars()
                    .all()
                )
            }
            if job_ids
            else {}
        )

        event_grammar_ids = {
            event.grammar_error_id
            for event in events
            if event.grammar_error_id is not None
        }
        event_assessment_ids = {
            event.pronunciation_assessment_id
            for event in events
            if event.pronunciation_assessment_id is not None
        }
        successful_session_ids = {job.session_id for job in post_cutover_jobs}
        session_ids.update(successful_session_ids)
        session_rows = (
            (
                await db.execute(
                    select(Session.id, Session.user_id, Session.ended_at).where(
                        Session.id.in_(session_ids)
                    )
                )
            ).all()
            if session_ids
            else []
        )
        session_user_ids = {row[0]: row[1] for row in session_rows}
        session_ended_ats = {row[0]: row[2] for row in session_rows}

        grammar_errors = (
            list(
                (
                    await db.execute(
                        select(GrammarError).where(
                            (GrammarError.id.in_(event_grammar_ids))
                            | (GrammarError.session_id.in_(successful_session_ids))
                        )
                    )
                )
                .scalars()
                .all()
            )
            if event_grammar_ids or successful_session_ids
            else []
        )
        assessments = (
            list(
                (
                    await db.execute(
                        select(PronunciationAssessment).where(
                            (PronunciationAssessment.id.in_(event_assessment_ids))
                            | (
                                PronunciationAssessment.session_id.in_(
                                    successful_session_ids
                                )
                            )
                        )
                    )
                )
                .scalars()
                .all()
            )
            if event_assessment_ids or successful_session_ids
            else []
        )
        grammar_by_id = {source.id: source for source in grammar_errors}
        assessment_by_id = {source.id: source for source in assessments}
        grammar_by_session: dict[uuid.UUID, list[GrammarError]] = defaultdict(list)
        for source in grammar_errors:
            grammar_by_session[source.session_id].append(source)
        assessment_by_session = {source.session_id: source for source in assessments}
        valid_skill_ids = set((await db.execute(select(Skill.id))).scalars().all())

        if cutover is None or cutover.cutover_at is None:
            _issue(issues, "cutover_missing")

        events_by_job: dict[uuid.UUID, list[LearningEvent]] = defaultdict(list)
        events_by_user: dict[uuid.UUID, list[LearningEvent]] = defaultdict(list)
        observations_by_skill: dict[tuple[uuid.UUID, str], list[LearningEvent]] = (
            defaultdict(list)
        )
        baseline_events: dict[tuple[uuid.UUID, str], list[LearningEvent]] = defaultdict(
            list
        )
        completed_by_job: dict[uuid.UUID, list[LearningEvent]] = defaultdict(list)

        for event in events:
            if not _canonical_key_matches(event):
                _issue(
                    issues,
                    "canonical_key_mismatch",
                    event.user_id,
                    event.skill_id,
                )
            if event.event_type in _EVENT_TYPES_WITH_SCHEMA_VERSION and not (
                _schema_version_matches(event.details)
            ):
                _issue(
                    issues,
                    "event_schema_version_mismatch",
                    event.user_id,
                    event.skill_id,
                )
            events_by_user[event.user_id].append(event)

            if event.analysis_job_id is not None:
                events_by_job[event.analysis_job_id].append(event)

            if event.event_type == "analysis_completed":
                completed_by_job[event.analysis_job_id].append(event)
                if event.source != "analysis":
                    _issue(
                        issues,
                        "completed_source_mismatch",
                        event.user_id,
                        None,
                    )
                if not _coverage_matches(
                    event.details,
                    assessment=assessment_by_session.get(event.session_id),
                    grammar_errors=grammar_by_session.get(event.session_id, []),
                ):
                    _issue(
                        issues,
                        "coverage_mismatch",
                        event.user_id,
                        None,
                    )
                job = jobs.get(event.analysis_job_id)
                session_user_id = session_user_ids.get(event.session_id)
                ended_at = session_ended_ats.get(event.session_id)
                if job is None:
                    _issue(
                        issues,
                        "missing_source",
                        event.user_id,
                        event.skill_id,
                    )
                else:
                    if (
                        job.session_id != event.session_id
                        or session_user_id != event.user_id
                        or event.user_id != job_user_id(job, session_user_ids)
                    ):
                        _issue(
                            issues,
                            "source_ownership_mismatch",
                            event.user_id,
                            event.skill_id,
                        )
                    if job.status != AnalysisJobStatus.succeeded:
                        _issue(
                            issues,
                            "completed_job_mismatch",
                            event.user_id,
                            event.skill_id,
                        )
                    if ended_at is None or event.occurred_at != ended_at:
                        _issue(
                            issues,
                            "event_time_mismatch",
                            event.user_id,
                            event.skill_id,
                        )
                continue

            if event.event_type == "baseline_snapshot":
                baseline_events[(event.user_id, event.skill_id)].append(event)
                if (
                    not isinstance(event.details, dict)
                    or event.details.get("legacy_synthetic_impact") != "unknown"
                ):
                    _issue(
                        issues,
                        "baseline_synthetic_impact_unknown",
                        event.user_id,
                        event.skill_id,
                    )
                if (
                    cutover is not None
                    and cutover.cutover_at is not None
                    and event.occurred_at != cutover.cutover_at
                ):
                    _issue(
                        issues,
                        "baseline_cutover_mismatch",
                        event.user_id,
                        event.skill_id,
                    )
                if event.source != "legacy_unknown":
                    _issue(
                        issues,
                        "baseline_source_mismatch",
                        event.user_id,
                        event.skill_id,
                    )
                if cutover is not None and event.cutover_revision != cutover.revision:
                    _issue(
                        issues,
                        "baseline_revision_mismatch",
                        event.user_id,
                        event.skill_id,
                    )
                continue

            if event.event_type in _OBSERVATION_TYPES and event.skill_id is not None:
                observations_by_skill[(event.user_id, event.skill_id)].append(event)

            job = jobs.get(event.analysis_job_id)
            session_user_id = session_user_ids.get(event.session_id)
            if job is None:
                _issue(
                    issues,
                    "missing_source",
                    event.user_id,
                    event.skill_id,
                )
            elif (
                job.session_id != event.session_id
                or session_user_id != event.user_id
                or event.user_id != job_user_id(job, session_user_ids)
            ):
                _issue(
                    issues,
                    "source_ownership_mismatch",
                    event.user_id,
                    event.skill_id,
                )

            if event.grammar_error_id is not None:
                source = grammar_by_id.get(event.grammar_error_id)
                if source is None:
                    _issue(
                        issues,
                        "missing_source",
                        event.user_id,
                        event.skill_id,
                    )
                elif (
                    source.session_id != event.session_id
                    or source.skill_tag != event.skill_id
                    or not _source_matches(event, source)
                ):
                    _issue(
                        issues,
                        "source_ownership_mismatch",
                        event.user_id,
                        event.skill_id,
                    )

            if event.pronunciation_assessment_id is not None:
                source = assessment_by_id.get(event.pronunciation_assessment_id)
                if source is None:
                    _issue(
                        issues,
                        "missing_source",
                        event.user_id,
                        event.skill_id,
                    )
                elif source.session_id != event.session_id or not _source_matches(
                    event, source
                ):
                    _issue(
                        issues,
                        "source_ownership_mismatch",
                        event.user_id,
                        event.skill_id,
                    )

        for job_id, job_events in events_by_job.items():
            completions = [
                event
                for event in job_events
                if event.event_type == "analysis_completed"
            ]
            job = jobs.get(job_id)
            observed_skills = {
                event.skill_id for event in job_events if event.skill_id is not None
            }
            if len(completions) > 1:
                for event in completions:
                    _issue(
                        issues,
                        "duplicate_completed_event",
                        event.user_id,
                        None,
                    )

            if completions:
                completed = completions[0]
                version = completed.algorithm_version
                parameters = algorithms.get(version or "")
                if parameters is None:
                    for skill_id in sorted(observed_skills) or [None]:
                        _issue(
                            issues,
                            "unknown_algorithm_version",
                            completed.user_id,
                            skill_id,
                        )
                elif not _params_match(
                    completed.algorithm_params,
                    parameters,
                ):
                    for skill_id in sorted(observed_skills) or [None]:
                        _issue(
                            issues,
                            "algorithm_params_mismatch",
                            completed.user_id,
                            skill_id,
                        )

            ordered = sorted(job_events, key=lambda event: event.apply_seq)
            if ordered and (
                ordered[0].event_type != "analysis_completed"
                or any(
                    event.event_type == "analysis_completed" for event in ordered[1:]
                )
            ):
                for event in ordered:
                    _issue(
                        issues,
                        "event_order_violation",
                        event.user_id,
                        event.skill_id,
                    )

            min_seq = ordered[0].apply_seq
            max_seq = ordered[-1].apply_seq
            user_id = ordered[0].user_id
            for other in events_by_user[user_id]:
                if (
                    min_seq <= other.apply_seq <= max_seq
                    and other.analysis_job_id != job_id
                ):
                    for event in ordered:
                        _issue(
                            issues,
                            "event_order_violation",
                            event.user_id,
                            event.skill_id,
                        )
                    break

        # Rebuild every post-cutover successful Job's canonical batch from its
        # real sources.  Pairing by source reference keeps deleted, reordered
        # and forged observations visible even when their ordinals and keys
        # were mutated together.
        for job in post_cutover_jobs:
            job_user = job_user_id(job, session_user_ids)
            ended_at = session_ended_ats.get(job.session_id)
            if not completed_by_job.get(job.id):
                _issue(
                    issues,
                    "missing_completed_event",
                    job_user,
                    None,
                )

            expected_batch = build_canonical_observations(
                job_id=job.id,
                assessment=assessment_by_session.get(job.session_id),
                grammar_errors=grammar_by_session.get(job.session_id, []),
                valid_skill_ids=valid_skill_ids,
            )
            expected_groups: dict[tuple[str, uuid.UUID], list[CanonicalObservation]] = (
                defaultdict(list)
            )
            for observation in expected_batch.observations:
                expected_groups[_expected_reference(observation)].append(observation)
            actual_groups: dict[tuple[str, uuid.UUID], list[LearningEvent]] = (
                defaultdict(list)
            )
            for event in events_by_job.get(job.id, []):
                if event.event_type not in _OBSERVATION_TYPES:
                    continue
                reference = _actual_reference(event)
                if reference is None:
                    _issue(
                        issues,
                        "unexpected_observation",
                        event.user_id,
                        event.skill_id,
                    )
                    continue
                actual_groups[reference].append(event)

            for reference in sorted(expected_groups, key=_reference_sort_key):
                expected_rows = sorted(
                    expected_groups[reference],
                    key=lambda observation: observation.source_ordinal,
                )
                actual_rows = sorted(
                    actual_groups.get(reference, []),
                    key=lambda event: event.apply_seq,
                )
                paired = min(len(expected_rows), len(actual_rows))
                for observation, event in zip(
                    expected_rows[:paired], actual_rows[:paired], strict=False
                ):
                    if not _observation_matches(event, observation, ended_at):
                        _issue(
                            issues,
                            "canonical_order_mismatch",
                            event.user_id,
                            event.skill_id or observation.skill_id,
                        )
                for observation in expected_rows[paired:]:
                    _issue(
                        issues,
                        "missing_observation",
                        job_user,
                        observation.skill_id,
                    )
                for event in actual_rows[paired:]:
                    _issue(
                        issues,
                        "unexpected_observation",
                        event.user_id,
                        event.skill_id,
                    )

            expected_count = len(expected_batch.observations)
            actual_reference_rows = [
                event for rows in actual_groups.values() for event in rows
            ]
            if len(actual_reference_rows) == expected_count:
                actual_batch = sorted(
                    actual_reference_rows,
                    key=lambda event: event.apply_seq,
                )
                for event, observation in zip(
                    actual_batch,
                    expected_batch.observations,
                    strict=True,
                ):
                    if not _observation_matches(event, observation, ended_at):
                        _issue(
                            issues,
                            "canonical_order_mismatch",
                            event.user_id,
                            event.skill_id or observation.skill_id,
                        )
            for reference in sorted(
                set(actual_groups) - set(expected_groups), key=_reference_sort_key
            ):
                for event in actual_groups[reference]:
                    _issue(
                        issues,
                        "unexpected_observation",
                        event.user_id,
                        event.skill_id,
                    )

            completions = completed_by_job.get(job.id, [])
            if completions:
                details = completions[0].details
                unmapped = (
                    details.get("unmapped") if isinstance(details, dict) else None
                )
                actual_unmapped_pronunciation = (
                    unmapped.get("pronunciation")
                    if isinstance(unmapped, dict)
                    else None
                )
                actual_unmapped_grammar = (
                    unmapped.get("grammar") if isinstance(unmapped, dict) else None
                )
                if (
                    actual_unmapped_pronunciation
                    != expected_batch.unmapped_pronunciation
                    or actual_unmapped_grammar != expected_batch.unmapped_grammar
                ):
                    _issue(
                        issues,
                        "unmapped_count_mismatch",
                        job_user,
                        None,
                    )

        state_by_key = {(state.user_id, state.skill_id): state for state in states}
        valid_algorithm_keys: set[tuple[uuid.UUID, str]] = set()
        for job_events in events_by_job.values():
            completion = next(
                (
                    event
                    for event in job_events
                    if event.event_type == "analysis_completed"
                ),
                None,
            )
            if completion is None or completion.algorithm_version not in algorithms:
                continue
            for event in job_events:
                if event.skill_id is not None:
                    valid_algorithm_keys.add((event.user_id, event.skill_id))

        min_non_baseline_seq = min(
            (
                event.apply_seq
                for event in events
                if event.event_type != "baseline_snapshot"
            ),
            default=None,
        )
        if cutover is not None and (
            cutover.baseline_digest is not None or cutover.baseline_count != 0
        ):
            fixed_baseline_rows = [
                (event.user_id, event.skill_id, event.p_mastery_snapshot)
                for event in events
                if event.event_type == "baseline_snapshot"
                and event.cutover_revision == cutover.revision
            ]
            if (
                len(fixed_baseline_rows) != cutover.baseline_count
                or _baseline_digest(fixed_baseline_rows) != cutover.baseline_digest
            ):
                _issue(
                    issues,
                    "baseline_set_mismatch",
                    None,
                    None,
                )
        for key, baseline_rows in baseline_events.items():
            if len(baseline_rows) > 1:
                _issue(
                    issues,
                    "duplicate_baseline",
                    key[0],
                    key[1],
                )
            if key not in state_by_key:
                _issue(
                    issues,
                    "baseline_state_missing",
                    key[0],
                    key[1],
                )
            for event in baseline_rows:
                if (
                    min_non_baseline_seq is not None
                    and event.apply_seq > min_non_baseline_seq
                ):
                    _issue(
                        issues,
                        "baseline_after_observation",
                        key[0],
                        key[1],
                    )

        default_params = algorithms.get("bkt-v1")
        all_keys = set(state_by_key) | set(baseline_events) | set(observations_by_skill)
        for key in sorted(all_keys, key=lambda item: (str(item[0]), item[1])):
            user_id, skill_id = key
            state = state_by_key.get(key)
            baseline_rows = baseline_events.get(key, [])
            observations = observations_by_skill.get(key, [])

            if baseline_rows:
                base_mastery = baseline_rows[0].p_mastery_snapshot
                if base_mastery is None:
                    _issue(
                        issues,
                        "baseline_snapshot_missing_value",
                        user_id,
                        skill_id,
                    )
                    continue
            else:
                if state is None:
                    # Synthetic observations intentionally leave no derived
                    # state; a real observation without state is data loss.
                    if any(
                        observation.is_synthetic is not True
                        for observation in observations
                    ):
                        _issue(
                            issues,
                            "state_missing",
                            user_id,
                            skill_id,
                        )
                    continue
                is_legacy = (
                    cutover is not None
                    and cutover.cutover_at is not None
                    and state.updated_at <= cutover.cutover_at
                )
                is_unobserved_new_state = (
                    not observations
                    and not is_legacy
                    and default_params is not None
                    and math.isclose(
                        state.p_mastery,
                        default_params.p_init,
                        abs_tol=TOLERANCE,
                        rel_tol=0.0,
                    )
                )
                if is_legacy and not is_unobserved_new_state:
                    _issue(
                        issues,
                        "missing_baseline",
                        user_id,
                        skill_id,
                    )
                    continue
                if not observations and not is_unobserved_new_state:
                    _issue(
                        issues,
                        "missing_baseline",
                        user_id,
                        skill_id,
                    )
                    continue
                if default_params is None:
                    continue
                base_mastery = default_params.p_init

            if key not in valid_algorithm_keys and observations:
                continue

            current = base_mastery
            for observation in observations:
                if observation.is_synthetic is True:
                    continue
                job_id = observation.analysis_job_id
                completion = next(
                    (
                        event
                        for event in completed_by_job.get(job_id, [])
                        if event.event_type == "analysis_completed"
                    ),
                    None,
                )
                if completion is None:
                    continue
                params = algorithms.get(completion.algorithm_version or "")
                if params is None:
                    break
                current = update_mastery(
                    current,
                    bool(observation.observation_correct),
                    params,
                )
            else:
                if state is not None and not math.isclose(
                    state.p_mastery,
                    current,
                    abs_tol=TOLERANCE,
                    rel_tol=0.0,
                ):
                    _issue(
                        issues,
                        "state_mismatch",
                        user_id,
                        skill_id,
                    )
                    synthetic_only = bool(observations) and all(
                        observation.is_synthetic is True for observation in observations
                    )
                    if synthetic_only:
                        _issue(
                            issues,
                            "synthetic_state_drift",
                            user_id,
                            skill_id,
                        )

        await db.rollback()
        replay_issues = tuple(
            ReplayIssue(code=code, user_id=user_id, skill_id=skill_id)
            for code, user_id, skill_id in sorted(
                issues,
                key=lambda item: (
                    item[0],
                    str(item[1]) if item[1] is not None else "",
                    item[2] or "",
                ),
            )
        )
        return ReplayReport(
            watermark=watermark,
            issues=replay_issues,
            isolation_level=str(isolation_level),
            read_only=str(read_only_value).casefold() in {"on", "true", "1"},
        )


def job_user_id(
    job: AnalysisJob,
    sessions: Mapping[uuid.UUID, uuid.UUID],
) -> uuid.UUID | None:
    return sessions.get(job.session_id)


def source_user_id(
    job: AnalysisJob,
    sessions: Mapping[uuid.UUID, uuid.UUID],
) -> uuid.UUID | None:
    return job_user_id(job, sessions)
