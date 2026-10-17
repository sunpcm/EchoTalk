import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from livekit.agents import llm
from livekit.agents.voice.events import ConversationItemAddedEvent, _TypeDiscriminator

from livekit_agent.agent import _persist_assistant_conversation_item


@pytest.mark.asyncio
async def test_assistant_conversation_item_persists_transcript():
    event = ConversationItemAddedEvent(
        item=llm.ChatMessage(role="assistant", content=["Hello student!"])
    )
    with patch("livekit_agent.agent.save_transcript", new_callable=AsyncMock) as save:
        _persist_assistant_conversation_item(event, "test_session")
        await asyncio.sleep(0)
        save.assert_awaited_once_with("test_session", "assistant", "Hello student!")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "item",
    [
        llm.ChatMessage(role="user", content=["Hello teacher!"]),
        llm.ChatMessage(role="assistant", content=[""]),
        _TypeDiscriminator(),
    ],
)
async def test_non_assistant_text_is_ignored(item):
    event = ConversationItemAddedEvent(item=item)
    with patch("livekit_agent.agent.save_transcript", new_callable=AsyncMock) as save:
        _persist_assistant_conversation_item(event, "test_session")
        await asyncio.sleep(0)
        save.assert_not_awaited()
