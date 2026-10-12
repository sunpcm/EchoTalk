"""
多维学习报告生成任务。
使用 Celery 异步执行或在 App 内部异步/同步调用。

依赖: Celery + Redis（USE_MOCK_CELERY=True 时同步执行）
"""

import logging
import uuid
from datetime import datetime
from statistics import mean

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session_maker
from models.exercise import PronunciationAssessment
from models.session import Session

logger = logging.getLogger(__name__)


async def calculate_pronunciation_trends(
    db: AsyncSession,
    user_id: str | uuid.UUID,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    include_synthetic: bool = False,
) -> dict:
    """
    查询 pronunciation_assessments 表，按 session 聚合并计算发音准确率趋势。

    参数:
        db: 数据库异步 Session
        user_id: 用户 UUID (字符串或 UUID 对象)
        start_time: 起始时间过滤（可选）
        end_time: 截止时间过滤（可选）
        include_synthetic: 是否包含 synthetic 评估（默认 False）

    返回:
        发音趋势统计字典
    """
    if isinstance(user_id, str):
        try:
            uid = uuid.UUID(user_id)
        except ValueError:
            logger.warning("Invalid UUID user_id: %s", user_id)
            return {
                "total_sessions": 0,
                "average_score": 0.0,
                "max_score": 0.0,
                "min_score": 0.0,
                "score_delta": 0.0,
                "trend": "insufficient_data",
                "sessions": [],
            }
    else:
        uid = user_id

    stmt = (
        select(PronunciationAssessment, Session)
        .join(Session, PronunciationAssessment.session_id == Session.id)
        .where(Session.user_id == uid)
    )

    if not include_synthetic:
        stmt = stmt.where(PronunciationAssessment.is_synthetic.is_(False))

    if start_time is not None:
        stmt = stmt.where(Session.started_at >= start_time)

    if end_time is not None:
        stmt = stmt.where(Session.started_at <= end_time)

    stmt = stmt.order_by(
        Session.started_at.asc(), PronunciationAssessment.created_at.asc()
    )

    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return {
            "total_sessions": 0,
            "average_score": 0.0,
            "max_score": 0.0,
            "min_score": 0.0,
            "score_delta": 0.0,
            "trend": "insufficient_data",
            "sessions": [],
        }

    session_records = []
    scores = []
    for assessment, session in rows:
        score = float(assessment.overall_score)
        scores.append(score)
        session_records.append(
            {
                "session_id": str(session.id),
                "overall_score": round(score, 2),
                "created_at": (
                    assessment.created_at.isoformat() if assessment.created_at else None
                ),
                "started_at": (
                    session.started_at.isoformat() if session.started_at else None
                ),
            }
        )

    total_sessions = len(scores)
    avg_score = round(mean(scores), 2)
    max_score = round(max(scores), 2)
    min_score = round(min(scores), 2)

    if total_sessions >= 2:
        mid = total_sessions // 2
        first_half_avg = mean(scores[:mid])
        second_half_avg = mean(scores[mid:])
        score_delta = round(second_half_avg - first_half_avg, 2)

        if score_delta > 2.0:
            trend = "improving"
        elif score_delta < -2.0:
            trend = "declining"
        else:
            trend = "stable"
    else:
        score_delta = 0.0
        trend = "stable"

    return {
        "total_sessions": total_sessions,
        "average_score": avg_score,
        "max_score": max_score,
        "min_score": min_score,
        "score_delta": score_delta,
        "trend": trend,
        "sessions": session_records,
    }


async def generate_weekly_report(user_id: str, db: AsyncSession | None = None) -> dict:
    """
    生成用户周度多维学习报告。

    参数:
        user_id: 用户 UUID 字符串
        db: 可选的数据库 AsyncSession

    返回:
        报告数据字典（供前端渲染或导出 PDF）
    """
    logger.info("generate_weekly_report called for user_id=%s", user_id)

    async def _generate(session: AsyncSession) -> dict:
        pronunciation_trends = await calculate_pronunciation_trends(session, user_id)

        # TODO: 查询 sessions 表统计本周练习数据
        # TODO: 查询 knowledge_states 计算技能趋势
        # TODO: 查询 grammar_errors 统计高频错误
        # TODO: 调用 RAG 服务生成下周推荐
        # TODO: 查询 transcripts.emotion_state 汇总情绪数据

        return {
            "user_id": user_id,
            "status": "partial",
            "pronunciation_trends": pronunciation_trends,
        }

    if db is not None:
        return await _generate(db)
    else:
        async with async_session_maker() as session:
            return await _generate(session)
