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

| 类型            | lane 内工作目录         | 命令                                                                | 环境/说明                                                             |
| --------------- | ----------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 真实单元测试树  | `apps/vite-app`         | `pnpm test`                                                         | 使用项目脚本配置 NODE_OPTIONS；Vitest 不使用 Turbo 缓存日志作为新证据 |
| 浏览器测试树    | `apps/vite-app`         | `pnpm test:e2e`                                                     | Chromium + 本地 Fake API；默认端口 4173/18181，单独串行运行           |
| 后端测试树      | `backend`               | `.venv/bin/python -m pytest --cov=. --cov-report=term-missing`      | 仅在 §3 明确独立测试库并核验后运行，Mock/DB 用例和 skip 分开报告      |
| 格式            | 仓库根                  | `pnpm format:check`                                                 | 不扫描本地 `.review/`                                                 |
| 前端 lint       | 仓库根                  | `pnpm exec turbo run lint --force`                                  | 强制执行，覆盖 Vite 与仍在维护的共享配置                              |
| 前端类型        | 仓库根                  | `pnpm exec turbo run typecheck --force`                             | 强制执行                                                              |
| 前端构建        | 仓库根                  | `pnpm exec turbo run build --force`                                 | 构建 Vite/Capacitor 产品前端，原生同步单独记录                        |
| 后端格式        | `backend`               | `.venv/bin/ruff format --check .`                                   | 与 CI 一致                                                            |
| 后端 lint       | `backend`               | `.venv/bin/ruff check .`                                            | 与 CI 一致                                                            |
| OpenAPI schema  | `backend`               | `../.review/rf07-a37-dev-venv/bin/python export_openapi.py --check` | 真实 app 导出后与 canonical `openapi.json` 字节比较；不读 dotenv/凭据 |
| API 类型漂移    | `apps/vite-app`         | `pnpm check:api-types`                                              | 从 tracked schema 重新生成并与 `api.generated.ts` 字节比较            |
| API 类型 runner | `apps/vite-app`         | `pnpm test:api-types`                                               | Node 真实 runner；覆盖确定性、stale、`$ref` 与写入失败                |
| 空库迁移        | `backend`               | `.venv/bin/alembic upgrade head` 后 `.venv/bin/alembic current`     | 仅在专用可重建测试库获授权后执行；不是普通基线检查的默认动作          |
| iOS 工程检查    | `apps/vite-app/ios/App` | `xcodebuild -list -project App.xcodeproj`                           | 仅清单；可能访问 SPM，运行前确认边界，完整编译不在本轮默认授权内      |
| Fake API测试    | `apps/vite-app`         | `pnpm test:fake-api`                                                | 真实 Node 子进程回归，使用动态端口 0 与原生 node:test                 |

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

脚本从技能副本复制，并修正命令失败时返回相同非零退出码，保留原输出格式与拒绝覆盖行为。
记录 cwd/HEAD/dirty、命令、时间、完整输出与真实退出码；不输出环境全集、凭据或用户内容。
重跑使用新编号并写明原因。报告可写数字，但每个数字必须指向对应 ev 原文；禁止手填通过数。

报告至少包含：实际基线；改动清单/意图/hash；验收映射；每棵测试树结果/ev 路径；
测试库边界；迁移前后版本；未做/未验证；需要裁决的问题。
区分既有代码失败、依赖缺失、未授权环境和本轮回归。交付后不再改动，等独立 Review。
评审结论为 APPROVED 或 CHANGES REQUESTED；缺外部证据时明确保留对应门禁未通过。

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
  验收要求所有存活 packages 的 version/integrity 与保留的 resolved snapshots/importer
  不变；被删除 workspace 的 importer 及其独占依赖可移除，不能手写 lock 规避该边界。
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
