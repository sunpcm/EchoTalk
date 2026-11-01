<div align="center">
  <img src="docs/assets/branding/echotalk-app-icon.svg" width="128" height="128" alt="EchoTalk Logo" />
  <h1>EchoTalk — AI 英语口语练习平台</h1>
</div>

EchoTalk 用实时 AI 对话帮助练习英语口语：选择推荐场景或导入 DocTalk 文本，
通过 LiveKit 语音练习，结束后查看转录、发音与语法反馈、技能掌握度及学习进度。
基础轨使用服务端 Provider 配置；自定义轨支持 BYOK（自备密钥），仍受账号权限与配置验证约束。

## 当前状态

文档核对的代码基线为 `e35d89b`（2026-11-01）。功能和验收事实见
[当前状态与变更决策](docs/PROJECT_STATUS.md)，未完成工作只维护在 [TODO](TODO.md)。

| 平台              | 当前边界                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Web               | React/Vite 产品客户端，已有本地自动化验证记录；真实 IdP、Provider、完整语音及生产验收单列。                               |
| iOS               | 同一前端的 Capacitor 工程与构建/同步入口；代码存在不等于真机、媒体或分发通过。                                            |
| macOS             | `tools/macos-m1-native-probe` 为独立 auth-only 探针，已有安装包真实冷暖登录回跳、取消及迟到回跳拒绝证据；尚非产品客户端。 |
| Android / Windows | 后续扩展方向，当前无正式交付；平台识别分支不代表平台支持。                                                                |

macOS M1 尚欠最小 API/媒体接线、真实 Provider **5 分钟 5 轮**和设备测试；
正式 `apps/vite-app/src-tauri/` 仍属 M2 计划，不能将原生认证通过写成 M1 整体完成。
仅面向主流系统、浏览器和工具链；未来具体最低 OS 尚未冻结，不承诺 macOS 14 兼容。
历史计划中的候选最低版本须以新的支持决策及设备证据为准。

## 架构与目录

复用业务、UI、API 客户端和状态，通过薄平台适配隔离原生 SDK、登录、安全存储、
权限、媒体设备与生命周期。未来 Android/Windows 沿此边界扩展；不提前实现新平台或抽大型 shared-core。
当前适配尚不完整：iOS 有原生生命周期接线，Tauri 仍走 Web 生命周期分支；认证探针尚未接共享 UI。

```text
apps/vite-app/                  React + TypeScript + Zustand，共享产品 UI
  src/platform/                平台识别、地址与生命周期适配
  ios/                         Capacitor iOS 工程
backend/                       FastAPI + SQLAlchemy / Alembic
  livekit_agent/               LiveKit Agent：STT → LLM → TTS
  workers/analysis_worker.py   PostgreSQL 持久化分析任务 Worker
  services/                   分析、BKT 知识追踪、课程与设置等业务
  data/                       版本化离线教学语料
packages/configs/              共享工具配置
tools/macos-m1-native-probe/    可行性认证探针，非正式桌面工程
docs/                         架构、契约与验收资料
```

API、Agent 和分析 Worker 是独立进程，共用 PostgreSQL；当前不依赖 Redis/Celery。
Provider 支持 Deepgram STT、Cartesia TTS，以及 SiliconFlow / OpenRouter LLM。
Provider 目录存在、密钥拨测成功或 readiness 返回 200 都不证明真实语音可用。

## 最小本地开发

以下步骤用于本机开发；真实服务、设备和分发需单独验收。
准备 Python **3.12**（`>=3.12,<3.13`）、uv **0.9.18**、Node **22**、pnpm **10.26.0**，
以及独立本地 PostgreSQL 15 开发实例/空库、可达的 LiveKit 与 Provider 服务。
不要复用应用、QA、生产、其他 lane 或自动化专用测试库。

### 1. 冻结安装与配置

从仓库根执行；后续命令中的 `cd backend` 也均相对仓库根。

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
cd backend
uv sync --frozen --group dev --python 3.12 --no-python-downloads
cd ..
# 已有配置先备份；否则从认证骨架开始
if [ -f .env ]; then
  cp -p .env ".env.backup.$(date +%Y%m%d%H%M%S)"
else
  cp .env.example .env
fi
```

后端 `config.py` 与 Agent 启动入口读取**仓库根 `.env`**，不是 `backend/.env`；
Vite dev 同样读取根目录。`.env.example` 只是认证/加密骨架，不包含全部运行配置。
编辑根 `.env`，补齐以下值（占位符必须替换）：

```dotenv
DATABASE_URL=postgresql://local_user:local_password@127.0.0.1:5432/echotalk_local_dev
AUTH_MODE=dev
DEV_AUTH_TOKEN=<随机本地开发token>
VITE_AUTH_MODE=dev
VITE_DEV_AUTH_TOKEN=<与DEV_AUTH_TOKEN完全相同>
CREDENTIAL_ENCRYPTION_KEYS={"local-v1":"<独立生成的Fernet密钥>"}
ACTIVE_CREDENTIAL_KEY_VERSION=local-v1
LIVEKIT_URL=wss://<你的LiveKit主机>
LIVEKIT_API_KEY=<LiveKit服务端key>
LIVEKIT_API_SECRET=<LiveKit服务端secret>
DEEPGRAM_API_KEY=<STT密钥>
CARTESIA_API_KEY=<TTS密钥>
DEFAULT_LLM_PROVIDER=siliconflow
SILICONFLOW_API_KEY=<LLM密钥>
DEFAULT_LLM_MODEL=<该Provider可用的模型ID>
```

LLM 二选一：使用 OpenRouter 时设 `DEFAULT_LLM_PROVIDER=openrouter`，填写
`OPENROUTER_API_KEY` 并选择其可用模型。凭据只保存在本地，不写入 Git 或日志。
可在 `backend` 执行以下命令分别生成 dev token 和独立加密密钥，再安全填入配置；不要复用示例密钥：

```bash
uv run --frozen python -c "import secrets; print(secrets.token_urlsafe(32))"
uv run --frozen python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

默认 `CALL_LEASE_MODE=disabled`；Cloud 单端占用尚未完成共享通话接线，不要为试通语音擅自开启。

### 2. 初始化隔离开发库

先创建归自己所有的空开发库，并确认根 `.env` 的 `DATABASE_URL` 指向它。
历史初始迁移含 `DROP ... CASCADE`：**不能直接对任意现有库升级**；有数据时先备份、审查迁移并单独制定方案。
以下仅用于已核实的隔离空库，在 `backend` 执行：

```bash
uv run --frozen alembic upgrade head
uv run --frozen alembic current
# 显式写入参考技能；该CLI不读.env，必须单独传入同一开发库URL
DATABASE_URL='postgresql://local_user:local_password@127.0.0.1:5432/echotalk_local_dev' \
  uv run --frozen python -m seed_reference_data
# 只校验离线课程目录并输出摘要，不写数据库
uv run --frozen python -m scripts.seed_corpus
```

### 3. 分终端启动

每个新终端先进入仓库根，再执行对应命令；`uv run --frozen` 明确选择后端项目环境。

```bash
# 终端一：API，仅监听本机
cd backend
uv run --frozen uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

```bash
# 终端二：语音 Agent；启动可能涉及模型资源，须先具备相应依赖/网络条件
cd backend
uv run --frozen python -m livekit_agent dev
```

```bash
# 终端三：持久化分析 Worker，否则结束后的分析任务不会被消费
cd backend
uv run --frozen python -m workers.analysis_worker
```

```bash
# 终端四：Vite HTTPS 客户端，默认仅监听127.0.0.1:5173
pnpm dev:vite
```

访问 `https://localhost:5173`，按本地开发证书配置完成信任并授权麦克风。
新账号默认免费且使用自定义轨：首次练习前须在设置界面选择 Provider、填写 STT/LLM/TTS 密钥并验证保存；
免费账号不能关闭自定义模式，仅填写服务端 `.env` 不等于该账号可使用基础轨。
Vite 将 `/api` 代理至 `http://localhost:8000`，按 `LIVEKIT_URL` 配置 WebSocket 代理；
真实语音仍依赖 WSS、ICE/TURN 可达性、有效 Provider 与 Agent 注册，不能靠 Mock 开关推定通过。
若浏览器直接跨源访问 API，需将 `https://localhost:5173` 加入后端 `CORS_ORIGINS` JSON 数组；不要使用通配符。

API 存活探测为 `http://localhost:8000/api/health`；它不检查真实语音。
接口定义见 [canonical OpenAPI](backend/openapi.json)，运行中的交互文档为 `http://localhost:8000/docs`。
[Compose 配置](docker-compose.yml)是备选本地集成入口，迁移与参考数据仍需独立处理；不代表一键真实语音或生产部署。

## 验证入口与安全边界

完整测试树、解释器、专用测试库与证据规则见 [Agent 评审手册 §2/§3](docs/agent-review-loop.md)。
常用入口如下；后端测试必须先绑定获准的独立测试库，禁止回退根 `.env` 的开发/应用库：

```bash
# 仓库根：前端质量与构建
pnpm lint && pnpm typecheck && pnpm format:check && pnpm build
# apps/vite-app：真实Vitest、Fake API浏览器E2E
pnpm test
pnpm test:e2e
# backend：仅在测试环境/数据库已显式隔离后执行
uv run --frozen python -m pytest --cov=. --cov-report=term-missing
```

Fake API E2E 不代替真实 IdP、LiveKit/Provider、设备或生产验收；各类验收证据须分别记录。
开发仅显式 dev token；生产只用 OIDC，校验 issuer/audience/JWKS，失败关闭。
原生客户端是 public client，不含 client secret；服务端密钥、用户 Token 和 BYOK 密文不得进入前端包或诊断日志。
构建与 dev 配置隔离：平台构建入口 `pnpm build:web` / `pnpm build:ios` 读取 app 目录配置，
输出隔离在 `dist/<platform>/<mode>`；根 `.env` 不能直接当发布配置，生产包不得含 dev token。

## 文档导航

- [文档总索引](docs/README.md) · [当前状态](docs/PROJECT_STATUS.md) · [唯一待办清单](TODO.md)
- [跨平台架构](docs/CROSS_PLATFORM_ARCHITECTURE.md) · [MVP 重构方案](docs/MVP_REFACTORING_REMEDIATION_PLAN.md)
- [macOS MVP 计划](docs/MACOS_MVP_DEVELOPMENT_PLAN.md) · [原生认证验证及未验边界](docs/verification/cross-platform/MACOS-M1-NATIVE-AUTH.md)
- [认证生命周期](docs/CROSS_PLATFORM_AUTH_LIFECYCLE.md) · [通话占用契约](docs/CROSS_PLATFORM_CALL_LEASE.md)
