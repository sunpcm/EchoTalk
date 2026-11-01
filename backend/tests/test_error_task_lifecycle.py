"""
EchoTalk LiveKit AgentJobOrchestrator 运行时错误通知任务所有权与关闭收束测试 (RF-09 / A57)。

覆盖契约：
1. 实例级自有通知任务追踪：活动阶段每次符合分类的错误产生一次通知，基础轨与可恢复错误不派发；
   完成回调移除任务并安全检索异常，失败仅记录静态安全日志，绝不泄露异常正文/密钥/room 原文或堆栈；
   CancelledError 安全检索无 unretrieved 告警。
2. 正常 run 成功返回后不提前取消在途通知或关闭健康 Sink；单一组合 shutdown callback 替代原
   sink.close 注册，保留原 sink.close 布尔返回值语义。
3. shutdown 同步标记 closing 并阻止迟到 error 回调创建新通知；既有通知享有命名类常量
   ERROR_TASK_DRAIN_TIMEOUT_SECONDS = 2.0 秒合作式排空预算（支持短值 patch），到期取消并等待
   pending 任务；Sink 关闭保留其 8.0s 排空预算。
4. 通知内 ctx.room.disconnect 触发 shutdown callback 重入时排除当前任务，不自锁、不自取消；
   重复与并发 close 幂等安全。
5. setup 失败、start 失败及 run 取消时收束已派发通知并关闭 Sink；普通通知异常不阻断其余资源关闭；
   close 自身被取消时仍取消并等待自有 pending 任务随后传播 CancelledError；Sink 异常原样传播。
6. 两个并发 Job 完全隔离。
"""

import asyncio
import gc
import json
import logging
import uuid
from typing import Any, Awaitable, Callable, Iterable
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from livekit.agents import APIStatusError, ErrorEvent, JobContext

from livekit_agent.error_mapper import SAFE_ERROR_MESSAGES
from livekit_agent.job_orchestrator import AgentJobOrchestrator
from livekit_agent.transcript_sink import TranscriptSink

CANARY = "SECRET_CANARY_RF09_A57_TOKEN_889900_NEVER_LEAK"
TEST_ERROR_LIFECYCLE_BUDGET_SECONDS: float = 2.0

_OBSERVED_TASKS: set[asyncio.Task[Any]] = set()


def _register_observed_task(task: asyncio.Task[Any]) -> None:
    _OBSERVED_TASKS.add(task)

    def _on_done(t: asyncio.Task[Any]) -> None:
        _OBSERVED_TASKS.discard(t)

    task.add_done_callback(_on_done)


async def _wait_bounded(
    awaitable: Awaitable[Any],
    timeout: float = TEST_ERROR_LIFECYCLE_BUDGET_SECONDS,
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
    timeout: float = TEST_ERROR_LIFECYCLE_BUDGET_SECONDS,
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


def _collect_orch_tasks(orch: AgentJobOrchestrator | None) -> list[asyncio.Task[Any]]:
    if orch is None:
        return []
    tasks: list[asyncio.Task[Any]] = list(orch.error_tasks)
    sink_close_task = getattr(orch, "_sink_close_task", None)
    if isinstance(sink_close_task, asyncio.Task):
        tasks.append(sink_close_task)
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
    orch: AgentJobOrchestrator | None = None,
    sinks: Iterable[TranscriptSink | None] | None = None,
    timeout: float = 1.0,
    name: str = "test_resources",
) -> None:
    """一次性收集测试装置拥有的所有任务，协调解开依赖并收束，保证前步失败也继续清理其余资源。"""
    all_sinks = list(sinks or [])
    if orch is not None and orch.sink is not None and orch.sink not in all_sinks:
        all_sinks.append(orch.sink)

    all_tasks: set[asyncio.Task[Any]] = set()
    if tasks:
        for t in tasks:
            if isinstance(t, asyncio.Task):
                all_tasks.add(t)
    for t in _collect_orch_tasks(orch):
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


class AssertNoCanaryLogHandler(logging.Handler):
    """捕获并严格断言日志记录不含 Canary、不含 exc_info 或 stack_info。"""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)

    def assert_clean(self) -> None:
        for r in self.records:
            msg = r.getMessage()
            assert CANARY not in msg, f"Canary leaked in formatted message: {msg}"
            assert CANARY not in str(r.msg), f"Canary leaked in raw msg: {r.msg}"
            if r.args:
                assert CANARY not in str(r.args), f"Canary leaked in args: {r.args}"
            assert r.exc_info is None, f"exc_info must be None, got: {r.exc_info}"
            assert getattr(r, "stack_info", None) is None, (
                f"stack_info must be None, got: {r.stack_info}"
            )
            for k, v in r.__dict__.items():
                if k in ("msg", "args", "exc_info", "stack_info"):
                    continue
                assert CANARY not in str(v), f"Canary leaked in field {k}: {v}"


def _make_mock_ctx(room_name: str | None = None) -> MagicMock:
    ctx = MagicMock(spec=JobContext)
    ctx.room = MagicMock()
    ctx.room.name = room_name if room_name is not None else str(uuid.uuid4())
    ctx.room.disconnect = AsyncMock()
    ctx.room.local_participant = MagicMock()
    ctx.room.local_participant.publish_data = AsyncMock()
    ctx.connect = AsyncMock()
    ctx.wait_for_participant = AsyncMock()
    ctx.shutdown_callbacks = []

    def _add_shutdown(cb: Callable[..., Any]) -> None:
        ctx.shutdown_callbacks.append(cb)

    ctx.add_shutdown_callback = MagicMock(side_effect=_add_shutdown)
    return ctx


def _make_capturing_session() -> tuple[MagicMock, dict[str, Callable[..., Any]]]:
    handlers: dict[str, Callable[..., Any]] = {}

    def _on(event_name: str):
        def _decorator(fn: Callable[..., Any]):
            handlers[event_name] = fn
            return fn

        return _decorator

    session = MagicMock()
    session.on = _on
    session.start = AsyncMock()
    return session, handlers


def _make_error_event(
    exc: Exception,
    *,
    recoverable: bool = False,
    err_type: str = "runtime",
) -> MagicMock:
    ev = MagicMock(spec=ErrorEvent)
    ev.error = MagicMock()
    ev.error.error = exc
    ev.error.type = err_type
    ev.error.recoverable = recoverable
    return ev


@pytest.mark.asyncio
async def test_active_error_tasks_tracked_and_removed_on_normal_completion():
    """验证活动阶段每次匹配错误均产生独立追踪任务，完成后自动移除，可恢复/基础轨不派发。"""
    ctx = _make_mock_ctx()
    session, handlers = _make_capturing_session()

    gate1 = asyncio.Event()
    gate2 = asyncio.Event()
    entered1 = asyncio.Event()
    entered2 = asyncio.Event()
    calls: list[tuple[Any, str, str]] = []

    async def _gated_send_error(
        c: JobContext,
        code: str,
        message: str | None = None,
        fallback_code: str = "ERR_SYSTEM_RUNTIME",
    ) -> None:
        calls.append((c, code, fallback_code))
        if len(calls) == 1:
            entered1.set()
            await gate1.wait()
        else:
            entered2.set()
            await gate2.wait()

    orch = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: session,
        send_error_fn=_gated_send_error,
    )

    await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

    assert "error" in handlers
    error_cb = handlers["error"]

    try:
        # 1. 可恢复错误不派发任务
        error_cb(_make_error_event(Exception("temp warning"), recoverable=True))
        assert len(orch._error_tasks) == 0
        assert len(calls) == 0

        # 2. 连续两次不可恢复错误（401 与普通不可恢复）各派发一个独立任务，不合并
        error_cb(
            _make_error_event(
                APIStatusError(message="unauthorized", status_code=401),
                recoverable=False,
            )
        )
        error_cb(_make_error_event(RuntimeError("fatal pipeline"), recoverable=False))

        await _wait_bounded(entered1.wait(), name="entered1")
        await _wait_bounded(entered2.wait(), name="entered2")
        assert len(orch._error_tasks) == 2
        assert len(orch.error_tasks) == 2
        assert calls == [
            (ctx, "ERR_CUSTOM_RUNTIME_AUTH", "ERR_CUSTOM_RUNTIME"),
            (ctx, "ERR_CUSTOM_RUNTIME", "ERR_CUSTOM_RUNTIME"),
        ]

        # 3. 释放第一个任务，验证完成回调在活动阶段立即移除该任务（有界轮询，避免 sleep(0) 无限循环）
        gate1.set()
        await _poll_bounded(
            lambda: len(orch._error_tasks) == 1,
            name="wait_error_task_removed_1",
        )
        assert len(orch._error_tasks) == 1

        # 4. 释放第二个任务，验证集合清空且 Sink 仍保持健康开启
        gate2.set()
        await _poll_bounded(
            lambda: len(orch._error_tasks) == 0,
            name="wait_error_task_removed_2",
        )
        assert len(orch._error_tasks) == 0
        assert orch.sink is not None
        assert orch.sink.closed is False
        assert orch.sink.accepting is True

        # 5. 切换为基础轨时，不可恢复错误也不派发
        orch.set_custom_mode(False)
        error_cb(
            _make_error_event(
                APIStatusError(message="sys 401", status_code=401),
                recoverable=False,
            )
        )
        assert len(orch._error_tasks) == 0
        assert len(calls) == 2

        assert await _wait_bounded(ctx.shutdown_callbacks[0](), name="shutdown") is True
        assert orch.sink.closed is True
    finally:
        gate1.set()
        gate2.set()
        if orch is not None:
            await _cleanup_test_resources(orch=orch, timeout=1.0)


@pytest.mark.asyncio
async def test_error_task_exception_retrieved_with_static_safe_log_and_no_canary():
    """验证通知任务异常由完成回调安全检索，仅写静态安全日志，零 Canary/堆栈泄露，不触发未检索异常告警。"""
    ctx = _make_mock_ctx(room_name=f"room-raw-{CANARY}")
    ctx.room.disconnect.side_effect = RuntimeError(f"disconnect boom {CANARY}")
    session, handlers = _make_capturing_session()

    logger = logging.getLogger("echotalk-agent")
    log_guard = AssertNoCanaryLogHandler()
    old_level = logger.level
    logger.addHandler(log_guard)
    logger.setLevel(logging.DEBUG)

    loop = asyncio.get_running_loop()
    old_exc_handler = loop.get_exception_handler()
    unhandled_loop_contexts: list[dict[str, Any]] = []

    def _loop_exc_handler(
        _loop: asyncio.AbstractEventLoop, context: dict[str, Any]
    ) -> None:
        unhandled_loop_contexts.append(context)

    loop.set_exception_handler(_loop_exc_handler)
    try:
        orch = AgentJobOrchestrator(ctx, session_factory=lambda: session)
        await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

        error_cb = handlers["error"]
        error_cb(
            _make_error_event(
                RuntimeError(f"upstream crash with secret {CANARY}"),
                recoverable=False,
            )
        )
        assert len(orch._error_tasks) == 1
        task = next(iter(orch._error_tasks))

        await asyncio.wait({task})
        await asyncio.sleep(0)
        del task
        gc.collect()
        await asyncio.sleep(0)

        assert len(orch._error_tasks) == 0
        assert unhandled_loop_contexts == []

        # 验证记录了静态安全警告且不含任何 Canary 或 traceback
        log_guard.assert_clean()
        warning_messages = [
            r.getMessage() for r in log_guard.records if r.levelno == logging.WARNING
        ]
        assert any(
            "运行时错误通知任务执行失败: session=unknown" in m for m in warning_messages
        )

        # 普通通知异常不阻止后续 Sink 关闭
        assert await ctx.shutdown_callbacks[0]() is True
        assert orch.sink is not None
        assert orch.sink.closed is True
    finally:
        loop.set_exception_handler(old_exc_handler)
        if orch is not None:
            await _cleanup_test_resources(orch=orch, timeout=1.0)
        logger.removeHandler(log_guard)
        logger.setLevel(old_level)


@pytest.mark.asyncio
async def test_error_task_cancelled_error_retrieved_safely():
    """验证通知任务发生 CancelledError 时被安全检索，无 unretrieved 告警且任务集合清空。"""
    ctx = _make_mock_ctx()
    entered = asyncio.Event()
    hang = asyncio.Event()

    async def _blocking_publish(**_kwargs: Any) -> None:
        entered.set()
        await hang.wait()

    ctx.room.local_participant.publish_data.side_effect = _blocking_publish
    session, handlers = _make_capturing_session()

    loop = asyncio.get_running_loop()
    old_exc_handler = loop.get_exception_handler()
    unhandled: list[dict[str, Any]] = []
    loop.set_exception_handler(lambda _l, c: unhandled.append(c))

    try:
        orch = AgentJobOrchestrator(ctx, session_factory=lambda: session)
        await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

        handlers["error"](_make_error_event(RuntimeError("err"), recoverable=False))
        await entered.wait()
        assert len(orch._error_tasks) == 1
        task = next(iter(orch._error_tasks))

        task.cancel()
        await asyncio.wait({task})
        await asyncio.sleep(0)
        del task
        gc.collect()
        await asyncio.sleep(0)

        assert len(orch._error_tasks) == 0
        assert unhandled == []
        assert await ctx.shutdown_callbacks[0]() is True
    finally:
        hang.set()
        loop.set_exception_handler(old_exc_handler)
        if orch is not None:
            await _cleanup_test_resources(orch=orch, timeout=1.0)


@pytest.mark.asyncio
async def test_successful_run_does_not_cancel_error_tasks_or_close_healthy_sink():
    """验证正常 run 成功返回后不提前取消通知或关闭健康 Sink，生命周期延续至 Job shutdown。"""
    session_id = str(uuid.uuid4())
    ctx = _make_mock_ctx(room_name=session_id)
    session, handlers = _make_capturing_session()

    entered_notify = asyncio.Event()
    release_notify = asyncio.Event()

    async def _slow_publish(**_kwargs: Any) -> None:
        entered_notify.set()
        await release_notify.wait()

    ctx.room.local_participant.publish_data.side_effect = _slow_publish

    async def _start_and_emit_error(*_args: Any, **_kwargs: Any) -> None:
        handlers["error"](
            _make_error_event(RuntimeError("early runtime error"), recoverable=False)
        )
        await entered_notify.wait()

    session.start.side_effect = _start_and_emit_error

    written_items: list[str] = []

    async def _writer(sid: str, role: str, content: str, **_kw: Any) -> bool:
        written_items.append(content)
        return True

    orch = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: session,
        sink_factory=lambda session_id, on_failure: TranscriptSink(
            session_id=session_id,
            on_failure=on_failure,
            writer=_writer,
        ),
    )

    await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

    # run() 已成功返回，但通知任务仍在途，且 Sink 保持健康可写
    assert orch.started is True
    assert orch.closing is False
    assert orch.closed is False
    assert len(orch._error_tasks) == 1
    in_flight_task = next(iter(orch._error_tasks))
    assert not in_flight_task.done()
    assert not in_flight_task.cancelled()

    assert orch.sink is not None
    assert orch.sink.closed is False
    assert orch.sink.accepting is True
    assert (
        orch.sink.submit(
            "assistant",
            "Still active after run",
            event_id=uuid.uuid4(),
        )
        is True
    )

    # 仅注册了单一组合 shutdown callback
    assert len(ctx.shutdown_callbacks) == 1
    assert ctx.shutdown_callbacks[0] == orch.close

    # 触发 Job shutdown 并释放通知门控
    shutdown_task = asyncio.create_task(ctx.shutdown_callbacks[0]())
    await asyncio.sleep(0)
    assert orch.closing is True
    release_notify.set()

    assert await shutdown_task is True
    assert len(orch._error_tasks) == 0
    assert written_items == ["Still active after run"]
    assert ctx.room.disconnect.await_count == 1
    assert orch.sink.closed is True


@pytest.mark.asyncio
async def test_shutdown_cooperative_drain_within_budget_and_bool_return_semantics():
    """验证 shutdown 在 2.0s 合作式预算内等待通知完成，且保留原 Sink.close() 的 True/False 返回语义。"""
    assert AgentJobOrchestrator.ERROR_TASK_DRAIN_TIMEOUT_SECONDS == 2.0

    # 1. Sink.close() 返回 True
    ctx1 = _make_mock_ctx()
    session1, handlers1 = _make_capturing_session()
    entered = asyncio.Event()
    gate = asyncio.Event()

    async def _gated_publish(**_kwargs: Any) -> None:
        entered.set()
        await gate.wait()

    ctx1.room.local_participant.publish_data.side_effect = _gated_publish
    orch1 = AgentJobOrchestrator(ctx1, session_factory=lambda: session1)
    await orch1.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

    handlers1["error"](_make_error_event(RuntimeError("err"), recoverable=False))
    await entered.wait()

    close_task = asyncio.create_task(ctx1.shutdown_callbacks[0]())
    await asyncio.sleep(0)
    assert orch1.closing is True
    assert not close_task.done()

    gate.set()
    assert await close_task is True
    assert ctx1.room.local_participant.publish_data.await_count == 1
    assert ctx1.room.disconnect.await_count == 1
    assert len(orch1._error_tasks) == 0

    # 2. Sink.close() 返回 False（例如转录落库失败）时，组合 callback 原样返回 False
    session_id2 = str(uuid.uuid4())
    ctx2 = _make_mock_ctx(room_name=session_id2)
    session2, _ = _make_capturing_session()

    async def _failing_writer(*_args: Any, **_kwargs: Any) -> bool:
        return False

    orch2 = AgentJobOrchestrator(
        ctx2,
        session_factory=lambda: session2,
        sink_factory=lambda session_id, on_failure: TranscriptSink(
            session_id=session_id,
            on_failure=None,
            writer=_failing_writer,
            max_attempts=1,
        ),
    )
    await orch2.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), False)))
    assert orch2.sink is not None
    assert orch2.sink.submit("user", "will fail", event_id=uuid.uuid4()) is True

    assert await ctx2.shutdown_callbacks[0]() is False
    assert orch2.sink.closed is True


@pytest.mark.asyncio
async def test_shutdown_timeout_cancels_and_awaits_pending_error_tasks_preserving_sink_8s_budget():
    """
    验证错误通知任务超过 ERROR_TASK_DRAIN_TIMEOUT_SECONDS 时被取消并等待收束；
    同时 Sink 仍执行其自有 8.0s 排空预算，不把错误通知预算误作 Sink 预算。
    """
    session_id = str(uuid.uuid4())
    ctx = _make_mock_ctx(room_name=session_id)
    session, handlers = _make_capturing_session()

    error_entered = asyncio.Event()
    error_cancelled_cleanup = asyncio.Event()
    never_set = asyncio.Event()

    async def _hung_send_error(*_args: Any, **_kwargs: Any) -> None:
        error_entered.set()
        try:
            await never_set.wait()
        except asyncio.CancelledError:
            await asyncio.sleep(0)
            error_cancelled_cleanup.set()
            raise

    writer_entered = asyncio.Event()
    writer_release = asyncio.Event()

    async def _slow_writer(*_args: Any, **_kwargs: Any) -> bool:
        writer_entered.set()
        await writer_release.wait()
        return True

    orch = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: session,
        sink_factory=lambda session_id, on_failure: TranscriptSink(
            session_id=session_id,
            on_failure=on_failure,
            writer=_slow_writer,
            drain_timeout=8.0,
        ),
        send_error_fn=_hung_send_error,
    )

    close_task: asyncio.Task[bool] | None = None
    try:
        with patch.object(
            AgentJobOrchestrator, "ERROR_TASK_DRAIN_TIMEOUT_SECONDS", 0.02
        ):
            await _wait_bounded(
                orch.run(
                    lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True))
                ),
                name="orch_run_budget",
            )

            # 提交一条需要等待排空的转录
            assert orch.sink is not None
            assert (
                orch.sink.submit("user", "important transcript", event_id=uuid.uuid4())
                is True
            )
            await _wait_bounded(writer_entered.wait(), name="writer_entered")

            # 触发挂起的错误通知任务
            handlers["error"](
                _make_error_event(RuntimeError("hang"), recoverable=False)
            )
            await _wait_bounded(error_entered.wait(), name="error_entered")
            assert len(orch._error_tasks) == 1
            hung_task = next(iter(orch._error_tasks))

            # 启动组合关闭：0.02s 后错误通知任务必须被取消并完成清理，随后继续等待 Sink 排空
            close_task = asyncio.create_task(ctx.shutdown_callbacks[0]())
            await _wait_bounded(
                error_cancelled_cleanup.wait(), name="error_cancelled_cleanup"
            )
            await _poll_bounded(
                lambda: hung_task.done() and len(orch._error_tasks) == 0,
                name="wait_hung_task_and_error_tasks_done",
            )

            assert hung_task.done() is True
            assert hung_task.cancelled() is True
            assert len(orch._error_tasks) == 0
            # Sink 此时仍在等待 writer_release（未因 0.02s 错误通知预算被提前掐断）
            assert not close_task.done()
            assert orch.sink.closed is False

            writer_release.set()
            assert await _wait_bounded(close_task, name="close_task") is True
            assert orch.sink.closed is True
            assert orch.sink.snapshot().succeeded == 1
    finally:
        writer_release.set()
        never_set.set()
        await _cleanup_test_resources(tasks=[close_task], orch=orch, timeout=1.0)


@pytest.mark.asyncio
async def test_late_error_callback_during_and_after_shutdown_spawns_zero_tasks():
    """验证 shutdown 开始同步标记 closing，关闭期间及关闭后迟到的 error 回调零通知。"""
    ctx = _make_mock_ctx()
    session, handlers = _make_capturing_session()

    first_entered = asyncio.Event()
    first_release = asyncio.Event()

    async def _gated_publish(**_kwargs: Any) -> None:
        first_entered.set()
        await first_release.wait()

    ctx.room.local_participant.publish_data.side_effect = _gated_publish
    orch = AgentJobOrchestrator(ctx, session_factory=lambda: session)
    await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

    error_cb = handlers["error"]
    error_cb(_make_error_event(RuntimeError("first"), recoverable=False))
    await first_entered.wait()
    assert len(orch._error_tasks) == 1

    # 启动关闭：同步标记 closing
    close_coro = ctx.shutdown_callbacks[0]()
    close_task = asyncio.create_task(close_coro)
    await asyncio.sleep(0)
    assert orch.closing is True

    # 关闭排空进行中触发迟到回调 -> 零新任务
    error_cb(_make_error_event(RuntimeError("late during closing"), recoverable=False))
    assert len(orch._error_tasks) == 1

    first_release.set()
    assert await close_task is True
    assert orch.closed is True
    assert len(orch._error_tasks) == 0

    # 关闭完成后再次触发迟到回调 -> 零新任务
    error_cb(_make_error_event(RuntimeError("late after closed"), recoverable=False))
    assert len(orch._error_tasks) == 0
    assert ctx.room.local_participant.publish_data.await_count == 1


@pytest.mark.asyncio
async def test_setup_failure_start_failure_and_run_cancellation_clean_up_tasks_and_sink():
    """验证 setup 失败、start 失败及 run 取消时均收束已派发通知并关闭 Sink。"""
    # 1. setup 失败（返回 None）时清理已派发通知并关闭 Sink
    ctx_setup = _make_mock_ctx()
    setup_task_cleaned = asyncio.Event()

    async def _setup_send_error(*_args: Any, **_kwargs: Any) -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            setup_task_cleaned.set()
            raise

    orch_setup = AgentJobOrchestrator(ctx_setup, send_error_fn=_setup_send_error)
    with patch.object(orch_setup, "ERROR_TASK_DRAIN_TIMEOUT_SECONDS", 0.01):

        async def _failing_setup(_sid: str, _sink: TranscriptSink):
            orch_setup.set_custom_mode(True)
            orch_setup.on_agent_error(
                _make_error_event(RuntimeError("err during setup"), recoverable=False)
            )
            assert len(orch_setup._error_tasks) == 1
            return None

        await orch_setup.run(_failing_setup)

    assert setup_task_cleaned.is_set() is True
    assert len(orch_setup._error_tasks) == 0
    assert orch_setup.sink is not None
    assert orch_setup.sink.closed is True
    assert orch_setup.closed is True

    # 2. start 失败且期间触发了真实保存的 error 回调（含普通通知异常），仍完成清理与 Sink 关闭
    ctx_start = _make_mock_ctx()
    session_start, handlers_start = _make_capturing_session()

    async def _flaky_send_error(
        c: JobContext,
        code: str,
        message: str | None = None,
        fallback_code: str = "ERR_SYSTEM_RUNTIME",
    ) -> None:
        if code == "ERR_CUSTOM_RUNTIME_AUTH":
            raise RuntimeError("runtime error notification failed")
        await c.room.local_participant.publish_data(
            payload=json.dumps(
                {
                    "type": "agent_error",
                    "code": code,
                    "message": SAFE_ERROR_MESSAGES[code],
                }
            ),
            reliable=True,
            topic="agent_error",
        )
        await c.room.disconnect()

    async def _failing_start(*_args: Any, **_kwargs: Any) -> None:
        handlers_start["error"](
            _make_error_event(
                APIStatusError(message="auth", status_code=401),
                recoverable=False,
            )
        )
        raise RuntimeError("start pipeline crashed")

    session_start.start.side_effect = _failing_start
    orch_start = AgentJobOrchestrator(
        ctx_start,
        session_factory=lambda: session_start,
        send_error_fn=_flaky_send_error,
    )
    await orch_start.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

    assert len(orch_start._error_tasks) == 0
    assert orch_start.sink is not None
    assert orch_start.sink.closed is True
    assert ctx_start.room.disconnect.await_count == 1

    # 3. run 在 start 期间被取消（CancelledError），仍取消并等待已派发通知、关闭 Sink 并传播取消
    ctx_cancel = _make_mock_ctx()
    session_cancel, handlers_cancel = _make_capturing_session()
    cancel_notify_entered = asyncio.Event()
    cancel_notify_cleaned = asyncio.Event()

    async def _hanging_send(*_args: Any, **_kwargs: Any) -> None:
        cancel_notify_entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancel_notify_cleaned.set()
            raise

    async def _cancelled_start(*_args: Any, **_kwargs: Any) -> None:
        handlers_cancel["error"](
            _make_error_event(RuntimeError("before cancel"), recoverable=False)
        )
        await cancel_notify_entered.wait()
        raise asyncio.CancelledError()

    session_cancel.start.side_effect = _cancelled_start
    orch_cancel = AgentJobOrchestrator(
        ctx_cancel,
        session_factory=lambda: session_cancel,
        send_error_fn=_hanging_send,
    )
    with patch.object(orch_cancel, "ERROR_TASK_DRAIN_TIMEOUT_SECONDS", 0.01):
        with pytest.raises(asyncio.CancelledError):
            await orch_cancel.run(
                lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True))
            )

    assert cancel_notify_cleaned.is_set() is True
    assert len(orch_cancel._error_tasks) == 0
    assert orch_cancel.sink is not None
    assert orch_cancel.sink.closed is True


@pytest.mark.asyncio
async def test_two_jobs_independent_error_task_isolation():
    """验证两个并发 Job 的错误通知任务追踪与关闭收束完全隔离，互不串扰。"""
    ctx1 = _make_mock_ctx()
    ctx2 = _make_mock_ctx()
    session1, handlers1 = _make_capturing_session()
    session2, handlers2 = _make_capturing_session()

    entered1 = asyncio.Event()
    entered2 = asyncio.Event()
    gate2 = asyncio.Event()

    async def _send1(*_args: Any, **_kwargs: Any) -> None:
        entered1.set()
        await asyncio.Event().wait()

    async def _send2(c: JobContext, code: str, **_kwargs: Any) -> None:
        entered2.set()
        await gate2.wait()
        await c.room.disconnect()

    orch1 = AgentJobOrchestrator(
        ctx1, session_factory=lambda: session1, send_error_fn=_send1
    )
    orch2 = AgentJobOrchestrator(
        ctx2, session_factory=lambda: session2, send_error_fn=_send2
    )

    await orch1.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))
    await orch2.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

    handlers1["error"](_make_error_event(RuntimeError("j1"), recoverable=False))
    handlers2["error"](_make_error_event(RuntimeError("j2"), recoverable=False))
    await entered1.wait()
    await entered2.wait()

    task1 = next(iter(orch1._error_tasks))
    task2 = next(iter(orch2._error_tasks))
    assert task1 is not task2

    # 关闭 Job 1（超时取消 task1），验证 Job 2 的 task2 与 Sink 不受任何影响
    with patch.object(orch1, "ERROR_TASK_DRAIN_TIMEOUT_SECONDS", 0.01):
        assert await ctx1.shutdown_callbacks[0]() is True

    assert task1.cancelled() is True
    assert len(orch1._error_tasks) == 0
    assert orch1.sink is not None and orch1.sink.closed is True

    assert not task2.done()
    assert not task2.cancelled()
    assert len(orch2._error_tasks) == 1
    assert orch2.closing is False
    assert orch2.sink is not None and orch2.sink.closed is False

    # 释放 Job 2 并正常关闭
    gate2.set()
    assert await ctx2.shutdown_callbacks[0]() is True
    assert len(orch2._error_tasks) == 0
    assert ctx2.room.disconnect.await_count == 1
    assert orch2.sink.closed is True


@pytest.mark.asyncio
async def test_disconnect_reentrant_shutdown_no_deadlock_or_self_cancel():
    """
    验证通知任务内 ctx.room.disconnect 间接调用 shutdown callback 重入时：
    排除 asyncio.current_task()，不自锁、不自取消，且并发外部 close 安全返回原 Sink 结果。
    """
    ctx = _make_mock_ctx()
    session, handlers = _make_capturing_session()

    disconnect_entered = asyncio.Event()
    allow_reentrant_close = asyncio.Event()
    reentrant_results: list[bool] = []

    async def _reentrant_disconnect() -> None:
        disconnect_entered.set()
        await allow_reentrant_close.wait()
        res = await ctx.shutdown_callbacks[0]()
        reentrant_results.append(res)

    ctx.room.disconnect.side_effect = _reentrant_disconnect

    orch = AgentJobOrchestrator(ctx, session_factory=lambda: session)
    orch.sink_close_spy = AsyncMock(return_value=True)
    await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))
    assert orch.sink is not None
    orig_sink_close = orch.sink.close
    orch.sink.close = AsyncMock(side_effect=orig_sink_close)

    external_close_task: asyncio.Task[bool] | None = None
    notify_task: asyncio.Task[Any] | None = None
    try:
        # 通过真实保存的 error 回调触发通知
        handlers["error"](
            _make_error_event(
                APIStatusError(message="401 auth", status_code=401),
                recoverable=False,
            )
        )
        await _wait_bounded(disconnect_entered.wait(), name="disconnect_entered")
        assert len(orch._error_tasks) == 1
        notify_task = next(iter(orch._error_tasks))

        # 外部同时发起 close，随后放行 disconnect 内的重入 close
        external_close_task = asyncio.create_task(ctx.shutdown_callbacks[0]())
        await asyncio.sleep(0)
        allow_reentrant_close.set()

        external_res = await _wait_bounded(
            external_close_task, name="external_close_task"
        )
        await _wait_bounded(asyncio.wait({notify_task}), name="wait_notify_task")

        assert external_res is True
        assert reentrant_results == [True]
        assert notify_task.done() is True
        assert notify_task.cancelled() is False
        assert notify_task.exception() is None
        assert len(orch._error_tasks) == 0
        assert orch.sink.close.await_count == 1
        assert orch.sink.closed is True
    finally:
        allow_reentrant_close.set()
        disconnect_entered.set()
        await _cleanup_test_resources(
            tasks=[external_close_task, notify_task], orch=orch, timeout=1.0
        )


@pytest.mark.asyncio
async def test_concurrent_and_repeated_shutdown_idempotent():
    """验证并发与重复调用 shutdown callback 幂等安全，Sink.close 仅执行一次且均返回一致结果。"""
    ctx = _make_mock_ctx()
    session, handlers = _make_capturing_session()

    entered = asyncio.Event()
    gate = asyncio.Event()

    async def _gated_publish(**_kwargs: Any) -> None:
        entered.set()
        await gate.wait()

    ctx.room.local_participant.publish_data.side_effect = _gated_publish
    orch = AgentJobOrchestrator(ctx, session_factory=lambda: session)
    await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))
    assert orch.sink is not None
    orig_sink_close = orch.sink.close
    orch.sink.close = AsyncMock(side_effect=orig_sink_close)

    handlers["error"](_make_error_event(RuntimeError("err"), recoverable=False))
    await entered.wait()

    c1 = asyncio.create_task(ctx.shutdown_callbacks[0]())
    c2 = asyncio.create_task(ctx.shutdown_callbacks[0]())
    c3 = asyncio.create_task(orch.close())
    await asyncio.sleep(0)

    gate.set()
    results = await asyncio.gather(c1, c2, c3)
    assert results == [True, True, True]

    # 再次顺序调用仍幂等返回相同结果
    assert await ctx.shutdown_callbacks[0]() is True
    assert orch.sink.close.await_count == 1
    assert len(orch._error_tasks) == 0


@pytest.mark.asyncio
async def test_close_cancelled_cancels_and_awaits_pending_tasks_and_sink_exception_propagates():
    """
    验证：
    1. close 自身被取消时，仍取消并等待自有 pending 错误通知任务完成清理，随后保持 CancelledError 传播。
    2. Sink.close 抛出异常时按原行为向上传播，且已派发通知任务已被收束。
    """
    # 1. close 被取消
    ctx1 = _make_mock_ctx()
    session1, handlers1 = _make_capturing_session()
    task_entered = asyncio.Event()
    task_cleaned = asyncio.Event()

    async def _blocking_send(*_args: Any, **_kwargs: Any) -> None:
        task_entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            await asyncio.sleep(0)
            task_cleaned.set()
            raise

    orch1 = AgentJobOrchestrator(
        ctx1, session_factory=lambda: session1, send_error_fn=_blocking_send
    )
    await orch1.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))

    handlers1["error"](_make_error_event(RuntimeError("err"), recoverable=False))
    await task_entered.wait()
    assert len(orch1._error_tasks) == 1
    pending_task = next(iter(orch1._error_tasks))

    close_task = asyncio.create_task(ctx1.shutdown_callbacks[0]())
    await asyncio.sleep(0)
    close_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await close_task

    assert task_cleaned.is_set() is True
    assert pending_task.done() is True
    assert pending_task.cancelled() is True
    assert len(orch1._error_tasks) == 0
    assert orch1.sink is not None and orch1.sink.closed is True

    # 2. Sink 异常原样传播
    ctx2 = _make_mock_ctx()
    session2, handlers2 = _make_capturing_session()
    orch2 = AgentJobOrchestrator(ctx2, session_factory=lambda: session2)
    await orch2.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))
    assert orch2.sink is not None
    await orch2.sink.close()
    orch2.sink.close = AsyncMock(side_effect=RuntimeError("sink fatal error"))

    handlers2["error"](_make_error_event(RuntimeError("err2"), recoverable=False))
    with pytest.raises(RuntimeError, match="sink fatal error"):
        await ctx2.shutdown_callbacks[0]()

    assert len(orch2._error_tasks) == 0
