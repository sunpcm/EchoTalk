import sys
from pathlib import Path

file_path = Path("/home/niu/code/EchoTalk/backend/routers/user.py")

new_content = """用户设置路由：双轨制配置读写。\"\"\"
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

def get_key_status(has_key: bool, is_valid: bool | None) -> str:
    if not has_key:
        return "unconfigured"
    if is_valid is False:
        return "error"
    if is_valid is True:
        return "verified"
    return "unconfigured"

@router.get("/user/settings", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    \"\"\"获取当前用户的双轨制配置。密钥字段仅返回是否存在，不返回明文。\"\"\"
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

    has_stt = row.encrypted_stt_key is not None
    has_llm = row.encrypted_llm_key is not None
    has_tts = row.encrypted_tts_key is not None

    return UserSettingsResponse(
        is_custom_mode=row.is_custom_mode,
        is_custom_verified=row.is_custom_verified,
        subscription_tier=tier,
        stt_provider=row.stt_provider.value if row.stt_provider else None,
        llm_provider=row.llm_provider.value if row.llm_provider else None,
        llm_model=row.llm_model,
        tts_provider=row.tts_provider.value if row.tts_provider else None,
        has_stt_key=has_stt,
        has_llm_key=has_llm,
        has_tts_key=has_tts,
        stt_status=get_key_status(has_stt, getattr(row, 'stt_is_valid', None)),
        llm_status=get_key_status(has_llm, getattr(row, 'llm_is_valid', None)),
        tts_status=get_key_status(has_tts, getattr(row, 'tts_is_valid', None)),
    )


@router.put("/user/settings", response_model=UserSettingsResponse)
async def update_user_settings(
    body: UserSettingsUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    \"\"\"更新当前用户的双轨制配置。支持部分更新，密钥加密后入库。\"\"\"
    user_id = uuid.UUID(current_user["id"])

    # 鉴权：只有非 free 用户才能关闭 is_custom_mode
    if body.is_custom_mode is False:
        user_stmt = select(User).where(User.id == user_id)
        user_result = await db.execute(user_stmt)
        user_obj = user_result.scalar_one_or_none()
        if user_obj and user_obj.subscription_tier == SubscriptionTier.free:
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

    stt_p = body.stt_provider or (row.stt_provider.value if row.stt_provider else None)
    llm_p = body.llm_provider or (row.llm_provider.value if row.llm_provider else None)
    tts_p = body.tts_provider or (row.tts_provider.value if row.tts_provider else None)
    
    stt_k = body.stt_key if body.stt_key is not None else (decrypt_api_key(row.encrypted_stt_key) if row.encrypted_stt_key else None)
    llm_k = body.llm_key if body.llm_key is not None else (decrypt_api_key(row.encrypted_llm_key) if row.encrypted_llm_key else None)
    tts_k = body.tts_key if body.tts_key is not None else (decrypt_api_key(row.encrypted_tts_key) if row.encrypted_tts_key else None)

    stt_valid = getattr(row, 'stt_is_valid', False) if (body.stt_provider is None and body.stt_key is None) else False
    if (body.stt_provider is not None or body.stt_key is not None) and stt_p and stt_k:
        try:
            stt_valid = await ProviderValidationService.validate_stt_key(stt_p, stt_k)
        except Exception:
            stt_valid = False
            
    llm_valid = getattr(row, 'llm_is_valid', False) if (body.llm_provider is None and body.llm_key is None) else False
    if (body.llm_provider is not None or body.llm_key is not None) and llm_p and llm_k:
        try:
            llm_valid = await ProviderValidationService.validate_llm_key(llm_p, llm_k)
        except Exception:
            llm_valid = False

    tts_valid = getattr(row, 'tts_is_valid', False) if (body.tts_provider is None and body.tts_key is None) else False
    if (body.tts_provider is not None or body.tts_key is not None) and tts_p and tts_k:
        try:
            tts_valid = await ProviderValidationService.validate_tts_key(tts_p, tts_k)
        except Exception:
            tts_valid = False

    failed_validations = []
    if (body.stt_provider is not None or body.stt_key is not None) and stt_p and stt_k and not stt_valid:
        failed_validations.append(f"STT: {stt_p}")
    if (body.llm_provider is not None or body.llm_key is not None) and llm_p and llm_k and not llm_valid:
        failed_validations.append(f"LLM: {llm_p}")
    if (body.tts_provider is not None or body.tts_key is not None) and tts_p and tts_k and not tts_valid:
        failed_validations.append(f"TTS: {tts_p}")
        
    if failed_validations:
        raise HTTPException(
            status_code=422,
            detail=f"Key Validation Failed for: {', '.join(failed_validations)}"
        )

    row.stt_is_valid = bool(stt_valid)
    row.llm_is_valid = bool(llm_valid)
    row.tts_is_valid = bool(tts_valid)

    row.is_custom_verified = bool(row.stt_is_valid and row.llm_is_valid and row.tts_is_valid)

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

    if body.stt_key is not None:
        row.encrypted_stt_key = encrypt_api_key(body.stt_key)
    if body.llm_key is not None:
        row.encrypted_llm_key = encrypt_api_key(body.llm_key)
    if body.tts_key is not None:
        row.encrypted_tts_key = encrypt_api_key(body.tts_key)

    await db.flush()
    await db.refresh(row)

    user_stmt2 = select(User).where(User.id == user_id)
    user_result2 = await db.execute(user_stmt2)
    user_obj_db = user_result2.scalar_one_or_none()
    tier = user_obj_db.subscription_tier.value if user_obj_db else "free"

    has_stt = row.encrypted_stt_key is not None
    has_llm = row.encrypted_llm_key is not None
    has_tts = row.encrypted_tts_key is not None

    return UserSettingsResponse(
        is_custom_mode=row.is_custom_mode,
        is_custom_verified=row.is_custom_verified,
        subscription_tier=tier,
        stt_provider=row.stt_provider.value if row.stt_provider else None,
        llm_provider=row.llm_provider.value if row.llm_provider else None,
        llm_model=row.llm_model,
        tts_provider=row.tts_provider.value if row.tts_provider else None,
        has_stt_key=has_stt,
        has_llm_key=has_llm,
        has_tts_key=has_tts,
        stt_status=get_key_status(has_stt, getattr(row, 'stt_is_valid', None)),
        llm_status=get_key_status(has_llm, getattr(row, 'llm_is_valid', None)),
        tts_status=get_key_status(has_tts, getattr(row, 'tts_is_valid', None)),
    )
"""

with open(file_path, "w", encoding="utf-8") as f:
    f.write('"""' + new_content)

