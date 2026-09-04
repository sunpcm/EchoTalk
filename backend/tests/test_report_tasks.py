"""
周报任务 worker 测试文件。
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from workers.report_tasks import fetch_emotion_summary, generate_weekly_report


@pytest.mark.asyncio
async def test_fetch_emotion_summary_invalid_user_id():
    result = await fetch_emotion_summary("invalid-uuid-string")
    assert result["status"] == "invalid_user_id"
    assert result["avg_anxiety_index"] is None
    assert result["sample_count"] == 0


@pytest.mark.asyncio
async def test_fetch_emotion_summary_no_data():
    valid_uuid = str(uuid.uuid4())
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    mock_session.execute.return_value = mock_result

    with patch("workers.report_tasks.async_session_maker") as mock_maker:
        mock_maker.return_value.__aenter__.return_value = mock_session
        result = await fetch_emotion_summary(valid_uuid)

    assert result["status"] == "no_data"
    assert result["avg_anxiety_index"] == 0.0
    assert result["avg_wpm"] == 0.0
    assert result["avg_hesitation_rate"] == 0.0
    assert result["sample_count"] == 0


@pytest.mark.asyncio
async def test_fetch_emotion_summary_success():
    valid_uuid = str(uuid.uuid4())
    mock_session = AsyncMock()
    mock_result = MagicMock()

    sample_emotion_states = [
        {"anxiety_level": 0.4, "wpm": 120.0, "hesitation_rate": 2.0},
        {"anxiety_level": 0.6, "wpm": 100.0, "hesitation_rate": 4.0},
        {"anxiety_level": 0.2, "wpm": 140.0, "hesitation_rate": 1.0},
    ]

    mock_result.scalars.return_value.all.return_value = sample_emotion_states
    mock_session.execute.return_value = mock_result

    with patch("workers.report_tasks.async_session_maker") as mock_maker:
        mock_maker.return_value.__aenter__.return_value = mock_session
        result = await fetch_emotion_summary(valid_uuid)

    assert result["status"] == "success"
    assert result["avg_anxiety_index"] == 0.4  # (0.4 + 0.6 + 0.2) / 3 = 0.4
    assert result["avg_wpm"] == 120.0  # (120 + 100 + 140) / 3 = 120.0
    assert result["avg_hesitation_rate"] == 2.33  # (2 + 4 + 1) / 3 = 2.33
    assert result["sample_count"] == 3


def test_generate_weekly_report():
    valid_uuid = str(uuid.uuid4())
    fake_emotion_summary = {
        "avg_anxiety_index": 0.35,
        "avg_wpm": 115.0,
        "avg_hesitation_rate": 1.8,
        "sample_count": 5,
        "status": "success",
    }

    with patch("workers.report_tasks.fetch_emotion_summary", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = fake_emotion_summary
        report = generate_weekly_report(valid_uuid)

    assert report["user_id"] == valid_uuid
    assert report["status"] == "skeleton"
    assert "emotion_summary" in report
    assert report["emotion_summary"]["avg_anxiety_index"] == 0.35
    assert report["emotion_summary"]["avg_wpm"] == 115.0
