"""
RAG 服务层：基于 ChromaDB 向量检索 + Krashen i+1 难度过滤。
为自适应课程推荐提供教学语料检索能力。
"""

import logging
import os
from dataclasses import dataclass
from pathlib import Path

import chromadb
from chromadb.config import Settings as ChromaSettings

logger = logging.getLogger(__name__)

# CEFR 等级 ↔ 数值双向映射
CEFR_TO_NUM = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
NUM_TO_CEFR = {v: k for k, v in CEFR_TO_NUM.items()}

# ChromaDB 配置
CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8000"))
CHROMA_PATH = str(Path(__file__).resolve().parent.parent / ".chromadb")
COLLECTION_NAME = "teaching_materials"


@dataclass
class RetrievedMaterial:
    """从 ChromaDB 检索到的单条教学语料。"""

    id: str
    document: str
    scenario_name: str
    difficulty_cefr: str
    category: str
    primary_skill: str
    skill_tags: list[str]
    distance: float


def _get_client() -> chromadb.ClientAPI:
    """根据环境变量选择 ChromaDB 连接模式。"""
    if CHROMA_HOST != "localhost":
        logger.info("Using ChromaDB HttpClient → %s:%s", CHROMA_HOST, CHROMA_PORT)
        return chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    logger.info("Using ChromaDB PersistentClient → %s", CHROMA_PATH)
    return chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=ChromaSettings(anonymized_telemetry=False),
    )


def _get_collection() -> chromadb.Collection:
    """获取 ChromaDB collection（懒加载，进程内复用）。"""
    client = _get_client()
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"description": "EchoTalk teaching materials for RAG"},
    )


def retrieve_materials(
    weak_skills: list[str],
    target_level: str = "B1",
    top_k: int = 3,
) -> list[RetrievedMaterial]:
    """
    基于薄弱技能和目标 CEFR 等级，检索推荐教学语料。

    检索策略：
    1. Krashen i+1 硬过滤：target_level ~ target_level+1 的 CEFR 范围
       （例如 target=B1 → 过滤 cefr_numeric 3~4，即 B1 和 B2）
    2. 向量相似度软排序：将弱技能拼成自然语言 query，
       利用 embedding 相似度在候选集中排序

    参数:
        weak_skills: BKT 识别的薄弱技能 ID 列表
        target_level: 用户当前 CEFR 目标等级
        top_k: 返回 Top-K 条语料

    返回:
        按相关性排序的 RetrievedMaterial 列表
    """
    collection = _get_collection()

    if collection.count() == 0:
        logger.warning("ChromaDB collection is empty, no materials to retrieve")
        return []

    # ── 1. 构建 Krashen i+1 过滤条件 ────────────────────────────
    current_num = CEFR_TO_NUM.get(target_level.upper(), 3)
    upper_num = min(current_num + 1, 6)  # 不超过 C2

    where_filter = {
        "$and": [
            {"cefr_numeric": {"$gte": current_num}},
            {"cefr_numeric": {"$lte": upper_num}},
        ]
    }

    # ── 2. 构建语义检索 query ──────────────────────────────────
    skills_text = ", ".join(weak_skills) if weak_skills else "general practice"
    query_text = f"Practice and improve: {skills_text}"

    logger.info(
        "RAG retrieve: query=%r, cefr_range=[%s~%s], top_k=%d",
        query_text,
        NUM_TO_CEFR.get(current_num, "?"),
        NUM_TO_CEFR.get(upper_num, "?"),
        top_k,
    )

    # ── 3. ChromaDB 查询（metadata 过滤 + 向量排序） ──────────
    results = collection.query(
        query_texts=[query_text],
        where=where_filter,
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
    )

    # ── 4. 解析结果 ──────────────────────────────────────────
    materials: list[RetrievedMaterial] = []

    if not results["ids"] or not results["ids"][0]:
        logger.info("RAG retrieve: no materials found in CEFR range")
        return materials

    for i, doc_id in enumerate(results["ids"][0]):
        meta = results["metadatas"][0][i]
        materials.append(
            RetrievedMaterial(
                id=doc_id,
                document=results["documents"][0][i],
                scenario_name=meta.get("scenario_name", ""),
                difficulty_cefr=meta.get("difficulty_cefr", ""),
                category=meta.get("category", ""),
                primary_skill=meta.get("primary_skill", ""),
                skill_tags=meta.get("skill_tags", "").split(","),
                distance=results["distances"][0][i],
            )
        )

    logger.info(
        "RAG retrieve: found %d materials: %s",
        len(materials),
        [m.scenario_name for m in materials],
    )
    return materials
