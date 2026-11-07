"""七天语法错误 Top 3 聚合查询服务。

单条有界 SQL 聚合，仅读必要列；不加载会话 ORM/关系、不逐会话查表、不读正文。
"""

import uuid

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.exercise import GrammarError
from models.session import Session, SessionStatus
from schemas.assessment import (
    WeeklyGrammarItem,
    WeeklyGrammarSummary,
)
from services.session_queries import weekly_day_windows

_FIXED_SKILL_TAGS = (
    "article_usage",
    "preposition",
    "subject_verb_agreement",
    "verb_tense_past",
    "verb_tense_present",
)
_DEMO_SOURCES = ("demo_mock", "demo_rule")


async def query_weekly_grammar(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    end_date: str,
    timezone_name: str,
) -> WeeklyGrammarSummary:
    """按七个本地自然日窗口聚合真实语法错误并返回稳定 Top 3。"""
    days = weekly_day_windows(end_date, timezone_name)
    start = days[0].start
    end = days[-1].end

    tag_expr = case(
        (
            GrammarError.skill_tag.in_(_FIXED_SKILL_TAGS),
            GrammarError.skill_tag,
        ),
        else_="other",
    )

    stmt = (
        select(tag_expr.label("skill_tag"), func.count().label("count"))
        .select_from(Session)
        .join(GrammarError, GrammarError.session_id == Session.id)
        .where(
            Session.user_id == user_id,
            Session.status == SessionStatus.completed,
            Session.started_at >= start,
            Session.started_at < end,
            GrammarError.is_synthetic.is_(False),
            GrammarError.source.not_in(_DEMO_SOURCES),
        )
        .group_by(tag_expr)
    )

    rows = (await db.execute(stmt)).all()
    counts: dict[str, int] = {}
    for skill_tag, count in rows:
        counts[skill_tag] = int(count)
    total_errors = sum(counts.values())

    items = [
        WeeklyGrammarItem(skill_tag=tag, count=count)
        for tag, count in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0]),
        )[:3]
    ]

    return WeeklyGrammarSummary(
        start=start,
        end=end,
        total_errors=total_errors,
        items=items,
    )
