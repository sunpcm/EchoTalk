"""
EchoTalk TranscriptSink 与 AgentJobOrchestrator 公共通知重入边界测试 (RF-09 / A58)。

覆盖契约：
1. 公共行为查询矩阵与状态不变性：
   - 普通调用（外部协程/任务）查询返回 False；
   - 未发生故障（无通知任务）查询返回 False；
   - 在其他 Sink 的通知任务中查询返回 False；
   - 在本 Sink 的故障通知任务中查询返回 True（无参或显式传参）；
   - 公共查询是纯只读行为，不改变 Sink 任何状态与记账快照；
   - 容错保护：未运行事件循环或传 None/非法任务安全返回 False。
2. 真实链路“通知 → disconnect → Orchestrator.close → Sink.close”重入：
   - 真实 Sink 故障触发 on_failure 回调；
   - 回调调用 disconnect 间接触发注册的 shutdown callback (Orchestrator.close)；
   - Orchestrator 使用 is_failure_notification_task() 识别重入，消除私有 _notify_task 访问；
   - 证明无自锁（deadlock）、无自取消（self-cancel）且所有自有任务完全收束。
3. 严格私有属性保护：
   - 证明 Orchestrator 关停期间对 Sink 零 _notify_task 私有属性访问。
4. 并发与混合场景：
   - 故障通知重入与外部并发 shutdown callback 安全共享；
   - 既有 Orchestrator 错误任务与 Sink 故障通知同时存在时无交叉干扰并按预算收束；
   - 健康 Sink 正常关闭时 query 返回 False 且正常排空。
"""

import asyncio
import uuid
from typing import Any, Callable
from unittest.mock import AsyncMock, MagicMock

import pytest
from livekit.agents import APIStatusError, JobContext

from livekit_agent.job_orchestrator import AgentJobOrchestrator
from livekit_agent.transcript_sink import TranscriptSink


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
    """验证 is_failure_notification_task 覆盖所有调用形态且绝对不修改状态。"""
    sid1 = str(uuid.uuid4())
    sid2 = str(uuid.uuid4())

    notify1_entered = asyncio.Event()
    notify1_release = asyncio.Event()
    results: dict[str, bool] = {}

    async def _on_fail1(_reason: str) -> None:
        cur = asyncio.current_task()
        results["sink1_no_arg_in_task1"] = sink1.is_failure_notification_task()
        results["sink1_explicit_in_task1"] = sink1.is_failure_notification_task(cur)
        results["sink2_no_arg_in_task1"] = sink2.is_failure_notification_task()
        results["sink2_explicit_task1"] = sink2.is_failure_notification_task(cur)
        notify1_entered.set()
        await notify1_release.wait()

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
    await notify1_entered.wait()

    # 在外部任务中查询：均应返回 False
    assert sink1.is_failure_notification_task() is False
    assert sink1.is_failure_notification_task(asyncio.current_task()) is False
    assert sink2.is_failure_notification_task() is False

    # 内部任务查询结果断言
    assert results["sink1_no_arg_in_task1"] is True
    assert results["sink1_explicit_in_task1"] is True
    assert results["sink2_no_arg_in_task1"] is False
    assert results["sink2_explicit_task1"] is False

    # 释放并关闭
    notify1_release.set()
    assert await sink1.close() is False
    assert await sink2.close() is True

    # 3. 关闭完成后外部调用仍为 False
    assert sink1.is_failure_notification_task() is False
    assert sink2.is_failure_notification_task() is False


def test_sink_is_failure_notification_task_without_running_loop():
    """验证在无运行事件循环时调用安全返回 False，不抛出 RuntimeError。"""
    sink = TranscriptSink(session_id=str(uuid.uuid4()))
    assert sink.is_failure_notification_task() is False
    assert sink.is_failure_notification_task(None) is False


@pytest.mark.asyncio
async def test_real_sink_failure_notification_disconnect_reentry_full_chain():
    """
    必须通过真实 Sink 故障通知回调触发：
    “Sink故障 → 通知 → disconnect → Orchestrator.close → Sink.close”重入。
    证明无自锁、无自取消、最终任务清理，且并发外部 close 正常返回。
    """
    session_id = str(uuid.uuid4())
    ctx = _make_mock_ctx(room_name=session_id)
    session, _ = _make_capturing_session()

    reentrant_close_results: list[bool] = []
    disconnect_entered = asyncio.Event()
    allow_reentrant_close = asyncio.Event()

    async def _mock_disconnect() -> None:
        disconnect_entered.set()
        await allow_reentrant_close.wait()
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

    await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))
    assert orch.sink is not None
    assert orch.started is True

    # 提交一条转录，触发 Sink 写入失败 -> max_attempts_exceeded -> _on_sink_failure
    submitted = orch.sink.submit("user", "test trigger failure", event_id=uuid.uuid4())
    assert submitted is True

    # 等待故障通知回调进入 disconnect
    await disconnect_entered.wait()

    # 外部同时调用 shutdown callback，形成并发关闭竞争
    external_close_task = asyncio.create_task(ctx.shutdown_callbacks[0]())
    await asyncio.sleep(0)

    # 放行 disconnect 内的重入 close
    allow_reentrant_close.set()

    external_res = await external_close_task
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
    call_payload = ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
    assert "ERR_CUSTOM_RUNTIME" in call_payload


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
    res = await orch._close_sink()
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
            await runtime_error_release.wait()
        await c.room.disconnect()

    sink_fail_entered = asyncio.Event()
    sink_fail_release = asyncio.Event()

    async def _failing_writer(*_args: Any, **_kwargs: Any) -> bool:
        sink_fail_entered.set()
        await sink_fail_release.wait()
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

    await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True)))
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
    await runtime_error_entered.wait()
    assert len(orch._error_tasks) == 1

    # 2. 触发 Sink 写入失败
    orch.sink.submit("user", "cause sink fail", event_id=uuid.uuid4())
    await sink_fail_entered.wait()

    # 3. 启动关闭
    close_task = asyncio.create_task(ctx.shutdown_callbacks[0]())
    await asyncio.sleep(0)
    assert orch.closing is True

    # 释放两边阻塞
    runtime_error_release.set()
    sink_fail_release.set()

    result = await close_task
    assert result is False
    assert len(orch._error_tasks) == 0
    assert orch.sink.closed is True
    assert orch.closed is True


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

    await orch.run(lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), False)))
    assert orch.sink is not None
    assert orch.sink.submit("assistant", "hello", event_id=uuid.uuid4()) is True

    # 执行关闭
    closed_ok = await ctx.shutdown_callbacks[0]()
    assert closed_ok is True
    assert orch.sink.is_failure_notification_task() is False
    assert orch.sink.snapshot().succeeded == 1
    assert orch.sink.snapshot().failed == 0
    assert orch.sink.closed is True
