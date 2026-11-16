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

## §8 RF04E 历史远端证据附录（原时点 2026-11-14）

> 本节来自 B1 `46ef954` 的独立历史附录。三条 main push、iOS failure 传播反证与 required-check
> 未核边界继续绑定各自提交和运行，不与 §6/§7 的数字相加，也不替代本次合并后的验证。

本节按安全摘要 `RF04E-remote-evidence.json` 与五个 Git 树的原生 YAML 解析结果
`RF04E-workflow-static-audit-r1.json` 追加。初版私有 regex 提取无效，已从证据链排除。
下列结论只覆盖所列历史提交、运行、job 和日志摘要；本轮核对时的起始树 `4ec1a4d` 上的原始本地
E2E 失败、追加诊断与未证根因独立记录在 [PROJECT_STATUS 的 RF04E 小节](../../PROJECT_STATUS.md)，
不能改写本节历史远端结果。

### §8.1 三条 main push 正向证据

| Git 树                                     | 触发与运行                                                                                             | 关键 job                                                                                          | 核对结果                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `42c61bb08f5e234989198ef46ed7534a80c70796` | `main` push，attempt 1，run [42171326665](https://github.com/sunpcm/EchoTalk/actions/runs/42171326665) | FE `127739581878`；BE `127739582109`；macOS `127739582055`；iOS `127739582001`；CI `127741167480` | 五个 job 均 completed/success；iOS 日志含 `BUILD SUCCEEDED`；聚合四个 need 均 success |
| `6bda2cde70eab1b53f96cf4cb58cdb06c0a7bb03` | `main` push，attempt 1，run [42172093887](https://github.com/sunpcm/EchoTalk/actions/runs/42172093887) | macOS `127742048834`；BE `127742049063`；FE `127742049210`；CI `127743546746`                     | 四个 job 均 completed/success；无 iOS job；聚合三个 need 均 success                   |
| `ef6cb5320331dea7e4d73c201ecc1ba54beb779a` | `main` push，attempt 1，run [42245842228](https://github.com/sunpcm/EchoTalk/actions/runs/42245842228) | macOS `127987713250`；FE `127987713639`；BE `127987713954`；CI `127990531178`                     | 四个 job 均 completed/success；无 iOS job；聚合三个 need 均 success                   |

三次运行的 frontend/backend 安全摘要都定位到对应 checkout SHA。三个 run 的 attempt 均为 1，但静态
audit 同时记录 `ci_retry_policy_2=true`；这里的成功不能写成零重试稳定性。E2E 日志摘要分别给出
`89 Chromium + 89 WebKit = 178 passed` 与两次 `80 Chromium + 80 WebKit = 160 passed`；不根据
job 绿色补写未出现的 retry、skip 或测试语义。

### §8.2 workflow 静态结构

| Git 树    | workflow SHA256                                                    | jobs                   | aggregate needs    |
| --------- | ------------------------------------------------------------------ | ---------------------- | ------------------ |
| `42c61bb` | `969a50da306de4fce3dec0733f71fbcabc6723bdf62011f13400f7aa29c6b4e7` | FE、BE、macOS、iOS、CI | FE、BE、macOS、iOS |
| `6bda2cd` | `930d6663fb840599d71492c57629e77968feb724ac3127aed0fa245c200e1a65` | FE、BE、macOS、CI      | FE、BE、macOS      |
| `ef6cb53` | `930d6663fb840599d71492c57629e77968feb724ac3127aed0fa245c200e1a65` | FE、BE、macOS、CI      | FE、BE、macOS      |
| `5c28e1b` | `982ddb365078a547447e6243be3714dd08a2c283bb5a6385568cd20e6d10e992` | FE、BE、macOS、iOS、CI | FE、BE、macOS、iOS |
| `4ec1a4d` | `f98c2c2d7d3b5337bb35165db669188acc4086624bf88d16be0740ccda49e85a` | FE、BE、macOS、iOS、CI | FE、BE、macOS、iOS |

五个树均由原生 YAML 解析确认聚合 job `if: always()`，并分别对当前 needs 的 result 做强断言。
`42c61bb` 与 `5c28e1b`、`4ec1a4d` 含 iOS；`6bda2cd` 与 `ef6cb53` 因 #118 回退不含 iOS，
不能反推两次运行曾通过 iOS。`4ec1a4d` 作为本轮核对时的起始树，只有静态 workflow 结构证据，
没有该树的远端 run。

### §8.3 RF-04 契约逐项核对

| 契约项                                                                      | 已有证据                                                                                                                                                                                                                               | 核对边界                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 前端格式、Lint、TypeScript、Vitest、Build、Fake API、API 类型与双浏览器 E2E | `42c61bb`：Vitest `1133 / 41 files`、build-script `21`、Fake API `72`、API 类型 runner `8`、E2E `178 = 89+89`；`6bda2cd`/`ef6cb53`：Vitest `1007 / 39 files`、build-script `18`、Fake API `61`、API 类型 runner `8`、E2E `160 = 80+80` | 三个对应 run 的 step 日志均成功；数据只绑定各自 SHA，不能作为本轮核对时的起始树或 PR 运行通过                                                                                                    |
| OpenAPI schema、TypeScript 生成类型与 Provider metadata                     | 三次均出现 `API types are current`、`OpenAPI schema is current` 和 `Provider metadata is current` 的摘要；API 类型 runner 均为 `8`                                                                                                     | 证明历史 step 和 tracked 产物一致性；未重新审查所有生成器实现与变体                                                                                                                              |
| Ruff 与 backend 测试                                                        | 三次 Ruff format/check 均 success；backend 分别为 `773 passed / 3 warnings / 78.52%`、`644 / 3 / 78.61%`、`665 / 3 / 78.99%`                                                                                                           | coverage 精确值取 `Required test coverage of 59.0% reached. Total coverage: 78.52/78.61/78.99%` 日志行；term-missing 的 `TOTAL` 只显示取整 `79%`，不作为精确值。摘要没有给出零 skip 结论，未补写 |
| Empty PostgreSQL 迁移与 59% coverage 阈值                                   | 三次均从空库迁移成功，日志明确显示 `c06_transcript_events (head)`；均显示达到 59% 阈值                                                                                                                                                 | 证明历史次次 run 的迁移与覆盖率门禁通过；未重放每个约束、索引、任务领取或幂等断言                                                                                                                |
| macOS 与 iOS 构建                                                           | 三次 macOS job success；`42c61bb` 的 iOS job success 且日志含 `BUILD SUCCEEDED`                                                                                                                                                        | `42c61bb` 仅证明无签名模拟器编译；`6bda2cd`/`ef6cb53` 无 iOS job，不能写 iOS 通过                                                                                                                |
| 聚合 `CI` 失败传播                                                          | `42c61bb` 四个 need success；`6bda2cd`/`ef6cb53` 三个 need success                                                                                                                                                                     | 证明当时各自 workflow 拓扑内的聚合成功；不能覆盖其树外的新增门禁或当前 required check                                                                                                            |

### §8.4 iOS 恢复与历史失败反证

PR #128 对应的 `5c28e1baa33a085738e341194595d9ccd7723598` 在 `main` push、attempt 1 的
run [42473006604](https://github.com/sunpcm/EchoTalk/actions/runs/42473006604) 恢复四 job 聚合：

- FE `128707973251`、BE `128707973472`、macOS `128707973437` 均 success。
- iOS `128707973381` failure，失败发生在 `Select Xcode and prepare locked SPM dependencies`；
  `Production web, explicit sync and unsigned simulator compile` 为 skipped。
- 聚合 `CI` job `128709245911` failure；安全摘要明确 `IOS_BUILD_RESULT: failure` 后
  `Process completed with exit code 1`。

这说明 aggregate 在该历史树上实际拒绝了 iOS failure，是 workflow 失败传播的正向反证。证据未确认
SPM 准备的失败根因，因此不主张网络、504、代码或环境归因，也不能把整个 run 改写成成功。iOS
预下载有限重试仍需在对应分支 CI 通过后单独核销。

### §8.5 尚未成立的范围

- 三次正向运行都是 `main` push，不能替代 PR 运行，也不能证明当前 PR 的 fail-block enforcement。
- 本轮未为格式、类型、迁移、E2E 等门禁逐类构造或读取失败负向 PR 运行；唯一已核负例是 #128 的
  iOS failure/aggregate failure。不能由这一单例反推每一类失败都会在 PR 合并处被阻断。
- required-check enforcement 与分支保护未读取、未更改；不能由 workflow job 存在或 main push 成功
  推定其已 required。
- `4ec1a4d` 是本轮核对时的起始树，其 workflow run count 为 `0`；任务分支 push 不触发现行 CI，
  不能写成远端通过或失败。
- 不覆盖真实 Provider/IdP/LiveKit/media/device、真实三端链路或生产；也不能据此证明历史测试中
  每一项断言与全部 skip/retry 行为。
