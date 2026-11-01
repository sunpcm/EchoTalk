# RF-07 Python API/Agent 运行角色依赖验证

> 状态：A79 b/r0 源码实施完成，停在 Review。`uv.lock`、`requirements.txt`、受控角色环境
> 安装、全量门禁、Linux/Docker 镜像与外部运行链路尚未由实施方验证。
> 起点：`codex/rf07-dependency-roles@8efb92387ac0bf3b9489a20b6080d78d6ec91ab4`。
> 日期：2026-11-01。

## 1. 目标与边界

本轮只把后端 Python 依赖从单一默认运行时拆为项目公共依赖与 `api`、`agent`、`dev` 三组，
并让同一 Dockerfile 按显式角色生成 API 或 Agent 运行时。变更范围限定
`backend/pyproject.toml`、`backend/Dockerfile` 与 `docker-compose.yml`；文档更新只记录契约
和当前证据边界。

本轮不升级或新增包，不改变原有 requirement 文本、extra 或版本范围，不修改业务代码、
HTTP、readiness、认证、迁移、seed、Worker、服务、系统工具、镜像基础版本或真实 Provider。
七个 LiveKit exact pins 保持：

- `livekit==1.1.2`
- `livekit-api==1.1.0`
- `livekit-agents==1.4.3`
- `livekit-plugins-deepgram==1.4.3`
- `livekit-plugins-cartesia==1.4.3`
- `livekit-plugins-openai==1.4.3`
- `livekit-plugins-silero==1.4.3`

## 2. 依赖分配

API 与 Agent 共用、由 `[project].dependencies` 声明：

- `sqlalchemy[asyncio]`
- `asyncpg`
- `pydantic`
- `pydantic-settings`
- `python-dotenv`
- `openai`
- `livekit-api`
- `cryptography`
- `httpx`

`api` 组：

- `fastapi`
- `uvicorn[standard]`
- `alembic`
- `python-jose[cryptography]`

`agent` 组：

- LiveKit RTC/Agents 与上述四个现有插件

`dev` 组保持 `ruff`、`pytest`、`pytest-asyncio`、`pytest-cov` 四项。当前
`tool.uv.default-groups` 为 `api/agent/dev`，因此本地无 flag 安装仍得到完整开发环境。
CI 原有 `--group dev` 无需改成同义别名；兼容 `requirements.txt` 继续导出
`api + agent` 两个运行组并排除 dev。

## 3. 真实消费者与减法证据

- API 入口 `backend/main.py`、路由与服务实际导入 FastAPI；`auth.py` 实际导入
  `python-jose` 与 httpx；`database.py` 与 ORM/查询路径实际使用 SQLAlchemy async 与
  asyncpg。
- `backend/workers/analysis_worker.py` 通过 PostgreSQL session、analysis jobs 与
  provider-backed analysis service 运行，和 API、显式 seed、Alembic/迁移工具共同使用
  `api` 运行组；这是一项运维配方边界，不表示 analysis-worker 导入 FastAPI。
- `backend/livekit_agent/bootstrap.py`、`agent.py`、`error_mapper.py`、
  `job_orchestrator.py` 实际导入 `livekit.agents`；`plugin_factory.py` 实际导入
  deepgram/cartesia/silero/openai 四个插件。Agent 的真实 package-main 入口由
  `python -m livekit_agent` 捕获，普通导入不得启动 worker。
- API 的 `routers/sessions.py` 与 `services/call_leases.py` 实际导入 `livekit.api`，所以
  `livekit-api` 留在 project common，而 Agent 专用 RTC 与插件只在 `agent` 组。
- `passlib[bcrypt]` 在全部 tracked backend 生产、测试与脚本中零消费者。修改前 lock 中只有
  项目根到 `passlib[bcrypt]` 的直接入边，以及 `passlib` 自身 optional extra 到 `bcrypt`
  的边；没有其他 incoming edge。本轮据此只删除这一个死直接依赖。`bcrypt` 是它的 extra
  子节点，应由主 Agent 原生重生成 lock/export 后自然消失，实施方不手写锁文件。
- `analysis_service.py` 对 `pronouncing` 使用 guarded optional import，并在不可用时回退到
  既有字母音素逻辑；该包原本不在项目声明或 lock 中。本轮按“不新增包”边界保持现状，不能
  把回退路径冒认为完整发音词典能力。

## 4. Docker 与 Compose 角色

`backend/Dockerfile` 接受 `BACKEND_ROLE`，默认 `api`。构建步骤先以 shell case 只接受
`api|agent`，非法值以非零退出；随后固定 uv 0.9.18 的现有镜像、执行 `uv lock --check`，并
运行：

```text
uv sync --frozen --no-default-groups --group "$BACKEND_ROLE" --no-python-downloads
```

该命令不会把 dev 混入任一角色。Compose 只改三个后端 build：

- `echotalk-api`：`BACKEND_ROLE=api`
- `echotalk-analysis-worker`：`BACKEND_ROLE=api`
- `echotalk-agent`：`BACKEND_ROLE=agent`

三个 build 的 context 均为 `./backend`。其它 commands、env、ports、网络、depends_on、
volumes、认证和启动入口逐字保持，没有新增 Worker 组或服务。
现有 `backend/.dockerignore` 继续排除 `.env`、`.env.*`、`.review/` 与本地缓存，本轮未改
其保护规则。

## 5. 待主 Agent 受控执行

1. 使用既有 uv 0.9.18 离线原生工具重生成 `backend/uv.lock`，逐包审查 version/hash 与依赖
   edge；除 `passlib`/其 `bcrypt` extra 子树外，必须证明全部存活锁记录保持，不能趁机升级。
2. 从新 lock 原生导出 `backend/requirements.txt`，保持合并 `api+agent`、排除 dev，并与 CI
   的 frozen export 精确比较。
3. 在两个授权环境串行验证：dev 环境同步全部组；runtime 环境按 `api → agent → 合并 runtime`
   切换，每一步使用 exact frozen/offline/no-python-downloads，异常时先恢复合并 runtime。
   中间角色环境不跑完整测试，最终检查实际安装分布。
4. 执行真实隔离导入、离线 API OpenAPI/current metadata 检查、Agent SDK/四个插件与 package
   main 导入；使用合成 Settings，禁止 dotenv/config 副作用、socket 与 worker 启动。
5. 运行 formatter、frontend10、OpenAPI schema、Provider metadata、Ruff 与专用 PostgreSQL
   上的 backend 全量 pytest；检查 Compose 静态解析并独立审查 diff。

## 6. 当前未验证状态

- 实施方未读取或写入任何 venv、uv cache、node_modules、dotenv、凭据或数据库内容，未执行
  formatter、测试、构建、安装、真实 Compose、镜像、服务、数据库、真实 CLI/Provider、
  Git commit/push/merge 或后台任务。
- 新 lock/export 尚未生成；角色安装包数、requirements 大小、覆盖率和镜像体积均不预填。
- API/Agent 的真实角色导入、恢复安装分布与锁记录尚未验证；CI 现有命令也没有在本轮执行。
- Linux/Docker 镜像、Compose 启动、远端 CI、Worker 注册、真实 LiveKit/Provider、语音链路、
  设备与部署均未验证。
- 本轮源码配方完成不单独完成 RF-05、RF-07、RF-09 或 RF-12。`pronouncing` 的 optional
  fallback 是现存边界，不在本轮新增依赖。
