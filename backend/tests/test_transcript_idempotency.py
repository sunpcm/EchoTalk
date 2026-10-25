"""转录事件幂等与数据库一致性测试套件 (RF-09 / A43)。

覆盖：
1. 真实专用 PostgreSQL 顺序写入相同 (session, event) 幂等返回原记录，metadata 保持不变。
2. 真实专用 PostgreSQL 至少 4 个独立连接 Barrier 并发竞争，仅生成 1 条物理记录且所有连接返回同一记录。
3. 相同内容不同 event_id、多 NULL legacy 记录、跨 session 相同 event_id 互不抑制。
4. 冲突 payload（role、content、emotion_state、显式 timestamp）与坏 key 严格失败关闭（返回 None 且零写）。
5. 未提供 timestamp 的重发允许 clock 前进但保留首写时间戳。
6. 非目标外键 (FK) 违规安全失败返回 None，不被误判为幂等重放成功。
7. 模拟 commit 成功但后续确认失败导致收 None 后，显式同 event 重试返回原记录且总条数仍为 1。
8. 每日会话转录条数统计不会因同 event 重发而多算。
9. 测试所用自建记录严格按归属在 finally 中清理，nested finally dispose 引擎，禁止全库 truncate/drop。
"""

import asyncio
import os
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models.session import (
    Session,
    SessionMode,
    SessionStatus,
    Transcript,
    TranscriptRole,
)
from models.user import User
from services.session_queries import query_daily_progress
from services.transcript_service import save_transcript
from time_utils import utc_now


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@pytest.fixture
async def pg_env():
    """获取专用测试数据库环境，基于自建 user/session 归属与 try/finally 清理自建行。"""
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip(
            "DATABASE_URL is required for PostgreSQL transcript idempotency tests"
        )

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    created_users: list[uuid.UUID] = []
    created_sessions: list[uuid.UUID] = []

    class PgContext:
        def __init__(self):
            self.session_factory = session_factory
            self.engine = engine

        async def create_user(self, email_prefix: str = "idemp-user") -> uuid.UUID:
            u_id = uuid.uuid4()
            async with session_factory() as db:
                user = User(
                    id=u_id,
                    email=f"{email_prefix}-{u_id.hex[:8]}@example.test",
                    created_at=utc_now(),
                )
                db.add(user)
                await db.commit()
            created_users.append(u_id)
            return u_id

        async def create_session(
            self,
            user_id: uuid.UUID,
            mode: SessionMode = SessionMode.conversation,
            status: SessionStatus = SessionStatus.active,
        ) -> uuid.UUID:
            s_id = uuid.uuid4()
            async with session_factory() as db:
                sess = Session(
                    id=s_id,
                    user_id=user_id,
                    mode=mode,
                    status=status,
                    started_at=utc_now(),
                )
                db.add(sess)
                await db.commit()
            created_sessions.append(s_id)
            return s_id

        async def cleanup(self):
            """以测试自有 session/user 为归属级联清理，严格避免影响外部数据。"""
            async with session_factory() as db, db.begin():
                if created_sessions:
                    await db.execute(
                        delete(Transcript).where(
                            Transcript.session_id.in_(created_sessions)
                        )
                    )
                    await db.execute(
                        delete(Session).where(Session.id.in_(created_sessions))
                    )
                if created_users:
                    await db.execute(delete(User).where(User.id.in_(created_users)))

    ctx = PgContext()
    with patch("services.transcript_service.async_session_maker", session_factory):
        try:
            yield ctx
        finally:
            try:
                await ctx.cleanup()
            finally:
                await engine.dispose()


@pytest.mark.asyncio
async def test_transcript_sequential_idempotent_replay(pg_env):
    """验证顺序写入相同 (session, event) 时返回原记录，metadata 保持不变且数据库仅 1 行。"""
    user_id = await pg_env.create_user()
    session_id = await pg_env.create_session(user_id)
    event_id = uuid.uuid4()
    content = "Hello, this is first submission."
    emotion = {"anxiety_level": 0.2, "wpm": 120}
    t_fixed = 1710000000123

    # 1. 首次写入
    t1 = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=content,
        timestamp_ms=t_fixed,
        emotion_state=emotion,
        event_id=event_id,
    )
    assert t1 is not None
    assert t1.session_id == session_id
    assert t1.event_id == event_id
    assert t1.role == TranscriptRole.user
    assert t1.content == content
    assert t1.timestamp_ms == t_fixed
    assert t1.emotion_state == emotion

    # 2. 相同载荷第二次调用（幂等重放）
    t2 = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=content,
        timestamp_ms=t_fixed,
        emotion_state=emotion,
        event_id=event_id,
    )
    assert t2 is not None
    assert t2.id == t1.id
    assert t2.timestamp_ms == t1.timestamp_ms
    assert t2.emotion_state == t1.emotion_state

    # 3. 数据库行数严格为 1
    async with pg_env.session_factory() as db:
        res = await db.execute(
            select(func.count(Transcript.id)).where(
                Transcript.session_id == session_id,
                Transcript.event_id == event_id,
            )
        )
        assert res.scalar_one() == 1


@pytest.mark.asyncio
async def test_transcript_concurrent_barrier_idempotent(pg_env):
    """验证至少 4 个独立连接通过 Barrier 真正并发竞争写入同一 (session, event) 严格只产生 1 条记录。"""
    user_id = await pg_env.create_user()
    session_id = await pg_env.create_session(user_id)
    event_id = uuid.uuid4()
    content = "Concurrent turn test content."
    emotion = {"valence": 0.9}
    t_fixed = 1710000005000

    num_workers = 4
    barrier = asyncio.Barrier(num_workers)
    backend_pids: list[int] = []

    async def worker():
        # 每个 worker 先通过独立连接取得真实的 pg_backend_pid()
        async with pg_env.session_factory() as sess:
            pid = (await sess.execute(select(func.pg_backend_pid()))).scalar_one()
            backend_pids.append(pid)

        # 4 个真实连接准备就绪后到达屏障同步触发并发写入
        await barrier.wait()
        return await save_transcript(
            session_id=str(session_id),
            role="assistant",
            content=content,
            timestamp_ms=t_fixed,
            emotion_state=emotion,
            event_id=event_id,
        )

    tasks = [asyncio.create_task(worker()) for _ in range(num_workers)]
    results = await asyncio.gather(*tasks)

    # 断言 4 个 worker 来自 4 个完全互斥的真实 PostgreSQL 后端连接
    assert len(backend_pids) == num_workers
    assert len(set(backend_pids)) == num_workers

    # 4 个调用均成功返回且指向同一记录
    assert len(results) == num_workers
    for r in results:
        assert r is not None
        assert r.id == results[0].id
        assert r.session_id == session_id
        assert r.event_id == event_id
        assert r.content == content

    # 数据库中严格只存在 1 条物理记录
    async with pg_env.session_factory() as db:
        res = await db.execute(
            select(func.count(Transcript.id)).where(
                Transcript.session_id == session_id,
                Transcript.event_id == event_id,
            )
        )
        assert res.scalar_one() == 1


@pytest.mark.asyncio
async def test_transcript_different_key_same_content_not_suppressed(pg_env):
    """验证相同内容与时间戳但不同 event_id 的合法消息不被合并，正常存入多条。"""
    user_id = await pg_env.create_user()
    session_id = await pg_env.create_session(user_id)
    content = "Repeat same utterance"
    t_fixed = 1710000010000

    ev1 = uuid.uuid4()
    ev2 = uuid.uuid4()

    t1 = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=content,
        timestamp_ms=t_fixed,
        event_id=ev1,
    )
    t2 = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=content,
        timestamp_ms=t_fixed,
        event_id=ev2,
    )
    assert t1 is not None and t2 is not None
    assert t1.id != t2.id
    assert t1.event_id == ev1
    assert t2.event_id == ev2

    async with pg_env.session_factory() as db:
        res = await db.execute(
            select(func.count(Transcript.id)).where(Transcript.session_id == session_id)
        )
        assert res.scalar_one() == 2


@pytest.mark.asyncio
async def test_transcript_legacy_null_event_id_not_suppressed(pg_env):
    """验证 legacy 无 key 模式 (event_id=None) 两次写入相同文本正常存入多条，保留 NULL 语义。"""
    user_id = await pg_env.create_user()
    session_id = await pg_env.create_session(user_id)
    content = "Legacy untracked utterance"

    t1 = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=content,
        event_id=None,
    )
    t2 = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=content,
        event_id=None,
    )
    assert t1 is not None and t2 is not None
    assert t1.id != t2.id
    assert t1.event_id is None
    assert t2.event_id is None

    async with pg_env.session_factory() as db:
        res = await db.execute(
            select(func.count(Transcript.id)).where(
                Transcript.session_id == session_id,
                Transcript.event_id.is_(None),
            )
        )
        assert res.scalar_one() == 2


@pytest.mark.asyncio
async def test_transcript_cross_session_isolation(pg_env):
    """验证跨 session 隔离：不同 session 使用相同的 event_id 互不抑制。"""
    user_id = await pg_env.create_user()
    s1 = await pg_env.create_session(user_id)
    s2 = await pg_env.create_session(user_id)
    shared_event_id = uuid.uuid4()
    content = "Same event id across sessions"

    t1 = await save_transcript(
        session_id=str(s1),
        role="user",
        content=content,
        event_id=shared_event_id,
    )
    t2 = await save_transcript(
        session_id=str(s2),
        role="user",
        content=content,
        event_id=shared_event_id,
    )
    assert t1 is not None and t2 is not None
    assert t1.id != t2.id
    assert t1.session_id == s1
    assert t2.session_id == s2
    assert t1.event_id == shared_event_id
    assert t2.event_id == shared_event_id


@pytest.mark.asyncio
async def test_transcript_payload_conflict_rejection(pg_env):
    """验证同 key 异 payload（content/role/emotion/显式时间戳）安全拒绝返回 None 且零改写。"""
    user_id = await pg_env.create_user()
    session_id = await pg_env.create_session(user_id)
    event_id = uuid.uuid4()
    original_content = "Original verified text"
    t_fixed = 1710000020000
    emotion = {"score": 1}

    # 首次写入
    t_orig = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=original_content,
        timestamp_ms=t_fixed,
        emotion_state=emotion,
        event_id=event_id,
    )
    assert t_orig is not None

    # 1. 冲突 content
    res_bad_content = await save_transcript(
        session_id=str(session_id),
        role="user",
        content="Tampered conflicting text",
        timestamp_ms=t_fixed,
        emotion_state=emotion,
        event_id=event_id,
    )
    assert res_bad_content is None

    # 2. 冲突 role
    res_bad_role = await save_transcript(
        session_id=str(session_id),
        role="assistant",
        content=original_content,
        timestamp_ms=t_fixed,
        emotion_state=emotion,
        event_id=event_id,
    )
    assert res_bad_role is None

    # 3. 冲突 emotion_state
    res_bad_emotion = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=original_content,
        timestamp_ms=t_fixed,
        emotion_state={"score": 999},
        event_id=event_id,
    )
    assert res_bad_emotion is None

    # 4. 冲突显式 timestamp_ms
    res_bad_time = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=original_content,
        timestamp_ms=t_fixed + 5000,
        emotion_state=emotion,
        event_id=event_id,
    )
    assert res_bad_time is None

    # 5. 重发时不显式传 timestamp_ms（时钟前进），允许并返回首写记录，时间戳不变
    res_clock_advance = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=original_content,
        timestamp_ms=None,
        emotion_state=emotion,
        event_id=event_id,
    )
    assert res_clock_advance is not None
    assert res_clock_advance.id == t_orig.id
    assert res_clock_advance.timestamp_ms == t_fixed

    # 验证原记录从未被篡改，总记录数仍为 1
    async with pg_env.session_factory() as db:
        res = await db.execute(
            select(Transcript).where(
                Transcript.session_id == session_id,
                Transcript.event_id == event_id,
            )
        )
        stored = res.scalar_one()
        assert stored.content == original_content
        assert stored.timestamp_ms == t_fixed
        assert stored.emotion_state == emotion


@pytest.mark.asyncio
async def test_transcript_fk_violation_not_treated_as_idempotent(pg_env):
    """验证非目标外键约束错误返回 None，绝不误判为幂等成功。"""
    non_existent_session = str(uuid.uuid4())
    event_id = uuid.uuid4()

    res = await save_transcript(
        session_id=non_existent_session,
        role="user",
        content="This session does not exist in DB",
        event_id=event_id,
    )
    assert res is None


@pytest.mark.asyncio
async def test_transcript_commit_ack_failure_explicit_retry(pg_env):
    """验证模拟 commit 成功但后续确认失败返回 None 时，调用者显式同 key 重试返回原记录且总条数仍为 1。"""
    user_id = await pg_env.create_user()
    session_id = await pg_env.create_session(user_id)
    event_id = uuid.uuid4()
    content = "Message with simulated ack drop"
    t_fixed = 1710000030000

    # 模拟第一次执行在 commit 之后、确认读取或返回时抛出异常
    call_count = 0

    from sqlalchemy.ext.asyncio import AsyncSession

    original_execute = AsyncSession.execute

    async def patched_execute(self, statement, *args, **kwargs):
        nonlocal call_count
        res = await original_execute(self, statement, *args, **kwargs)
        # 如果是首次写入返回 id 之后的第二次 execute (select Transcript)，模拟异常
        if isinstance(statement, Select) and call_count == 0:
            call_count += 1
            raise RuntimeError("Simulated network failure on ack after commit")
        return res

    with patch.object(AsyncSession, "execute", patched_execute):
        first_call = await save_transcript(
            session_id=str(session_id),
            role="user",
            content=content,
            timestamp_ms=t_fixed,
            event_id=event_id,
        )
        assert first_call is None

    # 显式断言模拟的确认异常确实被触发过
    assert call_count == 1

    # 显式断言在重试前数据库中已经真实存在 1 行（commit 确实已成功）
    async with pg_env.session_factory() as db:
        pre_retry_count = (
            await db.execute(
                select(func.count(Transcript.id)).where(
                    Transcript.session_id == session_id,
                    Transcript.event_id == event_id,
                )
            )
        ).scalar_one()
        assert pre_retry_count == 1

    # 调用者显式重试相同的 (session, event)
    second_call = await save_transcript(
        session_id=str(session_id),
        role="user",
        content=content,
        timestamp_ms=t_fixed,
        event_id=event_id,
    )
    assert second_call is not None
    assert second_call.session_id == session_id
    assert second_call.event_id == event_id
    assert second_call.content == content
    assert second_call.timestamp_ms == t_fixed

    # 数据库总条数依然为 1
    async with pg_env.session_factory() as db:
        count_res = await db.execute(
            select(func.count(Transcript.id)).where(
                Transcript.session_id == session_id,
                Transcript.event_id == event_id,
            )
        )
        assert count_res.scalar_one() == 1


@pytest.mark.asyncio
async def test_transcript_idempotency_turn_count_not_duplicated(pg_env):
    """验证真实 query_daily_progress 每日聚合不会因同 event 重试多算（所有角色条数保持）。"""
    user_id = await pg_env.create_user()
    session_id = await pg_env.create_session(user_id, status=SessionStatus.completed)
    ev_user = uuid.uuid4()
    ev_asst = uuid.uuid4()

    now = utc_now()
    window_start = now - timedelta(hours=1)
    window_end = now + timedelta(hours=1)

    # 正常 1 问 1 答（双角色转录）
    await save_transcript(str(session_id), "user", "User turn 1", event_id=ev_user)
    await save_transcript(str(session_id), "assistant", "Asst turn 1", event_id=ev_asst)

    async with pg_env.session_factory() as db:
        prog1 = await query_daily_progress(
            db, user_id=user_id, start=window_start, end=window_end
        )
        assert prog1.completed_sessions == 1
        assert prog1.total_turns == 2

    # 模拟网络重传同 event
    await save_transcript(str(session_id), "user", "User turn 1", event_id=ev_user)
    await save_transcript(str(session_id), "assistant", "Asst turn 1", event_id=ev_asst)

    # 再次查询真实每日聚合，断言条数严格不增
    async with pg_env.session_factory() as db:
        prog2 = await query_daily_progress(
            db, user_id=user_id, start=window_start, end=window_end
        )
        assert prog2.completed_sessions == 1
        assert prog2.total_turns == 2
