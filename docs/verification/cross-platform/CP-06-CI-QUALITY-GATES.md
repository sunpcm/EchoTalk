# CP-06 CI 真实测试入口接线与质量门禁（A30）

契约来源：`TODO.md` RF-04 CI 真实性与 CP-06 完整质量门禁。

> §1–§4 保留 A30 本地接线与当时远端尚未运行的冻结历史。A64 远端基础证据及 A67
> 新增门禁的未验边界见 §5；已发布实施 main76d9d6ba 的远端 CI 收口见 §6。

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

## §6 已发布实施 main76d9d6ba 的远端 CI 收口（2026-11-15）

I1 实施 [PR176](https://github.com/sunpcm/EchoTalk/pull/176) 已发布 main
[76d9d6ba](https://github.com/sunpcm/EchoTalk/commit/76d9d6ba8c3ad72cf2c0671344ff48b617faea0f)
（source `7f272cdb8845822010ae6658c8e1fc3a3913ec22` / CImerge
`5e5c1f8466649248428ded72db979f73eb2172c7`）。[mainCI 43686992533](https://github.com/sunpcm/EchoTalk/actions/runs/43686992533)
首轮五 jobs 全 success，覆盖现存前端门禁（按现存命令列出，含 G3 两层字节漂移）、backend、macOS 探针、iOS 无签名编译与聚合 `CI`：

- 前端（`test-frontend`，ubuntu）：Format、Lint、Typecheck、Vitest 1249 passed/53 files、
  build-script 21、Fake API 125、API 类型生成器 10、两层类型漂移检查、Build、
  Chromium+WebKit E2E 234（C117/W117，实际 retry/skip/flaky 0，4.5m）。
- 后端（`test-backend`，ubuntu，专用 PostgreSQL 15.19 空库迁移）：keyfree 运行时守卫、
  tracked OpenAPI schema `--check`、Provider 元数据 `--check`、Agent/分析契约 `--check`、
  Ruff format/check、Alembic 至 head、pytest 957 passed/3 warnings/80.63%（73.52s）。
- macOS 探针（`test-macos-probe`，macos-15）：固定 Node 22.13.1/arm64、Rust 1.93.1，
  无签名 arm64 app。
- iOS 无签名编译（`test-ios-build`，macos-15）：生产 Web build + 显式 sync +
  真实 arm64 Simulator 编译与静态产物校验。
- 聚合 `CI`：`needs` 上述四 job，逐项 `success` 才通过。

G3 同源契约的两层漂移门禁（backend tracked schema `--check` 与 frontend schema→TypeScript
字节漂移 + 生成器测试）已随本轮在 Linux CI 执行并通过；§5 所述「10 项前端门禁、schema 两层门禁、
完整 backend 与聚合 job 在 GitHub 当前树上均未执行」在本 main76d9d6ba 起不再成立，§1–§5 历史冻结记录保留。

前端现存门禁不以固定「10 项」计数（G3 新增的两层字节漂移已入列），本节按现存命令逐项列出。

RF-04 的 CI 执行部分就此核销：远端 Linux CI 已在 main76d9d6ba 五 jobs 全绿。RF-04 原契约仅含 CI
required check 与门禁；剩余边界仅为分支保护 required check 配置与 GitHub 管理权限（本轮只读核验为
403/INVALID_ARGUMENT，不证明设置不存在，不归档）。真实 IdP/Provider/LiveKit、设备与部署属 CP-06
三端真实链路独立卡，不并入 RF-04。

## §7 当前主线质量门禁与证据留存（2026-11-16）

§1–§6 历史冻结记录保留。自 main `76d9d6ba` 起，PR177–186 已按门禁逐包合并，最终主线为 CPB
main `53d2a409`（tree `cec480de`，与 source `e0a6250`/CI merge 全等）。各包 PR CI/Guard/mainCI 均首轮
全 success（无重跑），Linux 回读与 macOS 亲跑分列于
[当前状态页](../../PROJECT_STATUS.md) 与各包 history，不在此重复堆积。

- 前端现存门禁（`test-frontend`，ubuntu）：Format、Lint、Typecheck、Vitest、build-script、Fake API、
  OpenAPI→TypeScript `check:api-types`、类型生成器 runner、Build、Chromium+WebKit Playwright；CPB main
  Linux 回读 Vitest 1260/55、Fake 125、types 10、build 21、E2E 258 C129/W129（实际 retry/skip/flaky 0）。
- 后端（`test-backend`，ubuntu，专用 PostgreSQL 15.19 空库迁移）：tracked OpenAPI schema `--check`、
  Provider 元数据 `--check`、Agent/分析契约 `--check`、Ruff format/check、Alembic 至 head、
  pytest（CPB main 962 passed/3 warnings/80.63%）。
- macOS 探针 / iOS 无签名编译、聚合 `CI` 保持首轮 success。

### §7.1 CI 首失败证据留存（EV）

EV 已把 E2E 证据保存补上（`apps/vite-app/playwright.config.ts` 的 `use.trace` 改 `retain-on-failure`、
新增 `use.screenshot: only-on-failure`；`.github/workflows/ci.yml` E2E reporter 改 `list,json`，其后 always
上传 JSON 报告与 test-results，7 天 retention）。这只补证据保存，不修复也不宣称修复 session-flow GC 根因。
EV PR187 已 squash 至 main `bf4becd`（source `4c364cea` / CI merge `546090c6` / main 三者 tree `c2e7ddfa` 完全一致），
PR CI 43737757005 首六 success、Guard 43737757038 success，最终 mainCI 43738720996 首五 success。PR 与 main 两份
实际归档均已 MCP 实际下载核 SHA/CRC/原生 JSON/PNG（非只看日志元数据，不贴临时下载 URL）：PR artifact 14171327756
（SHA256 `60ae87e6…`，14725526 字节，143 文件/142 PNG/trace0）、main artifact 14171881434（SHA256
`45573d73a…`，14705831 字节，143 文件/142 PNG/trace0 main 全绿）；两者原生 `playwright-report/results.json`
均 expected 258 / C129 / W129 / retry0 / skip0 / flaky0，142 PNG（含 ACT 320px 200% 双浏览器截图），证明证据保留链路可用。

### §7.2 required-check 未核边界

RF-04 的 required check 配置（分支保护）仍未核：GitHub MCP managed App 对 branches/main/protection 返回 403、
rules/labels endpoint 不在白名单返回 INVALID_ARGUMENT。这不证明设置不存在，也不因此归档 RF-04；
需用户在仓库侧配置或授权核验，不通过外部查询绕 403。真实 IdP/LiveKit、设备与部署属 CP-06 三端真实链路独立卡，
不并入 RF-04。
