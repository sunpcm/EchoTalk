# EchoTalk 云端评审第一轮：架构、文档与 UI 交互（2026-11-10）

> 范围：只出报告，不改业务代码与测试。基线提交 `main@22eaf82`，工作分支
> `claude/cloud-review-2026-11`。所有结论都来自本次会话在云端容器内实际运行的命令或读到的源码行；
> 没有运行的内容在 §7 明确列为"未验证"。截图目录：
> [`2026-11-cloud-review/`](./2026-11-cloud-review/)（43 张，2 倍像素，共约 6 MB）。

## 0. 结论摘要

1. **基线与上一会话一致**：Vitest 1142、E2E 180、pytest 809，迁移 head `c06_transcript_events`。
2. **`ARCHITECTURE.md` §7 的三条 P0 里有两条已经解决**（真实认证、凭据密钥独立），文档正文仍按旧状态写；
   §2 能力表还有 4 行过期。只有"仓库内 Nginx 无 TLS"仍然成立。
3. **默认（暖色）主题大面积不满足 WCAG AA 对比度**：主按钮白字 2.93、标题 2.75、次要文字 3.58、
   空态文字 2.24（要求 4.5）。深色主题基本达标。这是本轮最重要的 UI 问题。
4. **"开始练习 → 进房 → 通话中"这条主路径没有任何 E2E 覆盖**：Fake API 没有 `/token` 与 `/dispatch` 路由。
   顺带暴露两个真实缺陷：创建成功但取 Token 失败会留下孤儿"活动会话"；后端 `detail` 原文直接显示给用户。
5. **Router 现在不做**；`ActiveSessions.tsx` 应先拆（1146 行、12 个 state、20 个 ref），拆分不动测试断言。
6. **平台适配层对 iOS/macOS 认证是空白**：`lib/auth.ts` 直接用 `window.sessionStorage`、
   `window.location` 和整页重定向，没有任何平台接缝，这是 macOS M2 与 iOS 真登录最先会漏进业务代码的位置。

## 1. 基线复核

环境：Node v22.23.4、pnpm 10.26.0、Python 3.12（`backend/.venv`）、PostgreSQL 15.19
（容器 `echotalk-test-pg`，库 `echotalk_test`）。Docker 守护进程开工时未运行，手动启动 `dockerd`；
`docker pull postgres:15.19-alpine` 首次遇到 Docker Hub 429，后台重试后成功。没有读取或创建 `.env`。

| 检查            | 命令（目录）                                                           | 结果                                             |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| 格式            | `pnpm format:check`（根）                                              | 通过，exit 0                                     |
| lint / 类型     | `pnpm exec turbo run lint typecheck --force`（根）                     | 通过，exit 0                                     |
| Vitest          | `pnpm --filter vite-app test`（根）                                    | 43 个文件，**1142 passed**                       |
| 构建            | `pnpm exec turbo run build --force`（根）                              | 通过，0 cached                                   |
| E2E（Fake API） | `pnpm exec playwright test --trace off`（`apps/vite-app`）             | **180 passed**（Chromium + WebKit，2.1 分钟）    |
| 后端格式 / lint | `.venv/bin/ruff format --check . && .venv/bin/ruff check .`（backend） | 通过，exit 0                                     |
| 迁移            | `.venv/bin/alembic upgrade head && .venv/bin/alembic current`          | `c06_transcript_events (head)`                   |
| pytest          | `.venv/bin/pytest --cov=. --cov-report=term-missing`                   | **809 passed**，3 warnings，覆盖率 79.67%，61 秒 |

与上一会话（2026-11-10）基线完全一致，无偏差。本轮没有跑的门禁：`check:api-types`、`test:api-types`、
`test:build`、`test:fake-api`、OpenAPI/Provider 元数据导出校验、`tools/keyfree-runtime` 单测、
iOS/macOS CI job（任务说明的表格未要求，见 §7）。

## 2. 发现

优先级含义：P0 = 阻断发布或误导决策；P1 = 应在下一轮处理；P2 = 可排期。

### 2.1 架构文档纠偏（对应任务 4.1）

#### A-1 `ARCHITECTURE.md` §7 逐条核对

| 条目                    | 状态         | 证据                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 Mock 鉴权          | **已解决**   | `backend/dependencies.py:60-104` 校验 Bearer 并按 `(issuer, subject)` 映射用户；dev 模式用 `secrets.compare_digest` 比对显式 Token（`:40-44`）。`backend/auth.py:74-113` 校验 RS256/ES256、audience、issuer、`exp`/`sub`。`backend/config.py:148-149` dev 模式无 Token 拒绝启动。测试：`test_auth.py`、`test_dependencies.py`、`test_resource_ownership.py`。真实 IdP 联调未验证 |
| P0-2 密钥耦合           | **已解决**   | `backend/config.py:51-53` 独立的 `CREDENTIAL_ENCRYPTION_KEYS` 版本化 keyring；`backend/utils/crypto.py:28-39` 按版本解密，旧派生密钥仅经 `LEGACY_CREDENTIAL_DECRYPTION_SECRET` 只读。`config.py:162-163` OIDC 模式禁止默认开发密钥。全仓 `.py` 中已无 `JWT_SECRET_KEY`。测试：`test_crypto.py`、`test_config_security.py`、`test_settings_lazy_decryption.py`                    |
| P0-3 无 TLS 生产入口    | **仍存在**   | `apps/vite-app/nginx.conf:2` 只有 `listen 80`；`docker-compose.yml` 只暴露 `3000:80`。后端侧已有补偿：`config.py:158-178` OIDC 模式要求 HTTPS issuer/JWKS 并拒绝非本机 HTTP Origin。实际部署是否有外层 TLS 终止，云端无法验证                                                                                                                                                    |
| P1-1 分析可观测性不足   | **仍存在**   | `backend/` 内没有队列积压、延迟或失败率的指标与告警实现（`grep` 指标/告警关键字只命中测试名）。Job 重试、超时恢复已有（`workers/`、`test_analysis_worker.py`）                                                                                                                                                                                                                   |
| P1-2 多 worker 播种竞态 | **已解决**   | `backend/main.py:23-27` 启动只做 `validate_runtime()`，不再写库；`backend/seed_reference_data.py:46-64` 用 `INSERT ... ON CONFLICT DO NOTHING` 的显式 CLI。测试：`test_lifespan_seeding.py`、`test_reference_seeding.py`                                                                                                                                                         |
| P1-3 迁移与启动未编排   | **部分解决** | CI 已从空库迁移（`.github/workflows/ci.yml` "Upgrade empty PostgreSQL database"）。`docker-compose.yml` 仍没有一次性迁移服务，API 可能在旧 Schema 上启动                                                                                                                                                                                                                         |
| P1-4 外部服务单点       | **部分解决** | 超时与连接策略已显式化并有测试（`test_llm_client_policy.py`、`test_session_connect_policy.py`）；熔断指标与降级说明仍没有。真实 Provider 行为云端无法验证                                                                                                                                                                                                                        |
| P1-5 Compose 就绪门禁   | **仍存在**   | `docker-compose.yml` 中只有 Postgres 有 `healthcheck`（`:14`）；`echotalk-web` 的 `depends_on: - echotalk-api` 无 `condition`，API 无 healthcheck                                                                                                                                                                                                                                |
| P2-1 语料人工维护       | **仍存在**   | `backend/data/` 版本化 JSON，无管理工具                                                                                                                                                                                                                                                                                                                                          |
| P2-2 CI 不构建真实镜像  | **仍存在**   | `ci.yml` 四个 job 中没有 `docker build`。镜像能否构建云端未验证（本轮未尝试）                                                                                                                                                                                                                                                                                                    |
| P2-3 CI 无空库迁移/iOS  | **已解决**   | `ci.yml` 的 `test-backend` 有空库迁移步骤；`test-ios-build`、`test-macos-probe` 两个 job 且被聚合 job `CI` 要求成功。远端运行结果本轮未查                                                                                                                                                                                                                                        |
| P2-4 单一 SPA / Router  | **仍存在**   | 见 F-2                                                                                                                                                                                                                                                                                                                                                                           |

- **问题**：文档第 5 行的免责说明承认"不代表当前实现"，但 §2、§7、§8 正文没改，读者（包括后续 Agent）
  需要自己逐条核对。§2 能力表另有 4 行过期：鉴权"仅 Mock"（`:62`）、BYOK"由 `JWT_SECRET_KEY` 派生"（`:63`）、
  "仓库没有 Tauri 工程"（`:59`，现有 `tools/macos-m1-native-probe`）、周报"未实现"（`:66`，会话次数与语法 Top3 已上线）。
  同时 §3、§6 在 11 月被追加了当前事实（A76–A84），一份文档里历史和现状混在一起。
- **建议**：把本文改回"当前架构"并删掉"历史审计"的定位：按上表重写 §2 与 §7，把已解决项移到文末
  "已关闭风险"一节并附解决提交；顶部两段 A76/A77 补充移入 §3.1。历史快照由 Git 保存，不另建副本
  （与 `docs/README.md` 的维护规则一致）。
- **优先级**：P0（文档误导发布判断）。**改动范围**：仅 `docs/ARCHITECTURE.md`、`docs/README.md` 一行导航。
- **验证**：评审逐条对照上表的文件行号；`pnpm format:check`。

#### A-2 `PROJECT_STATUS.md` 内部自相矛盾

- **现状证据**：`docs/PROJECT_STATUS.md:1164` "周度学习报告……**未实现，不可对外宣称可用**"；
  而 `TODO.md:497-505` 已勾选"最近七个本地自然日 completed 会话次数"和"语法 Top 3"，截图
  `07-weekly-progress--*.png`、`07b-weekly-grammar--*.png` 也显示功能在线。同表 `:1165`"移动端未实现"与
  `CROSS_PLATFORM_ARCHITECTURE.md:12` 的 iOS 现状不一致。
- **建议**：随 A-3 重组时更新"当前功能"表。**优先级**：P1。**范围**：文档。**验证**：对照 TODO 勾选项。

#### A-3 三份长文档的重组方案（只出方案）

现状（`grep -n '^#\{1,3\} '` 与行数统计）：

| 文档                        | 行数 | 结构问题                                                                                                                                              |
| --------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PROJECT_STATUS.md`    | 1500 | 109 个二级标题，约 100 个是按日期/轮次（A29–A84）的实施记录；"当前功能"表在第 1152 行，"已知限制"在 1219 行；48 行超过 600 字符；日期顺序前后两段颠倒 |
| `TODO.md`                   | 699  | 62 项未完成、81 项已完成混排；顶部 5 个按日期的段落（其中 3 个标题自带"历史"）；同一任务出现两次（如"LiveKit SDK 类型忽略"在 `:39` 和 `:531`）        |
| `docs/agent-review-loop.md` | 734  | §1 写死 `/Users/sunpcm/...` 本机路径与某一轮 lane；§2.1–§2.3、§3.1–§3.3、§17–§19 是单轮回执；手册声明"编号只追加不重排"                               |

共同原因：三份文档都在用"追加一段"的方式同时承担**当前状态**和**审计流水**两种职责。

方案：按"读者要回答的问题"拆成两层，历史层只追加、当前层可覆盖。

```text
docs/
├── PROJECT_STATUS.md            当前层，目标 ≤150 行
│     1. 当前功能表（唯一一张）  2. 当前验证基线（最近一次三测试树计数与提交）
│     3. 已知限制与风险          4. 明确未采纳的方案        5. 更新规则
├── history/                     历史层，只追加
│     ├── 2026-10.md             原 10 月各轮实施记录（A29–A63），原文搬运
│     ├── 2026-11.md             原 11 月各轮实施记录（A64–A84、RESTORE-20261107）
│     └── decisions.md           "已合并 / 未采纳"决策流水（原 2026-10-17、10-20 两节）
├── agent-review-loop.md         当前层：§1–§19 编号与标题全部保留
│     每节正文只留现行规则；单轮回执改为一行"见 history/review-loop-receipts.md#§2.2"
└── history/review-loop-receipts.md   原 §2.1.1、§2.2、§2.3、§3.1–§3.3、§17–§19 的回执原文
TODO.md                          当前层，只留未完成项，目标 ≤200 行
      分区：进行中 / 可直接开工 / 被外部条件阻断 / 待用户裁定 / 三端门禁 CP-00~07
      已勾选项移到 docs/history/todo-done.md（带原勾选日期与证据链接）
```

迁移顺序与约束：

1. 先搬历史层（纯剪切粘贴，不改一个字），单独一个提交，便于 `git diff --color-moved` 审查。
2. 再重写当前层，每张表的每一行都要能指到历史层的锚点或代码行。
3. `agent-review-loop.md` 的章节**编号不动**（现有 prompt 按编号引用），只把正文瘦身；§1 的本机绝对路径
   改成"本地主 checkout"并在 §1 增加"云端会话"小节，承接 `AGENTS.md` 已有的云端条款。
4. 用脚本检查全仓 Markdown 相对链接与锚点没有断（`TODO.md#三端交付计划web--macos--ios` 等被多处引用）。

- **优先级**：P1。**范围**：3 个文档 + 新增 4 个历史文件，零代码。**验证**：搬运提交的
  `git diff --color-moved --stat` 显示净增删为 0；链接检查脚本通过；`pnpm format:check`。
- 是否采用 `docs/history/` 这个目录名、是否保留 `docs/archive/` 并合并，见 §5 待裁定。

### 2.2 前端结构（对应任务 4.2）

#### F-1 `ActiveSessions.tsx` 是一个 1146 行的单组件

- **现状证据**：`apps/vite-app/src/components/conversation/ActiveSessions.tsx:58` 起只有一个导出组件，
  内含 12 个 `useState`（`:59-87`）、20 个 `useRef`（`:90-112`）、一个 536 行的区段放五类流程
  （列表查询 `:123`、分页 `:240`、结束确认 `:343-366,534`、恢复确认 `:375-406`、生命周期与认证订阅 `:659-860`），
  渲染从 `:864` 才开始。对应测试 `ActiveSessions.test.tsx` 4617 行。
- **问题**：五类流程共享同一批 ref 做"在途互斥"和"认证代际"判断，任何改动都要通读全文；
  后续 CP-02 的心跳与接管提示如果继续加在这里，会再加一组 state/ref。
- **建议**（拆分边界，不改行为）：

  | 新模块（同目录 `conversation/activeSessions/`） | 职责                                       | 来源行                 |
  | ----------------------------------------------- | ------------------------------------------ | ---------------------- |
  | `useActiveSessionList.ts`                       | 首屏查询、分页、认证身份与代际绑定、去重   | `:59-340`              |
  | `useSessionEndFlow.ts`                          | 结束确认意图、在途互斥、失败重试           | `:343-372`、`:534-657` |
  | `useSessionResumeFlow.ts`                       | 恢复确认、能力检查、取消与失败终态         | `:375-532`             |
  | `useActiveSessionsLifecycle.ts`                 | 生命周期适配器与认证快照订阅，触发只读刷新 | `:659-860`             |
  | `SessionRow.tsx` / `ConfirmPanel.tsx`           | 纯展示                                     | `:864-1146`            |
  | `ActiveSessions.tsx`                            | 组装，保留原导出名与路径                   | —                      |

  三个流程共用的互斥标志收进一个 `useRef` 持有的小对象（`{ ending, resuming, loadingMore }`），由组装层创建后传入，
  避免各 Hook 互相 import。

- **迁移步骤**：先抽纯展示（零逻辑风险）→ 再抽生命周期订阅 → 再抽 end/resume → 最后抽列表查询；每步一个提交。
- **对测试的影响**：`ActiveSessions.test.tsx` 从公共组件入口渲染，断言 DOM 与请求，
  **导出路径不变则 4617 行测试一行不用改**，这正是验收标准。E2E（`activity-layout`、`session-recovery`、
  `session-resume-error`、`session-pagination`）同样不变。不要在同一轮为新 Hook 补单测，先保证等价。
- **优先级**：P1。**范围**：1 个文件拆为约 7 个，净行数基本不变。
- **验证**：三测试树计数不变（1142 / 180）；`git diff` 中测试文件零改动；对关键互斥分支做 2–3 个变异确认仍被杀。

#### F-2 Router：现在不做

- **现状证据**：`App.tsx:197-203` 用 `appView`（`"dashboard" | "session" | "doc-chat-setup"`，
  `store/conversation.ts:113`）三选一；会话内再由 `VoiceInterface.tsx:30-60` 按 `phase` 选视图。
  `appView` 在非测试源码中被引用 22 处，在测试与 E2E 中 143 处（大量 `setState({ appView })`）。
- **判断：不做**。理由：
  1. 现在只有 3 个顶层视图，其中 `session` 的可见内容完全由服务端会话状态机决定，不能由 URL 决定
     （直接打开 `/session/:id` 仍要走"认证 → 查占用 → 用户确认恢复"，见
     `CROSS_PLATFORM_ARCHITECTURE.md` §5 的统一恢复顺序）。URL 路由在这里只会制造第二个事实源。
  2. Capacitor（`capacitor://`）与 Tauri 的自定义 scheme 下，history 路由需要额外回退配置，
     在 CP-03 设备证据出来之前引入是净风险。
  3. 143 处测试引用意味着迁移成本主要在测试，而当前没有用户可见的收益。
- **触发条件**（满足任一条再做，并且只做到所需范围）：
  - 出现需要**可分享或可刷新保持**的只读页面，例如独立的"历史会话详情"或"周报"页；
  - 需要系统返回手势/浏览器后退在视图间生效，并且用户反馈了这个问题；
  - OIDC 回调需要独立路径（现在回调在根路径处理，`lib/auth.ts:330`）；
  - 顶层视图超过 5 个。
- **现在值得做的小步**：把 `appView` 从 `conversation` store 挪到独立的导航切片
  （`store/navigation.ts`，约 30 行），因为"在哪个页面"和"会话处于什么阶段"是两件事，
  `App.tsx:113-116` 现在为了进 DocTalk 要先 `reset()` 会话再 `setState({ appView })`。
  这一步让将来接 Router 时只替换一个文件。测试影响：143 处引用需要机械替换 store 名，
  建议与 F-1 分开、单独一轮。**优先级**：P2。
- 未验证：浏览器后退键在当前实现下的实际表现本轮没有实测，上述为读码推断。

#### F-3 `store/`、`hooks/`、`lib/` 的职责边界

- **现状证据**（行数统计，不含测试）：`store/conversation.ts` 1389 行、`lib/api.ts` 1102 行、
  `lib/callLeaseController.ts` 581、`lib/auth.ts` 573、`store/settings.ts` 570；`hooks/` 只有 1 个文件，
  而 `components/settings/` 下有 `useSettingsForm.ts`、`useSettingsDialog.ts`，
  `components/conversation/` 下有 `useRoomAuthOwnership.ts`。
- **问题与建议**：
  1. `lib/api.ts` 混了四类东西：传输（`request`）、响应解析校验（`parse*`，约 400 行）、通话租约、各资源端点。
     按资源拆成 `lib/api/{client,sessions,assessments,settings,callLease}.ts`，由 `lib/api/index.ts` 原样再导出，
     38 处 `from "@/lib/api"` 不用改。P2。
  2. `store/conversation.ts` 里混有启动编排（health → create → token）、生命周期追踪器（`:60-110`）和就绪检查。
     已有 `conversationState.ts` 的 reducer 是好的方向；下一步把启动编排抽成 `store/conversationStartup.ts`。P2，
     且必须排在 F-1 之后，避免同时动两个最大的文件。
  3. `hooks/` 目录名存实亡。约定"只被一个功能域用的 Hook 留在该域目录；跨域的才进 `hooks/`"，
     并把这句话写进 `AGENTS.md`。`usePollingAssessment` 只被 `EndedConversation` 使用，可随 P-3 归位。P2。
  4. `store/*.ts` 与 `lib/apiErrorMessage.ts` 中有 11 处硬编码中文（`conversation.ts:655,673,691,1267`、
     `assessment.ts:167,191`、`settings.ts:454,525,542`、`apiErrorMessage.ts:23,41`），见 U-6。
- **验证**：每一步三测试树计数不变；`pnpm exec turbo run lint typecheck --force`。

### 2.3 UI 与交互（对应任务 4.3）

取证方式：Fake API（端口 18282）+ `pnpm dev`（端口 4273，`VITE_AUTH_MODE=dev`），用仓库内
Playwright 1.62.1 的 Chromium 在 1280×800 与 390×844 下截图；错误/加载态用 `page.route` 注入；
对比度既按 `theme-tokens.css` 计算，也读取了渲染后的 `getComputedStyle`。脚本是会话内临时文件，未入库。

截图索引（每个状态都有 `--desktop-1280` 与 `--mobile-390` 两张）：

| 状态                   | 文件前缀                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| 空态                   | `01-dashboard-empty`                                                                                         |
| 有活动会话 / 结束确认  | `02-dashboard-active-sessions`、`02b-active-session-confirm-end`                                             |
| 加载                   | `03-dashboard-loading`                                                                                       |
| 错误与重试             | `04-dashboard-errors`、`05-readiness-error`                                                                  |
| 设置抽屉               | `06-settings-drawer`、`06b-settings-drawer-bottom`                                                           |
| 周进度 / 周语法        | `07-weekly-progress`、`07b-weekly-grammar`                                                                   |
| 连接中 / 连接失败      | `08-session-connecting`、`09-session-connection-failed`                                                      |
| 会话中（桩化，见 U-3） | `10-session-active-stubbed`                                                                                  |
| 会后分析               | `11-analysis-pending`、`12-…-success`、`13-…-failure`、`14-…-grammar-only`、`15-analysis-no-pron-no-grammar` |
| DocTalk 设置           | `16-doc-chat-setup`                                                                                          |
| 冷色 / 深色主题        | `17-theme-cool`、`17-theme-dark`                                                                             |
| 键盘焦点               | `18-keyboard-focus--desktop-1280`                                                                            |

#### U-1 暖色与冷色主题的文字对比度不满足 WCAG 2.1 AA

- **现状证据**（渲染后实测，`getComputedStyle`，1280 宽 Dashboard；AA 要求正文 4.5、大字与图形 3.0）：

  | 元素                              | 字号/字重  | 暖色（默认） | 冷色     | 深色     |
  | --------------------------------- | ---------- | ------------ | -------- | -------- |
  | 主按钮"进入练习"白字 on `accent`  | 16px/600   | **2.93**     | 4.62     | 8.38     |
  | H1 标题 `accent` on `bg`          | 30px/700   | **2.75**     | 4.22     | 8.17     |
  | 副标题、说明 `text-muted` on `bg` | 16px、12px | **3.58**     | **3.67** | 5.96     |
  | 空态 `text-faint` on `bg`         | 14px       | **2.24**     | **2.23** | **3.60** |
  | "恢复练习"`accent` on 浅底        | 12px/500   | **2.54**     | **3.82** | 6.10     |
  | "结束记录"`danger` on 浅底        | 12px/500   | **3.29**     | **3.29** | 4.93     |
  | CEFR 徽标 `warning` on 浅底       | 12px/500   | **3.16**     | **3.16** | 6.80     |
  | 技能标签 `accent-soft-text`       | 12px       | **4.09**     | 6.39     | 7.77     |

  按 token 计算的补充：`danger` on `surface` 3.91、`success` on `surface` 3.10（发音分数 88 的绿色）、
  `border` on `surface` 1.23–1.30（输入框与卡片边界，非文字组件要求 3.0）。会话中"结束对话"按钮是白字 on
  `danger`（`ActiveConversation.tsx` 的 `bg-danger … text-white`），约 3.9。

- **问题**：默认主题下，最重要的行动按钮和几乎所有次要说明都不达标；`text-faint` 在三套主题都不达标，
  而它被用在空态、加载态和错误提示这些用户最需要读清的地方（见 `04-dashboard-errors`）。
  `PROJECT_STATUS.md:1163` 已承认"完整无障碍审计仍未完成"。
- **建议**：只改 `packages/configs/tailwind-config/theme-tokens.css` 的 token，不动组件：
  - 暖色 `--accent` 作为文字和按钮底色时加深到对白 ≥4.5（现有 `--accent-soft-text: #c9482a` 对白 4.9，
    可作为按钮底色与标题色的起点），原 `#f76b4a` 只留给装饰（渐变、图标底、进度条）。
  - `--text-muted` 暖色约 `#6f675f`、冷色约 `#5c6877`（对各自 `bg` ≥4.5）。
  - `--text-faint` 降级为"仅用于占位符与装饰"，把空态/加载/错误文案的类名从 `text-text-faint` 换成
    `text-text-muted`（这一条需要改组件类名，约 10 处）。
  - 浅色主题的 `--danger`、`--success`、`--warning` 作为文字使用时改用已有的 `*-text` token。
  - 具体色值是品牌决定，见 §5 待裁定；上面的数值只是"能达标的最小改动"参考。
- **优先级**：P0（默认主题主按钮不达标）。**范围**：1 个 CSS 文件 + 约 10 处类名。
- **验证**：把本轮的对比度脚本落成 E2E（三主题 × 关键元素，断言 ≥4.5 / ≥3.0）；
  现有 `theme-tokens.spec.ts`、`theme-transitions.spec.ts` 的 computed 断言需要同步色值。

#### U-2 主路径"开始练习 → 进房"没有 E2E，并暴露两个缺陷

- **现状证据**：`apps/vite-app/e2e/fake-api.mjs` 没有 `GET /api/sessions/{id}/token` 和 `POST …/dispatch`
  路由。首次截图时点击"进入练习"得到：
  1. 页面顶部显示 **`No fake route for GET /api/sessions/<uuid>/token`** ——后端 `detail` 字符串被原样展示
     （`lib/apiErrorMessage.ts:24-26` 直接取 `body.detail`；`store/conversation.ts:691` 取 `err.message`）。
     换成真实后端，用户会看到英文的 FastAPI 错误原文。
  2. 每失败一次，"活动会话"列表就多一条"场景练习"记录：`POST /sessions` 已成功，取 Token 失败后
     客户端没有结束该会话。连续三次失败后列表里有三条孤儿记录，每条都提供"恢复练习"。
     （这两张现场截图在补齐路由重拍时被覆盖，未保留；复现方法：按上面方式启动后直接点"进入练习"。）
- **问题**：最核心的用户路径只有单元测试覆盖；现有 E2E 都是直接 `setState` 进入结束态或拦截 LiveKit 模块。
  缺陷 2 在真实后端上是否同样发生，取决于后端是否有补偿，云端未验证；客户端代码路径是确定的。
- **建议**：
  - Fake API 增加 `/token`（返回假 Token 与不可达 `ws_url`）和 `/dispatch`；新增一条 E2E 覆盖
    "点击 → 连接中 → 连接失败 → 返回主页"，以及 `routeWebSocket` 挂起信令时的"连接中"视图。
  - 启动阶段错误统一走 i18n 的通用文案，原始 `detail` 只进诊断日志（`lib/diagnostics.ts` 已有通道）。
  - 取 Token 失败后的孤儿会话如何处理是**契约问题**（自动结束 vs 保留给用户恢复），见 §5 待裁定。
- **优先级**：P1。**范围**：`e2e/fake-api.mjs`、新 spec、`store/conversation.ts` 错误分支、i18n。
- **验证**：新 E2E 在 Chromium 与 WebKit 通过；`pnpm test:fake-api` 增加两条路由用例。

#### U-3 会话中界面：LiveKit 默认深色底与主题割裂，手机上字幕在折叠线以下

- **现状证据**：`10-session-active-stubbed--*.png`。**这张图是桩化的**：`useConnectionState` 被替换为恒
  `connected`、`useVoiceAssistant` 返回固定数据、WebSocket 信令被挂起，没有任何真实媒体。能确认的只有布局与样式：
  - 会话区域是一块 `#111` 黑底（来自 `@livekit/components-styles` 的 `data-lk-theme` 容器），
    与暖色页面背景直接拼接，外圈还露出页面底色。
  - 没有页头：不显示场景名、已进行时长、返回入口；唯一出口是红色"结束对话"。
  - 390 宽时顺序是"状态卡 → 回答推荐 → 对话记录"，字幕面板在首屏之外，下方还有大片空白黑底。
  - `ActiveConversation.tsx` 的 `AgentStatusText` 在 `thinking` 状态显示的是"连接中"文案（`tConv.connecting`）。
- **建议**：给 `LiveKitRoom` 容器覆盖背景为 `var(--bg)`；增加极简页头（场景名 + 计时）；手机上把字幕放在状态卡之后、
  回答推荐折叠为可展开；`thinking` 用独立文案。麦克风控制条（`VoiceAssistantControlBar`）在桩化下没有渲染，
  它的触控尺寸和对比度**未验证**。
- **优先级**：P1。**范围**：`ActiveConversation.tsx`、`RoomSession.tsx`、i18n、少量 CSS。
- **验证**：沿用 `answer-recommendations.spec.ts` 的模块桩方式做布局 E2E；真实双向音频下的观感必须在有 LiveKit 的环境人工验收。

#### U-4 错误与加载态四种样式并存，两处没有重试

- **现状证据**：`04-dashboard-errors--mobile-390.png` 同一屏上：
  活动会话是红底卡片 + 实心主按钮"重试"；今日推荐只有一行浅灰"加载失败，请稍后重试"，**没有重试按钮，
  连区块标题也消失**；今日进度是浅灰文字 + 一个 12px 的"重试"文字链，标题同样消失；
  最近七天与语法记录是正文色文字 + 描边按钮。`03-dashboard-loading` 同理：有的是转圈，有的是纯文字，
  今日推荐与今日进度加载时也没有标题。Dashboard 实测 **0 个** `aria-live` / `role=status` / `role=alert` 区域
  （只有就绪检查失败时才出现 `role="alert"`），加载完成与失败对读屏用户是静默的。
- **建议**：抽一个 `SectionState` 展示组件（`loading | empty | error` 三态，统一标题常驻、统一重试按钮 ≥44px、
  `role="status"`/`role="alert"`），五个区块替换使用。这是纯展示抽取，属于 `components/` 内的复用，不是 shared-core。
- **优先级**：P1。**范围**：新增 1 个组件，改 5 个区块组件的三态分支。
- **验证**：各区块现有 Vitest 用例的文案断言保持；新增一条 E2E 断言五个区块失败时都有可聚焦的重试按钮。

#### U-5 键盘、焦点与触控目标

- **现状证据**（实测）：
  - Tab 顺序与视觉顺序一致；设置抽屉是原生 modal `<dialog>`，连续 30 次 Tab 焦点不逃逸，Esc 关闭后焦点回到
    设置按钮；有 `aria-labelledby`。这部分做得好。
  - **DocTalk 入口卡片获得键盘焦点时没有可见指示**（`18-keyboard-focus--desktop-1280.png`）：
    `App.tsx:118` 同时写了 `focus-visible:ring-2` 和任意值 `shadow-[…]`，实测 `box-shadow` 只剩阴影那一层，
    环被覆盖。其余按钮均有 2px 焦点环。
  - `EndedConversation.tsx`、`ConversationStatusViews.tsx`、`SettingsProviderFields.tsx`、`AuthGate.tsx`
    中 `focus-visible` 出现 0 次，这些文件里的按钮依赖 `.btn-primary`，而该类没有定义焦点样式
    （`styles.css` 的 `.btn-primary`）。这几处的实际焦点表现本轮未逐一实测。
  - 390 宽触控目标 <44px：设置齿轮按钮 36×36（`App.tsx:50`，`p-2` + 20px 图标）；
    设置抽屉内 7 个输入框/下拉框高 34px。
  - 页面没有 `<main>`、`<header>`、`<nav>` 地标；`document.title` 是 "Echo Talk"（品牌写法为 EchoTalk）。
  - 320 宽与 390 宽 200% 字号下无横向溢出（`scrollWidth - clientWidth = 0`）。
- **建议**：`.btn-primary` 统一加 `focus-visible` 环；DocTalk 卡片改用 `outline` 做焦点指示避免与阴影冲突；
  齿轮按钮加 `min-h-[44px] min-w-[44px]`；表单控件 `min-h-[44px]`；`App.tsx` 外层包 `<main>`。
- **优先级**：P1。**范围**：`styles.css`、`App.tsx`、`SettingsProviderFields.tsx`。
- **验证**：E2E 增加"Tab 遍历每个可聚焦元素都有非透明 outline 或 ring"和"390 宽所有交互元素 ≥44px"两条通用断言。

#### U-6 文案与 i18n

- **现状证据**：
  - 未走 `src/i18n/` 的用户可见文案：`DocUploadCard.tsx:221`（aria-label）、`:273`（placeholder）、
    `DocChatSetup.tsx:47`，以及 F-3 第 4 点列出的 store/lib 中 11 处。
  - `zh-CN.ts:97` `goalReached: "Goal reached!"` 是英文。
  - 设置按钮的可访问名称是"自定义模型设置"（取自 `zhCN.settings.title`），抽屉标题也是它，
    但抽屉里第一屏是"外观主题"和"安全诊断"（`06-settings-drawer`）。建议标题改为"设置"。
  - 活动会话行展示完整 UUID（`02-dashboard-active-sessions`），对用户没有意义且挤占手机宽度。
  - 连接失败页标题和正文首句重复："语音连接已中断，音频已停止 / 语音连接已中断，音频已停止。返回后可明确恢复已有记录。"
    （`09-session-connection-failed`）。
  - 推荐卡片的场景名与技能标签是英文原值（"Travel Planning"、"Grammar Past Tense"），语法提示里的
    `skill_tag` 也是原值（`PronunciationFeedback.tsx:74`），而周语法区块已有中文映射（`zh-CN.ts:150-157`）可复用。
- **优先级**：P2（硬编码文案 P1，因为 `AGENTS.md` 明确要求走 i18n）。**范围**：i18n 文件 + 约 15 处引用。
- **验证**：加一条 ESLint 规则或 Vitest 扫描，禁止 `src/` 非 i18n、非测试文件的字符串字面量含中文字符。

#### U-7 遗留文案：无发音且无语法错误

- **现状证据**：`15-analysis-no-pron-no-grammar--*.png`。分析成功、`assessment` 为空、`grammarErrors` 为空时，
  页面只有一行"本次未生成发音评估，仅展示语法提示"和"返回主页"按钮——说要展示语法提示，下面却什么都没有
  （`PronunciationFeedback.tsx:61` 无条件显示这句，`:65` 语法列表为空时不渲染）。
  这就是 `TODO.md:19` 记录的"无发音且无语法错误时的文案待定"。
- **约束**：当前语法检测仍是 demo 规则（`TODO.md:19`），所以"没检出"不等于"没有错误"，文案不能祝贺用户零错误。
- **三个方案**（请用户选，见 §5）：

  | 方案 | 文案                                                                                     | 取舍                                                                                           |
  | ---- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
  | A    | 标题"本次练习已保存"；正文"暂时没有可展示的发音评估和语法提示。"                         | 最诚实、最短，不暗示任何质量结论；缺点是偏冷，用户不知道原因                                   |
  | B    | "本次未生成发音评估，也没有检测到语法提示。当前语法检测覆盖有限，未检出不代表没有问题。" | 把能力边界讲清楚，与"Demo 模拟结果"的提示风格一致；缺点是长，且 SGEC 上线后要改                |
  | C    | "本次没有需要提醒的内容，继续保持练习节奏。" + 按钮"再练一次"                            | 最有鼓励性并给出下一步；缺点是读起来像"零错误"，在 demo 规则阶段有误导风险，与 TODO 的口径冲突 |

  我的建议是 **A 的标题 + B 的第二句作为小字说明**，并且把现有的 `pronunciationUnavailable` 拆成两条 key：
  有语法提示时保留原句，没有时用新文案。无论选哪个，都应同时显示"技能掌握度未更新"的原因（若适用）。

- **优先级**：P1。**范围**：`zh-CN.ts` 两个 key、`PronunciationFeedback.tsx` 一个分支、对应 Vitest 与 Fake API 夹具。
- **验证**：Vitest 覆盖四种组合（有/无发音 × 有/无语法）；E2E 复用 `grammar-only` 夹具加空语法变体。

### 2.4 三端复用与平台边界（对应任务 4.4）

#### P-1 平台适配层够不够用

`src/platform/` 现有 `detection.ts`（67 行）、`url.ts`（246）、`webLifecycle.ts`（279）、`lifecycle.ts`（410）。
按 iOS/macOS 实际需要的能力对照：

| 能力                   | 现有抽象                                                                                    | 缺口                                                                                                                                                                            | 缺失时最可能漏进的业务位置                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 平台探测               | 有（`detection.ts:18`）                                                                     | —                                                                                                                                                                               | —                                                                                 |
| API / LiveKit 地址     | 有（`url.ts`），含原生代理推导                                                              | —                                                                                                                                                                               | —                                                                                 |
| 前后台切换             | 有。`LifecycleAdapter` 接口（`lifecycle.ts:32-38`），Web 与 iOS（`@capacitor/app`）两个实现 | macOS：`createLifecycleAdapter` 对非 iOS 一律返回 Web 适配器（`lifecycle.ts:404-406`）。Tauri 窗口隐藏/系统休眠是否触发 `visibilitychange` 需要 CP-03 设备证据                  | `RoomSession.tsx`、`ActiveSessions.tsx:659`、`store/conversation.ts:60-110`       |
| 系统认证会话回跳       | **无**                                                                                      | `lib/auth.ts:513-516` 用 `signinRedirect()` 整页跳转；`:330` 从 `window.location.href` 读回调。原生需要系统认证会话 + 自定义 scheme / Universal Link 回跳，含冷启动             | `lib/auth.ts`、`components/auth/AuthGate.tsx`                                     |
| Keychain 凭据          | **无**                                                                                      | `lib/auth.ts:58,202` 写死 `window.sessionStorage`。`AtomicWebStorageStore` 已经接受注入的 `store`（`:47`），是现成的接缝，但装配点没有平台分支                                  | `lib/auth.ts:195-215` 的 `getOidcManager`                                         |
| 深链                   | **无**                                                                                      | 没有"应用被 URL 唤起"的订阅接口。探针工程用了 `tauri-plugin-deep-link`（`tools/macos-m1-native-probe/src-tauri/Cargo.toml:14`），Capacitor 侧是 `App.addListener('appUrlOpen')` | `lib/auth.ts`（回调）、`App.tsx`（如果以后有可深链页面）                          |
| 麦克风权限             | **无**                                                                                      | 现在由 `LiveKitRoom audio={true}`（`RoomSession.tsx:312`）隐式触发浏览器权限弹窗；没有"预检 / 被拒后引导去系统设置"的接口。iOS 被永久拒绝、macOS TCC 拒绝后无法在应用内恢复     | `RoomSession.tsx`、`lib/practiceReadiness.ts`、`store/conversation.ts` 的就绪检查 |
| 文件选择               | 用 `<input type="file">` + `FileReader`（`DocUploadCard.tsx:124,250`）                      | WKWebView 下可用性属于 CP-05"文件导入"门禁，未验证                                                                                                                              | `DocUploadCard.tsx`                                                               |
| 安全存储之外的本地存储 | 主题用 `localStorage`（`store/settings.ts:220,231`），已做异常容错                          | 可接受，不需要抽象                                                                                                                                                              | —                                                                                 |

补充两点事实修正：

- 任务说明里"`platform/` 之外只有 `utils/env.ts` 一处用到原生相关调用"按 import 路径是对的，但
  **`RoomSession.tsx:50` 有一处组件内平台分支**：`const isNative = detectPlatform() === "ios"`，并据此决定
  是否等待原生就绪；`store/conversation.ts:69-78` 也有 `isNativeIos()`。这两处是从 `@/platform` 导入的，
  没有违反目录约定，但"macOS 走哪条分支"现在散在三个文件里（另一处是 `lifecycle.ts:404`）。
  建议把这个判断收成 `LifecycleAdapter.capabilities` 上的一个布尔（例如 `requiresNativeReadiness`），
  组件只读能力不读平台名。
- **`src/utils/env.ts` 应该删掉而不是"收回"**：它 23 行全部是对 `@/platform` 的再导出（`env.ts:6-23`），
  唯一使用者是 `lib/api.ts:6`。把这一处改成 `from "@/platform"`，删除 `env.ts` 与 `env.test.ts`
  （先确认测试内容已被 `platform.test.ts` 覆盖）。P2，改 2 个文件。

- **建议**（认证部分以 `CROSS_PLATFORM_AUTH_LIFECYCLE.md` 为准，它 §1 已明确"不实现原生系统认证/Keychain"）：
  在 `src/platform/` 增加三个**只有接口和 Web 实现**的薄文件，原生实现等 CP-03/CP-04 再填：

  ```text
  platform/authSession.ts   interface AuthSessionAdapter { startLogin(); startLogout(); onCallback(listener) }
                            Web 实现 = 现有 signinRedirect + window.location
  platform/secureStore.ts   interface SecureStore { get/set/remove }；Web 实现 = sessionStorage
                            注入到已有的 AtomicWebStorageStore({ store })
  platform/microphone.ts    interface MicrophonePermission { query(); request(); openSettingsHint }
                            Web 实现 = navigator.permissions + getUserMedia
  ```

  `lib/auth.ts` 只改装配点（约 10 行），契约 §2 的快照、revision、401 语义全部不动。
  这是把已经存在的隐式 Web 依赖显式化，不是为未来抽 shared-core。

- **优先级**：P1（在 macOS M2 或 iOS 真登录开工之前完成）。**范围**：新增 3 个文件 + `lib/auth.ts` 装配点。
- **验证**：`auth.test.ts` 现有用例零改动通过；新增接口各一组 Web 实现单测。原生实现全部**未验证**，需设备。

#### P-2 macOS 接入路径（只出设计，未验证）

现状：`tools/macos-m1-native-probe` 是独立 Tauri 工程，`tauri.conf.json:6` 的 `frontendDist` 指向自带的
`../web`，bundle id `org.echotalk.m1nativeprobe`，scheme `echotalk-m1`，与 `apps/vite-app` 没有连接。
`docs/MACOS_MVP_DEVELOPMENT_PLAN.md:109-111` 已规划 M2 把正式壳放在 `apps/vite-app/src-tauri/`，
本设计与之对齐，只补充"怎么接共享构建产物"。

1. **构建产物**：把 `scripts/build.mjs` 的 `ALLOWED_PLATFORMS` 从 `web | ios` 扩为加上 `macos`，
   产出 `dist/macos/<mode>/` 与同结构的 `build-manifest.json`（`build.mjs:138`，字段沿用
   platform / mode / API origin / auth mode）。校验规则复用 iOS 的：非 development 必须是 HTTPS API + OIDC，
   拒绝 dev Token（`CROSS_PLATFORM_ARCHITECTURE.md` §8.2）。
2. **壳读取产物**：`src-tauri/tauri.conf.json` 的 `frontendDist` 不写死路径，由一个 `sync-macos.mjs`
   （对照现有 `scripts/sync-ios.mjs`）在调用 `tauri build` 前校验 manifest 的 `platform === "macos"` 与 mode，
   再通过 `--config` 覆盖 `frontendDist` 为 `../dist/macos/<mode>`。校验失败、目标缺失或拿到 web/ios 产物时，
   在调用 Tauri 之前就拒绝，不回退旧 dist——与 iOS 同步同一条规则。
3. **Turbo 输入输出**：`turbo.json` 的 build 输出加 `dist/macos/**`，输入加 `src-tauri/tauri.conf.json` 与新脚本。
4. **CORS**：后端 `config.py:116,168` 已允许 `tauri` scheme 与 `tauri.localhost`，无需改动。
5. **平台探测**：`detection.ts:40-52` 已识别 Tauri 并返回 `macos`，无需改动。
6. **认证与深链**：按 P-1 的 `authSession` / `secureStore` 接口填 Tauri 实现，bundle id 与 scheme 用正式值，
   不沿用探针的 `echotalk-m1`。

**可以不等设备、现在就做的**：第 1 步、第 2 步的脚本与其 `node:test`（用临时目录和模拟子进程，参照
`build-isolation-test.mjs`、`ios-ci-test.mjs`）、第 3 步。这些都是纯 Node，Linux CI 可跑。

**必须等 CP-03 设备证据的**：是否采用 Tauri 本身（`TODO.md:593-595` 三项均未勾选）；WKWebView 下双向音频、
耳机切换、休眠唤醒；系统认证会话冷/暖回跳；TCC 麦克风授权与被拒恢复；窗口隐藏时 `visibilitychange` 是否可靠
（决定 P-1 的 macOS 生命周期适配器要不要单独实现）；签名、公证与最低系统版本。在这些证据出来之前，
**不要创建 `apps/vite-app/src-tauri/`**（`CROSS_PLATFORM_ARCHITECTURE.md:100` 的既有约束）。

- **优先级**：P2（受 CP-03 阻断）。**范围**：`scripts/build.mjs`、`config-validator.mjs`、新 `sync-macos.mjs`、`turbo.json`。
- **验证**：脚本测试可在云端跑；任何涉及 macOS 运行时的结论都需要设备，本轮全部未验证。

#### P-3 `src/components/` 的目录组织

- **现状**：已经按功能域分了 6 个目录（`auth`、`conversation`、`doc-chat`、`learning`、`pronunciation`、`settings`），
  方向是对的。实际的边界问题有三个：
  1. `learning/` 混了两个页面的东西：Dashboard 的五个区块，以及只在**会话中**使用的 `AnswerRecommendations`、
     只在**会后**使用的 `SkillTree`（两处都用）。
  2. 页面级组件没有归属：`Dashboard` 写在 `App.tsx:28-168` 里（140 行），是三端共用的首屏却没有自己的文件。
  3. 会话的三个阶段（会前活动列表、会中、会后分析）全在 `conversation/` 平铺，`pronunciation/` 只被会后页面使用。
- **判断：整理，但只做"按页面边界归位"，不引入新的分层概念，也不动 `src/` 以外的结构。** 目标：

  ```text
  src/components/
  ├── auth/                AuthGate
  ├── dashboard/           Dashboard（从 App.tsx 抽出）、RecommendedScenarios、DailyProgress、
  │                        WeeklyProgress、WeeklyGrammar、activeSessions/（F-1 的拆分结果）
  ├── session/             VoiceInterface、RoomSession、ActiveConversation、ChatSubtitles、
  │                        ConversationStatusViews、AnswerRecommendations、roomAudio、agentErrorMessage
  ├── review/              EndedConversation、PronunciationFeedback、PhonemeVisualizer
  ├── doc-chat/            不变
  ├── settings/            不变
  └── shared/              SkillTree、SectionState（U-4）
  ```

- **迁移顺序**：① 抽 `Dashboard` 到独立文件（不搬目录）→ ② F-1 拆 `ActiveSessions` → ③ 搬 `review/`
  （文件最少、依赖最简单）→ ④ 搬 `dashboard/` → ⑤ `conversation/` 改名 `session/`。每步一个提交，
  全部用 `git mv`，不夹带内容修改。
- **影响范围**：项目用 `@/components/...` 绝对别名。非测试源码中跨目录 import 这些组件的约 15 处
  （`App.tsx` 9 处，其余在 `EndedConversation`、`ActiveConversation`）；测试文件与被测文件同目录，跟着搬即可，
  内部相对 import 不变；E2E 有 1 个夹具直接 import 源码路径
  （`e2e/fixtures/answer-recommendations.tsx:3`），以及若干 spec 里的 `import("/src/store/…")`（store 不搬，不受影响）。
  `docs/` 中引用旧路径的验证文档属于历史记录，不回改。
- **优先级**：P2，且**排在 F-1 之后**；如果用户认为目录搬迁带来的 `git blame` 噪声不值得，可以只做第 ① 步。
- **验证**：三测试树计数不变；`git diff --stat -M` 显示均为 rename；`pnpm exec turbo run build --force`。

## 3. 建议的第二轮任务清单

格式与 `TODO.md` 一致，可直接复制。顺序即建议的执行顺序。

- [ ] **R2-01 `ARCHITECTURE.md` 改回当前架构**（A-1，P0）：按本报告 §2.1 的核对表重写 §2 能力表与 §7 风险，
      已解决项移入"已关闭风险"并附代码行；同步 `docs/README.md` 的导航描述。验收：§7 每条风险都有文件行号；
      全文不再出现"仅 Mock""`JWT_SECRET_KEY` 派生"作为现状描述；`pnpm format:check` 通过。只改文档。
- [ ] **R2-02 浅色主题对比度达标**（U-1，P0；色值待用户裁定）：调整 `theme-tokens.css` 中暖色/冷色的
      `--accent`、`--text-muted` 及语义色的文字用法，空态/加载/错误文案不再使用 `text-faint`。验收：新增 E2E
      在三主题下断言主按钮、标题、次要文字、空态、状态徽标对比度 ≥4.5（大字 ≥3.0）；现有主题 E2E 同步通过；
      Chromium 与 WebKit 均通过。
- [ ] **R2-03 无发音且无语法错误的文案**（U-7，P1；方案待用户裁定）：拆分 `pronunciationUnavailable` 为
      "有语法提示"与"无语法提示"两个 key，文案走 i18n。验收：Vitest 覆盖发音有/无 × 语法有/无四种组合；
      E2E 增加空语法夹具；不出现暗示"零错误"的措辞。
- [ ] **R2-04 主路径 E2E 与启动失败处理**（U-2，P1；孤儿会话处理待用户裁定）：Fake API 增加 `/token` 与
      `/dispatch`；新增"点击进入练习 → 连接中 → 连接失败 → 返回主页"E2E；启动阶段错误改用 i18n 通用文案，
      原始 `detail` 只进诊断。验收：新 spec 双浏览器通过；`test:fake-api` 覆盖两条新路由；
      页面上不出现后端英文 `detail` 原文。
- [ ] **R2-05 焦点、触控目标与地标**（U-5，P1）：`.btn-primary` 增加 `focus-visible` 样式；修复 DocTalk 卡片
      焦点环被阴影覆盖；齿轮按钮与设置表单控件 ≥44px；根布局使用 `<main>`。验收：新增通用 E2E——Tab 遍历
      Dashboard、设置抽屉、结束页的每个可聚焦元素都有可见指示；390 宽所有交互元素 ≥44×44。
- [ ] **R2-06 统一区块三态**（U-4，P1）：新增 `SectionState` 展示组件，Dashboard 五个区块的加载/空/错误态
      统一为"标题常驻 + 状态文案 + ≥44px 重试按钮"，并带 `role="status"` / `role="alert"`。验收：五个区块
      失败时均有可聚焦重试按钮（E2E）；现有区块 Vitest 的行为断言不变。
- [ ] **R2-07 拆分 `ActiveSessions.tsx`**（F-1，P1）：按 §2.2 的边界拆为 4 个 Hook + 2 个展示组件，
      保留原导出名与路径。验收：`ActiveSessions.test.tsx` 与相关 E2E **零改动**通过；Vitest 1142、E2E 180
      计数不变（若 R2-02~06 已增加用例，以当时基线为准）；单文件不超过 300 行。
- [ ] **R2-08 文档当前层与历史层分离**（A-2、A-3，P1；目录命名待用户裁定）：按 §2.1 A-3 的结构，先原文搬运
      历史记录，再重写 `PROJECT_STATUS.md`（≤150 行）与 `TODO.md`（只留未完成项）；`agent-review-loop.md`
      保留 §1–§19 编号、回执外移、增加云端会话小节。验收：搬运提交 `git diff --color-moved` 无内容变更；
      仓库内 Markdown 相对链接与锚点检查全部通过；"当前功能"表与 TODO 勾选项无矛盾。只改文档。
- [ ] **R2-09 平台接缝：认证会话、安全存储、麦克风权限**（P-1，P1）：在 `src/platform/` 增加三个接口及
      Web 实现，`lib/auth.ts` 改为经接口装配；把 `RoomSession.tsx:50` 与 `store/conversation.ts:69` 的
      平台名判断改为读取适配器能力；删除 `src/utils/env.ts`。验收：`auth.test.ts`、`VoiceInterface.test.tsx`
      零改动通过；`src/` 中 `platform/` 之外不再出现 `=== "ios"` 这类平台名比较；不新增依赖。
      原生实现不在本项范围。
- [ ] **R2-10 硬编码文案收口**（U-6、F-3，P2）：把 store/lib/组件中 14 处中文字面量与 `goalReached` 英文
      迁入 `src/i18n/`；设置抽屉标题改为"设置"；活动会话行不再展示完整 UUID；推荐卡片与语法提示的技能标签
      复用已有中文映射。验收：新增扫描测试，`src/` 非 i18n、非测试文件中无中文字符串字面量。
- [ ] **R2-11 会话中界面**（U-3，P1；真实媒体验收受外部条件阻断）：覆盖 LiveKit 容器背景为主题色、增加
      场景名与计时页头、手机上字幕优先、`thinking` 使用独立文案。验收：模块桩布局 E2E 覆盖 390 与 1280；
      真实 LiveKit 下的人工验收单列，未做不得勾选整项。
- [ ] **R2-12 macOS 构建产物与同步脚本**（P-2，P2；壳工程受 CP-03 阻断）：`build.mjs` 支持
      `--platform macos` 产出 `dist/macos/<mode>` 与 manifest；新增 `sync-macos.mjs` 的校验逻辑与 `node:test`。
      验收：`test:build` 新增 macOS 用例通过；拿到 web/ios 产物或 mode 不符时在调用外部工具前失败。
      不创建 `src-tauri/`。
- [ ] **R2-13 组件目录按页面边界归位**（P-3，P2；排在 R2-07 之后）：抽出 `Dashboard`，按 §2.4 P-3 的目标结构
      `git mv`。验收：`git diff --stat -M` 全部为 rename 或纯 import 路径修改；三测试树计数不变。
- [ ] **R2-14 Compose 就绪与迁移编排**（A-1 的 P1-3、P1-5，P2）：API 增加基于 `/api/health/ready` 的
      healthcheck，`echotalk-web` 改为 `condition: service_healthy`，增加一次性迁移服务。验收：云端可做
      `docker compose config` 校验；整栈启动验证需要 `.env` 与外部依赖，另列为未验证。

## 4. 本轮没有提议的事

按任务约束，以下内容本轮不作为建议：抽 `packages/shared-core`、拆 `apps/web|ios|macos`、为某一端单独写 UI、
引入 Router、引入正式 i18n 框架。评估后我也没有发现需要推翻
`CROSS_PLATFORM_ARCHITECTURE.md:39` 这条决策的证据：三端差异目前确实集中在 `platform/` 与 `lib/auth.ts`
装配点，共享一个客户端是合适的。

## 5. 待用户裁定

1. **U-7 文案**：方案 A / B / C，或我建议的"A 标题 + B 说明"。
2. **U-1 品牌色**：暖色主题的主色 `#f76b4a` 作为按钮底色与标题色对白只有 2.93 / 2.75。可选：(a) 加深主色；
   (b) 保留主色、按钮文字改深色；(c) 接受现状并记录为已知偏离。这是品牌决定。
3. **U-2 孤儿活动会话**：创建成功但取 Token 失败时，(a) 客户端自动调用幂等 `end`；(b) 保留记录让用户从
   "活动会话"恢复（现状）；(c) 服务端对从未签发 Token 的会话做超时清理。这涉及已冻结的 CP-02 契约
   （`CROSS_PLATFORM_ARCHITECTURE.md` §8.4"当前不实现创建重试"），所以不自行决定。
4. **A-3 文档重组**：是否接受 `docs/history/` 方案；与现有 `docs/archive/` 合并还是并存；
   `agent-review-loop.md` 的"编号只追加不重排"是否允许正文瘦身。
5. **产品口径**（任务说明已列，仅转述）：场景 `goals[]` 与 Task Completion；周报"练习时长"的定义。
6. **文档冲突**：`PROJECT_STATUS.md:1164` 说周报"未实现，不可对外宣称可用"，`TODO.md:497-505` 说其中两项已完成。
   我按代码与截图判断后者为准，但"对外能否宣称"是口径问题，请确认。
7. **截图入库**：43 张 PNG 约 6 MB。如果不希望二进制进主干，合并前可以改为只保留报告引用的十几张或改存 PR 附件。

## 6. 其他观察（未展开）

- `docker-compose.yml` 里写死了一个 LiveKit Cloud 项目域名作为 `LIVEKIT_UPSTREAM`。它不是密钥，但属于环境标识，
  建议改为必填环境变量。
- `PROJECT_STATUS.md:1221-1222` 记录的 CI runner 风险（Actions 的 Node 20 runtime、`ubuntu-latest` 迁移）本轮未核实现状。
- `TODO.md:59` 的 WebKit `weekly-grammar.spec.ts:57` 偶发失败：本轮完整 E2E 跑一次未复现，不构成结论。

## 7. 未验证事项及原因

| 事项                                                                                                                        | 原因                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 真实 LLM / Deepgram / Cartesia / ELSA / LiveKit / IdP 全部链路                                                              | 环境无 Key，任务禁止调用                                         |
| 会话中界面的真实表现（音频可视化、麦克风控制条、字幕滚动）                                                                  | 无 LiveKit；`10-session-active-stubbed` 为模块桩，仅验证布局     |
| iOS、macOS 的任何运行时行为，包括 §2.4 的全部原生设计                                                                       | 云端无 Xcode、无设备                                             |
| Docker 镜像构建与 Compose 整栈                                                                                              | 需要 `.env`；本轮未尝试 `docker build`                           |
| 远端 CI 当前状态、required check 配置                                                                                       | 本轮未查询 GitHub                                                |
| `check:api-types`、`test:api-types`、`test:build`、`test:fake-api`、OpenAPI/Provider 导出校验、`tools/keyfree-runtime` 单测 | 任务命令表未包含，未运行                                         |
| WebKit 下的截图与无障碍实测                                                                                                 | 截图与无障碍脚本只用了 Chromium；WebKit 仅由既有 180 项 E2E 覆盖 |
| 读屏软件（VoiceOver / NVDA）实际朗读效果                                                                                    | 无设备；只检查了 DOM 语义与属性                                  |
| 浏览器后退键、刷新后状态保持                                                                                                | 未实测，F-2 中为读码推断                                         |
| U-2 孤儿会话在真实后端是否同样产生                                                                                          | 仅在 Fake API 上观察到；后端是否有补偿未核对                     |
| `EndedConversation` 等 4 个文件中按钮的实际焦点表现                                                                         | 只做了静态 `grep`，未逐一 Tab 实测                               |
| 对比度建议色值的视觉效果                                                                                                    | 只做了数值计算，未出设计稿                                       |
