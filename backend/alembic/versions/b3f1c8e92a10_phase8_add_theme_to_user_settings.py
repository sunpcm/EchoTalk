"""phase8_add_theme_to_user_settings

Revision ID: b3f1c8e92a10
Revises: 91e80e32b8c6
Create Date: 2026-09-04 03:15:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b3f1c8e92a10"
down_revision: Union[str, Sequence[str], None] = "91e80e32b8c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_settings",
        sa.Column(
            "theme",
            sa.String(length=20),
            server_default="warm",
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_settings", "theme")
