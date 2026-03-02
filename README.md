# EchoTalk — AI 英语口语练习平台

基于 LiveKit WebRTC 的实时语音对话系统，集成发音评估、语法检测与 BKT 知识追踪。

---

## 项目当前状态与进度

| Phase | 内容                        | 状态      |
| ----- | --------------------------- | --------- |
| 1     | 后端基础对话管线            | ✅ 已完成 |
| 1     | 前端 Vite 语音 UI           | ✅ 已完成 |
| 2     | 发音评估 + 知识追踪（后端） | ✅ 已完成 |
| 2     | 发音高亮 + 技能树（前端）   | ✅ 已完成 |
| 3     | 情绪感知 + 数字人           | 🔲 待开发 |
| 4     | 自适应 RAG + 学习报告       | 🔲 待开发 |

---

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│ 前端 (Vite + React 19 + TypeScript)                 │
│  ├── LiveKit WebRTC 语音交互                         │
│  ├── zustand 状态管理                                │
│  └── Tailwind CSS v4 样式                            │
├─────────────────────────────────────────────────────┤
│ 后端 (FastAPI + SQLAlchemy 2.0 async)               │
│  ├── 对话管线: STT → LLM → TTS                      │
│  ├── 发音评估: Needleman-Wunsch 音素对齐             │
│  ├── 知识追踪: BKT 贝叶斯模型                       │
│  └── 语法检测: 正则规则引擎                          │
├─────────────────────────────────────────────────────┤
│ 数据层 (PostgreSQL + asyncpg)                       │
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

# 2. 启动开发服务器（/api 代理至 localhost:8000）
pnpm --filter vite-app dev

# 3. 访问 http://localhost:3000
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

| 方法 | 路径                       | 说明                 |
| ---- | -------------------------- | -------------------- |
| POST | `/api/sessions`            | 创建会话             |
| GET  | `/api/sessions`            | 会话列表             |
| GET  | `/api/sessions/{id}`       | 会话详情（含转录）   |
| POST | `/api/sessions/{id}/end`   | 结束会话（触发分析） |
| GET  | `/api/sessions/{id}/token` | LiveKit 令牌         |

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
│   └── services/                      # 业务逻辑
│       ├── llm_service.py             # LLM 调用
│       ├── analysis_service.py        # 分析管线编排
│       ├── pronunciation/             # NW 音素对齐
│       └── knowledge/                 # BKT 模型 + 技能映射
├── apps/vite-app/                     # Vite React 前端
│   └── src/
│       ├── components/
│       │   ├── conversation/          # 语音对话组件
│       │   ├── pronunciation/         # 发音反馈 + 音素可视化
│       │   └── learning/              # 技能树
│       ├── store/                     # zustand 状态管理
│       ├── hooks/                     # 自定义 Hook（轮询等）
│       ├── lib/                       # API 客户端
│       └── i18n/                      # 中文字符串
└── docs/                              # 技术文档
```

---

## Mock 模式说明

当前所有外部依赖均可 Mock 运行（`.env` 中 `USE_MOCK_*=True`）：

| 服务   | Mock 行为                    | 生产环境接入方式                    |
| ------ | ---------------------------- | ----------------------------------- |
| LLM    | 返回固定回复文本             | `USE_MOCK_LLM=False` + API Key      |
| TTS    | 返回 null（无音频）          | `USE_MOCK_TTS=False` + Cartesia Key |
| 发音   | letter-by-letter + TH→S 注入 | CMU 词典 / ELSA API                 |
| 语法   | 正则规则匹配                 | LLM 驱动检测                        |
| Celery | 同步执行，无需 Redis         | `USE_MOCK_CELERY=False` + Redis     |

---

_文档版本：Phase 2 前端完成（2026-03-02）_
