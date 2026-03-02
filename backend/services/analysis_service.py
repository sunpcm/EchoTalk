"""
会话分析管线。
会话结束后，执行发音评估、语法错误检测、BKT 知识状态更新。
当前为 mock 模式（USE_MOCK_CELERY=True），同步运行。
"""

import logging
import re
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.session import Transcript, TranscriptRole
from services.knowledge.bkt_model import BKTParams, update_mastery
from services.knowledge.skill_updater import phoneme_error_to_skill
from services.pronunciation.phoneme_aligner import (
    align_phonemes,
    compute_pronunciation_score,
)

logger = logging.getLogger(__name__)


# ───── 发音分析 ─────


def _get_ref_phonemes(word: str) -> list[str]:
    """获取单词的参考音素序列（优先 CMU 字典，否则字母回退）。"""
    word_lower = word.lower()
    try:
        import pronouncing

        phones = pronouncing.phones_for_word(word_lower)
        if phones:
            # CMU 返回格式如 "AH0 N D"，去掉重音数字
            return [re.sub(r"\d", "", p) for p in phones[0].split()]
    except ImportError:
        pass
    # 回退：每个字母作为一个"音素"
    return [ch.upper() for ch in word_lower if ch.isalpha()]


def _get_mock_user_phonemes(ref_phonemes: list[str], word: str) -> list[str]:
    """Mock 模式：生成用户音素（对 TH 开头词注入替换错误）。"""
    user_phonemes = list(ref_phonemes)
    if word.lower().startswith("th"):
        user_phonemes = ["S" if p in ("TH", "DH") else p for p in user_phonemes]
    return user_phonemes


async def analyze_session(session_id: uuid.UUID, db: AsyncSession) -> None:
    """
    发音评估 + 语法错误检测管线。

    1. 获取用户转录文本
    2. 拆词并逐词做 NW 对齐
    3. 保存 PronunciationAssessment
    4. 检测语法错误并保存 GrammarError
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
        return

    # 2. 合并文本并拆词
    full_text = " ".join(t.content for t in transcripts)
    words = [w for w in re.split(r"\s+", full_text.strip()) if w]

    # 3. 逐词做 NW 对齐
    all_alignment: list[dict] = []
    position_offset = 0

    for word in words:
        # 去除标点
        clean_word = re.sub(r"[^\w]", "", word)
        if not clean_word:
            continue

        ref = _get_ref_phonemes(clean_word)
        user = _get_mock_user_phonemes(ref, clean_word)

        if not ref:
            continue

        word_alignment = align_phonemes(ref, user)
        # 调整全局 position
        for entry in word_alignment:
            entry["position"] = position_offset + entry["position"]
        position_offset += len(word_alignment)

        all_alignment.extend(word_alignment)

    # 4. 计算得分并保存评估结果
    score = compute_pronunciation_score(all_alignment)

    assessment = PronunciationAssessment(
        id=uuid.uuid4(),
        session_id=session_id,
        overall_score=score,
        phoneme_alignment=all_alignment,
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

    # 5. 语法错误检测（mock 模式：简单规则匹配）
    await _detect_grammar_errors(session_id, full_text, db)


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
) -> None:
    """基于规则的语法错误检测（mock 模式）。"""
    detected: set[str] = set()  # 避免同一 skill_tag 重复

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
                corrected="",
                error_type=rule["error_type"],
            )
            db.add(error)
            detected.add(rule["skill_tag"])

    if detected:
        await db.flush()
        logger.info(
            "语法错误检测完成: session=%s, errors=%s",
            session_id,
            list(detected),
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

    # 2. 收集技能观察数据 {skill_id: [correct/incorrect, ...]}
    observations: dict[str, list[bool]] = {}

    if assessment and assessment.phoneme_alignment:
        for entry in assessment.phoneme_alignment:
            skill_id = phoneme_error_to_skill(entry)
            if skill_id:
                observations.setdefault(skill_id, []).append(entry["type"] == "correct")

    for error in grammar_errors:
        observations.setdefault(error.skill_tag, []).append(False)

    if not observations:
        logger.info("会话 %s 无可更新的技能", session_id)
        return

    # 3. 验证所有 skill_id 存在于 skills 表
    all_skill_ids = list(observations.keys())
    stmt = select(Skill.id).where(Skill.id.in_(all_skill_ids))
    result = await db.execute(stmt)
    valid_skills = {row[0] for row in result.all()}

    # 4. 对每个技能执行 BKT 更新
    params = BKTParams()

    for skill_id, obs_list in observations.items():
        if skill_id not in valid_skills:
            continue

        # 获取或创建 KnowledgeState
        stmt = select(KnowledgeState).where(
            KnowledgeState.user_id == user_id,
            KnowledgeState.skill_id == skill_id,
        )
        result = await db.execute(stmt)
        state = result.scalar_one_or_none()

        if state is None:
            state = KnowledgeState(
                id=uuid.uuid4(),
                user_id=user_id,
                skill_id=skill_id,
                p_mastery=params.p_init,
            )
            db.add(state)

        # 逐条观察更新
        for correct in obs_list:
            state.p_mastery = update_mastery(state.p_mastery, correct, params)
        state.updated_at = datetime.utcnow()

    await db.flush()
    logger.info(
        "知识状态更新完成: session=%s, skills=%s",
        session_id,
        list(observations.keys()),
    )
