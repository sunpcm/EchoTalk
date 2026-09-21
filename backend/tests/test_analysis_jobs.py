import asyncio
import os
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.session import (
    Session,
    SessionMode,
    SessionStatus,
    Transcript,
    TranscriptRole,
)
from models.user import User
from services.analysis_jobs import (
    MAX_ATTEMPTS,
    InvalidAnalysisTransition,
    claim_next_job,
    execute_claimed_job,
    record_job_failure,
    recover_stale_jobs,
    retry_job,
    transition_job,
    utc_now,
)


def _job(status: AnalysisJobStatus) -> AnalysisJob:
    return AnalysisJob(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        status=status,
        attempt_count=0,
        created_at=utc_now(),
        updated_at=utc_now(),
    )


def test_all_legal_analysis_state_transitions():
    now = utc_now()

    pending = _job(AnalysisJobStatus.pending)
    transition_job(pending, AnalysisJobStatus.running, now=now)
    assert pending.status == AnalysisJobStatus.running
    assert pending.attempt_count == 1

    transition_job(pending, AnalysisJobStatus.succeeded, now=now)
    assert pending.status == AnalysisJobStatus.succeeded
    assert pending.finished_at == now

    retrying = _job(AnalysisJobStatus.running)
    transition_job(retrying, AnalysisJobStatus.pending, now=now)
    assert retrying.status == AnalysisJobStatus.pending

    failed = _job(AnalysisJobStatus.running)
    transition_job(failed, AnalysisJobStatus.failed, now=now)
    transition_job(failed, AnalysisJobStatus.pending, now=now)
    assert failed.status == AnalysisJobStatus.pending


@pytest.mark.parametrize(
    ("source", "target"),
    [
        (AnalysisJobStatus.pending, AnalysisJobStatus.succeeded),
        (AnalysisJobStatus.pending, AnalysisJobStatus.failed),
        (AnalysisJobStatus.failed, AnalysisJobStatus.running),
        (AnalysisJobStatus.succeeded, AnalysisJobStatus.pending),
        (AnalysisJobStatus.succeeded, AnalysisJobStatus.running),
    ],
)
def test_illegal_analysis_state_transitions_are_rejected(source, target):
    with pytest.raises(InvalidAnalysisTransition):
        transition_job(_job(source), target)


def test_manual_retry_only_accepts_failed_or_stale_running_job():
    now = utc_now()
    failed = _job(AnalysisJobStatus.failed)
    retry_job(failed, now=now)
    assert failed.status == AnalysisJobStatus.pending

    stale = _job(AnalysisJobStatus.running)
    stale.started_at = now - timedelta(minutes=6)
    retry_job(stale, now=now)
    assert stale.status == AnalysisJobStatus.pending

    fresh = _job(AnalysisJobStatus.running)
    fresh.started_at = now
    with pytest.raises(InvalidAnalysisTransition):
        retry_job(fresh, now=now)


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@pytest.fixture
async def postgres_job():
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip("DATABASE_URL is required for PostgreSQL job integration tests")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()

    async with session_factory() as db, db.begin():
        db.add(User(id=user_id, email=f"analysis-{user_id}@example.test"))
        db.add(
            Session(
                id=session_id,
                user_id=user_id,
                mode=SessionMode.pronunciation,
                status=SessionStatus.completed,
            )
        )
        db.add(
            Transcript(
                session_id=session_id,
                role=TranscriptRole.user,
                content="This is a test",
                timestamp_ms=1,
            )
        )
        for skill_id, skill_name in (
            ("th_sounds", "TH sounds"),
            ("consonant_clusters", "Consonant clusters"),
        ):
            if await db.get(Skill, skill_id) is None:
                db.add(
                    Skill(
                        id=skill_id,
                        name=skill_name,
                        category="pronunciation",
                    )
                )
        db.add(
            AnalysisJob(
                id=job_id,
                session_id=session_id,
                status=AnalysisJobStatus.pending,
            )
        )

    try:
        yield session_factory, user_id, session_id, job_id
    finally:
        async with session_factory() as db, db.begin():
            await db.execute(
                delete(GrammarError).where(GrammarError.session_id == session_id)
            )
            await db.execute(
                delete(PronunciationAssessment).where(
                    PronunciationAssessment.session_id == session_id
                )
            )
            await db.execute(
                delete(KnowledgeState).where(KnowledgeState.user_id == user_id)
            )
            await db.execute(
                delete(Transcript).where(Transcript.session_id == session_id)
            )
            await db.execute(delete(AnalysisJob).where(AnalysisJob.id == job_id))
            await db.execute(delete(Session).where(Session.id == session_id))
            await db.execute(delete(User).where(User.id == user_id))
        await engine.dispose()


@pytest.mark.asyncio
async def test_skip_locked_claims_a_job_only_once(postgres_job):
    session_factory, _user_id, _session_id, job_id = postgres_job

    async def claim_once():
        async with session_factory() as db, db.begin():
            return await claim_next_job(db)

    claimed = await asyncio.gather(claim_once(), claim_once())
    assert claimed.count(job_id) == 1
    assert claimed.count(None) == 1


@pytest.mark.asyncio
async def test_failures_are_bounded_and_end_in_failed(postgres_job):
    session_factory, _user_id, _session_id, job_id = postgres_job
    now = utc_now()

    for attempt in range(1, MAX_ATTEMPTS + 1):
        async with session_factory() as db, db.begin():
            claimed = await claim_next_job(db, now=now)
            assert claimed == job_id
        async with session_factory() as db, db.begin():
            job = await record_job_failure(job_id, RuntimeError("forced"), db, now=now)
            assert job is not None
            expected = (
                AnalysisJobStatus.failed
                if attempt == MAX_ATTEMPTS
                else AnalysisJobStatus.pending
            )
            assert job.status == expected
            assert job.last_error == "Unexpected analysis failure (RuntimeError)"
            assert "forced" not in job.last_error
            if job.next_retry_at is not None:
                now = job.next_retry_at


@pytest.mark.asyncio
async def test_stale_job_is_recovered_after_worker_restart(postgres_job):
    session_factory, _user_id, _session_id, job_id = postgres_job
    now = utc_now()
    async with session_factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        assert job is not None
        transition_job(job, AnalysisJobStatus.running, now=now - timedelta(minutes=6))

    async with session_factory() as db, db.begin():
        assert await recover_stale_jobs(db, now=now) == 1

    async with session_factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job is not None
        assert job.status == AnalysisJobStatus.pending
        assert job.last_error_code == "worker_timeout"


@pytest.mark.asyncio
async def test_job_execution_writes_one_result_and_one_knowledge_effect(postgres_job):
    session_factory, user_id, session_id, job_id = postgres_job
    async with session_factory() as db, db.begin():
        assert await claim_next_job(db) == job_id

    async with session_factory() as db, db.begin():
        await execute_claimed_job(job_id, db)

    async with session_factory() as db:
        assessment_count = await db.scalar(
            select(func.count())
            .select_from(PronunciationAssessment)
            .where(PronunciationAssessment.session_id == session_id)
        )
        states = (
            (
                await db.execute(
                    select(KnowledgeState).where(KnowledgeState.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )
        mastery_snapshot = {state.skill_id: state.p_mastery for state in states}
        assert assessment_count == 1
        assert mastery_snapshot

    with pytest.raises(InvalidAnalysisTransition):
        async with session_factory() as db, db.begin():
            await execute_claimed_job(job_id, db)

    async with session_factory() as db:
        assessment_count = await db.scalar(
            select(func.count())
            .select_from(PronunciationAssessment)
            .where(PronunciationAssessment.session_id == session_id)
        )
        states = (
            (
                await db.execute(
                    select(KnowledgeState).where(KnowledgeState.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )
        assert assessment_count == 1
        assert {state.skill_id: state.p_mastery for state in states} == mastery_snapshot
