"""SGEC offline batch to I1 grammar evaluation adapter.

This module is intentionally pure and offline. It only adapts the strict
SGEC offline validator output into the I1 grammar evaluation dataclasses from
``services.assessment_providers``. It must not import configuration, ORM,
database, SQLAlchemy, networking or environment helpers.
"""

from collections.abc import Collection, Mapping, Sequence
from typing import Any

from services.assessment_providers import (
    AssessmentMetadata,
    GrammarEvaluation,
    GrammarFinding,
    validate_grammar_evaluation,
)
from services.sgec_offline import SGECBatchResult, validate_sgec_batch


class SGECAdapterError(RuntimeError):
    """A stable, machine-readable SGEC adapter rejection.

    The public ``code`` and structured ``issues`` are safe to expose. The
    message intentionally avoids echoing business text or unknown field names.
    """

    def __init__(self, code: str, issues: tuple[object, ...] = ()) -> None:
        super().__init__(f"SGEC adapter rejected batch: code={code}")
        self.code = code
        self.issues = issues

    def __str__(self) -> str:
        return self.code


def _is_blank(value: str) -> bool:
    return not value.strip()


def _has_valid_metadata_type(value: AssessmentMetadata) -> bool:
    return isinstance(value, AssessmentMetadata)


def _has_blank_model_version(metadata: AssessmentMetadata) -> bool:
    model_version = metadata.model_version
    return (
        model_version is None
        or not isinstance(model_version, str)
        or not model_version.strip()
    )


def _validate_adapter_gates(
    accepted: Sequence[Any],
    metadata: AssessmentMetadata,
) -> None:
    seen_skill_tags: set[str] = set()
    has_findings = bool(accepted)

    if has_findings and _has_blank_model_version(metadata):
        raise SGECAdapterError(code="empty_model_version")

    for item in accepted:
        skill_tag = item.skill_tag

        if skill_tag in seen_skill_tags:
            raise SGECAdapterError(code="duplicate_skill_tag")
        seen_skill_tags.add(skill_tag)

        if _is_blank(item.error_type):
            raise SGECAdapterError(code="empty_error_type")
        if _is_blank(item.original):
            raise SGECAdapterError(code="empty_original")
        if _is_blank(item.corrected):
            raise SGECAdapterError(code="empty_corrected")


def _finding_metadata(
    metadata: AssessmentMetadata, confidence: int | float | None
) -> AssessmentMetadata:
    return AssessmentMetadata(
        source=metadata.source,
        provider=metadata.provider,
        model_version=metadata.model_version,
        is_synthetic=metadata.is_synthetic,
        confidence=confidence,
    )


def build_grammar_evaluation(
    sgec_batch: Mapping[str, Any],
    allowed_skill_tags: Collection[str],
    metadata: AssessmentMetadata,
) -> GrammarEvaluation:
    """Build an I1 grammar evaluation from a strict SGEC offline batch.

    Raises ``SGECAdapterError`` for any validation or adapter gate rejection.
    The input is processed atomically: a bad item rejects the whole batch.
    """

    batch: SGECBatchResult = validate_sgec_batch(sgec_batch, allowed_skill_tags)
    if not batch.ok:
        raise SGECAdapterError(code="invalid_sgec_batch", issues=batch.issues)

    if not _has_valid_metadata_type(metadata):
        raise SGECAdapterError(code="invalid_metadata")

    _validate_adapter_gates(batch.accepted, metadata)

    findings = tuple(
        GrammarFinding(
            skill_tag=item.skill_tag,
            original=item.original,
            corrected=item.corrected,
            error_type=item.error_type,
            metadata=_finding_metadata(metadata, item.confidence),
        )
        for item in batch.accepted
    )
    evaluation = GrammarEvaluation(metadata=metadata, findings=findings)

    try:
        validate_grammar_evaluation(evaluation)
    except ValueError as exc:
        raise SGECAdapterError(code="invalid_grammar_evaluation") from exc

    return evaluation
