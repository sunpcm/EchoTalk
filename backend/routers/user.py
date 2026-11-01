"""用户设置路由：双轨制配置读写。"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from models.user import (
    User,
    UserSettings,
)
from schemas.user import UserSettingsResponse, UserSettingsUpdate
from services.user_settings_service import (
    UserSettingsService,
)
from services.validation_service import (
    ProviderValidationResult,
    ProviderValidationService,
)
from utils.crypto import decrypt_api_key, encrypt_api_key

router = APIRouter()


def get_key_status(has_key: bool, is_valid: bool | None) -> str:
    """薄兼容委托：获取密钥状态。"""
    return UserSettingsService.get_key_status(has_key, is_valid)


def _decrypt_and_rotate(row: UserSettings, prefix: str) -> str | None:
    """薄兼容委托：读取某个凭据；旧版本被使用时立即改写为 active key。"""
    return UserSettingsService.decrypt_and_rotate(
        row,
        prefix,
        decrypt_fn=decrypt_api_key,
        encrypt_fn=encrypt_api_key,
    )


def _as_validation_result(
    result: ProviderValidationResult | bool,
) -> ProviderValidationResult:
    """薄兼容委托：兼容测试替身，生产实现始终返回分类结果。"""
    return UserSettingsService.as_validation_result(result)


def _build_user_settings_response(
    row: UserSettings | None, tier: str
) -> UserSettingsResponse:
    """薄兼容委托：从数据库 UserSettings 对象与订阅等级构建 UserSettingsResponse 响应结构。"""
    return UserSettingsService.build_user_settings_response(row, tier)


def _validate_custom_mode_permission(
    user_obj: User | None, is_custom_mode: bool | None
) -> None:
    """薄兼容委托：鉴权：只有非 free 用户才能关闭 is_custom_mode。"""
    UserSettingsService.validate_custom_mode_permission(user_obj, is_custom_mode)


async def _validate_provider_keys(
    row: UserSettings, body: UserSettingsUpdate
) -> tuple[bool, bool, bool]:
    """薄兼容委托：校验各种 provider key 是否有效。如有不合法 key 抛出 422 异常。"""
    return await UserSettingsService.validate_provider_keys(
        row,
        body,
        decrypt_fn=decrypt_api_key,
        encrypt_fn=encrypt_api_key,
        validation_service=ProviderValidationService,
    )


def _apply_settings_update(
    row: UserSettings,
    body: UserSettingsUpdate,
    stt_valid: bool,
    llm_valid: bool,
    tts_valid: bool,
) -> None:
    """薄兼容委托：按请求更新 UserSettings 行属性并加密存放 API key。"""
    UserSettingsService.apply_settings_update(
        row,
        body,
        stt_valid,
        llm_valid,
        tts_valid,
        encrypt_fn=encrypt_api_key,
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

    return UserSettingsService.build_user_settings_response(row, tier)


@router.put("/user/settings", response_model=UserSettingsResponse)
async def update_user_settings(
    body: UserSettingsUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新当前用户的双轨制配置。支持部分更新，密钥加密后入库。"""
    user_id = current_user.id

    user_stmt = select(User).where(User.id == user_id)
    user_result = await db.execute(user_stmt)
    user_obj = user_result.scalar_one_or_none()
    UserSettingsService.validate_custom_mode_permission(user_obj, body.is_custom_mode)
    tier = user_obj.subscription_tier.value if user_obj else "free"

    stmt = select(UserSettings).where(UserSettings.user_id == user_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if row is None:
        row = UserSettings(user_id=user_id)
        db.add(row)

    stt_valid, llm_valid, tts_valid = await UserSettingsService.validate_provider_keys(
        row,
        body,
        decrypt_fn=decrypt_api_key,
        encrypt_fn=encrypt_api_key,
        validation_service=ProviderValidationService,
    )

    UserSettingsService.apply_settings_update(
        row,
        body,
        stt_valid,
        llm_valid,
        tts_valid,
        encrypt_fn=encrypt_api_key,
    )

    await db.flush()
    await db.refresh(row)

    return UserSettingsService.build_user_settings_response(row, tier)
