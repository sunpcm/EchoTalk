# RF-07 Python API/Agent 运行角色依赖验证

> 2026-11-04 最新补记：夜间任务真实隔离服务 C1 已由主控独立 APPROVED；
> C2 配对测量、最终组合两角色重建、真实服务/补充 HTTP 与清理已完成。见 §8 和
> [隔离服务验收](./RF-07-ISOLATED-SERVICES.md)。以下 A79 安装/验证结论保留历史时点。
> 完整门禁与最终 Review 以主控
> [本轮总报告](../../../.review/reports/overnight-product-runtime-20261103/report.md) 为权威。
>
> 历史状态：A79 已 Review APPROVED，单提交 `eaac89d0f4f008e77ba51b26a590412a03541acb`
> 已精确 fast-forward 本地 main，并通过完整 15 项 main 门禁。真实 Linux/Docker 镜像、
> Compose 服务、远端 CI 与外部运行链路仍未验证。
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
  子节点，已由主 Agent 原生重生成 lock/export 后自然消失；实施方未手写锁文件。
- `analysis_service.py` 对 `pronouncing` 使用 guarded optional import，并在不可用时回退到
  既有字母音素逻辑；该包原本不在项目声明或 lock 中。本轮按“不新增包”边界保持现状，不能
  把回退路径冒认为完整发音词典能力。

## 4. Docker 与 Compose 角色

`backend/Dockerfile` 接受 `BACKEND_ROLE`，默认 `api`。构建步骤先以 shell case 只接受
`api|agent`，非法值以非零退出；随后固定 uv 0.9.18 的现有镜像、执行 `uv lock --check`，并
运行：

```text
uv sync --frozen --no-default-groups --group "$BACKEND_ROLE" --no-python-downloads && \
    uv cache clean
```

2026-11-04 配方在原同步同一层追加cache清理，不改冻结安装参数与角色包集合；
主控已真实build并核安装完整性、动态库、导入、frozen export及服务，实减见§8。
该命令不会把 dev 混入任一角色。A79 历史 Compose 角色分配为：

- `echotalk-api`：`BACKEND_ROLE=api`
- `echotalk-analysis-worker`：`BACKEND_ROLE=api`
- `echotalk-agent`：`BACKEND_ROLE=agent`

三个 build 的 context 均为 `./backend`。其它 commands、env、ports、网络、depends_on、
volumes、认证和启动入口逐字保持，没有新增 Worker 组或服务。
现有 `backend/.dockerignore` 继续排除 `.env`、`.env.*`、`.review/` 与本地缓存，本轮未改
其保护规则。

## 5. 实施停写时待主 Agent 受控执行（冻结历史）

以下五项是 b/r0 实施方停写时的边界；主 Agent 随后已完成上述受控执行，结果见 §6。

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

## 6. A79 主 Agent 当前验收状态

- 主 Agent 使用既有 uv 0.9.18 离线原生工具重生成 `uv.lock` 与 `requirements.txt`，并完成
  dev 与 runtime 环境的 exact frozen/offline/no-python-downloads 同步。全部存活 package
  完整记录与全局 metadata 保持不变，唯一删除是 `passlib 1.7.4` 及其 extra 子树
  `bcrypt 5.0.0`；七个 LiveKit exact SDK pins 均保持。
- 受控导入验证的实际安装分布为 dev 104、API 55、Agent 83；runtime 环境按
  `api → agent → 合并 runtime` 串行切换后恢复 merged runtime 97。
- 主 Agent 已执行真实隔离导入、离线 OpenAPI/Provider metadata 检查、formatter、frontend10、
  OpenAPI schema、Provider metadata、Ruff、Compose 静态解析及专用 PostgreSQL backend
  全量测试。A79 后续独立 Review APPROVED，以单提交
  `eaac89d0f4f008e77ba51b26a590412a03541acb` 精确 fast-forward 本地 main，并完成完整
  15 项 main 门禁：969 Vitest/34 files、18 build-script、61 Fake API、8 类型生成器、
  148 E2E、586 backend/76.98% coverage，以及 schema/metadata/Ruff 等相关检查。
- 该具名提交是 receipt 中已完成的 A79 基线，相对本地 tracking reference
  `c704925bc9150d153fc951c2727e7472dad00d78` 领先 15 个提交；不声称远端实时查询或远端
  merge，本轮未 push 或部署，上述提交仅完成本地 main 精确 fast-forward。
- RF-05、RF-07、RF-09 与 RF-12 继续保持未勾选。Linux/Docker 镜像、Compose 实际服务、远端
  CI、真实 Provider/LiveKit、Worker 注册、设备与生产语音链路仍未验证。

## 7. b/r0 实施方停写时状态（冻结历史）

- 实施方未读取或写入任何 venv、uv cache、node_modules、dotenv、凭据或数据库内容，未执行
  formatter、测试、构建、安装、真实 Compose、镜像、服务、数据库、真实 CLI/Provider、
  Git commit/push/merge 或后台任务。
- 新 lock/export 尚未生成；角色安装包数、requirements 大小、覆盖率和镜像体积均不预填。
- API/Agent 的真实角色导入、恢复安装分布与锁记录尚未验证；CI 现有命令也没有在本轮执行。
- Linux/Docker 镜像、Compose 启动、远端 CI、Worker 注册、真实 LiveKit/Provider、语音链路、
  设备与部署均未验证。
- 本轮源码配方完成不单独完成 RF-05、RF-07、RF-09 或 RF-12。`pronouncing` 的 optional
  fallback 是现存边界，不在本轮新增依赖。

## 8. 2026-11-04 夜间任务：真实服务边界与最小缓存减法

本批基线 `0e09f5e7f3c16b5bb6562632880003e59369e372`；角色/依赖与上述七个LiveKit exact
pins不变，不改pyproject、uv.lock、requirements或原Compose。API和analysis-worker继续
使用api角色，语音Agent使用agent角色；本轮没有启动语音Agent注册或连接Provider。

主控已实测并独立批准C1：19项新offline runner、全新internal PG的SQL身份/空库/
pgx非空拒绝与rollback、真实base→c06、镜像源码/frozen export、真实uvicorn TCP HTTP
200/401/503、真实Worker缺Provider受控失败、预置过期任务attempt2合成成功及重启/重复
分析幂等。合成产物仅1assessment/1grammar、KnowledgeState=0，不扩大为真实学习效果。

三个Worker实际exit137（docker stop5秒后强杀），API exit0，四进程均已停止。
优雅SIGTERM退出尚未证明，作为运维遗留；不把强杀退出改写为成功0或143。本轮不修业务
入口/重试/租约。internal网络下宿主18800不可达仍false；容器loopback真实HTTP已验，
未增加外网bridge。详细事实/证据与清理边界见隔离服务文档。

首轮main before证据完整保留；收益仅依据后来格式冻结后的同版measure.py独立重测配对，
同arm64/基础digest/锁、每份153文件，仅Dockerfile缓存清理不同：API
1,545,036,632→1,542,251,419bytes，实减2,785,213bytes/0.1802684%；Agent
1,936,003,477→1,930,721,426bytes，实减5,282,051bytes/0.2728327%。
缓存120,456/398,460KiB→各4KiB不能当镜像实减，未采集inode证据，不断言差异原因。
两角色 `/usr` 仍各971,248KiB，保留gcc/libpq-dev/ffmpeg和原单阶段结构。
完整ID/基础digest/层/目录/两套计时定义见[Linux记录](./RF-07-LINUX-RUNTIME.md)。

cache-only before/after包版本集合逐角色相同（API55/Agent83），dev absent、各153文件/
frozen export、ldd6/79无missing、ffmpeg和三次导入均通过；新计时含ps监督开销，
不和首轮main适配样本混算，也不宣称cold start提速。

最终集成输入新增后端内容后，主控已从154文件独立快照重建两角色：

- API `sha256:eecbd997b19725256b7391eb1d4c068025f08bef41df62d4aee4eec9e8111cde`，
  1,542,284,611 bytes。
- Agent `sha256:ba556d437c23d178e2eeea887137368ccadd15d87ca85a5c0bb6e1766ebf2e9e`，
  1,930,754,618 bytes。

最终各154文件SHA/frozen/dev absent、55/83包版本与after一致，动态库/ffmpeg/三次导入
通过。最终Agent首样本34,594.359ms仍保留，不用于cache-only收益论证。
最终新PG/真实TCP HTTP/Worker过期任务与幂等已复验，仍为Worker137/API0、宿主18800false。
补充只读GET验证七桶/2completed、limit1两页、换窗cursor422、23小时DST、非法时区422、
匿名401、API退出0；最终容器与网络已按ID清理，scope清点为0容器/0网络（含产品PG）。

首次weekly-http批次因主控helper把stop字典当整数误报失败；原服务通过/HTTP断言通过/
stop0及首败回执保留，r1b修helper后的HTTP与cleanup全绿另列，未改产品代码或算mutation。
证据 `R/runtime/final-measure-r1/receipt.json`、`final-integrity-r1/result.json`、
`final-services-r1/`、`final-http-recheck-checks-r1b/summary.json`，其中
`R=.review/reports/overnight-product-runtime-20261103`。

主控排除根format/E2E的16项通过；双浏览器最终174项/exit0，173clean+1flaky，新增weekly8项
双浏览器通过。settings goto30秒超时多次retrypass，根因未定，不能写174全clean。
根format前次失败，待owner全部停写后主控统一原生格式复核；完整15项与最终Review以
`R/report.md`为权威，不能提前宣布全绿。本轮native/远端CI/真实IdP/Provider/LiveKit/
语音/原Compose/设备/部署仍未验证，Worker优雅终止与宿主18800边界保留。
