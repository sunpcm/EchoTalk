"""RED gate for B1-3 read-only learning-event replay validation.

The replay module is resolved at runtime to keep collection working before the
B1-3 implementation exists.  Cases use a real synthetic PostgreSQL database:
the validator must own one ``REPEATABLE READ READ ONLY`` transaction, read the
global ``MAX(apply_seq)`` watermark before other data, report every detected
integrity defect, and perform no repairs.

Required replay contract::

    validate_learning_event_replay(
        session_factory,
        *,
        algorithm_versions,
    ) -> ReplayReport

``ReplayReport`` exposes ``watermark``, ``issues``, ``isolation_level`` and
``read_only``.  Each issue exposes stable ``code``, optional ``user_id`` and
optional ``skill_id`` fields.
"""

import asyncio
import importlib
import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import delete, select, text
from sqlalchemy import event as sa_event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.session import Session, SessionMode, SessionStatus
from models.user import User
from services.knowledge.bkt_model import BKTParams, update_mastery

FROZEN_BKT_VERSION = "bkt-v1"
FROZEN_BKT_PARAMS = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}
REPLAY_MODULE = "services.learning_event_replay"
CUTOVER_MODULE = "services.learning_event_cutover"


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


def _runtime_api(module_name: str, required: set[str]):
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        if exc.name == module_name:
            pytest.fail(f"{module_name} is not implemented (B1-3 RED)", pytrace=False)
        raise
    missing = sorted(name for name in required if not hasattr(module, name))
    if missing:
        pytest.fail(
            f"{module_name} missing B1-3 API: {', '.join(missing)}",
            pytrace=False,
        )
    return module


def _cutover_api():
    return _runtime_api(
        CUTOVER_MODULE,
        {
            "prepare_cutover",
            "stop_legacy_writes",
            "write_legacy_baselines",
            "enable_event_gate",
            "resume_traffic",
        },
    )


def _replay_api():
    return _runtime_api(
        REPLAY_MODULE,
        {"validate_learning_event_replay"},
    )


class ReplayHarness:
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
            db.add(User(id=user_id, email=f"b1-3-replay-{user_id}@example.invalid"))
        self.user_ids.append(user_id)
        return user_id

    async def new_session(
        self,
        user_id: uuid.UUID,
        *,
        ended_at: datetime | None = None,
    ) -> uuid.UUID:
        session_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
                    ended_at=ended_at or datetime.now(UTC),
                )
            )
        return session_id

    async def add_knowledge_state(
        self,
        user_id: uuid.UUID,
        skill_id: str,
        p_mastery: float,
        *,
        updated_at: datetime | None = None,
    ) -> None:
        async with self.factory() as db, db.begin():
            values = {
                "id": uuid.uuid4(),
                "user_id": user_id,
                "skill_id": skill_id,
                "p_mastery": p_mastery,
            }
            if updated_at is not None:
                values["updated_at"] = updated_at
            db.add(KnowledgeState(**values))

    async def set_knowledge_state(
        self,
        user_id: uuid.UUID,
        skill_id: str,
        p_mastery: float,
        *,
        updated_at: datetime | None = None,
    ) -> None:
        async with self.factory() as db, db.begin():
            state = (
                await db.execute(
                    select(KnowledgeState).where(
                        KnowledgeState.user_id == user_id,
                        KnowledgeState.skill_id == skill_id,
                    )
                )
            ).scalar_one()
            state.p_mastery = p_mastery
            if updated_at is not None:
                state.updated_at = updated_at

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
                    delete(PronunciationAssessment).where(
                        PronunciationAssessment.session_id.in_(session_ids)
                    )
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


@dataclass(frozen=True)
class Batch:
    session_id: uuid.UUID
    job_id: uuid.UUID
    grammar_id: uuid.UUID
    completed_event_id: int
    observation_event_id: int
    completed_key: str
    observation_key: str


def _coverage(algorithm_version: str) -> dict:
    return {
        "schema_version": 1,
        "coverage": {
            "pronunciation": {
                "status": "not_called",
                "source": None,
                "provider": None,
                "model_version": None,
                "is_synthetic": None,
            },
            "grammar": {
                "status": "evaluated",
                "source": "provider",
                "provider": "llm",
                "model_version": "v1",
                "is_synthetic": False,
            },
        },
        "unmapped": {"pronunciation": 0, "grammar": 0},
        "algorithm_version": algorithm_version,
    }


async def _add_batch_in_transaction(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    skill_id: str,
    algorithm_version: str = FROZEN_BKT_VERSION,
    observation_first: bool = False,
    source_session_id: uuid.UUID | None = None,
    ended_at: datetime | None = None,
) -> Batch:
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    grammar_id = uuid.uuid4()
    completed_key = f"job:{job_id}:completed"
    observation_key = f"job:{job_id}:grammar:0"
    occurred_at = ended_at or datetime.now(UTC)
    finished_at = datetime.now(UTC)

    db.add(
        Session(
            id=session_id,
            user_id=user_id,
            mode=SessionMode.pronunciation,
            status=SessionStatus.completed,
            ended_at=occurred_at,
        )
    )
    db.add(
        AnalysisJob(
            id=job_id,
            session_id=session_id,
            status=AnalysisJobStatus.succeeded,
            attempt_count=1,
            started_at=finished_at,
            finished_at=finished_at,
        )
    )
    db.add(
        GrammarError(
            id=grammar_id,
            session_id=source_session_id or session_id,
            skill_tag=skill_id,
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

    completed = LearningEvent(
        idempotency_key=completed_key,
        event_type="analysis_completed",
        user_id=user_id,
        session_id=session_id,
        analysis_job_id=job_id,
        source="analysis",
        algorithm_version=algorithm_version,
        algorithm_params=dict(FROZEN_BKT_PARAMS),
        occurred_at=occurred_at,
        details=_coverage(algorithm_version),
    )
    observation = LearningEvent(
        idempotency_key=observation_key,
        event_type="grammar_observation",
        user_id=user_id,
        session_id=session_id,
        analysis_job_id=job_id,
        grammar_error_id=grammar_id,
        skill_id=skill_id,
        source_ordinal=0,
        observation_correct=False,
        observation_code="wrong_tense",
        source="provider",
        provider="llm",
        model_version="v1",
        confidence=0.9,
        is_synthetic=False,
        occurred_at=occurred_at,
        details={"schema_version": 1},
    )
    if observation_first:
        db.add(observation)
        await db.flush()
        db.add(completed)
        await db.flush()
    else:
        db.add(completed)
        await db.flush()
        db.add(observation)
        await db.flush()
    return Batch(
        session_id=session_id,
        job_id=job_id,
        grammar_id=grammar_id,
        completed_event_id=completed.apply_seq,
        observation_event_id=observation.apply_seq,
        completed_key=completed_key,
        observation_key=observation_key,
    )


async def _add_batch(pg, **kwargs) -> Batch:
    async with pg.factory() as db, db.begin():
        return await _add_batch_in_transaction(db, **kwargs)


async def _run_full_cutover(pg, api, revision: str):
    pg.track_revision(revision)
    async with pg.factory() as db, db.begin():
        await api.prepare_cutover(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        stopped = await api.stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )
    async with pg.factory() as db, db.begin():
        baselines = await api.write_legacy_baselines(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.enable_event_gate(db=db, revision=revision)
    async with pg.factory() as db, db.begin():
        await api.resume_traffic(db=db, revision=revision)
    return stopped, baselines


async def _validate(pg, api, factory=None):
    return await api.validate_learning_event_replay(
        factory or pg.factory,
        algorithm_versions={FROZEN_BKT_VERSION: dict(FROZEN_BKT_PARAMS)},
    )


def _issue_tuples(report) -> set[tuple[str, uuid.UUID | None, str | None]]:
    return {
        (issue.code, getattr(issue, "user_id", None), getattr(issue, "skill_id", None))
        for issue in report.issues
    }


@pytest.mark.asyncio
async def test_replay_reports_missing_legacy_baseline_but_accepts_new_skill(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-replay-baseline-{uuid.uuid4()}"
    user_id = await pg.new_user()
    legacy_skill = f"b1_3_legacy_{uuid.uuid4().hex}"[:50]
    tampered_skill = f"b1_3_tamper_{uuid.uuid4().hex}"[:50]
    new_skill = f"b1_3_new_{uuid.uuid4().hex}"[:50]
    for skill_id in (legacy_skill, tampered_skill, new_skill):
        await pg.ensure_skill(skill_id)
    await pg.add_knowledge_state(user_id, legacy_skill, 0.42)
    await pg.add_knowledge_state(user_id, tampered_skill, 0.33)

    _, baselines = await _run_full_cutover(pg, cutover, revision)
    assert baselines.count == 2

    params = BKTParams(**FROZEN_BKT_PARAMS)
    await pg.add_knowledge_state(user_id, new_skill, params.p_init)
    await _add_batch(
        pg,
        user_id=user_id,
        skill_id=new_skill,
    )
    new_value = update_mastery(params.p_init, False, params)
    await pg.set_knowledge_state(
        user_id,
        new_skill,
        new_value,
        updated_at=baselines.cutover_at + timedelta(seconds=1),
    )

    valid = await _validate(pg, replay)
    assert valid.issues == ()

    async with pg.factory() as db, db.begin():
        await db.execute(
            delete(LearningEvent).where(
                LearningEvent.idempotency_key
                == f"baseline:{revision}:{user_id}:{legacy_skill}"
            )
        )
        await db.execute(
            text(
                "UPDATE learning_events "
                "SET details = jsonb_set("
                "details, '{legacy_synthetic_impact}', '\"none\"'::jsonb, true"
                ") "
                "WHERE idempotency_key = :key"
            ),
            {"key": (f"baseline:{revision}:{user_id}:{tampered_skill}")},
        )

    broken = await _validate(pg, replay)
    issues = _issue_tuples(broken)
    assert ("missing_baseline", user_id, legacy_skill) in issues
    assert ("baseline_synthetic_impact_unknown", user_id, tampered_skill) in issues
    assert not any(
        code == "missing_baseline" and skill_id == new_skill
        for code, _, skill_id in issues
    )


async def _wait_for_replay_blocking_chain(
    pg,
    replay_task,
    *,
    application_name: str,
    blocker_pid: int,
) -> None:
    deadline = asyncio.get_running_loop().time() + 5
    while asyncio.get_running_loop().time() < deadline:
        if replay_task.done():
            await replay_task
            raise AssertionError("replay did not wait behind the table lock")
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
        "timed out waiting for pg_blocking_pids to identify replay contention"
    )


@pytest.mark.asyncio
async def test_replay_watermark_excludes_concurrently_committed_event_and_state(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-replay-watermark-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_watermark_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await pg.add_knowledge_state(user_id, skill_id, 0.42)
    await _run_full_cutover(pg, cutover, revision)

    first_batch = await _add_batch(
        pg,
        user_id=user_id,
        skill_id=skill_id,
    )
    params = BKTParams(**FROZEN_BKT_PARAMS)
    first_value = update_mastery(0.42, False, params)
    second_value = update_mastery(first_value, False, params)
    await pg.set_knowledge_state(user_id, skill_id, first_value)

    async with pg.factory() as db:
        old_watermark = await db.scalar(
            text("SELECT COALESCE(MAX(apply_seq), 0) FROM learning_events")
        )

    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    application_name = f"b1-3-replay-{uuid.uuid4()}"
    tagged_engine = create_async_engine(
        require_b1_database_url(),
        connect_args={"server_settings": {"application_name": application_name}},
    )
    tagged_factory = async_sessionmaker(tagged_engine, expire_on_commit=False)
    replay_task = None
    listening = False
    try:
        async with pg.factory() as locking_db, locking_db.begin():
            blocker_pid = await locking_db.scalar(text("SELECT pg_backend_pid()"))
            await locking_db.execute(
                text("LOCK TABLE knowledge_states IN ACCESS EXCLUSIVE MODE")
            )
            state = (
                await locking_db.execute(
                    select(KnowledgeState).where(
                        KnowledgeState.user_id == user_id,
                        KnowledgeState.skill_id == skill_id,
                    )
                )
            ).scalar_one()
            state.p_mastery = second_value
            second_batch = await _add_batch_in_transaction(
                locking_db,
                user_id=user_id,
                skill_id=skill_id,
            )
            await locking_db.flush()

            sa_event.listen(
                tagged_engine.sync_engine,
                "before_cursor_execute",
                capture,
            )
            listening = True
            replay_task = asyncio.create_task(
                _validate(pg, replay, factory=tagged_factory)
            )
            await _wait_for_replay_blocking_chain(
                pg,
                replay_task,
                application_name=application_name,
                blocker_pid=blocker_pid,
            )

        report = await replay_task
    finally:
        if listening:
            sa_event.remove(
                tagged_engine.sync_engine,
                "before_cursor_execute",
                capture,
            )
        if replay_task is not None and not replay_task.done():
            await replay_task
        await tagged_engine.dispose()

    assert report.issues == ()
    assert report.watermark == old_watermark
    assert second_batch.observation_event_id > report.watermark
    assert first_batch.observation_event_id <= report.watermark
    assert report.isolation_level.lower() == "repeatable read"
    assert report.read_only is True

    watermark_index = next(
        index
        for index, statement in enumerate(statements)
        if "COALESCE(MAX" in statement and "learning_events" in statement
    )
    knowledge_index = next(
        index
        for index, statement in enumerate(statements)
        if "FROM knowledge_states" in statement
    )
    assert watermark_index < knowledge_index


@pytest.mark.asyncio
async def test_replay_reports_all_defects_without_writes(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-replay-errors-{uuid.uuid4()}"
    user_id = await pg.new_user()
    other_user_id = await pg.new_user()
    skill_id = f"b1_3_errors_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await pg.add_knowledge_state(user_id, skill_id, 0.42)
    _, baselines = await _run_full_cutover(pg, cutover, revision)
    other_session = await pg.new_session(
        other_user_id,
        ended_at=baselines.cutover_at - timedelta(seconds=1),
    )

    broken_batch = await _add_batch(
        pg,
        user_id=user_id,
        skill_id=skill_id,
        algorithm_version="bkt-v9-unknown",
        observation_first=True,
        source_session_id=other_session,
        ended_at=baselines.cutover_at - timedelta(days=1),
    )
    await pg.set_knowledge_state(user_id, skill_id, 0.9)

    async with pg.factory() as db:
        before_events = await db.scalar(text("SELECT count(*) FROM learning_events"))
        before_jobs = await db.scalar(text("SELECT count(*) FROM analysis_jobs"))
        before_grammar = await db.scalar(text("SELECT count(*) FROM grammar_errors"))
        before_state = await db.scalar(
            select(KnowledgeState.p_mastery).where(
                KnowledgeState.user_id == user_id,
                KnowledgeState.skill_id == skill_id,
            )
        )

    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(pg.engine.sync_engine, "before_cursor_execute", capture)
    try:
        report = await _validate(pg, replay)
    finally:
        sa_event.remove(pg.engine.sync_engine, "before_cursor_execute", capture)

    issues = _issue_tuples(report)
    assert ("unknown_algorithm_version", user_id, skill_id) in issues
    assert ("event_order_violation", user_id, skill_id) in issues
    assert ("source_ownership_mismatch", user_id, skill_id) in issues
    assert broken_batch.observation_event_id < broken_batch.completed_event_id
    assert report.isolation_level.lower() == "repeatable read"
    assert report.read_only is True

    mutations = [
        statement
        for statement in statements
        if statement.lstrip()
        .upper()
        .startswith(("INSERT ", "UPDATE ", "DELETE ", "TRUNCATE ", "ALTER "))
    ]
    assert mutations == []

    async with pg.factory() as db:
        assert await db.scalar(text("SELECT count(*) FROM learning_events")) == (
            before_events
        )
        assert (
            await db.scalar(text("SELECT count(*) FROM analysis_jobs")) == before_jobs
        )
        assert await db.scalar(text("SELECT count(*) FROM grammar_errors")) == (
            before_grammar
        )
        assert await db.scalar(
            select(KnowledgeState.p_mastery).where(
                KnowledgeState.user_id == user_id,
                KnowledgeState.skill_id == skill_id,
            )
        ) == pytest.approx(before_state)


async def _add_pronunciation_batch(
    pg,
    *,
    user_id: uuid.UUID,
    skill_id: str,
    include_observation: bool = True,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """Create one synthetic pronunciation batch with its completed marker."""
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    assessment_id = uuid.uuid4()
    occurred_at = datetime.now(UTC)
    async with pg.factory() as db, db.begin():
        db.add(
            Session(
                id=session_id,
                user_id=user_id,
                mode=SessionMode.pronunciation,
                status=SessionStatus.completed,
                ended_at=occurred_at,
            )
        )
        db.add(
            AnalysisJob(
                id=job_id,
                session_id=session_id,
                status=AnalysisJobStatus.succeeded,
                attempt_count=1,
                started_at=occurred_at,
                finished_at=occurred_at,
            )
        )
        db.add(
            PronunciationAssessment(
                id=assessment_id,
                session_id=session_id,
                overall_score=0.5,
                phoneme_alignment=[
                    {"type": "substitution", "expected": "TH", "actual": "S"}
                ],
                source="demo",
                provider="demo",
                model_version="demo-v1",
                is_synthetic=True,
                confidence=0.6,
            )
        )
        await db.flush()
        details = _coverage(FROZEN_BKT_VERSION)
        details["coverage"]["pronunciation"] = {
            "status": "evaluated",
            "source": "demo",
            "provider": "demo",
            "model_version": "demo-v1",
            "is_synthetic": True,
        }
        db.add(
            LearningEvent(
                idempotency_key=f"job:{job_id}:completed",
                event_type="analysis_completed",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                source="analysis",
                algorithm_version=FROZEN_BKT_VERSION,
                algorithm_params=dict(FROZEN_BKT_PARAMS),
                occurred_at=occurred_at,
                details=details,
            )
        )
        if include_observation:
            db.add(
                LearningEvent(
                    idempotency_key=f"job:{job_id}:pron:0",
                    event_type="pronunciation_observation",
                    user_id=user_id,
                    session_id=session_id,
                    analysis_job_id=job_id,
                    pronunciation_assessment_id=assessment_id,
                    skill_id=skill_id,
                    source_ordinal=0,
                    observation_correct=False,
                    observation_code="substitution",
                    source="demo",
                    provider="demo",
                    model_version="demo-v1",
                    confidence=0.6,
                    is_synthetic=True,
                    occurred_at=occurred_at,
                    details={"schema_version": 1},
                )
            )
    return session_id, job_id, assessment_id


@pytest.mark.asyncio
async def test_replay_reports_completed_event_ownership_mismatch(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r1-owner-{uuid.uuid4()}"
    owner_id = await pg.new_user()
    other_user_id = await pg.new_user()
    await _run_full_cutover(pg, cutover, revision)

    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    occurred_at = datetime.now(UTC)
    async with pg.factory() as db, db.begin():
        db.add(
            Session(
                id=session_id,
                user_id=owner_id,
                mode=SessionMode.pronunciation,
                status=SessionStatus.completed,
                ended_at=occurred_at,
            )
        )
        db.add(
            AnalysisJob(
                id=job_id,
                session_id=session_id,
                status=AnalysisJobStatus.succeeded,
                attempt_count=1,
                started_at=occurred_at,
                finished_at=occurred_at,
            )
        )
        await db.flush()
        db.add(
            LearningEvent(
                idempotency_key=f"job:{job_id}:completed",
                event_type="analysis_completed",
                user_id=other_user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                source="analysis",
                algorithm_version=FROZEN_BKT_VERSION,
                algorithm_params=dict(FROZEN_BKT_PARAMS),
                occurred_at=occurred_at,
                details=_coverage(FROZEN_BKT_VERSION),
            )
        )

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("source_ownership_mismatch", other_user_id, None) in issues


@pytest.mark.asyncio
async def test_replay_reports_completed_event_job_state_and_time(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r1-state-{uuid.uuid4()}"
    user_id = await pg.new_user()
    await _run_full_cutover(pg, cutover, revision)

    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    ended_at = datetime.now(UTC)
    async with pg.factory() as db, db.begin():
        db.add(
            Session(
                id=session_id,
                user_id=user_id,
                mode=SessionMode.pronunciation,
                status=SessionStatus.completed,
                ended_at=ended_at,
            )
        )
        db.add(
            AnalysisJob(
                id=job_id,
                session_id=session_id,
                status=AnalysisJobStatus.failed,
                attempt_count=1,
                started_at=ended_at,
            )
        )
        await db.flush()
        db.add(
            LearningEvent(
                idempotency_key=f"job:{job_id}:completed",
                event_type="analysis_completed",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                source="analysis",
                algorithm_version=FROZEN_BKT_VERSION,
                algorithm_params=dict(FROZEN_BKT_PARAMS),
                occurred_at=ended_at + timedelta(hours=1),
                details=_coverage(FROZEN_BKT_VERSION),
            )
        )

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("completed_job_mismatch", user_id, None) in issues
    assert ("event_time_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_replay_reports_deleted_pronunciation_observation(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r1-pron-{uuid.uuid4()}"
    user_id = await pg.new_user()
    await pg.ensure_skill("th_sounds")
    await _run_full_cutover(pg, cutover, revision)
    _, _, assessment_id = await _add_pronunciation_batch(
        pg,
        user_id=user_id,
        skill_id="th_sounds",
        include_observation=False,
    )

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("missing_observation", user_id, "th_sounds") in issues
    assert assessment_id


@pytest.mark.asyncio
async def test_replay_accepts_unmapped_sources_without_events(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r1-unmapped-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_mapped_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _run_full_cutover(pg, cutover, revision)

    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    mapped_grammar_id = uuid.uuid4()
    unmapped_grammar_id = uuid.uuid4()
    occurred_at = datetime.now(UTC)
    async with pg.factory() as db, db.begin():
        db.add(
            Session(
                id=session_id,
                user_id=user_id,
                mode=SessionMode.pronunciation,
                status=SessionStatus.completed,
                ended_at=occurred_at,
            )
        )
        db.add(
            AnalysisJob(
                id=job_id,
                session_id=session_id,
                status=AnalysisJobStatus.succeeded,
                attempt_count=1,
                started_at=occurred_at,
                finished_at=occurred_at,
            )
        )
        db.add(
            GrammarError(
                id=mapped_grammar_id,
                session_id=session_id,
                skill_tag=skill_id,
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
                id=unmapped_grammar_id,
                session_id=session_id,
                skill_tag=f"unmapped_{uuid.uuid4().hex}"[:50],
                original="He go",
                corrected="He went",
                error_type="wrong_subject",
                source="provider",
                provider="llm",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        await db.flush()
        details = _coverage(FROZEN_BKT_VERSION)
        details["unmapped"]["grammar"] = 1
        db.add(
            LearningEvent(
                idempotency_key=f"job:{job_id}:completed",
                event_type="analysis_completed",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                source="analysis",
                algorithm_version=FROZEN_BKT_VERSION,
                algorithm_params=dict(FROZEN_BKT_PARAMS),
                occurred_at=occurred_at,
                details=details,
            )
        )
        db.add(
            LearningEvent(
                idempotency_key=f"job:{job_id}:grammar:0",
                event_type="grammar_observation",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                grammar_error_id=mapped_grammar_id,
                skill_id=skill_id,
                source_ordinal=0,
                observation_correct=False,
                observation_code="wrong_tense",
                source="provider",
                provider="llm",
                model_version="v1",
                confidence=0.9,
                is_synthetic=False,
                occurred_at=occurred_at,
                details={"schema_version": 1},
            )
        )

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert not any(code == "missing_observation" for code, _, _ in issues)


@pytest.mark.asyncio
async def test_replay_reports_tampered_ordinal_and_key(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r1-ordinal-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_ordinal_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await pg.add_knowledge_state(user_id, skill_id, 0.42)
    await _run_full_cutover(pg, cutover, revision)
    batch = await _add_batch(pg, user_id=user_id, skill_id=skill_id)
    await pg.set_knowledge_state(user_id, skill_id, 0.5)

    async with pg.factory() as db, db.begin():
        event = await db.get(LearningEvent, batch.observation_event_id)
        event.source_ordinal = 1
        event.idempotency_key = f"job:{batch.job_id}:grammar:1"

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("canonical_order_mismatch", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_replay_reports_real_observation_without_state(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r1-state-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_nostate_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _run_full_cutover(pg, cutover, revision)
    await _add_batch(pg, user_id=user_id, skill_id=skill_id)

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("state_missing", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_replay_reports_foreign_revision_and_late_baselines(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r1-anchor-{uuid.uuid4()}"
    foreign_user_id = await pg.new_user()
    late_user_id = await pg.new_user()
    foreign_skill = f"b1_3_foreign_{uuid.uuid4().hex}"[:50]
    late_skill = f"b1_3_late_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(foreign_skill)
    await pg.ensure_skill(late_skill)
    observed_user_id = await pg.new_user()
    observed_skill = f"b1_3_observed_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(observed_skill)
    await pg.add_knowledge_state(late_user_id, late_skill, 0.5)
    _, baselines = await _run_full_cutover(pg, cutover, revision)
    await _add_batch(pg, user_id=observed_user_id, skill_id=observed_skill)

    async with pg.factory() as db, db.begin():
        db.add(
            LearningEvent(
                idempotency_key=(
                    f"baseline:foreign-revision:{foreign_user_id}:{foreign_skill}"
                ),
                event_type="baseline_snapshot",
                user_id=foreign_user_id,
                skill_id=foreign_skill,
                source="legacy_unknown",
                p_mastery_snapshot=0.4,
                cutover_revision="foreign-revision",
                occurred_at=baselines.cutover_at,
                details={
                    "schema_version": 1,
                    "legacy_synthetic_impact": "unknown",
                },
            )
        )
        original_baseline = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.cutover_revision == revision,
                    LearningEvent.event_type == "baseline_snapshot",
                    LearningEvent.user_id == late_user_id,
                    LearningEvent.skill_id == late_skill,
                )
            )
        ).scalar_one()
        replayed_baseline = LearningEvent(
            idempotency_key=original_baseline.idempotency_key,
            event_type="baseline_snapshot",
            user_id=late_user_id,
            skill_id=late_skill,
            source="legacy_unknown",
            p_mastery_snapshot=0.5,
            cutover_revision=revision,
            occurred_at=baselines.cutover_at,
            details={
                "schema_version": 1,
                "legacy_synthetic_impact": "unknown",
            },
        )
        await db.delete(original_baseline)
        await db.flush()
        db.add(replayed_baseline)

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("baseline_revision_mismatch", foreign_user_id, foreign_skill) in issues
    assert ("baseline_after_observation", late_user_id, late_skill) in issues


async def _load_event_by_key(pg, key: str) -> int:
    async with pg.factory() as db:
        return await db.scalar(
            select(LearningEvent.apply_seq).where(LearningEvent.idempotency_key == key)
        )


@pytest.mark.asyncio
async def test_replay_rejects_completed_event_without_coverage_directions(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r2-coverage-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_r2_cov_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _run_full_cutover(pg, cutover, revision)
    batch = await _add_batch(pg, user_id=user_id, skill_id=skill_id)
    params = BKTParams(**FROZEN_BKT_PARAMS)
    await pg.add_knowledge_state(
        user_id,
        skill_id,
        update_mastery(params.p_init, False, params),
    )

    report = await _validate(pg, replay)
    assert report.issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.details = {**completed.details, "coverage": {}}

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("coverage_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_replay_rejects_completed_event_schema_version_drift(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r2-cschema-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_r2_cs_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _run_full_cutover(pg, cutover, revision)
    batch = await _add_batch(pg, user_id=user_id, skill_id=skill_id)
    params = BKTParams(**FROZEN_BKT_PARAMS)
    await pg.add_knowledge_state(
        user_id,
        skill_id,
        update_mastery(params.p_init, False, params),
    )

    assert (await _validate(pg, replay)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.details = {**completed.details, "schema_version": 99}

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("event_schema_version_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_replay_rejects_completed_event_source_drift(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r2-csource-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_r2_csrc_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _run_full_cutover(pg, cutover, revision)
    batch = await _add_batch(pg, user_id=user_id, skill_id=skill_id)
    params = BKTParams(**FROZEN_BKT_PARAMS)
    await pg.add_knowledge_state(
        user_id,
        skill_id,
        update_mastery(params.p_init, False, params),
    )

    assert (await _validate(pg, replay)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.source = "wrong-source"

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("completed_source_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_replay_rejects_observation_schema_version_drift(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r2-oschema-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_r2_os_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _run_full_cutover(pg, cutover, revision)
    batch = await _add_batch(pg, user_id=user_id, skill_id=skill_id)
    params = BKTParams(**FROZEN_BKT_PARAMS)
    await pg.add_knowledge_state(
        user_id,
        skill_id,
        update_mastery(params.p_init, False, params),
    )

    assert (await _validate(pg, replay)).issues == ()

    async with pg.factory() as db, db.begin():
        observation = await db.get(LearningEvent, batch.observation_event_id)
        observation.details = {"schema_version": 99}

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("event_schema_version_mismatch", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_replay_rejects_baseline_schema_version_drift(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r2-bschema-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_r2_bs_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await pg.add_knowledge_state(user_id, skill_id, 0.42)
    await _run_full_cutover(pg, cutover, revision)

    assert (await _validate(pg, replay)).issues == ()

    async with pg.factory() as db, db.begin():
        baseline = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.cutover_revision == revision,
                    LearningEvent.event_type == "baseline_snapshot",
                )
            )
        ).scalar_one()
        baseline.details = {
            "schema_version": 99,
            "legacy_synthetic_impact": "unknown",
        }

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("event_schema_version_mismatch", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_replay_rejects_baseline_between_complete_job_batches(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r2-between-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_r2_btwn_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await pg.add_knowledge_state(user_id, skill_id, 0.42)
    _, baselines = await _run_full_cutover(pg, cutover, revision)

    params = BKTParams(**FROZEN_BKT_PARAMS)
    first_batch = await _add_batch(pg, user_id=user_id, skill_id=skill_id)
    second_batch = await _add_batch(pg, user_id=user_id, skill_id=skill_id)
    twice_updated = update_mastery(update_mastery(0.42, False, params), False, params)
    await pg.set_knowledge_state(
        user_id,
        skill_id,
        twice_updated,
        updated_at=baselines.cutover_at + timedelta(seconds=1),
    )

    assert (await _validate(pg, replay)).issues == ()

    baseline_key = f"baseline:{revision}:{user_id}:{skill_id}"
    baseline_seq = await _load_event_by_key(pg, baseline_key)
    first_completed_seq = await _load_event_by_key(pg, first_batch.completed_key)
    first_observation_seq = await _load_event_by_key(
        pg,
        first_batch.observation_key,
    )
    assert baseline_seq < first_completed_seq < first_observation_seq

    # Move the baseline between the two complete batches without breaking
    # either job's completed-first order: [completed, observation, baseline,
    # second completed, second observation].
    async with pg.factory() as db, db.begin():
        await db.execute(
            text(
                "UPDATE learning_events SET apply_seq = :target "
                "WHERE idempotency_key = :key"
            ),
            {
                "target": baseline_seq + 10000,
                "key": first_batch.observation_key,
            },
        )
        await db.execute(
            text(
                "UPDATE learning_events SET apply_seq = :target "
                "WHERE idempotency_key = :key"
            ),
            {"target": first_observation_seq, "key": baseline_key},
        )
        await db.execute(
            text(
                "UPDATE learning_events SET apply_seq = :target "
                "WHERE idempotency_key = :key"
            ),
            {"target": baseline_seq, "key": first_batch.completed_key},
        )
        await db.execute(
            text(
                "UPDATE learning_events SET apply_seq = :target "
                "WHERE idempotency_key = :key"
            ),
            {
                "target": first_completed_seq,
                "key": first_batch.observation_key,
            },
        )

    moved_baseline_seq = await _load_event_by_key(pg, baseline_key)
    assert (
        first_batch.completed_event_id
        < moved_baseline_seq
        < second_batch.completed_event_id
    )

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert ("baseline_after_observation", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_replay_rejects_deleted_legacy_baseline_when_value_equals_p_init(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r2-pinit-{uuid.uuid4()}"
    user_id = await pg.new_user()
    skill_id = f"b1_3_r2_pinit_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    params = BKTParams(**FROZEN_BKT_PARAMS)
    await pg.add_knowledge_state(user_id, skill_id, params.p_init)
    _, baselines = await _run_full_cutover(pg, cutover, revision)

    await _add_batch(pg, user_id=user_id, skill_id=skill_id)
    updated = update_mastery(params.p_init, False, params)
    await pg.set_knowledge_state(
        user_id,
        skill_id,
        updated,
        updated_at=baselines.cutover_at + timedelta(seconds=1),
    )

    assert (await _validate(pg, replay)).issues == ()

    async with pg.factory() as db, db.begin():
        await db.execute(
            delete(LearningEvent).where(
                LearningEvent.idempotency_key
                == f"baseline:{revision}:{user_id}:{skill_id}"
            )
        )

    report = await _validate(pg, replay)
    issues = _issue_tuples(report)
    assert any(
        code == "baseline_set_mismatch" and issue_user_id in (None, user_id)
        for code, issue_user_id, _ in issues
    )


@pytest.mark.asyncio
async def test_replay_rejects_cross_source_observation_order_swap(pg):
    cutover = _cutover_api()
    replay = _replay_api()
    revision = f"b1-3-r2-order-{uuid.uuid4()}"
    user_id = await pg.new_user()
    first_skill = f"b1_3_r2_ord_a_{uuid.uuid4().hex}"[:50]
    second_skill = f"b1_3_r2_ord_b_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(first_skill)
    await pg.ensure_skill(second_skill)
    await _run_full_cutover(pg, cutover, revision)

    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    first_grammar_id = uuid.uuid4()
    second_grammar_id = uuid.uuid4()
    occurred_at = datetime.now(UTC)
    async with pg.factory() as db, db.begin():
        db.add(
            Session(
                id=session_id,
                user_id=user_id,
                mode=SessionMode.pronunciation,
                status=SessionStatus.completed,
                ended_at=occurred_at,
            )
        )
        db.add(
            AnalysisJob(
                id=job_id,
                session_id=session_id,
                status=AnalysisJobStatus.succeeded,
                attempt_count=1,
                started_at=occurred_at,
                finished_at=occurred_at,
            )
        )
        for grammar_id, skill_id, error_type in (
            (first_grammar_id, first_skill, "wrong_tense"),
            (second_grammar_id, second_skill, "wrong_subject"),
        ):
            db.add(
                GrammarError(
                    id=grammar_id,
                    session_id=session_id,
                    skill_tag=skill_id,
                    original="I go",
                    corrected="I went",
                    error_type=error_type,
                    source="provider",
                    provider="llm",
                    model_version="v1",
                    is_synthetic=True,
                    confidence=0.9,
                )
            )
        await db.flush()
        completed_details = _coverage(FROZEN_BKT_VERSION)
        completed_details["coverage"]["grammar"]["is_synthetic"] = True
        db.add(
            LearningEvent(
                idempotency_key=f"job:{job_id}:completed",
                event_type="analysis_completed",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                source="analysis",
                algorithm_version=FROZEN_BKT_VERSION,
                algorithm_params=dict(FROZEN_BKT_PARAMS),
                occurred_at=occurred_at,
                details=completed_details,
            )
        )
        for ordinal, (grammar_id, skill_id, error_type) in enumerate(
            (
                (first_grammar_id, first_skill, "wrong_tense"),
                (second_grammar_id, second_skill, "wrong_subject"),
            )
        ):
            db.add(
                LearningEvent(
                    idempotency_key=f"job:{job_id}:grammar:{ordinal}",
                    event_type="grammar_observation",
                    user_id=user_id,
                    session_id=session_id,
                    analysis_job_id=job_id,
                    grammar_error_id=grammar_id,
                    skill_id=skill_id,
                    source_ordinal=ordinal,
                    observation_correct=False,
                    observation_code=error_type,
                    source="provider",
                    provider="llm",
                    model_version="v1",
                    confidence=0.9,
                    is_synthetic=True,
                    occurred_at=occurred_at,
                    details={"schema_version": 1},
                )
            )

    assert (await _validate(pg, replay)).issues == ()

    first_key = f"job:{job_id}:grammar:0"
    second_key = f"job:{job_id}:grammar:1"
    first_seq = await _load_event_by_key(pg, first_key)
    second_seq = await _load_event_by_key(pg, second_key)
    assert first_seq < second_seq
    async with pg.factory() as db, db.begin():
        await db.execute(
            text(
                "UPDATE learning_events SET apply_seq = :target "
                "WHERE idempotency_key = :key"
            ),
            {"target": second_seq + 10000, "key": first_key},
        )
        await db.execute(
            text(
                "UPDATE learning_events SET apply_seq = :target "
                "WHERE idempotency_key = :key"
            ),
            {"target": first_seq, "key": second_key},
        )
        await db.execute(
            text(
                "UPDATE learning_events SET apply_seq = :target "
                "WHERE idempotency_key = :key"
            ),
            {"target": second_seq, "key": first_key},
        )

    report = await _validate(pg, replay)
    assert any(
        issue.code == "canonical_order_mismatch" and issue.user_id == user_id
        for issue in report.issues
    )
