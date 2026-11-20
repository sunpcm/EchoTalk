"""B2 S3 causal watermark-barrier replay test.

The clean-start validator fixes its ``MAX(apply_seq)`` watermark with the first
data query inside one ``REPEATABLE READ READ ONLY`` transaction.  This case
proves the causal boundary without touching the production method: an injected
``AsyncSession`` subclass signals *after* the watermark scalar returns, waits
for an independent writer to commit a complete batch, then continues reading
the same snapshot.  The observer must not see the writer's new rows, must not
report a false missing batch, and a fresh snapshot must see the whole batch.
"""

import asyncio
import hashlib
import json
import time
import uuid
from pathlib import Path
from typing import Any

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from models.knowledge import KnowledgeState
from models.learning_event import LearningEvent
from services.learning_event_replay import validate_learning_event_replay
from tests.test_learning_event_replay import (
    FROZEN_BKT_PARAMS,
    FROZEN_BKT_VERSION,
    ReplayHarness,
    _add_state,
    _replayed_mastery,
    _require_replay_database_url,
    _write_batch,
    _write_batch_in_transaction,
)

_WRITE_KEYWORDS = {
    "insert",
    "update",
    "delete",
    "create",
    "drop",
    "alter",
    "truncate",
    "commit",
    "grant",
    "revoke",
}


def _statement_text(statement: object) -> str | None:
    text_value = getattr(statement, "text", None)
    if isinstance(text_value, str):
        return text_value
    try:
        return str(statement)
    except Exception:
        return None


def _is_watermark(statement: object) -> bool:
    text_value = _statement_text(statement)
    return (
        text_value is not None
        and "MAX(apply_seq)" in text_value
        and "learning_events" in text_value
    )


def _is_write_statement(statement: str) -> bool:
    first_word = (
        statement.strip().lower().split(maxsplit=1)[0] if statement.strip() else ""
    )
    return first_word in _WRITE_KEYWORDS


class WatermarkBarrier:
    """Shared causal events plus the observer's raw executed statements."""

    def __init__(self) -> None:
        self.watermark_returned = asyncio.Event()
        self.writer_committed = asyncio.Event()
        self.writer_aborted = asyncio.Event()
        self.observer_statements: list[str] = []
        self.commit_calls: list[float] = []
        self.rollback_calls: list[float] = []
        self.watermark_returned_time: float | None = None
        self.writer_committed_time: float | None = None
        self.after_watermark_read_time: float | None = None


class BarrierSession(AsyncSession):
    """Observer session that pauses after the watermark scalar returns."""

    barrier: WatermarkBarrier | None = None

    async def scalar(self, *args: Any, **kwargs: Any) -> Any:
        result = await super().scalar(*args, **kwargs)
        statement = args[0] if args else kwargs.get("statement")
        if self.barrier is not None and _is_watermark(statement):
            self.barrier.watermark_returned_time = time.monotonic()
            self.barrier.watermark_returned.set()
            await self.barrier.writer_committed.wait()
        return result

    async def execute(self, *args: Any, **kwargs: Any) -> Any:
        if self.barrier is not None:
            if (
                self.barrier.watermark_returned.is_set()
                and self.barrier.after_watermark_read_time is None
            ):
                self.barrier.after_watermark_read_time = time.monotonic()
            statement = args[0] if args else kwargs.get("statement")
            text_value = _statement_text(statement)
            if text_value is not None:
                self.barrier.observer_statements.append(text_value)
        return await super().execute(*args, **kwargs)

    async def commit(self) -> None:
        if self.barrier is not None:
            self.barrier.commit_calls.append(time.monotonic())
        return await super().commit()

    async def rollback(self) -> None:
        if self.barrier is not None:
            self.barrier.rollback_calls.append(time.monotonic())
        return await super().rollback()


class BarrierFactory:
    """Wraps an ``async_sessionmaker`` so every session carries the barrier."""

    def __init__(
        self,
        base_factory: async_sessionmaker[BarrierSession],
        barrier: WatermarkBarrier,
    ) -> None:
        self._base_factory = base_factory
        self._barrier = barrier

    def __call__(self) -> BarrierSession:
        session = self._base_factory()
        session.barrier = self._barrier
        return session


class Recording:
    """Collects executed SQL and transaction calls for a read-only proof."""

    def __init__(self) -> None:
        self.statements: list[str] = []
        self.commit_calls: list[float] = []
        self.rollback_calls: list[float] = []


class RecordingSession(AsyncSession):
    """Observer session that records SQL, commit and rollback calls."""

    recording: Recording | None = None

    async def execute(self, *args: Any, **kwargs: Any) -> Any:
        if self.recording is not None:
            statement = args[0] if args else kwargs.get("statement")
            text_value = _statement_text(statement)
            if text_value is not None:
                self.recording.statements.append(text_value)
        return await super().execute(*args, **kwargs)

    async def commit(self) -> None:
        if self.recording is not None:
            self.recording.commit_calls.append(time.monotonic())
        return await super().commit()

    async def rollback(self) -> None:
        if self.recording is not None:
            self.recording.rollback_calls.append(time.monotonic())
        return await super().rollback()


class RecordingFactory:
    """Wraps a sessionmaker so each session carries one shared recorder."""

    def __init__(
        self,
        base_factory: async_sessionmaker[RecordingSession],
        recording: Recording,
    ) -> None:
        self._base_factory = base_factory
        self._recording = recording

    def __call__(self) -> RecordingSession:
        session = self._base_factory()
        session.recording = self._recording
        return session


@pytest.fixture
async def pg():
    database_url = _require_replay_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    harness = ReplayHarness(factory, engine)
    identity_verified = False
    try:
        async with factory() as db, db.begin():
            identity = (
                await db.execute(
                    text(
                        "SELECT current_database(), current_user, "
                        "current_setting('server_version_num')"
                    )
                )
            ).one()
            assert identity == (
                database_url.database,
                database_url.username,
                "150019",
            )
            assert (
                await db.scalar(text("SELECT version_num FROM alembic_version"))
                == source_head
            )
            identity_verified = True
        yield harness
    finally:
        if identity_verified:
            await harness.cleanup()
        else:
            await engine.dispose()


@pytest.mark.asyncio
async def test_watermark_causal_barrier_isolates_concurrent_writer(pg):
    writer_user = await pg.new_user()
    writer_skill = f"replay_causal_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(writer_skill)

    barrier = WatermarkBarrier()
    observer_factory = BarrierFactory(
        async_sessionmaker(
            pg.engine,
            expire_on_commit=False,
            class_=BarrierSession,
        ),
        barrier,
    )

    async def run_observer():
        return await validate_learning_event_replay(
            observer_factory,
            algorithm_versions={FROZEN_BKT_VERSION: dict(FROZEN_BKT_PARAMS)},
        )

    observer_task = asyncio.create_task(run_observer())
    writer_engine = create_async_engine(pg.engine.url, pool_pre_ping=True)
    writer_factory = async_sessionmaker(writer_engine, expire_on_commit=False)
    try:
        await asyncio.wait_for(barrier.watermark_returned.wait(), timeout=10)
        try:
            async with writer_factory() as writer_db, writer_db.begin():
                await _write_batch_in_transaction(
                    writer_db,
                    user_id=writer_user,
                    skill_id=writer_skill,
                )
                writer_db.add(
                    KnowledgeState(
                        id=uuid.uuid4(),
                        user_id=writer_user,
                        skill_id=writer_skill,
                        p_mastery=_replayed_mastery(),
                    )
                )
        except BaseException:
            barrier.writer_aborted.set()
            raise
        barrier.writer_committed_time = time.monotonic()
        barrier.writer_committed.set()

        report = await asyncio.wait_for(observer_task, timeout=10)

        assert report.watermark == 0
        assert report.issues == ()
        assert report.read_only is True
        assert report.isolation_level == "repeatable read"

        for statement in barrier.observer_statements:
            assert not _is_write_statement(statement), statement

        assert barrier.commit_calls == []
        assert len(barrier.rollback_calls) >= 1
        assert barrier.watermark_returned_time is not None
        assert barrier.writer_committed_time is not None
        assert barrier.after_watermark_read_time is not None
        assert barrier.watermark_returned_time < barrier.writer_committed_time
        assert barrier.writer_committed_time <= barrier.after_watermark_read_time

        fresh = await validate_learning_event_replay(
            pg.factory,
            algorithm_versions={FROZEN_BKT_VERSION: dict(FROZEN_BKT_PARAMS)},
        )
        assert fresh.issues == ()
        assert fresh.watermark >= 2
        assert report.watermark < fresh.watermark
    finally:
        if not observer_task.done():
            observer_task.cancel()
        try:
            await observer_task
        except (asyncio.CancelledError, Exception):
            pass
        await writer_engine.dispose()


async def _user_ledger_digest(pg, user_id: uuid.UUID) -> str:
    async with pg.factory() as db:
        events = list(
            (
                await db.execute(
                    select(LearningEvent)
                    .where(LearningEvent.user_id == user_id)
                    .order_by(LearningEvent.apply_seq)
                )
            )
            .scalars()
            .all()
        )
        states = list(
            (
                await db.execute(
                    select(KnowledgeState)
                    .where(KnowledgeState.user_id == user_id)
                    .order_by(KnowledgeState.skill_id)
                )
            )
            .scalars()
            .all()
        )
    payload = {
        "events": [
            {
                "apply_seq": event.apply_seq,
                "idempotency_key": event.idempotency_key,
                "event_type": event.event_type,
                "skill_id": event.skill_id,
                "source_ordinal": event.source_ordinal,
                "observation_code": event.observation_code,
                "source": event.source,
                "provider": event.provider,
                "model_version": event.model_version,
                "is_synthetic": event.is_synthetic,
                "algorithm_version": event.algorithm_version,
                "algorithm_params": event.algorithm_params,
                "p_mastery_snapshot": event.p_mastery_snapshot,
                "occurred_at": event.occurred_at.isoformat(),
                "details": event.details,
            }
            for event in events
        ],
        "states": [
            {
                "skill_id": state.skill_id,
                "p_mastery": state.p_mastery,
            }
            for state in states
        ],
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


@pytest.mark.asyncio
async def test_read_only_validation_leaves_dataset_byte_identical(pg):
    user_id = await pg.new_user()
    skill_id = f"b2_stable_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)

    await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    before = await _user_ledger_digest(pg, user_id)

    recording = Recording()
    recording_factory = RecordingFactory(
        async_sessionmaker(
            pg.engine,
            expire_on_commit=False,
            class_=RecordingSession,
        ),
        recording,
    )
    report = await validate_learning_event_replay(
        recording_factory,
        algorithm_versions={FROZEN_BKT_VERSION: dict(FROZEN_BKT_PARAMS)},
    )

    assert report.issues == ()
    assert report.read_only is True
    assert recording.commit_calls == []
    assert len(recording.rollback_calls) >= 1
    for statement in recording.statements:
        assert not _is_write_statement(statement), statement

    after = await _user_ledger_digest(pg, user_id)
    assert after == before
