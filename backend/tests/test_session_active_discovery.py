"""会话活动记录只读发现接口测试套件（CP02-B3）。

验证 GET /api/sessions/active 的契约边界：
- 多用户数据隔离
- 状态过滤（仅 status=active，排除 completed 与 cancelled）
- 空记录时返回 200 与空列表 []
- 确定性排序（started_at desc, id desc，含时间戳相同时按 UUID 降序）
- 响应字段最小化（无 Token、transcripts、doc 内容或 idempotency 列）
- 未认证请求返回 401
- 路由顺序正确（不影响既有 /sessions 历史列表与 /sessions/{session_id} 动态详情）
- 纯只读性（确认读操作不修改数据库状态或记录）
"""

import os
import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from main import app
from models.analysis import AnalysisJob
from models.session import (
    Session,
    SessionContext,
    SessionMode,
    SessionStatus,
    Transcript,
)
from models.user import User


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

        if self.override_user and self.user_id is not None:

            async def override_current_user() -> CurrentUser:
                return CurrentUser(
                    id=self.user_id,
                    email=f"active-test-{self.user_id}@example.test",
                    issuer="urn:echotalk:test",
                    subject=str(self.user_id),
                )

            app.dependency_overrides[get_current_user] = override_current_user
        else:
            app.dependency_overrides.pop(get_current_user, None)

        transport = ASGITransport(app=app)
        self.client = AsyncClient(transport=transport, base_url="http://testserver")
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
    """独立测试上下文，隔离依赖并严格自建自清。"""
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip(
            "DATABASE_URL is required for PostgreSQL session active discovery tests"
        )

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    created_user_ids: list[uuid.UUID] = []
    created_session_ids: list[uuid.UUID] = []

    async def create_test_user() -> User:
        u_id = uuid.uuid4()
        user = User(
            id=u_id,
            email=f"active-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
        )
        async with session_factory() as db, db.begin():
            db.add(user)
        created_user_ids.append(u_id)
        return user

    async def create_test_session(
        user_id: uuid.UUID,
        mode: SessionMode = SessionMode.free_talk,
        status: SessionStatus = SessionStatus.active,
        started_at: datetime | None = None,
        ended_at: datetime | None = None,
        session_id: uuid.UUID | None = None,
        with_doc_context: bool = False,
    ) -> Session:
        s_id = session_id or uuid.uuid4()
        s_time = started_at or datetime.utcnow()
        session = Session(
            id=s_id,
            user_id=user_id,
            mode=mode,
            status=status,
            started_at=s_time,
            ended_at=ended_at,
        )
        async with session_factory() as db, db.begin():
            db.add(session)
            if with_doc_context:
                ctx = SessionContext(
                    session_id=s_id,
                    custom_prompt="test prompt",
                    document_content="test content",
                    content_type="text/markdown",
                )
                db.add(ctx)
        created_session_ids.append(s_id)
        return session

    class TestContext:
        def __init__(self):
            self.session_factory = session_factory
            self.engine = engine
            self.create_test_user = create_test_user
            self.create_test_session = create_test_session

        def make_client(
            self,
            user_id: uuid.UUID | None = None,
            override_user: bool = True,
        ):
            return _ASGIClientContext(
                session_factory,
                user_id=user_id,
                override_user=override_user,
            )

    ctx = TestContext()
    try:
        yield ctx
    finally:
        # 仅清理本 fixture 创建的数据
        async with session_factory() as db, db.begin():
            if created_user_ids:
                stmt = select(Session.id).where(Session.user_id.in_(created_user_ids))
                db_session_ids = (await db.execute(stmt)).scalars().all()
                all_session_ids = list(set(created_session_ids + list(db_session_ids)))

                if all_session_ids:
                    await db.execute(
                        delete(SessionContext).where(
                            SessionContext.session_id.in_(all_session_ids)
                        )
                    )
                    await db.execute(
                        delete(Transcript).where(
                            Transcript.session_id.in_(all_session_ids)
                        )
                    )
                    await db.execute(
                        delete(AnalysisJob).where(
                            AnalysisJob.session_id.in_(all_session_ids)
                        )
                    )
                    await db.execute(
                        delete(Session).where(Session.id.in_(all_session_ids))
                    )
                await db.execute(delete(User).where(User.id.in_(created_user_ids)))
        await engine.dispose()


@pytest.mark.asyncio
async def test_active_sessions_multi_user_isolation(pg_env):
    """验证 GET /api/sessions/active 在多用户之间完全隔离。"""
    user_a = await pg_env.create_test_user()
    user_b = await pg_env.create_test_user()
    user_c = await pg_env.create_test_user()

    # User A: 2 个 active 会话
    s_a1 = await pg_env.create_test_session(user_a.id, SessionMode.free_talk)
    s_a2 = await pg_env.create_test_session(user_a.id, SessionMode.pronunciation)

    # User B: 1 个 active 会话
    s_b1 = await pg_env.create_test_session(user_b.id, SessionMode.doc_chat)

    # User A 查询：只看到 A 的 2 个活跃会话
    async with pg_env.make_client(user_id=user_a.id) as client:
        resp = await client.get("/api/sessions/active")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        returned_ids = {item["id"] for item in data}
        assert returned_ids == {str(s_a1.id), str(s_a2.id)}

    # User B 查询：只看到 B 的 1 个活跃会话
    async with pg_env.make_client(user_id=user_b.id) as client:
        resp = await client.get("/api/sessions/active")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == str(s_b1.id)

    # User C 查询：无任何会话，返回空列表 200
    async with pg_env.make_client(user_id=user_c.id) as client:
        resp = await client.get("/api/sessions/active")
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
async def test_active_sessions_filter_completed_and_cancelled(pg_env):
    """验证 GET /api/sessions/active 严格过滤 status=active，排除 completed 与 cancelled。"""
    user = await pg_env.create_test_user()

    now = datetime.utcnow()
    # 创建三种状态的会话
    s_active = await pg_env.create_test_session(
        user.id,
        SessionMode.free_talk,
        status=SessionStatus.active,
        started_at=now - timedelta(minutes=10),
    )
    await pg_env.create_test_session(
        user.id,
        SessionMode.pronunciation,
        status=SessionStatus.completed,
        started_at=now - timedelta(minutes=20),
        ended_at=now - timedelta(minutes=5),
    )
    await pg_env.create_test_session(
        user.id,
        SessionMode.doc_chat,
        status=SessionStatus.cancelled,
        started_at=now - timedelta(minutes=30),
        ended_at=now - timedelta(minutes=25),
    )

    async with pg_env.make_client(user_id=user.id) as client:
        resp = await client.get("/api/sessions/active")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == str(s_active.id)
        assert data[0]["status"] == "active"


@pytest.mark.asyncio
async def test_active_sessions_empty_list_returns_200(pg_env):
    """验证当前用户无 active 会话时返回 HTTP 200 与空列表 []。"""
    user = await pg_env.create_test_user()

    # 仅存在 completed 会话
    now = datetime.utcnow()
    await pg_env.create_test_session(
        user.id,
        SessionMode.free_talk,
        status=SessionStatus.completed,
        started_at=now - timedelta(minutes=10),
        ended_at=now - timedelta(minutes=5),
    )

    async with pg_env.make_client(user_id=user.id) as client:
        resp = await client.get("/api/sessions/active")
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
async def test_active_sessions_deterministic_ordering_with_same_timestamp(pg_env):
    """验证按 started_at desc, id desc 确定性排序，包括时间戳完全相同时按 UUID 降序。"""
    user = await pg_env.create_test_user()

    base_time = datetime(2026, 10, 21, 10, 0, 0)
    t_early = base_time
    t_same = base_time + timedelta(hours=1)
    t_late = base_time + timedelta(hours=2)

    # 准备两个不同的 UUID 用于同一时间戳
    id_low = uuid.UUID("11111111-1111-4111-8111-111111111111")
    id_high = uuid.UUID("99999999-9999-4999-8999-999999999999")
    assert id_high > id_low

    s_early = await pg_env.create_test_session(
        user.id,
        SessionMode.free_talk,
        started_at=t_early,
        session_id=uuid.UUID("22222222-2222-4222-8222-222222222222"),
    )
    # 同一时间戳注入 low 和 high
    s_same_low = await pg_env.create_test_session(
        user.id,
        SessionMode.pronunciation,
        started_at=t_same,
        session_id=id_low,
    )
    s_same_high = await pg_env.create_test_session(
        user.id,
        SessionMode.doc_chat,
        started_at=t_same,
        session_id=id_high,
    )
    s_late = await pg_env.create_test_session(
        user.id,
        SessionMode.free_talk,
        started_at=t_late,
        session_id=uuid.UUID("33333333-3333-4333-8333-333333333333"),
    )

    async with pg_env.make_client(user_id=user.id) as client:
        resp = await client.get("/api/sessions/active")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 4

        # 预期顺序：
        # 1. s_late (started_at 最大)
        # 2. s_same_high (started_at 居中，UUID 较大)
        # 3. s_same_low (started_at 居中，UUID 较小)
        # 4. s_early (started_at 最小)
        expected_ids = [
            str(s_late.id),
            str(s_same_high.id),
            str(s_same_low.id),
            str(s_early.id),
        ]
        actual_ids = [item["id"] for item in data]
        assert actual_ids == expected_ids


@pytest.mark.asyncio
async def test_active_sessions_response_fields_minimized(pg_env):
    """验证响应体严格遵循 SessionListItem 模型，不泄露 Token、转录、文档正文或幂等列。"""
    user = await pg_env.create_test_user()

    s = await pg_env.create_test_session(
        user.id,
        SessionMode.doc_chat,
        status=SessionStatus.active,
        with_doc_context=True,
    )

    async with pg_env.make_client(user_id=user.id) as client:
        resp = await client.get("/api/sessions/active")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        item = data[0]

        # 仅允许的公共字段集合
        allowed_fields = {"id", "mode", "status", "started_at", "ended_at"}
        assert set(item.keys()) == allowed_fields

        assert item["id"] == str(s.id)
        assert item["mode"] == "doc_chat"
        assert item["status"] == "active"
        assert item["ended_at"] is None

        # 显式禁止泄露的内部/大字段
        forbidden_fields = [
            "token",
            "livekit_token",
            "transcripts",
            "document_content",
            "doc_context",
            "custom_prompt",
            "request_idempotency_key",
            "request_fingerprint",
            "user_id",
        ]
        for field in forbidden_fields:
            assert field not in item, f"不应包含字段: {field}"


@pytest.mark.asyncio
async def test_active_sessions_unauthorized_returns_401(pg_env):
    """验证缺认证或无效 Token 时返回 401。"""
    # 1. 完全不提供 Authorization 头
    async with pg_env.make_client(override_user=False) as client:
        resp = await client.get("/api/sessions/active")
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Authentication required."

    # 2. 提供非法 Bearer Token
    async with pg_env.make_client(override_user=False) as client:
        headers = {"Authorization": "Bearer invalid-token-xyz"}
        resp = await client.get("/api/sessions/active", headers=headers)
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Authentication required."


@pytest.mark.asyncio
async def test_active_sessions_preserves_dynamic_detail_and_history_routes(pg_env):
    """验证 GET /api/sessions/active 置于 GET /api/sessions/{session_id} 之前，二者互不干扰。"""
    user = await pg_env.create_test_user()

    now = datetime.utcnow()
    s_active = await pg_env.create_test_session(
        user.id,
        SessionMode.free_talk,
        status=SessionStatus.active,
        started_at=now,
    )
    s_completed = await pg_env.create_test_session(
        user.id,
        SessionMode.pronunciation,
        status=SessionStatus.completed,
        started_at=now - timedelta(minutes=10),
        ended_at=now - timedelta(minutes=5),
    )

    async with pg_env.make_client(user_id=user.id) as client:
        # 1. 活跃发现接口：返回 active
        resp_active = await client.get("/api/sessions/active")
        assert resp_active.status_code == 200
        active_items = resp_active.json()
        assert len(active_items) == 1
        assert active_items[0]["id"] == str(s_active.id)

        # 2. 完整历史接口：返回 active 与 completed
        resp_history = await client.get("/api/sessions")
        assert resp_history.status_code == 200
        history_items = resp_history.json()
        assert len(history_items) == 2
        history_ids = [item["id"] for item in history_items]
        assert str(s_active.id) in history_ids
        assert str(s_completed.id) in history_ids

        # 3. 动态 UUID 详情接口正常匹配
        resp_detail_active = await client.get(f"/api/sessions/{s_active.id}")
        assert resp_detail_active.status_code == 200
        assert resp_detail_active.json()["id"] == str(s_active.id)
        assert resp_detail_active.json()["status"] == "active"

        resp_detail_completed = await client.get(f"/api/sessions/{s_completed.id}")
        assert resp_detail_completed.status_code == 200
        assert resp_detail_completed.json()["id"] == str(s_completed.id)
        assert resp_detail_completed.json()["status"] == "completed"

        # 4. 不存在的 UUID 正常返回 404
        non_existent_id = uuid.uuid4()
        resp_404 = await client.get(f"/api/sessions/{non_existent_id}")
        assert resp_404.status_code == 404
        assert resp_404.json()["detail"] == "会话不存在"


@pytest.mark.asyncio
async def test_active_sessions_read_only_does_not_modify_database(pg_env):
    """验证 GET /api/sessions/active 是严格只读操作，不修改记录或元数据。"""
    user = await pg_env.create_test_user()

    s = await pg_env.create_test_session(
        user.id,
        SessionMode.free_talk,
        status=SessionStatus.active,
    )

    # 读前快照
    async with pg_env.session_factory() as db:
        res = await db.execute(select(Session).where(Session.id == s.id))
        row_before = res.scalar_one()
        before_state = {
            "id": row_before.id,
            "user_id": row_before.user_id,
            "mode": row_before.mode,
            "status": row_before.status,
            "started_at": row_before.started_at,
            "ended_at": row_before.ended_at,
            "request_idempotency_key": row_before.request_idempotency_key,
            "request_fingerprint": row_before.request_fingerprint,
        }

    # 多次调用 GET /api/sessions/active
    async with pg_env.make_client(user_id=user.id) as client:
        for _ in range(3):
            resp = await client.get("/api/sessions/active")
            assert resp.status_code == 200
            assert len(resp.json()) == 1

    # 读后快照对比
    async with pg_env.session_factory() as db:
        res = await db.execute(select(Session).where(Session.id == s.id))
        row_after = res.scalar_one()
        after_state = {
            "id": row_after.id,
            "user_id": row_after.user_id,
            "mode": row_after.mode,
            "status": row_after.status,
            "started_at": row_after.started_at,
            "ended_at": row_after.ended_at,
            "request_idempotency_key": row_after.request_idempotency_key,
            "request_fingerprint": row_after.request_fingerprint,
        }

    assert before_state == after_state
