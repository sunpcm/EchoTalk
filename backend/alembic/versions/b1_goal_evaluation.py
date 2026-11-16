"""add append-only goal evaluation runs and results

Revision ID: b1_goal_evaluation
Revises: b1_scenario_goal_snapshots
Create Date: 2026-11-16 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b1_goal_evaluation"
down_revision: Union[str, Sequence[str], None] = "b1_scenario_goal_snapshots"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create append-only goal runs/results and their immutability guards."""
    run_status_enum = postgresql.ENUM(
        "pending",
        "running",
        "succeeded",
        "failed",
        name="goal_run_status_enum",
        create_type=False,
    )
    result_enum = postgresql.ENUM(
        "achieved",
        "not_achieved",
        "unknown",
        "not_assessed",
        name="goal_result_enum",
        create_type=False,
    )
    run_status_enum.create(op.get_bind(), checkfirst=True)
    result_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "goal_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "status",
            run_status_enum,
            server_default="pending",
            nullable=False,
        ),
        sa.Column("evaluator_version", sa.String(length=64), nullable=False),
        sa.Column(
            "evidence",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "revision > 0",
            name="ck_goal_runs_revision_positive",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_goal_runs_attempt_count_nonnegative",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(evidence) = 'array'",
            name="ck_goal_runs_evidence_array",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["session_goal_snapshots.session_id"],
            name="fk_goal_runs_session_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "revision",
            name="uq_goal_runs_session_revision",
        ),
    )
    op.create_index(
        "ix_goal_runs_claimable",
        "goal_runs",
        ["status", "next_retry_at", "created_at"],
    )

    op.create_table(
        "goal_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("goal_id", sa.String(length=200), nullable=False),
        sa.Column("goal_version", sa.Integer(), nullable=False),
        sa.Column("result", result_enum, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "goal_version > 0",
            name="ck_goal_results_goal_version_positive",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["goal_runs.id"],
            name="fk_goal_results_run_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "run_id",
            "goal_id",
            name="uq_goal_results_run_goal",
        ),
    )

    op.execute(
        """
        CREATE FUNCTION reject_goal_result_update()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $goal_eval$
        BEGIN
            RAISE EXCEPTION 'goal result is immutable'
                USING ERRCODE = '23000';
        END;
        $goal_eval$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_goal_results_no_update
        BEFORE UPDATE ON goal_results
        FOR EACH ROW
        EXECUTE FUNCTION reject_goal_result_update()
        """
    )
    op.execute(
        """
        CREATE FUNCTION enforce_goal_run_immutability()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $goal_eval$
        BEGIN
            IF OLD.status IN ('succeeded', 'failed') THEN
                RAISE EXCEPTION 'terminal goal run cannot be overwritten'
                    USING ERRCODE = '23000';
            END IF;
            IF NEW.id IS DISTINCT FROM OLD.id
                OR NEW.created_at IS DISTINCT FROM OLD.created_at
                OR NEW.session_id IS DISTINCT FROM OLD.session_id
                OR NEW.revision IS DISTINCT FROM OLD.revision
                OR NEW.evaluator_version IS DISTINCT FROM OLD.evaluator_version
                OR NEW.evidence IS DISTINCT FROM OLD.evidence THEN
                RAISE EXCEPTION 'goal run frozen fields are immutable'
                    USING ERRCODE = '23000';
            END IF;
            RETURN NEW;
        END;
        $goal_eval$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_goal_runs_immutable
        BEFORE UPDATE ON goal_runs
        FOR EACH ROW
        EXECUTE FUNCTION enforce_goal_run_immutability()
        """
    )


def downgrade() -> None:
    """Drop goal results/runs and their immutability guards."""
    op.execute("DROP TRIGGER IF EXISTS trg_goal_runs_immutable ON goal_runs")
    op.execute("DROP TRIGGER IF EXISTS trg_goal_results_no_update ON goal_results")
    op.execute("DROP FUNCTION IF EXISTS enforce_goal_run_immutability()")
    op.execute("DROP FUNCTION IF EXISTS reject_goal_result_update()")
    op.drop_table("goal_results")
    op.drop_index("ix_goal_runs_claimable", table_name="goal_runs")
    op.drop_table("goal_runs")
    sa.Enum(name="goal_result_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="goal_run_status_enum").drop(op.get_bind(), checkfirst=True)
