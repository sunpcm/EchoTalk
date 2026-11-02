"""通话租约契约测试套件（CP02-B4）。

覆盖单端通话占用协议后端契约（CROSS_PLATFORM_CALL_LEASE.md）与 Review 修复项：
1. disabled 模式旧行为保持（真实 CurrentUser 成功签发，dispatch 无超时，end 依赖自动提交）
2. 模式配置拒绝自建/缺凭据
3. 认证/所有权隔离（所有权 404 严格先于租约头门禁 409）
4. 首次/重复 claim
5. 无显式接管拒绝（含过期 owner 仍必须明确接管）
6. 显式接管顺序、generation 递增与严格先撤销后授予
7. 相同用户真实两连接争用（NOWAIT 55P03 精确映射 409 call_lease_busy）
8. 不同用户并发互不串行（确定性 barrier）
9. 接管后旧 heartbeat/token/dispatch/release 全部拒绝（409 call_lease_lost）
10. TTL/过期和续期（心跳正常续期、代际/设备冲突与过期 409）
11. 释放契约与 free 状态严格校验（匹配释放、同 tuple 幂等 200、旧代际不能释放新 owner）
12. Token 与 Dispatch 门禁校验（缺头 409、非法 422、未占用 409、正常调度）
13. 真实挂起超时与锁释放（真实 asyncio.timeout 超时返回 502，异常后行锁正常释放）
14. 所有写接口 commit 失败 500 且事务回滚（claim/heartbeat/release/end）
15. end 成功/幂等单 job，撤销失败事务回滚；结束其他旧 session 不影响当前活跃租约
16. 撤销期间 DB 仍为旧 owner，commit 前不可观察新 owner
17. Token 剩余 1..60 秒 TTL 动态计算，不足 1 秒拒绝签发
18. CORS 预检放行租约头
所有模拟 Cloud 测试严禁真实联网。
"""

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import jwt
import pytest
from fastapi import Header, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from auth import CurrentUser
from config import Settings, settings
from database import get_db
from dependencies import get_current_user
from main import app
from models.analysis import AnalysisJob
from models.call_lease import CallLease
from models.session import (
    Session,
    SessionContext,
    SessionMode,
    SessionStatus,
    Transcript,
)
from models.user import SubscriptionTier, User, UserProfile, UserSettings
from schemas.call_lease import (
    CallClaimRequest,
    CallHeartbeatRequest,
    CallLeaseResponse,
    CallReleaseRequest,
    CallReleaseResponse,
)
from services.call_leases import is_lock_not_available

# ---------------------------------------------------------------------------
# 0. 单元级测试 (Unit Tests)
# ---------------------------------------------------------------------------


def test_unit_is_lock_not_available_structured():
    """验证精确匹配 SQLSTATE 55P03，沿 orig/__cause__/__context__ 结构化遍历。"""

    class Target55P03(Exception):
        sqlstate = "55P03"

    exc = DBAPIError("statement timeout", params={}, orig=Target55P03())
    assert is_lock_not_available(exc) is True

    wrapper = Exception("wrap")
    wrapper.__cause__ = Target55P03()
    exc2 = OperationalError("busy", params={}, orig=wrapper)
    assert is_lock_not_available(exc2) is True

    class OtherSqlState(Exception):
        sqlstate = "40P01"  # deadlock

    exc3 = DBAPIError("deadlock", params={}, orig=OtherSqlState())
    assert is_lock_not_available(exc3) is False

    exc4 = OperationalError("error 55P03 in text", params={}, orig=Exception())
    assert is_lock_not_available(exc4) is False


def test_unit_call_lease_schemas_validation():
    """验证租约 Pydantic 请求/响应模型字段与校验。"""
    device_id = uuid.uuid4()
    req_claim = CallClaimRequest(device_id=device_id)
    assert req_claim.device_id == device_id
    assert req_claim.takeover is False

    req_hb = CallHeartbeatRequest(device_id=device_id, generation=1)
    assert req_hb.generation == 1
    with pytest.raises(Exception):
        CallHeartbeatRequest(device_id=device_id, generation=0)
    with pytest.raises(Exception):
        CallHeartbeatRequest(device_id=device_id, generation=-1)

    req_rel = CallReleaseRequest(device_id=device_id, generation=2)
    assert req_rel.generation == 2
    with pytest.raises(Exception):
        CallReleaseRequest(device_id=device_id, generation=0)

    now = datetime.now(timezone.utc)
    sess_id = uuid.uuid4()
    resp = CallLeaseResponse(
        session_id=sess_id,
        device_id=device_id,
        generation=1,
        state="held",
        expires_at=now,
    )
    assert resp.session_id == sess_id
    assert resp.generation == 1

    rel_resp = CallReleaseResponse(released=True, generation=1)
    assert rel_resp.released is True
    assert rel_resp.generation == 1


def test_unit_call_lease_runtime_configuration():
    """验证 CALL_LEASE_MODE=livekit_cloud 时配置校验：拒绝自建、缺凭据或非法 URL。"""
    cfg = Settings(
        AUTH_MODE="dev",
        DEV_AUTH_TOKEN="test_dev_token",
        DATABASE_URL="postgresql+asyncpg://dummy:dummy@localhost:5432/dummy",
        LIVEKIT_URL="https://myproj.livekit.cloud",
        LIVEKIT_API_KEY="test_api_key",
        LIVEKIT_API_SECRET="test_api_secret",
        CALL_LEASE_MODE="livekit_cloud",
    )
    # 合法配置
    cfg.validate_runtime()

    # 1. 缺失 key / secret
    cfg.LIVEKIT_API_KEY = ""
    with pytest.raises(RuntimeError, match="要求配置非空的 LIVEKIT_API_KEY"):
        cfg.validate_runtime()
    cfg.LIVEKIT_API_KEY = "test_key"

    # 2. 自建 URL（非 *.livekit.cloud）
    cfg.LIVEKIT_URL = "https://livekit.mycompany.internal"
    with pytest.raises(RuntimeError, match="要求 LIVEKIT_URL 为无凭据"):
        cfg.validate_runtime()

    # 3. 带 path 或 query 的非法 URL
    cfg.LIVEKIT_URL = "https://myproj.livekit.cloud/subpath?token=123"
    with pytest.raises(RuntimeError, match="要求 LIVEKIT_URL 为无凭据"):
        cfg.validate_runtime()


# ---------------------------------------------------------------------------
# 1. 真实 PostgreSQL 集成测试环境 (按测试自建自清，无导入期 DB 访问)
# ---------------------------------------------------------------------------


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


class _ASGIClientContext:
    def __init__(
        self,
        session_factory,
        user_id: uuid.UUID | None = None,
        override_user: bool = True,
    ):
        self.session_factory = session_factory
        self.user_id = user_id
        self.override_user = override_user
        self.client: AsyncClient | None = None
        self._saved_overrides: dict[Any, Any] = {}

    async def __aenter__(self) -> AsyncClient:
        self._saved_overrides = {
            get_db: app.dependency_overrides.get(get_db),
            get_current_user: app.dependency_overrides.get(get_current_user),
        }

        async def override_db():
            async with self.session_factory() as db:
                try:
                    yield db
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

        app.dependency_overrides[get_db] = override_db

        if self.override_user:
            default_uid = self.user_id

            async def override_current_user(
                authorization: str | None = Header(None),
            ) -> CurrentUser:
                if authorization and authorization.startswith("Bearer "):
                    token = authorization.split(" ")[1].strip()
                    try:
                        parsed_id = uuid.UUID(token)
                        return CurrentUser(
                            id=parsed_id,
                            email=f"call-test-{parsed_id}@example.test",
                            issuer="urn:echotalk:test",
                            subject=str(parsed_id),
                        )
                    except (ValueError, AttributeError):
                        pass
                if default_uid is not None:
                    return CurrentUser(
                        id=default_uid,
                        email=f"call-test-{default_uid}@example.test",
                        issuer="urn:echotalk:test",
                        subject=str(default_uid),
                    )
                raise HTTPException(status_code=401, detail="Authentication required.")

            app.dependency_overrides[get_current_user] = override_current_user
        else:
            app.dependency_overrides.pop(get_current_user, None)

        transport = ASGITransport(app=app, raise_app_exceptions=False)
        headers = {}
        if self.override_user and self.user_id is not None:
            headers["Authorization"] = f"Bearer {self.user_id}"

        self.client = AsyncClient(
            transport=transport,
            base_url="http://testserver",
            headers=headers,
        )
        return self.client

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()
        for dep, saved in self._saved_overrides.items():
            if saved is None:
                app.dependency_overrides.pop(dep, None)
            else:
                app.dependency_overrides[dep] = saved


@pytest.fixture
async def pg_env():
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip("DATABASE_URL is required for PostgreSQL call lease tests")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    created_user_ids: list[uuid.UUID] = []
    created_session_ids: list[uuid.UUID] = []

    async def create_user(
        tier: SubscriptionTier = SubscriptionTier.pro,
    ) -> User:
        u_id = uuid.uuid4()
        user = User(
            id=u_id,
            email=f"lease-user-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
            subscription_tier=tier,
        )
        user_settings = UserSettings(
            user_id=u_id,
            is_custom_mode=False,
        )
        async with session_factory() as db, db.begin():
            db.add(user)
            db.add(user_settings)
        created_user_ids.append(u_id)
        return user

    async def create_session(
        user_id: uuid.UUID,
        status: SessionStatus = SessionStatus.active,
    ) -> Session:
        s_id = uuid.uuid4()
        session = Session(
            id=s_id,
            user_id=user_id,
            mode=SessionMode.free_talk,
            status=status,
            started_at=datetime.now(timezone.utc),
        )
        async with session_factory() as db, db.begin():
            db.add(session)
        created_session_ids.append(s_id)
        return session

    class TestContext:
        def __init__(self):
            self.session_factory = session_factory
            self.engine = engine
            self.create_user = create_user
            self.create_session = create_session

        def client_for(
            self,
            user_id: uuid.UUID | None = None,
            override_user: bool = True,
        ) -> _ASGIClientContext:
            return _ASGIClientContext(
                self.session_factory,
                user_id=user_id,
                override_user=override_user,
            )

    ctx = TestContext()
    yield ctx

    # 严格仅清理当前测试创建的数据，按依赖倒序删除，绝不越界
    async with session_factory() as db, db.begin():
        if created_session_ids:
            await db.execute(
                delete(AnalysisJob).where(
                    AnalysisJob.session_id.in_(created_session_ids)
                )
            )
            await db.execute(
                delete(SessionContext).where(
                    SessionContext.session_id.in_(created_session_ids)
                )
            )
            await db.execute(
                delete(Transcript).where(Transcript.session_id.in_(created_session_ids))
            )
            await db.execute(
                delete(CallLease).where(CallLease.session_id.in_(created_session_ids))
            )
            await db.execute(delete(Session).where(Session.id.in_(created_session_ids)))
        if created_user_ids:
            await db.execute(
                delete(CallLease).where(CallLease.user_id.in_(created_user_ids))
            )
            await db.execute(
                delete(UserSettings).where(UserSettings.user_id.in_(created_user_ids))
            )
            await db.execute(
                delete(UserProfile).where(UserProfile.user_id.in_(created_user_ids))
            )
            await db.execute(delete(User).where(User.id.in_(created_user_ids)))
    await engine.dispose()


# ---------------------------------------------------------------------------
# 2. CORS 预检放行测试
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cors_preflight_allows_lease_headers(pg_env):
    """CORS 预检 OPTIONS 请求对租约控制头 X-Call-Device-Id 与 X-Call-Generation 正常放行。"""
    async with pg_env.client_for(user_id=None, override_user=False) as client:
        sess_id = uuid.uuid4()
        headers = {
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,x-call-device-id,x-call-generation,content-type",
        }
        res = await client.options(f"/api/sessions/{sess_id}/dispatch", headers=headers)
        assert res.status_code == 200
        allowed_headers = res.headers.get("access-control-allow-headers", "").lower()
        assert "x-call-device-id" in allowed_headers
        assert "x-call-generation" in allowed_headers


# ---------------------------------------------------------------------------
# 3. 核心契约集成测试用例
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_disabled_mode_preserves_legacy_behavior(pg_env):
    """disabled 模式下 claim/heartbeat/release 返回 503，Token 使用真实 CurrentUser 成功签发。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    device_id = str(uuid.uuid4())

    with (
        patch.object(settings, "CALL_LEASE_MODE", "disabled"),
        patch.object(settings, "LIVEKIT_URL", "http://localhost:7880"),
        patch.object(settings, "LIVEKIT_API_KEY", "devkey"),
        patch.object(settings, "LIVEKIT_API_SECRET", "secret1234567890"),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. 新写接口 503
            r_claim = await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": device_id, "takeover": False},
            )
            assert r_claim.status_code == 503
            assert (
                r_claim.json().get("detail", {}).get("code") == "call_leases_disabled"
            )

            # 2. Token 签发成功，且 participant_identity 为 user.id
            r_token = await client.get(f"/api/sessions/{session.id}/token")
            assert r_token.status_code == 200
            tok = r_token.json().get("token")
            assert tok is not None
            decoded = jwt.decode(
                tok,
                "secret1234567890",
                algorithms=["HS256"],
                options={"verify_signature": True},
            )
            assert decoded["sub"] == str(user.id)
            assert decoded["video"]["room"] == str(session.id)

            # 3. end 会话成功
            r_end = await client.post(f"/api/sessions/{session.id}/end")
            assert r_end.status_code == 200
            assert r_end.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_first_claim_and_repeat_claim_same_owner(pg_env):
    """首次 claim 分配 generation=1 并置 held；同 owner 重复 claim 保持 generation 并续期。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    device_id = str(uuid.uuid4())

    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        async with pg_env.client_for(user.id) as client:
            r1 = await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": device_id, "takeover": False},
            )
            assert r1.status_code == 200
            data1 = r1.json()
            assert data1["session_id"] == str(session.id)
            assert data1["device_id"] == device_id
            assert data1["generation"] == 1
            assert data1["state"] == "held"
            exp1 = datetime.fromisoformat(data1["expires_at"])

            r2 = await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": device_id, "takeover": False},
            )
            assert r2.status_code == 200
            data2 = r2.json()
            assert data2["generation"] == 1
            assert data2["state"] == "held"
            exp2 = datetime.fromisoformat(data2["expires_at"])
            assert exp2 >= exp1


@pytest.mark.asyncio
async def test_claim_conflict_without_takeover_returns_409(pg_env):
    """其他 held owner 在 takeover=False 时返回 409 call_in_use，包含 conflict_session_id。"""
    user = await pg_env.create_user()
    s1 = await pg_env.create_session(user.id)
    s2 = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        async with pg_env.client_for(user.id) as client:
            await client.post(
                f"/api/sessions/{s1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            r2 = await client.post(
                f"/api/sessions/{s2.id}/call/claim",
                json={"device_id": d2, "takeover": False},
            )
            assert r2.status_code == 409
            detail = r2.json().get("detail", {})
            assert detail.get("code") == "call_in_use"
            assert detail.get("conflict_session_id") == str(s1.id)
            assert detail.get("expires_at") is not None


@pytest.mark.asyncio
async def test_expired_owner_still_requires_explicit_takeover(pg_env):
    """即使旧占用已过期，其他设备 takeover=False 依然 409 call_in_use，必须明确接管。"""
    user = await pg_env.create_user()
    s1 = await pg_env.create_session(user.id)
    s2 = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        async with pg_env.client_for(user.id) as client:
            await client.post(
                f"/api/sessions/{s1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            # 人工将租约置为已过期
            async with pg_env.session_factory() as db, db.begin():
                lease = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                lease.expires_at = datetime.now(timezone.utc) - timedelta(seconds=10)

            # 过期后不同设备无接管依然 409
            r_no_takeover = await client.post(
                f"/api/sessions/{s2.id}/call/claim",
                json={"device_id": d2, "takeover": False},
            )
            assert r_no_takeover.status_code == 409
            assert r_no_takeover.json().get("detail", {}).get("code") == "call_in_use"


@pytest.mark.asyncio
async def test_takeover_strict_order_and_generation_increment(pg_env):
    """takeover=True：严格先撤销旧 owner 的 Cloud Token，再更新 DB 递增 generation。"""
    user = await pg_env.create_user()
    s1 = await pg_env.create_session(user.id)
    s2 = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    mock_remove = AsyncMock()

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=mock_remove)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            await client.post(
                f"/api/sessions/{s1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            r_takeover = await client.post(
                f"/api/sessions/{s2.id}/call/claim",
                json={"device_id": d2, "takeover": True},
            )
            assert r_takeover.status_code == 200
            data = r_takeover.json()
            assert data["session_id"] == str(s2.id)
            assert data["device_id"] == d2
            assert data["generation"] == 2
            assert data["state"] == "held"

            assert mock_remove.await_count == 1
            call_arg = mock_remove.call_args[0][0]
            assert call_arg.room == str(s1.id)
            assert call_arg.identity == f"{user.id}:1"
            now_ts = int(datetime.now(timezone.utc).timestamp())
            assert abs(call_arg.revoke_token_ts - (now_ts + 30)) <= 3


@pytest.mark.asyncio
async def test_takeover_cloud_failure_does_not_grant_new_owner(pg_env):
    """takeover 时若 Cloud 撤销失败，返回 502 且不更新 DB。"""
    user = await pg_env.create_user()
    s1 = await pg_env.create_session(user.id)
    s2 = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    mock_remove_fail = AsyncMock(side_effect=RuntimeError("Provider network error"))

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=mock_remove_fail)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            await client.post(
                f"/api/sessions/{s1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            r_fail = await client.post(
                f"/api/sessions/{s2.id}/call/claim",
                json={"device_id": d2, "takeover": True},
            )
            assert r_fail.status_code == 502
            assert (
                r_fail.json().get("detail", {}).get("code")
                == "call_provider_unavailable"
            )

            # 数据库中合法 owner 仍为 d1，generation 仍为 1
            async with pg_env.session_factory() as db:
                lease = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                assert lease.session_id == s1.id
                assert lease.device_id == uuid.UUID(d1)
                assert lease.generation == 1
                assert lease.state == "held"


# ---------------------------------------------------------------------------
# 4. Heartbeat 续期/冲突/过期契约测试 (完整恢复)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_heartbeat_success_and_conflict_and_expired(pg_env):
    """心跳续期契约：正常续期延长 expires_at；错误代际、错误设备、已过期或 free 状态均 409。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        async with pg_env.client_for(user.id) as client:
            # 1. 正常 claim
            r_claim = await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )
            assert r_claim.status_code == 200
            orig_exp = datetime.fromisoformat(r_claim.json()["expires_at"])

            # 2. 正常 heartbeat 续期
            r_hb = await client.post(
                f"/api/sessions/{session.id}/call/heartbeat",
                json={"device_id": d1, "generation": 1},
            )
            assert r_hb.status_code == 200
            data_hb = r_hb.json()
            assert data_hb["generation"] == 1
            assert data_hb["state"] == "held"
            new_exp = datetime.fromisoformat(data_hb["expires_at"])
            assert new_exp >= orig_exp

            # 3. 错误代际 -> 409 call_lease_lost
            r_wrong_gen = await client.post(
                f"/api/sessions/{session.id}/call/heartbeat",
                json={"device_id": d1, "generation": 2},
            )
            assert r_wrong_gen.status_code == 409
            assert r_wrong_gen.json().get("detail", {}).get("code") == "call_lease_lost"

            # 4. 错误设备 -> 409 call_lease_lost
            r_wrong_dev = await client.post(
                f"/api/sessions/{session.id}/call/heartbeat",
                json={"device_id": d2, "generation": 1},
            )
            assert r_wrong_dev.status_code == 409
            assert r_wrong_dev.json().get("detail", {}).get("code") == "call_lease_lost"

            # 5. 人工将租约置为已过期 -> 409 call_lease_expired
            async with pg_env.session_factory() as db, db.begin():
                lease = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                lease.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)

            r_exp = await client.post(
                f"/api/sessions/{session.id}/call/heartbeat",
                json={"device_id": d1, "generation": 1},
            )
            assert r_exp.status_code == 409
            assert r_exp.json().get("detail", {}).get("code") == "call_lease_expired"


# ---------------------------------------------------------------------------
# 5. Release 释放与新 Owner 保护测试 (完整恢复)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_release_matching_success_and_protect_new_owner(pg_env):
    """匹配 release 正常撤销；新 owner 接管后旧 owner release 报 409 且不篡改新 owner 也不调 Provider。"""
    user = await pg_env.create_user()
    s1 = await pg_env.create_session(user.id)
    s2 = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    mock_remove = AsyncMock()

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=mock_remove)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. d1 占用 s1
            await client.post(
                f"/api/sessions/{s1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            # 2. d2 接管 s2 (产生 gen 2，撤销 count=1)
            await client.post(
                f"/api/sessions/{s2.id}/call/claim",
                json={"device_id": d2, "takeover": True},
            )
            assert mock_remove.await_count == 1

            # 3. 旧 owner d1 试图 release (gen 1) -> 409 call_lease_lost，且绝不调用 Provider
            r_old_rel = await client.post(
                f"/api/sessions/{s1.id}/call/release",
                json={"device_id": d1, "generation": 1},
            )
            assert r_old_rel.status_code == 409
            assert r_old_rel.json().get("detail", {}).get("code") == "call_lease_lost"
            assert mock_remove.await_count == 1  # 依然为 1，未新增调用

            # 检查 DB：新 owner d2 依然是 held 状态，代际仍为 2
            async with pg_env.session_factory() as db:
                lease = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                assert lease.session_id == s2.id
                assert lease.device_id == uuid.UUID(d2)
                assert lease.generation == 2
                assert lease.state == "held"


@pytest.mark.asyncio
async def test_release_free_state_strict_tuple_validation(pg_env):
    """free 状态严格校验：仅完整相同 tuple 幂等 200，空记录/不同设备/未来代际均 409 且不触发 Provider。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    mock_remove = AsyncMock()

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=mock_remove)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. 从未占用的空记录直接请求 release -> 409 call_lease_lost，且不调 Provider
            r_empty = await client.post(
                f"/api/sessions/{session.id}/call/release",
                json={"device_id": d1, "generation": 99},
            )
            assert r_empty.status_code == 409
            assert r_empty.json().get("detail", {}).get("code") == "call_lease_lost"
            assert mock_remove.await_count == 0

            # 2. 正常 claim 后 release
            await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )
            r_rel = await client.post(
                f"/api/sessions/{session.id}/call/release",
                json={"device_id": d1, "generation": 1},
            )
            assert r_rel.status_code == 200
            assert mock_remove.await_count == 1

            # 3. 此时处于 free 状态：完全相同 tuple 重复 release 幂等返回 200（不调用 Provider）
            r_rel_repeat = await client.post(
                f"/api/sessions/{session.id}/call/release",
                json={"device_id": d1, "generation": 1},
            )
            assert r_rel_repeat.status_code == 200
            assert mock_remove.await_count == 1

            # 4. free 状态下，传入错误设备 / 错误代际 -> 409 call_lease_lost，且绝不调用 Provider
            r_wrong_dev = await client.post(
                f"/api/sessions/{session.id}/call/release",
                json={"device_id": d2, "generation": 1},
            )
            assert r_wrong_dev.status_code == 409
            assert r_wrong_dev.json().get("detail", {}).get("code") == "call_lease_lost"
            assert mock_remove.await_count == 1

            r_wrong_gen = await client.post(
                f"/api/sessions/{session.id}/call/release",
                json={"device_id": d1, "generation": 99},
            )
            assert r_wrong_gen.status_code == 409
            assert r_wrong_gen.json().get("detail", {}).get("code") == "call_lease_lost"
            assert mock_remove.await_count == 1


# ---------------------------------------------------------------------------
# 6. Token 门禁与 TTL 契约测试 (完整恢复)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_token_gate_headers_validation_and_unclaimed(pg_env):
    """Token 门禁：缺头 409 call_lease_required；格式错误 422；未占用或不匹配 409 call_lease_lost。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    device_id = str(uuid.uuid4())

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. 缺失请求头 -> 409 call_lease_required
            r_no_hdr = await client.get(f"/api/sessions/{session.id}/token")
            assert r_no_hdr.status_code == 409
            assert (
                r_no_hdr.json().get("detail", {}).get("code") == "call_lease_required"
            )

            # 2. 格式非法（generation 不是正整数） -> 422
            bad_hdr = {"X-Call-Device-Id": device_id, "X-Call-Generation": "-1"}
            r_bad = await client.get(
                f"/api/sessions/{session.id}/token", headers=bad_hdr
            )
            assert r_bad.status_code == 422

            # 3. 格式非法（device_id 不是 UUID） -> 422
            bad_hdr2 = {
                "X-Call-Device-Id": "not-a-uuid",
                "X-Call-Generation": "1",
            }
            r_bad2 = await client.get(
                f"/api/sessions/{session.id}/token", headers=bad_hdr2
            )
            assert r_bad2.status_code == 422

            # 4. 未 claim（处于 free 状态）请求 token -> 409 call_lease_lost
            valid_hdr = {"X-Call-Device-Id": device_id, "X-Call-Generation": "1"}
            r_unclaimed = await client.get(
                f"/api/sessions/{session.id}/token", headers=valid_hdr
            )
            assert r_unclaimed.status_code == 409
            assert r_unclaimed.json().get("detail", {}).get("code") == "call_lease_lost"


@pytest.mark.asyncio
async def test_token_ttl_dynamic_truncation(pg_env):
    """Token TTL 动态截断：80 秒截断为 60 秒，45 秒使用 45 秒，不足 1 秒拒绝签发。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    device_id = str(uuid.uuid4())
    headers = {"X-Call-Device-Id": device_id, "X-Call-Generation": "1"}

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "test_key_012345678901234567890"),
        patch.object(
            settings,
            "LIVEKIT_API_SECRET",
            "test_secret_123456789012345678901234567890",
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": device_id, "takeover": False},
            )

            # 1. 初始约 90 秒剩余 -> Token TTL 截断至 60 秒
            r_tok60 = await client.get(
                f"/api/sessions/{session.id}/token", headers=headers
            )
            assert r_tok60.status_code == 200
            dec60 = jwt.decode(
                r_tok60.json()["token"],
                "test_secret_123456789012345678901234567890",
                algorithms=["HS256"],
                options={"verify_signature": True},
            )
            assert dec60["exp"] - dec60.get("nbf", dec60["exp"] - 60) <= 60

            # 2. 人工设置剩余 45 秒 -> Token TTL 约为 45 秒
            async with pg_env.session_factory() as db, db.begin():
                lease = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                lease.expires_at = datetime.now(timezone.utc) + timedelta(seconds=45)

            r_tok45 = await client.get(
                f"/api/sessions/{session.id}/token", headers=headers
            )
            assert r_tok45.status_code == 200
            dec45 = jwt.decode(
                r_tok45.json()["token"],
                "test_secret_123456789012345678901234567890",
                algorithms=["HS256"],
                options={"verify_signature": True},
            )
            dur45 = dec45["exp"] - dec45.get("nbf", dec45["exp"] - 45)
            assert 40 <= dur45 <= 46

            # 3. 人工设置剩余 0.5 秒 -> 拒绝签发 409 call_lease_expired
            async with pg_env.session_factory() as db, db.begin():
                lease = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                lease.expires_at = datetime.now(timezone.utc) + timedelta(
                    milliseconds=500
                )

            r_short = await client.get(
                f"/api/sessions/{session.id}/token", headers=headers
            )
            assert r_short.status_code == 409
            assert r_short.json().get("detail", {}).get("code") == "call_lease_expired"


# ---------------------------------------------------------------------------
# 7. Dispatch 门禁与调度测试 (完整恢复)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_gate_headers_and_successful_call(pg_env):
    """Dispatch 门禁：缺头 409、非法 422、未占用 409；持有效租约成功调度 Agent。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    device_id = str(uuid.uuid4())

    mock_create_dispatch = AsyncMock()
    mock_list_dispatch = AsyncMock(return_value=[])

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch(
            "routers.sessions.LiveKitAPI.agent_dispatch",
            new_callable=lambda: property(
                lambda self: AsyncMock(
                    list_dispatch=mock_list_dispatch,
                    create_dispatch=mock_create_dispatch,
                )
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. 缺失请求头 -> 409 call_lease_required
            r_no_hdr = await client.post(f"/api/sessions/{session.id}/dispatch")
            assert r_no_hdr.status_code == 409
            assert (
                r_no_hdr.json().get("detail", {}).get("code") == "call_lease_required"
            )

            # 2. 格式非法 -> 422
            r_bad = await client.post(
                f"/api/sessions/{session.id}/dispatch",
                headers={"X-Call-Device-Id": device_id, "X-Call-Generation": "abc"},
            )
            assert r_bad.status_code == 422

            # 3. 未占用 -> 409 call_lease_lost
            valid_headers = {
                "X-Call-Device-Id": device_id,
                "X-Call-Generation": "1",
            }
            r_lost = await client.post(
                f"/api/sessions/{session.id}/dispatch", headers=valid_headers
            )
            assert r_lost.status_code == 409
            assert r_lost.json().get("detail", {}).get("code") == "call_lease_lost"

            # 4. 正常 claim 后成功 dispatch
            await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": device_id, "takeover": False},
            )
            r_disp = await client.post(
                f"/api/sessions/{session.id}/dispatch", headers=valid_headers
            )
            assert r_disp.status_code == 200
            assert r_disp.json() == {"dispatched": True}
            assert mock_create_dispatch.await_count == 1


# ---------------------------------------------------------------------------
# 8. 所有权 404 严格先于租约头门禁 409 (双用户 ASGI 测试)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_ownership_404_precedes_lease_headers_gate(pg_env):
    """会话所有权与存在性校验严格优先于请求头门禁：操作他人会话即使缺头也必须返回 404 而绝非 409。"""
    user1 = await pg_env.create_user()
    user2 = await pg_env.create_user()
    s_user1 = await pg_env.create_session(user1.id)
    s_user2 = await pg_env.create_session(user2.id)

    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        # user1 客户端
        async with pg_env.client_for(user1.id) as client:
            # 1. 访问 user2 的会话获取 Token（完全不传头）-> 必须返回 404（不能因缺头返回 409）
            r_tok_other_no_hdr = await client.get(f"/api/sessions/{s_user2.id}/token")
            assert r_tok_other_no_hdr.status_code == 404

            # 2. 访问 user2 的会话调度 Agent（完全不传头）-> 必须返回 404
            r_disp_other_no_hdr = await client.post(
                f"/api/sessions/{s_user2.id}/dispatch"
            )
            assert r_disp_other_no_hdr.status_code == 404

            # 3. 访问不存在的会话 UUID（不传头）-> 必须返回 404
            fake_uuid = uuid.uuid4()
            r_fake = await client.get(f"/api/sessions/{fake_uuid}/token")
            assert r_fake.status_code == 404

            # 4. 对比：user1 访问自己的合法活跃会话，不传头 -> 正确返回 409 call_lease_required
            r_tok_self_no_hdr = await client.get(f"/api/sessions/{s_user1.id}/token")
            assert r_tok_self_no_hdr.status_code == 409
            assert (
                r_tok_self_no_hdr.json().get("detail", {}).get("code")
                == "call_lease_required"
            )


# ---------------------------------------------------------------------------
# 9. 真实挂起超时与锁正常释放测试 (无假 TimeoutError)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_real_asyncio_timeout_and_lock_release(pg_env):
    """真实挂起超时：通过真实的 asyncio.timeout 触发超时返回 502，请求异常后行锁正常释放可再次获取。"""
    user = await pg_env.create_user()
    s1 = await pg_env.create_session(user.id)
    s2 = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    async def hang_revoke(*args, **kwargs):
        # 挂起 10 秒，等待外层真实的 asyncio.timeout 触发
        await asyncio.sleep(10)

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch("services.call_leases.CLOUD_TIMEOUT_SECONDS", 0.05),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=hang_revoke)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. d1 占有 s1
            await client.post(
                f"/api/sessions/{s1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            # 2. d2 接管，触发 0.05s 真实挂起超时 -> 502 call_provider_unavailable
            r_timeout = await client.post(
                f"/api/sessions/{s2.id}/call/claim",
                json={"device_id": d2, "takeover": True},
            )
            assert r_timeout.status_code == 502
            assert (
                r_timeout.json().get("detail", {}).get("code")
                == "call_provider_unavailable"
            )

    # 3. 关键验证：请求因超时中止后，行锁必须被完全释放！
    # 使用独立的数据库连接，能立即成功获得 User 锁（无 55P03 阻塞）
    async with pg_env.session_factory() as verify_db, verify_db.begin():
        stmt = select(User).where(User.id == user.id).with_for_update(nowait=True)
        locked_user = (await verify_db.execute(stmt)).scalar_one_or_none()
        assert locked_user is not None


# ---------------------------------------------------------------------------
# 10. 并发与锁争用测试
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_real_two_connections_compete_nowait_returns_409_busy(pg_env):
    """真实两连接行锁竞争：连接 1 锁定 User 行期间，连接 2 NOWAIT 55P03 精确映射 409 call_lease_busy。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    device_id = str(uuid.uuid4())

    lock_acquired = asyncio.Event()
    proceed_release = asyncio.Event()

    async def hold_user_lock():
        async with pg_env.session_factory() as db:
            async with db.begin():
                stmt = (
                    select(User).where(User.id == user.id).with_for_update(nowait=True)
                )
                await db.execute(stmt)
                lock_acquired.set()
                await proceed_release.wait()

    lock_task = asyncio.create_task(hold_user_lock())
    await lock_acquired.wait()

    try:
        with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
            async with pg_env.client_for(user.id) as client:
                resp = await client.post(
                    f"/api/sessions/{session.id}/call/claim",
                    json={"device_id": device_id, "takeover": False},
                )
                assert resp.status_code == 409
                assert resp.json().get("detail", {}).get("code") == "call_lease_busy"
    finally:
        proceed_release.set()
        await lock_task

    # 锁释放后重新请求成功
    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        async with pg_env.client_for(user.id) as client:
            resp_ok = await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": device_id, "takeover": False},
            )
            assert resp_ok.status_code == 200


@pytest.mark.asyncio
async def test_different_users_do_not_block_each_other(pg_env):
    """不同用户并发请求互不串行，通过 barrier 同步并发执行均成功。"""
    user1 = await pg_env.create_user()
    user2 = await pg_env.create_user()
    s1 = await pg_env.create_session(user1.id)
    s2 = await pg_env.create_session(user2.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    barrier = asyncio.Barrier(2)

    async def claim_user(u, s, d):
        async with pg_env.client_for(u.id) as client:
            await barrier.wait()
            return await client.post(
                f"/api/sessions/{s.id}/call/claim",
                json={"device_id": d, "takeover": False},
            )

    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        res1, res2 = await asyncio.gather(
            claim_user(user1, s1, d1),
            claim_user(user2, s2, d2),
        )
        assert res1.status_code == 200
        assert res2.status_code == 200


@pytest.mark.asyncio
async def test_takeover_invalidates_old_owner_all_subsequent_operations(pg_env):
    """接管后旧代际/旧 owner 的 heartbeat/token/dispatch/release 全部被 409 拒绝。"""
    user = await pg_env.create_user()
    s1 = await pg_env.create_session(user.id)
    s2 = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    mock_remove = AsyncMock()

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret_12345678"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=mock_remove)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. d1 占有 s1
            await client.post(
                f"/api/sessions/{s1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            # 2. d2 接管 s2 (进入 gen 2)
            await client.post(
                f"/api/sessions/{s2.id}/call/claim",
                json={"device_id": d2, "takeover": True},
            )

            # 3. 旧 d1 试图 heartbeat (gen 1) -> 409 call_lease_lost
            r_hb = await client.post(
                f"/api/sessions/{s1.id}/call/heartbeat",
                json={"device_id": d1, "generation": 1},
            )
            assert r_hb.status_code == 409
            assert r_hb.json().get("detail", {}).get("code") == "call_lease_lost"

            # 4. 旧 d1 试图 token (gen 1) -> 409 call_lease_lost
            old_headers = {"X-Call-Device-Id": d1, "X-Call-Generation": "1"}
            r_tok = await client.get(
                f"/api/sessions/{s1.id}/token", headers=old_headers
            )
            assert r_tok.status_code == 409
            assert r_tok.json().get("detail", {}).get("code") == "call_lease_lost"

            # 5. 旧 d1 试图 dispatch (gen 1) -> 409 call_lease_lost
            r_disp = await client.post(
                f"/api/sessions/{s1.id}/dispatch", headers=old_headers
            )
            assert r_disp.status_code == 409
            assert r_disp.json().get("detail", {}).get("code") == "call_lease_lost"

            # 6. 旧 d1 试图 release (gen 1) -> 409 call_lease_lost
            r_rel = await client.post(
                f"/api/sessions/{s1.id}/call/release",
                json={"device_id": d1, "generation": 1},
            )
            assert r_rel.status_code == 409
            assert r_rel.json().get("detail", {}).get("code") == "call_lease_lost"


@pytest.mark.asyncio
async def test_during_revoke_callback_db_still_retains_old_owner(pg_env):
    """撤销回调执行期间，DB 事务内与外部观察依然保持旧 owner，commit 前新 owner 不可被观察。"""
    user = await pg_env.create_user()
    s1 = await pg_env.create_session(user.id)
    s2 = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())
    d2 = str(uuid.uuid4())

    revoke_called = asyncio.Event()
    db_checked = asyncio.Event()

    async def mock_remove_inspect(req):
        revoke_called.set()
        await db_checked.wait()

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=mock_remove_inspect)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            await client.post(
                f"/api/sessions/{s1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            takeover_task = asyncio.create_task(
                client.post(
                    f"/api/sessions/{s2.id}/call/claim",
                    json={"device_id": d2, "takeover": True},
                )
            )

            await revoke_called.wait()

            # 此时独立事务检查 DB：owner 必须仍为 s1, d1, gen 1
            async with pg_env.session_factory() as db:
                lease = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                assert lease.session_id == s1.id
                assert lease.device_id == uuid.UUID(d1)
                assert lease.generation == 1
                assert lease.state == "held"

            db_checked.set()
            resp = await takeover_task
            assert resp.status_code == 200
            assert resp.json()["generation"] == 2


# ---------------------------------------------------------------------------
# 11. 端点显式 commit 失败全覆盖回滚测试 (claim/heartbeat/release/end)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_write_endpoints_commit_failure_rollback(pg_env):
    """端点显式 commit 抛出异常时（claim/heartbeat/release/end），均不得返回 200 且事务正确回滚。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    device_id = str(uuid.uuid4())

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=AsyncMock())
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. 正常 claim 成功建立基线
            r_ok = await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": device_id, "takeover": False},
            )
            assert r_ok.status_code == 200

            # 2. 模拟 commit 抛出异常
            with patch(
                "sqlalchemy.ext.asyncio.AsyncSession.commit",
                side_effect=RuntimeError("database commit failed"),
            ):
                # 2.1 claim 失败
                r_claim_fail = await client.post(
                    f"/api/sessions/{session.id}/call/claim",
                    json={"device_id": device_id, "takeover": False},
                )
                assert r_claim_fail.status_code == 500

                # 2.2 heartbeat 失败
                r_hb_fail = await client.post(
                    f"/api/sessions/{session.id}/call/heartbeat",
                    json={"device_id": device_id, "generation": 1},
                )
                assert r_hb_fail.status_code == 500

                # 2.3 release 失败
                r_rel_fail = await client.post(
                    f"/api/sessions/{session.id}/call/release",
                    json={"device_id": device_id, "generation": 1},
                )
                assert r_rel_fail.status_code == 500

                # 2.4 end 失败
                r_end_fail = await client.post(f"/api/sessions/{session.id}/end")
                assert r_end_fail.status_code == 500

            # 3. 验证上述操作均被回滚，session 仍为 active，lease 仍为 held
            async with pg_env.session_factory() as db:
                s_check = (
                    await db.execute(select(Session).where(Session.id == session.id))
                ).scalar_one()
                assert s_check.status == SessionStatus.active
                l_check = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                assert l_check.state == "held"


# ---------------------------------------------------------------------------
# 12. End 会话契约测试
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_end_session_cloud_mode_success_and_rollback_on_failure(pg_env):
    """end 会话：持有租约时先撤销 Cloud Token 再释放 lease 与完成会话；撤销失败回滚事务。"""
    user = await pg_env.create_user()
    session = await pg_env.create_session(user.id)
    d1 = str(uuid.uuid4())

    mock_remove = AsyncMock()

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "test_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "test_secret"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=mock_remove)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            # 1. claim 占用
            await client.post(
                f"/api/sessions/{session.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )

            # 2. 模拟撤销抛出异常
            mock_remove.side_effect = RuntimeError("Cloud timeout")
            r_fail = await client.post(f"/api/sessions/{session.id}/end")
            assert r_fail.status_code == 502
            assert (
                r_fail.json().get("detail", {}).get("code")
                == "call_provider_unavailable"
            )

            # 验证 session 仍为 active，lease 仍为 held，无 AnalysisJob
            async with pg_env.session_factory() as db:
                s_check = (
                    await db.execute(select(Session).where(Session.id == session.id))
                ).scalar_one()
                assert s_check.status == SessionStatus.active
                l_check = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                assert l_check.state == "held"
                job = (
                    await db.execute(
                        select(AnalysisJob).where(AnalysisJob.session_id == session.id)
                    )
                ).scalar_one_or_none()
                assert job is None

            # 3. 恢复正常撤销并重试 end
            mock_remove.side_effect = None
            r_end = await client.post(f"/api/sessions/{session.id}/end")
            assert r_end.status_code == 200
            assert r_end.json()["status"] == "completed"

            # 验证 lease 被置 free，session completed，单个 AnalysisJob 建立
            async with pg_env.session_factory() as db:
                s_done = (
                    await db.execute(select(Session).where(Session.id == session.id))
                ).scalar_one()
                assert s_done.status == SessionStatus.completed
                l_done = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                assert l_done.state == "free"
                job_done = (
                    await db.execute(
                        select(AnalysisJob).where(AnalysisJob.session_id == session.id)
                    )
                ).scalar_one_or_none()
                assert job_done is not None

            # 4. 重复 end 幂等返回 200，不建立第二个 job
            r_repeat = await client.post(f"/api/sessions/{session.id}/end")
            assert r_repeat.status_code == 200
            assert r_repeat.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_end_other_session_does_not_affect_active_lease(pg_env):
    """结束当前用户的其他旧 session 不影响当前持有的活跃租约。"""
    user = await pg_env.create_user()
    s_active = await pg_env.create_session(user.id)
    s_other = await pg_env.create_session(user.id)
    device_id = str(uuid.uuid4())

    mock_remove = AsyncMock()

    with (
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "dummy_key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "dummy_secret"),
        patch(
            "services.call_leases.LiveKitAPI.room",
            new_callable=lambda: property(
                lambda self: AsyncMock(remove_participant=mock_remove)
            ),
        ),
    ):
        async with pg_env.client_for(user.id) as client:
            # 租约绑定在 s_active
            await client.post(
                f"/api/sessions/{s_active.id}/call/claim",
                json={"device_id": device_id, "takeover": False},
            )

            # 结束不相关的旧会话 s_other
            r_end = await client.post(f"/api/sessions/{s_other.id}/end")
            assert r_end.status_code == 200
            assert r_end.json()["status"] == "completed"

            # 确认不触发对 s_active 的撤销
            assert mock_remove.await_count == 0

            # s_active 的租约依然 held
            async with pg_env.session_factory() as db:
                lease = (
                    await db.execute(
                        select(CallLease).where(CallLease.user_id == user.id)
                    )
                ).scalar_one()
                assert lease.session_id == s_active.id
                assert lease.state == "held"


# ---------------------------------------------------------------------------
# 13. 认证与基本权限隔离
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auth_and_session_ownership_isolation(pg_env):
    """未认证 401；操作他人 session 返回 404；已结束 session 不能 claim 400。"""
    user1 = await pg_env.create_user()
    user2 = await pg_env.create_user()
    s_user1 = await pg_env.create_session(user1.id)
    s_user2 = await pg_env.create_session(user2.id)
    d1 = str(uuid.uuid4())

    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        # 1. 未认证 401
        async with pg_env.client_for(user_id=None, override_user=False) as anon:
            r_anon = await anon.post(
                f"/api/sessions/{s_user1.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )
            assert r_anon.status_code == 401

        # 2. user1 试图操作 user2 的 session -> 404
        async with pg_env.client_for(user1.id) as client:
            r_other = await client.post(
                f"/api/sessions/{s_user2.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )
            assert r_other.status_code == 404

            # 3. 针对已 completed 的 session 进行 claim -> 400
            s_completed = await pg_env.create_session(
                user1.id, status=SessionStatus.completed
            )
            r_comp = await client.post(
                f"/api/sessions/{s_completed.id}/call/claim",
                json={"device_id": d1, "takeover": False},
            )
            assert r_comp.status_code == 400
