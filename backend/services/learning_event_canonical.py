"""Pure canonical observation rules shared by the writer and replay."""

from dataclasses import dataclass
from typing import Sequence
from uuid import UUID

from services.knowledge.skill_updater import phoneme_error_to_skill


class CanonicalObservationError(ValueError):
    """A source batch cannot produce a unique deterministic observation set."""


@dataclass(frozen=True, slots=True)
class CanonicalObservation:
    idempotency_key: str
    event_type: str
    skill_id: str
    source_ordinal: int
    observation_correct: bool
    observation_code: str | None
    pronunciation_assessment_id: UUID | None
    grammar_error_id: UUID | None
    source: str
    provider: str | None
    model_version: str | None
    confidence: float | None
    is_synthetic: bool


@dataclass(frozen=True, slots=True)
class CanonicalObservationBatch:
    job_id: UUID
    observations: tuple[CanonicalObservation, ...]
    unmapped_pronunciation: int
    unmapped_grammar: int


def candidate_skills(*, assessment, grammar_errors: Sequence) -> set[str]:
    """Return every skill a source batch could map to before DB validation."""
    candidates: set[str] = set()
    if assessment is not None and assessment.phoneme_alignment:
        for entry in _pronunciation_entries(assessment.phoneme_alignment):
            skill_id = phoneme_error_to_skill(entry)
            if skill_id is not None:
                candidates.add(skill_id)
    stable_keys = _grammar_stable_keys(grammar_errors)
    candidates.update(skill_tag for skill_tag, _error_type in stable_keys)
    return candidates


def _pronunciation_entries(alignment: object) -> list[dict]:
    """Validate nested JSON shape before the legacy skill mapper is called."""
    if not isinstance(alignment, list):
        raise CanonicalObservationError("phoneme_alignment must be an ordered array")
    entries: list[dict] = []
    for entry in alignment:
        if not isinstance(entry, dict):
            raise CanonicalObservationError("phoneme_alignment entries must be objects")
        error_type = entry.get("type")
        if not isinstance(error_type, str):
            raise CanonicalObservationError(
                "phoneme_alignment entry type must be a string"
            )
        expected = entry.get("expected")
        if expected is not None and not isinstance(expected, str):
            raise CanonicalObservationError(
                "phoneme_alignment expected must be null or a string"
            )
        entries.append(entry)
    return entries


def _grammar_stable_keys(grammar_errors: Sequence) -> list[tuple[str, str]]:
    stable_keys: list[tuple[str, str]] = []
    for error in grammar_errors:
        skill_tag = getattr(error, "skill_tag", None)
        error_type = getattr(error, "error_type", None)
        if not isinstance(skill_tag, str) or not isinstance(error_type, str):
            raise CanonicalObservationError("grammar stable keys must be strings")
        stable_keys.append((skill_tag, error_type))
    return stable_keys


def build_canonical_observations(
    *,
    job_id: UUID,
    assessment,
    grammar_errors: Sequence,
    valid_skill_ids: set[str],
) -> CanonicalObservationBatch:
    """Rebuild the writer's deterministic mapped observation batch."""
    pronunciation_candidates: list[tuple[dict, str | None, int]] = []
    if assessment is not None and assessment.phoneme_alignment:
        for ordinal, entry in enumerate(
            _pronunciation_entries(assessment.phoneme_alignment)
        ):
            pronunciation_candidates.append(
                (entry, phoneme_error_to_skill(entry), ordinal)
            )

    stable_keys = _grammar_stable_keys(grammar_errors)
    if len(stable_keys) != len(set(stable_keys)):
        raise CanonicalObservationError("grammar source contains duplicate stable keys")
    grammar_by_key = {
        (error.skill_tag, error.error_type): error for error in grammar_errors
    }
    sorted_grammar = [grammar_by_key[key] for key in sorted(stable_keys)]

    mapped_pronunciation = [
        (entry, skill_id, ordinal)
        for entry, skill_id, ordinal in pronunciation_candidates
        if skill_id is not None and skill_id in valid_skill_ids
    ]
    if mapped_pronunciation and (
        not assessment.model_version or not assessment.model_version.strip()
    ):
        raise CanonicalObservationError(
            "mapped pronunciation source requires a non-empty model version"
        )
    unmapped_pronunciation = len(pronunciation_candidates) - len(mapped_pronunciation)
    unmapped_grammar = sum(
        error.skill_tag not in valid_skill_ids for error in sorted_grammar
    )
    observations: list[CanonicalObservation] = []
    for entry, skill_id, ordinal in mapped_pronunciation:
        observations.append(
            CanonicalObservation(
                idempotency_key=f"job:{job_id}:pron:{ordinal}",
                event_type="pronunciation_observation",
                skill_id=skill_id,
                source_ordinal=ordinal,
                observation_correct=entry.get("type") == "correct",
                observation_code=entry.get("type"),
                pronunciation_assessment_id=assessment.id,
                grammar_error_id=None,
                source=assessment.source,
                provider=assessment.provider,
                model_version=assessment.model_version,
                confidence=assessment.confidence,
                is_synthetic=assessment.is_synthetic,
            )
        )

    for ordinal, error in enumerate(sorted_grammar):
        if error.skill_tag not in valid_skill_ids:
            continue
        if not error.model_version or not error.model_version.strip():
            raise CanonicalObservationError(
                "mapped grammar source requires a non-empty model version"
            )
        observations.append(
            CanonicalObservation(
                idempotency_key=f"job:{job_id}:grammar:{ordinal}",
                event_type="grammar_observation",
                skill_id=error.skill_tag,
                source_ordinal=ordinal,
                observation_correct=False,
                observation_code=error.error_type,
                pronunciation_assessment_id=None,
                grammar_error_id=error.id,
                source=error.source,
                provider=error.provider,
                model_version=error.model_version,
                confidence=error.confidence,
                is_synthetic=error.is_synthetic,
            )
        )

    return CanonicalObservationBatch(
        job_id=job_id,
        observations=tuple(observations),
        unmapped_pronunciation=unmapped_pronunciation,
        unmapped_grammar=unmapped_grammar,
    )
