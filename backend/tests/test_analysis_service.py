import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState
from services.analysis_service import (
    AnalysisServiceError,
    analyze_session,
    update_knowledge,
)


@pytest.mark.asyncio
async def test_update_knowledge_batching():
    session_id = uuid.uuid4()
    user_id = uuid.uuid4()

    skills = ["verb_tense_past", "subject_verb_agreement", "th_sounds"]

    assessment = PronunciationAssessment(
        session_id=session_id,
        phoneme_alignment=[{"type": "substitution", "expected": "TH", "position": 0}],
        source="provider",
        is_synthetic=False,
    )
    grammar_errors = [
        GrammarError(
            session_id=session_id,
            skill_tag="verb_tense_past",
            original="I go",
            corrected="I went",
            error_type="wrong_tense",
            source="provider",
            is_synthetic=False,
        ),
        GrammarError(
            session_id=session_id,
            skill_tag="subject_verb_agreement",
            original="he go",
            corrected="he goes",
            error_type="wrong_3p_verb",
            source="provider",
            is_synthetic=False,
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
    # subject_verb_agreement and th_sounds are newly created
    # (verb_tense_past already existed)
    assert mock_db.add.call_count == 2
    # updated due to incorrect grammar observation
    assert existing_state.p_mastery < 0.2


@pytest.mark.asyncio
async def test_synthetic_results_do_not_update_knowledge():
    assessment = PronunciationAssessment(
        session_id=uuid.uuid4(),
        phoneme_alignment=[{"type": "substitution", "expected": "TH", "position": 0}],
        source="demo_mock",
        is_synthetic=True,
    )
    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    assessment_result = MagicMock()
    assessment_result.scalar_one_or_none.return_value = assessment
    grammar_result = MagicMock()
    grammar_result.scalars.return_value.all.return_value = []
    mock_db.execute.side_effect = [assessment_result, grammar_result]

    await update_knowledge(uuid.uuid4(), uuid.uuid4(), mock_db)

    assert mock_db.execute.call_count == 2
    mock_db.add.assert_not_called()
    mock_db.flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_production_mode_without_provider_is_explicitly_unsupported(monkeypatch):
    monkeypatch.setattr("services.analysis_service.settings.USE_MOCK_ELSA", False)
    mock_db = AsyncMock()

    with pytest.raises(AnalysisServiceError) as exc_info:
        await analyze_session(uuid.uuid4(), mock_db)

    assert exc_info.value.code == "analysis_unsupported"
    mock_db.execute.assert_not_awaited()
