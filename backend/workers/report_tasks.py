"""
多维学习报告生成任务。
使用 Celery 异步执行，避免阻塞请求线程。

依赖: Celery + Redis（USE_MOCK_CELERY=True 时同步执行）
"""

import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session_maker
from models.session import Session, Transcript, TranscriptRole

logger = logging.getLogger(__name__)


async def get_emotion_summary_for_user(
    user_id: str | uuid.UUID,
    db: AsyncSession,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
) -> dict:
    """
    查询 transcripts.emotion_state 汇总指定用户的情绪与语速数据。

    参数:
        user_id: 用户 UUID 字符串或 UUID 对象
        db: AsyncSession 数据库会话
        start_time: 可选起始时间过滤 (Session.started_at)
        end_time: 可选结束时间过滤 (Session.started_at)

    返回:
        情绪汇总字典:
        {
            "average_anxiety_index": float,
            "average_wpm": float,
            "speech_rate_trends": list[dict],
            "total_transcripts_analyzed": int,
        }
    """
    if isinstance(user_id, str):
        user_uuid = uuid.UUID(user_id)
    else:
        user_uuid = user_id

    stmt = (
        select(Transcript)
        .join(Session, Transcript.session_id == Session.id)
        .where(
            Session.user_id == user_uuid,
            Transcript.role == TranscriptRole.user,
            Transcript.emotion_state.isnot(None),
        )
        .order_by(Transcript.timestamp_ms.asc())
    )

    if start_time is not None:
        stmt = stmt.where(Session.started_at >= start_time)
    if end_time is not None:
        stmt = stmt.where(Session.started_at <= end_time)

    result = await db.execute(stmt)
    transcripts = result.scalars().all()

    if not transcripts:
        return {
            "average_anxiety_index": 0.0,
            "average_wpm": 0.0,
            "speech_rate_trends": [],
            "total_transcripts_analyzed": 0,
        }

    anxiety_levels: list[float] = []
    wpms: list[float] = []
    trends: list[dict] = []

    for t in transcripts:
        state = t.emotion_state
        if not isinstance(state, dict):
            continue

        anxiety = state.get("anxiety_level")
        wpm = state.get("wpm")

        if anxiety is not None:
            anxiety_levels.append(float(anxiety))
        if wpm is not None:
            wpms.append(float(wpm))

        trends.append(
            {
                "session_id": str(t.session_id),
                "timestamp_ms": t.timestamp_ms,
                "wpm": float(wpm) if wpm is not None else 0.0,
                "anxiety_level": float(anxiety) if anxiety is not None else 0.0,
                "cognitive_load": state.get("cognitive_load", "normal"),
                "hesitation_rate": float(state.get("hesitation_rate", 0.0)),
            }
        )

    avg_anxiety = (
        round(sum(anxiety_levels) / len(anxiety_levels), 2) if anxiety_levels else 0.0
    )
    avg_wpm = round(sum(wpms) / len(wpms), 1) if wpms else 0.0

    return {
        "average_anxiety_index": avg_anxiety,
        "average_wpm": avg_wpm,
        "speech_rate_trends": trends,
        "total_transcripts_analyzed": len(trends),
    }


async def generate_weekly_report(
    user_id: str,
    db: AsyncSession | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
) -> dict:
    """
    生成用户周度多维学习报告。

    TODO: 实现以下报告维度
    - 本周练习时长 & 会话次数统计
    - 各技能 p_mastery 趋势（环比上周变化）
    - 发音准确率趋势（按 session 聚合）
    - 语法错误频次 Top-3 及改善建议
    - Krashen i+1 推荐下周学习重点
    - 情绪分析摘要（平均焦虑指数、语速趋势） [Implemented]

    参数:
        user_id: 用户 UUID 字符串
        db: 可选 AsyncSession 数据库会话
        start_time: 可选起始时间过滤
        end_time: 可选结束时间过滤

    返回:
        报告数据字典（供前端渲染或导出 PDF）
    """
    logger.info("generate_weekly_report called for user_id=%s", user_id)

    if db is not None:
        emotion_summary = await get_emotion_summary_for_user(
            user_id, db, start_time=start_time, end_time=end_time
        )
    else:
        async with async_session_maker() as session:
            emotion_summary = await get_emotion_summary_for_user(
                user_id, session, start_time=start_time, end_time=end_time
            )

    return {
        "user_id": user_id,
        "status": "skeleton",
        "emotion_summary": emotion_summary,
    }
