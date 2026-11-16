"""RED gate for the B1-3 learning-event cutover and persistent write gate.

The service modules are imported at runtime so the full test tree remains
collectable before B1-3 lands.  These cases use the dedicated synthetic
PostgreSQL database and exercise actual row locks and concurrent connections.

Required cutover service contract::

    prepare_cutover(*, db, revision) -> CutoverState
    stop_legacy_writes(
        *, db, revision, confirmed_legacy_writers_stopped
    ) -> CutoverState
    write_legacy_baselines(*, db, revision) -> BaselineResult
    enable_event_gate(*, db, revision) -> CutoverState
    resume_traffic(*, db, revision) -> CutoverState

The persistent singleton phase progresses only through ``prepared``,
``legacy_writes_stopped``, ``baselines_written``, ``events_enabled`` and
``traffic_resumed``.  ``stop_legacy_writes`` records the explicit maintenance
confirmation but does not itself define the data cut point.  The baseline
transaction protects the knowledge-state and Job write surface, waits for
in-flight legacy transactions, and only then fixes ``cutover_at`` with the
database clock.
"""

import asyncio
import importlib
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import delete, select, text
from sqlalchemy import event as sa_event
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.exercise import GrammarError
from models.knowledge import KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.session import Session, SessionMode, SessionStatus
from models.user import User
from services.analysis_jobs import AnalysisExecutionError

CUTOVER_MODULE = "services.learning_event_cutover"
WRITER_MODULE = "services.learning_events"


def require_b1_database_url():
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail("B1 PostgreSQL tests require explicit DATABASE_URL", pytrace=False)
    try:
        parsed = make_url(raw)
        target = (parsed.host, parsed.port, parsed.database)
        valid = (
            parsed.drivername in {"postgresql", "postgresql+asyncpg"}
            and target
            in {
                ("127.0.0.1", 55433, "echotalk_b1_test"),
                ("localhost", 5432, "echotalk_test"),
            }
            and bool(parsed.username and parsed.username.strip())
            and not parsed.query
        )
    except Exception:
        pytest.fail("B1 PostgreSQL test DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail("B1 PostgreSQL test database boundary mismatch", pytrace=False)
    return parsed.set(drivername="postgresql+asyncpg")


def _cutover_api():
    try:
        module = importlib.import_module(CUTOVER_MODULE)
    except ModuleNotFoundError as exc:
        if exc.name == CUTOVER_MODULE:
            pytest.fail(
                f"{CUTOVER_MODULE} is not implemented (B1-3 RED)", pytrace=False
            )
        raise
    required = {
        "CutoverError",
        "prepare_cutover",
        "stop_legacy_writes",
        "write_legacy_baselines",
        "enable_event_gate",
        "resume_traffic",
    }
    missing = sorted(name for name in required if not hasattr(module, name))
    if missing:
        pytest.fail(
            f"{CUTOVER_MODULE} missing B1-3 API: {', '.join(missing)}",
            pytrace=False,
        )
    return module


def _event_writer():
    try:
        module = importlib.import_module(WRITER_MODULE)
    except ModuleNotFoundError:
        pytest.fail(f"{WRITER_MODULE} is not importable", pytrace=False)
    writer = getattr(module, "write_learning_events", None)
    if writer is None:
        pytest.fail(
            f"{WRITER_MODULE}.write_learning_events is not implemented",
            pytrace=False,
        )
    return writer


class CutoverHarness:
    def __init__(self, factory, engine):
        self.factory = factory
        self.engine = engine
        self.user_ids: list[uuid.UUID] = []
        self.revisions: list[str] = []

    def track_revision(self, revision: str) -> None:
        self.revisions.append(revision)

    async def ensure_skill(self, skill_id: str) -> None:
        async with self.factory() as db, db.begin():
            if await db.get(Skill, skill_id) is None:
                db.add(
                    Skill(
                        id=skill_id,
                        name=f"B1-3 {skill_id[-12:]}",
                        category="grammar",
                    )
                )

    async def new_user(self) -> uuid.UUID:
        user_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(User(id=user_id, email=f"b1-3-{user_id}@example.invalid"))
        self.user_ids.append(user_id)
        return user_id

    async def add_knowledge_state(
        self,
        user_id: uuid.UUID,
        skill_id: str,
        p_mastery: float,
        *,
        updated_at: datetime | None = None,
    ) -> uuid.UUID:
        state_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            values = {
                "id": state_id,
                "user_id": user_id,
                "skill_id": skill_id,
                "p_mastery": p_mastery,
            }
            if updated_at is not None:
                values["updated_at"] = updated_at
            db.add(KnowledgeState(**values))
        return state_id

    async def new_session_job(
        self,
        user_id: uuid.UUID,
        *,
        status: AnalysisJobStatus = AnalysisJobStatus.running,
        ended_at: datetime | None = None,
    ) -> tuple[uuid.UUID, uuid.UUID]:
        session_id = uuid.uuid4()
        job_id = uuid.uuid4()
        current_time = datetime.now(UTC)
        async with self.factory() as db, db.begin():
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
                    ended_at=ended_at or current_time,
                )
            )
            db.add(
                AnalysisJob(
                    id=job_id,
                    session_id=session_id,
                    status=status,
                    attempt_count=0 if status is AnalysisJobStatus.pending else 1,
                    started_at=(
                        None if status is AnalysisJobStatus.pending else current_time
                    ),
                    finished_at=(
                        current_time if status is AnalysisJobStatus.succeeded else None
                    ),
                )
            )
        return session_id, job_id

    async def add_synthetic_grammar(
        self,
        session_id: uuid.UUID,
        skill_id: str,
    ) -> uuid.UUID:
        grammar_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                GrammarError(
                    id=grammar_id,
                    session_id=session_id,
                    skill_tag=skill_id,
                    original="synthetic input",
                    corrected="synthetic correction",
                    error_type="wrong_tense",
                    source="demo_rule",
                    provider=None,
                    model_version="demo-grammar-rules-v1",
                    is_synthetic=True,
                    confidence=0.5,
                )
            )
        return grammar_id

    async def cleanup(self) -> None:
        async with self.factory() as db, db.begin():
            if self.revisions:
                await db.execute(
                    delete(LearningEvent).where(
                        LearningEvent.cutover_revision.in_(self.revisions)
                    )
                )
            if self.user_ids:
                await db.execute(
                    delete(LearningEvent).where(
                        LearningEvent.user_id.in_(self.user_ids)
                    )
                )
                session_ids = select(Session.id).where(
                    Session.user_id.in_(self.user_ids)
                )
                await db.execute(
                    delete(GrammarError).where(GrammarError.session_id.in_(session_ids))
                )
                await db.execute(
                    delete(AnalysisJob).where(AnalysisJob.session_id.in_(session_ids))
                )
                await db.execute(
                    delete(KnowledgeState).where(
                        KnowledgeState.user_id.in_(self.user_ids)
                    )
                )
                await db.execute(
                    delete(Session).where(Session.user_id.in_(self.user_ids))
                )
                await db.execute(delete(User).where(User.id.in_(self.user_ids)))
            await db.execute(text("DELETE FROM learning_event_cutover"))
        await self.engine.dispose()


@pytest.fixture
async def pg():
    database_url = require_b1_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    harness = CutoverHarness(factory, engine)
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
            if (
                await db.scalar(text("SELECT to_regclass('learning_event_cutover')"))
                is None
            ):
                pytest.fail(
                    "learning_event_cutover table is absent (B1-3 RED)",
                    pytrace=False,
                )
            await db.execute(text("DELETE FROM learning_event_cutover"))
            identity_verified = True
        yield harness
    finally:
        if identity_verified:
            await harness.cleanup()
        else:
            await engine.dispose()


def _coverage() -> dict:
    return {
        "pronunciation": {
            "status": "not_called",
            "source": None,
            "provider": None,
            "model_version": None,
            "is_synthetic": None,
        },
        "grammar": {
            "status": "evaluated",
            "source": "demo_rule",
            "provider": None,
            "model_version": "demo-grammar-rules-v1",
            "is_synthetic": True,
        },
    }


async def _invoke_writer(
    pg,
    *,
    session_id: uuid.UUID,
    job_id: uuid.UUID,
    grammar_id: uuid.UUID,
    application_name: str | None = None,
):
    writer = _event_writer()
    async with pg.factory() as db, db.begin():
        if application_name is not None:
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": application_name},
            )
        job = await db.get(AnalysisJob, job_id)
        session = await db.get(Session, session_id)
        grammar = await db.get(GrammarError, grammar_id)
        assert job is not None and session is not None and grammar is not None
        await writer(
            job=job,
            session=session,
            user_id=session.user_id,
            assessment=None,
            grammar_errors=[grammar],
            coverage=_coverage(),
            db=db,
        )


async def _assert_writer_closed(pg, **kwargs) -> None:
    with pytest.raises(AnalysisExecutionError) as error:
        await _invoke_writer(pg, **kwargs)
    assert error.value.code == "learning_event_gate_closed"


async def _phase(pg) -> str:
    async with pg.factory() as db:
        return await db.scalar(
            text("SELECT phase FROM learning_event_cutover WHERE id = 1")
        )


async def _wait_for_blocking_chain(
    pg,
    task,
    *,
    application_name: str,
    blocker_pid: int,
) -> None:
    deadline = asyncio.get_running_loop().time() + 5
    while asyncio.get_running_loop().time() < deadline:
        if task.done():
            await task
            raise AssertionError("transaction did not wait for the legacy writer")
        async with pg.factory() as db:
            chains = (
                await db.execute(
                    text(
                        "SELECT pid, pg_blocking_pids(pid) "
                        "FROM pg_stat_activity "
                        "WHERE datname = current_database() "
                        "AND application_name = :application_name "
                        "AND wait_event_type = 'Lock'"
                    ),
                    {"application_name": application_name},
                )
            ).all()
            if any(
                blocker_pid in blockers
                for _, blockers in chains
                if blockers is not None
            ):
                return
        await asyncio.sleep(0.02)
    raise AssertionError(
        "timed out waiting for pg_blocking_pids to identify the legacy writer"
    )


async def _control_state(pg) -> tuple[str | None, datetime | None]:
    async with pg.factory() as db:
        row = (
            await db.execute(
                text(
                    "SELECT phase, cutover_at FROM learning_event_cutover WHERE id = 1"
                )
            )
        ).one_or_none()
    return (None, None) if row is None else (row.phase, row.cutover_at)


async def _set_job_status(
    pg,
    job_id: uuid.UUID,
    status: AnalysisJobStatus,
) -> None:
    async with pg.factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        assert job is not None
        job.status = status
        if status is AnalysisJobStatus.running:
            job.started_at = await db.scalar(text("SELECT clock_timestamp()"))
            job.finished_at = None
        elif status is AnalysisJobStatus.succeeded:
            job.finished_at = await db.scalar(text("SELECT clock_timestamp()"))


async def _open_gate(pg, api, revision: str):
    pg.track_revision(revision)
    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )
    async with pg.factory() as db, db.begin():
        await api.write_legacy_baselines(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.enable_event_gate(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        return await api.resume_traffic(db=db, revision=revision)


def _require_maintenance_cli() -> None:
    try:
        importlib.import_module("scripts.learning_events_maintenance")
    except ModuleNotFoundError as exc:
        if exc.name == "scripts.learning_events_maintenance":
            pytest.fail(
                "scripts.learning_events_maintenance is not implemented (B1-3 RED)",
                pytrace=False,
            )
        raise


def _run_maintenance_cli(
    args: list[str],
    *,
    cwd: Path | None = None,
    database_url: str | None = None,
) -> subprocess.CompletedProcess[str]:
    backend_root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env.pop("DATABASE_URL", None)
    if database_url is not None:
        env["DATABASE_URL"] = database_url
    python_path = env.get("PYTHONPATH")
    env["PYTHONPATH"] = (
        str(backend_root)
        if not python_path
        else f"{backend_root}{os.pathsep}{python_path}"
    )
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "scripts.learning_events_maintenance",
            *args,
        ],
        cwd=cwd or backend_root,
        env=env,
        text=True,
        capture_output=True,
        check=False,
        timeout=20,
    )


def _combined_output(result: subprocess.CompletedProcess[str]) -> str:
    return f"{result.stdout}\n{result.stderr}"


@pytest.mark.asyncio
async def test_empty_cutover_enforces_order_and_direct_writer_gate(pg):
    api = _cutover_api()
    revision = f"b1-3-empty-{uuid.uuid4()}"
    pg.track_revision(revision)
    skill_id = f"b1_3_empty_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    session_id, job_id = await pg.new_session_job(user_id)
    grammar_id = await pg.add_synthetic_grammar(session_id, skill_id)

    # A running Job is not a gate marker.  Without the persistent singleton
    # row, even a direct writer call must fail closed.
    assert await _control_state(pg) == (None, None)
    await _assert_writer_closed(
        pg,
        session_id=session_id,
        job_id=job_id,
        grammar_id=grammar_id,
    )

    async with pg.factory() as db, db.begin():
        prepared = await api.prepare_cutover(db=db, revision=revision)
    assert prepared.phase == "prepared"
    assert prepared.cutover_at is None

    with pytest.raises(api.CutoverError) as unconfirmed:
        async with pg.factory() as db, db.begin():
            await api.stop_legacy_writes(
                db=db,
                revision=revision,
                confirmed_legacy_writers_stopped=False,
            )
    assert unconfirmed.value.code == "legacy_writers_not_confirmed"
    assert await _phase(pg) == "prepared"

    with pytest.raises(api.CutoverError) as running_job:
        async with pg.factory() as db, db.begin():
            await api.stop_legacy_writes(
                db=db,
                revision=revision,
                confirmed_legacy_writers_stopped=True,
            )
    assert running_job.value.code == "cutover_running_jobs_exist"
    assert await _control_state(pg) == ("prepared", None)

    await _set_job_status(pg, job_id, AnalysisJobStatus.succeeded)
    async with pg.factory() as db, db.begin():
        stopped = await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )
    assert stopped.phase == "legacy_writes_stopped"
    assert stopped.cutover_at is None
    assert await _control_state(pg) == ("legacy_writes_stopped", None)

    with pytest.raises(api.CutoverError) as skipped_baseline:
        async with pg.factory() as db, db.begin():
            await api.enable_event_gate(db=db, revision=revision)
    assert skipped_baseline.value.code == "cutover_phase_order"

    async with pg.factory() as db, db.begin():
        baseline = await api.write_legacy_baselines(db=db, revision=revision)
    assert baseline.count == 0
    assert baseline.digest is not None
    assert baseline.cutover_at is not None
    assert await _control_state(pg) == ("baselines_written", baseline.cutover_at)

    writer_session, writer_job = await pg.new_session_job(
        user_id,
        status=AnalysisJobStatus.pending,
    )
    writer_grammar = await pg.add_synthetic_grammar(writer_session, skill_id)

    await _assert_writer_closed(
        pg,
        session_id=writer_session,
        job_id=writer_job,
        grammar_id=writer_grammar,
    )

    async with pg.factory() as db, db.begin():
        gated = await api.enable_event_gate(db=db, revision=revision)
    assert gated.phase == "events_enabled"

    await _assert_writer_closed(
        pg,
        session_id=writer_session,
        job_id=writer_job,
        grammar_id=writer_grammar,
    )

    async with pg.factory() as db, db.begin():
        resumed = await api.resume_traffic(db=db, revision=revision)
    assert resumed.phase == "traffic_resumed"
    await _set_job_status(pg, writer_job, AnalysisJobStatus.running)

    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(pg.engine.sync_engine, "before_cursor_execute", capture)
    try:
        await _invoke_writer(
            pg,
            session_id=writer_session,
            job_id=writer_job,
            grammar_id=writer_grammar,
        )
    finally:
        sa_event.remove(pg.engine.sync_engine, "before_cursor_execute", capture)

    async with pg.factory() as db:
        events = (
            (
                await db.execute(
                    select(LearningEvent)
                    .where(LearningEvent.analysis_job_id == writer_job)
                    .order_by(LearningEvent.apply_seq)
                )
            )
            .scalars()
            .all()
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
    assert [event.event_type for event in events] == [
        "analysis_completed",
        "grammar_observation",
    ]
    assert states == []
    assert not any("FROM knowledge_states" in stmt for stmt in statements)


@pytest.mark.asyncio
async def test_cutover_is_idempotent_and_never_reanchors_or_crosses_revision(pg):
    api = _cutover_api()
    revision = f"b1-3-idempotent-{uuid.uuid4()}"
    pg.track_revision(revision)
    skill_id = f"b1_3_state_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    await pg.add_knowledge_state(user_id, skill_id, 0.42)

    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)

    async with pg.factory() as db, db.begin():
        stopped = await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )
    async with pg.factory() as db, db.begin():
        first = await api.write_legacy_baselines(db=db, revision=revision)

    assert stopped.cutover_at is None
    assert first.count == 1
    assert len(first.digest) == 64
    assert first.cutover_at is not None

    async with pg.factory() as db:
        baseline = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key
                    == f"baseline:{revision}:{user_id}:{skill_id}"
                )
            )
        ).scalar_one()
    assert baseline.event_type == "baseline_snapshot"
    assert baseline.source == "legacy_unknown"
    assert baseline.p_mastery_snapshot == pytest.approx(0.42)
    assert baseline.occurred_at == first.cutover_at
    assert baseline.details == {
        "schema_version": 1,
        "legacy_synthetic_impact": "unknown",
    }

    async with pg.factory() as db, db.begin():
        state = (
            await db.execute(
                select(KnowledgeState).where(
                    KnowledgeState.user_id == user_id,
                    KnowledgeState.skill_id == skill_id,
                )
            )
        ).scalar_one()
        state.p_mastery = 0.77

    async with pg.factory() as db, db.begin():
        repeated = await api.write_legacy_baselines(db=db, revision=revision)
    assert (repeated.count, repeated.digest) == (first.count, first.digest)
    assert repeated.cutover_at == first.cutover_at

    async with pg.factory() as db:
        baseline_events = (
            (
                await db.execute(
                    select(LearningEvent).where(
                        LearningEvent.user_id == user_id,
                        LearningEvent.event_type == "baseline_snapshot",
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(baseline_events) == 1
    assert baseline_events[0].p_mastery_snapshot == pytest.approx(0.42)

    with pytest.raises(api.CutoverError) as revision_conflict:
        async with pg.factory() as db, db.begin():
            await api.prepare_cutover(
                db=db,
                revision=f"{revision}-other",
            )
    assert revision_conflict.value.code == "cutover_revision_conflict"

    with pytest.raises(api.CutoverError) as drift:
        async with pg.factory() as db, db.begin():
            await api.enable_event_gate(db=db, revision=revision)
    assert drift.value.code == "baseline_state_changed"
    assert await _phase(pg) == "baselines_written"


@pytest.mark.asyncio
async def test_baseline_waits_for_inflight_legacy_write_and_post_gate_writers_serialize(
    pg,
):
    api = _cutover_api()
    revision = f"b1-3-concurrent-{uuid.uuid4()}"
    pg.track_revision(revision)
    skill_id = f"b1_3_concurrent_{uuid.uuid4().hex}"[:50]
    phantom_skill_id = f"b1_3_phantom_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await pg.ensure_skill(phantom_skill_id)
    user_id = await pg.new_user()
    await pg.add_knowledge_state(user_id, skill_id, 0.2)
    _, legacy_job_id = await pg.new_session_job(
        user_id,
        status=AnalysisJobStatus.succeeded,
    )

    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )

    application_name = f"b1-3-baseline-{uuid.uuid4()}"

    async def run_baseline():
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": application_name},
            )
            return await api.write_legacy_baselines(db=db, revision=revision)

    baseline_task = None
    async with pg.factory() as legacy_db, legacy_db.begin():
        legacy_pid = await legacy_db.scalar(text("SELECT pg_backend_pid()"))
        legacy_job = (
            await legacy_db.execute(
                select(AnalysisJob)
                .where(AnalysisJob.id == legacy_job_id)
                .with_for_update()
            )
        ).scalar_one()
        legacy_job.last_error_code = "legacy_inflight"
        legacy_state = (
            await legacy_db.execute(
                select(KnowledgeState)
                .where(
                    KnowledgeState.user_id == user_id,
                    KnowledgeState.skill_id == skill_id,
                )
                .with_for_update()
            )
        ).scalar_one()
        legacy_state.p_mastery = 0.6
        legacy_db.add(
            KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id=phantom_skill_id,
                p_mastery=0.35,
            )
        )
        await legacy_db.flush()
        legacy_clock = await legacy_db.scalar(text("SELECT clock_timestamp()"))

        baseline_task = asyncio.create_task(run_baseline())
        await _wait_for_blocking_chain(
            pg,
            baseline_task,
            application_name=application_name,
            blocker_pid=legacy_pid,
        )
        assert not baseline_task.done()

    baseline = await baseline_task
    assert baseline.count == 2
    assert baseline.cutover_at >= legacy_clock
    async with pg.factory() as db:
        snapshots = dict(
            (
                await db.execute(
                    select(
                        LearningEvent.skill_id,
                        LearningEvent.p_mastery_snapshot,
                    ).where(
                        LearningEvent.user_id == user_id,
                        LearningEvent.cutover_revision == revision,
                        LearningEvent.event_type == "baseline_snapshot",
                    )
                )
            ).all()
        )
    assert snapshots[skill_id] == pytest.approx(0.6)
    assert snapshots[phantom_skill_id] == pytest.approx(0.35)

    async with pg.factory() as db, db.begin():
        await api.enable_event_gate(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.resume_traffic(db=db, revision=revision)

    first_session, first_job = await pg.new_session_job(user_id)
    second_session, second_job = await pg.new_session_job(user_id)
    first_grammar = await pg.add_synthetic_grammar(first_session, skill_id)
    second_grammar = await pg.add_synthetic_grammar(second_session, skill_id)

    await asyncio.gather(
        _invoke_writer(
            pg,
            session_id=first_session,
            job_id=first_job,
            grammar_id=first_grammar,
        ),
        _invoke_writer(
            pg,
            session_id=second_session,
            job_id=second_job,
            grammar_id=second_grammar,
        ),
    )

    async with pg.factory() as db:
        events = (
            (
                await db.execute(
                    select(LearningEvent)
                    .where(
                        LearningEvent.user_id == user_id,
                        LearningEvent.analysis_job_id.in_([first_job, second_job]),
                    )
                    .order_by(LearningEvent.apply_seq)
                )
            )
            .scalars()
            .all()
        )
    by_job: dict[uuid.UUID, list[int]] = {}
    for event in events:
        by_job.setdefault(event.analysis_job_id, []).append(event.apply_seq)
    assert set(by_job) == {first_job, second_job}
    assert all(len(sequences) == 2 for sequences in by_job.values())
    first_sequences = by_job[first_job]
    second_sequences = by_job[second_job]
    assert max(first_sequences) < min(second_sequences) or max(second_sequences) < min(
        first_sequences
    )


@pytest.mark.asyncio
async def test_baseline_waits_for_inflight_job_write_without_user_lock(pg):
    api = _cutover_api()
    revision = f"b1-3-job-drain-{uuid.uuid4()}"
    pg.track_revision(revision)
    user_id = await pg.new_user()
    _, job_id = await pg.new_session_job(
        user_id,
        status=AnalysisJobStatus.succeeded,
    )

    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )

    application_name = f"b1-3-job-baseline-{uuid.uuid4()}"

    async def run_baseline():
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": application_name},
            )
            return await api.write_legacy_baselines(db=db, revision=revision)

    async with pg.factory() as legacy_db, legacy_db.begin():
        legacy_pid = await legacy_db.scalar(text("SELECT pg_backend_pid()"))
        legacy_job = (
            await legacy_db.execute(
                select(AnalysisJob).where(AnalysisJob.id == job_id).with_for_update()
            )
        ).scalar_one()
        legacy_job.last_error_code = "legacy_job_inflight"
        await legacy_db.flush()
        legacy_clock = await legacy_db.scalar(text("SELECT clock_timestamp()"))

        baseline_task = asyncio.create_task(run_baseline())
        await _wait_for_blocking_chain(
            pg,
            baseline_task,
            application_name=application_name,
            blocker_pid=legacy_pid,
        )
        assert not baseline_task.done()

    baseline = await baseline_task
    assert baseline.count == 0
    assert baseline.cutover_at >= legacy_clock


def test_maintenance_cli_requires_explicit_database_url_without_dotenv(tmp_path):
    _require_maintenance_cli()
    (tmp_path / ".env").write_text(
        "DATABASE_URL=sqlite:///dotenv-canary.db\n",
        encoding="utf-8",
    )

    result = _run_maintenance_cli(
        [
            "baseline",
            "--revision",
            f"b1-3-missing-env-{uuid.uuid4()}",
            "--confirm-write",
        ],
        cwd=tmp_path,
    )
    output = _combined_output(result)
    assert result.returncode != 0
    assert "必须显式设置环境变量 DATABASE_URL" in output
    assert "dotenv-canary" not in output


@pytest.mark.asyncio
async def test_maintenance_cli_baseline_is_dry_run_until_confirmed(pg, tmp_path):
    _require_maintenance_cli()
    api = _cutover_api()
    revision = f"b1-3-cli-baseline-{uuid.uuid4()}"
    pg.track_revision(revision)
    skill_id = f"b1_3_cli_baseline_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    await pg.add_knowledge_state(user_id, skill_id, 0.44)

    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )

    dry_run = _run_maintenance_cli(
        ["baseline", "--revision", revision],
        cwd=tmp_path,
        database_url=os.environ["DATABASE_URL"],
    )
    assert dry_run.returncode == 0, _combined_output(dry_run)
    dry_payload = json.loads(dry_run.stdout)
    assert dry_payload["command"] == "baseline"
    assert dry_payload["dry_run"] is True
    assert dry_payload["count"] == 1
    async with pg.factory() as db:
        assert (
            await db.scalar(
                select(text("count(*)"))
                .select_from(LearningEvent)
                .where(LearningEvent.cutover_revision == revision)
            )
            == 0
        )
    assert await _control_state(pg) == ("legacy_writes_stopped", None)

    applied = _run_maintenance_cli(
        ["baseline", "--revision", revision, "--confirm-write"],
        cwd=tmp_path,
        database_url=os.environ["DATABASE_URL"],
    )
    assert applied.returncode == 0, _combined_output(applied)
    applied_payload = json.loads(applied.stdout)
    assert applied_payload["command"] == "baseline"
    assert applied_payload["dry_run"] is False
    assert applied_payload["count"] == 1
    async with pg.factory() as db:
        baseline = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key
                    == f"baseline:{revision}:{user_id}:{skill_id}"
                )
            )
        ).scalar_one()
    phase, cutover_at = await _control_state(pg)
    assert phase == "baselines_written"
    assert cutover_at == baseline.occurred_at


@pytest.mark.asyncio
async def test_maintenance_cli_validate_failure_is_nonzero_and_read_only(
    pg,
    tmp_path,
):
    _require_maintenance_cli()
    api = _cutover_api()
    revision = f"b1-3-cli-validate-{uuid.uuid4()}"
    pg.track_revision(revision)
    skill_id = f"b1_3_cli_validate_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    await pg.add_knowledge_state(user_id, skill_id, 0.51)

    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )
    async with pg.factory() as db, db.begin():
        await api.write_legacy_baselines(db=db, revision=revision)

    async with pg.factory() as db, db.begin():
        await db.execute(
            delete(LearningEvent).where(
                LearningEvent.idempotency_key
                == f"baseline:{revision}:{user_id}:{skill_id}"
            )
        )
    async with pg.factory() as db:
        before_events = await db.scalar(text("SELECT count(*) FROM learning_events"))
        before_state = await db.scalar(
            select(KnowledgeState.p_mastery).where(
                KnowledgeState.user_id == user_id,
                KnowledgeState.skill_id == skill_id,
            )
        )

    result = _run_maintenance_cli(
        ["validate"],
        cwd=tmp_path,
        database_url=os.environ["DATABASE_URL"],
    )
    output = _combined_output(result)
    assert result.returncode != 0
    payload = json.loads(result.stdout)
    assert payload["command"] == "validate"
    assert payload["ok"] is False
    issue_codes = {
        issue["code"] if isinstance(issue, dict) else str(issue)
        for issue in payload["issues"]
    }
    assert "missing_baseline" in issue_codes
    assert not re.search(r"postgres(?:ql)?(?:\+[A-Za-z0-9_]+)?://", output)
    assert "synthetic input" not in output

    async with pg.factory() as db:
        assert await db.scalar(text("SELECT count(*) FROM learning_events")) == (
            before_events
        )
        assert await db.scalar(
            select(KnowledgeState.p_mastery).where(
                KnowledgeState.user_id == user_id,
                KnowledgeState.skill_id == skill_id,
            )
        ) == pytest.approx(before_state)


@pytest.mark.asyncio
async def test_maintenance_cli_failed_write_rolls_back_and_redacts(pg, tmp_path):
    _require_maintenance_cli()
    api = _cutover_api()
    revision = f"b1-3-cli-atomic-{uuid.uuid4()}"
    pg.track_revision(revision)
    first_skill = f"b1_3_atomic_a_{uuid.uuid4().hex}"[:50]
    conflict_skill = f"b1_3_atomic_z_{uuid.uuid4().hex}"[:50]
    for skill_id in (first_skill, conflict_skill):
        await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    await pg.add_knowledge_state(user_id, first_skill, 0.31)
    await pg.add_knowledge_state(user_id, conflict_skill, 0.62)

    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )

    conflict_key = f"baseline:{revision}:{user_id}:{conflict_skill}"
    canary = "b1-3-conflict-provider-raw"
    async with pg.factory() as db, db.begin():
        db.add(
            LearningEvent(
                idempotency_key=conflict_key,
                event_type="baseline_snapshot",
                user_id=user_id,
                skill_id=conflict_skill,
                source="legacy_unknown",
                p_mastery_snapshot=0.99,
                cutover_revision=revision,
                occurred_at=await db.scalar(text("SELECT clock_timestamp()")),
                details={
                    "schema_version": 1,
                    "legacy_synthetic_impact": "unknown",
                    "conflict_canary": canary,
                },
            )
        )

    result = _run_maintenance_cli(
        ["baseline", "--revision", revision, "--confirm-write"],
        cwd=tmp_path,
        database_url=os.environ["DATABASE_URL"],
    )
    output = _combined_output(result)
    assert result.returncode != 0
    assert canary not in output
    assert not re.search(r"postgres(?:ql)?(?:\+[A-Za-z0-9_]+)?://", output)

    async with pg.factory() as db:
        baseline_events = (
            (
                await db.execute(
                    select(LearningEvent).where(
                        LearningEvent.cutover_revision == revision
                    )
                )
            )
            .scalars()
            .all()
        )
    assert [(event.skill_id, event.idempotency_key) for event in baseline_events] == [
        (conflict_skill, conflict_key)
    ]
    assert await _control_state(pg) == ("legacy_writes_stopped", None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "phase",
    ["baselines_written", "events_enabled", "traffic_resumed"],
)
async def test_late_phase_schema_rejects_null_baseline_digest(pg, phase):
    api = _cutover_api()
    await _open_gate(pg, api, f"b1-3-schema-null-{uuid.uuid4()}")

    with pytest.raises(IntegrityError):
        async with pg.factory() as db, db.begin():
            await db.execute(
                text(
                    "UPDATE learning_event_cutover "
                    "SET phase = :phase, baseline_digest = NULL "
                    "WHERE id = 1"
                ),
                {"phase": phase},
            )


@pytest.mark.asyncio
async def test_runtime_gate_rejects_structurally_incomplete_control_row(pg):
    api = _cutover_api()
    revision = f"b1-3-runtime-shape-{uuid.uuid4()}"
    await _open_gate(pg, api, revision)
    async with pg.factory() as db:
        digest = await db.scalar(
            text("SELECT baseline_digest FROM learning_event_cutover WHERE id = 1")
        )

    async with pg.factory() as db, db.begin():
        await db.execute(
            text(
                "ALTER TABLE learning_event_cutover "
                "DROP CONSTRAINT ck_learning_event_cutover_phase_shape"
            )
        )
        await db.execute(
            text(
                "UPDATE learning_event_cutover SET baseline_digest = NULL WHERE id = 1"
            )
        )

    try:
        async with pg.factory() as db:
            with pytest.raises(api.CutoverError) as error:
                await api.assert_learning_event_gate(db)
        assert error.value.code == "cutover_control_incomplete"
    finally:
        async with pg.factory() as db, db.begin():
            await db.execute(
                text(
                    "UPDATE learning_event_cutover "
                    "SET baseline_digest = :digest WHERE id = 1"
                ),
                {"digest": digest},
            )
            await db.execute(
                text(
                    "ALTER TABLE learning_event_cutover ADD CONSTRAINT "
                    "ck_learning_event_cutover_phase_shape CHECK ("
                    "(phase IN ('prepared','legacy_writes_stopped') "
                    "AND cutover_at IS NULL AND baseline_count = 0 "
                    "AND baseline_digest IS NULL) OR "
                    "(phase IN ('baselines_written','events_enabled',"
                    "'traffic_resumed') AND cutover_at IS NOT NULL "
                    "AND baseline_digest IS NOT NULL "
                    "AND baseline_digest ~ '^[0-9a-f]{64}$'))"
                )
            )


@pytest.mark.asyncio
async def test_first_cutover_rejects_preexisting_succeeded_job_events(pg):
    api = _cutover_api()
    revision = f"b1-3-p1-succeeded-{uuid.uuid4()}"
    skill_id = f"b1_3_succeeded_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    session_id, job_id = await pg.new_session_job(
        user_id,
        status=AnalysisJobStatus.succeeded,
    )
    grammar_id = await pg.add_synthetic_grammar(session_id, skill_id)
    async with pg.factory() as db:
        occurred_at = await db.scalar(
            select(Session.ended_at).where(Session.id == session_id)
        )
    async with pg.factory() as db, db.begin():
        db.add(
            LearningEvent(
                idempotency_key=f"job:{job_id}:completed",
                event_type="analysis_completed",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                source="analysis",
                algorithm_version="bkt-v1",
                algorithm_params={
                    "p_init": 0.1,
                    "p_transit": 0.2,
                    "p_slip": 0.1,
                    "p_guess": 0.2,
                },
                occurred_at=occurred_at,
                details={
                    "schema_version": 1,
                    "coverage": _coverage(),
                    "unmapped": {"pronunciation": 0, "grammar": 0},
                    "algorithm_version": "bkt-v1",
                },
            )
        )
        db.add(
            LearningEvent(
                idempotency_key=f"job:{job_id}:grammar:0",
                event_type="grammar_observation",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                grammar_error_id=grammar_id,
                skill_id=skill_id,
                source_ordinal=0,
                observation_correct=False,
                observation_code="wrong_tense",
                source="demo_rule",
                provider=None,
                model_version="demo-grammar-rules-v1",
                confidence=0.5,
                is_synthetic=True,
                occurred_at=occurred_at,
                details={"schema_version": 1},
            )
        )

    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    with pytest.raises(api.CutoverError) as error:
        async with pg.factory() as db, db.begin():
            await api.stop_legacy_writes(
                db=db,
                revision=revision,
                confirmed_legacy_writers_stopped=True,
            )
    assert error.value.code == "cutover_existing_events"


@pytest.mark.asyncio
async def test_first_cutover_rejects_foreign_revision_baseline(pg):
    api = _cutover_api()
    revision = f"b1-3-p1-anchor-{uuid.uuid4()}"
    foreign_revision = f"b1-3-p1-foreign-{uuid.uuid4()}"
    skill_id = f"b1_3_foreign_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    async with pg.factory() as db, db.begin():
        db.add(
            LearningEvent(
                idempotency_key=(f"baseline:{foreign_revision}:{user_id}:{skill_id}"),
                event_type="baseline_snapshot",
                user_id=user_id,
                skill_id=skill_id,
                source="legacy_unknown",
                p_mastery_snapshot=0.42,
                cutover_revision=foreign_revision,
                occurred_at=await db.scalar(text("SELECT clock_timestamp()")),
                details={
                    "schema_version": 1,
                    "legacy_synthetic_impact": "unknown",
                },
            )
        )

    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    with pytest.raises(api.CutoverError) as error:
        async with pg.factory() as db, db.begin():
            await api.stop_legacy_writes(
                db=db,
                revision=revision,
                confirmed_legacy_writers_stopped=True,
            )
    assert error.value.code == "cutover_existing_events"


@pytest.mark.asyncio
async def test_resume_rejects_knowledge_state_drift_after_enable(pg):
    api = _cutover_api()
    revision = f"b1-3-p1-resume-{uuid.uuid4()}"
    skill_id = f"b1_3_resume_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    await pg.add_knowledge_state(user_id, skill_id, 0.37)
    pg.track_revision(revision)
    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )
    async with pg.factory() as db, db.begin():
        await api.write_legacy_baselines(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.enable_event_gate(db=db, revision=revision)

    async with pg.factory() as db, db.begin():
        state = (
            await db.execute(
                select(KnowledgeState).where(
                    KnowledgeState.user_id == user_id,
                    KnowledgeState.skill_id == skill_id,
                )
            )
        ).scalar_one()
        state.p_mastery = 0.91

    with pytest.raises(api.CutoverError) as error:
        async with pg.factory() as db, db.begin():
            await api.resume_traffic(db=db, revision=revision)
    assert error.value.code == "baseline_state_changed"


@pytest.mark.asyncio
async def test_repeated_baseline_rejects_modified_original_payload(pg):
    api = _cutover_api()
    revision = f"b1-3-p1-repeat-{uuid.uuid4()}"
    skill_id = f"b1_3_repeat_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    user_id = await pg.new_user()
    await pg.add_knowledge_state(user_id, skill_id, 0.44)
    pg.track_revision(revision)
    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )
    async with pg.factory() as db, db.begin():
        await api.write_legacy_baselines(db=db, revision=revision)

    async with pg.factory() as db, db.begin():
        baseline = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.cutover_revision == revision,
                    LearningEvent.event_type == "baseline_snapshot",
                )
            )
        ).scalar_one()
        baseline.p_mastery_snapshot = 0.88

    with pytest.raises(api.CutoverError) as error:
        async with pg.factory() as db, db.begin():
            await api.write_legacy_baselines(db=db, revision=revision)
    assert error.value.code == "baseline_state_changed"
