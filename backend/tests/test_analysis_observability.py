"""Contract tests for the analysis job observability helpers.

The worker owns the durable transaction boundary: it wraps the claim/recovery
transaction and the execute/failure transaction in :func:`transaction_events`.
Events are therefore buffered in the same context that owns the commit and are
emitted only after that commit succeeds. Integration cases drive the real
``process_job`` and ``analysis_worker.run_forever`` entry points so that a
removed wrapper cannot leave the suite green; unit cases pin the whitelist,
redaction, rollback/cancel discard semantics, and buffer isolation.
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import delete, event
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
from services import analysis_jobs, analysis_observability
from services.analysis_jobs import MAX_ATTEMPTS, claim_next_job, process_job, utc_now
from services.analysis_observability import (
    UNKNOWN_ERROR_CODE,
    record_event,
    safe_error_code,
    transaction_events,
)
from services.analysis_service import AnalysisServiceError
from workers import analysis_worker as worker


class _RecordingLogger:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def info(self, msg: str, *args, **kwargs) -> None:
        self.messages.append(msg)


class _ExplodingLogger:
    def info(self, msg: str, *args, **kwargs) -> None:
        raise RuntimeError("observability handler failure")


def _emitted(log: _RecordingLogger) -> list[dict]:
    return [json.loads(message) for message in log.messages]


def _events_from(caplog) -> list[dict]:
    events: list[dict] = []
    for message in caplog.messages:
        try:
            payload = json.loads(message)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(payload, dict) and "event" in payload:
            events.append(payload)
    return events


def test_safe_error_code_whitelists_and_collapses_unknown():
    assert safe_error_code("analysis_unsupported") == "analysis_unsupported"
    assert safe_error_code("no_user_transcript") == "no_user_transcript"
    assert safe_error_code("session_missing") == "session_missing"
    assert safe_error_code("worker_timeout") == "worker_timeout"
    assert safe_error_code("analysis_failed") == "analysis_failed"
    assert safe_error_code("provider_injected_secret") == UNKNOWN_ERROR_CODE
    assert safe_error_code(None) == UNKNOWN_ERROR_CODE


def test_record_event_is_noop_without_an_active_buffer():
    record_event("analysis_job_claimed", job_id=uuid.uuid4())


def test_record_event_emits_only_whitelisted_fields_and_collapses_error():
    log = _RecordingLogger()
    job_id = uuid.uuid4()
    session_id = uuid.uuid4()
    with transaction_events(log=log):
        record_event(
            "analysis_job_claimed",
            job_id=job_id,
            session_id=session_id,
            attempt_count=1,
            error_code="provider_injected_secret",
            retryable=True,
            outcome="failed",
        )
    assert len(log.messages) == 1
    payload = json.loads(log.messages[0])
    assert set(payload) == {
        "event",
        "job_id",
        "session_id",
        "attempt_count",
        "error_code",
        "retryable",
        "outcome",
    }
    assert payload["event"] == "analysis_job_claimed"
    assert payload["job_id"] == str(job_id)
    assert payload["session_id"] == str(session_id)
    assert payload["attempt_count"] == 1
    assert payload["error_code"] == UNKNOWN_ERROR_CODE
    assert payload["retryable"] is True
    assert payload["outcome"] == "failed"


def test_record_event_omits_unset_optional_fields():
    log = _RecordingLogger()
    with transaction_events(log=log):
        record_event("analysis_job_succeeded", job_id=uuid.uuid4())
    payload = json.loads(log.messages[0])
    assert set(payload) == {"event", "job_id"}


def test_transaction_events_emits_on_normal_exit():
    log = _RecordingLogger()
    with transaction_events(log=log):
        record_event("analysis_job_claimed")
    assert [event["event"] for event in _emitted(log)] == ["analysis_job_claimed"]


def test_transaction_events_discards_on_exception():
    log = _RecordingLogger()
    with pytest.raises(RuntimeError, match="boom"):
        with transaction_events(log=log):
            record_event("analysis_job_claimed")
            raise RuntimeError("boom")
    assert log.messages == []


def test_transaction_events_discards_on_cancel():
    log = _RecordingLogger()
    with pytest.raises(asyncio.CancelledError):
        with transaction_events(log=log):
            record_event("analysis_job_claimed")
            raise asyncio.CancelledError
    assert log.messages == []


def test_handler_failure_is_swallowed_without_changing_outcome():
    log = _ExplodingLogger()
    with transaction_events(log=log):
        record_event("analysis_job_claimed")


def test_nested_buffers_are_isolated():
    outer = _RecordingLogger()
    inner = _RecordingLogger()
    with transaction_events(log=outer):
        record_event("outer_before")
        with transaction_events(log=inner):
            record_event("inner_only")
        record_event("outer_after")
    assert [event["event"] for event in _emitted(outer)] == [
        "outer_before",
        "outer_after",
    ]
    assert [event["event"] for event in _emitted(inner)] == ["inner_only"]


async def test_concurrent_tasks_have_isolated_buffers():
    first = _RecordingLogger()
    second = _RecordingLogger()
    first_inside = asyncio.Event()
    second_inside = asyncio.Event()

    async def run(event_name: str, log: _RecordingLogger, mine, other) -> None:
        with transaction_events(log=log):
            mine.set()
            await other.wait()
            record_event(event_name)

    await asyncio.gather(
        run("first_event", first, first_inside, second_inside),
        run("second_event", second, second_inside, first_inside),
    )
    assert [event["event"] for event in _emitted(first)] == ["first_event"]
    assert [event["event"] for event in _emitted(second)] == ["second_event"]


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
                content="I go yesterday. This is a test",
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
async def test_process_job_success_emits_succeeded(postgres_job, caplog):
    session_factory, _user_id, session_id, job_id = postgres_job
    async with session_factory() as db, db.begin():
        assert await claim_next_job(db) == job_id
    caplog.set_level(logging.INFO)
    await process_job(job_id, session_factory)
    events = _events_from(caplog)
    assert [event["event"] for event in events] == ["analysis_job_succeeded"]
    succeeded = events[0]
    assert succeeded["job_id"] == str(job_id)
    assert succeeded["session_id"] == str(session_id)
    assert succeeded["attempt_count"] == 1
    assert set(succeeded) == {"event", "job_id", "session_id", "attempt_count"}


@pytest.mark.asyncio
async def test_process_job_retryable_failure_redacts_message(
    postgres_job, caplog, monkeypatch
):
    session_factory, _user_id, session_id, job_id = postgres_job
    async with session_factory() as db, db.begin():
        assert await claim_next_job(db) == job_id

    async def boom(_session_id, _db):
        raise RuntimeError("SECRET-CREDENTIAL-abc123")

    monkeypatch.setattr(analysis_jobs, "analyze_session", boom)
    caplog.set_level(logging.INFO)
    await process_job(job_id, session_factory)
    events = _events_from(caplog)
    assert [event["event"] for event in events] == ["analysis_job_retryable_failure"]
    failure = events[0]
    assert failure["job_id"] == str(job_id)
    assert failure["session_id"] == str(session_id)
    assert failure["attempt_count"] == 1
    assert failure["error_code"] == "analysis_failed"
    assert failure["retryable"] is True
    assert set(failure) == {
        "event",
        "job_id",
        "session_id",
        "attempt_count",
        "error_code",
        "retryable",
    }
    assert "SECRET-CREDENTIAL-abc123" not in caplog.text


@pytest.mark.asyncio
async def test_process_job_exhausted_emits_exhausted(postgres_job, caplog, monkeypatch):
    session_factory, _user_id, session_id, job_id = postgres_job
    now = utc_now()
    async with session_factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        job.status = AnalysisJobStatus.running
        job.attempt_count = MAX_ATTEMPTS
        job.started_at = now
        await db.flush()

    async def boom(_session_id, _db):
        raise RuntimeError("forced")

    monkeypatch.setattr(analysis_jobs, "analyze_session", boom)
    caplog.set_level(logging.INFO)
    await process_job(job_id, session_factory)
    events = _events_from(caplog)
    assert [event["event"] for event in events] == ["analysis_job_exhausted"]
    failure = events[0]
    assert failure["job_id"] == str(job_id)
    assert failure["session_id"] == str(session_id)
    assert failure["attempt_count"] == MAX_ATTEMPTS
    assert failure["error_code"] == "analysis_failed"
    assert failure["retryable"] is True
    assert set(failure) == {
        "event",
        "job_id",
        "session_id",
        "attempt_count",
        "error_code",
        "retryable",
    }


@pytest.mark.asyncio
async def test_process_job_injectable_error_is_normalized(
    postgres_job, caplog, monkeypatch
):
    session_factory, _user_id, session_id, job_id = postgres_job
    async with session_factory() as db, db.begin():
        assert await claim_next_job(db) == job_id

    async def inject(_session_id, _db):
        raise AnalysisServiceError("provider_injected_secret", "SECRET-abc123")

    monkeypatch.setattr(analysis_jobs, "analyze_session", inject)
    caplog.set_level(logging.INFO)
    await process_job(job_id, session_factory)
    events = _events_from(caplog)
    assert [event["event"] for event in events] == [
        "analysis_job_non_retryable_failure"
    ]
    failure = events[0]
    assert failure["job_id"] == str(job_id)
    assert failure["session_id"] == str(session_id)
    assert failure["attempt_count"] == 1
    assert failure["error_code"] == UNKNOWN_ERROR_CODE
    assert failure["retryable"] is False
    assert set(failure) == {
        "event",
        "job_id",
        "session_id",
        "attempt_count",
        "error_code",
        "retryable",
    }
    assert "provider_injected_secret" not in caplog.text
    assert "SECRET-abc123" not in caplog.text


@pytest.mark.asyncio
async def test_worker_claim_emits_claimed(postgres_job, caplog, monkeypatch):
    session_factory, _user_id, session_id, job_id = postgres_job
    stop = asyncio.Event()

    async def process_once(_claimed_id, _factory):
        stop.set()

    monkeypatch.setattr(worker, "process_job", process_once)
    caplog.set_level(logging.INFO)
    await worker.run_forever(stop, session_factory=session_factory)
    events = _events_from(caplog)
    assert [event["event"] for event in events] == ["analysis_job_claimed"]
    claimed = events[0]
    assert claimed["job_id"] == str(job_id)
    assert claimed["session_id"] == str(session_id)
    assert claimed["attempt_count"] == 1
    assert set(claimed) == {"event", "job_id", "session_id", "attempt_count"}


@pytest.mark.asyncio
async def test_worker_stale_recovery_emits_event(postgres_job, caplog, monkeypatch):
    session_factory, _user_id, session_id, job_id = postgres_job
    now = utc_now()
    async with session_factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        job.status = AnalysisJobStatus.running
        job.attempt_count = 1
        job.started_at = now - timedelta(minutes=6)
        await db.flush()

    stop = asyncio.Event()

    async def process_once(_claimed_id, _factory):
        stop.set()

    monkeypatch.setattr(worker, "process_job", process_once)
    caplog.set_level(logging.INFO)
    await worker.run_forever(stop, session_factory=session_factory)
    events = _events_from(caplog)
    stale = [
        event for event in events if event["event"] == "analysis_job_stale_recovered"
    ]
    assert len(stale) == 1
    recovered = stale[0]
    assert recovered["job_id"] == str(job_id)
    assert recovered["session_id"] == str(session_id)
    assert recovered["attempt_count"] == 1
    assert recovered["error_code"] == "worker_timeout"
    assert recovered["outcome"] == "pending"
    assert set(recovered) == {
        "event",
        "job_id",
        "session_id",
        "attempt_count",
        "error_code",
        "outcome",
    }


@pytest.mark.asyncio
async def test_worker_cancel_emits_no_phantom_success(
    postgres_job, caplog, monkeypatch
):
    session_factory, _user_id, _session_id, job_id = postgres_job
    reached = asyncio.Event()
    release = asyncio.Event()
    real = analysis_jobs.analyze_session

    async def held(session_id, db):
        result = await real(session_id, db)
        reached.set()
        await release.wait()
        return result

    monkeypatch.setattr(analysis_jobs, "analyze_session", held)
    caplog.set_level(logging.INFO)
    task = asyncio.create_task(worker.run_forever(session_factory=session_factory))
    try:
        await asyncio.wait_for(reached.wait(), 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        release.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    events = _events_from(caplog)
    assert "analysis_job_succeeded" not in [event["event"] for event in events]
    async with session_factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.running
        assert job.attempt_count == 1


@pytest.mark.asyncio
async def test_handler_failure_keeps_committed_success_without_retry(
    postgres_job, monkeypatch
):
    session_factory, _user_id, _session_id, job_id = postgres_job
    async with session_factory() as db, db.begin():
        assert await claim_next_job(db) == job_id

    real_record_job_failure = analysis_jobs.record_job_failure
    failure_called = False

    async def spy_record_job_failure(job_id_, exc, db_, **kwargs):
        nonlocal failure_called
        failure_called = True
        return await real_record_job_failure(job_id_, exc, db_, **kwargs)

    monkeypatch.setattr(analysis_jobs, "record_job_failure", spy_record_job_failure)

    def exploding_info(_msg, *args, **kwargs):
        raise RuntimeError("handler boom")

    monkeypatch.setattr(analysis_observability.logger, "info", exploding_info)
    await process_job(job_id, session_factory)
    assert failure_called is False
    async with session_factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.succeeded
        assert job.attempt_count == 1


@pytest.mark.asyncio
async def test_commit_failure_after_buffered_success_emits_no_phantom_success(
    postgres_job, caplog
):
    session_factory, _user_id, session_id, job_id = postgres_job
    async with session_factory() as db, db.begin():
        assert await claim_next_job(db) == job_id

    remaining_failures = {"count": 1}

    def commit_fault_factory():
        session = session_factory()
        if remaining_failures["count"] > 0:
            remaining_failures["count"] -= 1

            def fail_before_commit(_session):
                raise RuntimeError("injected commit failure")

            event.listen(
                session.sync_session,
                "before_commit",
                fail_before_commit,
                once=True,
            )
        return session

    caplog.set_level(logging.INFO)
    await process_job(job_id, commit_fault_factory)

    events = _events_from(caplog)
    assert [event["event"] for event in events] == ["analysis_job_retryable_failure"]
    failure = events[0]
    assert failure["job_id"] == str(job_id)
    assert failure["session_id"] == str(session_id)
    assert failure["attempt_count"] == 1
    assert failure["error_code"] == "analysis_failed"
    assert failure["retryable"] is True
    assert set(failure) == {
        "event",
        "job_id",
        "session_id",
        "attempt_count",
        "error_code",
        "retryable",
    }

    async with session_factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.pending
        assert job.attempt_count == 1
