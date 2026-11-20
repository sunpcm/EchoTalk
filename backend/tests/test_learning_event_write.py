"""RED gate for B1-2 same-transaction learning event writes.

These cases exercise the production ``execute_claimed_job`` path plus the new
``services.learning_events.write_learning_events`` entry against a real
PostgreSQL database.  The new module is intentionally *not* imported at module
top level: it does not exist until B1-2 lands, and a top-level import would turn
every collection into an ``ImportError``.  Instead tests resolve the entry with
``importlib``/``getattr`` so the tree stays collectable and fails RED on the
missing API, then asserts the real lock/transaction/write semantics once the
entry exists.

The write entry contract used by this file is:

    async def write_learning_events(
        *,
        job: AnalysisJob,
        session: Session,
        user_id: uuid.UUID,
        assessment: PronunciationAssessment | None,
        grammar_errors: Sequence[GrammarError],
        coverage: dict[str, Any],
        db: AsyncSession,
    ) -> None

It locks the owning ``users.id`` row, validates the job/session/user and every
candidate source's ``session_id`` (fail closed on mismatch), writes the
``analysis_completed`` event and canonical observations idempotently, applies
BKT only for newly inserted non-synthetic observations in ``apply_seq`` order,
and leaves the job status transition to ``execute_claimed_job``.
``assessment``, ``grammar_errors`` and ``coverage`` all come explicitly from the
``analyze_session`` result: the writer must not re-query the source tables to
guess a missing direction, and must not treat ``assessment is None`` as proof of
``not_called`` (it could also be ``failed``).
"""

import asyncio
import copy
import importlib
import os
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import delete, select, text
from sqlalchemy import event as sa_event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm.attributes import flag_modified

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.session import (
    Session,
    SessionMode,
    SessionStatus,
    Transcript,
    TranscriptRole,
)
from models.user import User
from services import analysis_jobs, analysis_service
from services.analysis_jobs import AnalysisExecutionError, InvalidAnalysisTransition
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.learning_event_lifecycle import (
    LIFECYCLE_LOCK_KEY,
    LIFECYCLE_LOCK_NAMESPACE,
    acquire_exclusive_lifecycle_barrier,
)
from tests.learning_event_gate_helper import open_learning_event_gate

WRITE_LEARNING_EVENTS = "write_learning_events"
FROZEN_BKT_VERSION = "bkt-v1"
FROZEN_BKT_PARAMS = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}


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
                ("127.0.0.1", 55446, "echotalk_b2_main_test"),
                ("localhost", 5432, "echotalk_test"),
            }
            and bool(parsed.username and parsed.username.strip())
            and (
                target != ("127.0.0.1", 55446, "echotalk_b2_main_test")
                or parsed.username == "echotalk_b2_main_test"
            )
            and not parsed.query
        )
    except Exception:
        pytest.fail("B1 PostgreSQL test DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail("B1 PostgreSQL test database boundary mismatch", pytrace=False)
    return parsed.set(drivername="postgresql+asyncpg")


def _learning_events_module():
    try:
        return importlib.import_module("services.learning_events")
    except ModuleNotFoundError:
        pytest.fail(
            "services.learning_events is not implemented (B1-2 RED)", pytrace=False
        )


def _write_learning_events():
    module = _learning_events_module()
    fn = getattr(module, WRITE_LEARNING_EVENTS, None)
    if fn is None:
        pytest.fail(
            f"services.learning_events.{WRITE_LEARNING_EVENTS} is not implemented "
            "(B1-2 RED)",
            pytrace=False,
        )
    return fn


@dataclass
class _AnalysisResult:
    """Test double for the enriched ``analyze_session`` result.

    The fake adapters return explicit rows and per-direction coverage.  The
    production writer still re-reads the complete persisted source sets inside
    its Job -> User lock boundary before accepting that coverage.
    """

    assessment: PronunciationAssessment | None = None
    grammar_errors: list[GrammarError] = field(default_factory=list)
    coverage: dict[str, Any] = field(default_factory=dict)


def _coverage_for(
    assessment: PronunciationAssessment | None,
    grammar_errors: Sequence[GrammarError],
) -> dict[str, Any]:
    def source_facts(source):
        return {
            "source": source.source,
            "provider": source.provider,
            "model_version": source.model_version,
            "is_synthetic": source.is_synthetic,
        }

    pronunciation_facts = source_facts(assessment) if assessment is not None else None
    first_grammar = grammar_errors[0] if grammar_errors else None
    grammar_facts = source_facts(first_grammar) if first_grammar is not None else None
    return {
        "pronunciation": {
            "status": "evaluated" if assessment is not None else "not_called",
            "reason": "completed" if assessment is not None else "disabled",
            "result_count": len(assessment.phoneme_alignment)
            if assessment is not None and assessment.phoneme_alignment is not None
            else (0 if assessment is not None else None),
            "reused": False,
            "metadata": pronunciation_facts,
            "basis": "current_invocation" if assessment is not None else "none",
            "source_facts": pronunciation_facts,
        },
        "grammar": {
            "status": "evaluated" if first_grammar is not None else "not_called",
            "reason": "completed" if first_grammar is not None else "not_reached",
            "result_count": len(grammar_errors) if first_grammar is not None else None,
            "reused": False,
            "metadata": grammar_facts,
            "basis": "current_invocation" if first_grammar is not None else "none",
            "source_facts": grammar_facts,
        },
    }


class LedgerHarness:
    """Track a dedicated user's rows so each test can clean up safely."""

    def __init__(self, factory, engine):
        self.factory = factory
        self.engine = engine
        self.user_ids: list[uuid.UUID] = []

    async def ensure_skill(self, skill_id: str, name: str, category: str) -> None:
        async with self.factory() as db, db.begin():
            if await db.get(Skill, skill_id) is None:
                db.add(Skill(id=skill_id, name=name, category=category))

    async def ensure_seed_skills(self) -> None:
        for skill_id, name, category in (
            ("th_sounds", "TH sounds", "pronunciation"),
            ("verb_tense_past", "Past tense", "grammar"),
            ("subject_verb_agreement", "Subject-verb agreement", "grammar"),
        ):
            await self.ensure_skill(skill_id, name, category)

    async def new_user(self) -> uuid.UUID:
        user_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(User(id=user_id, email=f"b1-{user_id}@example.invalid"))
        self.user_ids.append(user_id)
        return user_id

    async def new_session(
        self, user_id: uuid.UUID, *, ended_at: datetime | None = None
    ) -> uuid.UUID:
        session_id = uuid.uuid4()
        if ended_at is None:
            ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
        async with self.factory() as db, db.begin():
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
                    ended_at=ended_at,
                )
            )
        return session_id

    async def new_transcript(
        self, session_id: uuid.UUID, content: str = "I go yesterday. This is a test"
    ) -> None:
        async with self.factory() as db, db.begin():
            db.add(
                Transcript(
                    session_id=session_id,
                    role=TranscriptRole.user,
                    content=content,
                    timestamp_ms=1,
                )
            )

    async def new_job(
        self,
        session_id: uuid.UUID,
        *,
        status: AnalysisJobStatus = AnalysisJobStatus.pending,
        attempt_count: int = 0,
    ) -> uuid.UUID:
        job_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                AnalysisJob(
                    id=job_id,
                    session_id=session_id,
                    status=status,
                    attempt_count=attempt_count,
                )
            )
        return job_id

    async def cleanup(self) -> None:
        async with self.factory() as db, db.begin():
            if self.user_ids:
                await db.execute(
                    delete(LearningEvent).where(
                        LearningEvent.user_id.in_(self.user_ids)
                    )
                )
                sessions = select(Session.id).where(Session.user_id.in_(self.user_ids))
                await db.execute(
                    delete(GrammarError).where(GrammarError.session_id.in_(sessions))
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
    harness = LedgerHarness(factory, engine)
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
        await open_learning_event_gate(
            factory,
            revision="test-fixture-b1-2-write",
        )
        yield harness
    finally:
        if identity_verified:
            await harness.cleanup()
        else:
            await engine.dispose()


async def claim_job(factory, job_id: uuid.UUID) -> None:
    async with factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        analysis_jobs.transition_job(job, AnalysisJobStatus.running)


async def run_job(factory, job_id: uuid.UUID) -> None:
    async with factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        analysis_jobs.transition_job(job, AnalysisJobStatus.running)
        await analysis_jobs.execute_claimed_job(job_id, db)


async def get_events(factory, user_id: uuid.UUID) -> list[LearningEvent]:
    async with factory() as db:
        return (
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


async def get_knowledge_states(factory, user_id: uuid.UUID) -> list[KnowledgeState]:
    async with factory() as db:
        return (
            (
                await db.execute(
                    select(KnowledgeState).where(KnowledgeState.user_id == user_id)
                )
            )
            .scalars()
            .all()
        )


async def _wait_for_blocked_application(
    factory,
    application_name: str,
) -> list[tuple[int, list[int]]]:
    deadline = asyncio.get_running_loop().time() + 5
    while asyncio.get_running_loop().time() < deadline:
        async with factory() as db:
            rows = (
                await db.execute(
                    text(
                        """
                        SELECT pid, pg_blocking_pids(pid) AS blockers
                        FROM pg_stat_activity
                        WHERE datname = current_database()
                          AND application_name = :application_name
                          AND wait_event_type = 'Lock'
                        """
                    ),
                    {"application_name": application_name},
                )
            ).all()
        if rows:
            return [(pid, list(blockers)) for pid, blockers in rows]
        await asyncio.sleep(0.02)
    raise AssertionError(
        f"timed out waiting for blocked application {application_name}"
    )


async def _application_pid(factory, application_name: str) -> int:
    async with factory() as db:
        pid = await db.scalar(
            text(
                """
                SELECT pid
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND application_name = :application_name
                """
            ),
            {"application_name": application_name},
        )
    if pid is None:
        raise AssertionError(f"application {application_name} has no backend")
    return pid


async def _wait_for_advisory_barrier_block(
    factory,
    application_name: str,
) -> tuple[int, list[int]]:
    """Wait until ``application_name`` waits on the fixed advisory barrier."""
    deadline = asyncio.get_running_loop().time() + 5
    while asyncio.get_running_loop().time() < deadline:
        async with factory() as db:
            waiter = (
                await db.execute(
                    text(
                        """
                        SELECT l.pid
                        FROM pg_locks l
                        JOIN pg_stat_activity a ON a.pid = l.pid
                        WHERE a.datname = current_database()
                          AND a.application_name = :application_name
                          AND l.locktype = 'advisory'
                          AND l.classid = :namespace
                          AND l.objid = :key
                          AND l.granted = false
                        """
                    ),
                    {
                        "application_name": application_name,
                        "namespace": LIFECYCLE_LOCK_NAMESPACE,
                        "key": LIFECYCLE_LOCK_KEY,
                    },
                )
            ).all()
        if waiter:
            pid = waiter[0][0]
            holders = await _advisory_barrier_holders(factory, exclude_pid=pid)
            if holders:
                return pid, holders
        await asyncio.sleep(0.02)
    raise AssertionError(
        f"timed out waiting for {application_name} to wait on the advisory barrier"
    )


async def _advisory_barrier_holders(
    factory,
    *,
    exclude_pid: int,
) -> list[int]:
    async with factory() as db:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT DISTINCT l.pid
                    FROM pg_locks l
                    JOIN pg_stat_activity a ON a.pid = l.pid
                    WHERE a.datname = current_database()
                      AND l.locktype = 'advisory'
                      AND l.classid = :namespace
                      AND l.objid = :key
                      AND l.granted = true
                      AND l.pid <> :exclude_pid
                    """
                ),
                {
                    "namespace": LIFECYCLE_LOCK_NAMESPACE,
                    "key": LIFECYCLE_LOCK_KEY,
                    "exclude_pid": exclude_pid,
                },
            )
        ).all()
    return [pid for (pid,) in rows]


async def _execute_two_jobs_observing_user_lock(
    pg,
    monkeypatch,
    *,
    job_a: uuid.UUID,
    job_b: uuid.UUID,
) -> None:
    """Run both production executors and prove the second waits on User."""
    events_module = _learning_events_module()
    real_apply = events_module._apply_bkt_updates
    first_reached_apply = asyncio.Event()
    release_first = asyncio.Event()

    async def hold_first_after_user_lock(*, job_id, **kwargs):
        if job_id == job_a:
            first_reached_apply.set()
            await release_first.wait()
        return await real_apply(job_id=job_id, **kwargs)

    monkeypatch.setattr(
        events_module,
        "_apply_bkt_updates",
        hold_first_after_user_lock,
    )

    async def execute(job_id, application_name):
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": application_name},
            )
            await analysis_jobs.execute_claimed_job(job_id, db)

    first = asyncio.create_task(execute(job_a, "b2-user-lock-first"))
    second = None
    try:
        await asyncio.wait_for(first_reached_apply.wait(), timeout=5)
        second = asyncio.create_task(execute(job_b, "b2-user-lock-second"))
        blocked = await _wait_for_blocked_application(pg.factory, "b2-user-lock-second")
        first_pid = await _application_pid(pg.factory, "b2-user-lock-first")
        assert blocked
        assert all(first_pid in blockers for _pid, blockers in blocked)
        assert not first.done()
        assert not second.done()

        release_first.set()
        await asyncio.wait_for(asyncio.gather(first, second), timeout=10)
    finally:
        release_first.set()
        for task in (first, second):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (first, second) if task is not None),
            return_exceptions=True,
        )


def install_analysis(monkeypatch, specs):
    """Replace ``analysis_jobs.analyze_session`` with a deterministic writer.

    ``specs`` maps ``session_id`` to ``(pronunciation_alignment, grammar_specs)``.
    A ``None`` pronunciation means no assessment (not called).  Each grammar
    spec accepts ``skill_tag``, ``error_type`` and optional ``is_synthetic``.
    """

    async def fake_analyze(session_id, db):
        pronunciation, grammar_specs = specs[session_id]
        assessment = None
        if pronunciation is not None:
            assessment = PronunciationAssessment(
                id=uuid.uuid4(),
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=pronunciation,
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
            db.add(assessment)
        grammar_errors: list[GrammarError] = []
        for spec in grammar_specs:
            grammar_error = GrammarError(
                id=uuid.uuid4(),
                session_id=session_id,
                skill_tag=spec["skill_tag"],
                original=spec.get("original", "I go"),
                corrected=spec.get("corrected", "I went"),
                error_type=spec.get("error_type", "wrong_tense"),
                source="provider",
                provider="llm",
                model_version="v1",
                is_synthetic=spec.get("is_synthetic", False),
                confidence=0.9,
            )
            db.add(grammar_error)
            grammar_errors.append(grammar_error)
        await db.flush()
        return _AnalysisResult(
            assessment=assessment,
            grammar_errors=grammar_errors,
            coverage=_coverage_for(assessment, grammar_errors),
        )

    monkeypatch.setattr(analysis_jobs, "analyze_session", fake_analyze)


TH_ALIGNMENT = [
    {"type": "substitution", "expected": "TH", "actual": "S", "position": 0}
]


def grammar_observation_values(
    *,
    key,
    user_id,
    session_id,
    job_id,
    grammar_id,
    skill_id,
    occurred_at,
    is_synthetic,
    source="provider",
    provider="llm",
    model_version="v1",
):
    return {
        "idempotency_key": key,
        "event_type": "grammar_observation",
        "user_id": user_id,
        "session_id": session_id,
        "analysis_job_id": job_id,
        "grammar_error_id": grammar_id,
        "skill_id": skill_id,
        "source_ordinal": 0,
        "observation_correct": False,
        "observation_code": "wrong_tense",
        "source": source,
        "provider": provider,
        "model_version": model_version,
        "confidence": 0.9,
        "is_synthetic": is_synthetic,
        "occurred_at": occurred_at,
        "details": {"schema_version": 1},
    }


def completed_event_values(
    *,
    user_id,
    session_id,
    job_id,
    occurred_at,
    coverage,
    unmapped_pronunciation,
    unmapped_grammar,
):
    return {
        "idempotency_key": f"job:{job_id}:completed",
        "event_type": "analysis_completed",
        "user_id": user_id,
        "session_id": session_id,
        "analysis_job_id": job_id,
        "pronunciation_assessment_id": None,
        "grammar_error_id": None,
        "skill_id": None,
        "source_ordinal": None,
        "observation_correct": None,
        "observation_code": None,
        "source": "analysis",
        "provider": None,
        "model_version": None,
        "confidence": None,
        "is_synthetic": None,
        "algorithm_version": FROZEN_BKT_VERSION,
        "algorithm_params": FROZEN_BKT_PARAMS,
        "p_mastery_snapshot": None,
        "cutover_revision": None,
        "occurred_at": occurred_at,
        "details": {
            "schema_version": 1,
            "coverage": coverage,
            "unmapped": {
                "pronunciation": unmapped_pronunciation,
                "grammar": unmapped_grammar,
            },
        },
    }


def test_write_learning_events_api_is_exposed():
    fn = _write_learning_events()
    assert callable(fn)


@pytest.mark.asyncio
async def test_synthetic_job_writes_completed_and_observations(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    completed = [e for e in events if e.event_type == "analysis_completed"]
    observations = [e for e in events if e.event_type != "analysis_completed"]
    assert len(completed) == 1
    assert observations, "synthetic observations should still be recorded"
    assert all(e.is_synthetic for e in observations)
    assert all(e.analysis_job_id == job_id for e in events)


@pytest.mark.asyncio
async def test_completed_event_has_bkt_v1_frozen_params(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    completed = [e for e in events if e.event_type == "analysis_completed"]
    assert len(completed) == 1
    assert completed[0].algorithm_version == FROZEN_BKT_VERSION
    assert completed[0].algorithm_params == FROZEN_BKT_PARAMS


@pytest.mark.asyncio
async def test_occurred_at_equals_session_ended_at(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    ended_at = datetime(2026, 11, 12, 7, 45, tzinfo=UTC)
    session_id = await pg.new_session(user_id, ended_at=ended_at)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    assert events
    assert all(e.occurred_at == ended_at for e in events)


@pytest.mark.asyncio
async def test_apply_seq_strictly_increases_within_user(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    assert len(events) >= 1
    seqs = [e.apply_seq for e in events]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == len(seqs)


@pytest.mark.asyncio
async def test_all_synthetic_does_not_create_knowledge_state(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    # Preset a real state so we can prove the synthetic run neither reads nor
    # modifies it (an empty state alone would not catch a stray SELECT).
    async with pg.factory() as db, db.begin():
        db.add(
            KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id="verb_tense_past",
                p_mastery=0.42,
            )
        )

    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(pg.engine.sync_engine, "before_cursor_execute", capture)
    try:
        await run_job(pg.factory, job_id)
    finally:
        sa_event.remove(pg.engine.sync_engine, "before_cursor_execute", capture)

    events = await get_events(pg.factory, user_id)
    assert any(e.event_type == "analysis_completed" for e in events)
    states = await get_knowledge_states(pg.factory, user_id)
    assert len(states) == 1
    assert states[0].skill_id == "verb_tense_past"
    assert abs(states[0].p_mastery - 0.42) < 1e-9
    assert not any("knowledge_states" in s.lower() for s in statements)


@pytest.mark.asyncio
async def test_real_pronunciation_synthetic_grammar_updates_only_pronunciation(
    pg, monkeypatch
):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                TH_ALIGNMENT,
                [
                    {
                        "skill_tag": "verb_tense_past",
                        "error_type": "wrong_tense",
                        "is_synthetic": True,
                    }
                ],
            )
        },
    )

    await run_job(pg.factory, job_id)

    states = await get_knowledge_states(pg.factory, user_id)
    assert {s.skill_id for s in states} == {"th_sounds"}
    events = await get_events(pg.factory, user_id)
    directions = {(e.event_type, e.skill_id, e.is_synthetic) for e in events}
    assert ("pronunciation_observation", "th_sounds", False) in directions
    assert ("grammar_observation", "verb_tense_past", True) in directions


@pytest.mark.asyncio
async def test_synthetic_pronunciation_real_grammar_updates_only_grammar(
    pg, monkeypatch
):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)

    async def fake_analyze(session_id_arg, db):
        assert session_id_arg == session_id
        assessment = PronunciationAssessment(
            id=uuid.uuid4(),
            session_id=session_id_arg,
            overall_score=75.0,
            phoneme_alignment=TH_ALIGNMENT,
            source="demo_mock",
            provider=None,
            model_version="demo-phoneme-rules-v1",
            is_synthetic=True,
            confidence=0.0,
        )
        db.add(assessment)
        grammar_error = GrammarError(
            id=uuid.uuid4(),
            session_id=session_id_arg,
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
        db.add(grammar_error)
        await db.flush()
        return _AnalysisResult(
            assessment=assessment,
            grammar_errors=[grammar_error],
            coverage=_coverage_for(assessment, [grammar_error]),
        )

    monkeypatch.setattr(analysis_jobs, "analyze_session", fake_analyze)

    await run_job(pg.factory, job_id)

    states = await get_knowledge_states(pg.factory, user_id)
    assert {s.skill_id for s in states} == {"verb_tense_past"}
    events = await get_events(pg.factory, user_id)
    directions = {(e.event_type, e.skill_id, e.is_synthetic) for e in events}
    assert ("pronunciation_observation", "th_sounds", True) in directions
    assert ("grammar_observation", "verb_tense_past", False) in directions


@pytest.mark.asyncio
async def test_both_real_sources_update_both_skills(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                TH_ALIGNMENT,
                [
                    {"skill_tag": "verb_tense_past", "error_type": "wrong_tense"},
                    {
                        "skill_tag": "subject_verb_agreement",
                        "error_type": "wrong_3p_verb",
                    },
                ],
            )
        },
    )

    await run_job(pg.factory, job_id)

    states = await get_knowledge_states(pg.factory, user_id)
    assert {s.skill_id for s in states} == {
        "th_sounds",
        "verb_tense_past",
        "subject_verb_agreement",
    }


@pytest.mark.asyncio
async def test_pronunciation_not_called_marks_coverage(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    monkeypatch.setattr(analysis_service.settings, "USE_MOCK_ELSA", False)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    completed = [e for e in events if e.event_type == "analysis_completed"]
    assert len(completed) == 1
    coverage = completed[0].details.get("coverage", {})
    assert coverage.get("pronunciation", {}).get("status") == "not_called"
    assert not any(e.event_type == "pronunciation_observation" for e in events)


@pytest.mark.asyncio
async def test_grammar_zero_errors_marks_evaluated(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id, content="I like the weather today.")
    job_id = await pg.new_job(session_id)
    monkeypatch.setattr(analysis_service.settings, "USE_MOCK_ELSA", False)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    completed = [e for e in events if e.event_type == "analysis_completed"]
    assert len(completed) == 1
    coverage = completed[0].details.get("coverage", {})
    grammar_coverage = coverage.get("grammar", {})
    assert grammar_coverage.get("status") == "evaluated"
    assert grammar_coverage.get("result_count") == 0
    assert grammar_coverage.get("basis") == "current_invocation"
    assert grammar_coverage.get("source_facts") == {
        "source": "demo_rule",
        "provider": None,
        "model_version": "demo-grammar-rules-v1",
        "is_synthetic": True,
    }
    assert not any(e.event_type == "grammar_observation" for e in events)
    states = await get_knowledge_states(pg.factory, user_id)
    assert states == []


@pytest.mark.asyncio
async def test_no_transcript_fails_and_rolls_back(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    job_id = await pg.new_job(session_id)
    monkeypatch.setattr(analysis_service.settings, "USE_MOCK_ELSA", False)

    await claim_job(pg.factory, job_id)
    await analysis_jobs.process_job(job_id, pg.factory)

    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.failed
        assert job.last_error_code == "no_user_transcript"
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []


@pytest.mark.asyncio
async def test_failure_after_events_rolls_back_whole_batch(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                TH_ALIGNMENT,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            )
        },
    )

    real_transition = analysis_jobs.transition_job

    def fail_after_events(job, target, *, now=None):
        if target == AnalysisJobStatus.succeeded:
            raise AnalysisExecutionError(
                "forced_failure", "injected after events", retryable=True
            )
        real_transition(job, target, now=now)

    monkeypatch.setattr(analysis_jobs, "transition_job", fail_after_events)

    await claim_job(pg.factory, job_id)
    await analysis_jobs.process_job(job_id, pg.factory)

    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.pending
        assessment = (
            await db.execute(
                select(PronunciationAssessment).where(
                    PronunciationAssessment.session_id == session_id
                )
            )
        ).scalar_one_or_none()
        assert assessment is None
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []


@pytest.mark.asyncio
async def test_external_cancellation_rolls_back_all_results(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)

    async def cancel_after_analysis(session_id_arg, db):
        await analysis_service.analyze_session(session_id_arg, db)
        raise asyncio.CancelledError()

    monkeypatch.setattr(analysis_jobs, "analyze_session", cancel_after_analysis)

    # Claim to running in its own committed transaction so the cancelled inner
    # transaction cannot also roll back the running state.
    await claim_job(pg.factory, job_id)

    # Catch the cancellation *outside* the transaction.  Catching it inside
    # ``db.begin()`` would swallow it and let the context manager commit the
    # half-written assessment instead of rolling back.
    async with pg.factory() as db:
        with pytest.raises(asyncio.CancelledError):
            async with db.begin():
                await analysis_jobs.execute_claimed_job(job_id, db)

    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.running
        assessment = (
            await db.execute(
                select(PronunciationAssessment).where(
                    PronunciationAssessment.session_id == session_id
                )
            )
        ).scalar_one_or_none()
        assert assessment is None
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []


@pytest.mark.asyncio
async def test_new_b2_pending_job_with_prior_attempt_runs(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, attempt_count=1)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    assert any(e.event_type == "analysis_completed" for e in events)


@pytest.mark.asyncio
async def test_new_b2_failed_job_retry_runs(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.failed)
    async with pg.factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        job.last_error_code = "worker_timeout"
        analysis_jobs.retry_job(job)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    assert any(e.event_type == "analysis_completed" for e in events)


@pytest.mark.asyncio
async def test_execute_claimed_job_refreshes_stale_orm_status(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)
    analyzed: list[uuid.UUID] = []

    async def should_not_analyze(session_id_arg, db):
        analyzed.append(session_id_arg)
        raise AssertionError("stale running ORM object authorized analysis")

    monkeypatch.setattr(analysis_jobs, "analyze_session", should_not_analyze)

    async with pg.factory() as db, db.begin():
        cached_job = await db.get(AnalysisJob, job_id)
        assert cached_job.status == AnalysisJobStatus.running

        async with pg.factory() as other_db, other_db.begin():
            current_job = await other_db.get(AnalysisJob, job_id)
            current_job.status = AnalysisJobStatus.pending

        with pytest.raises(InvalidAnalysisTransition):
            await analysis_jobs.execute_claimed_job(job_id, db)

    assert analyzed == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.pending
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []


@pytest.mark.asyncio
async def test_old_succeeded_job_not_backfilled(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.succeeded)

    with pytest.raises(InvalidAnalysisTransition):
        async with pg.factory() as db, db.begin():
            await analysis_jobs.execute_claimed_job(job_id, db)

    assert await get_events(pg.factory, user_id) == []


@pytest.mark.parametrize(
    "mismatch",
    ["cross_user_assessment", "cross_session_grammar", "session_job_mismatch"],
)
@pytest.mark.asyncio
async def test_cross_relation_fails_closed(pg, mismatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    other_user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    other_session_id = await pg.new_session(other_user_id)
    await pg.new_transcript(session_id)
    await pg.new_transcript(other_session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    if mismatch == "cross_user_assessment":
        assessment_session = other_session_id
        grammar_session = session_id
        session_arg = session_id
        user_arg = user_id
    elif mismatch == "cross_session_grammar":
        assessment_session = session_id
        grammar_session = other_session_id
        session_arg = session_id
        user_arg = user_id
    else:  # session_job_mismatch
        assessment_session = other_session_id
        grammar_session = other_session_id
        session_arg = other_session_id
        user_arg = other_user_id

    assessment_id = uuid.uuid4()
    grammar_id = uuid.uuid4()
    async with pg.factory() as db, db.begin():
        db.add(
            PronunciationAssessment(
                id=assessment_id,
                session_id=assessment_session,
                overall_score=75.0,
                phoneme_alignment=TH_ALIGNMENT,
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        db.add(
            GrammarError(
                id=grammar_id,
                session_id=grammar_session,
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

    write = _write_learning_events()
    with pytest.raises(AnalysisExecutionError):
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_arg)
            assessment = await db.get(PronunciationAssessment, assessment_id)
            grammar = await db.get(GrammarError, grammar_id)
            await write(
                job=job,
                session=session,
                user_id=user_arg,
                assessment=assessment,
                grammar_errors=[grammar],
                coverage=_coverage_for(assessment, [grammar]),
                db=db,
            )

    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.running
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []


@pytest.mark.asyncio
async def test_unknown_model_version_rejects_complete_batch_before_write(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    with pytest.raises(AnalysisExecutionError) as caught:
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            assessment = PronunciationAssessment(
                id=uuid.uuid4(),
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=TH_ALIGNMENT,
                source="legacy_mock",
                provider=None,
                model_version=None,
                is_synthetic=False,
                confidence=None,
            )
            grammar_error = GrammarError(
                id=uuid.uuid4(),
                session_id=session_id,
                skill_tag="verb_tense_past",
                original="I go",
                corrected="I went",
                error_type="wrong_tense",
                source="legacy_rule",
                provider=None,
                model_version=None,
                is_synthetic=False,
                confidence=None,
            )
            db.add_all([assessment, grammar_error])
            await db.flush()
            assert assessment.model_version is None
            assert grammar_error.model_version is None
            coverage = _coverage_for(assessment, [grammar_error])
            assert coverage["pronunciation"]["source_facts"]["model_version"] is None
            assert coverage["grammar"]["source_facts"]["model_version"] is None
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=assessment,
                grammar_errors=[grammar_error],
                coverage=coverage,
                db=db,
            )

    assert caught.value.code == "coverage_invalid"
    assert "non-empty model version" in str(caught.value)

    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []
    async with pg.factory() as db:
        assessments = (
            (
                await db.execute(
                    select(PronunciationAssessment).where(
                        PronunciationAssessment.session_id == session_id
                    )
                )
            )
            .scalars()
            .all()
        )
        grammar_errors = (
            (
                await db.execute(
                    select(GrammarError).where(GrammarError.session_id == session_id)
                )
            )
            .scalars()
            .all()
        )
        job = await db.get(AnalysisJob, job_id)
    assert assessments == []
    assert grammar_errors == []
    assert job.status == AnalysisJobStatus.running


@pytest.mark.asyncio
async def test_source_set_missing_persisted_pronunciation_rolls_back_batch(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    assessment_id = uuid.uuid4()
    grammar_id = uuid.uuid4()
    async with pg.factory() as db, db.begin():
        db.add(
            PronunciationAssessment(
                id=assessment_id,
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=TH_ALIGNMENT,
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        db.add(
            GrammarError(
                id=grammar_id,
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

    with pytest.raises(AnalysisExecutionError) as caught:
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            grammar = await db.get(GrammarError, grammar_id)
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage=_coverage_for(None, [grammar]),
                db=db,
            )

    assert caught.value.code == "source_set_mismatch"
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assessment = await db.get(PronunciationAssessment, assessment_id)
    assert job.status == AnalysisJobStatus.running
    assert assessment is not None


@pytest.mark.asyncio
async def test_heterogeneous_grammar_sources_roll_back_whole_batch(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    grammar_a_id = uuid.uuid4()
    grammar_b_id = uuid.uuid4()
    async with pg.factory() as db, db.begin():
        db.add(
            GrammarError(
                id=grammar_a_id,
                session_id=session_id,
                skill_tag="verb_tense_past",
                original="I go",
                corrected="I went",
                error_type="wrong_tense",
                source="provider_a",
                provider="llm_a",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        db.add(
            GrammarError(
                id=grammar_b_id,
                session_id=session_id,
                skill_tag="subject_verb_agreement",
                original="He go",
                corrected="He goes",
                error_type="subject_verb_agreement",
                source="provider_b",
                provider="llm_b",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )

    with pytest.raises(AnalysisExecutionError) as caught:
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            grammar_a = await db.get(GrammarError, grammar_a_id)
            grammar_b = await db.get(GrammarError, grammar_b_id)
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[grammar_a, grammar_b],
                coverage=_coverage_for(None, [grammar_a, grammar_b]),
                db=db,
            )

    assert caught.value.code == "coverage_invalid"
    assert "heterogeneous" in str(caught.value)
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
    assert job.status == AnalysisJobStatus.running


@pytest.mark.asyncio
async def test_writer_rechecks_session_ownership_after_waiting_for_user(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    other_user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    assessment_id = uuid.uuid4()
    grammar_id = uuid.uuid4()
    async with pg.factory() as db, db.begin():
        db.add(
            PronunciationAssessment(
                id=assessment_id,
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=TH_ALIGNMENT,
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        db.add(
            GrammarError(
                id=grammar_id,
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

    reassigned = asyncio.Event()
    release = asyncio.Event()

    async def block_and_reassign():
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b2-user-reassign-blocker"},
            )
            await db.execute(
                select(User.id).where(User.id == user_id).with_for_update()
            )
            session_row = await db.get(Session, session_id)
            session_row.user_id = other_user_id
            await db.flush()
            reassigned.set()
            await release.wait()

    async def run_writer():
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b2-user-reassign-writer"},
            )
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            assert session.user_id == user_id
            assessment = await db.get(PronunciationAssessment, assessment_id)
            grammar = await db.get(GrammarError, grammar_id)
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=assessment,
                grammar_errors=[grammar],
                coverage=_coverage_for(assessment, [grammar]),
                db=db,
            )

    blocker = asyncio.create_task(block_and_reassign())
    writer = None
    try:
        await asyncio.wait_for(reassigned.wait(), timeout=5)
        writer = asyncio.create_task(run_writer())
        blocked = await _wait_for_blocked_application(
            pg.factory, "b2-user-reassign-writer"
        )
        blocker_pid = await _application_pid(pg.factory, "b2-user-reassign-blocker")
        assert all(blocker_pid in blockers for _pid, blockers in blocked)

        release.set()
        with pytest.raises(AnalysisExecutionError) as caught:
            await writer
        assert caught.value.code == "session_ownership_mismatch"
    finally:
        release.set()
        for task in (blocker, writer):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (blocker, writer) if task is not None),
            return_exceptions=True,
        )

    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        session = await db.get(Session, session_id)
    assert job.status == AnalysisJobStatus.running
    assert session.user_id == other_user_id


@pytest.mark.asyncio
async def test_writer_rejects_stale_completed_payload_after_other_connection_commit(pg):
    """A cached completed event must not mask a different committed payload.

    The writer re-reads the persisted event set under the Job/User lock before
    comparing canonical payloads.  A stale ORM identity from the caller's
    earlier read would let ``False == 0`` type coercion hide a real database
    change; ``populate_existing`` must refresh that identity so the writer
    rejects the idempotent re-submit instead of proving a full commit.
    """
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    # Establish a canonical complete zero-observation batch whose completed
    # event stores details.unmapped.grammar as the JSON integer 0.
    async with pg.factory() as db, db.begin():
        job = await db.get(AnalysisJob, job_id)
        session = await db.get(Session, session_id)
        await _write_learning_events()(
            job=job,
            session=session,
            user_id=user_id,
            assessment=None,
            grammar_errors=[],
            coverage=_coverage_for(None, []),
            db=db,
        )

    async with pg.factory() as db_caller:
        # Strongly reference the completed event so its identity is cached in
        # this caller session before the out-of-band tamper commits.
        cached = (
            await db_caller.execute(
                select(LearningEvent).where(
                    LearningEvent.analysis_job_id == job_id,
                    LearningEvent.event_type == "analysis_completed",
                )
            )
        ).scalar_one()
        assert cached.details["unmapped"]["grammar"] == 0
        assert type(cached.details["unmapped"]["grammar"]) is int

        # A second connection changes the JSON integer 0 to JSON boolean false.
        # Explicit dirty marking defeats SQLAlchemy's ``False == 0`` change
        # detection so the update is really persisted.
        async with pg.factory() as db_tamper, db_tamper.begin():
            row = (
                await db_tamper.execute(
                    select(LearningEvent).where(
                        LearningEvent.analysis_job_id == job_id,
                        LearningEvent.event_type == "analysis_completed",
                    )
                )
            ).scalar_one()
            tampered_details = copy.deepcopy(row.details)
            tampered_details["unmapped"]["grammar"] = False
            row.details = tampered_details
            flag_modified(row, "details")

        # A third fresh connection proves the boolean false is committed.
        async with pg.factory() as db_verify:
            persisted = (
                await db_verify.execute(
                    select(LearningEvent).where(
                        LearningEvent.analysis_job_id == job_id,
                        LearningEvent.event_type == "analysis_completed",
                    )
                )
            ).scalar_one()
        assert persisted.details["unmapped"]["grammar"] is False
        assert type(persisted.details["unmapped"]["grammar"]) is bool

        # The caller still holds the stale integer 0, exactly the mask the
        # review probe exposed.
        assert cached.details["unmapped"]["grammar"] == 0

        job = await db_caller.get(AnalysisJob, job_id)
        session = await db_caller.get(Session, session_id)
        with pytest.raises(AnalysisExecutionError) as caught:
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[],
                coverage=_coverage_for(None, []),
                db=db_caller,
            )
        assert caught.value.code == "idempotency_conflict"

    # The rejected re-submit must not create extra events or knowledge state,
    # and the single completed row must retain the tampered boolean.
    events = await get_events(pg.factory, user_id)
    assert [event.event_type for event in events] == ["analysis_completed"]
    assert events[0].details["unmapped"]["grammar"] is False
    assert await get_knowledge_states(pg.factory, user_id) == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
    assert job.status == AnalysisJobStatus.running


@pytest.mark.asyncio
async def test_basis_none_cannot_hide_persisted_pronunciation_rolls_back(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    assessment_id = uuid.uuid4()
    async with pg.factory() as db, db.begin():
        db.add(
            PronunciationAssessment(
                id=assessment_id,
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=TH_ALIGNMENT,
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )

    with pytest.raises(AnalysisExecutionError) as caught:
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            assessment = await db.get(PronunciationAssessment, assessment_id)
            coverage = {
                "pronunciation": {
                    "status": "not_called",
                    "reason": "disabled",
                    "result_count": None,
                    "reused": False,
                    "metadata": None,
                    "basis": "none",
                    "source_facts": None,
                },
                "grammar": {
                    "status": "not_called",
                    "reason": "not_reached",
                    "result_count": None,
                    "reused": False,
                    "metadata": None,
                    "basis": "none",
                    "source_facts": None,
                },
            }
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=assessment,
                grammar_errors=[],
                coverage=coverage,
                db=db,
            )

    assert caught.value.code == "coverage_invalid"
    assert "basis=none" in str(caught.value)
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assessment = await db.get(PronunciationAssessment, assessment_id)
    assert job.status == AnalysisJobStatus.running
    assert assessment is not None


@pytest.mark.asyncio
async def test_empty_object_alignment_reused_source_rejects_before_write(pg):
    """P1-4: persisted ``phoneme_alignment={}`` must not be silently skipped.

    An empty JSON object is not a legal ordered array. When the pronunciation
    source is reused from a previous invocation (not_called / existing_result /
    reused=True / persisted_rows with matching source facts), the shared
    canonical rules must reject it and roll back rather than treat it as zero
    observations.
    """
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    assessment_id = uuid.uuid4()
    async with pg.factory() as db, db.begin():
        db.add(
            PronunciationAssessment(
                id=assessment_id,
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment={},
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )

    with pytest.raises(AnalysisExecutionError) as caught:
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            assessment = await db.get(PronunciationAssessment, assessment_id)
            coverage = {
                "pronunciation": {
                    "status": "not_called",
                    "reason": "existing_result",
                    "result_count": None,
                    "reused": True,
                    "metadata": None,
                    "basis": "persisted_rows",
                    "source_facts": {
                        "source": "provider",
                        "provider": "elsa",
                        "model_version": "v1",
                        "is_synthetic": False,
                    },
                },
                "grammar": {
                    "status": "not_called",
                    "reason": "not_reached",
                    "result_count": None,
                    "reused": False,
                    "metadata": None,
                    "basis": "none",
                    "source_facts": None,
                },
            }
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=assessment,
                grammar_errors=[],
                coverage=coverage,
                db=db,
            )

    assert caught.value.code == "coverage_invalid"
    assert "phoneme_alignment must be an ordered array" in str(caught.value)
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assessment = await db.get(PronunciationAssessment, assessment_id)
    assert job.status == AnalysisJobStatus.running
    assert assessment is not None


@pytest.mark.asyncio
async def test_same_job_retry_does_not_duplicate_events(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                TH_ALIGNMENT,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            )
        },
    )

    real_analyze = analysis_jobs.analyze_session
    calls = {"n": 0}

    async def fail_first(session_id_arg, db):
        calls["n"] += 1
        if calls["n"] == 1:
            raise AnalysisExecutionError("forced_failure", "injected", retryable=True)
        return await real_analyze(session_id_arg, db)

    monkeypatch.setattr(analysis_jobs, "analyze_session", fail_first)

    # Claim to running so the injected failure is actually exercised (a pending
    # job would be rejected by ``execute_claimed_job`` before analyze runs).
    await claim_job(pg.factory, job_id)
    await analysis_jobs.process_job(job_id, pg.factory)
    assert calls["n"] == 1
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.pending
    assert await get_events(pg.factory, user_id) == []

    await run_job(pg.factory, job_id)
    assert calls["n"] == 2

    events = await get_events(pg.factory, user_id)
    completed = [e for e in events if e.event_type == "analysis_completed"]
    grammar_observations = [e for e in events if e.event_type == "grammar_observation"]
    assert len(completed) == 1
    assert len(grammar_observations) == 1


@pytest.mark.asyncio
async def test_complete_duplicate_batch_is_a_noop_without_reapplying_bkt(
    pg, monkeypatch
):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)
    grammar_id = uuid.uuid4()
    async with pg.factory() as db, db.begin():
        db.add(
            GrammarError(
                id=grammar_id,
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

    write = _write_learning_events()

    async def write_once() -> None:
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            grammar = await db.get(GrammarError, grammar_id)
            await write(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage=_coverage_for(None, [grammar]),
                db=db,
            )

    await write_once()
    first_states = await get_knowledge_states(pg.factory, user_id)
    assert len(first_states) == 1
    first_mastery = first_states[0].p_mastery
    first_events = await get_events(pg.factory, user_id)
    assert [event.event_type for event in first_events] == [
        "analysis_completed",
        "grammar_observation",
    ]

    await write_once()

    second_events = await get_events(pg.factory, user_id)
    second_states = await get_knowledge_states(pg.factory, user_id)
    assert len(second_states) == 1
    assert [event.apply_seq for event in second_events] == [
        event.apply_seq for event in first_events
    ]
    assert second_states[0].p_mastery == first_mastery


@pytest.mark.asyncio
async def test_idempotency_partial_residual_fails_closed(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    grammar_id = uuid.uuid4()
    ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
    async with pg.factory() as db, db.begin():
        db.add(
            GrammarError(
                id=grammar_id,
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
            KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id="verb_tense_past",
                p_mastery=0.3,
            )
        )
        db.add(
            LearningEvent(
                **grammar_observation_values(
                    key=f"job:{job_id}:grammar:0",
                    user_id=user_id,
                    session_id=session_id,
                    job_id=job_id,
                    grammar_id=grammar_id,
                    skill_id="verb_tense_past",
                    occurred_at=ended_at,
                    is_synthetic=False,
                )
            )
        )

    write = _write_learning_events()
    with pytest.raises(AnalysisExecutionError):
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            grammar = await db.get(GrammarError, grammar_id)
            await write(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage=_coverage_for(None, [grammar]),
                db=db,
            )

    events = await get_events(pg.factory, user_id)
    grammar_observations = [e for e in events if e.event_type == "grammar_observation"]
    completed = [e for e in events if e.event_type == "analysis_completed"]
    # A half-committed batch (one observation, no completed event) cannot prove
    # the previous write finished, so the writer must fail closed and add nothing.
    assert len(grammar_observations) == 1
    assert completed == []
    states = await get_knowledge_states(pg.factory, user_id)
    assert {s.skill_id: s.p_mastery for s in states} == {"verb_tense_past": 0.3}
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.running


@pytest.mark.asyncio
async def test_idempotency_rejects_renamed_completed_key_before_insert(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)
    ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
    coverage = _coverage_for(None, [])

    async with pg.factory() as db, db.begin():
        values = completed_event_values(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            occurred_at=ended_at,
            coverage=coverage,
            unmapped_pronunciation=0,
            unmapped_grammar=0,
        )
        values["idempotency_key"] = f"foreign:{job_id}:completed"
        db.add(LearningEvent(**values))

    with pytest.raises(AnalysisExecutionError) as exc_info:
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[],
                coverage=coverage,
                db=db,
            )

    assert exc_info.value.code == "idempotency_conflict"
    events = await get_events(pg.factory, user_id)
    assert [event.idempotency_key for event in events] == [
        f"foreign:{job_id}:completed"
    ]
    assert await get_knowledge_states(pg.factory, user_id) == []


@pytest.mark.parametrize(
    "mutation",
    [
        lambda details: details["unmapped"].update(grammar=False),
        lambda details: details["coverage"]["grammar"].update(result_count=True),
    ],
)
@pytest.mark.asyncio
async def test_idempotency_rejects_nested_json_type_drift(pg, mutation):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)
    ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
    grammar_id = uuid.uuid4()

    async with pg.factory() as db, db.begin():
        grammar = GrammarError(
            id=grammar_id,
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
        db.add(grammar)
        await db.flush()
        values = completed_event_values(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            occurred_at=ended_at,
            coverage=_coverage_for(None, [grammar]),
            unmapped_pronunciation=0,
            unmapped_grammar=0,
        )
        mutation(values["details"])
        db.add(LearningEvent(**values))
        db.add(
            LearningEvent(
                **grammar_observation_values(
                    key=f"job:{job_id}:grammar:0",
                    user_id=user_id,
                    session_id=session_id,
                    job_id=job_id,
                    grammar_id=grammar_id,
                    skill_id="verb_tense_past",
                    occurred_at=ended_at,
                    is_synthetic=False,
                )
            )
        )
        db.add(
            KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id="verb_tense_past",
                p_mastery=0.3,
            )
        )

    with pytest.raises(AnalysisExecutionError) as exc_info:
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            grammar = await db.get(GrammarError, grammar_id)
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage=_coverage_for(None, [grammar]),
                db=db,
            )

    assert exc_info.value.code == "idempotency_conflict"
    states = await get_knowledge_states(pg.factory, user_id)
    assert [(state.skill_id, state.p_mastery) for state in states] == [
        ("verb_tense_past", 0.3)
    ]
    events = await get_events(pg.factory, user_id)
    assert len(events) == 2


@pytest.mark.asyncio
async def test_idempotency_conflicting_payload_fails_closed(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    grammar_id = uuid.uuid4()
    ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
    async with pg.factory() as db, db.begin():
        db.add(
            GrammarError(
                id=grammar_id,
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
            LearningEvent(
                **grammar_observation_values(
                    key=f"job:{job_id}:grammar:0",
                    user_id=user_id,
                    session_id=session_id,
                    job_id=job_id,
                    grammar_id=grammar_id,
                    skill_id="subject_verb_agreement",
                    occurred_at=ended_at,
                    is_synthetic=False,
                )
            )
        )

    write = _write_learning_events()
    with pytest.raises(AnalysisExecutionError):
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            grammar = await db.get(GrammarError, grammar_id)
            await write(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage=_coverage_for(None, [grammar]),
                db=db,
            )

    events = await get_events(pg.factory, user_id)
    completed = [e for e in events if e.event_type == "analysis_completed"]
    assert completed == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.running


@pytest.mark.asyncio
async def test_idempotency_completed_coverage_change_fails_closed(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    grammar_id = uuid.uuid4()
    ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
    stale_coverage = _coverage_for(None, [])
    async with pg.factory() as db, db.begin():
        db.add(
            GrammarError(
                id=grammar_id,
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
            LearningEvent(
                **completed_event_values(
                    user_id=user_id,
                    session_id=session_id,
                    job_id=job_id,
                    occurred_at=ended_at,
                    coverage=stale_coverage,
                    unmapped_pronunciation=0,
                    unmapped_grammar=0,
                )
            )
        )

    grammar = None
    async with pg.factory() as db:
        grammar = await db.get(GrammarError, grammar_id)

    write = _write_learning_events()
    with pytest.raises(AnalysisExecutionError):
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            await write(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage=_coverage_for(None, [grammar]),
                db=db,
            )

    events = await get_events(pg.factory, user_id)
    observations = [e for e in events if e.event_type != "analysis_completed"]
    assert observations == []
    assert await get_knowledge_states(pg.factory, user_id) == []


@pytest.mark.asyncio
async def test_foreign_completed_key_with_zero_observations_fails_closed(
    pg, monkeypatch
):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)

    foreign_user_id = await pg.new_user()
    foreign_session_id = await pg.new_session(foreign_user_id)
    foreign_job_id = await pg.new_job(foreign_session_id)
    ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
    coverage = _coverage_for(None, [])

    async with pg.factory() as db, db.begin():
        foreign_completed = completed_event_values(
            user_id=foreign_user_id,
            session_id=foreign_session_id,
            job_id=foreign_job_id,
            occurred_at=ended_at,
            coverage=coverage,
            unmapped_pronunciation=0,
            unmapped_grammar=0,
        )
        # The global key names the target job even though every ownership FK
        # points at a different, valid job/session/user.
        foreign_completed["idempotency_key"] = f"job:{job_id}:completed"
        db.add(LearningEvent(**foreign_completed))

    install_analysis(monkeypatch, {session_id: (None, [])})

    with pytest.raises(AnalysisExecutionError) as exc_info:
        await run_job(pg.factory, job_id)

    assert exc_info.value.code == "idempotency_conflict"
    assert await get_events(pg.factory, user_id) == []
    assert await get_knowledge_states(pg.factory, user_id) == []
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.pending
        assert job.attempt_count == 0
        foreign_event = await db.scalar(
            select(LearningEvent).where(
                LearningEvent.idempotency_key == f"job:{job_id}:completed"
            )
        )
        assert foreign_event is not None
        assert foreign_event.analysis_job_id == foreign_job_id


@pytest.mark.asyncio
async def test_idempotency_unexpected_residual_observation_fails_closed(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    grammar_id = uuid.uuid4()
    extra_grammar_id = uuid.uuid4()
    ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
    async with pg.factory() as db, db.begin():
        db.add(
            GrammarError(
                id=grammar_id,
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
                id=extra_grammar_id,
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
        coverage = _coverage_for(
            None,
            [
                GrammarError(
                    skill_tag="verb_tense_past",
                    source="provider",
                    provider="llm",
                    model_version="v1",
                    is_synthetic=False,
                )
            ],
        )
        db.add(
            LearningEvent(
                **completed_event_values(
                    user_id=user_id,
                    session_id=session_id,
                    job_id=job_id,
                    occurred_at=ended_at,
                    coverage=coverage,
                    unmapped_pronunciation=0,
                    unmapped_grammar=0,
                )
            )
        )
        # A non-canonical observation whose key is absent from the expected
        # batch must not be silently accepted or repaired.
        db.add(
            LearningEvent(
                **grammar_observation_values(
                    key=f"job:{job_id}:grammar:1",
                    user_id=user_id,
                    session_id=session_id,
                    job_id=job_id,
                    grammar_id=extra_grammar_id,
                    skill_id="verb_tense_past",
                    occurred_at=ended_at,
                    is_synthetic=False,
                )
            )
        )

    grammar = None
    async with pg.factory() as db:
        grammar = await db.get(GrammarError, grammar_id)

    write = _write_learning_events()
    with pytest.raises(AnalysisExecutionError):
        async with pg.factory() as db, db.begin():
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            await write(
                job=job,
                session=session,
                user_id=user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage=_coverage_for(None, [grammar]),
                db=db,
            )

    events = await get_events(pg.factory, user_id)
    observations = [e for e in events if e.event_type != "analysis_completed"]
    assert {e.idempotency_key for e in observations} == {f"job:{job_id}:grammar:1"}
    assert await get_knowledge_states(pg.factory, user_id) == []


@pytest.mark.asyncio
async def test_multiple_observations_batch_read_knowledge_states(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                [
                    {
                        "type": "substitution",
                        "expected": "TH",
                        "actual": "S",
                        "position": 0,
                    },
                    {
                        "type": "deletion",
                        "expected": "TH",
                        "actual": None,
                        "position": 1,
                    },
                ],
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            )
        },
    )

    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(pg.engine.sync_engine, "before_cursor_execute", capture)
    try:
        await run_job(pg.factory, job_id)
    finally:
        sa_event.remove(pg.engine.sync_engine, "before_cursor_execute", capture)

    knowledge_selects = [
        s for s in statements if "FROM knowledge_states" in s and "INSERT" not in s
    ]
    assert len(knowledge_selects) == 1
    states = await get_knowledge_states(pg.factory, user_id)
    assert {s.skill_id for s in states} == {"th_sounds", "verb_tense_past"}


@pytest.mark.asyncio
async def test_old_unproven_knowledge_state_fails_closed(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    old_session = await pg.new_session(user_id)
    await pg.new_transcript(old_session)
    old_job_id = await pg.new_job(old_session, status=AnalysisJobStatus.succeeded)
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            )
        },
    )
    old_grammar_id = uuid.uuid4()
    ended_at = datetime(2026, 11, 12, 10, 30, tzinfo=UTC)
    old_coverage = _coverage_for(
        None,
        [
            GrammarError(
                skill_tag="verb_tense_past",
                source="provider",
                provider="llm",
                model_version="v1",
                is_synthetic=False,
            )
        ],
    )
    old_coverage["grammar"] = {
        key: value
        for key, value in old_coverage["grammar"].items()
        if key in {"status", "reason", "result_count", "reused", "metadata"}
    }
    async with pg.factory() as db, db.begin():
        db.add(
            GrammarError(
                id=old_grammar_id,
                session_id=old_session,
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
            LearningEvent(
                **grammar_observation_values(
                    key=f"job:{old_job_id}:grammar:0",
                    user_id=user_id,
                    session_id=old_session,
                    job_id=old_job_id,
                    grammar_id=old_grammar_id,
                    skill_id="verb_tense_past",
                    occurred_at=ended_at,
                    is_synthetic=False,
                )
            )
        )
        db.add(
            LearningEvent(
                **completed_event_values(
                    user_id=user_id,
                    session_id=old_session,
                    job_id=old_job_id,
                    occurred_at=ended_at,
                    coverage=old_coverage,
                    unmapped_pronunciation=0,
                    unmapped_grammar=0,
                )
            )
        )
        db.add(
            KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id="verb_tense_past",
                p_mastery=0.9,
            )
        )

    with pytest.raises(AnalysisExecutionError) as exc_info:
        await run_job(pg.factory, job_id)

    assert exc_info.value.code == "knowledge_state_provenance_conflict"
    events = await get_events(pg.factory, user_id)
    assert {event.analysis_job_id for event in events} == {old_job_id}
    states = await get_knowledge_states(pg.factory, user_id)
    assert [(state.skill_id, state.p_mastery) for state in states] == [
        ("verb_tense_past", 0.9)
    ]
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.pending


@pytest.mark.parametrize(
    "tamper",
    ["observation_facts", "completed_facts", "synthetic_observation"],
)
@pytest.mark.asyncio
async def test_prior_history_must_match_complete_real_source_rows(
    pg, monkeypatch, tamper
):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    first_session = await pg.new_session(user_id)
    await pg.new_transcript(first_session)
    first_job = await pg.new_job(first_session)
    second_session = await pg.new_session(user_id)
    await pg.new_transcript(second_session)
    second_job = await pg.new_job(second_session)
    install_analysis(
        monkeypatch,
        {
            first_session: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
            second_session: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
        },
    )

    await run_job(pg.factory, first_job)
    first_state = (await get_knowledge_states(pg.factory, user_id))[0]
    first_mastery = first_state.p_mastery

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.analysis_job_id == first_job,
                    LearningEvent.event_type == "analysis_completed",
                )
            )
        ).scalar_one()
        observation = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.analysis_job_id == first_job,
                    LearningEvent.event_type == "grammar_observation",
                )
            )
        ).scalar_one()
        if tamper == "observation_facts":
            observation.provider = "tampered-provider"
        elif tamper == "completed_facts":
            tampered_details = copy.deepcopy(completed.details)
            tampered_details["coverage"]["grammar"]["source_facts"]["provider"] = (
                "tampered-provider"
            )
            completed.details = tampered_details
        else:
            observation.is_synthetic = True

    # JSONB nested mutations are not tracked by SQLAlchemy, so confirm the
    # tamper was actually persisted from a fresh connection before relying on
    # the provenance gate to reject the second job.
    async with pg.factory() as db:
        persisted_completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.analysis_job_id == first_job,
                    LearningEvent.event_type == "analysis_completed",
                )
            )
        ).scalar_one()
        persisted_observation = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.analysis_job_id == first_job,
                    LearningEvent.event_type == "grammar_observation",
                )
            )
        ).scalar_one()
    if tamper == "observation_facts":
        assert persisted_observation.provider == "tampered-provider"
    elif tamper == "completed_facts":
        assert (
            persisted_completed.details["coverage"]["grammar"]["source_facts"][
                "provider"
            ]
            == "tampered-provider"
        )
    else:
        assert persisted_observation.is_synthetic is True

    with pytest.raises(AnalysisExecutionError) as exc_info:
        await run_job(pg.factory, second_job)

    assert exc_info.value.code == "knowledge_state_provenance_conflict"
    states = await get_knowledge_states(pg.factory, user_id)
    assert [(state.skill_id, state.p_mastery) for state in states] == [
        ("verb_tense_past", first_mastery)
    ]
    events = await get_events(pg.factory, user_id)
    assert {event.analysis_job_id for event in events} == {first_job}
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, second_job)
        assert job.status == AnalysisJobStatus.pending


@pytest.mark.asyncio
async def test_current_job_events_cannot_support_a_preexisting_state(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            )
        },
    )

    async with pg.factory() as db, db.begin():
        db.add(
            KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id="verb_tense_past",
                p_mastery=0.9,
            )
        )

    with pytest.raises(AnalysisExecutionError) as exc_info:
        await run_job(pg.factory, job_id)

    assert exc_info.value.code == "knowledge_state_provenance_conflict"
    assert await get_events(pg.factory, user_id) == []
    states = await get_knowledge_states(pg.factory, user_id)
    assert [(state.skill_id, state.p_mastery) for state in states] == [
        ("verb_tense_past", 0.9)
    ]
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
        assert job.status == AnalysisJobStatus.pending


@pytest.mark.asyncio
async def test_new_knowledge_state_starts_from_frozen_p_init(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            )
        },
    )

    await run_job(pg.factory, job_id)

    states = await get_knowledge_states(pg.factory, user_id)
    assert len(states) == 1
    params = BKTParams(**FROZEN_BKT_PARAMS)
    expected = update_mastery(params.p_init, False, params)
    assert states[0].skill_id == "verb_tense_past"
    assert abs(states[0].p_mastery - expected) < 1e-9


@pytest.mark.asyncio
async def test_knowledge_state_with_prior_real_b2_history_updates(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    first_session = await pg.new_session(user_id)
    await pg.new_transcript(first_session)
    first_job = await pg.new_job(first_session)
    second_session = await pg.new_session(user_id)
    await pg.new_transcript(second_session)
    second_job = await pg.new_job(second_session)
    install_analysis(
        monkeypatch,
        {
            first_session: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
            second_session: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
        },
    )

    await run_job(pg.factory, first_job)
    first_states = await get_knowledge_states(pg.factory, user_id)
    assert len(first_states) == 1
    first_mastery = first_states[0].p_mastery

    await run_job(pg.factory, second_job)

    states = await get_knowledge_states(pg.factory, user_id)
    params = BKTParams(**FROZEN_BKT_PARAMS)
    expected = update_mastery(first_mastery, False, params)
    assert len(states) == 1
    assert states[0].skill_id == "verb_tense_past"
    assert abs(states[0].p_mastery - expected) < 1e-9


@pytest.mark.asyncio
async def test_persisted_rows_history_supports_the_next_real_update(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    first_session = await pg.new_session(user_id)
    await pg.new_transcript(first_session)
    first_job = await pg.new_job(first_session)
    second_session = await pg.new_session(user_id)
    await pg.new_transcript(second_session)
    second_job = await pg.new_job(second_session)

    async def fake_analyze(session_id, db):
        skill_tag = "verb_tense_past"
        error_type = "wrong_tense"
        grammar_error = GrammarError(
            id=uuid.uuid4(),
            session_id=session_id,
            skill_tag=skill_tag,
            original="I go",
            corrected="I went",
            error_type=error_type,
            source="provider",
            provider="llm",
            model_version="v1",
            is_synthetic=False,
            confidence=0.9,
        )
        db.add(grammar_error)
        await db.flush()
        coverage = _coverage_for(None, [grammar_error])
        if session_id == first_session:
            coverage["grammar"].update(
                status="not_called",
                reason="existing_result",
                result_count=None,
                reused=True,
                metadata=None,
                basis="persisted_rows",
            )
        return _AnalysisResult(
            assessment=None,
            grammar_errors=[grammar_error],
            coverage=coverage,
        )

    monkeypatch.setattr(analysis_jobs, "analyze_session", fake_analyze)

    await run_job(pg.factory, first_job)
    first_states = await get_knowledge_states(pg.factory, user_id)
    assert len(first_states) == 1
    first_mastery = first_states[0].p_mastery
    first_events = await get_events(pg.factory, user_id)
    first_completed = next(
        event for event in first_events if event.event_type == "analysis_completed"
    )
    assert first_completed.details["coverage"]["grammar"]["status"] == "not_called"
    assert first_completed.details["coverage"]["grammar"]["basis"] == "persisted_rows"

    await run_job(pg.factory, second_job)

    states = await get_knowledge_states(pg.factory, user_id)
    params = BKTParams(**FROZEN_BKT_PARAMS)
    expected = update_mastery(first_mastery, False, params)
    assert len(states) == 1
    assert states[0].skill_id == "verb_tense_past"
    assert abs(states[0].p_mastery - expected) < 1e-9


@pytest.mark.asyncio
async def test_prior_real_history_with_missing_state_fails_closed(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    first_session = await pg.new_session(user_id)
    await pg.new_transcript(first_session)
    first_job = await pg.new_job(first_session)
    second_session = await pg.new_session(user_id)
    await pg.new_transcript(second_session)
    second_job = await pg.new_job(second_session)
    install_analysis(
        monkeypatch,
        {
            first_session: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
            second_session: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
        },
    )

    await run_job(pg.factory, first_job)
    async with pg.factory() as db, db.begin():
        await db.execute(
            delete(KnowledgeState).where(KnowledgeState.user_id == user_id)
        )

    with pytest.raises(AnalysisExecutionError) as exc_info:
        await run_job(pg.factory, second_job)

    assert exc_info.value.code == "knowledge_state_provenance_conflict"
    assert await get_knowledge_states(pg.factory, user_id) == []
    events = await get_events(pg.factory, user_id)
    assert {event.analysis_job_id for event in events} == {first_job}
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, second_job)
        assert job.status == AnalysisJobStatus.pending


@pytest.mark.asyncio
async def test_unmapped_pronunciation_is_counted_without_renumbering(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)
    install_analysis(
        monkeypatch,
        {
            session_id: (
                [
                    {
                        "type": "substitution",
                        "expected": None,
                        "actual": "S",
                        "position": 0,
                    },
                    {
                        "type": "substitution",
                        "expected": "TH",
                        "actual": "S",
                        "position": 1,
                    },
                ],
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            )
        },
    )

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    completed = [e for e in events if e.event_type == "analysis_completed"]
    assert len(completed) == 1
    assert completed[0].details["unmapped"]["pronunciation"] == 1
    assert completed[0].details["unmapped"]["grammar"] == 0
    pronunciation = [e for e in events if e.event_type == "pronunciation_observation"]
    assert [e.source_ordinal for e in pronunciation] == [1]


@pytest.mark.asyncio
async def test_same_user_two_jobs_serialize_without_interleaving(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_a = await pg.new_session(user_id)
    session_b = await pg.new_session(user_id)
    await pg.new_transcript(session_a)
    await pg.new_transcript(session_b)
    job_a = await pg.new_job(session_a)
    job_b = await pg.new_job(session_b)
    install_analysis(
        monkeypatch,
        {
            session_a: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
            session_b: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
        },
    )
    await claim_job(pg.factory, job_a)
    await claim_job(pg.factory, job_b)

    await _execute_two_jobs_observing_user_lock(
        pg,
        monkeypatch,
        job_a=job_a,
        job_b=job_b,
    )

    events = await get_events(pg.factory, user_id)
    by_job: dict[uuid.UUID, list[int]] = {}
    for event in events:
        by_job.setdefault(event.analysis_job_id, []).append(event.apply_seq)
    assert set(by_job) == {job_a, job_b}
    a_seqs, b_seqs = by_job[job_a], by_job[job_b]
    assert max(a_seqs) < min(b_seqs) or max(b_seqs) < min(a_seqs)


@pytest.mark.asyncio
async def test_same_user_first_knowledge_state_creation_race(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_a = await pg.new_session(user_id)
    session_b = await pg.new_session(user_id)
    await pg.new_transcript(session_a)
    await pg.new_transcript(session_b)
    job_a = await pg.new_job(session_a)
    job_b = await pg.new_job(session_b)
    install_analysis(
        monkeypatch,
        {
            session_a: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
            session_b: (
                None,
                [{"skill_tag": "verb_tense_past", "error_type": "wrong_tense"}],
            ),
        },
    )
    await claim_job(pg.factory, job_a)
    await claim_job(pg.factory, job_b)

    await _execute_two_jobs_observing_user_lock(
        pg,
        monkeypatch,
        job_a=job_a,
        job_b=job_b,
    )

    states = await get_knowledge_states(pg.factory, user_id)
    assert len(states) == 1
    assert states[0].skill_id == "verb_tense_past"
    params = BKTParams(**FROZEN_BKT_PARAMS)
    expected = update_mastery(
        update_mastery(params.p_init, False, params), False, params
    )
    assert abs(states[0].p_mastery - expected) < 1e-9


@pytest.mark.asyncio
async def test_production_executor_waits_on_shared_barrier_before_analysis(
    pg, monkeypatch
):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    analyzed: list[uuid.UUID] = []

    async def fake_analyze(session_id_arg, db):
        analyzed.append(session_id_arg)
        grammar_error = GrammarError(
            id=uuid.uuid4(),
            session_id=session_id_arg,
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
        db.add(grammar_error)
        await db.flush()
        return _AnalysisResult(
            assessment=None,
            grammar_errors=[grammar_error],
            coverage=_coverage_for(None, [grammar_error]),
        )

    monkeypatch.setattr(analysis_jobs, "analyze_session", fake_analyze)

    hold = asyncio.Event()
    release = asyncio.Event()

    async def hold_exclusive():
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b2-prod-exec-holder"},
            )
            await acquire_exclusive_lifecycle_barrier(db)
            hold.set()
            await release.wait()

    async def run_executor():
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b2-prod-exec-executor"},
            )
            await analysis_jobs.execute_claimed_job(job_id, db)

    holder = asyncio.create_task(hold_exclusive())
    executor = None
    try:
        await asyncio.wait_for(hold.wait(), timeout=5)
        executor = asyncio.create_task(run_executor())
        waiter_pid, holders = await _wait_for_advisory_barrier_block(
            pg.factory, "b2-prod-exec-executor"
        )
        holder_pid = await _application_pid(pg.factory, "b2-prod-exec-holder")
        assert waiter_pid != holder_pid
        assert holder_pid in holders
        assert analyzed == []
        assert await get_events(pg.factory, user_id) == []

        release.set()
        await asyncio.wait_for(executor, timeout=5)
    finally:
        release.set()
        for task in (holder, executor):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (holder, executor) if task is not None),
            return_exceptions=True,
        )

    assert analyzed == [session_id]
    events = await get_events(pg.factory, user_id)
    assert any(event.event_type == "analysis_completed" for event in events)
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
    assert job.status == AnalysisJobStatus.succeeded


@pytest.mark.asyncio
async def test_direct_writer_waits_on_shared_barrier_before_writing(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, status=AnalysisJobStatus.running)

    assessment_id = uuid.uuid4()
    grammar_id = uuid.uuid4()
    async with pg.factory() as db, db.begin():
        db.add(
            PronunciationAssessment(
                id=assessment_id,
                session_id=session_id,
                overall_score=75.0,
                phoneme_alignment=TH_ALIGNMENT,
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
            )
        )
        db.add(
            GrammarError(
                id=grammar_id,
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

    hold = asyncio.Event()
    release = asyncio.Event()

    async def hold_exclusive():
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b2-direct-holder"},
            )
            await acquire_exclusive_lifecycle_barrier(db)
            hold.set()
            await release.wait()

    async def run_writer():
        async with pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b2-direct-writer"},
            )
            job = await db.get(AnalysisJob, job_id)
            session = await db.get(Session, session_id)
            assessment = await db.get(PronunciationAssessment, assessment_id)
            grammar = await db.get(GrammarError, grammar_id)
            await _write_learning_events()(
                job=job,
                session=session,
                user_id=user_id,
                assessment=assessment,
                grammar_errors=[grammar],
                coverage=_coverage_for(assessment, [grammar]),
                db=db,
            )
            # Direct callers own the success-chain transition: the writer only
            # persists events and BKT inside the same transaction.  Mirror the
            # production executor so this positive fixture stays on-contract.
            analysis_jobs.transition_job(job, AnalysisJobStatus.succeeded)

    holder = asyncio.create_task(hold_exclusive())
    writer = None
    try:
        await asyncio.wait_for(hold.wait(), timeout=5)
        writer = asyncio.create_task(run_writer())
        waiter_pid, holders = await _wait_for_advisory_barrier_block(
            pg.factory, "b2-direct-writer"
        )
        holder_pid = await _application_pid(pg.factory, "b2-direct-holder")
        assert waiter_pid != holder_pid
        assert holder_pid in holders
        assert await get_events(pg.factory, user_id) == []

        release.set()
        await asyncio.wait_for(writer, timeout=5)
    finally:
        release.set()
        for task in (holder, writer):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (holder, writer) if task is not None),
            return_exceptions=True,
        )

    events = await get_events(pg.factory, user_id)
    assert any(event.event_type == "analysis_completed" for event in events)
    async with pg.factory() as db:
        job = await db.get(AnalysisJob, job_id)
    assert job.status == AnalysisJobStatus.succeeded
