"""
转录写入服务。
独立于 FastAPI 请求生命周期，可在 Agent 进程和 FastAPI 路由中共同调用。
"""

import logging
import time
import uuid

from database import async_session_maker
from models.session import Transcript, TranscriptRole

logger = logging.getLogger(__name__)


async def save_transcript(
    session_id: str,
    role: str,
    content: str,
    timestamp_ms: int | None = None,
    emotion_state: dict | None = None,
) -> Transcript | None:
    """
    保存一条转录记录到数据库。

    参数:
        session_id: 会话 UUID 字符串
        role: "user" 或 "assistant"
        content: 转录文本内容
        timestamp_ms: 毫秒时间戳（默认取当前时间）
        emotion_state: Phase 3 情绪状态快照（仅 user 角色有值）

    返回:
        创建的 Transcript 对象，失败返回 None。
    """
    if not content or not content.strip():
        return None

    if timestamp_ms is None:
        timestamp_ms = int(time.time() * 1000)

    try:
        async with async_session_maker() as session:
            transcript = Transcript(
                session_id=uuid.UUID(session_id),
                role=TranscriptRole(role),
                content=content.strip(),
                timestamp_ms=timestamp_ms,
                emotion_state=emotion_state,
            )
            session.add(transcript)
            await session.commit()
            await session.refresh(transcript)
            logger.info(
                "转录已保存: session=%s, role=%s, len=%d, emotion=%s",
                session_id,
                role,
                len(content),
                "yes" if emotion_state else "no",
            )
            return transcript
    except Exception:
        logger.exception("转录保存失败: session=%s", session_id)
        return None
