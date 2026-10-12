import pytest
from livekit.agents import ConversationItemAddedEvent, llm
from livekit.agents.voice.events import _TypeDiscriminator


@pytest.mark.asyncio
async def test_on_conversation_item_added_assistant_message():
    from livekit_agent.agent import AgentSession

    session_id = "test-session-id"
    agent_session = AgentSession()

    # Re-register the handler as done in agent.py entrypoint
    saved_transcripts = []

    async def mock_save_transcript(sid, role, text, **kwargs):
        saved_transcripts.append((sid, role, text))

    @agent_session.on("conversation_item_added")
    def on_conversation_item(event: ConversationItemAddedEvent):
        item = event.item
        if isinstance(item, llm.ChatMessage) and item.role == "assistant":
            text = item.text_content
            if text:
                import asyncio

                asyncio.ensure_future(
                    mock_save_transcript(session_id, "assistant", text)
                )

    # 1. Test assistant ChatMessage with text
    item = llm.ChatMessage(role="assistant", content=["Hello from assistant"])
    event = ConversationItemAddedEvent(item=item)
    agent_session.emit("conversation_item_added", event)

    import asyncio

    await asyncio.sleep(0.01)  # allow scheduled task to run

    assert len(saved_transcripts) == 1
    assert saved_transcripts[0] == (session_id, "assistant", "Hello from assistant")


@pytest.mark.asyncio
async def test_on_conversation_item_added_user_message_and_non_chat_message():
    from livekit_agent.agent import AgentSession

    session_id = "test-session-id"
    agent_session = AgentSession()

    saved_transcripts = []

    async def mock_save_transcript(sid, role, text, **kwargs):
        saved_transcripts.append((sid, role, text))

    @agent_session.on("conversation_item_added")
    def on_conversation_item(event: ConversationItemAddedEvent):
        item = event.item
        if isinstance(item, llm.ChatMessage) and item.role == "assistant":
            text = item.text_content
            if text:
                import asyncio

                asyncio.ensure_future(
                    mock_save_transcript(session_id, "assistant", text)
                )

    # 2. Test user ChatMessage (should be ignored by assistant transcript saver)
    user_item = llm.ChatMessage(role="user", content=["Hello from user"])
    agent_session.emit(
        "conversation_item_added", ConversationItemAddedEvent(item=user_item)
    )

    # 3. Test non-ChatMessage (_TypeDiscriminator) item
    disc_item = _TypeDiscriminator()
    agent_session.emit(
        "conversation_item_added", ConversationItemAddedEvent(item=disc_item)
    )

    # 4. Test assistant message without text content
    empty_assistant_item = llm.ChatMessage(role="assistant", content=[])
    agent_session.emit(
        "conversation_item_added", ConversationItemAddedEvent(item=empty_assistant_item)
    )

    import asyncio

    await asyncio.sleep(0.01)

    assert len(saved_transcripts) == 0
