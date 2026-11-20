import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState
from models.session import Transcript, TranscriptRole
from services import analysis_service
from services.analysis_service import (
    SessionAnalysisResult,
    _apply_bkt_updates,
    _build_ledger_coverage,
    analyze_session,
    update_knowledge,
)
from services.assessment_providers import AssessmentMetadata
from services.learning_event_rules import (
    CoverageValidationError,
    validate_ledger_coverage,
)


def test_legacy_analysis_result_isolates_ledger_coverage_from_rich_snapshot():
    legacy_coverage = {
        "pronunciation": {"status": "not_called"},
        "grammar": {"status": "evaluated"},
    }

    result = SessionAnalysisResult(coverage=legacy_coverage)

    assert result.coverage is None
    assert result.ledger_coverage == legacy_coverage
    with pytest.raises(ValueError, match="cannot be combined"):
        SessionAnalysisResult(
            coverage=legacy_coverage,
            ledger_coverage={"grammar": {"status": "evaluated"}},
        )


def test_zero_error_current_invocation_keeps_demo_source_facts():
    metadata = AssessmentMetadata(
        "demo_rule",
        None,
        "demo-grammar-rules-v1",
        True,
        0.5,
    )

    coverage = _build_ledger_coverage(
        analysis_service.DirectionCoverage(
            "not_called",
            reason="disabled",
        ),
        analysis_service.DirectionCoverage(
            "evaluated",
            result_count=0,
            reason="completed",
            metadata=metadata,
        ),
        None,
        [],
    )

    assert coverage["grammar"] == {
        "status": "evaluated",
        "reason": "completed",
        "result_count": 0,
        "reused": False,
        "metadata": {
            "source": "demo_rule",
            "provider": None,
            "model_version": "demo-grammar-rules-v1",
            "is_synthetic": True,
            "confidence": 0.5,
        },
        "basis": "current_invocation",
        "source_facts": {
            "source": "demo_rule",
            "provider": None,
            "model_version": "demo-grammar-rules-v1",
            "is_synthetic": True,
        },
    }


def test_zero_error_current_invocation_passes_shared_reader_validation():
    coverage = _build_ledger_coverage(
        analysis_service.DirectionCoverage("not_called", reason="disabled"),
        analysis_service.DirectionCoverage(
            "evaluated",
            result_count=0,
            reason="completed",
            metadata=AssessmentMetadata(
                "demo_rule",
                None,
                "demo-grammar-rules-v1",
                True,
                0.5,
            ),
        ),
        None,
        [],
    )

    validate_ledger_coverage(
        coverage,
        pronunciation_sources=[],
        grammar_sources=[],
    )


def test_evaluated_zero_error_rejects_null_source_facts():
    coverage = _build_ledger_coverage(
        analysis_service.DirectionCoverage("not_called", reason="disabled"),
        analysis_service.DirectionCoverage(
            "evaluated",
            result_count=0,
            reason="completed",
            metadata=AssessmentMetadata(
                "demo_rule",
                None,
                "demo-grammar-rules-v1",
                True,
                0.5,
            ),
        ),
        None,
        [],
    )
    coverage["grammar"]["source_facts"] = None

    with pytest.raises(
        CoverageValidationError,
        match="current-invocation source facts do not match metadata",
    ):
        validate_ledger_coverage(
            coverage,
            pronunciation_sources=[],
            grammar_sources=[],
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
async def test_update_knowledge_skips_synthetic_results():
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
async def test_apply_bkt_updates_batching():
    user_id = uuid.uuid4()
    job_id = uuid.uuid4()

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

    prior_session_id = uuid.uuid4()
    prior_job_id = uuid.uuid4()
    prior_grammar_id = uuid.uuid4()
    prior_grammar = GrammarError(
        id=prior_grammar_id,
        session_id=prior_session_id,
        skill_tag="verb_tense_past",
        original="I go",
        corrected="I went",
        error_type="wrong_tense",
        source="provider",
        provider="llm",
        model_version="v1",
        is_synthetic=False,
        confidence=0.9,
    )
    prior_event = MagicMock()
    prior_event.event_type = "grammar_observation"
    prior_event.analysis_job_id = prior_job_id
    prior_event.grammar_error_id = prior_grammar_id
    prior_event.pronunciation_assessment_id = None
    prior_event.skill_id = "verb_tense_past"
    prior_event.source_ordinal = 0
    prior_event.source = "provider"
    prior_event.provider = "llm"
    prior_event.model_version = "v1"
    prior_event.is_synthetic = False
    prior_details = {
        "schema_version": 1,
        "coverage": {
            "pronunciation": {
                "status": "not_called",
                "reason": "disabled",
                "result_count": None,
                "reused": False,
                "metadata": None,
                "basis": "none",
                "source_facts": None,
            },
            "grammar": {
                "status": "evaluated",
                "reason": "completed",
                "result_count": 1,
                "reused": False,
                "metadata": {
                    "source": "provider",
                    "provider": "llm",
                    "model_version": "v1",
                    "is_synthetic": False,
                    "confidence": 0.9,
                },
                "basis": "current_invocation",
                "source_facts": {
                    "source": "provider",
                    "provider": "llm",
                    "model_version": "v1",
                    "is_synthetic": False,
                },
            },
        },
    }
    mock_history_res = MagicMock()
    mock_history_res.all.return_value = [(prior_event, prior_details, prior_session_id)]
    mock_assessments_res = MagicMock()
    mock_assessments_res.scalars.return_value.all.return_value = []
    mock_grammar_res = MagicMock()
    mock_grammar_res.scalars.return_value.all.return_value = [prior_grammar]
    mock_db.execute.side_effect = [
        mock_skills_res,
        mock_ks_res,
        mock_history_res,
        mock_assessments_res,
        mock_grammar_res,
    ]

    await _apply_bkt_updates(
        user_id=user_id,
        job_id=job_id,
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

    # Skill validation, one KnowledgeState batch select, one history select,
    # and one batch read per historical source type are the only reads.
    assert mock_db.execute.call_count == 5
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
        job_id=uuid.uuid4(),
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
    existing_pronunciation_result = MagicMock()
    existing_pronunciation_result.scalar_one_or_none.return_value = None
    existing_grammar_result = MagicMock()
    existing_grammar_result.scalars.return_value.all.return_value = []
    mock_db.execute.side_effect = [
        transcript_result,
        existing_pronunciation_result,
        existing_grammar_result,
    ]

    result = await analyze_session(session_id, mock_db)

    assert result is not None
    assert result.assessment is None
    assert len(result.grammar_errors) == 1
    assert result.grammar_errors[0].skill_tag == "verb_tense_past"
    assert result.ledger_coverage["pronunciation"]["status"] == "not_called"
    assert result.ledger_coverage["grammar"]["status"] == "evaluated"
    assert mock_db.add.call_count == 1
    added = mock_db.add.call_args[0][0]
    assert isinstance(added, GrammarError)
    assert added.skill_tag == "verb_tense_past"
    mock_db.flush.assert_awaited_once()
