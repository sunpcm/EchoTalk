"""用户设置路由：双轨制配置读写。"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from models.user import (
    LLMProvider,
    STTProvider,
    SubscriptionTier,
    TTSProvider,
    User,
    UserSettings,
)
from schemas.user import UserSettingsResponse, UserSettingsUpdate
from services.validation_service import (
    ProviderValidationResult,
    ProviderValidationService,
)
from utils.crypto import decrypt_api_key, encrypt_api_key

router = APIRouter()


def get_key_status(has_key: bool, is_valid: bool | None) -> str:
    if not has_key:
        return "unconfigured"
    if is_valid is False:
        return "error"
    if is_valid is True:
        return "verified"
    return "unconfigured"


def _decrypt_and_rotate(row: UserSettings, prefix: str) -> str | None:
    """读取某个凭据；旧版本被使用时立即改写为 active key。"""
    ciphertext = getattr(row, f"encrypted_{prefix}_key")
    if not ciphertext:
        return None
    decrypted = decrypt_api_key(ciphertext, getattr(row, f"{prefix}_key_version"))
    if decrypted.needs_rotation:
        encrypted = encrypt_api_key(decrypted.plaintext)
        setattr(row, f"encrypted_{prefix}_key", encrypted.ciphertext)
        setattr(row, f"{prefix}_key_version", encrypted.key_version)
    return decrypted.plaintext


def _as_validation_result(
    result: ProviderValidationResult | bool,
) -> ProviderValidationResult:
    """兼容测试替身，生产实现始终返回分类结果。"""
    if isinstance(result, ProviderValidationResult):
        return result
    return ProviderValidationResult(
        bool(result), "verified" if result else "provider_error"
    )


@router.get("/user/settings", response_model=UserSettingsResponse)
async def get_user_settings(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户的双轨制配置。密钥字段仅返回是否存在，不返回明文。"""
    user_id = current_user.id
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
        stt_status=get_key_status(has_stt, getattr(row, "stt_is_valid", None)),
        llm_status=get_key_status(has_llm, getattr(row, "llm_is_valid", None)),
        tts_status=get_key_status(has_tts, getattr(row, "tts_is_valid", None)),
    )


@router.put("/user/settings", response_model=UserSettingsResponse)
async def update_user_settings(
    body: UserSettingsUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新当前用户的双轨制配置。支持部分更新，密钥加密后入库。"""
    user_id = current_user.id

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

    stt_k = (
        body.stt_key if body.stt_key is not None else _decrypt_and_rotate(row, "stt")
    )
    llm_k = (
        body.llm_key if body.llm_key is not None else _decrypt_and_rotate(row, "llm")
    )
    tts_k = (
        body.tts_key if body.tts_key is not None else _decrypt_and_rotate(row, "tts")
    )

    stt_p_old = row.stt_provider.value if row.stt_provider else None
    llm_p_old = row.llm_provider.value if row.llm_provider else None
    tts_p_old = row.tts_provider.value if row.tts_provider else None

    stt_changed = (
        body.stt_provider is not None and body.stt_provider != stt_p_old
    ) or (body.stt_key is not None)
    llm_changed = (
        body.llm_provider is not None and body.llm_provider != llm_p_old
    ) or (body.llm_key is not None)
    tts_changed = (
        body.tts_provider is not None and body.tts_provider != tts_p_old
    ) or (body.tts_key is not None)

    stt_valid = getattr(row, "stt_is_valid", False) if not stt_changed else False
    validation_failures: dict[str, str] = {}
    if stt_changed and stt_p and stt_k:
        stt_result = _as_validation_result(
            await ProviderValidationService.validate_stt_key(stt_p, stt_k)
        )
        stt_valid = stt_result.ok
        if not stt_result.ok:
            validation_failures["stt"] = stt_result.code

    llm_valid = getattr(row, "llm_is_valid", False) if not llm_changed else False
    if llm_changed and llm_p and llm_k:
        llm_result = _as_validation_result(
            await ProviderValidationService.validate_llm_key(llm_p, llm_k)
        )
        llm_valid = llm_result.ok
        if not llm_result.ok:
            validation_failures["llm"] = llm_result.code

    tts_valid = getattr(row, "tts_is_valid", False) if not tts_changed else False
    if tts_changed and tts_p and tts_k:
        tts_result = _as_validation_result(
            await ProviderValidationService.validate_tts_key(tts_p, tts_k)
        )
        tts_valid = tts_result.ok
        if not tts_result.ok:
            validation_failures["tts"] = tts_result.code

    if validation_failures:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "provider_key_validation_failed",
                "providers": validation_failures,
            },
        )

    row.stt_is_valid = bool(stt_valid)
    row.llm_is_valid = bool(llm_valid)
    row.tts_is_valid = bool(tts_valid)

    row.is_custom_verified = bool(
        row.stt_is_valid and row.llm_is_valid and row.tts_is_valid
    )

    if body.is_custom_mode is not None:
        row.is_custom_mode = body.is_custom_mode
    if body.stt_provider is not None:
        row.stt_provider = STTProvider(body.stt_provider)
    if body.llm_provider is not None:
        row.llm_provider = LLMProvider(body.llm_provider)
    if body.llm_model is not None:
        row.llm_model = body.llm_model
    if body.tts_provider is not None:
        row.tts_provider = TTSProvider(body.tts_provider)

    if body.stt_key is not None:
        encrypted = encrypt_api_key(body.stt_key)
        row.encrypted_stt_key = encrypted.ciphertext
        row.stt_key_version = encrypted.key_version
    if body.llm_key is not None:
        encrypted = encrypt_api_key(body.llm_key)
        row.encrypted_llm_key = encrypted.ciphertext
        row.llm_key_version = encrypted.key_version
    if body.tts_key is not None:
        encrypted = encrypt_api_key(body.tts_key)
        row.encrypted_tts_key = encrypted.ciphertext
        row.tts_key_version = encrypted.key_version

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
        stt_status=get_key_status(has_stt, getattr(row, "stt_is_valid", None)),
        llm_status=get_key_status(has_llm, getattr(row, "llm_is_valid", None)),
        tts_status=get_key_status(has_tts, getattr(row, "tts_is_valid", None)),
    )
