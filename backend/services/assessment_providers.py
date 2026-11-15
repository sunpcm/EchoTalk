"""Transcript-only demo evaluators; no settings, database or audio contract."""

import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from services.pronunciation.phoneme_aligner import (
    align_phonemes,
    compute_pronunciation_score,
)

try:
    import pronouncing
except ImportError:
    pronouncing = None


@dataclass(frozen=True)
class AssessmentMetadata:
    source: str
    provider: str | None
    model_version: str | None
    is_synthetic: bool
    confidence: float | None


@dataclass(frozen=True)
class TranscriptAssessmentInput:
    text: str


@dataclass(frozen=True)
class PronunciationEvaluation:
    metadata: AssessmentMetadata
    overall_score: float
    phoneme_alignment: list[dict]


@dataclass(frozen=True)
class GrammarFinding:
    skill_tag: str
    original: str
    corrected: str
    error_type: str
    metadata: AssessmentMetadata


@dataclass(frozen=True)
class GrammarEvaluation:
    metadata: AssessmentMetadata
    findings: tuple[GrammarFinding, ...]


class PronunciationProvider(Protocol):
    metadata: AssessmentMetadata

    async def evaluate(
        self, value: TranscriptAssessmentInput
    ) -> PronunciationEvaluation: ...


class GrammarProvider(Protocol):
    metadata: AssessmentMetadata

    async def evaluate(self, value: TranscriptAssessmentInput) -> GrammarEvaluation: ...


def _get_ref_phonemes(word: str) -> list[str]:
    """获取单词的参考音素序列（优先 CMU 字典，否则字母回退）。"""
    word_lower = word.lower()
    if pronouncing is not None:
        phones = pronouncing.phones_for_word(word_lower)
        if phones:
            # CMU 返回格式如 "AH0 N D"，去掉重音数字
            return [re.sub(r"\d", "", p) for p in phones[0].split()]
    # 回退：每个字母作为一个"音素"
    return [ch.upper() for ch in word_lower if ch.isalpha()]


def _get_mock_user_phonemes(ref_phonemes: list[str], word: str) -> list[str]:
    """Mock 模式：生成用户音素（对 TH 开头词注入替换错误）。"""
    user_phonemes = list(ref_phonemes)
    if word.lower().startswith("th"):
        user_phonemes = ["S" if p in ("TH", "DH") else p for p in user_phonemes]
    return user_phonemes


class DemoMockPronunciationProvider:
    metadata = AssessmentMetadata("demo_mock", None, "demo-phoneme-rules-v1", True, 0.0)

    def __init__(self, reference_phonemes: Callable[[str], list[str]] | None = None):
        self._reference_phonemes = reference_phonemes

    async def evaluate(
        self, value: TranscriptAssessmentInput
    ) -> PronunciationEvaluation:
        resolver = (
            self._reference_phonemes
            if self._reference_phonemes is not None
            else _get_ref_phonemes
        )
        words = [w for w in re.split(r"\s+", value.text.strip()) if w]
        all_alignment: list[dict] = []
        position_offset = 0
        for word in words:
            clean_word = re.sub(r"[^\w]", "", word)
            if not clean_word:
                continue
            ref = resolver(clean_word)
            user = _get_mock_user_phonemes(ref, clean_word)
            if not ref:
                continue
            word_alignment = align_phonemes(ref, user)
            for entry in word_alignment:
                entry["position"] = position_offset + entry["position"]
            position_offset += len(word_alignment)
            all_alignment.extend(word_alignment)
        return PronunciationEvaluation(
            self.metadata, compute_pronunciation_score(all_alignment), all_alignment
        )


_GRAMMAR_RULES = [
    {
        "pattern": re.compile(
            r"(?:yesterday|last\s+\w+|ago|before)\b.*?\bI\s+go\b",
            re.IGNORECASE,
        ),
        "skill_tag": "verb_tense_past",
        "error_type": "wrong_tense",
        "extract": re.compile(r"\bI\s+go\b", re.IGNORECASE),
    },
    {
        "pattern": re.compile(r"\bI\s+go\b.*?\byesterday\b", re.IGNORECASE),
        "skill_tag": "verb_tense_past",
        "error_type": "wrong_tense",
        "extract": re.compile(r"\bI\s+go\b", re.IGNORECASE),
    },
    {
        "pattern": re.compile(r"\b(he|she|it)\s+(go|have|do)\b", re.IGNORECASE),
        "skill_tag": "subject_verb_agreement",
        "error_type": "wrong_3p_verb",
        "extract": re.compile(r"\b(he|she|it)\s+(go|have|do)\b", re.IGNORECASE),
    },
    {
        "pattern": re.compile(r"\bI\s+goes\b", re.IGNORECASE),
        "skill_tag": "subject_verb_agreement",
        "error_type": "wrong_3p_verb",
        "extract": re.compile(r"\bI\s+goes\b", re.IGNORECASE),
    },
]


def _grammar_correction(original: str, error_type: str) -> str:
    """Return the deterministic correction produced by the demo rule engine."""
    if error_type == "wrong_tense":
        return re.sub(r"\bgo\b", "went", original, flags=re.IGNORECASE)
    if original.lower() == "i goes":
        return "I go"
    match = re.match(r"\b(he|she|it)\s+(go|have|do)\b", original, re.IGNORECASE)
    if match:
        replacements = {"go": "goes", "have": "has", "do": "does"}
        return f"{match.group(1)} {replacements[match.group(2).lower()]}"
    return original


class DemoRuleGrammarProvider:
    metadata = AssessmentMetadata("demo_rule", None, "demo-grammar-rules-v1", True, 0.5)

    async def evaluate(self, value: TranscriptAssessmentInput) -> GrammarEvaluation:
        detected: set[str] = set()
        findings: list[GrammarFinding] = []
        for rule in _GRAMMAR_RULES:
            if rule["skill_tag"] in detected:
                continue
            match = rule["pattern"].search(value.text)
            if match:
                extract_match = rule["extract"].search(value.text)
                original = extract_match.group() if extract_match else match.group()
                findings.append(
                    GrammarFinding(
                        rule["skill_tag"],
                        original,
                        _grammar_correction(original, rule["error_type"]),
                        rule["error_type"],
                        self.metadata,
                    )
                )
                detected.add(rule["skill_tag"])
        return GrammarEvaluation(self.metadata, tuple(findings))


def validate_metadata(value: AssessmentMetadata) -> None:
    if not isinstance(value, AssessmentMetadata):
        raise ValueError("Invalid assessment metadata")
    if not isinstance(value.source, str) or not value.source:
        raise ValueError("Invalid assessment source")
    for item in (value.provider, value.model_version):
        if item is not None and not isinstance(item, str):
            raise ValueError("Invalid optional assessment metadata")
    if type(value.is_synthetic) is not bool:
        raise ValueError("Invalid synthetic marker")
    if value.confidence is not None and (
        type(value.confidence) not in (int, float)
        or not math.isfinite(value.confidence)
        or not 0 <= value.confidence <= 1
    ):
        raise ValueError("Invalid assessment confidence")


def validate_pronunciation_evaluation(value: PronunciationEvaluation) -> None:
    if not isinstance(value, PronunciationEvaluation):
        raise ValueError("Invalid pronunciation evaluation")
    validate_metadata(value.metadata)
    if (
        type(value.overall_score) not in (int, float)
        or not math.isfinite(value.overall_score)
        or not 0 <= value.overall_score <= 100
        or not isinstance(value.phoneme_alignment, list)
    ):
        raise ValueError("Invalid pronunciation result shape")
    fields = {"position", "phoneme", "expected", "actual", "type"}
    for entry in value.phoneme_alignment:
        if not isinstance(entry, dict) or set(entry) != fields:
            raise ValueError("Invalid phoneme alignment shape")
        if (
            type(entry["position"]) is not int
            or entry["position"] < 0
            or not isinstance(entry["phoneme"], str)
            or not isinstance(entry["type"], str)
            or entry["type"] not in {"correct", "substitution", "deletion", "insertion"}
            or any(
                item is not None and not isinstance(item, str)
                for item in (entry["expected"], entry["actual"])
            )
        ):
            raise ValueError("Invalid phoneme alignment fields")


def validate_grammar_evaluation(value: GrammarEvaluation) -> None:
    if not isinstance(value, GrammarEvaluation) or not isinstance(
        value.findings, tuple
    ):
        raise ValueError("Invalid grammar evaluation")
    validate_metadata(value.metadata)
    seen: set[str] = set()
    for finding in value.findings:
        if not isinstance(finding, GrammarFinding) or not all(
            isinstance(item, str)
            for item in (
                finding.skill_tag,
                finding.original,
                finding.corrected,
                finding.error_type,
            )
        ):
            raise ValueError("Invalid grammar finding")
        validate_metadata(finding.metadata)
        if finding.skill_tag in seen:
            raise ValueError("Duplicate grammar skill")
        seen.add(finding.skill_tag)
