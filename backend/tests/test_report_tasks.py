import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from models.session import Transcript, TranscriptRole
from workers.report_tasks import generate_weekly_report, get_emotion_summary_for_user


@pytest.mark.asyncio
async def test_get_emotion_summary_empty():
    user_id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    mock_db.execute.return_value = mock_result

    summary = await get_emotion_summary_for_user(user_id, mock_db)

    assert summary["average_anxiety_index"] == 0.0
    assert summary["average_wpm"] == 0.0
    assert summary["speech_rate_trends"] == []
    assert summary["total_transcripts_analyzed"] == 0


@pytest.mark.asyncio
async def test_get_emotion_summary_with_data():
    user_id = uuid.uuid4()
    session_id1 = uuid.uuid4()
    session_id2 = uuid.uuid4()

    t1 = Transcript(
        id=1,
        session_id=session_id1,
        role=TranscriptRole.user,
        content="Hello world",
        timestamp_ms=1000,
        emotion_state={
            "anxiety_level": 0.4,
            "cognitive_load": "normal",
            "hesitation_rate": 1.0,
            "wpm": 100.0,
        },
    )
    t2 = Transcript(
        id=2,
        session_id=session_id2,
        role=TranscriptRole.user,
        content="How are you doing",
        timestamp_ms=2000,
        emotion_state={
            "anxiety_level": 0.6,
            "cognitive_load": "high",
            "hesitation_rate": 3.5,
            "wpm": 120.0,
        },
    )

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [t1, t2]
    mock_db.execute.return_value = mock_result

    summary = await get_emotion_summary_for_user(str(user_id), mock_db)

    assert summary["average_anxiety_index"] == 0.5  # (0.4 + 0.6) / 2
    assert summary["average_wpm"] == 110.0  # (100.0 + 120.0) / 2
    assert summary["total_transcripts_analyzed"] == 2
    assert len(summary["speech_rate_trends"]) == 2

    trend1 = summary["speech_rate_trends"][0]
    assert trend1["session_id"] == str(session_id1)
    assert trend1["timestamp_ms"] == 1000
    assert trend1["wpm"] == 100.0
    assert trend1["anxiety_level"] == 0.4

    trend2 = summary["speech_rate_trends"][1]
    assert trend2["session_id"] == str(session_id2)
    assert trend2["timestamp_ms"] == 2000
    assert trend2["wpm"] == 120.0
    assert trend2["anxiety_level"] == 0.6


@pytest.mark.asyncio
async def test_get_emotion_summary_handles_partial_emotion_state():
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()

    t1 = Transcript(
        id=1,
        session_id=session_id,
        role=TranscriptRole.user,
        content="Testing partial state",
        timestamp_ms=1000,
        emotion_state={"anxiety_level": 0.3},  # missing wpm
    )

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [t1]
    mock_db.execute.return_value = mock_result

    summary = await get_emotion_summary_for_user(user_id, mock_db)

    assert summary["average_anxiety_index"] == 0.3
    assert summary["average_wpm"] == 0.0
    assert summary["total_transcripts_analyzed"] == 1
    assert summary["speech_rate_trends"][0]["wpm"] == 0.0


@pytest.mark.asyncio
async def test_generate_weekly_report_structure():
    user_id = str(uuid.uuid4())
    session_id = uuid.uuid4()

    t1 = Transcript(
        id=1,
        session_id=session_id,
        role=TranscriptRole.user,
        content="Sample transcript",
        timestamp_ms=1000,
        emotion_state={
            "anxiety_level": 0.2,
            "cognitive_load": "normal",
            "hesitation_rate": 0.0,
            "wpm": 130.0,
        },
    )

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [t1]
    mock_db.execute.return_value = mock_result

    start_time = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end_time = datetime(2025, 1, 7, tzinfo=timezone.utc)

    report = await generate_weekly_report(
        user_id, db=mock_db, start_time=start_time, end_time=end_time
    )

    assert report["user_id"] == user_id
    assert "emotion_summary" in report
    assert report["emotion_summary"]["average_anxiety_index"] == 0.2
    assert report["emotion_summary"]["average_wpm"] == 130.0
