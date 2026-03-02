"""发音评估与知识追踪路由。"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.session import Session
from schemas.assessment import (
    AssessmentResponse,
    GrammarErrorResponse,
    KnowledgeStateResponse,
    SkillResponse,
)

router = APIRouter()


# ─── 知识追踪端点（必须在 /{session_id} 之前，避免路径冲突） ───


@router.get(
    "/assessments/knowledge/states",
    response_model=list[KnowledgeStateResponse],
)
async def get_knowledge_states(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询当前用户的所有知识状态。"""
    user_id = uuid.UUID(current_user["id"])
    stmt = (
        select(KnowledgeState, Skill)
        .join(Skill, KnowledgeState.skill_id == Skill.id)
        .where(KnowledgeState.user_id == user_id)
        .order_by(Skill.category, Skill.id)
    )
    result = await db.execute(stmt)
    rows = result.all()

    return [
        KnowledgeStateResponse(
            id=state.id,
            user_id=state.user_id,
            skill_id=state.skill_id,
            skill_name=skill.name,
            skill_category=skill.category,
            p_mastery=state.p_mastery,
            updated_at=state.updated_at,
        )
        for state, skill in rows
    ]


@router.get(
    "/assessments/knowledge/skills",
    response_model=list[SkillResponse],
)
async def list_skills(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询所有技能定义。"""
    stmt = select(Skill).order_by(Skill.category, Skill.id)
    result = await db.execute(stmt)
    skills = result.scalars().all()
    return skills


# ─── 发音评估端点 ───


@router.get(
    "/assessments/{session_id}",
    response_model=AssessmentResponse,
)
async def get_assessment(
    session_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询发音评估结果。"""
    # 验证会话归属
    session = await _verify_session_owner(session_id, current_user, db)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    stmt = select(PronunciationAssessment).where(
        PronunciationAssessment.session_id == session_id
    )
    result = await db.execute(stmt)
    assessment = result.scalar_one_or_none()

    if assessment is None:
        raise HTTPException(status_code=404, detail="评估结果不存在")

    return assessment


@router.get(
    "/assessments/{session_id}/grammar",
    response_model=list[GrammarErrorResponse],
)
async def get_grammar_errors(
    session_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询语法错误列表。"""
    session = await _verify_session_owner(session_id, current_user, db)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    stmt = (
        select(GrammarError)
        .where(GrammarError.session_id == session_id)
        .order_by(GrammarError.created_at)
    )
    result = await db.execute(stmt)
    errors = result.scalars().all()
    return errors


# ─── 工具函数 ───


async def _verify_session_owner(
    session_id: uuid.UUID,
    current_user: dict,
    db: AsyncSession,
) -> Session | None:
    """验证会话存在且属于当前用户。"""
    stmt = select(Session).where(
        Session.id == session_id,
        Session.user_id == uuid.UUID(current_user["id"]),
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
