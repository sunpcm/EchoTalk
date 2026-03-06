"""用户设置路由：双轨制配置读写。"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.user import UserSettings
from schemas.user import UserSettingsResponse, UserSettingsUpdate
from utils.crypto import encrypt_api_key

router = APIRouter()


@router.get("/user/settings", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户的双轨制配置。密钥字段仅返回是否存在，不返回明文。"""
    user_id = uuid.UUID(current_user["id"])
    stmt = select(UserSettings).where(UserSettings.user_id == user_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if row is None:
        return UserSettingsResponse()

    return UserSettingsResponse(
        is_custom_mode=row.is_custom_mode,
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
    stmt = select(UserSettings).where(UserSettings.user_id == user_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if row is None:
        row = UserSettings(user_id=user_id)
        db.add(row)

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

    return UserSettingsResponse(
        is_custom_mode=row.is_custom_mode,
        stt_provider=row.stt_provider.value if row.stt_provider else None,
        llm_provider=row.llm_provider.value if row.llm_provider else None,
        llm_model=row.llm_model,
        tts_provider=row.tts_provider.value if row.tts_provider else None,
        has_stt_key=row.encrypted_stt_key is not None,
        has_llm_key=row.encrypted_llm_key is not None,
        has_tts_key=row.encrypted_tts_key is not None,
    )
