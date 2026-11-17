"""Read-only consistency validation of learning events and mastered state.

B2 clean-start semantics: the validator owns one ``REPEATABLE READ READ ONLY``
transaction, fixes the first-data-query ``MAX(apply_seq)`` watermark, then
checks every succeeded Job's complete batch, its persisted sources, the frozen
``bkt-v1`` algorithm facts and the derived knowledge state. It never repairs a
row, never uses a legacy baseline or cutover point-in-time as an initial state,
and reports any baseline snapshot as an unexpected leftover.

Stable issue codes (B2 S3):

    canonical_key_mismatch       event idempotency key does not match its shape
    event_schema_version_mismatch  details.schema_version is not the integer 1
    completed_source_mismatch    analysis_completed source is not ``analysis``
    coverage_mismatch            completed seven-key coverage does not match sources
    missing_source               a referenced Job/session/source row is absent
    ownership_mismatch           event/Job/Session/User/source ownership mismatch
    completed_job_mismatch       an event is tied to a Job that is not succeeded
    event_time_mismatch          completed.occurred_at does not match session ended_at
    unexpected_baseline          a baseline_snapshot exists in the clean ledger
    duplicate_completed_event    a Job has more than one analysis_completed
    algorithm_mismatch           algorithm version unknown or params are not exact
    event_order_violation        completed is not first or same-user batches interleave
    canonical_source_invalid     persisted sources cannot build a canonical batch
    unexpected_observation       a persisted observation has no canonical match
    canonical_order_mismatch     a matched observation is in the wrong position
    missing_observation          a canonical observation has no persisted event
    mismatched_batch             a succeeded Job's observation count differs
    unmapped_count_mismatch      completed unmapped counts differ from sources
    missing_completed_event      a succeeded Job has no analysis_completed
    real_state_missing           a real observation has no knowledge state
    synthetic_state_drift        a synthetic-only batch has a knowledge state
    state_mismatch               a state value does not match the replayed value
    state_out_of_range           a state value is not finite or outside [0, 1]

Legacy B1 mapping: ``source_ownership_mismatch`` -> ``ownership_mismatch``;
``unknown_algorithm_version`` / ``algorithm_params_mismatch`` ->
``algorithm_mismatch``; ``state_missing`` -> ``real_state_missing``; the former
baseline/cutover codes collapse into ``unexpected_baseline``.
"""

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
from models.session import Session
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.learning_event_canonical import (
    CanonicalObservation,
    CanonicalObservationError,
    build_canonical_observations,
)
from services.learning_event_rules import (
    CoverageValidationError,
    has_complete_b2_coverage,
    validate_ledger_coverage,
)

TOLERANCE = 1e-9
_PARAMETER_NAMES = ("p_init", "p_transit", "p_slip", "p_guess")
_OBSERVATION_TYPES = {"pronunciation_observation", "grammar_observation"}
_EVENT_TYPES_WITH_SCHEMA_VERSION = {
    "analysis_completed",
    *_OBSERVATION_TYPES,
    "baseline_snapshot",
}

FROZEN_BKT_VERSION = "bkt-v1"
FROZEN_BKT_PARAMS: dict[str, float] = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}
FROZEN_BKT = BKTParams(**FROZEN_BKT_PARAMS)


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
        if not isinstance(raw, Mapping) or set(raw) != set(_PARAMETER_NAMES):
            continue
        values: dict[str, float] = {}
        valid = True
        for name in _PARAMETER_NAMES:
            value = raw[name]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                valid = False
                break
            float_value = float(value)
            if not math.isfinite(float_value):
                valid = False
                break
            values[name] = float_value
        if not valid:
            continue
        normalized[version] = BKTParams(**values)
    return normalized


def _params_match(actual: object, expected: BKTParams) -> bool:
    """Compare persisted algorithm params against the frozen set exactly."""
    if not isinstance(actual, dict) or set(actual) != set(_PARAMETER_NAMES):
        return False
    for name in _PARAMETER_NAMES:
        value = actual[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        if value != getattr(expected, name):
            return False
    return True


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


def _coverage_matches(
    details: object,
    *,
    assessment: PronunciationAssessment | None,
    grammar_errors: list[GrammarError],
) -> bool:
    if not has_complete_b2_coverage(details):
        return False
    assert isinstance(details, dict)
    coverage = details.get("coverage")
    try:
        validate_ledger_coverage(
            coverage,
            pronunciation_sources=([assessment] if assessment is not None else []),
            grammar_sources=grammar_errors,
        )
    except CoverageValidationError:
        return False
    return True


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


def _valid_unmapped_count(value: object) -> bool:
    """Accept only a non-negative integer that is not a JSON boolean."""
    return type(value) is int and not isinstance(value, bool) and value >= 0


async def validate_learning_event_replay(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    algorithm_versions: Mapping[str, Mapping[str, float]],
) -> ReplayReport:
    """Validate one fixed ledger snapshot without repairing any row."""
    issues: set[tuple[str, uuid.UUID | None, str | None]] = set()
    # The caller map is validated for shape only. Frozen ``bkt-v1`` facts are
    # module constants and must never be redefined by caller input.
    _normalize_algorithms(algorithm_versions)
    default_params = FROZEN_BKT

    async with session_factory() as db:
        # Transaction control is issued before the first data query so the
        # watermark fixes the same MVCC snapshot used for every later read.
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

        all_jobs = list((await db.execute(select(AnalysisJob))).scalars().all())
        jobs_by_id = {job.id: job for job in all_jobs}
        succeeded_jobs = [
            job for job in all_jobs if job.status == AnalysisJobStatus.succeeded
        ]

        session_ids = {
            event.session_id for event in events if event.session_id is not None
        }
        session_ids.update(job.session_id for job in succeeded_jobs)

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
        grammar_errors = (
            list(
                (
                    await db.execute(
                        select(GrammarError).where(
                            (GrammarError.session_id.in_(session_ids))
                            | (GrammarError.id.in_(event_grammar_ids))
                        )
                    )
                )
                .scalars()
                .all()
            )
            if session_ids or event_grammar_ids
            else []
        )
        assessments = (
            list(
                (
                    await db.execute(
                        select(PronunciationAssessment).where(
                            (PronunciationAssessment.session_id.in_(session_ids))
                            | (PronunciationAssessment.id.in_(event_assessment_ids))
                        )
                    )
                )
                .scalars()
                .all()
            )
            if session_ids or event_assessment_ids
            else []
        )
        grammar_by_id = {source.id: source for source in grammar_errors}
        assessment_by_id = {source.id: source for source in assessments}
        grammar_by_session: dict[uuid.UUID, list[GrammarError]] = defaultdict(list)
        for source in grammar_errors:
            grammar_by_session[source.session_id].append(source)
        assessment_by_session = {source.session_id: source for source in assessments}
        valid_skill_ids = set((await db.execute(select(Skill.id))).scalars().all())

        events_by_job: dict[uuid.UUID, list[LearningEvent]] = defaultdict(list)
        events_by_user: dict[uuid.UUID, list[LearningEvent]] = defaultdict(list)
        observations_by_skill: dict[tuple[uuid.UUID, str], list[LearningEvent]] = (
            defaultdict(list)
        )
        completed_by_job: dict[uuid.UUID, list[LearningEvent]] = defaultdict(list)

        for event in events:
            if not _canonical_key_matches(event):
                _issue(issues, "canonical_key_mismatch", event.user_id, event.skill_id)
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

            if event.event_type == "baseline_snapshot":
                _issue(issues, "unexpected_baseline", event.user_id, event.skill_id)
                continue

            if event.event_type == "analysis_completed":
                completed_by_job[event.analysis_job_id].append(event)
                if event.source != "analysis":
                    _issue(issues, "completed_source_mismatch", event.user_id, None)
                if not _coverage_matches(
                    event.details,
                    assessment=assessment_by_session.get(event.session_id),
                    grammar_errors=grammar_by_session.get(event.session_id, []),
                ):
                    _issue(issues, "coverage_mismatch", event.user_id, None)
                job = jobs_by_id.get(event.analysis_job_id)
                session_user_id = session_user_ids.get(event.session_id)
                ended_at = session_ended_ats.get(event.session_id)
                if job is None:
                    _issue(issues, "missing_source", event.user_id, None)
                else:
                    if job.status != AnalysisJobStatus.succeeded:
                        _issue(issues, "completed_job_mismatch", event.user_id, None)
                    if (
                        job.session_id != event.session_id
                        or session_user_id != event.user_id
                        or event.user_id != job_user_id(job, session_user_ids)
                    ):
                        _issue(issues, "ownership_mismatch", event.user_id, None)
                    if ended_at is None or event.occurred_at != ended_at:
                        _issue(issues, "event_time_mismatch", event.user_id, None)
                continue

            if event.event_type in _OBSERVATION_TYPES:
                if event.skill_id is not None:
                    observations_by_skill[(event.user_id, event.skill_id)].append(event)
                job = jobs_by_id.get(event.analysis_job_id)
                session_user_id = session_user_ids.get(event.session_id)
                if job is None:
                    _issue(issues, "missing_source", event.user_id, event.skill_id)
                else:
                    if job.status != AnalysisJobStatus.succeeded:
                        _issue(
                            issues,
                            "completed_job_mismatch",
                            event.user_id,
                            event.skill_id,
                        )
                    if (
                        job.session_id != event.session_id
                        or session_user_id != event.user_id
                        or event.user_id != job_user_id(job, session_user_ids)
                    ):
                        _issue(
                            issues,
                            "ownership_mismatch",
                            event.user_id,
                            event.skill_id,
                        )

                if event.grammar_error_id is not None:
                    source = grammar_by_id.get(event.grammar_error_id)
                    if source is None:
                        _issue(issues, "missing_source", event.user_id, event.skill_id)
                    elif (
                        source.session_id != event.session_id
                        or source.skill_tag != event.skill_id
                        or not _source_matches(event, source)
                    ):
                        _issue(
                            issues,
                            "ownership_mismatch",
                            event.user_id,
                            event.skill_id,
                        )

                if event.pronunciation_assessment_id is not None:
                    source = assessment_by_id.get(event.pronunciation_assessment_id)
                    if source is None:
                        _issue(issues, "missing_source", event.user_id, event.skill_id)
                    elif source.session_id != event.session_id or not _source_matches(
                        event, source
                    ):
                        _issue(
                            issues,
                            "ownership_mismatch",
                            event.user_id,
                            event.skill_id,
                        )

        for job in succeeded_jobs:
            job_user = job_user_id(job, session_user_ids)
            ended_at = session_ended_ats.get(job.session_id)
            job_events = events_by_job.get(job.id, [])
            completions = [
                event
                for event in job_events
                if event.event_type == "analysis_completed"
            ]

            if len(completions) > 1:
                for event in completions:
                    _issue(issues, "duplicate_completed_event", event.user_id, None)

            if not completions:
                _issue(issues, "missing_completed_event", job_user, None)

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

            if ordered:
                min_seq = ordered[0].apply_seq
                max_seq = ordered[-1].apply_seq
                user_id = ordered[0].user_id
                for other in events_by_user.get(user_id, []):
                    if (
                        min_seq <= other.apply_seq <= max_seq
                        and other.analysis_job_id != job.id
                    ):
                        for event in ordered:
                            _issue(
                                issues,
                                "event_order_violation",
                                event.user_id,
                                event.skill_id,
                            )
                        break

            try:
                expected_batch = build_canonical_observations(
                    job_id=job.id,
                    assessment=assessment_by_session.get(job.session_id),
                    grammar_errors=grammar_by_session.get(job.session_id, []),
                    valid_skill_ids=valid_skill_ids,
                )
            except CanonicalObservationError:
                _issue(issues, "canonical_source_invalid", job_user, None)
                continue

            if completions:
                completed = completions[0]
                if completed.algorithm_version != FROZEN_BKT_VERSION or not (
                    _params_match(completed.algorithm_params, FROZEN_BKT)
                ):
                    _issue(issues, "algorithm_mismatch", completed.user_id, None)

            expected_groups: dict[tuple[str, uuid.UUID], list[CanonicalObservation]] = (
                defaultdict(list)
            )
            for observation in expected_batch.observations:
                expected_groups[_expected_reference(observation)].append(observation)
            actual_groups: dict[tuple[str, uuid.UUID], list[LearningEvent]] = (
                defaultdict(list)
            )
            actual_observation_count = 0
            actual_job_observations: list[LearningEvent] = []
            for event in job_events:
                if event.event_type not in _OBSERVATION_TYPES:
                    continue
                reference = _actual_reference(event)
                if reference is None:
                    _issue(
                        issues, "unexpected_observation", event.user_id, event.skill_id
                    )
                    continue
                actual_observation_count += 1
                actual_job_observations.append(event)
                actual_groups[reference].append(event)

            for reference in sorted(
                set(expected_groups) | set(actual_groups), key=_reference_sort_key
            ):
                expected_rows = sorted(
                    expected_groups.get(reference, []),
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

            if actual_observation_count != len(expected_batch.observations):
                _issue(issues, "mismatched_batch", job_user, None)

            actual_job_observations.sort(key=lambda event: event.apply_seq)
            if len(actual_job_observations) == len(expected_batch.observations):
                for actual, expected in zip(
                    actual_job_observations,
                    expected_batch.observations,
                    strict=False,
                ):
                    if not _observation_matches(actual, expected, ended_at):
                        _issue(
                            issues,
                            "canonical_order_mismatch",
                            actual.user_id,
                            actual.skill_id or expected.skill_id,
                        )

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
                    not _valid_unmapped_count(actual_unmapped_pronunciation)
                    or actual_unmapped_pronunciation
                    != expected_batch.unmapped_pronunciation
                    or not _valid_unmapped_count(actual_unmapped_grammar)
                    or actual_unmapped_grammar != expected_batch.unmapped_grammar
                ):
                    _issue(issues, "unmapped_count_mismatch", job_user, None)

        state_by_key = {(state.user_id, state.skill_id): state for state in states}
        all_keys = set(state_by_key) | set(observations_by_skill)
        for key in sorted(all_keys, key=lambda item: (str(item[0]), item[1])):
            user_id, skill_id = key
            state = state_by_key.get(key)
            observations = sorted(
                observations_by_skill.get(key, []), key=lambda event: event.apply_seq
            )
            real = [
                observation
                for observation in observations
                if observation.is_synthetic is not True
            ]
            synthetic = [
                observation
                for observation in observations
                if observation.is_synthetic is True
            ]

            state_value_valid = True
            if state is not None:
                p_mastery = state.p_mastery
                if (
                    isinstance(p_mastery, bool)
                    or not isinstance(p_mastery, (int, float))
                    or not math.isfinite(p_mastery)
                    or not (0.0 <= p_mastery <= 1.0)
                ):
                    _issue(issues, "state_out_of_range", user_id, skill_id)
                    state_value_valid = False

            if real:
                if state is None:
                    _issue(issues, "real_state_missing", user_id, skill_id)
                    continue
                current = default_params.p_init
                replayed = True
                for observation in real:
                    completion = next(
                        (
                            event
                            for event in completed_by_job.get(
                                observation.analysis_job_id, []
                            )
                            if event.event_type == "analysis_completed"
                        ),
                        None,
                    )
                    if completion is None:
                        replayed = False
                        break
                    if completion.algorithm_version != FROZEN_BKT_VERSION or not (
                        _params_match(completion.algorithm_params, FROZEN_BKT)
                    ):
                        replayed = False
                        break
                    current = update_mastery(
                        current,
                        bool(observation.observation_correct),
                        FROZEN_BKT,
                    )
                if (
                    replayed
                    and state_value_valid
                    and not math.isclose(
                        state.p_mastery,
                        current,
                        abs_tol=TOLERANCE,
                        rel_tol=0.0,
                    )
                ):
                    _issue(issues, "state_mismatch", user_id, skill_id)
            elif synthetic:
                if state is not None:
                    _issue(issues, "synthetic_state_drift", user_id, skill_id)
            elif state is not None:
                _issue(issues, "state_mismatch", user_id, skill_id)

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
