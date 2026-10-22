"""会话结束接口幂等契约测试套件（CP02）。

包含单元级 Mock 测试与真实 PostgreSQL 并发/隔离测试。
"""

import asyncio
import os
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from auth import CurrentUser
from models.analysis import AnalysisJob, AnalysisJobStatus
from models.session import Session, SessionMode, SessionStatus
from models.user import User
from routers.sessions import end_session
from services.analysis_jobs import utc_now


def _db_returning(value):
    db = AsyncMock()
    db.add = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    db.execute.return_value = result
    return db


def _session(
    user_id: uuid.UUID, status: SessionStatus = SessionStatus.active
) -> Session:
    return Session(
        id=uuid.uuid4(),
        user_id=user_id,
        mode=SessionMode.pronunciation,
        status=status,
    )


def _current_user(user_id: uuid.UUID) -> CurrentUser:
    return CurrentUser(
        id=user_id,
        email="idempotent-test@example.com",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )


# ---------------------------------------------------------------------------
# 单元级契约测试 (Unit / Mock)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unit_end_session_active_success():
    """active 状态会话正常结束，变 completed 并生成 pending 分析 Job。"""
    user_id = uuid.uuid4()
    session = _session(user_id, status=SessionStatus.active)
    db = _db_returning(session)

    res = await end_session(
        session.id,
        current_user=_current_user(user_id),
        db=db,
    )

    assert res is session
    assert session.status == SessionStatus.completed
    assert session.ended_at is not None
    db.add.assert_called_once()
    queued = db.add.call_args.args[0]
    assert isinstance(queued, AnalysisJob)
    assert queued.session_id == session.id
    assert queued.status == AnalysisJobStatus.pending
    db.refresh.assert_called_once_with(session)


@pytest.mark.asyncio
async def test_unit_end_session_completed_repeat_is_idempotent():
    """completed 状态重复结束，幂等返回 200，不改 ended_at 且不生成 Job。"""
    user_id = uuid.uuid4()
    session = _session(user_id, status=SessionStatus.completed)
    original_ended_at = utc_now() - timedelta(minutes=5)
    session.ended_at = original_ended_at
    db = _db_returning(session)

    res = await end_session(
        session.id,
        current_user=_current_user(user_id),
        db=db,
    )

    assert res is session
    assert session.status == SessionStatus.completed
    assert session.ended_at == original_ended_at
    db.add.assert_not_called()
    db.flush.assert_not_called()
    db.refresh.assert_not_called()


@pytest.mark.asyncio
async def test_unit_end_session_cancelled_raises_400():
    """cancelled 状态会话不能变 completed，保留 400 拒绝。"""
    user_id = uuid.uuid4()
    session = _session(user_id, status=SessionStatus.cancelled)
    db = _db_returning(session)

    with pytest.raises(HTTPException) as exc_info:
        await end_session(
            session.id,
            current_user=_current_user(user_id),
            db=db,
        )

    assert exc_info.value.status_code == 400
    assert session.status == SessionStatus.cancelled
    db.add.assert_not_called()
    db.flush.assert_not_called()


@pytest.mark.asyncio
async def test_unit_end_session_unowned_or_missing_raises_404():
    """会话不存在或不归属当前用户时，保持 404。"""
    user_id = uuid.uuid4()
    db = _db_returning(None)

    with pytest.raises(HTTPException) as exc_info:
        await end_session(
            uuid.uuid4(),
            current_user=_current_user(user_id),
            db=db,
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_unit_end_session_failure_propagation():
    """数据库异常正常向上抛出，保持事务边界，禁止捕获假成功。"""
    user_id = uuid.uuid4()
    session = _session(user_id, status=SessionStatus.active)
    db = _db_returning(session)
    db.flush.side_effect = RuntimeError("database connection broken")

    with pytest.raises(RuntimeError, match="database connection broken"):
        await end_session(
            session.id,
            current_user=_current_user(user_id),
            db=db,
        )


@pytest.mark.asyncio
async def test_unit_end_session_completed_without_job_no_auto_repair():
    """已 completed 但没有 Job 的历史会话不自动修复。"""
    user_id = uuid.uuid4()
    session = _session(user_id, status=SessionStatus.completed)
    session.ended_at = utc_now()
    session.analysis_job = None
    db = _db_returning(session)

    res = await end_session(
        session.id,
        current_user=_current_user(user_id),
        db=db,
    )

    assert res is session
    db.add.assert_not_called()
    db.flush.assert_not_called()


# ---------------------------------------------------------------------------
# 真实 PostgreSQL 集成与并发测试 (显式 DATABASE_URL 隔离模式)
# ---------------------------------------------------------------------------


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@pytest.fixture
async def pg_session_fixture():
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip("DATABASE_URL is required for PostgreSQL session idempotency tests")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()

    async with session_factory() as db, db.begin():
        db.add(
            User(
                id=user_id,
                email=f"idempotency-{user_id}@example.test",
                auth_issuer="urn:echotalk:test",
                auth_subject=str(user_id),
            )
        )
        db.add(
            Session(
                id=session_id,
                user_id=user_id,
                mode=SessionMode.pronunciation,
                status=SessionStatus.active,
            )
        )

    try:
        yield session_factory, user_id, session_id
    finally:
        async with session_factory() as db, db.begin():
            await db.execute(
                delete(AnalysisJob).where(AnalysisJob.session_id == session_id)
            )
            await db.execute(delete(Session).where(Session.id == session_id))
            await db.execute(delete(User).where(User.id == user_id))
        await engine.dispose()


@pytest.mark.asyncio
async def test_pg_end_session_active_success(pg_session_fixture):
    """真实 PostgreSQL 下 active 会话成功变 completed 并创建 1 个 Job。"""
    session_factory, user_id, session_id = pg_session_fixture
    user = CurrentUser(
        id=user_id,
        email=f"idempotency-{user_id}@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )

    async with session_factory() as db:
        res = await end_session(session_id, current_user=user, db=db)
        await db.commit()

    assert res.status == SessionStatus.completed
    assert res.ended_at is not None

    async with session_factory() as db:
        stmt_session = select(Session).where(Session.id == session_id)
        db_session = (await db.execute(stmt_session)).scalar_one()
        assert db_session.status == SessionStatus.completed
        assert db_session.ended_at == res.ended_at

        stmt_jobs = select(AnalysisJob).where(AnalysisJob.session_id == session_id)
        jobs = (await db.execute(stmt_jobs)).scalars().all()
        assert len(jobs) == 1
        assert jobs[0].status == AnalysisJobStatus.pending


@pytest.mark.asyncio
async def test_pg_repeat_end_session_preserves_ended_at_and_job(pg_session_fixture):
    """真实 PostgreSQL 下 completed 重复结束保持 ended_at，不新增 Job。"""
    session_factory, user_id, session_id = pg_session_fixture
    user = CurrentUser(
        id=user_id,
        email=f"idempotency-{user_id}@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )

    async with session_factory() as db:
        res1 = await end_session(session_id, current_user=user, db=db)
        await db.commit()

    ended_at_1 = res1.ended_at
    assert ended_at_1 is not None

    # 重复调用
    async with session_factory() as db:
        res2 = await end_session(session_id, current_user=user, db=db)
        await db.commit()

    assert res2.status == SessionStatus.completed
    assert res2.ended_at == ended_at_1

    async with session_factory() as db:
        stmt_jobs = select(AnalysisJob).where(AnalysisJob.session_id == session_id)
        jobs = (await db.execute(stmt_jobs)).scalars().all()
        assert len(jobs) == 1


@pytest.mark.asyncio
async def test_pg_concurrent_end_session_creates_single_job(pg_session_fixture):
    """真实 PostgreSQL 并发两条独立事务结束同一 active，仅一 Job 且两者成功。"""
    session_factory, user_id, session_id = pg_session_fixture
    user = CurrentUser(
        id=user_id,
        email=f"idempotency-{user_id}@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )

    async def call_end_session():
        async with session_factory() as db:
            try:
                res = await end_session(session_id, current_user=user, db=db)
                await db.commit()
                return res
            except Exception:
                await db.rollback()
                raise

    res1, res2 = await asyncio.gather(call_end_session(), call_end_session())

    assert res1.status == SessionStatus.completed
    assert res2.status == SessionStatus.completed
    assert res1.id == session_id
    assert res2.id == session_id

    async with session_factory() as db:
        stmt_session = select(Session).where(Session.id == session_id)
        db_session = (await db.execute(stmt_session)).scalar_one()
        assert db_session.status == SessionStatus.completed

        stmt_jobs = select(AnalysisJob).where(AnalysisJob.session_id == session_id)
        jobs = (await db.execute(stmt_jobs)).scalars().all()
        assert len(jobs) == 1
        assert jobs[0].status == AnalysisJobStatus.pending


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "existing_status", [AnalysisJobStatus.failed, AnalysisJobStatus.succeeded]
)
async def test_pg_end_session_does_not_reset_existing_job_state(
    pg_session_fixture, existing_status
):
    """对已完成但分析为 failed/succeeded 的会话，重复结束不重置 Job 状态。"""
    session_factory, user_id, session_id = pg_session_fixture
    user = CurrentUser(
        id=user_id,
        email=f"idempotency-{user_id}@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )

    async with session_factory() as db:
        await end_session(session_id, current_user=user, db=db)
        await db.commit()

    finished_time = utc_now()
    error_code = (
        "analysis_failed" if existing_status == AnalysisJobStatus.failed else None
    )
    async with session_factory() as db, db.begin():
        stmt_job = select(AnalysisJob).where(AnalysisJob.session_id == session_id)
        job = (await db.execute(stmt_job)).scalar_one()
        job.status = existing_status
        job.attempt_count = 3
        job.last_error_code = error_code
        job.finished_at = finished_time

    # 再次调用 end_session
    async with session_factory() as db:
        res = await end_session(session_id, current_user=user, db=db)
        await db.commit()

    assert res.status == SessionStatus.completed

    # 验证 Job 字段未被覆写或重置
    async with session_factory() as db:
        stmt_job = select(AnalysisJob).where(AnalysisJob.session_id == session_id)
        job = (await db.execute(stmt_job)).scalar_one()
        assert job.status == existing_status
        assert job.attempt_count == 3
        assert job.last_error_code == error_code
        assert job.finished_at == finished_time


@pytest.mark.asyncio
async def test_pg_end_session_cancelled_raises_400(pg_session_fixture):
    """真实 PostgreSQL 下 cancelled 会话调用 end_session 抛出 400。"""
    session_factory, user_id, session_id = pg_session_fixture
    user = CurrentUser(
        id=user_id,
        email=f"idempotency-{user_id}@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )

    async with session_factory() as db, db.begin():
        stmt_session = select(Session).where(Session.id == session_id)
        s = (await db.execute(stmt_session)).scalar_one()
        s.status = SessionStatus.cancelled

    async with session_factory() as db:
        with pytest.raises(HTTPException) as exc_info:
            await end_session(session_id, current_user=user, db=db)
        assert exc_info.value.status_code == 400

    async with session_factory() as db:
        stmt_session = select(Session).where(Session.id == session_id)
        s = (await db.execute(stmt_session)).scalar_one()
        assert s.status == SessionStatus.cancelled
        stmt_jobs = select(AnalysisJob).where(AnalysisJob.session_id == session_id)
        jobs = (await db.execute(stmt_jobs)).scalars().all()
        assert len(jobs) == 0


@pytest.mark.asyncio
async def test_pg_end_session_unowned_or_missing_raises_404(pg_session_fixture):
    """真实 PostgreSQL 下非本人或不存在的会话调用 end_session 抛出 404。"""
    session_factory, user_id, session_id = pg_session_fixture
    other_user = CurrentUser(
        id=uuid.uuid4(),
        email="other@example.test",
        issuer="urn:echotalk:test",
        subject=str(uuid.uuid4()),
    )

    async with session_factory() as db:
        with pytest.raises(HTTPException) as exc_info1:
            await end_session(session_id, current_user=other_user, db=db)
        assert exc_info1.value.status_code == 404

        with pytest.raises(HTTPException) as exc_info2:
            await end_session(uuid.uuid4(), current_user=other_user, db=db)
        assert exc_info2.value.status_code == 404
