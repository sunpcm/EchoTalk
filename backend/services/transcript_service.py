"""转录写入服务。

独立于 FastAPI 请求生命周期，可在 Agent 进程和 FastAPI 路由中共同调用。
支持基于 PostgreSQL 唯一约束的原子事件幂等写入与重放保护 (RF-09)。
"""

import logging
import time
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from database import async_session_maker
from models.session import Transcript, TranscriptRole

logger = logging.getLogger(__name__)


async def save_transcript(
    session_id: str,
    role: str,
    content: str,
    timestamp_ms: int | None = None,
    emotion_state: dict | None = None,
    *,
    event_id: uuid.UUID | str | None = None,
) -> Transcript | None:
    """保存一条转录记录到数据库。

    参数:
        session_id: 会话 UUID 字符串
        role: "user" 或 "assistant"
        content: 转录文本内容
        timestamp_ms: 毫秒时间戳（默认取当前时间）
        emotion_state: Phase 3 情绪状态快照（仅 user 角色有值）
        event_id: 可选的稳定事件标识符（UUID 或 UUID 字符串）；传入时启用原子幂等写入

    返回:
        创建或重放匹配的 Transcript 对象，失败或冲突返回 None。
    """
    if not content or not content.strip():
        return None

    try:
        sid = uuid.UUID(str(session_id).strip())
    except Exception:
        logger.warning("转录保存失败: 无效的 session_id 格式")
        return None

    try:
        trole = TranscriptRole(role)
    except Exception:
        logger.warning("转录保存失败: 无效的 role")
        return None

    explicit_timestamp = timestamp_ms is not None
    if not explicit_timestamp:
        timestamp_ms = int(time.time() * 1000)

    # 校验 event_id
    ev_uuid: uuid.UUID | None = None
    if event_id is not None:
        try:
            if isinstance(event_id, uuid.UUID):
                ev_uuid = event_id
            elif isinstance(event_id, str) and event_id.strip():
                ev_uuid = uuid.UUID(event_id.strip())
            else:
                logger.warning("转录保存失败: event_id 类型或格式非法")
                return None
        except Exception:
            logger.warning("转录保存失败: event_id 解析失败")
            return None

    # 1. Legacy 路径（event_id 为 None，保留历史无 key 插入行为）
    if ev_uuid is None:
        try:
            async with async_session_maker() as session:
                transcript = Transcript(
                    session_id=sid,
                    role=trole,
                    content=content.strip(),
                    timestamp_ms=timestamp_ms,
                    emotion_state=emotion_state,
                )
                session.add(transcript)
                await session.commit()
                await session.refresh(transcript)
                logger.info(
                    "转录已保存: session=%s, role=%s, len=%d, emotion=%s",
                    str(sid),
                    role,
                    len(content.strip()),
                    "yes" if emotion_state else "no",
                )
                return transcript
        except Exception:
            logger.warning("转录保存失败: session=%s", str(sid))
            return None

    # 2. 幂等路径（event_id 有效）
    try:
        async with async_session_maker() as session:
            stmt = (
                pg_insert(Transcript)
                .values(
                    session_id=sid,
                    event_id=ev_uuid,
                    role=trole,
                    content=content.strip(),
                    timestamp_ms=timestamp_ms,
                    emotion_state=emotion_state,
                )
                .on_conflict_do_nothing(constraint="uq_transcripts_session_event")
                .returning(Transcript.id)
            )
            result = await session.execute(stmt)
            inserted_id = result.scalar_one_or_none()

            if inserted_id is not None:
                # 首次插入成功，提交事务
                await session.commit()
                res = await session.execute(
                    select(Transcript).where(Transcript.id == inserted_id)
                )
                transcript = res.scalar_one_or_none()
                if transcript is None:
                    logger.warning("转录确认读取失败: session=%s", str(sid))
                    return None

                logger.info(
                    "转录已保存 (幂等首写): session=%s, role=%s, len=%d, emotion=%s",
                    str(sid),
                    role,
                    len(content.strip()),
                    "yes" if emotion_state else "no",
                )
                return transcript

            # 发生目标唯一约束冲突（同 session_id, event_id 已存在）
            await session.rollback()
            stmt_existing = select(Transcript).where(
                Transcript.session_id == sid,
                Transcript.event_id == ev_uuid,
            )
            res_existing = await session.execute(stmt_existing)
            existing = res_existing.scalar_one_or_none()
            if existing is None:
                logger.warning("转录冲突后读取原记录未找到: session=%s", str(sid))
                return None

            # 重放一致性校验: role, content, emotion_state, timestamp_ms
            if existing.role != trole:
                logger.warning("转录重放冲突: role 不匹配, session=%s", str(sid))
                return None

            if existing.content != content.strip():
                logger.warning("转录重放冲突: content 不匹配, session=%s", str(sid))
                return None

            if existing.emotion_state != emotion_state:
                logger.warning(
                    "转录重放冲突: emotion_state 不匹配, session=%s", str(sid)
                )
                return None

            # 显式传入时间戳必须一致；若未显式传入，允许时钟前进但保留原记录
            if explicit_timestamp and existing.timestamp_ms != timestamp_ms:
                logger.warning(
                    "转录重放冲突: 显式 timestamp_ms 不匹配, session=%s", str(sid)
                )
                return None

            logger.info(
                "转录幂等重放匹配: session=%s, role=%s, len=%d",
                str(sid),
                role,
                len(content.strip()),
            )
            return existing
    except Exception:
        logger.warning("转录保存或重放发生异常: session=%s", str(sid))
        return None
