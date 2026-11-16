"""Contract tests for the read-only analysis queue snapshot helper."""

import os
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.session import Session, SessionMode, SessionStatus
from models.user import User
from services.analysis_jobs import queue_snapshot, utc_now


class _FakeResult:
    def __init__(self, row: tuple[int, object]) -> None:
        self._row = row

    def one(self) -> tuple[int, object]:
        return self._row


class _FakeNoAutoflush:
    def __init__(self, db: "_FakeDB") -> None:
        self._db = db

    def __enter__(self) -> "_FakeNoAutoflush":
        self._db.no_autoflush_entered = True
        return self

    def __exit__(self, *exc) -> bool:
        return False


class _FakeDB:
    """Minimal session standing in for AsyncSession in snapshot contract tests.

    Deliberately exposes no ``flush``, ``commit`` or ``add`` methods: if the
    snapshot helper touched any of them the test would fail with AttributeError.
    """

    def __init__(self, row: tuple[int, object]) -> None:
        self.row = row
        self.executed: list[object] = []
        self.no_autoflush_entered = False
        self.no_autoflush = _FakeNoAutoflush(self)

    async def execute(self, statement: object) -> _FakeResult:
        self.executed.append(statement)
        return _FakeResult(self.row)


@pytest.mark.asyncio
async def test_snapshot_empty_queue_returns_zero_and_uses_autoflush_guard():
    db = _FakeDB((0, None))
    assert await queue_snapshot(db, now=utc_now()) == (0, 0)
    assert db.no_autoflush_entered is True
    assert len(db.executed) == 1


@pytest.mark.asyncio
async def test_snapshot_computes_age_from_created_at():
    now = utc_now()
    created_at = now - timedelta(seconds=125)
    db = _FakeDB((2, created_at))
    assert await queue_snapshot(db, now=now) == (2, 125)
    assert len(db.executed) == 1


@pytest.mark.asyncio
async def test_snapshot_clamps_future_clock_to_zero_age():
    now = utc_now()
    future_created_at = now + timedelta(minutes=10)
    db = _FakeDB((1, future_created_at))
    assert await queue_snapshot(db, now=now) == (1, 0)


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@pytest.fixture
async def snapshot_db():
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip("DATABASE_URL is required for PostgreSQL snapshot tests")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    session_ids = [uuid.uuid4() for _ in range(4)]

    try:
        yield session_factory, user_id, session_ids
    finally:
        async with session_factory() as db, db.begin():
            await db.execute(
                delete(AnalysisJob).where(AnalysisJob.session_id.in_(session_ids))
            )
            await db.execute(delete(Session).where(Session.id.in_(session_ids)))
            await db.execute(delete(User).where(User.id == user_id))
        await engine.dispose()


async def _seed_jobs(session_factory, user_id, specs):
    async with session_factory() as db, db.begin():
        db.add(User(id=user_id, email=f"snapshot-{user_id}@example.test"))
        for session_id, status, created_at, next_retry_at in specs:
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
                )
            )
            db.add(
                AnalysisJob(
                    id=uuid.uuid4(),
                    session_id=session_id,
                    status=status,
                    created_at=created_at,
                    updated_at=created_at,
                    next_retry_at=next_retry_at,
                )
            )


@pytest.mark.asyncio
async def test_snapshot_empty_database_returns_zero(snapshot_db):
    session_factory, _user_id, _session_ids = snapshot_db
    async with session_factory() as db:
        assert await queue_snapshot(db) == (0, 0)


@pytest.mark.asyncio
async def test_snapshot_does_not_autoflush_pending_objects(snapshot_db):
    session_factory, user_id, session_ids = snapshot_db
    async with session_factory() as db, db.begin():
        db.add(User(id=user_id, email=f"snapshot-{user_id}@example.test"))
        db.add(
            Session(
                id=session_ids[0],
                user_id=user_id,
                mode=SessionMode.pronunciation,
                status=SessionStatus.completed,
            )
        )
    async with session_factory() as db:
        db.add(
            AnalysisJob(
                id=uuid.uuid4(),
                session_id=session_ids[0],
                status=AnalysisJobStatus.pending,
            )
        )
        count, age = await queue_snapshot(db, now=utc_now())
        assert count == 0
        assert age == 0


@pytest.mark.asyncio
async def test_snapshot_counts_only_pending_jobs(snapshot_db):
    session_factory, user_id, session_ids = snapshot_db
    now = utc_now()
    await _seed_jobs(
        session_factory,
        user_id,
        [
            (
                session_ids[0],
                AnalysisJobStatus.pending,
                now - timedelta(seconds=60),
                None,
            ),
            (
                session_ids[1],
                AnalysisJobStatus.running,
                now - timedelta(seconds=30),
                None,
            ),
            (
                session_ids[2],
                AnalysisJobStatus.succeeded,
                now - timedelta(seconds=120),
                None,
            ),
            (
                session_ids[3],
                AnalysisJobStatus.failed,
                now - timedelta(seconds=90),
                None,
            ),
        ],
    )
    async with session_factory() as db:
        count, age = await queue_snapshot(db, now=now)
        assert count == 1
        assert age == 60


@pytest.mark.asyncio
async def test_snapshot_uses_oldest_pending_created_at(snapshot_db):
    session_factory, user_id, session_ids = snapshot_db
    now = utc_now()
    older = now - timedelta(seconds=300)
    newer = now - timedelta(seconds=20)
    await _seed_jobs(
        session_factory,
        user_id,
        [
            (session_ids[0], AnalysisJobStatus.pending, older, None),
            (session_ids[1], AnalysisJobStatus.pending, newer, None),
        ],
    )
    async with session_factory() as db:
        count, age = await queue_snapshot(db, now=now)
        assert count == 2
        assert age == 300


@pytest.mark.asyncio
async def test_snapshot_includes_delayed_retry_pending(snapshot_db):
    session_factory, user_id, session_ids = snapshot_db
    now = utc_now()
    delayed_retry = now + timedelta(seconds=30)
    await _seed_jobs(
        session_factory,
        user_id,
        [
            (
                session_ids[0],
                AnalysisJobStatus.pending,
                now - timedelta(seconds=10),
                delayed_retry,
            ),
        ],
    )
    async with session_factory() as db:
        count, age = await queue_snapshot(db, now=now)
        assert count == 1
        assert age == 10


@pytest.mark.asyncio
async def test_snapshot_future_created_at_clamps_age_to_zero(snapshot_db):
    session_factory, user_id, session_ids = snapshot_db
    now = utc_now()
    future_created_at = now + timedelta(minutes=5)
    await _seed_jobs(
        session_factory,
        user_id,
        [
            (
                session_ids[0],
                AnalysisJobStatus.pending,
                future_created_at,
                None,
            ),
        ],
    )
    async with session_factory() as db:
        count, age = await queue_snapshot(db, now=now)
        assert count == 1
        assert age == 0
