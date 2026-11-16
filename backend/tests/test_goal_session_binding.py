"""Public API contract for G-WIRE scenario-goal session binding.

The goal-binding service is imported only when a test needs it so the
TESTS_ONLY RED run fails with an explicit assertion instead of breaking
collection of the full backend test tree.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import json
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from alembic.script import ScriptDirectory
from fastapi import Request
from pydantic import ValidationError
from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from main import app
from models.scenario_goals import GoalCatalogVersion, SessionGoalSnapshot
from models.session import Session
from models.user import User
from schemas.scenario_goals import GoalDefinition
from schemas.session import SessionCreate
from services.material_catalog import get_material_catalog
from services.session_idempotency import compute_session_fingerprint

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "teaching_materials.json"
LEGACY_HASH = "6250cd55b4c928b36c45a08e2a1898fc8aa24824a8715998b9d34e1d2d9ba6cb"
LEGACY_CATALOG_HASH = "6b6ea5d7dfccf13e3d0c9fa4faa364c051f08797e20d4df9fd3f2b20c82dc7d7"
LEGACY_FIELDS = (
    "id",
    "document",
    "scenario_name",
    "difficulty_cefr",
    "cefr_numeric",
    "category",
    "primary_skill",
    "skill_tags",
    "priority",
)
EXPECTED_MATERIAL_IDS = [
    "mat_biz_greet_b1",
    "mat_past_perfect_b2",
    "mat_th_minimal_a2",
    "mat_hotel_checkin_b1",
    "mat_svagree_a2",
    "mat_restaurant_b1",
    "mat_articles_b2",
    "mat_presentation_b2",
    "mat_vowel_contrast_a2",
    "mat_job_interview_c1",
]

PILOT_GOALS = {
    "mat_biz_greet_b1": [
        {
            "goal_id": "mat_biz_greet_b1:introduce_name_and_role",
            "goal_version": 1,
            "description_en": "Introduce your name and your job or role.",
            "description_zh": "介绍自己的姓名及工作/角色。",
            "criteria": ["State your name.", "State your job or role."],
            "evidence_types": ["transcript"],
        },
        {
            "goal_id": "mat_biz_greet_b1:ask_other_work_question",
            "goal_version": 1,
            "description_en": "Ask the other person a question about their work.",
            "description_zh": "向对方提出一个与其工作相关的问题。",
            "criteria": ["Ask the other person a question about their work."],
            "evidence_types": ["transcript"],
        },
    ],
    "mat_hotel_checkin_b1": [
        {
            "goal_id": "mat_hotel_checkin_b1:express_checkin_reservation_status",
            "goal_version": 1,
            "description_en": "Express a check-in request and state whether you have a reservation.",
            "description_zh": "表达入住需求并说明有无预订。",
            "criteria": [
                "Express a check-in request.",
                "State whether you have a reservation.",
            ],
            "evidence_types": ["transcript"],
        },
        {
            "goal_id": "mat_hotel_checkin_b1:ask_checkout_time",
            "goal_version": 1,
            "description_en": "Ask for the checkout time.",
            "description_zh": "询问退房时间。",
            "criteria": ["Ask for the checkout time."],
            "evidence_types": ["transcript"],
        },
    ],
    "mat_restaurant_b1": [
        {
            "goal_id": "mat_restaurant_b1:order_one_dish_or_drink",
            "goal_version": 1,
            "description_en": "Clearly order one dish or drink.",
            "description_zh": "明确点一道菜或饮品。",
            "criteria": ["Order one dish or drink clearly."],
            "evidence_types": ["transcript"],
        },
        {
            "goal_id": "mat_restaurant_b1:state_preference_or_no_requirements",
            "goal_version": 1,
            "description_en": (
                "State one preference or restriction, or clearly say that you "
                "have no special requirements."
            ),
            "description_zh": "说明一项偏好或限制，或明确表示没有特殊要求。",
            "criteria": [
                (
                    "State a preference or restriction, or explicitly say that "
                    "there are no special requirements."
                )
            ],
            "evidence_types": ["transcript"],
        },
    ],
}


def _require_service_module() -> Any:
    module_name = "services.session_goal_binding"
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        if exc.name == module_name:
            pytest.fail(
                f"{module_name} is not implemented (G-WIRE RED)",
                pytrace=False,
            )
        raise


def _require_b1_database_url() -> URL:
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail(
            "G-WIRE PostgreSQL tests require explicit DATABASE_URL; no dotenv fallback",
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
        pytest.fail("G-WIRE PostgreSQL DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail(
            "G-WIRE PostgreSQL database boundary mismatch",
            pytrace=False,
        )
    return parsed.set(drivername="postgresql+asyncpg")


def _binding(material_id: str = "mat_biz_greet_b1", version: int = 1) -> dict[str, Any]:
    return {"material_id": material_id, "material_version": version}


def _body(
    material_id: str = "mat_biz_greet_b1",
    version: int = 1,
    *,
    mode: str = "scenario",
) -> dict[str, Any]:
    return {"mode": mode, "goal_binding": _binding(material_id, version)}


def _test_headers(user_id: uuid.UUID, key: uuid.UUID | None = None) -> dict[str, str]:
    headers = {"x-gwire-user-id": str(user_id)}
    if key is not None:
        headers["Idempotency-Key"] = str(key)
    return headers


def _synthetic_goal(material_id: str) -> GoalDefinition:
    return GoalDefinition.create(
        material_id=material_id,
        slug="ask_other_work_question",
        goal_version=1,
        description_en="Ask the other person a question about their work.",
        description_zh="向对方提出一个与其工作相关的问题。",
        criteria=("Ask the other person a question about their work.",),
        evidence_types=("transcript",),
    )


@dataclass
class WireHarness:
    factory: async_sessionmaker[AsyncSession]
    engine: Any
    user_ids: list[uuid.UUID] = field(default_factory=list)
    catalog_ids: set[str] = field(default_factory=set)
    trigger_functions: list[str] = field(default_factory=list)

    async def new_user(self, label: str = "wire") -> uuid.UUID:
        user_id = uuid.uuid4()
        async with self.factory() as db, db.begin():
            db.add(
                User(
                    id=user_id,
                    email=f"gwire-{label}-{user_id}@example.invalid",
                    password_hash="gwire-test-only",
                    auth_issuer=f"urn:gwire:{label}",
                    auth_subject=f"subject-{user_id}",
                )
            )
        self.user_ids.append(user_id)
        return user_id

    async def sessions_for(self, user_id: uuid.UUID) -> list[Session]:
        async with self.factory() as db:
            return list(
                (
                    await db.execute(
                        select(Session)
                        .where(Session.user_id == user_id)
                        .order_by(Session.started_at, Session.id)
                    )
                )
                .scalars()
                .all()
            )

    async def snapshot_for(self, session_id: uuid.UUID) -> SessionGoalSnapshot | None:
        async with self.factory() as db:
            return await db.get(SessionGoalSnapshot, session_id)

    async def catalog_for(
        self,
        material_id: str,
        material_version: int,
    ) -> GoalCatalogVersion | None:
        async with self.factory() as db:
            return await db.get(GoalCatalogVersion, (material_id, material_version))

    async def install_snapshot_failure_trigger(self) -> None:
        suffix = uuid.uuid4().hex
        function_name = f"gwire_reject_snapshot_{suffix}"
        trigger_name = f"gwire_reject_snapshot_{suffix}"
        async with self.factory() as db, db.begin():
            await db.execute(
                text(
                    f"""
                    CREATE FUNCTION {function_name}() RETURNS trigger
                    LANGUAGE plpgsql AS $gwire$
                    BEGIN
                        IF NEW.material_id = 'mat_biz_greet_b1' THEN
                            RAISE EXCEPTION 'GWIRE_GOAL_SNAPSHOT_FAILURE';
                        END IF;
                        RETURN NEW;
                    END;
                    $gwire$
                    """
                )
            )
            await db.execute(
                text(
                    f"""
                    CREATE TRIGGER {trigger_name}
                    BEFORE INSERT ON session_goal_snapshots
                    FOR EACH ROW
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

            if self.user_ids:
                session_ids = list(
                    (
                        await db.execute(
                            select(Session.id).where(Session.user_id.in_(self.user_ids))
                        )
                    )
                    .scalars()
                    .all()
                )
                if session_ids:
                    await db.execute(
                        delete(SessionGoalSnapshot).where(
                            SessionGoalSnapshot.session_id.in_(session_ids)
                        )
                    )
                    await db.execute(delete(Session).where(Session.id.in_(session_ids)))
                await db.execute(delete(User).where(User.id.in_(self.user_ids)))

            if self.catalog_ids:
                await db.execute(
                    delete(GoalCatalogVersion).where(
                        GoalCatalogVersion.material_id.in_(self.catalog_ids)
                    )
                )
        await self.engine.dispose()


class ApiContext:
    def __init__(
        self,
        harness: WireHarness,
        *,
        raise_app_exceptions: bool = True,
    ):
        self.harness = harness
        self.raise_app_exceptions = raise_app_exceptions
        self.client: httpx.AsyncClient | None = None
        self.saved_overrides: dict[Any, Any] = {}

    async def __aenter__(self) -> httpx.AsyncClient:
        self.saved_overrides = {
            get_db: app.dependency_overrides.get(get_db),
            get_current_user: app.dependency_overrides.get(get_current_user),
        }

        async def override_db():
            async with self.harness.factory() as db:
                try:
                    yield db
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

        async def override_user(request: Request) -> CurrentUser:
            user_id = uuid.UUID(request.headers["x-gwire-user-id"])
            return CurrentUser(
                id=user_id,
                email=f"{user_id}@example.invalid",
                issuer="urn:gwire:http",
                subject=str(user_id),
            )

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = override_user
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(
                app=app,
                raise_app_exceptions=self.raise_app_exceptions,
            ),
            base_url="http://test",
        )
        return self.client

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client is not None:
            await self.client.aclose()
        for dependency, previous in self.saved_overrides.items():
            if previous is None:
                app.dependency_overrides.pop(dependency, None)
            else:
                app.dependency_overrides[dependency] = previous


@pytest.fixture
async def wire_pg() -> AsyncIterator[WireHarness]:
    database_url = _require_b1_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    harness = WireHarness(factory=factory, engine=engine)
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


def _client(
    harness: WireHarness,
    *,
    raise_app_exceptions: bool = True,
) -> ApiContext:
    return ApiContext(harness, raise_app_exceptions=raise_app_exceptions)


async def _session_count(harness: WireHarness, user_id: uuid.UUID) -> int:
    async with harness.factory() as db:
        return int(
            await db.scalar(
                select(func.count())
                .select_from(Session)
                .where(Session.user_id == user_id)
            )
            or 0
        )


def _patch_catalog_sources(
    monkeypatch: pytest.MonkeyPatch,
    materials: tuple[Any, ...],
) -> None:
    module_names = (
        "services.material_catalog",
        "services.rag_service",
        "services.session_goal_binding",
    )
    patched = 0
    for module_name in module_names:
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError:
            continue
        for name in ("get_material_catalog", "load_material_catalog"):
            if hasattr(module, name):
                monkeypatch.setattr(
                    module,
                    name,
                    lambda *_args, **_kwargs: materials,
                )
                patched += 1
    assert patched > 0, "catalog binding must use a patchable catalog source"


def test_catalog_publishes_six_goals_and_preserves_legacy_metadata() -> None:
    raw_materials = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    assert [material["id"] for material in raw_materials] == EXPECTED_MATERIAL_IDS
    legacy_projection = [
        {key: material[key] for key in LEGACY_FIELDS} for material in raw_materials
    ]
    legacy_bytes = json.dumps(
        legacy_projection,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    assert hashlib.sha256(legacy_bytes).hexdigest() == LEGACY_CATALOG_HASH

    for material_id, expected_goals in PILOT_GOALS.items():
        material = next(item for item in raw_materials if item["id"] == material_id)
        assert material["material_version"] == 1
        assert material["goals"] == expected_goals

    for material in raw_materials:
        if material["id"] in PILOT_GOALS:
            continue
        assert "goals" not in material
        assert "material_version" not in material

    validated = {material.id: material for material in get_material_catalog()}
    assert set(PILOT_GOALS) <= set(validated)
    for material_id, expected_goals in PILOT_GOALS.items():
        material = validated[material_id]
        assert material.material_version == 1
        assert [
            goal.model_dump(mode="json") for goal in material.goals
        ] == expected_goals


def test_legacy_fingerprint_is_fixed_and_binding_is_strict() -> None:
    legacy_body = SessionCreate(mode="scenario")
    assert compute_session_fingerprint(legacy_body) == LEGACY_HASH

    explicit_null = SessionCreate.model_validate(
        {"mode": "scenario", "goal_binding": None}
    )
    assert compute_session_fingerprint(explicit_null) == LEGACY_HASH

    binding = _binding()
    bound_body = SessionCreate.model_validate(
        {"mode": "scenario", "goal_binding": binding}
    )
    bound_payload = bound_body.model_dump(mode="json")
    assert bound_payload["goal_binding"] == binding
    bound_fingerprint = compute_session_fingerprint(bound_body)
    assert bound_fingerprint == compute_session_fingerprint(bound_body)
    assert bound_fingerprint != LEGACY_HASH

    invalid_bodies = [
        {
            "mode": "scenario",
            "goal_binding": {**binding, "goals": PILOT_GOALS["mat_biz_greet_b1"]},
        },
        {
            "mode": "scenario",
            "goal_binding": {**binding, "material_version": "1"},
        },
        {"mode": "free_talk", "goal_binding": binding},
        {
            "mode": "scenario",
            "goal_binding": binding,
            "goals": PILOT_GOALS["mat_biz_greet_b1"],
        },
        {
            "mode": "scenario",
            "goal_binding": binding,
            "user_id": str(uuid.uuid4()),
        },
    ]
    for payload in invalid_bodies:
        with pytest.raises(ValidationError):
            SessionCreate.model_validate(payload)


@pytest.mark.asyncio
async def test_curriculum_default_and_opt_in_public_http(
    wire_pg: WireHarness,
) -> None:
    user_id = await wire_pg.new_user("curriculum")
    headers = _test_headers(user_id)
    async with _client(wire_pg) as client:
        default_response = await client.get("/api/curriculum/next", headers=headers)
        explicit_false = await client.get(
            "/api/curriculum/next?include_goals=false",
            headers=headers,
        )
        opt_in_response = await client.get(
            "/api/curriculum/next?include_goals=true",
            headers=headers,
        )

    assert default_response.status_code == 200
    assert explicit_false.status_code == 200
    assert opt_in_response.status_code == 200
    default_payload = default_response.json()
    assert explicit_false.json() == default_payload
    assert [
        recommendation["scenario_name"]
        for recommendation in default_payload["recommendations"]
    ] == [
        "business_meeting_greetings",
        "th_minimal_pairs",
        "hotel_checkin_roleplay",
    ]
    legacy_keys = {
        "scenario_name",
        "difficulty_cefr",
        "category",
        "focus_skills",
        "system_prompt_template",
    }
    for recommendation in default_payload["recommendations"]:
        assert set(recommendation) == legacy_keys

    opt_in_payload = opt_in_response.json()
    by_material = {
        recommendation["goal_binding"]["material_id"]: recommendation
        for recommendation in opt_in_payload["recommendations"]
        if "goal_binding" in recommendation
    }
    assert set(by_material) == {
        "mat_biz_greet_b1",
        "mat_hotel_checkin_b1",
    }
    for material_id, recommendation in by_material.items():
        assert recommendation["goal_binding"] == {
            "material_id": material_id,
            "material_version": 1,
            "goals": PILOT_GOALS[material_id],
        }
    th_material = next(
        recommendation
        for recommendation in opt_in_payload["recommendations"]
        if recommendation["scenario_name"] == "th_minimal_pairs"
    )
    assert "goal_binding" not in th_material


@pytest.mark.asyncio
async def test_no_key_binds_catalog_and_snapshot_atomically(
    wire_pg: WireHarness,
) -> None:
    user_id = await wire_pg.new_user("atomic")
    wire_pg.catalog_ids.update(PILOT_GOALS)
    headers = _test_headers(user_id)
    created: list[tuple[str, str]] = []
    async with _client(wire_pg) as client:
        for material_id in PILOT_GOALS:
            response = await client.post(
                "/api/sessions",
                json=_body(material_id),
                headers=headers,
            )
            assert response.status_code == 200
            created.append((material_id, response.json()["id"]))

    sessions = await wire_pg.sessions_for(user_id)
    assert len(sessions) == 3
    assert {str(session.id) for session in sessions} == {
        session_id for _, session_id in created
    }
    assert all(session.scenario_id is None for session in sessions)

    for material_id, raw_session_id in created:
        snapshot = await wire_pg.snapshot_for(uuid.UUID(raw_session_id))
        assert snapshot is not None
        assert (snapshot.material_id, snapshot.material_version) == (material_id, 1)
        catalog = await wire_pg.catalog_for(material_id, 1)
        assert catalog is not None
        assert catalog.goals == PILOT_GOALS[material_id]


@pytest.mark.asyncio
async def test_idempotency_replays_snapshot_and_rejects_rebinding(
    wire_pg: WireHarness,
) -> None:
    user_id = await wire_pg.new_user("idempotency")
    wire_pg.catalog_ids.update({"mat_biz_greet_b1", "mat_hotel_checkin_b1"})
    key = uuid.uuid4()
    body = _body("mat_biz_greet_b1")
    headers = _test_headers(user_id, key)

    async with _client(wire_pg) as client:
        first = await client.post("/api/sessions", json=body, headers=headers)
        second = await client.post("/api/sessions", json=body, headers=headers)
        conflict = await client.post(
            "/api/sessions",
            json=_body("mat_hotel_checkin_b1"),
            headers=headers,
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert conflict.status_code == 409
    assert second.json() == first.json()
    session_id = uuid.UUID(first.json()["id"])
    assert await _session_count(wire_pg, user_id) == 1
    snapshot = await wire_pg.snapshot_for(session_id)
    assert snapshot is not None
    assert (snapshot.material_id, snapshot.material_version) == ("mat_biz_greet_b1", 1)


@pytest.mark.asyncio
async def test_directory_evolution_does_not_rebind_original_replay(
    wire_pg: WireHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_service_module()
    user_id = await wire_pg.new_user("catalog-evolution")
    material_id = f"mat_synthetic_gwire_{uuid.uuid4().hex}"
    wire_pg.catalog_ids.add(material_id)
    source = get_material_catalog()[0]
    goal = _synthetic_goal(material_id)
    version_one = (replace(source, id=material_id, material_version=1, goals=(goal,)),)
    version_two = (replace(source, id=material_id, material_version=2, goals=(goal,)),)
    key = uuid.uuid4()
    body = {"mode": "scenario", "goal_binding": _binding(material_id, 1)}
    headers = _test_headers(user_id, key)

    _patch_catalog_sources(monkeypatch, version_one)
    async with _client(wire_pg) as client:
        original = await client.post("/api/sessions", json=body, headers=headers)
        assert original.status_code == 200
        original_session_id = uuid.UUID(original.json()["id"])
        original_snapshot = await wire_pg.snapshot_for(original_session_id)
        assert original_snapshot is not None
        assert original_snapshot.material_version == 1

        _patch_catalog_sources(monkeypatch, version_two)
        replay = await client.post("/api/sessions", json=body, headers=headers)
        assert replay.status_code == 200
        assert replay.json() == original.json()
        replay_snapshot = await wire_pg.snapshot_for(original_session_id)
        assert replay_snapshot is not None
        assert replay_snapshot.material_version == 1

        stale_new_key = await client.post(
            "/api/sessions",
            json=body,
            headers=_test_headers(user_id, uuid.uuid4()),
        )
        assert stale_new_key.status_code in {400, 404, 409, 422}

        current = await client.post(
            "/api/sessions",
            json={
                "mode": "scenario",
                "goal_binding": _binding(material_id, 2),
            },
            headers=_test_headers(user_id, uuid.uuid4()),
        )
        assert current.status_code == 200
        current_snapshot = await wire_pg.snapshot_for(uuid.UUID(current.json()["id"]))
        assert current_snapshot is not None
        assert current_snapshot.material_version == 2


@pytest.mark.asyncio
async def test_public_binding_inputs_fail_closed_without_sessions(
    wire_pg: WireHarness,
) -> None:
    user_id = await wire_pg.new_user("input-validation")
    wire_pg.catalog_ids.update(PILOT_GOALS)
    valid_binding = _binding()
    invalid_bodies = [
        {"mode": "free_talk", "goal_binding": valid_binding},
        {
            "mode": "scenario",
            "goal_binding": {
                **valid_binding,
                "goals": PILOT_GOALS["mat_biz_greet_b1"],
            },
        },
        {
            "mode": "scenario",
            "goal_binding": {
                **valid_binding,
                "material_version": "1",
            },
        },
        {
            "mode": "scenario",
            "goal_binding": _binding("mat_unknown_gwire", 1),
        },
        {
            "mode": "scenario",
            "goal_binding": _binding("mat_biz_greet_b1", 99),
        },
        {
            "mode": "scenario",
            "goal_binding": valid_binding,
            "goals": PILOT_GOALS["mat_biz_greet_b1"],
        },
        {
            "mode": "scenario",
            "goal_binding": valid_binding,
            "user_id": str(uuid.uuid4()),
        },
    ]

    async with _client(wire_pg) as client:
        for body in invalid_bodies:
            response = await client.post(
                "/api/sessions",
                json=body,
                headers=_test_headers(user_id),
            )
            assert response.status_code in {400, 404, 409, 422}, body
            await response.aread()

    assert await _session_count(wire_pg, user_id) == 0


@pytest.mark.asyncio
async def test_same_key_is_isolated_across_users(wire_pg: WireHarness) -> None:
    user_a = await wire_pg.new_user("account-a")
    user_b = await wire_pg.new_user("account-b")
    wire_pg.catalog_ids.add("mat_hotel_checkin_b1")
    key = uuid.uuid4()
    body = _body("mat_hotel_checkin_b1")

    async with _client(wire_pg) as client:
        response_a = await client.post(
            "/api/sessions",
            json=body,
            headers=_test_headers(user_a, key),
        )
        response_b = await client.post(
            "/api/sessions",
            json=body,
            headers=_test_headers(user_b, key),
        )
        assert response_a.status_code == 200
        assert response_b.status_code == 200
        session_a = uuid.UUID(response_a.json()["id"])
        session_b = uuid.UUID(response_b.json()["id"])
        assert session_a != session_b

        forbidden = await client.get(
            f"/api/sessions/{session_a}",
            headers=_test_headers(user_b),
        )
        assert forbidden.status_code == 404

    snapshot_a = await wire_pg.snapshot_for(session_a)
    snapshot_b = await wire_pg.snapshot_for(session_b)
    assert snapshot_a is not None
    assert snapshot_b is not None
    assert snapshot_a != snapshot_b
    assert await _session_count(wire_pg, user_a) == 1
    assert await _session_count(wire_pg, user_b) == 1


@pytest.mark.asyncio
async def test_concurrent_binding_creates_commit_without_deadlock(
    wire_pg: WireHarness,
) -> None:
    user_id = await wire_pg.new_user("concurrent")
    wire_pg.catalog_ids.update({"mat_biz_greet_b1", "mat_hotel_checkin_b1"})
    headers_a = _test_headers(user_id, uuid.uuid4())
    headers_b = _test_headers(user_id, uuid.uuid4())

    async with _client(wire_pg) as client:
        response_a, response_b = await asyncio.wait_for(
            asyncio.gather(
                client.post(
                    "/api/sessions",
                    json=_body("mat_biz_greet_b1"),
                    headers=headers_a,
                ),
                client.post(
                    "/api/sessions",
                    json=_body("mat_hotel_checkin_b1"),
                    headers=headers_b,
                ),
            ),
            timeout=10,
        )

    assert response_a.status_code == 200
    assert response_b.status_code == 200
    assert response_a.json()["id"] != response_b.json()["id"]
    sessions = await wire_pg.sessions_for(user_id)
    assert len(sessions) == 2
    snapshots = []
    for session in sessions:
        snapshot = await wire_pg.snapshot_for(session.id)
        assert snapshot is not None
        snapshots.append(snapshot.material_id)
    assert set(snapshots) == {"mat_biz_greet_b1", "mat_hotel_checkin_b1"}


@pytest.mark.asyncio
async def test_snapshot_write_failure_rolls_back_session_and_catalog(
    wire_pg: WireHarness,
) -> None:
    user_id = await wire_pg.new_user("rollback")
    wire_pg.catalog_ids.add("mat_biz_greet_b1")
    await wire_pg.install_snapshot_failure_trigger()

    async with _client(wire_pg, raise_app_exceptions=False) as client:
        response = await client.post(
            "/api/sessions",
            json=_body("mat_biz_greet_b1"),
            headers=_test_headers(user_id),
        )

    assert response.status_code >= 500
    assert await _session_count(wire_pg, user_id) == 0
    assert await wire_pg.catalog_for("mat_biz_greet_b1", 1) is None
