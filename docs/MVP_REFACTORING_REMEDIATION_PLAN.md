# EchoTalk MVP 技术债修复与重构方案

> 状态：待实施
>
> 审计基线：`origin/main@30f51f3175de20bc827ebdf29789ad934096133d`
>
> 文档职责：定义修复边界、实施顺序和验收标准；任务完成状态仍以根目录 `TODO.md` 为准。

## 1. 背景与结论

EchoTalk 当前已经具备 Web 对话、LiveKit Agent、BYOK、会话记录、学习评估和课程推荐等 MVP 能力，但部分实现仍保留原型阶段的假设：

- 会话结束、分析完成和评估可用没有独立状态，失败后可能永久停留在“分析中”。
- 鉴权仍返回固定 Mock 用户，前端仍发送固定 `mock-token`。
- 发音与语法评估包含合成音素和规则匹配，却进入正式学习结果链路。
- Redis、Celery Worker、ChromaDB 和多套前端模板带来的维护成本大于当前业务收益。
- Python 依赖没有真实锁定，CI、Docker 和本地运行时版本不一致。
- 单元测试数量尚可，但 Playwright E2E 是占位测试，后端格式和静态检查未进入 CI。
- Agent、Provider 设置和前端核心组件职责过多，继续叠加功能会显著提高回归风险。

本轮不进行框架重写。目标架构继续采用：

1. Vite + React 单一 Web/Capacitor 前端。
2. FastAPI 模块化单体，持有业务 API 和 PostgreSQL 事务。
3. 独立 LiveKit Agent 进程，持有实时语音生命周期。
4. PostgreSQL 作为业务状态和异步任务状态的唯一事实源。
5. 只有在规模和评测证明必要时，才重新引入专用队列或向量数据库。

## 2. 治理原则

### 2.1 可靠性优先于代码美化

先修复不可恢复状态、数据真实性、认证和 CI，再拆大文件或升级框架。纯重命名、目录搬迁和格式化不得与行为修复混在同一个 PR。

### 2.2 先删除，再抽象，最后升级

实施顺序统一为：

1. 删除未使用代码、依赖和服务。
2. 为真实业务边界建立接口和状态模型。
3. 补齐测试与可观测性。
4. 最后执行 LiveKit、Vite、OpenAI SDK 等大版本迁移。

### 2.3 每个迁移都必须可回滚

- 数据库变更使用 Alembic 前向迁移，不修改已经发布的历史迁移。
- 新旧行为需要并行时，使用显式配置开关，开关必须有删除期限。
- 删除容器或依赖前，先用仓库搜索和运行期指标确认没有调用者。
- 不允许通过清空数据库、覆盖密钥或重建用户数据完成迁移。

### 2.4 Mock 不得伪装成生产能力

Mock 只能存在于测试夹具或明确的本地 Demo 模式中。生产响应必须标明数据来源、分析状态和失败原因，不得把合成分数写入真实学习档案。

## 3. 目标运行时边界

```text
Web / Capacitor
      |
      | HTTP / WebSocket
      v
FastAPI modular monolith --------> PostgreSQL
      |                                 ^
      | LiveKit dispatch                | transcript / job state
      v                                 |
LiveKit Cloud <--------------> LiveKit Agent
                                      |
                                      +--> STT / LLM / TTS providers
```

修复后的核心约束：

- FastAPI 不在结束会话请求中执行耗时分析。
- Agent 不直接承担鉴权、密钥迁移或课程推荐职责。
- PostgreSQL 持有会话、分析任务、分析结果和密钥版本信息。
- 前端通过显式状态展示“排队、运行、成功、失败”，不再把 404 当作无限等待协议。
- Provider 的名称、能力、模型、验证方式和错误映射由统一 Registry 管理。

## 4. P0：发布阻断修复

### RF-01：重建会话分析状态机

#### 当前问题

`POST /api/sessions/{id}/end` 先将会话设为 `completed`，随后在同一请求中同步执行分析。异常只写日志，前端只能通过评估接口的 404 猜测分析是否仍在运行。轮询达到上限后仍保持 `polling`，并禁止返回主页。

#### 目标状态

新增持久化分析任务，推荐字段如下：

| 字段              | 说明                               |
| ----------------- | ---------------------------------- |
| `id`              | 任务 UUID                          |
| `session_id`      | 唯一关联会话，防止重复创建         |
| `status`          | `pending/running/succeeded/failed` |
| `attempt_count`   | 已执行次数                         |
| `last_error_code` | 可稳定映射给前端的错误码           |
| `last_error`      | 服务端诊断摘要，不存 Provider 凭据 |
| `next_retry_at`   | 下次可领取时间                     |
| `started_at`      | 最近一次开始时间                   |
| `finished_at`     | 成功或最终失败时间                 |
| `created_at`      | 创建时间                           |
| `updated_at`      | 更新时间                           |

状态转换只允许：

```text
pending -> running -> succeeded
   ^          |
   |          +-> failed -> pending（人工或自动重试）
   +----------+
```

#### 实施要求

- 结束会话事务只负责结束会话并创建唯一分析任务，随后立即返回。
- Worker 使用原子领取或 `FOR UPDATE SKIP LOCKED`，避免重复消费。
- 分析结果按 `session_id` 幂等写入；重复执行不得生成重复评估或重复更新知识状态。
- 任务崩溃或超时后能够重新入队，达到上限后进入 `failed`。
- 新增 `GET /api/sessions/{id}/analysis-status`。
- 新增受控的重试入口；只有任务失败或超时后才能重试。
- 前端允许用户在任何状态返回主页，并为失败状态提供重试动作。
- 结束会话 API 失败时不得静默切换到成功结束状态。

#### 技术选择

首选 PostgreSQL Job + 独立轻量 Worker，复用现有事务、备份和可观测能力。只有在吞吐量或跨服务消费需求有证据时，再采用 Redis/Celery。

#### 验收标准

- 强制让分析抛出异常后，状态最终进入 `failed`，页面不会永久转圈。
- 同一任务重复执行两次，数据库只存在一套评估和一次知识状态效果。
- Worker 在执行中被终止，重新启动后任务可以恢复。
- 用户可以在 `pending`、`running` 和 `failed` 状态返回主页。
- API 测试覆盖所有合法和非法状态转换。

### RF-02：隔离模拟分析与真实学习数据

#### 当前问题

当前发音分析会生成模拟用户音素，并用少量规则检测语法错误。依赖缺失时，参考音素还会退化为逐字母序列。这些结果不能代表真实发音或语法能力。

#### 实施要求

- 为评估增加 `source`、`provider`、`model_version`、`is_synthetic` 和 `confidence` 元数据。
- Demo 模式生成的结果必须设置 `is_synthetic=true`，不得更新真实 `KnowledgeState`。
- 生产模式缺少真实评估 Provider 时返回明确的 `unsupported`，不得静默回退为模拟结果。
- 真实发音评估应使用带时间戳或音素信息的 Provider 输出，保留原始响应引用以便审计。
- 语法评估结果必须包含原文片段、修正结果、规则或模型来源以及置信度。

#### 验收标准

- 测试和 Demo 数据能被明确识别并批量排除。
- 生产配置下无法产生来源不明的发音分数。
- Synthetic 评估不会改变用户掌握度。

### RF-03：接入真实鉴权并分离密钥生命周期

#### 当前问题

后端忽略 Authorization Header 并返回固定用户；前端固定发送 `Bearer mock-token`。`JWT_SECRET_KEY` 同时派生 BYOK 的 Fernet 密钥，轮换认证密钥会导致已保存 Provider Key 无法解密。

#### 实施要求

- 在进入实现前明确采用外部 OIDC 还是自建账号体系；两者不得同时半实现。
- 抽象统一 `CurrentUser` 依赖，所有会话、设置和评估查询都校验资源归属。
- 删除生产配置中的默认 JWT Secret，缺失关键配置时启动失败。
- 至少分离：
  - `AUTH_SIGNING_KEY`：认证签名或服务端会话用途。
  - `CREDENTIAL_ENCRYPTION_KEYS`：带版本号的 BYOK 主密钥集合。
  - `ACTIVE_CREDENTIAL_KEY_VERSION`：新写入使用的版本。
- 密文记录保存 `key_version`，读取旧版本后允许惰性重加密。
- 日志、异常、遥测和 API 响应禁止包含用户密钥明文。
- 不再把密钥验证失败统一折叠成布尔值；区分超时、网络、认证失败和 Provider 限流。

#### 验收标准

- 无 Token、伪造 Token、过期 Token 均返回 401。
- 用户 A 无法访问用户 B 的会话、设置和评估。
- 轮换认证签名密钥不会影响 BYOK 解密。
- 加密主密钥轮换后，旧密文仍可读取并逐步迁移。
- 日志扫描不包含测试密钥或 Authorization 内容。

### RF-04：让 CI 真实代表可交付状态

#### 实施要求

前端门禁：

- Prettier check、ESLint、TypeScript、Vitest。
- Playwright 启动真实 Web 和测试 API，至少覆盖：健康检查、创建会话、结束会话、分析成功、分析失败退出。
- PR CI 不访问付费语音 Provider；使用行为一致的本地 Fake Adapter。

后端门禁：

- 使用 Ruff format/check 或实际执行 Black + Flake8，二选一并统一。
- Pytest 加覆盖率阈值，阈值先以现状为基线，再逐步提高。
- 使用 PostgreSQL 服务执行 Alembic 从空库升级到 head。
- 验证关键唯一约束、索引、任务领取和幂等行为。

#### 验收标准

- 删除 `expect(true).toBe(true)` 占位测试。
- 任意格式错误、类型错误、失败迁移和真实 E2E 回归都会阻断 PR。
- CI 和本地使用相同的锁文件及主运行时版本。
- GitHub `CI` required check 只在所有必要子任务成功后通过。

## 5. P1：架构减法与构建复现

### RF-05：删除未产生业务价值的基础设施

#### Redis / Celery

- 如果 RF-01 采用 PostgreSQL Job，则删除 Redis、Celery Worker、Celery 配置及相关依赖。
- 如果决定继续使用 Celery，必须让它实际承接分析任务，并补齐幂等、重试、超时和监控；不得继续保留只返回 `skeleton` 的任务。

#### ChromaDB

- 当前少量静态语料迁移到 PostgreSQL 表或受版本控制的数据文件。
- 推荐逻辑先按 CEFR、skill tag 和优先级确定性过滤。
- 删除 Chroma 服务以及只为它引入的重依赖。
- 未来只有在语料规模和离线检索评测证明关键词/标签不足时，才考虑 `pgvector` 或独立向量数据库。

#### 验收标准

- `docker compose config` 中不再包含无调用者的服务。
- 课程推荐结果在迁移前后满足相同业务用例。
- 容器、CI 安装体积和冷启动时间有前后对比记录。

### RF-06：清理前端模板和发布工具残留

候选删除范围：

- `apps/webpack-app`
- 未被产品引用的 `packages/ui-lib`
- `.changeset`
- Plop 模板和 `plopfile.cjs`
- 对应的 Webpack、Changesets、Plop 依赖和脚本
- 根目录一次性调试文件

删除前必须使用 `rg` 检查 import、workspace 依赖、Docker COPY、Turbo pipeline 和 CI 调用。产品实际使用的共享 ESLint、Prettier、TypeScript、Tailwind 配置可以继续保留。

#### 验收标准

- 根包名和元数据改为 EchoTalk 项目语义。
- Turbo 只执行真实存在且有价值的任务。
- Vite Web、Capacitor 同步和 Docker 构建不依赖被删除目录。
- 测试输出不再出现多个“no tests”伪任务。

### RF-07：统一 Python 和 Node 依赖管理

#### Python

- 在 `backend/pyproject.toml` 建立真实 `[project]` 依赖。
- 按运行角色建立依赖组，例如 `api`、`agent`、`dev`；不再把测试和格式工具装入生产镜像。
- 生成并提交完整 `uv.lock`。
- Docker 使用 `uv sync --frozen`，CI 不再额外执行多次 `uv pip install`。
- 删除未引用的 `sentence-transformers`、`librosa`、`soundfile`、`scikit-learn`。
- 直接使用的包必须直接声明；不得依赖其他 SDK 的传递依赖。

#### Node

- CI、本地和 Docker 统一 Node 22。
- 使用 Corepack 和根目录声明的 pnpm 版本，不执行未固定版本的全局安装。
- 删除无效 workspace 后重新生成并审核 lockfile diff。

#### 验收标准

- 干净机器上只靠 lockfile 可以复现安装和测试。
- Docker 构建使用 frozen lock，依赖漂移会显式失败。
- API 镜像不包含测试工具和未使用 ML 运行时。
- Agent 与 API 可以共享源码，但不必安装彼此不需要的可选依赖。

### RF-08：修复启动播种、迁移和时间语义

#### 实施要求

- 移除每个 Uvicorn Worker 在 lifespan 中执行的测试用户和技能播种。
- 固定参考数据进入 Alembic、显式 seed 命令或数据库级 upsert；生产环境不得自动创建 Mock 用户。
- 全部时间改为 timezone-aware UTC，数据库列明确保存时区。
- 为高频查询补齐索引，至少审计：
  - `sessions(user_id, started_at)`
  - `transcripts(session_id, timestamp_ms)`
  - `assessments(session_id)`
  - `grammar_errors(session_id)`
  - `knowledge_states(user_id, skill_id)`
- 列表接口增加有界分页。

#### 验收标准

- 四个 API Worker 并发启动不会发生重复插入。
- 测试不再产生 `datetime.utcnow()` 弃用警告。
- 迁移在空库和现有数据库副本上都能成功执行。
- 关键列表查询有查询计划或基准证据支持索引选择。

## 6. P2：内部边界重构

### RF-09：拆分 LiveKit Agent

将当前 Agent 拆成以下协作边界：

- `AgentJobOrchestrator`：连接、参与者和会话生命周期。
- `CredentialResolver`：读取、解密和校验 Provider 配置。
- `ProviderRegistry`：Provider 能力和插件构造。
- `TranscriptSink`：可靠、可排空的转录持久化。
- `AgentErrorMapper`：SDK 错误到稳定产品错误码的映射。

同时完成：

- 删除运行时 `sys.path` 修改和模块导入时加载 `.env`。
- 不再临时删除进程级敏感环境变量；自定义模式通过显式参数构造插件。
- 不访问 LiveKit SDK 私有属性。
- 追踪后台任务，在进程退出前排空或安全取消；转录写入失败必须可观测和重试。

### RF-10：统一 Provider Registry 和设置服务

Registry 至少描述：

- Provider ID、能力类型和支持模型。
- 系统模式与 BYOK 模式是否可用。
- 凭据字段和校验方式。
- 显式超时、重试政策和错误映射。
- 前端展示元数据。

设置更新只解密或验证发生变化的凭据。主题、模型偏好等非敏感设置不得因为旧密钥无法解密而更新失败。多个独立 Provider 需要验证时可以并行执行，但必须限制总超时。

### RF-11：生成前端 API 类型并收敛状态模型

- 从 FastAPI OpenAPI 生成 TypeScript 类型或客户端。
- 保留小型自定义 Transport，统一处理认证、超时、取消、错误解析和 API Origin。
- 合并 `RequestInit.headers` 时保留默认 Header，不允许调用方无意覆盖认证信息。
- 将会话状态改为判别联合或 Reducer，避免出现无 Token 却处于 connecting 等非法组合。
- 按行为拆分 `VoiceInterface` 和 `SettingsDrawer`，不引入新的全局状态框架。

### RF-12：升级关键 SDK

仅在 RF-01、RF-04、RF-07、RF-09 完成后执行：

1. 单独迁移 LiveKit Agents，并用真实语音冒烟测试验证事件、错误和断连行为。
2. 单独评估 OpenAI SDK 主版本，验证 SiliconFlow/OpenRouter 兼容调用。
3. Vite、Vitest 和 TypeScript 分开升级，每次保持构建和 E2E 可回归。
4. PostgreSQL 主版本升级不属于本轮优先事项。

## 7. 推荐 PR 拆分与依赖顺序

| 顺序 | PR 范围                                     | 前置条件       |
| ---- | ------------------------------------------- | -------------- |
| 1    | CI 真实性：真实 E2E、后端格式检查、迁移测试 | 无             |
| 2    | 分析任务表、状态 API、幂等后端 Worker       | PR 1           |
| 3    | 前端分析状态、失败重试和随时退出            | PR 2           |
| 4    | Synthetic 评估隔离                          | PR 2           |
| 5    | 真实鉴权与资源归属校验                      | PR 1           |
| 6    | BYOK 密钥分离、版本化和轮换                 | PR 5           |
| 7    | 删除 Redis/Celery 或正式接入任务            | PR 2 决策完成  |
| 8    | 移除 Chroma 和未使用 ML 依赖                | 推荐结果已固化 |
| 9    | 删除 Webpack/ui-lib/生成器残留              | PR 1           |
| 10   | uv 锁定、运行时统一、镜像瘦身               | PR 7–9         |
| 11   | Provider Registry 与 Agent 内部拆分         | PR 6、10       |
| 12   | LiveKit 等 SDK 大版本升级                   | PR 1–11        |

每个 PR 只解决一个可验证问题；数据库迁移、业务行为变化和依赖大升级不应合并成一个超大 PR。

## 8. 每个 PR 的统一验收模板

### 8.1 变更前

- 记录 `origin/main` SHA 和工作树状态。
- 写清允许修改的文件范围。
- 标记是否包含迁移、配置、外部 Provider 或用户数据影响。
- 对删除项执行仓库引用搜索和运行期调用确认。

### 8.2 自动验证

目标命令如下；RF-07 完成前允许使用仓库当前等价命令：

```bash
cd /path/to/EchoTalk
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test

cd /path/to/EchoTalk/apps/vite-app
pnpm exec playwright test

cd /path/to/EchoTalk/backend
uv sync --frozen --group dev
uv run ruff format --check .
uv run ruff check .
uv run pytest --cov --cov-report=term-missing

cd /path/to/EchoTalk
docker compose config --quiet
```

涉及数据库的 PR 还必须在隔离 PostgreSQL 中验证：

```bash
cd /path/to/EchoTalk/backend
uv run alembic upgrade head
uv run alembic current
```

### 8.3 人工验证

- Web 完成一轮语音对话并成功生成评估。
- 分析失败时页面显示可操作错误，可重试并可返回主页。
- BYOK 三类 Provider 分别验证成功、认证失败、超时和限流。
- 若影响原生路由，至少执行一次 iOS 真机完整链路。
- 检查日志中没有 Token、API Key、密文或用户文档正文泄露。

### 8.4 交付证据

- 提供执行过的命令和结果摘要。
- 提供迁移前后 schema 或运行拓扑差异。
- 提供已知未覆盖边界，不用“全部完成”替代证据。
- 合并后观察错误率、任务积压和分析耗时，再删除兼容开关。

## 9. 完成定义

本轮修复只有同时满足以下条件才能关闭：

- 生产路径不再使用固定 Mock 用户、固定 Token 或合成评估冒充真实结果。
- 任一会话分析都能查询到明确终态，不存在永久轮询。
- 分析任务具备幂等、重试、崩溃恢复和可观测错误。
- CI 包含真实 E2E、后端质量检查和数据库迁移验证。
- Python 与 Node 安装由锁文件复现，CI 和 Docker 主版本一致。
- 无业务调用者的 Redis/Celery、Chroma、Webpack 和模板代码已删除或有明确保留证据。
- Agent 和 Provider 配置具有清晰内部边界，新增 Provider 不需要跨多个重复枚举手工同步。
- 关键 SDK 升级独立完成并通过真实语音冒烟测试。

## 10. 明确不做

本轮不做以下事项：

- 不把 FastAPI 模块化单体拆成多个业务微服务。
- 不引入 Kubernetes、服务网格或分布式事件总线。
- 不将 Vite/React 重写为 Next.js。
- 不引入 LangChain 取代简单明确的 Provider Adapter。
- 不因组件较大而替换 Zustand 或引入另一套全局状态管理。
- 不在同一个 PR 中批量升级所有依赖。
- 不为了迁移方便清空数据库、废弃既有用户密钥或跳过回滚设计。

这些技术只有在用户规模、团队边界、吞吐量或可观测数据证明当前结构不足时，才进入新的架构决策。
