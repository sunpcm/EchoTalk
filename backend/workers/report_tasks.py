"""
多维学习报告生成任务。
使用 Celery 异步执行，避免阻塞请求线程。

依赖: Celery + Redis（USE_MOCK_CELERY=True 时同步执行）
"""

import enum
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session_maker
from models.session import Session, SessionStatus

logger = logging.getLogger(__name__)


def get_current_week_start(now: datetime | None = None) -> datetime:
    """获取当前周的第一天（周一 00:00:00 UTC）。"""
    if now is None:
        now = datetime.now(timezone.utc)
    start_of_week = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return start_of_week


async def get_weekly_practice_stats(
    db: AsyncSession,
    user_id: str | uuid.UUID,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
) -> dict:
    """
    查询 sessions 表统计指定时间段（默认本周）的练习数据。

    参数:
        db: 数据库异步会话
        user_id: 用户 ID (UUID 或字符串)
        start_time: 起始时间（默认为本周一 00:00:00 UTC）
        end_time: 截止时间（可选）

    返回:
        包含练习时长、会话次数、按模式统计等的字典
    """
    if isinstance(user_id, str):
        user_id = uuid.UUID(user_id)

    if start_time is None:
        start_time = get_current_week_start()

    filter_start_time = (
        start_time.replace(tzinfo=None) if start_time.tzinfo else start_time
    )

    stmt = select(Session).where(
        Session.user_id == user_id,
        Session.started_at >= filter_start_time,
    )
    if end_time is not None:
        filter_end_time = end_time.replace(tzinfo=None) if end_time.tzinfo else end_time
        stmt = stmt.where(Session.started_at <= filter_end_time)

    result = await db.execute(stmt)
    sessions = result.scalars().all()

    total_sessions = len(sessions)
    completed_sessions = 0
    total_practice_seconds = 0.0
    sessions_by_mode: dict[str, int] = {}

    for s in sessions:
        if s.status == SessionStatus.completed or s.status == "completed":
            completed_sessions += 1

        mode_str = s.mode.value if isinstance(s.mode, enum.Enum) else str(s.mode)
        sessions_by_mode[mode_str] = sessions_by_mode.get(mode_str, 0) + 1

        if s.ended_at and s.started_at and s.ended_at > s.started_at:
            duration = (s.ended_at - s.started_at).total_seconds()
            total_practice_seconds += duration

    total_practice_minutes = round(total_practice_seconds / 60.0, 2)
    avg_session_duration_seconds = (
        round(total_practice_seconds / total_sessions, 2) if total_sessions > 0 else 0.0
    )

    return {
        "total_sessions": total_sessions,
        "completed_sessions": completed_sessions,
        "total_practice_seconds": round(total_practice_seconds, 2),
        "total_practice_minutes": total_practice_minutes,
        "avg_session_duration_seconds": avg_session_duration_seconds,
        "sessions_by_mode": sessions_by_mode,
        "period_start": start_time.isoformat(),
        "period_end": end_time.isoformat() if end_time else None,
    }


async def generate_weekly_report(user_id: str, db: AsyncSession | None = None) -> dict:
    """
    生成用户周度多维学习报告。

    维度包含:
    - 本周练习时长 & 会话次数统计 (已实现)
    - 各技能 p_mastery 趋势（环比上周变化）
    - 发音准确率趋势（按 session 聚合）
    - 语法错误频次 Top-3 及改善建议
    - Krashen i+1 推荐下周学习重点
    - 情绪分析摘要（平均焦虑指数、语速趋势）

    参数:
        user_id: 用户 UUID 字符串
        db: 数据库异步会话（可选，若未指定则自动创建）

    返回:
        报告数据字典（供前端渲染或导出 PDF）
    """
    logger.info("generate_weekly_report called for user_id=%s", user_id)

    if db is not None:
        weekly_practice_stats = await get_weekly_practice_stats(db, user_id)
    else:
        async with async_session_maker() as session:
            weekly_practice_stats = await get_weekly_practice_stats(session, user_id)

    # TODO: 查询 knowledge_states 计算技能趋势
    # TODO: 查询 pronunciation_assessments 计算发音趋势
    # TODO: 查询 grammar_errors 统计高频错误
    # TODO: 调用 RAG 服务生成下周推荐
    # TODO: 查询 transcripts.emotion_state 汇总情绪数据

    return {
        "user_id": user_id,
        "status": "skeleton",
        "weekly_practice_stats": weekly_practice_stats,
    }
