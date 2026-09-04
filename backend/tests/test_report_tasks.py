"""
Unit tests for report_tasks.py (Grammar error aggregation and report generation).
"""

import uuid
from datetime import datetime, timedelta
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from workers.report_tasks import (
    _generate_suggestion,
    get_top_grammar_errors,
    generate_weekly_report_async,
)


def test_generate_suggestion():
    sug_past = _generate_suggestion("verb_tense_past", "wrong_tense")
    assert "过去时态" in sug_past

    sug_verb = _generate_suggestion("subject_verb_agreement", "wrong_3p_verb")
    assert "主谓一致" in sug_verb

    sug_unknown = _generate_suggestion("unknown_tag", "unknown_error")
    assert "unknown_error" in sug_unknown
    assert "建议多复习" in sug_unknown


@pytest.mark.asyncio
async def test_get_top_grammar_errors_mock_db():
    mock_db = AsyncMock()
    user_id = uuid.uuid4()

    mock_row1 = ("verb_tense_past", "wrong_tense", 5, "I go yesterday", "I went yesterday")
    mock_row2 = ("subject_verb_agreement", "wrong_3p_verb", 3, "He go home", "He goes home")
    mock_row3 = ("article_usage", "missing_article", 2, "I have apple", "I have an apple")

    mock_result = MagicMock()
    mock_result.all.return_value = [mock_row1, mock_row2, mock_row3]
    mock_db.execute.return_value = mock_result

    res = await get_top_grammar_errors(mock_db, user_id, limit=3, days=7)

    assert len(res) == 3
    assert res[0]["skill_tag"] == "verb_tense_past"
    assert res[0]["count"] == 5
    assert res[0]["sample_original"] == "I go yesterday"
    assert "过去时态" in res[0]["suggestion"]

    assert res[1]["skill_tag"] == "subject_verb_agreement"
    assert res[1]["count"] == 3

    assert res[2]["skill_tag"] == "article_usage"
    assert res[2]["count"] == 2


@pytest.mark.asyncio
async def test_generate_weekly_report_async():
    user_id = str(uuid.uuid4())

    mock_top_errors = [
        {
            "skill_tag": "verb_tense_past",
            "error_type": "wrong_tense",
            "count": 4,
            "sample_original": "I go yesterday",
            "sample_corrected": "I went yesterday",
            "suggestion": "注意过去时态的使用。",
        }
    ]

    with patch("workers.report_tasks.async_session_maker") as mock_session_maker, patch(
        "workers.report_tasks.get_top_grammar_errors", new_callable=AsyncMock
    ) as mock_get_top:
        mock_db = AsyncMock()
        mock_session_maker.return_value.__aenter__.return_value = mock_db
        mock_get_top.return_value = mock_top_errors

        report = await generate_weekly_report_async(user_id)

        assert report["user_id"] == user_id
        assert report["status"] == "partial"
        assert "grammar_errors_summary" in report
        assert report["grammar_errors_summary"]["total_top_errors_count"] == 4
        assert len(report["grammar_errors_summary"]["top_errors"]) == 1
