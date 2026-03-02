# Phase 3 后端技术栈说明 — 情绪感知（本地轻量化方案）

## 概述

Phase 3 在 LiveKit Agent 中实现了基于 STT 文本的实时情绪感知，能够检测用户的犹豫词频率和语速，计算焦虑指数，并动态调整 LLM 的教学风格（正常模式 / 鼓励模式）。

---

## 核心模块

### 1. 情绪分析器 (`backend/services/emotion_analyzer.py`)

**新建文件**，包含两个核心类：

#### EmotionState（数据结构）

```python
@dataclass
class EmotionState:
    anxiety_level: float   # 0.0~1.0 焦虑指数
    cognitive_load: str     # "normal" | "high" 认知负荷
    hesitation_rate: float  # 犹豫词频率（次/分钟）
    wpm: float             # 语速（词/分钟）
```

#### EmotionAnalyzer（分析引擎）

- **犹豫词检测**：正则匹配 `uh|um|er|uhm|ah|hmm|erm|eh|huh`（Deepgram 会将犹豫声转录为这些 filler words）
- **滑动窗口**：2 分钟 `deque`，记录每条发言的 `(timestamp, word_count, hesitation_count)`
- **最少发言数**：需 ≥2 条发言才输出有意义的指标，否则返回保守默认值

**规则引擎**：

| 条件                      | 结果                      |
| ------------------------- | ------------------------- |
| `hesitation_rate > 3/min` | `cognitive_load = "high"` |
| `wpm < 80`                | 焦虑因子最大（+0.3）      |
| `wpm 80~100`              | 焦虑因子线性递减          |
| `wpm >= 100`              | 无额外焦虑                |

焦虑指数公式：`anxiety = 0.3（基础值）+ 犹豫词因子（0~0.4）+ 语速因子（0~0.3）`，clamp 到 [0, 1]。

**性能**：单次调用 <0.1ms（纯正则 + 数学运算），绝不阻塞 WebRTC 事件循环。

---

### 2. 动态 Prompt 构建 (`backend/services/llm_service.py`)

**修改文件**，新增 `build_dynamic_prompt()` 函数。

按 `anxiety_level` 阈值生成两种 System Prompt：

- **正常模式**（anxiety ≤ 0.6）：可适度挑战，自然重述
- **鼓励模式**（anxiety > 0.6）：简化词汇、缩短句子、增加正向反馈、温和重述、放慢节奏

预留 `weak_skills` 参数，Phase 4 RAG 可接入 BKT 薄弱技能列表。

---

### 3. 情绪感知 Agent (`backend/livekit_agent/agent.py`)

**修改文件**，新增 `EchoTalkAgent` 子类。

关键设计：

```
用户说话 → Deepgram STT → 文本 → on_user_turn_completed 钩子
                                     ├── EmotionAnalyzer.record_utterance()  [<0.1ms]
                                     ├── 模式切换? → update_instructions()   [仅切换时]
                                     └── asyncio.ensure_future(save_transcript + emotion_state)
                                 → LLM 推理（使用更新后的 instructions）
                                 → TTS → 音频回传
```

**防上下文膨胀**：仅在焦虑模式发生切换（normal ↔ encouragement）时调用 `update_instructions()`，避免每轮都注入新的 system message。

**转录分流**：

- 用户消息：在 `on_user_turn_completed` 中保存（附带 `emotion_state`）
- AI 回复：在 `conversation_item_added` 事件中保存（无 emotion_state）

---

### 4. 数据持久化

**修改文件**：

- `backend/models/session.py` — Transcript 模型增加 `emotion_state: JSON` 列
- `backend/services/transcript_service.py` — `save_transcript()` 新增 `emotion_state` 参数
- `backend/schemas/session.py` — `TranscriptResponse` 新增 `emotion_state` 字段

**Alembic 迁移**：`alembic/versions/8360f4e545f8_phase3_add_emotion_state_to_transcripts.py`

emotion_state JSON 结构示例：

```json
{
  "anxiety_level": 0.72,
  "cognitive_load": "high",
  "hesitation_rate": 4.5,
  "wpm": 75.3
}
```

---

## 新增依赖

| 包             | 用途                     | 本阶段是否使用     |
| -------------- | ------------------------ | ------------------ |
| `librosa`      | 音频特征提取（F0, 能量） | 预留，本阶段未使用 |
| `soundfile`    | 音频读写                 | 预留，本阶段未使用 |
| `scikit-learn` | 分类器 / 聚类            | 预留，本阶段未使用 |

本阶段情绪分析完全基于文本规则引擎，上述依赖为 Pro/Premium 音频特征分析预留。

---

## 设计决策

### 为什么用文本分析而非音频分析？

在 LiveKit Agents 1.4.3 框架中，`on_user_turn_completed` 钩子仅提供 STT 转录后的文本（`ChatMessage.text_content`），不暴露原始音频帧。因此实时分析必须基于文本。

优势：

- 零依赖（仅标准库 `re` + `collections.deque`）
- 零延迟（<0.1ms 纯 CPU 计算）
- Deepgram 已将犹豫声忠实转录为 filler words

### 为什么仅在模式切换时更新 Prompt？

每次 `update_instructions()` 会向 LLM 上下文注入一条新的 system-level 消息。如果每轮都更新，长对话会导致上下文膨胀。仅在 anxiety_level 跨越 0.6 阈值时更新，既保证响应及时，又控制上下文开销。

---

## 文件变更清单

| 文件                                         | 操作                                         |
| -------------------------------------------- | -------------------------------------------- |
| `backend/requirements.txt`                   | 修改 — 添加 librosa, soundfile, scikit-learn |
| `backend/services/emotion_analyzer.py`       | 新建 — 情绪分析器                            |
| `backend/services/llm_service.py`            | 修改 — 新增 build_dynamic_prompt()           |
| `backend/models/session.py`                  | 修改 — Transcript 增加 emotion_state 列      |
| `backend/alembic/versions/8360f4e545f8_*.py` | 新建 — Alembic 迁移                          |
| `backend/services/transcript_service.py`     | 修改 — save_transcript() 支持 emotion_state  |
| `backend/schemas/session.py`                 | 修改 — TranscriptResponse 增加 emotion_state |
| `backend/livekit_agent/agent.py`             | 修改 — EchoTalkAgent 子类 + 情绪集成         |
| `README.md`                                  | 修改 — 更新状态与功能                        |

---

_文档版本：Phase 3 后端完成（2026-03-02）_
