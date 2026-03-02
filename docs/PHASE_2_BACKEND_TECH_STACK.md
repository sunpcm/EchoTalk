# Phase 2 后端 — 技术栈说明（发音评估 + 知识追踪）

> Phase 2 后端完整内容：4 张新数据库表、Needleman-Wunsch 音素对齐算法、BKT 贝叶斯知识追踪模型、会话分析管线、4 个评估查询 API。

---

## 1. 新增目录结构

```
backend/
├── models/
│   ├── exercise.py            ← 新增：PronunciationAssessment + GrammarError 表
│   └── knowledge.py           ← 新增：Skill + KnowledgeState 表 + 种子数据
├── schemas/
│   └── assessment.py          ← 新增：评估相关 Pydantic 响应模型
├── routers/
│   └── assessment.py          ← 新增：4 个评估查询端点
├── services/
│   ├── analysis_service.py    ← 新增：会话分析管线编排
│   ├── pronunciation/
│   │   ├── __init__.py
│   │   └── phoneme_aligner.py ← 新增：NW 音素对齐算法
│   └── knowledge/
│       ├── __init__.py
│       ├── bkt_model.py       ← 新增：BKT 追踪模型
│       └── skill_updater.py   ← 新增：音素→技能映射
└── alembic/versions/
    └── c82f834e00e0_phase2_*.py ← 自动生成：迁移文件
```

---

## 2. 新增技术依赖

| 技术          | 用途                                                      |
| ------------- | --------------------------------------------------------- |
| `pronouncing` | CMU 发音词典查询（可选，未安装时回退为 letter-by-letter） |

> Phase 2 无新增 pip 依赖，所有算法为纯 Python 实现。`pronouncing` 为可选增强。

---

## 3. 新增数据库表

本阶段新增 4 张表：

| 表名                        | 主键类型   | 说明                                       |
| --------------------------- | ---------- | ------------------------------------------ |
| `skills`                    | String(50) | 技能定义（字符串 PK，如 `th_sounds`）      |
| `knowledge_states`          | UUID       | 用户技能掌握度（BKT 概率值），联合唯一约束 |
| `pronunciation_assessments` | UUID       | 发音评估结果（含 JSON 音素对齐数组）       |
| `grammar_errors`            | UUID       | 语法错误记录（skill_tag + 原文 + 纠正）    |

### 3.1 skills 表

```
id          VARCHAR(50)    PK   — "th_sounds", "verb_tense_past" 等
name        VARCHAR(100)        — "TH Sounds (θ / ð)"
category    VARCHAR(20)         — "grammar" | "pronunciation"
description TEXT           NULL — 中文描述
```

种子数据 10 个技能：

- grammar: article_usage, verb_tense_past, verb_tense_present, subject_verb_agreement, preposition
- pronunciation: vowel_sounds, consonant_clusters, word_stress, linking_sounds, th_sounds

### 3.2 knowledge_states 表

```
id          UUID       PK
user_id     UUID       FK→users.id
skill_id    VARCHAR    FK→skills.id
p_mastery   FLOAT      默认 0.1（BKT 初始掌握概率）
updated_at  TIMESTAMP  每次更新时写入
UNIQUE(user_id, skill_id)
```

### 3.3 pronunciation_assessments 表

```
id                UUID    PK
session_id        UUID    FK→sessions.id
overall_score     FLOAT   0.0 ~ 100.0
phoneme_alignment JSON    对齐结果数组
elsa_response     JSON    NULL（Phase 2 为 mock 模式）
created_at        TIMESTAMP
```

### 3.4 grammar_errors 表

```
id          UUID        PK
session_id  UUID        FK→sessions.id
skill_tag   VARCHAR(50) 对应 skills.id
original    TEXT        原始错误文本
corrected   TEXT        纠正后文本（mock 模式为空）
error_type  VARCHAR(50) 错误类型标签
created_at  TIMESTAMP
```

---

## 4. 新增 API 端点

| 方法 | 路径                                    | 说明              |
| ---- | --------------------------------------- | ----------------- |
| GET  | `/api/assessments/knowledge/states`     | 当前用户知识状态  |
| GET  | `/api/assessments/knowledge/skills`     | 技能列表（10 个） |
| GET  | `/api/assessments/{session_id}`         | 发音评估结果      |
| GET  | `/api/assessments/{session_id}/grammar` | 语法错误列表      |

> **路由顺序**：`/knowledge/states` 和 `/knowledge/skills` 必须定义在 `/{session_id}` 之前，避免 FastAPI 把 `"knowledge"` 当作 UUID 解析。

---

## 5. 核心算法

### 5.1 Needleman-Wunsch 音素对齐

**文件**：`services/pronunciation/phoneme_aligner.py`

全局序列对齐算法，用于比较用户实际发音（音素序列）与标准参考音素。

**打分参数**：

| 参数     | 值  | 说明          |
| -------- | --- | ------------- |
| match    | +2  | 音素匹配得分  |
| mismatch | -1  | 音素替换惩罚  |
| gap      | -1  | 缺失/多余惩罚 |

**DP 矩阵初始化**：

```
维度：(m+1) × (n+1)，m = len(ref), n = len(user)
dp[0][0] = 0
dp[i][0] = i × GAP_PENALTY    — ref 全缺失 = 全 deletion
dp[0][j] = j × GAP_PENALTY    — user 全多余 = 全 insertion
```

**填充规则**：取三方向最大值：

- 对角线：`dp[i-1][j-1] + (MATCH if ref[i]==user[j] else MISMATCH)`
- 上方：`dp[i-1][j] + GAP`（deletion）
- 左方：`dp[i][j-1] + GAP`（insertion）

**回溯**：从 `dp[m][n]` 到 `dp[0][0]`，优先对角线 > 上方 > 左方。

**输出格式**：

```python
[
  {"position": 0, "phoneme": "TH", "expected": "TH", "actual": "S",  "type": "substitution"},
  {"position": 1, "phoneme": "IH", "expected": "IH", "actual": "IH", "type": "correct"},
  {"position": 2, "phoneme": "N",  "expected": "N",  "actual": None, "type": "deletion"},
]
# type: "correct" | "substitution" | "deletion" | "insertion"
# phoneme 规则: expected if expected is not None else actual
```

**评分**：`score = correct_count / total_count × 100`，保留 1 位小数。

### 5.2 BKT 贝叶斯知识追踪

**文件**：`services/knowledge/bkt_model.py`

每个技能独立维护掌握概率 `p_mastery`，根据正确/错误观察实时贝叶斯更新。

**默认参数**：

| 参数      | 值   | 说明                     |
| --------- | ---- | ------------------------ |
| p_init    | 0.1  | 初始掌握概率（保守估计） |
| p_transit | 0.2  | 单次练习后新学会的概率   |
| p_slip    | 0.1  | 已掌握但答错（失误率）   |
| p_guess   | 0.2  | 未掌握但猜对             |
| threshold | 0.95 | 掌握判定阈值             |

**更新公式**：

```
答对时:
  P(correct) = (1 - p_slip) × p_mastery + p_guess × (1 - p_mastery)
  posterior  = (1 - p_slip) × p_mastery / P(correct)
  p_mastery  = posterior + (1 - posterior) × p_transit    ← 学习迁移

答错时:
  P(incorrect) = p_slip × p_mastery + (1 - p_guess) × (1 - p_mastery)
  posterior    = p_slip × p_mastery / P(incorrect)
  p_mastery    = posterior                                ← 不触发迁移
```

**关键设计决策**：答错时**不触发 transit**（学习迁移仅在正确响应时发生），确保：

- 连续 5 次答错 → p_mastery < 0.1（趋向 0）
- 连续 10 次答对 → p_mastery > 0.95（判定掌握）

### 5.3 音素→技能映射

**文件**：`services/knowledge/skill_updater.py`

将 ARPAbet 音素对齐结果映射到 skills 表中的技能 ID：

| 音素集合                      | 映射技能             |
| ----------------------------- | -------------------- |
| TH, DH                        | `th_sounds`          |
| AA, AE, AH, AO, AW, AY, EH... | `vowel_sounds`       |
| B, CH, D, F, G, HH, JH, K...  | `consonant_clusters` |
| insertion 类型（任意音素）    | `consonant_clusters` |

---

## 6. 会话分析管线

**文件**：`services/analysis_service.py`

会话结束时，由 `routers/sessions.py` 的 `end_session` 自动触发。

### 6.1 管线流程

```
end_session()
  → analyze_session(session_id, db)
      ├── 1. 查询用户转录记录（Transcript, role=user）
      ├── 2. 合并文本并拆词
      ├── 3. 逐词做 NW 音素对齐
      │   ├── _get_ref_phonemes(word)    — CMU 词典 / letter-by-letter 回退
      │   └── _get_mock_user_phonemes()  — TH→S 替换注入
      ├── 4. 计算得分 → 写入 pronunciation_assessments
      └── 5. _detect_grammar_errors()   → 写入 grammar_errors
  → update_knowledge(session_id, user_id, db)
      ├── 1. 读取 PronunciationAssessment + GrammarError
      ├── 2. phoneme_error_to_skill() 映射到 skill_id
      ├── 3. BKT update_mastery() 逐条更新
      └── 4. 写入/更新 knowledge_states
```

### 6.2 Mock 模式行为

| 组件         | Mock 行为                                           |
| ------------ | --------------------------------------------------- |
| 音素参考     | 优先 CMU 词典，未安装时每个字母作为一个"音素"       |
| 用户音素     | 对 `th` 开头单词注入 TH→S 替换错误                  |
| 语法检测     | 正则规则匹配（`I go to ... yesterday`、`he go` 等） |
| 分析触发方式 | 同步执行（生产环境将切换为 Celery 异步任务）        |

### 6.3 语法规则

| 模式                         | skill_tag              | error_type    |
| ---------------------------- | ---------------------- | ------------- |
| `yesterday/last/ago... I go` | verb_tense_past        | wrong_tense   |
| `I go ... yesterday`         | verb_tense_past        | wrong_tense   |
| `he/she/it go/have/do`       | subject_verb_agreement | wrong_3p_verb |
| `I goes`                     | subject_verb_agreement | wrong_3p_verb |

---

## 7. Pydantic 响应模型

**文件**：`schemas/assessment.py`

| 模型                   | 用途                                 |
| ---------------------- | ------------------------------------ |
| PhonemeAlignmentItem   | 音素对齐条目（嵌套在 Assessment 中） |
| AssessmentResponse     | 发音评估完整响应                     |
| GrammarErrorResponse   | 单条语法错误                         |
| KnowledgeStateResponse | 知识状态（含技能名称和类别）         |
| SkillResponse          | 技能定义                             |

---

## 8. 关键设计决策

1. **skills 表使用字符串主键**：验收测试期望 `skill_id="th_sounds"` 等可读字符串，而非自增整数。
2. **BKT transit 仅在答对时触发**：确保答错序列使 p_mastery 收敛到 0，答对序列收敛到 1。
3. **路由定义顺序**：`/knowledge/*` 端点必须在 `/{session_id}` 之前注册，防止 FastAPI 将 `"knowledge"` 解析为 UUID。
4. **分析管线 try/except 包裹**：分析失败不阻塞会话结束，仅记录 warning 日志。
5. **种子数据 lifespan 注入**：应用启动时自动检查并插入 10 个技能定义，使用 `merge` 语义避免重复。
6. **JSON 列存储音素对齐**：`phoneme_alignment` 使用 PostgreSQL JSON 类型，方便前端直接消费整个数组。

---

## 9. 验证方式

### NW 音素对齐单元测试

```bash
cd backend && .venv/bin/python3 - <<'EOF'
from services.pronunciation.phoneme_aligner import align_phonemes, compute_pronunciation_score

alignment = align_phonemes(["AH", "N", "D"], ["AH", "N", "D"])
assert all(a["type"] == "correct" for a in alignment)
assert compute_pronunciation_score(alignment) == 100.0
print("Perfect match: OK")

alignment = align_phonemes(["TH", "IH", "N"], ["S", "IH", "N"])
subs = [a for a in alignment if a["type"] == "substitution"]
assert len(subs) == 1
print("Substitution detection: OK")

alignment = align_phonemes(["AH", "N", "D"], ["AH", "D"])
assert any(a["type"] == "deletion" for a in alignment)
print("Deletion detection: OK")

alignment = align_phonemes(["AH", "N"], ["AH", "HH", "N"])
assert any(a["type"] == "insertion" for a in alignment)
print("Insertion detection: OK")
print("All NW alignment tests passed.")
EOF
```

### BKT 收敛验证

```bash
cd backend && .venv/bin/python3 - <<'EOF'
from services.knowledge.bkt_model import BKTParams, update_mastery, is_mastered

p = BKTParams()
pm = p.p_init
for _ in range(5):
    pm = update_mastery(pm, correct=False, params=p)
print(f"5 wrong answers: p_mastery={pm:.4f}")  # < 0.1

pm = p.p_init
for _ in range(10):
    pm = update_mastery(pm, correct=True, params=p)
print(f"10 correct answers: p_mastery={pm:.4f}")  # > 0.9
print(f"mastered: {is_mastered(pm)}")              # True
EOF
```
