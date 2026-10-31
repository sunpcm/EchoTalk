# RF-05 Redis/Celery 死基础设施减法验证

> 对应任务：A71 / RF-05
> 状态：A71 已独立 Review APPROVED，以单提交 `dd0fbc0` 精确 fast-forward 到本地 main；
> 完整测试、集成与 A72 最终复验均已完成。
> 日期：2026-11-01。

> 后续状态：A72 已继续完成课程语料离线迁移与 Chroma 引用清理，并以 `b2b02b3` 完成最终
> 复验。本文件第 1-3 节保留 A71 当时事实；当前结论见
> [RF-05 版本化离线课程推荐验证](./RF-05-OFFLINE-CURRICULUM.md)。

## 1. 真实调用审计

对全部已跟踪生产、脚本和 Compose 引用做了定向审计，结论如下：

- 真实会话分析入口为
  `backend/routers/sessions.py → backend/services/analysis_jobs.py →
backend/workers/analysis_worker.py`。结束会话创建 PostgreSQL `AnalysisJob`，Worker 原子领取、
  执行、有限重试并恢复陈旧运行任务。
- 真实课程推荐入口为
  `backend/routers/curriculum.py → backend/services/rag_service.retrieve_materials()`。
  ChromaDB 仍是课程推荐的业务依赖。
- `backend/workers/report_tasks.py::generate_weekly_report` 没有生产调用者，只返回
  `status: skeleton`；`backend/workers/celery_app.py` 仅被已删除的 Compose Celery 命令引用。
- 前端测试中的 `redis` 字符串是 API 错误聚合夹具，不对应服务消费，未修改。

## 2. 本轮变更

- 从 `backend/pyproject.toml` 删除唯一的 `celery[redis]` 直接依赖。
- 删除 `backend/workers/celery_app.py` 与 `backend/workers/report_tasks.py`，将
  `backend/workers/__init__.py` 说明改为 PostgreSQL 持久化分析任务。
- 从 `backend/config.py` 删除 `REDIS_URL` 与 `USE_MOCK_CELERY`，其他 Mock 开关不变。
- 仅修正 `backend/services/analysis_service.py` 的过期 Celery 头注释，并从
  `backend/tests/test_call_leases.py` 删除 dead `REDIS_URL` fixture 参数；测试与断言未删除。
- 从 `docker-compose.yml` 移除 `echotalk-redis`、`echotalk-worker`、二者相关
  Redis 环境/依赖及 `redis-data` 卷声明；保留 PostgreSQL、API、Agent、Chroma、Web 和
  `echotalk-analysis-worker`。
- 同步修正 README、仓库指南和架构文档中直接受影响的拓扑、依赖和分析 Worker 描述。

实施停写后，主 Agent 已按 uv 0.9.18 离线配方完成依赖生成与真实审计：

- `backend/uv.lock` 由 192 包变为 179 包，删除 amqp、billiard、celery、
  click-didyoumean、click-plugins、click-repl、kombu、prompt-toolkit、redis、tzdata、
  tzlocal、vine 与 wcwidth 共 13 包。
- 全部存活包记录逐值相同，7 个 LiveKit exact SDK 保持原版本。
- `backend/requirements.txt` 已从新 lock 使用
  `uv export --frozen --no-dev --no-emit-project --no-header --no-annotate` 原生重新导出。
- `cp00/.review/rf07-a37-dev-venv` 与 `cp00/.review/rf07-a37-runtime-venv` 已离线 frozen
  同步，包数分别由 172/165 变为 159/152。

实施方没有手写 lock/export 产物。

## 3. 保留能力

- PostgreSQL 分析 Job 的创建、原子领取、幂等结果、有限重试、失败状态和陈旧任务恢复。
- API 分析状态查询、手动重试、课程推荐及全部 LiveKit 功能。
- ChromaDB 与现有课程 RAG 用例；本轮不迁移向量检索。
- 周报作为未实现产品功能保留在待办中；删除 skeleton 不等于完成周报。

## 4. 检查状态

依赖生成、lock 删除/存活版本审计、requirements 导出与两个环境 frozen 同步已由主 Agent
完成。按共享锁权限限制，实施轮未执行 formatter、测试、build、Compose 配置校验、服务或 Git
写操作；以下门禁已由 A72 main final receipt 核销：

- 固定入口 `cross-platform-local-check.py b STEP` 经项目 `ev.sh` 留证。
- frontend10、OpenAPI schema、Ruff、专用 PostgreSQL backend pytest。

Compose 静态校验未在该 main receipt 中单独列示；生产分析 worker 接线、课程推荐和真实
PostgreSQL 分析测试由完整后端测试树及独立 Review 覆盖。

不能把未执行的检查、旧日志或 cached 结果当作通过，也不能把依赖产物审计当作完整测试或
Review APPROVED。

## 5. 剩余边界

RF05 整项仍保持未勾选。Chroma 业务语料迁移和重型 ML 依赖替换已由 A72 完成；镜像/CI
体积、冷启动比较、当前远端树 CI 和真实外部链路仍未完成或未验证。

## 6. A72 当前结论

- 10 条教学种子已迁入 `backend/data/teaching_materials.json`；检索不再依赖 Chroma、embedding、
  网络、环境变量或数据库。
- `echotalk-chroma`、Chroma 环境变量/健康依赖/volume 以及旧 seed 写入链路已从代码和
  `docker-compose.yml` 删除；未操作现有容器、服务、卷或持久化数据。
- `chromadb`、`sentence-transformers`、`librosa`、`soundfile`、`scikit-learn` 已从
  `backend/pyproject.toml` 删除直接声明。
- 主 Agent 已用 uv 0.9.18 离线原生重生成 lock/export 并完成受控环境 frozen sync：lock
  179→107、删除 72 条跨平台记录；本机 dev/runtime 安装包 159→106、152→99，各删除 53 包；
  全部存活 package 完整记录逐值相同，7 个 LiveKit exact SDK 保持。
- 完整后端首次运行 565 passed/1 failed，唯一失败是测试 expected 漏掉 restaurant 次级 tag；
  r1 已修正该 expected，并收窄空白包裹等级的错误放宽。最终 main 复验为 frontend10、
  917 Vitest、148 E2E、566 backend、80.10% coverage、OpenAPI schema 与 Ruff 全绿，
  A72 已独立 Review APPROVED 并集成。镜像/CI 体积和冷启动比较仍待执行，RF05 整项继续
  保持未勾选。
