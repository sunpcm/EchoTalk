"""Resolve and persist the current scenario-goal binding for a session."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.scenario_goals import SessionGoalSnapshot
from models.user import User
from schemas.scenario_goals import GoalDefinition
from services.material_catalog import get_material_catalog
from services.session_goal_snapshot import (
    record_goal_catalog_version,
    write_session_goal_snapshot,
)


class GoalBindingValidationError(ValueError):
    """Raised when a requested catalog reference is unavailable or invalid."""


@dataclass(frozen=True, slots=True)
class ResolvedGoalBinding:
    """One exact material version resolved from the controlled catalog."""

    material_id: str
    material_version: int
    goals: tuple[GoalDefinition, ...]


def resolve_goal_binding(
    material_id: str,
    material_version: int,
) -> ResolvedGoalBinding:
    """Resolve an exact current catalog version without accepting client goals."""
    if type(material_id) is not str or not material_id.strip():
        raise GoalBindingValidationError("material_id is invalid")
    if type(material_version) is not int or material_version <= 0:
        raise GoalBindingValidationError("material_version is invalid")

    for material in get_material_catalog():
        if material.id != material_id:
            continue
        if material.material_version != material_version or not material.goals:
            break
        return ResolvedGoalBinding(
            material_id=material.id,
            material_version=material.material_version,
            goals=material.goals,
        )
    raise GoalBindingValidationError(
        "goal_binding does not reference a current material version with goals"
    )


async def lock_user_for_goal_session(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
) -> None:
    """Acquire the User row before a bound Session insert to preserve lock order."""
    locked_user_id = await db.scalar(
        select(User.id).where(User.id == user_id).with_for_update()
    )
    if locked_user_id is None:
        raise GoalBindingValidationError("session user is unavailable")


async def bind_session_goal(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    binding: ResolvedGoalBinding,
) -> SessionGoalSnapshot:
    """Publish the immutable catalog version and snapshot in the caller transaction."""
    await record_goal_catalog_version(
        db,
        material_id=binding.material_id,
        material_version=binding.material_version,
        goals=binding.goals,
    )
    return await write_session_goal_snapshot(
        db,
        user_id=user_id,
        session_id=session_id,
        material_id=binding.material_id,
        material_version=binding.material_version,
    )
