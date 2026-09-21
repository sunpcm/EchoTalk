"""Durable PostgreSQL job orchestration for session analysis."""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.session import Session
from services.analysis_service import analyze_session, update_knowledge

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_DELAYS_SECONDS = (5, 30)
STALE_AFTER = timedelta(minutes=5)


class InvalidAnalysisTransition(ValueError):
    """Raised when code attempts an illegal job state transition."""


class AnalysisExecutionError(RuntimeError):
    """An analysis failure with a stable, non-sensitive public error code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


ALLOWED_TRANSITIONS: dict[AnalysisJobStatus, set[AnalysisJobStatus]] = {
    AnalysisJobStatus.pending: {AnalysisJobStatus.running},
    AnalysisJobStatus.running: {
        AnalysisJobStatus.pending,
        AnalysisJobStatus.succeeded,
        AnalysisJobStatus.failed,
    },
    AnalysisJobStatus.failed: {AnalysisJobStatus.pending},
    AnalysisJobStatus.succeeded: set(),
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def transition_job(
    job: AnalysisJob,
    target: AnalysisJobStatus,
    *,
    now: datetime | None = None,
) -> None:
    """Apply one validated state transition and its timestamp invariants."""
    if target not in ALLOWED_TRANSITIONS[job.status]:
        raise InvalidAnalysisTransition(f"{job.status.value} -> {target.value}")

    current_time = now or utc_now()
    job.status = target
    job.updated_at = current_time

    if target == AnalysisJobStatus.running:
        job.attempt_count += 1
        job.started_at = current_time
        job.finished_at = None
        job.next_retry_at = None
    elif target == AnalysisJobStatus.pending:
        job.finished_at = None
    else:
        job.finished_at = current_time
        job.next_retry_at = None


async def create_analysis_job(
    session_id: uuid.UUID,
    db: AsyncSession,
) -> AnalysisJob:
    """Create the unique pending job within the caller's session-end transaction."""
    job = AnalysisJob(session_id=session_id, status=AnalysisJobStatus.pending)
    db.add(job)
    await db.flush()
    return job


async def claim_next_job(
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> uuid.UUID | None:
    """Atomically claim one due job using PostgreSQL row locking."""
    current_time = now or utc_now()
    stmt = (
        select(AnalysisJob)
        .where(
            AnalysisJob.status == AnalysisJobStatus.pending,
            or_(
                AnalysisJob.next_retry_at.is_(None),
                AnalysisJob.next_retry_at <= current_time,
            ),
        )
        .order_by(AnalysisJob.created_at, AnalysisJob.id)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if job is None:
        return None

    transition_job(job, AnalysisJobStatus.running, now=current_time)
    await db.flush()
    return job.id


async def recover_stale_jobs(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    stale_after: timedelta = STALE_AFTER,
) -> int:
    """Return abandoned running jobs to the queue or fail exhausted jobs."""
    current_time = now or utc_now()
    stale_before = current_time - stale_after
    stmt = (
        select(AnalysisJob)
        .where(
            AnalysisJob.status == AnalysisJobStatus.running,
            AnalysisJob.started_at <= stale_before,
        )
        .with_for_update(skip_locked=True)
    )
    jobs = (await db.execute(stmt)).scalars().all()
    for job in jobs:
        if job.attempt_count >= MAX_ATTEMPTS:
            transition_job(job, AnalysisJobStatus.failed, now=current_time)
            job.last_error_code = "worker_timeout"
            job.last_error = "Analysis worker stopped before completing the job"
        else:
            transition_job(job, AnalysisJobStatus.pending, now=current_time)
            job.next_retry_at = current_time
            job.last_error_code = "worker_timeout"
            job.last_error = "Analysis worker stopped before completing the job"
    await db.flush()
    return len(jobs)


async def execute_claimed_job(job_id: uuid.UUID, db: AsyncSession) -> None:
    """Execute a running job atomically with all analysis result writes."""
    stmt = select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update()
    job = (await db.execute(stmt)).scalar_one_or_none()
    if job is None or job.status != AnalysisJobStatus.running:
        raise InvalidAnalysisTransition("only a running job can be executed")

    session = await db.get(Session, job.session_id)
    if session is None:
        raise AnalysisExecutionError("session_missing", "Session no longer exists")

    assessment = await analyze_session(job.session_id, db)
    if assessment is None:
        raise AnalysisExecutionError(
            "no_user_transcript", "Session has no user transcript to analyze"
        )
    await update_knowledge(job.session_id, session.user_id, db)

    transition_job(job, AnalysisJobStatus.succeeded)
    job.last_error_code = None
    job.last_error = None
    await db.flush()


def _safe_error(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, AnalysisExecutionError):
        return exc.code, str(exc)[:1000]
    # Provider exceptions may echo request headers or credentials. Persist only
    # the exception class; detailed provider diagnostics belong in redacted telemetry.
    return "analysis_failed", f"Unexpected analysis failure ({type(exc).__name__})"


async def record_job_failure(
    job_id: uuid.UUID,
    exc: Exception,
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> AnalysisJob | None:
    """Persist a bounded retry or final failure after execution rolled back."""
    current_time = now or utc_now()
    stmt = select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update()
    job = (await db.execute(stmt)).scalar_one_or_none()
    if job is None or job.status != AnalysisJobStatus.running:
        return job

    code, message = _safe_error(exc)
    job.last_error_code = code
    job.last_error = message

    if job.attempt_count >= MAX_ATTEMPTS:
        transition_job(job, AnalysisJobStatus.failed, now=current_time)
    else:
        transition_job(job, AnalysisJobStatus.pending, now=current_time)
        delay_index = min(job.attempt_count - 1, len(RETRY_DELAYS_SECONDS) - 1)
        job.next_retry_at = current_time + timedelta(
            seconds=RETRY_DELAYS_SECONDS[delay_index]
        )
    await db.flush()
    return job


async def process_job(
    job_id: uuid.UUID,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Run one claimed job, rolling back partial results before recording failure."""
    try:
        async with session_factory() as db, db.begin():
            await execute_claimed_job(job_id, db)
    except Exception as exc:
        logger.error("Analysis job %s failed (%s)", job_id, type(exc).__name__)
        async with session_factory() as db, db.begin():
            await record_job_failure(job_id, exc, db)


def retry_job(
    job: AnalysisJob,
    *,
    now: datetime | None = None,
    stale_after: timedelta = STALE_AFTER,
) -> None:
    """Requeue a final failure or a demonstrably stale running job."""
    current_time = now or utc_now()
    is_stale = (
        job.status == AnalysisJobStatus.running
        and job.started_at is not None
        and job.started_at <= current_time - stale_after
    )
    if job.status != AnalysisJobStatus.failed and not is_stale:
        raise InvalidAnalysisTransition("job is neither failed nor stale")

    transition_job(job, AnalysisJobStatus.pending, now=current_time)
    job.next_retry_at = current_time
    job.last_error_code = None
    job.last_error = None
