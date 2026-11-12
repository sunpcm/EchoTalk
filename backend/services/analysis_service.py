"""
会话分析管线。
会话结束后，执行发音评估、语法错误检测、BKT 知识状态更新。
由 PostgreSQL 持久化分析任务 worker 异步执行。
"""

import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.session import Transcript, TranscriptRole
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.pronunciation.phoneme_aligner import (
    align_phonemes,
    compute_pronunciation_score,
)
from time_utils import utc_now

logger = logging.getLogger(__name__)

# Frozen BKT version and its four parameters.  These are the only values used
# for derived ``knowledge_states`` updates and are recorded verbatim on the
# completed event so the version fact cannot drift from the computation.
FROZEN_BKT_VERSION = "bkt-v1"
FROZEN_BKT_PARAMS = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}

try:
    import pronouncing
except ImportError:
    pronouncing = None


class AnalysisServiceError(RuntimeError):
    """Expected analysis failure safe to expose through a stable code."""

    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class SessionAnalysisResult:
    """Result of session analysis when user transcripts exist."""

    assessment: PronunciationAssessment | None = None
    grammar_errors: list[GrammarError] = field(default_factory=list)
    coverage: dict[str, Any] = field(default_factory=dict)

    @property
    def id(self) -> uuid.UUID | None:
        return self.assessment.id if self.assessment is not None else None


# ───── 发音分析 ─────


def _get_ref_phonemes(word: str) -> list[str]:
    """获取单词的参考音素序列（优先 CMU 字典，否则字母回退）。"""
    word_lower = word.lower()
    if pronouncing is not None:
        phones = pronouncing.phones_for_word(word_lower)
        if phones:
            # CMU 返回格式如 "AH0 N D"，去掉重音数字
            return [re.sub(r"\d", "", p) for p in phones[0].split()]
    # 回退：每个字母作为一个"音素"
    return [ch.upper() for ch in word_lower if ch.isalpha()]


def _get_mock_user_phonemes(ref_phonemes: list[str], word: str) -> list[str]:
    """Mock 模式：生成用户音素（对 TH 开头词注入替换错误）。"""
    user_phonemes = list(ref_phonemes)
    if word.lower().startswith("th"):
        user_phonemes = ["S" if p in ("TH", "DH") else p for p in user_phonemes]
    return user_phonemes


async def analyze_session(
    session_id: uuid.UUID, db: AsyncSession
) -> SessionAnalysisResult | None:
    """
    发音评估 + 语法错误检测管线。

    1. 获取用户转录文本
    2. 发音可用时拆词并逐词做 NW 对齐，幂等保存 PronunciationAssessment
    3. 独立幂等检测语法错误并保存 GrammarError
    """
    # 1. 获取用户转录
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
        logger.info("会话 %s 无用户转录，跳过分析", session_id)
        return None

    # 2. 合并文本
    full_text = " ".join(t.content for t in transcripts)

    # 3. 发音评估（仅在启用发音 provider/mock 时执行，且保持独立幂等）
    assessment: PronunciationAssessment | None = None
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
        else:
            words = [w for w in re.split(r"\s+", full_text.strip()) if w]
            all_alignment: list[dict] = []
            position_offset = 0

            for word in words:
                clean_word = re.sub(r"[^\w]", "", word)
                if not clean_word:
                    continue

                ref = _get_ref_phonemes(clean_word)
                user = _get_mock_user_phonemes(ref, clean_word)

                if not ref:
                    continue

                word_alignment = align_phonemes(ref, user)
                for entry in word_alignment:
                    entry["position"] = position_offset + entry["position"]
                position_offset += len(word_alignment)

                all_alignment.extend(word_alignment)

            score = compute_pronunciation_score(all_alignment)

            assessment = PronunciationAssessment(
                id=uuid.uuid4(),
                session_id=session_id,
                overall_score=score,
                phoneme_alignment=all_alignment,
                source="demo_mock",
                provider=None,
                model_version="demo-phoneme-rules-v1",
                is_synthetic=True,
                confidence=0.0,
                provider_response_ref=None,
                elsa_response=None,
            )
            db.add(assessment)
            await db.flush()

            logger.info(
                "发音评估完成: session=%s, score=%.1f, phonemes=%d",
                session_id,
                score,
                len(all_alignment),
            )
    else:
        logger.info("会话 %s 未启用发音评估服务，跳过发音评估", session_id)

    # 4. 语法错误检测（独立幂等）
    grammar_errors = await _detect_grammar_errors(session_id, full_text, db)

    coverage = _build_coverage(assessment, grammar_errors)
    return SessionAnalysisResult(
        assessment=assessment,
        grammar_errors=grammar_errors,
        coverage=coverage,
    )


def _build_coverage(
    assessment: PronunciationAssessment | None,
    grammar_errors: Sequence[GrammarError],
) -> dict[str, Any]:
    """Return per-direction coverage facts for the completed event details."""
    first_grammar = grammar_errors[0] if grammar_errors else None
    return {
        "pronunciation": {
            "status": "evaluated" if assessment is not None else "not_called",
            "source": assessment.source if assessment is not None else None,
            "provider": assessment.provider if assessment is not None else None,
            "model_version": assessment.model_version
            if assessment is not None
            else None,
            "is_synthetic": assessment.is_synthetic if assessment is not None else None,
        },
        "grammar": {
            "status": "evaluated",
            "source": first_grammar.source if first_grammar is not None else None,
            "provider": first_grammar.provider if first_grammar is not None else None,
            "model_version": first_grammar.model_version
            if first_grammar is not None
            else None,
            "is_synthetic": first_grammar.is_synthetic
            if first_grammar is not None
            else None,
        },
    }


# ───── 语法错误检测 ─────

# 语法规则模式列表
_GRAMMAR_RULES = [
    {
        "pattern": re.compile(
            r"(?:yesterday|last\s+\w+|ago|before)\b.*?\bI\s+go\b",
            re.IGNORECASE,
        ),
        "skill_tag": "verb_tense_past",
        "error_type": "wrong_tense",
        "extract": re.compile(r"\bI\s+go\b", re.IGNORECASE),
    },
    {
        "pattern": re.compile(r"\bI\s+go\b.*?\byesterday\b", re.IGNORECASE),
        "skill_tag": "verb_tense_past",
        "error_type": "wrong_tense",
        "extract": re.compile(r"\bI\s+go\b", re.IGNORECASE),
    },
    {
        "pattern": re.compile(r"\b(he|she|it)\s+(go|have|do)\b", re.IGNORECASE),
        "skill_tag": "subject_verb_agreement",
        "error_type": "wrong_3p_verb",
        "extract": re.compile(r"\b(he|she|it)\s+(go|have|do)\b", re.IGNORECASE),
    },
    {
        "pattern": re.compile(r"\bI\s+goes\b", re.IGNORECASE),
        "skill_tag": "subject_verb_agreement",
        "error_type": "wrong_3p_verb",
        "extract": re.compile(r"\bI\s+goes\b", re.IGNORECASE),
    },
]


async def _detect_grammar_errors(
    session_id: uuid.UUID, text: str, db: AsyncSession
) -> list[GrammarError]:
    """基于规则的语法错误检测（mock 模式），对同一会话保持独立幂等。

    Returns the grammar errors for this session, either the already-persisted
    rows (idempotent) or the newly created rows from the demo rule engine.
    """
    existing = (
        (
            await db.execute(
                select(GrammarError)
                .where(GrammarError.session_id == session_id)
                .order_by(GrammarError.skill_tag, GrammarError.error_type)
            )
        )
        .scalars()
        .all()
    )
    if existing:
        logger.info("会话 %s 已有语法错误记录，跳过重复写入", session_id)
        return list(existing)

    detected: set[str] = set()  # 避免同一 skill_tag 重复
    created: list[GrammarError] = []

    for rule in _GRAMMAR_RULES:
        if rule["skill_tag"] in detected:
            continue
        match = rule["pattern"].search(text)
        if match:
            # 提取触发片段
            extract_match = rule["extract"].search(text)
            original = extract_match.group() if extract_match else match.group()

            error = GrammarError(
                id=uuid.uuid4(),
                session_id=session_id,
                skill_tag=rule["skill_tag"],
                original=original,
                corrected=_grammar_correction(original, rule["error_type"]),
                error_type=rule["error_type"],
                source="demo_rule",
                provider=None,
                model_version="demo-grammar-rules-v1",
                is_synthetic=True,
                confidence=0.5,
            )
            db.add(error)
            created.append(error)
            detected.add(rule["skill_tag"])

    if detected:
        await db.flush()
        logger.info(
            "语法错误检测完成: session=%s, errors=%s",
            session_id,
            list(detected),
        )
    return created


def _grammar_correction(original: str, error_type: str) -> str:
    """Return the deterministic correction produced by the demo rule engine."""
    if error_type == "wrong_tense":
        return re.sub(r"\bgo\b", "went", original, flags=re.IGNORECASE)
    if original.lower() == "i goes":
        return "I go"
    match = re.match(r"\b(he|she|it)\s+(go|have|do)\b", original, re.IGNORECASE)
    if match:
        replacements = {"go": "goes", "have": "has", "do": "does"}
        return f"{match.group(1)} {replacements[match.group(2).lower()]}"
    return original


# ───── BKT 知识状态更新 ─────


async def _apply_bkt_updates(
    *,
    user_id: uuid.UUID,
    observations: Sequence[dict[str, Any]],
    db: AsyncSession,
) -> None:
    """Apply frozen ``bkt-v1`` updates for already-validated observations.

    ``observations`` are the newly inserted non-synthetic observations in
    ``apply_seq`` order.  This helper only writes ``knowledge_states``; it must
    not re-read source tables or decide which direction was evaluated.
    """
    real = [obs for obs in observations if obs.get("is_synthetic") is not True]
    if not real:
        return

    skill_ids = list({obs["skill_id"] for obs in real})
    result = await db.execute(select(Skill.id).where(Skill.id.in_(skill_ids)))
    valid_skills = {row[0] for row in result.all()}
    if not valid_skills:
        return

    result = await db.execute(
        select(KnowledgeState).where(
            KnowledgeState.user_id == user_id,
            KnowledgeState.skill_id.in_(valid_skills),
        )
    )
    states = {state.skill_id: state for state in result.scalars().all()}

    params = BKTParams(**FROZEN_BKT_PARAMS)
    for obs in real:
        skill_id = obs["skill_id"]
        if skill_id not in valid_skills:
            continue
        state = states.get(skill_id)
        if state is None:
            state = KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id=skill_id,
                p_mastery=params.p_init,
            )
            db.add(state)
            states[skill_id] = state
        state.p_mastery = update_mastery(state.p_mastery, obs["correct"], params)
        state.updated_at = utc_now()

    await db.flush()
