# CP-06 CI 真实测试入口接线与质量门禁（A30）

契约来源：`TODO.md` RF-04 CI 真实性与 CP-06 完整质量门禁。

> §1–§4 保留 A30 本地接线与当时远端尚未运行的冻结历史。当前门禁拓扑、A64 远端
> 基础证据及 A67 新增门禁的未验边界见 §5。

## §1 CI 门禁对齐与命令映射

本次修改将 `.github/workflows/ci.yml` 中 `test-frontend` job 的执行步骤与本地 8 项质量门禁严格对齐，执行顺序为：格式 → Lint → Typecheck → 真实单测 → 两项 Node runner → Build → 双浏览器 E2E。

| 序号 | 门禁步骤              | CI 执行命令                                   | 说明与语义                                                   |
| ---- | --------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| 1    | Format                | `pnpm run format:check`                       | 检查全仓格式规范                                             |
| 2    | Lint                  | `pnpm exec turbo run lint --force`            | 全 workspace lint，强制执行避免缓存回放                      |
| 3    | Typecheck             | `pnpm exec turbo run typecheck --force`       | 全 workspace typecheck，强制执行避免缓存回放                 |
| 4    | Test (Vitest)         | `pnpm --filter vite-app test`                 | 直接定位 Vite Vitest 真实单测，避免 root test 占位任务       |
| 5    | Test (Build Scripts)  | `pnpm --filter vite-app test:build`           | 18 项构建脚本隔离测试（Node 原生 `node:test` runner）        |
| 6    | Test (Fake API)       | `pnpm --filter vite-app test:fake-api`        | 真实 Node 子进程回归测试套件（Node 原生 `node:test` runner） |
| 7    | Build                 | `pnpm exec turbo run build --force`           | 全 workspace 构建，强制执行避免缓存回放                      |
| 8    | E2E Test (Playwright) | `pnpm exec playwright test` (`apps/vite-app`) | Chromium 与 WebKit 双浏览器端到端测试                        |

每一步骤失败均正常阻断，不添加 `continue-on-error`、失败忽略或条件跳过逻辑。

## §2 保持的不变量

1. **依赖与环境**：
   - 依赖安装步骤保持 `pnpm install --frozen-lockfile`，依赖锁文件未修改。
   - Playwright 浏览器安装步骤保持 `pnpm exec playwright install --with-deps chromium webkit` 且 working-directory 位于 `apps/vite-app`，执行顺序保持在 E2E 之前。
   - Node 22 (`actions/setup-node@v4`，缓存 `pnpm`) 与 pnpm 10.26.0 (`pnpm/action-setup@v4`) 版本保持不变。
   - 运行环境为 `ubuntu-latest`，Actions 官方组件版本不变。
2. **Job 与后端测试**：
   - `test-frontend` job id 与 name 保持稳定，满足既有分支保护要求。
   - `test-backend` 整段配置完全不改，保持 PostgreSQL 15.19 临时服务、健康检查、`DATABASE_URL`、Python 3.12、uv、Ruff 格式与检查、Alembic 空库迁移及 pytest 覆盖率测试。
   - `ci` 聚合 job 完全不改：保持 `if: always()`、`needs: [test-frontend, test-backend]` 以及对两个 job 均为 `success` 的强断言。
3. **工作流触发与权限**：
   - 工作流 `on` 触发器（main/master push 与 pull_request）完全不改。
   - 未新增权限、secrets、服务依赖、发布或外部网络模型请求。

## §3 本地验证与门禁执行

本地通过 `cross-platform-local-check.py b quality` 执行完整 8 项门禁（format、lint、typecheck、test、build-script-test、fake-api-test、build、e2e），所有用例与断言保持全部通过。

2026-10-25 Codex 独立评审 APPROVED：648 项 Vitest、18 项构建脚本、53 项 Fake API Node、120 项双浏览器 E2E，以及专用 PostgreSQL 269 项 pytest（覆盖率 73.72%）与 Ruff 通过。另以 PyYAML 解析核对触发器、环境、后端 job 和聚合 job 不变量；去掉真实 Fake API gate、去掉后端成功断言的两个变异均被探针拒绝，源码逐字节恢复后重新通过完整 8 项门禁。

## §4 边界与远端未验

- 本轮修改为本地配置阶段，未触发 GitHub Actions 远端运行。
- 本地 8 项门禁通过不代表远端 Linux CI 实际通过；真实 Linux CI 双浏览器运行及远端证据保留为后续独立验收。
- 实施严格停在 Review，不进行 commit、push、merge 或部署。

## §5 当前状态核销（A70，2026-11-01）

当前工作流已从 A30 的 8 项前端门禁扩展为 10 项：

| 层次 | 当前门禁                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 前端 | Format、Lint、Typecheck、Vitest、build-script test、Fake API test、OpenAPI→TypeScript `check:api-types`、TypeScript 类型生成器 runner、Build、Chromium+WebKit Playwright |
| 后端 | 真实 FastAPI OpenAPI `--check`、Ruff format、Ruff check、空 PostgreSQL 迁移至 head、带覆盖率 pytest                                                                      |
| 聚合 | `ci` 并行等待 `test-frontend` 与 `test-backend`，任一非 `success` 即失败                                                                                                 |

A64 已有真实远端基础门禁证据。PR #109 的 run 41220439360 绑定 head
`b7585d140ecc6ad4f45580fabe71e32c9c51466b`、merge
`c704925bc9150d153fc951c2727e7472dad00d78`；`test-frontend`、`test-backend` 与聚合
`CI` 三 job 均为 completed/success。该次远端树的前端仍是旧 8 项门禁：854 Vitest、
18 build-script、61 Fake API、Chromium 74 + WebKit 74；backend 将空库迁移到
`c06_transcript_events` 后为 529 passed、3 warnings、82.49%。安全摘要与源 URL 位于
A70 b/r0 `ci-evidence.json`，源 URL 为
[GitHub Actions run 41220439360](https://github.com/sunpcm/EchoTalk/actions/runs/41220439360)。

A69 lane 私有验证完成 4 项独立组件/store 消费探针与两项有效通知变异，源码已完整还原；
这些私有探针/变异没有在 main 重跑。A69 自身精确 fast-forward 后已在 main 完成
frontend10、OpenAPI schema、Ruff 与专用 PostgreSQL backend 复验（917 Vitest/32 files、
148 双浏览器 E2E、540 backend）；A70 b/r0 `check-receipt.json` 记录的是此前这次 A69
复验。随后 A70 提交 `4946a87` 又在 main 完成一次同口径
frontend10/schema/Ruff/backend 复验，已由主 Agent 独立核实；这次 A70 复验不是该 receipt
记录的对象，不能把两者混写。

仍未验边界：

- A64 的远端成功证明旧 8 项前端门禁、旧 backend 与聚合 job 可在 Linux CI 执行；它不能
  追溯覆盖 A67 之后新增的 OpenAPI schema/TypeScript 类型生成与当前 10 项前端门禁。
- A67 新增门禁只在本地通过；A65–A69 均未 push，因此当前 10 项前端门禁、schema 两层门禁、
  完整 backend 与聚合 job 在 GitHub 当前树上均未执行。
- 真实 IdP/Provider/LiveKit、设备与部署也未验。故 RF-04 继续未勾选，剩余门禁是当前远端树
  的完整 CI 运行与真实链路验收。
