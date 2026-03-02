"""
Phase 4 语料种子脚本。
将教学语料写入 ChromaDB，供 RAG 服务检索。
"""

import sys
from pathlib import Path

# 让脚本可以直接 `python backend/scripts/seed_corpus.py` 运行
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chromadb  # noqa: E402
from chromadb.config import Settings as ChromaSettings  # noqa: E402

# CEFR 等级 → 数值映射
CEFR_MAP = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}

# ChromaDB 持久化路径（项目根目录下 .chromadb/）
CHROMA_PATH = str(Path(__file__).resolve().parent.parent / ".chromadb")
COLLECTION_NAME = "teaching_materials"

# ── 教学语料种子数据 ──────────────────────────────────────────────

SEED_MATERIALS = [
    {
        "id": "mat_biz_greet_b1",
        "document": (
            "Business meeting greetings: Practice introducing yourself and "
            "making small talk in a professional setting. "
            "Focus skills: word_stress, linking_sounds. Level: B1."
        ),
        "metadata": {
            "scenario_name": "business_meeting_greetings",
            "difficulty_cefr": "B1",
            "cefr_numeric": CEFR_MAP["B1"],
            "category": "conversation",
            "primary_skill": "word_stress",
            "skill_tags": "word_stress,linking_sounds",
        },
    },
    {
        "id": "mat_past_perfect_b2",
        "document": (
            "Past perfect tense lecture: Understand and practice "
            "'had + past participle' in storytelling contexts. "
            "Focus skills: verb_tense_past. Level: B2."
        ),
        "metadata": {
            "scenario_name": "past_perfect_explanation",
            "difficulty_cefr": "B2",
            "cefr_numeric": CEFR_MAP["B2"],
            "category": "grammar",
            "primary_skill": "verb_tense_past",
            "skill_tags": "verb_tense_past",
        },
    },
    {
        "id": "mat_th_minimal_a2",
        "document": (
            "TH minimal pairs drill: Practice distinguishing and producing "
            "think vs sink, three vs free, bath vs bass. "
            "Focus skills: th_sounds. Level: A2."
        ),
        "metadata": {
            "scenario_name": "th_minimal_pairs",
            "difficulty_cefr": "A2",
            "cefr_numeric": CEFR_MAP["A2"],
            "category": "pronunciation",
            "primary_skill": "th_sounds",
            "skill_tags": "th_sounds,consonant_clusters",
        },
    },
    {
        "id": "mat_hotel_checkin_b1",
        "document": (
            "Hotel check-in role play: Practice asking about room "
            "availability, making requests, and using polite expressions. "
            "Focus skills: preposition, linking_sounds. Level: B1."
        ),
        "metadata": {
            "scenario_name": "hotel_checkin_roleplay",
            "difficulty_cefr": "B1",
            "cefr_numeric": CEFR_MAP["B1"],
            "category": "conversation",
            "primary_skill": "preposition",
            "skill_tags": "preposition,linking_sounds",
        },
    },
    {
        "id": "mat_svagree_a2",
        "document": (
            "Subject-verb agreement practice: Drill 'he goes' vs 'they go', "
            "'she has' vs 'we have' with picture descriptions. "
            "Focus skills: subject_verb_agreement. Level: A2."
        ),
        "metadata": {
            "scenario_name": "subject_verb_agreement_drill",
            "difficulty_cefr": "A2",
            "cefr_numeric": CEFR_MAP["A2"],
            "category": "grammar",
            "primary_skill": "subject_verb_agreement",
            "skill_tags": "subject_verb_agreement,verb_tense_present",
        },
    },
    {
        "id": "mat_restaurant_b1",
        "document": (
            "Restaurant ordering: Practice ordering food, asking about menu "
            "items, and handling dietary restrictions in a restaurant. "
            "Focus skills: vowel_sounds, article_usage. Level: B1."
        ),
        "metadata": {
            "scenario_name": "restaurant_ordering",
            "difficulty_cefr": "B1",
            "cefr_numeric": CEFR_MAP["B1"],
            "category": "conversation",
            "primary_skill": "vowel_sounds",
            "skill_tags": "vowel_sounds,article_usage",
        },
    },
    {
        "id": "mat_articles_b2",
        "document": (
            "Advanced articles usage: Master 'the' with geographical names, "
            "'a/an' with abstract nouns, and zero article in generalizations. "
            "Focus skills: article_usage. Level: B2."
        ),
        "metadata": {
            "scenario_name": "advanced_articles",
            "difficulty_cefr": "B2",
            "cefr_numeric": CEFR_MAP["B2"],
            "category": "grammar",
            "primary_skill": "article_usage",
            "skill_tags": "article_usage",
        },
    },
    {
        "id": "mat_presentation_b2",
        "document": (
            "Giving a presentation: Practice opening remarks, transitions, "
            "and concluding a short business presentation. "
            "Focus skills: word_stress, consonant_clusters. Level: B2."
        ),
        "metadata": {
            "scenario_name": "business_presentation",
            "difficulty_cefr": "B2",
            "cefr_numeric": CEFR_MAP["B2"],
            "category": "conversation",
            "primary_skill": "word_stress",
            "skill_tags": "word_stress,consonant_clusters",
        },
    },
    {
        "id": "mat_vowel_contrast_a2",
        "document": (
            "Vowel contrast drill: Practice distinguishing ship vs sheep, "
            "bit vs beat, full vs fool with listen-and-repeat exercises. "
            "Focus skills: vowel_sounds. Level: A2."
        ),
        "metadata": {
            "scenario_name": "vowel_contrast_drill",
            "difficulty_cefr": "A2",
            "cefr_numeric": CEFR_MAP["A2"],
            "category": "pronunciation",
            "primary_skill": "vowel_sounds",
            "skill_tags": "vowel_sounds",
        },
    },
    {
        "id": "mat_job_interview_c1",
        "document": (
            "Job interview simulation: Practice answering behavioral "
            "questions using STAR method, negotiating salary, and "
            "discussing career goals with advanced vocabulary. "
            "Focus skills: verb_tense_past, word_stress. Level: C1."
        ),
        "metadata": {
            "scenario_name": "job_interview_simulation",
            "difficulty_cefr": "C1",
            "cefr_numeric": CEFR_MAP["C1"],
            "category": "conversation",
            "primary_skill": "verb_tense_past",
            "skill_tags": "verb_tense_past,word_stress",
        },
    },
]


def seed():
    """将种子语料写入 ChromaDB collection。"""
    client = chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=ChromaSettings(anonymized_telemetry=False),
    )

    # 获取或创建 collection（使用默认 embedding function）
    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"description": "EchoTalk teaching materials for RAG"},
    )

    ids = [m["id"] for m in SEED_MATERIALS]
    documents = [m["document"] for m in SEED_MATERIALS]
    metadatas = [m["metadata"] for m in SEED_MATERIALS]

    # upsert 幂等写入
    collection.upsert(ids=ids, documents=documents, metadatas=metadatas)

    print(f"[seed_corpus] ChromaDB path: {CHROMA_PATH}")
    print(f"[seed_corpus] Collection: {COLLECTION_NAME}")
    print(f"[seed_corpus] Upserted {len(ids)} materials.")

    # 验证
    count = collection.count()
    print(f"[seed_corpus] Total documents in collection: {count}")

    # 打印全部语料摘要
    for m in SEED_MATERIALS:
        meta = m["metadata"]
        print(
            f"  - {meta['scenario_name']:40s} "
            f"CEFR={meta['difficulty_cefr']} "
            f"skill={meta['primary_skill']}"
        )


if __name__ == "__main__":
    seed()
