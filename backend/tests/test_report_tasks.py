import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from workers.report_tasks import (
    calculate_pronunciation_trends,
    generate_weekly_report,
)


class DummySession:
    def __init__(self, session_id: uuid.UUID, user_id: uuid.UUID, started_at: datetime):
        self.id = session_id
        self.user_id = user_id
        self.started_at = started_at


class DummyPronunciationAssessment:
    def __init__(
        self,
        assessment_id: uuid.UUID,
        session_id: uuid.UUID,
        overall_score: float,
        created_at: datetime,
        is_synthetic: bool = False,
    ):
        self.id = assessment_id
        self.session_id = session_id
        self.overall_score = overall_score
        self.created_at = created_at
        self.is_synthetic = is_synthetic


@pytest.mark.asyncio
async def test_calculate_pronunciation_trends_invalid_uuid():
    mock_db = AsyncMock()
    result = await calculate_pronunciation_trends(mock_db, "invalid-uuid-str")

    assert result["total_sessions"] == 0
    assert result["average_score"] == 0.0
    assert result["max_score"] == 0.0
    assert result["min_score"] == 0.0
    assert result["score_delta"] == 0.0
    assert result["trend"] == "insufficient_data"
    assert result["sessions"] == []
    mock_db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_calculate_pronunciation_trends_empty():
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.all.return_value = []
    mock_db.execute.return_value = mock_result

    user_id = uuid.uuid4()
    result = await calculate_pronunciation_trends(mock_db, user_id)

    assert result["total_sessions"] == 0
    assert result["trend"] == "insufficient_data"
    assert result["sessions"] == []


@pytest.mark.asyncio
async def test_calculate_pronunciation_trends_single_session():
    mock_db = AsyncMock()
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    dummy_session = DummySession(session_id, user_id, now)
    dummy_assessment = DummyPronunciationAssessment(uuid.uuid4(), session_id, 82.5, now)

    mock_result = MagicMock()
    mock_result.all.return_value = [(dummy_assessment, dummy_session)]
    mock_db.execute.return_value = mock_result

    result = await calculate_pronunciation_trends(mock_db, user_id)

    assert result["total_sessions"] == 1
    assert result["average_score"] == 82.5
    assert result["max_score"] == 82.5
    assert result["min_score"] == 82.5
    assert result["score_delta"] == 0.0
    assert result["trend"] == "stable"
    assert len(result["sessions"]) == 1
    assert result["sessions"][0]["session_id"] == str(session_id)
    assert result["sessions"][0]["overall_score"] == 82.5


@pytest.mark.asyncio
async def test_calculate_pronunciation_trends_improving():
    mock_db = AsyncMock()
    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    s1 = DummySession(uuid.uuid4(), user_id, now)
    a1 = DummyPronunciationAssessment(uuid.uuid4(), s1.id, 65.0, now)

    s2 = DummySession(uuid.uuid4(), user_id, now)
    a2 = DummyPronunciationAssessment(uuid.uuid4(), s2.id, 75.0, now)

    s3 = DummySession(uuid.uuid4(), user_id, now)
    a3 = DummyPronunciationAssessment(uuid.uuid4(), s3.id, 90.0, now)

    mock_result = MagicMock()
    mock_result.all.return_value = [(a1, s1), (a2, s2), (a3, s3)]
    mock_db.execute.return_value = mock_result

    result = await calculate_pronunciation_trends(mock_db, str(user_id))

    assert result["total_sessions"] == 3
    assert result["average_score"] == 76.67
    assert result["max_score"] == 90.0
    assert result["min_score"] == 65.0
    assert result["score_delta"] > 2.0
    assert result["trend"] == "improving"


@pytest.mark.asyncio
async def test_calculate_pronunciation_trends_declining():
    mock_db = AsyncMock()
    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    s1 = DummySession(uuid.uuid4(), user_id, now)
    a1 = DummyPronunciationAssessment(uuid.uuid4(), s1.id, 90.0, now)

    s2 = DummySession(uuid.uuid4(), user_id, now)
    a2 = DummyPronunciationAssessment(uuid.uuid4(), s2.id, 60.0, now)

    mock_result = MagicMock()
    mock_result.all.return_value = [(a1, s1), (a2, s2)]
    mock_db.execute.return_value = mock_result

    result = await calculate_pronunciation_trends(mock_db, user_id)

    assert result["total_sessions"] == 2
    assert result["average_score"] == 75.0
    assert result["score_delta"] < -2.0
    assert result["trend"] == "declining"


@pytest.mark.asyncio
async def test_calculate_pronunciation_trends_stable():
    mock_db = AsyncMock()
    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    s1 = DummySession(uuid.uuid4(), user_id, now)
    a1 = DummyPronunciationAssessment(uuid.uuid4(), s1.id, 80.0, now)

    s2 = DummySession(uuid.uuid4(), user_id, now)
    a2 = DummyPronunciationAssessment(uuid.uuid4(), s2.id, 81.0, now)

    mock_result = MagicMock()
    mock_result.all.return_value = [(a1, s1), (a2, s2)]
    mock_db.execute.return_value = mock_result

    result = await calculate_pronunciation_trends(mock_db, user_id)

    assert result["total_sessions"] == 2
    assert result["score_delta"] == 1.0
    assert result["trend"] == "stable"


@pytest.mark.asyncio
async def test_calculate_pronunciation_trends_filters():
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.all.return_value = []
    mock_db.execute.return_value = mock_result

    user_id = uuid.uuid4()
    start_time = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end_time = datetime(2025, 1, 31, tzinfo=timezone.utc)

    result = await calculate_pronunciation_trends(
        mock_db,
        user_id,
        start_time=start_time,
        end_time=end_time,
        include_synthetic=True,
    )

    assert result["total_sessions"] == 0
    mock_db.execute.assert_called_once()


@pytest.mark.asyncio
async def test_generate_weekly_report_with_db():
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.all.return_value = []
    mock_db.execute.return_value = mock_result

    user_id_str = str(uuid.uuid4())
    report = await generate_weekly_report(user_id_str, db=mock_db)

    assert report["user_id"] == user_id_str
    assert report["status"] == "partial"
    assert "pronunciation_trends" in report
    assert report["pronunciation_trends"]["total_sessions"] == 0


@pytest.mark.asyncio
async def test_generate_weekly_report_without_db():
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.all.return_value = []
    mock_session.execute.return_value = mock_result

    class MockAsyncSessionContext:
        async def __aenter__(self):
            return mock_session

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    user_id_str = str(uuid.uuid4())

    with patch(
        "workers.report_tasks.async_session_maker",
        return_value=MockAsyncSessionContext(),
    ):
        report = await generate_weekly_report(user_id_str)

    assert report["user_id"] == user_id_str
    assert report["status"] == "partial"
    assert "pronunciation_trends" in report
