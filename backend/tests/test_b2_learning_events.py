"""Pure B2 coverage, canonical-order and export projection regression tests."""

import uuid
from types import SimpleNamespace

import pytest

from models.exercise import GrammarError, PronunciationAssessment
from services.analysis_service import (
    DirectionCoverage,
    _build_ledger_coverage,
)
from services.assessment_providers import (
    AssessmentMetadata,
    DemoRuleGrammarProvider,
    TranscriptAssessmentInput,
)
from services.learning_event_canonical import (
    CanonicalObservationError,
    build_canonical_observations,
    candidate_skills,
)
from services.learning_event_rules import (
    CoverageValidationError,
    has_b2_direction_coverage,
    has_complete_b2_coverage,
    metadata_source_facts,
    uniform_source_facts,
    validate_ledger_coverage,
)
from services.user_data_export import _project_event_details


def _metadata(
    *,
    source: str = "demo_rule",
    provider: str | None = None,
    model_version: str | None = "demo-grammar-rules-v1",
    is_synthetic: bool = True,
) -> AssessmentMetadata:
    return AssessmentMetadata(
        source,
        provider,
        model_version,
        is_synthetic,
        0.5,
    )


def _facts(metadata: AssessmentMetadata) -> dict[str, object]:
    return {
        "source": metadata.source,
        "provider": metadata.provider,
        "model_version": metadata.model_version,
        "is_synthetic": metadata.is_synthetic,
    }


def _direction(
    metadata: AssessmentMetadata,
    *,
    result_count: int = 0,
) -> dict[str, object]:
    return {
        "status": "evaluated",
        "reason": "completed",
        "result_count": result_count,
        "reused": False,
        "metadata": {
            **_facts(metadata),
            "confidence": metadata.confidence,
        },
        "basis": "current_invocation",
        "source_facts": _facts(metadata),
    }


def _coverage(
    grammar: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "pronunciation": {
            "status": "not_called",
            "reason": "disabled",
            "result_count": None,
            "reused": False,
            "metadata": None,
            "basis": "none",
            "source_facts": None,
        },
        "grammar": grammar or _direction(_metadata()),
    }


def _grammar(
    *,
    skill_tag: str = "verb_tense_past",
    error_type: str = "wrong_tense",
    source: str = "provider",
    provider: str | None = "llm",
    model_version: str | None = "v1",
    is_synthetic: bool = False,
) -> GrammarError:
    return GrammarError(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        skill_tag=skill_tag,
        original="I go",
        corrected="I went",
        error_type=error_type,
        source=source,
        provider=provider,
        model_version=model_version,
        is_synthetic=is_synthetic,
        confidence=0.9,
    )


def _assessment(
    alignment: list[dict],
    *,
    model_version: str | None = "v1",
) -> PronunciationAssessment:
    return PronunciationAssessment(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        overall_score=75.0,
        phoneme_alignment=alignment,
        source="provider",
        provider="elsa",
        model_version=model_version,
        is_synthetic=False,
        confidence=0.9,
    )


@pytest.mark.asyncio
async def test_zero_observation_current_invocation_keeps_demo_metadata_facts():
    evaluation = await DemoRuleGrammarProvider().evaluate(
        TranscriptAssessmentInput("Hello.")
    )
    assert evaluation.findings == ()

    coverage = _build_ledger_coverage(
        DirectionCoverage("not_called", reason="disabled"),
        DirectionCoverage(
            "evaluated",
            result_count=0,
            reason="completed",
            metadata=evaluation.metadata,
        ),
        None,
        [],
    )

    validate_ledger_coverage(
        coverage,
        pronunciation_sources=[],
        grammar_sources=[],
    )
    assert coverage["grammar"]["source_facts"] == {
        "source": "demo_rule",
        "provider": None,
        "model_version": "demo-grammar-rules-v1",
        "is_synthetic": True,
    }
    assert coverage["grammar"]["metadata"] == {
        "source": "demo_rule",
        "provider": None,
        "model_version": "demo-grammar-rules-v1",
        "is_synthetic": True,
        "confidence": 0.5,
    }


def test_evaluated_requires_four_key_source_facts_even_without_rows():
    coverage = _coverage()
    coverage["grammar"]["source_facts"] = None

    with pytest.raises(CoverageValidationError, match="do not match metadata"):
        validate_ledger_coverage(
            coverage,
            pronunciation_sources=[],
            grammar_sources=[],
        )


def test_metadata_projection_uses_the_source_facts_shape_validator():
    with pytest.raises(CoverageValidationError, match="invocation metadata is invalid"):
        metadata_source_facts(
            {
                "source": "",
                "provider": None,
                "model_version": "v1",
                "is_synthetic": True,
            }
        )


def test_complete_b2_coverage_requires_two_valid_seven_key_directions():
    assert has_complete_b2_coverage({"schema_version": 1, "coverage": _coverage()})

    old_five_key = _coverage()
    old_five_key["grammar"] = {
        "status": "evaluated",
        "reason": "completed",
        "result_count": 0,
        "reused": False,
        "metadata": None,
    }
    assert not has_complete_b2_coverage({"schema_version": 1, "coverage": old_five_key})

    invalid_basis = _coverage()
    invalid_basis["grammar"]["basis"] = "legacy"
    assert not has_complete_b2_coverage(
        {"schema_version": 1, "coverage": invalid_basis}
    )


@pytest.mark.parametrize("invalid_basis", [[], {}, set(), 1, True, None])
def test_complete_b2_coverage_rejects_non_string_basis_without_raising(
    invalid_basis,
):
    coverage = _coverage()
    coverage["grammar"]["basis"] = invalid_basis

    assert not has_complete_b2_coverage({"schema_version": 1, "coverage": coverage})


def test_history_support_accepts_both_real_observation_bases_only():
    real_facts = _facts(
        _metadata(
            source="provider",
            provider="llm",
            model_version="v1",
            is_synthetic=False,
        )
    )
    current_invocation = _direction(
        _metadata(
            source="provider",
            provider="llm",
            model_version="v1",
            is_synthetic=False,
        ),
        result_count=1,
    )
    current_details = {
        "schema_version": 1,
        "coverage": _coverage(current_invocation),
    }
    assert not has_b2_direction_coverage(current_details, "pronunciation")
    assert has_b2_direction_coverage(current_details, "grammar")

    persisted_rows = {
        "status": "not_called",
        "reason": "existing_result",
        "result_count": None,
        "reused": True,
        "metadata": None,
        "basis": "persisted_rows",
        "source_facts": real_facts,
    }
    persisted_details = {
        "schema_version": 1,
        "coverage": _coverage(persisted_rows),
    }
    assert has_b2_direction_coverage(persisted_details, "grammar")

    none_basis = {**persisted_rows, "basis": "none", "source_facts": None}
    assert not has_b2_direction_coverage(
        {"schema_version": 1, "coverage": _coverage(none_basis)},
        "grammar",
    )

    null_facts = {**persisted_rows, "source_facts": None}
    assert not has_b2_direction_coverage(
        {"schema_version": 1, "coverage": _coverage(null_facts)},
        "grammar",
    )

    synthetic_facts = {
        **persisted_rows,
        "source_facts": {
            **real_facts,
            "is_synthetic": True,
        },
    }
    assert not has_b2_direction_coverage(
        {"schema_version": 1, "coverage": _coverage(synthetic_facts)},
        "grammar",
    )


def test_metadata_projection_preserves_null_values_from_the_contract():
    facts = metadata_source_facts(
        {
            "source": None,
            "provider": None,
            "model_version": None,
            "is_synthetic": None,
        }
    )

    assert facts is not None
    assert facts.as_dict() == {
        "source": None,
        "provider": None,
        "model_version": None,
        "is_synthetic": None,
    }


def test_current_invocation_rejects_heterogeneous_persisted_sources():
    coverage = _coverage()
    first = _grammar(model_version="v1")
    second = _grammar(
        skill_tag="subject_verb_agreement",
        error_type="wrong_3p_verb",
        model_version="v2",
    )

    with pytest.raises(CoverageValidationError, match="heterogeneous"):
        validate_ledger_coverage(
            coverage,
            pronunciation_sources=[],
            grammar_sources=[first, second],
        )


def test_current_invocation_keeps_call_metadata_and_projects_uniform_rows():
    coverage = _coverage()
    row = _grammar(model_version="v2")
    coverage["grammar"]["result_count"] = 1
    coverage["grammar"]["source_facts"] = uniform_source_facts([row]).as_dict()

    validate_ledger_coverage(
        coverage,
        pronunciation_sources=[],
        grammar_sources=[row],
    )
    assert coverage["grammar"]["metadata"]["model_version"] == "demo-grammar-rules-v1"
    assert coverage["grammar"]["source_facts"]["model_version"] == "v2"


def test_current_invocation_rejects_source_facts_outside_complete_row_set():
    coverage = _coverage()
    row = _grammar(model_version="v2")
    coverage["grammar"]["result_count"] = 1

    with pytest.raises(CoverageValidationError, match="complete source rows"):
        validate_ledger_coverage(
            coverage,
            pronunciation_sources=[],
            grammar_sources=[row],
        )


@pytest.mark.parametrize(
    "mutation",
    [
        lambda direction: direction.update(status="not_called"),
        lambda direction: direction.update(status=[]),
        lambda direction: direction.update(reason={}),
        lambda direction: direction.update(basis=[]),
        lambda direction: direction.update(basis="none"),
        lambda direction: direction.update(result_count=None),
        lambda direction: direction.update(result_count=-1),
        lambda direction: direction.update(result_count=True),
        lambda direction: direction.update(result_count=999),
        lambda direction: direction.update(reused=0),
        lambda direction: direction.update(metadata=None),
    ],
)
def test_current_invocation_rejects_missing_or_invalid_call_facts(mutation):
    coverage = _coverage()
    mutation(coverage["grammar"])

    with pytest.raises(CoverageValidationError):
        validate_ledger_coverage(
            coverage,
            pronunciation_sources=[],
            grammar_sources=[],
        )


def test_evaluated_pronunciation_count_uses_full_alignment_length():
    assessment = _assessment(
        [
            {"type": "correct", "expected": "N", "actual": "N", "position": 0},
            {"type": "substitution", "expected": "TH", "actual": "S", "position": 1},
        ]
    )
    coverage = _coverage()
    coverage["pronunciation"] = {
        **_direction(_metadata()),
        "result_count": 2,
        "metadata": {
            **_facts(_metadata()),
            "confidence": 0.5,
        },
        "source_facts": uniform_source_facts([assessment]).as_dict(),
    }
    validate_ledger_coverage(
        coverage,
        pronunciation_sources=[assessment],
        grammar_sources=[],
    )

    coverage["pronunciation"]["result_count"] = 1
    with pytest.raises(CoverageValidationError, match="result_count"):
        validate_ledger_coverage(
            coverage,
            pronunciation_sources=[assessment],
            grammar_sources=[],
        )


def test_evaluated_pronunciation_zero_alignment_still_requires_source():
    assessment = _assessment([])
    coverage = _coverage()
    coverage["pronunciation"] = {
        **_direction(_metadata()),
        "result_count": 0,
        "source_facts": uniform_source_facts([assessment]).as_dict(),
    }

    validate_ledger_coverage(
        coverage,
        pronunciation_sources=[assessment],
        grammar_sources=[],
    )


def test_evaluated_pronunciation_without_source_row_is_rejected():
    coverage = _coverage()
    coverage["pronunciation"] = _direction(_metadata())

    with pytest.raises(
        CoverageValidationError,
        match="pronunciation evaluated coverage requires a source row",
    ):
        validate_ledger_coverage(
            coverage,
            pronunciation_sources=[],
            grammar_sources=[],
        )


def test_provider_null_is_a_valid_source_fact():
    metadata = _metadata(
        source="provider",
        provider=None,
        model_version="v1",
        is_synthetic=False,
    )
    validate_ledger_coverage(
        _coverage(_direction(metadata)),
        pronunciation_sources=[],
        grammar_sources=[],
    )


def test_not_called_distinguishes_persisted_rows_from_none():
    metadata = _metadata(
        source="provider",
        provider="llm",
        model_version="v1",
        is_synthetic=False,
    )
    persisted = {
        "status": "not_called",
        "reason": "existing_result",
        "result_count": None,
        "reused": True,
        "metadata": None,
        "basis": "persisted_rows",
        "source_facts": _facts(metadata),
    }
    validate_ledger_coverage(
        _coverage(persisted),
        pronunciation_sources=[],
        grammar_sources=[_grammar()],
    )

    with pytest.raises(CoverageValidationError, match="requires persisted source rows"):
        validate_ledger_coverage(
            _coverage(persisted),
            pronunciation_sources=[],
            grammar_sources=[],
        )


@pytest.mark.parametrize(
    ("facts", "sources", "message"),
    [
        (_facts(_metadata()), [_grammar()], "cannot discard persisted source rows"),
        (None, [], None),
    ],
)
def test_basis_none_cannot_hide_rows_or_carry_facts(facts, sources, message):
    direction = {
        "status": "not_called",
        "reason": "disabled",
        "result_count": None,
        "reused": False,
        "metadata": None,
        "basis": "none",
        "source_facts": facts,
    }
    if message is None:
        validate_ledger_coverage(
            _coverage(direction),
            pronunciation_sources=[],
            grammar_sources=sources,
        )
        return
    with pytest.raises(CoverageValidationError, match=message):
        validate_ledger_coverage(
            _coverage(direction),
            pronunciation_sources=[],
            grammar_sources=sources,
        )


def test_pronunciation_preserves_ordinal_holes():
    assessment = _assessment(
        [
            {"type": "correct", "expected": "N", "actual": "N", "position": 0},
            {"type": "substitution", "expected": "TH", "actual": "S", "position": 1},
        ]
    )
    batch = build_canonical_observations(
        job_id=uuid.uuid4(),
        assessment=assessment,
        grammar_errors=[],
        valid_skill_ids={"th_sounds"},
    )

    assert batch.unmapped_pronunciation == 1
    assert [observation.source_ordinal for observation in batch.observations] == [1]


@pytest.mark.parametrize(
    "entry",
    [
        {"type": "substitution", "expected": []},
        {"type": [], "expected": "TH"},
    ],
)
def test_candidate_skills_rejects_invalid_nested_pronunciation_types(entry):
    assessment = _assessment([entry])

    with pytest.raises(CanonicalObservationError):
        candidate_skills(assessment=assessment, grammar_errors=[])


@pytest.mark.parametrize(
    "entry",
    [
        {"type": "substitution", "expected": []},
        {"type": [], "expected": "TH"},
    ],
)
def test_canonical_order_rejects_invalid_nested_pronunciation_types(entry):
    assessment = _assessment([entry])

    with pytest.raises(CanonicalObservationError):
        build_canonical_observations(
            job_id=uuid.uuid4(),
            assessment=assessment,
            grammar_errors=[],
            valid_skill_ids={"th_sounds"},
        )


def test_null_expected_remains_an_unmapped_pronunciation_entry():
    assessment = _assessment(
        [
            {"type": "substitution", "expected": None, "position": 0},
            {"type": "substitution", "expected": "TH", "position": 1},
        ]
    )

    assert candidate_skills(assessment=assessment, grammar_errors=[]) == {"th_sounds"}
    batch = build_canonical_observations(
        job_id=uuid.uuid4(),
        assessment=assessment,
        grammar_errors=[],
        valid_skill_ids={"th_sounds"},
    )
    assert batch.unmapped_pronunciation == 1
    assert [observation.source_ordinal for observation in batch.observations] == [1]


def test_grammar_uses_stable_order_not_input_or_uuid_order():
    first = _grammar(
        skill_tag="verb_tense_past",
        error_type="wrong_tense",
    )
    second = _grammar(
        skill_tag="article_usage",
        error_type="missing_article",
    )
    batch = build_canonical_observations(
        job_id=uuid.uuid4(),
        assessment=None,
        grammar_errors=[first, second],
        valid_skill_ids={"article_usage", "verb_tense_past"},
    )

    assert [
        (observation.skill_id, observation.source_ordinal)
        for observation in batch.observations
    ] == [("article_usage", 0), ("verb_tense_past", 1)]


def test_duplicate_grammar_stable_key_rejects_even_when_unmapped():
    duplicate = [_grammar(), _grammar()]

    with pytest.raises(CanonicalObservationError, match="duplicate stable keys"):
        build_canonical_observations(
            job_id=uuid.uuid4(),
            assessment=None,
            grammar_errors=duplicate,
            valid_skill_ids=set(),
        )


@pytest.mark.parametrize(
    ("skill_tag", "error_type"),
    [
        (["verb_tense_past"], "wrong_tense"),
        ("verb_tense_past", {"wrong_tense": True}),
    ],
)
def test_candidate_skills_rejects_unhashable_grammar_keys(skill_tag, error_type):
    malformed = SimpleNamespace(skill_tag=skill_tag, error_type=error_type)

    with pytest.raises(CanonicalObservationError, match="stable keys must be strings"):
        candidate_skills(assessment=None, grammar_errors=[malformed])


@pytest.mark.parametrize(
    ("skill_tag", "error_type"),
    [
        (["verb_tense_past"], "wrong_tense"),
        ("verb_tense_past", {"wrong_tense": True}),
    ],
)
def test_canonical_order_rejects_unhashable_grammar_keys_before_sorting(
    skill_tag, error_type
):
    malformed = SimpleNamespace(skill_tag=skill_tag, error_type=error_type)

    with pytest.raises(CanonicalObservationError, match="stable keys must be strings"):
        build_canonical_observations(
            job_id=uuid.uuid4(),
            assessment=None,
            grammar_errors=[malformed],
            valid_skill_ids=set(),
        )


@pytest.mark.parametrize("model_version", [None, "", "   "])
def test_mapped_grammar_requires_non_blank_model_version(model_version):
    with pytest.raises(CanonicalObservationError, match="non-empty model version"):
        build_canonical_observations(
            job_id=uuid.uuid4(),
            assessment=None,
            grammar_errors=[_grammar(model_version=model_version)],
            valid_skill_ids={"verb_tense_past"},
        )


def test_export_projects_new_source_facts_to_legacy_five_field_dto():
    details = {
        "schema_version": 1,
        "coverage": {
            "pronunciation": {
                "status": "evaluated",
                "reason": "completed",
                "result_count": 0,
                "reused": False,
                "metadata": {
                    "source": "metadata-canary",
                    "provider": "metadata-provider-canary",
                    "model_version": "metadata-model-canary",
                    "is_synthetic": False,
                    "confidence": 0.7,
                },
                "basis": "current_invocation",
                "source_facts": {
                    "source": "pronunciation-source",
                    "provider": None,
                    "model_version": "pronunciation-v2",
                    "is_synthetic": True,
                },
            },
            "grammar": None,
        },
        "unmapped": {"pronunciation": 0, "grammar": 0},
    }

    projected = _project_event_details(details)

    assert projected.coverage is not None
    assert projected.coverage.pronunciation is not None
    assert projected.coverage.pronunciation.model_dump() == {
        "status": "evaluated",
        "source": "pronunciation-source",
        "provider": None,
        "model_version": "pronunciation-v2",
        "is_synthetic": True,
    }
    serialized = projected.model_dump_json()
    assert "metadata-canary" not in serialized
    assert "confidence" not in serialized


@pytest.mark.parametrize(
    "source_facts",
    [
        {
            "source": "provider",
            "provider": None,
            "model_version": "v1",
        },
        {
            "source": "provider",
            "provider": None,
            "model_version": "v1",
            "is_synthetic": False,
            "extra": "must-not-leak",
        },
    ],
)
def test_export_rejects_malformed_new_source_facts(source_facts):
    from services.user_data_export import UserDataExportIntegrityError

    with pytest.raises(
        UserDataExportIntegrityError,
        match="exactly four fields",
    ):
        _project_event_details(
            {
                "schema_version": 1,
                "coverage": {
                    "pronunciation": {
                        "status": "evaluated",
                        "source_facts": source_facts,
                    },
                    "grammar": None,
                },
                "unmapped": {"pronunciation": 0, "grammar": 0},
            }
        )
