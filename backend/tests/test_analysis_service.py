import uuid
from unittest.mock import AsyncMock, MagicMock
import pytest

from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState
from services.analysis_service import update_knowledge


@pytest.mark.asyncio
async def test_update_knowledge_batching():
    session_id = uuid.uuid4()
    user_id = uuid.uuid4()

    skills = ["verb_tense_past", "subject_verb_agreement", "th_sounds"]

    assessment = PronunciationAssessment(
        session_id=session_id,
        phoneme_alignment=[
            {"type": "substitution", "expected": "TH", "position": 0}
        ],
    )
    grammar_errors = [
        GrammarError(
            session_id=session_id,
            skill_tag="verb_tense_past",
            original="I go",
            corrected="I went",
            error_type="wrong_tense",
        ),
        GrammarError(
            session_id=session_id,
            skill_tag="subject_verb_agreement",
            original="he go",
            corrected="he goes",
            error_type="wrong_3p_verb",
        ),
    ]

    mock_db = AsyncMock()
    mock_db.add = MagicMock()

    mock_assessment_res = MagicMock()
    mock_assessment_res.scalar_one_or_none.return_value = assessment

    mock_grammar_res = MagicMock()
    mock_grammar_res.scalars.return_value.all.return_value = grammar_errors

    mock_skills_res = MagicMock()
    mock_skills_res.all.return_value = [(s,) for s in skills]

    # Pre-existing state for one skill
    existing_state = KnowledgeState(
        id=uuid.uuid4(),
        user_id=user_id,
        skill_id="verb_tense_past",
        p_mastery=0.2,
    )
    mock_ks_res = MagicMock()
    mock_ks_res.scalars.return_value.all.return_value = [existing_state]

    mock_db.execute.side_effect = [
        mock_assessment_res,
        mock_grammar_res,
        mock_skills_res,
        mock_ks_res,
    ]

    await update_knowledge(session_id, user_id, mock_db)

    # 1: PronunciationAssessment select
    # 2: GrammarError select
    # 3: Skill.id validation query
    # 4: KnowledgeState batch select query
    assert mock_db.execute.call_count == 4
    # subject_verb_agreement and th_sounds are newly created (verb_tense_past already existed)
    assert mock_db.add.call_count == 2
    assert existing_state.p_mastery < 0.2  # updated due to incorrect grammar observation
