"""
多维学习报告生成任务。
使用 Celery 异步执行，避免阻塞请求线程。

依赖: Celery + Redis（USE_MOCK_CELERY=True 时同步执行）
"""

import enum
import logging
import uuid
from datetime import datetime, timedelta, timezone
from statistics import mean

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session_maker
from models.exercise import GrammarError, PronunciationAssessment
from models.session import Session, SessionStatus, Transcript, TranscriptRole

logger = logging.getLogger(__name__)


def get_current_week_start(now: datetime | None = None) -> datetime:
    """获取当前周的第一天（周一 00:00:00 UTC）。"""
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is not None:
        now = now.astimezone(timezone.utc)
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
        end_time: 截止时间（默认当前时间，不含）

    返回:
        包含练习时长、会话次数、按模式统计等的字典
    """
    if isinstance(user_id, str):
        user_id = uuid.UUID(user_id)

    if start_time is None:
        start_time = get_current_week_start()
    if end_time is None:
        end_time = datetime.now(timezone.utc)

    filter_start_time = _db_time(start_time)

    stmt = select(Session).where(
        Session.user_id == user_id,
        Session.started_at >= filter_start_time,
    )
    filter_end_time = _db_time(end_time)
    stmt = stmt.where(Session.started_at < filter_end_time)

    result = await db.execute(stmt)
    sessions = result.scalars().all()

    total_sessions = len(sessions)
    completed_sessions = 0
    total_practice_seconds = 0.0
    timed_sessions = 0
    sessions_by_mode: dict[str, int] = {}

    for s in sessions:
        if s.status == SessionStatus.completed or s.status == "completed":
            completed_sessions += 1

        mode_str = s.mode.value if isinstance(s.mode, enum.Enum) else str(s.mode)
        sessions_by_mode[mode_str] = sessions_by_mode.get(mode_str, 0) + 1

        if s.ended_at and s.started_at and s.ended_at > s.started_at:
            duration = (min(s.ended_at, filter_end_time) - s.started_at).total_seconds()
            if duration <= 0:
                continue
            total_practice_seconds += duration
            timed_sessions += 1

    total_practice_minutes = round(total_practice_seconds / 60.0, 2)
    avg_session_duration_seconds = (
        round(total_practice_seconds / timed_sessions, 2) if timed_sessions > 0 else 0.0
    )

    return {
        "total_sessions": total_sessions,
        "completed_sessions": completed_sessions,
        "total_practice_seconds": round(total_practice_seconds, 2),
        "total_practice_minutes": total_practice_minutes,
        "avg_session_duration_seconds": avg_session_duration_seconds,
        "sessions_by_mode": sessions_by_mode,
        "period_start": start_time.isoformat(),
        "period_end": end_time.isoformat(),
    }


def _db_time(value: datetime) -> datetime:
    """The existing database columns use naive UTC timestamps."""
    return (
        value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
    )


async def get_weekly_pronunciation(
    db: AsyncSession, user_id: uuid.UUID, start: datetime, end: datetime
) -> dict:
    """Summarize real pronunciation assessments for sessions started this week."""
    stmt = (
        select(PronunciationAssessment, Session)
        .join(Session, PronunciationAssessment.session_id == Session.id)
        .where(
            Session.user_id == user_id,
            Session.started_at >= _db_time(start),
            Session.started_at < _db_time(end),
            PronunciationAssessment.is_synthetic.is_(False),
        )
        .order_by(Session.started_at, PronunciationAssessment.created_at)
    )
    rows = (await db.execute(stmt)).all()
    scores = [float(assessment.overall_score) for assessment, _ in rows]
    return {
        "total_sessions": len(scores),
        "average_score": round(mean(scores), 2) if scores else None,
        "score_delta": round(scores[-1] - scores[0], 2) if len(scores) >= 2 else None,
        "sessions": [
            {"session_id": str(session.id), "overall_score": round(score, 2)}
            for (_, session), score in zip(rows, scores)
        ],
    }


_GRAMMAR_SUGGESTIONS = {
    "subject_verb_agreement": "检查主语与动词的人称和单复数是否一致。",
    "article_usage": "练习可数名词前 a、an、the 的用法。",
    "wrong_tense": "根据事件发生的时间检查动词时态。",
}


async def get_weekly_grammar_errors(
    db: AsyncSession, user_id: uuid.UUID, start: datetime, end: datetime
) -> list[dict]:
    """Return the top three real grammar error types and examples in this week."""
    filters = (
        Session.user_id == user_id,
        Session.started_at >= _db_time(start),
        Session.started_at < _db_time(end),
        GrammarError.created_at >= _db_time(start),
        GrammarError.created_at < _db_time(end),
        GrammarError.is_synthetic.is_(False),
    )
    stmt = (
        select(
            GrammarError.skill_tag, GrammarError.error_type, func.count(GrammarError.id)
        )
        .join(Session, GrammarError.session_id == Session.id)
        .where(*filters)
        .group_by(GrammarError.skill_tag, GrammarError.error_type)
        .order_by(func.count(GrammarError.id).desc(), GrammarError.skill_tag)
        .limit(3)
    )
    rows = (await db.execute(stmt)).all()
    top_errors = []
    for skill_tag, error_type, count in rows:
        examples_stmt = (
            select(GrammarError.original, GrammarError.corrected)
            .join(Session, GrammarError.session_id == Session.id)
            .where(
                *filters,
                GrammarError.skill_tag == skill_tag,
                GrammarError.error_type == error_type,
            )
            .order_by(GrammarError.created_at.desc())
            .limit(3)
        )
        examples = (await db.execute(examples_stmt)).all()
        top_errors.append(
            {
                "skill_tag": skill_tag,
                "error_type": error_type,
                "count": count,
                "suggestion": _GRAMMAR_SUGGESTIONS.get(
                    error_type, f"针对 {skill_tag} 进行专项练习。"
                ),
                "examples": [
                    {"original": original, "corrected": corrected}
                    for original, corrected in examples
                ],
            }
        )
    return top_errors


async def get_weekly_emotion_summary(
    db: AsyncSession, user_id: uuid.UUID, start: datetime, end: datetime
) -> dict:
    """Summarize user transcript snapshots for sessions started this week."""
    stmt = (
        select(Transcript)
        .join(Session, Transcript.session_id == Session.id)
        .where(
            Session.user_id == user_id,
            Session.started_at >= _db_time(start),
            Session.started_at < _db_time(end),
            Transcript.role == TranscriptRole.user,
            Transcript.emotion_state.isnot(None),
        )
        .order_by(Session.started_at, Transcript.timestamp_ms)
    )
    transcripts = (await db.execute(stmt)).scalars().all()
    states = [t.emotion_state for t in transcripts if isinstance(t.emotion_state, dict)]
    anxiety = [
        float(s["anxiety_level"]) for s in states if s.get("anxiety_level") is not None
    ]
    wpm = [float(s["wpm"]) for s in states if s.get("wpm") is not None]
    return {
        "total_transcripts_analyzed": len(states),
        "average_anxiety_index": round(mean(anxiety), 2) if anxiety else None,
        "average_wpm": round(mean(wpm), 1) if wpm else None,
        "speech_rate_trends": [
            {
                "session_id": str(t.session_id),
                "timestamp_ms": t.timestamp_ms,
                "wpm": t.emotion_state.get("wpm"),
            }
            for t in transcripts
            if isinstance(t.emotion_state, dict)
        ],
    }


async def generate_weekly_report(
    user_id: str, db: AsyncSession | None = None, now: datetime | None = None
) -> dict:
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

    end = now or datetime.now(timezone.utc)
    start = get_current_week_start(end)
    uid = uuid.UUID(user_id)

    async def build(session: AsyncSession) -> dict:
        return {
            "user_id": user_id,
            "status": "partial",
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "weekly_practice_stats": await get_weekly_practice_stats(
                session, uid, start, end
            ),
            "pronunciation_trends": await get_weekly_pronunciation(
                session, uid, start, end
            ),
            "top_grammar_errors": await get_weekly_grammar_errors(
                session, uid, start, end
            ),
            "emotion_summary": await get_weekly_emotion_summary(
                session, uid, start, end
            ),
        }

    if db is not None:
        return await build(db)
    async with async_session_maker() as session:
        return await build(session)
