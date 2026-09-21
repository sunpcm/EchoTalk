"""add persistent analysis jobs

Revision ID: f4b5c6d7e8f9
Revises: 91e80e32b8c6
Create Date: 2026-09-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f4b5c6d7e8f9"
down_revision: Union[str, Sequence[str], None] = "91e80e32b8c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create durable jobs and reject pre-existing duplicate assessments."""
    # Deliberately do not delete or merge historical rows here. If duplicates
    # exist, this constraint fails loudly so they can be reviewed without data loss.
    op.create_unique_constraint(
        "uq_pronunciation_assessments_session_id",
        "pronunciation_assessments",
        ["session_id"],
    )

    status_enum = postgresql.ENUM(
        "pending",
        "running",
        "succeeded",
        "failed",
        name="analysis_job_status_enum",
        create_type=False,
    )
    postgresql.ENUM(
        "pending", "running", "succeeded", "failed", name="analysis_job_status_enum"
    ).create(op.get_bind(), checkfirst=True)
    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("status", status_enum, nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", name="uq_analysis_jobs_session_id"),
    )
    op.create_index(
        "ix_analysis_jobs_claimable",
        "analysis_jobs",
        ["status", "next_retry_at", "created_at"],
    )
    # Backfill without rewriting historical results: sessions that already have
    # an assessment are terminal; other completed sessions become recoverable work.
    op.execute(
        """
        INSERT INTO analysis_jobs (
            id,
            session_id,
            status,
            attempt_count,
            started_at,
            finished_at,
            created_at,
            updated_at
        )
        SELECT
            gen_random_uuid(),
            sessions.id,
            CASE
                WHEN pronunciation_assessments.id IS NULL
                    THEN 'pending'::analysis_job_status_enum
                ELSE 'succeeded'::analysis_job_status_enum
            END,
            CASE WHEN pronunciation_assessments.id IS NULL THEN 0 ELSE 1 END,
            pronunciation_assessments.created_at AT TIME ZONE 'UTC',
            pronunciation_assessments.created_at AT TIME ZONE 'UTC',
            COALESCE(sessions.ended_at, sessions.started_at) AT TIME ZONE 'UTC',
            NOW()
        FROM sessions
        LEFT JOIN pronunciation_assessments
            ON pronunciation_assessments.session_id = sessions.id
        WHERE sessions.status = 'completed'
        """
    )


def downgrade() -> None:
    """Remove analysis jobs and the assessment uniqueness constraint."""
    op.drop_index("ix_analysis_jobs_claimable", table_name="analysis_jobs")
    op.drop_table("analysis_jobs")
    sa.Enum(name="analysis_job_status_enum").drop(op.get_bind(), checkfirst=True)
    op.drop_constraint(
        "uq_pronunciation_assessments_session_id",
        "pronunciation_assessments",
        type_="unique",
    )
