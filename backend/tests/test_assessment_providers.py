"""Direct provider contracts; runnable with the fenced no-conftest entry."""

from dataclasses import FrozenInstanceError, replace
from types import SimpleNamespace

import pytest

from services import assessment_providers as providers
from services.assessment_providers import (
    AssessmentMetadata,
    DemoMockPronunciationProvider,
    DemoRuleGrammarProvider,
    GrammarEvaluation,
    GrammarFinding,
    PronunciationEvaluation,
    TranscriptAssessmentInput,
    validate_grammar_evaluation,
    validate_metadata,
    validate_pronunciation_evaluation,
)


def test_construction_does_not_run_text_or_reference_resolution():
    calls = []

    def reference(word):
        calls.append(word)
        return ["TH"]

    provider = DemoMockPronunciationProvider(reference)
    assert calls == []
    assert provider.metadata == AssessmentMetadata(
        "demo_mock", None, "demo-phoneme-rules-v1", True, 0.0
    )
    assert DemoRuleGrammarProvider().metadata == AssessmentMetadata(
        "demo_rule", None, "demo-grammar-rules-v1", True, 0.5
    )


@pytest.mark.asyncio
async def test_real_pronunciation_metadata_th_alignment_position_and_score():
    references = {"That": ["TH", "AE"], "cat": ["K"]}
    calls = []

    def reference(word):
        calls.append(word)
        return references[word]

    result = await DemoMockPronunciationProvider(reference).evaluate(
        TranscriptAssessmentInput("That, cat.")
    )
    validate_pronunciation_evaluation(result)
    assert calls == ["That", "cat"]
    assert result.metadata == AssessmentMetadata(
        "demo_mock", None, "demo-phoneme-rules-v1", True, 0.0
    )
    assert result.overall_score == 66.7
    assert result.phoneme_alignment == [
        {
            "position": 0,
            "phoneme": "TH",
            "expected": "TH",
            "actual": "S",
            "type": "substitution",
        },
        {
            "position": 1,
            "phoneme": "AE",
            "expected": "AE",
            "actual": "AE",
            "type": "correct",
        },
        {
            "position": 2,
            "phoneme": "K",
            "expected": "K",
            "actual": "K",
            "type": "correct",
        },
    ]
    assert references == {"That": ["TH", "AE"], "cat": ["K"]}


@pytest.mark.asyncio
async def test_empty_alignment_is_an_actual_zero_result():
    result = await DemoMockPronunciationProvider(lambda word: []).evaluate(
        TranscriptAssessmentInput("! word ?")
    )
    assert isinstance(result, PronunciationEvaluation)
    assert result.phoneme_alignment == []
    assert result.overall_score == 0.0
    assert result.metadata.confidence == 0.0
    validate_pronunciation_evaluation(result)


@pytest.mark.asyncio
async def test_reference_dictionary_strips_stress_and_falls_back_without_download(
    monkeypatch,
):
    monkeypatch.setattr(
        providers,
        "pronouncing",
        SimpleNamespace(
            phones_for_word=lambda word: ["DH AH0"] if word == "the" else []
        ),
    )
    assert providers._get_ref_phonemes("The") == ["DH", "AH"]
    assert providers._get_ref_phonemes("AB-12") == ["A", "B"]
    result = await DemoMockPronunciationProvider().evaluate(
        TranscriptAssessmentInput("The")
    )
    assert result.phoneme_alignment[0]["actual"] == "S"
    monkeypatch.setattr(providers, "pronouncing", None)
    fallback = await DemoMockPronunciationProvider().evaluate(
        TranscriptAssessmentInput("ab")
    )
    assert [item["expected"] for item in fallback.phoneme_alignment] == ["A", "B"]
    assert fallback.overall_score == 100.0


@pytest.mark.asyncio
async def test_grammar_rules_keep_order_one_finding_per_skill_and_metadata():
    result = await DemoRuleGrammarProvider().evaluate(
        TranscriptAssessmentInput("Yesterday I go. He go. I goes. I go yesterday.")
    )
    validate_grammar_evaluation(result)
    assert result.metadata == AssessmentMetadata(
        "demo_rule", None, "demo-grammar-rules-v1", True, 0.5
    )
    assert [
        (item.skill_tag, item.original, item.corrected, item.error_type)
        for item in result.findings
    ] == [
        ("verb_tense_past", "I go", "I went", "wrong_tense"),
        ("subject_verb_agreement", "He go", "He goes", "wrong_3p_verb"),
    ]
    for item in result.findings:
        assert item.metadata == AssessmentMetadata(
            "demo_rule", None, "demo-grammar-rules-v1", True, 0.5
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("text", "original", "corrected"),
    [
        ("Yesterday I go", "I go", "I went"),
        ("I go yesterday", "I go", "I went"),
        ("I goes", "I goes", "I go"),
        ("she have", "she have", "she has"),
        ("he do", "he do", "he does"),
        ("it go", "it go", "it goes"),
    ],
)
async def test_actual_demo_corrections(text, original, corrected):
    result = await DemoRuleGrammarProvider().evaluate(TranscriptAssessmentInput(text))
    assert len(result.findings) == 1
    assert (result.findings[0].original, result.findings[0].corrected) == (
        original,
        corrected,
    )


@pytest.mark.asyncio
async def test_grammar_zero_is_typed_and_keeps_invocation_metadata():
    result = await DemoRuleGrammarProvider().evaluate(
        TranscriptAssessmentInput("Hello.")
    )
    assert isinstance(result, GrammarEvaluation)
    assert result.findings == ()
    assert result.metadata == AssessmentMetadata(
        "demo_rule", None, "demo-grammar-rules-v1", True, 0.5
    )
    validate_grammar_evaluation(result)


@pytest.mark.parametrize("confidence", [None, 0.0, 0.5, 1.0])
def test_valid_null_and_zero_metadata_is_not_normalized(confidence):
    value = AssessmentMetadata("fixture", None, None, False, confidence)
    validate_metadata(value)
    assert value.provider is None
    assert value.model_version is None
    assert value.confidence == confidence
    assert value.is_synthetic is False
    with pytest.raises(FrozenInstanceError):
        value.source = "changed"


@pytest.mark.parametrize(
    "confidence", [-0.1, 1.1, float("nan"), float("inf"), True, "secret"]
)
def test_invalid_metadata_fails_without_echoing_untrusted_value(confidence):
    with pytest.raises(ValueError) as caught:
        validate_metadata(AssessmentMetadata("fixture", None, None, True, confidence))
    assert "secret" not in str(caught.value)


@pytest.mark.parametrize("value", [None, [], object()])
def test_no_pronunciation_result_cannot_mean_empty_success(value):
    with pytest.raises(ValueError, match="Invalid pronunciation"):
        validate_pronunciation_evaluation(value)


def test_bad_alignment_cannot_hide_extra_payload_fields():
    result = PronunciationEvaluation(
        AssessmentMetadata("fixture", None, None, True, None),
        0.0,
        [{"position": 0, "secret": "never-persist"}],
    )
    with pytest.raises(ValueError) as caught:
        validate_pronunciation_evaluation(result)
    assert "never-persist" not in str(caught.value)


@pytest.mark.parametrize("kind", ["secret-unknown-type", ["secret-unknown-type"], None])
def test_invalid_alignment_type_is_a_controlled_shape_failure(kind):
    result = PronunciationEvaluation(
        AssessmentMetadata("fixture", None, None, True, None),
        0.0,
        [
            {
                "position": 0,
                "phoneme": "TH",
                "expected": "TH",
                "actual": "S",
                "type": kind,
            }
        ],
    )
    with pytest.raises(ValueError, match="Invalid phoneme alignment fields") as caught:
        validate_pronunciation_evaluation(result)
    assert "secret-unknown-type" not in str(caught.value)


def test_invalid_and_duplicate_grammar_results_are_rejected():
    metadata = AssessmentMetadata("fixture", None, None, False, 0.0)
    finding = GrammarFinding("tense", "before", "after", "wrong_tense", metadata)
    for result in (
        None,
        GrammarEvaluation(metadata, []),
        GrammarEvaluation(metadata, (finding, finding)),
    ):
        with pytest.raises(ValueError):
            validate_grammar_evaluation(result)
    changed = replace(finding, metadata=replace(metadata, confidence=None))
    result = GrammarEvaluation(metadata, (changed,))
    validate_grammar_evaluation(result)
    assert result.findings[0].metadata.confidence is None
