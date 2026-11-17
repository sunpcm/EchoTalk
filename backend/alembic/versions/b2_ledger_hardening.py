"""harden the existing append-only learning event ledger

Revision ID: b2_ledger_hardening
Revises: b1_goal_evaluation
Create Date: 2026-11-17 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2_ledger_hardening"
down_revision: Union[str, Sequence[str], None] = "b1_goal_evaluation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_SHAPE_CHECK = (
    "(event_type = 'analysis_completed'"
    " AND session_id IS NOT NULL"
    " AND analysis_job_id IS NOT NULL"
    " AND source = 'analysis'"
    " AND pronunciation_assessment_id IS NULL"
    " AND grammar_error_id IS NULL"
    " AND skill_id IS NULL"
    " AND source_ordinal IS NULL"
    " AND observation_correct IS NULL"
    " AND observation_code IS NULL"
    " AND provider IS NULL"
    " AND model_version IS NULL"
    " AND confidence IS NULL"
    " AND is_synthetic IS NULL"
    " AND algorithm_version IS NOT NULL"
    " AND algorithm_params IS NOT NULL"
    " AND p_mastery_snapshot IS NULL"
    " AND cutover_revision IS NULL)"
    " OR (event_type = 'pronunciation_observation'"
    " AND session_id IS NOT NULL"
    " AND analysis_job_id IS NOT NULL"
    " AND pronunciation_assessment_id IS NOT NULL"
    " AND grammar_error_id IS NULL"
    " AND skill_id IS NOT NULL"
    " AND source_ordinal IS NOT NULL"
    " AND source_ordinal >= 0"
    " AND observation_correct IS NOT NULL"
    " AND observation_code IS NOT NULL"
    " AND observation_code <> ''"
    " AND model_version IS NOT NULL"
    " AND model_version <> ''"
    " AND is_synthetic IS NOT NULL"
    " AND algorithm_version IS NULL"
    " AND algorithm_params IS NULL"
    " AND p_mastery_snapshot IS NULL"
    " AND cutover_revision IS NULL)"
    " OR (event_type = 'grammar_observation'"
    " AND session_id IS NOT NULL"
    " AND analysis_job_id IS NOT NULL"
    " AND pronunciation_assessment_id IS NULL"
    " AND grammar_error_id IS NOT NULL"
    " AND skill_id IS NOT NULL"
    " AND source_ordinal IS NOT NULL"
    " AND source_ordinal >= 0"
    " AND observation_correct IS FALSE"
    " AND observation_code IS NOT NULL"
    " AND observation_code <> ''"
    " AND model_version IS NOT NULL"
    " AND model_version <> ''"
    " AND is_synthetic IS NOT NULL"
    " AND algorithm_version IS NULL"
    " AND algorithm_params IS NULL"
    " AND p_mastery_snapshot IS NULL"
    " AND cutover_revision IS NULL)"
    " OR (event_type = 'baseline_snapshot'"
    " AND session_id IS NULL"
    " AND analysis_job_id IS NULL"
    " AND pronunciation_assessment_id IS NULL"
    " AND grammar_error_id IS NULL"
    " AND skill_id IS NOT NULL"
    " AND source_ordinal IS NULL"
    " AND observation_correct IS NULL"
    " AND observation_code IS NULL"
    " AND provider IS NULL"
    " AND model_version IS NULL"
    " AND confidence IS NULL"
    " AND is_synthetic IS NULL"
    " AND algorithm_version IS NULL"
    " AND algorithm_params IS NULL"
    " AND source = 'legacy_unknown'"
    " AND p_mastery_snapshot IS NOT NULL"
    " AND cutover_revision IS NOT NULL)"
)

_ORIGINAL_SHAPE_CHECK = """
(event_type='analysis_completed' AND session_id IS NOT NULL
AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
AND grammar_error_id IS NULL AND skill_id IS NULL AND source_ordinal IS NULL
AND observation_correct IS NULL AND observation_code IS NULL AND provider IS NULL
AND model_version IS NULL AND confidence IS NULL AND is_synthetic IS NULL
AND algorithm_version IS NOT NULL AND algorithm_params IS NOT NULL
AND p_mastery_snapshot IS NULL AND cutover_revision IS NULL)
OR (event_type='pronunciation_observation' AND session_id IS NOT NULL
AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NOT NULL
AND grammar_error_id IS NULL AND skill_id IS NOT NULL
AND source_ordinal IS NOT NULL AND source_ordinal >= 0
AND observation_correct IS NOT NULL AND observation_code IS NOT NULL
AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL
AND cutover_revision IS NULL)
OR (event_type='grammar_observation' AND session_id IS NOT NULL
AND analysis_job_id IS NOT NULL AND pronunciation_assessment_id IS NULL
AND grammar_error_id IS NOT NULL AND skill_id IS NOT NULL
AND source_ordinal IS NOT NULL AND source_ordinal >= 0
AND observation_correct IS FALSE AND observation_code IS NOT NULL
AND is_synthetic IS NOT NULL AND algorithm_version IS NULL
AND algorithm_params IS NULL AND p_mastery_snapshot IS NULL
AND cutover_revision IS NULL)
OR (event_type='baseline_snapshot' AND session_id IS NULL
AND analysis_job_id IS NULL AND pronunciation_assessment_id IS NULL
AND grammar_error_id IS NULL AND skill_id IS NOT NULL AND source_ordinal IS NULL
AND observation_correct IS NULL AND observation_code IS NULL AND provider IS NULL
AND model_version IS NULL AND confidence IS NULL AND is_synthetic IS NULL
AND algorithm_version IS NULL AND algorithm_params IS NULL
AND source='legacy_unknown' AND p_mastery_snapshot IS NOT NULL
AND cutover_revision IS NOT NULL)
"""


def upgrade() -> None:
    """Harden the existing ledger without rewriting or backfilling rows."""
    op.drop_constraint(
        "ck_learning_events_shape",
        "learning_events",
        type_="check",
    )
    op.alter_column(
        "learning_events",
        "apply_seq",
        existing_type=sa.BigInteger(),
        existing_nullable=False,
        existing_server_default=sa.Identity(),
        server_default=sa.Identity(always=True),
    )
    op.create_check_constraint(
        "ck_learning_events_idempotency_key_not_empty",
        "learning_events",
        "idempotency_key <> ''",
    )
    op.create_check_constraint(
        "ck_learning_events_source_not_empty",
        "learning_events",
        "source <> ''",
    )
    op.create_check_constraint(
        "ck_learning_events_provider_null_or_not_empty",
        "learning_events",
        "provider IS NULL OR provider <> ''",
    )
    op.create_check_constraint(
        "ck_learning_events_details_shape",
        "learning_events",
        "(jsonb_typeof(details) = 'object'"
        " AND details->'schema_version' = '1'::jsonb) IS TRUE",
    )
    op.create_check_constraint(
        "ck_learning_events_algorithm_params_object",
        "learning_events",
        "(algorithm_params IS NULL"
        " OR jsonb_typeof(algorithm_params) = 'object') IS TRUE",
    )
    op.create_check_constraint(
        "ck_learning_events_shape",
        "learning_events",
        _SHAPE_CHECK,
    )


def downgrade() -> None:
    """Restore the B1 constraints and identity mode without touching rows."""
    op.drop_constraint(
        "ck_learning_events_shape",
        "learning_events",
        type_="check",
    )
    for constraint_name in (
        "ck_learning_events_algorithm_params_object",
        "ck_learning_events_details_shape",
        "ck_learning_events_provider_null_or_not_empty",
        "ck_learning_events_source_not_empty",
        "ck_learning_events_idempotency_key_not_empty",
    ):
        op.drop_constraint(
            constraint_name,
            "learning_events",
            type_="check",
        )
    op.alter_column(
        "learning_events",
        "apply_seq",
        existing_type=sa.BigInteger(),
        existing_nullable=False,
        existing_server_default=sa.Identity(always=True),
        server_default=sa.Identity(),
    )
    op.create_check_constraint(
        "ck_learning_events_shape",
        "learning_events",
        _ORIGINAL_SHAPE_CHECK,
    )
