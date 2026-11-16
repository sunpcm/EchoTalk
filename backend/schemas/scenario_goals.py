"""Strict immutable definitions for scenario goals."""

from __future__ import annotations

from typing import Annotated, Any, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)

NonEmptyString = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]
MATERIAL_ID_PATTERN = r"^mat_[a-z0-9_-]+$"
GOAL_ID_PATTERN = r"^mat_[a-z0-9_-]+:[a-z][a-z0-9_-]*$"
GoalId = Annotated[
    str,
    StringConstraints(
        strict=True,
        pattern=GOAL_ID_PATTERN,
    ),
]


class GoalDefinition(BaseModel):
    """One fully described goal in an immutable material version."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
    )

    goal_id: GoalId
    goal_version: int = Field(gt=0)
    description_en: NonEmptyString
    description_zh: NonEmptyString
    criteria: tuple[NonEmptyString, ...] = Field(min_length=1)
    evidence_types: tuple[NonEmptyString, ...] = Field(min_length=1)

    @field_validator("criteria", "evidence_types", mode="before")
    @classmethod
    def _normalize_json_arrays(cls, value: Any) -> Any:
        if isinstance(value, list):
            return tuple(value)
        if isinstance(value, tuple):
            return value
        return value

    @classmethod
    def create(
        cls,
        *,
        material_id: str,
        slug: str,
        goal_version: int,
        description_en: str,
        description_zh: str,
        criteria: tuple[str, ...] | list[str],
        evidence_types: tuple[str, ...] | list[str],
    ) -> Self:
        """Build a definition with the stable material-prefixed goal id."""
        return cls.model_validate(
            {
                "goal_id": f"{material_id}:{slug}",
                "goal_version": goal_version,
                "description_en": description_en,
                "description_zh": description_zh,
                "criteria": criteria,
                "evidence_types": evidence_types,
            }
        )
