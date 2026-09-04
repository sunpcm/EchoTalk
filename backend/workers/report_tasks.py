"""
多维学习报告生成任务。
使用 Celery 异步执行，避免阻塞请求线程。

依赖: Celery + Redis（USE_MOCK_CELERY=True 时同步执行）
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import select

from database import async_session_maker
from models.session import Session, Transcript, TranscriptRole

logger = logging.getLogger(__name__)


async def fetch_emotion_summary(user_id: str, days: int = 7) -> dict:
    """
    查询 transcripts.emotion_state 汇总情绪数据。

    参数:
        user_id: 用户 UUID 字符串
        days: 统计天数，默认最近 7 天

    返回:
        包含平均焦虑指数、平均语速及犹豫率的情绪汇总数据字典
    """
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        logger.error("Invalid user_id format: %s", user_id)
        return {
            "avg_anxiety_index": None,
            "avg_wpm": None,
            "avg_hesitation_rate": None,
            "sample_count": 0,
            "status": "invalid_user_id",
        }

    cutoff_date = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

    async with async_session_maker() as session:
        stmt = (
            select(Transcript.emotion_state)
            .join(Session, Transcript.session_id == Session.id)
            .where(
                Session.user_id == user_uuid,
                Session.started_at >= cutoff_date,
                Transcript.role == TranscriptRole.user,
                Transcript.emotion_state.isnot(None),
            )
        )
        result = await session.execute(stmt)
        emotion_states = result.scalars().all()

    if not emotion_states:
        return {
            "avg_anxiety_index": 0.0,
            "avg_wpm": 0.0,
            "avg_hesitation_rate": 0.0,
            "sample_count": 0,
            "status": "no_data",
        }

    anxiety_levels = []
    wpms = []
    hesitation_rates = []

    for state in emotion_states:
        if isinstance(state, dict):
            if "anxiety_level" in state and state["anxiety_level"] is not None:
                anxiety_levels.append(float(state["anxiety_level"]))
            if "wpm" in state and state["wpm"] is not None:
                wpms.append(float(state["wpm"]))
            if "hesitation_rate" in state and state["hesitation_rate"] is not None:
                hesitation_rates.append(float(state["hesitation_rate"]))

    avg_anxiety = (
        round(sum(anxiety_levels) / len(anxiety_levels), 2)
        if anxiety_levels
        else 0.0
    )
    avg_wpm = round(sum(wpms) / len(wpms), 1) if wpms else 0.0
    avg_hesitation = (
        round(sum(hesitation_rates) / len(hesitation_rates), 2)
        if hesitation_rates
        else 0.0
    )

    return {
        "avg_anxiety_index": avg_anxiety,
        "avg_wpm": avg_wpm,
        "avg_hesitation_rate": avg_hesitation,
        "sample_count": len(emotion_states),
        "status": "success",
    }


def generate_weekly_report(user_id: str) -> dict:
    """
    生成用户周度多维学习报告。

    TODO: 实现以下报告维度
    - 本周练习时长 & 会话次数统计
    - 各技能 p_mastery 趋势（环比上周变化）
    - 发音准确率趋势（按 session 聚合）
    - 语法错误频次 Top-3 及改善建议
    - Krashen i+1 推荐下周学习重点
    - 情绪分析摘要（平均焦虑指数、语速趋势）

    参数:
        user_id: 用户 UUID 字符串

    返回:
        报告数据字典（供前端渲染或导出 PDF）
    """
    logger.info("generate_weekly_report called for user_id=%s", user_id)

    # TODO: 查询 sessions 表统计本周练习数据
    # TODO: 查询 knowledge_states 计算技能趋势
    # TODO: 查询 pronunciation_assessments 计算发音趋势
    # TODO: 查询 grammar_errors 统计高频错误
    # TODO: 调用 RAG 服务生成下周推荐

    # 查询 transcripts.emotion_state 汇总情绪数据
    try:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import nest_asyncio

            nest_asyncio.apply()
            emotion_summary = loop.run_until_complete(
                fetch_emotion_summary(user_id)
            )
        else:
            emotion_summary = asyncio.run(fetch_emotion_summary(user_id))
    except Exception as e:
        logger.exception("Failed to fetch emotion summary for user_id=%s: %s", user_id, e)
        emotion_summary = {
            "avg_anxiety_index": 0.0,
            "avg_wpm": 0.0,
            "avg_hesitation_rate": 0.0,
            "sample_count": 0,
            "status": "error",
        }

    return {
        "user_id": user_id,
        "status": "skeleton",
        "message": "Report generation in progress",
        "emotion_summary": emotion_summary,
    }
