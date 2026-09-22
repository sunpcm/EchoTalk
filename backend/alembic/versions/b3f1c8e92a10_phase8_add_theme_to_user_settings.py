"""phase8_add_theme_to_user_settings

Revision ID: b3f1c8e92a10
Revises: b6d7e8f901a2
Create Date: 2026-09-04 03:15:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b3f1c8e92a10"
down_revision: Union[str, Sequence[str], None] = "b6d7e8f901a2"
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
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_user_settings_theme",
        "user_settings",
        "theme IN ('warm', 'cool', 'dark')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "ck_user_settings_theme",
        "user_settings",
        type_="check",
    )
    op.drop_column("user_settings", "theme")
