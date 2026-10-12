"""
多维学习报告生成任务。
使用 Celery 异步执行，避免阻塞请求线程。

依赖: Celery + Redis（USE_MOCK_CELERY=True 时同步执行）
"""

import logging

logger = logging.getLogger(__name__)


import uuid
from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.knowledge import KnowledgeState, Skill


from datetime import datetime, timedelta, timezone


async def get_skill_trends(
    db: AsyncSession, user_id: str | uuid.UUID
) -> list[dict[str, Any]]:
    """
    查询 knowledge_states 表计算用户技能掌握度 (p_mastery) 及其环比上周变化趋势 (p_mastery_change / wow_change)。

    参数:
        db: 异步数据库会话
        user_id: 用户 UUID (字符串或 UUID 对象)

    返回:
        技能掌握度趋势字典列表
    """
    if isinstance(user_id, str):
        try:
            uid = uuid.UUID(user_id)
        except ValueError:
            logger.warning(
                "Invalid user_id format passed to get_skill_trends: %s", user_id
            )
            return []
    else:
        uid = user_id

    stmt = (
        select(KnowledgeState, Skill)
        .join(Skill, KnowledgeState.skill_id == Skill.id)
        .where(KnowledgeState.user_id == uid)
        .order_by(Skill.category, Skill.id)
    )
    result = await db.execute(stmt)
    rows = result.all()

    now = datetime.now(timezone.utc)
    one_week_ago = now - timedelta(days=7)

    trends = []
    for state, skill in rows:
        updated_at = state.updated_at
        if updated_at is not None and updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        # 计算周环比变化: 若在过去 7 天内更新过，计算变化值; 否则设为 0.0 (无最新变化)
        # 初始默认 p_mastery 为 0.1
        if updated_at and updated_at >= one_week_ago:
            p_mastery_change = round(state.p_mastery - 0.1, 4)
            is_active_this_week = True
        else:
            p_mastery_change = 0.0
            is_active_this_week = False

        trends.append(
            {
                "skill_id": state.skill_id,
                "skill_name": skill.name,
                "category": skill.category,
                "p_mastery": state.p_mastery,
                "p_mastery_change": p_mastery_change,
                "is_active_this_week": is_active_this_week,
                "updated_at": updated_at.isoformat() if updated_at else None,
            }
        )

    return trends


async def generate_weekly_report_async(db: AsyncSession, user_id: str) -> dict:
    """
    异步生成用户周度多维学习报告。
    """
    logger.info("generate_weekly_report called for user_id=%s", user_id)

    skill_trends = await get_skill_trends(db, user_id)

    # TODO: 查询 sessions 表统计本周练习数据
    # TODO: 查询 pronunciation_assessments 计算发音趋势
    # TODO: 查询 grammar_errors 统计高频错误
    # TODO: 调用 RAG 服务生成下周推荐
    # TODO: 查询 transcripts.emotion_state 汇总情绪数据

    return {
        "user_id": user_id,
        "status": "skeleton",
        "skill_trends": skill_trends,
    }


def generate_weekly_report(user_id: str) -> dict:
    """
    生成用户周度多维学习报告 (Celery/同步调用入口)。

    参数:
        user_id: 用户 UUID 字符串

    返回:
        报告数据字典（供前端渲染或导出 PDF）
    """
    import asyncio
    from database import async_session_maker

    async def _run():
        async with async_session_maker() as db:
            return await generate_weekly_report_async(db, user_id)

    try:
        return asyncio.run(_run())
    except RuntimeError:
        # 当已在运行中的 event loop 内（如测试环境）
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(_run())
