"""
EchoTalk 后端 FastAPI 应用入口。
负责 CORS 配置、路由注册、生命周期管理。
"""

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import async_session_maker
from dependencies import MOCK_USER_ID
from models.user import User
from routers import conversation, health, sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时确保 Mock 测试用户存在。"""
    async with async_session_maker() as session:
        mock_uuid = uuid.UUID(MOCK_USER_ID)
        existing = await session.get(User, mock_uuid)
        if not existing:
            user = User(
                id=mock_uuid,
                email="test@example.com",
                password_hash=None,
            )
            session.add(user)
            await session.commit()
    yield


app = FastAPI(
    title="EchoTalk API",
    version="0.1.0",
    description="AI 口语练习系统后端",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(health.router, prefix="/api", tags=["健康检查"])
app.include_router(sessions.router, prefix="/api", tags=["会话管理"])
app.include_router(conversation.router, prefix="/api", tags=["对话"])
