"""七日本地自然日聚合的真实 PostgreSQL/HTTP 回归。

不复用历史成功日志、不以 mock SQL 替代真实聚合；每例独立事务最终回滚。
"""

import os
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from main import app
from models.session import (
    Session,
    SessionContext,
    SessionMode,
    SessionStatus,
    Transcript,
    TranscriptRole,
)
from models.user import User

WEEKLY_PATH = "/api/sessions/weekly-progress"
UTC = timezone.utc


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class WeeklyEnvironment:
    def __init__(self, db, engine):
        self.db = db
        self.engine = engine

    async def user(self) -> uuid.UUID:
        user_id = uuid.uuid4()
        self.db.add(
            User(
                id=user_id,
                email=f"weekly-{user_id}@example.test",
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
        ended_at: datetime | None = None,
    ) -> uuid.UUID:
        session_id = uuid.uuid4()
        self.db.add(
            Session(
                id=session_id,
                user_id=user_id,
                mode=SessionMode.free_talk,
                status=status,
                started_at=started_at,
                ended_at=ended_at,
            )
        )
        await self.db.flush()
        return session_id

    @asynccontextmanager
    async def client(self, user_id: uuid.UUID | None = None):
        saved = app.dependency_overrides.copy()

        async def override_db():
            yield self.db

        async def override_user():
            return CurrentUser(
                id=user_id,
                email="weekly@example.test",
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


@pytest.fixture
async def weekly_pg():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.fail("Dedicated PostgreSQL DATABASE_URL is required; no dotenv fallback")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                async with AsyncSession(bind=connection, expire_on_commit=False) as db:
                    yield WeeklyEnvironment(db, engine)
            finally:
                if transaction.is_active:
                    await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("zone", "end_date", "first_start", "last_start", "last_end", "last_hours"),
    [
        (
            "UTC",
            "2026-11-03",
            "2026-10-28T00:00:00Z",
            "2026-11-03T00:00:00Z",
            "2026-11-04T00:00:00Z",
            24,
        ),
        (
            "Asia/Singapore",
            "2026-11-03",
            "2026-10-27T16:00:00Z",
            "2026-11-02T16:00:00Z",
            "2026-11-03T16:00:00Z",
            24,
        ),
        (
            "America/New_York",
            "2026-03-08",
            "2026-03-02T05:00:00Z",
            "2026-03-08T05:00:00Z",
            "2026-03-09T04:00:00Z",
            23,
        ),
        (
            "America/New_York",
            "2026-11-01",
            "2026-10-26T04:00:00Z",
            "2026-11-01T04:00:00Z",
            "2026-11-02T05:00:00Z",
            25,
        ),
    ],
)
async def test_weekly_zero_buckets_and_real_timezone_boundaries(
    weekly_pg, zone, end_date, first_start, last_start, last_end, last_hours
):
    user_id = await weekly_pg.user()
    async with weekly_pg.client(user_id) as client:
        response = await client.get(
            WEEKLY_PATH, params={"end_date": end_date, "timezone": zone}
        )
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"days"}
    days = payload["days"]
    assert len(days) == 7
    assert [day["date"] for day in days] == [
        (date.fromisoformat(end_date) - timedelta(days=offset)).isoformat()
        for offset in range(6, -1, -1)
    ]
    assert _utc(days[0]["start"]) == _utc(first_start)
    assert _utc(days[-1]["start"]) == _utc(last_start)
    assert _utc(days[-1]["end"]) == _utc(last_end)
    for i, day in enumerate(days):
        assert set(day) == {"date", "start", "end", "completed_sessions"}
        assert type(day["completed_sessions"]) is int
        assert day["completed_sessions"] == 0
        assert _utc(day["start"]).utcoffset() == timedelta(0)
        assert _utc(day["end"]).utcoffset() == timedelta(0)
        expected_hours = last_hours if i == 6 else 24
        assert _utc(day["end"]) - _utc(day["start"]) == timedelta(hours=expected_hours)
        if i:
            assert days[i - 1]["end"] == day["start"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("zone", "end_date", "boundaries"),
    [
        (
            "UTC",
            "2026-11-03",
            [datetime(2026, 10, 28, tzinfo=UTC) + timedelta(days=i) for i in range(8)],
        ),
        (
            "Asia/Singapore",
            "2026-11-03",
            [
                datetime(2026, 10, 27, 16, tzinfo=UTC) + timedelta(days=i)
                for i in range(8)
            ],
        ),
        (
            "America/New_York",
            "2026-03-08",
            [datetime(2026, 3, 2, 5, tzinfo=UTC) + timedelta(days=i) for i in range(7)]
            + [datetime(2026, 3, 9, 4, tzinfo=UTC)],
        ),
        (
            "America/New_York",
            "2026-11-01",
            [
                datetime(2026, 10, 26, 4, tzinfo=UTC) + timedelta(days=i)
                for i in range(7)
            ]
            + [datetime(2026, 11, 2, 5, tzinfo=UTC)],
        ),
    ],
)
async def test_weekly_counts_half_open_days_status_user_and_zero_transcripts(
    weekly_pg, zone, end_date, boundaries
):
    owner = await weekly_pg.user()
    other = await weekly_pg.user()
    epsilon = timedelta(microseconds=1)
    # 每日午夜与结束前一微秒各一条；邻日午夜只能计入后一天。
    for start, end in zip(boundaries, boundaries[1:]):
        await weekly_pg.session(
            owner,
            start,
            ended_at=boundaries[-1] + timedelta(days=3),
        )
        await weekly_pg.session(owner, end - epsilon)
        await weekly_pg.session(owner, start, status=SessionStatus.active)
        await weekly_pg.session(owner, start, status=SessionStatus.cancelled)
        await weekly_pg.session(other, start)
    await weekly_pg.session(owner, boundaries[0] - epsilon)
    await weekly_pg.session(owner, boundaries[-1])
    # 转录再多也只是一条会话；其余 completed 没有转录仍应计数。
    with_transcripts = await weekly_pg.session(
        owner, boundaries[3] + timedelta(hours=1)
    )
    weekly_pg.db.add_all(
        [
            Transcript(
                session_id=with_transcripts,
                role=role,
                content="private transcript must never be read",
                timestamp_ms=i,
            )
            for i, role in enumerate(
                [TranscriptRole.user, TranscriptRole.assistant, TranscriptRole.user]
            )
        ]
    )
    await weekly_pg.db.flush()
    async with weekly_pg.client(owner) as client:
        response = await client.get(
            WEEKLY_PATH,
            params={"end_date": end_date, "timezone": zone, "user_id": str(other)},
        )
    assert response.status_code == 200
    assert [day["completed_sessions"] for day in response.json()["days"]] == [
        2,
        2,
        2,
        3,
        2,
        2,
        2,
    ]


@pytest.mark.asyncio
async def test_weekly_skipped_local_date_is_zero_and_does_not_double_count(weekly_pg):
    owner = await weekly_pg.user()
    # Apia 2011-12-30 被跳过，30日与31日午夜映射到同一 UTC 时刻。
    boundary = datetime(2011, 12, 30, 10, tzinfo=UTC)
    await weekly_pg.session(owner, boundary - timedelta(microseconds=1))
    await weekly_pg.session(owner, boundary)
    async with weekly_pg.client(owner) as client:
        response = await client.get(
            WEEKLY_PATH,
            params={"end_date": "2011-12-31", "timezone": "Pacific/Apia"},
        )
    assert response.status_code == 200
    days = response.json()["days"]
    assert [day["completed_sessions"] for day in days] == [0, 0, 0, 0, 1, 0, 1]
    assert days[5]["date"] == "2011-12-30"
    assert _utc(days[5]["start"]) == boundary == _utc(days[5]["end"])
    assert days[4]["end"] == days[5]["start"] == days[6]["start"]


@pytest.mark.asyncio
async def test_weekly_single_bounded_select_no_entities_bodies_or_writes(weekly_pg):
    owner = await weekly_pg.user()
    start = datetime(2026, 10, 28, tzinfo=UTC)
    session_id = await weekly_pg.session(owner, start)
    weekly_pg.db.add(
        SessionContext(
            session_id=session_id,
            document_content="private document must never be read",
            custom_prompt="private prompt",
        )
    )
    await weekly_pg.db.flush()
    statements = []

    def record_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append((" ".join(statement.lower().split()), parameters))

    event.listen(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    try:
        async with weekly_pg.client(owner) as client:
            response = await client.get(
                WEEKLY_PATH, params={"end_date": "2026-11-03", "timezone": "UTC"}
            )
    finally:
        event.remove(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    assert response.status_code == 200
    assert [day["completed_sessions"] for day in response.json()["days"]] == [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
    ]
    assert len(statements) == 1
    sql, parameters = statements[0]
    assert sql.startswith("select ")
    assert "count(" in sql and " from sessions " in sql
    assert " where " in sql
    predicates = sql.split(" where ", 1)[1]
    for column in ("user_id", "status", "started_at"):
        assert f"sessions.{column}" in predicates
    assert "sessions.started_at >=" in predicates
    assert "sessions.started_at <" in predicates
    assert start in parameters
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
        "ended_at",
        "sessions.id",
        "sessions.mode",
        "join ",
        "select sessions.*",
    ):
        assert forbidden not in sql
    # 读前的唯一实体仍具有相同状态、时间，无隐式结束/分析任务。
    row = (
        await weekly_pg.db.execute(
            select(Session.status, Session.started_at).where(Session.id == session_id)
        )
    ).one()
    assert row.status == SessionStatus.completed
    assert row.started_at == start


@pytest.mark.asyncio
async def test_weekly_selected_day_history_paginates_and_rejects_foreign_cursors(
    weekly_pg,
):
    owner = await weekly_pg.user()
    other = await weekly_pg.user()
    start = datetime(2026, 11, 1, 4, tzinfo=UTC)
    ids = [await weekly_pg.session(owner, start + timedelta(hours=i)) for i in range(3)]
    await weekly_pg.session(owner, start - timedelta(microseconds=1))
    async with weekly_pg.client(owner) as client:
        weekly = await client.get(
            WEEKLY_PATH,
            params={"end_date": "2026-11-01", "timezone": "America/New_York"},
        )
        assert weekly.status_code == 200
        days = weekly.json()["days"]
        selected = days[-1]
        assert selected["completed_sessions"] == 3
        params = {
            "status": "completed",
            "start": selected["start"],
            "end": selected["end"],
            "limit": 2,
        }
        first = await client.get("/api/sessions", params=params)
        assert first.status_code == 200
        cursor = first.json()["next_cursor"]
        assert cursor
        second = await client.get("/api/sessions", params={**params, "cursor": cursor})
        assert second.status_code == 200
        assert second.json()["next_cursor"] is None
        assert [
            item["id"] for item in first.json()["items"] + second.json()["items"]
        ] == [str(session_id) for session_id in reversed(ids)]
        changed_day = await client.get(
            "/api/sessions",
            params={
                **params,
                "cursor": cursor,
                "start": days[-2]["start"],
                "end": days[-2]["end"],
            },
        )
        assert changed_day.status_code == 422
        assert changed_day.json()["detail"] == "Invalid pagination cursor"
        changed_endpoint = await client.get(
            "/api/sessions/active", params={**params, "cursor": cursor}
        )
        assert changed_endpoint.status_code == 422
    async with weekly_pg.client(other) as client:
        changed_user = await client.get(
            "/api/sessions", params={**params, "cursor": cursor}
        )
        assert changed_user.status_code == 422
        assert changed_user.json()["detail"] == "Invalid pagination cursor"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "params",
    [
        {},
        {"end_date": "2026-11-03"},
        {"timezone": "UTC"},
        {"end_date": "2026-11-03", "timezone": ""},
        {"end_date": "2026-11-03", "timezone": "Invalid/Zone"},
        {"end_date": "2026-11-03", "timezone": "/etc/passwd"},
        {"end_date": "2026-11-03", "timezone": "../UTC"},
        {"end_date": "2026-11-03", "timezone": "U" * 129},
        {"end_date": "2026-11-03", "timezone": "UTC\x00"},
        {"end_date": "2026-02-29", "timezone": "UTC"},
        {"end_date": "2026-13-01", "timezone": "UTC"},
        {"end_date": "20261103", "timezone": "UTC"},
        {"end_date": "2026-1-03", "timezone": "UTC"},
        {"end_date": "2026-11-03T00:00:00Z", "timezone": "UTC"},
        {"end_date": "2026-11-03\n", "timezone": "UTC"},
        {"end_date": "0000-01-01", "timezone": "UTC"},
        {"end_date": "0001-01-06", "timezone": "UTC"},
        {"end_date": "0001-01-07", "timezone": "Asia/Singapore"},
        {"end_date": "9999-12-31", "timezone": "UTC"},
    ],
)
async def test_weekly_invalid_parameters_are_422_before_sql(weekly_pg, params):
    owner = await weekly_pg.user()
    statements = []

    def record_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    try:
        async with weekly_pg.client(owner) as client:
            response = await client.get(WEEKLY_PATH, params=params)
    finally:
        event.remove(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    assert response.status_code == 422
    assert statements == []


@pytest.mark.asyncio
async def test_weekly_requires_authentication(weekly_pg):
    async with weekly_pg.client() as client:
        for headers in ({}, {"Authorization": "Bearer invalid-weekly-token"}):
            response = await client.get(
                WEEKLY_PATH,
                params={"end_date": "2026-11-03", "timezone": "UTC"},
                headers=headers,
            )
            assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path", ["/api/sessions", "/api/sessions/active", "/api/sessions/daily-progress"]
)
async def test_weekly_does_not_relax_existing_48_hour_limits(weekly_pg, path):
    owner = await weekly_pg.user()
    async with weekly_pg.client(owner) as client:
        response = await client.get(
            path,
            params={"start": "2026-10-28T00:00:00Z", "end": "2026-11-04T00:00:00Z"},
        )
    assert response.status_code == 422
    assert response.json()["detail"] == "时间窗口跨度不能超过 48 小时"


def _duration_params(
    *,
    end_date: str = "2026-11-03",
    timezone_name: str = "UTC",
    include: str = "true",
) -> dict[str, str]:
    return {
        "end_date": end_date,
        "timezone": timezone_name,
        "include_recorded_duration": include,
    }


@pytest.mark.asyncio
async def test_weekly_omitted_and_false_duration_keep_legacy_count_only_response(
    weekly_pg,
):
    owner = await weekly_pg.user()
    start = datetime(2026, 10, 28, 1, tzinfo=UTC)
    await weekly_pg.session(owner, start, ended_at=start + timedelta(seconds=2))
    statements = []

    def record_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append((" ".join(statement.lower().split()), parameters))

    event.listen(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    try:
        async with weekly_pg.client(owner) as client:
            responses = [
                await client.get(
                    WEEKLY_PATH,
                    params={"end_date": "2026-11-03", "timezone": "UTC"},
                ),
                await client.get(
                    WEEKLY_PATH,
                    params=_duration_params(include="false"),
                ),
            ]
    finally:
        event.remove(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)

    for response in responses:
        assert response.status_code == 200
        payload = response.json()
        assert set(payload) == {"days"}
        assert [day["completed_sessions"] for day in payload["days"]] == [
            1,
            0,
            0,
            0,
            0,
            0,
            0,
        ]
        for day in payload["days"]:
            assert set(day) == {"date", "start", "end", "completed_sessions"}
            assert type(day["completed_sessions"]) is int

    assert len(statements) == len(responses) == 2
    for sql, parameters in statements:
        assert sql.startswith("select ")
        assert "count(" in sql and " from sessions " in sql
        assert "ended_at" not in sql
        assert owner in parameters


@pytest.mark.asyncio
async def test_weekly_true_duration_aggregates_owner_status_zero_and_explicit_fields(
    weekly_pg,
):
    owner = await weekly_pg.user()
    other = await weekly_pg.user()
    start = datetime(2026, 10, 28, 1, tzinfo=UTC)
    await weekly_pg.session(
        owner,
        start,
        ended_at=start + timedelta(milliseconds=2500),
    )
    zero_start = start + timedelta(hours=2)
    await weekly_pg.session(owner, zero_start, ended_at=zero_start)
    second_day_zero_start = start + timedelta(days=1)
    await weekly_pg.session(
        owner,
        second_day_zero_start,
        ended_at=second_day_zero_start,
    )
    await weekly_pg.session(
        owner,
        start + timedelta(hours=3),
        status=SessionStatus.active,
        ended_at=start + timedelta(hours=3, seconds=1),
    )
    await weekly_pg.session(
        owner,
        start + timedelta(hours=4),
        status=SessionStatus.cancelled,
        ended_at=start + timedelta(hours=4, seconds=1),
    )
    await weekly_pg.session(
        other,
        start + timedelta(hours=5),
        ended_at=start + timedelta(hours=5, seconds=1),
    )

    async with weekly_pg.client(owner) as client:
        response = await client.get(WEEKLY_PATH, params=_duration_params())

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"days"}
    days = payload["days"]
    assert len(days) == 7
    for day in days:
        assert set(day) == {
            "date",
            "start",
            "end",
            "completed_sessions",
            "recorded_duration_ms",
            "duration_unavailable_count",
        }
        assert type(day["completed_sessions"]) is int
        assert type(day["recorded_duration_ms"]) is int
        assert type(day["duration_unavailable_count"]) is int
    assert days[0]["completed_sessions"] == 2
    assert days[0]["recorded_duration_ms"] == 2500
    assert days[0]["duration_unavailable_count"] == 0
    assert days[1]["completed_sessions"] == 1
    assert days[1]["recorded_duration_ms"] == 0
    assert days[1]["duration_unavailable_count"] == 0
    for day in days[2:]:
        assert day["completed_sessions"] == 0
        assert day["recorded_duration_ms"] == 0
        assert day["duration_unavailable_count"] == 0


@pytest.mark.asyncio
async def test_weekly_true_duration_keeps_missing_and_negative_end_unavailable(
    weekly_pg,
):
    owner = await weekly_pg.user()
    start = datetime(2026, 10, 28, 1, tzinfo=UTC)
    await weekly_pg.session(owner, start, ended_at=None)
    await weekly_pg.session(
        owner,
        start + timedelta(hours=1),
        ended_at=start - timedelta(minutes=1),
    )

    async with weekly_pg.client(owner) as client:
        response = await client.get(WEEKLY_PATH, params=_duration_params())

    assert response.status_code == 200
    day = response.json()["days"][0]
    assert day["completed_sessions"] == 2
    assert day["recorded_duration_ms"] == 0
    assert day["duration_unavailable_count"] == 2


@pytest.mark.asyncio
async def test_weekly_true_duration_floors_each_session_before_summing(weekly_pg):
    owner = await weekly_pg.user()
    start = datetime(2026, 10, 28, 1, tzinfo=UTC)
    for offset in (0, 1):
        session_start = start + timedelta(hours=offset)
        await weekly_pg.session(
            owner,
            session_start,
            ended_at=session_start + timedelta(microseconds=1999),
        )

    async with weekly_pg.client(owner) as client:
        response = await client.get(WEEKLY_PATH, params=_duration_params())

    assert response.status_code == 200
    day = response.json()["days"][0]
    assert day["completed_sessions"] == 2
    # 每条 1999us 截断为 1ms，逐条 floor 后合计 2ms。
    # 若先求和再截断则会错误得到 3ms。
    assert day["recorded_duration_ms"] == 2
    assert day["duration_unavailable_count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    (
        "zone",
        "end_date",
        "session_start",
        "session_end",
        "expected_local_date",
        "expected_ms",
    ),
    [
        (
            "Asia/Singapore",
            "2026-11-03",
            datetime(2026, 11, 2, 15, 59, 30, tzinfo=UTC),
            datetime(2026, 11, 2, 16, 0, 30, tzinfo=UTC),
            "2026-11-02",
            60_000,
        ),
        (
            "America/New_York",
            "2026-03-08",
            datetime(2026, 3, 8, 5, tzinfo=UTC),
            datetime(2026, 3, 9, 4, tzinfo=UTC),
            "2026-03-08",
            23 * 60 * 60 * 1000,
        ),
        (
            "America/New_York",
            "2026-11-01",
            datetime(2026, 11, 1, 4, tzinfo=UTC),
            datetime(2026, 11, 2, 5, tzinfo=UTC),
            "2026-11-01",
            25 * 60 * 60 * 1000,
        ),
        (
            "Pacific/Apia",
            "2011-12-31",
            datetime(2011, 12, 30, 10, tzinfo=UTC),
            datetime(2011, 12, 30, 10, 0, 0, 1999, tzinfo=UTC),
            "2011-12-31",
            1,
        ),
    ],
)
async def test_weekly_true_duration_uses_local_start_day_dst_and_skipped_days(
    weekly_pg,
    zone,
    end_date,
    session_start,
    session_end,
    expected_local_date,
    expected_ms,
):
    owner = await weekly_pg.user()
    await weekly_pg.session(owner, session_start, ended_at=session_end)

    async with weekly_pg.client(owner) as client:
        response = await client.get(
            WEEKLY_PATH,
            params=_duration_params(end_date=end_date, timezone_name=zone),
        )

    assert response.status_code == 200
    days = response.json()["days"]
    target_days = [day for day in days if day["date"] == expected_local_date]
    assert len(target_days) == 1
    target = target_days[0]
    assert target["completed_sessions"] == 1
    assert target["recorded_duration_ms"] == expected_ms
    assert target["duration_unavailable_count"] == 0
    for day in days:
        if day["date"] == expected_local_date:
            continue
        assert day["completed_sessions"] == 0
        assert day["recorded_duration_ms"] == 0
        assert day["duration_unavailable_count"] == 0
    if zone == "Pacific/Apia":
        assert days[5]["date"] == "2011-12-30"
        assert days[5]["start"] == days[5]["end"]


@pytest.mark.asyncio
async def test_weekly_true_duration_uses_whole_week_half_open_boundaries(weekly_pg):
    owner = await weekly_pg.user()
    week_start = datetime(2026, 10, 28, tzinfo=UTC)
    week_end = datetime(2026, 11, 4, tzinfo=UTC)
    epsilon = timedelta(microseconds=1)
    await weekly_pg.session(
        owner,
        week_start - epsilon,
        ended_at=week_start + timedelta(seconds=1),
    )
    start_edge = week_start
    await weekly_pg.session(
        owner,
        start_edge,
        ended_at=start_edge + timedelta(milliseconds=500),
    )
    end_edge = week_end - epsilon
    await weekly_pg.session(
        owner,
        end_edge,
        ended_at=end_edge + timedelta(seconds=1),
    )
    await weekly_pg.session(
        owner,
        week_end,
        ended_at=week_end + timedelta(seconds=2),
    )

    async with weekly_pg.client(owner) as client:
        response = await client.get(WEEKLY_PATH, params=_duration_params())

    assert response.status_code == 200
    days = response.json()["days"]
    assert [day["completed_sessions"] for day in days] == [1, 0, 0, 0, 0, 0, 1]
    assert days[0]["recorded_duration_ms"] == 500
    assert days[-1]["recorded_duration_ms"] == 1000
    assert all(day["duration_unavailable_count"] == 0 for day in days)


@pytest.mark.asyncio
async def test_weekly_true_duration_uses_one_read_only_select_without_fanout(weekly_pg):
    owner = await weekly_pg.user()
    start = datetime(2026, 10, 28, tzinfo=UTC)
    session_id = await weekly_pg.session(
        owner,
        start,
        ended_at=start + timedelta(milliseconds=3210),
    )
    weekly_pg.db.add(
        SessionContext(
            session_id=session_id,
            document_content="private document must never be read",
            custom_prompt="private prompt",
        )
    )
    weekly_pg.db.add(
        Transcript(
            session_id=session_id,
            role=TranscriptRole.user,
            content="private transcript must never be read",
            timestamp_ms=0,
        )
    )
    await weekly_pg.db.flush()
    statements = []

    def record_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append((" ".join(statement.lower().split()), parameters))

    event.listen(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    try:
        async with weekly_pg.client(owner) as client:
            response = await client.get(WEEKLY_PATH, params=_duration_params())
    finally:
        event.remove(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)

    assert response.status_code == 200
    day = response.json()["days"][0]
    assert day["completed_sessions"] == 1
    assert day["recorded_duration_ms"] == 3210
    assert day["duration_unavailable_count"] == 0
    assert len(statements) == 1
    sql, parameters = statements[0]
    assert sql.startswith("select ")
    assert "count(" in sql and "sum(" in sql and " from sessions " in sql
    assert "ended_at" in sql
    predicates = sql.split(" where ", 1)[1]
    for column in ("user_id", "status", "started_at"):
        assert f"sessions.{column}" in predicates
    assert owner in parameters
    for forbidden in (
        " join ",
        "transcripts",
        "session_contexts",
        "analysis_jobs",
        "knowledge_states",
        "document_content",
        "custom_prompt",
        "sessions.id",
        "sessions.mode",
        "select sessions.*",
        " insert ",
        " update ",
        " delete ",
    ):
        assert forbidden not in sql


@pytest.mark.asyncio
async def test_weekly_invalid_duration_opt_in_is_422_before_sql(weekly_pg):
    owner = await weekly_pg.user()
    statements = []

    def record_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)
    try:
        async with weekly_pg.client(owner) as client:
            response = await client.get(
                WEEKLY_PATH,
                params=_duration_params(include="definitely-not-a-bool"),
            )
    finally:
        event.remove(weekly_pg.engine.sync_engine, "before_cursor_execute", record_sql)

    assert response.status_code == 422
    assert statements == []
