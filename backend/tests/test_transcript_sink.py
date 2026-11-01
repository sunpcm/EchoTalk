"""
EchoTalk TranscriptSink 单元测试与证伪矩阵 (RF-09 / A44 r1)。

覆盖：
1. 正常双入口持久化同 job 与两 job 间隔离。
2. 默认容量 256 pending + 1 active 真实边界测试、满后零接受与故障异步通知至多一次。
3. 关闭前后、flight 中、sleep 退避中、notification 中的任务收束与物理清空队列。
4. writer 返回 None / 普通异常 / 超时 / 意外取消 / 通用 Awaitable 及 Future 支持。
5. 首次真实 commit 成功后 ack 丢失模拟与幂等重发单条落库。
6. 稳定 key、深拷贝快照与 None 时间戳严格保持。
7. close 成功、超时、调用者取消与并发重复 close 幂等共享结果；caller 取消后底层可复用。
8. 故障回调签名检查，内部抛出 TypeError 不重复执行（至多一次）。
9. 故障回调重入调用 close() 不产生死锁、RecursionError 或未收束任务。
10. entrypoint 真实双入口写入后捕获执行 shutdown callback 并验证排空；
    初始化异常与 start 失败/取消断言 sink 真实关闭且自有任务全部 done。
11. 安全 Canary 日志脱敏审计（全 record 字段绝对无 Canary）。
12. 专用 PostgreSQL 真实落库与重发验证。
"""

import asyncio
import logging
import os
import uuid
from typing import Any, Awaitable, Callable, Iterable
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from livekit.agents import ConversationItemAddedEvent, JobContext, llm
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from livekit_agent.agent import (
    EchoTalkAgent,
    entrypoint,
)
from livekit_agent.transcript_sink import TranscriptSink
from models.session import Session, SessionMode, SessionStatus, Transcript
from models.user import User
from services.transcript_service import save_transcript
from time_utils import utc_now

CANARY = "SECRET_CANARY_SINK_TOKEN_998877_DO_NOT_LEAK"
TEST_SINK_BUDGET_SECONDS: float = 2.0

_OBSERVED_TASKS: set[asyncio.Task[Any]] = set()


def _register_observed_task(task: asyncio.Task[Any]) -> None:
    _OBSERVED_TASKS.add(task)

    def _on_done(t: asyncio.Task[Any]) -> None:
        _OBSERVED_TASKS.discard(t)

    task.add_done_callback(_on_done)


async def _wait_bounded(
    awaitable: Awaitable[Any],
    timeout: float = TEST_SINK_BUDGET_SECONDS,
    name: str = "operation",
) -> Any:
    """在命名短测试预算内等待可等待对象完成，超时抛出包含操作名称的 TimeoutError。

    采用独立的外部完成观察预算（显式持有 Task 并通过 asyncio.wait 观察），
    到期不在观察函数中无限等待取消，由 finally 接管清理，杜绝因底层延迟取消导致测试卡死。
    所有新建观察 Task 均自动登记与回收。
    """
    if isinstance(awaitable, asyncio.Task):
        task = awaitable
    else:
        task = asyncio.create_task(awaitable)
        _register_observed_task(task)

    done, pending = await asyncio.wait({task}, timeout=timeout)
    if pending:
        raise TimeoutError(f"测试等待超过预算 ({timeout}s): {name}")

    return task.result()


async def _poll_bounded(
    predicate: Callable[[], bool],
    timeout: float = TEST_SINK_BUDGET_SECONDS,
    name: str = "condition",
    interval: float = 0.01,
) -> None:
    """在命名短测试预算内轮询断言条件，避免 while sleep(0) 无限循环。"""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not predicate():
        if loop.time() >= deadline:
            raise TimeoutError(f"测试条件轮询超过预算 ({timeout}s): {name}")
        await asyncio.sleep(interval)


async def _cancel_and_wait_tasks(
    tasks: Iterable[asyncio.Task[Any] | None],
    timeout: float = 1.0,
    name: str = "tasks",
) -> None:
    """取消并有界等待任务集合，显式判定 pending 并安全检索所有（含已完成）任务异常。"""
    all_tasks = [t for t in tasks if t is not None]
    if not all_tasks:
        return

    # 1. 检索已经 done 的任务异常，不漏掉早已失败的任务
    for t in all_tasks:
        if t.done():
            if not t.cancelled():
                try:
                    t.exception()
                except (asyncio.CancelledError, Exception):
                    pass

    # 2. 对未完成的任务统一发起 cancel 并等待
    active = [t for t in all_tasks if not t.done()]
    if not active:
        return

    for t in active:
        t.cancel()

    done, pending = await asyncio.wait(active, timeout=timeout)
    for t in done:
        if not t.cancelled():
            try:
                t.exception()
            except (asyncio.CancelledError, Exception):
                pass

    if pending:
        pending_names = [getattr(t, "get_name", lambda: repr(t))() for t in pending]
        raise TimeoutError(f"测试清理超时，仍有未收束任务 ({name}): {pending_names}")


def _collect_sink_tasks(sink: TranscriptSink | None) -> list[asyncio.Task[Any]]:
    if sink is None:
        return []
    tasks: list[asyncio.Task[Any]] = []
    for attr in ("_notify_task", "_worker_task", "_close_task"):
        t = getattr(sink, attr, None)
        if isinstance(t, asyncio.Task):
            tasks.append(t)
    return tasks


async def _cleanup_sink(
    sink: TranscriptSink | None,
    timeout: float = 1.0,
) -> None:
    """测试本地收束 Sink 任务：取消并等待其内部 worker/notify/close 任务，显式判定 pending。

    仅执行强制清场，严禁人为篡改 _closed=True / _accepting=False 伪造关闭成功终态。
    """
    if sink is None:
        return
    sink_tasks = _collect_sink_tasks(sink)
    await _cancel_and_wait_tasks(sink_tasks, timeout=timeout, name="sink_tasks")


async def _cleanup_test_resources(
    tasks: Iterable[asyncio.Task[Any] | None] | None = None,
    sinks: Iterable[TranscriptSink | None] | None = None,
    timeout: float = 1.0,
    name: str = "test_resources",
) -> None:
    """一次性收集测试装置拥有的所有任务，协调解开依赖并收束，保证前步失败也继续清理其余资源。"""
    all_sinks = list(sinks or [])

    all_tasks: set[asyncio.Task[Any]] = set()
    if tasks:
        for t in tasks:
            if isinstance(t, asyncio.Task):
                all_tasks.add(t)
    for s in all_sinks:
        for t in _collect_sink_tasks(s):
            all_tasks.add(t)

    for t in list(_OBSERVED_TASKS):
        if not t.done():
            all_tasks.add(t)

    # 1. 协调取消：同时对所有 active 任务调用 cancel()，先解开内外依赖关系（如 shield 互等）
    for t in all_tasks:
        if not t.done():
            t.cancel()

    # 2. 统一有界等待所有任务收束与异常检索
    await _cancel_and_wait_tasks(all_tasks, timeout=timeout, name=name)


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
        pytest.skip("DATABASE_URL is required for PostgreSQL transcript sink tests")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    created_users: list[uuid.UUID] = []
    created_sessions: list[uuid.UUID] = []

    class PgContext:
        def __init__(self):
            self.session_factory = session_factory
            self.engine = engine

        async def create_user(self, email_prefix: str = "sink-pg-user") -> uuid.UUID:
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


class AssertNoCanaryHandler(logging.Handler):
    """严格审查捕获的所有 LogRecord 的每个字段，确保无 Canary 泄露。"""

    def __init__(self):
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord):
        self.records.append(record)

    def assert_records_clean(self):
        for r in self.records:
            msg = r.getMessage()
            assert CANARY not in msg, f"Canary found in formatted log: {msg}"
            assert CANARY not in str(r.msg), f"Canary found in raw msg: {r.msg}"
            if r.args:
                assert CANARY not in str(r.args), f"Canary found in log args: {r.args}"
            assert r.exc_info is None, f"exc_info must be None, but got: {r.exc_info}"
            assert getattr(r, "stack_info", None) is None, (
                f"stack_info must be None, but got: {r.stack_info}"
            )
            for k, v in r.__dict__.items():
                if k in ("msg", "args", "exc_info", "stack_info"):
                    continue
                assert CANARY not in str(v), f"Canary found in record field '{k}': {v}"


@pytest.fixture
def sink_log_guard():
    """审查 echotalk-agent logger 的 fixture。"""
    logger = logging.getLogger("echotalk-agent")
    old_level = logger.level
    handler = AssertNoCanaryHandler()
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        yield handler
        handler.assert_records_clean()
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)


# ===========================================================================
# 1. 正常持久化、快照记账与 Job 隔离
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_normal_persistence_and_snapshot_accounting():
    """验证正常双入口提交至同一 Sink，成功落库并满足记账恒等式。"""
    session_id = str(uuid.uuid4())
    written_items = []

    async def fake_writer(sid, role, content, **kwargs):
        written_items.append({"sid": sid, "role": role, "content": content, **kwargs})
        return MagicMock(spec=Transcript, id=uuid.uuid4())

    sink = TranscriptSink(
        session_id=session_id,
        writer=fake_writer,
        capacity=10,
    )

    ev_user = uuid.uuid4()
    ev_asst = uuid.uuid4()

    assert (
        sink.submit(
            "user",
            "Hello teacher",
            event_id=ev_user,
            emotion_state={"anxiety_level": 0.1},
        )
        is True
    )
    assert (
        sink.submit(
            "assistant",
            "Hello student, how are you?",
            event_id=ev_asst,
        )
        is True
    )

    closed_ok = await sink.close()
    assert closed_ok is True

    snap = sink.snapshot()
    assert snap.accepted == 2
    assert snap.succeeded == 2
    assert snap.failed == 0
    assert snap.pending == 0
    assert snap.inflight == 0
    assert snap.rejected == 0
    assert snap.status == "closed"
    assert snap.closed is True
    assert snap.accepted == snap.succeeded + snap.failed + snap.pending + snap.inflight
    assert len(written_items) == 2
    assert written_items[0]["event_id"] == ev_user
    assert written_items[0]["emotion_state"] == {"anxiety_level": 0.1}
    assert written_items[0]["timestamp_ms"] is None
    assert written_items[1]["event_id"] == ev_asst


@pytest.mark.asyncio
async def test_sink_two_jobs_isolation():
    """验证两独立会话的 Sink 彼此隔离，队列、状态与写入互不影响。"""
    s1 = str(uuid.uuid4())
    s2 = str(uuid.uuid4())
    items1, items2 = [], []

    sink1 = TranscriptSink(
        session_id=s1,
        writer=lambda *args, **kw: items1.append(args) or MagicMock(),
    )
    sink2 = TranscriptSink(
        session_id=s2,
        writer=lambda *args, **kw: items2.append(args) or MagicMock(),
    )

    sink1.submit("user", "Msg for job 1", event_id=uuid.uuid4())
    sink2.submit("assistant", "Msg for job 2", event_id=uuid.uuid4())

    await asyncio.gather(sink1.close(), sink2.close())

    assert len(items1) == 1 and items1[0][0] == s1
    assert len(items2) == 1 and items2[0][0] == s2
    assert sink1.snapshot().accepted == 1
    assert sink2.snapshot().accepted == 1


# ===========================================================================
# 2. 真实容量边界 (256 pending + 1 active)、满队列与故障单次通知
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_capacity_boundary_default_256_deterministic():
    """验证默认 256 pending + 1 active 真实边界：确定性同步，满后拒绝且单次通知。"""
    session_id = str(uuid.uuid4())
    failure_reasons = []
    block_writer = asyncio.Event()
    first_item_started = asyncio.Event()
    fail_event = asyncio.Event()

    call_count = 0

    async def blocking_writer(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        first_item_started.set()
        await block_writer.wait()
        return MagicMock()

    def on_fail(reason):
        failure_reasons.append(reason)
        fail_event.set()

    sink = TranscriptSink(
        session_id=session_id,
        writer=blocking_writer,
        on_failure=on_fail,
        capacity=256,
        drain_timeout=2.0,
    )

    # 1. 提交第 1 条，成为 active / in-flight
    assert sink.submit("user", "item active", event_id=uuid.uuid4()) is True
    await first_item_started.wait()

    # 2. 提交 256 条，完全填满 pending 队列
    for i in range(256):
        assert sink.submit("user", f"item {i}", event_id=uuid.uuid4()) is True

    snap = sink.snapshot()
    assert snap.inflight == 1
    assert snap.pending == 256
    assert snap.accepted == 257

    # 3. 提交第 258 条（超容）：立即同步拒绝，停止接纳
    assert sink.submit("user", "item 258 overflow", event_id=uuid.uuid4()) is False
    assert sink.accepting is False
    assert sink.snapshot().rejected == 1

    # 等待异步故障通知确定性完成
    await fail_event.wait()
    assert failure_reasons == ["capacity_exceeded"]

    # 再次提交依然拒绝
    assert sink.submit("user", "item 259", event_id=uuid.uuid4()) is False
    assert sink.snapshot().rejected == 2
    assert failure_reasons == ["capacity_exceeded"]  # 依然只有 1 次通知

    # 释放阻塞并排空
    block_writer.set()
    closed_ok = await sink.close()
    assert closed_ok is True
    assert sink.snapshot().succeeded == 257
    assert sink._queue.empty() is True


@pytest.mark.asyncio
async def test_sink_rejects_invalid_inputs():
    """验证空白文本、非法角色、缺失或非法 event_id 以及非法 session_id 被安全拒绝且零写。"""
    valid_sid = str(uuid.uuid4())
    writer = AsyncMock()
    sink = TranscriptSink(session_id=valid_sid, writer=writer)

    assert sink.submit("user", "", event_id=uuid.uuid4()) is False
    assert sink.submit("user", "   ", event_id=uuid.uuid4()) is False
    assert sink.submit("moderator", "valid text", event_id=uuid.uuid4()) is False
    assert sink.submit("user", "valid text", event_id=None) is False
    assert sink.submit("user", "valid text", event_id="") is False
    assert sink.submit("user", "valid text", event_id="not-a-uuid") is False
    assert (
        sink.submit(
            "user", "valid text", event_id=uuid.uuid4(), timestamp_ms="bad_stamp"
        )
        is False
    )

    await sink.close()
    writer.assert_not_called()
    assert sink.snapshot().accepted == 0
    assert sink.snapshot().rejected == 7

    bad_sink = TranscriptSink(session_id="bad-session-uuid", writer=writer)
    assert bad_sink.submit("user", "valid text", event_id=uuid.uuid4()) is False
    await bad_sink.close()


# ===========================================================================
# 3. 重试耗尽、超时、通用 Awaitable 与取消单次 task_done
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_retry_exhaustion_and_single_failure_notification():
    """验证写入最多 3 次尝试（首次 + 2 重试），耗尽后停止接纳并触发一次故障通知。"""
    session_id = str(uuid.uuid4())
    attempt_records = []
    failure_reasons = []

    async def failing_writer(sid, role, content, **kwargs):
        attempt_records.append((kwargs.get("event_id"), kwargs.get("timestamp_ms")))
        return None

    sink = TranscriptSink(
        session_id=session_id,
        writer=failing_writer,
        on_failure=lambda r: failure_reasons.append(r),
        max_attempts=3,
        backoff=(0.01, 0.02),
        drain_timeout=1.0,
    )

    target_ev = uuid.uuid4()
    sink.submit("assistant", "Will fail 3 times", event_id=target_ev)

    closed_ok = await sink.close()
    assert closed_ok is False

    assert len(attempt_records) == 3
    for ev, stamp in attempt_records:
        assert ev == target_ev

    snap = sink.snapshot()
    assert snap.accepted == 1
    assert snap.succeeded == 0
    assert snap.failed == 1
    assert snap.status == "closed"
    assert failure_reasons == ["max_attempts_exceeded"]


@pytest.mark.asyncio
async def test_sink_attempt_timeout_deterministic():
    """验证单次写入超过 attempt_timeout 确定性视作超时失败并触发退避重试。"""
    session_id = str(uuid.uuid4())
    never_done_event = asyncio.Event()
    call_count = 0

    async def slow_writer(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            await never_done_event.wait()
            return MagicMock()
        return MagicMock()

    sink = TranscriptSink(
        session_id=session_id,
        writer=slow_writer,
        max_attempts=3,
        attempt_timeout=0.02,
        backoff=(0.01, 0.01),
        drain_timeout=1.0,
    )

    sink.submit("user", "Deterministic attempt timeout test", event_id=uuid.uuid4())
    closed_ok = await sink.close()
    assert closed_ok is True
    assert call_count == 3
    assert sink.snapshot().succeeded == 1


@pytest.mark.asyncio
async def test_sink_future_and_general_awaitable_writer():
    """验证同步 writer 直接返回 Future 与 CustomAwaitable：未 resolve 前受等待，resolve 后成功。"""
    session_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()

    # 1. 验证同步返回 Future：未 resolve 前 succeeded == 0，resolve 后才 succeeded == 1
    fut = loop.create_future()
    fut_started = asyncio.Event()

    def sync_future_writer(*args, **kwargs):
        fut_started.set()
        return fut

    sink1 = TranscriptSink(
        session_id=session_id,
        writer=sync_future_writer,
        max_attempts=1,
        attempt_timeout=2.0,
        drain_timeout=2.0,
    )
    sink1.submit("assistant", "Future test", event_id=uuid.uuid4())
    await fut_started.wait()

    # 此时 Future 尚未 resolve，断言 succeeded 依然为 0
    assert sink1.snapshot().succeeded == 0

    # 手动 resolve Future 为 Transcript
    fut.set_result(MagicMock(spec=Transcript))
    assert await sink1.close() is True
    assert sink1.snapshot().succeeded == 1

    # 2. 验证同步返回 CustomAwaitable：真正驱动 __await__ 执行
    await_called = False

    class CustomAwaitable:
        def __await__(self):
            async def _coro():
                nonlocal await_called
                await_called = True
                return MagicMock(spec=Transcript)

            return _coro().__await__()

    def sync_custom_awaitable_writer(*args, **kwargs):
        return CustomAwaitable()

    sink2 = TranscriptSink(
        session_id=session_id,
        writer=sync_custom_awaitable_writer,
        max_attempts=1,
        drain_timeout=1.0,
    )
    sink2.submit("user", "Custom awaitable test", event_id=uuid.uuid4())
    assert await sink2.close() is True
    assert await_called is True
    assert sink2.snapshot().succeeded == 1


@pytest.mark.asyncio
async def test_sink_writer_cancelled_error_handling_single_task_done():
    """验证 writer 内部直接抛出 CancelledError 时恰好一次 task_done（无 ValueError），停接并通知。"""
    session_id = str(uuid.uuid4())
    failure_reasons = []
    fail_event = asyncio.Event()

    def on_fail(reason):
        failure_reasons.append(reason)
        fail_event.set()

    async def cancelling_writer(*args, **kwargs):
        raise asyncio.CancelledError()

    sink = TranscriptSink(
        session_id=session_id,
        writer=cancelling_writer,
        on_failure=on_fail,
        drain_timeout=0.5,
    )

    sink.submit("user", "Trigger unexpected cancel", event_id=uuid.uuid4())
    await fail_event.wait()

    assert sink.accepting is False
    assert failure_reasons == ["worker_cancelled"]

    closed_ok = await sink.close()
    assert closed_ok is False
    assert sink.snapshot().failed == 1
    assert sink._queue.empty() is True


# ===========================================================================
# 4. 故障回调签名检查与重入 close()
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_failure_callback_signature_inspection_no_retry_on_internal_type_error():
    """验证同步故障回调内部抛出 TypeError 时绝不重试再次执行（严格至多一次）。"""
    session_id = str(uuid.uuid4())
    call_count = 0
    fail_event = asyncio.Event()

    def buggy_user_callback(reason):
        nonlocal call_count
        call_count += 1
        fail_event.set()
        # 用户代码自身的内部 bug 产生 TypeError
        raise TypeError(f"User callback internal bug with {CANARY}")

    sink = TranscriptSink(
        session_id=session_id,
        writer=AsyncMock(side_effect=RuntimeError("write failed")),
        on_failure=buggy_user_callback,
        max_attempts=1,
        drain_timeout=0.5,
    )

    sink.submit("user", "Msg causing failure", event_id=uuid.uuid4())
    await fail_event.wait()
    await sink.close()

    assert call_count == 1  # 严格只调用了一次！


@pytest.mark.asyncio
async def test_sink_reentrant_close_from_on_failure():
    """验证故障回调重入调用 close() 消除自我等待与递归取消，正常完成排空与退出。"""
    session_id = str(uuid.uuid4())
    reentrant_closed_result = None
    cb_done = asyncio.Event()

    async def reentrant_on_failure(reason):
        nonlocal reentrant_closed_result
        # 证明当前运行任务身份确为 Sink 故障通知任务，杜绝 Task 身份漂移
        assert sink.is_failure_notification_task() is True
        assert sink.is_failure_notification_task(asyncio.current_task()) is True
        # 身份敏感重入调用必须在原通知 Task 中直接 await，避免 _wait_bounded 产生新 Task 破坏身份判定
        reentrant_closed_result = await sink.close()
        cb_done.set()

    sink = TranscriptSink(
        session_id=session_id,
        writer=AsyncMock(side_effect=RuntimeError("write failed")),
        on_failure=reentrant_on_failure,
        max_attempts=1,
        drain_timeout=1.0,
    )

    try:
        sink.submit("user", "Msg triggering reentrant close", event_id=uuid.uuid4())
        await _wait_bounded(cb_done.wait(), name="cb_done")

        # 外部也调用 close
        closed_ok = await _wait_bounded(sink.close(), name="external_sink_close")
        assert closed_ok is False
        assert reentrant_closed_result is False
        assert sink.snapshot().closed is True
        assert sink._queue.empty() is True
        assert sink._worker_task.done() is True
        assert sink._notify_task is not None
        assert sink._notify_task.done() is True
        assert (
            sink._notify_task.cancelled() is False
        )  # 证明重入非取消回退，而是正常排空完成退出
    finally:
        cb_done.set()
        await _cleanup_test_resources(sinks=[sink], timeout=1.0)


@pytest.mark.asyncio
async def test_sink_is_failure_notification_task_query_and_immutability():
    """验证 is_failure_notification_task 公共行为查询矩阵与状态不变性。

    显式 None 语义：task=None 与无参调用等价，均指当前任务；在故障通知任务内部返回 True，在外部任务返回 False。
    绝非任何情况下传 None 均返回 False。
    """
    session_id1 = str(uuid.uuid4())
    session_id2 = str(uuid.uuid4())

    notify_entered = asyncio.Event()
    release_notify = asyncio.Event()
    query_results: dict[str, bool] = {}

    async def blocking_on_failure(reason):
        current = asyncio.current_task()
        query_results["sink1_current_in_cb"] = sink1.is_failure_notification_task()
        query_results["sink1_explicit_task"] = sink1.is_failure_notification_task(
            current
        )
        query_results["sink1_explicit_none_in_cb"] = sink1.is_failure_notification_task(
            None
        )
        query_results["sink2_cross_query_current"] = (
            sink2.is_failure_notification_task()
        )
        query_results["sink2_cross_query_explicit"] = (
            sink2.is_failure_notification_task(current)
        )
        query_results["sink2_cross_query_none"] = sink2.is_failure_notification_task(
            None
        )
        notify_entered.set()
        await _wait_bounded(release_notify.wait(), name="release_notify")

    sink1 = TranscriptSink(
        session_id=session_id1,
        writer=AsyncMock(side_effect=RuntimeError("sink1 failed")),
        on_failure=blocking_on_failure,
        max_attempts=1,
        drain_timeout=1.0,
    )
    sink2 = TranscriptSink(
        session_id=session_id2,
        max_attempts=1,
        drain_timeout=1.0,
    )

    try:
        # 1. 故障发生前（无通知任务）：普通调用均返回 False
        snap_before = sink1.snapshot()
        assert sink1.is_failure_notification_task() is False
        assert sink1.is_failure_notification_task(asyncio.current_task()) is False
        assert sink1.is_failure_notification_task(None) is False
        assert sink2.is_failure_notification_task() is False

        # 状态不变
        assert sink1.snapshot() == snap_before

        # 2. 触发 Sink 1 故障通知
        sink1.submit("user", "trigger failure", event_id=uuid.uuid4())
        await _wait_bounded(notify_entered.wait(), name="notify_entered")

        # 外部任务查询 sink1 与 sink2：因外部当前任务不是 notify_task，均返回 False
        assert sink1.is_failure_notification_task() is False
        assert sink1.is_failure_notification_task(asyncio.current_task()) is False
        assert sink1.is_failure_notification_task(None) is False
        assert sink2.is_failure_notification_task() is False

        # 验证回调内部的查询结果：在 notify_task 内部，无参、传当前任务及显式传 None 均返回 True
        assert query_results["sink1_current_in_cb"] is True
        assert query_results["sink1_explicit_task"] is True
        assert query_results["sink1_explicit_none_in_cb"] is True
        assert query_results["sink2_cross_query_current"] is False
        assert query_results["sink2_cross_query_explicit"] is False
        assert query_results["sink2_cross_query_none"] is False
    finally:
        # 释放通知任务并关闭两个 Sink，保证首项失败不跳过第二项
        release_notify.set()
        err1: Exception | None = None
        err2: Exception | None = None
        try:
            assert await _wait_bounded(sink1.close(), name="sink1_close") is False
        except Exception as e:
            err1 = e
        try:
            assert await _wait_bounded(sink2.close(), name="sink2_close") is True
        except Exception as e:
            err2 = e
        finally:
            await _cleanup_test_resources(sinks=[sink1, sink2], timeout=1.0)
        if err1 is not None:
            raise err1
        if err2 is not None:
            raise err2

    # 3. 关闭完成后外部普通调用仍为 False
    assert sink1.is_failure_notification_task() is False
    assert sink1.is_failure_notification_task(None) is False
    assert sink2.is_failure_notification_task() is False


@pytest.mark.asyncio
async def test_sink_close_drains_hanging_notify_task_within_budget():
    """验证外部调用 close() 时若通知任务挂起，能在总预算内超时取消并收束通知任务，不遗留 pending 任务。"""
    session_id = str(uuid.uuid4())
    notify_started = asyncio.Event()

    async def hanging_on_failure(reason):
        notify_started.set()
        await asyncio.Event().wait()  # 永久挂起

    sink = TranscriptSink(
        session_id=session_id,
        writer=AsyncMock(side_effect=RuntimeError("write failed")),
        on_failure=hanging_on_failure,
        max_attempts=1,
        drain_timeout=0.1,  # 小预算
    )

    sink.submit("user", "Msg causing failure", event_id=uuid.uuid4())
    await notify_started.wait()

    # 外部调用 close()
    closed_ok = await sink.close()
    assert closed_ok is False
    assert sink.snapshot().closed is True
    assert sink._worker_task.done() is True
    assert sink._notify_task is not None
    assert sink._notify_task.done() is True


# ===========================================================================
# 5. 关闭、排空超时、取消与底层结果复用
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_close_timeout_explicit_failure_and_cleanup():
    """验证总排空预算超时后显式失败，收束所有自有任务并将未落库项目记为 failed。"""
    session_id = str(uuid.uuid4())
    hang_event = asyncio.Event()

    async def hanging_writer(*args, **kwargs):
        await hang_event.wait()
        return MagicMock()

    sink = TranscriptSink(
        session_id=session_id,
        writer=hanging_writer,
        drain_timeout=0.03,
    )

    sink.submit("user", "Hanging msg 1", event_id=uuid.uuid4())
    sink.submit("assistant", "Hanging msg 2", event_id=uuid.uuid4())

    closed_ok = await sink.close()
    assert closed_ok is False

    snap = sink.snapshot()
    assert snap.closed is True
    assert snap.accepted == 2
    assert snap.succeeded == 0
    assert snap.failed == 2
    assert snap.pending == 0
    assert snap.inflight == 0
    assert snap.accepted == snap.succeeded + snap.failed + snap.pending + snap.inflight
    assert sink._queue.empty() is True


@pytest.mark.asyncio
async def test_sink_close_concurrent_and_repeated_calls_idempotent():
    """验证 close 并发调用与重复串行调用幂等，共享同一执行结果。"""
    session_id = str(uuid.uuid4())

    async def fake_writer(*args, **kwargs):
        return MagicMock()

    sink = TranscriptSink(session_id=session_id, writer=fake_writer)
    sink.submit("user", "Msg 1", event_id=uuid.uuid4())

    results = await asyncio.gather(sink.close(), sink.close(), sink.close())
    assert all(r is True for r in results)
    assert await sink.close() is True


@pytest.mark.asyncio
async def test_sink_caller_cancellation_preserves_semantics_and_allows_subsequent_closer():
    """验证 caller 取消在捕获 CancelledError 时所有自有任务已完成且 closed=True，后续 close 可复用布尔结果。"""
    session_id = str(uuid.uuid4())
    writer_started = asyncio.Event()
    release_writer = asyncio.Event()

    async def controlled_writer(*args, **kwargs):
        writer_started.set()
        await release_writer.wait()
        return MagicMock()

    sink = TranscriptSink(
        session_id=session_id, writer=controlled_writer, drain_timeout=2.0
    )
    sink.submit("user", "Msg to be cancelled by caller 1", event_id=uuid.uuid4())

    # 启动 caller 1
    caller1_task = asyncio.create_task(sink.close())
    await writer_started.wait()

    # 取消 caller 1（此时 writer 仍受 release_writer 阻塞）
    caller1_task.cancel()

    # 确定性释放 writer，允许底层 shared close 任务继续完成
    release_writer.set()

    with pytest.raises(asyncio.CancelledError):
        await caller1_task

    # 关键断言：当 caller 1 捕获到 CancelledError 时，断言底层已经收束完毕！
    # closed 为 True，自有任务已 done！
    snap = sink.snapshot()
    assert snap.closed is True
    assert sink._worker_task.done() is True
    if sink._notify_task is not None:
        assert sink._notify_task.done() is True

    # caller 2 随后调用 close，必须获得底层执行完毕的布尔结果 True，而不是被 poison
    caller2_result = await sink.close()
    assert caller2_result is True
    assert snap.succeeded == 1
    assert snap.failed == 0


@pytest.mark.asyncio
async def test_sink_notify_task_cancellation_does_not_poison_shared_close():
    """验证通知子任务自身抛出 CancelledError 时，不 poison 共享 close，正常完成 closed=True 并返回 False。"""
    session_id = str(uuid.uuid4())
    notify_started = asyncio.Event()
    release_notify = asyncio.Event()

    async def cancelling_on_failure(reason):
        notify_started.set()
        await release_notify.wait()
        # 通知任务内部发生取消（自身 raise CancelledError）
        raise asyncio.CancelledError()

    sink = TranscriptSink(
        session_id=session_id,
        writer=AsyncMock(side_effect=RuntimeError("write failed")),
        on_failure=cancelling_on_failure,
        max_attempts=1,
        drain_timeout=1.0,
    )

    sink.submit("user", "Msg causing failure", event_id=uuid.uuid4())
    await notify_started.wait()

    # 启动外部 closer
    close_task = asyncio.create_task(sink.close())

    # 释放 notify，让其在收束期间抛出 CancelledError
    release_notify.set()

    # 外部 closer 必须正常返回 False，不能被子任务的 CancelledError 污染！
    result = await close_task
    assert result is False

    # 终态检查：closed=True，所有自有任务 done
    snap = sink.snapshot()
    assert snap.closed is True
    assert sink._worker_task.done() is True
    assert sink._notify_task is not None
    assert sink._notify_task.done() is True

    # 后续再次调用 close 正常复用返回 False，绝不抛 CancelledError
    assert await sink.close() is False


# ===========================================================================
# 6. 深拷贝、未传时间戳保持与 Canary 安全审计
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_deep_copy_and_timestamp_preservation():
    """验证输入字典后续修改不影响实际写，未传时间戳严格保持 None 快照。"""
    session_id = str(uuid.uuid4())
    captured_payloads = []

    async def recording_writer(sid, role, content, **kwargs):
        captured_payloads.append(
            {"role": role, "content": content, "emotion": kwargs.get("emotion_state")}
        )
        return MagicMock()

    sink = TranscriptSink(session_id=session_id, writer=recording_writer)

    mutable_emotion = {"anxiety_level": 0.5, "nested": {"val": 10}}
    ev = uuid.uuid4()
    sink.submit("user", "Original text", event_id=ev, emotion_state=mutable_emotion)

    mutable_emotion["anxiety_level"] = 0.99
    mutable_emotion["nested"]["val"] = 999

    await sink.close()

    assert len(captured_payloads) == 1
    assert captured_payloads[0]["emotion"]["anxiety_level"] == 0.5
    assert captured_payloads[0]["emotion"]["nested"]["val"] == 10


@pytest.mark.asyncio
async def test_sink_safe_logging_no_canary_leak(sink_log_guard):
    """验证非法输入、敏感正文、超时与异常均不回显 Canary，record 字典绝对干净。"""
    session_id = str(uuid.uuid4())

    async def canary_writer(*args, **kwargs):
        raise RuntimeError(f"Database error with canary {CANARY}")

    sink = TranscriptSink(
        session_id=session_id,
        writer=canary_writer,
        max_attempts=1,
        drain_timeout=0.2,
    )

    sink.submit(
        "user",
        f"Sensitive user content with {CANARY}",
        event_id=uuid.uuid4(),
    )
    await sink.close()


# ===========================================================================
# 7. SDK entrypoint 双入口真实排空与失败清理
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_real_entrypoint_two_entries_and_shutdown_callback_drain():
    """验证 entrypoint 两入口（user turn + assistant event）真实写入后，捕获执行 shutdown callback 证明排空。"""
    ctx = MagicMock(spec=JobContext)
    ctx._info = MagicMock()
    ctx.room = MagicMock()
    session_id = str(uuid.uuid4())
    ctx.room.name = session_id
    ctx.room.disconnect = AsyncMock()
    ctx.room.local_participant = MagicMock()
    ctx.room.local_participant.publish_data = AsyncMock()
    ctx.connect = AsyncMock()
    ctx.wait_for_participant = AsyncMock()

    shutdown_callbacks = []
    ctx.add_shutdown_callback = MagicMock(side_effect=shutdown_callbacks.append)

    mock_settings = MagicMock(is_custom_mode=False)
    captured_handlers = {}

    def mock_on(event_name):
        def decorator(fn):
            captured_handlers[event_name] = fn
            return fn

        return decorator

    mock_session = MagicMock()
    mock_session.on = mock_on
    mock_session.start = AsyncMock()

    captured_sink = None

    class InstrumentedAgent(EchoTalkAgent):
        def __init__(self, *args, **kwargs):
            nonlocal captured_sink
            super().__init__(*args, **kwargs)
            captured_sink = self._sink

    written_items = []

    async def recording_writer(sid, role, content, **kwargs):
        written_items.append((sid, role, content, kwargs.get("event_id")))
        return MagicMock(spec=Transcript)

    with (
        patch("livekit_agent.agent._fetch_user_settings", return_value=mock_settings),
        patch("livekit_agent.agent._fetch_session_context", return_value=None),
        patch(
            "livekit_agent.plugin_factory.PluginFactory.from_system_defaults",
            return_value={},
        ),
        patch("livekit_agent.agent.EchoTalkAgent", side_effect=InstrumentedAgent),
        patch("livekit_agent.agent.AgentSession", return_value=mock_session),
        patch(
            "livekit_agent.transcript_sink.save_transcript",
            side_effect=recording_writer,
        ),
    ):
        await entrypoint(ctx)

        assert captured_sink is not None
        assert captured_sink.accepting is True
        assert len(shutdown_callbacks) == 1

        # 1. 模拟入口 A：用户发言完成
        user_msg = llm.ChatMessage(
            role="user", content=["Hello AI!"], id="item_user_entry_001"
        )
        turn_ctx = MagicMock()
        # 调用 EchoTalkAgent 钩子
        agent_inst_obj = InstrumentedAgent(
            session_id=session_id, instructions="test", sink=captured_sink
        )
        await agent_inst_obj.on_user_turn_completed(turn_ctx, user_msg)

        # 2. 模拟入口 B：助教回复事件
        asst_msg = llm.ChatMessage(
            role="assistant", content=["Hello user!"], id="item_asst_entry_002"
        )
        asst_event = ConversationItemAddedEvent(item=asst_msg)
        assert "conversation_item_added" in captured_handlers
        captured_handlers["conversation_item_added"](asst_event)

        snap = captured_sink.snapshot()
        assert snap.accepted == 2

        # 3. 真实执行捕获的 shutdown callback 并验证排空
        close_cb = shutdown_callbacks[0]
        res = await close_cb()
        assert res is True

        final_snap = captured_sink.snapshot()
        assert final_snap.closed is True
        assert final_snap.succeeded == 2
        assert final_snap.failed == 0
        assert captured_sink._queue.empty() is True

        # 再次调用幂等返回 True
        assert await close_cb() is True


@pytest.mark.asyncio
async def test_sink_entrypoint_start_failure_asserts_sink_closed_and_tasks_done():
    """验证语音管线启动失败（或被取消）时，断言真实 Sink 必须 closed 且自有 worker 任务 done。"""
    ctx = MagicMock(spec=JobContext)
    ctx._info = MagicMock()
    ctx.room = MagicMock()
    ctx.room.name = str(uuid.uuid4())
    ctx.room.disconnect = AsyncMock()
    ctx.room.local_participant = MagicMock()
    ctx.room.local_participant.publish_data = AsyncMock()
    ctx.connect = AsyncMock()
    ctx.wait_for_participant = AsyncMock()
    ctx.add_shutdown_callback = MagicMock()

    mock_settings = MagicMock(is_custom_mode=False)
    captured_sink = None

    class InstrumentedAgent(EchoTalkAgent):
        def __init__(self, *args, **kwargs):
            nonlocal captured_sink
            super().__init__(*args, **kwargs)
            captured_sink = self._sink

    with (
        patch("livekit_agent.agent._fetch_user_settings", return_value=mock_settings),
        patch("livekit_agent.agent._fetch_session_context", return_value=None),
        patch(
            "livekit_agent.plugin_factory.PluginFactory.from_system_defaults",
            return_value={},
        ),
        patch("livekit_agent.agent.EchoTalkAgent", side_effect=InstrumentedAgent),
        patch(
            "livekit_agent.agent.AgentSession.start",
            side_effect=RuntimeError("Pipeline crash"),
        ),
    ):
        await entrypoint(ctx)

    assert captured_sink is not None
    assert captured_sink.closed is True
    assert captured_sink._worker_task.done() is True


@pytest.mark.asyncio
async def test_sink_entrypoint_early_failure_asserts_sink_closed_and_tasks_done():
    """验证用户配置查询等早期失败时，断言真实 Sink 依然保证 closed 且 worker done。"""
    ctx = MagicMock(spec=JobContext)
    ctx._info = MagicMock()
    ctx.room = MagicMock()
    ctx.room.name = str(uuid.uuid4())
    ctx.room.disconnect = AsyncMock()
    ctx.room.local_participant = MagicMock()
    ctx.room.local_participant.publish_data = AsyncMock()
    ctx.connect = AsyncMock()
    ctx.wait_for_participant = AsyncMock()

    created_sinks = []
    orig_sink_init = TranscriptSink.__init__

    def instrumented_sink_init(self, *args, **kwargs):
        orig_sink_init(self, *args, **kwargs)
        created_sinks.append(self)

    with (
        patch.object(TranscriptSink, "__init__", instrumented_sink_init),
        patch(
            "livekit_agent.agent._fetch_user_settings",
            side_effect=RuntimeError("DB query failed"),
        ),
    ):
        await entrypoint(ctx)

    assert len(created_sinks) == 1
    sink = created_sinks[0]
    assert sink.closed is True
    assert sink._worker_task.done() is True


@pytest.mark.asyncio
async def test_sink_entrypoint_registration_failure_asserts_sink_closed_and_tasks_done():
    """验证 shutdown callback 注册抛出异常时，断言真实 Sink 立即关闭且 worker 任务 done，且异常向外抛出。"""
    ctx = MagicMock(spec=JobContext)
    ctx.room = MagicMock()
    ctx.room.name = str(uuid.uuid4())
    ctx.room.disconnect = AsyncMock()
    ctx.room.local_participant = MagicMock()
    ctx.room.local_participant.publish_data = AsyncMock()
    ctx.connect = AsyncMock()
    ctx.wait_for_participant = AsyncMock()

    created_sinks = []
    orig_sink_init = TranscriptSink.__init__

    def instrumented_sink_init(self, *args, **kwargs):
        orig_sink_init(self, *args, **kwargs)
        created_sinks.append(self)

    # 模拟 add_shutdown_callback 抛出 RuntimeError
    ctx.add_shutdown_callback = MagicMock(
        side_effect=RuntimeError("shutdown callback registration failed")
    )

    with patch.object(TranscriptSink, "__init__", instrumented_sink_init):
        with pytest.raises(RuntimeError, match="registration failed"):
            await entrypoint(ctx)

    assert len(created_sinks) == 1
    sink = created_sinks[0]
    assert sink.closed is True
    assert sink._worker_task.done() is True


# ===========================================================================
# 8. 专用 PostgreSQL 真实落库与重发单条验证
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_default_writer_reaches_real_service(pg_env):
    """无 writer 注入时，延迟 wrapper 必须触达真实 transcript service。"""
    user_id = await pg_env.create_user(email_prefix="sink-default-writer")
    session_id = await pg_env.create_session(user_id)
    event_id = uuid.uuid4()

    sink = TranscriptSink(session_id=str(session_id))
    submit_kwargs = {
        "event_id": event_id,
        "timestamp_ms": 1_700_000_000_000,
    }
    sink.submit("assistant", "Default writer integration.", **submit_kwargs)

    assert await sink.close() is True

    async with pg_env.session_factory() as db:
        result = await db.execute(
            select(Transcript).where(
                Transcript.session_id == session_id,
                Transcript.event_id == event_id,
            )
        )
        transcript = result.scalar_one()
        assert transcript.content == "Default writer integration."
        assert transcript.timestamp_ms == submit_kwargs["timestamp_ms"]


@pytest.mark.asyncio
async def test_sink_with_real_pg_and_idempotent_commit_ack_retry(pg_env):
    """验证通过真实专用 PostgreSQL 接入 Sink，处理不确定提交确认丢失重发，最终单条记录。"""
    user_id = await pg_env.create_user()
    session_id = await pg_env.create_session(user_id)
    sid_str = str(session_id)
    event_id = uuid.uuid4()
    content = "Real PG sink turn test."

    first_call = True

    async def writer_with_simulated_ack_loss(*args, **kwargs):
        nonlocal first_call
        res = await save_transcript(*args, **kwargs)
        if first_call:
            first_call = False
            return None
        return res

    sink = TranscriptSink(
        session_id=sid_str,
        writer=writer_with_simulated_ack_loss,
        max_attempts=3,
        backoff=(0.01, 0.01),
    )

    sink.submit("assistant", content, event_id=event_id)
    closed_ok = await sink.close()
    assert closed_ok is True

    snap = sink.snapshot()
    assert snap.accepted == 1
    assert snap.succeeded == 1
    assert snap.failed == 0

    async with pg_env.session_factory() as db:
        res = await db.execute(
            select(func.count(Transcript.id)).where(
                Transcript.session_id == session_id,
                Transcript.event_id == event_id,
            )
        )
        assert res.scalar_one() == 1
