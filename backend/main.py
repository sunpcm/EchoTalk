"""
EchoTalk 后端 FastAPI 应用入口。
负责 CORS 配置、路由注册、生命周期管理。
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from config import settings
from database import async_session_maker
from models.knowledge import SEED_SKILLS, Skill
from routers import assessment, conversation, curriculum, health, sessions, user


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：验证安全配置并写入幂等参考数据。"""
    settings.validate_runtime()
    async with async_session_maker() as session:
        # 种子技能数据（Phase 2）
        if SEED_SKILLS:
            seed_ids = [s["id"] for s in SEED_SKILLS]
            stmt = select(Skill.id).where(Skill.id.in_(seed_ids))
            result = await session.execute(stmt)
            existing_ids = set(result.scalars().all())

            for skill_data in SEED_SKILLS:
                if skill_data["id"] not in existing_ids:
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
    allow_methods=settings.CORS_ALLOW_METHODS,
    allow_headers=settings.CORS_ALLOW_HEADERS,
)

# 注册路由
app.include_router(health.router, prefix="/api", tags=["健康检查"])
app.include_router(sessions.router, prefix="/api", tags=["会话管理"])
app.include_router(conversation.router, prefix="/api", tags=["对话"])
app.include_router(assessment.router, prefix="/api", tags=["发音评估与知识追踪"])
app.include_router(curriculum.router, prefix="/api", tags=["自适应课程推荐"])
app.include_router(user.router, prefix="/api", tags=["用户设置"])
