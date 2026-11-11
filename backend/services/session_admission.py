"""会话准入服务：用户/密钥/套餐校验与活跃会话状态校验。"""

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.session import Session, SessionStatus
from models.user import SubscriptionTier, User


async def verify_session_admission(db: AsyncSession, user_id: uuid.UUID) -> None:
    """校验用户存在、设置已配置、自备密钥已验证及套餐权限。"""
    user_stmt = (
        select(User).where(User.id == user_id).options(selectinload(User.settings))
    )
    user_obj = (await db.execute(user_stmt)).scalar_one_or_none()
    if not user_obj:
        raise HTTPException(status_code=401, detail="User not found.")
    settings_obj = user_obj.settings
    if not settings_obj:
        raise HTTPException(status_code=400, detail="请先在设置中完成模型与密钥配置。")
    if settings_obj.is_custom_mode:
        if not settings_obj.is_custom_verified:
            raise HTTPException(
                status_code=400,
                detail="自备密钥未验证或验证失败，请先完成密钥验证。",
            )
    else:
        if user_obj.subscription_tier == SubscriptionTier.free:
            raise HTTPException(
                status_code=403, detail="高级服务器线路仅限 VIP 用户使用。"
            )


async def get_active_session_or_raise(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    ended_detail: str,
) -> Session:
    """按所有权读取活跃会话；不存在 404，已结束按 ended_detail 抛 400。"""
    stmt = select(Session).where(
        Session.id == session_id,
        Session.user_id == user_id,
    )
    session = (await db.execute(stmt)).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail=ended_detail)
    return session
