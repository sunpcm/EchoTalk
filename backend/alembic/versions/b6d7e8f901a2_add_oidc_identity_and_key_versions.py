"""add OIDC identity and credential key versions

Revision ID: b6d7e8f901a2
Revises: a5c6d7e8f901
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b6d7e8f901a2"
down_revision: Union[str, Sequence[str], None] = "a5c6d7e8f901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LEGACY_VERSION = "legacy-jwt-derived-v1"


def upgrade() -> None:
    op.add_column("users", sa.Column("auth_issuer", sa.String(500), nullable=True))
    op.add_column("users", sa.Column("auth_subject", sa.String(500), nullable=True))
    op.create_unique_constraint(
        "uq_users_auth_identity", "users", ["auth_issuer", "auth_subject"]
    )

    for prefix in ("stt", "llm", "tts"):
        op.add_column(
            "user_settings",
            sa.Column(f"{prefix}_key_version", sa.String(100), nullable=True),
        )
        op.execute(
            sa.text(
                f"UPDATE user_settings SET {prefix}_key_version = :version "
                f"WHERE encrypted_{prefix}_key IS NOT NULL"
            ).bindparams(version=LEGACY_VERSION)
        )


def downgrade() -> None:
    for prefix in ("tts", "llm", "stt"):
        op.drop_column("user_settings", f"{prefix}_key_version")
    op.drop_constraint("uq_users_auth_identity", "users", type_="unique")
    op.drop_column("users", "auth_subject")
    op.drop_column("users", "auth_issuer")
