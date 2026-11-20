"""B2 S3 read-only learning-event replay validation tests.

This file keeps the pure offline checks for the frozen replay helpers plus real
PostgreSQL cases that exercise the complete ``validate_learning_event_replay``
clean-start path.  The validator must own one ``REPEATABLE READ READ ONLY``
transaction, fix the first-data-query ``MAX(apply_seq)`` watermark, read the same
snapshot for every later lookup, report every detected defect with a stable code
and never repair a row.

Real PostgreSQL tests are guarded by the dedicated synthetic database boundary
and are run by the maintainer; the implementation author only runs Ruff,
``compileall`` and the offline cases.
"""

import os
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import delete, inspect, select, text
from sqlalchemy import event as sa_event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session as SyncSession
from sqlalchemy.orm.attributes import flag_modified, set_committed_value

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.session import Session, SessionMode, SessionStatus
from models.user import User
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.learning_event_canonical import (
    CanonicalObservationError,
    build_canonical_observations,
    candidate_skills,
)
from services.learning_event_replay import (
    FROZEN_BKT_PARAMS,
    FROZEN_BKT_VERSION,
    _canonical_key_matches,
    _normalize_algorithms,
    _params_match,
    _schema_version_matches,
    _source_matches,
    validate_learning_event_replay,
)


def _issue_tuples(report) -> set[tuple[str, uuid.UUID | None, str | None]]:
    return {(issue.code, issue.user_id, issue.skill_id) for issue in report.issues}


# ---------------------------------------------------------------------------
# Pure offline helper checks
# ---------------------------------------------------------------------------


def _event(**kwargs: Any) -> LearningEvent:
    defaults: dict[str, Any] = {
        "idempotency_key": "placeholder",
        "event_type": "grammar_observation",
        "user_id": uuid.uuid4(),
        "source": "provider",
    }
    defaults.update(kwargs)
    return LearningEvent(**defaults)


def test_normalize_algorithms_rejects_bool_string_and_bad_key_set():
    ok = _normalize_algorithms({FROZEN_BKT_VERSION: dict(FROZEN_BKT_PARAMS)})
    assert ok[FROZEN_BKT_VERSION] == BKTParams(**FROZEN_BKT_PARAMS)

    assert (
        _normalize_algorithms(
            {
                FROZEN_BKT_VERSION: {
                    "p_init": True,
                    "p_transit": 0.2,
                    "p_slip": 0.1,
                    "p_guess": 0.2,
                }
            }
        )
        == {}
    )
    assert (
        _normalize_algorithms(
            {
                FROZEN_BKT_VERSION: {
                    "p_init": "0.1",
                    "p_transit": 0.2,
                    "p_slip": 0.1,
                    "p_guess": 0.2,
                }
            }
        )
        == {}
    )
    assert (
        _normalize_algorithms({FROZEN_BKT_VERSION: {"p_init": 0.1, "p_transit": 0.2}})
        == {}
    )
    assert (
        _normalize_algorithms(
            {
                FROZEN_BKT_VERSION: {
                    "p_init": float("nan"),
                    "p_transit": 0.2,
                    "p_slip": 0.1,
                    "p_guess": 0.2,
                }
            }
        )
        == {}
    )
    assert (
        _normalize_algorithms(
            {
                FROZEN_BKT_VERSION: {
                    "p_init": float("inf"),
                    "p_transit": 0.2,
                    "p_slip": 0.1,
                    "p_guess": 0.2,
                }
            }
        )
        == {}
    )
    assert _normalize_algorithms({}) == {}


def test_params_match_requires_exact_numeric_values_without_bool_or_string():
    expected = BKTParams(**FROZEN_BKT_PARAMS)
    assert _params_match(dict(FROZEN_BKT_PARAMS), expected)
    assert not _params_match(
        {
            "p_init": 0.1,
            "p_transit": 0.2,
            "p_slip": 0.1,
            "p_guess": True,
        },
        expected,
    )
    assert not _params_match(
        {
            "p_init": 0.1,
            "p_transit": 0.2,
            "p_slip": 0.1,
            "p_guess": "0.2",
        },
        expected,
    )
    assert not _params_match(
        {
            "p_init": 0.1,
            "p_transit": 0.2,
            "p_slip": 0.1,
            "p_guess": 0.2000000001,
        },
        expected,
    )
    assert not _params_match({"p_init": 0.1}, expected)


def test_canonical_key_matches_for_every_frozen_shape():
    job_id = uuid.uuid4()
    user_id = uuid.uuid4()
    skill_id = "verb_tense_past"

    assert _canonical_key_matches(
        _event(
            event_type="analysis_completed",
            idempotency_key=f"job:{job_id}:completed",
            analysis_job_id=job_id,
        )
    )
    assert not _canonical_key_matches(
        _event(
            event_type="analysis_completed",
            idempotency_key="wrong",
            analysis_job_id=job_id,
        )
    )
    assert _canonical_key_matches(
        _event(
            event_type="pronunciation_observation",
            idempotency_key=f"job:{job_id}:pron:2",
            analysis_job_id=job_id,
            source_ordinal=2,
        )
    )
    assert _canonical_key_matches(
        _event(
            event_type="grammar_observation",
            idempotency_key=f"job:{job_id}:grammar:0",
            analysis_job_id=job_id,
            source_ordinal=0,
        )
    )
    assert _canonical_key_matches(
        _event(
            event_type="baseline_snapshot",
            idempotency_key=f"baseline:rev1:{user_id}:{skill_id}",
            cutover_revision="rev1",
            user_id=user_id,
            skill_id=skill_id,
        )
    )
    assert not _canonical_key_matches(
        _event(
            event_type="baseline_snapshot",
            idempotency_key="bad",
            cutover_revision="rev1",
            user_id=user_id,
            skill_id=skill_id,
        )
    )
    assert not _canonical_key_matches(_event(event_type="unknown", idempotency_key="x"))


def test_schema_version_matches_only_integer_one():
    assert _schema_version_matches({"schema_version": 1})
    assert not _schema_version_matches({"schema_version": "1"})
    assert not _schema_version_matches({"schema_version": 2})
    assert not _schema_version_matches(None)
    assert not _schema_version_matches({"schema_version": True})


def test_source_matches_compares_four_audited_facts():
    source = GrammarError(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        skill_tag="verb_tense_past",
        original="x",
        corrected="y",
        error_type="wrong_tense",
        source="provider",
        provider="llm",
        model_version="v1",
        is_synthetic=False,
    )
    event = _event(
        source="provider",
        provider="llm",
        model_version="v1",
        is_synthetic=False,
    )
    assert _source_matches(event, source)
    assert not _source_matches(_event(source="other"), source)


def test_canonical_rejects_falsy_non_none_phoneme_alignment():
    def assessment(alignment: object) -> PronunciationAssessment:
        return PronunciationAssessment(
            id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            overall_score=75.0,
            phoneme_alignment=alignment,
            source="provider",
            provider="elsa",
            model_version="v1",
            is_synthetic=False,
            confidence=0.9,
        )

    # None and an empty array remain legal "no pronunciation data" shapes.
    assert candidate_skills(assessment=None, grammar_errors=[]) == set()
    assert candidate_skills(assessment=assessment(None), grammar_errors=[]) == set()
    assert candidate_skills(assessment=assessment([]), grammar_errors=[]) == set()
    build_canonical_observations(
        job_id=uuid.uuid4(),
        assessment=None,
        grammar_errors=[],
        valid_skill_ids=set(),
    )
    build_canonical_observations(
        job_id=uuid.uuid4(),
        assessment=assessment([]),
        grammar_errors=[],
        valid_skill_ids=set(),
    )

    # Falsy non-list JSON must not be silently ignored.
    for bad in ({}, False, 0, ""):
        with pytest.raises(CanonicalObservationError):
            candidate_skills(assessment=assessment(bad), grammar_errors=[])
        with pytest.raises(CanonicalObservationError):
            build_canonical_observations(
                job_id=uuid.uuid4(),
                assessment=assessment(bad),
                grammar_errors=[],
                valid_skill_ids=set(),
            )


# ---------------------------------------------------------------------------
# Real PostgreSQL harness (clean-start, no legacy baseline/cutover)
# ---------------------------------------------------------------------------


def _require_replay_database_url():
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail(
            "B2 replay PostgreSQL tests require explicit DATABASE_URL", pytrace=False
        )
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
        pytest.fail("B2 replay PostgreSQL test DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail(
            "B2 replay PostgreSQL test database boundary mismatch", pytrace=False
        )
    return parsed.set(drivername="postgresql+asyncpg")


class ReplayHarness:
    def __init__(self, factory, engine):
        self.factory = factory
        self.engine = engine
        self.user_ids: list[uuid.UUID] = []
        self.skill_ids: list[str] = []

    async def ensure_skill(self, skill_id: str) -> None:
        async with self.factory() as db, db.begin():
            if await db.get(Skill, skill_id) is None:
                db.add(
                    Skill(
                        id=skill_id,
                        name=f"replay {skill_id[-12:]}",
                        category="grammar",
                    )
                )
        self.skill_ids.append(skill_id)

    async def new_user(self) -> uuid.UUID:
        user_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(User(id=user_id, email=f"replay-{user_id}@example.invalid"))
        self.user_ids.append(user_id)
        return user_id

    async def cleanup(self) -> None:
        async with self.factory() as db, db.begin():
            if self.user_ids:
                await db.execute(
                    delete(LearningEvent).where(
                        LearningEvent.user_id.in_(self.user_ids)
                    )
                )
                await db.execute(
                    delete(KnowledgeState).where(
                        KnowledgeState.user_id.in_(self.user_ids)
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
                    delete(Session).where(Session.user_id.in_(self.user_ids))
                )
                await db.execute(delete(User).where(User.id.in_(self.user_ids)))
            if self.skill_ids:
                await db.execute(delete(Skill).where(Skill.id.in_(self.skill_ids)))
        await self.engine.dispose()


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


@dataclass(frozen=True)
class Batch:
    user_id: uuid.UUID
    session_id: uuid.UUID
    job_id: uuid.UUID
    grammar_id: uuid.UUID
    skill_id: str
    ended_at: datetime
    completed_key: str
    observation_key: str


def _pronunciation_direction() -> dict[str, Any]:
    return {
        "status": "not_called",
        "reason": "disabled",
        "result_count": None,
        "reused": False,
        "metadata": None,
        "basis": "none",
        "source_facts": None,
    }


def _grammar_direction(source: GrammarError) -> dict[str, Any]:
    return {
        "status": "evaluated",
        "reason": "completed",
        "result_count": 1,
        "reused": False,
        "metadata": {
            "source": source.source,
            "provider": source.provider,
            "model_version": source.model_version,
            "is_synthetic": source.is_synthetic,
            "confidence": source.confidence,
        },
        "basis": "current_invocation",
        "source_facts": {
            "source": source.source,
            "provider": source.provider,
            "model_version": source.model_version,
            "is_synthetic": source.is_synthetic,
        },
    }


def _coverage(source: GrammarError) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "coverage": {
            "pronunciation": _pronunciation_direction(),
            "grammar": _grammar_direction(source),
        },
        "unmapped": {"pronunciation": 0, "grammar": 0},
    }


def _approved_incorrect(p_mastery: float) -> float:
    """Independent incorrect-observation BKT posterior from frozen constants."""
    slip = FROZEN_BKT_PARAMS["p_slip"]
    guess = FROZEN_BKT_PARAMS["p_guess"]
    p_incorrect = slip * p_mastery + (1 - guess) * (1 - p_mastery)
    return slip * p_mastery / p_incorrect


def _approved_correct(p_mastery: float) -> float:
    """Independent correct-observation BKT posterior from frozen constants."""
    slip = FROZEN_BKT_PARAMS["p_slip"]
    guess = FROZEN_BKT_PARAMS["p_guess"]
    transit = FROZEN_BKT_PARAMS["p_transit"]
    p_correct = (1 - slip) * p_mastery + guess * (1 - p_mastery)
    posterior = (1 - slip) * p_mastery / p_correct
    return posterior + (1 - posterior) * transit


def _pronunciation_evaluated_direction(
    assessment: PronunciationAssessment,
) -> dict[str, Any]:
    facts = {
        "source": assessment.source,
        "provider": assessment.provider,
        "model_version": assessment.model_version,
        "is_synthetic": assessment.is_synthetic,
    }
    return {
        "status": "evaluated",
        "reason": "completed",
        "result_count": len(assessment.phoneme_alignment),
        "reused": False,
        "metadata": {**facts, "confidence": assessment.confidence},
        "basis": "current_invocation",
        "source_facts": facts,
    }


async def _write_batch_in_transaction(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    skill_id: str,
    observation_first: bool = False,
    is_synthetic: bool = False,
    occurred_at: datetime | None = None,
    error_type: str = "wrong_tense",
) -> Batch:
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    grammar_id = uuid.uuid4()
    occurred_at = occurred_at or datetime.now(UTC)
    completed_key = f"job:{job_id}:completed"
    observation_key = f"job:{job_id}:grammar:0"

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
    source = GrammarError(
        id=grammar_id,
        session_id=session_id,
        skill_tag=skill_id,
        original="I go",
        corrected="I went",
        error_type=error_type,
        source="provider",
        provider="llm",
        model_version="v1",
        is_synthetic=is_synthetic,
        confidence=0.9,
    )
    db.add(source)
    await db.flush()

    completed = LearningEvent(
        idempotency_key=completed_key,
        event_type="analysis_completed",
        user_id=user_id,
        session_id=session_id,
        analysis_job_id=job_id,
        source="analysis",
        algorithm_version=FROZEN_BKT_VERSION,
        algorithm_params=dict(FROZEN_BKT_PARAMS),
        occurred_at=occurred_at,
        details=_coverage(source),
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
        observation_code=error_type,
        source="provider",
        provider="llm",
        model_version="v1",
        confidence=0.9,
        is_synthetic=is_synthetic,
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
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
        grammar_id=grammar_id,
        skill_id=skill_id,
        ended_at=occurred_at,
        completed_key=completed_key,
        observation_key=observation_key,
    )


async def _write_batch(pg, **kwargs) -> Batch:
    async with pg.factory() as db, db.begin():
        return await _write_batch_in_transaction(db, **kwargs)


async def _add_state(
    pg,
    user_id: uuid.UUID,
    skill_id: str,
    p_mastery: float,
) -> None:
    async with pg.factory() as db, db.begin():
        db.add(
            KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id=skill_id,
                p_mastery=p_mastery,
            )
        )


def _replayed_mastery() -> float:
    params = BKTParams(**FROZEN_BKT_PARAMS)
    return update_mastery(params.p_init, False, params)


async def _validate(pg, factory=None):
    return await validate_learning_event_replay(
        factory or pg.factory,
        algorithm_versions={FROZEN_BKT_VERSION: dict(FROZEN_BKT_PARAMS)},
    )


@dataclass(frozen=True)
class PronunciationBatch:
    user_id: uuid.UUID
    session_id: uuid.UUID
    job_id: uuid.UUID
    assessment_id: uuid.UUID
    skill_id: str
    ended_at: datetime
    completed_key: str
    observation_keys: tuple[str, ...]


async def _write_pronunciation_batch_in_transaction(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    skill_id: str,
    alignment: list[dict[str, str]],
    is_synthetic: bool = False,
) -> PronunciationBatch:
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    assessment_id = uuid.uuid4()
    occurred_at = datetime.now(UTC)
    completed_key = f"job:{job_id}:completed"

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
    assessment = PronunciationAssessment(
        id=assessment_id,
        session_id=session_id,
        overall_score=75.0,
        phoneme_alignment=alignment,
        source="provider",
        provider="elsa",
        model_version="v1",
        is_synthetic=is_synthetic,
        confidence=0.9,
    )
    db.add(assessment)
    await db.flush()

    db.add(
        LearningEvent(
            idempotency_key=completed_key,
            event_type="analysis_completed",
            user_id=user_id,
            session_id=session_id,
            analysis_job_id=job_id,
            source="analysis",
            algorithm_version=FROZEN_BKT_VERSION,
            algorithm_params=dict(FROZEN_BKT_PARAMS),
            occurred_at=occurred_at,
            details={
                "schema_version": 1,
                "coverage": {
                    "pronunciation": _pronunciation_evaluated_direction(assessment),
                    "grammar": _pronunciation_direction(),
                },
                "unmapped": {"pronunciation": 0, "grammar": 0},
            },
        )
    )
    await db.flush()

    observation_keys: list[str] = []
    for ordinal, entry in enumerate(alignment):
        key = f"job:{job_id}:pron:{ordinal}"
        observation_keys.append(key)
        db.add(
            LearningEvent(
                idempotency_key=key,
                event_type="pronunciation_observation",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                pronunciation_assessment_id=assessment_id,
                skill_id=skill_id,
                source_ordinal=ordinal,
                observation_correct=(entry["type"] == "correct"),
                observation_code=entry["type"],
                source="provider",
                provider="elsa",
                model_version="v1",
                confidence=0.9,
                is_synthetic=is_synthetic,
                occurred_at=occurred_at,
                details={"schema_version": 1},
            )
        )
        await db.flush()

    return PronunciationBatch(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
        assessment_id=assessment_id,
        skill_id=skill_id,
        ended_at=occurred_at,
        completed_key=completed_key,
        observation_keys=tuple(observation_keys),
    )


async def _write_pronunciation_batch(pg, **kwargs) -> PronunciationBatch:
    async with pg.factory() as db, db.begin():
        return await _write_pronunciation_batch_in_transaction(db, **kwargs)


@dataclass(frozen=True)
class TwoGrammarBatch:
    user_id: uuid.UUID
    session_id: uuid.UUID
    job_id: uuid.UUID
    completed_key: str
    observation_keys: tuple[str, str]
    skill_ids: tuple[str, str]


def _clone_observation(event: LearningEvent) -> LearningEvent:
    """Copy every replay-relevant field while letting apply_seq be regenerated."""
    return LearningEvent(
        idempotency_key=event.idempotency_key,
        event_type=event.event_type,
        user_id=event.user_id,
        session_id=event.session_id,
        analysis_job_id=event.analysis_job_id,
        pronunciation_assessment_id=event.pronunciation_assessment_id,
        grammar_error_id=event.grammar_error_id,
        skill_id=event.skill_id,
        source_ordinal=event.source_ordinal,
        observation_correct=event.observation_correct,
        observation_code=event.observation_code,
        source=event.source,
        provider=event.provider,
        model_version=event.model_version,
        confidence=event.confidence,
        is_synthetic=event.is_synthetic,
        algorithm_version=event.algorithm_version,
        algorithm_params=event.algorithm_params,
        p_mastery_snapshot=event.p_mastery_snapshot,
        cutover_revision=event.cutover_revision,
        occurred_at=event.occurred_at,
        details=event.details,
    )


async def _write_two_grammar_batch_in_transaction(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    skill_a: str,
    skill_b: str,
    error_a: str = "wrong_tense",
    error_b: str = "missing_article",
) -> TwoGrammarBatch:
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    occurred_at = datetime.now(UTC)
    completed_key = f"job:{job_id}:completed"

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

    source_by_key: dict[tuple[str, str], GrammarError] = {}
    for skill_id, error_type in ((skill_a, error_a), (skill_b, error_b)):
        source = GrammarError(
            id=uuid.uuid4(),
            session_id=session_id,
            skill_tag=skill_id,
            original="x",
            corrected="y",
            error_type=error_type,
            source="provider",
            provider="llm",
            model_version="v1",
            is_synthetic=False,
            confidence=0.9,
        )
        db.add(source)
        source_by_key[(skill_id, error_type)] = source
    await db.flush()

    ordered_sources = [source_by_key[key] for key in sorted(source_by_key)]
    first = ordered_sources[0]
    facts = {
        "source": first.source,
        "provider": first.provider,
        "model_version": first.model_version,
        "is_synthetic": first.is_synthetic,
    }
    grammar_direction = {
        "status": "evaluated",
        "reason": "completed",
        "result_count": 2,
        "reused": False,
        "metadata": {**facts, "confidence": first.confidence},
        "basis": "current_invocation",
        "source_facts": facts,
    }
    details = {
        "schema_version": 1,
        "coverage": {
            "pronunciation": _pronunciation_direction(),
            "grammar": grammar_direction,
        },
        "unmapped": {"pronunciation": 0, "grammar": 0},
    }
    db.add(
        LearningEvent(
            idempotency_key=completed_key,
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
    await db.flush()

    observation_keys: list[str] = []
    for ordinal, source in enumerate(ordered_sources):
        key = f"job:{job_id}:grammar:{ordinal}"
        observation_keys.append(key)
        db.add(
            LearningEvent(
                idempotency_key=key,
                event_type="grammar_observation",
                user_id=user_id,
                session_id=session_id,
                analysis_job_id=job_id,
                grammar_error_id=source.id,
                skill_id=source.skill_tag,
                source_ordinal=ordinal,
                observation_correct=False,
                observation_code=source.error_type,
                source=source.source,
                provider=source.provider,
                model_version=source.model_version,
                confidence=source.confidence,
                is_synthetic=source.is_synthetic,
                occurred_at=occurred_at,
                details={"schema_version": 1},
            )
        )
        await db.flush()

    return TwoGrammarBatch(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
        completed_key=completed_key,
        observation_keys=tuple(observation_keys),
        skill_ids=tuple(source.skill_tag for source in ordered_sources),
    )


@dataclass(frozen=True)
class MixedPronGrammarBatch:
    user_id: uuid.UUID
    session_id: uuid.UUID
    job_id: uuid.UUID
    completed_key: str
    pron_observation_key: str
    grammar_observation_key: str
    assessment_id: uuid.UUID
    grammar_id: uuid.UUID


async def _write_mixed_pron_grammar_batch_in_transaction(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    pron_skill_id: str,
    grammar_skill_id: str,
) -> MixedPronGrammarBatch:
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    assessment_id = uuid.uuid4()
    grammar_id = uuid.uuid4()
    occurred_at = datetime.now(UTC)
    completed_key = f"job:{job_id}:completed"

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
    assessment = PronunciationAssessment(
        id=assessment_id,
        session_id=session_id,
        overall_score=75.0,
        phoneme_alignment=[{"type": "correct", "expected": "IY"}],
        source="provider",
        provider="elsa",
        model_version="v1",
        is_synthetic=False,
        confidence=0.9,
    )
    grammar = GrammarError(
        id=grammar_id,
        session_id=session_id,
        skill_tag=grammar_skill_id,
        original="I go",
        corrected="I went",
        error_type="wrong_tense",
        source="provider",
        provider="llm",
        model_version="v1",
        is_synthetic=False,
        confidence=0.9,
    )
    db.add(assessment)
    db.add(grammar)
    await db.flush()

    db.add(
        LearningEvent(
            idempotency_key=completed_key,
            event_type="analysis_completed",
            user_id=user_id,
            session_id=session_id,
            analysis_job_id=job_id,
            source="analysis",
            algorithm_version=FROZEN_BKT_VERSION,
            algorithm_params=dict(FROZEN_BKT_PARAMS),
            occurred_at=occurred_at,
            details={
                "schema_version": 1,
                "coverage": {
                    "pronunciation": _pronunciation_evaluated_direction(assessment),
                    "grammar": _grammar_direction(grammar),
                },
                "unmapped": {"pronunciation": 0, "grammar": 0},
            },
        )
    )
    await db.flush()

    pron_key = f"job:{job_id}:pron:0"
    grammar_key = f"job:{job_id}:grammar:0"
    db.add(
        LearningEvent(
            idempotency_key=pron_key,
            event_type="pronunciation_observation",
            user_id=user_id,
            session_id=session_id,
            analysis_job_id=job_id,
            pronunciation_assessment_id=assessment_id,
            skill_id=pron_skill_id,
            source_ordinal=0,
            observation_correct=True,
            observation_code="correct",
            source="provider",
            provider="elsa",
            model_version="v1",
            confidence=0.9,
            is_synthetic=False,
            occurred_at=occurred_at,
            details={"schema_version": 1},
        )
    )
    await db.flush()
    db.add(
        LearningEvent(
            idempotency_key=grammar_key,
            event_type="grammar_observation",
            user_id=user_id,
            session_id=session_id,
            analysis_job_id=job_id,
            grammar_error_id=grammar_id,
            skill_id=grammar_skill_id,
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
    await db.flush()

    return MixedPronGrammarBatch(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
        completed_key=completed_key,
        pron_observation_key=pron_key,
        grammar_observation_key=grammar_key,
        assessment_id=assessment_id,
        grammar_id=grammar_id,
    )


@dataclass(frozen=True)
class OrdinalHoleBatch:
    user_id: uuid.UUID
    session_id: uuid.UUID
    job_id: uuid.UUID
    completed_key: str
    valid_observation_key: str
    valid_skill_id: str
    unmapped_skill_id: str


async def _write_ordinal_hole_batch_in_transaction(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    valid_skill_id: str,
    unmapped_skill_id: str,
) -> OrdinalHoleBatch:
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    occurred_at = datetime.now(UTC)
    completed_key = f"job:{job_id}:completed"
    unmapped_grammar_id = uuid.uuid4()
    valid_grammar_id = uuid.uuid4()

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
            id=unmapped_grammar_id,
            session_id=session_id,
            skill_tag=unmapped_skill_id,
            original="x",
            corrected="y",
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
            id=valid_grammar_id,
            session_id=session_id,
            skill_tag=valid_skill_id,
            original="x",
            corrected="y",
            error_type="missing_article",
            source="provider",
            provider="llm",
            model_version="v1",
            is_synthetic=False,
            confidence=0.9,
        )
    )
    await db.flush()

    facts = {
        "source": "provider",
        "provider": "llm",
        "model_version": "v1",
        "is_synthetic": False,
    }
    db.add(
        LearningEvent(
            idempotency_key=completed_key,
            event_type="analysis_completed",
            user_id=user_id,
            session_id=session_id,
            analysis_job_id=job_id,
            source="analysis",
            algorithm_version=FROZEN_BKT_VERSION,
            algorithm_params=dict(FROZEN_BKT_PARAMS),
            occurred_at=occurred_at,
            details={
                "schema_version": 1,
                "coverage": {
                    "pronunciation": _pronunciation_direction(),
                    "grammar": {
                        "status": "evaluated",
                        "reason": "completed",
                        "result_count": 2,
                        "reused": False,
                        "metadata": {**facts, "confidence": 0.9},
                        "basis": "current_invocation",
                        "source_facts": facts,
                    },
                },
                "unmapped": {"pronunciation": 0, "grammar": 1},
            },
        )
    )
    await db.flush()

    valid_key = f"job:{job_id}:grammar:1"
    db.add(
        LearningEvent(
            idempotency_key=valid_key,
            event_type="grammar_observation",
            user_id=user_id,
            session_id=session_id,
            analysis_job_id=job_id,
            grammar_error_id=valid_grammar_id,
            skill_id=valid_skill_id,
            source_ordinal=1,
            observation_correct=False,
            observation_code="missing_article",
            source="provider",
            provider="llm",
            model_version="v1",
            confidence=0.9,
            is_synthetic=False,
            occurred_at=occurred_at,
            details={"schema_version": 1},
        )
    )
    await db.flush()

    return OrdinalHoleBatch(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
        completed_key=completed_key,
        valid_observation_key=valid_key,
        valid_skill_id=valid_skill_id,
        unmapped_skill_id=unmapped_skill_id,
    )


@contextmanager
def _learning_event_read_fault(
    *,
    target_key: str,
    field: str,
    value: Any,
    listener_ref: list[Any] | None = None,
):
    injected = False

    def loaded(session: SyncSession, instance: object) -> None:
        del session
        nonlocal injected
        if injected or not isinstance(instance, LearningEvent):
            return
        if instance.idempotency_key != target_key:
            return
        set_committed_value(instance, field, value)
        injected = True

    sa_event.listen(SyncSession, "loaded_as_persistent", loaded)
    if listener_ref is not None:
        listener_ref.append(loaded)
    try:
        yield lambda: injected
    finally:
        sa_event.remove(SyncSession, "loaded_as_persistent", loaded)


# ---------------------------------------------------------------------------
# Real PostgreSQL clean-start cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clean_grammar_batch_reports_no_issues_and_read_only(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_clean_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())

    report = await _validate(pg)
    assert report.issues == ()
    assert report.read_only is True
    assert report.isolation_level == "repeatable read"
    assert report.watermark >= 1


@pytest.mark.asyncio
async def test_baseline_snapshot_reports_unexpected_baseline(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_baseline_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    async with pg.factory() as db, db.begin():
        db.add(
            LearningEvent(
                idempotency_key=f"baseline:rev:{user_id}:{skill_id}",
                event_type="baseline_snapshot",
                user_id=user_id,
                skill_id=skill_id,
                source="legacy_unknown",
                p_mastery_snapshot=0.5,
                cutover_revision="rev",
                occurred_at=datetime.now(UTC),
                details={"schema_version": 1, "legacy_synthetic_impact": "unknown"},
            )
        )

    issues = _issue_tuples(await _validate(pg))
    assert ("unexpected_baseline", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_completed_key_drift_reports_canonical_key_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_key_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.idempotency_key = f"job:{batch.job_id}:wrong"

    issues = _issue_tuples(await _validate(pg))
    assert ("canonical_key_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_completed_schema_version_drift_reports_event_schema_version_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_cs_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    with _learning_event_read_fault(
        target_key=batch.completed_key,
        field="details",
        value={"schema_version": 99},
    ) as injected:
        report = await _validate(pg)
    assert injected()
    assert ("event_schema_version_mismatch", user_id, None) in _issue_tuples(report)


@pytest.mark.asyncio
async def test_completed_source_drift_reports_completed_source_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_src_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    with _learning_event_read_fault(
        target_key=batch.completed_key,
        field="source",
        value="wrong-source",
    ) as injected:
        report = await _validate(pg)
    assert injected()
    assert ("completed_source_mismatch", user_id, None) in _issue_tuples(report)


@pytest.mark.asyncio
async def test_coverage_drift_reports_coverage_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_cov_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.details = {**completed.details, "coverage": {}}

    issues = _issue_tuples(await _validate(pg))
    assert ("coverage_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_observation_source_drift_reports_ownership_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_own_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        observation = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.observation_key
                )
            )
        ).scalar_one()
        observation.source = "different-source"

    issues = _issue_tuples(await _validate(pg))
    assert ("ownership_mismatch", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_event_tied_to_non_succeeded_job_reports_completed_job_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_jobstatus_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        job = await db.get(AnalysisJob, batch.job_id)
        job.status = AnalysisJobStatus.failed

    issues = _issue_tuples(await _validate(pg))
    assert any(code == "completed_job_mismatch" for code, _, _ in issues)


@pytest.mark.asyncio
async def test_completed_time_drift_reports_event_time_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_time_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.occurred_at = batch.ended_at + timedelta(seconds=5)

    issues = _issue_tuples(await _validate(pg))
    assert ("event_time_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_unknown_algorithm_version_reports_algorithm_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_algo_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.algorithm_version = "unknown"

    issues = _issue_tuples(await _validate(pg))
    assert ("algorithm_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_bool_algorithm_param_reports_algorithm_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_algo_bool_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.algorithm_params = {
            "p_init": 0.1,
            "p_transit": 0.2,
            "p_slip": 0.1,
            "p_guess": True,
        }

    issues = _issue_tuples(await _validate(pg))
    assert ("algorithm_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_missing_completed_event_reports_missing_completed_event(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_miss_completed_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)

    async with pg.factory() as db, db.begin():
        await db.execute(
            delete(LearningEvent).where(
                LearningEvent.idempotency_key == batch.completed_key
            )
        )

    issues = _issue_tuples(await _validate(pg))
    assert ("missing_completed_event", user_id, None) in issues


@pytest.mark.asyncio
async def test_missing_observation_reports_missing_observation_and_mismatched_batch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_miss_obs_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)

    async with pg.factory() as db, db.begin():
        await db.execute(
            delete(LearningEvent).where(
                LearningEvent.idempotency_key == batch.observation_key
            )
        )

    issues = _issue_tuples(await _validate(pg))
    assert ("missing_observation", user_id, skill_id) in issues
    assert ("mismatched_batch", user_id, None) in issues


@pytest.mark.asyncio
async def test_extra_observation_reports_unexpected_observation(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_extra_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)

    async with pg.factory() as db, db.begin():
        db.add(
            LearningEvent(
                idempotency_key=f"job:{batch.job_id}:grammar:1",
                event_type="grammar_observation",
                user_id=user_id,
                session_id=batch.session_id,
                analysis_job_id=batch.job_id,
                grammar_error_id=batch.grammar_id,
                skill_id=skill_id,
                source_ordinal=1,
                observation_correct=False,
                observation_code="wrong_tense",
                source="provider",
                provider="llm",
                model_version="v1",
                confidence=0.9,
                is_synthetic=False,
                occurred_at=batch.ended_at,
                details={"schema_version": 1},
            )
        )

    issues = _issue_tuples(await _validate(pg))
    assert ("unexpected_observation", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_observation_payload_drift_reports_canonical_order_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_order_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        observation = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.observation_key
                )
            )
        ).scalar_one()
        observation.observation_code = "different"

    issues = _issue_tuples(await _validate(pg))
    assert ("canonical_order_mismatch", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_observation_before_completed_reports_event_order_violation(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_evorder_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _write_batch(pg, user_id=user_id, skill_id=skill_id, observation_first=True)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())

    issues = _issue_tuples(await _validate(pg))
    assert any(code == "event_order_violation" for code, _, _ in issues)


@pytest.mark.asyncio
async def test_zero_event_succeeded_job_reports_missing_completed_event(pg):
    user_id = await pg.new_user()
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
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

    issues = _issue_tuples(await _validate(pg))
    assert ("missing_completed_event", user_id, None) in issues


@pytest.mark.asyncio
async def test_pronunciation_correct_and_incorrect_sequence_replays_approved_bkt(pg):
    user_id = await pg.new_user()
    skill_id = "vowel_sounds"
    await pg.ensure_skill(skill_id)
    await _write_pronunciation_batch(
        pg,
        user_id=user_id,
        skill_id=skill_id,
        alignment=[
            {"type": "substitution", "expected": "AA"},
            {"type": "correct", "expected": "IY"},
        ],
    )
    correct_expected = _approved_correct(
        _approved_incorrect(FROZEN_BKT_PARAMS["p_init"])
    )
    wrong_expected = _approved_incorrect(
        _approved_incorrect(FROZEN_BKT_PARAMS["p_init"])
    )
    assert correct_expected != wrong_expected

    await _add_state(pg, user_id, skill_id, wrong_expected)
    issues = _issue_tuples(await _validate(pg))
    assert ("state_mismatch", user_id, skill_id) in issues

    async with pg.factory() as db, db.begin():
        state = (
            await db.execute(
                select(KnowledgeState).where(
                    KnowledgeState.user_id == user_id,
                    KnowledgeState.skill_id == skill_id,
                )
            )
        ).scalar_one()
        state.p_mastery = correct_expected

    assert (await _validate(pg)).issues == ()


@pytest.mark.asyncio
async def test_synthetic_pronunciation_batch_with_state_reports_synthetic_state_drift(
    pg,
):
    user_id = await pg.new_user()
    skill_id = "vowel_sounds"
    await pg.ensure_skill(skill_id)
    await _write_pronunciation_batch(
        pg,
        user_id=user_id,
        skill_id=skill_id,
        alignment=[{"type": "correct", "expected": "IY"}],
        is_synthetic=True,
    )
    await _add_state(pg, user_id, skill_id, 0.5)

    issues = _issue_tuples(await _validate(pg))
    assert ("synthetic_state_drift", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_grammar_ordinal_hole_keeps_canonical_mapping(pg):
    user_id = await pg.new_user()
    valid_skill = f"zzz_valid_{uuid.uuid4().hex}"[:50]
    unmapped_skill = f"aaa_unmapped_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(valid_skill)

    async with pg.factory() as db, db.begin():
        await _write_ordinal_hole_batch_in_transaction(
            db,
            user_id=user_id,
            valid_skill_id=valid_skill,
            unmapped_skill_id=unmapped_skill,
        )
    await _add_state(pg, user_id, valid_skill, _replayed_mastery())

    assert (await _validate(pg)).issues == ()


@pytest.mark.asyncio
async def test_pronunciation_grammar_canonical_order_swap_reports_canonical_order_mismatch(
    pg,
):
    user_id = await pg.new_user()
    pron_skill = "vowel_sounds"
    grammar_skill = f"b2_pg_grammar_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(pron_skill)
    await pg.ensure_skill(grammar_skill)

    async with pg.factory() as db, db.begin():
        batch = await _write_mixed_pron_grammar_batch_in_transaction(
            db,
            user_id=user_id,
            pron_skill_id=pron_skill,
            grammar_skill_id=grammar_skill,
        )
    await _add_state(
        pg,
        user_id,
        pron_skill,
        _approved_correct(FROZEN_BKT_PARAMS["p_init"]),
    )
    await _add_state(pg, user_id, grammar_skill, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        pron = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.pron_observation_key
                )
            )
        ).scalar_one()
        grammar = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.grammar_observation_key
                )
            )
        ).scalar_one()
        await db.delete(pron)
        await db.delete(grammar)
        await db.flush()
        db.add(_clone_observation(grammar))
        await db.flush()
        db.add(_clone_observation(pron))
        await db.flush()

    issues = _issue_tuples(await _validate(pg))
    assert any(code == "canonical_order_mismatch" for code, _, _ in issues)


@pytest.mark.asyncio
async def test_empty_object_phoneme_alignment_reports_canonical_source_invalid(pg):
    user_id = await pg.new_user()
    skill_id = "vowel_sounds"
    await pg.ensure_skill(skill_id)
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
        await db.flush()
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
                overall_score=75.0,
                phoneme_alignment={},
                source="provider",
                provider="elsa",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
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
                occurred_at=occurred_at,
                details={
                    "schema_version": 1,
                    "coverage": {
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
                        "grammar": _pronunciation_direction(),
                    },
                    "unmapped": {"pronunciation": 0, "grammar": 0},
                },
            )
        )

    issues = _issue_tuples(await _validate(pg))
    assert ("canonical_source_invalid", user_id, None) in issues


@pytest.mark.asyncio
async def test_unmapped_count_drift_reports_unmapped_count_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_unmapped_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        details = dict(completed.details)
        details["unmapped"] = {"pronunciation": 0, "grammar": 5}
        completed.details = details

    issues = _issue_tuples(await _validate(pg))
    assert ("unmapped_count_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_duplicate_stable_key_reports_canonical_source_invalid(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_dup_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
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
        for grammar_id in (uuid.uuid4(), uuid.uuid4()):
            db.add(
                GrammarError(
                    id=grammar_id,
                    session_id=session_id,
                    skill_tag=skill_id,
                    original="x",
                    corrected="y",
                    error_type="wrong_tense",
                    source="provider",
                    provider="llm",
                    model_version="v1",
                    is_synthetic=False,
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
                occurred_at=occurred_at,
                details={
                    "schema_version": 1,
                    "coverage": {
                        "pronunciation": _pronunciation_direction(),
                        "grammar": {
                            "status": "evaluated",
                            "reason": "completed",
                            "result_count": 2,
                            "reused": False,
                            "metadata": {
                                "source": "provider",
                                "provider": "llm",
                                "model_version": "v1",
                                "is_synthetic": False,
                            },
                            "basis": "current_invocation",
                            "source_facts": {
                                "source": "provider",
                                "provider": "llm",
                                "model_version": "v1",
                                "is_synthetic": False,
                            },
                        },
                    },
                    "unmapped": {"pronunciation": 0, "grammar": 0},
                },
            )
        )

    issues = _issue_tuples(await _validate(pg))
    assert ("canonical_source_invalid", user_id, None) in issues


@pytest.mark.asyncio
async def test_real_observation_missing_state_reports_real_state_missing(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_real_missing_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _write_batch(pg, user_id=user_id, skill_id=skill_id)

    issues = _issue_tuples(await _validate(pg))
    assert ("real_state_missing", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_synthetic_batch_with_state_reports_synthetic_state_drift(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_synth_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _write_batch(pg, user_id=user_id, skill_id=skill_id, is_synthetic=True)
    await _add_state(pg, user_id, skill_id, 0.5)

    issues = _issue_tuples(await _validate(pg))
    assert ("synthetic_state_drift", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_state_value_drift_reports_state_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_state_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, 0.9)

    issues = _issue_tuples(await _validate(pg))
    assert ("state_mismatch", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_state_out_of_range_reports_state_out_of_range(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_state_range_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, 1.5)

    issues = _issue_tuples(await _validate(pg))
    assert ("state_out_of_range", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_cross_source_apply_order_swap_reports_canonical_order_mismatch(pg):
    user_id = await pg.new_user()
    skill_a = f"b2_swap_a_{uuid.uuid4().hex}"[:50]
    skill_b = f"b2_swap_b_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_a)
    await pg.ensure_skill(skill_b)

    async with pg.factory() as db, db.begin():
        batch = await _write_two_grammar_batch_in_transaction(
            db,
            user_id=user_id,
            skill_a=skill_a,
            skill_b=skill_b,
        )
    for skill_id in batch.skill_ids:
        await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        first = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.observation_keys[0]
                )
            )
        ).scalar_one()
        second = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.observation_keys[1]
                )
            )
        ).scalar_one()
        await db.delete(first)
        await db.delete(second)
        await db.flush()
        db.add(_clone_observation(second))
        await db.flush()
        db.add(_clone_observation(first))
        await db.flush()

    issues = _issue_tuples(await _validate(pg))
    assert any(code == "canonical_order_mismatch" for code, _, _ in issues)


@pytest.mark.asyncio
async def test_unmapped_boolean_is_not_a_valid_count(pg):
    user_id = await pg.new_user()
    skill_id = f"b2_unmapped_bool_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    for bad in (False, True):
        async with pg.factory() as db, db.begin():
            completed = (
                await db.execute(
                    select(LearningEvent).where(
                        LearningEvent.idempotency_key == batch.completed_key
                    )
                )
            ).scalar_one()
            details = dict(completed.details)
            details["unmapped"] = {"pronunciation": 0, "grammar": bad}
            completed.details = details
            flag_modified(completed, "details")

        async with pg.factory() as db:
            json_type = await db.scalar(
                text(
                    "SELECT jsonb_typeof(details->'unmapped'->'grammar') "
                    "FROM learning_events WHERE idempotency_key = :key"
                ),
                {"key": batch.completed_key},
            )
            assert json_type == "boolean"
            loaded = (
                await db.execute(
                    select(LearningEvent).where(
                        LearningEvent.idempotency_key == batch.completed_key
                    )
                )
            ).scalar_one()
            assert loaded.details["unmapped"]["grammar"] is bad

        issues = _issue_tuples(await _validate(pg))
        assert ("unmapped_count_mismatch", user_id, None) in issues


@pytest.mark.asyncio
async def test_forged_registry_cannot_redefine_frozen_bkt(pg):
    user_id = await pg.new_user()
    skill_id = f"b2_forged_bkt_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.algorithm_params = {
            "p_init": 0.8,
            "p_transit": 0.2,
            "p_slip": 0.1,
            "p_guess": 0.2,
        }

    forged = {
        FROZEN_BKT_VERSION: {
            "p_init": 0.8,
            "p_transit": 0.2,
            "p_slip": 0.1,
            "p_guess": 0.2,
        }
    }
    report = await validate_learning_event_replay(
        pg.factory,
        algorithm_versions=forged,
    )
    assert ("algorithm_mismatch", user_id, None) in _issue_tuples(report)


async def _write_interleaved_two_jobs_in_transaction(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    skill_a: str,
    skill_b: str,
) -> None:
    """Write two same-user succeeded Jobs whose events interleave by apply_seq."""
    occurred_at = datetime.now(UTC)
    session_a = uuid.uuid4()
    session_b = uuid.uuid4()
    job_a = uuid.uuid4()
    job_b = uuid.uuid4()
    grammar_a = uuid.uuid4()
    grammar_b = uuid.uuid4()

    db.add(
        Session(
            id=session_a,
            user_id=user_id,
            mode=SessionMode.pronunciation,
            status=SessionStatus.completed,
            ended_at=occurred_at,
        )
    )
    db.add(
        Session(
            id=session_b,
            user_id=user_id,
            mode=SessionMode.pronunciation,
            status=SessionStatus.completed,
            ended_at=occurred_at,
        )
    )
    db.add(
        AnalysisJob(
            id=job_a,
            session_id=session_a,
            status=AnalysisJobStatus.succeeded,
            attempt_count=1,
            started_at=occurred_at,
            finished_at=occurred_at,
        )
    )
    db.add(
        AnalysisJob(
            id=job_b,
            session_id=session_b,
            status=AnalysisJobStatus.succeeded,
            attempt_count=1,
            started_at=occurred_at,
            finished_at=occurred_at,
        )
    )

    source_a = GrammarError(
        id=grammar_a,
        session_id=session_a,
        skill_tag=skill_a,
        original="I go",
        corrected="I went",
        error_type="wrong_tense",
        source="provider",
        provider="llm",
        model_version="v1",
        is_synthetic=False,
        confidence=0.9,
    )
    source_b = GrammarError(
        id=grammar_b,
        session_id=session_b,
        skill_tag=skill_b,
        original="I go",
        corrected="I went",
        error_type="wrong_tense",
        source="provider",
        provider="llm",
        model_version="v1",
        is_synthetic=False,
        confidence=0.9,
    )
    db.add(source_a)
    db.add(source_b)
    await db.flush()

    db.add(
        LearningEvent(
            idempotency_key=f"job:{job_a}:completed",
            event_type="analysis_completed",
            user_id=user_id,
            session_id=session_a,
            analysis_job_id=job_a,
            source="analysis",
            algorithm_version=FROZEN_BKT_VERSION,
            algorithm_params=dict(FROZEN_BKT_PARAMS),
            occurred_at=occurred_at,
            details=_coverage(source_a),
        )
    )
    await db.flush()

    db.add(
        LearningEvent(
            idempotency_key=f"job:{job_b}:completed",
            event_type="analysis_completed",
            user_id=user_id,
            session_id=session_b,
            analysis_job_id=job_b,
            source="analysis",
            algorithm_version=FROZEN_BKT_VERSION,
            algorithm_params=dict(FROZEN_BKT_PARAMS),
            occurred_at=occurred_at,
            details=_coverage(source_b),
        )
    )
    await db.flush()

    db.add(
        LearningEvent(
            idempotency_key=f"job:{job_a}:grammar:0",
            event_type="grammar_observation",
            user_id=user_id,
            session_id=session_a,
            analysis_job_id=job_a,
            grammar_error_id=grammar_a,
            skill_id=skill_a,
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
    await db.flush()

    db.add(
        LearningEvent(
            idempotency_key=f"job:{job_b}:grammar:0",
            event_type="grammar_observation",
            user_id=user_id,
            session_id=session_b,
            analysis_job_id=job_b,
            grammar_error_id=grammar_b,
            skill_id=skill_b,
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
    await db.flush()


@pytest.mark.asyncio
async def test_completed_cross_table_ownership_drift_reports_ownership_mismatch(pg):
    user_id = await pg.new_user()
    other_user_id = await pg.new_user()
    skill_id = f"replay_completed_own_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        completed = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.completed_key
                )
            )
        ).scalar_one()
        completed.user_id = other_user_id

    issues = _issue_tuples(await _validate(pg))
    assert ("ownership_mismatch", other_user_id, None) in issues


@pytest.mark.asyncio
async def test_observation_schema_version_drift_reports_event_schema_version_mismatch(
    pg,
):
    user_id = await pg.new_user()
    skill_id = f"replay_obs_schema_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    with _learning_event_read_fault(
        target_key=batch.observation_key,
        field="details",
        value={"schema_version": 99},
    ) as injected:
        report = await _validate(pg)
    assert injected()
    assert (
        "event_schema_version_mismatch",
        user_id,
        skill_id,
    ) in _issue_tuples(report)


@pytest.mark.asyncio
async def test_baseline_schema_version_drift_reports_event_schema_version_mismatch(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_baseline_schema_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    baseline_key = f"baseline:rev:{user_id}:{skill_id}"
    async with pg.factory() as db, db.begin():
        db.add(
            LearningEvent(
                idempotency_key=baseline_key,
                event_type="baseline_snapshot",
                user_id=user_id,
                skill_id=skill_id,
                source="legacy_unknown",
                p_mastery_snapshot=0.5,
                cutover_revision="rev",
                occurred_at=datetime.now(UTC),
                details={"schema_version": 1, "legacy_synthetic_impact": "unknown"},
            )
        )

    with _learning_event_read_fault(
        target_key=baseline_key,
        field="details",
        value={"schema_version": 99},
    ) as injected:
        report = await _validate(pg)
    assert injected()
    issues = _issue_tuples(report)
    assert ("event_schema_version_mismatch", user_id, skill_id) in issues
    assert ("unexpected_baseline", user_id, skill_id) in issues


@pytest.mark.asyncio
async def test_learning_event_read_fault_uses_persistent_load_and_committed_value(pg):
    user_id = await pg.new_user()
    skill_id = f"replay_fault_sem_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)

    with _learning_event_read_fault(
        target_key=batch.observation_key,
        field="details",
        value={"schema_version": 99},
    ) as injected:
        async with pg.factory() as db:
            observation = (
                await db.execute(
                    select(LearningEvent).where(
                        LearningEvent.idempotency_key == batch.observation_key
                    )
                )
            ).scalar_one()
            assert injected()
            assert observation.details == {"schema_version": 99}
            assert not inspect(observation).modified
            assert not inspect(observation).attrs.details.history.has_changes()
            assert observation not in db.dirty
            await db.rollback()

    async with pg.factory() as db:
        observation = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.observation_key
                )
            )
        ).scalar_one()
        assert observation.details == {"schema_version": 1}
        await db.rollback()


@pytest.mark.asyncio
async def test_observation_ordinal_and_key_joint_tamper_reports_canonical_order_mismatch(
    pg,
):
    user_id = await pg.new_user()
    skill_id = f"b2_ord_key_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_id)
    batch = await _write_batch(pg, user_id=user_id, skill_id=skill_id)
    await _add_state(pg, user_id, skill_id, _replayed_mastery())
    assert (await _validate(pg)).issues == ()

    async with pg.factory() as db, db.begin():
        observation = (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.idempotency_key == batch.observation_key
                )
            )
        ).scalar_one()
        observation.source_ordinal = 5
        observation.idempotency_key = f"job:{batch.job_id}:grammar:5"

    issues = _issue_tuples(await _validate(pg))
    assert ("canonical_order_mismatch", user_id, skill_id) in issues
    assert ("canonical_key_mismatch", user_id, skill_id) not in issues


@pytest.mark.asyncio
async def test_same_user_two_job_interleave_reports_event_order_violation(pg):
    user_id = await pg.new_user()
    skill_a = f"replay_inter_a_{uuid.uuid4().hex}"[:50]
    skill_b = f"replay_inter_b_{uuid.uuid4().hex}"[:50]
    await pg.ensure_skill(skill_a)
    await pg.ensure_skill(skill_b)

    async with pg.factory() as db, db.begin():
        await _write_interleaved_two_jobs_in_transaction(
            db,
            user_id=user_id,
            skill_a=skill_a,
            skill_b=skill_b,
        )

    await _add_state(pg, user_id, skill_a, _replayed_mastery())
    await _add_state(pg, user_id, skill_b, _replayed_mastery())

    issues = _issue_tuples(await _validate(pg))
    assert any(code == "event_order_violation" for code, _, _ in issues)
