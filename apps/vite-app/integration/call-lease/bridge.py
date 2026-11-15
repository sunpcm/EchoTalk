"""CP02I 本地组合 stdio 传输桥。

职责：只转发真实 FastAPI ASGI 请求（path/method/body/headers/response）到真实
PostgreSQL，不实现任何租约业务逻辑，不伪造服务端结果。仅模拟 LiveKit Cloud 房间
参与者移除（媒体撤销）；真实 PG/ASGI 路由/事务/JSON 响应不被 mock。

作为长驻 stdio 进程：stdin 读换行 JSON，stdout 写换行 JSON。安全约束：
- DATABASE_URL 必须为 postgresql:// 或 postgres://、精确 127.0.0.1:55433、
  用户与库均为 echotalk_b1_test，且显式设置 ECHOTALK_CALL_LEASE_LOCAL_PG=1；
- 进程级出站硬拦截：除 127.0.0.1:55433 的真实 PG 连接外，任何 socket
  connect/connect_ex/sendto/getaddrinfo 一律失败，真实 DNS 与 Cloud 无出站机会；
- 不读 .env / 真实凭据 / runtime 凭据；
- HTTP 身份必须来自请求 Bearer 合成 UUID，且该 UUID 必须是本桥创建并拥有的用户；
- 响应与 stderr 不回显数据库 URL / 密码 / Provider 原始错误。
"""

import asyncio
import json
import os
import socket as _socket
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


def _fail(message: str) -> None:
    print(json.dumps({"type": "fatal", "message": message}), flush=True)
    sys.exit(2)


def _install_egress_guard() -> None:
    """在导入 backend 前硬拦非 127.0.0.1:55433 出站；PG 真实连接保留。"""

    def _is_allowed(address: Any) -> bool:
        if not isinstance(address, tuple) or len(address) < 2:
            return False
        host, port = address[0], address[1]
        return host == "127.0.0.1" and port == 55433

    def _blocked(address: Any) -> OSError:
        raise OSError("egress_blocked_non_local_pg")

    real_getaddrinfo = _socket.getaddrinfo

    def guarded_getaddrinfo(host: Any, port: Any, *args: Any, **kwargs: Any):
        if host != "127.0.0.1" or port != 55433:
            raise OSError("egress_blocked_non_loopback_dns")
        return real_getaddrinfo(host, port, *args, **kwargs)

    real_connect = _socket.socket.connect
    real_connect_ex = _socket.socket.connect_ex
    real_sendto = _socket.socket.sendto

    def guarded_connect(self: _socket.socket, address: Any):
        if not _is_allowed(address):
            _blocked(address)
        return real_connect(self, address)

    def guarded_connect_ex(self: _socket.socket, address: Any):
        if not _is_allowed(address):
            _blocked(address)
        return real_connect_ex(self, address)

    def guarded_sendto(self: _socket.socket, data: Any, address: Any):
        if not _is_allowed(address):
            _blocked(address)
        return real_sendto(self, data, address)

    _socket.getaddrinfo = guarded_getaddrinfo
    _socket.socket.connect = guarded_connect
    _socket.socket.connect_ex = guarded_connect_ex
    _socket.socket.sendto = guarded_sendto


def _validated_database_url() -> str:
    if os.environ.get("ECHOTALK_CALL_LEASE_LOCAL_PG") != "1":
        _fail("ECHOTALK_CALL_LEASE_LOCAL_PG=1 必须显式开启")
    url = os.environ.get("DATABASE_URL")
    if not url:
        _fail("DATABASE_URL 未注入，桥拒绝启动")
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("postgresql", "postgres", "postgresql+asyncpg"):
            _fail("DATABASE_URL scheme 必须为 postgresql/postgres/postgresql+asyncpg")
        if parsed.query or parsed.fragment:
            _fail("DATABASE_URL 不得携带 query 或 fragment")
        if not parsed.password:
            _fail("DATABASE_URL 密码不得为空")
        if parsed.hostname != "127.0.0.1" or parsed.port != 55433:
            _fail("DATABASE_URL 必须精确指向 127.0.0.1:55433")
        if parsed.username != "echotalk_b1_test":
            _fail("DATABASE_URL 用户必须是本批合成用户 echotalk_b1_test")
        if (parsed.path or "") != "/echotalk_b1_test":
            _fail("DATABASE_URL 库名必须是本批合成库 echotalk_b1_test")
    except ValueError:
        _fail("DATABASE_URL 无法解析或端口非法")
    return url


DATABASE_URL = _validated_database_url()
ASYNC_DATABASE_URL = DATABASE_URL
if ASYNC_DATABASE_URL.startswith(("postgresql://", "postgres://")):
    ASYNC_DATABASE_URL = ASYNC_DATABASE_URL.replace(
        "postgresql://", "postgresql+asyncpg://", 1
    )

_install_egress_guard()

# 显式受控 import：bridge 由 app 侧 spawn 时也必须能定位 backend，不依赖 cwd 偶然成功
_BACKEND_DIR = Path(__file__).resolve().parents[4] / "backend"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


from unittest.mock import AsyncMock  # noqa: E402

from fastapi import Header, HTTPException  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

import services.call_leases as call_leases  # noqa: E402
from auth import CurrentUser  # noqa: E402
from config import settings  # noqa: E402
from database import get_db  # noqa: E402
from dependencies import get_current_user  # noqa: E402
from main import app  # noqa: E402
from models.analysis import AnalysisJob  # noqa: E402
from models.call_lease import CallLease  # noqa: E402
from models.session import (  # noqa: E402
    Session,
    SessionContext,
    SessionMode,
    SessionStatus,
    Transcript,
)
from models.user import SubscriptionTier, User, UserProfile, UserSettings  # noqa: E402

settings.CALL_LEASE_MODE = "livekit_cloud"
settings.AUTH_MODE = "dev"
settings.DEV_AUTH_TOKEN = "cp02i-synthetic-dev-token"
settings.LIVEKIT_URL = "https://test.livekit.cloud"
settings.LIVEKIT_API_KEY = "dummy_key"
settings.LIVEKIT_API_SECRET = "dummy_secret_12345678"

_revoke_mock = AsyncMock()


def _fake_room(self: Any) -> AsyncMock:
    return AsyncMock(remove_participant=_revoke_mock)


call_leases.LiveKitAPI.room = property(_fake_room)


engine = create_async_engine(ASYNC_DATABASE_URL, pool_pre_ping=True)
session_factory = async_sessionmaker(engine, expire_on_commit=False)

_owned_user_ids: set[uuid.UUID] = set()

_hold_armed = False
_hold_event: asyncio.Event | None = None


async def _override_db():
    async with session_factory() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise


async def _override_current_user(
    authorization: str | None = Header(None),
) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    raw_token = authorization[len("Bearer ") :].strip()
    try:
        user_id = uuid.UUID(raw_token)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=401, detail="Authentication required."
        ) from None
    if user_id not in _owned_user_ids:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return CurrentUser(
        id=user_id,
        email=f"cp02i-{user_id}@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )


app.dependency_overrides[get_db] = _override_db
app.dependency_overrides[get_current_user] = _override_current_user

transport = ASGITransport(app=app, raise_app_exceptions=False)
_client = AsyncClient(transport=transport, base_url="http://testserver")


async def _ctl_ping() -> dict:
    return {"ok": True, "ready": True}


async def _ctl_create_user() -> dict:
    uid = uuid.uuid4()
    async with session_factory() as db, db.begin():
        db.add(
            User(
                id=uid,
                email=f"cp02i-{uid}@example.test",
                auth_issuer="urn:echotalk:test",
                auth_subject=str(uid),
                subscription_tier=SubscriptionTier.pro,
            )
        )
        db.add(UserSettings(user_id=uid, is_custom_mode=False))
    _owned_user_ids.add(uid)
    return {"ok": True, "user_id": str(uid)}


async def _ctl_create_session() -> dict:
    owned = list(_owned_user_ids)
    if not owned:
        return {"ok": False, "error": "no owned user"}
    uid = owned[-1]
    s_id = uuid.uuid4()
    async with session_factory() as db, db.begin():
        db.add(
            Session(
                id=s_id,
                user_id=uid,
                mode=SessionMode.free_talk,
                status=SessionStatus.active,
                started_at=datetime.now(timezone.utc),
            )
        )
    return {"ok": True, "session_id": str(s_id)}


async def _ctl_set_revoke(mode: str) -> dict:
    if mode == "fail":
        _revoke_mock.side_effect = RuntimeError("synthetic cloud revoke failure")
    else:
        _revoke_mock.side_effect = None
    _revoke_mock.return_value = None
    return {"ok": True, "mode": mode}


async def _ctl_force_expire() -> dict:
    owned = list(_owned_user_ids)
    if not owned:
        return {"ok": False, "error": "no owned user"}
    uid = owned[-1]
    async with session_factory() as db, db.begin():
        lease = (
            await db.execute(select(CallLease).where(CallLease.user_id == uid))
        ).scalar_one_or_none()
        if lease is None:
            return {"ok": False, "error": "no lease"}
        lease.expires_at = datetime.now(timezone.utc) - timedelta(seconds=10)
    return {"ok": True}


async def _ctl_read_lease() -> dict:
    owned = list(_owned_user_ids)
    if not owned:
        return {"ok": False, "error": "no owned user"}
    uid = owned[-1]
    async with session_factory() as db:
        lease = (
            await db.execute(select(CallLease).where(CallLease.user_id == uid))
        ).scalar_one_or_none()
        if lease is None:
            return {"ok": True, "lease": None}
        return {
            "ok": True,
            "lease": {
                "session_id": str(lease.session_id) if lease.session_id else None,
                "device_id": str(lease.device_id) if lease.device_id else None,
                "generation": lease.generation,
                "state": lease.state,
                "expires_at": lease.expires_at.isoformat()
                if lease.expires_at
                else None,
            },
        }


async def _ctl_hold() -> dict:
    global _hold_armed, _hold_event
    _hold_armed = True
    _hold_event = asyncio.Event()
    return {"ok": True}


async def _ctl_release() -> dict:
    global _hold_armed
    _hold_armed = False
    if _hold_event is not None:
        _hold_event.set()
    return {"ok": True}


async def _cleanup_user(uid: uuid.UUID) -> None:
    async with session_factory() as db, db.begin():
        session_ids = (
            (await db.execute(select(Session.id).where(Session.user_id == uid)))
            .scalars()
            .all()
        )
        if session_ids:
            await db.execute(
                delete(AnalysisJob).where(AnalysisJob.session_id.in_(session_ids))
            )
            await db.execute(
                delete(SessionContext).where(SessionContext.session_id.in_(session_ids))
            )
            await db.execute(
                delete(Transcript).where(Transcript.session_id.in_(session_ids))
            )
            await db.execute(
                delete(CallLease).where(CallLease.session_id.in_(session_ids))
            )
            await db.execute(delete(Session).where(Session.id.in_(session_ids)))
        await db.execute(delete(CallLease).where(CallLease.user_id == uid))
        await db.execute(delete(UserSettings).where(UserSettings.user_id == uid))
        await db.execute(delete(UserProfile).where(UserProfile.user_id == uid))
        await db.execute(delete(User).where(User.id == uid))


async def _ctl_cleanup() -> dict:
    for uid in list(_owned_user_ids):
        await _cleanup_user(uid)
        _owned_user_ids.discard(uid)
    return {"ok": True}


async def _handle_ctl(msg: dict) -> dict:
    op = msg.get("op")
    if op == "ping":
        return await _ctl_ping()
    if op == "create_user":
        return await _ctl_create_user()
    if op == "create_session":
        return await _ctl_create_session()
    if op == "set_revoke":
        return await _ctl_set_revoke(str(msg.get("mode", "ok")))
    if op == "force_expire":
        return await _ctl_force_expire()
    if op == "read_lease":
        return await _ctl_read_lease()
    if op == "hold":
        return await _ctl_hold()
    if op == "release":
        return await _ctl_release()
    if op == "cleanup":
        return await _ctl_cleanup()
    if op == "shutdown":
        return {"ok": True, "shutdown": True}
    return {"ok": False, "error": "unknown op"}


def _validated_asgi_path(path: str) -> str:
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/api/"):
        raise ValueError("bridge_rejects_non_local_api_path")
    return path


async def _handle_http(msg: dict, safe_write: Any) -> None:
    req_id = msg.get("id")
    try:
        path = _validated_asgi_path(str(msg.get("path", "")))
        method = str(msg.get("method", "GET")).upper()
        headers = {str(k): str(v) for k, v in (msg.get("headers") or {}).items()}
        body = str(msg.get("body") or "")
        resp = await _client.request(
            method, path, headers=headers, content=body.encode("utf-8")
        )
        payload = {
            "type": "http",
            "id": req_id,
            "status": resp.status_code,
            "headers": dict(resp.headers),
            "body": resp.content.decode("utf-8", "replace"),
        }
    except Exception:  # noqa: BLE001
        # 桥内部失败是独立事件，不伪造成服务端 HTTP 响应
        payload = {
            "type": "bridge_error",
            "id": req_id,
            "message": "bridge_request_failed",
        }

    if _hold_armed and _hold_event is not None and payload.get("type") == "http":
        await safe_write({"type": "held", "id": req_id})
        await _hold_event.wait()
    await safe_write(payload)


async def _main() -> None:
    loop = asyncio.get_running_loop()
    stdin_queue: asyncio.Queue[str | None] = asyncio.Queue()
    stdout_lock = asyncio.Lock()
    pending_tasks: set[asyncio.Task] = set()

    def _stdin_reader() -> None:
        try:
            for raw in sys.stdin:
                line = raw.rstrip("\n")
                if line:
                    loop.call_soon_threadsafe(stdin_queue.put_nowait, line)
        finally:
            loop.call_soon_threadsafe(stdin_queue.put_nowait, None)

    def _write_line(obj: dict) -> None:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    async def safe_write(obj: dict) -> None:
        async with stdout_lock:
            _write_line(obj)

    shutdown = False
    try:
        threading.Thread(target=_stdin_reader, daemon=True).start()
        while not shutdown:
            line = await stdin_queue.get()
            if line is None:
                shutdown = True
                break
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                await safe_write({"type": "error", "message": "invalid json"})
                continue

            mtype = msg.get("type")
            if mtype == "ctl":
                result = await _handle_ctl(msg)
                await safe_write({"type": "ctl", "id": msg.get("id"), **result})
                if result.get("shutdown"):
                    shutdown = True
            elif mtype == "http":
                task = asyncio.create_task(_handle_http(msg, safe_write))
                pending_tasks.add(task)
                task.add_done_callback(pending_tasks.discard)
            else:
                await safe_write({"type": "error", "message": "unknown message type"})
    finally:
        global _hold_armed
        _hold_armed = False
        if _hold_event is not None:
            _hold_event.set()
        snapshot = list(pending_tasks)
        for task in snapshot:
            if not task.done():
                task.cancel()
        if snapshot:
            await asyncio.gather(*snapshot, return_exceptions=True)
        cleanup_failed = False
        for uid in list(_owned_user_ids):
            try:
                await _cleanup_user(uid)
            except Exception:  # noqa: BLE001
                cleanup_failed = True
            finally:
                _owned_user_ids.discard(uid)
        try:
            await _client.aclose()
        except Exception:  # noqa: BLE001
            cleanup_failed = True
        try:
            await engine.dispose()
        except Exception:  # noqa: BLE001
            cleanup_failed = True
        if cleanup_failed:
            # 清理失败不得吞成 exit 0；仅发静态错误，不暴露 SQL/URL/原始异常
            await safe_write({"type": "fatal", "message": "bridge_cleanup_failed"})
            raise SystemExit(2)


if __name__ == "__main__":
    asyncio.run(_main())
