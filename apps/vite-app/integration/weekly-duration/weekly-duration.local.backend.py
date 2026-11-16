"""Real FastAPI/PostgreSQL fixture and server harness for WDI local verification.

This process imports the production app and authentication path. It installs
only test-process isolation guards around environment-file reads, network
egress, fixtures, and resource lifecycle.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, NoReturn
from urllib.parse import urlsplit

API_HOST = "127.0.0.1"
API_PORT = 18183
PG_PORT = 55433
PG_DATABASE = "echotalk_b1_test"
PG_USER = "echotalk_b1_test"
MARKER = "wdi-local-weekly-duration-20261116"
DEV_ISSUER = "urn:echotalk:dev"
DEV_SUBJECT = "local-developer"
DEV_USER_ID = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
OTHER_USER_ID = uuid.UUID("d0600000-0000-4000-8000-000000000001")
OTHER_EMAIL = "wdi-other-user@users.invalid"
BACKEND_ROOT = Path(__file__).resolve().parents[4] / "backend"
ALLOWED_DASHBOARD_GET_PATHS = frozenset(
    {
        "/api/health",
        "/api/health/ready",
        "/api/user/settings",
        "/api/assessments/knowledge/states",
        "/api/assessments/knowledge/skills",
        "/api/assessments/weekly-grammar",
        "/api/curriculum/next",
        "/api/sessions/active",
        "/api/sessions/daily-progress",
        "/api/sessions",
        "/api/sessions/weekly-progress",
    }
)

SESSION_IDS = [
    uuid.UUID(f"c0600000-0000-4000-8000-{index:012d}") for index in range(1, 11)
]


def _fail(message: str) -> NoReturn:
    print(f"WDI_HARNESS_ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def _validated_database_url() -> str:
    if os.environ.get("ECHOTALK_WDI_LOCAL_PG") != "1":
        _fail("ECHOTALK_WDI_LOCAL_PG=1 must be explicitly enabled")
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        _fail("DATABASE_URL is required")
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError:
        _fail("DATABASE_URL is invalid")
    if parsed.scheme not in {"postgres", "postgresql", "postgresql+asyncpg"}:
        _fail("DATABASE_URL uses an unsupported scheme")
    if parsed.hostname != API_HOST_ALIAS or port != PG_PORT:
        _fail("DATABASE_URL must target 127.0.0.1:55433")
    if parsed.username != PG_USER:
        _fail("DATABASE_URL must use the dedicated test user")
    if parsed.password is None or parsed.password == "":
        _fail("DATABASE_URL password must not be empty")
    if parsed.path != f"/{PG_DATABASE}" or parsed.query or parsed.fragment:
        _fail("DATABASE_URL must target only the dedicated test database")
    return raw


API_HOST_ALIAS = "127.0.0.1"


def _is_dotenv_path(value: Any) -> bool:
    if not isinstance(value, (str, bytes, os.PathLike)):
        return False
    try:
        name = Path(os.fsdecode(value)).name
    except (TypeError, ValueError):
        return False
    return name == ".env" or name.startswith(".env.")


def _install_isolation_guards() -> None:
    """Deny dotenv reads and all outbound connections except the dedicated PG."""

    def guarded_audit(event: str, args: tuple[Any, ...]) -> None:
        if event == "open" and args and _is_dotenv_path(args[0]):
            raise PermissionError("dotenv_read_forbidden")

    def is_allowed(address: Any) -> bool:
        if not isinstance(address, tuple) or len(address) < 2:
            return False
        host, port = address[0], address[1]
        return host == "127.0.0.1" and port == PG_PORT

    real_getaddrinfo = socket.getaddrinfo
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_sendto = socket.socket.sendto
    real_create_connection = socket.create_connection

    def guarded_getaddrinfo(host: Any, port: Any, *args: Any, **kwargs: Any):
        if host != "127.0.0.1" or port != PG_PORT:
            raise OSError("egress_blocked_non_pg_dns")
        return real_getaddrinfo(host, port, *args, **kwargs)

    def guarded_connect(self: socket.socket, address: Any):
        if not is_allowed(address):
            raise OSError("egress_blocked_non_pg_connect")
        return real_connect(self, address)

    def guarded_connect_ex(self: socket.socket, address: Any):
        if not is_allowed(address):
            raise OSError("egress_blocked_non_pg_connect")
        return real_connect_ex(self, address)

    def guarded_sendto(self: socket.socket, data: Any, address: Any):
        if not is_allowed(address):
            raise OSError("egress_blocked_non_pg_sendto")
        return real_sendto(self, data, address)

    def guarded_create_connection(address: Any, *args: Any, **kwargs: Any):
        if not is_allowed(address):
            raise OSError("egress_blocked_non_pg_connect")
        return real_create_connection(address, *args, **kwargs)

    socket.getaddrinfo = guarded_getaddrinfo
    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex
    socket.socket.sendto = guarded_sendto
    socket.create_connection = guarded_create_connection
    sys.addaudithook(guarded_audit)


def _install_settings_isolation() -> None:
    from pydantic_settings import BaseSettings

    original_init = BaseSettings.__init__

    def isolated_init(settings_instance: BaseSettings, **values: object) -> None:
        values["_env_file"] = None
        values["_secrets_dir"] = None
        original_init(settings_instance, **values)

    def isolated_sources(
        cls: type[BaseSettings],
        settings_cls: type[BaseSettings],
        init_settings: object,
        env_settings: object,
        dotenv_settings: object,
        file_secret_settings: object,
    ) -> tuple[object, object]:
        del cls, settings_cls, dotenv_settings, file_secret_settings
        return init_settings, env_settings

    BaseSettings.__init__ = isolated_init
    BaseSettings.settings_customise_sources = classmethod(isolated_sources)


_DATABASE_URL = _validated_database_url()
_install_isolation_guards()
_install_settings_isolation()
sys.dont_write_bytecode = True
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import delete, func, select  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    async_sessionmaker,
    create_async_engine,
)

from config import settings  # noqa: E402
from models.session import Session, SessionMode, SessionStatus  # noqa: E402
from models.user import User, UserProfile, UserSettings  # noqa: E402


def _utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def _session_rows(main_user_id: uuid.UUID, other_user_id: uuid.UUID) -> list[Session]:
    base = datetime(2026, 10, 28, 1, tzinfo=timezone.utc)
    return [
        Session(
            id=SESSION_IDS[0],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=base,
            ended_at=base + timedelta(microseconds=333_666),
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[1],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=base + timedelta(hours=1),
            ended_at=base + timedelta(hours=1, microseconds=333_666),
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[2],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=base + timedelta(hours=2),
            ended_at=base + timedelta(hours=2, microseconds=333_666),
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[3],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=_utc("2026-10-29T01:00:00Z"),
            ended_at=_utc("2026-10-29T01:01:01.500Z"),
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[4],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=_utc("2026-10-30T01:00:00Z"),
            ended_at=_utc("2026-10-30T01:00:00Z"),
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[5],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=_utc("2026-11-01T01:00:00Z"),
            ended_at=None,
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[6],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=_utc("2026-11-01T02:00:00Z"),
            ended_at=_utc("2026-11-01T01:59:59Z"),
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[7],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=_utc("2026-11-02T01:00:00Z"),
            ended_at=_utc("2026-11-02T02:00:00Z"),
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[8],
            user_id=main_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.active,
            started_at=_utc("2026-10-31T01:00:00Z"),
            ended_at=None,
            request_fingerprint=MARKER,
        ),
        Session(
            id=SESSION_IDS[9],
            user_id=other_user_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
            started_at=_utc("2026-10-31T02:00:00Z"),
            ended_at=_utc("2026-10-31T02:00:01Z"),
            request_fingerprint=MARKER,
        ),
    ]


def _write_state(state_path: Path, state: dict[str, Any]) -> None:
    temporary = state_path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, state_path)


def _read_state(state_path: Path) -> dict[str, Any]:
    try:
        value = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        _fail("fixture state is missing or invalid")
    if not isinstance(value, dict) or value.get("marker") != MARKER:
        _fail("fixture state marker does not match")
    return value


async def _seed(state_path: Path) -> None:
    if state_path.exists():
        _fail("fixture state already exists")
    settings.validate_runtime()
    engine = create_async_engine(settings.ASYNC_DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db, db.begin():
            main_user = (
                await db.execute(
                    select(User).where(
                        User.auth_issuer == DEV_ISSUER,
                        User.auth_subject == DEV_SUBJECT,
                    )
                )
            ).scalar_one_or_none()
            main_user_created = False
            main_settings_created = False
            main_profile_created = False
            if main_user is None:
                if await db.get(User, DEV_USER_ID) is not None:
                    _fail("dev user id exists without the expected issuer/subject")
                email_owner = await db.scalar(
                    select(User.id).where(User.email == "test@example.com")
                )
                if email_owner is not None:
                    _fail("synthetic dev email belongs to another user")
                main_user = User(
                    id=DEV_USER_ID,
                    email="test@example.com",
                    password_hash=None,
                    auth_issuer=DEV_ISSUER,
                    auth_subject=DEV_SUBJECT,
                )
                db.add(main_user)
                await db.flush()
                main_user_created = True
                db.add(UserSettings(user_id=main_user.id, is_custom_mode=False))
                db.add(UserProfile(user_id=main_user.id, total_practice_minutes=0))
                main_settings_created = True
                main_profile_created = True
                await db.flush()

            other_user = await db.get(User, OTHER_USER_ID)
            if other_user is not None:
                _fail("fixed other-user id already exists")
            other_email_owner = await db.scalar(
                select(User.id).where(User.email == OTHER_EMAIL)
            )
            if other_email_owner is not None:
                _fail("fixed other-user email already exists")
            other_user = User(
                id=OTHER_USER_ID,
                email=OTHER_EMAIL,
                password_hash=None,
                auth_issuer="urn:echotalk:wdi",
                auth_subject="other-user",
            )
            db.add(other_user)
            await db.flush()

            existing_ids = (
                (
                    await db.execute(
                        select(Session.id).where(Session.id.in_(SESSION_IDS))
                    )
                )
                .scalars()
                .all()
            )
            if existing_ids:
                _fail("fixed fixture session ids already exist")

            week_start = _utc("2026-10-27T16:00:00Z")
            week_end = _utc("2026-11-03T16:00:00Z")
            unexpected = await db.scalar(
                select(func.count())
                .select_from(Session)
                .where(
                    Session.user_id == main_user.id,
                    Session.started_at >= week_start,
                    Session.started_at < week_end,
                )
            )
            if int(unexpected or 0) != 0:
                _fail("dev user target week contains non-fixture sessions")

            for row in _session_rows(main_user.id, other_user.id):
                db.add(row)
            await db.flush()

            state = {
                "marker": MARKER,
                "main_user_id": str(main_user.id),
                "main_user_created": main_user_created,
                "main_settings_created": main_settings_created,
                "main_profile_created": main_profile_created,
                "other_user_id": str(other_user.id),
                "other_user_created": True,
                "created_session_ids": [str(value) for value in SESSION_IDS],
            }
        _write_state(state_path, state)
    except SystemExit:
        raise
    except Exception as exc:
        _fail(f"seed failed with {type(exc).__name__}")
    finally:
        await engine.dispose()


async def _cleanup(state_path: Path) -> None:
    state = _read_state(state_path)
    main_user_id = uuid.UUID(str(state["main_user_id"]))
    other_user_id = uuid.UUID(str(state["other_user_id"]))
    expected_ids = {uuid.UUID(str(value)) for value in state["created_session_ids"]}
    if expected_ids != set(SESSION_IDS):
        _fail("fixture state session ids do not match the frozen vector")

    engine = create_async_engine(settings.ASYNC_DATABASE_URL, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db, db.begin():
            rows = (
                await db.execute(
                    select(
                        Session.id,
                        Session.user_id,
                        Session.request_fingerprint,
                    ).where(Session.id.in_(expected_ids))
                )
            ).all()
            for row in rows:
                if row.id not in expected_ids or row.request_fingerprint != MARKER:
                    _fail("fixture session ownership marker changed")
                if row.user_id not in {main_user_id, other_user_id}:
                    _fail("fixture session owner changed")

            if rows:
                result = await db.execute(
                    delete(Session).where(
                        Session.id.in_([row.id for row in rows]),
                        Session.request_fingerprint == MARKER,
                    )
                )
                if result.rowcount != len(rows):
                    _fail("fixture session deletion was incomplete")

            if bool(state.get("main_settings_created")):
                await db.execute(
                    delete(UserSettings).where(UserSettings.user_id == main_user_id)
                )
            if bool(state.get("main_profile_created")):
                await db.execute(
                    delete(UserProfile).where(UserProfile.user_id == main_user_id)
                )

            if bool(state.get("other_user_created")):
                remaining = await db.scalar(
                    select(func.count())
                    .select_from(Session)
                    .where(Session.user_id == other_user_id)
                )
                if int(remaining or 0) != 0:
                    _fail("other fixture user is still referenced")
                await db.execute(delete(User).where(User.id == other_user_id))

            if bool(state.get("main_user_created")):
                references = (
                    await db.scalar(
                        select(func.count())
                        .select_from(Session)
                        .where(Session.user_id == main_user_id)
                    ),
                    await db.scalar(
                        select(func.count())
                        .select_from(UserSettings)
                        .where(UserSettings.user_id == main_user_id)
                    ),
                    await db.scalar(
                        select(func.count())
                        .select_from(UserProfile)
                        .where(UserProfile.user_id == main_user_id)
                    ),
                )
                if any(int(value or 0) != 0 for value in references):
                    _fail("created dev user is still referenced")
                await db.execute(delete(User).where(User.id == main_user_id))
    except SystemExit:
        raise
    except Exception as exc:
        _fail(f"cleanup failed with {type(exc).__name__}")
    finally:
        await engine.dispose()


class ReadOnlyDashboardEnvelope:
    """Restrict the test API process to the Dashboard's real read-only routes."""

    def __init__(self, app: Any) -> None:
        self._app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        scope_type = scope.get("type")
        if scope_type == "lifespan":
            await self._app(scope, receive, send)
            return

        if scope_type != "http":
            if scope_type == "websocket":
                await send(
                    {
                        "type": "websocket.close",
                        "code": 1008,
                        "reason": "read-only Dashboard envelope",
                    }
                )
            return

        if scope.get("method") != "GET":
            await _send_envelope_json(
                send,
                405,
                b"method_not_allowed",
                extra_headers=[(b"allow", b"GET")],
            )
            return

        if scope.get("path") not in ALLOWED_DASHBOARD_GET_PATHS:
            await _send_envelope_json(send, 403, b"path_forbidden")
            return

        await self._app(scope, receive, send)


async def _send_envelope_json(
    send: Any,
    status: int,
    detail: bytes,
    *,
    extra_headers: list[tuple[bytes, bytes]] | None = None,
) -> None:
    body = b'{"detail":"' + detail + b'"}'
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode("ascii")),
        *(extra_headers or []),
    ]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


async def _serve() -> None:
    import uvicorn

    import database
    from main import app as production_app

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_socket.bind((API_HOST, API_PORT))
        server_socket.listen(2048)
        application = ReadOnlyDashboardEnvelope(production_app)
        config = uvicorn.Config(
            application,
            host=API_HOST,
            port=API_PORT,
            access_log=False,
            log_level="warning",
            timeout_graceful_shutdown=10,
        )
        server = uvicorn.Server(config)
        try:
            await server.serve(sockets=[server_socket])
        finally:
            server_socket.close()
            await database.engine.dispose()
    except Exception as exc:
        server_socket.close()
        _fail(
            f"api server failed with {type(exc).__name__} errno={getattr(exc, 'errno', None)}"
        )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("seed", "cleanup", "serve"))
    parser.add_argument("--state", type=Path)
    args = parser.parse_args()
    if args.operation in {"seed", "cleanup"} and args.state is None:
        parser.error("--state is required for seed and cleanup")
    return args


def main() -> None:
    args = _parse_args()
    if args.operation == "seed":
        asyncio.run(_seed(args.state))
    elif args.operation == "cleanup":
        asyncio.run(_cleanup(args.state))
    else:
        asyncio.run(_serve())


if __name__ == "__main__":
    main()
