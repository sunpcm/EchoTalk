"""Immutable scenario-goal catalog versions and session snapshots."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from time_utils import utc_now


class GoalCatalogVersion(Base):
    """One global, immutable set of goals for a material version."""

    __tablename__ = "goal_catalog_versions"
    __table_args__ = (
        CheckConstraint(
            "material_version > 0",
            name="ck_goal_catalog_versions_version_positive",
        ),
        CheckConstraint(
            "jsonb_typeof(goals) = 'array'",
            name="ck_goal_catalog_versions_goals_array",
        ),
        CheckConstraint(
            "jsonb_array_length(goals) > 0",
            name="ck_goal_catalog_versions_goals_nonempty",
        ),
    )

    material_id: Mapped[str] = mapped_column(
        String(100),
        primary_key=True,
    )
    material_version: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    goals: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB(astext_type=Text()),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=text("now()"),
        nullable=False,
    )


class SessionGoalSnapshot(Base):
    """The one catalog version selected for a session."""

    __tablename__ = "session_goal_snapshots"
    __table_args__ = (
        CheckConstraint(
            "material_version > 0",
            name="ck_session_goal_snapshots_version_positive",
        ),
        ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name="fk_session_goal_snapshots_session_id",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["material_id", "material_version"],
            [
                "goal_catalog_versions.material_id",
                "goal_catalog_versions.material_version",
            ],
            name="fk_session_goal_snapshots_catalog_version",
            ondelete="RESTRICT",
        ),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
    )
    material_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    material_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
