# Compose 启动门禁方案 B（CPB）— 本机验收与边界记录

> 日期：2026-11-15；任务包：CPB（R2-14 Compose 启动门禁方案 B：仅配置 + 有意义契约测试）；
> 分支 `codex/compose-startup-gates-20261115`；父依次合 ACT source `5e478b8`、DASH source `89421da`、DASH main `543e266` 后当前 merge HEAD
> `da6be7688509021267b4e3a7fb73575d4a10f45e`（已亲核 clean；源码 `git diff --stat 89421da` 仅 Compose + 新增 5 pytest）。
> 本文件记录用户 B 裁定、两路径源码、R0→R1 精确化、三处有效变异、前序 16 门禁与最新全量 17 门禁、未验证边界；
> 不冒充已发布 main/CI，不预填 CPB PR 编号或发布终点 SHA。

## 范围与最终改动

用户 2026-11-15 明确采用方案 B：只落地配置与有意义的契约测试，不执行迁移/整栈/部署。唯一两路径源码：

1. `docker-compose.yml`（相对 ACT source `5e478b8` 为 +42/-1）：新增一次性迁移服务 `echotalk-migrate`
   （api 角色、`alembic upgrade head`、`restart=no`、先等 compose 内 postgres healthy）；api/agent/analysis-worker
   依赖 `echotalk-migrate: service_completed_successfully`；api 新增匿名 `GET /api/health` healthcheck
   （镜像现成 Python 标准库 urllib、有限 timeout）；web 依赖 api `service_healthy`。保留 `/api/health/ready`
   认证语义与原服务 command/env/dns/网络/端口/volume/auth fail-closed 语义。
2. `backend/tests/test_compose_startup_contract.py`（新增，5 用例）：纯静态契约测试，stdlib subprocess 调真实
   `docker compose config --format json --no-env-resolution`；显式 `--env-file` 指向测试内临时生成的
   `synthetic-vars.txt`（非 `.env` 名）；清洁环境；health 脚本仅 `compile`/AST 静态验证、绝不 exec 或发起连接。

未改 Dockerfile、依赖/锁、后端路由/DB 模型、迁移文件、其他包。整个 CPB 包源码改动仅 `docker-compose.yml` 与新增
`backend/tests/test_compose_startup_contract.py` 两路径；"源码/锁零改"仅指本次文档收口（4MD）阶段不再改动源码/锁。

## 事实时序

- 实施 R0（report-r0）：两文件落地；契约测试首次即 5/5 通过（0.60s）；native config
  `docker compose --env-file ... config --quiet --no-env-resolution` exit 0。
- 独立评审 CHANGES REQUESTED R1（feedback-r1）：P1 health 契约仅子串断言无法识别 wrong-path；
  P2 `docker-compose.yml` 长行 format 失败。
- 实施 R1（report-r1）：P1 将 health 契约升级为 stdlib AST + `urllib.parse` 精确抽取 `urllib.request.urlopen`
  实际目标，校验完整端点（http/localhost/8000/`/api/health`/无 query/无 fragment）+ 匿名请求 + 有限正 timeout，
  仅 compile/AST 不 exec、不发网络；P2 用仓库既有 Prettier 仅重排长行。生产 URL 当前正确，无需业务改动。

## 验收结果（父 Harness 亲跑，未发布）

前序（R1 阶段）16 门禁全 success；最新全量（文档收口 validated-evidence）17 门禁全 success，二者为不同阶段、不合并。
最新全量 17 门禁计数：

- Vitest 1260 passed / 55 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 962 passed / 3 warnings / 80.63%
- 完整 E2E 258（Chromium 129 / WebKit 129，retry/skip/flaky 0）

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。实施 Agent 自测仅契约测试、native config、Ruff、Prettier；
前序 16 门禁、最新 17 门禁与私有变异由父 Harness 在本 lane 实际执行，实施 Agent 未运行浏览器/PG/三树/变异。

最终组合 E2E `integrateddashfinal` 已实测通过：258/0（C129/W129，retry/skip/flaky 0，命令 53.47s），源码字节稳定；
先前中间树 E2E 258 实际通过但不计最终门禁（父在 merge 失败后仍启动、已标中间树）；DASH 合入 CPB 的 2MD 冲突
已按正确顺序以 DASH 原 blob 解析（先覆盖后父 `git add` 完成正常 merge）。

## 有效变异（父 Harness 私有，均目标 RED + 逐字节恢复 GREEN）

- wrong-path：`docker-compose.yml:55` `http://localhost:8000/api/health` →
  `http://localhost:8000/api/health-missing-endpoint`，`test_api_healthcheck_is_anonymous_and_compiles`
  目标 RED，恢复 GREEN。
- barrier：`docker-compose.yml:73` `condition: service_completed_successfully` → `condition: service_started`，
  `test_db_services_gate_on_migration_success` 目标 RED，恢复 GREEN。
- web：`docker-compose.yml:139` web 依赖 `echotalk-api: condition: service_healthy` →
  `condition: service_started`，`test_web_gates_on_api_health` 目标 RED，恢复 GREEN。

三处私有变异均已逐字节恢复（`formal_unchanged=true`、`private_restored=true`）。

## 输入因果界限与未验证

- `docker compose config` 是编排归一化语义验证，不是整栈验收；迁移完成只保证启动前置，不证明运行中的 DB/Provider
  持续健康/就绪。health 仅表达 liveness + 成功迁移启动顺序；liveness + 迁移门禁只约束 Compose 启动顺序，
  不保证运行中 DB 持续 ready，也不保证独立容器重启后的依赖顺序。
- 测试显式 `synthetic-vars.txt` + `--no-env-resolution`，不读写 `.env*`、不解析默认 `.env` 或 env_file。
- 本机未运行 `docker compose up/build/run/start/restart`、未在本机库执行 alembic 或迁移、未起新迁移服务容器、
  未访问真实 Provider/LiveKit/IdP、未整栈或部署；父亲跑 pytest 使用已有专用 PG 容器。
- CI 原有「Upgrade empty PostgreSQL database」会对一次性合成库执行 `alembic upgrade head`（原流程未改，后续结果
  分列）；不声称所有环境零迁移或零容器运行。
- 本次文档收口阶段源码/锁零改（整个包源码仅 `docker-compose.yml` + 新增 5 pytest）；不猜未来 CPB PR/main/CI 编号或
  发布终点 SHA；不开服务。

停 Review；本文件为文档收口，不 commit / push / merge。
