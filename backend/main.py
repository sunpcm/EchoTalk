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
from models.knowledge import SEED_SKILLS, Skill
from models.user import User
from routers import assessment, conversation, curriculum, health, sessions, user


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时确保 Mock 测试用户和种子技能数据存在。"""
    async with async_session_maker() as session:
        # 确保 Mock 测试用户存在
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

        # 种子技能数据（Phase 2）
        for skill_data in SEED_SKILLS:
            existing_skill = await session.get(Skill, skill_data["id"])
            if not existing_skill:
                session.add(Skill(**skill_data))
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
app.include_router(assessment.router, prefix="/api", tags=["发音评估与知识追踪"])
app.include_router(curriculum.router, prefix="/api", tags=["自适应课程推荐"])
app.include_router(user.router, prefix="/api", tags=["用户设置"])
