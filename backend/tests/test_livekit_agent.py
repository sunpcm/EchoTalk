import asyncio
import logging
import uuid
from unittest.mock import MagicMock, patch

import pytest
from livekit.agents import llm
from livekit.agents.voice.events import ConversationItemAddedEvent, _TypeDiscriminator

from livekit_agent.agent import EchoTalkAgent, _persist_assistant_conversation_item
from livekit_agent.transcript_events import derive_transcript_event_id


class _TaskCapturer:
    """捕获 asyncio.ensure_future 创建的后台任务以支持确定性 await。"""

    def __init__(self):
        self.tasks: list[asyncio.Future] = []
        self._orig = asyncio.ensure_future

    def __enter__(self):
        def _capture(coro_or_future, *args, **kwargs):
            task = self._orig(coro_or_future, *args, **kwargs)
            self.tasks.append(task)
            return task

        self._patcher = patch("asyncio.ensure_future", side_effect=_capture)
        self._patcher.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._patcher.stop()

    async def wait_all(self):
        if self.tasks:
            await asyncio.gather(*self.tasks)


@pytest.mark.asyncio
async def test_assistant_conversation_item_persists_transcript():
    """验证 assistant 消息携带有效 id 时，稳定派生 event_id 并通过 Sink submit（确定性接线）。"""
    session_id = str(uuid.uuid4())
    item_id = "item_assistant_001"
    event = ConversationItemAddedEvent(
        item=llm.ChatMessage(role="assistant", content=["Hello student!"], id=item_id)
    )
    expected_event_id = derive_transcript_event_id(session_id, "assistant", item_id)
    assert expected_event_id is not None

    mock_sink = MagicMock()
    _persist_assistant_conversation_item(event, session_id, sink=mock_sink)
    mock_sink.submit.assert_called_once_with(
        "assistant",
        "Hello student!",
        event_id=expected_event_id,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_item_id",
    [
        None,
        "",
        "   ",
    ],
)
async def test_assistant_conversation_item_missing_id_is_ignored(bad_item_id):
    """验证 assistant 消息缺失或空 item_id 时，安全拒绝且不调用 Sink submit。"""
    session_id = str(uuid.uuid4())
    msg = llm.ChatMessage(role="assistant", content=["Hello student!"])
    msg.id = bad_item_id  # 模拟缺失或空 id
    event = ConversationItemAddedEvent(item=msg)

    mock_sink = MagicMock()
    _persist_assistant_conversation_item(event, session_id, sink=mock_sink)
    mock_sink.submit.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "item",
    [
        llm.ChatMessage(role="user", content=["Hello teacher!"], id="item_user_001"),
        llm.ChatMessage(role="assistant", content=[""], id="item_asst_002"),
        _TypeDiscriminator(),
    ],
)
async def test_non_assistant_text_is_ignored(item):
    """验证非 assistant 角色或空文本被正确忽略。"""
    session_id = str(uuid.uuid4())
    event = ConversationItemAddedEvent(item=item)
    mock_sink = MagicMock()
    _persist_assistant_conversation_item(event, session_id, sink=mock_sink)
    mock_sink.submit.assert_not_called()


@pytest.mark.asyncio
async def test_user_turn_completed_persists_transcript_with_event_id():
    """验证用户发言完成后，从 new_message.id 稳定派生 event_id 并调用 Sink submit。"""
    session_id = str(uuid.uuid4())
    item_id = "item_user_say_hello"
    mock_sink = MagicMock()
    agent = EchoTalkAgent(
        session_id=session_id, instructions="test instructions", sink=mock_sink
    )
    msg = llm.ChatMessage(role="user", content=["I am fine, thank you!"], id=item_id)
    expected_event_id = derive_transcript_event_id(session_id, "user", item_id)
    assert expected_event_id is not None

    turn_ctx = MagicMock()
    await agent.on_user_turn_completed(turn_ctx, msg)
    assert mock_sink.submit.call_count == 1
    args, kwargs = mock_sink.submit.call_args
    assert args[0] == "user"
    assert args[1] == "I am fine, thank you!"
    assert kwargs.get("event_id") == expected_event_id
    assert kwargs.get("emotion_state") is not None


@pytest.mark.asyncio
async def test_user_turn_completed_missing_id_is_ignored():
    """验证用户发言消息缺失有效 id 时，不发起 Sink submit 调用。"""
    session_id = str(uuid.uuid4())
    mock_sink = MagicMock()
    agent = EchoTalkAgent(
        session_id=session_id, instructions="test instructions", sink=mock_sink
    )
    msg = llm.ChatMessage(role="user", content=["I am fine, thank you!"])
    msg.id = None  # 缺失有效 id

    turn_ctx = MagicMock()
    await agent.on_user_turn_completed(turn_ctx, msg)
    mock_sink.submit.assert_not_called()


def test_transcript_event_id_properties():
    """验证稳定派生函数的确定性、重发一致性、opaque 保留与跨域隔离属性。"""
    s1 = str(uuid.uuid4())
    s2 = str(uuid.uuid4())

    # 1. 相同 session, role, item_id 重发派生完全相同
    ev1 = derive_transcript_event_id(s1, "user", "item_001")
    ev2 = derive_transcript_event_id(s1, "user", "item_001")
    assert ev1 is not None and ev1 == ev2

    # 2. 相同 session/role，不同 item_id 派生不同
    ev3 = derive_transcript_event_id(s1, "user", "item_002")
    assert ev1 != ev3

    # 3. opaque source_item_id：不同非空 ID（含空格不同）严格不被合并
    ev_padded = derive_transcript_event_id(s1, "user", " item_001 ")
    assert ev_padded is not None
    assert ev_padded != ev1

    # 4. 相同 session/item_id，不同 role 域隔离
    ev_asst = derive_transcript_event_id(s1, "assistant", "item_001")
    assert ev1 != ev_asst

    # 5. 相同 role/item_id，不同 session 域隔离
    ev_s2 = derive_transcript_event_id(s2, "user", "item_001")
    assert ev1 != ev_s2

    # 6. 非法参数安全返回 None
    assert derive_transcript_event_id(None, "user", "item_001") is None
    assert derive_transcript_event_id("bad-session", "user", "item_001") is None
    assert derive_transcript_event_id(s1, "invalid_role", "item_001") is None
    assert derive_transcript_event_id(s1, "user", "") is None
    assert derive_transcript_event_id(s1, "user", "   ") is None


def test_transcript_event_id_safe_logging(caplog):
    """验证非法输入不回显未知正文或 Canary，record 字典绝对干净。"""
    canary = "SECRET_CANARY_ROLE_TOKEN_998877"
    with caplog.at_level(logging.WARNING, logger="echotalk-agent"):
        ev = derive_transcript_event_id(
            str(uuid.uuid4()), f"bad_role_{canary}", "item_01"
        )
        assert ev is None
        assert len(caplog.records) >= 1
        for record in caplog.records:
            assert canary not in record.message
            assert canary not in str(record.__dict__)
