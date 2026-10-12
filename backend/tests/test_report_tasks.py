import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from models.knowledge import KnowledgeState, Skill
from workers.report_tasks import (
    generate_weekly_report,
    generate_weekly_report_async,
    get_skill_trends,
)


@pytest.mark.asyncio
async def test_get_skill_trends_empty():
    mock_db = AsyncMock()
    mock_res = MagicMock()
    mock_res.all.return_value = []
    mock_db.execute.return_value = mock_res

    random_user_id = uuid.uuid4()
    trends = await get_skill_trends(mock_db, random_user_id)
    assert trends == []
    mock_db.execute.assert_called_once()


@pytest.mark.asyncio
async def test_get_skill_trends_with_active_and_old_data():
    mock_db = AsyncMock()
    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    two_weeks_ago = now - timedelta(days=14)

    skill1 = Skill(
        id="verb_tense_past",
        name="Past Tense",
        category="grammar",
        description="Past tense usage",
    )
    state1 = KnowledgeState(
        id=uuid.uuid4(),
        user_id=user_id,
        skill_id=skill1.id,
        p_mastery=0.85,
        updated_at=now,
    )

    skill2 = Skill(
        id="th_sounds",
        name="TH Sounds",
        category="pronunciation",
        description="TH sounds",
    )
    state2 = KnowledgeState(
        id=uuid.uuid4(),
        user_id=user_id,
        skill_id=skill2.id,
        p_mastery=0.50,
        updated_at=two_weeks_ago,
    )

    mock_res = MagicMock()
    mock_res.all.return_value = [(state1, skill1), (state2, skill2)]
    mock_db.execute.return_value = mock_res

    trends = await get_skill_trends(mock_db, str(user_id))
    assert len(trends) == 2

    active_trend = trends[0]
    assert active_trend["skill_id"] == "verb_tense_past"
    assert active_trend["p_mastery"] == 0.85
    assert active_trend["p_mastery_change"] == 0.75
    assert active_trend["is_active_this_week"] is True

    old_trend = trends[1]
    assert old_trend["skill_id"] == "th_sounds"
    assert old_trend["p_mastery"] == 0.50
    assert old_trend["p_mastery_change"] == 0.0
    assert old_trend["is_active_this_week"] is False


@pytest.mark.asyncio
async def test_get_skill_trends_invalid_uuid():
    mock_db = AsyncMock()
    trends = await get_skill_trends(mock_db, "invalid-uuid-string")
    assert trends == []
    mock_db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_generate_weekly_report_async():
    mock_db = AsyncMock()
    user_id = str(uuid.uuid4())
    mock_res = MagicMock()
    mock_res.all.return_value = []
    mock_db.execute.return_value = mock_res

    report = await generate_weekly_report_async(mock_db, user_id)
    assert report["user_id"] == user_id
    assert "skill_trends" in report
    assert report["skill_trends"] == []


def test_generate_weekly_report_sync(monkeypatch):
    mock_db = AsyncMock()
    mock_res = MagicMock()
    mock_res.all.return_value = []
    mock_db.execute.return_value = mock_res

    class MockAsyncSessionMaker:
        def __call__(self):
            return self

        async def __aenter__(self):
            return mock_db

        async def __aexit__(self, exc_type, exc, tb):
            pass

    monkeypatch.setattr("database.async_session_maker", MockAsyncSessionMaker())

    user_id = str(uuid.uuid4())
    report = generate_weekly_report(user_id)
    assert report["user_id"] == user_id
    assert "skill_trends" in report
    assert report["skill_trends"] == []
