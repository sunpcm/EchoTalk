# Phase 4 后端技术栈说明 — 自适应 RAG + 学习报告

## 概述

Phase 4 实现了基于 ChromaDB 向量检索的 RAG（Retrieval-Augmented Generation）系统，结合 BKT 知识追踪输出的薄弱技能，按 Krashen i+1 理论过滤合适难度的教学语料，为每个学生生成定制化的练习场景推荐。

---

## 核心模块

### 1. RAG 服务 (`backend/services/rag_service.py`)

**新建文件**，封装 ChromaDB 向量检索 + Krashen i+1 难度过滤。

#### 检索策略（两阶段）

```
弱技能列表（BKT 输出）
    ↓
构建语义 query: "Practice and improve: th_sounds, verb_tense_past"
    ↓
ChromaDB metadata 硬过滤: cefr_numeric >= target AND cefr_numeric <= target+1
    ↓
向量相似度软排序: embedding 余弦距离
    ↓
Top-K 候选教学语料
```

#### CEFR 数值化映射

| CEFR | 数值 |
| ---- | ---- |
| A1   | 1    |
| A2   | 2    |
| B1   | 3    |
| B2   | 4    |
| C1   | 5    |
| C2   | 6    |

Krashen i+1 示例：用户在 B1 → 过滤 `cefr_numeric` 3~4（B1 和 B2 材料）。

#### ChromaDB Collection Metadata Schema

```python
metadata = {
    "scenario_name": str,      # 场景名（如 "business_meeting_greetings"）
    "difficulty_cefr": str,    # 人类可读 CEFR（"B1"）
    "cefr_numeric": int,       # 数值化 CEFR（3）→ 用于 $gte/$lte 范围查询
    "category": str,           # "pronunciation" | "grammar" | "conversation"
    "primary_skill": str,      # 主要技能标签
    "skill_tags": str,         # 逗号分隔的全部关联技能
}
```

**为什么用 `cefr_numeric`？** ChromaDB 的 `where` 过滤器支持 `$gte`/`$lte` 数值比较，但不支持字符串大小比较。数值化使得范围查询变成简单的整数比较。

#### 核心函数

```python
def retrieve_materials(
    weak_skills: list[str],
    target_level: str = "B1",
    top_k: int = 3,
) -> list[RetrievedMaterial]:
```

**向量模型**：ChromaDB 默认使用 `all-MiniLM-L6-v2`（ONNX runtime，轻量本地 embedding）。

---

### 2. 自适应课程路由 (`backend/routers/curriculum.py`)

**新建文件**，实现 `GET /api/curriculum/next` 端点。

#### 推荐流程

```
1. 查询 knowledge_states → 按 p_mastery ASC 排序
2. 收集 p_mastery < 0.95 的技能
3. 根据最弱技能掌握度推断目标 CEFR:
   - p_mastery < 0.3 → target = "A2"
   - p_mastery < 0.6 → target = "B1"
   - else → target = "B2"
4. 取最弱 3 个技能作为 RAG query
5. 调用 rag_service.retrieve_materials() 检索
6. 为每条语料生成 system_prompt_template
7. 返回推荐列表
```

#### 响应体结构

```json
{
  "weakest_skill": "verb_tense_past",
  "weakest_skill_mastery": 0.1,
  "target_level": "A2",
  "recommendations": [
    {
      "scenario_name": "subject_verb_agreement_drill",
      "difficulty_cefr": "A2",
      "category": "grammar",
      "focus_skills": ["subject_verb_agreement", "verb_tense_present"],
      "system_prompt_template": "You are a friendly AI English coach..."
    }
  ]
}
```

#### System Prompt 模板

每条推荐包含一个预构建的 LLM System Prompt，包含：

- 场景描述（来自 RAG 检索的 document）
- 目标 CEFR 等级
- 重点练习技能列表
- 教学指令（Recast 纠错策略、句长控制、难度适配）

前端可直接将此 prompt 传入下次会话的 LLM 调用，实现无缝的自适应教学。

---

### 3. 语料种子脚本 (`backend/scripts/seed_corpus.py`)

**新建文件**，将 10 条教学语料种子写入 ChromaDB。

| 场景                         | CEFR | 类别          | 主技能                 |
| ---------------------------- | ---- | ------------- | ---------------------- |
| business_meeting_greetings   | B1   | conversation  | word_stress            |
| past_perfect_explanation     | B2   | grammar       | verb_tense_past        |
| th_minimal_pairs             | A2   | pronunciation | th_sounds              |
| hotel_checkin_roleplay       | B1   | conversation  | preposition            |
| subject_verb_agreement_drill | A2   | grammar       | subject_verb_agreement |
| restaurant_ordering          | B1   | conversation  | vowel_sounds           |
| advanced_articles            | B2   | grammar       | article_usage          |
| business_presentation        | B2   | conversation  | word_stress            |
| vowel_contrast_drill         | A2   | pronunciation | vowel_sounds           |
| job_interview_simulation     | C1   | conversation  | verb_tense_past        |

使用 `collection.upsert()` 保证幂等性（可重复运行）。

运行方式：

```bash
cd backend
python scripts/seed_corpus.py
```

---

### 4. 周报任务骨架 (`backend/workers/report_tasks.py`)

**新建文件**，Celery 异步任务骨架。

```python
def generate_weekly_report(user_id: str) -> dict:
    # TODO: 本周练习时长 & 会话次数统计
    # TODO: 各技能 p_mastery 趋势（环比上周变化）
    # TODO: 发音准确率趋势（按 session 聚合）
    # TODO: 语法错误频次 Top-3 及改善建议
    # TODO: Krashen i+1 推荐下周学习重点
    # TODO: 情绪分析摘要（平均焦虑指数、语速趋势）
```

待后续接入 Celery + Redis 后启用定时调度。

---

## 新增依赖

| 包                      | 用途                         | 版本要求 |
| ----------------------- | ---------------------------- | -------- |
| `chromadb`              | 本地向量数据库（持久化模式） | >=1.0.0  |
| `sentence-transformers` | 本地 embedding 模型加载      | >=5.0.0  |

ChromaDB 内置 `all-MiniLM-L6-v2` ONNX 模型（~80MB，首次运行自动下载），无需 GPU。

---

## 设计决策

### 为什么用 ChromaDB 而非 Pinecone/Weaviate？

- 本地持久化，零网络延迟，零 API 费用
- 内置 ONNX embedding（无需配置外部 embedding 服务）
- 文件系统存储（`.chromadb/` 目录），部署简单
- 10~1000 条语料规模下性能完全足够

### 为什么把 CEFR 做成数值字段？

ChromaDB 的 `where` 过滤仅支持数值比较（`$gte`/`$lte`），不支持字符串排序。将 A1~C2 映射为 1~6 后，Krashen i+1 范围查询变成 `cefr_numeric >= N AND cefr_numeric <= N+1`，简洁且高效。

### 为什么目标等级根据 mastery 推断而非用户 profile？

当前 Mock 模式下 user_profiles 的 target_level 未必已设置。使用最弱技能的 p_mastery 动态推断，在「冷启动」场景下也能给出合理推荐。后续可切换为读取 user_profiles.target_level。

---

## 文件变更清单

| 文件                              | 操作                                        |
| --------------------------------- | ------------------------------------------- |
| `backend/requirements.txt`        | 修改 — 添加 chromadb, sentence-transformers |
| `backend/services/rag_service.py` | 新建 — RAG 向量检索 + Krashen i+1 过滤      |
| `backend/routers/curriculum.py`   | 新建 — 自适应课程推荐端点                   |
| `backend/scripts/seed_corpus.py`  | 新建 — 语料种子写入脚本                     |
| `backend/workers/__init__.py`     | 新建 — workers 包初始化                     |
| `backend/workers/report_tasks.py` | 新建 — 周报生成任务骨架                     |
| `backend/main.py`                 | 修改 — 注册 curriculum 路由                 |
| `README.md`                       | 修改 — 更新状态、架构图、功能说明、API 表   |

---

_文档版本：Phase 4 后端完成（2026-03-02）_
