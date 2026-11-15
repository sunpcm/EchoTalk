"""Real service/Job wiring. PostgreSQL execution belongs to the Harness."""

import asyncio
import logging
import os
import re
import uuid
from dataclasses import FrozenInstanceError
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from models.analysis import AnalysisJob, AnalysisJobStatus
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
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
from services.assessment_providers import (
    AssessmentMetadata,
    GrammarEvaluation,
    GrammarFinding,
    PronunciationEvaluation,
)
from time_utils import utc_now


def _test_database_url():
    # Same fail-closed loopback/test-name/version boundary as the old worker suite.
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        pytest.fail(
            "provider pipeline requires explicit test DATABASE_URL", pytrace=False
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
            and not parts & {"prod", "production", "qa", "stage", "staging", "live"}
            and not parsed.query
        )
    except Exception:
        pytest.fail("invalid provider pipeline test DATABASE_URL", pytrace=False)
    if not valid:
        pytest.fail("provider pipeline test database boundary mismatch", pytrace=False)
    return parsed.set(drivername="postgresql+asyncpg")


@pytest.fixture
async def pipeline(monkeypatch):
    url = _test_database_url()
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
                        "SELECT current_database(), current_user, current_setting('server_version_num')"
                    )
                )
            ).one()
            assert identity == (url.database, url.username, "150019")
            assert (
                await db.scalar(text("SELECT version_num FROM alembic_version"))
                == "c06_transcript_events"
            )
            verified = True
            db.add(User(id=user_id, email=f"provider-{user_id}@example.invalid"))
            await db.flush()
            db.add(
                Session(
                    id=session_id,
                    user_id=user_id,
                    mode=SessionMode.pronunciation,
                    status=SessionStatus.completed,
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
            db.add(AnalysisJob(id=job_id, session_id=session_id))
            for skill_id, category in (
                ("th_sounds", "pronunciation"),
                ("verb_tense_past", "grammar"),
            ):
                if await db.get(Skill, skill_id) is None:
                    db.add(Skill(id=skill_id, name=skill_id, category=category))
                    created_skills.append(skill_id)
        monkeypatch.setattr(service.settings, "USE_MOCK_ELSA", True)
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


async def _set_text(pipeline, content):
    async with pipeline.factory() as db, db.begin():
        await db.execute(
            delete(Transcript).where(Transcript.session_id == pipeline.session_id)
        )
        if content is not None:
            db.add(
                Transcript(
                    session_id=pipeline.session_id,
                    role=TranscriptRole.user,
                    content=content,
                    timestamp_ms=1,
                )
            )


def _snapshots(monkeypatch):
    values = []
    monkeypatch.setattr(service, "_observe_coverage", values.append)
    return values


def _replacement_providers(
    monkeypatch, p_synthetic=False, g_synthetic=False, populated_metadata=False
):
    declared = AssessmentMetadata("declared-fixture", "declared", "declared", True, 0.5)
    # Legal returned values deliberately differ from BOTH demo and declaration.
    p_metadata = AssessmentMetadata(
        "fixture-pronunciation",
        "fixture-pronunciation-adapter" if populated_metadata else None,
        "fixture-p-v2" if populated_metadata else None,
        p_synthetic,
        None if populated_metadata else 0.0,
    )
    g_metadata = AssessmentMetadata(
        "fixture-grammar",
        None if populated_metadata else "fixture-adapter",
        "fixture-g-v2" if populated_metadata else None,
        g_synthetic,
        None if populated_metadata else 0.0,
    )
    calls = []

    async def pronunciation(value):
        calls.append(("pronunciation", value.text))
        return PronunciationEvaluation(
            p_metadata,
            37.5,
            [
                {
                    "position": 0,
                    "phoneme": "TH",
                    "expected": "TH",
                    "actual": "S",
                    "type": "substitution",
                }
            ],
        )

    async def grammar(value):
        calls.append(("grammar", value.text))
        return GrammarEvaluation(
            declared,
            (
                GrammarFinding(
                    "verb_tense_past",
                    "fixture before",
                    "fixture after",
                    "wrong_tense",
                    g_metadata,
                ),
            ),
        )

    monkeypatch.setattr(
        service,
        "_select_pronunciation_provider",
        lambda: SimpleNamespace(metadata=declared, evaluate=pronunciation),
    )
    monkeypatch.setattr(
        service,
        "_select_grammar_provider",
        lambda: SimpleNamespace(metadata=declared, evaluate=grammar),
    )
    return calls


async def _claim(pipeline):
    async with pipeline.factory() as db, db.begin():
        assert await analysis_jobs.claim_next_job(db) == pipeline.job_id


async def _job_and_products(pipeline):
    async with pipeline.factory() as db:
        job = await db.get(AnalysisJob, pipeline.job_id)
        counts = tuple(
            [
                await db.scalar(
                    select(func.count())
                    .select_from(model)
                    .where(model.session_id == pipeline.session_id)
                )
                for model in (PronunciationAssessment, GrammarError)
            ]
        )
        return job, counts


def test_legacy_result_has_unknown_coverage_and_keeps_id_alias():
    assert service.SessionAnalysisResult().coverage is None
    assert service.SessionAnalysisResult().id is None
    assessment = SimpleNamespace(id=uuid.uuid4())
    result = service.SessionAnalysisResult(assessment)
    assert result.assessment is assessment
    assert result.id == assessment.id
    assert result.coverage is None
    assert analysis_jobs.analyze_session is service.analyze_session


def test_default_diagnostic_drops_real_metadata_canary(caplog):
    canary = "i1-canary-input-token-response-73"
    metadata = AssessmentMetadata(canary, canary, canary, True, 0.0)
    direction = service.DirectionCoverage(
        "failed", reason="exception", metadata=metadata
    )
    snapshot = service.AnalysisCoverage(
        direction,
        service.DirectionCoverage("not_called"),
        "failed",
        "evaluation",
        "pronunciation",
    )
    with caplog.at_level(logging.INFO, logger=service.__name__):
        service._observe_coverage(snapshot)
    diagnostic = [
        record.getMessage()
        for record in caplog.records
        if "Assessment computation:" in record.getMessage()
    ]
    assert len(diagnostic) == 1
    assert "outcome=failed" in diagnostic[0]
    assert "commit=unconfirmed" in diagnostic[0]
    assert canary not in caplog.text
    assert '"event"' not in diagnostic[0]
    with pytest.raises(FrozenInstanceError):
        snapshot.pronunciation.status = "evaluated"


def test_observer_control_exception_is_not_swallowed(monkeypatch):
    problem = asyncio.CancelledError("fixture control exception")

    def interrupted(snapshot):
        raise problem

    monkeypatch.setattr(service, "_observe_coverage", interrupted)
    snapshot = service.AnalysisCoverage(
        service.DirectionCoverage("not_called"),
        service.DirectionCoverage("not_called"),
        "running",
        "orchestration",
    )
    with pytest.raises(asyncio.CancelledError) as caught:
        service._publish_coverage(snapshot)
    assert caught.value is problem


@pytest.mark.asyncio
@pytest.mark.parametrize("synthetic", [False, True])
@pytest.mark.parametrize("populated_metadata", [False, True])
async def test_replacement_return_metadata_is_persisted_not_demo_or_declaration(
    pipeline, monkeypatch, synthetic, populated_metadata
):
    calls = _replacement_providers(
        monkeypatch, synthetic, synthetic, populated_metadata
    )
    async with pipeline.factory() as db, db.begin():
        result = await service.analyze_session(pipeline.session_id, db)
        assert [name for name, _ in calls] == ["pronunciation", "grammar"]
        assert result.coverage.pronunciation.result_count == 1
        assert result.coverage.grammar.result_count == 1
        assert result.coverage.pronunciation.metadata.source == "fixture-pronunciation"
        assert result.coverage.grammar.metadata.source == "declared-fixture"
        result_id = result.id
    async with pipeline.factory() as db:
        assessment = await db.scalar(
            select(PronunciationAssessment).where(
                PronunciationAssessment.session_id == pipeline.session_id
            )
        )
        error = await db.scalar(
            select(GrammarError).where(GrammarError.session_id == pipeline.session_id)
        )
        assert assessment.id == result_id
        assert (
            assessment.source,
            assessment.provider,
            assessment.model_version,
            assessment.confidence,
        ) == (
            "fixture-pronunciation",
            "fixture-pronunciation-adapter" if populated_metadata else None,
            "fixture-p-v2" if populated_metadata else None,
            None if populated_metadata else 0.0,
        )
        assert assessment.is_synthetic is synthetic
        assert assessment.overall_score == 37.5
        assert assessment.phoneme_alignment[0]["actual"] == "S"
        assert (
            assessment.provider_response_ref is None
            and assessment.elsa_response is None
        )
        assert (
            error.source,
            error.provider,
            error.model_version,
            error.confidence,
        ) == (
            "fixture-grammar",
            None if populated_metadata else "fixture-adapter",
            "fixture-g-v2" if populated_metadata else None,
            None if populated_metadata else 0.0,
        )
        assert error.is_synthetic is synthetic
        assert (error.original, error.corrected) == ("fixture before", "fixture after")


@pytest.mark.asyncio
async def test_real_demo_keeps_order_metadata_and_internal_coverage(pipeline):
    async with pipeline.factory() as db, db.begin():
        await db.execute(
            delete(Transcript).where(Transcript.session_id == pipeline.session_id)
        )
        db.add_all(
            [
                Transcript(
                    session_id=pipeline.session_id,
                    role=TranscriptRole.user,
                    content="yesterday",
                    timestamp_ms=20,
                ),
                Transcript(
                    session_id=pipeline.session_id,
                    role=TranscriptRole.user,
                    content="I go",
                    timestamp_ms=10,
                ),
            ]
        )
        await db.flush()
        result = await service.analyze_session(pipeline.session_id, db)
        assert result.coverage.outcome == "completed"
        assert result.coverage.commit_status == "unconfirmed"
        assert result.coverage.pronunciation.status == "evaluated"
        assert result.coverage.pronunciation.result_count == len(
            result.assessment.phoneme_alignment
        )
        assert result.coverage.grammar.status == "evaluated"
        assert result.coverage.grammar.result_count == 1
        assert (
            result.assessment.source,
            result.assessment.provider,
            result.assessment.model_version,
            result.assessment.is_synthetic,
            result.assessment.confidence,
        ) == ("demo_mock", None, "demo-phoneme-rules-v1", True, 0.0)
        error = await db.scalar(
            select(GrammarError).where(GrammarError.session_id == pipeline.session_id)
        )
        assert (error.original, error.corrected) == ("I go", "I went")
        assert (
            error.source,
            error.provider,
            error.model_version,
            error.is_synthetic,
            error.confidence,
        ) == ("demo_rule", None, "demo-grammar-rules-v1", True, 0.5)


@pytest.mark.asyncio
async def test_no_transcript_is_not_empty_success_and_never_selects_provider(
    pipeline, monkeypatch
):
    await _set_text(pipeline, None)
    snapshots = _snapshots(monkeypatch)

    def forbidden():
        pytest.fail("no transcript must not select a provider")

    monkeypatch.setattr(service, "_select_pronunciation_provider", forbidden)
    monkeypatch.setattr(service, "_select_grammar_provider", forbidden)
    async with pipeline.factory() as db, db.begin():
        assert await service.analyze_session(pipeline.session_id, db) is None
    final = snapshots[-1]
    assert final.outcome == "no_input"
    assert final.pronunciation.status == final.grammar.status == "not_called"
    assert final.pronunciation.reason == final.grammar.reason == "no_user_transcript"
    assert final.pronunciation.result_count is None
    assert final.grammar.metadata is None


@pytest.mark.asyncio
@pytest.mark.parametrize("content", ["   ", "!!! ???"])
async def test_existing_blank_or_punctuation_transcript_is_evaluated_zero(
    pipeline, content
):
    await _set_text(pipeline, content)
    async with pipeline.factory() as db, db.begin():
        result = await service.analyze_session(pipeline.session_id, db)
        assert result.assessment is not None and result.id is not None
        assert result.assessment.overall_score == 0.0
        assert result.assessment.phoneme_alignment == []
        assert result.coverage.pronunciation.status == "evaluated"
        assert result.coverage.pronunciation.result_count == 0
        assert result.coverage.grammar.status == "evaluated"
        assert result.coverage.grammar.result_count == 0


@pytest.mark.asyncio
async def test_dynamic_gate_and_two_independent_idempotence_boundaries(
    pipeline, monkeypatch
):
    calls = _replacement_providers(monkeypatch)
    monkeypatch.setattr(service.settings, "USE_MOCK_ELSA", False)
    async with pipeline.factory() as db, db.begin():
        first = await service.analyze_session(pipeline.session_id, db)
        assert first.assessment is None and first.id is None
        assert first.coverage.pronunciation.reason == "disabled"
        assert [name for name, _ in calls] == ["grammar"]
    monkeypatch.setattr(service.settings, "USE_MOCK_ELSA", True)
    async with pipeline.factory() as db, db.begin():
        second = await service.analyze_session(pipeline.session_id, db)
        assert [name for name, _ in calls] == ["grammar", "pronunciation"]
        assert second.coverage.pronunciation.status == "evaluated"
        assert second.coverage.grammar.status == "not_called"
        assert second.coverage.grammar.reused is True
        assert second.coverage.grammar.metadata is None
        assert second.coverage.grammar.result_count is None
        saved_id = second.id
    async with pipeline.factory() as db, db.begin():
        third = await service.analyze_session(pipeline.session_id, db)
        assert third.id == saved_id
        assert third.coverage.pronunciation.reason == "existing_result"
        assert third.coverage.pronunciation.reused is True
        assert third.coverage.pronunciation.result_count is None
        assert third.coverage.grammar.reason == "existing_result"
        assert len(calls) == 2


@pytest.mark.asyncio
async def test_existing_pronunciation_keeps_null_false_and_response_bytes(
    pipeline, monkeypatch
):
    original_id = uuid.uuid4()
    async with pipeline.factory() as db, db.begin():
        db.add(
            PronunciationAssessment(
                id=original_id,
                session_id=pipeline.session_id,
                overall_score=19.5,
                phoneme_alignment=[],
                source="legacy-fixture",
                provider=None,
                model_version=None,
                is_synthetic=False,
                confidence=None,
                provider_response_ref="fixture-ref",
                elsa_response={"fixture": [1, None]},
            )
        )

    def forbidden():
        pytest.fail("existing pronunciation cannot choose or evaluate a new provider")

    monkeypatch.setattr(service, "_select_pronunciation_provider", forbidden)
    async with pipeline.factory() as db, db.begin():
        result = await service.analyze_session(pipeline.session_id, db)
        assert result.id == original_id
        assert result.coverage.pronunciation.status == "not_called"
        assert result.coverage.pronunciation.metadata == AssessmentMetadata(
            "legacy-fixture", None, None, False, None
        )
        assert result.coverage.grammar.status == "evaluated"
        row = result.assessment
        assert (
            row.source,
            row.provider,
            row.model_version,
            row.confidence,
            row.is_synthetic,
        ) == ("legacy-fixture", None, None, None, False)
        assert (row.overall_score, row.provider_response_ref, row.elsa_response) == (
            19.5,
            "fixture-ref",
            {"fixture": [1, None]},
        )


@pytest.mark.asyncio
async def test_grammar_zero_is_invoked_again_without_marker_or_extra_flush(
    pipeline, monkeypatch
):
    await _set_text(pipeline, "Hello.")
    monkeypatch.setattr(service.settings, "USE_MOCK_ELSA", False)
    count = 0
    original = service._select_grammar_provider

    def counted():
        nonlocal count
        count += 1
        return original()

    monkeypatch.setattr(service, "_select_grammar_provider", counted)
    async with pipeline.factory() as db, db.begin():
        flush_count = 0

        async def no_flush():
            nonlocal flush_count
            flush_count += 1

        monkeypatch.setattr(db, "flush", no_flush)
        for _ in range(2):
            result = await service.analyze_session(pipeline.session_id, db)
            assert result.coverage.grammar.status == "evaluated"
            assert result.coverage.grammar.result_count == 0
            assert result.coverage.grammar.reused is False
        assert count == 2
        assert flush_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("direction", ["pronunciation", "grammar"])
@pytest.mark.parametrize("cancelled", [False, True])
async def test_provider_failure_identity_and_failed_snapshot(
    pipeline, monkeypatch, direction, cancelled
):
    snapshots = _snapshots(monkeypatch)
    problem = (
        asyncio.CancelledError("synthetic cancel")
        if cancelled
        else service.AnalysisServiceError(
            "analysis_failed", "safe fixture failure", retryable=False
        )
    )

    async def fail(value):
        raise problem

    provider = SimpleNamespace(
        metadata=AssessmentMetadata("fixture", None, None, True, 0.0), evaluate=fail
    )
    monkeypatch.setattr(service, f"_select_{direction}_provider", lambda: provider)
    with pytest.raises(type(problem)) as caught:
        async with pipeline.factory() as db, db.begin():
            await service.analyze_session(pipeline.session_id, db)
    assert caught.value is problem
    if not cancelled:
        assert caught.value.code == "analysis_failed"
        assert caught.value.retryable is False
    final = snapshots[-1]
    failed = getattr(final, direction)
    assert failed.status == "failed"
    assert failed.result_count is None
    assert failed.reason == ("cancelled" if cancelled else "exception")
    assert final.outcome == ("cancelled" if cancelled else "failed")
    assert final.phase == "evaluation" and final.commit_status == "unconfirmed"
    if direction == "pronunciation":
        assert final.grammar.status == "not_called"
        assert final.grammar.reason == (
            "upstream_cancelled" if cancelled else "upstream_failed"
        )
        assert final.grammar.metadata is None
    else:
        assert final.pronunciation.status == "evaluated"
    assert (await _job_and_products(pipeline))[1] == (0, 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [None, []])
async def test_invalid_return_is_failed_not_zero_success(pipeline, monkeypatch, value):
    snapshots = _snapshots(monkeypatch)

    async def invalid(input_value):
        return value

    monkeypatch.setattr(
        service,
        "_select_pronunciation_provider",
        lambda: SimpleNamespace(
            metadata=AssessmentMetadata("fixture", None, None, True, None),
            evaluate=invalid,
        ),
    )
    with pytest.raises(ValueError, match="Invalid pronunciation evaluation"):
        async with pipeline.factory() as db, db.begin():
            await service.analyze_session(pipeline.session_id, db)
    assert snapshots[-1].outcome == "failed"
    assert snapshots[-1].pronunciation.status == "failed"
    assert snapshots[-1].pronunciation.result_count is None
    assert snapshots[-1].grammar.status == "not_called"


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["selection", "query", "flush"])
async def test_orchestration_and_db_failure_are_not_provider_failure(
    pipeline, monkeypatch, stage
):
    snapshots = _snapshots(monkeypatch)
    problem = RuntimeError("private database/selection fixture")
    with pytest.raises(RuntimeError) as caught:
        async with pipeline.factory() as db, db.begin():
            if stage == "selection":

                def reject():
                    raise problem

                monkeypatch.setattr(service, "_select_pronunciation_provider", reject)
            else:

                async def reject(*args, **kwargs):
                    raise problem

                monkeypatch.setattr(
                    db, "execute" if stage == "query" else "flush", reject
                )
            await service.analyze_session(pipeline.session_id, db)
    assert caught.value is problem
    final = snapshots[-1]
    assert final.outcome == "failed"
    assert final.phase == ("persistence" if stage == "flush" else "orchestration")
    assert final.pronunciation.status == (
        "evaluated" if stage == "flush" else "not_called"
    )
    assert final.grammar.status == "not_called"
    assert final.commit_status == "unconfirmed"


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_fails", [False, True])
async def test_observer_ordinary_exception_cannot_override_outcome(
    pipeline, monkeypatch, provider_fails
):
    observed = []

    def broken(snapshot):
        observed.append(snapshot)
        raise RuntimeError("diagnostic fixture failure")

    monkeypatch.setattr(service, "_observe_coverage", broken)
    problem = RuntimeError("original provider fixture failure")
    if provider_fails:

        async def fail(value):
            raise problem

        monkeypatch.setattr(
            service,
            "_select_grammar_provider",
            lambda: SimpleNamespace(
                metadata=AssessmentMetadata("fixture", None, None, True, 0.0),
                evaluate=fail,
            ),
        )
        with pytest.raises(RuntimeError) as caught:
            async with pipeline.factory() as db, db.begin():
                await service.analyze_session(pipeline.session_id, db)
        assert caught.value is problem
        assert observed[-1].outcome == "failed"
    else:
        async with pipeline.factory() as db, db.begin():
            result = await service.analyze_session(pipeline.session_id, db)
            assert result.coverage.outcome == "completed"
            assert result.id is not None
        assert observed[-1].outcome == "completed"


@pytest.mark.asyncio
async def test_real_job_rolls_back_products_and_retains_retry_budget(
    pipeline, monkeypatch, caplog
):
    snapshots = []
    original_observer = service._observe_coverage

    def observed(snapshot):
        snapshots.append(snapshot)
        original_observer(snapshot)

    monkeypatch.setattr(service, "_observe_coverage", observed)
    canary = "i1-canary-secret-provider-response-91"
    await _set_text(pipeline, f"I go yesterday {canary}")

    async def fail(value):
        assert canary in value.text
        raise RuntimeError(canary)

    monkeypatch.setattr(
        service,
        "_select_grammar_provider",
        lambda: SimpleNamespace(
            metadata=AssessmentMetadata(canary, canary, canary, True, None),
            evaluate=fail,
        ),
    )
    with caplog.at_level(logging.INFO):
        for attempt in (1, 2, 3):
            await _claim(pipeline)
            before = utc_now()
            await analysis_jobs.process_job(pipeline.job_id, pipeline.factory)
            after = utc_now()
            job, products = await _job_and_products(pipeline)
            assert products == (0, 0)
            assert job.attempt_count == attempt
            assert job.last_error_code == "analysis_failed"
            assert job.last_error == "Unexpected analysis failure (RuntimeError)"
            if attempt < 3:
                delay = 5 if attempt == 1 else 30
                assert job.status == AnalysisJobStatus.pending
                assert (
                    before + timedelta(seconds=delay)
                    <= job.next_retry_at
                    <= after + timedelta(seconds=delay)
                )
                async with pipeline.factory() as db, db.begin():
                    queued = await db.get(AnalysisJob, pipeline.job_id)
                    queued.next_retry_at = utc_now() - timedelta(seconds=1)
            else:
                assert job.status == AnalysisJobStatus.failed
                assert job.next_retry_at is None
    assert snapshots[-1].outcome == "failed"
    assert snapshots[-1].pronunciation.status == "evaluated"
    assert snapshots[-1].grammar.status == "failed"
    assert snapshots[-1].commit_status == "unconfirmed"
    assert canary not in caplog.text
    assert any(
        "Assessment computation:" in record.getMessage() for record in caplog.records
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["evaluation", "persistence"])
async def test_real_job_cancel_keeps_running_and_rolls_back_partial_products(
    pipeline, monkeypatch, stage
):
    snapshots = _snapshots(monkeypatch)
    await _claim(pipeline)
    entered, release = asyncio.Event(), asyncio.Event()
    if stage == "evaluation":

        async def held(value):
            entered.set()
            await release.wait()
            return GrammarEvaluation(
                AssessmentMetadata("fixture", None, None, True, None), ()
            )

        monkeypatch.setattr(
            service,
            "_select_grammar_provider",
            lambda: SimpleNamespace(
                metadata=AssessmentMetadata("fixture", None, None, True, None),
                evaluate=held,
            ),
        )
    else:
        original_flush = AsyncSession.flush

        async def held(self, *args, **kwargs):
            await original_flush(self, *args, **kwargs)
            entered.set()
            await release.wait()

        monkeypatch.setattr(AsyncSession, "flush", held)
    task = asyncio.create_task(
        analysis_jobs.process_job(pipeline.job_id, pipeline.factory)
    )
    try:
        await asyncio.wait_for(entered.wait(), 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        job, products = await _job_and_products(pipeline)
        assert job.status == AnalysisJobStatus.running
        assert job.attempt_count == 1
        assert job.last_error_code is None and job.next_retry_at is None
        assert products == (0, 0)
        assert snapshots[-1].outcome == "cancelled"
        assert snapshots[-1].phase == stage
        assert snapshots[-1].pronunciation.status == "evaluated"
        assert snapshots[-1].grammar.status == (
            "failed" if stage == "evaluation" else "not_called"
        )
        assert snapshots[-1].commit_status == "unconfirmed"
        assert pipeline.engine.pool.checkedout() == 0
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("p_synthetic", "g_synthetic", "expected"),
    [
        (True, True, set()),
        (False, True, {"th_sounds"}),
        (True, False, {"verb_tense_past"}),
    ],
)
async def test_real_job_bkt_uses_each_persisted_synthetic_flag(
    pipeline, monkeypatch, p_synthetic, g_synthetic, expected
):
    calls = _replacement_providers(monkeypatch, p_synthetic, g_synthetic)
    await _claim(pipeline)
    await analysis_jobs.process_job(pipeline.job_id, pipeline.factory)
    job, products = await _job_and_products(pipeline)
    assert job.status == AnalysisJobStatus.succeeded
    assert products == (1, 1)
    assert [name for name, _ in calls] == ["pronunciation", "grammar"]
    async with pipeline.factory() as db:
        states = (
            await db.scalars(
                select(KnowledgeState).where(KnowledgeState.user_id == pipeline.user_id)
            )
        ).all()
        assert {state.skill_id for state in states} == expected


@pytest.mark.asyncio
async def test_disabled_pronunciation_does_not_hide_old_real_row_from_job_bkt(
    pipeline, monkeypatch
):
    async with pipeline.factory() as db, db.begin():
        db.add(
            PronunciationAssessment(
                id=uuid.uuid4(),
                session_id=pipeline.session_id,
                overall_score=0.0,
                phoneme_alignment=[
                    {
                        "type": "substitution",
                        "expected": "TH",
                        "actual": "S",
                        "position": 0,
                    }
                ],
                source="legacy-fixture",
                provider=None,
                model_version=None,
                is_synthetic=False,
                confidence=None,
            )
        )
    monkeypatch.setattr(service.settings, "USE_MOCK_ELSA", False)
    snapshots = _snapshots(monkeypatch)
    await _claim(pipeline)
    await analysis_jobs.process_job(pipeline.job_id, pipeline.factory)
    job, _ = await _job_and_products(pipeline)
    assert job.status == AnalysisJobStatus.succeeded
    assert snapshots[-1].pronunciation.reason == "disabled"
    assert snapshots[-1].pronunciation.metadata is None
    async with pipeline.factory() as db:
        states = (
            await db.scalars(
                select(KnowledgeState).where(KnowledgeState.user_id == pipeline.user_id)
            )
        ).all()
        assert {state.skill_id for state in states} == {"th_sounds"}
