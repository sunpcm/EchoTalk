"""对话路由：发送消息并获取 AI 回复。"""

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from openai import APIError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.session import Session, SessionStatus, Transcript, TranscriptRole
from schemas.conversation import ChatRequest, ChatResponse
from services.llm_service import SYSTEM_PROMPT, chat_completion

router = APIRouter()


@router.post("/conversation/chat", response_model=ChatResponse)
async def send_message(
    body: ChatRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    发送消息并获取 AI 回复。

    流程：保存用户消息 → 加载历史 → 调用 LLM → 保存 AI 回复 → 返回。
    """
    user_id = uuid.UUID(current_user["id"])

    # 1. 校验 session 存在、属于当前用户、且状态为 active
    stmt = select(Session).where(
        Session.id == body.session_id,
        Session.user_id == user_id,
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail="会话已结束，无法发送消息")

    # 2. 保存用户消息到 transcripts
    now_ms = int(time.time() * 1000)

    user_transcript = Transcript(
        session_id=body.session_id,
        role=TranscriptRole.user,
        content=body.message,
        timestamp_ms=now_ms,
    )
    db.add(user_transcript)
    await db.flush()

    # 3. 加载该 session 的全部历史消息（含刚插入的用户消息）
    history_stmt = (
        select(Transcript)
        .where(Transcript.session_id == body.session_id)
        .order_by(Transcript.timestamp_ms)
    )
    history_result = await db.execute(history_stmt)
    transcripts = history_result.scalars().all()

    # 4. 构建 LLM messages 数组
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for t in transcripts:
        messages.append({"role": t.role.value, "content": t.content})

    # 5. 调用 LLM 获取回复
    try:
        reply_text = await chat_completion(messages)
    except APIError as e:
        raise HTTPException(
            status_code=502,
            detail=f"LLM 服务调用失败: {e.message}",
        )

    # 6. 保存 AI 回复到 transcripts
    reply_ms = int(time.time() * 1000)

    assistant_transcript = Transcript(
        session_id=body.session_id,
        role=TranscriptRole.assistant,
        content=reply_text,
        timestamp_ms=reply_ms,
    )
    db.add(assistant_transcript)
    await db.flush()
    await db.refresh(assistant_transcript)

    # 7. 返回响应（audio_base64 暂为 null，TTS 留到 WebRTC 阶段集成）
    return ChatResponse(
        reply=reply_text,
        transcript_id=assistant_transcript.id,
        audio_base64=None,
    )
