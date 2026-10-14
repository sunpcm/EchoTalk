import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models.session import Session, SessionMode, SessionStatus
from workers.report_tasks import (
    generate_weekly_report,
    get_current_week_start,
    get_weekly_emotion_summary,
    get_weekly_grammar_errors,
    get_weekly_practice_stats,
    get_weekly_pronunciation,
)


def _mock_db(sessions: list[Session]) -> AsyncMock:
    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = sessions
    db.execute.return_value = result
    return db


@pytest.mark.asyncio
async def test_get_weekly_practice_stats_success():
    user_id = uuid.uuid4()
    now = datetime.utcnow()
    start_of_week = get_current_week_start(now).replace(tzinfo=None)

    # Session 1: completed, duration 1800s (30m)
    s1 = Session(
        id=uuid.uuid4(),
        user_id=user_id,
        mode=SessionMode.pronunciation,
        status=SessionStatus.completed,
        started_at=start_of_week + timedelta(hours=1),
        ended_at=start_of_week + timedelta(hours=1, minutes=30),
    )
    # Session 2: completed, duration 900s (15m)
    s2 = Session(
        id=uuid.uuid4(),
        user_id=user_id,
        mode=SessionMode.free_talk,
        status=SessionStatus.completed,
        started_at=start_of_week + timedelta(hours=2),
        ended_at=start_of_week + timedelta(hours=2, minutes=15),
    )
    # Session 3: active, no ended_at
    s3 = Session(
        id=uuid.uuid4(),
        user_id=user_id,
        mode=SessionMode.conversation,
        status=SessionStatus.active,
        started_at=start_of_week + timedelta(hours=3),
        ended_at=None,
    )

    db = _mock_db([s1, s2, s3])

    stats = await get_weekly_practice_stats(
        db=db,
        user_id=user_id,
        start_time=start_of_week,
    )

    assert stats["total_sessions"] == 3
    assert stats["completed_sessions"] == 2
    assert stats["total_practice_seconds"] == 2700.0
    assert stats["total_practice_minutes"] == 45.0
    assert stats["avg_session_duration_seconds"] == 1350.0
    assert stats["sessions_by_mode"] == {
        "pronunciation": 1,
        "free_talk": 1,
        "conversation": 1,
    }


@pytest.mark.asyncio
async def test_get_weekly_practice_stats_empty():
    user_id = uuid.uuid4()
    db = _mock_db([])

    stats = await get_weekly_practice_stats(
        db=db,
        user_id=user_id,
    )

    assert stats["total_sessions"] == 0
    assert stats["completed_sessions"] == 0
    assert stats["total_practice_seconds"] == 0.0
    assert stats["total_practice_minutes"] == 0.0
    assert stats["avg_session_duration_seconds"] == 0.0
    assert stats["sessions_by_mode"] == {}


@pytest.mark.asyncio
async def test_get_weekly_practice_stats_accepts_str_user_id():
    user_id = uuid.uuid4()
    db = _mock_db([])

    stats = await get_weekly_practice_stats(
        db=db,
        user_id=str(user_id),
    )

    assert stats["total_sessions"] == 0


@pytest.mark.asyncio
async def test_generate_weekly_report_with_db():
    user_id = uuid.uuid4()
    db = _mock_db([])

    with (
        patch(
            "workers.report_tasks.get_weekly_pronunciation",
            new_callable=AsyncMock,
            return_value={},
        ),
        patch(
            "workers.report_tasks.get_weekly_grammar_errors",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "workers.report_tasks.get_weekly_emotion_summary",
            new_callable=AsyncMock,
            return_value={},
        ),
    ):
        report = await generate_weekly_report(user_id=str(user_id), db=db)

    assert report["user_id"] == str(user_id)
    assert report["status"] == "partial"
    assert "weekly_practice_stats" in report
    assert report["weekly_practice_stats"]["total_sessions"] == 0


@pytest.mark.asyncio
async def test_generate_weekly_report_without_db():
    user_id = uuid.uuid4()
    mock_session = _mock_db([])

    class MockAsyncSessionMaker:
        async def __aenter__(self):
            return mock_session

        async def __aexit__(self, exc_type, exc, tb):
            pass

    with (
        patch(
            "workers.report_tasks.async_session_maker",
            return_value=MockAsyncSessionMaker(),
        ),
        patch(
            "workers.report_tasks.get_weekly_pronunciation",
            new_callable=AsyncMock,
            return_value={},
        ),
        patch(
            "workers.report_tasks.get_weekly_grammar_errors",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "workers.report_tasks.get_weekly_emotion_summary",
            new_callable=AsyncMock,
            return_value={},
        ),
    ):
        report = await generate_weekly_report(user_id=str(user_id))

    assert report["user_id"] == str(user_id)
    assert "weekly_practice_stats" in report
    assert report["weekly_practice_stats"]["total_sessions"] == 0


@pytest.mark.asyncio
async def test_weekly_pronunciation_needs_two_real_scores_for_delta():
    user_id = uuid.uuid4()
    db = AsyncMock()
    result = MagicMock()
    assessment = MagicMock(overall_score=82.5)
    session = MagicMock(id=uuid.uuid4())
    result.all.return_value = [(assessment, session)]
    db.execute.return_value = result
    start = get_current_week_start()

    summary = await get_weekly_pronunciation(
        db, user_id, start, start + timedelta(days=7)
    )

    assert summary["average_score"] == 82.5
    assert summary["score_delta"] is None
    assert summary["sessions"][0]["session_id"] == str(session.id)


@pytest.mark.asyncio
async def test_weekly_grammar_examples_match_top_error():
    user_id = uuid.uuid4()
    db = AsyncMock()
    counts = MagicMock()
    counts.all.return_value = [("tense", "wrong_tense", 2)]
    examples = MagicMock()
    examples.all.return_value = [("I go yesterday", "I went yesterday")]
    db.execute.side_effect = [counts, examples]
    start = get_current_week_start()

    errors = await get_weekly_grammar_errors(
        db, user_id, start, start + timedelta(days=7)
    )

    assert errors[0]["count"] == 2
    assert errors[0]["examples"] == [
        {"original": "I go yesterday", "corrected": "I went yesterday"}
    ]


@pytest.mark.asyncio
async def test_weekly_emotion_averages_only_present_values():
    user_id = uuid.uuid4()
    db = AsyncMock()
    result = MagicMock()
    first = MagicMock(
        session_id=uuid.uuid4(),
        timestamp_ms=1000,
        emotion_state={"anxiety_level": 0.4, "wpm": 120},
    )
    second = MagicMock(
        session_id=first.session_id,
        timestamp_ms=2000,
        emotion_state={"wpm": 140},
    )
    result.scalars.return_value.all.return_value = [first, second]
    db.execute.return_value = result
    start = get_current_week_start()

    summary = await get_weekly_emotion_summary(
        db, user_id, start, start + timedelta(days=7)
    )

    assert summary["total_transcripts_analyzed"] == 2
    assert summary["average_anxiety_index"] == 0.4
    assert summary["average_wpm"] == 130.0
