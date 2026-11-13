"""健康检查路由。"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import CurrentUser
from config import settings
from database import get_db
from dependencies import get_current_user
from models.user import SubscriptionTier, User
from provider_catalog import PROVIDER_CATALOGS
from schemas.system_readiness import (
    SystemReadinessResponse,
    SystemReadinessUnavailableResponse,
)
from services.system_readiness import SystemReadinessError, check_system_readiness

router = APIRouter()


@router.get("/health")
async def health_check():
    """基础健康检查接口，用于验证服务是否正常运行。"""
    return {"status": "ok", "service": "echo-talk"}


@router.get(
    "/health/system-ready",
    response_model=SystemReadinessResponse,
    responses={
        503: {
            "model": SystemReadinessUnavailableResponse,
            "description": "Shared PostgreSQL is not ready.",
        }
    },
)
async def system_readiness_check() -> SystemReadinessResponse | JSONResponse:
    """公开的系统就绪检查；仅验证共享 PostgreSQL，而不判断用户练习权限。"""

    try:
        await check_system_readiness()
    except SystemReadinessError:
        return JSONResponse(
            status_code=503,
            content=SystemReadinessUnavailableResponse(status="not_ready").model_dump(),
        )
    return SystemReadinessResponse(status="ready")


@router.get("/health/ready")
async def readiness_check(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    深度健康检查，验证关键依赖（数据库、外部服务配置等）是否可用。
    如果各个检查通过，返回 ready，否则抛出 503 异常。
    """
    errors: dict[str, str] = {}
    reasons: set[str] = set()

    def fail(key: str, code: str, message: str) -> None:
        errors[key] = message
        reasons.add(code)

    def configured(value: object) -> bool:
        return isinstance(value, str) and bool(value.strip())

    real_roles = [
        role
        for role in PROVIDER_CATALOGS
        if not getattr(settings, f"USE_MOCK_{role.upper()}")
    ]
    user_obj = None
    user_settings = None
    database_failed = False
    try:
        if not settings.USE_MOCK_DB:
            await db.execute(text("SELECT 1"))
            stmt = (
                select(User)
                .where(User.id == current_user.id)
                .options(selectinload(User.settings))
            )
            result = await db.execute(stmt)
            user_obj = result.scalar_one_or_none()
            if user_obj is not None:
                user_settings = user_obj.settings
    except Exception:
        database_failed = True
        fail("database", "database_unavailable", "Database is temporarily unavailable")

    # DB mock 只替代数据库；不能绕过任一非 mock 语音角色的用户配置。
    if not database_failed and (not settings.USE_MOCK_DB or real_roles):
        if user_obj is None:
            fail("user", "user_unavailable", "User configuration is unavailable")
        elif real_roles and user_settings is None:
            fail("config", "settings_required", "Practice settings are required")

    if not settings.USE_MOCK_LIVEKIT and not all(
        configured(value)
        for value in (
            settings.LIVEKIT_URL,
            settings.LIVEKIT_API_KEY,
            settings.LIVEKIT_API_SECRET,
        )
    ):
        fail("livekit", "livekit_unconfigured", "LiveKit is not fully configured")

    if not database_failed and user_obj is not None and user_settings is not None:
        if real_roles and user_settings.is_custom_mode:
            if not user_settings.is_custom_verified:
                fail(
                    "config",
                    "custom_unverified",
                    "Custom credentials require verification",
                )
            for role in real_roles:
                provider = getattr(user_settings, f"{role}_provider", None)
                provider_id = getattr(provider, "value", provider)
                if provider_id not in PROVIDER_CATALOGS[role] or not configured(
                    getattr(user_settings, f"encrypted_{role}_key", None)
                ):
                    fail(
                        role,
                        "custom_incomplete",
                        "Custom provider configuration is incomplete",
                    )
        elif real_roles:
            if user_obj.subscription_tier == SubscriptionTier.free:
                fail(
                    "auth",
                    "permission_denied",
                    "System providers require a paid subscription",
                )
            for role in real_roles:
                catalog = PROVIDER_CATALOGS[role]
                if role == "llm":
                    provider = catalog.get(settings.DEFAULT_LLM_PROVIDER)
                else:
                    provider = next((p for p in catalog.values() if p.is_default), None)
                if (
                    provider is None
                    or not configured(getattr(settings, provider.api_key_field, None))
                    or (role == "llm" and not configured(settings.DEFAULT_LLM_MODEL))
                ):
                    fail(
                        role,
                        "provider_unconfigured",
                        "System provider is not fully configured",
                    )

    if errors:
        priority = (
            "database_unavailable",
            "user_unavailable",
            "settings_required",
            "custom_unverified",
            "custom_incomplete",
            "permission_denied",
            "livekit_unconfigured",
            "provider_unconfigured",
        )
        code = next(reason for reason in priority if reason in reasons)
        raise HTTPException(
            status_code=503,
            detail={"status": "not_ready", "errors": errors, "code": code},
        )

    return {"status": "ready"}
