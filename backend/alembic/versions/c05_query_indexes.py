"""add three essential query indexes for sessions, transcripts, and grammar_errors

Revision ID: c05_query_indexes
Revises: c04_utc_timestamps
Create Date: 2026-10-25 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c05_query_indexes"
down_revision: Union[str, Sequence[str], None] = "c04_utc_timestamps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create three essential query indexes."""
    op.create_index(
        "ix_sessions_user_started_id",
        "sessions",
        ["user_id", sa.text("started_at DESC"), sa.text("id DESC")],
        unique=False,
    )
    op.create_index(
        "ix_transcripts_session_timestamp",
        "transcripts",
        ["session_id", "timestamp_ms"],
        unique=False,
    )
    op.create_index(
        "ix_grammar_errors_session_created",
        "grammar_errors",
        ["session_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    """Drop the three query indexes in reverse order."""
    op.drop_index("ix_grammar_errors_session_created", table_name="grammar_errors")
    op.drop_index("ix_transcripts_session_timestamp", table_name="transcripts")
    op.drop_index("ix_sessions_user_started_id", table_name="sessions")
