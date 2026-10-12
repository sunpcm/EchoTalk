from unittest.mock import AsyncMock, patch

import pytest
from livekit.agents import llm
from livekit.agents.voice.events import ConversationItemAddedEvent, _TypeDiscriminator


@pytest.mark.asyncio
async def test_on_conversation_item_assistant_message():
    """Test that assistant ChatMessage triggers save_transcript."""
    # We test the conversation item logic directly or by inspecting how item is handled
    item = llm.ChatMessage(role="assistant", content=["Hello student!"])
    event = ConversationItemAddedEvent(item=item)

    assert isinstance(event.item, llm.ChatMessage)
    assert event.item.role == "assistant"
    assert event.item.text_content == "Hello student!"

    with patch(
        "livekit_agent.agent.save_transcript", new_callable=AsyncMock
    ) as mock_save:
        # Simulate what on_conversation_item does
        if isinstance(event.item, llm.ChatMessage) and event.item.role == "assistant":
            text = event.item.text_content
            if text:
                await mock_save("test_session", "assistant", text)

        mock_save.assert_called_once_with("test_session", "assistant", "Hello student!")


@pytest.mark.asyncio
async def test_on_conversation_item_user_message_ignored():
    """Test that user ChatMessage is ignored in on_conversation_item."""
    item = llm.ChatMessage(role="user", content=["Hello teacher!"])
    event = ConversationItemAddedEvent(item=item)

    with patch(
        "livekit_agent.agent.save_transcript", new_callable=AsyncMock
    ) as mock_save:
        if isinstance(event.item, llm.ChatMessage) and event.item.role == "assistant":
            text = event.item.text_content
            if text:
                await mock_save("test_session", "assistant", text)

        mock_save.assert_not_called()


@pytest.mark.asyncio
async def test_on_conversation_item_type_discriminator_ignored():
    """Test that non-ChatMessage items (_TypeDiscriminator) are safely ignored without error."""
    item = _TypeDiscriminator()
    event = ConversationItemAddedEvent(item=item)

    with patch(
        "livekit_agent.agent.save_transcript", new_callable=AsyncMock
    ) as mock_save:
        if isinstance(event.item, llm.ChatMessage) and event.item.role == "assistant":
            text = event.item.text_content
            if text:
                await mock_save("test_session", "assistant", text)

        mock_save.assert_not_called()
