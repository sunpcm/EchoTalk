"""自适应课程推荐路由：基于 BKT 弱项 + RAG 检索生成定制化练习场景。"""

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.knowledge import KnowledgeState, Skill
from services.knowledge.bkt_model import MASTERY_THRESHOLD
from services.rag_service import retrieve_materials

router = APIRouter()


# ─── 响应模型 ──────────────────────────────────────────────────


class CurriculumRecommendation(BaseModel):
    """单条课程推荐。"""

    scenario_name: str
    difficulty_cefr: str
    category: str
    focus_skills: list[str]
    system_prompt_template: str


class CurriculumNextResponse(BaseModel):
    """GET /api/curriculum/next 响应体。"""

    weakest_skill: str
    weakest_skill_mastery: float
    target_level: str
    recommendations: list[CurriculumRecommendation]


# ─── 端点 ──────────────────────────────────────────────────────


@router.get(
    "/curriculum/next",
    response_model=CurriculumNextResponse,
)
async def get_next_curriculum(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取下一步推荐练习场景。

    逻辑:
    1. 读取当前用户的 knowledge_states，找到 p_mastery < 0.95 的最弱技能
    2. 调用 RAG 服务，检索与弱技能相关的教学语料
    3. 为每条语料构建 system_prompt_template，返回推荐列表
    """
    user_id = uuid.UUID(current_user["id"])

    # ── 1. 查询用户知识状态 ──────────────────────────────────
    stmt = (
        select(KnowledgeState, Skill)
        .join(Skill, KnowledgeState.skill_id == Skill.id)
        .where(KnowledgeState.user_id == user_id)
        .order_by(KnowledgeState.p_mastery.asc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    # 收集未掌握的技能（p_mastery < threshold）
    weak_entries = [
        (state, skill) for state, skill in rows if state.p_mastery < MASTERY_THRESHOLD
    ]

    # 若无知识状态记录或全部已掌握，使用默认推荐
    if not weak_entries:
        weakest_skill_id = "verb_tense_past"
        weakest_mastery = 0.1
        weak_skill_ids = [weakest_skill_id]
    else:
        weakest_state, weakest_skill_obj = weak_entries[0]
        weakest_skill_id = weakest_state.skill_id
        weakest_mastery = weakest_state.p_mastery
        # 取最弱的 3 个技能作为检索 query
        weak_skill_ids = [s.skill_id for s, _ in weak_entries[:3]]

    # ── 2. 确定目标 CEFR 等级 ───────────────────────────────
    # 简化逻辑：根据最弱技能掌握度推断当前水平
    if weakest_mastery < 0.3:
        target_level = "A2"
    elif weakest_mastery < 0.6:
        target_level = "B1"
    else:
        target_level = "B2"

    # ── 3. RAG 检索 ──────────────────────────────────────────
    materials = retrieve_materials(
        weak_skills=weak_skill_ids,
        target_level=target_level,
        top_k=3,
    )

    # ── 4. 构建推荐列表 ─────────────────────────────────────
    recommendations = []
    for mat in materials:
        prompt_template = _build_system_prompt_template(
            scenario_name=mat.scenario_name,
            focus_skills=mat.skill_tags,
            difficulty=mat.difficulty_cefr,
            material_description=mat.document,
        )
        recommendations.append(
            CurriculumRecommendation(
                scenario_name=mat.scenario_name,
                difficulty_cefr=mat.difficulty_cefr,
                category=mat.category,
                focus_skills=mat.skill_tags,
                system_prompt_template=prompt_template,
            )
        )

    return CurriculumNextResponse(
        weakest_skill=weakest_skill_id,
        weakest_skill_mastery=round(weakest_mastery, 4),
        target_level=target_level,
        recommendations=recommendations,
    )


# ─── 工具函数 ──────────────────────────────────────────────────


def _build_system_prompt_template(
    scenario_name: str,
    focus_skills: list[str],
    difficulty: str,
    material_description: str,
) -> str:
    """为推荐场景构建 LLM System Prompt 模板。"""
    skills_str = ", ".join(focus_skills)
    return (
        f"You are a friendly AI English coach running a "
        f"'{scenario_name}' practice scenario.\n\n"
        f"[Scenario] {material_description}\n\n"
        f"[Target Level] CEFR {difficulty}\n"
        f"[Focus Skills] {skills_str}\n\n"
        f"[Instructions]\n"
        f"- Guide the conversation around the scenario topic\n"
        f"- Naturally create opportunities for the student to practice "
        f"the focus skills\n"
        f"- Use implicit recasting for error correction\n"
        f"- Keep responses concise (2-4 sentences)\n"
        f"- Adjust complexity to {difficulty} level"
    )
