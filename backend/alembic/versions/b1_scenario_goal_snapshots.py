"""add immutable scenario goal catalog versions and session snapshots

Revision ID: b1_scenario_goal_snapshots
Revises: b1_learning_event_cutover
Create Date: 2026-11-16 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b1_scenario_goal_snapshots"
down_revision: Union[str, Sequence[str], None] = "b1_learning_event_cutover"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create versioned goal definitions and one snapshot per session."""
    op.create_table(
        "goal_catalog_versions",
        sa.Column("material_id", sa.String(length=100), nullable=False),
        sa.Column("material_version", sa.Integer(), nullable=False),
        sa.Column(
            "goals",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "material_version > 0",
            name="ck_goal_catalog_versions_version_positive",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(goals) = 'array'",
            name="ck_goal_catalog_versions_goals_array",
        ),
        sa.CheckConstraint(
            "jsonb_array_length(goals) > 0",
            name="ck_goal_catalog_versions_goals_nonempty",
        ),
        sa.PrimaryKeyConstraint("material_id", "material_version"),
    )
    op.create_table(
        "session_goal_snapshots",
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("material_id", sa.String(length=100), nullable=False),
        sa.Column("material_version", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "material_version > 0",
            name="ck_session_goal_snapshots_version_positive",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name="fk_session_goal_snapshots_session_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["material_id", "material_version"],
            [
                "goal_catalog_versions.material_id",
                "goal_catalog_versions.material_version",
            ],
            name="fk_session_goal_snapshots_catalog_version",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("session_id"),
    )
    op.execute(
        """
        CREATE FUNCTION reject_scenario_goal_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $scenario_goal$
        BEGIN
            RAISE EXCEPTION 'scenario goal records are immutable'
                USING ERRCODE = 'integrity_constraint_violation';
        END;
        $scenario_goal$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_goal_catalog_versions_no_update
        BEFORE UPDATE ON goal_catalog_versions
        FOR EACH ROW
        EXECUTE FUNCTION reject_scenario_goal_mutation()
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_session_goal_snapshots_no_update
        BEFORE UPDATE ON session_goal_snapshots
        FOR EACH ROW
        EXECUTE FUNCTION reject_scenario_goal_mutation()
        """
    )


def downgrade() -> None:
    """Drop the snapshot and catalog tables and their shared guard."""
    op.execute(
        "DROP TRIGGER IF EXISTS trg_session_goal_snapshots_no_update "
        "ON session_goal_snapshots"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_goal_catalog_versions_no_update "
        "ON goal_catalog_versions"
    )
    op.drop_table("session_goal_snapshots")
    op.drop_table("goal_catalog_versions")
    op.execute("DROP FUNCTION IF EXISTS reject_scenario_goal_mutation()")
