# EchoTalk Agent 评审手册

> 建立日期：2026-10-21。章节编号被 prompt 引用后只追加，不重排。
> 架构/评审负责范围、接口、独立验收与集成；实施负责代码、测试和交付报告，停在 Review。

## §1 基线、目录与生命周期

- 当前主 checkout：`/Users/sunpcm/code/EchoTalk`；旧本地 `main@66a64fe` 保留，不 reset、不 stash、不强推。
- 2026-10-21 通过 GitHub 实时核实远端 `main@a8f08959af92bf38222589fcf7e9539b99d8d56c`；本地 origin/main 指向同一提交。
- 新建准备 lane：`/Users/sunpcm/code/EchoTalk/.review/worktrees/cp00`，分支 `codex/cross-platform-cp00`，从上述远端提交开始。
- 主 checkout 尚有三份上一轮计划文档改动；已在准备 lane 以远端文档为底移入计划，保留远端的安全补丁和可访问性完成记录。未更新主分支。
- 本地指令、报告、工具：主 checkout 下 `.review/prompts/`、`.review/reports/`、`.review/reports/tools/ev.sh`。
- `.review/` 通过 Git common dir 的 `info/exclude` 排除，Prettier 也排除，防止嵌套 worktree/报告进入格式扫描。
- 用户已确认 prompt 仅保存在本地；报告、原始证据和 reviewer-probes 始终不跟踪。
- CP-00 完成后从评审通过的同一提交建立 A/B/C 常驻 lane；每轮换分支，不删除重建运行环境。
- 单仓项目不需要跨仓配对或关联 trailer。现存其他 worktree 非本循环所有，保持只读，不清理。

## §2 测试树、解释器与质量门禁

所有命令从对应 lane 执行，先固定 Node 22 的 PATH；本机已发现
`/Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node`，pnpm 为 10.26.0。
当前默认 PATH 是 Node 24，不能据此宣称完成 CI Node 22 验证。
Python 使用 lane 内 `backend/.venv/bin/python`，目标 3.12；不得借用其他 lane 的可变虚拟环境。

| 类型               | lane 内工作目录         | 命令                                                                     | 环境/说明                                                                                 |
| ------------------ | ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 真实单元测试树     | `apps/vite-app`         | `pnpm test`                                                              | 使用项目脚本配置 NODE_OPTIONS；Vitest 不使用 Turbo 缓存日志作为新证据                     |
| 浏览器测试树       | `apps/vite-app`         | `pnpm test:e2e`                                                          | Chromium + 本地 Fake API；默认端口 4173/18181，单独串行运行                               |
| 后端测试树         | `backend`               | `.venv/bin/python -m pytest --cov=. --cov-report=term-missing`           | 仅在 §3 明确独立测试库并核验后运行，Mock/DB 用例和 skip 分开报告                          |
| 格式               | 仓库根                  | `pnpm format:check`                                                      | 不扫描本地 `.review/`                                                                     |
| 前端 lint          | 仓库根                  | `pnpm exec turbo run lint --force`                                       | 强制执行；实际只有 Vite 真实 lint 任务，共享配置包不伪造 lint 任务                        |
| 前端类型           | 仓库根                  | `pnpm exec turbo run typecheck --force`                                  | 强制执行                                                                                  |
| 前端构建           | 仓库根                  | `pnpm exec turbo run build --force`                                      | 构建 Vite/Capacitor 产品前端，原生同步单独记录                                            |
| 后端格式           | `backend`               | `.venv/bin/ruff format --check .`                                        | 与 CI 一致                                                                                |
| 后端 lint          | `backend`               | `.venv/bin/ruff check .`                                                 | 与 CI 一致                                                                                |
| OpenAPI schema     | `backend`               | `../.review/rf07-a37-dev-venv/bin/python export_openapi.py --check`      | 真实 app 导出后与 canonical `openapi.json` 字节比较；不读 dotenv/凭据                     |
| API 类型漂移       | `apps/vite-app`         | `pnpm check:api-types`                                                   | 从 tracked schema 重新生成并与 `api.generated.ts` 字节比较                                |
| API 类型 runner    | `apps/vite-app`         | `pnpm test:api-types`                                                    | Node 真实 runner；覆盖确定性、stale、`$ref` 与写入失败                                    |
| 空库迁移           | `backend`               | `.venv/bin/alembic upgrade head` 后 `.venv/bin/alembic current`          | 仅在专用可重建测试库获授权后执行；不是普通基线检查的默认动作                              |
| iOS 工程检查       | `apps/vite-app/ios/App` | `xcodebuild -list -project App.xcodeproj`                                | 仅清单；可能访问 SPM，运行前确认边界，完整编译不在本轮默认授权内                          |
| Fake API测试       | `apps/vite-app`         | `pnpm test:fake-api`                                                     | 真实 Node 子进程回归，使用动态端口 0 与原生 node:test                                     |
| iOS CI 脚本 runner | 仓库根                  | `node --test --test-timeout=30000 apps/vite-app/scripts/ios-ci-test.mjs` | 独立 Node runner；正式入口 `test:ios-ci` 保留，不交 Vitest 收集；不表示原生 iOS CI 已通过 |

共享配置 package 不提供占位 test 脚本，不得计入测试树。根目录历史独立诊断脚本
`test_api_err.ts` 已移除，明确不属于测试树。新增真实 runner 时追加本表。
构建脚本测试（`pnpm test:build`）与 Fake API 真实子进程回归测试（`pnpm test:fake-api`）均为 Node 原生 `node:test` 真实 runner，列入独立计数。
当前前端 quality 门禁共 10 项：format、lint、typecheck、Vitest、build-script-test、fake-api-test、api-types-check、api-types-test、build、e2e；baseline 保留 3 项（format、lint、typecheck）。
真实 IdP、LiveKit/Provider、iOS/macOS 设备链路是独立外部验收，不由 Fake API E2E 替代。

### §2.1 RF-07 Python 依赖受控安装与环境验证规范

1. **项目规范与解释器声明**：后端成为标准 uv 项目，`backend/pyproject.toml` 声明 `name = "echotalk-backend"`、`version = "0.1.0"`、`requires-python = ">=3.12,<3.13"`、`[tool.uv] package = false`；`backend/.python-version` 明确声明 `3.12`，统一对齐 CI 与本地解释器，禁止开发入口回退到其他 Python 版本。
2. **唯一依赖真相与导出入口**：`backend/uv.lock` 经 A71 原生删除 Celery/Redis 依赖后为 179 个包（原 192）；`backend/requirements.txt` 已由主 Agent 使用 uv 0.9.18 通过 `uv export --frozen --no-dev --no-emit-project --no-header --no-annotate` 重新导出，仍是单一只读兼容镜像产物（runtime-only，不含开发工具），禁止手写双重直接依赖。CI 中通过只读导出并与仓内文件精确 `cmp` 校验一致性。A72 又经同版本 uv 离线原生重算，lock 179→107、删除 72 条跨平台记录；`requirements.txt` 为 82,071→52,074 bytes，全部存活 package 完整记录逐值相同，7 个 LiveKit exact SDK 保持。
3. **环境隔离与只读边界**：原 `backend/.venv` 及 A36 `.review/rf07-venv` 保持严格只读，不得修改、删除或用于新依赖同步；RF-07 受控新环境固定位于 `cp00/.review/rf07-a37-dev-venv` 与 `cp00/.review/rf07-a37-runtime-venv`。A71 后为 dev 159/runtime 152；A72 经离线 frozen sync 后各删除 53 个安装包，变为 dev 106/runtime 99。A37 当时 172/165 环境上的 269 项 backend pytest（覆盖率 73.72%）保留为历史证据，A71 的 540 项 backend pytest（79.59%）已在 `dd0fbc0` main 复验通过。两套环境完全独立于 backend 目录，不进入 Docker build context，实施方严禁直接读取数据库凭据或拿旧 env 日志充数。当前本地测试脚本与 runner 严格使用当前 lane 指定环境，不得擅自指向全局 Python。
4. **CI 与 Docker 配方统一**：CI (`.github/workflows/ci.yml`) 锁定 `astral-sh/setup-uv@v3` 版本为 `0.9.18`，通过 `uv lock --check` 与 `uv sync --frozen --group dev --no-python-downloads` 实施冻结安装（显式包含 dev 组）；Dockerfile 统一为 `python:3.12-slim` 与 uv 0.9.18 配方，通过 `uv sync --frozen --no-dev --no-python-downloads` 排除 dev 组，隔离虚拟环境于 `/opt/venv`，`.dockerignore` 补充 `.env*`、`.review/` 及测试缓存排除规则，避免本地环境泄露至镜像上下文。

### §2.1.1 RF-07 运行角色当前安装与受控环境（2026-11-01，A79 已验）

- 当前 `backend/pyproject.toml` 将 API 与 Agent 共用依赖保留在 `[project].dependencies`，
  并以 `api`、`agent` 与既有 `dev` 组区分运行角色；`tool.uv.default-groups` 同时包含
  `api/agent/dev`，无 flag 的本地开发安装保持完整。CI 仍显式使用 `--group dev`，并继续
  先执行 `uv lock --check`，不因默认组变化改写同义命令。
- 后端 Dockerfile 以受控 `BACKEND_ROLE=api|agent` 选择唯一运行组，固定 uv 0.9.18 后使用
  `--frozen --no-default-groups --group "$BACKEND_ROLE" --no-python-downloads`，非法值在
  `uv sync` 前失败；dev 不进入任一角色镜像。Compose 中 API 与 analysis-worker 使用 `api`，
  语音 Agent 使用 `agent`。
- `requirements.txt` 继续作为兼容镜像产物，由当前完整默认组导出后排除 dev，内容等价于
  `api + agent` 两组运行依赖；不得改成只含 API 或只含 Agent 的导出。`uv.lock` 与
  `requirements.txt` 只能由受控主 Agent 使用既有 uv 0.9.18 离线原生工具生成，实施方不手写。
- 当前只允许主 Agent 使用 lane 内
  `.review/rf07-a37-dev-venv` 与 `.review/rf07-a37-runtime-venv` 做受控安装与导入证据；
  runtime 环境须按 `api → agent → 合并 runtime` 串行切换并在每个状态使用精确 frozen/
  offline/no-python-downloads 命令，dev 环境同步全部组。中间角色环境不得跑完整测试，异常
  后先恢复合并 runtime 再判断安装分布。`backend/.venv`、A36 旧环境、全局环境、uv cache、
  dotenv 与凭据均不在实施方读取或写入边界内。
- A79 已由主 Agent 使用既有 uv 0.9.18 离线工具完成 lock/export 原生生成与受控角色验证：
  全部存活锁记录及全局 metadata 保持不变，只删除 `passlib 1.7.4`/`bcrypt 5.0.0`，七个
  LiveKit exact pins 不变；导入分布为 dev 104、API 55、Agent 83，最终恢复 merged runtime
  97。独立 Review APPROVED 后以单提交
  `eaac89d0f4f008e77ba51b26a590412a03541acb` 精确 fast-forward 本地 main，并通过完整
  15 项 main 门禁；该提交相对本地 tracking reference 领先 15 个提交，不是远端实时查询。
- 上述本地配方与门禁不等于 Linux/Docker 镜像、Compose 服务、远端 CI、真实 LiveKit/
  Provider、Worker 注册、设备或部署已通过；RF-05、RF-07、RF-09 与 RF-12 的外部边界继续
  保持未完成。

### §2.2 2026-11-04 夜间运行时新增 runner 与实际验收索引

本轮证据根 R 为主 checkout 的 `.review/reports/overnight-product-runtime-20261103/`。
新增 runtime-format/runtime-lint/runtime-unit 独立于 frontend10/backend5；真实服务与镜像
另列，不将这些新增检查计入旧 15 项。全部由主控经本轮已审 `R/tools` 控制器和只读
`/Users/sunpcm/code/EchoTalk/.review/reports/tools/ev.sh` 执行，实施者不运行。

C 三项实际清单固定于 `R/runtime/c2-project-quality-manifest-r1.json`，cwd 为
`/Users/sunpcm/code/EchoTalk/.review/worktrees/overnight-runtime-20261103`。manifest 绑定
该 C lane `backend/pyproject.toml` 的 SHA256
`b65ac36452e41aee661541c64d2c6377b2251467ffcc757341d3afda390473b6`；Ruff 两项均显式
`--config backend/pyproject.toml`，19 项 unittest 与之属于同一 manifest/源码指纹。
以下列出与 manifest 等价的精确命令；环境由主控清理，`PYTHONDONTWRITEBYTECODE=1`，
不继承数据库/Provider 配置，单项 timeout 120 秒。命令仅供主控封装，不授予实施者执行权。

```sh
RUNTIME_TREE='/Users/sunpcm/code/EchoTalk/.review/worktrees/overnight-runtime-20261103'
RUNTIME_RUFF='/Users/sunpcm/code/EchoTalk/.review/worktrees/overnight-product-runtime-20261103/backend/.venv/bin/ruff'
RUNTIME_PYTHON='/Users/sunpcm/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/bin/python3.12'
export PYTHONDONTWRITEBYTECODE=1
cd "$RUNTIME_TREE"
"$RUNTIME_RUFF" format --check --config backend/pyproject.toml \
  tools/keyfree-runtime/container_probe.py tools/keyfree-runtime/measure.py \
  tools/keyfree-runtime/runtime.py tools/keyfree-runtime/runtime_support.py \
  tools/keyfree-runtime/test_runtime.py
"$RUNTIME_RUFF" check --config backend/pyproject.toml \
  tools/keyfree-runtime/container_probe.py tools/keyfree-runtime/measure.py \
  tools/keyfree-runtime/runtime.py tools/keyfree-runtime/runtime_support.py \
  tools/keyfree-runtime/test_runtime.py
"$RUNTIME_PYTHON" -B -m unittest discover -s tools/keyfree-runtime -p 'test_*.py'
```

以上 Ruff 是主控集成 lane 的受控工具，Python 是主控核验的 3.12.12；此清单不扩展
实施者读取或借用环境的权限。`R/runtime/c2-project-quality-checks-r1/summary.json`
记录三项 process/gate exit 均为 0、runtime-unit 19 项，绑定 C 指纹
`7f5add2cb20657dfaa811d3b9c06ab7cf164b95d4e5d6f0085de9c56089ea3c5`。
离线测试不证明真实服务、镜像或宿主 HTTP 入口通过。

真实服务入口 `tools/keyfree-runtime/runtime.py` 按下列参数协议执行；冻结快照、manifest、
provision 与独立 approval 的实际绝对路径由主控绑定，禁止直接使用占位值：

```sh
python -B <冻结工具快照>/runtime.py provision --manifest <冻结manifest.json>
python -B <冻结工具快照>/runtime.py exercise --manifest <冻结manifest.json> \
  --provision <report_root>/provision/provision.json --approval <主控独立approval.json>
python -B <冻结工具快照>/runtime.py cleanup --manifest <冻结manifest.json>
```

顺序为 provision → 独立空库 SQL 回执与迁移审查 → 主控独立批准 → exercise → cleanup；
provision 不批准迁移，cleanup 以实际回执为准。命令、manifest/approval、身份与清理边界
由主控按 [RF-07 隔离服务文档](./verification/cross-platform/RF-07-ISOLATED-SERVICES.md)
审核。`measure.py` 是独立镜像测量入口；C before 使用的主控冻结测量适配及其证据另列，
不把候选脚本当作已执行。配对收益只引用 `R/runtime/paired-comparison-r1.json`：API
0.1803%、Agent 0.2728%。包含 A 源码的最终 154 文件新镜像另有新 ID 和验收回执，
不与上述 before/after 配对混算收益，不据体积降幅推导冷启动改善。

| 范围                     | 本轮已知结果                                                                                                                                                                    | 权威索引与限制                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A backend5               | 五项 exit 0；678 pytest、3 warnings、78.67%，59% 门禁保持；Review APPROVED                                                                                                      | `R/api/checks-r1/summary.json`、`R/api/REVIEW-r1.md`；仅批准 A 冻结输入                                                                                                                                                                         |
| B frontend10             | 十项 exit 0；1098 Vitest、21 build-script、69 Fake API、8 types；双浏览器 173 clean + 1 flaky = 174                                                                             | `R/ui/quality-fixed-r1/summary.json`、`R/ui/quality-fixed-r1/10-e2e/command.log`；旧 settings-drawer 文件 goto 首试超时，重试通过，归因未定                                                                                                     |
| C 工具三项               | 格式/lint/19 unittest 均 exit 0，显式绑定上述 pyproject                                                                                                                         | `R/runtime/c2-project-quality-checks-r1/summary.json`；不属于旧 15 项                                                                                                                                                                           |
| C1 隔离服务              | Review APPROVED；真实 uvicorn TCP 的 container-http，宿主 18800 未通；Worker 137                                                                                                | `R/runtime/c1-review-r1.md`、`R/runtime/c1-r1/exercise/result.json`；见 §3.2                                                                                                                                                                    |
| 最终组合功能 16 项       | 前端除 format/e2e 的 8 项 + backend5 + runtime3 全部 process/gate 0；1098 Vitest、21 build-script、69 Fake API、8 types、678 pytest/3 warnings/78.67%、19 runtime，59% 门禁保持 | `R/final-functional-checks-r1/summary.json`；不含 root format 与 E2E                                                                                                                                                                            |
| 最终组合双浏览器         | 173 clean + 1 flaky = 174，process/gate 0；8 条新增 weekly 场景全部通过                                                                                                         | `R/final-e2e-checks-r1/summary.json`、`R/final-e2e-checks-r1/01-e2e/command.log`；同 settings-drawer beforeEach goto 首试 30s 超时、retry 通过，本轮多次出现，归因未定                                                                          |
| 最终 root format         | **pending：待主控最终回执**；首败 exit 1 仅提示两份 A 文档未 Prettier                                                                                                           | `R/final-quality-checks-r1` 保留首败；owner 全部停写后主控统一原生 Prettier、机械 copy、重跑 root format，不能提前写旧 15 项全绿                                                                                                                |
| 最终输入新镜像与真实服务 | 最终 154 后端文件新镜像、完整性、runtime/真实 HTTP 已验                                                                                                                         | `R/runtime/final-measure-r1/receipt.json`、`final-integrity-r1/result.json`、`final-services-r1/exercise/result.json`、`final-services-r1/weekly-http-r1b/result.json`、`final-http-recheck-checks-r1b/summary.json`（后四项同在 `R/runtime/`） |
| 自有资源清理             | 主控确认 C1/C2/final 清理通过；最终 HTTP/cleanup 两项 exit 0；最后产品 PG 正由主控清理                                                                                          | `R/runtime/final-http-recheck-checks-r1b/summary.json`；产品 PG 最终状态以 `R/report.md`、`R/progress.json` 为准                                                                                                                                |

本表为同一 r2 文档收口时点的真实分项结果；最终总报告 `R/report.md` 与
`R/progress.json` 是后续格式、产品 PG 清理及整体状态的最新权威。实施者不运行原生
formatter，也不等待格式结果继续改写；真实 Provider/语音/设备/native 编译/远端 CI
均未验证，停止在 Review，无 commit/push。

### §2.3 2026-11-04 Worker 停机补充轮 runner 与实测

本补充轮新证据根为 `.review/reports/overnight-followup-20261104/`，以下入口由主控使用
本轮新树的独立 Python 3.12 环境、受控 `R/tools`/原只读 `ev.sh`/全局锁代跑。
不使用旧 R 的成功日志或旧 lane 虚拟环境冒充新验证，实施者不安装/执行。

| 检查                | 工作目录               | 命令                                                                            | 环境与边界                                                                              |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Worker 新回归模块   | 新 worker 树 `backend` | `.venv/bin/python -B -m pytest tests/test_analysis_worker.py`                   | 本机主控仅允许 §3.3 新产品测试 PG；仓内 guard 按下述可移植测试库规则验证；无 DB 不 skip |
| Worker 离线时序子集 | 同上                   | `.venv/bin/python -B -m pytest tests/test_analysis_worker.py -k 'not postgres'` | 仅独立定位，不代替上行或完整 pytest；无 Provider 配置                                   |
| 完整后端树          | 新集成树 `backend`     | `.venv/bin/python -B -m pytest --cov=. --cov-report=term-missing`               | §3.3 专用库，59% 门禁保持，主控串行协调                                                 |

所有 Python 入口保持 `PYTHONDONTWRITEBYTECODE=1`；新模块不注册测试进程全局信号。
主控 `R/worker/quality-checks-r1/summary.json` 已验 backend5 全部 process/gate0：
730 pytest/3 warnings/78.43%，59%门禁不变；新 Worker 模块另列52通过。
`R/worker/REVIEW-r1.md` 已批准四文件集成，并确认claim后stop守卫的真实变异被
pending/running断言杀死且还原；实施者未读取私有probe或自行运行检查。

真实 Linux PID1 命令 `python -B -m workers.analysis_worker` 已由主控在新镜像验证：
TERM/INT正常退出0，处理中drain0、超时取消回滚0、明确预置过期后的恢复幂等保持。
镜像/服务索引为 `R/worker/final-measure-r1/receipt.json`、`final-integrity-r1/result.json`、
`runtime-after-r1/{exercise,sigint,inflight}/` 与 `runtime-after-services-checks-r1/summary.json`
（后面三个路径同在 `R/worker/`），详细边界见 RF07 隔离服务文档。
这是Worker范围实测；最终组合 frontend10/backend5 与 runtime3 仍以新 `R/report.md`
为准，不因单项通过取消完整检查，不把旧结果或宿主子进程替代Linux PID1证据。

仓内 Worker 回归不能把一次性本地日期库名写成 CI 的唯一目标。guard 仅接受显式
PostgreSQL/asyncpg、loopback host、有效显式端口、非空 user、以独立 test/pytest token
命名且不含 QA/production 等环境标记的数据库，拒绝额外 URL query；缺省/非法目标在
连接前失败、不 skip/读 dotenv。SQL 再核 current_database/current_user 与已验证 URL
相同，server15.19/c06仍固定。当前 CI 的 localhost:5432、user echotalk/db echotalk_test
因此可移植；正例测试只解析地址、不在本机创建或访问5432。主控本机许可仍严格只有§3.3。

## §3 测试库与安装边界

用户已授权专用容器 `echotalk-cp00-pg`（postgres:15.19-alpine），仅监听 `127.0.0.1:55432`，库 `echotalk_cp00_test`。密码仅存在本地受保护 runtime，不提供给外部 Agent。CP-00 空库迁移至 `b3f1c8e92a10`；后续仅后端 B 线使用此库，A/C 不连接数据库。
CI 的临时 `localhost:5432/echotalk_test` 仅是 CI 契约，不能推断本机同地址可安全使用。
仓库 Compose 的 `echotalk` 是应用库，不允许用于测试。禁止读取或复制主 checkout 的 `.env` 来寻找可用库。

确认后应在本节追加每条 lane 允许的 container/host/port/database，密码不写文档。
执行前核验服务身份、数据库名、迁移版本；并发后端 lane 使用不同库，迁移由单一所有者串行管理。
`DATABASE_URL` 缺失时不启动 pytest，避免配置模块回退根 `.env` 或默认应用库。
不得通过假地址、Mock 开关或删除集成测试把测试树制造为全绿。

既有各隔离 worktree 的前端 frozen 安装授权保持不变；本次 Python 锁定与 frozen 安装授权仅限当前 cp00 及其受控环境（A36 `.review/rf07-venv`、A37 `.review/rf07-a37-dev-venv` 与 `.review/rf07-a37-runtime-venv`），不扩展到其他 lane 或服务环境。Python 依赖可复现性改造（RF-07）已完成本地 Dev 组受控拆分：后端作为标准 Python 3.12 uv 项目锁定 192 个包（26 runtime + 4 dev，172 项 baseline 重叠版本与 LiveKit 7 项 exact SDK 版本严格不变）；依赖安装对齐 CI（`--group dev`）与 Docker（`--no-dev`）源码配方，通过受控工具在隔离环境验证。远端 Linux/Docker 实际镜像构建仍待后续独立验收。
不借用主 checkout 的 node_modules/venv 冒充新 lane 的独立依赖环境。

### §3.1 2026-11-03 三线任务与组合验收专用边界

本节仅追加本批已授权边界，不替换上文历史授权，不将执行权限交给受限实施节点。
凭据仅由主控在受保护 runtime 中保管；实施节点不得读取 cp00 runtime、dotenv 或密码。

| 工作线       | 授权 worktree                                                                     | 主控可用测试库                                                                                               | 执行限制                                                                                      |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A 与最终组合 | `/Users/sunpcm/code/EchoTalk/.review/worktrees/diagnostics-export-20261103`       | 原 `echotalk-cp00-pg` / `127.0.0.1:55432` / `echotalk_cp00_test`                                             | 仅完整 pytest 测试写入，不迁移；沿用原 cp00 协调锁；最终组合在 A 执行完整 frontend10/backend5 |
| B            | 本批 B lane（本节不增加其文件写入权限）                                           | 无                                                                                                           | 仅前端/原生检查，不连接数据库                                                                 |
| C            | `/Users/sunpcm/code/EchoTalk/.review/worktrees/linux-runtime-acceptance-20261103` | 新 `echotalk-keyfree-20261103-pg` / `127.0.0.1:55443` / `echotalk_keyfree_empty`、`echotalk_keyfree_upgrade` | 与 55432 库独立；仅主控审核脚本与迁移后代跑，运行于全新内部网络                               |

C 固定 PostgreSQL `postgres:15.19-alpine`，资源 label 为
`codex.scope=echotalk-keyfree-20261103`。不得复用任何已有应用库、QA/生产库或其它 lane 的库，
不得读取/复制真实用户数据。密码由主控随机生成，仅写本任务报告下受保护 runtime，
不进文档、命令回显或报告。主控核验容器 ID、label、镜像、内部网络、端口绑定与 SQL 数据库
身份后才运行。初始迁移含 `DROP ... CASCADE`，从 base 开始前必须 SQL 确认全新专用库
不存在业务表/用户对象；发现对象立即拒绝，不清表、不 downgrade、不复用部分失败库。
旧版本合成演练固定 `c03_call_leases → c06_transcript_events`，只覆盖该前置状态。
迁移审查与输入 hash 在本批 C 报告 `migration-review.md`、`migration-inputs.json`；
审查记录不等于脚本或服务已获执行放行。C 实施节点只准备文档/工具，不运行测试、安装或服务。

### §3.2 2026-11-03 夜间产品与运行时专用边界

本轮源码基线为 `0e09f5e7f3c16b5bb6562632880003e59369e372`。产品测试只允许新容器
`echotalk-overnight-20261103-test-pg`，镜像 `postgres:15.19-alpine`，绑定
`127.0.0.1:55444`，用户和数据库均为 `echotalk_overnight_test`。仅 A lane
`overnight-progress-api-20261103` 与主控组合 lane `overnight-product-runtime-20261103`
共享同一协调锁串行使用；实际测试、安装、迁移及服务操作均由主控受控代跑，实施者不执行。

运行时只允许新容器 `echotalk-overnight-20261103-runtime-pg`，同一 PostgreSQL 镜像，
数据库 `echotalk_overnight_runtime`，仅接本轮全新 internal 网络，不发布 PG 端口；
隔离 API 仅绑定 `127.0.0.1:18800`。所有资源必须带
`codex.scope=echotalk-overnight-20261103`。创建前核对名字和端口未占用，不能停止或复用
占用资源；若主控选用已授权候选产品端口 55445..55449 或 HTTP 18801..18809，须先追加
精确 manifest 和本节边界，再创建资源。禁止启动原 Compose 或连接应用库、QA、生产、
其他 lane 的库，禁止复制真实用户数据。

凭据只由主控随机生成并保存在本任务 R/protected（目录 0700、文件 0600），不进源码、
命令回显或报告，A/C 实施者不读取。空库迁移必须先独立审查迁移输入，再用 SQL 核验
专用数据库身份、业务表及用户对象均为空；发现对象即拒绝，不清表、不 downgrade。
主控同时核验容器 ID、镜像、label、网络、端口绑定和迁移版本。以上为授权边界，
本轮执行事实与限制见下文；新增 runner 清单及验收索引见 §2.2，不由旧 15 项自动覆盖。

2026-11-04 主控执行事实补充：初次产品 PG 仅接 internal 网络，虽有 HostConfig 端口配置，
实际 `NetworkSettings.Ports` 为空，宿主 55444 连接被拒绝；该失败阶段没有执行迁移，
失败 SQL 回执保留。主控随后将同一本轮专用 PG 接入新独占普通 bridge
`echotalk-overnight-20261103-product-host`，核验不可变容器 ID、scope、镜像与实际端口，
仅发布 `127.0.0.1:55444`，并按 ID/scope 核验后断开、移除本轮旧 internal 网络。
本次产品 PG 网络修正不用于 C；C 运行时强制 internal 的边界不放宽。

回执根 R 为主 checkout 的 `.review/reports/overnight-product-runtime-20261103/`。
`R/setup/product-pg-resource-r1.json` 与 `R/setup/product-network-review-r0.md`
记录资源和审查；
`R/setup/product-db-empty-before.json` 记录库/用户均为 `echotalk_overnight_test`、
PostgreSQL `150019`，业务 relations/types/functions 均为 0、无 Alembic 版本；
`R/setup/product-db-migrated.json` 记录主控迁移后版本 `c06_transcript_events`。
这些是已读取的主控执行回执，实施者没有独立连接或执行 SQL/迁移。
产品 PG 协调锁根仍为 `/Users/sunpcm/.local/state/review-loop/locks`，
资源锁为 `R/resource-locks/product-db`；本轮 `backend_action.py` 严格限定 loopback 55444。
本轮新增 runner 精确清单见 §2.2，按新 RF-07 文档由主控审核执行，旧 15 项不自动覆盖。

C1 实际边界：运行时 PG 用户/库均为 `echotalk_overnight_runtime`，只在本轮全新
`echotalk-overnight-20261103-runtime-<run_id>` internal 网络内，PG 使用 tmpfs 且不发布端口。
provision 要求关系、类型、函数及额外 schema 四类用户对象计数均为 0，主控另审迁移后
独立批准 exercise；非空即拒绝，不清表/downgrade。C1 主控回执确认 base→c06，
只授权本轮隔离资源，不连接产品 PG、应用、QA、生产或其他 lane。

API 使用真实 `uvicorn main:app --host 0.0.0.0 --port 8000`，主控以 `container-http`
在 API 容器内经 `127.0.0.1:8000` TCP 请求；health 200、匿名 sessions 401、缺 Key 的
ready 503 已验。宿主 `127.0.0.1:18800` 的
`host_loopback_health_verified=false`，internal 约束保持，不承诺宿主用户入口可达。
真实 Worker 只证明主控预置过期任务的恢复与幂等，不外推任意崩溃或真实 Provider。
`R/runtime/c1-r1/exercise/result.json` 中三个 Worker 均 stopped、退出 137，API stopped、
退出 0；Worker 未证明优雅关闭。该历史 exercise 回执中 PG 曾保留待清理；主控本次交接
已确认 C1/C2/final 自有资源后续清理通过，final 的 cleanup exit 0 另见
`R/runtime/final-http-recheck-checks-r1b/summary.json`，不以 exercise passed 代替清理证据。

最终 154 文件新镜像的真实服务与 weekly HTTP 也已通过，仍保留三个 Worker 137/API 0、
`host_loopback_health_verified=false`，不改变 internal/宿主端口边界。真实 weekly HTTP
独立验证 7 桶、2 个 completed、23h DST、两页各 1 条历史、换窗口 cursor 422、非法时区
422 和匿名 401；GET-only，不与 Fake API 浏览器场景混称一条真实语音链路。
prepared stale 仍仅证明显式准备过期任务的恢复及幂等。主控正在清最后产品 PG，
本节点不自行核验或写为已清；最终 root format 回执和产品资源状态以 `R/report.md`、
`R/progress.json` 为准。

### §3.3 2026-11-04 Worker/WebKit 补充轮独立资源边界

本节只增加用户已授权补充轮边界，不授权任何实施节点执行安装、测试、服务或数据库。
本轮三个新树为 `overnight-followup-{integration,worker,ui}-20261104`；唯一 Worker owner
树为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/overnight-followup-worker-20261104`。
32文件已审 seed 是合法 dirty 输入，原任务四树、main/next2、旧 R 与旧资源保持只读。

| 用途                            | 全新 PG 容器                            | 用户 / 数据库                                             | 端口与唯一网络                                                                      | 存储与标签                                                                    |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Worker PG 回归及最终完整 pytest | `echotalk-followup-20261104-test-pg`    | `echotalk_followup_test` / `echotalk_followup_test`       | 仅 `127.0.0.1:55444`；独占普通 bridge `echotalk-followup-20261104-product-host`     | `/var/lib/postgresql/data` 用 tmpfs；`codex.scope=echotalk-followup-20261104` |
| 真实 API / Worker CLI 验收      | `echotalk-followup-20261104-runtime-pg` | `echotalk_followup_runtime` / `echotalk_followup_runtime` | PG 不发布端口；独占全新 internal 网络 `echotalk-followup-20261104-runtime-internal` | 同一 PG 数据目录用 tmpfs；同一本轮 scope 标签                                 |

两套 PG 均为 `postgres:15.19-alpine`；执行前由主控核实际本地不可变 image ID 并冻结到
新 R 资源 manifest，不能只信 tag 或复用旧回执。创建前查名字、端口和网络未占用，冲突
直接拒绝，不停止/改名/连接占用资源，不复用已存在的同名 PG。测试与迁移在主控同一
协调锁下串行；Worker 与最终集成的 pytest 不并行消费共享库。

runtime API 只请求 `127.0.0.1:18800` 发布，优先真实 `container-http` TCP 验收；
internal 网络下宿主端口不可达时单列 false，不加可出公网网络，不用 ASGI 内调用冒充 HTTP。
本轮任何端口/资源替代必须先由主控冻结精确新 manifest 并更新本节，再创建资源。

凭据只由主控随机生成于新 R/protected（目录0700/文件0600），实施者不读、不复制旧
protected/真实dotenv/Provider模板，不把值写入命令行/日志。本机 R 受控适配必须在执行前
严格固定 `127.0.0.1:55444`、user/db `echotalk_followup_test` 及本节精确容器/镜像/
scope/网络身份；`DATABASE_URL` 缺失或不符即拒绝启动，不 skip/回退默认应用库。
仓内测试guard按§2.3兼容显式loopback测试库，并在SQL中复查身份；该可移植规则不扩大
本机执行许可，不允许通过给其他test库URL绕过主控R适配。当前CI地址仅纯解析正例，
不授权本机访问5432、其他user/database或现存测试资源。
禁止连接原 cp00、旧轮产品/运行时 PG、应用/QA/生产或其他 lane 的库；仅用新合成数据。

主控先亲读全部迁移文件及其 SHA，再独立 SQL 核 server15.19、database/user、数据库
OID/`system_identifier` 与关系/类型/函数/额外 schema 四计数为空。系统 schema 用精确
`pg_` 前缀排除，普通 `pgx` schema 必须计数；任一用户对象非空即拒绝，不清表、downgrade
或复用半失败库。初始迁移含 DROP CASCADE，必须独立审批后才 base→c06，并核实际revision。
PG 新回归只删除自身随机 fixture 的记录；不修改业务 stale/重试/租约语义来清状态。

收尾只按本轮不可变容器/网络 ID、scope、镜像和网络归属核验后清理，不做 global prune。
`R/worker/implementer/db-boundary-ready.json` 仅标记本节资源边界及当时手册 SHA 已准备，
不是整体停写/执行批准。主控可只读手册准备新资源，不能冻结、编译或测试仍在写入的源码。

本轮 runtime 矩阵与其专用资源清理已由主控验收，见
`R/worker/runtime-after-services-checks-r1/summary.json` 及
`R/worker/runtime-after-r1/cleanup/cleanup.json`。产品测试PG仍保留给最终pytest，
不能据此写本轮全部资源已清或最终组合全绿；后续整体状态以新 `R/report.md` 为权威。

## §4 生成产物及验证

| 产物                        | 源                             | 原生检查/边界                                                         |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Vite dist                   | TS/React、构建环境             | tsc/typecheck + build；产物不提交，环境切换后重新构建                 |
| Capacitor public/config/SPM | webDir、Capacitor config、依赖 | 先核验 build/sync，再做 Xcode 编译；不手改自动生成的 SPM 配置规避错误 |
| Alembic revision            | ORM/显式 schema 变更           | 审查迁移脚本；专用空库升级/current 及相关集成测试                     |
| API 类型                    | 受跟踪的 OpenAPI schema        | 生成后仍需 typecheck 和契约测试；schema 与 types 两层漂移检查进入 CI  |

## §5 证据与报告

每条验收命令经主 checkout 的 `.review/reports/tools/ev.sh` 执行：

```bash
/Users/sunpcm/code/EchoTalk/.review/reports/tools/ev.sh \
  /Users/sunpcm/code/EchoTalk/.review/reports/cp00/implementer/ev \
  01 'git status --porcelain -b && git log --oneline -1'
```

脚本是项目兼容副本：三参数调用保留流式输出、pipefail 和命令真实退出码，不能用共享
legacy 的 tee 状态代替。显式 `--quiet` 才只回显日志末尾；完整 stdout/stderr 和真实
`# exit` 仍落盘。执行前拒绝已有文件、目录、软链接（含悬空链接），同目录同编号只允许
一个调用执行命令；创建或日志写入失败必须非零。旧调用无须添加 quiet。
两种模式先保存命令真实退出码，再在原始双流字节后额外写一个 LF 和独立末行 `# exit=N`；
已有尾换行或空输出会多一个分隔换行。原始二进制字节不删改，旧历史日志保持原样。
记录 cwd/HEAD/dirty、命令、时间、完整输出与真实退出码；不输出环境全集、凭据或用户内容。
重跑使用新编号并写明原因。报告可写数字，但每个数字必须指向对应 ev 原文；禁止手填通过数。

报告至少包含：实际基线；改动清单/意图/hash；验收映射；每棵测试树结果/ev 路径；
测试库边界；迁移前后版本；未做/未验证；需要裁决的问题。
区分既有代码失败、依赖缺失、未授权环境和本轮回归。交付后不再改动，等独立 Review。
评审结论为 APPROVED 或 CHANGES REQUESTED；缺外部证据时明确保留对应门禁未通过。

后续 prompt 与报告同时列出以下字段；不改历史报告和通用工具 receipt schema：

| 字段                    | 必填内容与证据限制                                                      |
| ----------------------- | ----------------------------------------------------------------------- |
| `execution_mode`        | 实际执行方式，例如主节点前台、原生子 Agent 或 CLI；不表示进程是否仍运行 |
| `source_writes_stopped` | 是 / 否 / 未知，分列实施方声明和独立稳定字节观察                        |
| `task_processes`        | 本任务范围未发现残留 / 仍运行 / 未知；评审待办不是进程                  |
| `known_session_ids`     | 已知工具 session/进程身份及状态；不可查询写未知，空列表不是 OS 全量核验 |
| `evidence_basis`        | 分列节点声明、完成事件、工具退出记录、独立观察及各自证据路径/hash/范围  |

没有实际 OS 退出记录就记未知；合成 failure marker 与超时门禁码不充当真实进程退出码。
主节点能执行也不能证明原生子节点可执行：派发前分别核固定入口、报告目录和原共享锁根
的实际权限；受限实施方继续由获授权主控代跑验收，不扩权限或换锁根。

## §6 并行边界与集成

CP-00 是准备轮，不启动产品修改。后续接口定案后按以下所有权并行：

| lane | 第一批范围               | 禁止跨改                               |
| ---- | ------------------------ | -------------------------------------- |
| A    | CP-01 平台/地址/构建同步 | 后端、原生认证、会话状态机             |
| B    | CP-02 后端幂等/恢复契约  | 共享前端和平台构建配置                 |
| C    | CP-03 macOS 最小验证     | 正式共享前端、正式桌面工程和依赖锁文件 |

API 契约由架构评审先确定；`lib/api.ts`、`conversation.ts`、`VoiceInterface.tsx` 每轮唯一写入者。
`pnpm-lock.yaml`/package.json 由指定负责人修改；数据库迁移只由 B 维护。
E2E 默认端口只允许一条 lane 使用；要并发须先实现并核验独立端口配置，不能仅设置无效环境变量。
Xcode 的 DerivedData、构建输出和音频设备占用同样隔离；真机与麦克风验收串行排程。

认证线与恢复线可分别开发，认证状态接口先冻结；最终退出清理、401 和恢复采音联合验收。
每条 lane 单独 Review 后再集成，集成后的完整三端验收串行执行；各 lane 测试通过不能代替组合验证。

## §7 已知坑与准备轮发现

- 本地 main 与远端分叉：先钉住双方 HEAD 和文档，禁止 pull/reset 覆盖本地计划；新 lane 从核实远端开始。
- 旧主目录依赖不完整：typecheck 报 oidc-client-ts 缺失，Vitest 的认证/API suite 无法收集；这不是跨端代码回归。
- 旧主目录 Python 虚拟环境只有解释器，缺 pytest/ruff；安装和数据库边界确认前不能宣称后端通过。
- 根 Turbo 命令可能回放缓存；基线质量门禁使用 --force，真实测试 runner 直接执行。
- 原 ev.sh 仅打印失败退出码但管道可能返回成功；本地副本已保留真实退出码，需用失败探针验证。

## §8 CP-00 通过后的执行事实与下一批

2026-10-21 CP-00 独立评审 APPROVED；原始报告及证据仅在本地 `.review/reports/cp00/`。Vitest108、pytest184（75.86%）、Chromium Fake API E2E6通过；后者不代表真实登录和语音。iOS设备/OS证据待补。

用户确认独立 macOS 应用，先做 Tauri 2 spike；授权在 C 线隔离安装最小 Rust/Tauri，不改全局 PATH、根锁文件和既有 iOS。麦克风、真实登录及发布另行验收。

用户授权 agy/Gemini 3.8 Flash Medium 处理 A/B/C 必要源码、配置、测试及本地 prompt，排除 .env/密钥/凭据/用户数据。CP00临时命令授权已撤回；下一批采用仅文件实施，由评审端执行已授权固定验收，不新增通用命令权限。

下一批缩小为：A 平台与地址纯逻辑及回归测试；B 结束接口幂等与回归测试；C 独立本地 Tauri spike 脚手架。A 的构建隔离、B 的创建幂等/设备租约仍在后续轮次。三线不修改共享锁文件；逐线评审后再集成。

坑：代理只用于需要外网的CLI/安装；本地pytest子进程移除HTTP(S)/ALL_PROXY，避免HTTPX SOCKS额外依赖；不要改产品代码掩盖环境问题。报告只引用真实路径及runner统计，禁止猜测试名或逐文件数量。

## §9 本地持续授权与首批集成

用户已明确要求本轮代码修改、质量检查、专用测试库操作不再逐条请示。agy权限仅放行评审维护的固定入口 `.review/reports/tools/cross-platform-local-check.py <lane> <step>`；分支/步骤须匹配，不接收任意shell/SQL。配置已备份，按本任务记录增量规则，完成本计划后撤回，不覆盖其他配置变化。实测agy运行B线lint成功、无拒绝。此为工作流权限，不是OS安全沙箱；含数据库凭据的测试须先由评审读代码。

允许边界：指定worktree代码和测试、已授权现有依赖安装、质量门禁、既有本机FakeAPI E2E、专用echotalk-cp00-pg库；禁止应用/生产库、秘密泄露、远端push/merge/deploy及真实IdP/Provider写入。编译/iOS同步不包含签名、Xcode联网或真机。新增依赖、外部服务与产品决策仍按既有授权判断，超范围才停。

2026-10-21首批A1/B1合入自建 `codex/cross-platform-integration`（主checkout和远端均未变）：独立前端147、后端200、Chromium E2E6及格式/lint/类型/双构建通过。C原型本地试音由用户确认有声且释放音轨；详细边界见CP-03。下一批A2/B2先遵守架构文档§8冻结契约，再并行实施。

## §10 节约主评审额度模式

本轮工作流升级后，后续已授权任务按 `docs/REVIEW_LOOP_AUTOMATION.md` 的“优先节约 Codex 额度”执行。agy 负责实现和预算内的常规排错；Codex 集中确定契约、评审及独立验收。实施方可调用既有固定入口的 `<lane> quality` 一次运行检查；底层仍经过各步骤的分支和测试库门禁，不接受任意命令。检查成功不代表独立评审批准；源码/证据冻结、有限返工和产品决策交互规则继续有效。

本次只升级工作流，认证线里程碑后的业务派发仍处于停止状态，不能因本节自动恢复旧任务。当前实测仅证明固定清单接线和本地门禁测试通过，尚未证明 Codex 净额度收益。

## §11 可靠启动与正式恢复

后续自动任务在启动模型前执行本地固定入口`<lane> preflight`及`<lane> baseline`，维护审查过的HEAD/runner配置。实施方引用预检基线与固定命令，不猜Git启动命令、不绕权限拒绝。快速门禁前置，完整quality与独立评审保留。使用通用skill的`amend-budget`/`reparse-delivery`和有限agy解析器，不手工改账本或消费计数；具体边界及本地验证见`docs/REVIEW_LOOP_AUTOMATION.md`“2026-10-22可靠性修复”。本次仅升级工作流，不自动恢复已结束任务。

## §12 A8双前端工作线执行事实

2026-10-22从共同fc9540e分别使用track-a（占用控制器）与track-b（Web生命周期），各自分支、文件清单、agy会话、账本与预算。B工作线本轮转换为前端任务，旧后端分支与虚拟环境保留；固定入口b质量检查已按新分支配置，不再调用旧后端测试动作。两线不改共享API/store/UI或锁文件。

两线各经独立返工与APPROVED，B先集成、A后串行merge，组合完整门禁通过。测试库由评审单独串行回归，不交实施方凭据；浏览器端口与变异/源码消费者串行。运行摘要用控制器nonce传递确定子batch路径，不扫描“最近文件”推断归属；账本锁不是worktree锁，仍由主调度者避免重复派发。

用户中断宿主后A原控制器继续运行；继续前核对进程身份、账本和源码，未重复启动。此为保留运行现场的事实，不等同支持远端取消或无人值守恢复。工作流新问题见本地报告，不自动扩展全局skill。

## §13 检查范围与布局任务

新批次按review-loop的check_scope核对检查类型、预期/实际ID和逐项状态；baseline全绿不等于quality全绿，旧摘要范围缺失时需读取绑定manifest/summary。布局任务选择使用[本地布局清单](./verification/cross-platform/UI-LOCAL-CHECKLIST.md)，真实文字范围与元素内容框分别核验。新控制器和拒权早停边界见[自动流程手册](./REVIEW_LOOP_AUTOMATION.md)的2026-10-24优化记录；不据本文自动恢复已完成账本。

## §14 PR #98 后的当前拓扑（2026-10-24）

本轮实时核验本地/远端 main 为 `80fb8ec`，仅保留主 checkout 与 `.review/worktrees/cp00`；旧 track-a/b/c 已归档，前文路径/分支/服务状态均为带日期的历史事实，不能直接恢复使用。A27 仅在 cp00 的 `codex/cp05-reduced-motion` 实施，主 checkout 在评审通过前保持只读。

现有固定 runner 的 b 角色已由评审重绑 cp00、本轮明确分支及已审查 HEAD；`.review/reports/track-b/` 仅复用历史证据目录名称，并不代表旧 worktree 仍存在。每轮继续维护 runner/baseline/hash，禁止仅改目录名绕过预检。后端仍仅由评审运行 cp00 专用虚拟环境及隔离测试库 helper。

## §15 RF-11 OpenAPI schema 与 TypeScript 类型门禁（2026-11-01）

- canonical schema：`backend/openapi.json`，只能由 `backend/export_openapi.py` 在隔离子进程中调用真实 `main.app.openapi()` 生成；禁止手改。`.prettierignore` 排除该文件，以插件字节一致性作为原生检查。
- schema 生成：`cd backend && ../.review/rf07-a37-dev-venv/bin/python export_openapi.py`；生成后检查：同解释器追加 `--check`。父进程不得携带应用 dotenv/凭据，子进程只接收合成非业务配置，并在导入业务前阻断 DNS/socket。TMP/TEMP 与 XDG 目录受控，但不重设 `HOME`；导入 config 前通过文档化 `BaseSettings` 构造参数禁用 dotenv/file-secret，再以真实 `settings_customise_sources` 签名仅保留 init/env。真实子进程 120 秒超时，异常仅输出阶段/类型并在父进程再次校验；全部 probe/test 子进程也有有限 timeout。
- TypeScript 类型：`apps/vite-app/src/lib/api.generated.ts` 只能由 `openapi-typescript@7.13.0` 从上述 JSON 生成；生成命令为 `pnpm --filter vite-app generate:api-types`，漂移检查为 `pnpm --filter vite-app check:api-types`。
- lock 更新：RF-06 已删除 Webpack/ui-lib/Plop/Changesets workspace 消费者，因此
  `pnpm-workspace.yaml` 不再保留 Webpack 专属 peer override；generator 所需的
  `type-fest@4.41.0` 及精确 `openapi-typescript@7.13.0` 仍须保留。lock 由主 Agent 在
  实施停写后使用 Node 22、pnpm 10.26.0 与
  `pnpm install --lockfile-only --prefer-offline --config.dedupe-peer-dependents=false`
  原生重生成，再执行 offline frozen install；不把 dedupe 开关写入全局或 workspace 默认。
  验收要求所有存活 packages 的 version/integrity、保留下来的解析依赖边与 importer 不变；
  被删除 workspace 的 importer 及其独占依赖可移除。原生 metadata 变化仍须逐项独立审查，
  A73 的已审例外仅为 6 个精确 optional metadata 字段由缺省状态新增为 true（原生锁新增
  该字段），以及 1 个无消费者 catalog 锁项移除；这不是任意 metadata 漂移的通用放行。
  最终文件须经正常 Prettier 规范化后以 hash 冻结并复验，禁止手写 lock 或承受未审漂移。
- 新 Node 真实 runner：`pnpm --filter vite-app test:api-types`，覆盖确定性、stale 不写、remote/越界 `$ref`、缺产物、输出失败及真实 CLI 检查。
- 后端新增离线导出回归：`cd backend && ../.review/rf07-a37-dev-venv/bin/python -m pytest tests/test_openapi_export.py`；CI `test-backend` 另在 full pytest 前执行 schema `--check`。
- 两层职责：backend job 验证实际 FastAPI schema 未漂移；frontend job 验证 schema 到 TypeScript 字节未漂移并运行生成器测试，不安装 Python 全栈。
- 更新流程：修改 HTTP schema 后，由受控主 Agent 先执行 Python 导出，再审阅 JSON diff，执行 Node 生成，最后运行 `check:api-types`、typecheck、生成器测试和完整测试树。任一失败都保留旧已审产物，不把部分写入当成功。
- A67 当前已验状态（2026-11-01）：本地独立 Review APPROVED，定格于单提交
  `1321bbe43ac540cacb75ea3845ac381076a7c637`，main 精确 fast-forward。完整前端
  quality10 通过（Vitest 907 项/32 files、Node 构建测试 18 项、Fake API 61 项、类型生成器
  8 项、Chromium+WebKit E2E 148 项）；专用 PostgreSQL 全 pytest 为 540 passed/3 warnings、
  79.41%，子进程 coverage 未合并、59% 门禁保持；两项 stale 变异被 killed 并完整还原源码。
  未 push/部署，远端 CI、真实 IdP/Provider/LiveKit 与设备仍未验证。

## §16 RF-10 Provider 展示元数据生成门禁（2026-11-01）

- 单一来源：`backend/provider_catalog.py` 是不可变 Provider 展示元数据来源。`role`、
  `label` 和默认标记随对应 Provider 条目维护，展示字段必须有默认值以保持既有 dataclass
  构造兼容；禁止在 exporter、adapter 或组件中再维护 id、label、默认选择映射。
- canonical 产物：`apps/vite-app/src/lib/providers.generated.json` 只能由
  `backend/export_provider_metadata.py` 从真实 catalog 生成，禁止手改。投影白名单仅包含
  `role`、`id`、`label` 及每个 role 的一个默认 id；不得透出 URL、凭据字段、Headers、
  校验配置或其他内部运行字段。`.prettierignore` 精确排除该产物，由生成器字节检查守护。
- 生成命令：`cd backend && ../.review/rf07-a37-dev-venv/bin/python
export_provider_metadata.py`；漂移检查追加 `--check`。父进程只加载标准库，真实 catalog
  导入、投影与序列化在带有限 timeout 和网络失败关闭屏障的隔离子进程中完成；输出采用
  UTF-8、排序 key、2 空格缩进、末尾换行并通过同目录临时文件原子替换。
- `--check` 只比较完整字节，缺产物或 stale 均非零且不写文件或目录；生成、超时、子进程
  异常和替换失败不得破坏已有产物，异常输出只允许阶段与异常类型。后端回归覆盖真实 CLI、
  稳定字节、缺失/stale、原子失败、导入纯净和敏感字段零透出。
- CI 接线：`test-backend` 在既有 OpenAPI schema 检查后显式运行
  `.venv/bin/python export_provider_metadata.py --check`。`test-frontend` 不安装 Python；
  前端通过 `providerMetadata.ts` 消费 tracked JSON，不新增 fetch、缓存或 session 支线。
- 本地固定 runner 在实施停写后新增独立 `provider-metadata-check`；现有 frontend10 与
  OpenAPI schema 门禁保持原项，不能把本轮 metadata check 追溯写成旧轮已执行。
- 更新流程：修改 catalog 展示字段后，由受控主 Agent 在实施停写后先审查 exporter，再执行
  原生生成、审阅 JSON diff，最后运行 metadata check、Ruff、相关 pytest、前端 typecheck/
  Vitest、完整 frontend10 与 backend 测试树。生成文件提交前不得手写或交给 formatter。

## §17 局部工具接线与批准任务数据（2026-11-01，待独立 Review）

本节只描述本次工具接线候选，不授权恢复 A85 或其他业务。实际交付状态、最终 hash 和
当前增量交付在主 checkout 的 `.review/reports/skill-wiring-20261101-53cb562/implementer/r1/`；
已评审 r0 记录仍在 `.review/reports/skill-wiring-20261101-68c0632/implementer/r0/`，保持原样。
两份仓内文档在独立 `codex/review-loop-local-wiring` worktree 修改，main/cp00 保持只读。
共享 skill 经本地差异复核后固定于 `53cb562160d9a29f0ca560efff765a2c35e98832`；公共预检及
loop_gate hash 与 r0 相同，仅接入 ev 分隔格式。固定 runtime 及其
runtime-pin、bounded_step、DB helpers、旧任务指针和 A84 脚本不升级或改写。

### §17.1 稳定入口和审批链

固定 CLI 仍是 `.review/reports/tools/cross-platform-local-check.py <lane> <step>`。
稳定入口先校验新 helper hash，再由 helper 校验工具、共享预检及固定 runtime。
新配置命名空间是 `.review/reports/tools/review-loop-local-wiring/`，由评审方维护：

- `config.json` 固定实际工具 hash、共享 HEAD/预检脚本 hash、原 runtime-pin hash 和
  新 `tasks.json` 路径；仅更新确有变化的工具 pin，不回写旧 `review-loop-launch-baselines.json`。
- `tasks.json` 的 a/b/c 初始均为 null：真实入口拒绝执行，不能把旧任务视为自动激活。
  评审方批准新任务后才发布指针，绑定 task、manifest/approval 的绝对路径及 SHA256。
- 每轮 manifest 使用独立新文件，绑定 schema/task/lane/worktree、批准 branch/HEAD、
  `require_clean`、`allowed_files`、`formatter_files`、`allowed_steps`、`quality_ids`、
  `required_checks`、report_root、launch_mode、source_writes_stopped；按需列
  expected_fingerprint、带 hash 的 artifacts 与 integration_target。
- 独立 approval 以 `approved_for_execution` 绑定 manifest SHA、source_fingerprint、
  评审依据文件路径/SHA；审批不可由 runner 读取当前 Git 状态自动补造。dirty 使用明确 bool
  false 和独立批准的合法 expected_fingerprint；未填、字符串 false 或不符均拒绝。
- 检查完成后，新 approval 用 `check_summaries` 显式选择 summary 路径/SHA；不扫描最新成功
  日志，也不为补证据修改原 manifest。正式 audit 要求15项齐全、逐项真实退出/完整计数、
  日志 hash 及源码/manifest/config/tool hash 均匹配最终输入；只有字节冻结仍不能通过审计。
- allowed_files/formatter_files 是文件级相对路径，formatter 范围必须为修改范围子集。
  Git `-z` 清单保留空格，重命名源/目的分别确认；未跟踪文件也核范围。拒绝路径越界、
  软链接及解析后越界，不接任意 argv、SQL、环境变量或目录范围扩张。

检查前以及持锁后都核任务、manifest/approval/tool hash、分支/HEAD、dirty 范围和批准指纹，
失败不启动命令。formatter 仅接批准且实际变更的现存文件，删除文件不传 formatter；
执行后字节变化会使旧审批失效，必须由评审方审阅最终 diff 后另建批准文件和指针。
生成产物同样完成原生生成/检查后再冻结，不能用 formatter 前回执验收最终字节。
生成准备写入只豁免 `api-types-generate`、`provider-metadata-generate`、`schema-export`；
它们仍核允许范围、配置/hash、分支/HEAD、锁及停写声明，真正非零保持非零，越界仍拒绝。
其余只读检查即使仅改变 allowed_files 内字节也拒绝，不把整个 EXTRA 列表视为写入许可。
三项生成准备在命令启动前将输入 approval 的消费回执写入 report_root/preparation-inputs；
即使无字节变化、非零或中断，旧批准也不能再检查、freeze/audit 或执行依赖后步。该回执
不改 manifest、approval、指针或 expected_fingerprint，不代表批准输出；由评审方审阅 diff
后另建最终字节批准才可继续。普通格式化步骤原有的字节变化后重批规则保持。

### §17.2 固定检查与通道

`b quality` 保持 frontend10：format、lint、typecheck、test、build-script-test、
fake-api-test、api-types-check、api-types-test、build、e2e。完整验收另需 backend5：
backend-format、backend-lint、backend-test、schema-check、provider-metadata-check。
baseline 不冒充完整验收；有依赖步骤按真实非零立即停止。有效测试须有非零计数和完整摘要，
零测试、摘要无效、skip/error/中断不算通过；退出 1 无有效失败摘要时改为门禁 78，不能
当有效 mutation kill。receipt 分开 command process_exit_code 与门禁 exit_code。

原生预检使用官方 `launch_mode=native`，不携带 CLI 字段；CLI 预检保留既有可执行文件、
权限文件/条目和代理组检查。清单只由固定配置构造，不借通道切换删掉公共门禁。
这只验证主节点本地预检，不证明真实原生子 Agent 权限或交付。

原 DB helper 仍绑定 cp00/专用库；其他 worktree 的 backend-test 在调用 helper 前拒绝，
原 A 线 placeholder helper 同样只允许其原 worktree，避免稳定入口核一棵树却修改另一棵树。
本次不重写 DB helper。独立工具 worktree 不安装业务依赖。E2E 输出使用报告区唯一目录，
C 线保留原离线 cargo 路径/环境。固定入口是协作门禁，不能拦截绕入口的编辑或命令。

### §17.3 冻结、审计和集成护栏

新增 `.review/reports/tools/review-stage.py <lane> <stage> <receipt绝对路径>`，stage 为：

- `freeze`：停写声明与批准输入均通过后，持 lane 锁冻结最终源码、manifest、工具/config、
  runtime-pin 和所列证据 hash。回执状态 `frozen_not_reviewed`，不是 APPROVED。
- `audit`：评审方新 approval 显式绑定 frozen_receipt 路径/SHA 后，持锁复核同一最终输入。
- `integration-check`：另有 `approved_for_integration` 才取得 main/lane 双锁复核目标
  干净、批准 HEAD 及冻结输入；此命令只读，不提交或合并，其退出不构成锁外操作的许可。
- `integrate-fixture`：仅用于临时合成 Git 仓；worktree 和 Git common-dir 均须在临时根，
  拒绝真实 EchoTalk 及其 linked worktree。本轮仅在该入口演示受锁 commit + 精确 ff。

全部复用原 `worktree_lock` 与 `/Users/sunpcm/.local/state/review-loop/locks`。canonical
worktree 路径排序后固定顺序取双锁；高序单锁内申请低序锁会拒绝，避免自锁。可信继承锁
不由子方释放；冲突、异常、未恢复 mutation journal 均失败关闭，新取锁异常时释放。
拥有锁的执行方负责硬超时/进程组；继承锁下的检查保留原 bounded helper 的外层控制语义，
由传入锁的 check_batch/mutate 控制进程组超时，不能脱离外层控制器单独借锁跑长任务。
正式冻结/验收拒绝非稳定输入；普通静态阅读无需全面串行。锁不代替停写确认，也不阻止
直接编辑；变异检查仍需批准的输入版本，指纹不匹配必须拒绝，不得把拒绝当 kill。

真实项目的 commit/ff 仍需后续明确授权，并在 `integration_guard` 同一 context 内完成
复核和动作，禁止先运行 integration-check 再在锁外集成。本轮没有真实集成执行入口。

### §17.4 备份、验证和回退

修改前备份位于本轮报告 `backup/`；`baseline-and-backup.json` 记录原路径、模式和 SHA，
`new-paths.json` 标明本轮新增项。未复制 dotenv/凭据。先完成代码、文档和 formatter，再冻结
最终文件 hash，串行运行本轮离线检查。离线验证只证明工具行为，不替代上述15项业务门禁，
不证明原生权限、真实服务或额度节省。本次这些业务/外部边界均未执行。

回退先停本轮自有操作并核已知 session，确认当前文件仍等于本轮最终 hash、没有其他写者。
从备份逐文件 `cp -p` 恢复旧 ev/runner 及原模式；旧配置本来未改，核旧 hash 即可。两份
文档只回退本工具 worktree 的自有修改。新增路径仅在 hash/归属一致时移出活动路径并保留
证据，不覆盖别人后来的数据；检查备份 hash、旧入口离线兼容和 main/cp00 基线。存在漂移
则停止回退并报告，不 reset/stash/清理其他现场。

r1 是五份文件的局部增量：review_wiring.py、项目 ev.sh、新 config 与两份文档；r1 备份恢复
保留 r0 已批准文档修改，不恢复到 Git HEAD。只更新这两个实际变更工具 pin 和经审 shared_head，
tasks null 槽位、其他 pin、runtime、历史记录不改。r0 上述备份/新路径说明是其历史口径。

## §18 七天语法 + 宿主 HTTP / api 资源与 runner 边界（2026-11-05 收口）

本节记录本轮 scope=echotalk-grammar-http-20261104 的资源、runner 与最终验收事实，旧节不重排。

- 四树 HEAD=8fa9c0a8f2170eb21b38f0bdca8d551e9dd94ef3；API 树分支
  `codex/overnight-grammar-api-20261104`。API 候选 7 文件已以源指纹
  `0c62b0137d30c05d9943722639fc4525b729c8bc2b9929dcb52e2a54e3afb169` 获独立 APPROVED；
  产品代码、测试、生成物和 OpenAPI 随后冻结，2026-11-05 只允许两份已验证文档收口。
- 产品 PG 容器 `echotalk-grammar-http-20261104-test-pg`，network
  `echotalk-grammar-http-20261104-product-host`，数据库/用户 `echotalk_grammar_http_test`，
  宿主 `127.0.0.1:55444`，仅本轮独占 tmpfs。runtime 宿主 HTTP `127.0.0.1:18800..18809`；
  凭据只在主控 `R/protected` runtime，不进 Git 或报告正文。
- 建 PG 前实施 owner 先追加精确边界到
  `docs/verification/cross-platform/RF-08-WEEKLY-GRAMMAR.md`；主控亲读迁移与 SQL 空库身份、
  单独审批后才迁移。禁止旧库/应用库/QA/生产/降级或清表。
- 产品代码和测试由实施方编写；后端 pytest、Ruff、OpenAPI schema 生成/漂移检查、迁移、
  镜像与 HTTP 由主控受控代跑。
  最终组合质量 15 项 exit 0，其中 backend5 为 773 passed、3 warnings、78.48%，59% 门禁
  保持；单次完整 pytest 与独立源码 Review 是同一冻结输入的两类证据，不重复算两次自测。
- 新 host-gateway 最终通过 16 次宿主 GET：health 200、匿名 401、缺 Key ready 503、
  weekly-grammar 有效 200/非法 date/timezone 422，周窗口覆盖纽约 25 小时日；历史 55 条、
  4 页，cursor 负向请求改变 status 并返回 422，另覆盖 >48h 等负向边界，请求前后数据库计数
  不变。API/PG 仍只在 internal 网络，只有固定网关连接 internal 与专用 bridge 并发布
  `127.0.0.1:18800`，`ip_forward=0`。同 bridge canary 由网关容器内 `docker exec` 直连通过，
  API 侧同探测被阻断；该结果不证明任意 relay/代理能力，也未接触公网。此前 internal-only
  时宿主 18800 不可达的历史失败继续保留，不改写成原 Compose 或真实 Provider 链路通过。
- API 的 user、synthetic 与 gateway IP-forward 变异均被对应断言杀死并恢复，首败与中断日志
  保留。最终 runtime/product cleanup 均 exit 0，按本轮不可变身份与 label 清理且无全局 prune。
  当前文档改动仍需主控最终 format 和整体 Review；真实 Provider/IdP/LiveKit、语音、设备、
  native、远端 CI 与部署仍为独立未验边界。

## §19 RESTORE-20261107 资源收口

本段替换 delivery r0 候选追加，不改写上方从
`42c61bb08f5e234989198ef46ed7534a80c70796` 恢复的原文。上方历史 CI 与已验记录只属于
当时提交。本候选没有 push，也没有本轮远端 CI。这里的 Node 回归不能代替 native
App、Xcode、Rust 构建或设备验收。真实 Provider、IdP、LiveKit、语音、生产部署和原
Compose 整栈未验。根格式与保全回执见主控交付报告，这里不预告根格式通过。

本节只收口本轮追加的资源记录。§18 及更早的原文不动。

### §19.1 产品测试库

该库已经创建、独立审批、迁移验收，并在验收后删除。身份没有改变：

| 项            | 实际值                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| scope         | `echotalk-restore-20261107`                                               |
| 容器          | `echotalk-restore-20261107-test-pg`                                       |
| 容器 ID       | `47327ca68f5618b7bf7e8493edaf62892a622c41147fc83b1ed8144958e2cc2a`        |
| 网络          | 普通 bridge `echotalk-restore-20261107-product-host`                      |
| 网络 ID       | `38db83768419d55c612bb13fcc5bfae79828dbdb22af1a5b4703d1cb16c8bd85`        |
| 镜像          | `sha256:a46e076249ce434e41203b8c1dadfaa025b9726331d72390df038385d6dc29cd` |
| 发布          | 只绑定 `127.0.0.1:55444`                                                  |
| 用户 / 数据库 | `echotalk_restore_test`                                                   |
| 存储          | `/var/lib/postgresql/data` 仅 tmpfs                                       |

迁移前真实 SQL：server `150019`，database OID `16384`，`system_identifier`
`7705103694990835753`，`relations`、`types`、`functions`、`extra_schemas` 均为 0，
`alembic_version` 为空。独立迁移审查和空库审批之后才 upgrade。迁移后仍是同一 OID
和 `system_identifier`，`alembic_version` 为 `c06_transcript_events`，`relations`
42、`types` 44、`functions` 0、`extra_schemas` 0。随后 backend pytest 794 passed、
3 warnings、覆盖率 78.84%，59% 门禁保持。清理回执 `removed: true`、
`tmpfs_only: true`，删除的是上面同一对容器和网络 ID。它没有继续运行，也没有连接
旧 cp00、应用库、QA 或生产库。

### §19.2 runtime 私有命名适配

产品 `tools/keyfree-runtime/runtime.py` 的恢复字节没有修改，磁盘上的
`LEGACY_SCOPE`、`PG_NAME` 和 allowlist 仍是旧常量。这不是产品对新 scope 的通用支持。
主控私有 harness 只在本轮进程内存中绑定名称，原隔离、身份和 approval guards 仍执行。

本轮实际绑定并已创建的资源是：

- scope `echotalk-restore-20261107`，run `restore-r0`。
- PG 容器 `echotalk-restore-20261107-runtime-pg`，用户和数据库都是
  `echotalk_overnight_runtime`，不发布宿主端口，数据目录只用 tmpfs。
- internal 网络 `echotalk-restore-20261107-runtime-restore-r0-internal`。
- gateway 网络 `echotalk-restore-20261107-runtime-restore-r0-gateway`。
- gateway 以 `host-gateway` 只发布 `127.0.0.1:18800`，`ip_forward=0`。
- Postgres 镜像与产品库相同；API 镜像
  `sha256:523ef5c5638bb4b8f18289da21c3b8b27ca0cfc0f1d8ec8406b0298f60c7de6a`，
  Agent 镜像
  `sha256:ce02c1505bf5c91d4eb8ff71c21ba015a3837d134698266578dc0b7b65eb170a`。
  后端源 159 个文件，SHA256
  `44c04778fccd391e4d0f420a3adf7959a9820cb6ae7b34e16c6efa6d1e381ba6`。

provision 时库为空：server `150019`，`relations`、`types`、`routines`、
`extra_schemas` 均为 0。独立 run manifest 和空库审批后，exercise、宿主 HTTP、
runtime cleanup、产品库 cleanup 均 exit 0。宿主 16 次 GET 的数据均为合成 fixture，
包括 real-flag 行，不是实际用户或真实 Provider 数据：health 200、匿名 401、
缺 Key ready 503，loopback 已核验。API 与 PG 只在 internal 网络，没有默认路由和
发布端口；固定 gateway 同时连接 internal 与本轮 gateway 网络。同机 canary 为
gateway 正向、API 负向，没有公网调用。五个进程最终 exit 0。这不改写上方历史中
internal-only 时宿主 18800 不可达的记录。

验收后 runtime 的 8 个自有 ID 已删除，清单在
`.review/reports/restore-integrations-20261107/runtime/services-r0/cleanup/cleanup.json`。
产品库和它的 bridge 也已删除。凭据只在主控 protected runtime，没有进入本文。
最终保全审计见主控交付报告，本段不把该审计预告为通过。

### §19.3 本轮 Node 回归与未验边界

Vitest 1137、构建脚本 21、Fake API 72、API 类型 runner 8、Chromium+WebKit E2E 178
且 retry 0、runtime 标准库测试 31、iOS 编排 Node 测试 28。actionlint 通过。ESLint
0 error、136 warnings。macOS probe 首轮 47 项中 17 项 ENOENT，原因是探针自身缺少
`node_modules`；离线 `npm ci --ignore-scripts` 后 47 项通过，无产品补丁，首败日志
保留。`WeeklyGrammar` slot 归属守卫变异被杀死，完整源码指纹已恢复。

API 与 Agent 镜像分别有 55 和 83 个包、ldd 6 和 79，dev 依赖不在镜像内，冻结导出
一致，各 3 个导入样本和 ffmpeg 通过。宿主 HTTP 的全部数据都是合成 fixture，包括 real-flag 行，不是实际用户或真实
Provider 数据。`total_errors` 为 21，其中含榜外记录；榜内三项是 `other` 7、
`article_usage` 5、`verb_tense_past` 5，合计 17。历史 55 条共 4 页、纽约 25 小时日；
读请求前后数据库计数不变。Worker 演练另有一条 synthetic assessment 和一条 synthetic
grammar、零 KnowledgeState，与上述 HTTP fixture 分开。恢复范围只包括显式准备的过期
running job，重启和重复执行保持幂等，不证明任意崩溃恢复。gateway TERM/INT 为
272/262 毫秒且 exit 0；PID1 服务长驻 17 秒，前后有健康 listener 检查，不是单条连接
持有 17 秒。最多 2 个连接，第 3 个被拒绝，active shutdown 199 毫秒，header timeout
153 毫秒。

以上不是 native App、Xcode、Rust、设备、真实 Provider、IdP、LiveKit、语音、生产
部署或原 Compose 整栈的验收，也不是本轮远端 CI。
