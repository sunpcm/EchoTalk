"""用户设置路由：双轨制配置读写。"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.user import User, UserSettings, SubscriptionTier
from schemas.user import UserSettingsResponse, UserSettingsUpdate
from utils.crypto import encrypt_api_key, decrypt_api_key
from services.validation_service import ProviderValidationService

router = APIRouter()


@router.get("/user/settings", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户的双轨制配置。密钥字段仅返回是否存在，不返回明文。"""
    user_id = uuid.UUID(current_user["id"])
    user_stmt = select(User).where(User.id == user_id)
    user_result = await db.execute(user_stmt)
    user_obj = user_result.scalar_one_or_none()

    tier = user_obj.subscription_tier.value if user_obj else "free"

    stmt = select(UserSettings).where(UserSettings.user_id == user_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if row is None:
        return UserSettingsResponse(subscription_tier=tier)

    return UserSettingsResponse(
        is_custom_mode=row.is_custom_mode,
        is_custom_verified=row.is_custom_verified,
        subscription_tier=tier,
        stt_provider=row.stt_provider.value if row.stt_provider else None,
        llm_provider=row.llm_provider.value if row.llm_provider else None,
        llm_model=row.llm_model,
        tts_provider=row.tts_provider.value if row.tts_provider else None,
        has_stt_key=row.encrypted_stt_key is not None,
        has_llm_key=row.encrypted_llm_key is not None,
        has_tts_key=row.encrypted_tts_key is not None,
    )


@router.put("/user/settings", response_model=UserSettingsResponse)
async def update_user_settings(
    body: UserSettingsUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新当前用户的双轨制配置。支持部分更新，密钥加密后入库。"""
    user_id = uuid.UUID(current_user["id"])

    # 鉴权：只有非 free 用户才能关闭 is_custom_mode
    if body.is_custom_mode is False:
        user_stmt = select(User).where(User.id == user_id)
        user_result = await db.execute(user_stmt)
        user_obj = user_result.scalar_one_or_none()
        if user_obj and user_obj.subscription_tier == SubscriptionTier.free:
            # 或者强制覆盖为 True: body.is_custom_mode = True
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Free tier users cannot disable custom mode.",
            )

    stmt = select(UserSettings).where(UserSettings.user_id == user_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if row is None:
        row = UserSettings(user_id=user_id)
        db.add(row)

    # 提取用于拨测的上下文（合并新的和旧的配置）
    stt_p = body.stt_provider or (row.stt_provider.value if row.stt_provider else None)
    llm_p = body.llm_provider or (row.llm_provider.value if row.llm_provider else None)
    tts_p = body.tts_provider or (row.tts_provider.value if row.tts_provider else None)

    stt_k = (
        body.stt_key
        if body.stt_key is not None
        else (decrypt_api_key(row.encrypted_stt_key) if row.encrypted_stt_key else None)
    )
    llm_k = (
        body.llm_key
        if body.llm_key is not None
        else (decrypt_api_key(row.encrypted_llm_key) if row.encrypted_llm_key else None)
    )
    tts_k = (
        body.tts_key
        if body.tts_key is not None
        else (decrypt_api_key(row.encrypted_tts_key) if row.encrypted_tts_key else None)
    )

    # 执行拨测
    if stt_p and llm_p and tts_p and stt_k and llm_k and tts_k:
        is_valid = await ProviderValidationService.validate_all(
            stt_p, stt_k, llm_p, llm_k, tts_p, tts_k
        )
        row.is_custom_verified = is_valid
    else:
        # 信息不全，不可能通过拨测
        row.is_custom_verified = False

    # 更新非密钥字段（仅当请求中提供了该字段时）
    if body.is_custom_mode is not None:
        row.is_custom_mode = body.is_custom_mode
    if body.stt_provider is not None:
        row.stt_provider = body.stt_provider
    if body.llm_provider is not None:
        row.llm_provider = body.llm_provider
    if body.llm_model is not None:
        row.llm_model = body.llm_model
    if body.tts_provider is not None:
        row.tts_provider = body.tts_provider

    # 加密并更新密钥字段
    if body.stt_key is not None:
        row.encrypted_stt_key = encrypt_api_key(body.stt_key)
    if body.llm_key is not None:
        row.encrypted_llm_key = encrypt_api_key(body.llm_key)
    if body.tts_key is not None:
        row.encrypted_tts_key = encrypt_api_key(body.tts_key)

    await db.flush()
    await db.refresh(row)

    # 重新获取用户实体以取得最新 tier（虽然本接口不改 tier）
    user_stmt2 = select(User).where(User.id == user_id)
    user_result2 = await db.execute(user_stmt2)
    user_obj_db = user_result2.scalar_one_or_none()
    tier = user_obj_db.subscription_tier.value if user_obj_db else "free"

    return UserSettingsResponse(
        is_custom_mode=row.is_custom_mode,
        is_custom_verified=row.is_custom_verified,
        subscription_tier=tier,
        stt_provider=row.stt_provider.value if row.stt_provider else None,
        llm_provider=row.llm_provider.value if row.llm_provider else None,
        llm_model=row.llm_model,
        tts_provider=row.tts_provider.value if row.tts_provider else None,
        has_stt_key=row.encrypted_stt_key is not None,
        has_llm_key=row.encrypted_llm_key is not None,
        has_tts_key=row.encrypted_tts_key is not None,
    )
