"""RED gate for B1-5 whole-account hard deletion.

The product modules are resolved at runtime so the rest of the backend test
tree remains collectable before B1-5 lands.  These tests use the dedicated
synthetic PostgreSQL database and exercise actual foreign keys, row locks,
transactions, authentication, worker entry points and the HTTP route.

Required product contract::

    DELETE /api/user/account -> 200 {"status": "deleted"}
    ``schemas.user_account_deletion.UserAccountDeletionResponse``
    ``services.user_account_deletion.delete_user_account(
        *, db: AsyncSession, user_id: UUID
    )``

The service performs all work in the caller's transaction and does not commit
success.  The route commits before acknowledging success and returns one
generic, non-sensitive 500 response on failure.
"""

import asyncio
import hashlib
import importlib
import json
import os
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator
from unittest.mock import patch

import httpx
import pytest
from alembic.script import ScriptDirectory
from pydantic import ValidationError
from sqlalchemy import delete, event, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import dependencies as auth_dependencies
from auth import AuthIdentity, CurrentUser
from database import get_db
from dependencies import (
    get_authenticated_identity,
    get_current_user,
    get_current_user_from_identity,
)
from main import app
from models.analysis import AnalysisJob, AnalysisJobStatus
from models.call_lease import CallLease, CallLeaseState
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.learning_event_cutover import LearningEventCutover
from models.session import (
    Session,
    SessionContext,
    SessionMode,
    SessionStatus,
    Transcript,
    TranscriptRole,
)
from models.user import User, UserProfile, UserSettings
from services.analysis_jobs import (
    AnalysisExecutionError,
    InvalidAnalysisTransition,
    claim_next_job,
    execute_claimed_job,
    record_job_failure,
    recover_stale_jobs,
    transition_job,
)
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.learning_event_canonical import build_canonical_observations
from services.learning_event_cutover import (
    assert_learning_event_gate,
    lock_cutover_control_for_update,
    prepare_cutover,
    stop_legacy_writes,
    write_legacy_baselines,
)
from services.learning_event_replay import validate_learning_event_replay
from services.learning_events import write_learning_events

DELETE_PATH = "/api/user/account"
DELETION_SERVICE = "services.user_account_deletion"
DELETION_SCHEMA = "schemas.user_account_deletion"
GENERIC_DELETE_ERROR = "Unable to delete user account."
EMPTY_BASELINE_DIGEST = hashlib.sha256(b"[]").hexdigest()
FROZEN_BKT_PARAMS = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}
BKT_PARAMS = BKTParams(**FROZEN_BKT_PARAMS)
CONTROL_CUTOVER_AT = datetime(2026, 11, 12, 23, 59, tzinfo=UTC)
LEGACY_ANALYSIS_AT = datetime(2026, 11, 12, 23, 40, tzinfo=UTC)
POST_CUTOVER_ANALYSIS_AT = datetime(2026, 11, 13, 4, 10, tzinfo=UTC)
TRIGGER_CANARY = "B1_5_DELETE_TRIGGER_SECRET_CANARY"
DEV_BEARER_TOKEN = "b1-5-real-token"


def _deletion_api():
    try:
        module = importlib.import_module(DELETION_SERVICE)
    except ModuleNotFoundError as exc:
        if exc.name == DELETION_SERVICE:
            pytest.fail(
                f"{DELETION_SERVICE} is not implemented (B1-5 RED)",
                pytrace=False,
            )
        raise
    if not hasattr(module, "delete_user_account"):
        pytest.fail(
            f"{DELETION_SERVICE}.delete_user_account is not implemented (B1-5 RED)",
            pytrace=False,
        )
    return module


def _deletion_schema():
    try:
        module = importlib.import_module(DELETION_SCHEMA)
    except ModuleNotFoundError as exc:
        if exc.name == DELETION_SCHEMA:
            pytest.fail(
                f"{DELETION_SCHEMA} is not implemented (B1-5 RED)",
                pytrace=False,
            )
        raise
    if not hasattr(module, "UserAccountDeletionResponse"):
        pytest.fail(
            "schemas.user_account_deletion.UserAccountDeletionResponse "
            "is not implemented (B1-5 RED)",
            pytrace=False,
        )
    return module


def _require_route_registered() -> None:
    path_item = app.openapi().get("paths", {}).get(DELETE_PATH, {})
    if "delete" not in path_item:
        pytest.fail(
            f"DELETE {DELETE_PATH} is not implemented (B1-5 RED)", pytrace=False
        )


def _require_b1_database_url():
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


def _digest(rows: list[tuple[uuid.UUID, str, float]]) -> str:
    canonical = [
        {
            "user_id": str(user_id),
            "skill_id": skill_id,
            "p_mastery": p_mastery,
        }
        for user_id, skill_id, p_mastery in sorted(
            rows,
            key=lambda row: (row[0], row[1]),
        )
    ]
    payload = json.dumps(
        canonical,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


@dataclass(frozen=True)
class AccountBundle:
    user_id: uuid.UUID
    session_id: uuid.UUID
    job_id: uuid.UUID
    pronunciation_id: uuid.UUID
    grammar_id: uuid.UUID
    baseline_revision: str
    baselines: tuple[tuple[uuid.UUID, str, float], ...]


@dataclass
class DeletionHarness:
    factory: async_sessionmaker[AsyncSession]
    engine: Any
    user_ids: list[uuid.UUID] = field(default_factory=list)
    session_ids: list[uuid.UUID] = field(default_factory=list)
    job_ids: list[uuid.UUID] = field(default_factory=list)
    trigger_functions: list[str] = field(default_factory=list)

    async def ensure_skills(self) -> None:
        for skill_id, name, category in (
            ("article_usage", "Article Usage", "grammar"),
            ("th_sounds", "TH sounds", "pronunciation"),
            ("verb_tense_past", "Past Tense", "grammar"),
        ):
            async with self.factory() as db, db.begin():
                if await db.get(Skill, skill_id) is None:
                    db.add(Skill(id=skill_id, name=name, category=category))

    async def new_account(
        self,
        label: str,
        *,
        user_id: uuid.UUID | None = None,
        mastery: dict[str, float] | None = None,
        with_baseline: bool = True,
        with_analysis_events: bool = True,
        job_status: AnalysisJobStatus = AnalysisJobStatus.succeeded,
        baseline_revision: str | None = None,
    ) -> AccountBundle:
        mastery = {
            "article_usage": 0.42,
            "th_sounds": 0.1,
            "verb_tense_past": 0.1,
            **(mastery or {}),
        }
        user_id = user_id or uuid.uuid4()
        session_id = uuid.uuid4()
        job_id = uuid.uuid4()
        pronunciation_id = uuid.uuid4()
        grammar_id = uuid.uuid4()
        occurred_at = (
            POST_CUTOVER_ANALYSIS_AT if with_analysis_events else LEGACY_ANALYSIS_AT
        )
        revision = baseline_revision or f"b1-5-{label}-{uuid.uuid4()}"
        async with self.factory() as db, db.begin():
            db.add(
                User(
                    id=user_id,
                    email=f"b1-5-{label}-{user_id}@example.invalid",
                    password_hash=f"password-{label}-canary",
                    auth_issuer=f"urn:b1-5:{label}",
                    auth_subject=f"subject-{user_id}",
                )
            )
            await db.flush()
            db.add(
                UserProfile(
                    user_id=user_id,
                    native_language="zh-CN",
                    target_level="B2",
                    learning_goals=["interview", label],
                    total_practice_minutes=37,
                )
            )
            db.add(
                UserSettings(
                    user_id=user_id,
                    theme="dark",
                    encrypted_stt_key=f"stt-{label}-cipher-canary",
                    stt_key_version="v1",
                    encrypted_llm_key=f"llm-{label}-cipher-canary",
                    llm_key_version="v2",
                    encrypted_tts_key=f"tts-{label}-cipher-canary",
                    tts_key_version="v3",
                )
            )
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
                    started_at=occurred_at - timedelta(minutes=10),
                    ended_at=occurred_at,
                )
            )
            await db.flush()
            db.add(
                Transcript(
                    session_id=session_id,
                    event_id=uuid.uuid4(),
                    role=TranscriptRole.user,
                    content=f"transcript-{label}-canary",
                    audio_url=f"https://audio.example.invalid/{label}.wav",
                    timestamp_ms=1,
                    emotion_state={"private": label},
                )
            )
            db.add(
                SessionContext(
                    session_id=session_id,
                    custom_prompt=f"prompt-{label}-canary",
                    document_content=f"document-{label}-canary",
                    content_type="text/markdown",
                )
            )
            db.add(
                AnalysisJob(
                    id=job_id,
                    session_id=session_id,
                    status=job_status,
                    attempt_count=(0 if job_status is AnalysisJobStatus.pending else 1),
                    started_at=(
                        None
                        if job_status is AnalysisJobStatus.pending
                        else occurred_at - timedelta(minutes=10)
                    ),
                    finished_at=(
                        occurred_at
                        if job_status
                        in {AnalysisJobStatus.succeeded, AnalysisJobStatus.failed}
                        else None
                    ),
                )
            )
            await db.flush()
            assessment = PronunciationAssessment(
                id=pronunciation_id,
                session_id=session_id,
                overall_score=82.5,
                phoneme_alignment=[
                    {
                        "position": 0,
                        "phoneme": "TH",
                        "expected": "TH",
                        "actual": "S",
                        "type": "substitution",
                    }
                ],
                source="b1-5-test",
                provider="fixture-provider",
                model_version="v1",
                is_synthetic=False,
                confidence=0.9,
                provider_response_ref=f"provider-{label}-canary",
                elsa_response={"raw": f"elsa-{label}-canary"},
            )
            grammar_error = GrammarError(
                id=grammar_id,
                session_id=session_id,
                skill_tag="verb_tense_past",
                original=f"original-{label}-canary",
                corrected=f"corrected-{label}-canary",
                error_type="tense",
                source="b1-5-test",
                provider="fixture-provider",
                model_version="v1",
                is_synthetic=False,
                confidence=0.8,
            )
            db.add(assessment)
            db.add(grammar_error)
            db.add(
                CallLease(
                    user_id=user_id,
                    session_id=session_id,
                    device_id=uuid.uuid4(),
                    generation=2,
                    state=CallLeaseState.held.value,
                    expires_at=occurred_at + timedelta(hours=1),
                )
            )
            await db.flush()

            if with_baseline:
                for skill_id, p_mastery in mastery.items():
                    db.add(
                        LearningEvent(
                            idempotency_key=f"baseline:{revision}:{user_id}:{skill_id}",
                            event_type="baseline_snapshot",
                            user_id=user_id,
                            skill_id=skill_id,
                            source="legacy_unknown",
                            p_mastery_snapshot=p_mastery,
                            cutover_revision=revision,
                            occurred_at=CONTROL_CUTOVER_AT,
                            details={
                                "schema_version": 1,
                                "legacy_synthetic_impact": "unknown",
                            },
                        )
                    )
                await db.flush()

            state_mastery = dict(mastery)
            if with_analysis_events:
                assert job_status is AnalysisJobStatus.succeeded
                canonical = build_canonical_observations(
                    job_id=job_id,
                    assessment=assessment,
                    grammar_errors=[grammar_error],
                    valid_skill_ids={
                        "article_usage",
                        "th_sounds",
                        "verb_tense_past",
                    },
                )
                db.add(
                    LearningEvent(
                        idempotency_key=f"job:{job_id}:completed",
                        event_type="analysis_completed",
                        user_id=user_id,
                        session_id=session_id,
                        analysis_job_id=job_id,
                        source="analysis",
                        algorithm_version="bkt-v1",
                        algorithm_params=dict(FROZEN_BKT_PARAMS),
                        occurred_at=occurred_at,
                        details={
                            "schema_version": 1,
                            "coverage": {
                                "pronunciation": {
                                    "status": "evaluated",
                                    "source": assessment.source,
                                    "provider": assessment.provider,
                                    "model_version": "v1",
                                    "is_synthetic": False,
                                },
                                "grammar": {
                                    "status": "evaluated",
                                    "source": grammar_error.source,
                                    "provider": grammar_error.provider,
                                    "model_version": "v1",
                                    "is_synthetic": False,
                                },
                            },
                            "unmapped": {
                                "pronunciation": canonical.unmapped_pronunciation,
                                "grammar": canonical.unmapped_grammar,
                            },
                        },
                    )
                )
                await db.flush()
                for observation in canonical.observations:
                    db.add(
                        LearningEvent(
                            idempotency_key=observation.idempotency_key,
                            event_type=observation.event_type,
                            user_id=user_id,
                            session_id=session_id,
                            analysis_job_id=job_id,
                            pronunciation_assessment_id=(
                                observation.pronunciation_assessment_id
                            ),
                            grammar_error_id=observation.grammar_error_id,
                            skill_id=observation.skill_id,
                            source_ordinal=observation.source_ordinal,
                            observation_correct=observation.observation_correct,
                            observation_code=observation.observation_code,
                            source=observation.source,
                            provider=observation.provider,
                            model_version=observation.model_version,
                            confidence=observation.confidence,
                            is_synthetic=observation.is_synthetic,
                            occurred_at=occurred_at,
                            details={"schema_version": 1},
                        )
                    )
                    await db.flush()
                    if not observation.is_synthetic:
                        current = state_mastery.get(observation.skill_id, 0.1)
                        if not with_baseline:
                            current = BKT_PARAMS.p_init
                        state_mastery[observation.skill_id] = update_mastery(
                            current,
                            observation.observation_correct,
                            BKT_PARAMS,
                        )

            for skill_id, p_mastery in state_mastery.items():
                db.add(
                    KnowledgeState(
                        user_id=user_id,
                        skill_id=skill_id,
                        p_mastery=p_mastery,
                        updated_at=occurred_at,
                    )
                )

        self.user_ids.append(user_id)
        self.session_ids.append(session_id)
        self.job_ids.append(job_id)
        return AccountBundle(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            pronunciation_id=pronunciation_id,
            grammar_id=grammar_id,
            baseline_revision=revision,
            baselines=tuple(
                (user_id, skill_id, p_mastery)
                for skill_id, p_mastery in mastery.items()
            )
            if with_baseline
            else (),
        )

    async def set_control(
        self,
        phase: str,
        baselines: list[tuple[uuid.UUID, str, float]],
        *,
        revision: str,
    ) -> tuple[str, datetime | None]:
        cutover_at = CONTROL_CUTOVER_AT
        complete = phase in {
            "baselines_written",
            "events_enabled",
            "traffic_resumed",
        }
        values = {
            "id": 1,
            "revision": revision,
            "phase": phase,
            "cutover_at": cutover_at if complete else None,
            "baseline_count": len(baselines) if complete else 0,
            "baseline_digest": _digest(baselines) if complete else None,
        }
        async with self.factory() as db, db.begin():
            await db.execute(text("DELETE FROM learning_event_cutover"))
            await db.execute(LearningEventCutover.__table__.insert().values(**values))
        return revision, values["cutover_at"]

    async def install_delete_failure(
        self, user_id: uuid.UUID, *, deferred: bool
    ) -> None:
        suffix = uuid.uuid4().hex
        function_name = f"b1_5_reject_delete_{suffix}"
        trigger_name = f"b1_5_reject_delete_{suffix}"
        async with self.factory() as db, db.begin():
            await db.execute(
                text(
                    f"""
                    CREATE FUNCTION {function_name}() RETURNS trigger
                    LANGUAGE plpgsql AS $b1_5$
                    BEGIN
                        RAISE EXCEPTION '{TRIGGER_CANARY}';
                    END;
                    $b1_5$
                    """
                )
            )
            if deferred:
                await db.execute(
                    text(
                        f"""
                        CREATE CONSTRAINT TRIGGER {trigger_name}
                        AFTER DELETE ON users
                        DEFERRABLE INITIALLY DEFERRED
                        FOR EACH ROW
                        WHEN (OLD.id = '{user_id}'::uuid)
                        EXECUTE FUNCTION {function_name}()
                        """
                    )
                )
            else:
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
            user_ids = self.user_ids
            session_ids = self.session_ids
            job_ids = self.job_ids
            if user_ids:
                await db.execute(
                    delete(LearningEvent).where(LearningEvent.user_id.in_(user_ids))
                )
                await db.execute(
                    delete(CallLease).where(CallLease.user_id.in_(user_ids))
                )
                await db.execute(
                    delete(KnowledgeState).where(KnowledgeState.user_id.in_(user_ids))
                )
                await db.execute(
                    delete(UserSettings).where(UserSettings.user_id.in_(user_ids))
                )
                await db.execute(
                    delete(UserProfile).where(UserProfile.user_id.in_(user_ids))
                )
            if session_ids:
                await db.execute(
                    delete(LearningEvent).where(
                        LearningEvent.session_id.in_(session_ids)
                    )
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
                    delete(Transcript).where(Transcript.session_id.in_(session_ids))
                )
                await db.execute(
                    delete(SessionContext).where(
                        SessionContext.session_id.in_(session_ids)
                    )
                )
                await db.execute(
                    delete(CallLease).where(CallLease.session_id.in_(session_ids))
                )
            if job_ids:
                await db.execute(
                    delete(LearningEvent).where(
                        LearningEvent.analysis_job_id.in_(job_ids)
                    )
                )
                await db.execute(delete(AnalysisJob).where(AnalysisJob.id.in_(job_ids)))
            if session_ids:
                await db.execute(delete(Session).where(Session.id.in_(session_ids)))
            if user_ids:
                await db.execute(delete(User).where(User.id.in_(user_ids)))
            await db.execute(text("DELETE FROM learning_event_cutover"))
        await self.engine.dispose()


@pytest.fixture
async def deletion_pg():
    database_url = _require_b1_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    harness = DeletionHarness(factory=factory, engine=engine)
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
            await db.execute(text("DELETE FROM learning_event_cutover"))
            identity_verified = True
        await harness.ensure_skills()
        yield harness
    finally:
        if identity_verified:
            await harness.cleanup()
        else:
            await engine.dispose()


def _owned_where(
    model: Any,
    user_ids: list[uuid.UUID],
    session_ids: list[uuid.UUID],
):
    if hasattr(model, "user_id"):
        return model.user_id.in_(user_ids)
    return model.session_id.in_(session_ids)


async def _owned_snapshot(
    harness: DeletionHarness,
    user_ids: list[uuid.UUID],
) -> dict[str, list[dict[str, Any]]]:
    async with harness.factory() as db:
        session_ids = list(
            (
                await db.execute(
                    select(Session.id).where(Session.user_id.in_(user_ids))
                )
            ).scalars()
        )
        snapshot: dict[str, list[dict[str, Any]]] = {}
        models = {
            "users": User,
            "profiles": UserProfile,
            "settings": UserSettings,
            "sessions": Session,
            "transcripts": Transcript,
            "contexts": SessionContext,
            "jobs": AnalysisJob,
            "pronunciations": PronunciationAssessment,
            "grammar_errors": GrammarError,
            "knowledge_states": KnowledgeState,
            "events": LearningEvent,
            "call_leases": CallLease,
        }
        for name, model in models.items():
            where = (
                model.id.in_(user_ids)
                if model is User
                else model.id.in_(session_ids)
                if model is Session
                else _owned_where(model, user_ids, session_ids)
            )
            rows = (await db.execute(select(model).where(where))).scalars()
            serialized = [
                {
                    column.key: getattr(row, column.key)
                    for column in model.__table__.columns
                }
                for row in rows
            ]
            snapshot[name] = sorted(
                serialized,
                key=lambda row: json.dumps(
                    {
                        key: (
                            value.isoformat()
                            if isinstance(value, datetime)
                            else str(value)
                        )
                        for key, value in row.items()
                    },
                    sort_keys=True,
                ),
            )
        snapshot["skills"] = [
            {
                "id": row.id,
                "name": row.name,
                "category": row.category,
                "description": row.description,
            }
            for row in (
                await db.execute(
                    select(Skill)
                    .where(
                        Skill.id.in_(["article_usage", "th_sounds", "verb_tense_past"])
                    )
                    .order_by(Skill.id)
                )
            ).scalars()
        ]
        return snapshot


async def _control_snapshot(
    harness: DeletionHarness,
) -> dict[str, Any] | None:
    async with harness.factory() as db:
        control = await db.get(LearningEventCutover, 1)
        if control is None:
            return None
        return {
            "id": control.id,
            "revision": control.revision,
            "phase": control.phase,
            "cutover_at": control.cutover_at,
            "baseline_count": control.baseline_count,
            "baseline_digest": control.baseline_digest,
        }


async def _assert_owned_rows_absent(
    harness: DeletionHarness,
    bundle: AccountBundle,
) -> None:
    async with harness.factory() as db:
        assert await db.get(User, bundle.user_id) is None
        assert await db.get(UserProfile, bundle.user_id) is None
        assert await db.get(UserSettings, bundle.user_id) is None
        assert await db.get(Session, bundle.session_id) is None
        assert await db.get(AnalysisJob, bundle.job_id) is None
        assert await db.get(PronunciationAssessment, bundle.pronunciation_id) is None
        assert await db.get(GrammarError, bundle.grammar_id) is None
        assert await db.get(CallLease, bundle.user_id) is None
        assert (
            await db.scalar(
                select(Transcript.id).where(Transcript.session_id == bundle.session_id)
            )
        ) is None
        assert (
            await db.scalar(
                select(SessionContext.id).where(
                    SessionContext.session_id == bundle.session_id
                )
            )
        ) is None
        assert (
            await db.scalar(
                select(KnowledgeState.id).where(
                    KnowledgeState.user_id == bundle.user_id
                )
            )
        ) is None
        assert (
            await db.scalar(
                select(LearningEvent.apply_seq).where(
                    LearningEvent.user_id == bundle.user_id
                )
            )
        ) is None


@contextmanager
def _request_as(
    user_id: uuid.UUID,
    factory: async_sessionmaker[AsyncSession],
) -> Iterator[None]:
    previous_identity = app.dependency_overrides.get(get_authenticated_identity)
    previous_user = app.dependency_overrides.get(get_current_user)
    previous_mapped_user = app.dependency_overrides.get(get_current_user_from_identity)
    previous_db = app.dependency_overrides.get(get_db)

    async def override_identity() -> AuthIdentity:
        return AuthIdentity(
            issuer="urn:echotalk:b1-5-test",
            subject=f"b1-5-{user_id}",
            email=f"{user_id}@example.invalid",
        )

    async def override_user() -> CurrentUser:
        return CurrentUser(
            id=user_id,
            email=f"{user_id}@example.invalid",
            issuer="urn:echotalk:b1-5-test",
            subject=f"b1-5-{user_id}",
        )

    async def override_db():
        async with factory() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    app.dependency_overrides[get_authenticated_identity] = override_identity
    app.dependency_overrides[get_current_user] = override_user
    app.dependency_overrides[get_current_user_from_identity] = override_user
    app.dependency_overrides[get_db] = override_db
    try:
        yield
    finally:
        if previous_identity is None:
            app.dependency_overrides.pop(get_authenticated_identity, None)
        else:
            app.dependency_overrides[get_authenticated_identity] = previous_identity
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user
        if previous_mapped_user is None:
            app.dependency_overrides.pop(get_current_user_from_identity, None)
        else:
            app.dependency_overrides[get_current_user_from_identity] = (
                previous_mapped_user
            )
        if previous_db is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_db


@contextmanager
def _real_bearer(
    factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    *,
    mock_user_id: uuid.UUID,
    issuer: str,
    subject: str,
    application_name: str = "b1-5-http-delete",
) -> Iterator[None]:
    previous_identity = app.dependency_overrides.pop(get_authenticated_identity, None)
    previous_user = app.dependency_overrides.pop(get_current_user, None)
    previous_mapped_user = app.dependency_overrides.pop(
        get_current_user_from_identity,
        None,
    )
    monkeypatch.setattr("dependencies.settings.AUTH_MODE", "dev")
    monkeypatch.setattr(
        "dependencies.settings.DEV_AUTH_TOKEN",
        DEV_BEARER_TOKEN,
    )
    monkeypatch.setattr(auth_dependencies, "MOCK_USER_ID", str(mock_user_id))
    monkeypatch.setattr(auth_dependencies, "DEV_ISSUER", issuer)
    monkeypatch.setattr(auth_dependencies, "DEV_SUBJECT", subject)

    async def override_db():
        async with factory() as db:
            try:
                await db.execute(
                    text("SELECT set_config('application_name', :value, true)"),
                    {"value": application_name},
                )
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_db
    try:
        yield
    finally:
        if previous_identity is not None:
            app.dependency_overrides[get_authenticated_identity] = previous_identity
        if previous_user is not None:
            app.dependency_overrides[get_current_user] = previous_user
        if previous_mapped_user is not None:
            app.dependency_overrides[get_current_user_from_identity] = (
                previous_mapped_user
            )
        if previous_db is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_db


async def _delete_http(
    *,
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    query: dict[str, str] | None = None,
) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        return await client.request(
            "DELETE",
            DELETE_PATH,
            headers=headers,
            json=body,
            params=query,
        )


async def _wait_for_blocked_application(
    harness: DeletionHarness,
    application_name: str,
) -> list[int]:
    deadline = asyncio.get_running_loop().time() + 5
    while asyncio.get_running_loop().time() < deadline:
        async with harness.factory() as db:
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
            return [pid for pid, _ in rows]
        await asyncio.sleep(0.02)
    raise AssertionError(
        f"timed out waiting for blocked application {application_name}"
    )


@pytest.mark.asyncio
async def test_native_fixture_precondition_is_clean_before_deletion_red(
    deletion_pg: DeletionHarness,
):
    revision = f"b1-5-fixture-precondition-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "fixture-precondition-target",
        baseline_revision=revision,
    )
    await deletion_pg.set_control(
        "traffic_resumed",
        list(target.baselines),
        revision=revision,
    )

    async with deletion_pg.factory() as db, db.begin():
        await write_legacy_baselines(db=db, revision=revision)
    report = await validate_learning_event_replay(
        deletion_pg.factory,
        algorithm_versions={"bkt-v1": dict(FROZEN_BKT_PARAMS)},
    )

    assert report.issues == ()


def test_delete_response_schema_is_typed_and_fixed():
    schema = _deletion_schema()
    response = schema.UserAccountDeletionResponse(status="deleted")
    assert response.model_dump() == {"status": "deleted"}
    with pytest.raises(ValidationError):
        schema.UserAccountDeletionResponse(status="ok")


def test_route_openapi_declares_typed_fixed_success_response():
    _require_route_registered()
    document = app.openapi()
    operation = document["paths"][DELETE_PATH]["delete"]
    success_schema = operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    assert success_schema["$ref"] == (
        "#/components/schemas/UserAccountDeletionResponse"
    )
    component = document["components"]["schemas"]["UserAccountDeletionResponse"]
    assert component["properties"]["status"]["const"] == "deleted"
    assert component["required"] == ["status"]


@pytest.mark.asyncio
async def test_full_delete_removes_every_owned_row_and_preserves_other_values(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-full-delete-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "target",
        mastery={
            "article_usage": 0.24,
            "verb_tense_past": 0.51,
        },
        baseline_revision=revision,
    )
    other = await deletion_pg.new_account(
        "other",
        mastery={
            "article_usage": 0.63,
            "verb_tense_past": 0.77,
        },
        baseline_revision=revision,
    )
    revision, cutover_at = await deletion_pg.set_control(
        "traffic_resumed",
        [*target.baselines, *other.baselines],
        revision=revision,
    )
    before_other = await _owned_snapshot(deletion_pg, [other.user_id])

    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=target.user_id)

    await _assert_owned_rows_absent(deletion_pg, target)
    assert await _owned_snapshot(deletion_pg, [other.user_id]) == before_other
    async with deletion_pg.factory() as db:
        control = await db.get(LearningEventCutover, 1)
        assert control is not None
        assert control.revision == revision
        assert control.phase == "traffic_resumed"
        assert control.cutover_at == cutover_at
        assert control.baseline_count == len(other.baselines)
        assert control.baseline_digest == _digest(list(other.baselines))
        assert await db.get(Skill, "article_usage") is not None
        assert await db.get(Skill, "th_sounds") is not None
        assert await db.get(Skill, "verb_tense_past") is not None


@pytest.mark.asyncio
async def test_deleting_last_baseline_uses_canonical_empty_digest(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-last-baseline-{uuid.uuid4()}"
    bundle = await deletion_pg.new_account(
        "last-baseline",
        mastery={"article_usage": 0.31},
        baseline_revision=revision,
    )
    revision, cutover_at = await deletion_pg.set_control(
        "traffic_resumed",
        list(bundle.baselines),
        revision=revision,
    )

    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=bundle.user_id)

    await _assert_owned_rows_absent(deletion_pg, bundle)
    async with deletion_pg.factory() as db:
        control = await db.get(LearningEventCutover, 1)
        assert control is not None
        assert control.revision == revision
        assert control.phase == "traffic_resumed"
        assert control.cutover_at == cutover_at
        assert control.baseline_count == 0
        assert control.baseline_digest == EMPTY_BASELINE_DIGEST
        assert (
            await db.scalar(
                select(LearningEvent.apply_seq).where(
                    LearningEvent.event_type == "baseline_snapshot"
                )
            )
        ) is None


@pytest.mark.parametrize(
    ("phase", "has_baselines"),
    [
        ("prepared", False),
        ("legacy_writes_stopped", False),
        ("baselines_written", True),
        ("events_enabled", True),
        ("traffic_resumed", True),
    ],
)
@pytest.mark.asyncio
async def test_delete_is_legal_in_every_cutover_phase_and_keeps_control_shape(
    deletion_pg: DeletionHarness,
    phase: str,
    has_baselines: bool,
):
    service = _deletion_api()
    revision = f"b1-5-phase-{phase}-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        f"phase-target-{phase}",
        with_baseline=has_baselines,
        with_analysis_events=has_baselines,
        baseline_revision=revision,
    )
    other = await deletion_pg.new_account(
        f"phase-other-{phase}",
        mastery={"verb_tense_past": 0.66},
        with_baseline=has_baselines,
        with_analysis_events=has_baselines,
        baseline_revision=revision,
    )
    baselines = [*target.baselines, *other.baselines] if has_baselines else []
    revision, cutover_at = await deletion_pg.set_control(
        phase,
        baselines,
        revision=revision,
    )
    before_other = await _owned_snapshot(deletion_pg, [other.user_id])

    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=target.user_id)

    await _assert_owned_rows_absent(deletion_pg, target)
    assert await _owned_snapshot(deletion_pg, [other.user_id]) == before_other
    async with deletion_pg.factory() as db:
        control = await db.get(LearningEventCutover, 1)
        assert control is not None
        assert control.revision == revision
        assert control.phase == phase
        assert control.cutover_at == cutover_at
        assert control.baseline_count == (len(other.baselines) if has_baselines else 0)
        assert control.baseline_digest == (
            _digest(list(other.baselines)) if has_baselines else None
        )


@pytest.mark.asyncio
async def test_empty_and_repeated_delete_are_idempotent(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-idempotent-{uuid.uuid4()}"
    bundle = await deletion_pg.new_account(
        "idempotent",
        with_baseline=False,
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control("prepared", [], revision=revision)

    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=bundle.user_id)
    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=bundle.user_id)
    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=uuid.uuid4())

    await _assert_owned_rows_absent(deletion_pg, bundle)
    async with deletion_pg.factory() as db:
        assert await db.get(LearningEventCutover, 1) is not None


@pytest.mark.asyncio
async def test_existing_user_with_no_child_rows_deletes_cleanly(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    user_id = uuid.uuid4()
    revision = f"b1-5-empty-user-{uuid.uuid4()}"
    deletion_pg.user_ids.append(user_id)
    await deletion_pg.set_control("prepared", [], revision=revision)
    async with deletion_pg.factory() as db, db.begin():
        db.add(
            User(
                id=user_id,
                email=f"empty-{user_id}@example.invalid",
                auth_issuer=f"urn:b1-5:empty:{user_id}",
                auth_subject=f"empty:{user_id}",
            )
        )

    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=user_id)

    async with deletion_pg.factory() as db:
        assert await db.get(User, user_id) is None
        assert await db.get(UserProfile, user_id) is None
        assert await db.get(UserSettings, user_id) is None


@pytest.mark.asyncio
async def test_delete_in_early_phase_with_no_control_row_is_legal_when_no_baselines_exist(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-missing-control-clean-{uuid.uuid4()}"
    bundle = await deletion_pg.new_account(
        "missing-control-clean",
        with_baseline=False,
        with_analysis_events=False,
        baseline_revision=revision,
    )

    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=bundle.user_id)

    await _assert_owned_rows_absent(deletion_pg, bundle)
    async with deletion_pg.factory() as db:
        assert await db.get(LearningEventCutover, 1) is None


@pytest.mark.asyncio
async def test_missing_control_delete_serializes_with_concurrent_baseline_prepare(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-missing-control-race-{uuid.uuid4()}"
    bundle = await deletion_pg.new_account(
        "missing-control-race",
        with_baseline=False,
        with_analysis_events=False,
        baseline_revision=revision,
    )
    control_checked = asyncio.Event()
    release_delete = asyncio.Event()
    original_lock = lock_cutover_control_for_update

    async def observed_missing_control_lock(
        db: AsyncSession,
    ) -> LearningEventCutover | None:
        row = await original_lock(db)
        assert row is None
        control_checked.set()
        await release_delete.wait()
        return row

    async def prepare_and_write_baseline() -> None:
        async with deletion_pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b1-5-missing-control-baseline"},
            )
            await prepare_cutover(db=db, revision=revision)
            await stop_legacy_writes(
                db=db,
                revision=revision,
                confirmed_legacy_writers_stopped=True,
            )
            await write_legacy_baselines(db=db, revision=revision)

    async def delete_account() -> None:
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=bundle.user_id)

    deletion = None
    baseline = None
    try:
        with patch.object(
            service,
            "lock_cutover_control_for_update",
            observed_missing_control_lock,
        ):
            deletion = asyncio.create_task(delete_account())
            await asyncio.wait_for(control_checked.wait(), timeout=5)
            baseline = asyncio.create_task(prepare_and_write_baseline())
            try:
                await asyncio.wait_for(
                    asyncio.shield(baseline),
                    timeout=1,
                )
            except TimeoutError:
                await _wait_for_blocked_application(
                    deletion_pg,
                    "b1-5-missing-control-baseline",
                )
            release_delete.set()
            await asyncio.wait_for(
                asyncio.gather(deletion, baseline),
                timeout=10,
            )
    finally:
        release_delete.set()
        for task in (deletion, baseline):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (deletion, baseline) if task is not None),
            return_exceptions=True,
        )

    await _assert_owned_rows_absent(deletion_pg, bundle)
    async with deletion_pg.factory() as db:
        control = await db.get(LearningEventCutover, 1)
        assert control is not None
        assert control.baseline_count == 0
        assert control.baseline_digest == EMPTY_BASELINE_DIGEST
        assert (
            await db.scalar(
                select(LearningEvent.apply_seq).where(
                    LearningEvent.event_type == "baseline_snapshot"
                )
            )
        ) is None


@pytest.mark.asyncio
async def test_missing_control_with_baseline_events_fails_closed(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    bundle = await deletion_pg.new_account(
        "missing-control-baseline",
        with_analysis_events=False,
    )
    before = await _owned_snapshot(deletion_pg, [bundle.user_id])

    with pytest.raises(Exception):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=bundle.user_id)

    assert await _owned_snapshot(deletion_pg, [bundle.user_id]) == before
    assert await _control_snapshot(deletion_pg) is None


@pytest.mark.parametrize(
    "phase",
    ["prepared", "legacy_writes_stopped"],
)
@pytest.mark.asyncio
async def test_baseline_events_in_incomplete_phase_fail_closed(
    deletion_pg: DeletionHarness,
    phase: str,
):
    service = _deletion_api()
    bundle = await deletion_pg.new_account(
        f"early-baseline-{phase}",
        with_analysis_events=False,
    )
    await deletion_pg.set_control(
        phase,
        [],
        revision=bundle.baseline_revision,
    )
    before_rows = await _owned_snapshot(deletion_pg, [bundle.user_id])
    before_control = await _control_snapshot(deletion_pg)

    with pytest.raises(Exception):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=bundle.user_id)

    assert (
        await _owned_snapshot(
            deletion_pg,
            [bundle.user_id],
        )
        == before_rows
    )
    assert await _control_snapshot(deletion_pg) == before_control


@pytest.mark.asyncio
async def test_corrupt_control_digest_fails_closed_without_whitelisting(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    bundle = await deletion_pg.new_account("broken-digest")
    await deletion_pg.set_control(
        "baselines_written",
        list(bundle.baselines),
        revision=bundle.baseline_revision,
    )
    async with deletion_pg.factory() as db, db.begin():
        await db.execute(
            text(
                "UPDATE learning_event_cutover "
                "SET baseline_digest = repeat('0', 64) WHERE id = 1"
            )
        )
    before = await _owned_snapshot(deletion_pg, [bundle.user_id])
    before_control = await _control_snapshot(deletion_pg)

    with pytest.raises(Exception):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=bundle.user_id)

    assert await _owned_snapshot(deletion_pg, [bundle.user_id]) == before
    assert await _control_snapshot(deletion_pg) == before_control


@pytest.mark.asyncio
async def test_control_count_mismatch_fails_closed_without_partial_delete(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    bundle = await deletion_pg.new_account("broken-count")
    await deletion_pg.set_control(
        "baselines_written",
        list(bundle.baselines),
        revision=bundle.baseline_revision,
    )
    async with deletion_pg.factory() as db, db.begin():
        await db.execute(
            text(
                "UPDATE learning_event_cutover "
                "SET baseline_count = baseline_count + 1 WHERE id = 1"
            )
        )
    before_rows = await _owned_snapshot(deletion_pg, [bundle.user_id])
    before_control = await _control_snapshot(deletion_pg)

    with pytest.raises(Exception):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=bundle.user_id)

    assert (
        await _owned_snapshot(
            deletion_pg,
            [bundle.user_id],
        )
        == before_rows
    )
    assert await _control_snapshot(deletion_pg) == before_control


@pytest.mark.asyncio
async def test_cross_user_event_ownership_fails_closed(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-cross-event-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "cross-event-target",
        with_baseline=False,
        with_analysis_events=False,
        baseline_revision=revision,
    )
    other = await deletion_pg.new_account(
        "cross-event-other",
        with_baseline=False,
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control("prepared", [], revision=revision)
    async with deletion_pg.factory() as db, db.begin():
        db.add(
            LearningEvent(
                idempotency_key=f"job:{other.job_id}:completed",
                event_type="analysis_completed",
                user_id=target.user_id,
                session_id=other.session_id,
                analysis_job_id=other.job_id,
                source="analysis",
                algorithm_version="bkt-v1",
                algorithm_params=dict(FROZEN_BKT_PARAMS),
                occurred_at=datetime(2026, 11, 13, 4, 10, tzinfo=UTC),
                details={
                    "schema_version": 1,
                    "coverage": {},
                    "unmapped": {"pronunciation": 0, "grammar": 0},
                },
            )
        )
    before = await _owned_snapshot(
        deletion_pg,
        [target.user_id, other.user_id],
    )
    before_control = await _control_snapshot(deletion_pg)

    with pytest.raises(Exception):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=target.user_id)

    assert (
        await _owned_snapshot(
            deletion_pg,
            [target.user_id, other.user_id],
        )
        == before
    )
    assert await _control_snapshot(deletion_pg) == before_control


@pytest.mark.asyncio
async def test_cross_owned_baseline_event_fails_closed(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-cross-baseline-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "cross-baseline-target",
        baseline_revision=revision,
    )
    other = await deletion_pg.new_account(
        "cross-baseline-other",
        mastery={"verb_tense_past": 0.64},
        baseline_revision=revision,
    )
    await deletion_pg.set_control(
        "traffic_resumed",
        [*target.baselines, *other.baselines],
        revision=revision,
    )
    async with deletion_pg.factory() as db, db.begin():
        await db.execute(
            text(
                "UPDATE learning_events SET user_id = :other_user_id "
                "WHERE user_id = :target_user_id "
                "AND event_type = 'baseline_snapshot'"
            ),
            {
                "target_user_id": target.user_id,
                "other_user_id": other.user_id,
            },
        )
    before_rows = await _owned_snapshot(
        deletion_pg,
        [target.user_id, other.user_id],
    )
    before_control = await _control_snapshot(deletion_pg)

    with pytest.raises(Exception):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=target.user_id)

    assert (
        await _owned_snapshot(
            deletion_pg,
            [target.user_id, other.user_id],
        )
        == before_rows
    )
    assert await _control_snapshot(deletion_pg) == before_control


@pytest.mark.asyncio
async def test_cross_user_call_lease_fails_closed_instead_of_set_null(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-cross-lease-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "cross-lease-target",
        with_baseline=False,
        with_analysis_events=False,
        baseline_revision=revision,
    )
    other = await deletion_pg.new_account(
        "cross-lease-other",
        with_baseline=False,
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control("prepared", [], revision=revision)
    async with deletion_pg.factory() as db, db.begin():
        lease = await db.get(CallLease, target.user_id)
        assert lease is not None
        lease.session_id = other.session_id
    before = await _owned_snapshot(
        deletion_pg,
        [target.user_id, other.user_id],
    )
    before_control = await _control_snapshot(deletion_pg)

    with pytest.raises(Exception):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=target.user_id)

    assert (
        await _owned_snapshot(
            deletion_pg,
            [target.user_id, other.user_id],
        )
        == before
    )
    assert await _control_snapshot(deletion_pg) == before_control


@pytest.mark.asyncio
async def test_late_user_delete_failure_rolls_back_earlier_child_deletes(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    bundle = await deletion_pg.new_account("late-rollback")
    await deletion_pg.set_control(
        "traffic_resumed",
        list(bundle.baselines),
        revision=bundle.baseline_revision,
    )
    await deletion_pg.install_delete_failure(bundle.user_id, deferred=False)
    before = await _owned_snapshot(deletion_pg, [bundle.user_id])
    before_control = await _control_snapshot(deletion_pg)

    with pytest.raises(Exception):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=bundle.user_id)

    assert await _owned_snapshot(deletion_pg, [bundle.user_id]) == before
    assert await _control_snapshot(deletion_pg) == before_control


@pytest.mark.asyncio
async def test_claimed_and_stale_job_paths_cannot_resurrect_deleted_data(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    bundle = await deletion_pg.new_account(
        "claimed-job",
        with_analysis_events=False,
        job_status=AnalysisJobStatus.pending,
    )
    await deletion_pg.set_control(
        "traffic_resumed",
        list(bundle.baselines),
        revision=bundle.baseline_revision,
    )
    async with deletion_pg.factory() as db, db.begin():
        assert await claim_next_job(db) == bundle.job_id
    async with deletion_pg.factory() as db:
        stale_job = await db.get(AnalysisJob, bundle.job_id)
        stale_session = await db.get(Session, bundle.session_id)
        stale_grammar = await db.get(GrammarError, bundle.grammar_id)
        assert stale_job is not None
        assert stale_session is not None
        assert stale_grammar is not None
        db.expunge(stale_job)
        db.expunge(stale_session)
        db.expunge(stale_grammar)

    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=bundle.user_id)

    future = datetime.now(UTC) + timedelta(days=1)
    async with deletion_pg.factory() as db, db.begin():
        assert await recover_stale_jobs(db, now=future) == 0
        assert await claim_next_job(db, now=future) is None
        assert (
            await record_job_failure(
                bundle.job_id,
                AnalysisExecutionError("late_failure", "late failure"),
                db,
                now=future,
            )
            is None
        )

    with pytest.raises(InvalidAnalysisTransition):
        async with deletion_pg.factory() as db, db.begin():
            await execute_claimed_job(bundle.job_id, db)
    with pytest.raises(AnalysisExecutionError) as writer_error:
        async with deletion_pg.factory() as db, db.begin():
            await write_learning_events(
                job=stale_job,
                session=stale_session,
                user_id=bundle.user_id,
                assessment=None,
                grammar_errors=[stale_grammar],
                coverage={
                    "pronunciation": {
                        "status": "not_called",
                        "source": None,
                        "provider": None,
                        "model_version": None,
                        "is_synthetic": None,
                    },
                    "grammar": {
                        "status": "evaluated",
                        "source": "b1-5-test",
                        "provider": "synthetic",
                        "model_version": "v1",
                        "is_synthetic": False,
                    },
                },
                db=db,
            )
    assert writer_error.value.code == "job_missing"
    await _assert_owned_rows_absent(deletion_pg, bundle)


@pytest.mark.asyncio
async def test_worker_and_delete_serialize_without_deadlock_or_late_resurrection(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-worker-delete-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "worker-delete-target",
        with_analysis_events=False,
        job_status=AnalysisJobStatus.running,
        baseline_revision=revision,
    )
    other = await deletion_pg.new_account(
        "worker-delete-other",
        mastery={"verb_tense_past": 0.71},
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control(
        "traffic_resumed",
        [*target.baselines, *other.baselines],
        revision=revision,
    )
    before_other = await _owned_snapshot(deletion_pg, [other.user_id])
    user_locked = asyncio.Event()
    release_user = asyncio.Event()

    async def hold_user_lock():
        async with deletion_pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b1-5-user-blocker"},
            )
            assert (
                await db.scalar(
                    select(User.id).where(User.id == target.user_id).with_for_update()
                )
                == target.user_id
            )
            user_locked.set()
            await release_user.wait()

    async def run_worker():
        async with deletion_pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b1-5-worker-writer"},
            )
            job = await db.get(AnalysisJob, target.job_id)
            session = await db.get(Session, target.session_id)
            grammar = await db.get(GrammarError, target.grammar_id)
            assert job is not None and session is not None and grammar is not None
            await write_learning_events(
                job=job,
                session=session,
                user_id=target.user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage={
                    "pronunciation": {
                        "status": "not_called",
                        "source": None,
                        "provider": None,
                        "model_version": None,
                        "is_synthetic": None,
                    },
                    "grammar": {
                        "status": "evaluated",
                        "source": "b1-5-test",
                        "provider": "synthetic",
                        "model_version": "v1",
                        "is_synthetic": False,
                    },
                },
                db=db,
            )
            transition_job(job, AnalysisJobStatus.succeeded)

    async def run_delete():
        async with deletion_pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b1-5-delete"},
            )
            await service.delete_user_account(db=db, user_id=target.user_id)

    blocker = asyncio.create_task(hold_user_lock())
    worker = None
    deletion = None
    try:
        await asyncio.wait_for(user_locked.wait(), timeout=5)
        worker = asyncio.create_task(run_worker())
        await _wait_for_blocked_application(deletion_pg, "b1-5-worker-writer")
        deletion = asyncio.create_task(run_delete())
        await _wait_for_blocked_application(deletion_pg, "b1-5-delete")
        assert not worker.done()
        assert not deletion.done()
        release_user.set()
        await asyncio.wait_for(blocker, timeout=5)
        await asyncio.wait_for(worker, timeout=5)
        await asyncio.wait_for(deletion, timeout=5)
    finally:
        release_user.set()
        for task in (blocker, worker, deletion):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (blocker, worker, deletion) if task is not None),
            return_exceptions=True,
        )

    await _assert_owned_rows_absent(deletion_pg, target)
    assert await _owned_snapshot(deletion_pg, [other.user_id]) == before_other
    async with deletion_pg.factory() as db:
        control = await db.get(LearningEventCutover, 1)
        assert control is not None
        assert control.baseline_count == len(other.baselines)
        assert control.baseline_digest == _digest(list(other.baselines))


@pytest.mark.asyncio
async def test_two_concurrent_account_deletes_do_not_lose_baseline_updates(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-concurrent-delete-{uuid.uuid4()}"
    first = await deletion_pg.new_account(
        "concurrent-first",
        with_analysis_events=False,
        baseline_revision=revision,
    )
    second = await deletion_pg.new_account(
        "concurrent-second",
        with_analysis_events=False,
        baseline_revision=revision,
    )
    remaining = await deletion_pg.new_account(
        "concurrent-remaining",
        mastery={"verb_tense_past": 0.58},
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control(
        "traffic_resumed",
        [*first.baselines, *second.baselines, *remaining.baselines],
        revision=revision,
    )
    before_remaining = await _owned_snapshot(
        deletion_pg,
        [remaining.user_id],
    )

    async def delete_one(user_id: uuid.UUID):
        async with deletion_pg.factory() as db, db.begin():
            await service.delete_user_account(db=db, user_id=user_id)

    await asyncio.wait_for(
        asyncio.gather(
            delete_one(first.user_id),
            delete_one(second.user_id),
        ),
        timeout=10,
    )

    await _assert_owned_rows_absent(deletion_pg, first)
    await _assert_owned_rows_absent(deletion_pg, second)
    assert (
        await _owned_snapshot(
            deletion_pg,
            [remaining.user_id],
        )
        == before_remaining
    )
    async with deletion_pg.factory() as db:
        control = await db.get(LearningEventCutover, 1)
        assert control is not None
        assert control.baseline_count == len(remaining.baselines)
        assert control.baseline_digest == _digest(list(remaining.baselines))


@pytest.mark.asyncio
async def test_replay_passes_and_other_user_baseline_payload_is_byte_stable(
    deletion_pg: DeletionHarness,
):
    service = _deletion_api()
    revision = f"b1-5-replay-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "replay-target",
        with_analysis_events=False,
        baseline_revision=revision,
    )
    other = await deletion_pg.new_account(
        "replay-other",
        mastery={"verb_tense_past": 0.73},
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control(
        "traffic_resumed",
        [*target.baselines, *other.baselines],
        revision=revision,
    )
    async with deletion_pg.factory() as db:
        other_events = (
            await db.execute(
                select(LearningEvent)
                .where(LearningEvent.user_id == other.user_id)
                .order_by(LearningEvent.apply_seq)
            )
        ).scalars()
        before_events = [
            {
                column.key: getattr(row, column.key)
                for column in LearningEvent.__table__.columns
            }
            for row in other_events
        ]

    async with deletion_pg.factory() as db, db.begin():
        await service.delete_user_account(db=db, user_id=target.user_id)

    report = await validate_learning_event_replay(
        deletion_pg.factory,
        algorithm_versions={"bkt-v1": dict(FROZEN_BKT_PARAMS)},
    )
    assert report.issues == ()
    async with deletion_pg.factory() as db:
        after_rows = (
            await db.execute(
                select(LearningEvent)
                .where(LearningEvent.user_id == other.user_id)
                .order_by(LearningEvent.apply_seq)
            )
        ).scalars()
        after_events = [
            {
                column.key: getattr(row, column.key)
                for column in LearningEvent.__table__.columns
            }
            for row in after_rows
        ]
    assert after_events == before_events


@pytest.mark.asyncio
async def test_invalid_bearer_is_rejected_before_any_business_sql(
    deletion_pg: DeletionHarness,
    monkeypatch: pytest.MonkeyPatch,
):
    _require_route_registered()
    mapped_id = uuid.uuid4()
    issuer = f"urn:b1-5:invalid-before-sql:{mapped_id}"
    subject = f"b1-5-invalid-before-sql:{mapped_id}"
    revision = f"b1-5-invalid-before-sql-{uuid.uuid4()}"
    deletion_pg.user_ids.append(mapped_id)
    await deletion_pg.set_control("traffic_resumed", [], revision=revision)

    statements: list[str] = []

    def capture_statement(
        _connection,
        _cursor,
        statement: str,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        normalized = " ".join(statement.upper().split())
        if "SET_CONFIG(" in normalized and "APPLICATION_NAME" in normalized:
            return
        statements.append(normalized)

    event.listen(
        deletion_pg.engine.sync_engine,
        "before_cursor_execute",
        capture_statement,
    )
    try:
        with _real_bearer(
            deletion_pg.factory,
            monkeypatch,
            mock_user_id=mapped_id,
            issuer=issuer,
            subject=subject,
            application_name="b1-5-invalid-before-sql",
        ):
            anonymous = await _delete_http()
            wrong = await _delete_http(
                headers={"Authorization": "Bearer wrong-b1-5-token"}
            )
    finally:
        event.remove(
            deletion_pg.engine.sync_engine,
            "before_cursor_execute",
            capture_statement,
        )

    for response in (anonymous, wrong):
        assert response.status_code == 401
        assert response.json() == {"detail": "Authentication required."}
        assert response.headers["www-authenticate"] == "Bearer"
    assert statements == []
    async with deletion_pg.factory() as db:
        assert await db.get(User, mapped_id) is None


@pytest.mark.asyncio
async def test_invalid_bearer_does_not_wait_for_shared_learning_event_gate(
    deletion_pg: DeletionHarness,
    monkeypatch: pytest.MonkeyPatch,
):
    _require_route_registered()
    mapped_id = uuid.uuid4()
    issuer = f"urn:b1-5:invalid-before-gate:{mapped_id}"
    subject = f"b1-5-invalid-before-gate:{mapped_id}"
    revision = f"b1-5-invalid-before-gate-{uuid.uuid4()}"
    deletion_pg.user_ids.append(mapped_id)
    await deletion_pg.set_control("traffic_resumed", [], revision=revision)

    gate_held = asyncio.Event()
    release_gate = asyncio.Event()

    async def hold_shared_gate() -> None:
        async with deletion_pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b1-5-invalid-auth-gate-holder"},
            )
            await assert_learning_event_gate(db)
            gate_held.set()
            await release_gate.wait()

    gate_task = asyncio.create_task(hold_shared_gate())
    request_task = None
    response = None
    waited_for_gate = False
    try:
        await asyncio.wait_for(gate_held.wait(), timeout=5)
        with _real_bearer(
            deletion_pg.factory,
            monkeypatch,
            mock_user_id=mapped_id,
            issuer=issuer,
            subject=subject,
            application_name="b1-5-invalid-auth-gate-request",
        ):
            request_task = asyncio.create_task(
                _delete_http(headers={"Authorization": "Bearer wrong-b1-5-token"})
            )
            done, _ = await asyncio.wait({request_task}, timeout=2)
            if not done:
                await _wait_for_blocked_application(
                    deletion_pg,
                    "b1-5-invalid-auth-gate-request",
                )
                waited_for_gate = True
    finally:
        release_gate.set()
        results = await asyncio.wait_for(
            asyncio.gather(
                gate_task,
                *([] if request_task is None else [request_task]),
                return_exceptions=True,
            ),
            timeout=10,
        )

    assert not isinstance(results[0], BaseException)
    if request_task is not None:
        assert not isinstance(results[1], BaseException)
        response = results[1]
    assert not waited_for_gate
    assert isinstance(response, httpx.Response)
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required."}
    assert response.headers["www-authenticate"] == "Bearer"
    async with deletion_pg.factory() as db:
        assert await db.get(User, mapped_id) is None


@pytest.mark.asyncio
async def test_route_first_mapping_creation_and_deletion_share_transaction(
    deletion_pg: DeletionHarness,
    monkeypatch: pytest.MonkeyPatch,
):
    _require_route_registered()
    mapped_id = uuid.uuid4()
    issuer = f"urn:b1-5:first-map:{mapped_id}"
    subject = f"b1-5-first-map:{mapped_id}"
    revision = f"b1-5-first-map-{uuid.uuid4()}"
    deletion_pg.user_ids.append(mapped_id)
    await deletion_pg.set_control("traffic_resumed", [], revision=revision)

    with _real_bearer(
        deletion_pg.factory,
        monkeypatch,
        mock_user_id=mapped_id,
        issuer=issuer,
        subject=subject,
    ):
        anonymous = await _delete_http()
        wrong = await _delete_http(headers={"Authorization": "Bearer wrong-b1-5-token"})
        success = await _delete_http(
            headers={"Authorization": f"Bearer {DEV_BEARER_TOKEN}"}
        )

    assert anonymous.status_code == 401
    assert wrong.status_code == 401
    assert success.status_code == 200
    assert success.json() == {"status": "deleted"}
    async with deletion_pg.factory() as db:
        assert await db.get(User, mapped_id) is None
        assert await db.get(UserProfile, mapped_id) is None
        assert await db.get(UserSettings, mapped_id) is None
        assert (
            await db.scalar(
                select(LearningEvent.apply_seq).where(
                    LearningEvent.user_id == mapped_id
                )
            )
        ) is None


@pytest.mark.asyncio
async def test_route_links_existing_unlinked_user_before_deleting_it(
    deletion_pg: DeletionHarness,
    monkeypatch: pytest.MonkeyPatch,
):
    _require_route_registered()
    mapped_id = uuid.uuid4()
    issuer = f"urn:b1-5:existing-map:{mapped_id}"
    subject = f"b1-5-existing-map:{mapped_id}"
    revision = f"b1-5-existing-map-{uuid.uuid4()}"
    bundle = await deletion_pg.new_account(
        "existing-unlinked",
        user_id=mapped_id,
        with_baseline=False,
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control("prepared", [], revision=revision)
    async with deletion_pg.factory() as db, db.begin():
        user = await db.get(User, mapped_id)
        assert user is not None
        user.auth_issuer = None
        user.auth_subject = None

    with _real_bearer(
        deletion_pg.factory,
        monkeypatch,
        mock_user_id=mapped_id,
        issuer=issuer,
        subject=subject,
    ):
        anonymous = await _delete_http()
        wrong = await _delete_http(headers={"Authorization": "Bearer wrong-b1-5-token"})
        assert anonymous.status_code == 401
        assert wrong.status_code == 401
        async with deletion_pg.factory() as db:
            assert await db.get(User, mapped_id) is not None
        response = await _delete_http(
            headers={"Authorization": f"Bearer {DEV_BEARER_TOKEN}"}
        )

    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}
    await _assert_owned_rows_absent(deletion_pg, bundle)


@pytest.mark.asyncio
async def test_existing_unlinked_bearer_mapping_keeps_worker_lock_order(
    deletion_pg: DeletionHarness,
    monkeypatch: pytest.MonkeyPatch,
):
    _require_route_registered()
    mapped_id = uuid.uuid4()
    issuer = f"urn:b1-5:existing-map-lock:{mapped_id}"
    subject = f"b1-5-existing-map-lock:{mapped_id}"
    revision = f"b1-5-existing-map-lock-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "existing-unlinked-lock",
        user_id=mapped_id,
        with_analysis_events=False,
        job_status=AnalysisJobStatus.running,
        baseline_revision=revision,
    )
    other = await deletion_pg.new_account(
        "existing-unlinked-lock-other",
        mastery={"verb_tense_past": 0.69},
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control(
        "traffic_resumed",
        [*target.baselines, *other.baselines],
        revision=revision,
    )
    async with deletion_pg.factory() as db, db.begin():
        user = await db.get(User, mapped_id)
        assert user is not None
        user.auth_issuer = None
        user.auth_subject = None
    before_other = await _owned_snapshot(deletion_pg, [other.user_id])
    worker_gate_held = asyncio.Event()
    release_worker = asyncio.Event()

    async def run_worker():
        async with deletion_pg.factory() as db, db.begin():
            await db.execute(
                text("SELECT set_config('application_name', :value, true)"),
                {"value": "b1-5-existing-auth-worker"},
            )
            await assert_learning_event_gate(db)
            worker_gate_held.set()
            await release_worker.wait()
            job = await db.get(AnalysisJob, target.job_id)
            session = await db.get(Session, target.session_id)
            grammar = await db.get(GrammarError, target.grammar_id)
            assert job is not None and session is not None and grammar is not None
            await write_learning_events(
                job=job,
                session=session,
                user_id=target.user_id,
                assessment=None,
                grammar_errors=[grammar],
                coverage={
                    "pronunciation": {
                        "status": "not_called",
                        "source": None,
                        "provider": None,
                        "model_version": None,
                        "is_synthetic": None,
                    },
                    "grammar": {
                        "status": "evaluated",
                        "source": "b1-5-test",
                        "provider": "synthetic",
                        "model_version": "v1",
                        "is_synthetic": False,
                    },
                },
                db=db,
            )
            transition_job(job, AnalysisJobStatus.succeeded)

    worker = asyncio.create_task(run_worker())
    request = None
    worker_result = None
    response = None
    try:
        await asyncio.wait_for(worker_gate_held.wait(), timeout=5)
        with _real_bearer(
            deletion_pg.factory,
            monkeypatch,
            mock_user_id=mapped_id,
            issuer=issuer,
            subject=subject,
            application_name="b1-5-existing-auth-delete",
        ):
            request = asyncio.create_task(
                _delete_http(headers={"Authorization": f"Bearer {DEV_BEARER_TOKEN}"})
            )
            await _wait_for_blocked_application(
                deletion_pg,
                "b1-5-existing-auth-delete",
            )
            release_worker.set()
            worker_result, response = await asyncio.wait_for(
                asyncio.gather(worker, request, return_exceptions=True),
                timeout=10,
            )
    finally:
        release_worker.set()
        for task in (worker, request):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (worker, request) if task is not None),
            return_exceptions=True,
        )

    assert not isinstance(worker_result, BaseException)
    assert isinstance(response, httpx.Response)
    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}
    await _assert_owned_rows_absent(deletion_pg, target)
    assert await _owned_snapshot(deletion_pg, [other.user_id]) == before_other
    async with deletion_pg.factory() as db:
        control = await db.get(LearningEventCutover, 1)
        assert control is not None
        assert control.baseline_count == len(other.baselines)
        assert control.baseline_digest == _digest(list(other.baselines))


@pytest.mark.asyncio
async def test_first_bearer_mapping_commit_failure_leaves_no_local_user(
    deletion_pg: DeletionHarness,
    monkeypatch: pytest.MonkeyPatch,
):
    _require_route_registered()
    mapped_id = uuid.uuid4()
    issuer = f"urn:b1-5:first-map-failure:{mapped_id}"
    subject = f"b1-5-first-map-failure:{mapped_id}"
    revision = f"b1-5-first-map-failure-{uuid.uuid4()}"
    deletion_pg.user_ids.append(mapped_id)
    await deletion_pg.set_control("traffic_resumed", [], revision=revision)
    await deletion_pg.install_delete_failure(mapped_id, deferred=True)

    with _real_bearer(
        deletion_pg.factory,
        monkeypatch,
        mock_user_id=mapped_id,
        issuer=issuer,
        subject=subject,
    ):
        response = await _delete_http(
            headers={"Authorization": f"Bearer {DEV_BEARER_TOKEN}"}
        )

    assert response.status_code == 500
    assert response.json() == {"detail": GENERIC_DELETE_ERROR}
    assert TRIGGER_CANARY not in response.text
    async with deletion_pg.factory() as db:
        assert await db.get(User, mapped_id) is None
        assert await db.get(UserProfile, mapped_id) is None
        assert await db.get(UserSettings, mapped_id) is None


@pytest.mark.asyncio
async def test_forged_body_and_query_user_id_never_replace_bearer_identity(
    deletion_pg: DeletionHarness,
):
    _require_route_registered()
    revision = f"b1-5-forged-identity-{uuid.uuid4()}"
    target = await deletion_pg.new_account(
        "route-target",
        baseline_revision=revision,
    )
    victim = await deletion_pg.new_account(
        "route-victim",
        with_analysis_events=False,
        baseline_revision=revision,
    )
    await deletion_pg.set_control(
        "traffic_resumed",
        [*target.baselines, *victim.baselines],
        revision=revision,
    )
    before_victim = await _owned_snapshot(deletion_pg, [victim.user_id])

    with _request_as(target.user_id, deletion_pg.factory):
        response = await _delete_http(
            body={"user_id": str(victim.user_id)},
            query={"user_id": str(victim.user_id)},
        )

    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}
    assert str(victim.user_id) not in response.text
    assert str(target.user_id) not in response.text
    await _assert_owned_rows_absent(deletion_pg, target)
    assert await _owned_snapshot(deletion_pg, [victim.user_id]) == before_victim


@pytest.mark.asyncio
async def test_success_is_not_sent_before_commit_finishes(
    deletion_pg: DeletionHarness,
):
    _require_route_registered()
    bundle = await deletion_pg.new_account("commit-barrier")
    await deletion_pg.set_control(
        "traffic_resumed",
        list(bundle.baselines),
        revision=bundle.baseline_revision,
    )
    commit_started = asyncio.Event()
    release_commit = asyncio.Event()
    original_commit = AsyncSession.commit

    async def delayed_commit(session: AsyncSession):
        commit_started.set()
        await release_commit.wait()
        return await original_commit(session)

    with patch.object(AsyncSession, "commit", delayed_commit):
        with _request_as(bundle.user_id, deletion_pg.factory):
            request = asyncio.create_task(_delete_http())
            await asyncio.wait_for(commit_started.wait(), timeout=5)
            assert not request.done()
            release_commit.set()
            response = await asyncio.wait_for(request, timeout=5)

    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}
    await _assert_owned_rows_absent(deletion_pg, bundle)


@pytest.mark.asyncio
async def test_deferred_commit_failure_returns_generic_500_and_full_rollback(
    deletion_pg: DeletionHarness,
    caplog: pytest.LogCaptureFixture,
):
    _require_route_registered()
    bundle = await deletion_pg.new_account("commit-failure")
    await deletion_pg.set_control(
        "traffic_resumed",
        list(bundle.baselines),
        revision=bundle.baseline_revision,
    )
    await deletion_pg.install_delete_failure(bundle.user_id, deferred=True)
    before = await _owned_snapshot(deletion_pg, [bundle.user_id])
    before_control = await _control_snapshot(deletion_pg)

    with _request_as(bundle.user_id, deletion_pg.factory):
        response = await _delete_http()

    assert response.status_code == 500
    assert response.json() == {"detail": GENERIC_DELETE_ERROR}
    assert TRIGGER_CANARY not in response.text
    assert TRIGGER_CANARY not in caplog.text
    assert await _owned_snapshot(deletion_pg, [bundle.user_id]) == before
    assert await _control_snapshot(deletion_pg) == before_control
