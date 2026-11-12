"""add append-only learning event ledger

Revision ID: b1_learning_events
Revises: c06_transcript_events
Create Date: 2026-11-12 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b1_learning_events"
down_revision: Union[str, Sequence[str], None] = "c06_transcript_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the append-only learning event ledger."""
    op.create_table(
        "learning_events",
        sa.Column("apply_seq", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=200), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "analysis_job_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "pronunciation_assessment_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "grammar_error_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("skill_id", sa.String(length=50), nullable=True),
        sa.Column("source_ordinal", sa.Integer(), nullable=True),
        sa.Column("observation_correct", sa.Boolean(), nullable=True),
        sa.Column("observation_code", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=True),
        sa.Column("model_version", sa.String(length=100), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("is_synthetic", sa.Boolean(), nullable=True),
        sa.Column("algorithm_version", sa.String(length=64), nullable=True),
        sa.Column("algorithm_params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("p_mastery_snapshot", sa.Float(), nullable=True),
        sa.Column("cutover_revision", sa.String(length=100), nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("""'{"schema_version": 1}'::jsonb"""),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('analysis_completed','pronunciation_observation',"
            "'grammar_observation','baseline_snapshot')",
            name="ck_learning_events_type",
        ),
        sa.CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name="ck_learning_events_confidence",
        ),
        sa.CheckConstraint(
            "p_mastery_snapshot IS NULL OR p_mastery_snapshot BETWEEN 0 AND 1",
            name="ck_learning_events_snapshot",
        ),
        sa.CheckConstraint(
            """(event_type='analysis_completed' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NULL AND skill_id IS NULL AND source_ordinal IS NULL
            AND observation_correct IS NULL AND observation_code IS NULL AND provider IS NULL
            AND model_version IS NULL AND confidence IS NULL AND is_synthetic IS NULL
            AND algorithm_version IS NOT NULL AND algorithm_params IS NOT NULL
            AND p_mastery_snapshot IS NULL AND cutover_revision IS NULL)
            OR (event_type='pronunciation_observation' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NOT NULL
            AND grammar_error_id IS NULL AND skill_id IS NOT NULL
            AND source_ordinal IS NOT NULL AND source_ordinal >= 0
            AND observation_correct IS NOT NULL AND observation_code IS NOT NULL
            AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
            AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL
            AND cutover_revision IS NULL)
            OR (event_type='grammar_observation' AND session_id IS NOT NULL
            AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NOT NULL AND skill_id IS NOT NULL
            AND source_ordinal IS NOT NULL AND source_ordinal >= 0
            AND observation_correct IS FALSE AND observation_code IS NOT NULL
            AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
            AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL
            AND cutover_revision IS NULL)
            OR (event_type='baseline_snapshot' AND session_id IS NULL
            AND analysis_job_id IS NULL AND pronunciation_assessment_id IS NULL
            AND grammar_error_id IS NULL AND skill_id IS NOT NULL AND source_ordinal IS NULL
            AND observation_correct IS NULL AND observation_code IS NULL AND provider IS NULL
            AND model_version IS NULL AND confidence IS NULL AND is_synthetic IS NULL
            AND algorithm_version IS NULL AND algorithm_params IS NULL
            AND source='legacy_unknown' AND p_mastery_snapshot IS NOT NULL
            AND cutover_revision IS NOT NULL)""",
            name="ck_learning_events_shape",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["analysis_job_id"],
            ["analysis_jobs.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["pronunciation_assessment_id"],
            ["pronunciation_assessments.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["grammar_error_id"],
            ["grammar_errors.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["skill_id"],
            ["skills.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("apply_seq"),
        sa.UniqueConstraint(
            "idempotency_key",
            name="uq_learning_events_idempotency_key",
        ),
    )
    op.create_index(
        "ix_learning_events_user_seq",
        "learning_events",
        ["user_id", "apply_seq"],
    )
    op.create_index(
        "ix_learning_events_user_skill_seq",
        "learning_events",
        ["user_id", "skill_id", "apply_seq"],
        postgresql_where=sa.text(
            "event_type IN ('pronunciation_observation','grammar_observation')"
        ),
    )
    op.create_index(
        "ix_learning_events_session_seq",
        "learning_events",
        ["session_id", "apply_seq"],
    )
    op.create_index(
        "uq_learning_events_completed_job",
        "learning_events",
        ["analysis_job_id"],
        unique=True,
        postgresql_where=sa.text("event_type='analysis_completed'"),
    )


def downgrade() -> None:
    """Drop the learning event ledger and its indexes."""
    op.drop_table("learning_events")
