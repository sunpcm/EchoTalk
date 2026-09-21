"""add assessment provenance

Revision ID: a5c6d7e8f901
Revises: f4b5c6d7e8f9
Create Date: 2026-09-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a5c6d7e8f901"
down_revision: Union[str, Sequence[str], None] = "f4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mark legacy rule-based results synthetic and require provenance going forward."""
    op.add_column(
        "pronunciation_assessments",
        sa.Column("source", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "pronunciation_assessments",
        sa.Column("provider", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "pronunciation_assessments",
        sa.Column("model_version", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "pronunciation_assessments",
        sa.Column("is_synthetic", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "pronunciation_assessments",
        sa.Column("confidence", sa.Float(), nullable=True),
    )
    op.add_column(
        "pronunciation_assessments",
        sa.Column("provider_response_ref", sa.String(length=500), nullable=True),
    )
    op.execute(
        """
        UPDATE pronunciation_assessments
        SET source = 'legacy_mock', is_synthetic = TRUE, confidence = 0
        """
    )
    op.alter_column("pronunciation_assessments", "source", nullable=False)
    op.alter_column("pronunciation_assessments", "is_synthetic", nullable=False)
    op.create_check_constraint(
        "ck_pronunciation_assessments_confidence",
        "pronunciation_assessments",
        "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
    )
    op.create_index(
        "ix_pronunciation_assessments_real_created_at",
        "pronunciation_assessments",
        ["created_at"],
        postgresql_where=sa.text("is_synthetic = false"),
    )

    op.add_column(
        "grammar_errors", sa.Column("source", sa.String(length=50), nullable=True)
    )
    op.add_column(
        "grammar_errors", sa.Column("provider", sa.String(length=50), nullable=True)
    )
    op.add_column(
        "grammar_errors",
        sa.Column("model_version", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "grammar_errors", sa.Column("is_synthetic", sa.Boolean(), nullable=True)
    )
    op.add_column("grammar_errors", sa.Column("confidence", sa.Float(), nullable=True))
    op.execute(
        """
        UPDATE grammar_errors
        SET source = 'legacy_rule', is_synthetic = TRUE, confidence = 0
        """
    )
    op.alter_column("grammar_errors", "source", nullable=False)
    op.alter_column("grammar_errors", "is_synthetic", nullable=False)
    op.create_check_constraint(
        "ck_grammar_errors_confidence",
        "grammar_errors",
        "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
    )
    op.create_index(
        "ix_grammar_errors_real_session_id",
        "grammar_errors",
        ["session_id"],
        postgresql_where=sa.text("is_synthetic = false"),
    )


def downgrade() -> None:
    """Remove provenance columns without altering assessment result rows."""
    op.drop_index("ix_grammar_errors_real_session_id", table_name="grammar_errors")
    op.drop_constraint(
        "ck_grammar_errors_confidence", "grammar_errors", type_="check"
    )
    op.drop_column("grammar_errors", "confidence")
    op.drop_column("grammar_errors", "is_synthetic")
    op.drop_column("grammar_errors", "model_version")
    op.drop_column("grammar_errors", "provider")
    op.drop_column("grammar_errors", "source")

    op.drop_index(
        "ix_pronunciation_assessments_real_created_at",
        table_name="pronunciation_assessments",
    )
    op.drop_constraint(
        "ck_pronunciation_assessments_confidence",
        "pronunciation_assessments",
        type_="check",
    )
    op.drop_column("pronunciation_assessments", "provider_response_ref")
    op.drop_column("pronunciation_assessments", "confidence")
    op.drop_column("pronunciation_assessments", "is_synthetic")
    op.drop_column("pronunciation_assessments", "model_version")
    op.drop_column("pronunciation_assessments", "provider")
    op.drop_column("pronunciation_assessments", "source")
