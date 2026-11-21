"""SGEC grammar provider PostgreSQL integration tests.

这些用例由主控在专用 PostgreSQL 测试库执行，测试文件本身不连接数据库。
覆盖真实 ``process_job`` / ``execute_claimed_job`` 链路、B2 事件与知识状态、
只读 replay、导出投影、账号删除、失败回滚/重试、stale recovery 与坏批次回滚。

R1 静态 Review 修正：
* 合成路径显式注入 ``SGECGrammarProvider``，不依赖 ``_select_grammar_provider``
  把 ``is_synthetic`` 置为 True。
* 重试路径共享同一受控 payload source，并通过真实 ``claim_next_job`` 领取第二次。
* unmapped 使用显式不在 DB 的扩展标签和 allowed 集合注入。
* DB guard 精确匹配本机/CI profile 与同名 role。
* 不再依赖 learning_event_cutover gate。
"""

import asyncio
import os
import uuid
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import delete, select, text
from sqlalchemy import event as sa_event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from agent_analysis_contract import KnownAnalysisErrorCode
from models.analysis import AnalysisJob, AnalysisJobStatus
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import SEED_SKILLS, KnowledgeState, Skill
from models.learning_event import LearningEvent
from models.session import (
    Session,
    SessionMode,
    SessionStatus,
    Transcript,
    TranscriptRole,
)
from models.user import User
from services import analysis_jobs
from services import analysis_service as service
from services.assessment_providers import AssessmentMetadata
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.learning_event_replay import validate_learning_event_replay
from services.sgec_llm import SGECLLMError
from services.sgec_provider import SGECGrammarProvider
from services.user_account_deletion import delete_user_account
from services.user_data_export import build_user_data_export
from time_utils import utc_now

FROZEN_BKT_VERSION = "bkt-v1"
FROZEN_BKT_PARAMS = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}

_DATABASE_PROFILES = {
    ("127.0.0.1", 55446, "echotalk_b2_main_test"): "echotalk_b2_main_test",
    ("localhost", 5432, "echotalk_test"): "echotalk",
}


def _sgec_database_url():
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail("SGEC pipeline requires explicit test DATABASE_URL", pytrace=False)
    try:
        parsed = make_url(raw)
        split = urlsplit(raw)
        target = (parsed.host, parsed.port, parsed.database)
        valid = (
            parsed.drivername in {"postgresql", "postgresql+asyncpg"}
            and target in _DATABASE_PROFILES
            and parsed.username == _DATABASE_PROFILES[target]
            and not parsed.query
            and not split.fragment
        )
    except Exception:
        pytest.fail("SGEC pipeline test DATABASE_URL is invalid", pytrace=False)
    if not valid:
        pytest.fail("SGEC pipeline test database boundary mismatch", pytrace=False)
    return parsed.set(drivername="postgresql+asyncpg")


class QueuePayloadSource:
    """Shared in-memory source for exactly one retry cycle.

    A fresh ``FakePayloadSource`` would reset ``failure_consumed`` every time
    ``_select_grammar_provider`` is called, so the second attempt could fail
    again without exercising the actual claim/retry path.
    """

    def __init__(self, *, payloads, failure_code=None):
        self.payloads = list(payloads)
        self.failure_code = failure_code
        self.failure_consumed = False
        self.calls = 0

    async def __call__(self, value):
        self.calls += 1
        if self.failure_code is not None and not self.failure_consumed:
            self.failure_consumed = True
            raise SGECLLMError(self.failure_code)
        if not self.payloads:
            raise SGECLLMError("sgec_llm_empty_response")
        return self.payloads.pop(0)


def _metadata(*, synthetic):
    return AssessmentMetadata(
        source="sgec",
        provider="sgec-llm",
        model_version="sgec-test-v1",
        is_synthetic=synthetic,
        confidence=None,
    )


def _mapped_payload(skill_tag="verb_tense_past", *, confidence=None):
    item = {
        "skill_tag": skill_tag,
        "original": "I go",
        "corrected": "I went",
        "error_type": "wrong_tense",
    }
    if confidence is not None:
        item["confidence"] = confidence
    return {"errors": [item]}


def _inject_provider(monkeypatch, *, metadata, allowed_skill_tags, source):
    provider = SGECGrammarProvider(metadata, allowed_skill_tags, source)
    monkeypatch.setattr(service.settings, "USE_MOCK_ELSA", False)
    monkeypatch.setattr(service, "_select_grammar_provider", lambda: provider)
    return provider


def _patch_real_selection_source(monkeypatch, *, source):
    """Exercise the real ``_select_grammar_provider`` branch with valid settings.

    The fake factory must provide every value Core's new pre-flight gate
    requires, otherwise the provider will be rejected before the test payload
    is evaluated.
    """
    monkeypatch.setattr(service.settings, "USE_MOCK_ELSA", False)
    monkeypatch.setattr(service.settings, "SGEC_GRAMMAR_PROVIDER_ENABLED", True)
    monkeypatch.setattr(service.settings, "SGEC_LLM_MODEL", "sgec-test-model")
    monkeypatch.setattr(service.settings, "SGEC_LLM_MODEL_VERSION", "sgec-test-v1")
    monkeypatch.setattr(service.settings, "SGEC_LLM_BASE_URL", "https://sgec.invalid")
    monkeypatch.setattr(service.settings, "SGEC_LLM_API_KEY", "sgec-test-key")
    monkeypatch.setattr(service.settings, "SGEC_LLM_TIMEOUT_SECONDS", 30.0)
    monkeypatch.setattr(service.settings, "SGEC_LLM_MAX_TOKENS", 1024)
    monkeypatch.setattr(service.settings, "SGEC_LLM_MAX_OUTPUT_CHARS", 65536)

    def fake_source(**kwargs):
        assert kwargs["model"] == "sgec-test-model"
        assert kwargs["base_url"] == "https://sgec.invalid"
        assert kwargs["api_key"] == "sgec-test-key"
        assert kwargs["allowed_skill_tags"] == frozenset(
            skill["id"] for skill in SEED_SKILLS
        )
        return source

    monkeypatch.setattr(service, "SGECLLMPayloadSource", fake_source)


async def _add_skill(pipeline, skill_id):
    async with pipeline.factory() as db, db.begin():
        if await db.get(Skill, skill_id) is None:
            db.add(Skill(id=skill_id, name=skill_id, category="grammar"))


@pytest.fixture
async def pipeline(monkeypatch):
    url = _sgec_database_url()
    source_head = ScriptDirectory(
        str(Path(__file__).resolve().parents[1] / "alembic")
    ).get_current_head()
    assert source_head == "b2_ledger_hardening"
    engine = create_async_engine(url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id, session_id, job_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    verified = False
    created_skills = []
    try:
        async with factory() as db, db.begin():
            identity = (
                await db.execute(
                    text(
                        "SELECT current_database(), current_user, "
                        "current_setting('server_version_num')"
                    )
                )
            ).one()
            assert identity == (url.database, url.username, "150019")
            assert (
                await db.scalar(text("SELECT version_num FROM alembic_version"))
                == source_head
            )
            verified = True
            db.add(User(id=user_id, email=f"sgec-{user_id}@example.invalid"))
            await db.flush()
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
                    ended_at=utc_now(),
                )
            )
            await db.flush()
            db.add(
                Transcript(
                    session_id=session_id,
                    role=TranscriptRole.user,
                    content="I go yesterday. This is a test",
                    timestamp_ms=1,
                )
            )
            if await db.get(Skill, "verb_tense_past") is None:
                db.add(
                    Skill(
                        id="verb_tense_past", name="verb_tense_past", category="grammar"
                    )
                )
                created_skills.append("verb_tense_past")
        async with factory() as db, db.begin():
            db.add(AnalysisJob(id=job_id, session_id=session_id))
        monkeypatch.setattr(service.settings, "USE_MOCK_ELSA", False)
        yield SimpleNamespace(
            factory=factory,
            engine=engine,
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
        )
    finally:
        try:
            if verified:
                async with factory() as db, db.begin():
                    await db.execute(
                        delete(LearningEvent).where(LearningEvent.user_id == user_id)
                    )
                    for model in (
                        GrammarError,
                        PronunciationAssessment,
                        Transcript,
                        AnalysisJob,
                    ):
                        await db.execute(
                            delete(model).where(model.session_id == session_id)
                        )
                    await db.execute(
                        delete(KnowledgeState).where(KnowledgeState.user_id == user_id)
                    )
                    await db.execute(delete(Session).where(Session.id == session_id))
                    await db.execute(delete(User).where(User.id == user_id))
                    if created_skills:
                        await db.execute(
                            delete(Skill).where(Skill.id.in_(created_skills))
                        )
        finally:
            await engine.dispose()


async def _claim(pipeline, *, now=None):
    async with pipeline.factory() as db, db.begin():
        assert await analysis_jobs.claim_next_job(db, now=now) == pipeline.job_id


async def _run_job(pipeline):
    await _claim(pipeline)
    await analysis_jobs.process_job(pipeline.job_id, pipeline.factory)


async def _job(pipeline):
    async with pipeline.factory() as db:
        return await db.get(AnalysisJob, pipeline.job_id)


async def _events(pipeline):
    async with pipeline.factory() as db:
        return list(
            (
                await db.execute(
                    select(LearningEvent)
                    .where(LearningEvent.analysis_job_id == pipeline.job_id)
                    .order_by(LearningEvent.apply_seq)
                )
            )
            .scalars()
            .all()
        )


async def _knowledge_states(pipeline):
    async with pipeline.factory() as db:
        return list(
            (
                await db.execute(
                    select(KnowledgeState).where(
                        KnowledgeState.user_id == pipeline.user_id
                    )
                )
            )
            .scalars()
            .all()
        )


def _seven_key_direction(direction):
    assert set(direction) == {
        "status",
        "reason",
        "result_count",
        "reused",
        "metadata",
        "basis",
        "source_facts",
    }


@pytest.mark.parametrize(
    "raw_url",
    [
        (
            "postgresql+asyncpg://echotalk_b2_main_test:pw@"
            "127.0.0.1:55446/echotalk_b2_main_test"
        ),
        ("postgresql://echotalk:pw@localhost:5432/echotalk_test"),
    ],
)
def test_sgec_database_url_accepts_runtime_password(monkeypatch, raw_url):
    monkeypatch.setenv("DATABASE_URL", raw_url)
    assert _sgec_database_url().render_as_string(hide_password=True)


@pytest.mark.parametrize(
    "raw_url",
    [
        ("postgresql+asyncpg://wrong_role:pw@127.0.0.1:55446/echotalk_b2_main_test"),
        (
            "postgresql+asyncpg://echotalk_b2_main_test:pw@"
            "127.0.0.1:55446/echotalk_b2_main_test?sslmode=require"
        ),
        (
            "postgresql+asyncpg://echotalk_b2_main_test:pw@"
            "127.0.0.1:55446/echotalk_b2_main_test#fragment"
        ),
        ("postgresql+asyncpg://echotalk:pw@127.0.0.1:55446/echotalk_b2_main_test"),
        ("postgresql+asyncpg://echotalk_b2_main_test:pw@localhost:5432/echotalk_test"),
    ],
)
def test_sgec_database_url_rejects_guard_mismatch(monkeypatch, raw_url):
    monkeypatch.setenv("DATABASE_URL", raw_url)
    with pytest.raises(BaseException, match="database boundary mismatch"):
        _sgec_database_url()


def _capture_knowledge_sql(pipeline):
    """Assert knowledge tables are not read/written during one pipeline path."""
    statements = []
    target = pipeline.engine.sync_engine
    identifier = "before_cursor_execute"

    def before_execute(conn, cursor, statement, parameters, context, executemany):
        statements.append(str(statement))

    sa_event.listen(target, identifier, before_execute)

    class Capture:
        def snapshot_and_remove(self):
            sa_event.remove(target, identifier, before_execute)
            return list(statements)

    return Capture()


@pytest.mark.asyncio
async def test_real_mapped_sgec_job_writes_events_and_frozen_bkt(pipeline, monkeypatch):
    source = QueuePayloadSource(payloads=[_mapped_payload(confidence=0.72)])
    _patch_real_selection_source(monkeypatch, source=source)
    await _run_job(pipeline)

    job = await _job(pipeline)
    assert job.status == AnalysisJobStatus.succeeded
    events = await _events(pipeline)
    assert [event.event_type for event in events] == [
        "analysis_completed",
        "grammar_observation",
    ]
    completed = events[0]
    coverage = completed.details["coverage"]
    _seven_key_direction(coverage["pronunciation"])
    _seven_key_direction(coverage["grammar"])
    assert coverage["grammar"]["status"] == "evaluated"
    assert coverage["grammar"]["result_count"] == 1
    assert coverage["grammar"]["source_facts"] == {
        "source": "sgec",
        "provider": "sgec-llm",
        "model_version": "sgec-test-v1",
        "is_synthetic": False,
    }
    assert completed.details["unmapped"] == {"pronunciation": 0, "grammar": 0}
    observation = events[1]
    assert observation.skill_id == "verb_tense_past"
    assert observation.observation_code == "wrong_tense"
    assert observation.confidence == 0.72
    assert observation.source == "sgec"
    assert observation.provider == "sgec-llm"
    assert observation.model_version == "sgec-test-v1"
    assert observation.is_synthetic is False

    states = await _knowledge_states(pipeline)
    assert [state.skill_id for state in states] == ["verb_tense_past"]
    params = BKTParams(**FROZEN_BKT_PARAMS)
    assert states[0].p_mastery == update_mastery(params.p_init, False, params)

    report = await validate_learning_event_replay(
        pipeline.factory,
        algorithm_versions={FROZEN_BKT_VERSION: dict(FROZEN_BKT_PARAMS)},
    )
    assert report.issues == ()
    assert report.read_only is True
    assert report.isolation_level == "repeatable read"


@pytest.mark.asyncio
async def test_unmapped_extension_tag_counts_skip_and_writes_no_observation_or_bkt(
    pipeline, monkeypatch
):
    source = QueuePayloadSource(
        payloads=[_mapped_payload(skill_tag="extension:unmapped")]
    )
    _inject_provider(
        monkeypatch,
        metadata=_metadata(synthetic=False),
        allowed_skill_tags=frozenset({"extension:unmapped"}),
        source=source,
    )
    await _run_job(pipeline)

    job = await _job(pipeline)
    assert job.status == AnalysisJobStatus.succeeded
    events = await _events(pipeline)
    assert [event.event_type for event in events] == ["analysis_completed"]
    completed = events[0]
    coverage = completed.details["coverage"]
    assert coverage["grammar"]["status"] == "evaluated"
    assert coverage["grammar"]["result_count"] == 1
    assert completed.details["unmapped"] == {"pronunciation": 0, "grammar": 1}
    assert await _knowledge_states(pipeline) == []


@pytest.mark.asyncio
async def test_zero_error_real_sgec_job_has_evaluated_zero_and_no_bkt(
    pipeline, monkeypatch
):
    source = QueuePayloadSource(payloads=[{"errors": []}])
    _patch_real_selection_source(monkeypatch, source=source)
    await _run_job(pipeline)

    job = await _job(pipeline)
    assert job.status == AnalysisJobStatus.succeeded
    events = await _events(pipeline)
    assert [event.event_type for event in events] == ["analysis_completed"]
    coverage = events[0].details["coverage"]
    assert coverage["grammar"]["status"] == "evaluated"
    assert coverage["grammar"]["result_count"] == 0
    assert coverage["grammar"]["basis"] == "current_invocation"
    assert coverage["grammar"]["source_facts"]["source"] == "sgec"
    assert await _knowledge_states(pipeline) == []


@pytest.mark.asyncio
async def test_synthetic_mapped_job_writes_event_but_no_knowledge_sql_or_state(
    pipeline, monkeypatch
):
    capture = _capture_knowledge_sql(pipeline)
    source = QueuePayloadSource(payloads=[_mapped_payload(confidence=0.4)])
    _inject_provider(
        monkeypatch,
        metadata=_metadata(synthetic=True),
        allowed_skill_tags=frozenset({"verb_tense_past"}),
        source=source,
    )
    await _run_job(pipeline)
    statements = capture.snapshot_and_remove()

    job = await _job(pipeline)
    assert job.status == AnalysisJobStatus.succeeded
    events = await _events(pipeline)
    assert [event.event_type for event in events] == [
        "analysis_completed",
        "grammar_observation",
    ]
    assert events[1].is_synthetic is True
    assert events[1].confidence == 0.4
    assert await _knowledge_states(pipeline) == []
    assert not any(
        "knowledge_states" in statement.casefold() for statement in statements
    )


@pytest.mark.asyncio
async def test_failure_rolls_back_then_same_job_retries_without_duplicate_events(
    pipeline, monkeypatch
):
    canary = "sgec-canary-secret-raw-response"
    source = QueuePayloadSource(
        payloads=[_mapped_payload()],
        failure_code="sgec_llm_transport_failed",
    )
    _patch_real_selection_source(monkeypatch, source=source)
    await _claim(pipeline)
    await analysis_jobs.process_job(pipeline.job_id, pipeline.factory)

    job = await _job(pipeline)
    assert job.status == AnalysisJobStatus.pending
    assert job.attempt_count == 1
    assert job.last_error_code == KnownAnalysisErrorCode.ANALYSIS_FAILED.value
    assert canary not in (job.last_error or "")
    assert await _events(pipeline) == []
    assert await _knowledge_states(pipeline) == []

    retry_now = job.next_retry_at
    await _claim(pipeline, now=retry_now)
    assert source.calls == 1
    await analysis_jobs.process_job(pipeline.job_id, pipeline.factory)
    assert source.calls == 2

    job = await _job(pipeline)
    assert job.status == AnalysisJobStatus.succeeded
    assert job.attempt_count == 2
    events = await _events(pipeline)
    assert [event.event_type for event in events] == [
        "analysis_completed",
        "grammar_observation",
    ]
    assert len(events) == 2


@pytest.mark.asyncio
async def test_cancelled_provider_rolls_back_job_then_stale_recovery_requeues(
    pipeline, monkeypatch
):
    async def fail(value):
        raise asyncio.CancelledError("sgec cancel")

    provider = _inject_provider(
        monkeypatch,
        metadata=_metadata(synthetic=False),
        allowed_skill_tags=frozenset({"verb_tense_past"}),
        source=fail,
    )
    assert provider is not None
    await _claim(pipeline)

    with pytest.raises(asyncio.CancelledError):
        async with pipeline.factory() as db, db.begin():
            await analysis_jobs.execute_claimed_job(pipeline.job_id, db)

    async with pipeline.factory() as db:
        job = await db.get(AnalysisJob, pipeline.job_id)
        assert job.status == AnalysisJobStatus.running
        assert (
            await db.execute(
                select(LearningEvent).where(
                    LearningEvent.analysis_job_id == pipeline.job_id
                )
            )
        ).scalars().all() == []

    now = utc_now()
    async with pipeline.factory() as db, db.begin():
        job = await db.get(AnalysisJob, pipeline.job_id)
        job.started_at = now - timedelta(minutes=6)
        await db.flush()
        assert await analysis_jobs.recover_stale_jobs(db, now=now) == 1
        await db.flush()
        assert job.status == AnalysisJobStatus.pending
        assert job.last_error_code == KnownAnalysisErrorCode.WORKER_TIMEOUT.value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_payload",
    [
        {"not_errors": []},
        {"errors": "bad"},
        {"errors": [{"skill_tag": "verb_tense_past"}]},
        {
            "errors": [
                {
                    "skill_tag": "verb_tense_past",
                    "original": "",
                    "corrected": "ok",
                    "error_type": "wrong_tense",
                }
            ]
        },
        {
            "errors": [
                {
                    "skill_tag": "verb_tense_past",
                    "original": "ok",
                    "corrected": "",
                    "error_type": "wrong_tense",
                }
            ]
        },
        {
            "errors": [
                {
                    "skill_tag": "verb_tense_past",
                    "original": "ok",
                    "corrected": "ok",
                    "error_type": "",
                }
            ]
        },
        {
            "errors": [
                {
                    "skill_tag": "verb_tense_past",
                    "original": "I go",
                    "corrected": "I went",
                    "error_type": "wrong_tense",
                },
                {
                    "skill_tag": "verb_tense_past",
                    "original": "I go",
                    "corrected": "I went",
                    "error_type": "other",
                },
            ]
        },
    ],
)
async def test_bad_payload_rolls_back_job_and_products(
    pipeline, monkeypatch, bad_payload
):
    source = QueuePayloadSource(payloads=[bad_payload])
    _patch_real_selection_source(monkeypatch, source=source)
    await _claim(pipeline)
    await analysis_jobs.process_job(pipeline.job_id, pipeline.factory)

    job = await _job(pipeline)
    assert job.status == AnalysisJobStatus.pending
    assert job.attempt_count == 1
    assert job.last_error_code == KnownAnalysisErrorCode.ANALYSIS_FAILED.value
    assert await _events(pipeline) == []
    assert await _knowledge_states(pipeline) == []


@pytest.mark.asyncio
async def test_export_projects_sgec_facts_and_account_deletion_removes_ledger(
    pipeline, monkeypatch
):
    source = QueuePayloadSource(payloads=[_mapped_payload(confidence=0.9)])
    _patch_real_selection_source(monkeypatch, source=source)
    await _run_job(pipeline)

    export = await build_user_data_export(
        session_factory=pipeline.factory,
        user_id=pipeline.user_id,
    )
    dumped = export.model_dump()
    grammar_rows = [
        row
        for row in dumped.get("grammar_assessments", [])
        if row.get("skill_tag") == "verb_tense_past"
    ]
    assert len(grammar_rows) == 1
    grammar = grammar_rows[0]
    assert grammar["source"] == "sgec"
    assert grammar["provider"] == "sgec-llm"
    assert grammar["model_version"] == "sgec-test-v1"
    assert grammar["is_synthetic"] is False
    assert grammar["confidence"] == 0.9
    event_rows = [
        row
        for row in dumped.get("learning_events", [])
        if row.get("event_type") == "grammar_observation"
    ]
    assert len(event_rows) == 1
    assert event_rows[0]["source"] == "sgec"
    assert event_rows[0]["skill_id"] == "verb_tense_past"
    completed_rows = [
        row
        for row in dumped.get("learning_events", [])
        if row.get("event_type") == "analysis_completed"
    ]
    assert len(completed_rows) == 1
    coverage = completed_rows[0]["details"]["coverage"]["grammar"]
    assert set(coverage) == {
        "status",
        "source",
        "provider",
        "model_version",
        "is_synthetic",
    }
    assert "confidence" not in coverage
    assert coverage["source"] == "sgec"
    assert coverage["provider"] == "sgec-llm"
    assert coverage["model_version"] == "sgec-test-v1"
    assert coverage["is_synthetic"] is False
    assert dumped["knowledge_states"][0]["skill_id"] == "verb_tense_past"

    async with pipeline.factory() as db, db.begin():
        await delete_user_account(db=db, user_id=pipeline.user_id)

    async with pipeline.factory() as db:
        assert await db.get(User, pipeline.user_id) is None
        assert (
            await db.execute(
                select(LearningEvent).where(LearningEvent.user_id == pipeline.user_id)
            )
        ).scalars().all() == []
        assert (
            await db.execute(
                select(KnowledgeState).where(KnowledgeState.user_id == pipeline.user_id)
            )
        ).scalars().all() == []
