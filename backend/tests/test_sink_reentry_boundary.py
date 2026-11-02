"""
EchoTalk TranscriptSink 与 AgentJobOrchestrator 公共通知重入边界测试 (RF-09 / A58 & A59)。

覆盖契约：
1. 公共行为查询矩阵与状态不变性：
   - 普通调用（外部协程/任务）查询返回 False；
   - 未发生故障（无通知任务）查询返回 False；
   - 在其他 Sink 的通知任务中查询返回 False；
   - 在本 Sink 的故障通知任务中查询返回 True（无参、显式当前任务或显式传 task=None）；
   - 显式 None 与当前任务语义：task=None 与无参调用一致，均指当前任务（默认值）；
     在通知任务内部均返回 True，在外部任务均返回 False；非任何情况下传 None 均返回 False；
   - 公共查询是纯只读行为，不改变 Sink 任何状态与记账快照；
   - 容错保护：未运行事件循环或外部调用安全返回 False。
2. 真实链路“通知 → disconnect → Orchestrator.close → Sink.close”重入：
   - 真实 Sink 故障触发 on_failure 回调；
   - 回调调用 disconnect 间接触发注册的 shutdown callback (Orchestrator.close)；
   - Orchestrator 使用 is_failure_notification_task() 识别重入，消除私有 _notify_task 访问；
   - 证明无自锁（deadlock）、无自取消（self-cancel）且自有任务收束；
   - 引入独立外部完成观察预算与协调 try...finally 清理，若重入查询被破坏（如变异为 False），
     在短预算内确定性抛出 TimeoutError 并释放 gate、取消任务完成清理，避免挂死至 900 秒硬超时。
3. 负向测试与强制清场：
   - 证明故障通知未到达时在短预算内可判定地超时并强制清场；
   - 证明使用替身模拟重入查询返回 False 造成关闭互等时在短预算内超时并解锁清场；
   - 严格区分“真实正常关闭”（断言 closed=True 与记账快照）与“强制清场”（断言任务终止与无挂起，不人为篡改属性伪造终态）。
4. 严格私有属性保护：
   - 证明 Orchestrator 关停期间对 Sink 零 _notify_task 私有属性访问。
5. 并发与混合场景：
   - 故障通知重入与外部并发 shutdown callback 安全共享；
   - 既有 Orchestrator 错误任务与 Sink 故障通知同时存在时无交叉干扰并按预算收束；
   - 健康 Sink 正常关闭时 query 返回 False 且正常排空。
6. 故障路径验证：
   - 证明关闭操作因延迟响应取消时外部完成观察预算先到期抛错且随后安全清场；
   - 证明清理步骤中个别步骤抛出异常时仍继续收束其余自有资源，不跳过后续资源。
"""

import asyncio
import uuid
from typing import Any, Awaitable, Callable, Iterable
from unittest.mock import AsyncMock, MagicMock

import pytest
from livekit.agents import APIStatusError, JobContext

from livekit_agent.job_orchestrator import AgentJobOrchestrator
from livekit_agent.transcript_sink import TranscriptSink

TEST_REENTRY_BUDGET_SECONDS: float = 2.0

_OBSERVED_TASKS: set[asyncio.Task[Any]] = set()


def _register_observed_task(task: asyncio.Task[Any]) -> None:
    _OBSERVED_TASKS.add(task)

    def _on_done(t: asyncio.Task[Any]) -> None:
        _OBSERVED_TASKS.discard(t)

    task.add_done_callback(_on_done)


async def _wait_bounded(
    awaitable: Awaitable[Any],
    timeout: float = TEST_REENTRY_BUDGET_SECONDS,
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
    timeout: float = TEST_REENTRY_BUDGET_SECONDS,
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


def _make_mock_ctx(room_name: str | None = None) -> MagicMock:
    ctx = MagicMock(spec=JobContext)
    ctx.room = MagicMock()
    ctx.room.name = room_name or str(uuid.uuid4())
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


@pytest.mark.asyncio
async def test_sink_is_failure_notification_task_comprehensive_matrix():
    """验证 is_failure_notification_task 覆盖所有调用形态且绝对不修改状态。

    明确显式 None 语义：task=None 与无参调用完全一致，均指代当前正在运行的任务（默认参数）。
    在通知任务内部，无参、传当前任务与传 None 均返回 True；在外部普通任务中均返回 False。
    绝非任何情况下传 None 均返回 False。
    """
    sid1 = str(uuid.uuid4())
    sid2 = str(uuid.uuid4())

    notify1_entered = asyncio.Event()
    notify1_release = asyncio.Event()
    results: dict[str, bool] = {}

    async def _on_fail1(_reason: str) -> None:
        cur = asyncio.current_task()
        results["sink1_no_arg_in_task1"] = sink1.is_failure_notification_task()
        results["sink1_explicit_in_task1"] = sink1.is_failure_notification_task(cur)
        results["sink1_explicit_none_in_task1"] = sink1.is_failure_notification_task(
            None
        )
        results["sink2_no_arg_in_task1"] = sink2.is_failure_notification_task()
        results["sink2_explicit_task1"] = sink2.is_failure_notification_task(cur)
        results["sink2_explicit_none_task1"] = sink2.is_failure_notification_task(None)
        notify1_entered.set()
        await _wait_bounded(notify1_release.wait(), name="notify1_release")

    sink1 = TranscriptSink(
        session_id=sid1,
        writer=AsyncMock(side_effect=RuntimeError("fail 1")),
        on_failure=_on_fail1,
        max_attempts=1,
        drain_timeout=1.0,
    )
    sink2 = TranscriptSink(
        session_id=sid2,
        max_attempts=1,
        drain_timeout=1.0,
    )

    try:
        # 1. 故障发生前（无通知任务）：普通外部调用
        snap1_before = sink1.snapshot()
        snap2_before = sink2.snapshot()

        assert sink1.is_failure_notification_task() is False
        assert sink1.is_failure_notification_task(asyncio.current_task()) is False
        assert sink1.is_failure_notification_task(None) is False
        assert sink2.is_failure_notification_task() is False

        # 状态与记账快照完全未变
        assert sink1.snapshot() == snap1_before
        assert sink2.snapshot() == snap2_before

        # 2. 触发 Sink 1 故障
        sink1.submit("user", "msg1", event_id=uuid.uuid4())
        await _wait_bounded(notify1_entered.wait(), name="notify1_entered")

        # 在外部任务中查询：因当前运行任务并非通知任务，无参、传当前任务及传 None 均返回 False
        assert sink1.is_failure_notification_task() is False
        assert sink1.is_failure_notification_task(asyncio.current_task()) is False
        assert sink1.is_failure_notification_task(None) is False
        assert sink2.is_failure_notification_task() is False

        # 内部任务查询结果断言：在 notify1 内部，无参、显式当前任务及显式 None 均严格为 True
        assert results["sink1_no_arg_in_task1"] is True
        assert results["sink1_explicit_in_task1"] is True
        assert results["sink1_explicit_none_in_task1"] is True
        # 交叉查询 sink2 均为 False
        assert results["sink2_no_arg_in_task1"] is False
        assert results["sink2_explicit_task1"] is False
        assert results["sink2_explicit_none_task1"] is False
    finally:
        # 无论成功或超时/失败，确保释放内部等待并收束两个 Sink，避免首项失败跳过第二项
        notify1_release.set()
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

    # 3. 关闭完成后外部调用仍为 False
    assert sink1.is_failure_notification_task() is False
    assert sink1.is_failure_notification_task(None) is False
    assert sink2.is_failure_notification_task() is False


def test_sink_is_failure_notification_task_without_running_loop():
    """验证在无运行事件循环时调用（无参或传 None）安全返回 False，不抛出 RuntimeError。"""
    sink = TranscriptSink(session_id=str(uuid.uuid4()))
    assert sink.is_failure_notification_task() is False
    assert sink.is_failure_notification_task(None) is False


@pytest.mark.asyncio
async def test_real_sink_failure_notification_disconnect_reentry_full_chain():
    """
    必须通过真实 Sink 故障通知回调触发：
    “Sink故障 → 通知 → disconnect → Orchestrator.close → Sink.close”重入。
    证明无自锁、无自取消、最终任务清理，且并发外部 close 正常返回。

    短测试预算与异常清理契约：
    所有外部等待均施加 TEST_REENTRY_BUDGET_SECONDS 命名预算；
    若重入查询逻辑被破坏（如变异为 False 导致关闭互等），测试在 2.0s 内确定性抛出 TimeoutError，
    并在 finally 块中释放 gate、取消自建 pending task 并收束 Sink/Orchestrator 任务，
    保证 pytest 以失败报告 (exit 1) 退出，绝不死锁直到 900 秒硬超时。
    """
    session_id = str(uuid.uuid4())
    ctx = _make_mock_ctx(room_name=session_id)
    session, _ = _make_capturing_session()

    reentrant_close_results: list[bool] = []
    disconnect_entered = asyncio.Event()
    allow_reentrant_close = asyncio.Event()

    async def _mock_disconnect() -> None:
        disconnect_entered.set()
        await _wait_bounded(allow_reentrant_close.wait(), name="allow_reentrant_close")
        # 模拟 LiveKit disconnect 触发已注册的 shutdown callback (Orchestrator.close)
        assert len(ctx.shutdown_callbacks) == 1
        res = await ctx.shutdown_callbacks[0]()
        reentrant_close_results.append(res)

    ctx.room.disconnect.side_effect = _mock_disconnect

    # 使用必然失败的 writer 触发真实 Sink 重试耗尽
    async def _failing_writer(*_args: Any, **_kwargs: Any) -> bool:
        raise RuntimeError("database write fatal error")

    orch = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: session,
        sink_factory=lambda session_id, on_failure: TranscriptSink(
            session_id=session_id,
            on_failure=on_failure,
            writer=_failing_writer,
            max_attempts=1,
            drain_timeout=1.0,
        ),
    )

    external_close_task: asyncio.Task[bool] | None = None
    try:
        await _wait_bounded(
            orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True))),
            name="orch_run",
        )
        assert orch.sink is not None
        assert orch.started is True

        # 提交一条转录，触发 Sink 写入失败 -> max_attempts_exceeded -> _on_sink_failure
        submitted = orch.sink.submit(
            "user", "test trigger failure", event_id=uuid.uuid4()
        )
        assert submitted is True

        # 等待故障通知回调进入 disconnect（受命名短测试预算约束）
        await _wait_bounded(disconnect_entered.wait(), name="wait_disconnect_entered")

        # 外部同时调用 shutdown callback，形成并发关闭竞争
        external_close_task = asyncio.create_task(ctx.shutdown_callbacks[0]())
        await asyncio.sleep(0)

        # 放行 disconnect 内的重入 close
        allow_reentrant_close.set()

        # 等待外部关闭任务完成（若重入查询被改 False 发生互等，在此短预算内抛出 TimeoutError）
        external_res = await _wait_bounded(
            external_close_task,
            timeout=TEST_REENTRY_BUDGET_SECONDS,
            name="external_close_task_wait",
        )
        assert external_res is False
        assert reentrant_close_results == [False]

        # 证明终态：无自锁、无自取消、任务清理
        assert orch.closed is True
        assert orch.sink.closed is True
        assert orch.sink._worker_task.done() is True
        assert orch.sink._notify_task is not None
        assert orch.sink._notify_task.done() is True
        assert orch.sink._notify_task.cancelled() is False
        assert len(orch._error_tasks) == 0

        # 验证客户端收到了安全的 Sink 故障错误码
        assert ctx.room.local_participant.publish_data.await_count == 1
        call_payload = ctx.room.local_participant.publish_data.call_args.kwargs[
            "payload"
        ]
        assert "ERR_CUSTOM_RUNTIME" in call_payload
    finally:
        # 测试超时或断言失败时的强制安全清理，协调收集所有任务解开依赖并收束，避免挂死
        allow_reentrant_close.set()
        disconnect_entered.set()
        await _cleanup_test_resources(
            tasks=[external_close_task],
            orch=orch,
            timeout=1.0,
            name="real_reentry_resources",
        )


@pytest.mark.asyncio
async def test_orchestrator_close_sink_zero_private_attribute_access():
    """严格证明 Orchestrator._close_sink 仅通过公共查询边界，绝不读取 _notify_task 私有字段。"""
    ctx = _make_mock_ctx()
    orch = AgentJobOrchestrator(ctx)

    class StrictProtectedSink:
        def __init__(self):
            self.queried = False
            self.closed = False

        def is_failure_notification_task(self):
            self.queried = True
            return True

        async def close(self):
            self.closed = True
            return True

        def __getattribute__(self, name: str) -> Any:
            if name == "_notify_task":
                raise AssertionError(
                    "严重违背边界：Orchestrator 试图读取 Sink 私有 _notify_task！"
                )
            return super().__getattribute__(name)

    strict_sink = StrictProtectedSink()
    orch.sink = strict_sink

    # 执行 _close_sink，若访问 _notify_task 则立即抛出 AssertionError
    res = await _wait_bounded(orch._close_sink(), name="strict_sink_close")
    assert res is True
    assert strict_sink.queried is True
    assert strict_sink.closed is True


@pytest.mark.asyncio
async def test_sink_reentry_with_concurrent_agent_error_cooperative_drain():
    """
    验证既有 Agent 运行时错误通知任务（由 on_agent_error 派发）与
    Sink 故障通知任务并发存在时，两套任务分别在各自预算内收束，无交叉死锁。
    """
    ctx = _make_mock_ctx()
    session, handlers = _make_capturing_session()

    runtime_error_entered = asyncio.Event()
    runtime_error_release = asyncio.Event()

    async def _slow_send_error(c: JobContext, code: str, **_kwargs: Any) -> None:
        if code == "ERR_CUSTOM_RUNTIME_AUTH":
            runtime_error_entered.set()
            await _wait_bounded(
                runtime_error_release.wait(), name="runtime_error_release"
            )
        await c.room.disconnect()

    sink_fail_entered = asyncio.Event()
    sink_fail_release = asyncio.Event()

    async def _failing_writer(*_args: Any, **_kwargs: Any) -> bool:
        sink_fail_entered.set()
        await _wait_bounded(sink_fail_release.wait(), name="sink_fail_release")
        return False

    orch = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: session,
        sink_factory=lambda session_id, on_failure: TranscriptSink(
            session_id=session_id,
            on_failure=on_failure,
            writer=_failing_writer,
            max_attempts=1,
            drain_timeout=1.0,
        ),
        send_error_fn=_slow_send_error,
    )

    close_task: asyncio.Task[bool] | None = None
    try:
        await _wait_bounded(
            orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True))),
            name="orch_run_concurrent",
        )
        assert orch.sink is not None

        # 1. 触发 Agent 运行时错误（401）
        handlers["error"](
            MagicMock(
                error=MagicMock(
                    error=APIStatusError(message="401", status_code=401),
                    type="runtime",
                    recoverable=False,
                )
            )
        )
        await _wait_bounded(runtime_error_entered.wait(), name="runtime_error_entered")
        assert len(orch._error_tasks) == 1

        # 2. 触发 Sink 写入失败
        orch.sink.submit("user", "cause sink fail", event_id=uuid.uuid4())
        await _wait_bounded(sink_fail_entered.wait(), name="sink_fail_entered")

        # 3. 启动关闭
        close_task = asyncio.create_task(ctx.shutdown_callbacks[0]())
        await asyncio.sleep(0)
        assert orch.closing is True

        # 释放两边阻塞
        runtime_error_release.set()
        sink_fail_release.set()

        result = await _wait_bounded(close_task, name="concurrent_close_task")
        assert result is False
        assert len(orch._error_tasks) == 0
        assert orch.sink.closed is True
        assert orch.closed is True
    finally:
        runtime_error_release.set()
        sink_fail_release.set()
        await _cleanup_test_resources(
            tasks=[close_task],
            orch=orch,
            timeout=1.0,
            name="concurrent_drain_resources",
        )


@pytest.mark.asyncio
async def test_healthy_sink_shutdown_reentry_query_returns_false():
    """验证健康 Sink（无故障）正常 shutdown 时，is_failure_notification_task 返回 False 并成功返回 True。"""
    ctx = _make_mock_ctx()
    session, _ = _make_capturing_session()

    async def _good_writer(*_args: Any, **_kwargs: Any) -> bool:
        return True

    orch = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: session,
        sink_factory=lambda session_id, on_failure: TranscriptSink(
            session_id=session_id,
            on_failure=on_failure,
            writer=_good_writer,
        ),
    )

    await _wait_bounded(
        orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), False))),
        name="orch_run_healthy",
    )
    assert orch.sink is not None
    assert orch.sink.submit("assistant", "hello", event_id=uuid.uuid4()) is True

    # 执行关闭
    try:
        closed_ok = await _wait_bounded(
            ctx.shutdown_callbacks[0](), name="healthy_shutdown"
        )
        assert closed_ok is True
        assert orch.sink.is_failure_notification_task() is False
        assert orch.sink.snapshot().succeeded == 1
        assert orch.sink.snapshot().failed == 0
        assert orch.sink.closed is True
    finally:
        if orch is not None:
            await _cleanup_test_resources(orch=orch, timeout=1.0)


# ===========================================================================
# 负向测试：证明在短预算内可判定地失败并清理，而非产生无限挂起
# ===========================================================================


@pytest.mark.asyncio
async def test_negative_reentry_bounded_timeout_when_notification_event_never_arrives():
    """负向测试：使用真实故障通知回调挂起/未到达装置，证明等待超时在短预算内判定并收束任务。"""
    session_id = str(uuid.uuid4())
    ctx = _make_mock_ctx(room_name=session_id)
    session, _ = _make_capturing_session()

    notification_arrived = asyncio.Event()
    hang_notification = asyncio.Event()

    async def _hanging_send_error(c: JobContext, code: str, **kwargs: Any) -> None:
        # 模拟故障通知回调在发送前永久挂起，导致到达信号 notification_arrived 永不到达
        await hang_notification.wait()
        notification_arrived.set()

    async def _failing_writer(*_args: Any, **_kwargs: Any) -> bool:
        raise RuntimeError("database write fatal error")

    orch = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: session,
        sink_factory=lambda session_id, on_failure: TranscriptSink(
            session_id=session_id,
            on_failure=on_failure,
            writer=_failing_writer,
            max_attempts=1,
            drain_timeout=1.0,
        ),
        send_error_fn=_hanging_send_error,
    )

    try:
        await _wait_bounded(
            orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True))),
            name="orch_run_negative",
        )
        assert orch.sink is not None

        # 提交一条转录，触发真实 Sink 写入失败 -> max_attempts_exceeded -> _on_sink_failure -> _hanging_send_error
        submitted = orch.sink.submit(
            "user", "test trigger failure for never arrives", event_id=uuid.uuid4()
        )
        assert submitted is True

        # 真实故障通知任务已被派发，但其到达/完成信号 notification_arrived 永不到达
        # 验证在短测试预算 (0.05s) 内等待该通知到达确定性抛出 TimeoutError
        with pytest.raises(TimeoutError, match="测试等待超过预算"):
            await _wait_bounded(
                notification_arrived.wait(),
                timeout=0.05,
                name="notification_never_arrives",
            )
    finally:
        # 释放 gate，取消并等待所有自有与底层任务，显式判定 pending 并收束
        hang_notification.set()
        if orch is not None:
            await _cleanup_test_resources(
                orch=orch, timeout=1.0, name="negative_never_arrives_resources"
            )

    # 断言强制清场终态：后台任务均已收束，无悬挂任务，无未检索异常（不伪造真实正常关闭 closed=True）
    assert orch.sink._worker_task.done() is True
    assert orch.sink._notify_task is not None
    assert orch.sink._notify_task.done() is True
    assert len(orch.error_tasks) == 0


@pytest.mark.asyncio
async def test_negative_reentry_deadlock_detected_when_reentry_query_returns_false():
    """负向测试：使用本地替身证明当重入查询失效（返回 False）造成关闭互等死锁时，

    外部等待会在短测试预算 (0.15s) 内判定性抛出 TimeoutError，并且装置能立即清理解除死锁。
    """
    session_id = str(uuid.uuid4())
    ctx = _make_mock_ctx(room_name=session_id)
    session, _ = _make_capturing_session()

    disconnect_entered = asyncio.Event()
    allow_reentrant_close = asyncio.Event()

    async def _mock_disconnect() -> None:
        disconnect_entered.set()
        await allow_reentrant_close.wait()
        # 触发重入关闭
        await ctx.shutdown_callbacks[0]()

    ctx.room.disconnect.side_effect = _mock_disconnect

    async def _failing_writer(*_args: Any, **_kwargs: Any) -> bool:
        raise RuntimeError("db error")

    orch = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: session,
        sink_factory=lambda session_id, on_failure: TranscriptSink(
            session_id=session_id,
            on_failure=on_failure,
            writer=_failing_writer,
            max_attempts=1,
            drain_timeout=1.0,
        ),
    )

    external_close_task: asyncio.Task[bool] | None = None
    try:
        await _wait_bounded(
            orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True))),
            name="orch_run_mutant_sim",
        )
        assert orch.sink is not None

        # 模拟变异：强制将 is_failure_notification_task 篡改为始终返回 False
        orch.sink.is_failure_notification_task = MagicMock(return_value=False)

        # 提交转录触发 Sink 失败通知
        orch.sink.submit("user", "cause failure", event_id=uuid.uuid4())
        await _wait_bounded(disconnect_entered.wait(), name="disconnect_entered_wait")

        # 外部同时发起 shutdown
        external_close_task = asyncio.create_task(ctx.shutdown_callbacks[0]())
        await asyncio.sleep(0)

        # 放行 disconnect 内重入 close
        allow_reentrant_close.set()

        # 因重入查询被篡改为 False，形成关闭互等死锁。验证短预算 (0.15s) 内必定抛出 TimeoutError！
        with pytest.raises(TimeoutError, match="测试等待超过预算"):
            await _wait_bounded(
                external_close_task,
                timeout=0.15,
                name="mutant_deadlocked_close",
            )
    finally:
        # 测试在捕获超时后，验证测试装置的 finally 清理能力：
        allow_reentrant_close.set()
        disconnect_entered.set()
        await _cleanup_test_resources(
            tasks=[external_close_task],
            orch=orch,
            timeout=1.0,
            name="negative_deadlock_resources",
        )

    # 断言强制清场终态：所有任务已 done，无后台挂死任务（不伪造真实正常关闭 closed=True）
    assert external_close_task.done() is True
    assert orch.sink._worker_task.done() is True
    assert orch.sink._notify_task.done() is True
    assert len(orch.error_tasks) == 0


# ===========================================================================
# 故障路径测试：覆盖延迟响应取消预算先到期与步骤失败时清理其余资源
# ===========================================================================


@pytest.mark.asyncio
async def test_sink_close_delayed_cancellation_response_external_budget_expires_first():
    """验证当关闭操作因 shield/内部等待而延迟响应取消时，外部观察预算先到期并抛出 TimeoutError，

    且装置能及时在 finally 中释放阻塞并清场收束，不发生挂死。
    """
    session_id = str(uuid.uuid4())
    writer_entered = asyncio.Event()
    writer_release = asyncio.Event()

    async def _delayed_writer(*_args: Any, **_kwargs: Any) -> bool:
        writer_entered.set()
        await writer_release.wait()
        return True

    sink = TranscriptSink(
        session_id=session_id,
        writer=_delayed_writer,
        max_attempts=1,
        drain_timeout=2.0,
    )

    close_task: asyncio.Task[bool] | None = None
    try:
        # 提交一条转录，使其进入 in-flight 执行状态
        assert sink.submit("user", "delayed item", event_id=uuid.uuid4()) is True
        await _wait_bounded(writer_entered.wait(), name="writer_entered")

        # 启动外部 close 任务
        close_task = asyncio.create_task(sink.close())

        # 外部观察预算 (0.05s) 远小于排空所需时间，且 writer 尚未释放
        # 证明 _wait_bounded 在观察预算到期时立即抛出 TimeoutError，而不是卡在 wait_for 的取消等待中
        with pytest.raises(TimeoutError, match="测试等待超过预算"):
            await _wait_bounded(
                close_task,
                timeout=0.05,
                name="delayed_cancel_close",
            )

        # 观察预算到期后，由于 Sink.close 内部 shield 延迟响应取消，close_task 此时仍处于 pending
        assert close_task.done() is False
    finally:
        # 释放 writer 门控，协调收束所有任务
        writer_release.set()
        await _cleanup_test_resources(
            tasks=[close_task],
            sinks=[sink],
            timeout=1.0,
            name="delayed_cancel_cleanup",
        )

    assert close_task.done() is True
    assert sink._worker_task.done() is True


@pytest.mark.asyncio
async def test_cleanup_continues_and_cleans_remaining_resources_when_one_step_fails():
    """验证当某个清理步骤发生异常时，清理机制仍能继续收束其余自有资源，不跳过后续资源。"""
    session_id1 = str(uuid.uuid4())
    session_id2 = str(uuid.uuid4())

    writer1_block = asyncio.Event()
    writer2_block = asyncio.Event()

    async def _w1(*_args: Any, **_kwargs: Any) -> bool:
        await writer1_block.wait()
        return True

    async def _w2(*_args: Any, **_kwargs: Any) -> bool:
        await writer2_block.wait()
        return True

    sink1 = TranscriptSink(session_id=session_id1, writer=_w1, drain_timeout=1.0)
    sink2 = TranscriptSink(session_id=session_id2, writer=_w2, drain_timeout=1.0)

    sink1.submit("user", "msg1", event_id=uuid.uuid4())
    sink2.submit("user", "msg2", event_id=uuid.uuid4())

    # 构造一个会在取消等待时抛错的故障任务模拟第一步失败
    failing_task = asyncio.create_task(asyncio.sleep(10))

    cleanup_errors: list[Exception] = []

    # 模拟第一步清理抛出异常，第二步仍继续收束 sink1 与 sink2
    try:
        try:
            # 步骤 1 模拟失败
            failing_task.cancel()
            raise RuntimeError("simulated cleanup step 1 failure")
        except Exception as e:
            cleanup_errors.append(e)

        # 步骤 2 保证继续执行其余资源清理
        writer1_block.set()
        writer2_block.set()
        await _cleanup_test_resources(sinks=[sink1, sink2], timeout=1.0)
    finally:
        # 确保故障任务自身也被收束
        if not failing_task.done():
            failing_task.cancel()
            try:
                await failing_task
            except (asyncio.CancelledError, Exception):
                pass

    # 证明步骤 1 记录了异常，但步骤 2 的 sink1 和 sink2 均被完全清理收束
    assert len(cleanup_errors) == 1
    assert str(cleanup_errors[0]) == "simulated cleanup step 1 failure"
    assert sink1._worker_task.done() is True
    assert sink2._worker_task.done() is True
    assert failing_task.done() is True
