"""add the singleton learning-event cutover control row

Revision ID: b1_learning_event_cutover
Revises: b1_learning_events
Create Date: 2026-11-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1_learning_event_cutover"
down_revision: Union[str, Sequence[str], None] = "b1_learning_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the singleton maintenance and event-gate state."""
    op.create_table(
        "learning_event_cutover",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("revision", sa.String(length=100), nullable=False),
        sa.Column("phase", sa.String(length=32), nullable=False),
        sa.Column("cutover_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "baseline_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("baseline_digest", sa.String(length=64), nullable=True),
        sa.CheckConstraint(
            "baseline_count >= 0",
            name="ck_learning_event_cutover_baseline_count",
        ),
        sa.CheckConstraint(
            "id = 1",
            name="ck_learning_event_cutover_singleton",
        ),
        sa.CheckConstraint(
            "phase IN ('prepared','legacy_writes_stopped','baselines_written',"
            "'events_enabled','traffic_resumed')",
            name="ck_learning_event_cutover_phase",
        ),
        sa.CheckConstraint(
            """(phase IN ('prepared','legacy_writes_stopped')
            AND cutover_at IS NULL AND baseline_count = 0
            AND baseline_digest IS NULL)
            OR
            (phase IN ('baselines_written','events_enabled','traffic_resumed')
            AND cutover_at IS NOT NULL
            AND baseline_digest IS NOT NULL
            AND baseline_digest ~ '^[0-9a-f]{64}$')""",
            name="ck_learning_event_cutover_phase_shape",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "revision",
            name="uq_learning_event_cutover_revision",
        ),
    )


def downgrade() -> None:
    """Drop the cutover control state."""
    op.drop_table("learning_event_cutover")
