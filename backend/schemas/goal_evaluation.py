"""Read-only goal view schemas for ``GET /sessions/{id}/goals``."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class GoalViewEntry(BaseModel):
    """One frozen goal definition plus its terminal result (or null)."""

    model_config = ConfigDict(extra="forbid")

    goal_id: str
    goal_version: int
    description_en: str
    description_zh: str
    criteria: tuple[str, ...]
    evidence_types: tuple[str, ...]
    result: str | None


class GoalExecution(BaseModel):
    """Execution progress for the one active revision."""

    model_config = ConfigDict(extra="forbid")

    status: str
    revision: int
    evaluator_version: str


class GoalSummary(BaseModel):
    """Terminal count invariants; ``0 <= achieved <= assessed <= total``."""

    model_config = ConfigDict(extra="forbid")

    total: int
    achieved: int
    not_achieved: int
    assessed: int
    unknown: int
    not_assessed: int


class GoalViewResponse(BaseModel):
    """Stable owner-scoped read for one session's goals."""

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    configured: bool
    material_id: str | None
    material_version: int | None
    goals: list[GoalViewEntry]
    execution: GoalExecution | None
    summary: GoalSummary | None
