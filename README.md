# EchoTalk — AI 英语口语练习平台

基于 LiveKit WebRTC 的实时语音对话系统，集成发音评估、语法检测与 BKT 知识追踪。

---

## 项目当前状态与进度

| Phase | 内容                          | 状态      |
| ----- | ----------------------------- | --------- |
| 1     | 后端基础对话管线              | ✅ 已完成 |
| 1     | 前端 Vite 语音 UI             | ✅ 已完成 |
| 2     | 发音评估 + 知识追踪（后端）   | ✅ 已完成 |
| 2     | 发音高亮 + 技能树（前端）     | ✅ 已完成 |
| 3     | 情绪感知（后端）              | ✅ 已完成 |
| 3     | 数字人（前端）                | 🔲 待开发 |
| 4     | 自适应 RAG + 学习报告（后端） | ✅ 已完成 |
| 4     | 课程推荐 Dashboard（前端）    | ✅ 已完成 |

---

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│ 前端 (Vite + React 19 + TypeScript)                 │
│  ├── Dashboard: 推荐场景卡片 + 每日进度 + 技能树     │
│  ├── LiveKit WebRTC 语音交互                         │
│  ├── zustand 状态管理（视图流转 + 连接 + 评估）      │
│  └── Tailwind CSS v4 样式                            │
├─────────────────────────────────────────────────────┤
│ 后端 (FastAPI + SQLAlchemy 2.0 async)               │
│  ├── 对话管线: STT → LLM → TTS                      │
│  ├── 情绪感知: 文本犹豫词 + 语速规则引擎            │
│  ├── 发音评估: Needleman-Wunsch 音素对齐             │
│  ├── 知识追踪: BKT 贝叶斯模型                       │
│  ├── 语法检测: 正则规则引擎                          │
│  └── 自适应 RAG: ChromaDB 向量检索 + Krashen i+1    │
├─────────────────────────────────────────────────────┤
│ 数据层 (PostgreSQL + asyncpg + ChromaDB)             │
│  └── 8 张表: users, user_profiles, sessions,        │
│      transcripts, skills, knowledge_states,         │
│      pronunciation_assessments, grammar_errors      │
└─────────────────────────────────────────────────────┘
```

---

## 如何启动当前项目

### 前置条件

- Python 3.12+
- Node.js 20+ / pnpm
- PostgreSQL 15+

### 后端启动

```bash
# 1. 进入后端目录
cd backend

# 2. 创建虚拟环境并安装依赖
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. 配置环境变量
#    复制 .env.example 为 .env 并填写:
#    - DATABASE_URL=postgresql://user:pass@localhost:5432/echotalk
#    - SILICONFLOW_API_KEY 或 OPENROUTER_API_KEY
#    - JWT_SECRET_KEY（任意字符串）

# 4. 数据库迁移
alembic upgrade head

# 5. 启动服务（种子数据自动注入）
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：

```bash
curl http://localhost:8000/api/health
# {"status":"ok","service":"echo-talk"}
```

### 前端启动

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发服务器（HTTPS + /api 代理至 localhost:8000 + LiveKit WS 代理）
pnpm --filter vite-app dev

# 3. 访问 https://localhost:5173（本机）或 https://<Ubuntu IP>:5173（局域网）
#    首次访问需接受自签名证书安全警告
#    注意：必须使用 HTTPS，否则浏览器拒绝麦克风权限（getUserMedia 安全上下文要求）
```

---

## 当前已支持的功能特性

### Phase 1 — 基础对话管线

- **用户认证**：Mock 鉴权（固定测试用户），预留 JWT 接入
- **会话管理**：创建、列表、详情、结束会话
- **AI 对话**：多轮上下文对话，LLM 生成回复（支持 SiliconFlow / OpenRouter）
- **语音交互**：LiveKit WebRTC 实时语音（前端 SDK 集成完成）
- **转录持久化**：所有对话记录存入 transcripts 表

### Phase 2 — 发音评估与知识追踪

- **发音评估**：Needleman-Wunsch 全局音素对齐，逐词分析替换/缺失/多余错误
- **评分系统**：正确音素占比 × 100 的发音得分（0-100）
- **语法检测**：正则规则匹配过去时态错误、主谓一致错误
- **BKT 知识追踪**：10 个技能（5 语法 + 5 发音）独立追踪掌握概率
- **自动分析管线**：会话结束时自动触发发音评估 + 语法检测 + BKT 更新
- **评估查询 API**：发音结果、语法错误、知识状态、技能列表 4 个端点

### Phase 2 — 前端评估可视化

- **发音反馈组件**：对话结束后自动展示发音评分（0-100），颜色编码（绿/黄/红）
- **音素可视化**：逐音素彩色色块渲染（绿=正确、红=替换/缺失、琥珀=多余），Hover 显示错误详情
- **语法提示**：检测到的语法错误以列表形式展示，含 skill_tag 标签和原文标注
- **技能掌握度**：BKT 知识状态按发音/语法分组，进度条 + 百分比展示，≥95% 标记「已掌握」
- **轮询机制**：指数退避轮询兼容未来 Celery 异步分析，404 时自动重试
- **评估状态管理**：独立 zustand store，管理 idle/polling/loaded/error 四状态生命周期

### Phase 2 — LiveKit 连接优化

- **开发环境 HTTPS**：`@vitejs/plugin-basic-ssl` 自签名证书，满足 `getUserMedia` 安全上下文要求
- **LiveKit WebSocket 代理**：Vite dev server 代理 `/livekit-ws` 路径到 LiveKit Cloud，绕过 SDK region routing
- **延迟 Agent 调度**：前端先连入房间，再通过 `/dispatch` 端点触发 Agent 加入，避免空房间踢出

### Phase 3 — 情绪感知（后端）

- **犹豫词检测**：正则匹配 STT 文本中的 filler words（uh/um/er/ah/hmm 等），计算频率（次/分钟）
- **语速追踪**：2 分钟滑动窗口统计 WPM（词/分钟），低语速作为焦虑信号
- **焦虑指数**：规则引擎综合犹豫词频率 + 语速，实时计算 anxiety_level（0~1）
- **动态 Prompt**：anxiety_level > 0.6 时自动切换鼓励模式（简化语言、增加正向反馈、温和重述）
- **情绪持久化**：每条用户转录附带 emotion_state JSON（anxiety_level, cognitive_load, hesitation_rate, wpm）
- **零阻塞设计**：纯文本分析 <0.1ms，通过 Agent.on_user_turn_completed 钩子在 LLM 推理前完成

### Phase 4 — 自适应 RAG + 学习报告（后端）

- **RAG 语料检索**：ChromaDB 本地向量数据库，10 条教学语料种子（发音/语法/场景对话）
- **Krashen i+1 过滤**：CEFR 数值化映射（A1=1~C2=6），metadata `$gte/$lte` 硬过滤 + 向量相似度软排序
- **自适应课程推荐**：读取 BKT 最弱技能 → RAG 检索匹配语料 → 生成定制化 System Prompt 模板
- **智能难度定位**：根据最弱技能掌握度自动推断目标 CEFR 等级（<0.3→A2, <0.6→B1, else→B2）
- **周报骨架预留**：Celery 异步 `generate_weekly_report` 任务（技能趋势 / 发音准确率 / 语法频次 / 情绪摘要）

### Phase 4 — 课程推荐 Dashboard（前端）

- **Dashboard 视图**：Zustand `appView` 状态机驱动 Dashboard / Session 双视图切换，无需 react-router
- **推荐卡片**：消费 `GET /api/curriculum/next`，渲染 1-3 个场景卡片（场景名称 + CEFR 等级色码 + 重点技能标签）
- **每日进度**：聚合当日完成会话的转录轮次，进度条可视化 turns/20 目标值，达标变绿 + "Goal reached!"
- **技能树集成**：Dashboard 挂载时自动加载 BKT 知识状态，展示全局技能掌握度
- **完整流转**：进入练习 → LiveKit 对话 → 评估反馈 → 返回主页（自动刷新数据）
- **i18n 规范**：新增文案统一提取至 `zhCN.dashboard` 命名空间

---

## API 端点一览

### 基础接口

| 方法 | 路径                 | 说明         |
| ---- | -------------------- | ------------ |
| GET  | `/api/health`        | 健康检查     |
| POST | `/api/auth/register` | 用户注册     |
| POST | `/api/auth/login`    | 用户登录     |
| GET  | `/api/auth/me`       | 当前用户信息 |

### 会话管理

| 方法 | 路径                          | 说明                 |
| ---- | ----------------------------- | -------------------- |
| POST | `/api/sessions`               | 创建会话             |
| GET  | `/api/sessions`               | 会话列表             |
| GET  | `/api/sessions/{id}`          | 会话详情（含转录）   |
| POST | `/api/sessions/{id}/end`      | 结束会话（触发分析） |
| GET  | `/api/sessions/{id}/token`    | LiveKit 令牌         |
| POST | `/api/sessions/{id}/dispatch` | 调度 Agent 加入房间  |

### 对话

| 方法 | 路径                     | 说明                 |
| ---- | ------------------------ | -------------------- |
| POST | `/api/conversation/chat` | 发送消息获取 AI 回复 |

### 评估与知识追踪（Phase 2）

| 方法 | 路径                                    | 说明         |
| ---- | --------------------------------------- | ------------ |
| GET  | `/api/assessments/{session_id}`         | 发音评估结果 |
| GET  | `/api/assessments/{session_id}/grammar` | 语法错误列表 |
| GET  | `/api/assessments/knowledge/states`     | 用户知识状态 |
| GET  | `/api/assessments/knowledge/skills`     | 技能定义列表 |

### 自适应课程推荐（Phase 4）

| 方法 | 路径                   | 说明                   |
| ---- | ---------------------- | ---------------------- |
| GET  | `/api/curriculum/next` | 获取下一步推荐练习场景 |

---

## 项目结构

```
EchoTalk/
├── backend/                           # FastAPI 后端
│   ├── main.py                        # 应用入口
│   ├── config.py                      # 环境配置
│   ├── database.py                    # 异步数据库引擎
│   ├── dependencies.py                # Mock 鉴权
│   ├── models/                        # ORM 模型（8 张表）
│   ├── schemas/                       # Pydantic 响应模型
│   ├── routers/                       # API 路由
│   ├── services/                      # 业务逻辑
│   │   ├── llm_service.py             # LLM 调用 + 动态 Prompt 构建
│   │   ├── emotion_analyzer.py        # 情绪分析规则引擎
│   │   ├── rag_service.py             # RAG 向量检索 + Krashen i+1
│   │   ├── analysis_service.py        # 分析管线编排
│   │   ├── pronunciation/             # NW 音素对齐
│   │   └── knowledge/                 # BKT 模型 + 技能映射
│   ├── workers/                       # Celery 异步任务
│   │   └── report_tasks.py            # 周报生成（骨架预留）
│   └── scripts/                       # 工具脚本
│       └── seed_corpus.py             # RAG 语料种子写入
├── apps/vite-app/                     # Vite React 前端
│   └── src/
│       ├── components/
│       │   ├── conversation/          # 语音对话组件
│       │   ├── pronunciation/         # 发音反馈 + 音素可视化
│       │   └── learning/              # 技能树 + 推荐卡片 + 每日进度
│       ├── store/                     # zustand 状态管理
│       ├── hooks/                     # 自定义 Hook（轮询等）
│       ├── lib/                       # API 客户端
│       └── i18n/                      # 中文字符串
└── docs/                              # 技术文档
```

---

## Mock 模式说明

当前所有外部依赖均可 Mock 运行（`.env` 中 `USE_MOCK_*=True`）：

| 服务   | Mock 行为                             | 生产环境接入方式                    |
| ------ | ------------------------------------- | ----------------------------------- |
| LLM    | 返回固定回复文本                      | `USE_MOCK_LLM=False` + API Key      |
| TTS    | 返回 null（无音频）                   | `USE_MOCK_TTS=False` + Cartesia Key |
| 发音   | letter-by-letter + TH→S 注入          | CMU 词典 / ELSA API                 |
| 语法   | 正则规则匹配                          | LLM 驱动检测                        |
| 情绪   | 文本犹豫词 + 语速规则引擎             | Hume EVI 3 原生情绪（Premium）      |
| Celery | 同步执行，无需 Redis                  | `USE_MOCK_CELERY=False` + Redis     |
| RAG    | ChromaDB 本地嵌入（all-MiniLM-L6-v2） | sentence-transformers 自定义模型    |

---

_文档版本：Phase 1-4 全栈开发完成（2026-03-02）_
