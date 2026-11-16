"""Caller-owned writes and owner-scoped reads for scenario goal snapshots."""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.scenario_goals import GoalCatalogVersion, SessionGoalSnapshot
from models.session import Session, SessionStatus
from models.user import User
from schemas.scenario_goals import MATERIAL_ID_PATTERN, GoalDefinition

_MATERIAL_ID_RE = re.compile(MATERIAL_ID_PATTERN)


class ScenarioGoalValidationError(ValueError):
    """Raised when a scenario goal write is structurally invalid."""


class GoalCatalogConflictError(RuntimeError):
    """Raised when one catalog version is reused with different content."""


class SessionGoalConflictError(RuntimeError):
    """Raised when a session is rebound to a different catalog version."""


class SessionGoalAccessError(RuntimeError):
    """Raised when a session does not belong to the requested user."""


class SessionGoalStateError(RuntimeError):
    """Raised when a first snapshot is attempted outside an active session."""


def _require_material_version(material_version: int) -> int:
    if type(material_version) is not int or material_version <= 0:
        raise ScenarioGoalValidationError("material_version must be a positive integer")
    return material_version


def _require_material_id(material_id: str) -> str:
    if (
        type(material_id) is not str
        or len(material_id) > 100
        or _MATERIAL_ID_RE.fullmatch(material_id) is None
    ):
        raise ScenarioGoalValidationError("material_id is invalid")
    return material_id


def _validate_goals(
    *,
    material_id: str,
    goals: Sequence[GoalDefinition],
) -> list[dict[str, object]]:
    if isinstance(goals, (str, bytes, bytearray)) or not isinstance(goals, Sequence):
        raise ScenarioGoalValidationError("goals must be a non-empty sequence")
    if not goals:
        raise ScenarioGoalValidationError("goals must be a non-empty sequence")

    canonical: list[dict[str, object]] = []
    seen_goal_ids: set[str] = set()
    expected_prefix = f"{material_id}:"
    for index, goal in enumerate(goals):
        if not isinstance(goal, GoalDefinition):
            raise ScenarioGoalValidationError(
                f"goals[{index}] must be a GoalDefinition"
            )
        if not goal.goal_id.startswith(expected_prefix):
            raise ScenarioGoalValidationError(
                f"goals[{index}] material prefix does not match"
            )
        if goal.goal_id in seen_goal_ids:
            raise ScenarioGoalValidationError(f"duplicate goal_id {goal.goal_id!r}")
        seen_goal_ids.add(goal.goal_id)
        canonical.append(goal.model_dump(mode="json"))
    return canonical


async def record_goal_catalog_version(
    db: AsyncSession,
    *,
    material_id: str,
    material_version: int,
    goals: Sequence[GoalDefinition],
) -> GoalCatalogVersion:
    """Append or return one immutable goal catalog version."""
    material_id = _require_material_id(material_id)
    material_version = _require_material_version(material_version)
    canonical_goals = _validate_goals(
        material_id=material_id,
        goals=goals,
    )

    statement = (
        pg_insert(GoalCatalogVersion)
        .values(
            material_id=material_id,
            material_version=material_version,
            goals=canonical_goals,
        )
        .on_conflict_do_nothing(
            index_elements=[
                GoalCatalogVersion.material_id,
                GoalCatalogVersion.material_version,
            ]
        )
    )
    await db.execute(statement)

    row = await db.scalar(
        select(GoalCatalogVersion).where(
            GoalCatalogVersion.material_id == material_id,
            GoalCatalogVersion.material_version == material_version,
        )
    )
    if row is None:
        raise RuntimeError("goal catalog version insert did not produce a row")
    if row.goals != canonical_goals:
        raise GoalCatalogConflictError(
            "material_version already exists with different goals"
        )
    return row


async def write_session_goal_snapshot(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    material_id: str,
    material_version: int,
) -> SessionGoalSnapshot:
    """Bind one active session to one catalog version in the caller transaction."""
    if not isinstance(user_id, uuid.UUID) or not isinstance(session_id, uuid.UUID):
        raise ScenarioGoalValidationError("user_id and session_id must be UUIDs")
    material_id = _require_material_id(material_id)
    material_version = _require_material_version(material_version)

    locked_user_id = await db.scalar(
        select(User.id).where(User.id == user_id).with_for_update()
    )
    if locked_user_id is None:
        raise SessionGoalAccessError("session is not available to this user")

    session = (
        await db.execute(
            select(Session.id, Session.status)
            .where(
                Session.id == session_id,
                Session.user_id == user_id,
            )
            .with_for_update()
        )
    ).one_or_none()
    if session is None:
        raise SessionGoalAccessError("session is not available to this user")

    existing = await db.scalar(
        select(SessionGoalSnapshot).where(SessionGoalSnapshot.session_id == session_id)
    )
    if existing is not None:
        if (
            existing.material_id == material_id
            and existing.material_version == material_version
        ):
            return existing
        raise SessionGoalConflictError(
            "session is already bound to a different catalog version"
        )

    if session.status != SessionStatus.active:
        raise SessionGoalStateError(
            "first session goal snapshot requires an active session"
        )

    catalog_exists = await db.scalar(
        select(GoalCatalogVersion.material_id).where(
            GoalCatalogVersion.material_id == material_id,
            GoalCatalogVersion.material_version == material_version,
        )
    )
    if catalog_exists is None:
        raise ScenarioGoalValidationError(
            "referenced goal catalog version does not exist"
        )

    snapshot = SessionGoalSnapshot(
        session_id=session_id,
        material_id=material_id,
        material_version=material_version,
    )
    db.add(snapshot)
    await db.flush()
    return snapshot


async def read_session_goal_snapshot(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> SessionGoalSnapshot | None:
    """Read a snapshot only when its session belongs to the requested user."""
    return await db.scalar(
        select(SessionGoalSnapshot)
        .join(Session, Session.id == SessionGoalSnapshot.session_id)
        .where(
            SessionGoalSnapshot.session_id == session_id,
            Session.user_id == user_id,
        )
    )
