"""B2 existing-ledger hardening: offline migration contract and real PG probes.

The PostgreSQL tests require an already-migrated, empty synthetic database. They
never create tables or execute Alembic, and all rows are rolled back.
"""

from __future__ import annotations

import importlib.util
import io
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSON, JSONB
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from models import LearningEvent

BACKEND = Path(__file__).resolve().parents[1]
VERSIONS = BACKEND / "alembic" / "versions"
PG_DIALECT = postgresql.dialect()

REVISION = "b2_ledger_hardening"
PARENT = "b1_goal_evaluation"
DATABASE_HOST = "127.0.0.1"
DATABASE_PORT = 55446
DATABASE_NAME = "echotalk_b2_main_test"
DATABASE_ROLE = "echotalk_b2_main_test"
SERVER_VERSION_NUM = "150019"
CHECK_STATE = "23514"
IDENTITY_STATE = "428C9"

EXPECTED_COLUMNS = {
    "apply_seq": ("BIGINT", False, True),
    "idempotency_key": ("VARCHAR(200)", False, False),
    "event_type": ("VARCHAR(32)", False, False),
    "user_id": ("UUID", False, False),
    "session_id": ("UUID", True, False),
    "analysis_job_id": ("UUID", True, False),
    "pronunciation_assessment_id": ("UUID", True, False),
    "grammar_error_id": ("UUID", True, False),
    "skill_id": ("VARCHAR(50)", True, False),
    "source_ordinal": ("INTEGER", True, False),
    "observation_correct": ("BOOLEAN", True, False),
    "observation_code": ("VARCHAR(64)", True, False),
    "source": ("VARCHAR(50)", False, False),
    "provider": ("VARCHAR(50)", True, False),
    "model_version": ("VARCHAR(100)", True, False),
    "confidence": ("FLOAT", True, False),
    "is_synthetic": ("BOOLEAN", True, False),
    "algorithm_version": ("VARCHAR(64)", True, False),
    "algorithm_params": ("JSONB", True, False),
    "p_mastery_snapshot": ("FLOAT", True, False),
    "cutover_revision": ("VARCHAR(100)", True, False),
    "occurred_at": ("TIMESTAMP WITH TIME ZONE", False, False),
    "recorded_at": ("TIMESTAMP WITH TIME ZONE", False, False),
    "details": ("JSONB", False, False),
}

EXPECTED_PG_COLUMNS = {
    "apply_seq": "bigint",
    "idempotency_key": "character varying(200)",
    "event_type": "character varying(32)",
    "user_id": "uuid",
    "session_id": "uuid",
    "analysis_job_id": "uuid",
    "pronunciation_assessment_id": "uuid",
    "grammar_error_id": "uuid",
    "skill_id": "character varying(50)",
    "source_ordinal": "integer",
    "observation_correct": "boolean",
    "observation_code": "character varying(64)",
    "source": "character varying(50)",
    "provider": "character varying(50)",
    "model_version": "character varying(100)",
    "confidence": "double precision",
    "is_synthetic": "boolean",
    "algorithm_version": "character varying(64)",
    "algorithm_params": "jsonb",
    "p_mastery_snapshot": "double precision",
    "cutover_revision": "character varying(100)",
    "occurred_at": "timestamp with time zone",
    "recorded_at": "timestamp with time zone",
    "details": "jsonb",
}

EXPECTED_FKS = {
    "user_id": ("users", "id", "RESTRICT"),
    "session_id": ("sessions", "id", "RESTRICT"),
    "analysis_job_id": ("analysis_jobs", "id", "RESTRICT"),
    "pronunciation_assessment_id": ("pronunciation_assessments", "id", "RESTRICT"),
    "grammar_error_id": ("grammar_errors", "id", "RESTRICT"),
    "skill_id": ("skills", "id", "RESTRICT"),
}

EXPECTED_CHECKS = {
    "ck_learning_events_type",
    "ck_learning_events_confidence",
    "ck_learning_events_snapshot",
    "ck_learning_events_idempotency_key_not_empty",
    "ck_learning_events_source_not_empty",
    "ck_learning_events_provider_null_or_not_empty",
    "ck_learning_events_details_shape",
    "ck_learning_events_algorithm_params_object",
    "ck_learning_events_shape",
}

EXPECTED_ADDED_CHECKS = {
    "ck_learning_events_idempotency_key_not_empty",
    "ck_learning_events_source_not_empty",
    "ck_learning_events_provider_null_or_not_empty",
    "ck_learning_events_details_shape",
    "ck_learning_events_algorithm_params_object",
    "ck_learning_events_shape",
}

EXPECTED_INDEXES = {
    "ix_learning_events_user_seq",
    "ix_learning_events_user_skill_seq",
    "ix_learning_events_session_seq",
    "uq_learning_events_completed_job",
}

EXPECTED_SHAPE_PREDICATES = {
    "analysis_completed": (
        "source = 'analysis'",
        "algorithm_version IS NOT NULL",
        "algorithm_params IS NOT NULL",
    ),
    "pronunciation_observation": (
        "observation_code <> ''",
        "model_version IS NOT NULL",
        "model_version <> ''",
    ),
    "grammar_observation": (
        "observation_correct IS FALSE",
        "observation_code <> ''",
        "model_version IS NOT NULL",
        "model_version <> ''",
    ),
    "baseline_snapshot": (
        "source = 'legacy_unknown'",
        "p_mastery_snapshot IS NOT NULL",
        "cutover_revision IS NOT NULL",
    ),
}

ALGORITHM_PARAMS = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}


def _load_revision() -> Any:
    path = VERSIONS / f"{REVISION}.py"
    spec = importlib.util.spec_from_file_location(REVISION, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _render(function_name: str) -> str:
    buffer = io.StringIO()
    context = MigrationContext.configure(
        dialect=PG_DIALECT,
        opts={"as_sql": True, "literal_binds": False, "output_buffer": buffer},
    )
    with Operations.context(context):
        getattr(_load_revision(), function_name)()
    return buffer.getvalue()


def _check_signatures() -> dict[str, str]:
    return {
        constraint.name: constraint.sqltext.text
        for constraint in LearningEvent.__table__.constraints
        if isinstance(constraint, sa.CheckConstraint)
    }


def _shape_branches() -> dict[str, str]:
    shape = " ".join(_check_signatures()["ck_learning_events_shape"].split())
    branches: dict[str, str] = {}
    for raw_branch in shape.split(") OR ("):
        branch = raw_branch.removeprefix("(").removesuffix(")")
        prefix = "event_type = '"
        assert branch.startswith(prefix), branch
        event_type = branch[len(prefix) :].split("'", 1)[0]
        assert event_type not in branches, event_type
        branches[event_type] = branch
    return branches


def test_revision_is_a_single_linear_head() -> None:
    script = ScriptDirectory(str(BACKEND / "alembic"))
    revisions = {revision.revision: revision for revision in script.walk_revisions()}
    assert revisions[REVISION].down_revision == PARENT
    assert set(script.get_heads()) == {REVISION}


def test_upgrade_is_existing_table_alter_without_data_repair() -> None:
    sql = _render("upgrade")
    normalized = " ".join(sql.upper().split())

    assert "ALTER TABLE LEARNING_EVENTS" in normalized
    assert "ALTER COLUMN APPLY_SEQ SET GENERATED ALWAYS" in normalized
    assert "DROP CONSTRAINT CK_LEARNING_EVENTS_SHAPE" in normalized
    assert normalized.count("ADD CONSTRAINT") == len(EXPECTED_ADDED_CHECKS)
    for name in EXPECTED_ADDED_CHECKS:
        assert name.upper() in normalized

    assert "CREATE TABLE LEARNING_EVENTS" not in normalized
    assert "DROP TABLE LEARNING_EVENTS" not in normalized
    for forbidden in ("DELETE FROM", "UPDATE LEARNING_EVENTS", "TRUNCATE", "SETVAL("):
        assert forbidden not in normalized


def test_new_shape_and_json_unknown_guards_are_explicit() -> None:
    sql = _render("upgrade")
    checks = _check_signatures()

    assert checks["ck_learning_events_details_shape"] == (
        "(jsonb_typeof(details) = 'object'"
        " AND details->'schema_version' = '1'::jsonb) IS TRUE"
    )
    assert checks["ck_learning_events_algorithm_params_object"] == (
        "(algorithm_params IS NULL"
        " OR jsonb_typeof(algorithm_params) = 'object') IS TRUE"
    )
    assert "details->>'schema_version'" not in sql
    assert "details->'schema_version' = '1'::jsonb" in sql
    assert sql.count("IS TRUE") >= 2

    branches = _shape_branches()
    assert set(branches) == set(EXPECTED_SHAPE_PREDICATES)
    for event_type, predicates in EXPECTED_SHAPE_PREDICATES.items():
        for predicate in predicates:
            assert predicate in branches[event_type], (event_type, predicate)


def test_orm_and_migration_have_the_same_hardening_contract() -> None:
    table = LearningEvent.__table__
    checks = _check_signatures()

    assert set(table.columns.keys()) == set(EXPECTED_COLUMNS)
    assert tuple(table.primary_key.columns.keys()) == ("apply_seq",)
    assert table.columns["apply_seq"].identity is not None
    assert table.columns["apply_seq"].identity.always is True
    assert set(checks) == EXPECTED_CHECKS

    for name, (type_name, nullable, primary_key) in EXPECTED_COLUMNS.items():
        column = table.columns[name]
        assert column.type.compile(dialect=PG_DIALECT) == type_name, name
        assert column.nullable is nullable, name
        assert column.primary_key is primary_key, name

    foreign_keys = {
        fk.parent.name: (fk.column.table.name, fk.column.name, fk.ondelete)
        for fk in table.foreign_keys
    }
    assert foreign_keys == EXPECTED_FKS

    sql = _render("upgrade")
    assert "ALTER COLUMN APPLY_SEQ SET GENERATED ALWAYS" in " ".join(
        sql.upper().split()
    )
    for name in EXPECTED_ADDED_CHECKS:
        assert name in sql


def test_downgrade_restores_only_b1_contract_and_preserves_rows() -> None:
    sql = _render("downgrade")
    normalized = " ".join(sql.upper().split())

    assert "ALTER TABLE LEARNING_EVENTS" in normalized
    assert "ALTER COLUMN APPLY_SEQ SET GENERATED BY DEFAULT" in normalized
    assert normalized.count("DROP CONSTRAINT") == 6
    assert normalized.count("ADD CONSTRAINT") == 1
    assert "ADD CONSTRAINT CK_LEARNING_EVENTS_SHAPE" in normalized
    assert "CREATE TABLE LEARNING_EVENTS" not in normalized
    assert "DROP TABLE LEARNING_EVENTS" not in normalized
    for forbidden in ("DELETE FROM", "UPDATE LEARNING_EVENTS", "TRUNCATE", "SETVAL("):
        assert forbidden not in normalized


def _valid_database_url() -> str:
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail(
            "B2 hardening PostgreSQL tests require explicit DATABASE_URL; "
            "no dotenv fallback",
            pytrace=False,
        )
    try:
        parsed = make_url(raw)
        target = (parsed.host, parsed.port, parsed.database)
        valid = (
            parsed.drivername in {"postgresql", "postgresql+asyncpg"}
            and target == (DATABASE_HOST, DATABASE_PORT, DATABASE_NAME)
            and parsed.username == DATABASE_ROLE
            and not parsed.query
        )
    except Exception:
        pytest.fail("B2 hardening PostgreSQL DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail(
            "B2 hardening PostgreSQL DATABASE_URL is outside the isolated namespace",
            pytrace=False,
        )
    return raw


@pytest.fixture
async def db() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(
        _valid_database_url().replace("postgresql://", "postgresql+asyncpg://"),
        poolclass=NullPool,
    )
    connection: AsyncConnection | None = None
    transaction = None
    try:
        connection = await engine.connect()
        transaction = await connection.begin()
        identity = (
            await connection.execute(
                sa.text(
                    "SELECT current_database(), current_user, "
                    "current_setting('server_version_num')"
                )
            )
        ).one()
        versions = (
            (
                await connection.execute(
                    sa.text("SELECT version_num FROM alembic_version")
                )
            )
            .scalars()
            .all()
        )
        assert identity == (DATABASE_NAME, DATABASE_ROLE, SERVER_VERSION_NUM)
        assert versions == [REVISION]

        async with AsyncSession(
            bind=connection,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        ) as session:
            yield session
    finally:
        if transaction is not None:
            await transaction.rollback()
        if connection is not None:
            await connection.close()
        await engine.dispose()


class SyntheticRows:
    def __init__(self) -> None:
        tag = uuid4().hex
        self.tag = tag
        self.user_id = uuid4()
        self.skill_id = f"b2m_{tag}"[:50]
        self.completed_session_id = uuid4()
        self.pronunciation_session_id = uuid4()
        self.grammar_session_id = uuid4()
        self.completed_job_id = uuid4()
        self.pronunciation_job_id = uuid4()
        self.grammar_job_id = uuid4()
        self.pronunciation_id = uuid4()
        self.grammar_id = uuid4()
        self.now = datetime.now(UTC).replace(microsecond=0)

    async def seed(self, db: AsyncSession) -> None:
        await db.execute(
            sa.text(
                """
                INSERT INTO users
                    (id, email, auth_issuer, auth_subject,
                     subscription_tier, created_at)
                VALUES
                    (:id, :email, :issuer, :subject, 'free', :created_at)
                """
            ),
            {
                "id": self.user_id,
                "email": f"b2-main-{self.tag}@example.invalid",
                "issuer": f"urn:echotalk:b2-main:{self.tag}",
                "subject": self.tag,
                "created_at": self.now,
            },
        )
        await db.execute(
            sa.text(
                """
                INSERT INTO skills (id, name, category, description)
                VALUES (:id, :id, 'grammar', NULL)
                """
            ),
            {"id": self.skill_id},
        )
        for session_id in (
            self.completed_session_id,
            self.pronunciation_session_id,
            self.grammar_session_id,
        ):
            await db.execute(
                sa.text(
                    """
                    INSERT INTO sessions
                        (id, user_id, mode, status, started_at, ended_at)
                    VALUES
                        (:id, :user_id, 'conversation', 'completed',
                         :started_at, :ended_at)
                    """
                ),
                {
                    "id": session_id,
                    "user_id": self.user_id,
                    "started_at": self.now - timedelta(minutes=1),
                    "ended_at": self.now,
                },
            )
        for job_id, session_id in (
            (self.completed_job_id, self.completed_session_id),
            (self.pronunciation_job_id, self.pronunciation_session_id),
            (self.grammar_job_id, self.grammar_session_id),
        ):
            await db.execute(
                sa.text(
                    """
                    INSERT INTO analysis_jobs
                        (id, session_id, status, attempt_count, created_at, updated_at)
                    VALUES
                        (:id, :session_id, 'succeeded', 1, :created_at, :created_at)
                    """
                ),
                {"id": job_id, "session_id": session_id, "created_at": self.now},
            )
        await db.execute(
            sa.text(
                """
                INSERT INTO pronunciation_assessments
                    (id, session_id, overall_score, phoneme_alignment,
                     source, provider, model_version, is_synthetic,
                     confidence, created_at)
                VALUES
                    (:id, :session_id, 0.8, CAST('[]' AS json),
                     'synthetic_demo', NULL, 'synthetic-v1', false, 1, :created_at)
                """
            ),
            {
                "id": self.pronunciation_id,
                "session_id": self.pronunciation_session_id,
                "created_at": self.now,
            },
        )
        await db.execute(
            sa.text(
                """
                INSERT INTO grammar_errors
                    (id, session_id, skill_tag, original, corrected,
                     error_type, source, provider, model_version,
                     is_synthetic, confidence, created_at)
                VALUES
                    (:id, :session_id, :skill_id, 'synthetic',
                     'synthetic', 'synthetic_error', 'synthetic_demo', NULL,
                     'synthetic-v1', false, 0, :created_at)
                """
            ),
            {
                "id": self.grammar_id,
                "session_id": self.grammar_session_id,
                "skill_id": self.skill_id,
                "created_at": self.now,
            },
        )

    def event(self, event_type: str, suffix: str = "") -> dict[str, Any]:
        event: dict[str, Any] = {
            "idempotency_key": f"b2-main:{self.tag}:{event_type}{suffix}",
            "event_type": event_type,
            "user_id": self.user_id,
            "session_id": None,
            "analysis_job_id": None,
            "pronunciation_assessment_id": None,
            "grammar_error_id": None,
            "skill_id": None,
            "source_ordinal": None,
            "observation_correct": None,
            "observation_code": None,
            "source": "synthetic_demo",
            "provider": None,
            "model_version": None,
            "confidence": None,
            "is_synthetic": None,
            "algorithm_version": None,
            "algorithm_params": None,
            "p_mastery_snapshot": None,
            "cutover_revision": None,
            "occurred_at": self.now,
            "details": {"schema_version": 1},
        }
        if event_type == "analysis_completed":
            event.update(
                session_id=self.completed_session_id,
                analysis_job_id=self.completed_job_id,
                source="analysis",
                algorithm_version="bkt-v1",
                algorithm_params=ALGORITHM_PARAMS.copy(),
            )
        elif event_type == "pronunciation_observation":
            event.update(
                session_id=self.pronunciation_session_id,
                analysis_job_id=self.pronunciation_job_id,
                pronunciation_assessment_id=self.pronunciation_id,
                skill_id=self.skill_id,
                source_ordinal=0,
                observation_correct=True,
                observation_code="vowel",
                model_version="synthetic-v1",
                is_synthetic=False,
                confidence=0.8,
            )
        elif event_type == "grammar_observation":
            event.update(
                session_id=self.grammar_session_id,
                analysis_job_id=self.grammar_job_id,
                grammar_error_id=self.grammar_id,
                skill_id=self.skill_id,
                source_ordinal=0,
                observation_correct=False,
                observation_code="synthetic_error",
                model_version="synthetic-v1",
                is_synthetic=False,
                confidence=0.9,
            )
        elif event_type == "baseline_snapshot":
            event.update(
                skill_id=self.skill_id,
                source="legacy_unknown",
                p_mastery_snapshot=0.1,
                cutover_revision=f"b2-main:{self.tag}",
            )
        else:
            raise AssertionError(f"unknown event type: {event_type}")
        return event


EVENT_COLUMNS = tuple(
    column for column in EXPECTED_COLUMNS if column not in {"apply_seq", "recorded_at"}
)
INSERT_TYPES: dict[str, sa.types.TypeEngine[Any]] = {
    "idempotency_key": sa.String(),
    "event_type": sa.String(),
    "user_id": sa.Uuid(),
    "session_id": sa.Uuid(),
    "analysis_job_id": sa.Uuid(),
    "pronunciation_assessment_id": sa.Uuid(),
    "grammar_error_id": sa.Uuid(),
    "skill_id": sa.String(),
    "source_ordinal": sa.Integer(),
    "observation_correct": sa.Boolean(),
    "observation_code": sa.String(),
    "source": sa.String(),
    "provider": sa.String(),
    "model_version": sa.String(),
    "confidence": sa.Float(),
    "is_synthetic": sa.Boolean(),
    "algorithm_version": sa.String(),
    "algorithm_params": JSONB(none_as_null=True),
    "p_mastery_snapshot": sa.Float(),
    "cutover_revision": sa.String(),
    "occurred_at": sa.DateTime(timezone=True),
    "details": JSONB(none_as_null=True),
}


async def _insert(
    db: AsyncSession,
    event: dict[str, Any],
    *,
    omitted: tuple[str, ...] = (),
    explicit_apply_seq: int | None = None,
) -> None:
    columns = tuple(column for column in EVENT_COLUMNS if column not in omitted)
    if explicit_apply_seq is not None:
        columns = ("apply_seq", *columns)
    names = {column: f"v_{column}" for column in columns}
    statement = sa.text(
        f"INSERT INTO learning_events ({', '.join(columns)}) "
        f"VALUES ({', '.join(':' + names[column] for column in columns)})"
    ).bindparams(
        *(
            sa.bindparam(
                names[column],
                type_=(
                    sa.BigInteger() if column == "apply_seq" else INSERT_TYPES[column]
                ),
            )
            for column in columns
        )
    )
    params = {
        names[column]: event[column] for column in columns if column != "apply_seq"
    }
    if explicit_apply_seq is not None:
        params[names["apply_seq"]] = explicit_apply_seq
    await db.execute(statement, params)


def _postgres_error(error: DBAPIError) -> Any:
    candidates: list[Any] = []
    pending: list[Any] = [error]
    while pending:
        current = pending.pop(0)
        if any(current is candidate for candidate in candidates):
            continue
        candidates.append(current)
        pending.extend(
            candidate
            for candidate in (
                getattr(current, "__cause__", None),
                getattr(current, "__context__", None),
                getattr(current, "orig", None),
            )
            if candidate is not None
        )
    postgres_errors = [
        candidate
        for candidate in candidates
        if candidate.__class__.__module__.startswith("asyncpg.")
    ]
    assert postgres_errors, "database rejection must come from asyncpg"
    return postgres_errors[-1]


async def _reject(
    db: AsyncSession,
    operation: Callable[[], Awaitable[Any]],
    *,
    sqlstate: str,
    constraint: str | None = None,
) -> None:
    with pytest.raises(DBAPIError) as caught:
        savepoint = await db.begin_nested()
        try:
            await operation()
        finally:
            await savepoint.rollback()
    postgres = _postgres_error(caught.value)
    assert getattr(postgres, "sqlstate", None) == sqlstate
    if constraint is not None:
        assert getattr(postgres, "constraint_name", None) == constraint


async def _reject_event(
    db: AsyncSession,
    event: dict[str, Any],
    constraint: str,
) -> None:
    await _reject(
        db,
        lambda: _insert(db, event),
        sqlstate=CHECK_STATE,
        constraint=constraint,
    )


async def test_postgres_schema_identity_counts_fks_and_indexes(
    db: AsyncSession,
) -> None:
    columns = (
        await db.execute(
            sa.text(
                """
                    SELECT attribute.attname,
                           format_type(attribute.atttypid, attribute.atttypmod),
                           NOT attribute.attnotnull,
                           attribute.attidentity::text
                    FROM pg_attribute AS attribute
                    WHERE attribute.attrelid = 'learning_events'::regclass
                      AND attribute.attnum > 0
                      AND NOT attribute.attisdropped
                    ORDER BY attribute.attnum
                    """
            )
        )
    ).all()
    assert len(columns) == 24
    assert {row[0]: row[1] for row in columns} == EXPECTED_PG_COLUMNS
    assert {row[0]: row[2] for row in columns} == {
        name: nullable for name, (_, nullable, _) in EXPECTED_COLUMNS.items()
    }
    assert {row[0]: row[3] for row in columns}["apply_seq"] == "a"

    checks = set(
        (
            await db.execute(
                sa.text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'learning_events'::regclass "
                    "AND contype = 'c'"
                )
            )
        )
        .scalars()
        .all()
    )
    assert checks == EXPECTED_CHECKS

    foreign_keys = (
        await db.execute(
            sa.text(
                """
                SELECT source.attname, target.relname, target_col.attname,
                       fk.confdeltype::text
                FROM pg_constraint AS fk
                JOIN pg_attribute AS source
                  ON source.attrelid = fk.conrelid
                 AND source.attnum = fk.conkey[1]
                JOIN pg_class AS target
                  ON target.oid = fk.confrelid
                JOIN pg_attribute AS target_col
                  ON target_col.attrelid = fk.confrelid
                 AND target_col.attnum = fk.confkey[1]
                WHERE fk.conrelid = 'learning_events'::regclass
                  AND fk.contype = 'f'
                """
            )
        )
    ).all()
    assert len(foreign_keys) == 6
    assert {row[0]: (row[1], row[2], row[3]) for row in foreign_keys} == {
        column: (table, target, "r")
        for column, (table, target, _) in EXPECTED_FKS.items()
    }

    indexes = set(
        (
            await db.execute(
                sa.text(
                    "SELECT index_catalog.relname FROM pg_index AS index "
                    "JOIN pg_class AS index_catalog "
                    "ON index_catalog.oid = index.indexrelid "
                    "WHERE index.indrelid = 'learning_events'::regclass"
                )
            )
        )
        .scalars()
        .all()
    )
    assert EXPECTED_INDEXES <= indexes
    assert "uq_learning_events_idempotency_key" in indexes


async def test_identity_always_rejects_explicit_apply_seq(db: AsyncSession) -> None:
    rows = SyntheticRows()
    await rows.seed(db)
    event = rows.event("baseline_snapshot", ":identity")
    await _reject(
        db,
        lambda: _insert(db, event, explicit_apply_seq=2_000_000_000),
        sqlstate=IDENTITY_STATE,
    )


@pytest.mark.parametrize(
    "details",
    [
        {},
        {"schema_version": "1"},
        {"schema_version": False},
        {"schema_version": [1]},
        {"schema_version": None},
        JSON.NULL,
        [1],
        "1",
        False,
    ],
)
async def test_details_rejects_json_unknown_and_wrong_types(
    db: AsyncSession,
    details: Any,
) -> None:
    rows = SyntheticRows()
    await rows.seed(db)
    event = rows.event("baseline_snapshot", f":details:{type(details).__name__}")
    event["details"] = details
    await _reject_event(db, event, "ck_learning_events_details_shape")


async def test_details_sql_null_is_rejected_as_not_null(db: AsyncSession) -> None:
    rows = SyntheticRows()
    await rows.seed(db)
    event = rows.event("baseline_snapshot", ":details-sql-null")
    event["details"] = None

    with pytest.raises(DBAPIError) as caught:
        savepoint = await db.begin_nested()
        try:
            await _insert(db, event)
        finally:
            await savepoint.rollback()
    postgres = _postgres_error(caught.value)
    assert getattr(postgres, "sqlstate", None) == "23502"
    assert getattr(postgres, "column_name", None) == "details"


@pytest.mark.parametrize("params", [JSON.NULL, [], "1", False, 0])
async def test_completed_algorithm_params_require_json_object(
    db: AsyncSession,
    params: Any,
) -> None:
    rows = SyntheticRows()
    await rows.seed(db)
    event = rows.event("analysis_completed", f":params:{type(params).__name__}")
    event["algorithm_params"] = params
    await _reject_event(db, event, "ck_learning_events_algorithm_params_object")


@pytest.mark.parametrize(
    ("event_type", "column", "value", "constraint"),
    [
        (
            "pronunciation_observation",
            "model_version",
            None,
            "ck_learning_events_shape",
        ),
        (
            "pronunciation_observation",
            "model_version",
            "",
            "ck_learning_events_shape",
        ),
        (
            "grammar_observation",
            "model_version",
            None,
            "ck_learning_events_shape",
        ),
        (
            "grammar_observation",
            "model_version",
            "",
            "ck_learning_events_shape",
        ),
        (
            "grammar_observation",
            "observation_code",
            "",
            "ck_learning_events_shape",
        ),
        (
            "analysis_completed",
            "source",
            "wrong-source",
            "ck_learning_events_shape",
        ),
        (
            "pronunciation_observation",
            "observation_code",
            "",
            "ck_learning_events_shape",
        ),
        (
            "baseline_snapshot",
            "idempotency_key",
            "",
            "ck_learning_events_idempotency_key_not_empty",
        ),
        (
            "pronunciation_observation",
            "source",
            "",
            "ck_learning_events_source_not_empty",
        ),
        (
            "grammar_observation",
            "provider",
            "",
            "ck_learning_events_provider_null_or_not_empty",
        ),
        (
            "grammar_observation",
            "observation_correct",
            None,
            "ck_learning_events_shape",
        ),
        (
            "grammar_observation",
            "observation_correct",
            True,
            "ck_learning_events_shape",
        ),
    ],
)
async def test_hardened_empty_null_and_grammar_rules(
    db: AsyncSession,
    event_type: str,
    column: str,
    value: Any,
    constraint: str,
) -> None:
    rows = SyntheticRows()
    await rows.seed(db)
    event = rows.event(event_type, f":{column}:{value!r}")
    event[column] = value
    await _reject_event(db, event, constraint)


async def test_provider_null_remains_valid_for_mapped_observation(
    db: AsyncSession,
) -> None:
    rows = SyntheticRows()
    await rows.seed(db)
    event = rows.event("pronunciation_observation", ":provider-null")
    assert event["provider"] is None
    await _insert(db, event)


@pytest.mark.parametrize(
    ("event_type", "column", "value", "constraint"),
    [
        ("pronunciation_observation", "confidence", 0.0, None),
        ("pronunciation_observation", "confidence", 1.0, None),
        (
            "pronunciation_observation",
            "confidence",
            -0.0001,
            "ck_learning_events_confidence",
        ),
        (
            "pronunciation_observation",
            "confidence",
            1.0001,
            "ck_learning_events_confidence",
        ),
        (
            "pronunciation_observation",
            "confidence",
            float("nan"),
            "ck_learning_events_confidence",
        ),
        (
            "pronunciation_observation",
            "confidence",
            float("inf"),
            "ck_learning_events_confidence",
        ),
        ("baseline_snapshot", "p_mastery_snapshot", 0.0, None),
        ("baseline_snapshot", "p_mastery_snapshot", 1.0, None),
        (
            "baseline_snapshot",
            "p_mastery_snapshot",
            -0.0001,
            "ck_learning_events_snapshot",
        ),
        (
            "baseline_snapshot",
            "p_mastery_snapshot",
            1.0001,
            "ck_learning_events_snapshot",
        ),
        (
            "baseline_snapshot",
            "p_mastery_snapshot",
            float("nan"),
            "ck_learning_events_snapshot",
        ),
        (
            "baseline_snapshot",
            "p_mastery_snapshot",
            float("inf"),
            "ck_learning_events_snapshot",
        ),
    ],
)
async def test_confidence_and_snapshot_boundaries(
    db: AsyncSession,
    event_type: str,
    column: str,
    value: float,
    constraint: str | None,
) -> None:
    rows = SyntheticRows()
    await rows.seed(db)
    event = rows.event(event_type, f":{column}:{value!r}")
    event[column] = value
    if constraint is None:
        await _insert(db, event)
    else:
        await _reject_event(db, event, constraint)
