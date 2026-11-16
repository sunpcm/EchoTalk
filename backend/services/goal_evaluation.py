"""Caller-owned goal evaluation runs and worker execution primitives."""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from models.goal_evaluation import (
    GoalEvaluationResult,
    GoalResult,
    GoalRun,
    GoalRunStatus,
)
from models.scenario_goals import GoalCatalogVersion, SessionGoalSnapshot
from models.session import Session, SessionStatus, Transcript, TranscriptRole
from schemas.scenario_goals import GoalDefinition
from services import goal_rules

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_DELAYS_SECONDS = (5, 30)
STALE_AFTER = timedelta(minutes=5)

ALLOWED_TRANSITIONS: dict[GoalRunStatus, set[GoalRunStatus]] = {
    GoalRunStatus.pending: {GoalRunStatus.running},
    GoalRunStatus.running: {
        GoalRunStatus.pending,
        GoalRunStatus.succeeded,
        GoalRunStatus.failed,
    },
    GoalRunStatus.failed: set(),
    GoalRunStatus.succeeded: set(),
}


class GoalEvaluationError(RuntimeError):
    """A stable, non-sensitive goal evaluation failure."""

    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class EvidenceValidationError(GoalEvaluationError):
    """Frozen evidence could not be proven intact for the run's session."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _transition_run(
    run: GoalRun,
    target: GoalRunStatus,
    *,
    now: datetime | None = None,
) -> None:
    if target not in ALLOWED_TRANSITIONS[run.status]:
        raise GoalEvaluationError(
            "invalid_transition",
            f"{run.status.value} -> {target.value}",
        )
    current = now or _utc_now()
    run.status = target
    run.updated_at = current
    if target == GoalRunStatus.running:
        run.attempt_count += 1
        run.started_at = current
        run.finished_at = None
        run.next_retry_at = None
    elif target == GoalRunStatus.pending:
        run.finished_at = None
    else:
        run.finished_at = current
        run.next_retry_at = None


async def _snapshot_and_goals(
    db: AsyncSession,
    run: GoalRun,
) -> tuple[SessionGoalSnapshot, list[GoalDefinition]]:
    snapshot = await db.scalar(
        select(SessionGoalSnapshot).where(
            SessionGoalSnapshot.session_id == run.session_id
        )
    )
    if snapshot is None:
        raise GoalEvaluationError(
            "snapshot_missing",
            "goal snapshot no longer exists",
        )
    catalog = await db.scalar(
        select(GoalCatalogVersion).where(
            GoalCatalogVersion.material_id == snapshot.material_id,
            GoalCatalogVersion.material_version == snapshot.material_version,
        )
    )
    if catalog is None:
        raise GoalEvaluationError(
            "catalog_missing",
            "goal catalog version no longer exists",
        )
    goals = [GoalDefinition.model_validate(raw) for raw in catalog.goals]
    return snapshot, goals


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


async def _load_evidence(db: AsyncSession, run: GoalRun) -> list[str]:
    evidence_ids: list[int] = []
    for item in run.evidence:
        raw_id = item.get("transcript_id")
        try:
            transcript_id = int(raw_id)
        except (TypeError, ValueError):
            raise EvidenceValidationError(
                "evidence_malformed",
                "frozen evidence reference is malformed",
            )
        evidence_ids.append(transcript_id)

    if len(evidence_ids) != len(set(evidence_ids)):
        raise EvidenceValidationError(
            "evidence_duplicate",
            "frozen evidence references a transcript more than once",
        )

    rows = (
        await db.execute(
            select(Transcript.id, Transcript.content, Transcript.role).where(
                Transcript.id.in_(evidence_ids),
                Transcript.session_id == run.session_id,
            )
        )
    ).all()
    by_id = {row.id: (row.content, row.role) for row in rows}

    utterances: list[str] = []
    for item in run.evidence:
        transcript_id = int(item["transcript_id"])
        expected_digest = item.get("sha256")
        if transcript_id not in by_id:
            raise EvidenceValidationError(
                "evidence_missing",
                "frozen transcript no longer exists for the session",
            )
        content, role = by_id[transcript_id]
        if role != TranscriptRole.user:
            raise EvidenceValidationError(
                "evidence_role_mismatch",
                "frozen transcript is not student evidence",
            )
        if _sha256(content) != expected_digest:
            raise EvidenceValidationError(
                "evidence_digest_mismatch",
                "frozen transcript content changed",
            )
        utterances.append(content)
    return utterances


async def create_goal_run(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GoalRun | None:
    """Create one pending revision-1 run for a completed, snapshot-bound session.

    Never takes a ``FOR UPDATE`` lock on ``users``; the caller already owns the
    session write and this only proves ownership via the joined snapshot read.
    """
    snapshot = await db.scalar(
        select(SessionGoalSnapshot)
        .join(Session, Session.id == SessionGoalSnapshot.session_id)
        .where(
            SessionGoalSnapshot.session_id == session_id,
            Session.user_id == user_id,
        )
    )
    if snapshot is None:
        return None

    session_status = await db.scalar(
        select(Session.status).where(
            Session.id == session_id,
            Session.user_id == user_id,
        )
    )
    if session_status != SessionStatus.completed:
        return None

    catalog = await db.scalar(
        select(GoalCatalogVersion).where(
            GoalCatalogVersion.material_id == snapshot.material_id,
            GoalCatalogVersion.material_version == snapshot.material_version,
        )
    )
    if catalog is None:
        return None

    transcript_rows = (
        await db.execute(
            select(Transcript.id, Transcript.content)
            .where(
                Transcript.session_id == session_id,
                Transcript.role == TranscriptRole.user,
            )
            .order_by(Transcript.timestamp_ms, Transcript.id)
        )
    ).all()
    evidence = [
        {
            "transcript_id": str(row.id),
            "sha256": _sha256(row.content),
        }
        for row in transcript_rows
    ]

    run = GoalRun(
        session_id=session_id,
        revision=1,
        status=GoalRunStatus.pending,
        evaluator_version=goal_rules.EVALUATOR_VERSION,
        evidence=evidence,
        attempt_count=0,
    )
    db.add(run)
    await db.flush()
    return run


async def claim_next_goal_run(
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> uuid.UUID | None:
    """Atomically claim one due run with ``FOR UPDATE SKIP LOCKED``."""
    current = now or _utc_now()
    run = (
        await db.execute(
            select(GoalRun)
            .where(
                GoalRun.status == GoalRunStatus.pending,
                or_(
                    GoalRun.next_retry_at.is_(None),
                    GoalRun.next_retry_at <= current,
                ),
            )
            .order_by(GoalRun.created_at, GoalRun.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
    ).scalar_one_or_none()
    if run is None:
        return None
    _transition_run(run, GoalRunStatus.running, now=current)
    await db.flush()
    return run.id


async def recover_stale_goal_runs(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    stale_after: timedelta = STALE_AFTER,
) -> int:
    """Requeue abandoned running runs or fail exhausted ones."""
    current = now or _utc_now()
    stale_before = current - stale_after
    runs = (
        (
            await db.execute(
                select(GoalRun)
                .where(
                    GoalRun.status == GoalRunStatus.running,
                    GoalRun.started_at <= stale_before,
                )
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    for run in runs:
        run.last_error_code = "worker_timeout"
        run.last_error = None
        if run.attempt_count >= MAX_ATTEMPTS:
            _transition_run(run, GoalRunStatus.failed, now=current)
            await _write_results(db, run, GoalResult.unknown)
        else:
            _transition_run(run, GoalRunStatus.pending, now=current)
            run.next_retry_at = current
    await db.flush()
    return len(runs)


async def _write_results(
    db: AsyncSession,
    run: GoalRun,
    result: GoalResult,
) -> None:
    _snapshot, goals = await _snapshot_and_goals(db, run)
    for goal in goals:
        db.add(
            GoalEvaluationResult(
                run_id=run.id,
                goal_id=goal.goal_id,
                goal_version=goal.goal_version,
                result=result,
            )
        )


async def execute_claimed_goal_run(run_id: uuid.UUID, db: AsyncSession) -> None:
    """Execute one running run and atomically write its terminal results."""
    run = (
        await db.execute(select(GoalRun).where(GoalRun.id == run_id).with_for_update())
    ).scalar_one_or_none()
    if run is None or run.status != GoalRunStatus.running:
        raise GoalEvaluationError(
            "invalid_transition",
            "only a running goal run can be executed",
        )

    snapshot, goals = await _snapshot_and_goals(db, run)

    if run.evaluator_version != goal_rules.EVALUATOR_VERSION:
        for goal in goals:
            db.add(
                GoalEvaluationResult(
                    run_id=run.id,
                    goal_id=goal.goal_id,
                    goal_version=goal.goal_version,
                    result=GoalResult.not_assessed,
                )
            )
        _transition_run(run, GoalRunStatus.succeeded)
        await db.flush()
        return

    if snapshot.material_version != 1:
        for goal in goals:
            db.add(
                GoalEvaluationResult(
                    run_id=run.id,
                    goal_id=goal.goal_id,
                    goal_version=goal.goal_version,
                    result=GoalResult.not_assessed,
                )
            )
        _transition_run(run, GoalRunStatus.succeeded)
        await db.flush()
        return

    try:
        utterances = await _load_evidence(db, run)
    except EvidenceValidationError:
        for goal in goals:
            db.add(
                GoalEvaluationResult(
                    run_id=run.id,
                    goal_id=goal.goal_id,
                    goal_version=goal.goal_version,
                    result=GoalResult.unknown,
                )
            )
        _transition_run(run, GoalRunStatus.succeeded)
        await db.flush()
        return

    for goal in goals:
        result = goal_rules.evaluate_goal(
            goal.goal_id,
            goal.goal_version,
            utterances,
        )
        db.add(
            GoalEvaluationResult(
                run_id=run.id,
                goal_id=goal.goal_id,
                goal_version=goal.goal_version,
                result=result,
            )
        )
    _transition_run(run, GoalRunStatus.succeeded)
    await db.flush()


def _safe_error_code(exc: Exception) -> str:
    if isinstance(exc, GoalEvaluationError):
        return exc.code
    return "goal_evaluation_failed"


async def record_goal_run_failure(
    run_id: uuid.UUID,
    exc: Exception,
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> GoalRun | None:
    """Persist a bounded retry or a terminal failed state after a rollback."""
    current = now or _utc_now()
    run = (
        await db.execute(select(GoalRun).where(GoalRun.id == run_id).with_for_update())
    ).scalar_one_or_none()
    if run is None or run.status != GoalRunStatus.running:
        return run

    run.last_error_code = _safe_error_code(exc)
    run.last_error = None

    retryable = getattr(exc, "retryable", False)
    if run.attempt_count >= MAX_ATTEMPTS or not retryable:
        _transition_run(run, GoalRunStatus.failed, now=current)
        await _write_results(db, run, GoalResult.unknown)
    else:
        _transition_run(run, GoalRunStatus.pending, now=current)
        delay_index = min(run.attempt_count - 1, len(RETRY_DELAYS_SECONDS) - 1)
        run.next_retry_at = current + timedelta(
            seconds=RETRY_DELAYS_SECONDS[delay_index]
        )
    await db.flush()
    return run


async def process_goal_run(
    run_id: uuid.UUID,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Run one claimed run, rolling back partial results before recording."""
    try:
        async with session_factory() as db, db.begin():
            await execute_claimed_goal_run(run_id, db)
    except Exception as exc:
        logger.error(
            "Goal run %s failed (%s)",
            run_id,
            type(exc).__name__,
        )
        async with session_factory() as db, db.begin():
            await record_goal_run_failure(run_id, exc, db)
