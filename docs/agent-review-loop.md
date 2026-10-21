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

| 类型           | lane 内工作目录         | 命令                                                            | 环境/说明                                                             |
| -------------- | ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| 真实单元测试树 | `apps/vite-app`         | `pnpm test`                                                     | 使用项目脚本配置 NODE_OPTIONS；Vitest 不使用 Turbo 缓存日志作为新证据 |
| 浏览器测试树   | `apps/vite-app`         | `pnpm test:e2e`                                                 | Chromium + 本地 Fake API；默认端口 4173/18181，单独串行运行           |
| 后端测试树     | `backend`               | `.venv/bin/python -m pytest --cov=. --cov-report=term-missing`  | 仅在 §3 明确独立测试库并核验后运行，Mock/DB 用例和 skip 分开报告      |
| 格式           | 仓库根                  | `pnpm format:check`                                             | 不扫描本地 `.review/`                                                 |
| 前端 lint      | 仓库根                  | `pnpm exec turbo run lint --force`                              | 强制执行，覆盖 Vite/仍维护的 Webpack 脚本                             |
| 前端类型       | 仓库根                  | `pnpm exec turbo run typecheck --force`                         | 强制执行                                                              |
| 前端构建       | 仓库根                  | `pnpm exec turbo run build --force`                             | Webpack/Vite 构建都保留，原生同步单独记录                             |
| 后端格式       | `backend`               | `.venv/bin/ruff format --check .`                               | 与 CI 一致                                                            |
| 后端 lint      | `backend`               | `.venv/bin/ruff check .`                                        | 与 CI 一致                                                            |
| 空库迁移       | `backend`               | `.venv/bin/alembic upgrade head` 后 `.venv/bin/alembic current` | 仅在专用可重建测试库获授权后执行；不是普通基线检查的默认动作          |
| iOS 工程检查   | `apps/vite-app/ios/App` | `xcodebuild -list -project App.xcodeproj`                       | 仅清单；可能访问 SPM，运行前确认边界，完整编译不在本轮默认授权内      |

`packages/ui-lib` 有 Vitest 配置但当前无测试文件；其他 package 的 echo/no tests 脚本不是测试树。
根目录 `test_api_err.ts` 是独立诊断脚本，不冒充测试 runner。新增真实 runner 时追加本表。
真实 IdP、LiveKit/Provider、iOS/macOS 设备链路是独立外部验收，不由 Fake API E2E 替代。

## §3 测试库与安装边界

用户已授权专用容器 `echotalk-cp00-pg`（postgres:15.19-alpine），仅监听 `127.0.0.1:55432`，库 `echotalk_cp00_test`。密码仅存在本地受保护 runtime，不提供给外部 Agent。CP-00 空库迁移至 `b3f1c8e92a10`；后续仅后端 B 线使用此库，A/C 不连接数据库。
CI 的临时 `localhost:5432/echotalk_test` 仅是 CI 契约，不能推断本机同地址可安全使用。
仓库 Compose 的 `echotalk` 是应用库，不允许用于测试。禁止读取或复制主 checkout 的 `.env` 来寻找可用库。

确认后应在本节追加每条 lane 允许的 container/host/port/database，密码不写文档。
执行前核验服务身份、数据库名、迁移版本；并发后端 lane 使用不同库，迁移由单一所有者串行管理。
`DATABASE_URL` 缺失时不启动 pytest，避免配置模块回退根 `.env` 或默认应用库。
不得通过假地址、Mock 开关或删除集成测试把测试树制造为全绿。

用户已允许各隔离 worktree 按现有锁文件安装前端依赖、按现有 requirements.txt 安装独立 Python 环境；不扩展为任意依赖升级或浏览器安装。
获准后前端使用现有锁文件 frozen 安装，不更改 manifest/lock；Python 依照当前 CI 的 requirements.txt，
记录解析出的包版本。requirements.txt 使用范围约束，不能把这次解析称为 uv.lock 冻结安装；
依赖可复现性改造属于 RF-07，本轮不顺手实施。
不借用主 checkout 的 node_modules/venv 冒充新 lane 的独立依赖环境。

## §4 生成产物及验证

| 产物                        | 源                             | 原生检查/边界                                                         |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Vite/Webpack dist           | TS/React、构建环境             | tsc/typecheck + 对应 build；产物不提交，环境切换后重新构建            |
| Capacitor public/config/SPM | webDir、Capacitor config、依赖 | 先核验 build/sync，再做 Xcode 编译；不手改自动生成的 SPM 配置规避错误 |
| Alembic revision            | ORM/显式 schema 变更           | 审查迁移脚本；专用空库升级/current 及相关集成测试                     |
| 未来 API 类型               | OpenAPI                        | 生成后仍需 typecheck 和契约测试；当前不提前引入生成器                 |

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
