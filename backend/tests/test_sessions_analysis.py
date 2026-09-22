import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from auth import CurrentUser
from models.analysis import AnalysisJob, AnalysisJobStatus
from models.session import Session, SessionMode, SessionStatus
from routers.sessions import end_session, get_analysis_status, retry_analysis
from services.analysis_jobs import utc_now


def _db_returning(value):
    db = AsyncMock()
    db.add = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    db.execute.return_value = result
    return db


def _session(user_id: uuid.UUID) -> Session:
    return Session(
        id=uuid.uuid4(),
        user_id=user_id,
        mode=SessionMode.pronunciation,
        status=SessionStatus.active,
    )


def _current_user(user_id: uuid.UUID) -> CurrentUser:
    return CurrentUser(
        id=user_id,
        email="test@example.com",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )


@pytest.mark.asyncio
async def test_end_session_only_completes_session_and_enqueues_job():
    user_id = uuid.uuid4()
    session = _session(user_id)
    db = _db_returning(session)

    result = await end_session(
        session.id,
        current_user=_current_user(user_id),
        db=db,
    )

    assert result is session
    assert session.status == SessionStatus.completed
    assert session.ended_at is not None
    queued = db.add.call_args.args[0]
    assert isinstance(queued, AnalysisJob)
    assert queued.session_id == session.id
    assert queued.status == AnalysisJobStatus.pending


@pytest.mark.asyncio
async def test_end_session_does_not_hide_job_creation_failure():
    user_id = uuid.uuid4()
    session = _session(user_id)
    db = _db_returning(session)
    db.flush.side_effect = RuntimeError("database unavailable")

    with pytest.raises(RuntimeError, match="database unavailable"):
        await end_session(
            session.id,
            current_user=_current_user(user_id),
            db=db,
        )


@pytest.mark.asyncio
async def test_analysis_status_returns_explicit_failed_state():
    user_id = uuid.uuid4()
    now = utc_now()
    job = AnalysisJob(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        status=AnalysisJobStatus.failed,
        attempt_count=3,
        last_error_code="analysis_failed",
        started_at=now - timedelta(seconds=2),
        finished_at=now,
        created_at=now,
        updated_at=now,
    )
    response = await get_analysis_status(
        job.session_id,
        current_user=_current_user(user_id),
        db=_db_returning(job),
    )

    assert response.status == "failed"
    assert response.error_code == "analysis_failed"
    assert response.retryable is True


@pytest.mark.asyncio
async def test_analysis_status_hides_jobs_not_owned_by_user():
    session_id = uuid.uuid4()
    with pytest.raises(HTTPException) as exc_info:
        await get_analysis_status(
            session_id,
            current_user=_current_user(uuid.uuid4()),
            db=_db_returning(None),
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_retry_endpoint_accepts_failed_and_rejects_pending():
    user_id = uuid.uuid4()
    now = utc_now()
    failed = AnalysisJob(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        status=AnalysisJobStatus.failed,
        attempt_count=3,
        created_at=now,
        updated_at=now,
    )
    response = await retry_analysis(
        failed.session_id,
        current_user=_current_user(user_id),
        db=_db_returning(failed),
    )
    assert response.status == "pending"
    assert response.error_code is None

    pending = AnalysisJob(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        status=AnalysisJobStatus.pending,
        attempt_count=0,
        created_at=now,
        updated_at=now,
    )
    with pytest.raises(HTTPException) as exc_info:
        await retry_analysis(
            pending.session_id,
            current_user=_current_user(user_id),
            db=_db_returning(pending),
        )
    assert exc_info.value.status_code == 409
