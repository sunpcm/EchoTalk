"""Worker lifecycle behavior; real PostgreSQL cases require the new test DB."""

import asyncio
import copy
import os
import re
import selectors
import signal
import subprocess
import sys
import textwrap
import uuid
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import make_url
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
from services import analysis_jobs, analysis_service
from time_utils import utc_now
from workers import analysis_worker as worker


def assert_no_worker_tasks():
    remaining = [
        task.get_name()
        for task in asyncio.all_tasks()
        if task.get_name().startswith("analysis-worker-") and not task.done()
    ]
    assert remaining == []


class MemoryQueue:
    """Transactional test queue, with explicit barriers instead of timing sleeps."""

    def __init__(self):
        self.jobs = {}
        self.products = []
        self.connections = 0
        self.claimed = asyncio.Event()
        self.processing = asyncio.Event()
        self.release = asyncio.Event()
        self.recover_hook = None
        self.claim_hook = None
        self.commit_hook = None

    @asynccontextmanager
    async def session(self):
        queue = self

        class Transaction:
            @asynccontextmanager
            async def begin(self):
                snapshot = copy.deepcopy((queue.jobs, queue.products))
                try:
                    yield
                    if queue.commit_hook is not None:
                        await queue.commit_hook()
                except BaseException:
                    queue.jobs, queue.products = snapshot
                    raise

        self.connections += 1
        try:
            yield Transaction()
        finally:
            self.connections -= 1


@pytest.fixture
def memory_queue(monkeypatch):
    queue = MemoryQueue()

    async def recover(_db):
        if queue.recover_hook is not None:
            await queue.recover_hook()
        return 0

    async def claim(_db):
        job_id = next(
            (key for key, value in queue.jobs.items() if value == "pending"), None
        )
        if job_id is not None:
            queue.jobs[job_id] = "running"
        queue.claimed.set()
        if queue.claim_hook is not None:
            await queue.claim_hook()
        return job_id

    async def process(job_id, factory):
        async with factory() as db, db.begin():
            queue.products.append(job_id)
            queue.processing.set()
            await queue.release.wait()
            queue.jobs[job_id] = "succeeded"

    monkeypatch.setattr(worker, "recover_stale_jobs", recover)
    monkeypatch.setattr(worker, "claim_next_job", claim)
    monkeypatch.setattr(worker, "process_job", process)
    return queue


@pytest.mark.asyncio
async def test_stop_before_start_does_not_open_a_session(memory_queue):
    stop = asyncio.Event()
    stop.set()
    memory_queue.jobs["first"] = "pending"
    await worker.run_forever(stop, session_factory=memory_queue.session)
    assert memory_queue.jobs == {"first": "pending"}
    assert not memory_queue.claimed.is_set()
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_idle_stop_does_not_wait_for_the_poll_interval(memory_queue):
    stop = asyncio.Event()
    task = asyncio.create_task(
        worker.run_forever(stop, session_factory=memory_queue.session, poll_seconds=60)
    )
    await asyncio.wait_for(memory_queue.claimed.wait(), 1)
    stop.set()
    await asyncio.wait_for(task, 1)
    assert memory_queue.jobs == {}
    assert memory_queue.products == []
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_stop_during_recovery_rolls_back_and_never_claims(memory_queue):
    stop = asyncio.Event()
    reached = asyncio.Event()

    async def recover():
        memory_queue.jobs["stale"] = "pending"
        reached.set()
        await asyncio.Event().wait()

    memory_queue.jobs["stale"] = "running"
    memory_queue.recover_hook = recover
    task = asyncio.create_task(
        worker.run_forever(stop, session_factory=memory_queue.session)
    )
    await asyncio.wait_for(reached.wait(), 1)
    stop.set()
    await asyncio.wait_for(task, 1)
    assert memory_queue.jobs == {"stale": "running"}
    assert not memory_queue.claimed.is_set()
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_stop_set_inside_recovery_never_starts_a_claim(memory_queue):
    stop = asyncio.Event()

    async def recover():
        memory_queue.jobs["stale"] = "pending"
        stop.set()

    memory_queue.jobs["stale"] = "running"
    memory_queue.recover_hook = recover
    await worker.run_forever(stop, session_factory=memory_queue.session)
    assert memory_queue.jobs == {"stale": "running"}
    assert not memory_queue.claimed.is_set()
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_signal_crossing_claim_rolls_back_without_processing(memory_queue):
    stop = asyncio.Event()

    async def after_claim():
        stop.set()

    memory_queue.jobs["first"] = "pending"
    memory_queue.claim_hook = after_claim
    await worker.run_forever(stop, session_factory=memory_queue.session)
    assert memory_queue.jobs == {"first": "pending"}
    assert memory_queue.products == []
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_stop_during_commit_cancels_uncommitted_claim(memory_queue):
    stop = asyncio.Event()
    committing = asyncio.Event()

    async def commit():
        committing.set()
        await asyncio.Event().wait()

    memory_queue.jobs["first"] = "pending"
    memory_queue.commit_hook = commit
    task = asyncio.create_task(
        worker.run_forever(stop, session_factory=memory_queue.session)
    )
    await asyncio.wait_for(committing.wait(), 1)
    stop.set()
    await asyncio.wait_for(task, 1)
    assert memory_queue.jobs == {"first": "pending"}
    assert not memory_queue.processing.is_set()
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_active_job_finishes_but_next_job_stays_pending(memory_queue):
    stop = asyncio.Event()
    memory_queue.jobs.update(first="pending", second="pending")
    task = asyncio.create_task(
        worker.run_forever(stop, session_factory=memory_queue.session)
    )
    await asyncio.wait_for(memory_queue.processing.wait(), 1)
    stop.set()
    stop.set()
    memory_queue.release.set()
    await asyncio.wait_for(task, 1)
    assert memory_queue.jobs == {"first": "succeeded", "second": "pending"}
    assert memory_queue.products == ["first"]
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_active_job_timeout_rolls_back_without_success_or_retry(memory_queue):
    stop = asyncio.Event()
    memory_queue.jobs.update(first="pending", second="pending")
    task = asyncio.create_task(
        worker.run_forever(
            stop, session_factory=memory_queue.session, shutdown_grace_seconds=0.01
        )
    )
    await asyncio.wait_for(memory_queue.processing.wait(), 1)
    stop.set()
    await asyncio.wait_for(task, 1)
    assert memory_queue.jobs == {"first": "running", "second": "pending"}
    assert memory_queue.products == []
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_external_cancellation_propagates_and_releases_transaction(memory_queue):
    stop = asyncio.Event()
    memory_queue.jobs["first"] = "pending"
    task = asyncio.create_task(
        worker.run_forever(stop, session_factory=memory_queue.session)
    )
    await asyncio.wait_for(memory_queue.processing.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert memory_queue.jobs == {"first": "running"}
    assert memory_queue.products == []
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_recovery_exception_is_not_a_successful_shutdown(memory_queue):
    async def fail():
        raise RuntimeError("fixture recovery failure")

    memory_queue.recover_hook = fail
    with pytest.raises(RuntimeError, match="fixture recovery failure"):
        await worker.run_forever(session_factory=memory_queue.session)
    assert memory_queue.connections == 0
    assert_no_worker_tasks()


@pytest.mark.asyncio
async def test_unrequested_job_cancellation_is_not_swallowed(memory_queue, monkeypatch):
    async def cancelled(_job, _factory):
        raise asyncio.CancelledError

    memory_queue.jobs["first"] = "pending"
    monkeypatch.setattr(worker, "process_job", cancelled)
    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(session_factory=memory_queue.session)
    assert memory_queue.jobs == {"first": "running"}
    assert memory_queue.products == []
    assert_no_worker_tasks()


@pytest.mark.asyncio
@pytest.mark.parametrize("poll", [0, -1, float("inf"), float("nan")])
async def test_invalid_budget_is_rejected_without_opening_db(memory_queue, poll):
    with pytest.raises(ValueError, match="budgets must be positive"):
        await worker.run_forever(
            session_factory=memory_queue.session, poll_seconds=poll
        )
    assert memory_queue.connections == 0
    assert not memory_queue.claimed.is_set()
    assert_no_worker_tasks()


CHILD_BOOTSTRAP = """
import asyncio, os, signal
from pydantic_settings import BaseSettings
original_init = BaseSettings.__init__
def no_file_settings(self, *args, **kwargs):
    kwargs['_env_file'] = None
    kwargs['_secrets_dir'] = None
    original_init(self, *args, **kwargs)
BaseSettings.__init__ = no_file_settings
"""


def child_environment():
    result = {
        key: os.environ[key]
        for key in ("PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG")
        if key in os.environ
    }
    result.update(
        PYTHONDONTWRITEBYTECODE="1",
        DATABASE_URL="postgresql+asyncpg://127.0.0.1:1/worker_no_connection",
    )
    return result


def start_child(code):
    return subprocess.Popen(
        [sys.executable, "-B", "-c", CHILD_BOOTSTRAP + textwrap.dedent(code)],
        cwd=Path(__file__).resolve().parents[1],
        env=child_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def finish_child(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.communicate(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=1)


def test_import_does_not_install_signals_or_create_tasks():
    process = start_child(
        """
        async def check():
            before = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
            tasks = set(asyncio.all_tasks())
            from workers import analysis_worker
            assert set(asyncio.all_tasks()) == tasks
            assert all(signal.getsignal(s) is h for s, h in before.items())
            print('IMPORT_OK', flush=True)
        asyncio.run(check())
        """
    )
    try:
        output, errors = process.communicate(timeout=10)
        assert process.returncode == 0, errors
        assert output.strip() == "IMPORT_OK"
    finally:
        finish_child(process)


@pytest.mark.parametrize("stop_signal", [signal.SIGTERM, signal.SIGINT])
@pytest.mark.parametrize("fallback", [False, True])
def test_real_posix_signals_exit_zero_dispose_and_restore(stop_signal, fallback):
    assert os.name == "posix", "this regression requires a POSIX runner"
    process = start_child(
        f"""
        from contextlib import asynccontextmanager
        from workers import analysis_worker as worker
        before = {{s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}}
        @asynccontextmanager
        async def session():
            class DB:
                @asynccontextmanager
                async def begin(self):
                    yield
            yield DB()
        async def recover(db):
            return 0
        async def claim(db):
            print('READY', flush=True)
            return None
        class Engine:
            async def dispose(self):
                os.kill(os.getpid(), signal.SIGTERM)
                os.kill(os.getpid(), signal.SIGINT)
                wake = asyncio.get_running_loop().create_future()
                asyncio.get_running_loop().call_soon(wake.set_result, None)
                await wake
                print('DISPOSED', flush=True)
        worker.async_session_maker = session
        worker.recover_stale_jobs = recover
        worker.claim_next_job = claim
        worker.settings.ANALYSIS_WORKER_POLL_SECONDS = 60
        worker.engine = Engine()
        async def run():
            if {fallback!r}:
                def unsupported(*args):
                    raise NotImplementedError
                asyncio.get_running_loop().add_signal_handler = unsupported
            await worker._run_cli()
            assert not [t for t in asyncio.all_tasks()
                        if t.get_name().startswith('analysis-worker-') and not t.done()]
        asyncio.run(run())
        assert all(signal.getsignal(s) is h for s, h in before.items())
        print('RESTORED', flush=True)
        """
    )
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            assert ready.select(timeout=10), "child did not reach real worker loop"
            assert process.stdout.readline().strip() == "READY"
        process.send_signal(stop_signal)
        output, errors = process.communicate(timeout=4.8)
        assert process.returncode == 0, errors
        assert output.splitlines() == ["DISPOSED", "RESTORED"]
    finally:
        finish_child(process)


def test_cli_unexpected_error_exits_nonzero_and_still_disposes():
    process = start_child(
        """
        from workers import analysis_worker as worker
        async def fail(*args, **kwargs):
            raise RuntimeError('private-error-body-not-for-logs')
        class Engine:
            async def dispose(self):
                print('DISPOSED', flush=True)
        worker.run_forever = fail
        worker.engine = Engine()
        worker.main()
        """
    )
    try:
        output, errors = process.communicate(timeout=5)
        assert process.returncode == 1
        assert output.strip() == "DISPOSED"
        assert "RuntimeError" in errors
        assert "private-error-body-not-for-logs" not in errors
    finally:
        finish_child(process)


def test_cli_cancellation_resistant_job_exits_nonzero_within_outer_stop_budget():
    process = start_child(
        """
        from contextlib import asynccontextmanager
        from workers import analysis_worker as worker
        @asynccontextmanager
        async def session():
            class DB:
                @asynccontextmanager
                async def begin(self):
                    yield
            yield DB()
        async def recover(db):
            return 0
        async def claim(db):
            return 'one-job'
        async def stubborn(job, factory):
            print('READY', flush=True)
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                await asyncio.Event().wait()
        class Engine:
            async def dispose(self):
                print('DISPOSED', flush=True)
        worker.async_session_maker = session
        worker.recover_stale_jobs = recover
        worker.claim_next_job = claim
        worker.process_job = stubborn
        worker.engine = Engine()
        worker.main()
        """
    )
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            assert ready.select(timeout=10), "child did not start the active job"
            assert process.stdout.readline().strip() == "READY"
        process.send_signal(signal.SIGTERM)
        output, errors = process.communicate(timeout=4.8)
        assert process.returncode == 1
        assert "could not cancel owned work safely" in errors
        assert "DISPOSED" not in output
    finally:
        finish_child(process)


def test_cli_disposal_timeout_is_failure_instead_of_fake_success():
    process = start_child(
        """
        from workers import analysis_worker as worker
        async def finished(*args, **kwargs):
            return
        class Engine:
            async def dispose(self):
                print('READY', flush=True)
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    await asyncio.Event().wait()
        worker.run_forever = finished
        worker.engine = Engine()
        worker.main()
        """
    )
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            assert ready.select(timeout=10), "child did not enter disposal"
            assert process.stdout.readline().strip() == "READY"
        _, errors = process.communicate(timeout=3)
        assert process.returncode == 1
        assert "could not release its engine safely" in errors
    finally:
        finish_child(process)


def require_test_database_url():
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail(
            "worker PostgreSQL tests require explicit DATABASE_URL", pytrace=False
        )
    try:
        parsed = make_url(raw)
        database = parsed.database or ""
        parts = set(re.split(r"[_-]+", database.casefold()))
        valid = (
            parsed.drivername in {"postgresql", "postgresql+asyncpg"}
            and parsed.host in {"127.0.0.1", "localhost", "::1"}
            and parsed.port is not None
            and 1 <= parsed.port <= 65535
            and bool(parsed.username and parsed.username.strip())
            and re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_-]*", database) is not None
            and bool(parts & {"test", "pytest"})
            and not (parts & {"prod", "production", "qa", "stage", "staging", "live"})
            and not parsed.query
        )
    except Exception:
        pytest.fail("worker PostgreSQL test DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail("worker PostgreSQL test database boundary mismatch", pytrace=False)
    return parsed.set(drivername="postgresql+asyncpg")


@pytest.fixture
def forbid_guard_connections(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("DSN guard must not open a connection", pytrace=False)

    monkeypatch.setattr(sys.modules[__name__], "create_async_engine", forbidden)
    monkeypatch.setattr("socket.create_connection", forbidden)


def test_database_guard_fails_without_explicit_url(
    monkeypatch, forbid_guard_connections
):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(pytest.fail.Exception, match="require explicit DATABASE_URL"):
        require_test_database_url()


@pytest.mark.parametrize(
    ("url", "host", "port", "user", "database"),
    [
        (
            "postgresql+asyncpg://echotalk_followup_test@127.0.0.1:55444/echotalk_followup_test",
            "127.0.0.1",
            55444,
            "echotalk_followup_test",
            "echotalk_followup_test",
        ),
        (
            "postgresql+asyncpg://echotalk@localhost:5432/echotalk_test",
            "localhost",
            5432,
            "echotalk",
            "echotalk_test",
        ),
        (
            "postgresql://tester@[::1]:55445/pytest_worker",
            "::1",
            55445,
            "tester",
            "pytest_worker",
        ),
        (
            "postgresql://tester@127.0.0.1:65535/test_worker",
            "127.0.0.1",
            65535,
            "tester",
            "test_worker",
        ),
    ],
)
def test_database_guard_accepts_explicit_test_urls_without_connecting(
    monkeypatch, forbid_guard_connections, url, host, port, user, database
):
    # The CI and other URLs here are parsed only, never local resource permission.
    monkeypatch.setenv("DATABASE_URL", url)
    parsed = require_test_database_url()
    assert parsed.drivername == "postgresql+asyncpg"
    assert (parsed.host, parsed.port, parsed.username, parsed.database) == (
        host,
        port,
        user,
        database,
    )
    assert not parsed.query


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://echotalk_followup_test@127.0.0.1:55444/echotalk",
        "postgresql://echotalk_followup_test@127.0.0.1:55444/echotalk_followup_test?sslmode=disable",
        "postgresql://tester@127.0.0.1:55444/echotalk_qa_test",
        "postgresql://tester@127.0.0.1:55444/echotalk_prod_test",
        "postgresql://tester@127.0.0.1:55444/production_test",
        "postgresql://tester@127.0.0.1:55444/staging_test",
        "postgresql://tester@127.0.0.1:55444/contest",
        "postgresql://tester@192.0.2.1:55444/echotalk_test",
        "postgresql://tester@db.example.invalid:5432/echotalk_test",
        "postgresql://tester@[2001:db8::1]:55444/echotalk_test",
        "postgresql://tester@127.0.0.1/echotalk_test",
        "postgresql://tester@127.0.0.1:0/echotalk_test",
        "postgresql://tester@127.0.0.1:65536/echotalk_test",
        "postgresql://tester@127.0.0.1:bad/echotalk_test",
        "postgresql://127.0.0.1:55444/echotalk_test",
        "postgresql://tester@127.0.0.1:55444/",
        "postgresql://tester@/echotalk_test",
        "postgresql+psycopg://tester@localhost:5432/echotalk_test",
        "sqlite:///:memory:",
    ],
)
def test_database_guard_rejects_other_targets_without_connecting(
    monkeypatch, forbid_guard_connections, url
):
    monkeypatch.setenv("DATABASE_URL", url)
    with pytest.raises(
        pytest.fail.Exception,
        match="database boundary mismatch|DATABASE_URL is invalid",
    ):
        require_test_database_url()


@pytest.fixture
async def postgres_worker_job(monkeypatch):
    database_url = require_test_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, session_id, job_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    identity_verified = False
    try:
        async with factory() as db, db.begin():
            identity = (
                await db.execute(
                    text(
                        "SELECT current_database(), current_user, current_setting('server_version_num')"
                    )
                )
            ).one()
            assert identity == (database_url.database, database_url.username, "150019")
            assert (
                await db.scalar(text("SELECT version_num FROM alembic_version"))
                == source_head
            )
            identity_verified = True
            db.add(User(id=user_id, email=f"worker-{user_id}@example.invalid"))
            await db.flush()
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
                )
            )
            await db.flush()
            db.add(
                Transcript(
                    session_id=session_id,
                    role=TranscriptRole.user,
                    content="I go yesterday. This is a test",
                    timestamp_ms=1,
                )
            )
            db.add(AnalysisJob(id=job_id, session_id=session_id))
        from services import analysis_service

        monkeypatch.setattr(analysis_service.settings, "USE_MOCK_ELSA", True)
        yield factory, engine, user_id, session_id, job_id
    finally:
        try:
            if identity_verified:
                async with factory() as db, db.begin():
                    sessions = select(Session.id).where(Session.user_id == user_id)
                    await db.execute(
                        delete(GrammarError).where(
                            GrammarError.session_id.in_(sessions)
                        )
                    )
                    await db.execute(
                        delete(PronunciationAssessment).where(
                            PronunciationAssessment.session_id.in_(sessions)
                        )
                    )
                    await db.execute(
                        delete(Transcript).where(Transcript.session_id.in_(sessions))
                    )
                    await db.execute(
                        delete(AnalysisJob).where(AnalysisJob.session_id.in_(sessions))
                    )
                    await db.execute(
                        delete(KnowledgeState).where(KnowledgeState.user_id == user_id)
                    )
                    await db.execute(delete(Session).where(Session.user_id == user_id))
                    await db.execute(delete(User).where(User.id == user_id))
        finally:
            await engine.dispose()


async def hold_real_analysis(monkeypatch):
    reached, release = asyncio.Event(), asyncio.Event()
    real = analysis_jobs.analyze_session

    async def held(session_id, db):
        result = await real(session_id, db)
        reached.set()
        await release.wait()
        return result

    monkeypatch.setattr(analysis_jobs, "analyze_session", held)
    return reached, release, real


async def database_snapshot(factory, session_id, job_id):
    async with factory() as db:
        job = await db.get(AnalysisJob, job_id)
        return {
            "status": job.status,
            "attempt": job.attempt_count,
            "last_error_code": job.last_error_code,
            "next_retry_at": job.next_retry_at,
            "finished_at": job.finished_at,
            "assessments": await db.scalar(
                select(func.count())
                .select_from(PronunciationAssessment)
                .where(PronunciationAssessment.session_id == session_id)
            ),
            "grammar": await db.scalar(
                select(func.count())
                .select_from(GrammarError)
                .where(GrammarError.session_id == session_id)
            ),
        }


@pytest.mark.asyncio
async def test_postgres_active_job_drains_once_and_next_job_is_not_claimed(
    postgres_worker_job, monkeypatch
):
    factory, engine, user_id, session_id, job_id = postgres_worker_job
    reached, release, _ = await hold_real_analysis(monkeypatch)
    stop = asyncio.Event()
    task = asyncio.create_task(worker.run_forever(stop, session_factory=factory))
    try:
        await asyncio.wait_for(reached.wait(), 3)
        second_session, second_job = uuid.uuid4(), uuid.uuid4()
        async with factory() as db, db.begin():
            db.add(
                Session(
                    id=second_session,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
                )
            )
            await db.flush()
            db.add(AnalysisJob(id=second_job, session_id=second_session))
        stop.set()
        stop.set()
        release.set()
        await asyncio.wait_for(task, 3)
        state = await database_snapshot(factory, session_id, job_id)
        assert state["status"] == AnalysisJobStatus.succeeded
        assert state["attempt"] == 1
        assert (state["assessments"], state["grammar"]) == (1, 1)
        async with factory() as db:
            untouched = await db.get(AnalysisJob, second_job)
            assert untouched.status == AnalysisJobStatus.pending
            assert untouched.attempt_count == 0
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(KnowledgeState)
                    .where(KnowledgeState.user_id == user_id)
                )
                == 0
            )
        assert engine.pool.checkedout() == 0
        assert_no_worker_tasks()
    finally:
        stop.set()
        release.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_postgres_timeout_rolls_back_and_existing_stale_recovery_succeeds(
    postgres_worker_job, monkeypatch
):
    factory, engine, _user_id, session_id, job_id = postgres_worker_job
    reached, release, real = await hold_real_analysis(monkeypatch)
    stop = asyncio.Event()
    task = asyncio.create_task(
        worker.run_forever(stop, session_factory=factory, shutdown_grace_seconds=0.01)
    )
    try:
        await asyncio.wait_for(reached.wait(), 3)
        stop.set()
        await asyncio.wait_for(task, 3)
        state = await database_snapshot(factory, session_id, job_id)
        assert state == {
            "status": AnalysisJobStatus.running,
            "attempt": 1,
            "last_error_code": None,
            "next_retry_at": None,
            "finished_at": None,
            "assessments": 0,
            "grammar": 0,
        }
        assert engine.pool.checkedout() == 0
        assert_no_worker_tasks()
        async with factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            job.started_at = (
                utc_now() - analysis_jobs.STALE_AFTER - timedelta(minutes=1)
            )
        monkeypatch.setattr(analysis_jobs, "analyze_session", real)
        restart_stop = asyncio.Event()
        real_process = worker.process_job

        async def process_once(claimed_id, session_factory):
            await real_process(claimed_id, session_factory)
            restart_stop.set()

        monkeypatch.setattr(worker, "process_job", process_once)
        await asyncio.wait_for(
            worker.run_forever(restart_stop, session_factory=factory), 3
        )
        final = await database_snapshot(factory, session_id, job_id)
        assert final["status"] == AnalysisJobStatus.succeeded
        assert final["attempt"] == 2
        assert (final["assessments"], final["grammar"]) == (1, 1)
        assert engine.pool.checkedout() == 0
        assert_no_worker_tasks()
    finally:
        stop.set()
        release.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_postgres_stop_crossing_claim_rolls_back_running_transition(
    postgres_worker_job, monkeypatch
):
    factory, engine, _user_id, session_id, job_id = postgres_worker_job
    claimed = asyncio.Event()
    real_claim = worker.claim_next_job

    async def hold_claim(db):
        result = await real_claim(db)
        claimed.set()
        await asyncio.Event().wait()
        return result

    monkeypatch.setattr(worker, "claim_next_job", hold_claim)
    stop = asyncio.Event()
    task = asyncio.create_task(worker.run_forever(stop, session_factory=factory))
    try:
        await asyncio.wait_for(claimed.wait(), 3)
        stop.set()
        await asyncio.wait_for(task, 3)
        state = await database_snapshot(factory, session_id, job_id)
        assert state["status"] == AnalysisJobStatus.pending
        assert state["attempt"] == 0
        assert state["last_error_code"] is None
        assert (state["assessments"], state["grammar"]) == (0, 0)
        assert engine.pool.checkedout() == 0
        assert_no_worker_tasks()
    finally:
        stop.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_postgres_stop_during_recovery_does_not_commit_a_new_retry(
    postgres_worker_job, monkeypatch
):
    factory, engine, _user_id, session_id, job_id = postgres_worker_job
    expired = utc_now() - analysis_jobs.STALE_AFTER - timedelta(minutes=1)
    async with factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        analysis_jobs.transition_job(job, AnalysisJobStatus.running, now=expired)
    recovered = asyncio.Event()
    real_recover = worker.recover_stale_jobs

    async def held_recovery(db):
        count = await real_recover(db)
        recovered.set()
        await asyncio.Event().wait()
        return count

    monkeypatch.setattr(worker, "recover_stale_jobs", held_recovery)
    stop = asyncio.Event()
    task = asyncio.create_task(worker.run_forever(stop, session_factory=factory))
    try:
        await asyncio.wait_for(recovered.wait(), 3)
        stop.set()
        await asyncio.wait_for(task, 3)
        state = await database_snapshot(factory, session_id, job_id)
        assert state["status"] == AnalysisJobStatus.running
        assert state["attempt"] == 1
        assert state["last_error_code"] is None
        assert state["next_retry_at"] is None
        assert (state["assessments"], state["grammar"]) == (0, 0)
        async with factory() as db:
            job = await db.get(AnalysisJob, job_id)
            assert job.started_at == expired
        assert engine.pool.checkedout() == 0
        assert_no_worker_tasks()
    finally:
        stop.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_postgres_external_cancel_does_not_persist_failure_or_partial_products(
    postgres_worker_job, monkeypatch
):
    factory, engine, _user_id, session_id, job_id = postgres_worker_job
    reached, release, _ = await hold_real_analysis(monkeypatch)
    task = asyncio.create_task(worker.run_forever(session_factory=factory))
    try:
        await asyncio.wait_for(reached.wait(), 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        state = await database_snapshot(factory, session_id, job_id)
        assert state["status"] == AnalysisJobStatus.running
        assert state["attempt"] == 1
        assert state["last_error_code"] is None
        assert state["next_retry_at"] is None
        assert (state["assessments"], state["grammar"]) == (0, 0)
        assert engine.pool.checkedout() == 0
        assert_no_worker_tasks()
    finally:
        release.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def ensure_test_skills(db):
    for skill_id, name, category in (
        ("th_sounds", "TH sounds", "pronunciation"),
        ("verb_tense_past", "Past tense", "grammar"),
        ("subject_verb_agreement", "Subject-verb agreement", "grammar"),
    ):
        if await db.get(Skill, skill_id) is None:
            db.add(Skill(id=skill_id, name=name, category=category))
    await db.flush()


@pytest.mark.asyncio
async def test_postgres_all_synthetic_skips_knowledge(postgres_worker_job):
    factory, _engine, user_id, session_id, job_id = postgres_worker_job
    async with factory() as db, db.begin():
        await ensure_test_skills(db)
        assert await analysis_jobs.claim_next_job(db) == job_id
        await analysis_jobs.execute_claimed_job(job_id, db)

    state = await database_snapshot(factory, session_id, job_id)
    assert state["status"] == AnalysisJobStatus.succeeded
    assert (state["assessments"], state["grammar"]) == (1, 1)

    async with factory() as db:
        knowledge_count = await db.scalar(
            select(func.count())
            .select_from(KnowledgeState)
            .where(KnowledgeState.user_id == user_id)
        )
        assert knowledge_count == 0


@pytest.mark.asyncio
async def test_postgres_real_pronunciation_only_updates_bkt(postgres_worker_job):
    factory, _engine, user_id, session_id, _job_id = postgres_worker_job
    alignment = [
        {"type": "substitution", "expected": "TH", "actual": "S", "position": 0}
    ]
    async with factory() as db, db.begin():
        await ensure_test_skills(db)
        db.add(
            PronunciationAssessment(
                id=uuid.uuid4(),
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=alignment,
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        db.add(
            GrammarError(
                id=uuid.uuid4(),
                session_id=session_id,
                skill_tag="verb_tense_past",
                original="I go",
                corrected="I went",
                error_type="wrong_tense",
                source="demo_rule",
                provider=None,
                model_version="demo-grammar-rules-v1",
                is_synthetic=True,
                confidence=0.5,
            )
        )
        await db.flush()
        await analysis_service.update_knowledge(session_id, user_id, db)

    async with factory() as db:
        stmt = select(KnowledgeState).where(KnowledgeState.user_id == user_id)
        states = (await db.execute(stmt)).scalars().all()
        mastery_by_skill = {s.skill_id: s.p_mastery for s in states}
        assert set(mastery_by_skill) == {"th_sounds"}


@pytest.mark.asyncio
async def test_postgres_real_grammar_only_updates_bkt(postgres_worker_job):
    factory, _engine, user_id, session_id, job_id = postgres_worker_job
    alignment = [
        {"type": "substitution", "expected": "TH", "actual": "S", "position": 0}
    ]
    async with factory() as db, db.begin():
        await ensure_test_skills(db)
        db.add(
            PronunciationAssessment(
                id=uuid.uuid4(),
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=alignment,
                source="demo_mock",
                provider=None,
                model_version="demo-phoneme-rules-v1",
                is_synthetic=True,
                confidence=0.0,
            )
        )
        db.add(
            GrammarError(
                id=uuid.uuid4(),
                session_id=session_id,
                skill_tag="verb_tense_past",
                original="I go",
                corrected="I went",
                error_type="wrong_tense",
                source="provider",
                provider="llm",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        await db.flush()
        await analysis_service.update_knowledge(session_id, user_id, db)

    async with factory() as db:
        stmt = select(KnowledgeState).where(KnowledgeState.user_id == user_id)
        states = (await db.execute(stmt)).scalars().all()
        assert {s.skill_id for s in states} == {"verb_tense_past"}

    async with factory() as db, db.begin():
        clear_stmt = delete(KnowledgeState).where(KnowledgeState.user_id == user_id)
        await db.execute(clear_stmt)
        assert await analysis_jobs.claim_next_job(db) == job_id
        await analysis_jobs.execute_claimed_job(job_id, db)

    async with factory() as db:
        stmt = select(KnowledgeState).where(KnowledgeState.user_id == user_id)
        states = (await db.execute(stmt)).scalars().all()
        assert {s.skill_id for s in states} == {"verb_tense_past"}


@pytest.mark.asyncio
async def test_postgres_both_real_sources_update_bkt(postgres_worker_job):
    factory, _engine, user_id, session_id, _job_id = postgres_worker_job
    alignment = [
        {"type": "substitution", "expected": "TH", "actual": "S", "position": 0}
    ]
    async with factory() as db, db.begin():
        await ensure_test_skills(db)
        db.add(
            PronunciationAssessment(
                id=uuid.uuid4(),
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=alignment,
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        db.add(
            GrammarError(
                id=uuid.uuid4(),
                session_id=session_id,
                skill_tag="verb_tense_past",
                original="I go",
                corrected="I went",
                error_type="wrong_tense",
                source="provider",
                provider="llm",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        db.add(
            GrammarError(
                id=uuid.uuid4(),
                session_id=session_id,
                skill_tag="subject_verb_agreement",
                original="he go",
                corrected="he goes",
                error_type="wrong_3p_verb",
                source="demo_rule",
                provider=None,
                model_version="demo-grammar-rules-v1",
                is_synthetic=True,
                confidence=0.5,
            )
        )
        await db.flush()
        await analysis_service.update_knowledge(session_id, user_id, db)

    async with factory() as db:
        stmt = select(KnowledgeState).where(KnowledgeState.user_id == user_id)
        states = (await db.execute(stmt)).scalars().all()
        assert {s.skill_id for s in states} == {"th_sounds", "verb_tense_past"}


@pytest.mark.asyncio
async def test_postgres_no_elsa_runs_grammar(postgres_worker_job, monkeypatch):
    factory, _engine, user_id, session_id, job_id = postgres_worker_job
    monkeypatch.setattr(analysis_service.settings, "USE_MOCK_ELSA", False)

    async with factory() as db, db.begin():
        await ensure_test_skills(db)
        assert await analysis_jobs.claim_next_job(db) == job_id
        await analysis_jobs.execute_claimed_job(job_id, db)

    state = await database_snapshot(factory, session_id, job_id)
    assert state["status"] == AnalysisJobStatus.succeeded
    assert state["last_error_code"] is None
    assert (state["assessments"], state["grammar"]) == (0, 1)

    async with factory() as db:
        knowledge_count = await db.scalar(
            select(func.count())
            .select_from(KnowledgeState)
            .where(KnowledgeState.user_id == user_id)
        )
        assert knowledge_count == 0


@pytest.mark.asyncio
async def test_postgres_no_transcript_fails(postgres_worker_job, monkeypatch):
    factory, _engine, _user_id, session_id, job_id = postgres_worker_job
    monkeypatch.setattr(analysis_service.settings, "USE_MOCK_ELSA", False)

    async with factory() as db, db.begin():
        await db.execute(delete(Transcript).where(Transcript.session_id == session_id))
        assert await analysis_jobs.claim_next_job(db) == job_id

    await analysis_jobs.process_job(job_id, factory)

    state = await database_snapshot(factory, session_id, job_id)
    assert state["status"] == AnalysisJobStatus.failed
    assert state["last_error_code"] == "no_user_transcript"
    assert (state["assessments"], state["grammar"]) == (0, 0)


@pytest.mark.asyncio
async def test_postgres_rerun_grammar_idempotent(postgres_worker_job, monkeypatch):
    factory, _engine, _user_id, session_id, job_id = postgres_worker_job
    monkeypatch.setattr(analysis_service.settings, "USE_MOCK_ELSA", False)

    async with factory() as db, db.begin():
        first = await analysis_service.analyze_session(session_id, db)
        second = await analysis_service.analyze_session(session_id, db)
        assert first is not None and first.assessment is None
        assert second is not None and second.assessment is None

    before = await database_snapshot(factory, session_id, job_id)
    assert (before["assessments"], before["grammar"]) == (0, 1)

    monkeypatch.setattr(analysis_service.settings, "USE_MOCK_ELSA", True)
    async with factory() as db, db.begin():
        third = await analysis_service.analyze_session(session_id, db)
        fourth = await analysis_service.analyze_session(session_id, db)
        assert third is not None and third.assessment is not None
        assert fourth is not None and fourth.assessment is not None
        assert third.id == fourth.id

    after = await database_snapshot(factory, session_id, job_id)
    assert (after["assessments"], after["grammar"]) == (1, 1)
