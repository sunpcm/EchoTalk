"""Durable baseline cutover and learning-event write gate."""

import hashlib
import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.knowledge import KnowledgeState
from models.learning_event import LearningEvent
from models.learning_event_cutover import LearningEventCutover

PREPARED = "prepared"
LEGACY_WRITES_STOPPED = "legacy_writes_stopped"
BASELINES_WRITTEN = "baselines_written"
EVENTS_ENABLED = "events_enabled"
TRAFFIC_RESUMED = "traffic_resumed"

_BASELINE_SOURCE = "legacy_unknown"
_BASELINE_DETAILS = {
    "schema_version": 1,
    "legacy_synthetic_impact": "unknown",
}
_HEX64 = re.compile(r"[0-9a-f]{64}")


class CutoverError(RuntimeError):
    """A stable, public cutover error code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class CutoverState:
    revision: str
    phase: str
    cutover_at: datetime | None
    baseline_count: int
    baseline_digest: str | None


@dataclass(frozen=True, slots=True)
class BaselineResult:
    revision: str
    phase: str
    cutover_at: datetime
    count: int
    digest: str


@dataclass(frozen=True, slots=True)
class BaselinePreview:
    revision: str
    count: int
    digest: str


def _state(row: LearningEventCutover) -> CutoverState:
    return CutoverState(
        revision=row.revision,
        phase=row.phase,
        cutover_at=row.cutover_at,
        baseline_count=row.baseline_count,
        baseline_digest=row.baseline_digest,
    )


def _baseline_result(row: LearningEventCutover) -> BaselineResult:
    if (
        row.cutover_at is None
        or row.baseline_digest is None
        or row.phase not in {BASELINES_WRITTEN, EVENTS_ENABLED, TRAFFIC_RESUMED}
    ):
        raise CutoverError(
            "cutover_phase_order",
            "baseline result is not complete for the current cutover phase",
        )
    return BaselineResult(
        revision=row.revision,
        phase=row.phase,
        cutover_at=row.cutover_at,
        count=row.baseline_count,
        digest=row.baseline_digest,
    )


def _validate_revision(revision: str) -> str:
    value = revision.strip()
    if not value or len(value) > 100:
        raise CutoverError(
            "cutover_revision_invalid",
            "cutover revision must contain between 1 and 100 characters",
        )
    return value


async def _control_for_update(db: AsyncSession) -> LearningEventCutover:
    row = await db.scalar(
        select(LearningEventCutover)
        .where(LearningEventCutover.id == 1)
        .with_for_update()
    )
    if row is None:
        raise CutoverError(
            "cutover_not_prepared",
            "learning-event cutover has not been prepared",
        )
    return row


def _require_revision(row: LearningEventCutover, revision: str) -> None:
    if row.revision != revision:
        raise CutoverError(
            "cutover_revision_conflict",
            "another learning-event cutover revision is already active",
        )


def _require_phase(row: LearningEventCutover, expected: str) -> None:
    if row.phase != expected:
        raise CutoverError(
            "cutover_phase_order",
            f"cutover phase must be {expected}",
        )


async def _lock_maintenance_surfaces(db: AsyncSession) -> None:
    """Stop old and new writers after the singleton row has been locked."""
    await db.execute(text("LOCK TABLE analysis_jobs IN EXCLUSIVE MODE"))
    await db.execute(text("LOCK TABLE knowledge_states IN SHARE ROW EXCLUSIVE MODE"))


async def _assert_no_running_jobs(db: AsyncSession) -> None:
    running_job_id = await db.scalar(
        select(AnalysisJob.id)
        .where(AnalysisJob.status == AnalysisJobStatus.running)
        .limit(1)
    )
    if running_job_id is not None:
        raise CutoverError(
            "cutover_running_jobs_exist",
            "running analysis jobs must be drained before the cutover",
        )


async def _assert_no_anomalous_events(
    db: AsyncSession,
) -> None:
    existing_event = await db.scalar(select(LearningEvent.apply_seq).limit(1))
    if existing_event is not None:
        raise CutoverError(
            "cutover_existing_events",
            "learning events already exist before the first cutover baseline",
        )


def _digest_rows(
    rows: list[tuple[uuid.UUID, str, float]],
) -> str:
    canonical = [
        {
            "user_id": str(user_id),
            "skill_id": skill_id,
            "p_mastery": p_mastery,
        }
        for user_id, skill_id, p_mastery in rows
    ]
    payload = json.dumps(
        canonical,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


async def _baseline_candidates(
    db: AsyncSession,
) -> list[tuple[uuid.UUID, str, float]]:
    result = await db.execute(
        select(
            KnowledgeState.user_id,
            KnowledgeState.skill_id,
            KnowledgeState.p_mastery,
        ).order_by(KnowledgeState.user_id, KnowledgeState.skill_id)
    )
    return [(row[0], row[1], row[2]) for row in result.all()]


async def prepare_cutover(
    *,
    db: AsyncSession,
    revision: str,
) -> CutoverState:
    """Create or read the singleton cutover row."""
    normalized_revision = _validate_revision(revision)
    await db.execute(
        pg_insert(LearningEventCutover)
        .values(
            id=1,
            revision=normalized_revision,
            phase=PREPARED,
            cutover_at=None,
            baseline_count=0,
            baseline_digest=None,
        )
        .on_conflict_do_nothing()
    )
    row = await _control_for_update(db)
    _require_revision(row, normalized_revision)
    return _state(row)


async def stop_legacy_writes(
    *,
    db: AsyncSession,
    revision: str,
    confirmed_legacy_writers_stopped: bool,
) -> CutoverState:
    """Record explicit operator confirmation after draining old writers."""
    if confirmed_legacy_writers_stopped is not True:
        raise CutoverError(
            "legacy_writers_not_confirmed",
            "legacy writer shutdown must be explicitly confirmed",
        )

    normalized_revision = _validate_revision(revision)
    row = await _control_for_update(db)
    _require_revision(row, normalized_revision)
    already_stopped = row.phase == LEGACY_WRITES_STOPPED
    if not already_stopped:
        _require_phase(row, PREPARED)

    await _lock_maintenance_surfaces(db)
    await _assert_no_running_jobs(db)
    await _assert_no_anomalous_events(db)
    if already_stopped:
        return _state(row)
    row.phase = LEGACY_WRITES_STOPPED
    await db.flush()
    return _state(row)


async def preview_legacy_baselines(
    *,
    db: AsyncSession,
    revision: str,
) -> BaselinePreview:
    """Read the locked baseline candidate set without changing the cutover."""
    normalized_revision = _validate_revision(revision)
    row = await _control_for_update(db)
    _require_revision(row, normalized_revision)
    _require_phase(row, LEGACY_WRITES_STOPPED)

    await _lock_maintenance_surfaces(db)
    await _assert_no_running_jobs(db)
    await _assert_no_anomalous_events(db)
    candidates = await _baseline_candidates(db)
    return BaselinePreview(
        revision=normalized_revision,
        count=len(candidates),
        digest=_digest_rows(candidates),
    )


def _baseline_values(
    *,
    revision: str,
    user_id: uuid.UUID,
    skill_id: str,
    p_mastery: float,
    cutover_at: datetime,
) -> dict[str, Any]:
    return {
        "idempotency_key": f"baseline:{revision}:{user_id}:{skill_id}",
        "event_type": "baseline_snapshot",
        "user_id": user_id,
        "session_id": None,
        "analysis_job_id": None,
        "pronunciation_assessment_id": None,
        "grammar_error_id": None,
        "skill_id": skill_id,
        "source_ordinal": None,
        "observation_correct": None,
        "observation_code": None,
        "source": _BASELINE_SOURCE,
        "provider": None,
        "model_version": None,
        "confidence": None,
        "is_synthetic": None,
        "algorithm_version": None,
        "algorithm_params": None,
        "p_mastery_snapshot": p_mastery,
        "cutover_revision": revision,
        "occurred_at": cutover_at,
        "details": dict(_BASELINE_DETAILS),
    }


def _baseline_matches(event: LearningEvent, values: dict[str, Any]) -> bool:
    for key, expected in values.items():
        if key in {"recorded_at"}:
            continue
        if getattr(event, key) != expected:
            return False
    return True


async def _insert_baseline(
    db: AsyncSession,
    values: dict[str, Any],
) -> None:
    inserted = await db.scalar(
        pg_insert(LearningEvent)
        .values(**values)
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
        .returning(LearningEvent.apply_seq)
    )
    if inserted is not None:
        return

    existing = await db.scalar(
        select(LearningEvent).where(
            LearningEvent.idempotency_key == values["idempotency_key"]
        )
    )
    if existing is None or not _baseline_matches(existing, values):
        raise CutoverError(
            "baseline_conflict",
            "existing baseline does not match the canonical snapshot payload",
        )


async def write_legacy_baselines(
    *,
    db: AsyncSession,
    revision: str,
) -> BaselineResult:
    """Fix the cutover point and idempotently write legacy state baselines."""
    normalized_revision = _validate_revision(revision)
    row = await _control_for_update(db)
    _require_revision(row, normalized_revision)
    if row.phase in {BASELINES_WRITTEN, EVENTS_ENABLED, TRAFFIC_RESUMED}:
        await _verify_persisted_baseline_set(
            db,
            revision=normalized_revision,
            row=row,
        )
        return _baseline_result(row)
    _require_phase(row, LEGACY_WRITES_STOPPED)

    # The table locks wait for and then exclude every legacy write that took
    # the historical Job -> User -> KS path, including writers that do not know
    # the singleton gate exists.
    await _lock_maintenance_surfaces(db)
    await _assert_no_running_jobs(db)
    await _assert_no_anomalous_events(db)

    candidates = await _baseline_candidates(db)
    cutover_at = await db.scalar(text("SELECT clock_timestamp()"))
    if cutover_at is None:
        raise CutoverError(
            "cutover_clock_unavailable",
            "database clock did not return a cutover timestamp",
        )

    for user_id, skill_id, p_mastery in candidates:
        await _insert_baseline(
            db,
            _baseline_values(
                revision=normalized_revision,
                user_id=user_id,
                skill_id=skill_id,
                p_mastery=p_mastery,
                cutover_at=cutover_at,
            ),
        )

    row.phase = BASELINES_WRITTEN
    row.cutover_at = cutover_at
    row.baseline_count = len(candidates)
    row.baseline_digest = _digest_rows(candidates)
    await db.flush()
    return _baseline_result(row)


async def _assert_baseline_event_set(
    db: AsyncSession,
    *,
    revision: str,
    candidates: list[tuple[uuid.UUID, str, float]],
    cutover_at: datetime,
) -> None:
    events = list(
        (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.cutover_revision == revision,
                    LearningEvent.event_type == "baseline_snapshot",
                )
            )
        )
        .scalars()
        .all()
    )
    persisted = {(event.user_id, event.skill_id): event for event in events}
    expected_keys = {(user_id, skill_id) for user_id, skill_id, _ in candidates}
    if set(persisted) != expected_keys:
        raise CutoverError(
            "baseline_state_changed",
            "baseline event set no longer matches the knowledge-state snapshot",
        )

    for user_id, skill_id, p_mastery in candidates:
        expected = _baseline_values(
            revision=revision,
            user_id=user_id,
            skill_id=skill_id,
            p_mastery=p_mastery,
            cutover_at=cutover_at,
        )
        if not _baseline_matches(persisted[(user_id, skill_id)], expected):
            raise CutoverError(
                "baseline_state_changed",
                "baseline event payload no longer matches the fixed snapshot",
            )


async def _verify_persisted_baseline_set(
    db: AsyncSession,
    *,
    revision: str,
    row: LearningEventCutover,
) -> None:
    """Verify the already fixed baseline events without re-anchoring state."""
    events = list(
        (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.cutover_revision == revision,
                    LearningEvent.event_type == "baseline_snapshot",
                )
            )
        )
        .scalars()
        .all()
    )
    if len(events) != row.baseline_count:
        raise CutoverError(
            "baseline_state_changed",
            "persisted baseline event count no longer matches the cutover",
        )

    persisted_rows = sorted(
        ((event.user_id, event.skill_id, event.p_mastery_snapshot) for event in events),
        key=lambda item: (item[0], item[1]),
    )
    if _digest_rows(persisted_rows) != row.baseline_digest:
        raise CutoverError(
            "baseline_state_changed",
            "persisted baseline events no longer match the fixed digest",
        )

    for event in events:
        if (
            event.idempotency_key
            != f"baseline:{revision}:{event.user_id}:{event.skill_id}"
            or event.source != _BASELINE_SOURCE
            or event.occurred_at != row.cutover_at
            or event.details != dict(_BASELINE_DETAILS)
            or event.p_mastery_snapshot is None
        ):
            raise CutoverError(
                "baseline_state_changed",
                "persisted baseline payload no longer matches its canonical shape",
            )


async def _assert_only_revision_baselines(
    db: AsyncSession,
    *,
    revision: str,
) -> None:
    extra_event = await db.scalar(
        select(LearningEvent.apply_seq)
        .where(
            or_(
                LearningEvent.event_type != "baseline_snapshot",
                LearningEvent.cutover_revision.is_distinct_from(revision),
            )
        )
        .limit(1)
    )
    if extra_event is not None:
        raise CutoverError(
            "baseline_state_changed",
            "unexpected learning events exist beside the fixed baselines",
        )


async def enable_event_gate(
    *,
    db: AsyncSession,
    revision: str,
) -> CutoverState:
    """Enable deployment of event-aware writers while traffic remains stopped."""
    normalized_revision = _validate_revision(revision)
    row = await _control_for_update(db)
    _require_revision(row, normalized_revision)
    if row.phase in {EVENTS_ENABLED, TRAFFIC_RESUMED}:
        return _state(row)
    _require_phase(row, BASELINES_WRITTEN)

    await _lock_maintenance_surfaces(db)
    await _assert_no_running_jobs(db)
    candidates = await _baseline_candidates(db)
    if (
        len(candidates) != row.baseline_count
        or _digest_rows(candidates) != row.baseline_digest
        or row.cutover_at is None
    ):
        raise CutoverError(
            "baseline_state_changed",
            "knowledge states changed after the baseline cutover",
        )
    await _assert_baseline_event_set(
        db,
        revision=normalized_revision,
        candidates=candidates,
        cutover_at=row.cutover_at,
    )
    await _assert_only_revision_baselines(db, revision=normalized_revision)

    row.phase = EVENTS_ENABLED
    await db.flush()
    return _state(row)


async def resume_traffic(
    *,
    db: AsyncSession,
    revision: str,
) -> CutoverState:
    """Open the durable event gate after deployment is enabled."""
    normalized_revision = _validate_revision(revision)
    row = await _control_for_update(db)
    _require_revision(row, normalized_revision)
    if row.phase == TRAFFIC_RESUMED:
        return _state(row)
    _require_phase(row, EVENTS_ENABLED)

    await _lock_maintenance_surfaces(db)
    await _assert_no_running_jobs(db)
    candidates = await _baseline_candidates(db)
    if (
        len(candidates) != row.baseline_count
        or _digest_rows(candidates) != row.baseline_digest
        or row.cutover_at is None
    ):
        raise CutoverError(
            "baseline_state_changed",
            "knowledge states changed after the baseline cutover",
        )
    await _assert_baseline_event_set(
        db,
        revision=normalized_revision,
        candidates=candidates,
        cutover_at=row.cutover_at,
    )
    await _assert_only_revision_baselines(db, revision=normalized_revision)
    row.phase = TRAFFIC_RESUMED
    await db.flush()
    return _state(row)


async def assert_learning_event_gate(db: AsyncSession) -> CutoverState:
    """Take the shared gate lock and fail closed unless traffic is resumed."""
    row = await db.scalar(
        select(LearningEventCutover)
        .where(LearningEventCutover.id == 1)
        .with_for_update(read=True)
    )
    if row is None or row.phase != TRAFFIC_RESUMED:
        raise CutoverError(
            "learning_event_gate_closed",
            "learning-event writes are disabled by the persistent cutover gate",
        )
    if (
        row.cutover_at is None
        or row.baseline_digest is None
        or row.baseline_count < 0
        or _HEX64.fullmatch(row.baseline_digest) is None
    ):
        raise CutoverError(
            "cutover_control_incomplete",
            "learning-event cutover control row is structurally incomplete",
        )
    return _state(row)


# A descriptive alias for callers that describe this as an assertion.
ensure_learning_event_gate = assert_learning_event_gate
