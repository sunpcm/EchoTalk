"""Shared strict coverage rules for writing and reading B2 learning events."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

COVERAGE_DIRECTION_KEYS = frozenset(
    {
        "status",
        "reason",
        "result_count",
        "reused",
        "metadata",
        "basis",
        "source_facts",
    }
)
SOURCE_FACT_KEYS = frozenset({"source", "provider", "model_version", "is_synthetic"})
COMPLETED_STATUSES = frozenset({"not_called", "evaluated"})
COVERAGE_REASONS = frozenset(
    {
        "not_reached",
        "no_user_transcript",
        "disabled",
        "existing_result",
        "completed",
        "exception",
        "cancelled",
        "upstream_failed",
        "upstream_cancelled",
        "orchestration_failed",
        "orchestration_cancelled",
    }
)
COVERAGE_BASES = frozenset({"current_invocation", "persisted_rows", "none"})
COVERAGE_DIRECTION_NAMES = ("pronunciation", "grammar")
COVERAGE_DIRECTION_KEYSET = frozenset(COVERAGE_DIRECTION_NAMES)


class CoverageValidationError(ValueError):
    """A completed event's coverage cannot be proven from its source rows."""


def has_complete_b2_coverage(details: object) -> bool:
    """Return whether completed details expose two valid seven-key directions."""
    if (
        not isinstance(details, dict)
        or type(details.get("schema_version")) is not int
        or details["schema_version"] != 1
    ):
        return False
    coverage = details.get("coverage")
    if not isinstance(coverage, dict) or set(coverage) != COVERAGE_DIRECTION_KEYSET:
        return False
    for direction in coverage.values():
        if (
            not isinstance(direction, dict)
            or set(direction) != COVERAGE_DIRECTION_KEYS
            or not isinstance(direction["status"], str)
            or direction["status"] not in COMPLETED_STATUSES
            or not isinstance(direction["reason"], str)
            or direction["reason"] not in COVERAGE_REASONS
            or (
                direction["result_count"] is not None
                and (
                    type(direction["result_count"]) is not int
                    or direction["result_count"] < 0
                )
            )
            or type(direction["reused"]) is not bool
            or (
                direction["metadata"] is not None
                and not isinstance(direction["metadata"], dict)
            )
            or not isinstance(direction["basis"], str)
            or direction["basis"] not in COVERAGE_BASES
            or (
                direction["source_facts"] is not None
                and not _valid_source_fact_object(direction["source_facts"])
            )
        ):
            return False
    return True


def has_b2_direction_coverage(details: object, direction_name: str) -> bool:
    """Return whether one completed direction satisfies the full B2 shape."""
    if direction_name not in COVERAGE_DIRECTION_KEYSET or not has_complete_b2_coverage(
        details
    ):
        return False
    assert isinstance(details, dict)
    coverage = details["coverage"]
    direction = coverage[direction_name]
    if direction["status"] == "evaluated":
        if (
            direction["basis"] != "current_invocation"
            or direction["result_count"] is None
            or direction["result_count"] <= 0
        ):
            return False
    elif direction["status"] != "not_called" or direction["basis"] != "persisted_rows":
        return False
    if direction["source_facts"] is None:
        return False
    facts = direction["source_facts"]
    return type(facts["is_synthetic"]) is bool and facts["is_synthetic"] is False


@dataclass(frozen=True, slots=True)
class SourceFacts:
    source: str | None
    provider: str | None
    model_version: str | None
    is_synthetic: bool | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "provider": self.provider,
            "model_version": self.model_version,
            "is_synthetic": self.is_synthetic,
        }


def source_facts(source: object) -> SourceFacts:
    """Project and type-check the four auditable facts on a persisted source."""
    raw_source = getattr(source, "source", None)
    provider = getattr(source, "provider", None)
    model_version = getattr(source, "model_version", None)
    is_synthetic = getattr(source, "is_synthetic", None)
    if not isinstance(raw_source, str) or not raw_source:
        raise CoverageValidationError("source facts require a non-empty source")
    if provider is not None and (not isinstance(provider, str) or not provider):
        raise CoverageValidationError("provider must be null or non-empty")
    if model_version is not None and (
        not isinstance(model_version, str) or not model_version
    ):
        raise CoverageValidationError("model_version must be null or non-empty")
    if type(is_synthetic) is not bool:
        raise CoverageValidationError("is_synthetic must be a boolean")
    return SourceFacts(raw_source, provider, model_version, is_synthetic)


def metadata_source_facts(metadata: object) -> SourceFacts | None:
    """Project the four source facts from one I1 invocation metadata object."""
    if metadata is None:
        return None
    if isinstance(metadata, dict):
        try:
            return _parse_source_fact_object(
                {key: metadata[key] for key in SOURCE_FACT_KEYS},
                allow_null_source=True,
            )
        except (KeyError, TypeError, CoverageValidationError) as exc:
            raise CoverageValidationError("invocation metadata is invalid") from exc
    return source_facts(metadata)


def uniform_source_facts(sources: Sequence[object]) -> SourceFacts | None:
    """Return one direction's facts only when every persisted row is homogeneous."""
    if not sources:
        return None
    facts = [source_facts(source) for source in sources]
    first = facts[0]
    if any(candidate != first for candidate in facts[1:]):
        raise CoverageValidationError("source facts are heterogeneous")
    return first


def _parse_source_fact_object(
    value: object,
    *,
    allow_null_source: bool,
) -> SourceFacts:
    if not isinstance(value, dict) or set(value) != SOURCE_FACT_KEYS:
        raise CoverageValidationError("source_facts must contain exactly four fields")
    source = value["source"]
    provider = value["provider"]
    model_version = value["model_version"]
    synthetic = value["is_synthetic"]
    if source is None and not allow_null_source:
        raise CoverageValidationError("source_facts source cannot be null")
    if source is not None and (not isinstance(source, str) or not source):
        raise CoverageValidationError("source_facts source must be null or non-empty")
    if provider is not None and (not isinstance(provider, str) or not provider):
        raise CoverageValidationError("source_facts provider must be null or non-empty")
    if model_version is not None and (
        not isinstance(model_version, str) or not model_version
    ):
        raise CoverageValidationError(
            "source_facts model_version must be null or non-empty"
        )
    if synthetic is not None and type(synthetic) is not bool:
        raise CoverageValidationError(
            "source_facts is_synthetic must be null or boolean"
        )
    return SourceFacts(source, provider, model_version, synthetic)


def _valid_source_fact_object(value: object) -> bool:
    try:
        _parse_source_fact_object(value, allow_null_source=True)
    except CoverageValidationError:
        return False
    return True


def _validate_direction(
    name: str,
    direction: object,
    sources: Sequence[object],
) -> None:
    if not isinstance(direction, dict) or set(direction) != COVERAGE_DIRECTION_KEYS:
        raise CoverageValidationError(
            f"{name} coverage must contain exactly seven fields"
        )

    status = direction["status"]
    reason = direction["reason"]
    result_count = direction["result_count"]
    reused = direction["reused"]
    metadata = direction["metadata"]
    basis = direction["basis"]
    raw_facts = direction["source_facts"]

    if not isinstance(status, str):
        raise CoverageValidationError(f"{name} completed status is invalid")
    if status not in COMPLETED_STATUSES:
        raise CoverageValidationError(f"{name} completed status is invalid")
    if not isinstance(reason, str):
        raise CoverageValidationError(f"{name} coverage reason is invalid")
    if reason not in COVERAGE_REASONS:
        raise CoverageValidationError(f"{name} coverage reason is invalid")
    if result_count is not None and (type(result_count) is not int or result_count < 0):
        raise CoverageValidationError(f"{name} result_count is invalid")
    if type(reused) is not bool:
        raise CoverageValidationError(f"{name} reused must be a boolean")
    if metadata is not None and not isinstance(metadata, dict):
        raise CoverageValidationError(f"{name} metadata must be an object or null")
    if not isinstance(basis, str):
        raise CoverageValidationError(f"{name} basis is invalid")
    if basis not in COVERAGE_BASES:
        raise CoverageValidationError(f"{name} basis is invalid")
    if raw_facts is not None and not _valid_source_fact_object(raw_facts):
        raise CoverageValidationError(f"{name} source_facts is invalid")

    expected = uniform_source_facts(sources)
    if status == "evaluated":
        if basis != "current_invocation":
            raise CoverageValidationError(
                f"{name} evaluated coverage requires current_invocation"
            )
        if result_count is None:
            raise CoverageValidationError(
                f"{name} evaluated coverage requires a result count"
            )
        if name == "pronunciation":
            if not sources:
                raise CoverageValidationError(
                    "pronunciation evaluated coverage requires a source row"
                )
            if len(sources) > 1:
                raise CoverageValidationError(
                    "pronunciation completed coverage allows at most one source"
                )
            alignment = (
                getattr(sources[0], "phoneme_alignment", None) if sources else []
            )
            if not isinstance(alignment, list):
                raise CoverageValidationError(
                    "pronunciation source alignment must be an array"
                )
            expected_count = len(alignment)
        else:
            expected_count = len(sources)
        if result_count != expected_count:
            raise CoverageValidationError(
                f"{name} result_count does not match complete source facts"
            )

        invocation = metadata_source_facts(metadata)
        if invocation is None:
            raise CoverageValidationError(
                f"{name} evaluated coverage requires invocation metadata"
            )
        if expected is not None:
            if raw_facts != expected.as_dict():
                raise CoverageValidationError(
                    f"{name} source_facts do not match complete source rows"
                )
        elif raw_facts != invocation.as_dict():
            raise CoverageValidationError(
                f"{name} current-invocation source facts do not match metadata"
            )
        return

    if basis == "persisted_rows":
        if expected is None:
            raise CoverageValidationError(
                f"{name} persisted_rows requires persisted source rows"
            )
        if raw_facts != expected.as_dict():
            raise CoverageValidationError(
                f"{name} persisted-row source facts do not match"
            )
    elif basis == "none":
        if sources or raw_facts is not None:
            raise CoverageValidationError(
                f"{name} basis=none cannot discard persisted source rows"
            )
    else:
        raise CoverageValidationError(
            f"{name} not_called coverage requires persisted_rows or none"
        )


def validate_ledger_coverage(
    coverage: object,
    *,
    pronunciation_sources: Sequence[object],
    grammar_sources: Sequence[object],
) -> None:
    """Validate exactly two seven-field directions against complete source sets."""
    if not isinstance(coverage, dict) or set(coverage) != COVERAGE_DIRECTION_KEYSET:
        raise CoverageValidationError("coverage must contain exactly two directions")
    _validate_direction(
        "pronunciation",
        coverage["pronunciation"],
        pronunciation_sources,
    )
    _validate_direction("grammar", coverage["grammar"], grammar_sources)
