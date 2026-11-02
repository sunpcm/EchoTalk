"""用户设置业务服务：设置响应构建、权限判断、按变更凭据验证与更新/加密业务逻辑。"""

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, status

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
from utils.crypto import (
    DecryptedCredential,
    EncryptedCredential,
    decrypt_api_key,
    encrypt_api_key,
)


def get_key_status(has_key: bool, is_valid: bool | None) -> str:
    """根据密钥是否存在及验证状态计算三态状态字符串。"""
    if not has_key:
        return "unconfigured"
    if is_valid is False:
        return "error"
    if is_valid is True:
        return "verified"
    return "unconfigured"


def decrypt_and_rotate(
    row: UserSettings,
    prefix: str,
    *,
    decrypt_fn: Callable[[str, str | None], DecryptedCredential] | None = None,
    encrypt_fn: Callable[[str], EncryptedCredential] | None = None,
) -> str | None:
    """读取某个凭据；旧版本被使用时立即改写为 active key。"""
    ciphertext = getattr(row, f"encrypted_{prefix}_key")
    if not ciphertext:
        return None
    _decrypt = decrypt_fn if decrypt_fn is not None else decrypt_api_key
    _encrypt = encrypt_fn if encrypt_fn is not None else encrypt_api_key
    decrypted = _decrypt(ciphertext, getattr(row, f"{prefix}_key_version"))
    if decrypted.needs_rotation:
        encrypted = _encrypt(decrypted.plaintext)
        setattr(row, f"encrypted_{prefix}_key", encrypted.ciphertext)
        setattr(row, f"{prefix}_key_version", encrypted.key_version)
    return decrypted.plaintext


def as_validation_result(
    result: ProviderValidationResult | bool,
) -> ProviderValidationResult:
    """兼容测试替身，生产实现始终返回分类结果。"""
    if isinstance(result, ProviderValidationResult):
        return result
    return ProviderValidationResult(
        bool(result), "verified" if result else "provider_error"
    )


def build_user_settings_response(
    row: UserSettings | None, tier: str
) -> UserSettingsResponse:
    """从数据库 UserSettings 对象与订阅等级构建 UserSettingsResponse 响应结构。"""
    if row is None:
        return UserSettingsResponse(subscription_tier=tier)

    has_stt = row.encrypted_stt_key is not None
    has_llm = row.encrypted_llm_key is not None
    has_tts = row.encrypted_tts_key is not None

    return UserSettingsResponse(
        is_custom_mode=row.is_custom_mode,
        is_custom_verified=row.is_custom_verified,
        subscription_tier=tier,
        theme=row.theme if getattr(row, "theme", None) else "warm",
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


def validate_custom_mode_permission(
    user_obj: User | None, is_custom_mode: bool | None
) -> None:
    """鉴权：只有非 free 用户才能关闭 is_custom_mode。"""
    if is_custom_mode is False:
        if user_obj and user_obj.subscription_tier == SubscriptionTier.free:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Free tier users cannot disable custom mode.",
            )


async def validate_provider_keys(
    row: UserSettings,
    body: UserSettingsUpdate,
    *,
    decrypt_fn: Callable[[str, str | None], DecryptedCredential] | None = None,
    encrypt_fn: Callable[[str], EncryptedCredential] | None = None,
    validation_service: type[ProviderValidationService] | Any = None,
) -> tuple[bool, bool, bool]:
    """校验各种 provider key 是否有效。如有不合法的 provider key，抛出 422 异常。

    返回 tuple: (stt_valid, llm_valid, tts_valid)
    """
    val_service = (
        validation_service
        if validation_service is not None
        else ProviderValidationService
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
    llm_valid = getattr(row, "llm_is_valid", False) if not llm_changed else False
    tts_valid = getattr(row, "tts_is_valid", False) if not tts_changed else False

    to_validate: list[tuple[str, str, str]] = []

    if stt_changed:
        stt_p = body.stt_provider or stt_p_old
        stt_k = (
            body.stt_key
            if body.stt_key is not None
            else decrypt_and_rotate(
                row, "stt", decrypt_fn=decrypt_fn, encrypt_fn=encrypt_fn
            )
        )
        if stt_p and stt_k:
            to_validate.append(("stt", stt_p, stt_k))

    if llm_changed:
        llm_p = body.llm_provider or llm_p_old
        llm_k = (
            body.llm_key
            if body.llm_key is not None
            else decrypt_and_rotate(
                row, "llm", decrypt_fn=decrypt_fn, encrypt_fn=encrypt_fn
            )
        )
        if llm_p and llm_k:
            to_validate.append(("llm", llm_p, llm_k))

    if tts_changed:
        tts_p = body.tts_provider or tts_p_old
        tts_k = (
            body.tts_key
            if body.tts_key is not None
            else decrypt_and_rotate(
                row, "tts", decrypt_fn=decrypt_fn, encrypt_fn=encrypt_fn
            )
        )
        if tts_p and tts_k:
            to_validate.append(("tts", tts_p, tts_k))

    validation_failures: dict[str, str] = {}
    if to_validate:
        results = await val_service.validate_parallel(to_validate)
        for role in ("stt", "llm", "tts"):
            if role in results:
                res = as_validation_result(results[role])
                if res.ok:
                    if role == "stt":
                        stt_valid = True
                    elif role == "llm":
                        llm_valid = True
                    elif role == "tts":
                        tts_valid = True
                else:
                    validation_failures[role] = res.code

    if validation_failures:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "provider_key_validation_failed",
                "providers": validation_failures,
            },
        )

    return bool(stt_valid), bool(llm_valid), bool(tts_valid)


def apply_settings_update(
    row: UserSettings,
    body: UserSettingsUpdate,
    stt_valid: bool,
    llm_valid: bool,
    tts_valid: bool,
    *,
    encrypt_fn: Callable[[str], EncryptedCredential] | None = None,
) -> None:
    """按请求更新 UserSettings 行属性并加密存放 API key。"""
    _encrypt = encrypt_fn if encrypt_fn is not None else encrypt_api_key

    row.stt_is_valid = stt_valid
    row.llm_is_valid = llm_valid
    row.tts_is_valid = tts_valid

    row.is_custom_verified = bool(
        row.stt_is_valid and row.llm_is_valid and row.tts_is_valid
    )

    if body.is_custom_mode is not None:
        row.is_custom_mode = body.is_custom_mode
    if body.theme is not None:
        row.theme = body.theme
    if body.stt_provider is not None:
        row.stt_provider = STTProvider(body.stt_provider)
    if body.llm_provider is not None:
        row.llm_provider = LLMProvider(body.llm_provider)
    if body.llm_model is not None:
        row.llm_model = body.llm_model
    if body.tts_provider is not None:
        row.tts_provider = TTSProvider(body.tts_provider)

    if body.stt_key is not None:
        encrypted = _encrypt(body.stt_key)
        row.encrypted_stt_key = encrypted.ciphertext
        row.stt_key_version = encrypted.key_version
    if body.llm_key is not None:
        encrypted = _encrypt(body.llm_key)
        row.encrypted_llm_key = encrypted.ciphertext
        row.llm_key_version = encrypted.key_version
    if body.tts_key is not None:
        encrypted = _encrypt(body.tts_key)
        row.encrypted_tts_key = encrypted.ciphertext
        row.tts_key_version = encrypted.key_version


class UserSettingsService:
    """用户设置领域服务无状态命名空间。"""

    get_key_status = staticmethod(get_key_status)
    decrypt_and_rotate = staticmethod(decrypt_and_rotate)
    as_validation_result = staticmethod(as_validation_result)
    build_user_settings_response = staticmethod(build_user_settings_response)
    validate_custom_mode_permission = staticmethod(validate_custom_mode_permission)
    validate_provider_keys = staticmethod(validate_provider_keys)
    apply_settings_update = staticmethod(apply_settings_update)
