import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models.session import Transcript, TranscriptRole
from services.transcript_service import save_transcript


@pytest.mark.asyncio
async def test_save_transcript_empty_or_whitespace_content():
    """验证当 content 为空或全空白字符时，直接返回 None，不操作数据库。"""
    with patch("services.transcript_service.async_session_maker") as mock_maker:
        result_empty = await save_transcript(str(uuid.uuid4()), "user", "")
        result_spaces = await save_transcript(str(uuid.uuid4()), "user", "   \n\t  ")

        assert result_empty is None
        assert result_spaces is None
        mock_maker.assert_not_called()


@pytest.mark.asyncio
async def test_save_transcript_success_default_timestamp():
    """验证正常保存 user 转录记录，自动生成时间戳并正确设置 emotion_state。"""
    session_id_str = str(uuid.uuid4())
    content = "Hello, I am testing."
    emotion_state = {"valence": 0.8, "arousal": 0.5}

    mock_session = AsyncMock()
    mock_session.add = MagicMock()

    mock_maker = MagicMock()
    mock_maker.return_value.__aenter__.return_value = mock_session

    with patch("services.transcript_service.async_session_maker", mock_maker), patch(
        "time.time", return_value=1700000000.123
    ):
        result = await save_transcript(
            session_id=session_id_str,
            role="user",
            content=content,
            timestamp_ms=None,
            emotion_state=emotion_state,
        )

        assert result is not None
        assert isinstance(result, Transcript)
        assert result.session_id == uuid.UUID(session_id_str)
        assert result.role == TranscriptRole.user
        assert result.content == "Hello, I am testing."
        assert result.timestamp_ms == 1700000000123
        assert result.emotion_state == emotion_state

        mock_session.add.assert_called_once_with(result)
        mock_session.commit.assert_awaited_once()
        mock_session.refresh.assert_awaited_once_with(result)


@pytest.mark.asyncio
async def test_save_transcript_success_custom_timestamp_assistant_role():
    """验证正常保存 assistant 转录记录，使用自定义时间戳并自动去除文本前后空白。"""
    session_id_str = str(uuid.uuid4())
    content = "  Hello! How can I help you today?  "
    custom_timestamp = 1690000000000

    mock_session = AsyncMock()
    mock_session.add = MagicMock()

    with patch("services.transcript_service.async_session_maker") as mock_maker:
        mock_maker.return_value.__aenter__.return_value = mock_session

        result = await save_transcript(
            session_id=session_id_str,
            role="assistant",
            content=content,
            timestamp_ms=custom_timestamp,
            emotion_state=None,
        )

        assert result is not None
        assert isinstance(result, Transcript)
        assert result.session_id == uuid.UUID(session_id_str)
        assert result.role == TranscriptRole.assistant
        assert result.content == "Hello! How can I help you today?"
        assert result.timestamp_ms == custom_timestamp
        assert result.emotion_state is None

        mock_session.add.assert_called_once_with(result)
        mock_session.commit.assert_awaited_once()
        mock_session.refresh.assert_awaited_once_with(result)


@pytest.mark.asyncio
async def test_save_transcript_invalid_session_id():
    """验证传入无效 session_id (不是 UUID) 时，捕获异常并返回 None。"""
    mock_session = AsyncMock()
    mock_session.add = MagicMock()

    with patch("services.transcript_service.async_session_maker") as mock_maker:
        mock_maker.return_value.__aenter__.return_value = mock_session

        result = await save_transcript(
            session_id="invalid-uuid-string",
            role="user",
            content="Hello",
        )

        assert result is None


@pytest.mark.asyncio
async def test_save_transcript_invalid_role():
    """验证传入无效 role 时，捕获 Enum 校验异常并返回 None。"""
    session_id_str = str(uuid.uuid4())
    mock_session = AsyncMock()
    mock_session.add = MagicMock()

    with patch("services.transcript_service.async_session_maker") as mock_maker:
        mock_maker.return_value.__aenter__.return_value = mock_session

        result = await save_transcript(
            session_id=session_id_str,
            role="system_admin",  # invalid role for TranscriptRole enum
            content="Hello",
        )

        assert result is None


@pytest.mark.asyncio
async def test_save_transcript_db_exception():
    """验证当数据库操作 (commit) 抛出异常时，捕获异常并返回 None。"""
    session_id_str = str(uuid.uuid4())
    mock_session = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.commit.side_effect = Exception("Database connection error")

    with patch("services.transcript_service.async_session_maker") as mock_maker:
        mock_maker.return_value.__aenter__.return_value = mock_session

        result = await save_transcript(
            session_id=session_id_str,
            role="user",
            content="Hello",
        )

        assert result is None
