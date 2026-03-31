"""phase7_add_doc_chat_mode_and_session_contexts

Revision ID: 91e80e32b8c6
Revises: 20a8c7f2bc2f
Create Date: 2026-03-31 19:50:16.544589

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "91e80e32b8c6"
down_revision: Union[str, Sequence[str], None] = "20a8c7f2bc2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. 必须在事务块外部执行 ENUM 更新
    # PostgreSQL 不允许在事务块内执行 ALTER TYPE ... ADD VALUE
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE session_mode_enum ADD VALUE IF NOT EXISTS 'doc_chat'")

    # 2. 创建 session_contexts 表
    op.create_table(
        "session_contexts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("custom_prompt", sa.Text(), nullable=True),
        sa.Column("document_content", sa.Text(), nullable=True),
        sa.Column("content_type", sa.String(length=50), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("session_contexts")
    # 注意: PostgreSQL 不支持 ALTER TYPE ... REMOVE VALUE，
    # 需要重建 enum 类型才能移除值。MVP 阶段仅 drop 表即可。
