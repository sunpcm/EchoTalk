"""会话管理路由：创建、列表、详情、结束、令牌签发。"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from livekit.api import (
    AccessToken,
    CreateAgentDispatchRequest,
    LiveKitAPI,
    VideoGrants,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import settings
from database import get_db
from dependencies import get_current_user
from models.session import Session, SessionMode, SessionStatus
from models.user import SubscriptionTier, User
from schemas.session import SessionCreate, SessionListItem, SessionResponse
from services.analysis_service import analyze_session, update_knowledge

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/sessions", response_model=SessionResponse)
async def create_session(
    body: SessionCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建新的练习会话。"""
    # 校验 mode 值是否合法
    try:
        mode = SessionMode(body.mode)
    except ValueError:
        valid_modes = [m.value for m in SessionMode]
        raise HTTPException(
            status_code=400,
            detail=f"无效的 mode 值: '{body.mode}'。有效值: {valid_modes}",
        )

    session = Session(
        id=uuid.uuid4(),
        user_id=uuid.UUID(current_user["id"]),
        mode=mode,
        status=SessionStatus.active,
        started_at=datetime.utcnow(),
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)

    return session


@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户的所有会话。"""
    stmt = (
        select(Session)
        .where(Session.user_id == uuid.UUID(current_user["id"]))
        .order_by(Session.started_at.desc())
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    return sessions


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询会话详情（含转录记录）。"""
    stmt = (
        select(Session)
        .where(
            Session.id == session_id,
            Session.user_id == uuid.UUID(current_user["id"]),
        )
        .options(selectinload(Session.transcripts))
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    return session


@router.post("/sessions/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """结束会话：将状态更新为 completed 并记录结束时间。"""
    stmt = (
        select(Session)
        .where(
            Session.id == session_id,
            Session.user_id == uuid.UUID(current_user["id"]),
        )
        .options(selectinload(Session.transcripts))
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail="会话已结束，无法重复操作")

    session.status = SessionStatus.completed
    session.ended_at = datetime.utcnow()
    await db.flush()
    await db.refresh(session)

    # 触发分析管线（mock 模式下同步执行）
    try:
        await analyze_session(session.id, db)
        await update_knowledge(session.id, uuid.UUID(current_user["id"]), db)
        await db.flush()
    except Exception as e:
        logger.warning("会话分析失败: %s", e)

    return session


@router.get("/sessions/{session_id}/token")
async def get_session_token(
    session_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """为指定会话生成加入房间的 LiveKit 令牌。并在签发前校验鉴权与连通状态。"""
    user_id = uuid.UUID(current_user["id"])

    # === 【Phase 6】鉴权拦截与连通性检查 ===
    user_stmt = (
        select(User).where(User.id == user_id).options(selectinload(User.settings))
    )
    user_result = await db.execute(user_stmt)
    user_obj = user_result.scalar_one_or_none()

    if not user_obj:
        raise HTTPException(status_code=401, detail="User not found.")

    settings_obj = user_obj.settings
    if not settings_obj:
        # 如果没有设置记录，表示纯新用户，需要求其去设置
        raise HTTPException(status_code=400, detail="请先在设置中完成模型与密钥配置。")

    # 1. 检查是否选择了自备密钥
    if settings_obj.is_custom_mode:
        # 自备密钥必须通过拨测（is_custom_verified == True）
        if not settings_obj.is_custom_verified:
            raise HTTPException(
                status_code=400, detail="自备密钥未验证或验证失败，请先完成密钥验证。"
            )
    else:
        # 用户试图走系统内置（System Mode）
        # 2. 只有非 free 会员能使用系统内置
        if user_obj.subscription_tier == SubscriptionTier.free:
            raise HTTPException(
                status_code=403, detail="高级服务器线路仅限 VIP 用户使用。"
            )
    # ==========================================

    # 验证会话存在
    stmt = select(Session).where(
        Session.id == session_id,
        Session.user_id == user_id,
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail="会话已结束，无法生成令牌")

    # 生成 LiveKit Token
    # room 名直接使用 session_id 字符串
    room_name = str(session.id)
    participant_identity = str(current_user["id"])
    participant_name = current_user.get("username", "Participant")

    grant = VideoGrants(room_join=True, room=room_name)
    access_token = AccessToken(
        settings.LIVEKIT_API_KEY,
        settings.LIVEKIT_API_SECRET,
    )
    access_token.with_identity(participant_identity)
    access_token.with_name(participant_name)
    access_token.with_grants(grant)

    token = access_token.to_jwt()

    return {"token": token, "ws_url": settings.LIVEKIT_URL}


@router.post("/sessions/{session_id}/dispatch")
async def dispatch_agent(
    session_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """前端已连接房间后调用，调度 Agent 加入。"""
    stmt = select(Session).where(
        Session.id == session_id,
        Session.user_id == uuid.UUID(current_user["id"]),
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail="会话已结束")

    room_name = str(session.id)

    try:
        async with LiveKitAPI(
            url=settings.LIVEKIT_URL,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        ) as lk_api:
            # 幂等：仅当房间无 dispatch 时才创建
            existing = await lk_api.agent_dispatch.list_dispatch(room_name)
            if not existing:
                await lk_api.agent_dispatch.create_dispatch(
                    CreateAgentDispatchRequest(room=room_name, agent_name="")
                )
    except Exception as e:
        logger.error("Agent 调度失败: %s", e)
        raise HTTPException(status_code=502, detail="语音服务暂时不可用，请稍后重试")

    return {"dispatched": True}
