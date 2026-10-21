"""会话创建接口幂等契约测试套件（CP02-B2）。

包含单元测试与基于真实 PostgreSQL + httpx.ASGITransport 的并发/边界测试。
"""

import asyncio
import os
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
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
from routers.sessions import create_session
from schemas.session import DocContext, SessionCreate
from services.session_idempotency import (
    compute_session_fingerprint,
    is_idempotency_unique_violation,
    parse_idempotency_key,
)

# ---------------------------------------------------------------------------
# 1. 单元级测试 (Unit Tests / Mock)
# ---------------------------------------------------------------------------


def test_unit_parse_idempotency_key_valid():
    """合法的 UUID 字符串或 UUID 对象被正确解析。"""
    raw_uuid = uuid.uuid4()
    assert parse_idempotency_key(str(raw_uuid)) == raw_uuid
    assert parse_idempotency_key(f"  {raw_uuid}  ") == raw_uuid
    assert parse_idempotency_key(raw_uuid) == raw_uuid


def test_unit_parse_idempotency_key_none_and_fastapi_header():
    """None 或 FastAPI 默认 Header 对象返回 None。"""
    assert parse_idempotency_key(None) is None
    from fastapi.params import Header

    assert parse_idempotency_key(Header(None)) is None


def test_unit_parse_idempotency_key_invalid():
    """非法字符串或非法类型抛出 400 异常。"""
    for invalid in ["not-a-uuid", "", "   ", "12345", 12345, []]:
        with pytest.raises(HTTPException) as exc_info:
            parse_idempotency_key(invalid)
        assert exc_info.value.status_code == 400
        assert "Idempotency-Key 格式无效" in exc_info.value.detail


def test_unit_compute_session_fingerprint_deterministic():
    """请求体指纹计算具有确定性，且不受字典键序影响。"""
    body1 = SessionCreate(
        mode="doc_chat",
        doc_context=DocContext(
            raw_text="hello",
            prompt="summarize",
            content_type="text/markdown",
        ),
    )
    body2 = SessionCreate(
        mode="doc_chat",
        doc_context=DocContext(
            prompt="summarize",
            raw_text="hello",
            content_type="text/markdown",
        ),
    )
    fp1 = compute_session_fingerprint(body1)
    fp2 = compute_session_fingerprint(body2)
    assert fp1 == fp2
    assert len(fp1) == 64


def test_unit_compute_session_fingerprint_diff_mode_and_doc_context():
    """不同 mode 或 doc_context 产生不同指纹。"""
    b_free = SessionCreate(mode="free_talk")
    b_pron = SessionCreate(mode="pronunciation")
    assert compute_session_fingerprint(b_free) != compute_session_fingerprint(b_pron)

    b_doc1 = SessionCreate(
        mode="doc_chat",
        doc_context=DocContext(raw_text="text1", prompt="p1"),
    )
    b_doc2 = SessionCreate(
        mode="doc_chat",
        doc_context=DocContext(raw_text="text2", prompt="p1"),
    )
    assert compute_session_fingerprint(b_doc1) != compute_session_fingerprint(b_doc2)


def test_unit_is_idempotency_unique_violation_exact_match():
    """精确匹配 PostgreSQL SQLSTATE 23505 和 uq_sessions_user_idempotency_key。"""

    class TargetOrig(Exception):
        sqlstate = "23505"
        constraint_name = "uq_sessions_user_idempotency_key"

    exc = IntegrityError("msg", params={}, orig=TargetOrig())
    assert is_idempotency_unique_violation(exc) is True

    # 沿 __cause__ 链路能够找到
    cause_exc = Exception("wrapper")
    cause_exc.__cause__ = TargetOrig()
    exc2 = IntegrityError("msg", params={}, orig=cause_exc)
    assert is_idempotency_unique_violation(exc2) is True


def test_unit_is_idempotency_unique_violation_non_target_rejected():
    """非目标约束名或非 23505 错误，即使文本包含字段名也被拒绝。"""

    class OtherConstraintOrig:
        sqlstate = "23505"
        constraint_name = "uq_other_constraint_request_idempotency_key"

        def __str__(self):
            return "duplicate key violates request_idempotency_key"

    exc1 = IntegrityError("msg", params={}, orig=OtherConstraintOrig())
    assert is_idempotency_unique_violation(exc1) is False

    class ForeignKeyOrig:
        sqlstate = "23503"
        constraint_name = "fk_sessions_user_id"

    exc2 = IntegrityError("msg", params={}, orig=ForeignKeyOrig())
    assert is_idempotency_unique_violation(exc2) is False

    # 无结构化属性
    exc3 = IntegrityError(
        "generic error mentioning request_idempotency_key", {}, orig=Exception()
    )
    assert is_idempotency_unique_violation(exc3) is False


@pytest.mark.asyncio
async def test_unit_create_session_direct_call_without_header_param():
    """直接函数调用未提供 idempotency_key 时安全使用默认值。"""
    user_id = uuid.uuid4()
    current_user = CurrentUser(
        id=user_id,
        email="test@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()

    body = SessionCreate(mode="free_talk")
    # 直接调用时不传 idempotency_key，依赖默认 Header 对象
    created = await create_session(body=body, current_user=current_user, db=db)
    assert created.user_id == user_id
    assert created.request_idempotency_key is None
    assert created.request_fingerprint is None


@pytest.mark.asyncio
async def test_unit_create_session_with_mock_conflict_raises_409():
    """同 key 不同请求体抛出 409 异常。"""
    user_id = uuid.uuid4()
    key = uuid.uuid4()
    current_user = CurrentUser(
        id=user_id,
        email="test@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )
    db = AsyncMock()
    existing = Session(
        id=uuid.uuid4(),
        user_id=user_id,
        mode=SessionMode.free_talk,
        status=SessionStatus.active,
        request_idempotency_key=key,
        request_fingerprint="fingerprint_a",
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = existing
    db.execute.return_value = result

    body = SessionCreate(mode="pronunciation")
    with pytest.raises(HTTPException) as exc_info:
        await create_session(
            body=body,
            idempotency_key=str(key),
            current_user=current_user,
            db=db,
        )
    assert exc_info.value.status_code == 409
    assert "Idempotency-Key 已被不同参数的请求使用" in exc_info.value.detail


# ---------------------------------------------------------------------------
# 2. 真实 PostgreSQL 集成与并发测试 (显式 DATABASE_URL 隔离模式)
# ---------------------------------------------------------------------------


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@pytest.fixture
async def pg_env():
    """独立测试上下文，隔离依赖并严格自建自清。"""
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip("DATABASE_URL is required for PostgreSQL create idempotency tests")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    created_user_ids: list[uuid.UUID] = []
    created_session_ids: list[uuid.UUID] = []

    async def create_test_user() -> User:
        u_id = uuid.uuid4()
        user = User(
            id=u_id,
            email=f"idemp-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
        )
        async with session_factory() as db, db.begin():
            db.add(user)
        created_user_ids.append(u_id)
        return user

    class TestContext:
        def __init__(self):
            self.session_factory = session_factory
            self.engine = engine
            self.create_test_user = create_test_user
            self.created_session_ids = created_session_ids

        def make_client(
            self,
            user_id: uuid.UUID,
            barrier: asyncio.Barrier | None = None,
            conflict_tracker: dict | None = None,
        ):
            """构造具备隔离依赖覆盖的 HTTPX 客户端上下文管理器。"""
            return _ASGIClientContext(
                session_factory,
                user_id,
                created_session_ids,
                barrier=barrier,
                conflict_tracker=conflict_tracker,
            )

    ctx = TestContext()
    try:
        yield ctx
    finally:
        # 清理自身创建的数据：按本 fixture 随机用户查询所属全部 session 后清理，避免遗留
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


class DeterministicRaceSessionWrapper:
    """包装 AsyncSession，通过屏障强制双方初始查询双 miss 后再竞争插入。"""

    def __init__(
        self,
        raw_session,
        barrier: asyncio.Barrier,
        conflict_tracker: dict | None = None,
    ):
        self._raw = raw_session
        self._barrier = barrier
        self._conflict_tracker = (
            conflict_tracker if conflict_tracker is not None else {}
        )
        self._initial_query_passed = False

    async def execute(self, statement, *args, **kwargs):
        res = await self._raw.execute(statement, *args, **kwargs)
        stmt_str = str(statement)
        # 拦截首次基于 request_idempotency_key 的幂等初始查询
        if "request_idempotency_key" in stmt_str and not self._initial_query_passed:
            self._initial_query_passed = True
            # 两者均在执行完初始查询（均为 miss，结果为空）后在屏障处会合
            await self._barrier.wait()
        return res

    def begin_nested(self):
        real_nested = self._raw.begin_nested()
        tracker = self._conflict_tracker

        class NestedWrapper:
            async def __aenter__(self):
                return await real_nested.__aenter__()

            async def __aexit__(self, exc_type, exc_val, exc_tb):
                if exc_type is not None and issubclass(exc_type, IntegrityError):
                    tracker["conflict_count"] = tracker.get("conflict_count", 0) + 1
                return await real_nested.__aexit__(exc_type, exc_val, exc_tb)

        return NestedWrapper()

    def add(self, instance):
        return self._raw.add(instance)

    async def flush(self, *args, **kwargs):
        return await self._raw.flush(*args, **kwargs)

    async def refresh(self, *args, **kwargs):
        return await self._raw.refresh(*args, **kwargs)

    async def commit(self):
        return await self._raw.commit()

    async def rollback(self):
        return await self._raw.rollback()

    async def close(self):
        return await self._raw.close()

    def __getattr__(self, name):
        return getattr(self._raw, name)


class _ASGIClientContext:
    def __init__(
        self,
        session_factory,
        user_id: uuid.UUID,
        tracked_sessions: list[uuid.UUID],
        barrier: asyncio.Barrier | None = None,
        conflict_tracker: dict | None = None,
    ):
        self.session_factory = session_factory
        self.user_id = user_id
        self.tracked_sessions = tracked_sessions
        self.barrier = barrier
        self.conflict_tracker = conflict_tracker
        self.client: AsyncClient | None = None
        self._saved_overrides: dict[Any, Any] = {}

    async def __aenter__(self) -> AsyncClient:
        # 保存既有 dependency overrides，退出时严格恢复之前值
        self._saved_overrides = {
            get_db: app.dependency_overrides.get(get_db),
            get_current_user: app.dependency_overrides.get(get_current_user),
        }

        async def override_db():
            async with self.session_factory() as db:
                if self.barrier is not None:
                    db = DeterministicRaceSessionWrapper(
                        db, self.barrier, self.conflict_tracker
                    )
                try:
                    yield db
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

        async def override_user() -> CurrentUser:
            return CurrentUser(
                id=self.user_id,
                email=f"idemp-{self.user_id}@example.test",
                issuer="urn:echotalk:test",
                subject=str(self.user_id),
            )

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = override_user

        transport = ASGITransport(app=app)
        self.client = AsyncClient(transport=transport, base_url="http://test")
        return self.client

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            if self.client:
                await self.client.aclose()
        finally:
            for dep, prev_val in self._saved_overrides.items():
                if prev_val is None:
                    app.dependency_overrides.pop(dep, None)
                else:
                    app.dependency_overrides[dep] = prev_val


def _track(ctx, response_data: dict[str, Any]):
    sid_str = response_data.get("id")
    if sid_str:
        sid = uuid.UUID(sid_str)
        if sid not in ctx.created_session_ids:
            ctx.created_session_ids.append(sid)


# ---------------------------------------------------------------------------
# 集成用例
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pg_create_session_no_key_creates_distinct_sessions(pg_env):
    """缺省 Idempotency-Key 时，两次同请求体请求均创建新会话。"""
    user = await pg_env.create_test_user()
    body = {"mode": "free_talk"}

    async with pg_env.make_client(user.id) as client:
        r1 = await client.post("/api/sessions", json=body)
        assert r1.status_code == 200
        d1 = r1.json()
        _track(pg_env, d1)

        r2 = await client.post("/api/sessions", json=body)
        assert r2.status_code == 200
        d2 = r2.json()
        _track(pg_env, d2)

    assert d1["id"] != d2["id"]


@pytest.mark.asyncio
async def test_pg_create_session_serial_idempotency_replay(pg_env):
    """相同用户与相同 Idempotency-Key 串行调用，返回相同原会话且 DB 仅一条。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    headers = {"Idempotency-Key": key}
    body = {"mode": "conversation"}

    async with pg_env.make_client(user.id) as client:
        r1 = await client.post("/api/sessions", json=body, headers=headers)
        assert r1.status_code == 200
        d1 = r1.json()
        _track(pg_env, d1)

        r2 = await client.post("/api/sessions", json=body, headers=headers)
        assert r2.status_code == 200
        d2 = r2.json()

    assert d1["id"] == d2["id"]
    assert d1["started_at"] == d2["started_at"]

    # 验证 DB 确仅一条记录
    async with pg_env.session_factory() as db:
        stmt = select(Session).where(
            Session.user_id == user.id,
            Session.request_idempotency_key == uuid.UUID(key),
        )
        records = (await db.execute(stmt)).scalars().all()
        assert len(records) == 1


@pytest.mark.asyncio
async def test_pg_create_session_concurrent_idempotency(pg_env):
    """独立事务并发使用相同 Key，在同一 client 上下文发起，均返回 200 和同一会话。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    body = {"mode": "pronunciation"}

    start_event = asyncio.Event()

    async with pg_env.make_client(user.id) as client:

        async def run_req():
            await start_event.wait()
            return await client.post(
                "/api/sessions",
                json=body,
                headers={"Idempotency-Key": key},
            )

        t1 = asyncio.create_task(run_req())
        t2 = asyncio.create_task(run_req())

        # 同步起跑
        start_event.set()
        res1, res2 = await asyncio.wait_for(asyncio.gather(t1, t2), timeout=10.0)

    assert res1.status_code == 200
    assert res2.status_code == 200
    d1 = res1.json()
    d2 = res2.json()
    _track(pg_env, d1)
    _track(pg_env, d2)

    assert d1["id"] == d2["id"]

    async with pg_env.session_factory() as db:
        stmt = select(Session).where(
            Session.user_id == user.id,
            Session.request_idempotency_key == uuid.UUID(key),
        )
        records = (await db.execute(stmt)).scalars().all()
        assert len(records) == 1


@pytest.mark.asyncio
async def test_pg_create_session_deterministic_race_same_body(pg_env):
    """确定性并发屏障：强制双初始查询未命中后竞争插入，同请求体均返回 200 且返回同一会话。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    body = {"mode": "conversation"}

    barrier = asyncio.Barrier(2)
    tracker = {"conflict_count": 0}

    async with pg_env.make_client(
        user.id, barrier=barrier, conflict_tracker=tracker
    ) as client:
        start_event = asyncio.Event()

        async def run_req():
            await start_event.wait()
            return await client.post(
                "/api/sessions",
                json=body,
                headers={"Idempotency-Key": key},
            )

        t1 = asyncio.create_task(run_req())
        t2 = asyncio.create_task(run_req())

        start_event.set()
        res1, res2 = await asyncio.wait_for(asyncio.gather(t1, t2), timeout=10.0)

    assert res1.status_code == 200
    assert res2.status_code == 200
    d1 = res1.json()
    d2 = res2.json()
    _track(pg_env, d1)
    _track(pg_env, d2)

    assert d1["id"] == d2["id"]
    # 验证确实发生了数据库唯一冲突并被捕获
    assert tracker["conflict_count"] >= 1

    async with pg_env.session_factory() as db:
        stmt = select(Session).where(
            Session.user_id == user.id,
            Session.request_idempotency_key == uuid.UUID(key),
        )
        records = (await db.execute(stmt)).scalars().all()
        assert len(records) == 1


@pytest.mark.asyncio
async def test_pg_create_session_deterministic_race_diff_body_conflict_409(pg_env):
    """确定性并发屏障：强制双初始查询未命中后竞争插入，不同请求体其一 200 另一 409。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    body1 = {"mode": "free_talk"}
    body2 = {"mode": "pronunciation"}

    barrier = asyncio.Barrier(2)
    tracker = {"conflict_count": 0}

    async with pg_env.make_client(
        user.id, barrier=barrier, conflict_tracker=tracker
    ) as client:
        start_event = asyncio.Event()

        async def run_req(b):
            await start_event.wait()
            return await client.post(
                "/api/sessions",
                json=b,
                headers={"Idempotency-Key": key},
            )

        t1 = asyncio.create_task(run_req(body1))
        t2 = asyncio.create_task(run_req(body2))

        start_event.set()
        res1, res2 = await asyncio.wait_for(asyncio.gather(t1, t2), timeout=10.0)

    codes = {res1.status_code, res2.status_code}
    assert codes == {200, 409}

    ok_res = res1 if res1.status_code == 200 else res2
    conflict_res = res2 if res1.status_code == 200 else res1

    _track(pg_env, ok_res.json())
    assert "Idempotency-Key 已被不同参数的请求使用" in conflict_res.json()["detail"]
    assert tracker["conflict_count"] >= 1

    async with pg_env.session_factory() as db:
        stmt = select(Session).where(
            Session.user_id == user.id,
            Session.request_idempotency_key == uuid.UUID(key),
        )
        records = (await db.execute(stmt)).scalars().all()
        assert len(records) == 1


@pytest.mark.asyncio
async def test_pg_create_session_deterministic_race_doc_chat_single_context(pg_env):
    """确定性并发屏障：doc_chat 模式强制双 miss 竞争插入，验证 DB 中恰好仅 1 条 Context。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    body = {
        "mode": "doc_chat",
        "doc_context": {
            "raw_text": "Deterministic barrier race test document content",
            "prompt": "Evaluate context deduplication",
            "content_type": "text/markdown",
        },
    }

    barrier = asyncio.Barrier(2)
    tracker = {"conflict_count": 0}

    async with pg_env.make_client(
        user.id, barrier=barrier, conflict_tracker=tracker
    ) as client:
        start_event = asyncio.Event()

        async def run_req():
            await start_event.wait()
            return await client.post(
                "/api/sessions",
                json=body,
                headers={"Idempotency-Key": key},
            )

        t1 = asyncio.create_task(run_req())
        t2 = asyncio.create_task(run_req())

        start_event.set()
        res1, res2 = await asyncio.wait_for(asyncio.gather(t1, t2), timeout=10.0)

    assert res1.status_code == 200
    assert res2.status_code == 200
    d1 = res1.json()
    d2 = res2.json()
    _track(pg_env, d1)
    _track(pg_env, d2)

    assert d1["id"] == d2["id"]
    assert tracker["conflict_count"] >= 1

    session_id = uuid.UUID(d1["id"])
    async with pg_env.session_factory() as db:
        s_stmt = select(Session).where(Session.id == session_id)
        sessions = (await db.execute(s_stmt)).scalars().all()
        assert len(sessions) == 1

        c_stmt = select(SessionContext).where(SessionContext.session_id == session_id)
        contexts = (await db.execute(c_stmt)).scalars().all()
        assert len(contexts) == 1
        assert contexts[0].document_content == body["doc_context"]["raw_text"]


@pytest.mark.asyncio
async def test_pg_create_session_body_change_conflict_409(pg_env):
    """相同 Key 请求体发生改变返回 409。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    headers = {"Idempotency-Key": key}

    async with pg_env.make_client(user.id) as client:
        r1 = await client.post(
            "/api/sessions", json={"mode": "free_talk"}, headers=headers
        )
        assert r1.status_code == 200
        _track(pg_env, r1.json())

        r2 = await client.post(
            "/api/sessions", json={"mode": "pronunciation"}, headers=headers
        )
        assert r2.status_code == 409
        assert "Idempotency-Key 已被不同参数的请求使用" in r2.json()["detail"]


@pytest.mark.asyncio
async def test_pg_create_session_doc_context_differences_and_defaults(pg_env):
    """doc_chat 模式下，文本改变 409，省略默认字段 200 重放。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    headers = {"Idempotency-Key": key}

    # 首次创建包含完整的 doc_context
    body1 = {
        "mode": "doc_chat",
        "doc_context": {
            "raw_text": "Sample Document Content",
            "prompt": "Interview me",
            "content_type": "text/markdown",
        },
    }
    async with pg_env.make_client(user.id) as client:
        r1 = await client.post("/api/sessions", json=body1, headers=headers)
        assert r1.status_code == 200
        d1 = r1.json()
        _track(pg_env, d1)

        # 重复请求，省略默认 content_type（依赖 Pydantic 规范化）-> 200 重放
        body2 = {
            "mode": "doc_chat",
            "doc_context": {
                "raw_text": "Sample Document Content",
                "prompt": "Interview me",
            },
        }
        r2 = await client.post("/api/sessions", json=body2, headers=headers)
        assert r2.status_code == 200
        assert r2.json()["id"] == d1["id"]

        # 内容变动 -> 409
        body3 = {
            "mode": "doc_chat",
            "doc_context": {
                "raw_text": "Modified Content",
                "prompt": "Interview me",
            },
        }
        r3 = await client.post("/api/sessions", json=body3, headers=headers)
        assert r3.status_code == 409


@pytest.mark.asyncio
async def test_pg_create_session_doc_chat_context_is_unique(pg_env):
    """doc_chat 重复幂等调用不会创建重复的 SessionContext。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    headers = {"Idempotency-Key": key}
    body = {
        "mode": "doc_chat",
        "doc_context": {
            "raw_text": "Doc content",
            "prompt": "Doc prompt",
        },
    }

    async with pg_env.make_client(user.id) as client:
        r1 = await client.post("/api/sessions", json=body, headers=headers)
        assert r1.status_code == 200
        d1 = r1.json()
        _track(pg_env, d1)

        r2 = await client.post("/api/sessions", json=body, headers=headers)
        assert r2.status_code == 200

    session_id = uuid.UUID(d1["id"])
    async with pg_env.session_factory() as db:
        stmt = select(SessionContext).where(SessionContext.session_id == session_id)
        contexts = (await db.execute(stmt)).scalars().all()
        assert len(contexts) == 1
        assert contexts[0].document_content == "Doc content"


@pytest.mark.asyncio
async def test_pg_create_session_user_isolation(pg_env):
    """不同用户使用相同 Idempotency-Key 相互隔离，分别创建各自的会话。"""
    user_a = await pg_env.create_test_user()
    user_b = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    headers = {"Idempotency-Key": key}
    body = {"mode": "free_talk"}

    async with pg_env.make_client(user_a.id) as client_a:
        ra = await client_a.post("/api/sessions", json=body, headers=headers)
        assert ra.status_code == 200
        da = ra.json()
        _track(pg_env, da)

    async with pg_env.make_client(user_b.id) as client_b:
        rb = await client_b.post("/api/sessions", json=body, headers=headers)
        assert rb.status_code == 200
        db_data = rb.json()
        _track(pg_env, db_data)

    assert da["id"] != db_data["id"]
    assert da["user_id"] == str(user_a.id)
    assert db_data["user_id"] == str(user_b.id)


@pytest.mark.asyncio
async def test_pg_create_session_completed_replay(pg_env):
    """原会话已完成（completed）时，使用相同 Key 重放仍返回原会话，不新建。"""
    user = await pg_env.create_test_user()
    key = str(uuid.uuid4())
    headers = {"Idempotency-Key": key}
    body = {"mode": "free_talk"}

    async with pg_env.make_client(user.id) as client:
        r1 = await client.post("/api/sessions", json=body, headers=headers)
        assert r1.status_code == 200
        d1 = r1.json()
        _track(pg_env, d1)
        session_id = uuid.UUID(d1["id"])

        # 将该会话置为 completed
        async with pg_env.session_factory() as db, db.begin():
            stmt = select(Session).where(Session.id == session_id)
            s = (await db.execute(stmt)).scalar_one()
            s.status = SessionStatus.completed

        # 重放创建请求
        r2 = await client.post("/api/sessions", json=body, headers=headers)
        assert r2.status_code == 200
        d2 = r2.json()

    assert d2["id"] == str(session_id)
    assert d2["status"] == "completed"


@pytest.mark.asyncio
async def test_pg_create_session_invalid_key_400(pg_env):
    """传入非法 UUID 格式的 Idempotency-Key 返回 400。"""
    user = await pg_env.create_test_user()
    headers = {"Idempotency-Key": "invalid-uuid-string"}

    async with pg_env.make_client(user.id) as client:
        r = await client.post(
            "/api/sessions", json={"mode": "free_talk"}, headers=headers
        )
        assert r.status_code == 400
        assert "Idempotency-Key 格式无效" in r.json()["detail"]


@pytest.mark.asyncio
async def test_pg_create_session_non_target_integrity_error_bubbles_up():
    """非 uq_sessions_user_idempotency_key 的数据库错误不被幂等吞掉。"""
    user_id = uuid.uuid4()
    key = uuid.uuid4()
    current_user = CurrentUser(
        id=user_id,
        email="test@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )

    db = MagicMock()
    # 模拟第一次查询未找到
    res_mock = MagicMock()
    res_mock.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=res_mock)

    # 模拟 begin_nested 同步方法返回异步上下文管理器
    class MockNestedCM:
        async def __aenter__(self):
            raise IntegrityError(
                "insert into ...",
                params={},
                orig=Exception("foreign key constraint fk_sessions_user_id violated"),
            )

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            return False

    db.begin_nested = MagicMock(return_value=MockNestedCM())

    body = SessionCreate(mode="free_talk")
    with pytest.raises(IntegrityError) as exc_info:
        await create_session(
            body=body,
            idempotency_key=str(key),
            current_user=current_user,
            db=db,
        )
    assert "foreign key constraint" in str(exc_info.value)


@pytest.mark.asyncio
async def test_pg_create_session_non_target_constraint_containing_column_name_bubbles_up():
    """即使错误消息包含 request_idempotency_key 列名，非目标约束名也必须原样抛出。"""
    user_id = uuid.uuid4()
    key = uuid.uuid4()
    current_user = CurrentUser(
        id=user_id,
        email="test@example.test",
        issuer="urn:echotalk:test",
        subject=str(user_id),
    )

    db = MagicMock()
    res_mock = MagicMock()
    res_mock.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=res_mock)

    class MockPgOrig:
        def __init__(self):
            self.sqlstate = "23505"
            self.constraint_name = "uq_other_constraint_request_idempotency_key"

        def __str__(self):
            return "duplicate key violates request_idempotency_key column"

    class MockNestedCM:
        async def __aenter__(self):
            raise IntegrityError(
                "insert into sessions (request_idempotency_key) ...",
                params={},
                orig=MockPgOrig(),
            )

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            return False

    db.begin_nested = MagicMock(return_value=MockNestedCM())

    body = SessionCreate(mode="free_talk")
    with pytest.raises(IntegrityError) as exc_info:
        await create_session(
            body=body,
            idempotency_key=str(key),
            current_user=current_user,
            db=db,
        )
    orig = getattr(exc_info.value, "orig", None)
    assert (
        getattr(orig, "constraint_name", None)
        == "uq_other_constraint_request_idempotency_key"
    )


@pytest.mark.asyncio
async def test_create_session_unauthenticated_rejected():
    """创建接口缺认证请求被实际 HTTP 401 拒绝，且不读取真实 Token。"""
    saved_user_dep = app.dependency_overrides.pop(get_current_user, None)
    saved_db_dep = app.dependency_overrides.pop(get_db, None)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/sessions", json={"mode": "free_talk"})
            assert resp.status_code == 401
            assert resp.headers.get("www-authenticate") == "Bearer"
            assert resp.json().get("detail") == "Authentication required."
    finally:
        if saved_user_dep is not None:
            app.dependency_overrides[get_current_user] = saved_user_dep
        if saved_db_dep is not None:
            app.dependency_overrides[get_db] = saved_db_dep
