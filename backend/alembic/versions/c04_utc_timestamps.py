"""convert seven timestamp columns to timezone-aware UTC

Revision ID: c04_utc_timestamps
Revises: c03_call_leases
Create Date: 2026-10-25 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c04_utc_timestamps"
down_revision: Union[str, Sequence[str], None] = "c03_call_leases"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table_name, column_name, nullable)
TARGET_COLUMNS: tuple[tuple[str, str, bool], ...] = (
    ("users", "created_at", False),
    ("sessions", "started_at", False),
    ("sessions", "ended_at", True),
    ("user_settings", "updated_at", False),
    ("knowledge_states", "updated_at", False),
    ("pronunciation_assessments", "created_at", False),
    ("grammar_errors", "created_at", False),
)


def upgrade() -> None:
    """Upgrade schema: alter seven timestamp columns to timestamptz (UTC)."""
    for table_name, column_name, is_nullable in TARGET_COLUMNS:
        op.alter_column(
            table_name,
            column_name,
            type_=sa.DateTime(timezone=True),
            existing_type=sa.DateTime(timezone=False),
            nullable=is_nullable,
            existing_nullable=is_nullable,
            postgresql_using=f"{column_name} AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    """Downgrade schema: alter seven timestamptz columns back to naive timestamp."""
    for table_name, column_name, is_nullable in TARGET_COLUMNS:
        op.alter_column(
            table_name,
            column_name,
            type_=sa.DateTime(timezone=False),
            existing_type=sa.DateTime(timezone=True),
            nullable=is_nullable,
            existing_nullable=is_nullable,
            postgresql_using=f"{column_name} AT TIME ZONE 'UTC'",
        )
