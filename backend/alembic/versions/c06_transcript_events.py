"""add event_id and unique constraint to transcripts for idempotent events

Revision ID: c06_transcript_events
Revises: c05_query_indexes
Create Date: 2026-10-25 18:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c06_transcript_events"
down_revision: Union[str, Sequence[str], None] = "c05_query_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add nullable event_id column and unique constraint to transcripts."""
    op.add_column(
        "transcripts",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_unique_constraint(
        "uq_transcripts_session_event",
        "transcripts",
        ["session_id", "event_id"],
    )


def downgrade() -> None:
    """Drop unique constraint and event_id column from transcripts."""
    op.drop_constraint(
        "uq_transcripts_session_event",
        "transcripts",
        type_="unique",
    )
    op.drop_column("transcripts", "event_id")
