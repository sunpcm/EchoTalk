"""create call_leases table

Revision ID: c03_call_leases
Revises: c02_create_idempotency
Create Date: 2026-10-21 16:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c03_call_leases"
down_revision: Union[str, Sequence[str], None] = "c02_create_idempotency"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: create call_leases table with PK/FK/checks."""
    op.create_table(
        "call_leases",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "generation",
            sa.BigInteger(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "state",
            sa.String(length=16),
            server_default="free",
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.CheckConstraint(
            "generation >= 0",
            name="ck_call_leases_generation_non_negative",
        ),
        sa.CheckConstraint(
            "state IN ('held', 'free')",
            name="ck_call_leases_state",
        ),
    )


def downgrade() -> None:
    """Downgrade schema: drop call_leases table."""
    op.drop_table("call_leases")
