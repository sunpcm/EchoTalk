"""R2-14 RED gate for authenticated and system infrastructure readiness."""

import asyncio
import os
import re
import time
from contextlib import contextmanager
from typing import Any, Iterator

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import event, func, select
from sqlalchemy.engine import make_url

import database
from database import get_db
from dependencies import (
    get_authenticated_identity,
    get_current_user,
    get_current_user_from_identity,
)
from main import app
from models.user import User
from routers.health import router as health_router

SYSTEM_READY_PATH = "/api/health/system-ready"
SYSTEM_READY_ROUTE_PATH = "/health/system-ready"
LEGACY_READY_PATH = "/api/health/ready"
_LOCAL_B1_DATABASE = ("127.0.0.1", 55433, "echotalk_b1_test")
_CI_DATABASE = ("localhost", 5432, "echotalk_test")
_AUTH_DEPENDENCIES = (
    get_authenticated_identity,
    get_current_user,
    get_current_user_from_identity,
)
_MISSING = object()
_USER_SQL = re.compile(r"\b(?:users|user_profiles|user_settings)\b", re.IGNORECASE)
_WRITE_SQL = re.compile(
    r"^\s*(?:insert|update|delete|merge|create|alter|drop|truncate)\b",
    re.IGNORECASE,
)
_SENSITIVE_CREDENTIAL = "synthetic-credential"
_SENSITIVE_ERROR = (
    f"postgresql+asyncpg://canary_user:{_SENSITIVE_CREDENTIAL}"
    "@127.0.0.1:65530/canary_db"
)
_SENSITIVE_MARKERS = (
    "canary_user",
    _SENSITIVE_CREDENTIAL,
    "canary_db",
    "postgresql",
    "127.0.0.1",
    "65530",
    "RuntimeError",
    "Traceback",
)


def _require_system_ready_route() -> dict[str, Any]:
    operation = app.openapi().get("paths", {}).get(SYSTEM_READY_PATH, {}).get("get")
    if operation is None:
        pytest.fail(
            f"GET {SYSTEM_READY_PATH} is not implemented (R2-14 RED)",
            pytrace=False,
        )
    return operation


def _require_b1_database_url():
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail(
            "R2-14 PostgreSQL test requires explicit DATABASE_URL",
            pytrace=False,
        )
    expected_target = (
        _CI_DATABASE
        if os.environ.get("GITHUB_ACTIONS") == "true"
        else _LOCAL_B1_DATABASE
    )
    try:
        parsed = make_url(raw)
        actual = (parsed.host, parsed.port, parsed.database)
        valid = (
            parsed.drivername in {"postgresql", "postgresql+asyncpg"}
            and actual == expected_target
            and bool(parsed.username and parsed.username.strip())
            and not parsed.query
        )
        engine_target = (
            database.engine.url.host,
            database.engine.url.port,
            database.engine.url.database,
        )
    except Exception:
        pytest.fail("R2-14 PostgreSQL test DATABASE_URL is invalid", pytrace=False)
    if not valid or engine_target != expected_target:
        pytest.fail("R2-14 PostgreSQL test database boundary mismatch", pytrace=False)
    return parsed


@contextmanager
def _real_auth_dependencies() -> Iterator[None]:
    saved = {
        dependency: app.dependency_overrides.pop(dependency, _MISSING)
        for dependency in _AUTH_DEPENDENCIES
    }
    try:
        yield
    finally:
        for dependency, value in saved.items():
            if value is _MISSING:
                app.dependency_overrides.pop(dependency, None)
            else:
                app.dependency_overrides[dependency] = value


class _ResponseStartObserver:
    def __init__(self, application: Any, observe: Any) -> None:
        self.application = application
        self.observe = observe
        self.observations: list[Any] = []

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        async def observed_send(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                self.observations.append(self.observe())
            await send(message)

        await self.application(scope, receive, observed_send)


def _client(application: Any = app) -> AsyncClient:
    return AsyncClient(
        transport=ASGITransport(app=application, raise_app_exceptions=False),
        base_url="http://test",
    )


def _dependency_calls(dependant: Any) -> Iterator[Any]:
    for dependency in dependant.dependencies:
        yield dependency.call
        yield from _dependency_calls(dependency)


def _resolve_schema(openapi: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    resolved = schema
    visited: set[str] = set()
    while "$ref" in resolved:
        ref = resolved["$ref"]
        assert ref not in visited
        visited.add(ref)
        assert ref.startswith("#/")
        current: Any = openapi
        for segment in ref[2:].split("/"):
            current = current[segment.replace("~1", "/").replace("~0", "~")]
        resolved = current
    return resolved


def _assert_generic_503(response: Response) -> dict[str, Any]:
    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/json")
    for marker in _SENSITIVE_MARKERS:
        assert marker not in response.text
    payload = response.json()
    assert isinstance(payload, dict) and payload
    assert set(payload) <= {"status", "detail", "code", "errors"}
    if "status" in payload:
        assert payload["status"] == "not_ready"
    detail = payload.get("detail")
    if isinstance(detail, dict) and "status" in detail:
        assert detail["status"] == "not_ready"
    if isinstance(detail, str):
        assert detail.strip()
    return payload


async def _user_count() -> int:
    async with database.async_session_maker() as session:
        count = await session.scalar(select(func.count()).select_from(User))
    return int(count or 0)


class _FakeConnection:
    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.query_cancelled = asyncio.Event()

    async def execute(self, *_args: Any, **_kwargs: Any) -> None:
        if self.mode == "query_error":
            raise RuntimeError(_SENSITIVE_ERROR)
        if self.mode == "timeout":
            try:
                await asyncio.Future()
            finally:
                self.query_cancelled.set()
        return None

    async def scalar(self, *args: Any, **kwargs: Any) -> Any:
        return await self.execute(*args, **kwargs)


class _ConnectionContext:
    def __init__(
        self,
        connection: _FakeConnection,
        released: asyncio.Event,
        release_delay: float = 0.0,
    ) -> None:
        self.connection = connection
        self.released = released
        self.release_delay = release_delay

    async def __aenter__(self) -> _FakeConnection:
        return self.connection

    async def __aexit__(self, *_args: Any) -> bool:
        if self.release_delay:
            await asyncio.shield(asyncio.sleep(self.release_delay))
        self.released.set()
        return False


def test_system_ready_openapi_is_public_and_typed() -> None:
    operation = _require_system_ready_route()
    openapi = app.openapi()

    parameters = operation.get("parameters", [])
    assert parameters == []
    assert "security" not in operation

    success = operation["responses"]["200"]["content"]["application/json"]["schema"]
    success_schema = _resolve_schema(openapi, success)
    assert success_schema.get("type") == "object"
    assert "status" in success_schema.get("required", [])
    status_schema = _resolve_schema(
        openapi,
        success_schema["properties"]["status"],
    )
    assert status_schema.get("const") == "ready" or status_schema.get("enum") == [
        "ready"
    ]

    error = operation["responses"]["503"]["content"]["application/json"]["schema"]
    error_schema = _resolve_schema(openapi, error)
    assert error_schema

    route = next(
        route
        for route in health_router.routes
        if getattr(route, "path", None) == SYSTEM_READY_ROUTE_PATH
    )
    dependencies = {
        call for call in _dependency_calls(route.dependant) if call is not None
    }
    assert dependencies.isdisjoint(_AUTH_DEPENDENCIES)
    assert get_db not in dependencies


@pytest.mark.asyncio
async def test_system_ready_real_postgres_is_public_and_side_effect_free() -> None:
    _require_system_ready_route()
    _require_b1_database_url()
    before = await _user_count()
    statements: list[str] = []

    def capture_statement(
        _connection: Any,
        _cursor: Any,
        statement: str,
        _parameters: Any,
        _context: Any,
        _executemany: bool,
    ) -> None:
        statements.append(" ".join(statement.split()))

    event.listen(
        database.engine.sync_engine,
        "before_cursor_execute",
        capture_statement,
    )
    observer = _ResponseStartObserver(app, database.engine.pool.checkedout)
    try:
        with _real_auth_dependencies():
            async with _client(observer) as client:
                anonymous = await client.get(SYSTEM_READY_PATH)
                wrong_bearer = await client.get(
                    SYSTEM_READY_PATH,
                    headers={"Authorization": "Bearer definitely-wrong"},
                )
    finally:
        event.remove(
            database.engine.sync_engine,
            "before_cursor_execute",
            capture_statement,
        )

    after = await _user_count()
    assert anonymous.status_code == 200
    assert anonymous.json() == {"status": "ready"}
    assert wrong_bearer.status_code == 200
    assert wrong_bearer.json() == {"status": "ready"}
    assert database.engine.pool.checkedout() == 0
    assert observer.observations == [0, 0]
    assert before == after
    assert not any(_USER_SQL.search(statement) for statement in statements)
    assert not any(_WRITE_SQL.search(statement) for statement in statements)
    assert any(statement.casefold() == "select 1" for statement in statements)


@pytest.mark.asyncio
async def test_legacy_ready_still_rejects_missing_and_wrong_bearer() -> None:
    _require_system_ready_route()
    with _real_auth_dependencies():
        async with _client() as client:
            missing = await client.get(LEGACY_READY_PATH)
            wrong = await client.get(
                LEGACY_READY_PATH,
                headers={"Authorization": "Bearer definitely-wrong"},
            )

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert missing.headers.get("www-authenticate") == "Bearer"
    assert wrong.headers.get("www-authenticate") == "Bearer"


@pytest.mark.asyncio
async def test_system_ready_connection_failure_returns_generic_json_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_system_ready_route()
    attempted = False

    def fail_connect(
        self: Any,
        *_args: Any,
        **_kwargs: Any,
    ) -> None:
        nonlocal attempted
        attempted = True
        raise RuntimeError(_SENSITIVE_ERROR)

    monkeypatch.setattr(type(database.engine), "connect", fail_connect)
    with _real_auth_dependencies():
        async with _client() as client:
            response = await client.get(SYSTEM_READY_PATH)

    _assert_generic_503(response)
    assert attempted


@pytest.mark.asyncio
async def test_system_ready_query_failure_releases_connection_before_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_system_ready_route()
    released = asyncio.Event()
    connection = _FakeConnection("query_error")

    def return_connection_context(
        self: Any,
        *_args: Any,
        **_kwargs: Any,
    ) -> _ConnectionContext:
        return _ConnectionContext(connection, released)

    monkeypatch.setattr(
        type(database.engine),
        "connect",
        return_connection_context,
    )
    observer = _ResponseStartObserver(app, released.is_set)
    with _real_auth_dependencies():
        async with _client(observer) as client:
            response = await client.get(SYSTEM_READY_PATH)

    _assert_generic_503(response)
    assert observer.observations == [True]


@pytest.mark.asyncio
async def test_system_ready_timeout_is_bounded_and_releases_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_system_ready_route()
    released = asyncio.Event()
    connection = _FakeConnection("timeout")

    def return_connection_context(
        self: Any,
        *_args: Any,
        **_kwargs: Any,
    ) -> _ConnectionContext:
        return _ConnectionContext(connection, released)

    monkeypatch.setattr(
        type(database.engine),
        "connect",
        return_connection_context,
    )
    started = time.monotonic()
    observer = _ResponseStartObserver(app, released.is_set)
    try:
        async with asyncio.timeout(4.5):
            with _real_auth_dependencies():
                async with _client(observer) as client:
                    response = await client.get(SYSTEM_READY_PATH)
    except TimeoutError:
        pytest.fail(
            "GET /api/health/system-ready exceeded the bounded readiness deadline",
            pytrace=False,
        )
    elapsed = time.monotonic() - started

    _assert_generic_503(response)
    assert elapsed < 4.5
    assert connection.query_cancelled.is_set()
    assert observer.observations == [True]


@pytest.mark.asyncio
async def test_system_ready_budget_includes_shielded_driver_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_system_ready_route()
    released = asyncio.Event()
    connection = _FakeConnection("timeout")
    context = _ConnectionContext(connection, released, release_delay=2.0)

    def return_connection_context(
        self: Any,
        *_args: Any,
        **_kwargs: Any,
    ) -> _ConnectionContext:
        return context

    monkeypatch.setattr(
        type(database.engine),
        "connect",
        return_connection_context,
    )
    observer = _ResponseStartObserver(app, released.is_set)
    deadline_hit = False
    started = time.monotonic()
    with _real_auth_dependencies():
        async with _client(observer) as client:
            request_task = asyncio.create_task(client.get(SYSTEM_READY_PATH))
            try:
                response = await asyncio.wait_for(
                    asyncio.shield(request_task),
                    timeout=3.5,
                )
            except TimeoutError:
                deadline_hit = True
                response = await request_task
    elapsed = time.monotonic() - started

    assert not deadline_hit, (
        "GET /api/health/system-ready exceeded the 3.5s outer hard deadline"
    )
    assert response is not None
    _assert_generic_503(response)
    assert elapsed < 3.0
    assert connection.query_cancelled.is_set()
    assert observer.observations == [True]
