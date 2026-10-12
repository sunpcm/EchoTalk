import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from workers.report_tasks import (
    compile_top_grammar_errors,
    generate_weekly_report,
    generate_weekly_report_async,
    get_suggestion_for_error,
)


def test_get_suggestion_for_error():
    # Known error_type
    sug_tense = get_suggestion_for_error("verb_tense_past", "wrong_tense")
    assert "verb tenses" in sug_tense or "past tense" in sug_tense

    # Known skill_tag
    sug_agree = get_suggestion_for_error("subject_verb_agreement", "custom_error")
    assert "subject and verb agree" in sug_agree

    # Fallback to skill_desc
    sug_desc = get_suggestion_for_error(
        "custom_skill", "custom_error", skill_desc="Custom Grammar Skill"
    )
    assert sug_desc == "Practice targeted exercises focusing on: Custom Grammar Skill."

    # Fallback to tag name
    sug_clean = get_suggestion_for_error("advanced_relative_clause", "custom_error")
    assert sug_clean == "Review and practice rules for advanced relative clause."


@pytest.mark.asyncio
async def test_compile_top_grammar_errors_invalid_user_id():
    mock_db = AsyncMock()
    res = await compile_top_grammar_errors("invalid-uuid-string", mock_db)
    assert res == []


@pytest.mark.asyncio
async def test_compile_top_grammar_errors_no_errors_found():
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.all.return_value = []
    mock_db.execute.return_value = mock_result

    user_id = uuid.uuid4()
    res = await compile_top_grammar_errors(user_id, mock_db)
    assert res == []


@pytest.mark.asyncio
async def test_compile_top_grammar_errors_success():
    mock_db = AsyncMock()

    # Mock top errors query result
    mock_group_row = MagicMock()
    mock_group_row.skill_tag = "verb_tense_past"
    mock_group_row.error_type = "wrong_tense"
    mock_group_row.error_count = 5
    mock_group_row.skill_name = "Past Tense"
    mock_group_row.skill_description = "Past Tense Description"

    group_result = MagicMock()
    group_result.all.return_value = [mock_group_row]

    # Mock examples query result
    mock_ex_row = MagicMock()
    mock_ex_row.original = "I go to store yesterday"
    mock_ex_row.corrected = "I went to store yesterday"

    ex_result = MagicMock()
    ex_result.all.return_value = [mock_ex_row]

    mock_db.execute.side_effect = [group_result, ex_result]

    user_id = uuid.uuid4()
    res = await compile_top_grammar_errors(user_id, mock_db, limit=3)

    assert len(res) == 1
    item = res[0]
    assert item["skill_tag"] == "verb_tense_past"
    assert item["error_type"] == "wrong_tense"
    assert item["skill_name"] == "Past Tense"
    assert item["count"] == 5
    assert len(item["examples"]) == 1
    assert item["examples"][0]["original"] == "I go to store yesterday"
    assert item["examples"][0]["corrected"] == "I went to store yesterday"
    assert "suggestion" in item


@pytest.mark.asyncio
async def test_generate_weekly_report_async():
    mock_db = AsyncMock()
    mock_group_result = MagicMock()
    mock_group_result.all.return_value = []
    mock_db.execute.return_value = mock_group_result

    user_id = str(uuid.uuid4())
    report = await generate_weekly_report_async(user_id, db=mock_db)

    assert report["user_id"] == user_id
    assert report["status"] == "partial"
    assert "top_grammar_errors" in report
    assert report["top_grammar_errors"] == []


def test_generate_weekly_report_sync():
    mock_db = AsyncMock()
    mock_group_result = MagicMock()
    mock_group_result.all.return_value = []
    mock_db.execute.return_value = mock_group_result

    user_id = str(uuid.uuid4())
    report = generate_weekly_report(user_id, db=mock_db)

    assert report["user_id"] == user_id
    assert report["status"] == "partial"
    assert "top_grammar_errors" in report
