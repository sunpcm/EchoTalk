import ast
import importlib
from pathlib import Path

import pytest

from services.assessment_providers import AssessmentMetadata, GrammarEvaluation
from services.sgec_adapter import SGECAdapterError, build_grammar_evaluation

REPO_ROOT = Path(__file__).resolve().parents[2]
CANDIDATES_PATH = REPO_ROOT / "docs" / "evaluation" / "sgec_candidates.v1.json"

TRUSTED_METADATA = AssessmentMetadata(
    source="sgec_adapter_test",
    provider="test-provider",
    model_version="sgec-candidates-v1",
    is_synthetic=True,
    confidence=0.0,
)


def _finding(overrides=None):
    values = {
        "skill_tag": "article_usage",
        "original": "a elephant",
        "corrected": "an elephant",
        "error_type": "article",
    }
    if overrides:
        values.update(overrides)
    return values


def _batch(errors):
    return {"errors": errors}


def test_zero_error_batch_keeps_caller_metadata():
    evaluation = build_grammar_evaluation(
        _batch([]),
        {"article_usage"},
        TRUSTED_METADATA,
    )

    assert isinstance(evaluation, GrammarEvaluation)
    assert evaluation.metadata is TRUSTED_METADATA
    assert evaluation.findings == ()


def test_single_error_maps_all_fields_and_confidence_none():
    evaluation = build_grammar_evaluation(
        _batch([_finding({"confidence": None})]),
        {"article_usage"},
        TRUSTED_METADATA,
    )

    finding = evaluation.findings[0]
    assert evaluation.metadata is TRUSTED_METADATA
    assert finding.skill_tag == "article_usage"
    assert finding.original == "a elephant"
    assert finding.corrected == "an elephant"
    assert finding.error_type == "article"
    assert finding.metadata.source == TRUSTED_METADATA.source
    assert finding.metadata.provider == TRUSTED_METADATA.provider
    assert finding.metadata.model_version == TRUSTED_METADATA.model_version
    assert finding.metadata.is_synthetic is TRUSTED_METADATA.is_synthetic
    assert finding.metadata.confidence is None


@pytest.mark.parametrize(
    "confidence",
    [0, 0.0, 1, 1.0, 0.85],
)
def test_confidence_preserved_per_finding(confidence):
    evaluation = build_grammar_evaluation(
        _batch([_finding({"confidence": confidence})]),
        {"article_usage"},
        TRUSTED_METADATA,
    )

    assert evaluation.findings[0].metadata.confidence == confidence


def test_multiple_different_skills_map_in_order():
    evaluation = build_grammar_evaluation(
        _batch(
            [
                _finding({"skill_tag": "article_usage"}),
                _finding(
                    {
                        "skill_tag": "subject_verb_agreement",
                        "original": "He go",
                        "corrected": "He goes",
                        "error_type": "wrong_3p_verb",
                        "confidence": 1.0,
                    }
                ),
            ]
        ),
        {"article_usage", "subject_verb_agreement"},
        TRUSTED_METADATA,
    )

    assert [f.skill_tag for f in evaluation.findings] == [
        "article_usage",
        "subject_verb_agreement",
    ]
    assert [f.metadata.confidence for f in evaluation.findings] == [None, 1.0]


def test_atomic_rejection_on_unknown_skill_tag_preserves_issue():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding({"skill_tag": "other"})]),
            {"article_usage"},
            TRUSTED_METADATA,
        )

    assert exc_info.value.code == "invalid_sgec_batch"
    assert [issue.code for issue in exc_info.value.issues] == ["unknown_skill_tag"]


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {},
        {"errors": "not-an-array"},
        {"errors": None},
    ],
)
def test_atomic_rejection_on_bad_structure(payload):
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(payload, {"article_usage"}, TRUSTED_METADATA)

    assert exc_info.value.code == "invalid_sgec_batch"


def test_atomic_rejection_on_extra_field():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding({"source": "real"})]),
            {"article_usage"},
            TRUSTED_METADATA,
        )

    assert exc_info.value.code == "invalid_sgec_batch"
    assert [issue.code for issue in exc_info.value.issues] == ["unknown_field"]


def test_atomic_rejection_on_missing_field():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding({"corrected": None})]),
            {"article_usage"},
            TRUSTED_METADATA,
        )

    assert exc_info.value.code == "invalid_sgec_batch"
    assert [issue.code for issue in exc_info.value.issues] == ["missing_required_field"]


@pytest.mark.parametrize(
    "confidence", [True, False, 1.5, -0.1, float("nan"), float("inf")]
)
def test_atomic_rejection_on_invalid_confidence(confidence):
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding({"confidence": confidence})]),
            {"article_usage"},
            TRUSTED_METADATA,
        )

    assert exc_info.value.code == "invalid_sgec_batch"
    assert [issue.code for issue in exc_info.value.issues] == ["invalid_confidence"]


def test_duplicate_skill_tag_rejects_whole_batch():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch(
                [
                    _finding(),
                    _finding({"corrected": "an elephant, second"}),
                ]
            ),
            {"article_usage"},
            TRUSTED_METADATA,
        )

    assert exc_info.value.code == "duplicate_skill_tag"


@pytest.mark.parametrize("field", ["error_type", "original", "corrected"])
@pytest.mark.parametrize("value", ["", "   ", "\t"])
def test_blank_core_fields_reject(field, value):
    expected_code = f"empty_{field}"

    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding({field: value})]),
            {"article_usage"},
            TRUSTED_METADATA,
        )

    assert exc_info.value.code == expected_code


def test_error_type_at_50_character_boundary_is_accepted():
    error_type = "错" * 50

    evaluation = build_grammar_evaluation(
        _batch([_finding({"error_type": error_type})]),
        {"article_usage"},
        TRUSTED_METADATA,
    )

    assert evaluation.findings[0].error_type == error_type


def test_error_type_over_50_unicode_characters_rejects_stably():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding({"error_type": "错" * 51})]),
            {"article_usage"},
            TRUSTED_METADATA,
        )

    assert exc_info.value.code == "error_type_too_long"


def test_one_error_type_over_50_characters_rejects_whole_batch():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch(
                [
                    _finding(),
                    _finding(
                        {
                            "skill_tag": "subject_verb_agreement",
                            "error_type": "x" * 51,
                        }
                    ),
                ]
            ),
            {"article_usage", "subject_verb_agreement"},
            TRUSTED_METADATA,
        )

    assert exc_info.value.code == "error_type_too_long"


@pytest.mark.parametrize("model_version", [None, "", "   "])
def test_blank_model_version_rejects_when_findings_exist(model_version):
    metadata = AssessmentMetadata(
        source="sgec_adapter_test",
        provider="test-provider",
        model_version=model_version,
        is_synthetic=True,
        confidence=0.0,
    )

    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding()]),
            {"article_usage"},
            metadata,
        )

    assert exc_info.value.code == "empty_model_version"


def test_blank_model_version_allowed_for_zero_error_batch():
    metadata = AssessmentMetadata(
        source="sgec_adapter_test",
        provider="test-provider",
        model_version="",
        is_synthetic=True,
        confidence=0.0,
    )

    evaluation = build_grammar_evaluation(_batch([]), {"article_usage"}, metadata)

    assert evaluation.metadata is metadata
    assert evaluation.findings == ()


def test_invalid_metadata_type_rejects():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(_batch([]), {"article_usage"}, "not metadata")  # type: ignore[arg-type]

    assert exc_info.value.code == "invalid_metadata"


def test_bad_payload_and_bad_metadata_returns_structure_issues_first():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            {"errors": "not-an-array"},
            {"article_usage"},
            None,  # type: ignore[arg-type]
        )

    assert exc_info.value.code == "invalid_sgec_batch"
    assert [issue.code for issue in exc_info.value.issues] == ["invalid_top_level"]


def test_bad_errors_field_and_bad_metadata_returns_structure_issues_first():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            {"errors": None},
            {"article_usage"},
            "not metadata",  # type: ignore[arg-type]
        )

    assert exc_info.value.code == "invalid_sgec_batch"
    assert [issue.code for issue in exc_info.value.issues] == ["invalid_top_level"]


def test_invalid_allowed_skill_tags_reject_with_stable_code():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(_batch([]), ["ok", 1], TRUSTED_METADATA)  # type: ignore[list-item]

    assert exc_info.value.code == "invalid_sgec_batch"
    assert [issue.code for issue in exc_info.value.issues] == ["invalid_allowed_tags"]


@pytest.mark.parametrize("model_version", [True, 42, [], {}])
def test_non_string_model_version_rejects_with_findings(model_version):
    metadata = AssessmentMetadata(
        source="sgec_adapter_test",
        provider="test-provider",
        model_version=model_version,
        is_synthetic=True,
        confidence=0.0,
    )

    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding()]),
            {"article_usage"},
            metadata,
        )

    assert exc_info.value.code == "empty_model_version"


def _candidate_ids():
    import json

    with CANDIDATES_PATH.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data["candidates"]


def _candidate_input(candidate):
    return candidate["input"]


def _payload_for_candidate(candidate):
    value = _candidate_input(candidate)
    if "payload" in value:
        return value["payload"]
    return {"errors": candidate.get("proposal", {}).get("findings", [])}


def _allowed_tags_for_candidate(candidate):
    value = _candidate_input(candidate)
    if "allowed_skill_tags" in value:
        return set(value["allowed_skill_tags"])
    return {
        "article_usage",
        "subject_verb_agreement",
        "verb_tense_past",
        "verb_tense_past_negation",
        "double_negative",
        "subject_verb_agreement_negation",
        "pronoun_case",
        "preposition_usage",
        "conditional_structure",
        "word_order",
        "pluralization",
        "auxiliary_verb",
        "question_formation",
    }


CANDIDATE_EXPECTATIONS = {
    "sgec_001": "accept",
    "sgec_002": "accept",
    "sgec_003": "accept",
    "sgec_004": "accept",
    "sgec_005": "duplicate_skill_tag",
    "sgec_006": "duplicate_skill_tag",
    "sgec_007": "accept",
    "sgec_008": "accept",
    "sgec_009": "accept",
    "sgec_010": "accept",
    "sgec_011": "accept",
    "sgec_012": "accept",
    "sgec_013": "accept",
    "sgec_014": "accept",
    "sgec_015": "accept",
    "sgec_016": "accept",
    "sgec_017": "invalid_sgec_batch",
    "sgec_018": "invalid_sgec_batch",
    "sgec_019": "invalid_sgec_batch",
    "sgec_020": "invalid_sgec_batch",
    "sgec_021": "invalid_sgec_batch",
    "sgec_022": "invalid_sgec_batch",
    "sgec_023": "invalid_sgec_batch",
    "sgec_024": "invalid_sgec_batch",
}


def test_all_24_candidates_have_explicit_adapter_outcome():
    candidates = _candidate_ids()
    assert len(candidates) == 24

    for candidate in candidates:
        candidate_id = candidate["id"]
        expected = CANDIDATE_EXPECTATIONS[candidate_id]
        proposal = candidate["proposal"]
        payload = _payload_for_candidate(candidate)
        allowed_tags = _allowed_tags_for_candidate(candidate)

        if expected == "accept":
            evaluation = build_grammar_evaluation(
                payload, allowed_tags, TRUSTED_METADATA
            )
            assert evaluation.metadata is TRUSTED_METADATA
            assert len(evaluation.findings) == len(proposal.get("findings", []))
        elif expected in {"duplicate_skill_tag", "invalid_sgec_batch"}:
            with pytest.raises(SGECAdapterError) as exc_info:
                build_grammar_evaluation(payload, allowed_tags, TRUSTED_METADATA)
            assert exc_info.value.code == expected
        else:
            pytest.fail(f"unexpected candidate expectation for {candidate_id}")


@pytest.mark.parametrize(
    "forbidden",
    [
        "config",
        "database",
        "models",
        "sqlalchemy",
        "httpx",
        "socket",
        "os.environ",
    ],
)
def test_adapter_import_purity_forbidden_tokens(forbidden):
    adapter_path = REPO_ROOT / "backend" / "services" / "sgec_adapter.py"
    tree = ast.parse(
        adapter_path.read_text(encoding="utf-8"), filename=str(adapter_path)
    )
    imported_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_names.update(alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported_names.add((node.module or "").split(".", 1)[0])
    assert forbidden.split(".", 1)[0] not in imported_names


def test_adapter_import_does_not_import_forbidden_modules():
    adapter = importlib.import_module("services.sgec_adapter")
    forbidden = {"config", "database", "models", "sqlalchemy", "httpx", "socket", "os"}
    imported = {name.split(".", 1)[0] for name in adapter.__dict__}
    assert not forbidden.intersection(imported)


def test_adapter_does_not_read_environment():
    adapter_path = REPO_ROOT / "backend" / "services" / "sgec_adapter.py"
    tree = ast.parse(
        adapter_path.read_text(encoding="utf-8"), filename=str(adapter_path)
    )
    for node in ast.walk(tree):
        assert not (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "os"
            and node.attr == "environ"
        )


def test_optional_explanation_field_is_not_transmitted():
    with pytest.raises(SGECAdapterError) as exc_info:
        build_grammar_evaluation(
            _batch([_finding({"explanation": "secret business text"})]),
            {"article_usage"},
            TRUSTED_METADATA,
        )
    assert exc_info.value.code == "invalid_sgec_batch"
    assert [issue.code for issue in exc_info.value.issues] == ["unknown_field"]
