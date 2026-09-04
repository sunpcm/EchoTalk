"""
多维学习报告生成任务。
使用 Celery 异步执行，避免阻塞请求线程。

依赖: Celery + Redis（USE_MOCK_CELERY=True 时同步执行）
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session_maker
from models.exercise import GrammarError
from models.session import Session

logger = logging.getLogger(__name__)

# 预设的针对语法错误的改善建议映射
_SUGGESTION_MAP = {
    "verb_tense_past": (
        "注意过去时态的使用。提及过去发生的事情或带有 yesterday, ago, last 等时间状语时，请使用动词过去式。"
    ),
    "subject_verb_agreement": (
        "注意主谓一致。当主语为第三人称单数 (he, she, it) 时，一般现在时动词需变单三形式 (如 goes, has, does)。"
    ),
    "article_usage": (
        "注意冠词 (a, an, the) 的用法。单数可数名词前需加冠词，元音音素开头的单词前使用 an。"
    ),
    "preposition_error": (
        "注意介词固定搭配 (如 depend on, listen to, arrive at/in)。"
    ),
    "plural_noun": (
        "注意可数名词复数形式及不规则复数变化。"
    ),
}

_DEFAULT_SUGGESTION = "建议多复习相关语法规则并在口语练习中多加巩固。"


def _generate_suggestion(skill_tag: str, error_type: str) -> str:
    """根据 skill_tag 与 error_type 生成个性化语法改善建议。"""
    if skill_tag in _SUGGESTION_MAP:
        return _SUGGESTION_MAP[skill_tag]
    return f"经常出现 {error_type or skill_tag} 类型的语法错误，{_DEFAULT_SUGGESTION}"


async def get_top_grammar_errors(
    db: AsyncSession,
    user_id: uuid.UUID | str,
    limit: int = 3,
    days: int | None = 7,
) -> list[dict]:
    """
    查询用户在指定时间段内（默认近7天）出现频次最高的语法错误 Top-N 并生成改善建议。

    参数:
        db: 异步数据库会话
        user_id: 用户 UUID
        limit: 返回的错误类型数量（默认 3）
        days: 统计最近多少天的数据（None 表示全量）

    返回:
        语法错误统计列表，包含 skill_tag, error_type, count, sample_original, sample_corrected, suggestion
    """
    if isinstance(user_id, str):
        user_id = uuid.UUID(user_id)

    # 1. 构建基础查询，关联 sessions 表过滤 user_id
    query = (
        select(
            GrammarError.skill_tag,
            GrammarError.error_type,
            func.count(GrammarError.id).label("error_count"),
            func.max(GrammarError.original).label("sample_original"),
            func.max(GrammarError.corrected).label("sample_corrected"),
        )
        .join(Session, GrammarError.session_id == Session.id)
        .where(Session.user_id == user_id)
    )

    if days is not None:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.where(GrammarError.created_at >= since)

    # 2. 按 skill_tag, error_type 分组，按频次降序，限制数量
    query = (
        query.group_by(GrammarError.skill_tag, GrammarError.error_type)
        .order_by(func.count(GrammarError.id).desc())
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()

    # 3. 组装返回结果
    top_errors = []
    for row in rows:
        skill_tag, error_type, count, sample_orig, sample_corr = row
        top_errors.append(
            {
                "skill_tag": skill_tag,
                "error_type": error_type,
                "count": count,
                "sample_original": sample_orig,
                "sample_corrected": sample_corr,
                "suggestion": _generate_suggestion(skill_tag, error_type),
            }
        )

    return top_errors


async def generate_weekly_report_async(user_id: str) -> dict:
    """
    异步生成用户周度多维学习报告。
    """
    logger.info("generate_weekly_report_async called for user_id=%s", user_id)
    u_uuid = uuid.UUID(user_id)

    async with async_session_maker() as db:
        top_grammar_errors = await get_top_grammar_errors(db, u_uuid, limit=3, days=7)

    return {
        "user_id": user_id,
        "status": "partial",
        "grammar_errors_summary": {
            "top_errors": top_grammar_errors,
            "total_top_errors_count": sum(e["count"] for e in top_grammar_errors),
        },
        "message": "Report generation with top grammar errors completed",
    }


def generate_weekly_report(user_id: str) -> dict:
    """
    生成用户周度多维学习报告（Celery 任务入口）。

    参数:
        user_id: 用户 UUID 字符串

    返回:
        报告数据字典（供前端渲染或导出 PDF）
    """
    logger.info("generate_weekly_report called for user_id=%s", user_id)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # 如果已在运行事件循环中，使用 create_task 或 run_until_complete (若在独立线程)
        import nest_asyncio
        nest_asyncio.apply()
        return loop.run_until_complete(generate_weekly_report_async(user_id))
    else:
        return asyncio.run(generate_weekly_report_async(user_id))
