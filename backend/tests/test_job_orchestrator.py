"""
EchoTalk LiveKit AgentJobOrchestrator 生命周期与边界测试 (RF-09)。

覆盖：
1. 真实接线与完整成功生命周期：连接、等待、单个 Sink 分配、唯一 shutdown callback、
   事件接线、管线启动，成功后 Sink 保持 accepting，执行 shutdown callback 完成排空。
2. 两个 Job 的独立状态隔离：两 Job 拥有独立 session_id、sink、agent_session，
   互不干扰，一个 Job 失败不影响另一个 Job。
3. setup 阶段失败（返回 None）：安全退出并关闭自有 Sink，所有自有任务 done。
4. start 启动失败：调用 send_error_fn 发送安全错误码并断连，自有 Sink 被关闭。
5. 异步取消（CancelledError）：异常向上传播且自有 Sink 正常关闭。
6. Sink 故障通知（_on_sink_failure）：根据当前 is_custom 状态映射为安全错误码。
7. entrypoint 真实委托：验证 entrypoint 显式注入工厂并执行 Orchestrator。
"""

import asyncio
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from livekit.agents import (
    AutoSubscribe,
    ConversationItemAddedEvent,
    ErrorEvent,
    JobContext,
    llm,
)

from livekit_agent.agent import entrypoint
from livekit_agent.error_mapper import SAFE_ERROR_MESSAGES
from livekit_agent.job_orchestrator import AgentJobOrchestrator
from livekit_agent.transcript_sink import TranscriptSink
from provider_catalog import SESSION_CONNECT_POLICY


def _create_mock_job_context(room_name: str | None = None) -> MagicMock:
    """创建隔离测试专用的 Mock JobContext。"""
    ctx = MagicMock(spec=JobContext)
    ctx.room = MagicMock()
    ctx.room.name = room_name or str(uuid.uuid4())
    ctx.room.disconnect = AsyncMock()
    ctx.room.local_participant = MagicMock()
    ctx.room.local_participant.publish_data = AsyncMock()
    ctx.connect = AsyncMock()
    ctx.wait_for_participant = AsyncMock()
    ctx.shutdown_callbacks = []

    def _add_shutdown(cb):
        ctx.shutdown_callbacks.append(cb)

    ctx.add_shutdown_callback = MagicMock(side_effect=_add_shutdown)
    return ctx


@pytest.mark.asyncio
async def test_orchestrator_successful_lifecycle():
    """验证 Orchestrator 完整成功生命周期及单 Sink 排空。"""
    session_id = str(uuid.uuid4())
    ctx = _create_mock_job_context(room_name=session_id)

    mock_agent = MagicMock()
    mock_session = MagicMock()
    mock_session.on = MagicMock()
    mock_session.start = AsyncMock()

    orchestrator = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: mock_session,
    )

    async def _setup(sid: str, sink: TranscriptSink):
        assert sid == session_id
        assert sink is not None
        assert sink.accepting is True
        return mock_agent, False

    await orchestrator.run(_setup)

    # 1. 验证连接与等待
    ctx.connect.assert_awaited_once_with(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    ctx.wait_for_participant.assert_awaited_once()

    # 2. 验证单个 Sink 与单个组合 shutdown callback
    assert orchestrator.sink is not None
    assert orchestrator.sink.accepting is True
    assert orchestrator.started is True
    assert len(ctx.shutdown_callbacks) == 1
    assert ctx.shutdown_callbacks[0] == orchestrator.close

    # 3. 验证 session 启动
    mock_session.start.assert_awaited_once_with(mock_agent, room=ctx.room)

    # 4. 模拟关闭排空
    closed_ok = await ctx.shutdown_callbacks[0]()
    assert closed_ok is True
    assert orchestrator.sink.closed is True
    assert orchestrator.closed is True


@pytest.mark.asyncio
async def test_orchestrator_two_jobs_state_isolation():
    """验证两 Job 并发或先后运行时状态完全隔离。"""
    sid1 = str(uuid.uuid4())
    sid2 = str(uuid.uuid4())
    ctx1 = _create_mock_job_context(room_name=sid1)
    ctx2 = _create_mock_job_context(room_name=sid2)

    session1 = MagicMock()
    session1.on = MagicMock()
    session1.start = AsyncMock()

    session2 = MagicMock()
    session2.on = MagicMock()
    session2.start = AsyncMock()

    orch1 = AgentJobOrchestrator(ctx1, session_factory=lambda: session1)
    orch2 = AgentJobOrchestrator(ctx2, session_factory=lambda: session2)

    agent1 = MagicMock()
    agent2 = MagicMock()

    await orch1.run(lambda s, sink: asyncio.sleep(0, result=(agent1, True)))
    await orch2.run(lambda s, sink: asyncio.sleep(0, result=(agent2, False)))

    assert orch1.session_id == sid1
    assert orch2.session_id == sid2
    assert orch1.sink is not orch2.sink
    assert orch1.is_custom is True
    assert orch2.is_custom is False
    assert orch1.started is True
    assert orch2.started is True

    # 关闭 1 不影响 2
    await orch1.sink.close()
    assert orch1.sink.closed is True
    assert orch2.sink.closed is False

    await orch2.sink.close()
    assert orch2.sink.closed is True


@pytest.mark.asyncio
async def test_orchestrator_setup_failure_closes_sink_and_tasks_done():
    """验证 setup 回调返回 None（业务失败）时安全退出并关闭自有 Sink。"""
    ctx = _create_mock_job_context()
    orchestrator = AgentJobOrchestrator(ctx)

    async def _failing_setup(sid: str, sink: TranscriptSink):
        return None

    await orchestrator.run(_failing_setup)

    assert orchestrator.sink is not None
    assert orchestrator.sink.closed is True
    assert orchestrator.sink._worker_task.done() is True
    assert orchestrator.started is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "is_custom,expected_code",
    [
        (True, "ERR_CUSTOM_RUNTIME"),
        (False, "ERR_SYSTEM_RUNTIME"),
    ],
)
async def test_orchestrator_start_failure_sends_error_and_closes_sink(
    is_custom, expected_code
):
    """验证语音管线启动异常时记录错误、发送对应错误码断连并排空关闭 Sink。"""
    ctx = _create_mock_job_context()
    mock_session = MagicMock()
    mock_session.on = MagicMock()
    mock_session.start = AsyncMock(side_effect=RuntimeError("Pipeline crash"))

    orchestrator = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: mock_session,
    )
    mock_agent = MagicMock()

    async def _setup(sid: str, sink: TranscriptSink):
        return mock_agent, is_custom

    await orchestrator.run(_setup)

    assert orchestrator.started is False
    assert orchestrator.sink is not None
    assert orchestrator.sink.closed is True
    assert orchestrator.sink._worker_task.done() is True

    assert ctx.room.local_participant.publish_data.await_count == 1
    call_payload = json.loads(
        ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert call_payload["code"] == expected_code
    assert call_payload["message"] == SAFE_ERROR_MESSAGES[expected_code]
    assert ctx.room.disconnect.await_count == 1


@pytest.mark.asyncio
async def test_orchestrator_cancellation_propagates_and_closes_sink():
    """验证 Orchestrator 在取消时正确传播 CancelledError 并关闭自有 Sink。"""
    ctx = _create_mock_job_context()
    mock_session = MagicMock()
    mock_session.on = MagicMock()
    mock_session.start = AsyncMock(side_effect=asyncio.CancelledError())

    orchestrator = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: mock_session,
    )

    async def _setup(sid: str, sink: TranscriptSink):
        return MagicMock(), False

    with pytest.raises(asyncio.CancelledError):
        await orchestrator.run(_setup)

    assert orchestrator.started is False
    assert orchestrator.sink is not None
    assert orchestrator.sink.closed is True
    assert orchestrator.sink._worker_task.done() is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "is_custom,expected_code",
    [
        (True, "ERR_CUSTOM_RUNTIME"),
        (False, "ERR_SYSTEM_RUNTIME"),
    ],
)
async def test_orchestrator_sink_failure_notification(is_custom, expected_code):
    """验证 Sink 故障回调 _on_sink_failure 正确根据 is_custom 发送错误并断连。"""
    ctx = _create_mock_job_context()
    orchestrator = AgentJobOrchestrator(ctx)
    orchestrator.set_custom_mode(is_custom)
    orchestrator.safe_session_id = "test-session"

    await orchestrator._on_sink_failure("test reason")

    assert ctx.room.local_participant.publish_data.await_count == 1
    call_payload = json.loads(
        ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert call_payload["code"] == expected_code
    assert call_payload["message"] == SAFE_ERROR_MESSAGES[expected_code]
    assert ctx.room.disconnect.await_count == 1


@pytest.mark.asyncio
async def test_orchestrator_assistant_event_wiring():
    """验证 conversation_item_added 事件触发时正确调用注入的 persist_assistant_fn。"""
    ctx = _create_mock_job_context()
    captured_handlers = {}

    def mock_on(event_name):
        def decorator(fn):
            captured_handlers[event_name] = fn
            return fn

        return decorator

    mock_session = MagicMock()
    mock_session.on = mock_on
    mock_session.start = AsyncMock()

    mock_persist = MagicMock(return_value=True)

    orchestrator = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: mock_session,
        persist_assistant_fn=mock_persist,
    )

    await orchestrator.run(
        lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), False))
    )

    assert "conversation_item_added" in captured_handlers
    event = ConversationItemAddedEvent(
        item=llm.ChatMessage(role="assistant", content=["test"], id="item_1")
    )
    captured_handlers["conversation_item_added"](event)

    mock_persist.assert_called_once_with(
        event, orchestrator.session_id, sink=orchestrator.sink
    )
    await orchestrator.sink.close()


@pytest.mark.asyncio
async def test_entrypoint_delegates_to_orchestrator():
    """验证 entrypoint 执行时显式创建并调用 AgentJobOrchestrator.run。"""
    ctx = _create_mock_job_context()
    mock_settings = MagicMock(is_custom_mode=False)

    with (
        patch(
            "livekit_agent.agent._fetch_user_settings",
            AsyncMock(return_value=mock_settings),
        ),
        patch(
            "livekit_agent.agent._fetch_session_context", AsyncMock(return_value=None)
        ),
        patch(
            "livekit_agent.agent.ProviderRegistry.from_system_defaults", return_value={}
        ),
        patch("livekit_agent.agent.EchoTalkAgent", return_value=MagicMock()),
        patch("livekit_agent.agent.AgentSession") as mock_session_cls,
    ):
        mock_sess_inst = MagicMock()
        mock_sess_inst.on = MagicMock()
        mock_sess_inst.start = AsyncMock()
        mock_session_cls.return_value = mock_sess_inst

        await entrypoint(ctx)

        # 验证连接与启动已由编排器执行
        ctx.connect.assert_awaited_once()
        ctx.wait_for_participant.assert_awaited_once()
        mock_session_cls.assert_called_once()
        assert mock_session_cls.call_args.args == ()
        sdk_conn_options = mock_session_cls.call_args.kwargs["conn_options"]
        assert (
            sdk_conn_options.stt_conn_options.max_retry
            == SESSION_CONNECT_POLICY.stt.max_retry
        )
        assert (
            sdk_conn_options.llm_conn_options.retry_interval
            == SESSION_CONNECT_POLICY.llm.retry_interval
        )
        assert (
            sdk_conn_options.tts_conn_options.timeout
            == SESSION_CONNECT_POLICY.tts.timeout
        )
        assert (
            sdk_conn_options.max_unrecoverable_errors
            == SESSION_CONNECT_POLICY.max_unrecoverable_errors
        )
        mock_sess_inst.start.assert_awaited_once()
        assert len(ctx.shutdown_callbacks) == 1

        # 执行 shutdown callback 排空
        assert await ctx.shutdown_callbacks[0]() is True


@pytest.mark.asyncio
async def test_orchestrator_runtime_error_wiring():
    """验证 error 事件触发时，自定义轨且不可恢复错误正确调用 send_error_fn。"""
    ctx = _create_mock_job_context()
    captured_handlers = {}

    def mock_on(event_name):
        def decorator(fn):
            captured_handlers[event_name] = fn
            return fn

        return decorator

    mock_session = MagicMock()
    mock_session.on = mock_on
    mock_session.start = AsyncMock()

    orchestrator = AgentJobOrchestrator(
        ctx,
        session_factory=lambda: mock_session,
    )

    await orchestrator.run(
        lambda sid, sink: asyncio.sleep(0, result=(MagicMock(), True))
    )

    assert "error" in captured_handlers
    error_event = MagicMock(spec=ErrorEvent)
    error_event.error = MagicMock()
    error_event.error.error = Exception("Fatal custom error")
    error_event.error.type = "runtime"
    error_event.error.recoverable = False

    captured_handlers["error"](error_event)
    assert len(orchestrator._error_tasks) == 1

    assert await ctx.shutdown_callbacks[0]() is True
    assert len(orchestrator._error_tasks) == 0

    assert ctx.room.local_participant.publish_data.await_count == 1
    call_payload = json.loads(
        ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert call_payload["code"] == "ERR_CUSTOM_RUNTIME"
    assert ctx.room.disconnect.await_count == 1
    assert orchestrator.sink.closed is True


@pytest.mark.asyncio
async def test_orchestrator_close_sink_uses_is_failure_notification_task_boundary():
    """验证 Orchestrator._close_sink 使用公共 is_failure_notification_task 边界，零私有属性访问。"""
    ctx = _create_mock_job_context()
    orchestrator = AgentJobOrchestrator(ctx)

    class MockBoundarySink:
        def __init__(self):
            self.query_count = 0
            self.close_count = 0
            self.reentrant_mode = False

        def is_failure_notification_task(self):
            self.query_count += 1
            return self.reentrant_mode

        async def close(self):
            self.close_count += 1
            return True

        def __getattr__(self, name: str):
            if name == "_notify_task":
                raise AssertionError("Orchestrator 不得访问私有属性 _notify_task")
            raise AttributeError(name)

    mock_sink = MockBoundarySink()
    orchestrator.sink = mock_sink

    # 1. 非重入模式：query 返回 False，正常走 _sink_close_task 且返回 True
    mock_sink.reentrant_mode = False
    res1 = await orchestrator._close_sink()
    assert res1 is True
    assert mock_sink.query_count == 1
    assert mock_sink.close_count == 1

    # 2. 重入模式：query 返回 True，直接 await sink.close() 且不通过 _sink_close_task
    orchestrator._sink_close_task = None
    mock_sink.reentrant_mode = True
    res2 = await orchestrator._close_sink()
    assert res2 is True
    assert mock_sink.query_count == 2
    assert mock_sink.close_count == 2
