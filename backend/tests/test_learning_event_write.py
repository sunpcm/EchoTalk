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

    B1-2 changes ``analyze_session`` to return the explicit grammar rows and
    per-direction coverage alongside the assessment, so the event writer never
    re-reads source tables or guesses a missing direction from ``None``.  The
    fake adapters below return this same shape.
    """

    assessment: PronunciationAssessment | None = None
    grammar_errors: list[GrammarError] = field(default_factory=list)
    coverage: dict[str, Any] = field(default_factory=dict)


def _coverage_for(
    assessment: PronunciationAssessment | None,
    grammar_errors: Sequence[GrammarError],
) -> dict[str, Any]:
    first_grammar = grammar_errors[0] if grammar_errors else None
    return {
        "pronunciation": {
            "status": "evaluated" if assessment is not None else "not_called",
            "source": assessment.source if assessment is not None else None,
            "provider": assessment.provider if assessment is not None else None,
            "model_version": assessment.model_version
            if assessment is not None
            else None,
            "is_synthetic": assessment.is_synthetic if assessment is not None else None,
        },
        "grammar": {
            "status": "evaluated",
            "source": first_grammar.source if first_grammar is not None else None,
            "provider": first_grammar.provider if first_grammar is not None else None,
            "model_version": first_grammar.model_version
            if first_grammar is not None
            else None,
            "is_synthetic": first_grammar.is_synthetic
            if first_grammar is not None
            else None,
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
            if not self.user_ids:
                return
            await db.execute(
                delete(LearningEvent).where(LearningEvent.user_id.in_(self.user_ids))
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
                delete(KnowledgeState).where(KnowledgeState.user_id.in_(self.user_ids))
            )
            await db.execute(delete(Session).where(Session.user_id.in_(self.user_ids)))
            await db.execute(delete(User).where(User.id.in_(self.user_ids)))
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
    assert coverage.get("grammar", {}).get("status") == "evaluated"
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
async def test_old_pending_job_runs_new_path(pg):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id, attempt_count=1)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    assert any(e.event_type == "analysis_completed" for e in events)


@pytest.mark.asyncio
async def test_old_failed_job_retry_runs_new_path(pg):
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
async def test_unknown_model_version_stays_null(pg, monkeypatch):
    await pg.ensure_seed_skills()
    user_id = await pg.new_user()
    session_id = await pg.new_session(user_id)
    await pg.new_transcript(session_id)
    job_id = await pg.new_job(session_id)

    async def legacy_analyze(session_id_arg, db):
        assessment = PronunciationAssessment(
            id=uuid.uuid4(),
            session_id=session_id_arg,
            overall_score=75.0,
            phoneme_alignment=TH_ALIGNMENT,
            source="legacy_mock",
            provider=None,
            model_version=None,
            is_synthetic=False,
            confidence=None,
        )
        db.add(assessment)
        grammar_error = GrammarError(
            id=uuid.uuid4(),
            session_id=session_id_arg,
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
        db.add(grammar_error)
        await db.flush()
        return _AnalysisResult(
            assessment=assessment,
            grammar_errors=[grammar_error],
            coverage=_coverage_for(assessment, [grammar_error]),
        )

    monkeypatch.setattr(analysis_jobs, "analyze_session", legacy_analyze)

    await run_job(pg.factory, job_id)

    events = await get_events(pg.factory, user_id)
    observations = [e for e in events if e.event_type != "analysis_completed"]
    assert observations
    assert all(e.model_version is None for e in observations)


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

    async def execute(job_id):
        async with pg.factory() as db, db.begin():
            await analysis_jobs.execute_claimed_job(job_id, db)

    await asyncio.gather(execute(job_a), execute(job_b))

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

    async def execute(job_id):
        async with pg.factory() as db, db.begin():
            await analysis_jobs.execute_claimed_job(job_id, db)

    await asyncio.gather(execute(job_a), execute(job_b))

    states = await get_knowledge_states(pg.factory, user_id)
    assert len(states) == 1
    assert states[0].skill_id == "verb_tense_past"
    params = BKTParams(**FROZEN_BKT_PARAMS)
    expected = update_mastery(
        update_mastery(params.p_init, False, params), False, params
    )
    assert abs(states[0].p_mastery - expected) < 1e-9
