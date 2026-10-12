"""
多维学习报告生成任务。
使用 Celery 异步执行，避免阻塞请求线程。

依赖: Celery + Redis（USE_MOCK_CELERY=True 时同步执行）
"""

import asyncio
import concurrent.futures
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session_maker
from models.exercise import GrammarError
from models.knowledge import Skill
from models.session import Session

logger = logging.getLogger(__name__)

SUGGESTIONS_MAP: dict[str, str] = {
    "verb_tense_past": "Pay attention to past tense verb forms when describing past events (e.g., use 'went' instead of 'go').",
    "subject_verb_agreement": "Ensure subject and verb agree in number and person, especially for 3rd person singular (e.g., 'he goes', 'she has').",
    "article_usage": "Pay attention to article usage (a/an/the) before countable and uncountable nouns.",
    "preposition": "Practice preposition collocations in common context phrases (e.g., 'at night', 'in the morning').",
    "verb_tense_present": "Use present tense for general facts and routines; remember third-person singular -s/-es endings.",
    "wrong_tense": "Check verb tenses to ensure consistency with the time frame of your statement.",
    "wrong_3p_verb": "Remember to conjugate third-person singular verbs in present tense (e.g., 'he does', 'she goes').",
}


def get_suggestion_for_error(
    skill_tag: str, error_type: str, skill_desc: str | None = None
) -> str:
    """Get actionable improvement suggestion for a grammar error."""
    if error_type in SUGGESTIONS_MAP:
        return SUGGESTIONS_MAP[error_type]
    if skill_tag in SUGGESTIONS_MAP:
        return SUGGESTIONS_MAP[skill_tag]
    if skill_desc:
        return f"Practice targeted exercises focusing on: {skill_desc}."
    clean_tag = skill_tag.replace("_", " ")
    return f"Review and practice rules for {clean_tag}."


async def compile_top_grammar_errors(
    user_id: str | uuid.UUID,
    db: AsyncSession,
    limit: int = 3,
    time_window_days: int | None = None,
) -> list[dict]:
    """
    Query grammar_errors table to find the user's most frequent grammar mistakes
    and provide suggestions for improvement.
    """
    if isinstance(user_id, str):
        try:
            user_uuid = uuid.UUID(user_id)
        except ValueError:
            logger.error("Invalid user_id format: %s", user_id)
            return []
    else:
        user_uuid = user_id

    # Base query joining GrammarError with Session and Skill
    stmt = (
        select(
            GrammarError.skill_tag,
            GrammarError.error_type,
            func.count(GrammarError.id).label("error_count"),
            Skill.name.label("skill_name"),
            Skill.description.label("skill_description"),
        )
        .join(Session, GrammarError.session_id == Session.id)
        .outerjoin(Skill, GrammarError.skill_tag == Skill.id)
        .where(Session.user_id == user_uuid)
    )

    if time_window_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=time_window_days)
        stmt = stmt.where(GrammarError.created_at >= cutoff)

    stmt = (
        stmt.group_by(
            GrammarError.skill_tag,
            GrammarError.error_type,
            Skill.name,
            Skill.description,
        )
        .order_by(desc("error_count"), GrammarError.skill_tag)
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    top_errors = []
    for row in rows:
        skill_tag = row.skill_tag
        error_type = row.error_type
        error_count = row.error_count
        skill_name = row.skill_name or skill_tag
        skill_desc = row.skill_description

        # Query recent concrete examples for this (skill_tag, error_type)
        example_stmt = (
            select(GrammarError.original, GrammarError.corrected)
            .join(Session, GrammarError.session_id == Session.id)
            .where(
                Session.user_id == user_uuid,
                GrammarError.skill_tag == skill_tag,
                GrammarError.error_type == error_type,
            )
            .order_by(desc(GrammarError.created_at))
            .limit(3)
        )
        example_res = await db.execute(example_stmt)
        examples = [
            {"original": ex.original, "corrected": ex.corrected}
            for ex in example_res.all()
        ]

        suggestion = get_suggestion_for_error(skill_tag, error_type, skill_desc)

        top_errors.append(
            {
                "skill_tag": skill_tag,
                "error_type": error_type,
                "skill_name": skill_name,
                "count": error_count,
                "suggestion": suggestion,
                "examples": examples,
            }
        )

    return top_errors


async def generate_weekly_report_async(
    user_id: str, db: AsyncSession | None = None
) -> dict:
    """Async implementation of weekly report generation."""
    logger.info("generate_weekly_report_async called for user_id=%s", user_id)

    async def _generate(session: AsyncSession) -> dict:
        top_grammar_errors = await compile_top_grammar_errors(user_id, session, limit=3)
        return {
            "user_id": user_id,
            "status": "partial",
            "top_grammar_errors": top_grammar_errors,
        }

    if db is not None:
        return await _generate(db)

    async with async_session_maker() as session:
        return await _generate(session)


def generate_weekly_report(user_id: str, db: AsyncSession | None = None) -> dict:
    """
    生成用户周度多维学习报告。

    参数:
        user_id: 用户 UUID 字符串
        db: 可选的 AsyncSession (供测试或异步上下文注入)

    返回:
        报告数据字典（供前端渲染或导出 PDF）
    """
    logger.info("generate_weekly_report called for user_id=%s", user_id)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        try:
            import nest_asyncio

            nest_asyncio.apply()
            return loop.run_until_complete(generate_weekly_report_async(user_id, db))
        except ImportError:
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(
                    lambda: asyncio.run(generate_weekly_report_async(user_id, db))
                ).result()
    else:
        return asyncio.run(generate_weekly_report_async(user_id, db))
