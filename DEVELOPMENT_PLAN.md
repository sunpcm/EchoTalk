# EchoTalk AI 口语系统 - 全栈开发落地计划

## 一、 开发环境与工程规范

- **硬件协同**：在 Mac 上使用 VS Code Insiders，通过 Remote-SSH 连接到本地 Ubuntu 服务器 (`192.168.50.50`) 进行开发。Ubuntu 负责所有算力与容器运行，Mac 负责纯粹的代码编写与 GUI 交互。

### AI 结对编程

- **Claude Code (终端 Agent)**：负责后端 `FastAPI` 骨架、数据库表结构生成、编写基础 CRUD 接口、配置基础设施（`Docker`/`Celery`），并执行自动化 `curl` 验证和脚本测试。

- **GitHub Copilot (侧边栏 & 行内)**：负责 Next.js 前端页面的细粒度编写、`Tailwind` 样式微调、Zustand 状态管理，以及复杂的局部算法推导（如 BKT 具体计算公式）。

### 工程底线

- **Monorepo 架构**：前端 Next.js 15 (TS/React)，后端纯 FastAPI (Python)，**绝不引入** Node.js 后端服务。保护现有的 Login 与用户管理模块。

- **i18n 优先**：前后端从第一行代码起预留多语言接口（如使用 i18n key 而非硬编码中文文案）。

- **鉴权旁路 (Mock Auth)**：现阶段全局注入 `get_current_user` Mock 中间件，返回固定测试 `user_id`，绕过真实鉴权，预留 `TODO` 注释。

- **代码门禁**：所有代码提交前必须通过 Husky 拦截器（Pre-commit hook），确保 Linting 和类型检查完全通过。

## 二、 阶段拆解与执行里程碑

### Phase 0：基础设施与脚手架组装

**目标**： 搭建坚实的工程底座，让前后端能互相“听懂”对方。

- **后端 (Python)**：配置虚拟环境，安装 `FastAPI`、`SQLAlchemy`、`Alembic` 等基础依赖。编写 `docker-compose.yml` 启动 PostgreSQL 和 Redis。

- **前端 (Next.js)**：在 Monorepo 对应目录下配置好 `TailwindCSS`、`shadcn/ui`，并引入 i18n 基础库（如 `next-intl`）。

- **工程化**：配置好前后的 Lint 规则（`ESLint`/`Prettier`, `flake8`/`black`）和 Husky pre-commit 钩子。

### Phase 1：基础对话管线 (核心骨架)

**目标**： 跑通端到端的实时语音对话（STT -> LLM -> TTS），延迟控制在 800ms 内。

**后端任务**：

- 实现 `users`, `sessions`, `transcripts` 数据表与 Alembic 迁移。
- 实现带 Mock Auth 的 Session CRUD 接口（`/api/sessions` 等）。
- 编写 LiveKit Agent 桥接逻辑，跑通 Free 管线（Deepgram Flux + LLM + Cartesia Sonic 3）。

**前端任务**：

- 搭建核心练习页 `VoiceInterface`，集成 `@livekit/components-react`。
- 实现录音波形可视化与实时转录文本展示（`TranscriptPanel`）。

### Phase 2：发音评估与知识追踪 (业务深度)

**目标**： 实现音素级的精准发音反馈，并引入 BKT 算法追踪用户掌握度。

**后端任务**：

- 配置 Celery 异步队列，将会话结束后的数据抛入后台处理。
- 实现 Needleman-Wunsch 音素对齐算法，计算发音得分并写入数据库。
- 实现 BKT 知识追踪更新逻辑（更新 `knowledge_states` 表）。

**前端任务**：

- 开发 `PhonemeVisualizer` 组件，根据后端返回的 JSON 渲染音素红绿高亮。
- 开发 `SkillTree` 组件展示技能掌握度进度条。

### Phase 3：情绪感知与多模态交互 (体验升维)

**目标**： 引入原生 S2S 情感对话与数字人视觉反馈，打造沉浸式陪伴感。

**后端任务**：

- 接入本地音频特征提取（`librosa`）进行认知负荷分析，并将情绪指令注入 LLM Prompt。
- **Premium 专属**：接入 Hume EVI 3 实现原生语音到语音管线。

**前端任务**：

- 集成 `Sync.so` 实现数字人实时唇形同步 (`AvatarDisplay` 组件)。
- 处理音视频同步的时间戳对齐问题。

### Phase 4：RAG 与自适应学习路径 (生态闭环)

**目标**： 根据用户的 BKT 状态，动态推送符合 Krashen i+1 难度的练习场景。

**后端任务**：

- 本地启动 ChromaDB 向量数据库，构建包含 500+ 条标签语料的基础库。
- 实现 `rag_service` 检索逻辑，结合 BKT 弱项生成下一次对话的 System Prompt。
- 通过 Celery Beat 和 LLM 批处理生成每周多维学习报告。

**前端任务**：

- 开发学习报告展示页面。
- 首页动态渲染由 RAG 推荐的下一次练习场景。

## 三、 阶段交付物标准

在每一个 Phase 完成后，必须产出以下交付物，方可进入下一阶段：

- **代码质量验证**：
  - 所有代码无缝通过 Husky 钩子（无 Lint 报错，无 TypeScript 类型错误）。
  - 核心接口必须通过 `验收测试手册.md` 中的 `curl` 或集成脚本测试，返回 `HTTP 200`。

- **强制文档输出**：让 Claude Code 在该阶段结束前自动生成以下两份中文文档：
  - `docs/PHASE_X_TECH_STACK.md`：记录本阶段新增的目录结构、核心文件职责以及使用的技术栈清单。
  - `docs/PHASE_X_MANUAL_TEST.md`：详细记录本阶段的人工测试步骤、前置条件、需要验证的 i18n 字段以及可能的排障方法。
