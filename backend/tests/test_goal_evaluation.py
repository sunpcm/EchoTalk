"""G-EVAL RED: goal evaluation persistence, worker fairness, export, deletion.

Modules are resolved at runtime so a missing implementation fails with an
explicit pytest.fail instead of breaking collection.  This file only depends on
the already-published GOAL-DATA public primitives (``record_goal_catalog_version``,
``write_session_goal_snapshot``) and the fixed six official pilot goal IDs; it
does not depend on any G-WIRE private function.
"""

from __future__ import annotations

import asyncio
import importlib
import os
import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from main import app
from models.analysis import AnalysisJob, AnalysisJobStatus
from models.learning_event import LearningEvent
from models.session import (
    Session,
    SessionMode,
    SessionStatus,
    Transcript,
    TranscriptRole,
)
from models.user import User
from services.user_account_deletion import delete_user_account
from services.user_data_export import get_user_data_export_session_factory

EXPORT_PATH = "/api/user/data-export"
GOALS_ENDPOINT = "/api/sessions/{session_id}/goals"
V1_TOP_LEVEL_KEYS = {
    "schema_version",
    "exported_at",
    "sessions",
    "transcripts",
    "pronunciation_assessments",
    "grammar_assessments",
    "learning_events",
    "knowledge_states",
}
V2_TOP_LEVEL_KEYS = V1_TOP_LEVEL_KEYS | {"session_goals"}
V3_TOP_LEVEL_KEYS = V2_TOP_LEVEL_KEYS | {"goal_runs", "goal_results"}

# One stable shape for the read-only GET goals response.  No alias keys.
GOALS_RESPONSE_KEYS = {
    "session_id",
    "configured",
    "material_id",
    "material_version",
    "goals",
    "execution",
    "summary",
}
GOALS_ENTRY_KEYS = {
    "goal_id",
    "goal_version",
    "description_en",
    "description_zh",
    "criteria",
    "evidence_types",
    "result",
}
GOALS_EXECUTION_KEYS = {"status", "revision", "evaluator_version"}
GOALS_SUMMARY_KEYS = {
    "total",
    "achieved",
    "not_achieved",
    "assessed",
    "unknown",
    "not_assessed",
}

SCHEMA_MODULE = "schemas.scenario_goals"
MODEL_MODULE = "models.goal_evaluation"
SERVICE_MODULE = "services.goal_evaluation"

MATERIAL_ID = "mat_biz_greet_b1"
MATERIAL_VERSION = 1
GOAL_SLUGS = ("introduce_name_and_role", "ask_other_work_question")
GOAL_RUN_TABLE = "goal_runs"
GOAL_RESULT_TABLE = "goal_results"
GOAL_RUN_UNIQUE_CONSTRAINT = "uq_goal_runs_session_revision"
GOAL_RESULT_UNIQUE_CONSTRAINT = "uq_goal_results_run_goal"
IMMUTABLE_RESULT_SQLSTATE = "23000"
IMMUTABLE_RESULT_MESSAGE = "goal result is immutable"
DELETE_FAILURE_SQLSTATE = "23000"
DELETE_FAILURE_MARKER = "goal_eval_delete_failure"


def _require_module(module_name: str) -> Any:
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        if exc.name == module_name:
            pytest.fail(f"{module_name} is not implemented (G-EVAL RED)", pytrace=False)
        raise


def _schema_api() -> Any:
    module = _require_module(SCHEMA_MODULE)
    if not hasattr(module, "GoalDefinition"):
        pytest.fail(
            f"{SCHEMA_MODULE}.GoalDefinition is missing (G-EVAL RED)", pytrace=False
        )
    return module


def _model_api() -> Any:
    module = _require_module(MODEL_MODULE)
    missing = [
        name
        for name in ("GoalRun", "GoalEvaluationResult", "GoalRunStatus", "GoalResult")
        if not hasattr(module, name)
    ]
    if missing:
        pytest.fail(
            f"{MODEL_MODULE} is missing: {', '.join(missing)} (G-EVAL RED)",
            pytrace=False,
        )
    return module


def _service_api() -> Any:
    module = _require_module(SERVICE_MODULE)
    required = (
        "create_goal_run",
        "claim_next_goal_run",
        "recover_stale_goal_runs",
        "execute_claimed_goal_run",
        "record_goal_run_failure",
        "process_goal_run",
    )
    missing = [name for name in required if not hasattr(module, name)]
    if missing:
        pytest.fail(
            f"{SERVICE_MODULE} is missing: {', '.join(missing)} (G-EVAL RED)",
            pytrace=False,
        )
    return module


def _require_b1_database_url() -> URL:
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail(
            "B1 PostgreSQL tests require explicit DATABASE_URL; no dotenv fallback",
            pytrace=False,
        )
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


def _pilot_goal(slug: str, *, goal_version: int = 1) -> Any:
    return _schema_api().GoalDefinition.create(
        material_id=MATERIAL_ID,
        slug=slug,
        goal_version=goal_version,
        description_en=f"Pilot goal {slug}.",
        description_zh=f"试点目标 {slug}。",
        criteria=("Demonstrate the pilot communicative task.",),
        evidence_types=("transcript",),
    )


@dataclass
class EvalHarness:
    factory: async_sessionmaker[AsyncSession]
    engine: Any
    user_ids: list[uuid.UUID] = field(default_factory=list)
    session_ids: list[uuid.UUID] = field(default_factory=list)
    catalog_ids: list[str] = field(default_factory=list)
    trigger_functions: list[str] = field(default_factory=list)

    async def new_user(self, label: str = "goal") -> uuid.UUID:
        user_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                User(
                    id=user_id,
                    email=f"goal-eval-{label}-{user_id}@example.invalid",
                    password_hash="goal-eval-test-only",
                    auth_issuer=f"urn:goal-eval:{label}",
                    auth_subject=f"subject-{user_id}",
                )
            )
        self.user_ids.append(user_id)
        return user_id

    async def new_session(self, user_id: uuid.UUID) -> uuid.UUID:
        session_id = uuid.uuid4()
        started_at = datetime(2026, 11, 16, 2, 0, tzinfo=UTC)
        async with self.factory() as db, db.begin():
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.scenario,
                    status=SessionStatus.active,
                    started_at=started_at,
                )
            )
        self.session_ids.append(session_id)
        return session_id

    async def set_status(self, session_id: uuid.UUID, status: SessionStatus) -> None:
        async with self.factory() as db, db.begin():
            session = await db.get(Session, session_id)
            session.status = status
            if status is not SessionStatus.active and session.ended_at is None:
                session.ended_at = session.started_at + timedelta(minutes=5)

    async def new_catalog(
        self, *, goals: Sequence[Any], material_version: int = MATERIAL_VERSION
    ) -> None:
        service = _require_module("services.session_goal_snapshot")
        self.catalog_ids.append(MATERIAL_ID)
        async with self.factory() as db, db.begin():
            await service.record_goal_catalog_version(
                db,
                material_id=MATERIAL_ID,
                material_version=material_version,
                goals=goals,
            )

    async def new_snapshot(
        self,
        *,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        material_version: int = MATERIAL_VERSION,
    ) -> None:
        service = _require_module("services.session_goal_snapshot")
        async with self.factory() as db, db.begin():
            await service.write_session_goal_snapshot(
                db,
                user_id=user_id,
                session_id=session_id,
                material_id=MATERIAL_ID,
                material_version=material_version,
            )

    async def new_transcript(
        self,
        session_id: uuid.UUID,
        *,
        role: TranscriptRole,
        content: str,
    ) -> int:
        async with self.factory() as db, db.begin():
            row = Transcript(
                session_id=session_id,
                role=role,
                content=content,
                timestamp_ms=0,
            )
            db.add(row)
            await db.flush()
            return row.id

    async def install_user_delete_failure(self, user_id: uuid.UUID) -> None:
        suffix = uuid.uuid4().hex
        function_name = f"goal_eval_reject_user_delete_{suffix}"
        trigger_name = f"goal_eval_reject_user_delete_{suffix}"
        async with self.factory() as db, db.begin():
            await db.execute(
                text(
                    f"""
                    CREATE FUNCTION {function_name}() RETURNS trigger
                    LANGUAGE plpgsql AS $goal_eval$
                    BEGIN
                        RAISE EXCEPTION USING ERRCODE = '23000',
                            MESSAGE = 'goal_eval_delete_failure';
                    END;
                    $goal_eval$
                    """
                )
            )
            await db.execute(
                text(
                    f"""
                    CREATE TRIGGER {trigger_name}
                    BEFORE DELETE ON users
                    FOR EACH ROW
                    WHEN (OLD.id = '{user_id}'::uuid)
                    EXECUTE FUNCTION {function_name}()
                    """
                )
            )
        self.trigger_functions.append(function_name)

    async def cleanup(self) -> None:
        async with self.factory() as db, db.begin():
            for function_name in self.trigger_functions:
                await db.execute(
                    text(f"DROP FUNCTION IF EXISTS {function_name}() CASCADE")
                )
            run_table = await db.scalar(
                text(f"SELECT to_regclass('public.{GOAL_RUN_TABLE}')")
            )
            if run_table is not None and self.session_ids:
                await db.execute(
                    text(f"DELETE FROM {GOAL_RUN_TABLE} WHERE session_id = ANY(:ids)"),
                    {"ids": self.session_ids},
                )
            snapshot_table = await db.scalar(
                text("SELECT to_regclass('public.session_goal_snapshots')")
            )
            if snapshot_table is not None:
                for session_id in self.session_ids:
                    await db.execute(
                        text(
                            "DELETE FROM session_goal_snapshots WHERE session_id = :sid"
                        ),
                        {"sid": session_id},
                    )
            if self.session_ids:
                await db.execute(
                    delete(Transcript).where(
                        Transcript.session_id.in_(self.session_ids)
                    )
                )
                await db.execute(
                    delete(AnalysisJob).where(
                        AnalysisJob.session_id.in_(self.session_ids)
                    )
                )
            if self.user_ids:
                await db.execute(
                    delete(Session).where(Session.user_id.in_(self.user_ids))
                )
                await db.execute(delete(User).where(User.id.in_(self.user_ids)))
            catalog_table = await db.scalar(
                text("SELECT to_regclass('public.goal_catalog_versions')")
            )
            if catalog_table is not None:
                for material_id in self.catalog_ids:
                    await db.execute(
                        text(
                            "DELETE FROM goal_catalog_versions WHERE material_id = :mid"
                        ),
                        {"mid": material_id},
                    )
        await self.engine.dispose()


@pytest.fixture
async def eval_pg() -> AsyncIterator[EvalHarness]:
    database_url = _require_b1_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    harness = EvalHarness(factory=factory, engine=engine)
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
            assert identity == (database_url.database, database_url.username, "150019")
            assert (
                await db.scalar(text("SELECT version_num FROM alembic_version"))
            ) == source_head
            identity_verified = True
        yield harness
    finally:
        if identity_verified:
            await harness.cleanup()
        else:
            await engine.dispose()


@asynccontextmanager
async def _app_client(
    harness: EvalHarness, user_id: uuid.UUID
) -> AsyncIterator[httpx.AsyncClient]:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user_id,
        email=f"{user_id}@example.invalid",
        issuer="urn:goal-eval:http",
        subject=str(user_id),
    )

    async def _override_get_db():
        async with harness.factory() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    app.dependency_overrides[get_db] = _override_get_db
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)


@asynccontextmanager
async def _export_client(
    harness: EvalHarness, user_id: uuid.UUID
) -> AsyncIterator[httpx.AsyncClient]:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user_id,
        email=f"{user_id}@example.invalid",
        issuer="urn:goal-eval:http",
        subject=str(user_id),
    )
    app.dependency_overrides[get_user_data_export_session_factory] = lambda: (
        harness.factory
    )
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_user_data_export_session_factory, None)


async def _bootstrap_run(
    harness: EvalHarness,
    *,
    utterances: Sequence[str],
) -> tuple[uuid.UUID, uuid.UUID, Any]:
    """active session -> snapshot -> transcripts -> completed -> create run."""
    service = _service_api()
    user_id = await harness.new_user()
    session_id = await harness.new_session(user_id)
    await harness.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await harness.new_snapshot(user_id=user_id, session_id=session_id)
    for utterance in utterances:
        await harness.new_transcript(
            session_id, role=TranscriptRole.user, content=utterance
        )
    await harness.set_status(session_id, SessionStatus.completed)
    async with harness.factory() as db, db.begin():
        run = await service.create_goal_run(db, session_id=session_id, user_id=user_id)
    return user_id, session_id, run


def test_goal_runs_and_results_models_expose_four_results_and_run_status() -> None:
    api = _model_api()
    assert {m.value for m in api.GoalRunStatus} == {
        "pending",
        "running",
        "succeeded",
        "failed",
    }
    assert {m.value for m in api.GoalResult} == {
        "achieved",
        "not_achieved",
        "unknown",
        "not_assessed",
    }


@pytest.mark.asyncio
async def test_create_goal_run_only_for_completed_snapshot(
    eval_pg: EvalHarness,
) -> None:
    service = _service_api()
    user_id = await eval_pg.new_user("completed")
    session_id = await eval_pg.new_session(user_id)
    await eval_pg.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await eval_pg.new_snapshot(user_id=user_id, session_id=session_id)
    await eval_pg.set_status(session_id, SessionStatus.completed)
    async with eval_pg.factory() as db, db.begin():
        run = await service.create_goal_run(db, session_id=session_id, user_id=user_id)
        assert run is not None
        assert run.status.value == "pending"
        assert run.revision == 1

    active_user = await eval_pg.new_user("active")
    active_session = await eval_pg.new_session(active_user)
    await eval_pg.new_snapshot(user_id=active_user, session_id=active_session)
    async with eval_pg.factory() as db, db.begin():
        assert (
            await service.create_goal_run(
                db, session_id=active_session, user_id=active_user
            )
            is None
        )

    cancelled_user = await eval_pg.new_user("cancelled")
    cancelled_session = await eval_pg.new_session(cancelled_user)
    await eval_pg.new_snapshot(user_id=cancelled_user, session_id=cancelled_session)
    await eval_pg.set_status(cancelled_session, SessionStatus.cancelled)
    async with eval_pg.factory() as db, db.begin():
        assert (
            await service.create_goal_run(
                db, session_id=cancelled_session, user_id=cancelled_user
            )
            is None
        )

    nosnap_user = await eval_pg.new_user("nosnap")
    nosnap_session = await eval_pg.new_session(nosnap_user)
    await eval_pg.set_status(nosnap_session, SessionStatus.completed)
    async with eval_pg.factory() as db, db.begin():
        assert (
            await service.create_goal_run(
                db, session_id=nosnap_session, user_id=nosnap_user
            )
            is None
        )


@pytest.mark.asyncio
async def test_execute_writes_terminal_results_atomically(eval_pg: EvalHarness) -> None:
    service = _service_api()
    model = _model_api()
    _user_id, _session_id, run = await _bootstrap_run(
        eval_pg,
        utterances=[
            "My name is Anna and I am a product manager.",
            "What do you do for work?",
        ],
    )
    assert run is not None

    async with eval_pg.factory() as db, db.begin():
        claimed = await service.claim_next_goal_run(db)
        assert claimed == run.id
        await service.execute_claimed_goal_run(run.id, db)

    async with eval_pg.factory() as db:
        header = await db.get(model.GoalRun, run.id)
        assert header.status.value == "succeeded"
        results = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {r.goal_id for r in results} == {
            f"{MATERIAL_ID}:{slug}" for slug in GOAL_SLUGS
        }
        assert {r.result.value for r in results} == {"achieved"}


@pytest.mark.asyncio
async def test_v2_runs_use_version_guard_without_rewriting_v1_history(
    eval_pg: EvalHarness, monkeypatch
) -> None:
    service = _service_api()
    model = _model_api()
    rules = _require_module("services.goal_rules")

    _user_id, _session_id, v2_run = await _bootstrap_run(
        eval_pg,
        utterances=[
            "My name is Anna and I am a product manager.",
            "What do you do for work?",
        ],
    )
    assert v2_run is not None
    assert rules.EVALUATOR_VERSION == "deterministic-goal-v2"
    assert v2_run.evaluator_version == "deterministic-goal-v2"
    async with eval_pg.factory() as db, db.begin():
        claimed = await service.claim_next_goal_run(db)
        assert claimed == v2_run.id
        await service.execute_claimed_goal_run(v2_run.id, db)

    with monkeypatch.context() as version_override:
        version_override.setattr(
            rules,
            "EVALUATOR_VERSION",
            "deterministic-goal-v1",
        )
        _user_id, _session_id, pending_v1_run = await _bootstrap_run(
            eval_pg,
            utterances=["My name is Anna and I am a product manager."],
        )
    assert pending_v1_run is not None
    assert rules.EVALUATOR_VERSION == "deterministic-goal-v2"
    assert pending_v1_run.evaluator_version == "deterministic-goal-v1"
    async with eval_pg.factory() as db, db.begin():
        pending_v1 = await db.get(model.GoalRun, pending_v1_run.id)
        pending_v1_evidence = [dict(item) for item in pending_v1.evidence]

    async with eval_pg.factory() as db, db.begin():
        claimed = await service.claim_next_goal_run(db)
        assert claimed == pending_v1_run.id
        await service.execute_claimed_goal_run(pending_v1_run.id, db)

    async with eval_pg.factory() as db:
        pending_v1 = await db.get(model.GoalRun, pending_v1_run.id)
        pending_v1_results = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == pending_v1_run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert pending_v1.status.value == "succeeded"
        assert pending_v1.evaluator_version == "deterministic-goal-v1"
        assert pending_v1.evidence == pending_v1_evidence
        assert {result.result.value for result in pending_v1_results} == {
            "not_assessed"
        }

    with monkeypatch.context() as version_override:
        version_override.setattr(
            rules,
            "EVALUATOR_VERSION",
            "deterministic-goal-v1",
        )
        _user_id, _session_id, successful_v1_run = await _bootstrap_run(
            eval_pg,
            utterances=[
                "My name is Anna and I am a product manager.",
                "What do you do for work?",
            ],
        )
    assert successful_v1_run is not None
    assert successful_v1_run.evaluator_version == "deterministic-goal-v1"
    with monkeypatch.context() as version_override:
        version_override.setattr(
            rules,
            "EVALUATOR_VERSION",
            "deterministic-goal-v1",
        )
        async with eval_pg.factory() as db, db.begin():
            claimed = await service.claim_next_goal_run(db)
            assert claimed == successful_v1_run.id
            await service.execute_claimed_goal_run(successful_v1_run.id, db)
    assert rules.EVALUATOR_VERSION == "deterministic-goal-v2"

    async with eval_pg.factory() as db:
        successful_v1 = await db.get(model.GoalRun, successful_v1_run.id)
        successful_v1_evidence = [dict(item) for item in successful_v1.evidence]
        before = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == successful_v1_run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        before_results = {(result.goal_id, result.result.value) for result in before}
        assert successful_v1.status.value == "succeeded"
        assert successful_v1.evaluator_version == "deterministic-goal-v1"

    await service.process_goal_run(successful_v1_run.id, eval_pg.factory)

    async with eval_pg.factory() as db:
        successful_v1 = await db.get(model.GoalRun, successful_v1_run.id)
        after = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == successful_v1_run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert successful_v1.status.value == "succeeded"
        assert successful_v1.evaluator_version == "deterministic-goal-v1"
        assert successful_v1.evidence == successful_v1_evidence
        assert (
            {(result.goal_id, result.result.value) for result in after}
            == before_results
            == {(f"{MATERIAL_ID}:{slug}", "achieved") for slug in GOAL_SLUGS}
        )


@pytest.mark.asyncio
async def test_frozen_evidence_excludes_late_transcript(eval_pg: EvalHarness) -> None:
    service = _service_api()
    model = _model_api()
    factory = eval_pg.factory
    user_id = await eval_pg.new_user("late")
    session_id = await eval_pg.new_session(user_id)
    await eval_pg.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await eval_pg.new_snapshot(user_id=user_id, session_id=session_id)

    release_low = asyncio.Event()
    low_id_ready = asyncio.Event()

    async def hold_low_transcript() -> None:
        async with factory() as db_a:
            async with db_a.begin():
                low = Transcript(
                    session_id=session_id,
                    role=TranscriptRole.user,
                    content="and I am a product manager.",
                    timestamp_ms=0,
                )
                db_a.add(low)
                await db_a.flush()
                low_id_ready.set()
                await release_low.wait()

    task_low = asyncio.create_task(hold_low_transcript())
    try:
        await asyncio.wait_for(low_id_ready.wait(), 3)

        # A committed assistant positive must never count as student evidence,
        # and the visible student evidence is only the name (goal incomplete).
        await eval_pg.new_transcript(
            session_id,
            role=TranscriptRole.assistant,
            content="My name is Anna and I am a product manager.",
        )
        await eval_pg.new_transcript(
            session_id,
            role=TranscriptRole.user,
            content="My name is Anna.",
        )
        await eval_pg.set_status(session_id, SessionStatus.completed)
        async with factory() as db, db.begin():
            run = await service.create_goal_run(
                db, session_id=session_id, user_id=user_id
            )
        assert run is not None
    finally:
        release_low.set()
        await asyncio.wait_for(task_low, 3)

    async with factory() as db, db.begin():
        await service.claim_next_goal_run(db)
        await service.execute_claimed_goal_run(run.id, db)
    async with factory() as db:
        results = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        by_goal = {r.goal_id: r.result.value for r in results}
        assert by_goal[f"{MATERIAL_ID}:introduce_name_and_role"] == "unknown"


@pytest.mark.asyncio
async def test_digest_mismatch_does_not_produce_false_success(
    eval_pg: EvalHarness,
) -> None:
    service = _service_api()
    model = _model_api()
    user_id = await eval_pg.new_user("digest")
    session_id = await eval_pg.new_session(user_id)
    await eval_pg.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await eval_pg.new_snapshot(user_id=user_id, session_id=session_id)
    transcript_id = await eval_pg.new_transcript(
        session_id,
        role=TranscriptRole.user,
        content="My name is Anna and I am a product manager.",
    )
    await eval_pg.set_status(session_id, SessionStatus.completed)
    async with eval_pg.factory() as db, db.begin():
        run = await service.create_goal_run(db, session_id=session_id, user_id=user_id)
    assert run is not None
    async with eval_pg.factory() as db, db.begin():
        row = await db.get(Transcript, transcript_id)
        row.content = "My name is Anna."
    async with eval_pg.factory() as db, db.begin():
        await service.claim_next_goal_run(db)
        await service.execute_claimed_goal_run(run.id, db)
    async with eval_pg.factory() as db:
        results = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        by_goal = {r.goal_id: r.result.value for r in results}
        assert by_goal[f"{MATERIAL_ID}:introduce_name_and_role"] == "unknown"


@pytest.mark.asyncio
async def test_concurrent_claim_returns_unique_run(eval_pg: EvalHarness) -> None:
    service = _service_api()
    run_ids = []
    for index in range(2):
        _user_id, _session_id, run = await _bootstrap_run(
            eval_pg, utterances=[f"My name is Anna {index} and I am a product manager."]
        )
        run_ids.append(run.id)

    first_claimed = asyncio.Event()
    release_first = asyncio.Event()
    claimed: dict[str, Any] = {}

    async def claim_and_hold() -> None:
        async with eval_pg.factory() as db:
            async with db.begin():
                claimed["first"] = await service.claim_next_goal_run(db)
                first_claimed.set()
                await release_first.wait()

    task = asyncio.create_task(claim_and_hold())
    try:
        await asyncio.wait_for(first_claimed.wait(), 3)
        # Independent connection claims while the first transaction still holds
        # its row lock; skip_locked must select the other pending run.
        async with eval_pg.factory() as db, db.begin():
            claimed["second"] = await service.claim_next_goal_run(db)
    finally:
        release_first.set()
        await asyncio.wait_for(task, 3)

    assert claimed["first"] is not None
    assert claimed["second"] is not None
    assert claimed["first"] != claimed["second"]
    assert {claimed["first"], claimed["second"]} == set(run_ids)


@pytest.mark.asyncio
async def test_execution_failure_is_atomic_and_never_succeeds(
    eval_pg: EvalHarness, monkeypatch
) -> None:
    service = _service_api()
    model = _model_api()
    rules = _require_module("services.goal_rules")
    _user_id, _session_id, run = await _bootstrap_run(
        eval_pg, utterances=["My name is Anna and I am a product manager."]
    )
    assert run is not None

    def explode(goal_id, goal_version, utterances):
        raise RuntimeError("synthetic rule failure")

    monkeypatch.setattr(rules, "evaluate_goal", explode)
    async with eval_pg.factory() as db, db.begin():
        await service.claim_next_goal_run(db)
    await service.process_goal_run(run.id, eval_pg.factory)

    async with eval_pg.factory() as db:
        header = await db.get(model.GoalRun, run.id)
        assert header.status.value == "failed"
        assert header.last_error_code is not None
        assert "synthetic rule failure" not in (header.last_error or "")
        results = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(results) == 2
        assert {r.result.value for r in results} == {"unknown"}


@pytest.mark.asyncio
async def test_worker_fair_poll_drains_one_goal_and_one_analysis(monkeypatch) -> None:
    worker = _require_module("workers.analysis_worker")
    goal_missing = [
        name
        for name in (
            "claim_next_goal_run",
            "process_goal_run",
            "recover_stale_goal_runs",
        )
        if not hasattr(worker, name)
    ]
    if goal_missing:
        pytest.fail(
            f"analysis_worker is missing goal poll API: {', '.join(goal_missing)} (G-EVAL RED)",
            pytrace=False,
        )

    claimed = {"analysis": 0, "goal": 0}
    processed = {"analysis": 0, "goal": 0}
    stop = asyncio.Event()
    done = asyncio.Event()

    async def recover_analysis(_db):
        return 0

    async def recover_goal(_db):
        return 0

    async def claim_analysis(_db):
        if claimed["analysis"] < 1:
            claimed["analysis"] += 1
            return uuid.uuid4()
        return None

    async def claim_goal(_db):
        if claimed["goal"] < 1:
            claimed["goal"] += 1
            return uuid.uuid4()
        return None

    def _mark_done():
        if processed["analysis"] >= 1 and processed["goal"] >= 1:
            done.set()

    async def process_analysis(_job_id, _factory):
        processed["analysis"] += 1
        _mark_done()

    async def process_goal(_run_id, _factory):
        processed["goal"] += 1
        _mark_done()

    monkeypatch.setattr(worker, "recover_stale_jobs", recover_analysis)
    monkeypatch.setattr(worker, "claim_next_job", claim_analysis)
    monkeypatch.setattr(worker, "process_job", process_analysis)
    monkeypatch.setattr(worker, "recover_stale_goal_runs", recover_goal)
    monkeypatch.setattr(worker, "claim_next_goal_run", claim_goal)
    monkeypatch.setattr(worker, "process_goal_run", process_goal)

    task = asyncio.create_task(worker.run_forever(stop, poll_seconds=0.01))
    try:
        await asyncio.wait_for(done.wait(), 2)
    finally:
        stop.set()
        await asyncio.wait_for(task, 2)

    assert claimed["analysis"] == 1
    assert claimed["goal"] == 1
    assert processed["analysis"] == 1
    assert processed["goal"] == 1


@pytest.mark.asyncio
async def test_postgres_worker_isolates_analysis_failure_from_goal(
    eval_pg: EvalHarness, monkeypatch
) -> None:
    from tests.learning_event_gate_helper import open_learning_event_gate

    model = _model_api()
    analysis_jobs = _require_module("services.analysis_jobs")
    user_id, session_id, run = await _bootstrap_run(
        eval_pg, utterances=["My name is Anna and I am a product manager."]
    )
    assert run is not None

    await open_learning_event_gate(
        eval_pg.factory,
        revision=f"test-{uuid.uuid4().hex}-goal-worker",
    )

    job_id = uuid.uuid4()
    async with eval_pg.factory() as db, db.begin():
        db.add(
            AnalysisJob(
                id=job_id, session_id=session_id, status=AnalysisJobStatus.pending
            )
        )

    async def fail_analyze(session_id, db):
        raise analysis_jobs.AnalysisExecutionError(
            "synthetic_analyze", "synthetic analyze failure", retryable=False
        )

    monkeypatch.setattr(analysis_jobs, "analyze_session", fail_analyze)

    try:
        worker = _require_module("workers.analysis_worker")
        stop = asyncio.Event()
        task = asyncio.create_task(
            worker.run_forever(stop, session_factory=eval_pg.factory)
        )
        try:
            await _wait_for_terminal(eval_pg, run.id, job_id)
        finally:
            stop.set()
            await asyncio.wait_for(task, 2)

        async with eval_pg.factory() as db:
            header = await db.get(model.GoalRun, run.id)
            job = await db.get(AnalysisJob, job_id)
            assert header.status.value == "succeeded"
            assert job.status.value == "failed"
    finally:
        async with eval_pg.factory() as db, db.begin():
            await db.execute(
                delete(LearningEvent).where(LearningEvent.user_id == user_id)
            )
            await db.execute(text("DELETE FROM learning_event_cutover"))


async def _wait_for_terminal(
    harness: EvalHarness,
    run_id: uuid.UUID,
    job_id: uuid.UUID,
    *,
    timeout: float = 3.0,
) -> None:
    model = _model_api()
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        async with harness.factory() as db:
            run = await db.get(model.GoalRun, run_id)
            job = await db.get(AnalysisJob, job_id)
            if (
                run is not None
                and job is not None
                and run.status.value in {"succeeded", "failed"}
                and job.status.value in {"succeeded", "failed"}
            ):
                return
        await asyncio.sleep(0.05)
    pytest.fail(
        "worker did not reach terminal goal+analysis states in time", pytrace=False
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("call_lease_mode", ["disabled", "livekit_cloud"])
async def test_end_session_creates_single_run_and_repeated_end_does_not_rerun(
    eval_pg: EvalHarness, monkeypatch, call_lease_mode: str
) -> None:
    from config import settings

    monkeypatch.setattr(settings, "CALL_LEASE_MODE", call_lease_mode)
    model = _model_api()
    user_id = await eval_pg.new_user("end")
    session_id = await eval_pg.new_session(user_id)
    await eval_pg.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await eval_pg.new_snapshot(user_id=user_id, session_id=session_id)
    await eval_pg.new_transcript(
        session_id,
        role=TranscriptRole.user,
        content="My name is Anna and I am a product manager.",
    )

    async with _app_client(eval_pg, user_id) as client:
        first = await client.post(f"/api/sessions/{session_id}/end")
        second = await client.post(f"/api/sessions/{session_id}/end")

    assert first.status_code == 200
    assert second.status_code == 200
    async with eval_pg.factory() as db:
        runs = (
            (
                await db.execute(
                    select(model.GoalRun).where(model.GoalRun.session_id == session_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(runs) == 1
        assert runs[0].status.value == "pending"
        assert runs[0].revision == 1


@pytest.mark.asyncio
async def test_get_goals_endpoint_readonly_states(eval_pg: EvalHarness) -> None:
    service = _service_api()

    # 1. no snapshot -> configured:false, empty goals, null summary
    nosnap_user = await eval_pg.new_user("get-nosnap")
    nosnap_session = await eval_pg.new_session(nosnap_user)
    await eval_pg.set_status(nosnap_session, SessionStatus.completed)
    async with _app_client(eval_pg, nosnap_user) as client:
        res = await client.get(GOALS_ENDPOINT.format(session_id=nosnap_session))
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == GOALS_RESPONSE_KEYS
    assert body["configured"] is False
    assert body["goals"] == []
    assert body["summary"] is None
    assert body["execution"] is None

    # 2. active with snapshot, no run -> derived not_assessed, nothing written
    active_user = await eval_pg.new_user("get-active")
    active_session = await eval_pg.new_session(active_user)
    await eval_pg.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await eval_pg.new_snapshot(user_id=active_user, session_id=active_session)
    async with _app_client(eval_pg, active_user) as client:
        res = await client.get(GOALS_ENDPOINT.format(session_id=active_session))
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is True
    assert body["execution"] is None
    assert len(body["goals"]) == 2
    assert {g["result"] for g in body["goals"]} == {"not_assessed"}
    assert body["summary"] == {
        "total": 2,
        "achieved": 0,
        "not_achieved": 0,
        "assessed": 0,
        "unknown": 0,
        "not_assessed": 2,
    }
    async with eval_pg.factory() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(_model_api().GoalRun)
                .where(_model_api().GoalRun.session_id == active_session)
            )
            == 0
        )

    # 3. pending run -> null results, null summary, execution pending
    pend_user = await eval_pg.new_user("get-pending")
    pend_session = await eval_pg.new_session(pend_user)
    await eval_pg.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await eval_pg.new_snapshot(user_id=pend_user, session_id=pend_session)
    await eval_pg.new_transcript(
        pend_session, role=TranscriptRole.user, content="My name is Anna."
    )
    await eval_pg.set_status(pend_session, SessionStatus.completed)
    async with eval_pg.factory() as db, db.begin():
        await service.create_goal_run(db, session_id=pend_session, user_id=pend_user)
    async with _app_client(eval_pg, pend_user) as client:
        res = await client.get(GOALS_ENDPOINT.format(session_id=pend_session))
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is True
    assert body["execution"]["status"] == "pending"
    assert body["summary"] is None
    assert {g["result"] for g in body["goals"]} == {None}

    # Settle the earlier pending run so the next claim targets the terminal run.
    async with eval_pg.factory() as db, db.begin():
        pend_run_id = await service.claim_next_goal_run(db)
        await service.execute_claimed_goal_run(pend_run_id, db)

    # 4. terminal -> precise summary
    term_user = await eval_pg.new_user("get-term")
    term_session = await eval_pg.new_session(term_user)
    await eval_pg.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await eval_pg.new_snapshot(user_id=term_user, session_id=term_session)
    await eval_pg.new_transcript(
        term_session,
        role=TranscriptRole.user,
        content="My name is Anna and I am a product manager.",
    )
    await eval_pg.set_status(term_session, SessionStatus.completed)
    async with eval_pg.factory() as db, db.begin():
        run = await service.create_goal_run(
            db, session_id=term_session, user_id=term_user
        )
        await service.claim_next_goal_run(db)
        await service.execute_claimed_goal_run(run.id, db)
    async with _app_client(eval_pg, term_user) as client:
        res = await client.get(GOALS_ENDPOINT.format(session_id=term_session))
    assert res.status_code == 200
    body = res.json()
    assert body["execution"]["status"] == "succeeded"
    assert body["summary"] == {
        "total": 2,
        "achieved": 1,
        "not_achieved": 0,
        "assessed": 1,
        "unknown": 1,
        "not_assessed": 0,
    }

    # 5. other user -> 404
    other_user = await eval_pg.new_user("get-other")
    async with _app_client(eval_pg, other_user) as client:
        res = await client.get(GOALS_ENDPOINT.format(session_id=term_session))
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_sql_unique_constraints_and_terminal_update_rejected(
    eval_pg: EvalHarness,
) -> None:
    service = _service_api()
    model = _model_api()
    _user_id, _session_id, run = await _bootstrap_run(
        eval_pg, utterances=["My name is Anna and I am a product manager."]
    )
    assert run is not None

    # run unique: clone every persisted column and only replace the id.
    async def clone_run(db: AsyncSession) -> None:
        existing = await db.get(model.GoalRun, run.id)
        values = {
            column.name: getattr(existing, column.name)
            for column in model.GoalRun.__table__.columns
            if column.name != "id"
        }
        db.add(model.GoalRun(id=uuid.uuid4(), **values))
        await db.flush()

    await _expect_sqlstate(
        eval_pg,
        expected_sqlstate="23505",
        constraint_name=GOAL_RUN_UNIQUE_CONSTRAINT,
        action=clone_run,
    )

    async with eval_pg.factory() as db, db.begin():
        await service.claim_next_goal_run(db)
        await service.execute_claimed_goal_run(run.id, db)

    # result unique: clone a persisted result and only replace the id.
    async with eval_pg.factory() as db:
        existing_result = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult)
                    .where(model.GoalEvaluationResult.run_id == run.id)
                    .order_by(model.GoalEvaluationResult.id)
                    .limit(1)
                )
            )
            .scalars()
            .one()
        )
        result_id = existing_result.id
        result_values = {
            column.name: getattr(existing_result, column.name)
            for column in model.GoalEvaluationResult.__table__.columns
            if column.name != "id"
        }

    async def clone_result(db: AsyncSession) -> None:
        db.add(model.GoalEvaluationResult(id=uuid.uuid4(), **result_values))
        await db.flush()

    await _expect_sqlstate(
        eval_pg,
        expected_sqlstate="23505",
        constraint_name=GOAL_RESULT_UNIQUE_CONSTRAINT,
        action=clone_result,
    )

    # terminal result UPDATE is rejected by the immutable trigger.
    async def update_result(db: AsyncSession) -> None:
        await db.execute(
            text(f"UPDATE {GOAL_RESULT_TABLE} SET result = 'achieved' WHERE id = :id"),
            {"id": result_id},
        )

    await _expect_sqlstate(
        eval_pg,
        expected_sqlstate=IMMUTABLE_RESULT_SQLSTATE,
        message_contains=IMMUTABLE_RESULT_MESSAGE,
        action=update_result,
    )


def _find_orig_attr(exc: Any, name: str, default: Any = None) -> Any:
    node = getattr(exc, "orig", exc)
    seen: set[int] = set()
    while node is not None and id(node) not in seen:
        seen.add(id(node))
        if hasattr(node, name):
            return getattr(node, name)
        node = getattr(node, "__cause__", None)
    return default


async def _expect_sqlstate(
    harness: EvalHarness,
    *,
    expected_sqlstate: str,
    constraint_name: str | None = None,
    message_contains: str | None = None,
    action: Any,
) -> None:
    async with harness.factory() as db:
        transaction = await db.begin()
        try:
            await action(db)
        except (DBAPIError, IntegrityError) as exc:
            await transaction.rollback()
            sqlstate = _find_orig_attr(exc, "sqlstate")
            if sqlstate != expected_sqlstate:
                pytest.fail(
                    f"expected SQLSTATE {expected_sqlstate}, got {sqlstate}",
                    pytrace=False,
                )
            if constraint_name is not None:
                got = _find_orig_attr(exc, "constraint_name")
                if got != constraint_name:
                    pytest.fail(
                        f"expected constraint {constraint_name}, got {got}",
                        pytrace=False,
                    )
            if message_contains is not None:
                message = _find_orig_attr(exc, "message", "") or str(
                    getattr(exc, "orig", exc)
                )
                if message_contains not in message:
                    pytest.fail(
                        f"expected message containing {message_contains!r}, "
                        f"got {message!r}",
                        pytrace=False,
                    )
            return
        await transaction.rollback()
    pytest.fail(f"expected SQLSTATE {expected_sqlstate}", pytrace=False)


@pytest.mark.asyncio
async def test_unsupported_goal_version_is_not_assessed(eval_pg: EvalHarness) -> None:
    service = _service_api()
    model = _model_api()
    user_id = await eval_pg.new_user("version")
    session_id = await eval_pg.new_session(user_id)
    await eval_pg.new_catalog(
        goals=[_pilot_goal(slug, goal_version=2) for slug in GOAL_SLUGS]
    )
    await eval_pg.new_snapshot(user_id=user_id, session_id=session_id)
    await eval_pg.new_transcript(
        session_id,
        role=TranscriptRole.user,
        content="My name is Anna and I am a product manager.",
    )
    await eval_pg.set_status(session_id, SessionStatus.completed)
    async with eval_pg.factory() as db, db.begin():
        run = await service.create_goal_run(db, session_id=session_id, user_id=user_id)
    assert run is not None
    async with eval_pg.factory() as db, db.begin():
        await service.claim_next_goal_run(db)
        await service.execute_claimed_goal_run(run.id, db)
    async with eval_pg.factory() as db:
        results = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {r.result.value for r in results} == {"not_assessed"}


@pytest.mark.asyncio
async def test_unsupported_material_version_is_not_assessed(
    eval_pg: EvalHarness,
) -> None:
    service = _service_api()
    model = _model_api()
    user_id = await eval_pg.new_user("mat-version")
    session_id = await eval_pg.new_session(user_id)
    await eval_pg.new_catalog(
        goals=[_pilot_goal(slug) for slug in GOAL_SLUGS],
        material_version=2,
    )
    await eval_pg.new_snapshot(
        user_id=user_id,
        session_id=session_id,
        material_version=2,
    )
    await eval_pg.new_transcript(
        session_id,
        role=TranscriptRole.user,
        content="My name is Anna and I am a product manager.",
    )
    await eval_pg.set_status(session_id, SessionStatus.completed)
    async with eval_pg.factory() as db, db.begin():
        run = await service.create_goal_run(db, session_id=session_id, user_id=user_id)
    assert run is not None
    async with eval_pg.factory() as db, db.begin():
        await service.claim_next_goal_run(db)
        await service.execute_claimed_goal_run(run.id, db)
    async with eval_pg.factory() as db:
        results = (
            (
                await db.execute(
                    select(model.GoalEvaluationResult).where(
                        model.GoalEvaluationResult.run_id == run.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {r.result.value for r in results} == {"not_assessed"}


@pytest.mark.asyncio
async def test_export_v3_damaged_evidence_fails_closed(eval_pg: EvalHarness) -> None:
    service = _service_api()
    user_id, session_id, run = await _bootstrap_run(
        eval_pg, utterances=["My name is Anna and I am a product manager."]
    )
    assert run is not None
    async with eval_pg.factory() as db, db.begin():
        await service.claim_next_goal_run(db)
        await service.execute_claimed_goal_run(run.id, db)

    # corrupt the frozen transcript content so the v3 evidence digest no longer matches
    async with eval_pg.factory() as db, db.begin():
        row = (
            (
                await db.execute(
                    select(Transcript).where(
                        Transcript.session_id == session_id,
                        Transcript.role == TranscriptRole.user,
                    )
                )
            )
            .scalars()
            .first()
        )
        row.content = "tampered content"

    async with _export_client(eval_pg, user_id) as client:
        res = await client.get(EXPORT_PATH, params={"schema_version": 3})
    assert res.status_code == 500
    assert res.headers.get("content-disposition") is None


@pytest.mark.asyncio
async def test_account_deletion_rollback_and_cross_account_isolation(
    eval_pg: EvalHarness,
) -> None:
    model = _model_api()
    user_a, _session_a, _run_a = await _bootstrap_run(
        eval_pg, utterances=["My name is Anna and I am a product manager."]
    )
    user_b, _session_b, run_b = await _bootstrap_run(
        eval_pg, utterances=["My name is Bob and I am an engineer."]
    )
    assert run_b is not None

    await eval_pg.install_user_delete_failure(user_a)
    async with eval_pg.factory() as db:
        transaction = await db.begin()
        try:
            await delete_user_account(db=db, user_id=user_a)
        except DBAPIError as exc:
            await transaction.rollback()
            orig = getattr(exc, "orig", None)
            assert getattr(orig, "sqlstate", None) == DELETE_FAILURE_SQLSTATE
            assert DELETE_FAILURE_MARKER in (getattr(orig, "message", "") or str(orig))
        else:
            await transaction.rollback()
            pytest.fail("expected delete trigger failure", pytrace=False)

    async with eval_pg.factory() as db:
        run_a_count = await db.scalar(
            select(func.count())
            .select_from(model.GoalRun)
            .where(model.GoalRun.session_id == _session_a)
        )
        run_b_count = await db.scalar(
            select(func.count())
            .select_from(model.GoalRun)
            .where(model.GoalRun.session_id == _session_b)
        )
        assert run_a_count == 1
        assert run_b_count == 1


@pytest.mark.asyncio
async def test_account_deletion_removes_goal_runs_in_same_transaction(
    eval_pg: EvalHarness,
) -> None:
    model = _model_api()
    user_id, _session_id, run = await _bootstrap_run(
        eval_pg, utterances=["My name is Anna and I am a product manager."]
    )
    assert run is not None

    async with eval_pg.factory() as db, db.begin():
        await delete_user_account(db=db, user_id=user_id)

    async with eval_pg.factory() as db:
        run_count = await db.scalar(select(func.count()).select_from(model.GoalRun))
        result_count = await db.scalar(
            select(func.count()).select_from(model.GoalEvaluationResult)
        )
        assert run_count == 0
        assert result_count == 0


@pytest.mark.asyncio
async def test_get_goals_after_authentication_select(eval_pg: EvalHarness) -> None:
    from routers.sessions import get_session_goals

    user_id = await eval_pg.new_user("auth-tx")
    session_id = await eval_pg.new_session(user_id)
    await eval_pg.new_catalog(goals=[_pilot_goal(slug) for slug in GOAL_SLUGS])
    await eval_pg.new_snapshot(user_id=user_id, session_id=session_id)
    await eval_pg.new_transcript(
        session_id,
        role=TranscriptRole.user,
        content="My name is Anna and I am a product manager.",
    )
    await eval_pg.set_status(session_id, SessionStatus.completed)

    current_user = CurrentUser(
        id=user_id,
        email=f"{user_id}@example.invalid",
        issuer="urn:goal-eval:auth-tx",
        subject=str(user_id),
    )

    async with eval_pg.factory() as db:
        # Authentication shares get_db and has already issued a User SELECT.
        await db.execute(select(User.id).where(User.id == user_id))
        # The handler must not SET TRANSACTION after the auth query (25001).
        response = await get_session_goals(
            session_id=session_id,
            current_user=current_user,
            db=db,
        )
        assert response.session_id == session_id
        assert response.configured is True
        # Do not commit/rollback the authentication transaction here.
