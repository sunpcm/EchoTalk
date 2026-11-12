"""RED schema gate for the B1-1 learning event ledger."""

import os
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import UniqueConstraint, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

import models
from models import Base
from models.analysis import AnalysisJob
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import Skill
from models.session import Session
from models.user import User


def test_learning_event_orm_registered():
    assert hasattr(models, "LearningEvent"), "LearningEvent is not exported"

    learning_event = models.LearningEvent
    table = learning_event.__table__
    assert table is Base.metadata.tables.get("learning_events")
    assert set(table.columns.keys()) == {
        "apply_seq",
        "idempotency_key",
        "event_type",
        "user_id",
        "session_id",
        "analysis_job_id",
        "pronunciation_assessment_id",
        "grammar_error_id",
        "skill_id",
        "source_ordinal",
        "observation_correct",
        "observation_code",
        "source",
        "provider",
        "model_version",
        "confidence",
        "is_synthetic",
        "algorithm_version",
        "algorithm_params",
        "p_mastery_snapshot",
        "cutover_revision",
        "occurred_at",
        "recorded_at",
        "details",
    }
    assert table.columns["apply_seq"].primary_key
    assert table.columns["apply_seq"].identity is not None
    unique_constraints = {
        constraint.name: tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert unique_constraints == {
        "uq_learning_events_idempotency_key": ("idempotency_key",)
    }


def test_learning_event_migration_lineage():
    backend_root = Path(__file__).resolve().parents[1]
    script = ScriptDirectory(str(backend_root / "alembic"))
    revisions = {revision.revision: revision for revision in script.walk_revisions()}

    assert "b1_learning_events" in revisions
    learning_events = revisions["b1_learning_events"]
    assert learning_events.down_revision == "c06_transcript_events"
    assert any(
        revision.down_revision == "b1_learning_events"
        for revision in revisions.values()
    ) or set(script.get_heads()) == {"b1_learning_events"}


def require_b1_database_url():
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail("B1 PostgreSQL tests require explicit DATABASE_URL", pytrace=False)

    try:
        parsed = make_url(raw)
        target = (parsed.host, parsed.port, parsed.database)
        valid = (
            parsed.drivername in {"postgresql", "postgresql+asyncpg"}
            and target
            in {
                ("127.0.0.1", 55433, "echotalk_b1_test"),
                ("localhost", 5432, "echotalk_test"),
            }
            and bool(parsed.username and parsed.username.strip())
            and not parsed.query
        )
    except Exception:
        pytest.fail("B1 PostgreSQL test DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail("B1 PostgreSQL test database boundary mismatch", pytrace=False)
    return parsed.set(drivername="postgresql+asyncpg")


@pytest.mark.asyncio
async def test_postgres_learning_events_schema():
    database_url = require_b1_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        async with engine.connect() as connection:
            identity = (
                await connection.execute(
                    text(
                        "SELECT current_database(), current_user, "
                        "current_setting('server_version_num')"
                    )
                )
            ).one()
            assert identity == (
                database_url.database,
                database_url.username,
                "150019",
            )
            assert (
                await connection.scalar(text("SELECT to_regclass('learning_events')"))
                is not None
            ), "learning_events table is absent"

            columns = {
                row.column_name: (
                    row.data_type,
                    row.character_maximum_length,
                    row.is_nullable,
                    row.is_identity,
                )
                for row in await connection.execute(
                    text(
                        "SELECT column_name, data_type, character_maximum_length, "
                        "is_nullable, is_identity "
                        "FROM information_schema.columns "
                        "WHERE table_schema = current_schema() "
                        "AND table_name = 'learning_events'"
                    )
                )
            }
            expected_columns = {
                "apply_seq": ("bigint", None, "NO", "YES"),
                "idempotency_key": ("character varying", 200, "NO", "NO"),
                "event_type": ("character varying", 32, "NO", "NO"),
                "user_id": ("uuid", None, "NO", "NO"),
                "session_id": ("uuid", None, "YES", "NO"),
                "analysis_job_id": ("uuid", None, "YES", "NO"),
                "pronunciation_assessment_id": ("uuid", None, "YES", "NO"),
                "grammar_error_id": ("uuid", None, "YES", "NO"),
                "skill_id": ("character varying", 50, "YES", "NO"),
                "source_ordinal": ("integer", None, "YES", "NO"),
                "observation_correct": ("boolean", None, "YES", "NO"),
                "observation_code": ("character varying", 64, "YES", "NO"),
                "source": ("character varying", 50, "NO", "NO"),
                "provider": ("character varying", 50, "YES", "NO"),
                "model_version": ("character varying", 100, "YES", "NO"),
                "confidence": ("double precision", None, "YES", "NO"),
                "is_synthetic": ("boolean", None, "YES", "NO"),
                "algorithm_version": ("character varying", 64, "YES", "NO"),
                "algorithm_params": ("jsonb", None, "YES", "NO"),
                "p_mastery_snapshot": ("double precision", None, "YES", "NO"),
                "cutover_revision": ("character varying", 100, "YES", "NO"),
                "occurred_at": ("timestamp with time zone", None, "NO", "NO"),
                "recorded_at": ("timestamp with time zone", None, "NO", "NO"),
                "details": ("jsonb", None, "NO", "NO"),
            }
            assert columns == expected_columns

            constraints = {
                row.conname: row.contype
                for row in await connection.execute(
                    text(
                        "SELECT conname, contype::text AS contype FROM pg_constraint "
                        "WHERE conrelid = 'learning_events'::regclass"
                    )
                )
            }
            assert constraints["learning_events_pkey"] == "p"
            assert constraints["uq_learning_events_idempotency_key"] == "u"
            assert constraints["ck_learning_events_type"] == "c"
            assert constraints["ck_learning_events_confidence"] == "c"
            assert constraints["ck_learning_events_snapshot"] == "c"
            assert constraints["ck_learning_events_shape"] == "c"

            foreign_keys = {
                row.column_name: (row.ref_table, row.ref_column, row.delete_rule)
                for row in await connection.execute(
                    text(
                        "SELECT src.attname AS column_name, ref.relname AS ref_table, "
                        "ref_col.attname AS ref_column, "
                        "cons.confdeltype::text AS delete_rule "
                        "FROM pg_constraint cons "
                        "JOIN LATERAL unnest(cons.conkey, cons.confkey) "
                        "WITH ORDINALITY AS keys(src_attnum, ref_attnum, ordinality) "
                        "ON TRUE "
                        "JOIN pg_class src_class ON src_class.oid = cons.conrelid "
                        "JOIN pg_attribute src ON src.attrelid = src_class.oid "
                        "AND src.attnum = keys.src_attnum "
                        "JOIN pg_class ref ON ref.oid = cons.confrelid "
                        "JOIN pg_attribute ref_col ON ref_col.attrelid = ref.oid "
                        "AND ref_col.attnum = keys.ref_attnum "
                        "WHERE cons.conrelid = 'learning_events'::regclass "
                        "AND cons.contype = 'f'"
                    )
                )
            }
            assert foreign_keys == {
                "user_id": ("users", "id", "r"),
                "session_id": ("sessions", "id", "r"),
                "analysis_job_id": ("analysis_jobs", "id", "r"),
                "pronunciation_assessment_id": (
                    "pronunciation_assessments",
                    "id",
                    "r",
                ),
                "grammar_error_id": ("grammar_errors", "id", "r"),
                "skill_id": ("skills", "id", "r"),
            }

            indexes = {
                row.index_name: (row.is_unique, row.predicate)
                for row in await connection.execute(
                    text(
                        "SELECT idx.relname AS index_name, ix.indisunique AS is_unique, "
                        "pg_get_expr(ix.indpred, ix.indrelid) AS predicate "
                        "FROM pg_index ix JOIN pg_class idx ON idx.oid = ix.indexrelid "
                        "WHERE ix.indrelid = 'learning_events'::regclass"
                    )
                )
            }
            assert indexes["ix_learning_events_user_seq"][0] is False
            assert indexes["ix_learning_events_user_seq"][1] is None
            assert indexes["ix_learning_events_user_skill_seq"][0] is False
            user_skill_predicate = indexes["ix_learning_events_user_skill_seq"][1]
            assert user_skill_predicate is not None
            assert "pronunciation_observation" in user_skill_predicate
            assert "grammar_observation" in user_skill_predicate
            assert indexes["ix_learning_events_session_seq"][0] is False
            assert indexes["ix_learning_events_session_seq"][1] is None
            assert indexes["uq_learning_events_completed_job"][0] is True
            completed_predicate = indexes["uq_learning_events_completed_job"][1]
            assert completed_predicate is not None
            assert "analysis_completed" in completed_predicate
    finally:
        await engine.dispose()


def learning_event_values(event_type, idempotency_key, **overrides):
    values = {
        "idempotency_key": idempotency_key,
        "event_type": event_type,
        "source": "analysis",
        "occurred_at": datetime(2026, 11, 12, tzinfo=UTC),
    }
    if event_type == "analysis_completed":
        values.update(
            {
                "session_id": learning_event_values.session_id,
                "analysis_job_id": learning_event_values.job_id,
                "algorithm_version": "bkt-v1",
                "algorithm_params": {
                    "p_init": 0.1,
                    "p_transit": 0.2,
                    "p_slip": 0.1,
                    "p_guess": 0.2,
                },
            }
        )
    elif event_type == "pronunciation_observation":
        values.update(
            {
                "session_id": learning_event_values.session_id,
                "analysis_job_id": learning_event_values.job_id,
                "pronunciation_assessment_id": (
                    learning_event_values.pronunciation_assessment_id
                ),
                "skill_id": learning_event_values.skill_id,
                "source_ordinal": 0,
                "observation_correct": False,
                "observation_code": "th_substitution",
                "provider": "demo",
                "model_version": None,
                "confidence": 0.5,
                "is_synthetic": True,
                "algorithm_params": None,
            }
        )
    elif event_type == "grammar_observation":
        values.update(
            {
                "session_id": learning_event_values.session_id,
                "analysis_job_id": learning_event_values.job_id,
                "grammar_error_id": learning_event_values.grammar_error_id,
                "skill_id": learning_event_values.skill_id,
                "source_ordinal": 0,
                "observation_correct": False,
                "observation_code": "verb_tense_past",
                "provider": "demo",
                "model_version": None,
                "confidence": 0.5,
                "is_synthetic": True,
                "algorithm_params": None,
            }
        )
    elif event_type == "baseline_snapshot":
        values.update(
            {
                "skill_id": learning_event_values.skill_id,
                "source": "legacy_unknown",
                "p_mastery_snapshot": 0.2,
                "cutover_revision": "b1-cutover-test",
            }
        )
    values.update(overrides)
    return values


@asynccontextmanager
async def expect_integrity_error(connection, expected_fragments):
    if isinstance(expected_fragments, str):
        expected_fragments = (expected_fragments,)
    nested = await connection.begin_nested()
    try:
        yield
    except IntegrityError as error:
        await nested.rollback()
        diagnostic = getattr(error.orig, "diag", None)
        constraint_name = getattr(diagnostic, "constraint_name", None)
        message = f"{error.orig} {constraint_name or ''}"
        assert any(fragment in message for fragment in expected_fragments)
    else:
        await nested.rollback()
        raise AssertionError(
            f"expected IntegrityError containing one of {expected_fragments}"
        )


@pytest.mark.asyncio
async def test_postgres_learning_events_constraints():
    database_url = require_b1_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    now = datetime(2026, 11, 12, tzinfo=UTC)
    suffix = uuid.uuid4().hex
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    job_id = uuid.uuid4()
    pronunciation_id = uuid.uuid4()
    grammar_id = uuid.uuid4()
    skill_id = f"skill-{suffix}"[:50]
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                identity = (
                    await connection.execute(
                        text(
                            "SELECT current_database(), current_user, "
                            "current_setting('server_version_num')"
                        )
                    )
                ).one()
                assert identity == (
                    database_url.database,
                    database_url.username,
                    "150019",
                )
                learning_events = Base.metadata.tables.get("learning_events")
                assert learning_events is not None, (
                    "learning_events ORM table is absent"
                )

                learning_event_values.session_id = session_id
                learning_event_values.job_id = job_id
                learning_event_values.pronunciation_assessment_id = pronunciation_id
                learning_event_values.grammar_error_id = grammar_id
                learning_event_values.skill_id = skill_id

                await connection.execute(
                    User.__table__.insert().values(
                        id=user_id,
                        email=f"b1-schema-{suffix}@example.invalid",
                        created_at=now,
                    )
                )
                await connection.execute(
                    Skill.__table__.insert().values(
                        id=skill_id,
                        name=f"B1 test {suffix}",
                        category="grammar",
                    )
                )
                await connection.execute(
                    Session.__table__.insert().values(
                        id=session_id,
                        user_id=user_id,
                        mode="pronunciation",
                        status="completed",
                        started_at=now,
                        ended_at=now,
                    )
                )
                await connection.execute(
                    AnalysisJob.__table__.insert().values(
                        id=job_id,
                        session_id=session_id,
                        status="pending",
                        attempt_count=0,
                        created_at=now,
                        updated_at=now,
                    )
                )
                await connection.execute(
                    PronunciationAssessment.__table__.insert().values(
                        id=pronunciation_id,
                        session_id=session_id,
                        overall_score=0.5,
                        phoneme_alignment=[],
                        source="demo_mock",
                        provider="demo",
                        model_version="demo-mock",
                        is_synthetic=True,
                        confidence=0.5,
                        created_at=now,
                    )
                )
                await connection.execute(
                    GrammarError.__table__.insert().values(
                        id=grammar_id,
                        session_id=session_id,
                        skill_tag=skill_id,
                        original="I go yesterday.",
                        corrected="I went yesterday.",
                        error_type="verb_tense_past",
                        source="demo_rule",
                        provider="demo",
                        model_version="demo-rule",
                        is_synthetic=True,
                        confidence=0.5,
                        created_at=now,
                    )
                )

                valid_keys = [
                    "job-completed",
                    "job-pron-0",
                    "job-grammar-0",
                    f"baseline-{suffix}",
                ]
                valid_types = [
                    "analysis_completed",
                    "pronunciation_observation",
                    "grammar_observation",
                    "baseline_snapshot",
                ]
                for event_type, idempotency_key in zip(
                    valid_types, valid_keys, strict=True
                ):
                    await connection.execute(
                        learning_events.insert().values(
                            **learning_event_values(
                                event_type, idempotency_key, user_id=user_id
                            )
                        )
                    )

                stored = {
                    row.event_type: row
                    for row in await connection.execute(
                        learning_events.select().where(
                            learning_events.c.user_id == user_id
                        )
                    )
                }
                assert set(stored) == set(valid_types)
                assert [
                    stored[event_type].apply_seq for event_type in valid_types
                ] == sorted(stored[event_type].apply_seq for event_type in valid_types)
                assert all(row.recorded_at is not None for row in stored.values())
                assert all(
                    row.details == {"schema_version": 1} for row in stored.values()
                )

                invalid_cases = [
                    (
                        "pronunciation_observation",
                        f"bad-type-{suffix}",
                        {"event_type": "unsupported"},
                        (
                            "ck_learning_events_type",
                            "ck_learning_events_shape",
                        ),
                    ),
                    (
                        "analysis_completed",
                        f"completed-null-job-{suffix}",
                        {"analysis_job_id": None},
                        "ck_learning_events_shape",
                    ),
                    (
                        "pronunciation_observation",
                        f"pron-null-ordinal-{suffix}",
                        {"source_ordinal": None},
                        "ck_learning_events_shape",
                    ),
                    (
                        "grammar_observation",
                        f"grammar-true-{suffix}",
                        {"observation_correct": True},
                        "ck_learning_events_shape",
                    ),
                    (
                        "baseline_snapshot",
                        f"baseline-source-{suffix}",
                        {"source": "legacy_known"},
                        "ck_learning_events_shape",
                    ),
                    (
                        "pronunciation_observation",
                        f"confidence-low-{suffix}",
                        {"confidence": -0.01},
                        "ck_learning_events_confidence",
                    ),
                    (
                        "pronunciation_observation",
                        f"confidence-high-{suffix}",
                        {"confidence": 1.01},
                        "ck_learning_events_confidence",
                    ),
                    (
                        "baseline_snapshot",
                        f"snapshot-low-{suffix}",
                        {"p_mastery_snapshot": -0.01},
                        "ck_learning_events_snapshot",
                    ),
                    (
                        "baseline_snapshot",
                        f"snapshot-high-{suffix}",
                        {"p_mastery_snapshot": 1.01},
                        "ck_learning_events_snapshot",
                    ),
                    (
                        "pronunciation_observation",
                        f"ordinal-negative-{suffix}",
                        {"source_ordinal": -1},
                        "ck_learning_events_shape",
                    ),
                    (
                        "pronunciation_observation",
                        f"occurred-null-{suffix}",
                        {"occurred_at": None},
                        "occurred_at",
                    ),
                ]
                for event_type, key, overrides, expected in invalid_cases:
                    values = learning_event_values(event_type, key, user_id=user_id)
                    values.update(overrides)
                    async with expect_integrity_error(connection, expected):
                        await connection.execute(
                            learning_events.insert().values(**values)
                        )

                async with expect_integrity_error(
                    connection, "uq_learning_events_idempotency_key"
                ):
                    await connection.execute(
                        learning_events.insert().values(
                            **learning_event_values(
                                "pronunciation_observation",
                                "job-pron-0",
                                user_id=user_id,
                                source_ordinal=1,
                            )
                        )
                    )
                async with expect_integrity_error(
                    connection, "uq_learning_events_completed_job"
                ):
                    await connection.execute(
                        learning_events.insert().values(
                            **learning_event_values(
                                "analysis_completed",
                                f"job-completed-2-{suffix}",
                                user_id=user_id,
                            )
                        )
                    )

                for table, key in [
                    (PronunciationAssessment.__table__, pronunciation_id),
                    (GrammarError.__table__, grammar_id),
                    (AnalysisJob.__table__, job_id),
                    (Skill.__table__, skill_id),
                ]:
                    async with expect_integrity_error(connection, "learning_events"):
                        await connection.execute(
                            table.delete().where(table.c.id == key)
                        )

                await connection.execute(
                    learning_events.delete().where(
                        learning_events.c.user_id == user_id,
                        learning_events.c.event_type != "baseline_snapshot",
                    )
                )
                await connection.execute(
                    GrammarError.__table__.delete().where(
                        GrammarError.__table__.c.id == grammar_id
                    )
                )
                await connection.execute(
                    PronunciationAssessment.__table__.delete().where(
                        PronunciationAssessment.__table__.c.id == pronunciation_id
                    )
                )
                await connection.execute(
                    AnalysisJob.__table__.delete().where(
                        AnalysisJob.__table__.c.id == job_id
                    )
                )
                await connection.execute(
                    Session.__table__.delete().where(
                        Session.__table__.c.id == session_id
                    )
                )
                async with expect_integrity_error(connection, "learning_events"):
                    await connection.execute(
                        User.__table__.delete().where(User.__table__.c.id == user_id)
                    )
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
