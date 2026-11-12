import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from models.exercise import GrammarError
from models.knowledge import KnowledgeState
from models.session import Transcript, TranscriptRole
from services.analysis_service import _apply_bkt_updates, analyze_session


@pytest.mark.asyncio
async def test_apply_bkt_updates_batching():
    user_id = uuid.uuid4()

    skills = ["verb_tense_past", "subject_verb_agreement", "th_sounds"]

    mock_db = AsyncMock()
    mock_db.add = MagicMock()

    mock_skills_res = MagicMock()
    mock_skills_res.all.return_value = [(s,) for s in skills]

    existing_state = KnowledgeState(
        id=uuid.uuid4(),
        user_id=user_id,
        skill_id="verb_tense_past",
        p_mastery=0.2,
    )
    mock_ks_res = MagicMock()
    mock_ks_res.scalars.return_value.all.return_value = [existing_state]

    mock_db.execute.side_effect = [mock_skills_res, mock_ks_res]

    await _apply_bkt_updates(
        user_id=user_id,
        observations=[
            {"skill_id": "verb_tense_past", "correct": False, "is_synthetic": False},
            {
                "skill_id": "subject_verb_agreement",
                "correct": False,
                "is_synthetic": False,
            },
            {"skill_id": "th_sounds", "correct": True, "is_synthetic": False},
        ],
        db=mock_db,
    )

    # Skill validation and the single KnowledgeState batch select are the only
    # reads; states are not re-read per observation.
    assert mock_db.execute.call_count == 2
    # subject_verb_agreement and th_sounds are newly created
    # (verb_tense_past already existed)
    assert mock_db.add.call_count == 2
    # updated due to incorrect grammar observation
    assert existing_state.p_mastery < 0.2


@pytest.mark.asyncio
async def test_synthetic_results_do_not_update_knowledge():
    mock_db = AsyncMock()
    mock_db.add = MagicMock()

    await _apply_bkt_updates(
        user_id=uuid.uuid4(),
        observations=[
            {"skill_id": "verb_tense_past", "correct": False, "is_synthetic": True},
        ],
        db=mock_db,
    )

    mock_db.execute.assert_not_called()
    mock_db.add.assert_not_called()
    mock_db.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_analyze_session_without_provider_runs_grammar_only(monkeypatch):
    monkeypatch.setattr("services.analysis_service.settings.USE_MOCK_ELSA", False)
    session_id = uuid.uuid4()
    transcript = Transcript(
        session_id=session_id,
        role=TranscriptRole.user,
        content="I go yesterday.",
        timestamp_ms=1,
    )
    mock_db = AsyncMock()
    mock_db.add = MagicMock()

    transcript_result = MagicMock()
    transcript_result.scalars.return_value.all.return_value = [transcript]
    existing_grammar_result = MagicMock()
    existing_grammar_result.scalars.return_value.all.return_value = []
    mock_db.execute.side_effect = [transcript_result, existing_grammar_result]

    result = await analyze_session(session_id, mock_db)

    assert result is not None
    assert result.assessment is None
    assert len(result.grammar_errors) == 1
    assert result.grammar_errors[0].skill_tag == "verb_tense_past"
    assert result.coverage["pronunciation"]["status"] == "not_called"
    assert result.coverage["grammar"]["status"] == "evaluated"
    assert mock_db.add.call_count == 1
    added = mock_db.add.call_args[0][0]
    assert isinstance(added, GrammarError)
    assert added.skill_tag == "verb_tense_past"
    mock_db.flush.assert_awaited_once()
