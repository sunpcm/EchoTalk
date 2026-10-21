"""add session create idempotency columns

Revision ID: c02_create_idempotency
Revises: b3f1c8e92a10
Create Date: 2026-10-21 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c02_create_idempotency"
down_revision: Union[str, Sequence[str], None] = "b3f1c8e92a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: add request_idempotency_key, request_fingerprint, and unique constraint."""
    op.add_column(
        "sessions",
        sa.Column(
            "request_idempotency_key",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "sessions",
        sa.Column(
            "request_fingerprint",
            sa.String(length=64),
            nullable=True,
        ),
    )
    op.create_unique_constraint(
        "uq_sessions_user_idempotency_key",
        "sessions",
        ["user_id", "request_idempotency_key"],
    )


def downgrade() -> None:
    """Downgrade schema: remove unique constraint and idempotency columns."""
    op.drop_constraint(
        "uq_sessions_user_idempotency_key",
        "sessions",
        type_="unique",
    )
    op.drop_column("sessions", "request_fingerprint")
    op.drop_column("sessions", "request_idempotency_key")
