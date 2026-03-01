"""initial tables: users, user_profiles, sessions, transcripts

Revision ID: 8a4b33719582
Revises:
Create Date: 2026-03-01 20:30:05.754264

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8a4b33719582"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """创建初始表结构。"""
    # 清理数据库中可能存在的旧表和类型（之前开发遗留）
    op.execute("DROP TABLE IF EXISTS pronunciation_assessments CASCADE")
    op.execute("DROP TABLE IF EXISTS grammar_errors CASCADE")
    op.execute("DROP TABLE IF EXISTS knowledge_states CASCADE")
    op.execute("DROP TABLE IF EXISTS skills CASCADE")
    op.execute("DROP TYPE IF EXISTS subscription_tier_enum CASCADE")
    op.execute("DROP TYPE IF EXISTS session_mode_enum CASCADE")
    op.execute("DROP TYPE IF EXISTS session_status_enum CASCADE")
    op.execute("DROP TYPE IF EXISTS tier_used_enum CASCADE")
    op.execute("DROP TYPE IF EXISTS transcript_role_enum CASCADE")

    # 创建 users 表
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column(
            "subscription_tier",
            sa.Enum("free", "pro", "premium", name="subscription_tier_enum"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    # 创建 sessions 表
    op.create_table(
        "sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "mode",
            sa.Enum(
                "pronunciation",
                "free_talk",
                "conversation",
                "scenario",
                "exam_prep",
                name="session_mode_enum",
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("active", "completed", "cancelled", name="session_status_enum"),
            nullable=False,
        ),
        sa.Column("scenario_id", sa.Integer(), nullable=True),
        sa.Column(
            "tier_used",
            sa.Enum("free", "pro", "premium", name="tier_used_enum"),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # 创建 user_profiles 表
    op.create_table(
        "user_profiles",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("native_language", sa.String(length=10), nullable=True),
        sa.Column("target_level", sa.String(length=20), nullable=True),
        sa.Column("learning_goals", sa.ARRAY(sa.Text()), nullable=True),
        sa.Column("total_practice_minutes", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )

    # 创建 transcripts 表
    op.create_table(
        "transcripts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("user", "assistant", name="transcript_role_enum"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("audio_url", sa.String(length=500), nullable=True),
        sa.Column("timestamp_ms", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """删除所有表。"""
    op.drop_table("transcripts")
    op.drop_table("user_profiles")
    op.drop_table("sessions")
    op.drop_table("users")
