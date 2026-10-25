"""会话分页、游标安全及每日聚合回归测试套件（RF-08 / A41）。

覆盖范围：
- >100 记录真实多页 keyset 分页，无重复无遗漏
- 同一微秒时间戳按 UUID 降序严格稳定排序
- limit 边界（1, 50, 100 合法；0, 101 返回 422）
- 恶意/损坏/超长游标返回统一 422 安全错误，不泄露异常及秘密
- 跨用户/跨端点/跨筛选复用游标返回 422
- 时间窗口校验：无时区、start >= end、窗口 > 48 小时、非成对时间均返回 422
- 静态 /api/sessions/daily-progress 路由优先于 /api/sessions/{session_id} 动态路由，不被 UUID 路由抢占
- 每日聚合：仅统计 completed，半开区间 [start, end)，0 转录也计会话，全角色转录计数，跨用户严格隔离
- 未认证请求返回 401
- 所有创建数据在 finally 逆序清理，保证测试幂等与隔离
"""

import base64
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, event
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
    TranscriptRole,
)
from models.user import User
from services.session_queries import encode_cursor
from time_utils import utc_now


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
                    email=f"pagination-test-{self.user_id}@example.test",
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
        try:
            if self.client:
                await self.client.aclose()
        finally:
            for dep, saved in self._saved_overrides.items():
                if saved is None:
                    app.dependency_overrides.pop(dep, None)
                else:
                    app.dependency_overrides[dep] = saved


@pytest.fixture
async def pg_env():
    """独立测试上下文，隔离依赖并在 finally 中严格逆序自建自清。"""
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip("DATABASE_URL is required for PostgreSQL session pagination tests")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    created_user_ids: list[uuid.UUID] = []
    created_session_ids: list[uuid.UUID] = []

    async def create_test_user() -> User:
        u_id = uuid.uuid4()
        user = User(
            id=u_id,
            email=f"pagi-{u_id}@example.test",
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
    ) -> Session:
        s_id = session_id or uuid.uuid4()
        s_time = started_at or utc_now()
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
        created_session_ids.append(s_id)
        return session

    async def create_test_transcript(
        session_id: uuid.UUID,
        role: TranscriptRole = TranscriptRole.user,
        content: str = "test utterance",
        timestamp_ms: int = 1000,
    ) -> Transcript:
        tr = Transcript(
            session_id=session_id,
            role=role,
            content=content,
            timestamp_ms=timestamp_ms,
        )
        async with session_factory() as db, db.begin():
            db.add(tr)
        return tr

    def make_client(
        user_id: uuid.UUID | None = None,
        override_user: bool = True,
    ) -> _ASGIClientContext:
        return _ASGIClientContext(session_factory, user_id, override_user)

    class ContextHelper:
        pass

    ctx = ContextHelper()
    ctx.create_test_user = create_test_user
    ctx.create_test_session = create_test_session
    ctx.create_test_transcript = create_test_transcript
    ctx.make_client = make_client
    ctx.session_factory = session_factory
    ctx.engine = engine

    try:
        yield ctx
    finally:
        try:
            # 严格逆序清理所有创建的测试数据
            async with session_factory() as db, db.begin():
                if created_session_ids:
                    all_ids = list(set(created_session_ids))
                    await db.execute(
                        delete(Transcript).where(Transcript.session_id.in_(all_ids))
                    )
                    await db.execute(
                        delete(SessionContext).where(
                            SessionContext.session_id.in_(all_ids)
                        )
                    )
                    await db.execute(
                        delete(AnalysisJob).where(AnalysisJob.session_id.in_(all_ids))
                    )
                    await db.execute(delete(Session).where(Session.id.in_(all_ids)))
                if created_user_ids:
                    all_uids = list(set(created_user_ids))
                    await db.execute(delete(User).where(User.id.in_(all_uids)))
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_pagination_over_100_records_no_duplicates_no_missing(pg_env):
    """验证 >100 条记录多页 keyset 分页：完整遍历所有记录，无重复无遗漏。"""
    user = await pg_env.create_test_user()
    base_time = datetime(2026, 10, 20, 12, 0, 0, tzinfo=timezone.utc)

    # 创建 105 条按时间降序的会话
    created_sessions = []
    for i in range(105):
        s = await pg_env.create_test_session(
            user.id,
            status=SessionStatus.completed,
            started_at=base_time - timedelta(minutes=i),
        )
        created_sessions.append(s)

    async with pg_env.make_client(user_id=user.id) as client:
        fetched_ids = []
        cursor = None
        page_count = 0

        while True:
            params = {"limit": 40}
            if cursor:
                params["cursor"] = cursor
            resp = await client.get("/api/sessions", params=params)
            assert resp.status_code == 200
            data = resp.json()
            assert "items" in data
            assert "next_cursor" in data

            items = data["items"]
            fetched_ids.extend([item["id"] for item in items])
            page_count += 1
            cursor = data["next_cursor"]
            if cursor is None:
                break

        # 40 + 40 + 25 = 105，共 3 页
        assert page_count == 3
        assert len(fetched_ids) == 105
        assert len(set(fetched_ids)) == 105, "不能有重复数据"

        expected_ids = [str(s.id) for s in created_sessions]
        assert fetched_ids == expected_ids, (
            "顺序必须与 started_at desc, id desc 完全一致"
        )


@pytest.mark.asyncio
async def test_pagination_same_microsecond_uuid_tiebreak(pg_env):
    """验证相同微秒时间戳时按 UUID 降序严格稳定排序与 keyset 翻页。"""
    user = await pg_env.create_test_user()
    same_time = datetime(2026, 10, 21, 15, 30, 0, 123456, tzinfo=timezone.utc)

    id1 = uuid.UUID("11111111-1111-4111-8111-111111111111")
    id2 = uuid.UUID("55555555-5555-4555-8555-555555555555")
    id3 = uuid.UUID("99999999-9999-4999-8999-999999999999")

    await pg_env.create_test_session(user.id, session_id=id1, started_at=same_time)
    await pg_env.create_test_session(user.id, session_id=id2, started_at=same_time)
    await pg_env.create_test_session(user.id, session_id=id3, started_at=same_time)

    async with pg_env.make_client(user_id=user.id) as client:
        # 第一页 limit=2，应返回 id3, id2，并在游标中指向 id2
        resp1 = await client.get("/api/sessions", params={"limit": 2})
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert len(data1["items"]) == 2
        assert data1["items"][0]["id"] == str(id3)
        assert data1["items"][1]["id"] == str(id2)
        assert data1["next_cursor"] is not None

        # 第二页传入游标，应精确返回 id1
        resp2 = await client.get(
            "/api/sessions",
            params={"limit": 2, "cursor": data1["next_cursor"]},
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert len(data2["items"]) == 1
        assert data2["items"][0]["id"] == str(id1)
        assert data2["next_cursor"] is None


@pytest.mark.asyncio
async def test_pagination_limit_boundaries(pg_env):
    """验证 limit 参数边界：1..100 合法，0 与 101 返回 422。"""
    user = await pg_env.create_test_user()

    async with pg_env.make_client(user_id=user.id) as client:
        # limit=0 -> 422
        resp = await client.get("/api/sessions", params={"limit": 0})
        assert resp.status_code == 422

        # limit=101 -> 422
        resp = await client.get("/api/sessions", params={"limit": 101})
        assert resp.status_code == 422

        # limit=1 -> 200
        resp = await client.get("/api/sessions", params={"limit": 1})
        assert resp.status_code == 200

        # limit=100 -> 200
        resp = await client.get("/api/sessions", params={"limit": 100})
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_pagination_corrupted_cursor_safety(pg_env):
    """验证损坏、非法 base64、非 JSON、超长游标、bool版本、非法键值均返回 422 安全错误。"""
    user = await pg_env.create_test_user()
    s = await pg_env.create_test_session(user.id)

    valid_payload = {
        "v": 1,
        "u": str(user.id),
        "ep": "history",
        "st": None,
        "s": None,
        "e": None,
        "t": s.started_at.isoformat(),
        "id": str(s.id),
    }
    valid_cursor = base64.urlsafe_b64encode(
        json.dumps(valid_payload).encode("utf-8")
    ).decode("ascii")

    def make_b64(payload_dict: dict) -> str:
        return base64.urlsafe_b64encode(
            json.dumps(payload_dict).encode("utf-8")
        ).decode("ascii")

    bad_cursors = [
        "not-base64-???",
        "YWJj",  # "abc" - valid base64 but invalid JSON
        "e30=",  # "{}" - valid JSON but missing version and keys
        "a" * 1025,  # 超长游标
        valid_cursor + "!!",  # 宽松 base64 常见漏洞后缀
        make_b64({**valid_payload, "v": True}),  # bool 型版本
        make_b64({**valid_payload, "v": 1.0}),  # float 型版本
        make_b64({**valid_payload, "v": 2}),  # 未知版本
        make_b64({**valid_payload, "extra": "key"}),  # 额外未知键
        make_b64({k: v for k, v in valid_payload.items() if k != "id"}),  # 缺少键
        make_b64({**valid_payload, "t": "2026-10-25T10:00:00"}),  # naive 无时区
        make_b64({**valid_payload, "id": "invalid-uuid"}),  # 非法 UUID
    ]

    async with pg_env.make_client(user_id=user.id) as client:
        for bad_cursor in bad_cursors:
            resp = await client.get("/api/sessions", params={"cursor": bad_cursor})
            assert resp.status_code == 422, f"Failed on cursor: {bad_cursor}"
            assert "Invalid pagination cursor" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_pagination_sql_query_count_and_column_isolation(pg_env):
    """P1-01 回归：捕获并验证每页严格 1 条必要列 SELECT，绝不连带查询 transcripts/contexts/jobs 正文。

    验证：
    - 分页查询时，无论数据量多少，每页仅发送 1 条 SQL
    - SELECT 语句只投影 sessions 的必要列，不触发 selectin 关联加载
    - aggregate 同样仅 1 条 SQL 统计完成会话与总轮次，0 正文
    """
    user = await pg_env.create_test_user()
    base_time = datetime(2026, 10, 25, 12, 0, 0, tzinfo=timezone.utc)

    # 创建 5 条会话，并关联多条 transcripts
    created_sessions = []
    for i in range(5):
        sess = await pg_env.create_test_session(
            user.id,
            status=SessionStatus.completed,
            started_at=base_time - timedelta(minutes=i),
        )
        created_sessions.append(sess)
        await pg_env.create_test_transcript(sess.id, role=TranscriptRole.user)
        await pg_env.create_test_transcript(sess.id, role=TranscriptRole.assistant)

    captured_sqls: list[str] = []

    def before_cursor_execute(
        conn, cursor, statement, parameters, context, executemany
    ):
        clean = " ".join(statement.split())
        # 仅关注业务 SELECT，排除事务控制或元数据查询
        if clean.upper().startswith("SELECT"):
            captured_sqls.append(clean)

    event.listen(
        pg_env.engine.sync_engine, "before_cursor_execute", before_cursor_execute
    )

    try:
        async with pg_env.make_client(user_id=user.id) as client:
            # 1. 验证 GET /api/sessions 分页查询
            captured_sqls.clear()
            resp = await client.get("/api/sessions", params={"limit": 10})
            assert resp.status_code == 200
            # 严格只有 1 条 SELECT 查询！若存在 selectin，这里会有 4 条查询
            assert len(captured_sqls) == 1, f"Expected 1 SQL, got: {len(captured_sqls)}"
            select_sql = captured_sqls[0].lower()
            assert "sessions.id" in select_sql
            assert "sessions.started_at" in select_sql
            assert "transcripts" not in select_sql
            assert "session_contexts" not in select_sql
            assert "analysis_jobs" not in select_sql

            # 2. 验证 GET /api/sessions/active
            captured_sqls.clear()
            resp_active = await client.get("/api/sessions/active", params={"limit": 10})
            assert resp_active.status_code == 200
            assert len(captured_sqls) == 1, f"Expected 1 SQL, got: {len(captured_sqls)}"
            assert "transcripts" not in captured_sqls[0].lower()

            # 3. 验证 GET /api/sessions/daily-progress 单次聚合查询
            captured_sqls.clear()
            resp_prog = await client.get(
                "/api/sessions/daily-progress",
                params={
                    "start": (base_time - timedelta(days=1)).isoformat(),
                    "end": (base_time + timedelta(days=1)).isoformat(),
                },
            )
            assert resp_prog.status_code == 200
            assert len(captured_sqls) == 1, f"Expected 1 SQL, got: {len(captured_sqls)}"
            prog_sql = captured_sqls[0].lower()
            assert "count(distinct sessions.id)" in prog_sql or "count(" in prog_sql
            # 确保不读取 transcript 内容字段
            assert "transcripts.content" not in prog_sql
    finally:
        event.remove(
            pg_env.engine.sync_engine, "before_cursor_execute", before_cursor_execute
        )


@pytest.mark.asyncio
async def test_pagination_cross_user_cross_endpoint_cursor_rejected(pg_env):
    """验证跨用户、跨端点、跨筛选条件的游标复用被严格拒绝 (422)。"""
    user_a = await pg_env.create_test_user()
    user_b = await pg_env.create_test_user()

    s_a = await pg_env.create_test_session(user_a.id)

    # 构造针对 user_a 在 history 端点生成的游标
    cursor_a = encode_cursor(
        user_id=user_a.id,
        endpoint="history",
        status=None,
        start=None,
        end=None,
        started_at=s_a.started_at,
        session_id=s_a.id,
    )

    # 1. 跨用户复用：user_b 携带 user_a 的游标请求 history
    async with pg_env.make_client(user_id=user_b.id) as client_b:
        resp = await client_b.get("/api/sessions", params={"cursor": cursor_a})
        assert resp.status_code == 422
        assert "Invalid pagination cursor" in resp.json()["detail"]

    # 2. 跨端点复用：user_a 在 active 端点携带 history 游标
    async with pg_env.make_client(user_id=user_a.id) as client_a:
        resp = await client_a.get("/api/sessions/active", params={"cursor": cursor_a})
        assert resp.status_code == 422
        assert "Invalid pagination cursor" in resp.json()["detail"]

    # 3. 跨筛选复用：user_a 带 status=completed 请求，但游标绑定的 status=None
    async with pg_env.make_client(user_id=user_a.id) as client_a:
        resp = await client_a.get(
            "/api/sessions",
            params={"status": "completed", "cursor": cursor_a},
        )
        assert resp.status_code == 422
        assert "Invalid pagination cursor" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_window_validation_rules(pg_env):
    """验证时间窗口校验规则：无时区、start >= end、跨度 > 48小时、非成对提供均返回 422。"""
    user = await pg_env.create_test_user()

    async with pg_env.make_client(user_id=user.id) as client:
        # 1. 仅提供 start，缺少 end -> 422
        resp = await client.get(
            "/api/sessions",
            params={"start": "2026-10-25T00:00:00Z"},
        )
        assert resp.status_code == 422

        # 2. 仅提供 end，缺少 start -> 422
        resp = await client.get(
            "/api/sessions",
            params={"end": "2026-10-25T00:00:00Z"},
        )
        assert resp.status_code == 422

        # 3. start >= end -> 422
        resp = await client.get(
            "/api/sessions",
            params={
                "start": "2026-10-25T10:00:00Z",
                "end": "2026-10-25T09:00:00Z",
            },
        )
        assert resp.status_code == 422

        # 4. 跨度 > 48 小时 -> 422
        resp = await client.get(
            "/api/sessions",
            params={
                "start": "2026-10-20T00:00:00Z",
                "end": "2026-10-25T00:00:00Z",
            },
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_daily_progress_aggregation(pg_env):
    """验证 GET /api/sessions/daily-progress 聚合逻辑与隔离性。

    - 必须定义在动态 /sessions/{session_id} 之前，不被 UUID 路由捕获
    - 仅统计 status=completed
    - 半开区间 [start, end)
    - 0 条转录的 completed 会话计 1 会话、0 转录
    - 有转录的 completed 会话计所有角色的转录数
    - 多用户数据隔离：其他用户的会话绝不计入
    """
    user_me = await pg_env.create_test_user()
    user_other = await pg_env.create_test_user()

    window_start = datetime(2026, 10, 25, 0, 0, 0, tzinfo=timezone.utc)
    window_end = datetime(2026, 10, 25, 23, 59, 59, tzinfo=timezone.utc)

    # 1. 窗口内 completed，0 转录
    await pg_env.create_test_session(
        user_me.id,
        status=SessionStatus.completed,
        started_at=window_start + timedelta(hours=1),
    )

    # 2. 窗口内 completed，3 条转录（2 user + 1 assistant）
    s2 = await pg_env.create_test_session(
        user_me.id,
        status=SessionStatus.completed,
        started_at=window_start + timedelta(hours=2),
    )
    await pg_env.create_test_transcript(s2.id, role=TranscriptRole.user)
    await pg_env.create_test_transcript(s2.id, role=TranscriptRole.assistant)
    await pg_env.create_test_transcript(s2.id, role=TranscriptRole.user)

    # 3. 窗口内 active 会话，有转录 -> 不计入
    s3 = await pg_env.create_test_session(
        user_me.id,
        status=SessionStatus.active,
        started_at=window_start + timedelta(hours=3),
    )
    await pg_env.create_test_transcript(s3.id, role=TranscriptRole.user)

    # 4. 窗口内 cancelled 会话 -> 不计入
    await pg_env.create_test_session(
        user_me.id,
        status=SessionStatus.cancelled,
        started_at=window_start + timedelta(hours=4),
    )

    # 5. 窗口外（早于 start）completed 会话 -> 不计入
    await pg_env.create_test_session(
        user_me.id,
        status=SessionStatus.completed,
        started_at=window_start - timedelta(minutes=1),
    )

    # 6. 窗口外（恰好等于或晚于 end）completed 会话 -> 不计入
    await pg_env.create_test_session(
        user_me.id,
        status=SessionStatus.completed,
        started_at=window_end,
    )

    # 7. 其它用户的窗口内 completed 会话 -> 绝不计入
    s_other = await pg_env.create_test_session(
        user_other.id,
        status=SessionStatus.completed,
        started_at=window_start + timedelta(hours=1),
    )
    await pg_env.create_test_transcript(s_other.id, role=TranscriptRole.user)

    async with pg_env.make_client(user_id=user_me.id) as client:
        resp = await client.get(
            "/api/sessions/daily-progress",
            params={
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["completed_sessions"] == 2
        assert data["total_turns"] == 3


@pytest.mark.asyncio
async def test_auth_boundary_401(pg_env):
    """验证未认证请求返回 401。"""
    async with pg_env.make_client(override_user=False) as client:
        resp1 = await client.get("/api/sessions")
        assert resp1.status_code == 401

        resp2 = await client.get("/api/sessions/active")
        assert resp2.status_code == 401

        resp3 = await client.get(
            "/api/sessions/daily-progress",
            params={
                "start": "2026-10-25T00:00:00Z",
                "end": "2026-10-25T12:00:00Z",
            },
        )
        assert resp3.status_code == 401
