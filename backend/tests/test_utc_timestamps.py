"""七列 timezone-aware UTC 语义测试套件（RF-08 / A39）。

覆盖：
1. 7 列 ORM 模型定义：timezone=True、NULL 属性、default 与 UserSettings onupdate
2. Pydantic UtcDatetime 模式校验：拒绝 naive 值、接受 aware 且非 UTC 偏移归一至 UTC、JSON 显式 UTC
3. 真实专用 PostgreSQL 数据库 7 列默认提供器省略值写入与 aware UTC 读写
4. UserSettings.updated_at 在实际更新操作时的 onupdate 行为（严格基于 datetime.now(timezone.utc) 真实时钟上下界）
5. 真实生产 create_session / end_session HTTP 路由及 update_knowledge 服务路径的 aware UTC 与显式零偏移断言
6. 失败路径清理韧性回归：未登记 ID 的 KnowledgeState 及 HTTP 会话在 teardown 中安全级联清理，无 FK 违规且 engine 必然 dispose
"""

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, ValidationError
from sqlalchemy import DateTime, delete, or_, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from auth import CurrentUser
from config import settings
from database import get_db
from dependencies import get_current_user
from main import app
from models.analysis import AnalysisJob
from models.call_lease import CallLease
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.session import (
    Session,
    SessionContext,
    SessionMode,
    SessionStatus,
    Transcript,
)
from models.user import User, UserSettings
from schemas.assessment import (
    AssessmentResponse,
    GrammarErrorResponse,
    KnowledgeStateResponse,
    PhonemeAlignmentItem,
)
from schemas.session import (
    AnalysisStatusResponse,
    SessionListItem,
    SessionResponse,
)
from schemas.time import UtcDatetime
from services.analysis_service import update_knowledge
from time_utils import utc_now

# ---------------------------------------------------------------------------
# 1. ORM 模型元数据与列定义测试
# ---------------------------------------------------------------------------


def test_seven_columns_orm_timezone_and_nullability():
    """验证 7 列 ORM 模型均显式声明 DateTime(timezone=True) 及原 nullable 属性。"""
    # 1. users.created_at
    user_created_at = User.__table__.columns["created_at"]
    assert isinstance(user_created_at.type, DateTime)
    assert user_created_at.type.timezone is True
    assert user_created_at.nullable is False
    assert user_created_at.default is not None

    # 2. sessions.started_at
    sess_started_at = Session.__table__.columns["started_at"]
    assert isinstance(sess_started_at.type, DateTime)
    assert sess_started_at.type.timezone is True
    assert sess_started_at.nullable is False
    assert sess_started_at.default is not None

    # 3. sessions.ended_at (nullable)
    sess_ended_at = Session.__table__.columns["ended_at"]
    assert isinstance(sess_ended_at.type, DateTime)
    assert sess_ended_at.type.timezone is True
    assert sess_ended_at.nullable is True

    # 4. user_settings.updated_at
    settings_updated_at = UserSettings.__table__.columns["updated_at"]
    assert isinstance(settings_updated_at.type, DateTime)
    assert settings_updated_at.type.timezone is True
    assert settings_updated_at.nullable is False
    assert settings_updated_at.default is not None
    assert settings_updated_at.onupdate is not None

    # 5. knowledge_states.updated_at
    ks_updated_at = KnowledgeState.__table__.columns["updated_at"]
    assert isinstance(ks_updated_at.type, DateTime)
    assert ks_updated_at.type.timezone is True
    assert ks_updated_at.nullable is False
    assert ks_updated_at.default is not None

    # 6. pronunciation_assessments.created_at
    pa_created_at = PronunciationAssessment.__table__.columns["created_at"]
    assert isinstance(pa_created_at.type, DateTime)
    assert pa_created_at.type.timezone is True
    assert pa_created_at.nullable is False
    assert pa_created_at.default is not None

    # 7. grammar_errors.created_at
    ge_created_at = GrammarError.__table__.columns["created_at"]
    assert isinstance(ge_created_at.type, DateTime)
    assert ge_created_at.type.timezone is True
    assert ge_created_at.nullable is False
    assert ge_created_at.default is not None


def test_utc_now_returns_aware_utc():
    """验证 time_utils.utc_now 返回 timezone-aware UTC datetime 且偏移严格为 0。"""
    now = utc_now()
    assert now.tzinfo is not None
    assert now.tzinfo == timezone.utc
    assert now.utcoffset() == timedelta(0)


# ---------------------------------------------------------------------------
# 2. Pydantic 响应模型与 UtcDatetime 语义测试
# ---------------------------------------------------------------------------


class _SampleUtcModel(BaseModel):
    ts: UtcDatetime
    opt_ts: UtcDatetime | None = None


def test_utc_datetime_rejects_naive_datetime():
    """验证 UtcDatetime 严格拒绝 naive datetime 与 naive ISO 字符串。"""
    naive_dt = datetime(2026, 10, 25, 12, 0, 0)
    with pytest.raises(ValidationError):
        _SampleUtcModel(ts=naive_dt)

    with pytest.raises(ValidationError):
        _SampleUtcModel(ts="2026-10-25T12:00:00")


def test_utc_datetime_normalizes_non_utc_offsets():
    """验证 UtcDatetime 接收带时区输入（如 +08:00），并将其正确归一化为 UTC。"""
    east8 = timezone(timedelta(hours=8))
    dt_e8 = datetime(2026, 10, 25, 20, 0, 0, tzinfo=east8)

    model = _SampleUtcModel(ts=dt_e8)
    assert model.ts.tzinfo == timezone.utc
    assert model.ts.utcoffset() == timedelta(0)
    assert model.ts.hour == 12
    assert model.ts.day == 25

    # 字符串测试
    model_str = _SampleUtcModel(ts="2026-10-25T20:00:00+08:00")
    assert model_str.ts.tzinfo == timezone.utc
    assert model_str.ts.utcoffset() == timedelta(0)
    assert model_str.ts.hour == 12

    # JSON 序列化测试：包含显式 UTC 标记（Z 或 +00:00）
    dumped_json = model.model_dump_json()
    assert "2026-10-25T12:00:00Z" in dumped_json


def test_response_schemas_use_utc_datetime():
    """验证会话、评估和知识状态响应模型使用 UtcDatetime，JSON 包含明确 UTC 标识。"""
    now_utc = datetime.now(timezone.utc)
    now_e8 = now_utc.astimezone(timezone(timedelta(hours=8)))
    s_id = uuid.uuid4()
    u_id = uuid.uuid4()

    # SessionResponse
    sr = SessionResponse(
        id=s_id,
        user_id=u_id,
        mode="free_talk",
        status="active",
        started_at=now_e8,
        ended_at=None,
        transcripts=[],
    )
    assert sr.started_at.tzinfo == timezone.utc
    assert sr.started_at.utcoffset() == timedelta(0)
    assert sr.started_at == now_utc
    assert "Z" in sr.model_dump_json() or "+00:00" in sr.model_dump_json()

    # SessionListItem
    sli = SessionListItem(
        id=s_id,
        mode="free_talk",
        status="active",
        started_at=now_utc,
        ended_at=None,
    )
    assert sli.started_at.tzinfo == timezone.utc
    assert sli.started_at.utcoffset() == timedelta(0)

    # AnalysisStatusResponse
    asr = AnalysisStatusResponse(
        session_id=s_id,
        status="succeeded",
        attempt_count=1,
        retryable=False,
        started_at=now_e8,
        finished_at=now_utc,
        updated_at=now_utc,
    )
    assert asr.started_at is not None and asr.started_at.tzinfo == timezone.utc
    assert asr.finished_at is not None and asr.finished_at.tzinfo == timezone.utc
    assert asr.updated_at.tzinfo == timezone.utc
    assert asr.updated_at.utcoffset() == timedelta(0)

    # AssessmentResponse
    ar = AssessmentResponse(
        id=uuid.uuid4(),
        session_id=s_id,
        overall_score=90.0,
        phoneme_alignment=[
            PhonemeAlignmentItem(
                position=0,
                phoneme="AA",
                expected="AA",
                actual="AA",
                type="correct",
            )
        ],
        source="demo_mock",
        is_synthetic=True,
        created_at=now_utc,
    )
    assert ar.created_at.tzinfo == timezone.utc
    assert ar.created_at.utcoffset() == timedelta(0)

    # GrammarErrorResponse
    ger = GrammarErrorResponse(
        id=uuid.uuid4(),
        session_id=s_id,
        skill_tag="verb_tense_past",
        original="I go",
        corrected="I went",
        error_type="wrong_tense",
        source="demo_rule",
        is_synthetic=True,
        confidence=0.5,
        created_at=now_utc,
    )
    assert ger.created_at.tzinfo == timezone.utc
    assert ger.created_at.utcoffset() == timedelta(0)

    # KnowledgeStateResponse
    ksr = KnowledgeStateResponse(
        id=uuid.uuid4(),
        user_id=u_id,
        skill_id="verb_tense_past",
        skill_name="Past Tense",
        skill_category="grammar",
        p_mastery=0.75,
        updated_at=now_utc,
    )
    assert ksr.updated_at.tzinfo == timezone.utc
    assert ksr.updated_at.utcoffset() == timedelta(0)


# ---------------------------------------------------------------------------
# 3. 真实 PostgreSQL 专用库持久化、默认提供器与 HTTP 链路测试
# ---------------------------------------------------------------------------


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


class _TestClientContext:
    def __init__(self, session_factory, user_id: uuid.UUID, user_email: str):
        self.session_factory = session_factory
        self.user_id = user_id
        self.user_email = user_email
        self.client: AsyncClient | None = None
        self._saved_overrides: dict[Any, Any] = {}

    async def __aenter__(self) -> AsyncClient:
        self._saved_overrides = {
            get_db: app.dependency_overrides.get(get_db),
            get_current_user: app.dependency_overrides.get(get_current_user),
        }

        async def override_db():
            async with self.session_factory() as db:
                try:
                    yield db
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

        async def override_user() -> CurrentUser:
            return CurrentUser(
                id=self.user_id,
                email=self.user_email,
                issuer="urn:echotalk:test",
                subject=str(self.user_id),
            )

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = override_user

        transport = ASGITransport(app=app, raise_app_exceptions=False)
        self.client = AsyncClient(transport=transport, base_url="http://testserver")
        return self.client

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            if self.client:
                await self.client.aclose()
        finally:
            for dep, saved in self._saved_overrides.items():
                if saved is None:
                    app.dependency_overrides.pop(dep, None)
                else:
                    app.dependency_overrides[dep] = saved


@pytest.fixture
async def pg_env():
    """获取专用测试数据库环境，基于测试自有 user/session 归属与 try/finally 级联清理自建行。"""
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip("DATABASE_URL is required for PostgreSQL UTC timestamp tests")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    created_users: list[uuid.UUID] = []
    created_sessions: list[uuid.UUID] = []
    created_assessments: list[uuid.UUID] = []
    created_grammar_errors: list[uuid.UUID] = []
    created_skills: list[str] = []
    created_knowledge_states: list[uuid.UUID] = []

    class PgContext:
        def __init__(self):
            self.session_factory = session_factory
            self.engine = engine

        def track_user(self, u_id: uuid.UUID) -> uuid.UUID:
            created_users.append(u_id)
            return u_id

        def track_session(self, s_id: uuid.UUID) -> uuid.UUID:
            created_sessions.append(s_id)
            return s_id

        def track_assessment(self, pa_id: uuid.UUID) -> uuid.UUID:
            created_assessments.append(pa_id)
            return pa_id

        def track_grammar_error(self, ge_id: uuid.UUID) -> uuid.UUID:
            created_grammar_errors.append(ge_id)
            return ge_id

        def track_skill(self, sk_id: str) -> str:
            created_skills.append(sk_id)
            return sk_id

        def track_knowledge_state(self, ks_id: uuid.UUID) -> uuid.UUID:
            created_knowledge_states.append(ks_id)
            return ks_id

        def make_client(
            self,
            user_id: uuid.UUID,
            user_email: str | None = None,
        ):
            return _TestClientContext(
                session_factory,
                user_id=user_id,
                user_email=user_email or f"utc-{user_id}@example.test",
            )

        async def cleanup(self):
            """以测试自有 user/session 为归属，级联清理所有关联从属行，不影响共享或外部数据。"""
            async with session_factory() as db, db.begin():
                # 1. 发现当前测试自有用户所创建的全部会话（包括未显式 track_session 的会话）
                all_session_ids = set(created_sessions)
                if created_users:
                    res = await db.execute(
                        select(Session.id).where(Session.user_id.in_(created_users))
                    )
                    all_session_ids.update(res.scalars().all())

                sess_list = list(all_session_ids)

                # 2. 级联清理会话及用户相关的从属表（严格子表先于父表）
                if created_users or sess_list:
                    await db.execute(
                        CallLease.__table__.delete().where(
                            (CallLease.user_id.in_(created_users))
                            | (CallLease.session_id.in_(sess_list))
                        )
                    )

                if sess_list:
                    await db.execute(
                        GrammarError.__table__.delete().where(
                            GrammarError.session_id.in_(sess_list)
                        )
                    )
                    await db.execute(
                        PronunciationAssessment.__table__.delete().where(
                            PronunciationAssessment.session_id.in_(sess_list)
                        )
                    )
                    await db.execute(
                        AnalysisJob.__table__.delete().where(
                            AnalysisJob.session_id.in_(sess_list)
                        )
                    )
                    await db.execute(
                        SessionContext.__table__.delete().where(
                            SessionContext.session_id.in_(sess_list)
                        )
                    )
                    await db.execute(
                        Transcript.__table__.delete().where(
                            Transcript.session_id.in_(sess_list)
                        )
                    )

                # 3. 清理当前测试自建用户或自建技能派生的所有 KnowledgeState（先于 Skill 和 User）
                ks_conditions = []
                if created_users:
                    ks_conditions.append(KnowledgeState.user_id.in_(created_users))
                if created_skills:
                    ks_conditions.append(KnowledgeState.skill_id.in_(created_skills))
                if created_knowledge_states:
                    ks_conditions.append(
                        KnowledgeState.id.in_(created_knowledge_states)
                    )

                if ks_conditions:
                    await db.execute(
                        KnowledgeState.__table__.delete().where(or_(*ks_conditions))
                    )

                # 4. 清理会话
                if sess_list:
                    await db.execute(
                        Session.__table__.delete().where(Session.id.in_(sess_list))
                    )

                # 5. 清理当前测试自建的独立技能（绝不清理共享种子技能）
                if created_skills:
                    await db.execute(
                        Skill.__table__.delete().where(Skill.id.in_(created_skills))
                    )

                # 6. 清理当前测试自建用户的设置与用户主表
                if created_users:
                    await db.execute(
                        UserSettings.__table__.delete().where(
                            UserSettings.user_id.in_(created_users)
                        )
                    )
                    await db.execute(
                        User.__table__.delete().where(User.id.in_(created_users))
                    )

                # 清空追踪列表以支持重复安全调用
                created_users.clear()
                created_sessions.clear()
                created_assessments.clear()
                created_grammar_errors.clear()
                created_skills.clear()
                created_knowledge_states.clear()

    ctx = PgContext()
    try:
        yield ctx
    finally:
        try:
            await ctx.cleanup()
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_pg_seven_columns_defaults_and_persisted_utc(pg_env):
    """验证真实 PG 库写读 7 列：在省略时间戳入参时由模型 default 填充 aware UTC，且均满足真实时钟上下界。"""
    u_id = pg_env.track_user(uuid.uuid4())
    s_id = pg_env.track_session(uuid.uuid4())
    pa_id = pg_env.track_assessment(uuid.uuid4())
    ge_id = pg_env.track_grammar_error(uuid.uuid4())
    ks_id = pg_env.track_knowledge_state(uuid.uuid4())
    skill_id = pg_env.track_skill(f"test_sk_{uuid.uuid4().hex[:8]}")

    t_before = datetime.now(timezone.utc)

    async with pg_env.session_factory() as db, db.begin():
        # 1. User: 省略 created_at 入参，测试默认提供器
        user = User(
            id=u_id,
            email=f"utc-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
        )
        db.add(user)

        # 2. UserSettings: 省略 updated_at 入参，测试默认提供器
        settings_obj = UserSettings(
            user_id=u_id,
            is_custom_mode=False,
        )
        db.add(settings_obj)

        # 3. Session: 省略 started_at 入参，ended_at 保持为 None
        session = Session(
            id=s_id,
            user_id=u_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
        )
        db.add(session)

        # 4. Skill
        skill = Skill(
            id=skill_id,
            name="Test Skill",
            category="grammar",
        )
        db.add(skill)

        # 5. KnowledgeState: 省略 updated_at 入参，测试默认提供器
        ks = KnowledgeState(
            id=ks_id,
            user_id=u_id,
            skill_id=skill_id,
            p_mastery=0.5,
        )
        db.add(ks)

        # 6. PronunciationAssessment: 省略 created_at 入参，测试默认提供器
        pa = PronunciationAssessment(
            id=pa_id,
            session_id=s_id,
            overall_score=80.0,
            phoneme_alignment=[],
            source="demo_mock",
            is_synthetic=True,
        )
        db.add(pa)

        # 7. GrammarError: 省略 created_at 入参，测试默认提供器
        ge = GrammarError(
            id=ge_id,
            session_id=s_id,
            skill_tag=skill_id,
            original="I go",
            corrected="I went",
            error_type="wrong_tense",
            source="demo_rule",
            is_synthetic=True,
        )
        db.add(ge)

    t_after = datetime.now(timezone.utc)

    # 验证读取与时间上下界
    async with pg_env.session_factory() as db:
        # 1. User.created_at
        r_user = (await db.execute(select(User).where(User.id == u_id))).scalar_one()
        assert r_user.created_at.tzinfo is not None
        assert r_user.created_at.utcoffset() == timedelta(0)
        assert (
            t_before - timedelta(seconds=2)
            <= r_user.created_at
            <= t_after + timedelta(seconds=2)
        )

        # 2. UserSettings.updated_at
        r_settings = (
            await db.execute(select(UserSettings).where(UserSettings.user_id == u_id))
        ).scalar_one()
        assert r_settings.updated_at.tzinfo is not None
        assert r_settings.updated_at.utcoffset() == timedelta(0)
        assert (
            t_before - timedelta(seconds=2)
            <= r_settings.updated_at
            <= t_after + timedelta(seconds=2)
        )

        # 3. Session.started_at 与 ended_at (nullable)
        r_session = (
            await db.execute(select(Session).where(Session.id == s_id))
        ).scalar_one()
        assert r_session.started_at.tzinfo is not None
        assert r_session.started_at.utcoffset() == timedelta(0)
        assert (
            t_before - timedelta(seconds=2)
            <= r_session.started_at
            <= t_after + timedelta(seconds=2)
        )
        assert r_session.ended_at is None

        # 4. KnowledgeState.updated_at
        r_ks = (
            await db.execute(select(KnowledgeState).where(KnowledgeState.id == ks_id))
        ).scalar_one()
        assert r_ks.updated_at.tzinfo is not None
        assert r_ks.updated_at.utcoffset() == timedelta(0)
        assert (
            t_before - timedelta(seconds=2)
            <= r_ks.updated_at
            <= t_after + timedelta(seconds=2)
        )

        # 5. PronunciationAssessment.created_at
        r_pa = (
            await db.execute(
                select(PronunciationAssessment).where(
                    PronunciationAssessment.id == pa_id
                )
            )
        ).scalar_one()
        assert r_pa.created_at.tzinfo is not None
        assert r_pa.created_at.utcoffset() == timedelta(0)
        assert (
            t_before - timedelta(seconds=2)
            <= r_pa.created_at
            <= t_after + timedelta(seconds=2)
        )

        # 6. GrammarError.created_at
        r_ge = (
            await db.execute(select(GrammarError).where(GrammarError.id == ge_id))
        ).scalar_one()
        assert r_ge.created_at.tzinfo is not None
        assert r_ge.created_at.utcoffset() == timedelta(0)
        assert (
            t_before - timedelta(seconds=2)
            <= r_ge.created_at
            <= t_after + timedelta(seconds=2)
        )


@pytest.mark.asyncio
async def test_pg_user_settings_onupdate_behavior(pg_env):
    """验证 UserSettings 更新时 onupdate 自动更新为新的 aware UTC 时间戳，严格基于真实时钟上下界。"""
    u_id = pg_env.track_user(uuid.uuid4())

    async with pg_env.session_factory() as db, db.begin():
        user = User(
            id=u_id,
            email=f"utc-settings-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
        )
        db.add(user)
        settings_obj = UserSettings(
            user_id=u_id,
            is_custom_mode=False,
        )
        db.add(settings_obj)

    async with pg_env.session_factory() as db:
        st_initial = (
            await db.execute(select(UserSettings).where(UserSettings.user_id == u_id))
        ).scalar_one()
        t_created = st_initial.updated_at
        assert t_created.tzinfo is not None
        assert t_created.utcoffset() == timedelta(0)

    # 触发真实数据更新
    t_update_before = datetime.now(timezone.utc)
    async with pg_env.session_factory() as db, db.begin():
        st = (
            await db.execute(select(UserSettings).where(UserSettings.user_id == u_id))
        ).scalar_one()
        st.is_custom_mode = True

    t_update_after = datetime.now(timezone.utc)

    # 验证 onupdate
    async with pg_env.session_factory() as db:
        st_after = (
            await db.execute(select(UserSettings).where(UserSettings.user_id == u_id))
        ).scalar_one()
        assert st_after.updated_at.tzinfo is not None
        assert st_after.updated_at.utcoffset() == timedelta(0)
        assert st_after.updated_at >= t_created
        assert (
            t_update_before - timedelta(seconds=2)
            <= st_after.updated_at
            <= t_update_after + timedelta(seconds=2)
        )


@pytest.mark.asyncio
async def test_http_session_create_and_end_utc_paths(pg_env):
    """验证生产 create_session 与 end_session HTTP 路径返回显式 UTC JSON，且 DB 时间具备零偏移。"""
    u_id = pg_env.track_user(uuid.uuid4())

    async with pg_env.session_factory() as db, db.begin():
        user = User(
            id=u_id,
            email=f"utc-http-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
        )
        db.add(user)

    async with pg_env.make_client(user_id=u_id) as client:
        # 1. POST /api/sessions 创建会话
        t_create_before = datetime.now(timezone.utc)
        resp_create = await client.post("/api/sessions", json={"mode": "free_talk"})
        t_create_after = datetime.now(timezone.utc)

        assert resp_create.status_code == 200
        data_create = resp_create.json()
        s_id = pg_env.track_session(uuid.UUID(data_create["id"]))

        # 验证 JSON 响应具有显式 UTC（Z 或 +00:00）且值在真实时钟上下界内
        raw_started_at = data_create["started_at"]
        assert raw_started_at.endswith("Z") or "+00:00" in raw_started_at
        parsed_started_at = datetime.fromisoformat(raw_started_at)
        assert parsed_started_at.utcoffset() == timedelta(0)
        assert (
            t_create_before - timedelta(seconds=2)
            <= parsed_started_at
            <= t_create_after + timedelta(seconds=2)
        )
        assert data_create["ended_at"] is None

        # 验证数据库中持久化的 started_at
        async with pg_env.session_factory() as db:
            db_session = (
                await db.execute(select(Session).where(Session.id == s_id))
            ).scalar_one()
            assert db_session.started_at.tzinfo is not None
            assert db_session.started_at.utcoffset() == timedelta(0)
            assert db_session.ended_at is None

        # 2. POST /api/sessions/{session_id}/end 结束会话 (mock dispatch/disabled 模式)
        with patch.object(settings, "CALL_LEASE_MODE", "disabled"):
            t_end_before = datetime.now(timezone.utc)
            resp_end = await client.post(f"/api/sessions/{s_id}/end")
            t_end_after = datetime.now(timezone.utc)

            assert resp_end.status_code == 200
            data_end = resp_end.json()
            raw_ended_at = data_end["ended_at"]
            assert raw_ended_at is not None
            assert raw_ended_at.endswith("Z") or "+00:00" in raw_ended_at
            parsed_ended_at = datetime.fromisoformat(raw_ended_at)
            assert parsed_ended_at.utcoffset() == timedelta(0)
            assert (
                t_end_before - timedelta(seconds=2)
                <= parsed_ended_at
                <= t_end_after + timedelta(seconds=2)
            )

        # 验证数据库中持久化的 ended_at
        async with pg_env.session_factory() as db:
            db_session_end = (
                await db.execute(select(Session).where(Session.id == s_id))
            ).scalar_one()
            assert db_session_end.ended_at.tzinfo is not None
            assert db_session_end.ended_at.utcoffset() == timedelta(0)


@pytest.mark.asyncio
async def test_update_knowledge_writes_explicit_zero_offset_utc(pg_env):
    """验证 update_knowledge 服务路径写入 KnowledgeState 时明确具有零偏移 (timedelta(0))。"""
    u_id = pg_env.track_user(uuid.uuid4())
    s_id = pg_env.track_session(uuid.uuid4())
    skill_id = pg_env.track_skill(f"test_sk_{uuid.uuid4().hex[:8]}")

    async with pg_env.session_factory() as db, db.begin():
        user = User(
            id=u_id,
            email=f"utc-ks-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
        )
        db.add(user)
        session = Session(
            id=s_id,
            user_id=u_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
        )
        db.add(session)
        skill = Skill(id=skill_id, name="UTC Test Skill", category="grammar")
        db.add(skill)

        # 插入非 synthetic 的 GrammarError 触发 update_knowledge
        ge = GrammarError(
            id=pg_env.track_grammar_error(uuid.uuid4()),
            session_id=s_id,
            skill_tag=skill_id,
            original="I go",
            corrected="I went",
            error_type="wrong_tense",
            source="test_rule",
            is_synthetic=False,
        )
        db.add(ge)

    t_before = datetime.now(timezone.utc)
    async with pg_env.session_factory() as db:
        await update_knowledge(s_id, u_id, db)
        await db.commit()
    t_after = datetime.now(timezone.utc)

    async with pg_env.session_factory() as db:
        ks = (
            await db.execute(
                select(KnowledgeState).where(
                    KnowledgeState.user_id == u_id,
                    KnowledgeState.skill_id == skill_id,
                )
            )
        ).scalar_one()
        pg_env.track_knowledge_state(ks.id)

        assert ks.updated_at.tzinfo is not None
        assert ks.updated_at.utcoffset() == timedelta(0)
        assert (
            t_before - timedelta(seconds=2)
            <= ks.updated_at
            <= t_after + timedelta(seconds=2)
        )


# ---------------------------------------------------------------------------
# 4. 失败清理韧性回归测试 (独立探针复现防御)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_teardown_cleans_unregistered_knowledge_state_without_fk_error(
    pg_env,
):
    """验证知识状态更新已提交但未登记ID时，teardown通过归属用户与技能级联清理，不发生FK异常且保留共享/其它测试数据。"""
    u_id = pg_env.track_user(uuid.uuid4())
    s_id = pg_env.track_session(uuid.uuid4())
    skill_id = pg_env.track_skill(f"test_reg_sk_{uuid.uuid4().hex[:8]}")

    # 模拟其它测试或共享的数据（未被当前 pg_env 跟踪）
    other_u_id = uuid.uuid4()
    shared_skill_id = f"shared_sk_{uuid.uuid4().hex[:8]}"

    async with pg_env.session_factory() as db, db.begin():
        # 写入其它用户与共享技能
        other_user = User(
            id=other_u_id,
            email=f"other-{other_u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(other_u_id),
        )
        db.add(other_user)
        shared_skill = Skill(
            id=shared_skill_id, name="Shared Skill", category="grammar"
        )
        db.add(shared_skill)

        # 写入自有用户、会话、自有技能及语法错误
        user = User(
            id=u_id,
            email=f"reg-ks-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
        )
        db.add(user)
        session = Session(
            id=s_id,
            user_id=u_id,
            mode=SessionMode.free_talk,
            status=SessionStatus.completed,
        )
        db.add(session)
        skill = Skill(id=skill_id, name="Regression Skill", category="grammar")
        db.add(skill)
        ge = GrammarError(
            id=pg_env.track_grammar_error(uuid.uuid4()),
            session_id=s_id,
            skill_tag=skill_id,
            original="I go",
            corrected="I went",
            error_type="wrong_tense",
            source="test_reg",
            is_synthetic=False,
        )
        db.add(ge)

    try:
        # 提交知识更新，生成 KnowledgeState，但故意模拟未执行 track_knowledge_state
        async with pg_env.session_factory() as db:
            await update_knowledge(s_id, u_id, db)
            await db.commit()

        # 执行清理：必须成功且不产生 FK IntegrityError
        await pg_env.cleanup()

        # 验证自有行全部清理完毕
        async with pg_env.session_factory() as db:
            r_u = (
                await db.execute(select(User).where(User.id == u_id))
            ).scalar_one_or_none()
            assert r_u is None
            r_sk = (
                await db.execute(select(Skill).where(Skill.id == skill_id))
            ).scalar_one_or_none()
            assert r_sk is None

            # 验证其它用户与共享技能不受影响
            r_other_u = (
                await db.execute(select(User).where(User.id == other_u_id))
            ).scalar_one_or_none()
            assert r_other_u is not None
            r_shared_sk = (
                await db.execute(select(Skill).where(Skill.id == shared_skill_id))
            ).scalar_one_or_none()
            assert r_shared_sk is not None
    finally:
        # 清理模拟的外部数据，保持测试库干净
        async with pg_env.session_factory() as db, db.begin():
            await db.execute(delete(User).where(User.id == other_u_id))
            await db.execute(delete(Skill).where(Skill.id == shared_skill_id))


@pytest.mark.asyncio
async def test_teardown_cleans_unregistered_http_session_without_fk_error(
    pg_env,
):
    """验证HTTP会话创建已提交但未登记session时，teardown通过用户反查级联清理，不发生FK异常且可再次执行。"""
    u_id = pg_env.track_user(uuid.uuid4())

    async with pg_env.session_factory() as db, db.begin():
        user = User(
            id=u_id,
            email=f"reg-http-{u_id}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id),
        )
        db.add(user)

    async with pg_env.make_client(user_id=u_id) as client:
        resp = await client.post("/api/sessions", json={"mode": "free_talk"})
        assert resp.status_code == 200
        # 故意模拟未调用 pg_env.track_session

    # 执行清理：通过归属用户反查到 session，成功清理且不产生 FK 异常
    await pg_env.cleanup()

    # 验证自有用户与会话全部消失
    async with pg_env.session_factory() as db:
        r_u = (
            await db.execute(select(User).where(User.id == u_id))
        ).scalar_one_or_none()
        assert r_u is None
        r_s = (
            (await db.execute(select(Session).where(Session.user_id == u_id)))
            .scalars()
            .all()
        )
        assert len(r_s) == 0

    # 验证后续可再次执行无残留冲突
    u_id_again = pg_env.track_user(uuid.uuid4())
    async with pg_env.session_factory() as db, db.begin():
        user_again = User(
            id=u_id_again,
            email=f"reg-http-{u_id_again}@example.test",
            auth_issuer="urn:echotalk:test",
            auth_subject=str(u_id_again),
        )
        db.add(user_again)

    async with pg_env.make_client(user_id=u_id_again) as client:
        resp_again = await client.post("/api/sessions", json={"mode": "free_talk"})
        assert resp_again.status_code == 200
