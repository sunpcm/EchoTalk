"""RED contract for immutable scenario-goal versions and session snapshots.

The new product modules are resolved at test runtime so a missing GO-DATA
implementation produces an explicit assertion failure instead of breaking
collection of the rest of the backend test tree.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from alembic.script import ScriptDirectory
from pydantic import ValidationError
from sqlalchemy import delete, select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from auth import CurrentUser
from dependencies import get_current_user
from main import app
from models.session import Session, SessionMode, SessionStatus
from models.user import User
from services.material_catalog import MaterialCatalogError, load_material_catalog
from services.user_account_deletion import delete_user_account
from services.user_data_export import get_user_data_export_session_factory

EXPORT_PATH = "/api/user/data-export"
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
SESSION_KEYS = {"id", "mode", "status", "started_at", "ended_at"}
V2_TOP_LEVEL_KEYS = V1_TOP_LEVEL_KEYS | {"session_goals"}
SESSION_GOAL_KEYS = {
    "session_id",
    "material_id",
    "material_version",
    "goals",
}
GOAL_KEYS = {
    "goal_id",
    "goal_version",
    "description_en",
    "description_zh",
    "criteria",
    "evidence_types",
}
GENERIC_EXPORT_ERROR = "Unable to export user data."

SERVICE_MODULE = "services.session_goal_snapshot"
MODEL_MODULE = "models.scenario_goals"
SCHEMA_MODULE = "schemas.scenario_goals"


def _require_module(module_name: str) -> Any:
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        if exc.name == module_name:
            pytest.fail(
                f"{module_name} is not implemented (GOAL-DATA RED)",
                pytrace=False,
            )
        raise


def _schema_api() -> Any:
    module = _require_module(SCHEMA_MODULE)
    if not hasattr(module, "GoalDefinition"):
        pytest.fail(
            f"{SCHEMA_MODULE}.GoalDefinition is not implemented (GOAL-DATA RED)",
            pytrace=False,
        )
    return module


def _model_api() -> Any:
    module = _require_module(MODEL_MODULE)
    missing = [
        name
        for name in ("GoalCatalogVersion", "SessionGoalSnapshot")
        if not hasattr(module, name)
    ]
    if missing:
        pytest.fail(
            f"{MODEL_MODULE} is missing: {', '.join(missing)} (GOAL-DATA RED)",
            pytrace=False,
        )
    return module


def _service_api() -> Any:
    module = _require_module(SERVICE_MODULE)
    required = (
        "record_goal_catalog_version",
        "write_session_goal_snapshot",
        "read_session_goal_snapshot",
        "ScenarioGoalValidationError",
        "GoalCatalogConflictError",
        "SessionGoalConflictError",
        "SessionGoalAccessError",
        "SessionGoalStateError",
    )
    missing = [name for name in required if not hasattr(module, name)]
    if missing:
        pytest.fail(
            f"{SERVICE_MODULE} is missing: {', '.join(missing)} (GOAL-DATA RED)",
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
        pytest.fail(
            "B1 PostgreSQL test database boundary mismatch",
            pytrace=False,
        )
    return parsed.set(drivername="postgresql+asyncpg")


def _synthetic_material_id(label: str = "goal") -> str:
    return f"mat_synthetic_{label}_{uuid.uuid4().hex}"


def _synthetic_goal(
    material_id: str,
    *,
    slug: str = "clear_request",
    goal_version: int = 1,
    marker: str = "clear request",
) -> Any:
    schema = _schema_api()
    return schema.GoalDefinition.create(
        material_id=material_id,
        slug=slug,
        goal_version=goal_version,
        description_en=f"Make a {marker}.",
        description_zh=f"提出一个明确的{marker}。",
        criteria=(f"State the {marker} explicitly.",),
        evidence_types=("transcript",),
    )


def _synthetic_catalog_record(material_id: str) -> dict[str, Any]:
    source = asdict(load_material_catalog()[0])
    source["id"] = material_id
    source.pop("goals", None)
    source.pop("material_version", None)
    return source


def _write_catalog_records(
    path: Path,
    records: list[dict[str, Any]],
) -> None:
    path.write_text(json.dumps(records), encoding="utf-8")


async def _expect_dbapi_failure_then_rollback(
    harness: GoalHarness,
    statement: str,
    params: dict[str, Any] | None,
    failure_message: str,
) -> None:
    async with harness.factory() as db:
        transaction = await db.begin()
        try:
            await db.execute(text(statement), params or {})
        except DBAPIError:
            await transaction.rollback()
            return
        await transaction.rollback()
    pytest.fail(failure_message, pytrace=False)


@dataclass
class GoalHarness:
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
                    email=f"goal-data-{label}-{user_id}@example.invalid",
                    password_hash="goal-data-test-only",
                    auth_issuer=f"urn:goal-data:{label}",
                    auth_subject=f"subject-{user_id}",
                )
            )
        self.user_ids.append(user_id)
        return user_id

    async def new_session(
        self,
        user_id: uuid.UUID,
        *,
        status: SessionStatus = SessionStatus.active,
    ) -> uuid.UUID:
        session_id = uuid.uuid4()
        started_at = datetime(2026, 11, 16, 2, 0, tzinfo=UTC)
        async with self.factory() as db, db.begin():
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.scenario,
                    status=status,
                    started_at=started_at,
                    ended_at=(
                        None
                        if status is SessionStatus.active
                        else started_at + timedelta(minutes=5)
                    ),
                )
            )
        self.session_ids.append(session_id)
        return session_id

    async def new_catalog(
        self,
        material_id: str,
        material_version: int,
        goals: Sequence[Any],
    ) -> Any:
        service = _service_api()
        self.catalog_ids.append(material_id)
        async with self.factory() as db, db.begin():
            return await service.record_goal_catalog_version(
                db,
                material_id=material_id,
                material_version=material_version,
                goals=goals,
            )

    async def new_snapshot(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        material_id: str,
        material_version: int,
    ) -> Any:
        service = _service_api()
        async with self.factory() as db, db.begin():
            return await service.write_session_goal_snapshot(
                db,
                user_id=user_id,
                session_id=session_id,
                material_id=material_id,
                material_version=material_version,
            )

    async def insert_malformed_snapshot(
        self,
        session_id: uuid.UUID,
        material_id: str,
    ) -> None:
        self.catalog_ids.append(material_id)
        malformed_goals = [{"goal_id": "incomplete-goal"}]
        async with self.factory() as db, db.begin():
            await db.execute(
                text(
                    """
                    INSERT INTO goal_catalog_versions
                        (material_id, material_version, goals, created_at)
                    VALUES
                        (:material_id, 1, CAST(:goals AS jsonb), NOW())
                    """
                ),
                {
                    "material_id": material_id,
                    "goals": json.dumps(malformed_goals),
                },
            )
            await db.execute(
                text(
                    """
                    INSERT INTO session_goal_snapshots
                        (session_id, material_id, material_version)
                    VALUES
                        (:session_id, :material_id, 1)
                    """
                ),
                {
                    "session_id": session_id,
                    "material_id": material_id,
                },
            )

    async def install_user_delete_failure(self, user_id: uuid.UUID) -> None:
        suffix = uuid.uuid4().hex
        function_name = f"goal_data_reject_user_delete_{suffix}"
        trigger_name = f"goal_data_reject_user_delete_{suffix}"
        async with self.factory() as db, db.begin():
            await db.execute(
                text(
                    f"""
                    CREATE FUNCTION {function_name}() RETURNS trigger
                    LANGUAGE plpgsql AS $goal_data$
                    BEGIN
                        RAISE EXCEPTION 'GOAL_DATA_DELETE_FAILURE';
                    END;
                    $goal_data$
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

            snapshot_table = await db.scalar(
                text("SELECT to_regclass('public.session_goal_snapshots')")
            )
            if snapshot_table is not None:
                for session_id in self.session_ids:
                    await db.execute(
                        text(
                            """
                            DELETE FROM session_goal_snapshots
                            WHERE session_id = :session_id
                            """
                        ),
                        {"session_id": session_id},
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
                            """
                            DELETE FROM goal_catalog_versions
                            WHERE material_id = :material_id
                            """
                        ),
                        {"material_id": material_id},
                    )
        await self.engine.dispose()


@pytest.fixture
async def goal_pg() -> AsyncIterator[GoalHarness]:
    database_url = _require_b1_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    harness = GoalHarness(factory=factory, engine=engine)
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


@asynccontextmanager
async def _export_client(
    harness: GoalHarness,
    user_id: uuid.UUID,
) -> AsyncIterator[httpx.AsyncClient]:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user_id,
        email=f"{user_id}@example.invalid",
        issuer="urn:goal-data:http",
        subject=str(user_id),
    )
    app.dependency_overrides[get_user_data_export_session_factory] = lambda: (
        harness.factory
    )
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(
            get_user_data_export_session_factory,
            None,
        )


def test_goal_definition_is_strict_frozen_and_derives_stable_id() -> None:
    material_id = "mat_synthetic_stable_id"
    first = _synthetic_goal(material_id)
    second = _synthetic_goal(material_id)

    assert first.goal_id == f"{material_id}:clear_request"
    assert second.goal_id == first.goal_id
    assert first.goal_version == 1
    assert first.criteria == ("State the clear request explicitly.",)
    assert first.evidence_types == ("transcript",)

    with pytest.raises(ValidationError):
        first.description_en = "mutated"


def test_goal_definition_rejects_unknown_fields() -> None:
    goal = _synthetic_goal("mat_synthetic_extra")
    payload = goal.model_dump()
    payload["unexpected"] = "must-be-rejected"

    with pytest.raises(ValidationError):
        _schema_api().GoalDefinition.model_validate(payload)


def test_goal_definition_rejects_empty_criteria_or_evidence() -> None:
    schema = _schema_api()
    common = {
        "material_id": "mat_synthetic_empty",
        "slug": "empty",
        "goal_version": 1,
        "description_en": "English description.",
        "description_zh": "中文描述。",
    }
    with pytest.raises(ValidationError):
        schema.GoalDefinition.create(
            **common,
            criteria=(),
            evidence_types=("transcript",),
        )
    with pytest.raises(ValidationError):
        schema.GoalDefinition.create(
            **common,
            criteria=("A declared criterion.",),
            evidence_types=(),
        )


def test_goal_definition_rejects_invalid_versions_and_slugs() -> None:
    schema = _schema_api()
    for invalid_version in (0, -1, True):
        with pytest.raises(ValidationError):
            schema.GoalDefinition.create(
                material_id="mat_synthetic_invalid",
                slug="valid_slug",
                goal_version=invalid_version,
                description_en="English description.",
                description_zh="中文描述。",
                criteria=("A declared criterion.",),
                evidence_types=("transcript",),
            )
    with pytest.raises(ValidationError):
        schema.GoalDefinition.create(
            material_id="mat_synthetic_invalid",
            slug="not stable",
            goal_version=1,
            description_en="English description.",
            description_zh="中文描述。",
            criteria=("A declared criterion.",),
            evidence_types=("transcript",),
        )


def test_existing_ten_material_catalog_remains_legacy_compatible() -> None:
    materials = load_material_catalog()
    missing_fields = [
        field
        for field in ("goals", "material_version")
        if not hasattr(materials[0], field)
    ]
    if missing_fields:
        pytest.fail(
            "CatalogMaterial is missing optional fields: "
            f"{', '.join(missing_fields)} (GOAL-DATA RED)",
            pytrace=False,
        )

    assert len(materials) == 10
    assert len({material.id for material in materials}) == 10
    assert all(material.goals == () for material in materials)
    assert all(material.material_version is None for material in materials)


def test_material_catalog_consumes_synthetic_versions_and_goals(
    tmp_path: Path,
) -> None:
    material_id = _synthetic_material_id("catalog-success")
    goal = _synthetic_goal(material_id)
    record = _synthetic_catalog_record(material_id)
    record["material_version"] = 2
    record["goals"] = [goal.model_dump(mode="json")]
    catalog_path = tmp_path / "synthetic_material_catalog.json"
    _write_catalog_records(catalog_path, [record])

    materials = load_material_catalog(catalog_path)

    assert len(materials) == 1
    loaded = materials[0]
    assert loaded.id == material_id
    assert loaded.material_version == 2
    assert isinstance(loaded.goals, tuple)
    assert loaded.goals == (goal,)
    assert loaded.goals[0].goal_id == f"{material_id}:clear_request"


def test_material_catalog_goals_require_material_version(
    tmp_path: Path,
) -> None:
    material_id = _synthetic_material_id("catalog-version-required")
    record = _synthetic_catalog_record(material_id)
    record["goals"] = [_synthetic_goal(material_id).model_dump(mode="json")]
    catalog_path = tmp_path / "missing_material_version.json"
    _write_catalog_records(catalog_path, [record])

    with pytest.raises(MaterialCatalogError):
        load_material_catalog(catalog_path)


def test_material_catalog_rejects_duplicate_goal_ids(tmp_path: Path) -> None:
    material_id = _synthetic_material_id("catalog-duplicate-goal")
    record = _synthetic_catalog_record(material_id)
    record["material_version"] = 1
    record["goals"] = [
        _synthetic_goal(material_id).model_dump(mode="json"),
        _synthetic_goal(
            material_id,
            goal_version=2,
            marker="duplicate clear request",
        ).model_dump(mode="json"),
    ]
    catalog_path = tmp_path / "duplicate_goal_ids.json"
    _write_catalog_records(catalog_path, [record])

    with pytest.raises(MaterialCatalogError):
        load_material_catalog(catalog_path)


def test_material_catalog_rejects_goal_from_different_material(
    tmp_path: Path,
) -> None:
    material_id = _synthetic_material_id("catalog-owner")
    foreign_goal = _synthetic_goal(_synthetic_material_id("catalog-foreign"))
    record = _synthetic_catalog_record(material_id)
    record["material_version"] = 1
    record["goals"] = [foreign_goal.model_dump(mode="json")]
    catalog_path = tmp_path / "foreign_material_goal.json"
    _write_catalog_records(catalog_path, [record])

    with pytest.raises(MaterialCatalogError):
        load_material_catalog(catalog_path)


def test_material_catalog_rejects_invalid_catalog_or_goal_versions(
    tmp_path: Path,
) -> None:
    material_id = _synthetic_material_id("catalog-invalid-version")
    goal_payload = _synthetic_goal(material_id).model_dump(mode="json")
    invalid_versions = (0, -1, True, "1")
    catalog_path = tmp_path / "invalid_material_version.json"

    for invalid_version in invalid_versions:
        record = _synthetic_catalog_record(material_id)
        record["material_version"] = invalid_version
        record["goals"] = [goal_payload]
        _write_catalog_records(catalog_path, [record])
        with pytest.raises(MaterialCatalogError):
            load_material_catalog(catalog_path)

    catalog_path = tmp_path / "invalid_goal_version.json"
    for invalid_version in invalid_versions:
        goal = dict(goal_payload)
        goal["goal_version"] = invalid_version
        record = _synthetic_catalog_record(material_id)
        record["material_version"] = 1
        record["goals"] = [goal]
        _write_catalog_records(catalog_path, [record])
        with pytest.raises(MaterialCatalogError):
            load_material_catalog(catalog_path)


@pytest.mark.asyncio
async def test_catalog_rejects_duplicate_goal_ids(goal_pg: GoalHarness) -> None:
    service = _service_api()
    models = _model_api()
    material_id = _synthetic_material_id("duplicate")
    first = _synthetic_goal(material_id)
    duplicate = _synthetic_goal(material_id, goal_version=2, marker="duplicate")
    goal_pg.catalog_ids.append(material_id)

    async with goal_pg.factory() as db:
        with pytest.raises(service.ScenarioGoalValidationError):
            await service.record_goal_catalog_version(
                db,
                material_id=material_id,
                material_version=1,
                goals=(first, duplicate),
            )
        await db.rollback()

    async with goal_pg.factory() as db:
        row = await db.get(models.GoalCatalogVersion, (material_id, 1))
        assert row is None


@pytest.mark.asyncio
async def test_catalog_same_version_and_content_is_idempotent(
    goal_pg: GoalHarness,
) -> None:
    material_id = _synthetic_material_id("idempotent")
    goals = (_synthetic_goal(material_id),)

    first = await goal_pg.new_catalog(material_id, 1, goals)
    second = await goal_pg.new_catalog(material_id, 1, goals)

    assert second.material_id == first.material_id
    assert second.material_version == first.material_version
    assert second.goals == first.goals
    assert second.created_at == first.created_at


@pytest.mark.asyncio
async def test_catalog_same_version_with_different_content_is_rejected(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    models = _model_api()
    material_id = _synthetic_material_id("conflict")
    original = (_synthetic_goal(material_id, marker="original request"),)
    changed = (_synthetic_goal(material_id, marker="changed request"),)
    await goal_pg.new_catalog(material_id, 1, original)
    goal_pg.catalog_ids.append(material_id)

    async with goal_pg.factory() as db:
        with pytest.raises(service.GoalCatalogConflictError):
            await service.record_goal_catalog_version(
                db,
                material_id=material_id,
                material_version=1,
                goals=changed,
            )
        await db.rollback()

    async with goal_pg.factory() as db:
        row = await db.get(models.GoalCatalogVersion, (material_id, 1))
        assert row is not None
        assert row.goals == [original[0].model_dump(mode="json")]


@pytest.mark.asyncio
async def test_catalog_retains_two_material_versions(goal_pg: GoalHarness) -> None:
    models = _model_api()
    material_id = _synthetic_material_id("versions")
    version_one = (_synthetic_goal(material_id, marker="version one"),)
    version_two = (_synthetic_goal(material_id, marker="version two"),)

    await goal_pg.new_catalog(material_id, 1, version_one)
    await goal_pg.new_catalog(material_id, 2, version_two)

    async with goal_pg.factory() as db:
        rows = (
            (
                await db.execute(
                    select(models.GoalCatalogVersion)
                    .where(models.GoalCatalogVersion.material_id == material_id)
                    .order_by(models.GoalCatalogVersion.material_version)
                )
            )
            .scalars()
            .all()
        )
    assert [row.material_version for row in rows] == [1, 2]
    assert rows[0].goals == [version_one[0].model_dump(mode="json")]
    assert rows[1].goals == [version_two[0].model_dump(mode="json")]


@pytest.mark.asyncio
async def test_referenced_catalog_version_cannot_be_deleted(
    goal_pg: GoalHarness,
) -> None:
    models = _model_api()
    material_id = _synthetic_material_id("restrict")
    user_id = await goal_pg.new_user("restrict")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )
    await goal_pg.new_snapshot(user_id, session_id, material_id, 1)

    await _expect_dbapi_failure_then_rollback(
        goal_pg,
        """
        DELETE FROM goal_catalog_versions
        WHERE material_id = :material_id AND material_version = 1
        """,
        {"material_id": material_id},
        "Referenced goal_catalog_versions must use an FK RESTRICT policy",
    )

    async with goal_pg.factory() as db:
        assert await db.get(models.GoalCatalogVersion, (material_id, 1)) is not None
        assert await db.get(models.SessionGoalSnapshot, session_id) is not None


@pytest.mark.asyncio
async def test_active_session_snapshot_persists_without_denormalized_goals(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    models = _model_api()
    material_id = _synthetic_material_id("active")
    user_id = await goal_pg.new_user("active")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )

    written = await goal_pg.new_snapshot(user_id, session_id, material_id, 1)
    async with goal_pg.factory() as db:
        read = await service.read_session_goal_snapshot(
            db,
            user_id=user_id,
            session_id=session_id,
        )

    assert written.session_id == session_id
    assert read is not None
    assert read.material_id == material_id
    assert read.material_version == 1
    snapshot_columns = set(models.SessionGoalSnapshot.__table__.columns.keys())
    assert "goals" not in snapshot_columns
    assert "user_id" not in snapshot_columns


@pytest.mark.asyncio
async def test_snapshot_same_binding_is_idempotent(goal_pg: GoalHarness) -> None:
    models = _model_api()
    material_id = _synthetic_material_id("snapshot-idempotent")
    user_id = await goal_pg.new_user("snapshot-idempotent")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )

    first = await goal_pg.new_snapshot(user_id, session_id, material_id, 1)
    second = await goal_pg.new_snapshot(user_id, session_id, material_id, 1)

    assert second.session_id == first.session_id
    assert second.material_id == first.material_id
    assert second.material_version == first.material_version
    async with goal_pg.factory() as db:
        count = await db.scalar(
            select(models.SessionGoalSnapshot)
            .where(models.SessionGoalSnapshot.session_id == session_id)
            .with_only_columns(models.SessionGoalSnapshot.session_id)
            .limit(1)
        )
    assert count == session_id


@pytest.mark.asyncio
async def test_snapshot_different_binding_is_rejected(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    material_id = _synthetic_material_id("snapshot-conflict")
    user_id = await goal_pg.new_user("snapshot-conflict")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id, marker="version one"),),
    )
    await goal_pg.new_catalog(
        material_id,
        2,
        (_synthetic_goal(material_id, marker="version two"),),
    )
    await goal_pg.new_snapshot(user_id, session_id, material_id, 1)

    async with goal_pg.factory() as db:
        with pytest.raises(service.SessionGoalConflictError):
            await service.write_session_goal_snapshot(
                db,
                user_id=user_id,
                session_id=session_id,
                material_id=material_id,
                material_version=2,
            )
        await db.rollback()

    async with goal_pg.factory() as db:
        snapshot = await service.read_session_goal_snapshot(
            db,
            user_id=user_id,
            session_id=session_id,
        )
    assert snapshot is not None
    assert snapshot.material_version == 1


@pytest.mark.asyncio
async def test_snapshot_read_is_scoped_to_owner(goal_pg: GoalHarness) -> None:
    service = _service_api()
    material_id = _synthetic_material_id("owner-read")
    owner_id = await goal_pg.new_user("owner-read")
    other_id = await goal_pg.new_user("other-read")
    session_id = await goal_pg.new_session(owner_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )
    await goal_pg.new_snapshot(owner_id, session_id, material_id, 1)

    async with goal_pg.factory() as db:
        assert (
            await service.read_session_goal_snapshot(
                db,
                user_id=other_id,
                session_id=session_id,
            )
            is None
        )


@pytest.mark.asyncio
async def test_snapshot_write_rejects_cross_account_session(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    models = _model_api()
    material_id = _synthetic_material_id("owner-write")
    owner_id = await goal_pg.new_user("owner-write")
    other_id = await goal_pg.new_user("other-write")
    session_id = await goal_pg.new_session(owner_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )

    async with goal_pg.factory() as db:
        with pytest.raises(service.SessionGoalAccessError):
            await service.write_session_goal_snapshot(
                db,
                user_id=other_id,
                session_id=session_id,
                material_id=material_id,
                material_version=1,
            )
        await db.rollback()

    async with goal_pg.factory() as db:
        assert await db.get(models.SessionGoalSnapshot, session_id) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    [SessionStatus.completed, SessionStatus.cancelled],
)
async def test_first_snapshot_requires_active_session(
    goal_pg: GoalHarness,
    status: SessionStatus,
) -> None:
    service = _service_api()
    models = _model_api()
    material_id = _synthetic_material_id(status.value)
    user_id = await goal_pg.new_user(status.value)
    session_id = await goal_pg.new_session(user_id, status=status)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )

    async with goal_pg.factory() as db:
        with pytest.raises(service.SessionGoalStateError):
            await service.write_session_goal_snapshot(
                db,
                user_id=user_id,
                session_id=session_id,
                material_id=material_id,
                material_version=1,
            )
        await db.rollback()

    async with goal_pg.factory() as db:
        assert await db.get(models.SessionGoalSnapshot, session_id) is None


@pytest.mark.asyncio
async def test_legacy_session_without_snapshot_reads_none(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    user_id = await goal_pg.new_user("legacy")
    session_id = await goal_pg.new_session(
        user_id,
        status=SessionStatus.completed,
    )

    async with goal_pg.factory() as db:
        assert (
            await service.read_session_goal_snapshot(
                db,
                user_id=user_id,
                session_id=session_id,
            )
            is None
        )


@pytest.mark.asyncio
async def test_callers_own_rollback_for_catalog_and_snapshot(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    models = _model_api()
    material_id = _synthetic_material_id("caller-rollback")
    user_id = await goal_pg.new_user("caller-rollback")
    session_id = await goal_pg.new_session(user_id)
    goal = _synthetic_goal(material_id)
    goal_pg.catalog_ids.append(material_id)

    async with goal_pg.factory() as db:
        await service.record_goal_catalog_version(
            db,
            material_id=material_id,
            material_version=1,
            goals=(goal,),
        )
        await service.write_session_goal_snapshot(
            db,
            user_id=user_id,
            session_id=session_id,
            material_id=material_id,
            material_version=1,
        )
        await db.rollback()

    async with goal_pg.factory() as db:
        assert await db.get(models.GoalCatalogVersion, (material_id, 1)) is None
        assert await db.get(models.SessionGoalSnapshot, session_id) is None


@pytest.mark.asyncio
async def test_new_session_and_snapshot_roll_back_together(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    models = _model_api()
    material_id = _synthetic_material_id("atomic-session")
    user_id = await goal_pg.new_user("atomic-session")
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )
    session_id = uuid.uuid4()
    goal_pg.session_ids.append(session_id)

    async with goal_pg.factory() as db:
        transaction = await db.begin()
        try:
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.scenario,
                    status=SessionStatus.active,
                )
            )
            await db.flush()
            await service.write_session_goal_snapshot(
                db,
                user_id=user_id,
                session_id=session_id,
                material_id=material_id,
                material_version=1,
            )
            raise RuntimeError("rollback-new-session-and-snapshot")
        except RuntimeError:
            await transaction.rollback()

    async with goal_pg.factory() as db:
        assert await db.get(Session, session_id) is None
        assert await db.get(models.SessionGoalSnapshot, session_id) is None


@pytest.mark.asyncio
async def test_two_connections_concurrently_reuse_same_binding(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    models = _model_api()
    material_id = _synthetic_material_id("concurrent")
    user_id = await goal_pg.new_user("concurrent")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )
    ready_events = [asyncio.Event(), asyncio.Event()]
    release_writes = asyncio.Event()

    async def write_in_own_transaction(index: int) -> Any:
        async with goal_pg.factory() as db:
            await db.connection()
            ready_events[index].set()
            await release_writes.wait()
            snapshot = await service.write_session_goal_snapshot(
                db,
                user_id=user_id,
                session_id=session_id,
                material_id=material_id,
                material_version=1,
            )
            await db.commit()
            return snapshot

    tasks = [asyncio.create_task(write_in_own_transaction(index)) for index in range(2)]
    try:
        await asyncio.wait_for(
            asyncio.gather(*(event.wait() for event in ready_events)),
            timeout=10,
        )
        release_writes.set()
        first, second = await asyncio.wait_for(
            asyncio.gather(*tasks),
            timeout=20,
        )
    finally:
        release_writes.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    assert first.session_id == session_id
    assert second.session_id == session_id
    async with goal_pg.factory() as db:
        snapshots = (
            (
                await db.execute(
                    select(models.SessionGoalSnapshot).where(
                        models.SessionGoalSnapshot.session_id == session_id
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(snapshots) == 1


@pytest.mark.asyncio
async def test_idempotent_catalog_record_does_not_block_snapshot_fk(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    material_id = _synthetic_material_id("catalog_read_no_lock")
    goal = _synthetic_goal(material_id)
    user_id = await goal_pg.new_user("catalog_read_no_lock")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(material_id, 1, (goal,))
    record_ready = asyncio.Event()
    release_record = asyncio.Event()
    tasks: list[asyncio.Task[Any]] = []

    async def hold_idempotent_record_open() -> Any:
        async with goal_pg.factory() as db:
            await db.connection()
            row = await service.record_goal_catalog_version(
                db,
                material_id=material_id,
                material_version=1,
                goals=(goal,),
            )
            record_ready.set()
            await release_record.wait()
            await db.rollback()
            return row

    async def write_while_record_transaction_is_open() -> Any:
        async with goal_pg.factory() as db:
            snapshot = await service.write_session_goal_snapshot(
                db,
                user_id=user_id,
                session_id=session_id,
                material_id=material_id,
                material_version=1,
            )
            await db.commit()
            return snapshot

    record_task = asyncio.create_task(hold_idempotent_record_open())
    tasks.append(record_task)
    try:
        await asyncio.wait_for(record_ready.wait(), timeout=10)
        snapshot_task = asyncio.create_task(write_while_record_transaction_is_open())
        tasks.append(snapshot_task)
        done, _ = await asyncio.wait({snapshot_task}, timeout=10)
        assert snapshot_task in done, (
            "idempotent catalog read must not block snapshot FK insertion"
        )
        snapshot = snapshot_task.result()
    finally:
        release_record.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    assert snapshot.session_id == session_id
    assert snapshot.material_id == material_id
    assert snapshot.material_version == 1


@pytest.mark.asyncio
async def test_rejected_cross_account_snapshot_does_not_lock_owner_session(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    material_id = _synthetic_material_id("owner_scoped_lock")
    owner_id = await goal_pg.new_user("owner_scoped_lock_owner")
    other_id = await goal_pg.new_user("owner_scoped_lock_other")
    session_id = await goal_pg.new_session(owner_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )
    rejection_ready = asyncio.Event()
    release_rejection = asyncio.Event()
    tasks: list[asyncio.Task[Any]] = []

    async def rejected_cross_account_transaction() -> None:
        async with goal_pg.factory() as db:
            await db.connection()
            try:
                await service.write_session_goal_snapshot(
                    db,
                    user_id=other_id,
                    session_id=session_id,
                    material_id=material_id,
                    material_version=1,
                )
            except service.SessionGoalAccessError:
                rejection_ready.set()
                await release_rejection.wait()
                await db.rollback()
                return
            await db.rollback()
            pytest.fail(
                "Cross-account snapshot write unexpectedly succeeded",
                pytrace=False,
            )

    async def write_as_owner_while_rejection_is_open() -> Any:
        async with goal_pg.factory() as db:
            snapshot = await service.write_session_goal_snapshot(
                db,
                user_id=owner_id,
                session_id=session_id,
                material_id=material_id,
                material_version=1,
            )
            await db.commit()
            return snapshot

    rejection_task = asyncio.create_task(rejected_cross_account_transaction())
    tasks.append(rejection_task)
    try:
        await asyncio.wait_for(rejection_ready.wait(), timeout=10)
        owner_task = asyncio.create_task(write_as_owner_while_rejection_is_open())
        tasks.append(owner_task)
        done, _ = await asyncio.wait({owner_task}, timeout=10)
        assert owner_task in done, (
            "rejected cross-account write must not lock the owner's session"
        )
        snapshot = owner_task.result()
    finally:
        release_rejection.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    assert snapshot.session_id == session_id
    assert snapshot.material_id == material_id
    assert snapshot.material_version == 1


@pytest.mark.asyncio
async def test_direct_catalog_update_is_blocked(goal_pg: GoalHarness) -> None:
    models = _model_api()
    material_id = _synthetic_material_id("immutable-catalog")
    original = (_synthetic_goal(material_id, marker="original"),)
    changed = (_synthetic_goal(material_id, marker="changed"),)
    await goal_pg.new_catalog(material_id, 1, original)

    await _expect_dbapi_failure_then_rollback(
        goal_pg,
        """
        UPDATE goal_catalog_versions
        SET goals = CAST(:goals AS jsonb)
        WHERE material_id = :material_id AND material_version = 1
        """,
        {
            "material_id": material_id,
            "goals": json.dumps([changed[0].model_dump(mode="json")]),
        },
        "Direct UPDATE of goal_catalog_versions must be blocked by a trigger",
    )

    async with goal_pg.factory() as db:
        row = await db.get(models.GoalCatalogVersion, (material_id, 1))
    assert row is not None
    assert row.goals == [original[0].model_dump(mode="json")]


@pytest.mark.asyncio
async def test_direct_snapshot_update_is_blocked(goal_pg: GoalHarness) -> None:
    models = _model_api()
    material_id = _synthetic_material_id("immutable-snapshot")
    user_id = await goal_pg.new_user("immutable-snapshot")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id, marker="version one"),),
    )
    await goal_pg.new_catalog(
        material_id,
        2,
        (_synthetic_goal(material_id, marker="version two"),),
    )
    await goal_pg.new_snapshot(user_id, session_id, material_id, 1)

    await _expect_dbapi_failure_then_rollback(
        goal_pg,
        """
        UPDATE session_goal_snapshots
        SET material_version = 2
        WHERE session_id = :session_id
        """,
        {"session_id": session_id},
        "Direct UPDATE of session_goal_snapshots must be blocked by a trigger",
    )

    async with goal_pg.factory() as db:
        row = await db.get(models.SessionGoalSnapshot, session_id)
    assert row is not None
    assert row.material_version == 1


@pytest.mark.asyncio
async def test_delete_account_removes_own_snapshot_only(
    goal_pg: GoalHarness,
) -> None:
    models = _model_api()
    material_id = _synthetic_material_id("delete")
    owner_id = await goal_pg.new_user("delete-owner")
    other_id = await goal_pg.new_user("delete-other")
    owner_session_id = await goal_pg.new_session(owner_id)
    other_session_id = await goal_pg.new_session(other_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )
    await goal_pg.new_snapshot(owner_id, owner_session_id, material_id, 1)
    await goal_pg.new_snapshot(other_id, other_session_id, material_id, 1)

    async with goal_pg.factory() as db:
        await delete_user_account(db=db, user_id=owner_id)
        await db.commit()

    async with goal_pg.factory() as db:
        assert await db.get(User, owner_id) is None
        assert await db.get(Session, owner_session_id) is None
        assert await db.get(models.SessionGoalSnapshot, owner_session_id) is None
        assert await db.get(User, other_id) is not None
        assert await db.get(Session, other_session_id) is not None
        assert await db.get(models.SessionGoalSnapshot, other_session_id) is not None
        assert await db.get(models.GoalCatalogVersion, (material_id, 1)) is not None


@pytest.mark.asyncio
async def test_delete_account_failure_rolls_back_snapshot_deletion(
    goal_pg: GoalHarness,
) -> None:
    models = _model_api()
    material_id = _synthetic_material_id("delete-rollback")
    owner_id = await goal_pg.new_user("delete-rollback-owner")
    other_id = await goal_pg.new_user("delete-rollback-other")
    owner_session_id = await goal_pg.new_session(owner_id)
    other_session_id = await goal_pg.new_session(other_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )
    await goal_pg.new_snapshot(owner_id, owner_session_id, material_id, 1)
    await goal_pg.new_snapshot(other_id, other_session_id, material_id, 1)
    await goal_pg.install_user_delete_failure(owner_id)

    async with goal_pg.factory() as db:
        with pytest.raises(DBAPIError):
            await delete_user_account(db=db, user_id=owner_id)
        await db.rollback()

    async with goal_pg.factory() as db:
        assert await db.get(User, owner_id) is not None
        assert await db.get(Session, owner_session_id) is not None
        assert await db.get(models.SessionGoalSnapshot, owner_session_id) is not None
        assert await db.get(User, other_id) is not None
        assert await db.get(models.SessionGoalSnapshot, other_session_id) is not None


@pytest.mark.asyncio
async def test_http_export_defaults_to_v1_and_preserves_shape(
    goal_pg: GoalHarness,
) -> None:
    material_id = _synthetic_material_id("export-v1")
    user_id = await goal_pg.new_user("export-v1")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(
        material_id,
        1,
        (_synthetic_goal(material_id),),
    )
    await goal_pg.new_snapshot(user_id, session_id, material_id, 1)

    async with _export_client(goal_pg, user_id) as client:
        response = await client.get(EXPORT_PATH)

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == V1_TOP_LEVEL_KEYS
    assert payload["schema_version"] == 1
    assert "session_goals" not in payload
    assert len(payload["sessions"]) == 1
    assert set(payload["sessions"][0]) == SESSION_KEYS
    assert "attachment" in response.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_http_export_v2_contains_complete_owner_goal_only(
    goal_pg: GoalHarness,
) -> None:
    material_id = _synthetic_material_id("export-v2")
    goal = _synthetic_goal(material_id)
    owner_id = await goal_pg.new_user("export-v2-owner")
    other_id = await goal_pg.new_user("export-v2-other")
    owner_session_id = await goal_pg.new_session(owner_id)
    other_session_id = await goal_pg.new_session(other_id)
    await goal_pg.new_catalog(material_id, 1, (goal,))
    await goal_pg.new_snapshot(owner_id, owner_session_id, material_id, 1)
    await goal_pg.new_snapshot(other_id, other_session_id, material_id, 1)

    async with _export_client(goal_pg, owner_id) as client:
        response = await client.get(
            EXPORT_PATH,
            params={"schema_version": 2},
        )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == V2_TOP_LEVEL_KEYS
    assert payload["schema_version"] == 2
    assert len(payload["session_goals"]) == 1
    exported = payload["session_goals"][0]
    assert set(exported) == SESSION_GOAL_KEYS
    assert exported["session_id"] == str(owner_session_id)
    assert exported["material_id"] == material_id
    assert exported["material_version"] == 1
    assert exported["goals"] == [goal.model_dump(mode="json")]
    assert set(exported["goals"][0]) == GOAL_KEYS
    assert all(
        item["session_id"] != str(other_session_id) for item in payload["session_goals"]
    )
    assert "attachment" in response.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_snapshot_and_export_keep_v1_goals_after_v2_is_published(
    goal_pg: GoalHarness,
) -> None:
    service = _service_api()
    material_id = _synthetic_material_id("export-version-pin")
    version_one = _synthetic_goal(
        material_id,
        marker="version one request",
    )
    version_two = _synthetic_goal(
        material_id,
        marker="version two request",
    )
    user_id = await goal_pg.new_user("export-version-pin")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.new_catalog(material_id, 1, (version_one,))
    await goal_pg.new_snapshot(user_id, session_id, material_id, 1)
    await goal_pg.new_catalog(material_id, 2, (version_two,))

    async with goal_pg.factory() as db:
        snapshot = await service.read_session_goal_snapshot(
            db,
            user_id=user_id,
            session_id=session_id,
        )
    assert snapshot is not None
    assert snapshot.material_id == material_id
    assert snapshot.material_version == 1

    async with _export_client(goal_pg, user_id) as client:
        response = await client.get(
            EXPORT_PATH,
            params={"schema_version": 2},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == 2
    assert len(payload["session_goals"]) == 1
    exported = payload["session_goals"][0]
    assert exported["session_id"] == str(session_id)
    assert exported["material_id"] == material_id
    assert exported["material_version"] == 1
    assert exported["goals"] == [version_one.model_dump(mode="json")]
    assert exported["goals"] != [version_two.model_dump(mode="json")]


@pytest.mark.asyncio
async def test_http_export_v2_bad_catalog_is_generic_500_without_download_headers(
    goal_pg: GoalHarness,
) -> None:
    material_id = _synthetic_material_id("export-bad")
    user_id = await goal_pg.new_user("export-bad")
    session_id = await goal_pg.new_session(user_id)
    await goal_pg.insert_malformed_snapshot(session_id, material_id)

    async with _export_client(goal_pg, user_id) as client:
        response = await client.get(
            EXPORT_PATH,
            params={"schema_version": 2},
        )

    assert response.status_code == 500
    assert response.json() == {"detail": GENERIC_EXPORT_ERROR}
    assert "content-disposition" not in response.headers
    assert "cache-control" not in response.headers
