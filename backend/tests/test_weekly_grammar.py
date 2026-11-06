"""七天语法 Top 3 聚合的真实 PostgreSQL/HTTP 回归。

不复用历史成功日志、不以 mock SQL 替代真实聚合；每例独立事务最终回滚。
"""

import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from main import app
from models.exercise import GrammarError
from models.session import Session, SessionMode, SessionStatus
from models.user import User

GRAMMAR_PATH = "/api/assessments/weekly-grammar"
UTC = timezone.utc


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class GrammarEnvironment:
    def __init__(self, db, engine):
        self.db = db
        self.engine = engine

    async def user(self) -> uuid.UUID:
        user_id = uuid.uuid4()
        self.db.add(
            User(
                id=user_id,
                email=f"grammar-{user_id}@example.test",
                auth_issuer="urn:echotalk:test",
                auth_subject=str(user_id),
            )
        )
        await self.db.flush()
        return user_id

    async def session(
        self,
        user_id: uuid.UUID,
        started_at: datetime,
        *,
        status: SessionStatus = SessionStatus.completed,
    ) -> uuid.UUID:
        session_id = uuid.uuid4()
        self.db.add(
            Session(
                id=session_id,
                user_id=user_id,
                mode=SessionMode.free_talk,
                status=status,
                started_at=started_at,
                ended_at=started_at + timedelta(minutes=1),
            )
        )
        await self.db.flush()
        return session_id

    async def grammar_error(
        self,
        session_id: uuid.UUID,
        skill_tag: str,
        *,
        source: str = "real_provider",
        is_synthetic: bool = False,
        created_at: datetime | None = None,
    ) -> None:
        self.db.add(
            GrammarError(
                id=uuid.uuid4(),
                session_id=session_id,
                skill_tag=skill_tag,
                original="private original must never be read",
                corrected="private correction must never be read",
                error_type="test_error",
                source=source,
                provider=None,
                model_version=None,
                is_synthetic=is_synthetic,
                confidence=None,
                created_at=created_at or datetime.now(UTC),
            )
        )
        await self.db.flush()

    async def errors(
        self,
        session_id: uuid.UUID,
        skill_tag: str,
        count: int,
        *,
        source: str = "real_provider",
        is_synthetic: bool = False,
    ) -> None:
        for _ in range(count):
            await self.grammar_error(
                session_id,
                skill_tag,
                source=source,
                is_synthetic=is_synthetic,
            )

    @asynccontextmanager
    async def client(self, user_id: uuid.UUID | None = None):
        saved = app.dependency_overrides.copy()

        async def override_db():
            yield self.db

        async def override_user():
            return CurrentUser(
                id=user_id,
                email="grammar@example.test",
                issuer="urn:echotalk:test",
                subject=str(user_id),
            )

        app.dependency_overrides[get_db] = override_db
        if user_id is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = override_user
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                yield client
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(saved)


def require_test_database_url():
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail(
            "grammar PostgreSQL tests require explicit DATABASE_URL", pytrace=False
        )
    try:
        parsed = make_url(raw)
        database = parsed.database or ""
        parts = set(re.split(r"[_-]+", database.casefold()))
        valid = (
            parsed.drivername in {"postgresql", "postgresql+asyncpg"}
            and parsed.host in {"127.0.0.1", "localhost", "::1"}
            and parsed.port is not None
            and 1 <= parsed.port <= 65535
            and bool(parsed.username and parsed.username.strip())
            and re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_-]*", database) is not None
            and bool(parts & {"test", "pytest"})
            and not (parts & {"prod", "production", "qa", "stage", "staging", "live"})
            and not parsed.query
        )
    except Exception:
        pytest.fail("grammar PostgreSQL test DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail("grammar PostgreSQL test database boundary mismatch", pytrace=False)
    return parsed.set(drivername="postgresql+asyncpg")


@pytest.fixture
async def grammar_pg():
    database_url = require_test_database_url()
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                identity = (
                    await connection.execute(
                        text("SELECT current_database(), current_user")
                    )
                ).one()
                assert identity == (database_url.database, database_url.username)
                async with AsyncSession(bind=connection, expire_on_commit=False) as db:
                    yield GrammarEnvironment(db, engine)
            finally:
                if transaction.is_active:
                    await transaction.rollback()
    finally:
        await engine.dispose()


def test_grammar_database_guard_fails_without_explicit_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(pytest.fail.Exception, match="require explicit DATABASE_URL"):
        require_test_database_url()


@pytest.mark.parametrize(
    ("url", "host", "port", "user", "database"),
    [
        (
            "postgresql+asyncpg://echotalk_grammar_http_test@127.0.0.1:55444/echotalk_grammar_http_test",
            "127.0.0.1",
            55444,
            "echotalk_grammar_http_test",
            "echotalk_grammar_http_test",
        ),
        (
            "postgresql://tester@127.0.0.1:55444/test_grammar",
            "127.0.0.1",
            55444,
            "tester",
            "test_grammar",
        ),
    ],
)
def test_grammar_database_guard_accepts_explicit_test_urls_without_connecting(
    monkeypatch, url, host, port, user, database
):
    monkeypatch.setenv("DATABASE_URL", url)
    parsed = require_test_database_url()
    assert parsed.drivername == "postgresql+asyncpg"
    assert (parsed.host, parsed.port, parsed.username, parsed.database) == (
        host,
        port,
        user,
        database,
    )
    assert not parsed.query


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://tester@127.0.0.1:55444/echotalk_grammar_http",
        "postgresql://tester@127.0.0.1:55444/echotalk_qa_test",
        "postgresql://tester@127.0.0.1:55444/echotalk_prod_test",
        "postgresql://tester@127.0.0.1:55444/production",
        "postgresql://tester@192.0.2.1:55444/test_grammar",
        "postgresql://tester@db.example.invalid:5432/test_grammar",
        "postgresql://tester@127.0.0.1/test_grammar",
        "postgresql://tester@127.0.0.1:0/test_grammar",
        "postgresql://tester@127.0.0.1:65536/test_grammar",
        "postgresql://127.0.0.1:55444/test_grammar",
        "postgresql://tester@127.0.0.1:55444/",
        "sqlite:///:memory:",
    ],
)
def test_grammar_database_guard_rejects_other_targets_without_connecting(
    monkeypatch, url
):
    monkeypatch.setenv("DATABASE_URL", url)
    with pytest.raises(
        pytest.fail.Exception,
        match="database boundary mismatch|DATABASE_URL is invalid",
    ):
        require_test_database_url()


@pytest.mark.asyncio
async def test_grammar_requires_authentication(grammar_pg):
    async with grammar_pg.client() as client:
        for headers in ({}, {"Authorization": "Bearer invalid-grammar-token"}):
            response = await client.get(
                GRAMMAR_PATH,
                params={"end_date": "2026-11-03", "timezone": "UTC"},
                headers=headers,
            )
            assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "params",
    [
        {},
        {"end_date": "2026-11-03"},
        {"timezone": "UTC"},
        {"end_date": "2026-11-03", "timezone": ""},
        {"end_date": "2026-11-03", "timezone": "Invalid/Zone"},
        {"end_date": "2026-11-03", "timezone": "U" * 129},
        {"end_date": "2026-11-03", "timezone": "UTC\x00"},
        {"end_date": "2026-02-29", "timezone": "UTC"},
        {"end_date": "2026-13-01", "timezone": "UTC"},
        {"end_date": "20261103", "timezone": "UTC"},
        {"end_date": "2026-1-03", "timezone": "UTC"},
        {"end_date": "2026-11-03T00:00:00Z", "timezone": "UTC"},
        {"end_date": "2026-11-03\n", "timezone": "UTC"},
        {"end_date": "0000-01-01", "timezone": "UTC"},
        {"end_date": "9999-12-31", "timezone": "UTC"},
    ],
)
async def test_grammar_invalid_parameters_are_422_before_sql(grammar_pg, params):
    owner = await grammar_pg.user()
    statements = []

    def record_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(grammar_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    try:
        async with grammar_pg.client(owner) as client:
            response = await client.get(GRAMMAR_PATH, params=params)
    finally:
        event.remove(grammar_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    assert response.status_code == 422
    assert statements == []


@pytest.mark.asyncio
async def test_grammar_empty_state(grammar_pg):
    owner = await grammar_pg.user()
    start = datetime(2026, 10, 28, tzinfo=UTC)
    await grammar_pg.session(owner, start)
    async with grammar_pg.client(owner) as client:
        response = await client.get(
            GRAMMAR_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
        )
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"start", "end", "total_errors", "items"}
    assert payload["total_errors"] == 0
    assert payload["items"] == []
    assert _utc(payload["start"]) == datetime(2026, 10, 28, tzinfo=UTC)
    assert _utc(payload["end"]) == datetime(2026, 11, 4, tzinfo=UTC)


@pytest.mark.asyncio
async def test_grammar_cross_user_isolation(grammar_pg):
    owner = await grammar_pg.user()
    other = await grammar_pg.user()
    start = datetime(2026, 10, 29, tzinfo=UTC)
    owner_session = await grammar_pg.session(owner, start)
    other_session = await grammar_pg.session(other, start)
    await grammar_pg.errors(owner_session, "article_usage", 2)
    await grammar_pg.errors(other_session, "preposition", 5)

    async with grammar_pg.client(owner) as client:
        response = await client.get(
            GRAMMAR_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_errors"] == 2
    assert payload["items"] == [{"skill_tag": "article_usage", "count": 2}]

    async with grammar_pg.client(other) as client:
        response = await client.get(
            GRAMMAR_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_errors"] == 5
    assert payload["items"] == [{"skill_tag": "preposition", "count": 5}]


@pytest.mark.asyncio
async def test_grammar_filters_status_synthetic_and_demo(grammar_pg):
    owner = await grammar_pg.user()
    start = datetime(2026, 10, 29, tzinfo=UTC)

    counted = await grammar_pg.session(owner, start)
    await grammar_pg.errors(counted, "article_usage", 1)

    active = await grammar_pg.session(owner, start, status=SessionStatus.active)
    await grammar_pg.errors(active, "article_usage", 1)

    cancelled = await grammar_pg.session(owner, start, status=SessionStatus.cancelled)
    await grammar_pg.errors(cancelled, "article_usage", 1)

    synthetic = await grammar_pg.session(owner, start)
    await grammar_pg.errors(synthetic, "article_usage", 1, is_synthetic=True)

    demo_rule = await grammar_pg.session(owner, start)
    await grammar_pg.errors(demo_rule, "article_usage", 1, source="demo_rule")

    demo_mock = await grammar_pg.session(owner, start)
    await grammar_pg.errors(demo_mock, "article_usage", 1, source="demo_mock")

    async with grammar_pg.client(owner) as client:
        response = await client.get(
            GRAMMAR_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_errors"] == 1
    assert payload["items"] == [{"skill_tag": "article_usage", "count": 1}]


@pytest.mark.asyncio
async def test_grammar_late_write_uses_session_window_not_error_created_at(grammar_pg):
    owner = await grammar_pg.user()
    # 窗口 2026-10-28T00:00Z .. 2026-11-04T00:00Z。
    inside_session = await grammar_pg.session(owner, datetime(2026, 10, 29, tzinfo=UTC))
    await grammar_pg.grammar_error(
        inside_session,
        "article_usage",
        created_at=datetime(2026, 10, 1, tzinfo=UTC),
    )
    outside_session = await grammar_pg.session(
        owner, datetime(2026, 10, 27, tzinfo=UTC)
    )
    await grammar_pg.grammar_error(
        outside_session,
        "verb_tense_past",
        created_at=datetime(2026, 10, 30, tzinfo=UTC),
    )

    async with grammar_pg.client(owner) as client:
        response = await client.get(
            GRAMMAR_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_errors"] == 1
    assert payload["items"] == [{"skill_tag": "article_usage", "count": 1}]


@pytest.mark.asyncio
async def test_grammar_top3_and_total_out_of_band(grammar_pg):
    owner = await grammar_pg.user()
    start = datetime(2026, 10, 29, tzinfo=UTC)
    session_id = await grammar_pg.session(owner, start)
    await grammar_pg.errors(session_id, "article_usage", 5)
    await grammar_pg.errors(session_id, "verb_tense_past", 4)
    await grammar_pg.errors(session_id, "verb_tense_present", 3)
    await grammar_pg.errors(session_id, "subject_verb_agreement", 2)
    await grammar_pg.errors(session_id, "preposition", 1)
    await grammar_pg.errors(session_id, "vowel_sounds", 6)
    await grammar_pg.errors(session_id, "consonant_clusters", 1)

    async with grammar_pg.client(owner) as client:
        response = await client.get(
            GRAMMAR_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_errors"] == 22
    assert payload["items"] == [
        {"skill_tag": "other", "count": 7},
        {"skill_tag": "article_usage", "count": 5},
        {"skill_tag": "verb_tense_past", "count": 4},
    ]


@pytest.mark.asyncio
async def test_grammar_tie_stable_ordering(grammar_pg):
    owner = await grammar_pg.user()
    start = datetime(2026, 10, 29, tzinfo=UTC)
    session_id = await grammar_pg.session(owner, start)
    await grammar_pg.errors(session_id, "verb_tense_past", 2)
    await grammar_pg.errors(session_id, "article_usage", 2)
    await grammar_pg.errors(session_id, "preposition", 1)

    async with grammar_pg.client(owner) as client:
        response = await client.get(
            GRAMMAR_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == [
        {"skill_tag": "article_usage", "count": 2},
        {"skill_tag": "verb_tense_past", "count": 2},
        {"skill_tag": "preposition", "count": 1},
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("zone", "end_date", "first_start", "last_end"),
    [
        ("UTC", "2026-11-03", "2026-10-28T00:00:00Z", "2026-11-04T00:00:00Z"),
        (
            "Asia/Singapore",
            "2026-11-03",
            "2026-10-27T16:00:00Z",
            "2026-11-03T16:00:00Z",
        ),
        (
            "America/New_York",
            "2026-03-08",
            "2026-03-02T05:00:00Z",
            "2026-03-09T04:00:00Z",
        ),
        (
            "America/New_York",
            "2026-11-01",
            "2026-10-26T04:00:00Z",
            "2026-11-02T05:00:00Z",
        ),
    ],
)
async def test_grammar_window_boundaries_half_open_and_dst(
    grammar_pg, zone, end_date, first_start, last_end
):
    owner = await grammar_pg.user()
    epsilon = timedelta(microseconds=1)
    in_first = await grammar_pg.session(owner, _utc(first_start))
    await grammar_pg.errors(in_first, "article_usage", 1)
    before = await grammar_pg.session(owner, _utc(first_start) - epsilon)
    await grammar_pg.errors(before, "article_usage", 1)
    in_last = await grammar_pg.session(owner, _utc(last_end) - epsilon)
    await grammar_pg.errors(in_last, "verb_tense_past", 1)
    after = await grammar_pg.session(owner, _utc(last_end))
    await grammar_pg.errors(after, "verb_tense_past", 1)

    async with grammar_pg.client(owner) as client:
        response = await client.get(
            GRAMMAR_PATH, params={"end_date": end_date, "timezone": zone}
        )
    assert response.status_code == 200
    payload = response.json()
    assert _utc(payload["start"]) == _utc(first_start)
    assert _utc(payload["end"]) == _utc(last_end)
    assert payload["total_errors"] == 2
    assert payload["items"] == [
        {"skill_tag": "article_usage", "count": 1},
        {"skill_tag": "verb_tense_past", "count": 1},
    ]


@pytest.mark.asyncio
async def test_grammar_apia_skipped_date(grammar_pg):
    owner = await grammar_pg.user()
    boundary = datetime(2011, 12, 30, 10, tzinfo=UTC)
    before = await grammar_pg.session(owner, boundary - timedelta(microseconds=1))
    await grammar_pg.errors(before, "article_usage", 1)
    at_boundary = await grammar_pg.session(owner, boundary)
    await grammar_pg.errors(at_boundary, "verb_tense_past", 1)

    async with grammar_pg.client(owner) as client:
        response = await client.get(
            GRAMMAR_PATH,
            params={"end_date": "2011-12-31", "timezone": "Pacific/Apia"},
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_errors"] == 2
    assert payload["items"] == [
        {"skill_tag": "article_usage", "count": 1},
        {"skill_tag": "verb_tense_past", "count": 1},
    ]


@pytest.mark.asyncio
async def test_grammar_single_bounded_select_necessary_columns(grammar_pg):
    owner = await grammar_pg.user()
    start = datetime(2026, 10, 29, tzinfo=UTC)
    session_id = await grammar_pg.session(owner, start)
    await grammar_pg.errors(session_id, "article_usage", 2)
    await grammar_pg.errors(session_id, "vowel_sounds", 1)

    statements = []

    def record_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append((" ".join(statement.lower().split()), parameters))

    event.listen(grammar_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    try:
        async with grammar_pg.client(owner) as client:
            response = await client.get(
                GRAMMAR_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
            )
    finally:
        event.remove(grammar_pg.engine.sync_engine, "before_cursor_execute", record_sql)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_errors"] == 3
    assert payload["items"] == [
        {"skill_tag": "article_usage", "count": 2},
        {"skill_tag": "other", "count": 1},
    ]

    assert len(statements) == 1
    sql, parameters = statements[0]
    assert sql.startswith("select ")
    assert "count(" in sql
    assert "case" in sql
    assert "join grammar_errors" in sql
    assert " where " in sql
    predicates = sql.split(" where ", 1)[1]
    for column in ("user_id", "status", "started_at"):
        assert f"sessions.{column}" in predicates
    assert "sessions.started_at >=" in predicates
    assert "sessions.started_at <" in predicates
    assert "grammar_errors.is_synthetic" in predicates
    assert "grammar_errors.source" in predicates
    assert "grammar_errors.session_id" in sql
    assert datetime(2026, 10, 28, tzinfo=UTC) in parameters
    assert datetime(2026, 11, 4, tzinfo=UTC) in parameters
    assert owner in parameters
    for forbidden in (
        "transcripts",
        "session_contexts",
        "analysis_jobs",
        "knowledge_states",
        "document_content",
        "custom_prompt",
        "request_fingerprint",
        "original",
        "corrected",
        "error_type",
        "confidence",
        "provider",
        "model_version",
        "created_at",
        "sessions.ended_at",
        "sessions.mode",
        "select sessions.*",
    ):
        assert forbidden not in sql
