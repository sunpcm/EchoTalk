# Phase 1 后端 — 技术栈说明

> Phase 1 后端完整内容：FastAPI 骨架、数据库建表、Mock 鉴权、会话 CRUD 接口、LLM 对话服务、会话结束功能。

---

## 1. 目录结构

```
backend/                              # FastAPI Python 后端
├── main.py                           # 应用入口（CORS、路由注册、lifespan 生命周期）
├── config.py                         # pydantic-settings 配置（读取根目录 .env）
├── database.py                       # 异步 SQLAlchemy engine + session + get_db 依赖
├── dependencies.py                   # Mock get_current_user 鉴权依赖
├── requirements.txt                  # Python 依赖清单
├── pyproject.toml                    # black 格式化配置
├── setup.cfg                         # flake8 检查配置
├── alembic.ini                       # Alembic 迁移配置
├── alembic/
│   ├── env.py                        # 异步 Alembic 迁移环境
│   ├── script.py.mako                # 迁移模板
│   └── versions/
│       └── 8a4b33719582_initial_*.py # 初始迁移
├── models/
│   ├── __init__.py                   # 统一导出所有 ORM 模型
│   ├── base.py                       # SQLAlchemy DeclarativeBase
│   ├── user.py                       # User + UserProfile 模型
│   └── session.py                    # Session + Transcript 模型
├── schemas/
│   ├── __init__.py
│   ├── session.py                    # 会话请求/响应模型
│   └── conversation.py               # 对话请求/响应模型
├── routers/
│   ├── __init__.py
│   ├── health.py                     # GET /api/health
│   ├── sessions.py                   # 会话 CRUD + 结束接口
│   └── conversation.py               # 对话聊天接口
└── services/
    ├── __init__.py
    └── llm_service.py                # LLM 调用封装（SiliconFlow / OpenRouter）
```

---

## 2. 技术栈清单

| 技术              | 版本       | 用途                                          |
| ----------------- | ---------- | --------------------------------------------- |
| Python            | 3.12       | 运行时                                        |
| FastAPI           | 0.135+     | Web 框架                                      |
| Uvicorn           | 0.41+      | ASGI 服务器（含 uvloop）                      |
| SQLAlchemy        | 2.0+       | ORM（异步模式）                               |
| asyncpg           | 0.31+      | PostgreSQL 异步驱动                           |
| Alembic           | 1.18+      | 数据库迁移                                    |
| Pydantic          | 2.12+      | 数据校验与序列化                              |
| pydantic-settings | 2.13+      | 环境变量配置加载                              |
| **openai**        | **1.109+** | **LLM 调用（兼容 SiliconFlow / OpenRouter）** |
| python-jose       | 3.3+       | JWT 解码（预留，Phase 2 接入）                |
| passlib           | 1.7+       | 密码哈希（预留，Phase 2 接入）                |
| black             | 26+        | 代码格式化                                    |
| flake8            | 7.3+       | 代码质量检查                                  |

---

## 3. 数据库表（PostgreSQL）

本阶段创建 4 张表：

| 表名            | 说明                                             |
| --------------- | ------------------------------------------------ |
| `users`         | 用户主表（UUID 主键、email 唯一、订阅等级 ENUM） |
| `user_profiles` | 用户配置（一对一关联 users，含学习目标数组）     |
| `sessions`      | 练习会话（mode/status 为 ENUM，关联 users）      |
| `transcripts`   | 会话转录记录（BIGSERIAL 主键，关联 sessions）    |

ENUM 类型：

- `subscription_tier_enum`: free, pro, premium
- `session_mode_enum`: pronunciation, free_talk, conversation, scenario, exam_prep
- `session_status_enum`: active, completed, cancelled
- `tier_used_enum`: free, pro, premium
- `transcript_role_enum`: user, assistant

---

## 4. API 接口

| 方法     | 路径                         | 说明                             |
| -------- | ---------------------------- | -------------------------------- |
| GET      | `/api/health`                | 健康检查                         |
| POST     | `/api/sessions`              | 创建练习会话                     |
| GET      | `/api/sessions`              | 列出当前用户会话                 |
| GET      | `/api/sessions/{id}`         | 查询会话详情（含转录）           |
| **POST** | **`/api/sessions/{id}/end`** | **结束会话（status→completed）** |
| **POST** | **`/api/conversation/chat`** | **发送消息并获取 AI 回复**       |

### 4.1 对话接口详情

**POST /api/conversation/chat**

请求体：

```json
{ "session_id": "<uuid>", "message": "用户输入的文本" }
```

响应体：

```json
{ "reply": "AI 回复文本", "transcript_id": 123, "audio_base64": null }
```

流程：保存用户消息 → 加载历史上下文 → 调用 LLM → 保存 AI 回复 → 返回。

---

## 5. LLM 服务设计

### 5.1 Provider 架构

使用 OpenAI SDK 兼容接口，通过切换 `base_url` 和 `api_key` 支持多个 provider：

| Provider    | base_url                        | API Key 字段          |
| ----------- | ------------------------------- | --------------------- |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `SILICONFLOW_API_KEY` |
| OpenRouter  | `https://openrouter.ai/api/v1`  | `OPENROUTER_API_KEY`  |

### 5.2 模型选择

由 `.env` 中 `DEFAULT_LLM_PROVIDER` 和 `DEFAULT_LLM_MODEL` 控制：

- 当前配置：`siliconflow` + `Qwen/Qwen2.5-7B-Instruct`

### 5.3 System Prompt

Phase 1 使用简化版口语教练 prompt，包含：

- 角色设定（友善有耐心的 AI 英语教练）
- 错误纠正策略（隐性重述 Recast）
- 回复长度控制（2-4 句保持对话流）
- 情绪鼓励指令

Phase 2+ 将加入 BKT 薄弱技能标签、情绪分析指令、RAG 材料等。

---

## 6. 关键设计决策

1. **异步 SQLAlchemy**：使用 `create_async_engine` + `AsyncSession`，配合 asyncpg 驱动。
2. **配置加载**：`config.py` 使用 `pydantic-settings` 从项目根目录 `.env` 加载。
3. **DATABASE_URL 转换**：`postgresql://` 自动转为 `postgresql+asyncpg://`。
4. **Mock 鉴权**：`dependencies.py` 返回固定测试用户，预留 JWT TODO 注释。
5. **Lifespan 种子**：应用启动时自动创建 Mock 测试用户。
6. **AsyncOpenAI**：使用 `openai` 包的 `AsyncOpenAI` 客户端，与 FastAPI 异步路由天然匹配。
7. **多轮上下文**：从 transcripts 表加载历史消息，构建完整 `messages` 数组传入 LLM。

---

## 7. 环境变量（本阶段使用）

| 变量                   | 说明                                   |
| ---------------------- | -------------------------------------- |
| `DATABASE_URL`         | PostgreSQL 连接串                      |
| `CORS_ORIGINS`         | 允许的前端来源（JSON 数组）            |
| `JWT_SECRET_KEY`       | JWT 密钥（当前 Mock，预留）            |
| `SILICONFLOW_API_KEY`  | SiliconFlow API 密钥                   |
| `OPENROUTER_API_KEY`   | OpenRouter API 密钥（备用）            |
| `DEFAULT_LLM_PROVIDER` | LLM 服务商（siliconflow / openrouter） |
| `DEFAULT_LLM_MODEL`    | LLM 模型名称                           |
| `USE_MOCK_*`           | 各服务 Mock 开关                       |
