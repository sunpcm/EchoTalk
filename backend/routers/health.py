"""健康检查路由。"""

import uuid
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from dependencies import get_current_user
from models.user import UserSettings

router = APIRouter()


@router.get("/health")
async def health_check():
    """基础健康检查接口，用于验证服务是否正常运行。"""
    return {"status": "ok", "service": "echo-talk"}


@router.get("/health/ready")
async def readiness_check(
    current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    深度健康检查，验证关键依赖（数据库、外部服务配置等）是否可用。
    如果各个检查通过，返回 ready，否则抛出 503 异常。
    """
    errors: Dict[str, str] = {}

    # 1. 检查数据库连通性并获取用户配置
    user_settings = None
    try:
        if not settings.USE_MOCK_DB:
            await db.execute(text("SELECT 1"))

            # 获取当前用户的配置（Step 2）
            user_id = uuid.UUID(current_user["id"])
            stmt = select(UserSettings).where(UserSettings.user_id == user_id)
            result = await db.execute(stmt)
            user_settings = result.scalar_one_or_none()
    except Exception as e:
        errors["database"] = f"DB connection failed: {str(e)}"

    # 2. 检查 LiveKit 配置
    if not settings.USE_MOCK_LIVEKIT:
        if (
            not settings.LIVEKIT_URL
            or not settings.LIVEKIT_API_KEY
            or not settings.LIVEKIT_API_SECRET
        ):
            errors["livekit"] = "LiveKit credentials are not fully configured"

    # 3. 检查 LLM 配置 (基于双轨制逻辑，Step 3)
    if not settings.USE_MOCK_LLM:
        is_custom_mode = user_settings.is_custom_mode if user_settings else False

        if is_custom_mode:
            # 分支 B: 自定义模式，检查用户是否提供了密钥
            if not user_settings or not user_settings.encrypted_llm_key:
                errors["llm"] = "自备密钥模式已开启，但未提供有效的 LLM API Key"
        else:
            # 分支 A: 平台兜底模式，检查环境变量
            if not settings.SILICONFLOW_API_KEY and not settings.OPENROUTER_API_KEY:
                errors["llm"] = "No global LLM API key configured"

    if errors:
        raise HTTPException(
            status_code=503, detail={"status": "not_ready", "errors": errors}
        )

    return {"status": "ready"}
