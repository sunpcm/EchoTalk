# EchoTalk — AI 英语口语练习平台

基于 LiveKit WebRTC 的实时语音对话系统，集成发音评估、语法检测与 BKT 知识追踪。

---

## 项目当前状态与进度

| Phase | 内容                              | 状态      |
| ----- | --------------------------------- | --------- |
| 1     | 后端基础对话管线                  | ✅ 已完成 |
| 1     | 前端 Vite 语音 UI                 | ✅ 已完成 |
| 2     | 发音评估 + 知识追踪（后端）       | ✅ 已完成 |
| 2     | 发音高亮 + 技能树（前端）         | ✅ 已完成 |
| 3     | 情绪感知（后端）                  | ✅ 已完成 |
| 3     | 数字人（前端）                    | 🔲 待开发 |
| 4     | 自适应 RAG + 学习报告（后端）     | ✅ 已完成 |
| 4     | 课程推荐 Dashboard（前端）        | ✅ 已完成 |
| 5     | 双轨制 BYOK — 数据层 + Agent      | ✅ 已完成 |
| 5     | 双轨制 BYOK — 设置抽屉 + 错误拦截 | ✅ 已完成 |

---

## 技术架构

```
┌────────────────────────────────────────────────────────┐
│ 前端 (Vite + React 19 + TypeScript)                      │
│  ├── Dashboard: 推荐场景卡片 + 每日进度 + 技能树           │
│  ├── LiveKit WebRTC 语音交互                              │
│  ├── zustand 状态管理（视图流转 + 连接 + 评估 + 设置）       │
│  ├── 设置抽屉: 双轨制 Switch + Provider/Key 配置           │
│  ├── DataChannel 错误拦截 + 自动重连阻止                   │
│  └── Tailwind CSS v4 样式                                │
├────────────────────────────────────────────────────────┤
│ 后端 (FastAPI + SQLAlchemy 2.0 async)                   │
│  ├── 对话管线: STT → LLM → TTS                           │
│  ├── 双轨路由: 基础轨(.env) / 自定义轨(BYOK) + Fail-Fast  │
│  ├── PluginFactory: 插件工厂（动态实例化 STT/LLM/TTS）     │
│  ├── 情绪感知: 文本犹豫词 + 语速规则引擎                    │
│  ├── 发音评估: Needleman-Wunsch 音素对齐                   │
│  ├── 知识追踪: BKT 贝叶斯模型                              │
│  ├── 语法检测: 正则规则引擎                                │
│  └── 自适应 RAG: ChromaDB 向量检索 + Krashen i+1          │
├────────────────────────────────────────────────────────┤
│ 数据层 (PostgreSQL + asyncpg + ChromaDB)                  │
│  └── 9 张表: users, user_profiles, user_settings,         │
│      sessions, transcripts, skills, knowledge_states,     │
│      pronunciation_assessments, grammar_errors            │
└────────────────────────────────────────────────────────┘
```

---

## Docker 容器化部署（生产环境推荐）

### 前置条件

- Docker Engine 20+
- Docker Compose V2

### 服务架构

```
docker-compose.yml 包含 7 个服务：

  echotalk-postgres   ── PostgreSQL 15
  echotalk-redis      ── Redis 7
  echotalk-chroma     ── ChromaDB 向量数据库
  echotalk-api        ── FastAPI (uvicorn × 4 workers)
  echotalk-agent      ── LiveKit 语音 Agent
  echotalk-worker     ── Celery 异步任务
  echotalk-web        ── Nginx 静态前端 + API 反向代理
```

### 启动步骤

```bash
# 1. 确认 .env 文件已配置（API keys 等敏感信息）
#    docker-compose 中的 DATABASE_URL / REDIS_URL / CHROMA_HOST
#    已自动指向容器内部地址，无需手动修改

# 2. 一键构建并启动全部服务（后台运行）
docker compose up -d --build

# 3. 查看服务状态
docker compose ps

# 4. 初始化 ChromaDB 语料种子（首次部署时执行）
docker compose exec echotalk-api python scripts/seed_corpus.py

# 5. 数据库迁移（首次部署时执行）
docker compose exec echotalk-api alembic upgrade head
```

### 访问地址

| 服务     | 地址                                                 |
| -------- | ---------------------------------------------------- |
| 前端     | `http://localhost:3000`                              |
| API      | `http://localhost:3000/api/` （通过 Nginx 反向代理） |
| 健康检查 | `http://localhost:3000/api/health`                   |

### 常用运维命令

```bash
# 查看日志
docker compose logs -f echotalk-api
docker compose logs -f echotalk-agent

# 重启单个服务
docker compose restart echotalk-api

# 停止全部服务
docker compose down

# 停止并清除数据卷（⚠️ 会丢失数据库数据）
docker compose down -v
```

---

## 本地开发启动

### 前置条件

- Python 3.12+ / [uv](https://docs.astral.sh/uv/)
- Node.js 20+ / pnpm
- PostgreSQL 15+

### 后端启动

```bash
# 1. 进入后端目录
cd backend

# 2. 创建虚拟环境并安装依赖
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt

# 3. 配置环境变量
#    复制 .env.example 为 .env 并填写:
#    - DATABASE_URL=postgresql://user:pass@localhost:5432/echotalk
#    - SILICONFLOW_API_KEY 或 OPENROUTER_API_KEY
#    - DEEPGRAM_API_KEY, CARTESIA_API_KEY（基础轨语音服务）
#    - JWT_SECRET_KEY（任意字符串，同时用于 Phase 5 Fernet 密钥派生）

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

### Phase 5 — 双轨制 BYOK 数据层与 Agent 路由（后端）

- **用户设置表**：`user_settings` 一对一关联 `users`，存储双轨制开关 `is_custom_mode` 与加密 API Key
- **Fernet 对称加密**：`cryptography.fernet` 加密用户 API Key，密钥由 `SHA-256(JWT_SECRET_KEY)` 派生
- **设置 API**：`GET/PUT /api/user/settings`，密钥仅返回 `has_xxx_key: bool`，部分更新支持
- **PluginFactory 插件工厂**：统一实例化 STT/LLM/TTS/VAD 插件，预检 Provider + Key 有效性
- **双轨路由**：Agent 根据 `is_custom_mode` 选择基础轨（`.env` 系统密钥）或自定义轨（DB 解密密钥）
- **Fail-Fast 不降级**：自定义轨失败后通过 DataChannel 发送 `agent_error` JSON + 断连，绝不回落到系统默认配置
- **错误码协议**：`ERR_CUSTOM_KEY_INVALID` / `ERR_UNSUPPORTED_*_PROVIDER`，`reliable=True` TCP 语义保证送达
- **LLM Provider 映射**：支持 SiliconFlow (`api.siliconflow.cn`) 和 OpenRouter (`openrouter.ai`)

### Phase 5 — 设置抽屉与 DataChannel 错误拦截（前端）

- **设置抽屉 (SettingsDrawer)**：右侧滑入式抽屉，Switch 切换双轨模式，Provider 下拉 + API Key 密码输入
- **已配置徽章**：`has_xxx_key=true` 时显示绿色「已配置」标识，空提交不覆盖已有密钥
- **设置 Store**：Zustand `useSettingsStore`，应用启动时自动水合（GET），保存时部分更新（PUT）
- **DataChannel 错误拦截**：`useDataChannel("agent_error")` 监听 Agent 错误消息，解析 JSON 并展示红色错误卡片
- **自动重连阻止**：`setAgentError()` 将 `connectionState` 切到 `"ended"`，卸载 `<LiveKitRoom>` 根本阻断 WebRTC 重连
- **onDisconnected 守卫**：检测到 `agentError` 时跳过琥珀色连接警告，避免重叠错误提示
- **i18n 规范**：新增 `settings` + `agentError` 两个命名空间

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

### 用户设置（Phase 5）

| 方法 | 路径                 | 说明                                       |
| ---- | -------------------- | ------------------------------------------ |
| GET  | `/api/user/settings` | 获取双轨制配置状态，密钥仅返回 has_xxx_key |
| PUT  | `/api/user/settings` | 部分更新双轨制配置，明文 Key 加密后入库    |

---

## 项目结构

```
EchoTalk/
├── backend/                           # FastAPI 后端
│   ├── main.py                        # 应用入口
│   ├── config.py                      # 环境配置
│   ├── database.py                    # 异步数据库引擎
│   ├── dependencies.py                # Mock 鉴权
│   ├── models/                        # ORM 模型（9 张表）
│   ├── schemas/                       # Pydantic 响应模型
│   ├── routers/                       # API 路由
│   ├── services/                      # 业务逻辑
│   │   ├── llm_service.py             # LLM 调用 + 动态 Prompt 构建
│   │   ├── emotion_analyzer.py        # 情绪分析规则引擎
│   │   ├── rag_service.py             # RAG 向量检索 + Krashen i+1
│   │   ├── analysis_service.py        # 分析管线编排
│   │   ├── pronunciation/             # NW 音素对齐
│   │   └── knowledge/                 # BKT 模型 + 技能映射
│   ├── utils/                         # 工具模块
│   │   └── crypto.py                  # Fernet API Key 加解密
│   ├── livekit_agent/                 # LiveKit 语音 Agent
│   │   ├── agent.py                   # 双轨路由入口
│   │   └── plugin_factory.py          # PluginFactory 插件工厂
│   ├── workers/                       # Celery 异步任务
│   │   └── report_tasks.py            # 周报生成（骨架预留）
│   └── scripts/                       # 工具脚本
│       └── seed_corpus.py             # RAG 语料种子写入
├── apps/vite-app/                     # Vite React 前端
│   └── src/
│       ├── components/
│       │   ├── conversation/          # 语音对话组件 + DataChannel 错误拦截
│       │   ├── settings/              # 设置抽屉（双轨制配置 UI）
│       │   ├── pronunciation/         # 发音反馈 + 音素可视化
│       │   └── learning/              # 技能树 + 推荐卡片 + 每日进度
│       ├── store/                     # zustand 状态管理（conversation + assessment + settings）
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

_文档版本：Phase 1-5 全栈开发完成（2026-03-06）_
