"""
会话分析管线。
会话结束后，执行发音评估、语法错误检测、BKT 知识状态更新。
由 PostgreSQL 持久化分析任务 worker 异步执行。
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field, replace
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent_analysis_contract import AnalysisPublicErrorCode
from config import settings
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.session import Transcript, TranscriptRole
from services.assessment_providers import (
    AssessmentMetadata,
    DemoMockPronunciationProvider,
    DemoRuleGrammarProvider,
    GrammarProvider,
    PronunciationProvider,
    TranscriptAssessmentInput,
    validate_grammar_evaluation,
    validate_pronunciation_evaluation,
)
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.knowledge.skill_updater import phoneme_error_to_skill
from time_utils import utc_now

logger = logging.getLogger(__name__)


class AnalysisServiceError(RuntimeError):
    """Expected analysis failure safe to expose through a stable code."""

    def __init__(
        self, code: AnalysisPublicErrorCode, message: str, *, retryable: bool = False
    ):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


CoverageReason = Literal[
    "not_reached",
    "no_user_transcript",
    "disabled",
    "existing_result",
    "completed",
    "exception",
    "cancelled",
    "upstream_failed",
    "upstream_cancelled",
    "orchestration_failed",
    "orchestration_cancelled",
]


@dataclass(frozen=True)
class DirectionCoverage:
    status: Literal["not_called", "evaluated", "failed"]
    result_count: int | None = None
    reason: CoverageReason = "not_reached"
    metadata: AssessmentMetadata | None = None
    reused: bool = False


@dataclass(frozen=True)
class AnalysisCoverage:
    pronunciation: DirectionCoverage
    grammar: DirectionCoverage
    outcome: Literal["running", "completed", "failed", "cancelled", "no_input"]
    phase: Literal["orchestration", "evaluation", "persistence"]
    direction: Literal["pronunciation", "grammar"] | None = None
    commit_status: Literal["unconfirmed"] = "unconfirmed"


@dataclass(frozen=True)
class SessionAnalysisResult:
    """Result of session analysis when user transcripts exist."""

    assessment: PronunciationAssessment | None = None
    coverage: AnalysisCoverage | None = None

    @property
    def id(self) -> uuid.UUID | None:
        return self.assessment.id if self.assessment is not None else None


@dataclass
class _CoverageProgress:
    pronunciation: DirectionCoverage = field(
        default_factory=lambda: DirectionCoverage("not_called")
    )
    grammar: DirectionCoverage = field(
        default_factory=lambda: DirectionCoverage("not_called")
    )
    phase: Literal["orchestration", "evaluation", "persistence"] = "orchestration"
    direction: Literal["pronunciation", "grammar"] | None = None

    def snapshot(self, outcome) -> AnalysisCoverage:
        return AnalysisCoverage(
            self.pronunciation, self.grammar, outcome, self.phase, self.direction
        )

    def mark_unreached(self, reason: CoverageReason) -> None:
        for name in ("pronunciation", "grammar"):
            current = getattr(self, name)
            if current.reason == "not_reached":
                setattr(self, name, replace(current, reason=reason))


def _observe_coverage(snapshot: AnalysisCoverage) -> None:
    """Computation diagnostics only; neither a committed job nor B2 event."""
    logger.info(
        "Assessment computation: outcome=%s phase=%s direction=%s "
        "pronunciation=%s/%s/%s reused=%s grammar=%s/%s/%s reused=%s "
        "commit=unconfirmed",
        snapshot.outcome,
        snapshot.phase,
        snapshot.direction,
        snapshot.pronunciation.status,
        snapshot.pronunciation.reason,
        snapshot.pronunciation.result_count,
        snapshot.pronunciation.reused,
        snapshot.grammar.status,
        snapshot.grammar.reason,
        snapshot.grammar.result_count,
        snapshot.grammar.reused,
    )


def _publish_coverage(snapshot: AnalysisCoverage) -> None:
    try:
        _observe_coverage(snapshot)
    except Exception:
        # Ordinary diagnostic failures cannot alter the analysis outcome.
        pass


def _select_pronunciation_provider() -> PronunciationProvider:
    return DemoMockPronunciationProvider()


def _select_grammar_provider() -> GrammarProvider:
    return DemoRuleGrammarProvider()


def _existing_metadata(assessment: PronunciationAssessment) -> AssessmentMetadata:
    return AssessmentMetadata(
        assessment.source,
        assessment.provider,
        assessment.model_version,
        assessment.is_synthetic,
        assessment.confidence,
    )


async def analyze_session(
    session_id: uuid.UUID, db: AsyncSession
) -> SessionAnalysisResult | None:
    """Analyze transcript text within the caller's original transaction."""
    progress = _CoverageProgress()
    try:
        stmt = (
            select(Transcript)
            .where(
                Transcript.session_id == session_id,
                Transcript.role == TranscriptRole.user,
            )
            .order_by(Transcript.timestamp_ms)
        )
        result = await db.execute(stmt)
        transcripts = result.scalars().all()
        if not transcripts:
            progress.mark_unreached("no_user_transcript")
            _publish_coverage(progress.snapshot("no_input"))
            logger.info("会话 %s 无用户转录，跳过分析", session_id)
            return None

        full_text = " ".join(t.content for t in transcripts)
        assessment: PronunciationAssessment | None = None
        progress.direction = "pronunciation"
        if settings.USE_MOCK_ELSA:
            existing_result = await db.execute(
                select(PronunciationAssessment).where(
                    PronunciationAssessment.session_id == session_id
                )
            )
            existing = existing_result.scalar_one_or_none()
            if existing is not None:
                logger.info("会话 %s 已有发音评估，跳过重复写入", session_id)
                assessment = existing
                progress.pronunciation = DirectionCoverage(
                    "not_called",
                    reason="existing_result",
                    metadata=_existing_metadata(existing),
                    reused=True,
                )
                _publish_coverage(progress.snapshot("running"))
            else:
                provider = _select_pronunciation_provider()
                metadata = provider.metadata
                progress.phase = "evaluation"
                try:
                    evaluation = await provider.evaluate(
                        TranscriptAssessmentInput(full_text)
                    )
                    validate_pronunciation_evaluation(evaluation)
                except asyncio.CancelledError:
                    progress.pronunciation = DirectionCoverage(
                        "failed", reason="cancelled", metadata=metadata
                    )
                    raise
                except Exception:
                    progress.pronunciation = DirectionCoverage(
                        "failed", reason="exception", metadata=metadata
                    )
                    raise
                progress.pronunciation = DirectionCoverage(
                    "evaluated",
                    len(evaluation.phoneme_alignment),
                    "completed",
                    evaluation.metadata,
                )
                _publish_coverage(progress.snapshot("running"))
                progress.phase = "persistence"
                assessment = PronunciationAssessment(
                    id=uuid.uuid4(),
                    session_id=session_id,
                    overall_score=evaluation.overall_score,
                    phoneme_alignment=evaluation.phoneme_alignment,
                    source=evaluation.metadata.source,
                    provider=evaluation.metadata.provider,
                    model_version=evaluation.metadata.model_version,
                    is_synthetic=evaluation.metadata.is_synthetic,
                    confidence=evaluation.metadata.confidence,
                    provider_response_ref=None,
                    elsa_response=None,
                )
                db.add(assessment)
                await db.flush()
                logger.info(
                    "发音评估完成: session=%s, score=%.1f, phonemes=%d",
                    session_id,
                    evaluation.overall_score,
                    len(evaluation.phoneme_alignment),
                )
        else:
            progress.pronunciation = DirectionCoverage("not_called", reason="disabled")
            _publish_coverage(progress.snapshot("running"))
            logger.info("会话 %s 未启用发音评估服务，跳过发音评估", session_id)

        await _detect_grammar_errors(session_id, full_text, db, progress=progress)
        progress.phase = "orchestration"
        progress.direction = None
        coverage = progress.snapshot("completed")
        _publish_coverage(coverage)
        return SessionAnalysisResult(assessment=assessment, coverage=coverage)
    except asyncio.CancelledError:
        progress.mark_unreached(
            "upstream_cancelled"
            if progress.phase == "evaluation"
            else "orchestration_cancelled"
        )
        _publish_coverage(progress.snapshot("cancelled"))
        raise
    except Exception:
        progress.mark_unreached(
            "upstream_failed"
            if progress.phase == "evaluation"
            else "orchestration_failed"
        )
        _publish_coverage(progress.snapshot("failed"))
        raise


async def _detect_grammar_errors(
    session_id: uuid.UUID, text: str, db: AsyncSession, *, progress: _CoverageProgress
) -> None:
    """Preserve independent grammar existence and nonempty flush boundaries."""
    progress.phase = "orchestration"
    progress.direction = "grammar"
    existing_result = await db.execute(
        select(GrammarError.id).where(GrammarError.session_id == session_id).limit(1)
    )
    if existing_result.scalar_one_or_none() is not None:
        logger.info("会话 %s 已有语法错误记录，跳过重复写入", session_id)
        progress.grammar = DirectionCoverage(
            "not_called", reason="existing_result", reused=True
        )
        _publish_coverage(progress.snapshot("running"))
        return

    provider = _select_grammar_provider()
    metadata = provider.metadata
    progress.phase = "evaluation"
    try:
        evaluation = await provider.evaluate(TranscriptAssessmentInput(text))
        validate_grammar_evaluation(evaluation)
    except asyncio.CancelledError:
        progress.grammar = DirectionCoverage(
            "failed", reason="cancelled", metadata=metadata
        )
        raise
    except Exception:
        progress.grammar = DirectionCoverage(
            "failed", reason="exception", metadata=metadata
        )
        raise
    progress.grammar = DirectionCoverage(
        "evaluated", len(evaluation.findings), "completed", evaluation.metadata
    )
    _publish_coverage(progress.snapshot("running"))
    progress.phase = "persistence"
    for finding in evaluation.findings:
        error = GrammarError(
            id=uuid.uuid4(),
            session_id=session_id,
            skill_tag=finding.skill_tag,
            original=finding.original,
            corrected=finding.corrected,
            error_type=finding.error_type,
            source=finding.metadata.source,
            provider=finding.metadata.provider,
            model_version=finding.metadata.model_version,
            is_synthetic=finding.metadata.is_synthetic,
            confidence=finding.metadata.confidence,
        )
        db.add(error)
    if evaluation.findings:
        await db.flush()
        logger.info(
            "语法错误检测完成: session=%s, errors=%d",
            session_id,
            len(evaluation.findings),
        )


# ───── BKT 知识状态更新 ─────


async def update_knowledge(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """
    根据发音评估和语法错误更新 BKT 知识状态。

    1. 读取 PronunciationAssessment 和 GrammarErrors
    2. 映射每个错误到 skill_id
    3. 调用 BKT update_mastery 更新掌握概率
    4. 写入 KnowledgeState
    """
    # 1. 读取评估数据
    stmt = select(PronunciationAssessment).where(
        PronunciationAssessment.session_id == session_id
    )
    result = await db.execute(stmt)
    assessment = result.scalar_one_or_none()

    stmt = select(GrammarError).where(GrammarError.session_id == session_id)
    result = await db.execute(stmt)
    grammar_errors = result.scalars().all()

    # 2. 按来源门控收集非合成技能观察数据 {skill_id: [correct/incorrect, ...]}
    observations: dict[str, list[bool]] = {}

    if (
        assessment is not None
        and not assessment.is_synthetic
        and assessment.phoneme_alignment
    ):
        for entry in assessment.phoneme_alignment:
            skill_id = phoneme_error_to_skill(entry)
            if skill_id:
                observations.setdefault(skill_id, []).append(entry["type"] == "correct")

    for error in grammar_errors:
        if not error.is_synthetic:
            observations.setdefault(error.skill_tag, []).append(False)

    if not observations:
        logger.info("会话 %s 无可更新的技能", session_id)
        return

    # 3. 验证所有 skill_id 存在于 skills 表
    all_skill_ids = list(observations.keys())
    stmt = select(Skill.id).where(Skill.id.in_(all_skill_ids))
    result = await db.execute(stmt)
    valid_skills = {row[0] for row in result.all()}

    if not valid_skills:
        logger.info("会话 %s 无有效技能需更新", session_id)
        return

    # 4. 批量查询用户在 valid_skills 中的现有 KnowledgeState，避免 N+1 查询
    stmt = select(KnowledgeState).where(
        KnowledgeState.user_id == user_id,
        KnowledgeState.skill_id.in_(valid_skills),
    )
    result = await db.execute(stmt)
    existing_states = {state.skill_id: state for state in result.scalars().all()}

    params = BKTParams()

    for skill_id, obs_list in observations.items():
        if skill_id not in valid_skills:
            continue

        state = existing_states.get(skill_id)
        if state is None:
            state = KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id=skill_id,
                p_mastery=params.p_init,
            )
            db.add(state)
            existing_states[skill_id] = state

        # 逐条观察更新
        for correct in obs_list:
            state.p_mastery = update_mastery(state.p_mastery, correct, params)
        state.updated_at = utc_now()

    await db.flush()
    logger.info(
        "知识状态更新完成: session=%s, skills=%s",
        session_id,
        list(observations.keys()),
    )
