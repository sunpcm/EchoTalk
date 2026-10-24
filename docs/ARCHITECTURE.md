# EchoTalk 历史架构审计（2026-09-20）

> 审计基线：`main@1f9a1b0`，2026-09-20。
>
> 本文保留 `main@1f9a1b0` 的历史审计，不代表当前实现。其 Mock 鉴权、密钥耦合等结论已由后续认证与凭据改造更新；不得据此判断当前发布状态。当前事实见 [PROJECT_STATUS.md](./PROJECT_STATUS.md)、[TODO.md](../TODO.md) 与 [三端门禁](./CROSS_PLATFORM_ARCHITECTURE.md)，以下为原审计内容。

## 1. 架构结论

EchoTalk 当前是一个以 PostgreSQL 为事实源的模块化单体，实时语音运行时和异步任务运行时从 API 进程中分离：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 客户端                                                               │
│  Vite React Web（主客户端） | Capacitor iOS 壳（基础已接入）           │
│  Webpack React（备用打包器，不是移动端/生产交付基线）                  │
└──────────────┬─────────────────────┬─────────────────────────────────┘
               │ HTTPS / REST        │ WebRTC / DataChannel
               ▼                     ▼
┌────────────────────────────┐   ┌─────────────────────────────────────┐
│ Nginx                      │   │ LiveKit Cloud                       │
│ / → Vite 静态文件          │   │ 房间、媒体、Agent dispatch          │
│ /api → FastAPI             │   └──────────────────┬──────────────────┘
│ /livekit-ws → LiveKit      │                      │
└──────────────┬─────────────┘                      ▼
               ▼                         ┌─────────────────────────────┐
┌────────────────────────────┐           │ LiveKit Agent 独立进程      │
│ FastAPI 模块化单体          │◀─────────▶│ STT → LLM → TTS             │
│ 会话 / 设置 / 评估 / 课程   │ PostgreSQL│ 情绪感知、转录持久化、BYOK  │
└──────┬─────────┬───────────┘           └──────────────┬──────────────┘
       │         │                                      │
       ▼         ▼                                      ▼
 PostgreSQL    ChromaDB                           外部 AI Provider
 事实数据       教学语料向量检索                  Deepgram/LLM/Cartesia

 Redis ◀──── Celery Worker（当前仅承载未完成的周报骨架，不在核心链路）
```

这个边界适合当前体量：业务事务留在一个 FastAPI 服务内，低延迟音频处理交给 LiveKit Agent，只有真正需要脱离请求生命周期的任务才进入 Celery。现阶段继续拆分业务微服务会增加分布式事务、部署和可观测性成本，没有足够收益。

## 2. 能力状态

| 能力              | 当前状态               | 事实边界                                                                            |
| ----------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| Web 客户端        | 已实现                 | `apps/vite-app` 是交付基线；无 React Router，由 Zustand 驱动 Dashboard/Session 视图 |
| iOS               | 基础接入               | Capacitor 工程、麦克风描述、`AVAudioSession` 已存在；真机全链路和发布未验证         |
| Android / Desktop | 未实现                 | 仓库没有 Android 工程或 Tauri 工程                                                  |
| API               | 已实现                 | FastAPI + async SQLAlchemy，统一挂载在 `/api`                                       |
| 实时语音          | 已实现                 | LiveKit Cloud + 独立 Agent；依赖外部 STT/LLM/TTS Provider                           |
| 鉴权              | 仅 Mock                | 所有 Bearer Token 当前都映射到同一个固定用户，不能用于多用户或公网生产              |
| BYOK              | 已实现但受鉴权边界限制 | Key 用 Fernet 加密入库；密钥由 `JWT_SECRET_KEY` 派生                                |
| 评估 / BKT        | 已实现                 | 会话结束请求内同步计算，失败只记录 warning，不会重试                                |
| RAG               | 已实现                 | 课程推荐读取 ChromaDB；语料需单独播种                                               |
| Celery 周报       | 骨架                   | Worker 可启动，但任务只返回 `status: skeleton`，核心流程不会投递它                  |

## 3. 运行时与职责

### 3.1 前端

- `apps/vite-app`：React 19、TypeScript、Zustand、Tailwind CSS v4，是 Web 与 iOS 共享的唯一 UI 产物。
- `conversation` store：创建会话、获取 LiveKit Token、结束会话以及连接状态。
- `assessment` store：结束会话后轮询发音、语法和知识状态。
- `settings` store：BYOK 配置从 API 水合；主题只保存在 `localStorage`。
- `VoiceInterface`：选择 Web 代理或原生直连的 LiveKit URL，并监听 `agent_error` DataChannel。
- `apps/webpack-app`：备用构建实现。它不应被当作与 Vite 客户端功能等价的第二生产前端。

前端 API 路径由 `getApiBaseUrl()` 惰性解析。Web 默认使用同源 `/api`；原生端必须提供 `VITE_API_BASE_URL`，并自动补齐 `/api`。

### 3.2 FastAPI

FastAPI 保持模块化单体边界，路由只做鉴权、输入输出和流程编排：

| 模块     | 路径                               | 职责                                        |
| -------- | ---------------------------------- | ------------------------------------------- |
| 健康检查 | `/api/health`, `/api/health/ready` | 进程存活与数据库就绪检查                    |
| 会话     | `/api/sessions...`                 | 会话生命周期、LiveKit Token、Agent dispatch |
| 对话     | `/api/conversation/chat`           | 非实时文本对话                              |
| 评估     | `/api/assessments...`              | 发音、语法、BKT 状态查询                    |
| 课程     | `/api/curriculum/next`             | 最弱技能 + ChromaDB 检索推荐                |
| 用户设置 | `/api/user/settings`               | 双轨模式、Provider 与加密 Key 的读写/拨测   |

`database.get_db()` 在请求成功后提交、异常时回滚。业务服务复用同一个 `AsyncSession`，因此单请求内的关系数据库写入仍处于同一事务边界。

### 3.3 LiveKit Agent

Agent 是独立进程，不通过 FastAPI 依赖注入访问数据库。它以房间名中的 `session_id` 读取会话、文档上下文和用户设置，然后：

1. 根据 `is_custom_mode` 选择系统 Provider 或用户 BYOK Provider；
2. 初始化 STT、LLM、TTS 与 VAD；
3. 在用户轮次完成时进行情绪分析并动态调整 Prompt；
4. 把用户与 Assistant 转录写回 PostgreSQL；
5. 自定义轨失败时通过 `agent_error` DataChannel fail-fast，不静默回退到系统密钥。

Agent 与 API 共享数据库模型和配置，这是有意的代码复用，但也意味着两者必须使用相同版本的迁移和 `JWT_SECRET_KEY`。

### 3.4 Celery Worker

Celery 使用 Redis 同时作为 broker 和 result backend。当前只有 `generate_weekly_report` 骨架，尚未被核心业务投递。因此 Compose 中存在 Worker 并不等于周报功能已完成，也不代表评估已经异步化。

## 4. 核心数据与所有权

PostgreSQL 当前包含 10 张业务表：

```text
users
├── user_profiles          1:0..1
├── user_settings          1:0..1（Provider 配置、加密 API Key、验证状态）
├── sessions               1:N
│   ├── transcripts        1:N（文本、角色、情绪状态）
│   ├── session_contexts   1:0..1（DocTalk 原文与自定义 Prompt）
│   ├── pronunciation_assessments
│   └── grammar_errors
└── knowledge_states       1:N ── N:1 skills
```

- PostgreSQL 是用户、会话、设置、转录与学习状态的事实源。
- ChromaDB 只保存可重建的教学语料向量，不拥有用户事务数据。
- Redis 当前只服务 Celery，不是会话状态或事实数据来源。
- Schema 通过 Alembic 管理；应用启动不会自动执行迁移。

## 5. 关键业务链路

### 5.1 实时语音会话

```text
前端 readiness
  → POST /sessions
  → GET /sessions/{id}/token（套餐 / BYOK 验证门禁）
  → 前端加入 LiveKit 房间
  → POST /sessions/{id}/dispatch
  → LiveKit 调度 Agent
  → Agent 查询 session/settings/context
  → STT → 动态 Prompt/LLM → TTS
  → 转录与 emotion_state 写 PostgreSQL
```

Web 默认经 Nginx/Vite 的 `/livekit-ws` 代理连接；原生默认使用后端返回的 `ws_url` 直连。原生强制代理时，从真实 API origin 推导 WSS 地址，不能使用 WebView 的 `localhost`。

### 5.2 会话结束与学习分析

```text
POST /sessions/{id}/end
  → session 标记 completed
  → 请求内同步 analyze_session
  → 请求内同步 update_knowledge
  → 前端轮询 /assessments/{id}
```

当前失败语义不够可靠：分析异常会被捕获并只写 warning，接口仍返回已完成会话；没有任务状态、重试或补偿器。结果是“会话完成但评估永久不存在”，前端只能轮询超时。

### 5.3 DocTalk

前端读取用户选择的文本文件，把 `raw_text`、`content_type` 和自定义 Prompt 随创建会话请求发送。后端限制正文最多 50,000 字符，并把原文保存在 `session_contexts`；Agent 启动时读取上下文注入 Prompt。当前没有对象存储、病毒扫描、解析队列或文档版本管理。

## 6. 部署拓扑

根目录 Compose 是**本地集成/单机基线**，不是完整生产拓扑：

| 服务              | 数量/命令          | 持久化或依赖                      |
| ----------------- | ------------------ | --------------------------------- |
| `echotalk-web`    | Nginx 1 个         | 静态文件；反代 API 与 LiveKit WSS |
| `echotalk-api`    | Uvicorn 4 workers  | PostgreSQL、Redis、ChromaDB       |
| `echotalk-agent`  | LiveKit Agent 1 个 | PostgreSQL、Redis、外部 Provider  |
| `echotalk-worker` | Celery 1 个        | Redis、PostgreSQL                 |
| PostgreSQL 15     | 1 个               | named volume                      |
| Redis 7           | 1 个               | named volume                      |
| ChromaDB `latest` | 1 个               | named volume                      |

部署前必须单独执行 `alembic upgrade head` 与语料播种。Compose 只暴露 HTTP `3000`，没有 TLS 终止、备份、资源限制、集中日志或多副本协调，因此 README 不应把它称为生产环境推荐方案。

## 7. 已确认的架构风险

### P0：发布阻断

1. **Mock 鉴权**：`get_current_user` 忽略 Authorization 内容；当前所有用户数据实际属于固定测试用户。
2. **密钥耦合**：`JWT_SECRET_KEY` 同时派生 Fernet Key。随机变更会导致已存 BYOK Key 永久无法解密；默认开发值不能进入公网环境。
3. **无 TLS 生产入口**：仓库内 Nginx 只监听 80。麦克风、Cookie、原生 ATS 和凭据传输都要求真实 HTTPS/WSS 边界。

### P1：可靠性

1. **分析无持久任务状态**：同步分析失败被吞掉，没有 retry、幂等任务或人工补偿入口。
2. **多 worker 启动竞态**：4 个 Uvicorn worker 都执行测试用户与技能播种；“先查后插”缺少数据库级 upsert，冷启动时可能发生唯一键竞争。
3. **迁移与启动未编排**：服务可能在旧 Schema 上启动；应由单独的一次性迁移 Job 串行执行，而不是让每个 API worker 自动迁移。
4. **外部服务单点**：LiveKit Cloud、STT、LLM、TTS 任一不可用都会中断语音链路；当前缺少统一超时预算、熔断指标和降级说明。
5. **Compose 就绪门禁不足**：Web 只等待 API 容器启动，不等待 `/health/ready`；API 本身也没有容器 healthcheck。

### P2：维护与交付

1. ChromaDB 使用 `latest`，升级不可复现；应固定版本并验证数据兼容性。
2. CI 的 Node 版本是 22，而前端 Docker builder 是 Node 20；应统一到同一受支持版本。
3. CI 没有验证 Alembic 从空库升级、Docker 镜像构建或 iOS 构建。
4. 前端 API、状态与页面仍耦合在单一 SPA；在引入更多页面前再评估 Router，不需要现在为“未来可能”抽共享核心。

## 8. 推荐演进顺序

1. **先封安全边界**：真实认证、稳定的加密主密钥策略、HTTPS/WSS、生产配置 fail-fast。
2. **再补交付可靠性**：一次性迁移 Job、幂等播种、API/Agent/Provider 健康与结构化日志。
3. **持久化分析任务**：为会话分析增加明确状态、幂等 Job、有限重试和补偿入口；可继续使用现有 Celery，无需新服务。
4. **完成 iOS 真机闭环**：在真实认证与网络边界上验证，不把模拟器启动等同于可发布。
5. **按需求扩展 Android/Desktop**：先做平台 Spike，再决定是否维护原生工程；不要提前创建空壳或抽取 `shared-core`。

## 9. 文档更新规则

- 本文只记录当前实现和已经确认的风险，不写阶段待办清单。
- 跨端目标与平台门禁写入 `CROSS_PLATFORM_ARCHITECTURE.md`。
- 可执行任务与验收条件只写入根目录 `TODO.md`。
- 架构状态变化时，应在同一提交中更新本文、README 摘要和相关验收文档。
