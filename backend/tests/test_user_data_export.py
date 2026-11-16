"""RED gate for B1-4 authenticated user data export.

The product modules are intentionally resolved at test runtime.  They do not
exist before B1-4 lands, and a module-level import would prevent the rest of
the backend test tree from being collected.

The HTTP contract is ``GET /api/user/data-export``.  The route authenticates
with the existing Bearer dependency, uses a dedicated session factory for one
``REPEATABLE READ READ ONLY`` PostgreSQL snapshot, and returns a fully
validated JSON document before any success headers or body bytes are sent.
"""

import asyncio
import importlib
import json
import os
import uuid
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

import httpx
import pytest
from alembic.script import ScriptDirectory
from pydantic import ValidationError
from sqlalchemy import delete, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.sql import Select

from auth import CurrentUser
from dependencies import MOCK_USER_ID, get_current_user
from main import app
from models.analysis import AnalysisJob
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

EXPORT_PATH = "/api/user/data-export"
EXPORT_TOP_LEVEL_KEYS = [
    "schema_version",
    "exported_at",
    "sessions",
    "transcripts",
    "pronunciation_assessments",
    "grammar_assessments",
    "learning_events",
    "knowledge_states",
]
SESSION_KEYS = ["id", "mode", "status", "started_at", "ended_at"]
TRANSCRIPT_KEYS = ["id", "session_id", "event_id", "role", "content", "timestamp_ms"]
PRONUNCIATION_KEYS = [
    "id",
    "session_id",
    "overall_score",
    "phoneme_alignment",
    "source",
    "provider",
    "model_version",
    "is_synthetic",
    "confidence",
    "created_at",
]
GRAMMAR_KEYS = [
    "id",
    "session_id",
    "skill_tag",
    "original",
    "corrected",
    "error_type",
    "source",
    "provider",
    "model_version",
    "is_synthetic",
    "confidence",
    "created_at",
]
EVENT_KEYS = [
    "apply_seq",
    "event_type",
    "session_id",
    "analysis_job_id",
    "pronunciation_assessment_id",
    "grammar_error_id",
    "skill_id",
    "source_ordinal",
    "observation_correct",
    "observation_code",
    "source",
    "provider",
    "model_version",
    "confidence",
    "is_synthetic",
    "algorithm_version",
    "algorithm_params",
    "p_mastery_snapshot",
    "cutover_revision",
    "occurred_at",
    "recorded_at",
    "details",
]
EVENT_DETAILS_KEYS = [
    "schema_version",
    "coverage",
    "unmapped",
    "legacy_synthetic_impact",
]
KNOWLEDGE_STATE_KEYS = ["skill_id", "p_mastery", "updated_at"]

FROZEN_BKT_VERSION = "bkt-v1"
FROZEN_BKT_PARAMS = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}
GENERIC_EXPORT_ERROR = "Unable to export user data."
SENSITIVE_KEYS = {
    "api_key",
    "audio_url",
    "auth_issuer",
    "auth_subject",
    "custom_prompt",
    "document_content",
    "elsa_response",
    "encrypted_llm_key",
    "encrypted_stt_key",
    "encrypted_tts_key",
    "idempotency_key",
    "internal_prompt",
    "password_hash",
    "provider_raw_response",
    "provider_response_ref",
    "provider_token",
    "user_id",
}
NON_FINITE_FLOAT_VALUES = [
    pytest.param(float("nan"), id="nan"),
    pytest.param(float("inf"), id="positive-infinity"),
    pytest.param(float("-inf"), id="negative-infinity"),
]


def _require_route_registered() -> None:
    paths = app.openapi().get("paths", {})
    if EXPORT_PATH not in paths:
        pytest.fail(
            f"GET {EXPORT_PATH} is not implemented (B1-4 RED)",
            pytrace=False,
        )


def _export_module():
    try:
        return importlib.import_module("services.user_data_export")
    except ModuleNotFoundError:
        pytest.fail(
            "services.user_data_export is not implemented (B1-4 RED)",
            pytrace=False,
        )


def _export_schema_module():
    try:
        return importlib.import_module("schemas.user_data_export")
    except ModuleNotFoundError:
        pytest.fail(
            "schemas.user_data_export is not implemented (B1-4 RED)",
            pytrace=False,
        )


def _export_session_factory_dependency():
    dependency = getattr(
        _export_module(),
        "get_user_data_export_session_factory",
        None,
    )
    if dependency is None:
        pytest.fail(
            "services.user_data_export.get_user_data_export_session_factory "
            "is not implemented (B1-4 RED)",
            pytrace=False,
        )
    return dependency


@contextmanager
def _request_as(user_id: uuid.UUID, session_factory: Any) -> Iterator[None]:
    dependency = _export_session_factory_dependency()
    previous_user = app.dependency_overrides.get(get_current_user)
    previous_factory = app.dependency_overrides.get(dependency)

    async def override_user() -> CurrentUser:
        return CurrentUser(
            id=user_id,
            email=f"{user_id}@example.invalid",
            issuer="urn:echotalk:b1-4-test",
            subject=f"b1-4-{user_id}",
        )

    app.dependency_overrides[get_current_user] = override_user
    app.dependency_overrides[dependency] = lambda: session_factory
    try:
        yield
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user
        if previous_factory is None:
            app.dependency_overrides.pop(dependency, None)
        else:
            app.dependency_overrides[dependency] = previous_factory


async def _get_export(*, query: str = "") -> httpx.Response:
    _require_route_registered()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        return await client.get(f"{EXPORT_PATH}{query}")


def _assert_generic_error(response: httpx.Response, *secret_values: str) -> None:
    assert response.status_code == 500
    assert response.json() == {"detail": GENERIC_EXPORT_ERROR}
    assert "content-disposition" not in response.headers
    for secret in secret_values:
        assert secret not in response.text


def _all_object_keys(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            keys.add(key)
            keys.update(_all_object_keys(nested))
    elif isinstance(value, list):
        for nested in value:
            keys.update(_all_object_keys(nested))
    return keys


def _all_object_values(value: Any) -> list[Any]:
    values: list[Any] = []
    if isinstance(value, dict):
        for nested in value.values():
            values.append(nested)
            values.extend(_all_object_values(nested))
    elif isinstance(value, list):
        for nested in value:
            values.append(nested)
            values.extend(_all_object_values(nested))
    return values


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


@dataclass
class ExportHarness:
    factory: Any
    engine: Any
    user_ids: list[uuid.UUID] = field(default_factory=list)

    async def ensure_seed_skills(self) -> None:
        for skill_id, name, category in (
            ("th_sounds", "TH Sounds", "pronunciation"),
            ("verb_tense_past", "Past Tense", "grammar"),
            ("article_usage", "Article Usage", "grammar"),
        ):
            async with self.factory() as db, db.begin():
                if await db.get(Skill, skill_id) is None:
                    db.add(Skill(id=skill_id, name=name, category=category))

    async def new_user(self, *, email_label: str = "export") -> uuid.UUID:
        user_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                User(
                    id=user_id,
                    email=f"b1-4-{email_label}-{user_id}@example.invalid",
                    password_hash="test-password-hash-canary",
                    auth_issuer="urn:issuer-canary",
                    auth_subject=f"subject-canary-{user_id}",
                )
            )
        self.user_ids.append(user_id)
        return user_id

    async def new_session(
        self,
        user_id: uuid.UUID,
        *,
        started_at: datetime | None = None,
        ended_at: datetime | None = None,
        mode: SessionMode = SessionMode.pronunciation,
        status: SessionStatus = SessionStatus.completed,
    ) -> uuid.UUID:
        if started_at is None:
            started_at = datetime(2026, 11, 13, 1, 0, tzinfo=UTC)
        if ended_at is None:
            ended_at = started_at + timedelta(minutes=10)
        session_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=mode,
                    status=status,
                    started_at=started_at,
                    ended_at=ended_at,
                )
            )
        return session_id

    async def new_transcript(
        self,
        session_id: uuid.UUID,
        *,
        content: str,
        timestamp_ms: int,
        role: TranscriptRole = TranscriptRole.user,
    ) -> int:
        transcript = Transcript(
            session_id=session_id,
            event_id=uuid.uuid4(),
            role=role,
            content=content,
            audio_url="https://audio.example.invalid/private.wav",
            timestamp_ms=timestamp_ms,
            emotion_state={"private_emotion": "must-not-export"},
        )
        async with self.factory() as db, db.begin():
            db.add(transcript)
            await db.flush()
            transcript_id = transcript.id
        return transcript_id

    async def new_job(self, session_id: uuid.UUID) -> uuid.UUID:
        job_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(AnalysisJob(id=job_id, session_id=session_id))
        return job_id

    async def new_pronunciation_assessment(
        self,
        session_id: uuid.UUID,
        *,
        overall_score: float = 82.5,
        model_version: str | None = "acme-phoneme-v1",
        is_synthetic: bool = False,
        phoneme_alignment: list[dict[str, Any]] | None = None,
        provider_response_ref: str | None = "provider-ref-canary",
        elsa_response: dict[str, Any] | None = None,
    ) -> uuid.UUID:
        assessment_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                PronunciationAssessment(
                    id=assessment_id,
                    session_id=session_id,
                    overall_score=overall_score,
                    phoneme_alignment=phoneme_alignment
                    if phoneme_alignment is not None
                    else [
                        {
                            "position": 0,
                            "phoneme": "th",
                            "expected": "th",
                            "actual": "s",
                            "type": "substitution",
                        }
                    ],
                    source="acme_pronunciation",
                    provider="acme",
                    model_version=model_version,
                    is_synthetic=is_synthetic,
                    confidence=0.91,
                    provider_response_ref=provider_response_ref,
                    elsa_response=elsa_response
                    if elsa_response is not None
                    else {"raw_response_canary": "provider-elsa-canary"},
                )
            )
        return assessment_id

    async def new_grammar_error(
        self,
        session_id: uuid.UUID,
        *,
        original: str = "I go yesterday.",
        corrected: str = "I went yesterday.",
        model_version: str | None = None,
        is_synthetic: bool = True,
    ) -> uuid.UUID:
        grammar_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                GrammarError(
                    id=grammar_id,
                    session_id=session_id,
                    skill_tag="verb_tense_past",
                    original=original,
                    corrected=corrected,
                    error_type="tense",
                    source="acme_grammar",
                    provider=None,
                    model_version=model_version,
                    is_synthetic=is_synthetic,
                    confidence=0.63,
                )
            )
        return grammar_id

    async def new_knowledge_state(
        self,
        user_id: uuid.UUID,
        *,
        skill_id: str,
        p_mastery: float,
        updated_at: datetime,
    ) -> None:
        async with self.factory() as db, db.begin():
            db.add(
                KnowledgeState(
                    user_id=user_id,
                    skill_id=skill_id,
                    p_mastery=p_mastery,
                    updated_at=updated_at,
                )
            )

    async def insert_event(self, values: dict[str, Any]) -> None:
        async with self.factory() as db, db.begin():
            db.add(LearningEvent(**values))

    async def add_rows_after_first_snapshot(
        self,
        user_id: uuid.UUID,
    ) -> tuple[uuid.UUID, uuid.UUID]:
        session_id = uuid.uuid4()
        transcript_id: int | None = None
        async with self.factory() as db, db.begin():
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.free_talk,
                    status=SessionStatus.completed,
                    started_at=datetime(2026, 11, 13, 8, 0, tzinfo=UTC),
                    ended_at=datetime(2026, 11, 13, 8, 5, tzinfo=UTC),
                )
            )
            transcript = Transcript(
                session_id=session_id,
                event_id=uuid.uuid4(),
                role=TranscriptRole.user,
                content="CONCURRENT_ORDERED_COMMIT_CANARY",
                timestamp_ms=99,
            )
            db.add(transcript)
            db.add(
                LearningEvent(
                    **_baseline_event_values(
                        user_id,
                        skill_id="article_usage",
                        revision="b1-4-concurrent-order",
                    )
                )
            )
            await db.flush()
            transcript_id = transcript.id
        assert transcript_id is not None
        return session_id, uuid.uuid4()

    async def cleanup(self) -> None:
        async with self.factory() as db, db.begin():
            if self.user_ids:
                session_ids = select(Session.id).where(
                    Session.user_id.in_(self.user_ids)
                )
                await db.execute(
                    delete(LearningEvent).where(
                        LearningEvent.user_id.in_(self.user_ids)
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
        await self.engine.dispose()


@pytest.fixture
async def export_pg():
    database_url = _require_b1_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    harness = ExportHarness(factory=factory, engine=engine)
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


def _coverage_values() -> dict[str, Any]:
    return {
        "pronunciation": {
            "status": "evaluated",
            "source": "acme_pronunciation",
            "provider": "acme",
            "model_version": "acme-phoneme-v1",
            "is_synthetic": False,
            "internal_prompt": "coverage-internal-prompt-canary",
        },
        "grammar": {
            "status": "evaluated",
            "source": "acme_grammar",
            "provider": None,
            "model_version": None,
            "is_synthetic": True,
            "provider_raw_response": "coverage-provider-raw-canary",
        },
    }


def _completed_event_values(
    user_id: uuid.UUID,
    *,
    session_id: uuid.UUID,
    job_id: uuid.UUID,
    occurred_at: datetime,
) -> dict[str, Any]:
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
        "algorithm_params": {
            **FROZEN_BKT_PARAMS,
            "provider_raw_response": "algorithm-provider-raw-canary",
        },
        "p_mastery_snapshot": None,
        "cutover_revision": None,
        "occurred_at": occurred_at,
        "details": {
            "schema_version": 1,
            "coverage": _coverage_values(),
            "unmapped": {
                "pronunciation": 1,
                "grammar": 0,
                "internal_prompt": "unmapped-internal-prompt-canary",
            },
            "internal_prompt": "event-details-internal-prompt-canary",
            "provider_raw_response": "event-details-provider-raw-canary",
            "unknown_nested": {"api_key": "unknown-nested-api-key-canary"},
        },
    }


def _pronunciation_event_values(
    user_id: uuid.UUID,
    *,
    session_id: uuid.UUID,
    job_id: uuid.UUID,
    assessment_id: uuid.UUID,
    occurred_at: datetime,
    model_version: str | None = "acme-phoneme-v1",
    is_synthetic: bool = False,
) -> dict[str, Any]:
    return {
        "idempotency_key": f"job:{job_id}:pronunciation:0",
        "event_type": "pronunciation_observation",
        "user_id": user_id,
        "session_id": session_id,
        "analysis_job_id": job_id,
        "pronunciation_assessment_id": assessment_id,
        "grammar_error_id": None,
        "skill_id": "th_sounds",
        "source_ordinal": 0,
        "observation_correct": False,
        "observation_code": "th_substitution",
        "source": "acme_pronunciation",
        "provider": "acme",
        "model_version": model_version,
        "confidence": 0.91,
        "is_synthetic": is_synthetic,
        "algorithm_version": None,
        "algorithm_params": None,
        "p_mastery_snapshot": None,
        "cutover_revision": None,
        "occurred_at": occurred_at,
        "details": {"schema_version": 1},
    }


def _grammar_event_values(
    user_id: uuid.UUID,
    *,
    session_id: uuid.UUID,
    job_id: uuid.UUID,
    grammar_id: uuid.UUID,
    occurred_at: datetime,
    model_version: str | None = None,
    is_synthetic: bool = True,
) -> dict[str, Any]:
    return {
        "idempotency_key": f"job:{job_id}:grammar:0",
        "event_type": "grammar_observation",
        "user_id": user_id,
        "session_id": session_id,
        "analysis_job_id": job_id,
        "pronunciation_assessment_id": None,
        "grammar_error_id": grammar_id,
        "skill_id": "verb_tense_past",
        "source_ordinal": 0,
        "observation_correct": False,
        "observation_code": "verb_tense_past",
        "source": "acme_grammar",
        "provider": None,
        "model_version": model_version,
        "confidence": 0.63,
        "is_synthetic": is_synthetic,
        "algorithm_version": None,
        "algorithm_params": None,
        "p_mastery_snapshot": None,
        "cutover_revision": None,
        "occurred_at": occurred_at,
        "details": {"schema_version": 1},
    }


def _baseline_event_values(
    user_id: uuid.UUID,
    *,
    skill_id: str,
    revision: str,
) -> dict[str, Any]:
    return {
        "idempotency_key": f"baseline:{revision}:{user_id}:{skill_id}",
        "event_type": "baseline_snapshot",
        "user_id": user_id,
        "session_id": None,
        "analysis_job_id": None,
        "pronunciation_assessment_id": None,
        "grammar_error_id": None,
        "skill_id": skill_id,
        "source_ordinal": None,
        "observation_correct": None,
        "observation_code": None,
        "source": "legacy_unknown",
        "provider": None,
        "model_version": None,
        "confidence": None,
        "is_synthetic": None,
        "algorithm_version": None,
        "algorithm_params": None,
        "p_mastery_snapshot": 0.42,
        "cutover_revision": revision,
        "occurred_at": datetime(2026, 11, 12, 23, 59, tzinfo=UTC),
        "details": {
            "schema_version": 1,
            "legacy_synthetic_impact": "unknown",
            "provider_response_ref": "baseline-provider-ref-canary",
        },
    }


def _pronunciation_export_values(**overrides: Any) -> dict[str, Any]:
    values = {
        "id": uuid.uuid4(),
        "session_id": uuid.uuid4(),
        "overall_score": 82.5,
        "phoneme_alignment": [],
        "source": "acme_pronunciation",
        "provider": "acme",
        "model_version": "acme-phoneme-v1",
        "is_synthetic": False,
        "confidence": 0.91,
        "created_at": datetime(2026, 11, 13, 4, 10, 1, tzinfo=UTC),
    }
    values.update(overrides)
    return values


def _grammar_export_values(**overrides: Any) -> dict[str, Any]:
    values = {
        "id": uuid.uuid4(),
        "session_id": uuid.uuid4(),
        "skill_tag": "verb_tense_past",
        "original": "I go yesterday.",
        "corrected": "I went yesterday.",
        "error_type": "tense",
        "source": "acme_grammar",
        "provider": None,
        "model_version": None,
        "is_synthetic": True,
        "confidence": 0.63,
        "created_at": datetime(2026, 11, 13, 4, 10, 2, tzinfo=UTC),
    }
    values.update(overrides)
    return values


def _learning_event_export_values(**overrides: Any) -> dict[str, Any]:
    timestamp = datetime(2026, 11, 13, 4, 10, tzinfo=UTC)
    values = {
        "apply_seq": 1,
        "event_type": "pronunciation_observation",
        "session_id": uuid.uuid4(),
        "analysis_job_id": uuid.uuid4(),
        "pronunciation_assessment_id": uuid.uuid4(),
        "grammar_error_id": None,
        "skill_id": "th_sounds",
        "source_ordinal": 0,
        "observation_correct": False,
        "observation_code": "th_substitution",
        "source": "acme_pronunciation",
        "provider": "acme",
        "model_version": "acme-phoneme-v1",
        "confidence": None,
        "is_synthetic": False,
        "algorithm_version": None,
        "algorithm_params": None,
        "p_mastery_snapshot": None,
        "cutover_revision": None,
        "occurred_at": timestamp,
        "recorded_at": timestamp,
        "details": {
            "schema_version": 1,
            "coverage": None,
            "unmapped": None,
            "legacy_synthetic_impact": None,
        },
    }
    values.update(overrides)
    return values


def _knowledge_state_export_values(**overrides: Any) -> dict[str, Any]:
    values = {
        "skill_id": "article_usage",
        "p_mastery": 0.42,
        "updated_at": datetime(2026, 11, 13, 4, 10, 6, tzinfo=UTC),
    }
    values.update(overrides)
    return values


@pytest.mark.asyncio
async def test_data_export_requires_real_bearer_authentication():
    _require_route_registered()
    previous_user = app.dependency_overrides.pop(get_current_user, None)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.get(EXPORT_PATH)
    finally:
        if previous_user is not None:
            app.dependency_overrides[get_current_user] = previous_user

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert "content-disposition" not in response.headers


@pytest.mark.asyncio
async def test_empty_export_returns_fixed_v1_shape(export_pg: ExportHarness):
    user_id = await export_pg.new_user(email_label="empty")
    with _request_as(user_id, export_pg.factory):
        response = await _get_export()

    assert response.status_code == 200
    body = response.json()
    assert list(body) == EXPORT_TOP_LEVEL_KEYS
    assert body["schema_version"] == 1
    assert datetime.fromisoformat(body["exported_at"].replace("Z", "+00:00")).tzinfo
    assert body["sessions"] == []
    assert body["transcripts"] == []
    assert body["pronunciation_assessments"] == []
    assert body["grammar_assessments"] == []
    assert body["learning_events"] == []
    assert body["knowledge_states"] == []
    assert response.headers["cache-control"] == "no-store"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="echotalk-user-data-export.json"'
    )
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
async def test_partial_export_keeps_missing_sections_empty(
    export_pg: ExportHarness,
):
    user_id = await export_pg.new_user(email_label="partial")
    session_id = await export_pg.new_session(user_id)
    await export_pg.new_transcript(
        session_id,
        content="Only the transcript exists.",
        timestamp_ms=10,
    )

    with _request_as(user_id, export_pg.factory):
        response = await _get_export()

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["sessions"]] == [str(session_id)]
    assert [item["content"] for item in body["transcripts"]] == [
        "Only the transcript exists."
    ]
    assert body["pronunciation_assessments"] == []
    assert body["grammar_assessments"] == []
    assert body["learning_events"] == []
    assert body["knowledge_states"] == []


@pytest.mark.asyncio
async def test_authenticated_user_cannot_select_another_user_and_arrays_are_stable(
    export_pg: ExportHarness,
):
    owner_id = await export_pg.new_user(email_label="owner")
    other_id = await export_pg.new_user(email_label="other")

    later_id = await export_pg.new_session(
        owner_id,
        started_at=datetime(2026, 11, 13, 3, 0, tzinfo=UTC),
    )
    earlier_id = await export_pg.new_session(
        owner_id,
        started_at=datetime(2026, 11, 13, 2, 0, tzinfo=UTC),
    )
    await export_pg.new_transcript(
        later_id, content="later transcript", timestamp_ms=20
    )
    await export_pg.new_transcript(
        earlier_id, content="later row in one session", timestamp_ms=30
    )
    await export_pg.new_transcript(
        earlier_id, content="earlier row in one session", timestamp_ms=10
    )
    other_session_id = await export_pg.new_session(
        other_id,
        started_at=datetime(2026, 11, 13, 1, 0, tzinfo=UTC),
    )
    await export_pg.new_transcript(
        other_session_id,
        content="OTHER_USER_CONTENT_CANARY",
        timestamp_ms=1,
    )

    with _request_as(owner_id, export_pg.factory):
        response = await _get_export(query=f"?user_id={other_id}")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["sessions"]] == [
        str(earlier_id),
        str(later_id),
    ]
    assert [item["content"] for item in body["transcripts"]] == [
        "earlier row in one session",
        "later row in one session",
        "later transcript",
    ]
    assert str(other_session_id) not in response.text
    assert "OTHER_USER_CONTENT_CANARY" not in response.text
    assert str(other_id) not in response.text
    assert "b1-4-other" not in response.text
    assert list(body["sessions"][0]) == SESSION_KEYS
    assert list(body["transcripts"][0]) == TRANSCRIPT_KEYS


@pytest.mark.asyncio
async def test_all_event_types_sources_versions_and_unknowns_are_preserved(
    export_pg: ExportHarness,
):
    await export_pg.ensure_seed_skills()
    user_id = await export_pg.new_user(email_label="events")
    ended_at = datetime(2026, 11, 13, 4, 10, tzinfo=UTC)
    session_id = await export_pg.new_session(
        user_id,
        started_at=datetime(2026, 11, 13, 4, 0, tzinfo=UTC),
        ended_at=ended_at,
    )
    await export_pg.new_transcript(
        session_id,
        content="I go yesterday, but I said the word three.",
        timestamp_ms=1,
    )
    job_id = await export_pg.new_job(session_id)
    pronunciation_id = await export_pg.new_pronunciation_assessment(session_id)
    grammar_id = await export_pg.new_grammar_error(session_id)
    await export_pg.new_knowledge_state(
        user_id,
        skill_id="verb_tense_past",
        p_mastery=0.61,
        updated_at=datetime(2026, 11, 13, 4, 11, tzinfo=UTC),
    )
    await export_pg.new_knowledge_state(
        user_id,
        skill_id="th_sounds",
        p_mastery=0.37,
        updated_at=datetime(2026, 11, 13, 4, 12, tzinfo=UTC),
    )
    await export_pg.insert_event(
        _completed_event_values(
            user_id,
            session_id=session_id,
            job_id=job_id,
            occurred_at=ended_at,
        )
    )
    await export_pg.insert_event(
        _pronunciation_event_values(
            user_id,
            session_id=session_id,
            job_id=job_id,
            assessment_id=pronunciation_id,
            occurred_at=ended_at,
        )
    )
    await export_pg.insert_event(
        _grammar_event_values(
            user_id,
            session_id=session_id,
            job_id=job_id,
            grammar_id=grammar_id,
            occurred_at=ended_at,
            model_version=None,
            is_synthetic=True,
        )
    )
    await export_pg.insert_event(
        _baseline_event_values(
            user_id,
            skill_id="article_usage",
            revision="b1-4-export-v1",
        )
    )

    with _request_as(user_id, export_pg.factory):
        response = await _get_export()
        repeated = await _get_export()

    assert response.status_code == 200
    assert repeated.status_code == 200
    body = response.json()
    assert list(body) == EXPORT_TOP_LEVEL_KEYS
    assert list(body["pronunciation_assessments"][0]) == PRONUNCIATION_KEYS
    assert list(body["grammar_assessments"][0]) == GRAMMAR_KEYS
    assert list(body["learning_events"][0]) == EVENT_KEYS
    assert list(body["learning_events"][0]["details"]) == EVENT_DETAILS_KEYS
    assert list(body["knowledge_states"][0]) == KNOWLEDGE_STATE_KEYS

    events = body["learning_events"]
    assert [event["event_type"] for event in events] == [
        "analysis_completed",
        "pronunciation_observation",
        "grammar_observation",
        "baseline_snapshot",
    ]
    completed, pronunciation, grammar, baseline = events
    assert completed["source"] == "analysis"
    assert completed["algorithm_version"] == FROZEN_BKT_VERSION
    assert completed["algorithm_params"] == FROZEN_BKT_PARAMS
    assert completed["details"]["schema_version"] == 1
    assert completed["details"]["coverage"]["pronunciation"]["status"] == "evaluated"
    assert completed["details"]["unmapped"] == {
        "pronunciation": 1,
        "grammar": 0,
    }
    assert pronunciation["source"] == "acme_pronunciation"
    assert pronunciation["provider"] == "acme"
    assert pronunciation["model_version"] == "acme-phoneme-v1"
    assert pronunciation["is_synthetic"] is False
    assert grammar["source"] == "acme_grammar"
    assert grammar["model_version"] is None
    assert grammar["is_synthetic"] is True
    assert baseline["source"] == "legacy_unknown"
    assert baseline["is_synthetic"] is None
    assert baseline["details"]["legacy_synthetic_impact"] == "unknown"

    assert [state["skill_id"] for state in body["knowledge_states"]] == [
        "th_sounds",
        "verb_tense_past",
    ]
    stable_first = dict(body)
    stable_second = repeated.json()
    stable_first.pop("exported_at")
    stable_second.pop("exported_at")
    assert stable_first == stable_second


@pytest.mark.asyncio
async def test_nested_json_uses_whitelists_without_corrupting_user_text(
    export_pg: ExportHarness,
):
    await export_pg.ensure_seed_skills()
    user_id = await export_pg.new_user(email_label="nested")
    ended_at = datetime(2026, 11, 13, 5, 10, tzinfo=UTC)
    session_id = await export_pg.new_session(
        user_id,
        started_at=datetime(2026, 11, 13, 5, 0, tzinfo=UTC),
        ended_at=ended_at,
    )
    job_id = await export_pg.new_job(session_id)
    pronunciation_id = await export_pg.new_pronunciation_assessment(
        session_id,
        phoneme_alignment=[
            {
                "position": 0,
                "phoneme": "th",
                "expected": "th",
                "actual": "s",
                "type": "substitution",
                "provider_token": "alignment-provider-token-canary",
                "internal_prompt": "alignment-internal-prompt-canary",
            }
        ],
        provider_response_ref="assessment-provider-ref-canary",
        elsa_response={"raw_response": "assessment-elsa-response-canary"},
    )
    grammar_id = await export_pg.new_grammar_error(
        session_id,
        original="The user wrote internal_prompt and provider_response_ref literally.",
        corrected="The user's corrected sentence stays intact.",
    )
    await export_pg.insert_event(
        _pronunciation_event_values(
            user_id,
            session_id=session_id,
            job_id=job_id,
            assessment_id=pronunciation_id,
            occurred_at=ended_at,
        )
    )
    await export_pg.insert_event(
        _grammar_event_values(
            user_id,
            session_id=session_id,
            job_id=job_id,
            grammar_id=grammar_id,
            occurred_at=ended_at,
        )
    )
    await export_pg.insert_event(
        _completed_event_values(
            user_id,
            session_id=session_id,
            job_id=job_id,
            occurred_at=ended_at,
        )
    )
    await export_pg.insert_event(
        _baseline_event_values(
            user_id,
            skill_id="article_usage",
            revision="b1-4-nested-whitelist",
        )
    )

    with _request_as(user_id, export_pg.factory):
        response = await _get_export()

    assert response.status_code == 200
    body = response.json()
    assert SENSITIVE_KEYS.isdisjoint(_all_object_keys(body))
    assert "test-password-hash-canary" not in response.text
    assert "urn:issuer-canary" not in response.text
    assert "subject-canary" not in response.text
    assert "provider-ref-canary" not in response.text
    assert "provider-elsa-canary" not in response.text
    assert "alignment-provider-token-canary" not in response.text
    assert "event-details-provider-raw-canary" not in response.text
    assert "unknown-nested-api-key-canary" not in response.text
    assert "The user wrote internal_prompt and provider_response_ref literally." in (
        response.text
    )
    assert "The user's corrected sentence stays intact." in response.text
    events = body["learning_events"]
    assert [event["apply_seq"] for event in events] == sorted(
        event["apply_seq"] for event in events
    )
    completed_events = [
        event for event in events if event["event_type"] == "analysis_completed"
    ]
    assert len(completed_events) == 1
    assert completed_events[0]["algorithm_params"] == {
        **FROZEN_BKT_PARAMS,
    }
    assert body["pronunciation_assessments"][0]["phoneme_alignment"] == [
        {
            "position": 0,
            "phoneme": "th",
            "expected": "th",
            "actual": "s",
            "type": "substitution",
        }
    ]
    assert {
        "internal_prompt",
        "provider_raw_response",
        "provider_response_ref",
        "provider_token",
        "api_key",
    }.isdisjoint(_all_object_keys(body))
    assert "internal_prompt" not in _all_object_values(body)
    assert "provider_raw_response" not in _all_object_values(body)


@pytest.mark.asyncio
async def test_cross_user_relationship_fails_closed_without_leaking_content(
    export_pg: ExportHarness,
):
    owner_id = await export_pg.new_user(email_label="cross-owner")
    other_id = await export_pg.new_user(email_label="cross-other")
    other_session_id = await export_pg.new_session(other_id)
    await export_pg.new_transcript(
        other_session_id,
        content="CROSS_OWNER_TRANSCRIPT_CANARY",
        timestamp_ms=1,
    )
    other_job_id = await export_pg.new_job(other_session_id)
    await export_pg.insert_event(
        _completed_event_values(
            owner_id,
            session_id=other_session_id,
            job_id=other_job_id,
            occurred_at=datetime(2026, 11, 13, 6, 0, tzinfo=UTC),
        )
    )

    with _request_as(owner_id, export_pg.factory):
        response = await _get_export()

    _assert_generic_error(
        response,
        "CROSS_OWNER_TRANSCRIPT_CANARY",
        str(other_session_id),
        str(other_job_id),
        str(other_id),
        "event-details-internal-prompt-canary",
    )


@pytest.mark.asyncio
async def test_query_failure_returns_generic_error_without_download_headers():
    _require_route_registered()
    secret = "QUERY_FAILURE_SECRET_CANARY"

    def failing_factory():
        raise RuntimeError(secret)

    with _request_as(uuid.UUID(MOCK_USER_ID), failing_factory):
        response = await _get_export()

    _assert_generic_error(response, secret)


@pytest.mark.asyncio
async def test_serialization_failure_returns_generic_error_without_download_headers(
    monkeypatch: pytest.MonkeyPatch,
):
    _require_route_registered()
    schema_module = _export_schema_module()
    route_module = importlib.import_module("routers.user")
    secret = "SERIALIZATION_FAILURE_SECRET_CANARY"
    model = schema_module.UserDataExport(
        schema_version=1,
        exported_at=datetime.now(UTC),
        sessions=[],
        transcripts=[],
        pronunciation_assessments=[],
        grammar_assessments=[],
        learning_events=[],
        knowledge_states=[],
    )

    async def fake_builder(*args: Any, **kwargs: Any):
        return model

    def fail_serialization(*args: Any, **kwargs: Any):
        raise RuntimeError(secret)

    monkeypatch.setattr(route_module, "build_user_data_export", fake_builder)
    monkeypatch.setattr(
        route_module,
        "serialize_user_data_export",
        fail_serialization,
    )

    with _request_as(uuid.UUID(MOCK_USER_ID), lambda: None):
        response = await _get_export()

    _assert_generic_error(response, secret)


@pytest.mark.asyncio
async def test_export_uses_one_repeatable_read_only_snapshot(
    export_pg: ExportHarness,
    monkeypatch: pytest.MonkeyPatch,
):
    await export_pg.ensure_seed_skills()
    user_id = await export_pg.new_user(email_label="snapshot")
    existing_session_id = await export_pg.new_session(user_id)
    await export_pg.new_transcript(
        existing_session_id,
        content="VISIBLE_BEFORE_SNAPSHOT",
        timestamp_ms=1,
    )

    first_query_finished = asyncio.Event()
    writer_finished = asyncio.Event()
    observed_modes: list[tuple[str, str]] = []
    marker = "b1-4-export-snapshot-test"
    original_execute = AsyncSession.execute

    async def controlled_execute(
        self: AsyncSession,
        statement: Any,
        *args: Any,
        **kwargs: Any,
    ):
        result = await original_execute(self, statement, *args, **kwargs)
        if (
            self.info.get(marker)
            and isinstance(statement, Select)
            and not first_query_finished.is_set()
        ):
            isolation = (
                await original_execute(
                    self,
                    text("SHOW transaction_isolation"),
                )
            ).scalar_one()
            read_only = (
                await original_execute(
                    self,
                    text("SHOW transaction_read_only"),
                )
            ).scalar_one()
            observed_modes.append((isolation, read_only))
            first_query_finished.set()
            await writer_finished.wait()
        return result

    monkeypatch.setattr(AsyncSession, "execute", controlled_execute)

    @asynccontextmanager
    async def instrumented_factory():
        async with export_pg.factory() as db:
            db.info[marker] = True
            yield db

    with _request_as(user_id, instrumented_factory):
        request_task = asyncio.create_task(_get_export())
        new_session_id: uuid.UUID | None = None
        try:
            await asyncio.wait_for(first_query_finished.wait(), timeout=5)
            new_session_id, _ = await export_pg.add_rows_after_first_snapshot(user_id)
        finally:
            writer_finished.set()
        response = await request_task

    assert response.status_code == 200
    assert observed_modes == [("repeatable read", "on")]
    assert new_session_id is not None
    body = response.json()
    assert str(new_session_id) not in response.text
    assert "CONCURRENT_ORDERED_COMMIT_CANARY" not in response.text
    assert [item["content"] for item in body["transcripts"]] == [
        "VISIBLE_BEFORE_SNAPSHOT"
    ]
    # The initial session query cannot prove the later event query shares its
    # snapshot.  Because this test starts with no events, the post-commit
    # baseline must leave the event array empty.
    assert body["learning_events"] == []
    assert "b1-4-concurrent-order" not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("non_finite", NON_FINITE_FLOAT_VALUES)
async def test_non_finite_knowledge_state_fails_closed(
    export_pg: ExportHarness,
    non_finite: float,
):
    await export_pg.ensure_seed_skills()
    user_id = await export_pg.new_user(email_label="non-finite-knowledge")
    await export_pg.new_knowledge_state(
        user_id,
        skill_id="article_usage",
        p_mastery=non_finite,
        updated_at=datetime(2026, 11, 13, 8, 0, tzinfo=UTC),
    )

    with _request_as(user_id, export_pg.factory):
        response = await _get_export()

    _assert_generic_error(response)


@pytest.mark.asyncio
@pytest.mark.parametrize("non_finite", NON_FINITE_FLOAT_VALUES)
async def test_non_finite_pronunciation_score_fails_closed(
    export_pg: ExportHarness,
    non_finite: float,
):
    user_id = await export_pg.new_user(email_label="non-finite-pronunciation")
    session_id = await export_pg.new_session(user_id)
    await export_pg.new_pronunciation_assessment(
        session_id,
        overall_score=non_finite,
    )

    with _request_as(user_id, export_pg.factory):
        response = await _get_export()

    _assert_generic_error(response)


@pytest.mark.parametrize("non_finite", NON_FINITE_FLOAT_VALUES)
def test_all_export_float_fields_reject_non_finite_values(non_finite: float):
    schema = _export_schema_module()
    cases = []

    for field_name in ("overall_score", "confidence"):
        cases.append(
            (
                f"PronunciationAssessmentExport.{field_name}",
                lambda field_name=field_name: schema.PronunciationAssessmentExport(
                    **_pronunciation_export_values(**{field_name: non_finite})
                ),
            )
        )

    cases.append(
        (
            "GrammarAssessmentExport.confidence",
            lambda: schema.GrammarAssessmentExport(
                **_grammar_export_values(confidence=non_finite)
            ),
        )
    )

    for field_name in FROZEN_BKT_PARAMS:
        params = {**FROZEN_BKT_PARAMS, field_name: non_finite}
        cases.append(
            (
                f"BktAlgorithmParams.{field_name}",
                lambda params=params: schema.BktAlgorithmParams(**params),
            )
        )

    confidence_event = _learning_event_export_values(confidence=non_finite)
    cases.append(
        (
            "LearningEventExport.confidence",
            lambda: schema.LearningEventExport(**confidence_event),
        )
    )

    baseline_event = _learning_event_export_values(
        event_type="baseline_snapshot",
        analysis_job_id=None,
        pronunciation_assessment_id=None,
        skill_id="article_usage",
        source_ordinal=None,
        observation_correct=None,
        observation_code=None,
        source="legacy_unknown",
        provider=None,
        model_version=None,
        confidence=None,
        is_synthetic=None,
        algorithm_version=None,
        algorithm_params=None,
        p_mastery_snapshot=non_finite,
        cutover_revision="b1-4-non-finite-boundary",
    )
    cases.append(
        (
            "LearningEventExport.p_mastery_snapshot",
            lambda: schema.LearningEventExport(**baseline_event),
        )
    )

    cases.append(
        (
            "KnowledgeStateExport.p_mastery",
            lambda: schema.KnowledgeStateExport(
                **_knowledge_state_export_values(p_mastery=non_finite)
            ),
        )
    )

    accepted_fields = []
    for field_path, build_model in cases:
        try:
            build_model()
        except ValidationError:
            continue
        accepted_fields.append(field_path)

    assert accepted_fields == []


def test_export_schema_preserves_legal_nullable_floats_as_json_null():
    schema = _export_schema_module()

    pronunciation = schema.PronunciationAssessmentExport(
        **_pronunciation_export_values(confidence=None)
    )
    grammar = schema.GrammarAssessmentExport(**_grammar_export_values(confidence=None))
    event = schema.LearningEventExport(
        **_learning_event_export_values(
            confidence=None,
            p_mastery_snapshot=None,
            algorithm_params=None,
        )
    )

    pronunciation_json = json.loads(pronunciation.model_dump_json())
    grammar_json = json.loads(grammar.model_dump_json())
    event_json = json.loads(event.model_dump_json())

    assert pronunciation_json["confidence"] is None
    assert grammar_json["confidence"] is None
    assert event_json["confidence"] is None
    assert event_json["p_mastery_snapshot"] is None
    assert event_json["algorithm_params"] is None
