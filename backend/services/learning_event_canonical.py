"""Pure canonical observation rules shared by the writer and replay."""

from dataclasses import dataclass
from typing import Sequence
from uuid import UUID

from services.knowledge.skill_updater import phoneme_error_to_skill


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
        for entry in assessment.phoneme_alignment:
            skill_id = phoneme_error_to_skill(entry)
            if skill_id is not None:
                candidates.add(skill_id)
    candidates.update(error.skill_tag for error in grammar_errors)
    return candidates


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
        for ordinal, entry in enumerate(assessment.phoneme_alignment):
            pronunciation_candidates.append(
                (entry, phoneme_error_to_skill(entry), ordinal)
            )

    sorted_grammar = sorted(
        grammar_errors, key=lambda error: (error.skill_tag, error.error_type)
    )

    unmapped_pronunciation = 0
    observations: list[CanonicalObservation] = []
    for entry, skill_id, ordinal in pronunciation_candidates:
        if skill_id is None or skill_id not in valid_skill_ids:
            unmapped_pronunciation += 1
            continue
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

    unmapped_grammar = 0
    for ordinal, error in enumerate(sorted_grammar):
        if error.skill_tag not in valid_skill_ids:
            unmapped_grammar += 1
            continue
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
