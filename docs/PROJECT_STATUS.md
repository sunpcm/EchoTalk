# EchoTalk 当前状态

> 最后核对：2026-11-16。当前卡片为 **GOAL-DESIGN 场景 goals 与 Task Completion 设计（`FINAL_READY`）**：
> 唯一工作树为
> `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
> `codex/B1-learning-events-20261112`，冻结 HEAD
> `929fb0ea91d2c9937c1414be192e5f5cad47d02c`，开工 clean。本卡只把私有已内容评审的场景
> goals/Task Completion 设计草案写回 `docs/SCENARIO_GOALS_DESIGN.md`，并只更新 `TODO.md`、
> 本文件与 `docs/history/2026-11.md`；goal 持久化 A/B/C、判定器、状态机与总体完成度均待用户
> 确认，未实施、未获业务批准。实施节点不运行测试/服务/PG，不执行 Git 写操作（允许只读核基线）；
> 主控 12 项行为/工程门禁已全 `exit 0`（机器核验 behavior `0`），完整数字集中在下方 GOAL-DESIGN
> 小节。设计草案见
> [SCENARIO_GOALS_DESIGN.md](./SCENARIO_GOALS_DESIGN.md)。
>
> WR-DESIGN 周报剩余指标设计（`FINAL_READY`）现作为最近历史快照保留（已 `APPROVED` 并发布
> `929fb0ea91d2c9937c1414be192e5f5cad47d02c`）：`p_mastery` 环比 A/B/C、报告/对比窗口与 IANA 时区
> 均待用户确认，业务未获批准。详细见下方
> [WR-DESIGN 小节](#wr-design-周报剩余指标设计final_ready)。
>
> WDI 周报时长真实本地组合补验（`FINAL_READY`）现作为最近历史快照保留（已发布
> `9d75fb0a67c835eb7b29af6f88b284a28ca9263a`）：唯一工作树为
> `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
> `codex/B1-learning-events-20261112`，开工 clean。本卡只新增显式本地测试入口、
> Chromium/WebKit 组合用例及隔离 harness/说明，补浏览器 → 真实 HTTP → 本地 FastAPI/main lifespan/
> dev 认证/生产 `get_db` → 真实 SQLAlchemy/asyncpg → 自有 PostgreSQL → 现有 parser/controller/UI
> 的组合缺口。产品、既有测试、默认 Playwright/Vite 配置、旧 bridge、迁移与依赖锁不改；默认 278
> 例 E2E 不扩写。WDI 本机合成链路子范围已完成，完整机器数字、失败历史、变异、guard 与资源
> 状态集中记录在下方 [WDI 小节](#wdi-周报时长真实本地组合补验final_ready)；CP-06 父项及真实
> 外部条件不因本子项完成而勾选。详细边界见下方 WDI 小节与
> [CP-06 周报时长验证说明](./verification/cross-platform/CP-06-WEEKLY-DURATION-LOCAL.md)。
>
> TDOC 文档卡现作为最近历史快照保留，其结论为 **TDOC 剩余待办与项目状态核对（`FINAL_READY`）**：
> 唯一工作树为
> `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
> `codex/B1-learning-events-20261112`，本次核对业务基线（原开工 HEAD）
> `3134a0ccb47d5c75e570117d2eb534cd265f712e`，开工 clean。本卡只核对并写回 `TODO.md`
> 与本文件；产品、测试、迁移、依赖及其他文档只读。实施节点不执行 Git 写操作；最终主控独立
> Review 后的正常 commit/push 以主控同卡回执为准，本卡不会新开 PR。实施节点未运行测试或服务；
> 主控按 `AGENTS.md` 负责完整三树，只有自有 PG 用于门禁。主控最终 13 项门禁全部 `exit 0`；
> 完整机器数字、旧复选框保持、保护文件核对与自有 PG 精确清理证据集中记录在下方
> [TDOC 小节](#tdoc-剩余待办与项目状态核对final_ready)，其他历史小节数字保持原时点口径。
> WD-DESIGN `9d3ab32`、WD-API `9179050`、WD-UI `3134a0c` 已由主控分别独立 Review
> `APPROVED` 并推送当前分支，用户 Review 仍待。`9179050` 只是 WD-UI 原源码父提交，不是
> 本次核对业务基线，也不替代 `3134a0c` 的独立证据。
>
> 本次核对确认 58 条未勾选的原始复选框记录：R2 为 2；候选产品 6 加 P1 的 7，合计 13；
> 历史维护待验为 9；RF 为 8；CP 及后续候选为 26。58 是原始记录数，包含父项、重复外部验收和
> 远期候选，不能称 58 张独立开发卡或精确工期；本卡未改复选框、未新增复选框，也未拆分重复卡。
> 本卡只证实本次核对业务基线 `3134a0c` 的两个远端 CI 查询结果：GitHub 的
> `/commits/3134a0ccb47d5c75e570117d2eb534cd265f712e/check-runs` 与
> `/actions/runs?head_sha=3134a0ccb47d5c75e570117d2eb534cd265f712e&per_page=100`，两者均为
> `total_count=0`。该证据绑定原业务基线 `3134a0c`，不随本次文档后续提交改写，也不据此推断
> 其他远端状态；因此该业务基线远端 CI 缺证，RF-04、CP-06 与已实现的 iOS 预下载有限重试继续
> 保留未验证。后续触发 CI、修改 workflow 或分支保护规则均未获本卡授权，也不以历史 `main`
> 运行覆盖该业务基线。
>
> 下一张建议是已确认时长的浏览器→真实本地 API→合成 PG 整链路补验，先核既有覆盖与隔离启动条件，
> 只补实际断点；本卡不实施。其他可先写指标及 goals/Task Completion 的产品/数据设计草案、正式
> i18n 迁移的取舍草案，均不代表已确认业务口径或获准实施。只读源码显示
> `backend/main.py` 的 lifespan 调用 `settings.validate_runtime()`，`backend/config.py` 提供
> 显式 `DEV_AUTH_TOKEN` 入口，且 `validate_runtime()` 还校验 active key 与 keyring 等完整安全
> 配置。准确边界是：存在显式 dev 鉴权入口，仍须满足完整安全配置校验；本卡未启动产品 API 或
> 整链路，运行条件待下一卡实证。详细最终验收数字只在本文件 TDOC 小节集中记录；下方 WD-UI
> 及三卡小节均保留各自时点的历史和数字。
>
> WD-UI 原当前卡现作为历史快照保留。客户端只固定发送
> `include_recorded_duration=true`，服务端仍以默认 `false` 保持旧四字段/count-only 兼容；
> 已有 parser、requestAbort、baseURL、controller、生成类型和迁移不改。周总与选中日使用同一
> “可用 / 暂无可用 / 未知”语义，全部不可计算不再显示 `0秒`，零个可信不可计算计数也不再冒充
> 已知 0。正式返修 `1/2`；测试前过程纠正 `1`、TDD oracle 修正 `2`，全部原始失败证据保留。
> 主控最终 13 项机器门禁全部 `exit 0`，新 17 回归、双浏览器、截图、四组私有变异与 PG 清理完成；
> 详细数字只集中在下方 WD-UI 小节。WD-API 已独立 Review `APPROVED` 并随 `9179050` 推送，
> WD-DESIGN 已独立 Review `APPROVED` 并随 `9d3ab32` 推送，二者均作为历史快照保留。
> 下方 CP04E、CP04I、CP05L、CP02I、CP05K 等小节均为各自时点的历史快照，其中测试数字、基线、
> 资源状态与 Review 结论不对当前 WD-UI 作新证据。
> 下方 CP05D、R2-11、R2-10 以及 SGEC-OFF、R2-UI、R2-LIVE、DEC-A、RDOC、A18P2、
> A19 P2 等小节也均为各自时点的历史交付。R2-11 当时的模型分工与路由可用性记录不代表
> 本卡路由或产品结论。旧 CP05D 所属批次的合成 PG 已 `stop_exit0`/`auto_removed=true`；
> `cp05k-cp02i-cp05l-20261115` 新批三卡共用 PG 也已在 CP05L 最终收口时按精确 container ID、
> 双 owner、`127.0.0.1` 与合成身份核验后 `stop_exit0`、`auto_removed=true`。这里的“三卡”
> 明确指历史批 **CP05K / CP02I / CP05L**。当前时长三卡仅核销“已记录会话时长”本范围，完整周报、
> CP-05、三端和真实学习质量仍未完成。本批自有 PG 已按精确 ID、双 owner、loopback 与合成身份
> 核验后清理，名称与 ID 均不存在，其他资源未动。
> 生产、真实 Provider/IdP/LiveKit、设备、部署和真实数据仍未验收。
> 正式 macOS 客户端、Tauri 选型、native 认证、设备与签名均未创建或验收。
> 本文只回答"现在实现了什么、验证到哪一步、有哪些已知限制"。未完成工作只在根目录
> [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；逐轮实施记录在
> [`history/`](./history/)，不在本文追加。

## 当前功能

| 领域           | 当前实现                                                                                      | 状态与边界                                                              |
| -------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离               | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收       |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                             | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明              |
| 启动与系统就绪 | 公开 `/api/health/system-ready` 只读检查共享 PG；Compose 先迁移后启动并校验 API 健康          | 本地合成合同已验收；原整栈、生产 rollout 和真实外部依赖未验收           |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束          | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭             |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态                               | 自动化覆盖状态机；语法为 demo 规则，真实发音 Provider 未验收            |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态            | 已实现                                                                  |
| 本人数据导出   | `GET /api/user/data-export` 输出固定 v1 JSON，显式白名单并读取单一一致只读快照                | 已实现；代码/测试 Review APPROVED，用户 Review 待、无导出 UI            |
| 本人账号删除   | `DELETE /api/user/account` 在受控事务硬删本人 12 类业务数据，保留控制行和他人数据             | 已实现；代码/测试 Review APPROVED，用户 Review 待；生产不可恢复性未验收 |
| 自适应课程     | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                           | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务                |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast            | 已实现；密钥轮换和 Provider 连通性需按环境验收                          |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                           | 已实现 Web 流程；原生端文件选择未验收                                   |
| 前端体验       | Dashboard 已独立，课程推荐、每日进度、评估反馈按页面边界归位；三主题、键盘焦点、44px 触控目标 | 三主题文字对比度有 E2E 回归；边框对比度与读屏实测未完成                 |
| 周度学习       | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3、已记录会话时长         | **部分实现**：时长三卡本范围已 FINAL_READY；其他周报指标未实现          |
| iOS            | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                                       | 真机全链路、原生登录与发布未验收                                        |
| macOS          | 共享 Vite 静态产物 `dist/macos/<mode>`、manifest、sync 前校验和 Turbo `ANALYZE` 缓存          | 纯脚本已实现；正式客户端、壳、Tauri 选型、native 认证、设备与签名未验   |
| 数字人         | 只有待办                                                                                      | **未实现**                                                              |

## 当前验证基线

### GOAL-DESIGN 场景 goals 与 Task Completion 设计（`FINAL_READY`）

- **范围与写集**：唯一工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD 为
  `929fb0ea91d2c9937c1414be192e5f5cad47d02c`，开工 clean。允许写集为
  `docs/SCENARIO_GOALS_DESIGN.md`、`TODO.md`、本文件与 `docs/history/2026-11.md`。
  实施节点只写回设计草案，不安装依赖、不改代码/测试/迁移/锁，不运行测试/服务/PG，不执行 Git
  写操作（允许只读核基线）；最终全仓 format、独立 Review、正常 commit 与当前分支 push 以主控同卡回执为准。
- **内容**：把私有已内容评审的场景 goals/Task Completion 设计草案写回，goal 持久化 A/B/C（A 目录内
  版本化目标为推荐、待确认）、判定器与状态机、总体完成度 `achieved X / assessed Y / total Z` 均待确认；
  技术失败 `unknown`、未运行 `not_assessed`、成功评估未满足 `not_achieved`。用户此前仅批准“已记录
  会话时长”方案 A；本卡各方案均未获业务批准，未实施。
- **口径保护**：`material.id` 字符串不与 `sessions.scenario_id`（Integer）互填；新增 goal/evaluation/
  revision 持久化必须以账号结构化导出与 B1-5 同事务整账号删除为实施前置，未准备好只能延期；不放开
  既有成功 analysis Job 重跑、不复制转录正文、不新增录音。
- **主控机器门禁（12 项行为/工程门禁全 `exit 0`，机器核验 behavior `0`）**：Vitest
  `1309 passed / 60 files`；默认 E2E `278 = 139 Chromium + 139 WebKit`，每例单 result/`retry0`，
  `0 skip/flaky/unexpected`；backend `1055 passed / 3 warnings / 0 skip`，raw coverage
  `81.87336184301283%`；build-script `47`、Fake API `117`、API 类型生成器 `8`、iOS（仅 Node）`37`；
  lint `132 warnings / 0 errors / 0 new`，多重集与基线相同。
- **状态与下一步**：`FINAL_READY`，等主控最终全仓 format、独立 Review、commit/push 与用户/业务
  确认；合成不替代业务确认或真实环境，不称真实准确率/教学效果。设计草案见
  [SCENARIO_GOALS_DESIGN.md](./SCENARIO_GOALS_DESIGN.md)。

### WR-DESIGN 周报剩余指标设计（`FINAL_READY`）

- **范围与写集**：唯一工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD 为
  `9d75fb0a67c835eb7b29af6f88b284a28ca9263a`，开工 clean。允许写集为
  `docs/WEEKLY_REMAINING_METRICS_DESIGN.md`、`TODO.md`、本文件与 `docs/history/2026-11.md`。
  实施节点只写回设计草案，不安装依赖、不改代码/测试/迁移/锁，不运行测试/服务/PG，不执行 Git
  写操作（允许只读核基线）；全仓
  最终 format、独立 Review、正常 commit 与当前分支 push 以主控同卡回执为准。
- **内容**：把私有已内容评审（`R2_READY`）的周报剩余指标设计草案写回，给出 `p_mastery` 环比
  A/B/C（A 最小向前时点快照为推荐、待确认）、报告/对比窗口与 IANA 时区待确认（含推荐组合与
  取舍）、发音/焦虑/语速/RAG 其他指标口径，以及供用户确认的决策清单。用户此前仅批准“已记录
  会话时长”方案 A；本卡各方案均未获业务批准，不称已采纳或实施，用户/业务确认仍待。
- **口径保护**：不得把既有“含今天七桶”滚动窗口静默改成自然周，旧七桶口径完全不变；快照记录
  实际采集时刻，不能晚采后冒周边界。新增快照/读模型必须以账号结构化导出与 B1-5 同事务删除为
  实施前置，未准备好只能延期，本卡不实施。
- **主控机器门禁（13 项全 `exit 0`，机器 verify `0`）**：Vitest `1309 passed / 60 files`；默认
  E2E `278 = 139 Chromium + 139 WebKit`，每例单 result/`retry0`，`0 skip/flaky/unexpected`；
  backend `1055 passed / 3 warnings / 0 skip`，raw coverage `81.90095185542833%`；build-script
  `47`、Fake API `117`、API 类型生成器 `8`、iOS（仅 Node）`37`；lint `132 warnings / 0 errors /
0 new`，多重集与基线相同。
- **状态与下一步**：`FINAL_READY`，已 `APPROVED` 并发布 `929fb0ea91d2c9937c1414be192e5f5cad47d02c`；
  用户/业务确认仍待。合成不替代业务确认或真实环境，不称真实准确率/教学效果。设计草案见
  [WEEKLY_REMAINING_METRICS_DESIGN.md](./WEEKLY_REMAINING_METRICS_DESIGN.md)。

### WDI 周报时长真实本地组合补验（`FINAL_READY`）

- **范围与写集**：冻结基线为 `ad4f61e70fe471cb7ef3c8e5351fb2d0aa177410`（已发布
  `9d75fb0a67c835eb7b29af6f88b284a28ca9263a`），工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`。允许写集为
  `apps/vite-app/integration/weekly-duration/` 的 5 个新文件、`apps/vite-app/package.json` 的
  `test:weekly-duration-local` 入口、新 CP-06 验证说明、[`TODO.md`](../TODO.md)、本文件与
  [`docs/history/2026-11.md`](./history/2026-11.md)。产品业务、既有测试、旧 bridge、默认
  Playwright/Vite 配置、迁移、锁与真实 runtime 均只读。目标是补齐当前缺失的浏览器到自有 PG 的
  真实组合，不重复大量已有单元、ASGI、Fake HTTP 或布局兼容用例。
- **真实拓扑**：Chromium/WebKit 各 2 例；API 只监听 `127.0.0.1:18183`，前端仅 HTTPS
  `127.0.0.1:4175`，遇到占用即失败，不杀、不复用。Playwright 使用真实默认产品入口、真实
  `main.app`/lifespan、生产 `get_db` 与 dev 认证、真实 SQLAlchemy/asyncpg；无
  `dependency_overrides`、ASGITransport、stdio、Fake HTTP、`route.fulfill` 或正常响应重写。
  WebKit 复用仓库既有 launcher。专用 Vite config 显式 `envDir:false`，不导入旧
  `vite.config.ts`/`loadEnv`，保留 HTTPS、React plugin、`@` alias 与 `/api` proxy。
- **显式入口**：从仓库根目录执行
  `pnpm --filter vite-app test:weekly-duration-local --retries=0 --workers=1`。运行前须自建专用
  PostgreSQL、完成迁移并注入仅指向 `127.0.0.1:55433`、`echotalk_b1_test` 数据库/用户的合成
  `DATABASE_URL`；package script 固定设置 `ECHOTALK_WDI_LOCAL_PG=1`。该入口管理真实 API/Vite 与
  fixture 生命周期，不负责起停 PG。
- **进程与网络隔离**：主控进程外注入 `DATABASE_URL`，只接受 `127.0.0.1:55433`、
  `echotalk_b1_test` 数据库与用户；包裹命令固定 `ECHOTALK_WDI_LOCAL_PG=1`。API 子进程只允许该
  PG 出站，非 PG TCP/DNS/`sendto` 硬拒；Python `.env*` 打开读取与 Vite 实际 dotenv 读取硬拒。
  测试 API 外层最小 ASGI envelope 将产品 lifespan 原样透传，只允许与浏览器白名单一致的必要
  Dashboard GET 和 health/ready；非 GET 在进入产品路由前返回 `405`，未知 GET 返回 `403`，
  WebSocket 直接关闭。产品 app、路由、认证与依赖覆盖不变，服务端拒绝不依赖 page route。
- **合成 fixture**：默认 dev 身份为 `urn:echotalk:dev` / `local-developer`，优先复用预检创建的
  用户；缺失时才用固定 ID 初始化并记录 ownership。另有固定他人用户；全部 10 条 session 使用
  marker `wdi-local-weekly-duration-20261116`。七天 completed 为
  `3/1/1/0/2/1/0`，对应时长 `999ms/61,500ms/0/0/0/3,600,000ms/0`，不可计算计数
  `0/0/0/0/2/0/0`。1–3 号分别 333666µs，逐条 floor 后合计 `999ms`，而错误地汇总后 floor 为
  `1000ms`；4 号为 61.5 秒；5 号合法零；6–7 号为 missing/negative end；8 号为整小时；9 号为
  当前用户 active；10 号为他人 completed。独立 oracle 冻结周总 `3,662,499ms`，UI 显示
  “1小时1分2秒”、不可计算 `2`。
- **组合断言**：主场景按真实 weekly request/response 校验 `end_date/timezone/include=true`、
  七桶六字段、逐条 floor、合法零、11-01 选中日两条均不可计算、首个 50 条查询窗口与用户/状态
  排除；正数日点击只按
  `/api/sessions` 路径捕获本次 request，再由同一 `Request.response()` 校验 query/status/IDs，并
  异步核对 DOM listitem IDs。零日按产品原语义检查 UI 空态，另用同源真实 Bearer GET 独立验证
  该历史窗口为空；不伪造未发生的浏览器请求。兼容场景用同源真实 HTTP 校验省略/false 四字段和无
  Bearer `401`。每例最终断言 `capture.blocked=[]`、`pageErrors=[]`、无业务写和禁用动态 GET。
- **最终机器门禁**：前端七项加后端五项共 12 项最终 `exit 0`。Vitest 为
  `1309 passed / 60 files / 0 skip`；默认 E2E 为 `278 = Chromium 139 + WebKit 139`，每例一个
  passed result、retry 0，skip/flaky/unexpected 均为 0；backend 为
  `1055 passed / 3 warnings / 0 skip`，
  raw coverage 为 `81.90095185542833%`。完整 backend 套件含既有单元、mock 与 PostgreSQL 测试，
  不把 1055 全部描述为无 mock 的整链路。Fake API `117`、build `47`、API 类型 runner `8`、iOS
  仅 Node runner `37` 均 `exit 0`；lint 为基线 `132 warnings / 0 errors / 0 new`，按
  file/message/rule 多重集与基线完全相同。新增真实 HTTP+PG 组合另计 `4 = Chromium 2 + WebKit 2`，
  最终 `exit 0`，不与默认 278 例 E2E 混算。
- **负对照与快速重启**：两项语义变异各为 `1 selected / 1` 个具体 assertion failure，子进程状态
  `1`，组合 driver `exit 0`；Python/Node 隔离 guard 为 `exit 0`，真实 `POST/PUT` `405`、
  unsafe GET `403`、原始无认证 `401` 负对照 driver `exit 0`。同一端口快速连续启动成功；保留
  存活 listener 的连接/accept 哨兵仍拒绝且未受影响。`SO_REUSEADDR=1` 只解决已停止自有服务的
  `TIME_WAIT`，未启用 `SO_REUSEPORT`，不绕过仍存活的占用者。
- **格式核验**：spec 与 runner 两文件仅经现有 Prettier `--write`；主控已对 before/after 做完整
  AST 与 raw 模板字面量等价核验，断言、向量与产品行为未改。
- **资源生命周期**：固定端口先排他探测；只管理本进程启动的 API/前端 PID 与 marker/fixture state。
  正常和启动失败均先收束自有子进程，再按 state 精确清理本卡会话、自有他人用户及本卡新建
  settings/profile；即使 seed 结果不明确，只要 state 或进程存在仍尝试回收。cleanup 失败不删除
  临时根，保留 state 路径并非零报告；不终止占端口者、不复用端口。预检 dev 用户不由本卡无条件
  删除。实测仅 API/Vite 自有进程/监听资源与 WDI marker rows 已回收；本批专用合成 PG 仍为后续
  三张设计卡的后端验证独占保留。
- **失败与返修历史**：R0 四例先因 direct Node 绕过标准 bin shim、已缓存 PostCSS 插件解析失败
  而在 CSS 初始化阶段失败，不是产品 RED。runner 改为执行现有 `node_modules/.bin/vite` shim，
  dotenv preload 与自有 PID 生命周期保持，未安装依赖或修改 PostCSS/样式。R1 两例通过，另两例仅
  因历史 window 常量使用 `.000Z`、真实 controller query 使用同瞬间的 `Z` 而失败，属于测试 oracle
  写法；第 3 轮在 helper 中先验证带时区 RFC3339，再以 `toISOString()` 与独立窗口常量比较。
  正式 harness 返修最终 `2/2`，产品业务返修 `0/2`。主控已修正 Ruff 的 backend cwd 接线，不把
  repo cwd 的 I001 误记为源码问题。
- **R2 快速重启缺陷**：真实连续周期暴露手工预绑定 socket 未设 `SO_REUSEADDR`。主控用同一端口
  控制复现无 reuse 失败 `errno 48`→启用 reuse 成功→移除后再次 `errno 48`；修复只在 bind 前启用
  `SO_REUSEADDR`，绝不启用 `SO_REUSEPORT`。存活 listener 的连接/accept 哨兵继续被真实 bind
  拒绝。历史首个私有 API stderr 未保留，不能声称当时直接采到 errno；现有结论只与已复现机制一致。
- **证据保留**：R0 trace 未单独复制，后续 output 清理后仅保留原日志/JSON/RCA；R1 及之后各轮 trace
  分别保存在独立 output 目录。导入、连接或缺失配置失败不算有效业务 RED，skip 不算通过。
- **完成边界**：WDI 只完成本机浏览器→真实 HTTP→FastAPI→SQLAlchemy/asyncpg→自有合成 PG→现有
  UI 的子范围。没有新增大于 50 条的真实 PG 分页场景，不宣称本卡验证 50+5 分页；既有
  controller/backend/Fake API 覆盖继续承担分页。CP-06 父项、Linux CI、真实 IdP/LiveKit、设备、
  生产部署、真实数据与完整周报父项继续未验收且不勾；后续三份设计分别为周报剩余指标、goals/Task
  Completion 与正式 i18n，仍待逐卡写回和用户决策。
- **终态与交接**：代码、测试和四份文档均已停写。全仓最终 format、独立 Review、正常 commit 与
  当前分支 push 以主控同卡回执为准；本小节不预告这些回执，也不与新开 PR、merge、deploy 混同。

### TDOC 剩余待办与项目状态核对（`FINAL_READY`）

- **范围与基线**：只更新 [`TODO.md`](../TODO.md) 与本文件，基线为
  `3134a0ccb47d5c75e570117d2eb534cd265f712e`。未勾选原始复选框记录为 58：R2 `2`；候选产品
  `6` 加 P1 `7` 合计 `13`；历史维护待验 `9`；RF `8`；CP 及后续候选 `26`。这些数字描述记录
  分布，包含父项、重复外部验收和远期候选，不是独立开发卡数或工期。主控最终核验所有旧复选框
  状态完整保持，原始未勾选记录仍为 58；本卡未勾选、取消勾选、新增复选框或为重复条目另造卡。
- **当前 CI 证据**：本卡只证实 commit check-runs 与 actions-runs 两个接口对本次核对业务基线
  `3134a0c` 均返回 `total_count=0`，不据此推断其他远端状态。该结果绑定原业务基线，不随本次
  文档后续提交改写；RF-04、CP-06 与已实现的 iOS 预下载有限重试继续缺证并保留未验证。后续
  触发 CI、修改 workflow 或分支保护规则未获本卡授权；不把 `9179050`、历史 `main` 结果或其他
  历史门禁当作该业务基线的 CI。
- **三卡状态**：WD-DESIGN `9d3ab32`、WD-API `9179050`、WD-UI `3134a0c` 均已由主控分别独立
  Review `APPROVED` 并推送当前分支；用户 Review 仍待。`9179050` 只保留为 WD-UI 原源码父，
  当前工作基线是 `3134a0c`。WD-UI 顶端原“当前卡”说明已标为历史快照，其失败、数字和 PG 清理
  事实均原样保留，不追溯修改旧历史结论。
- **下一步建议**：优先做已确认时长的浏览器→真实本地 API→合成 PG 整链路补验，先查既有覆盖与
  隔离启动条件，只补实际断点；本卡不实施。只读源码中 lifespan 调用
  `settings.validate_runtime()`，config 提供显式 `DEV_AUTH_TOKEN` 入口，`validate_runtime()`
  还校验 active key 与 keyring 等完整安全配置；因此只可写“存在显式 dev 鉴权入口，仍须满足完整
  安全配置校验”，本卡未启动产品 API 或整链路，运行条件待下一卡实证。指标、goals/Task Completion
  和正式 i18n 可先写设计草案，实施另等用户确认。指标历史快照、窗口和有效口径，goals 完成
  判据，音频采集保留/删除授权及 macOS 方案仍需业务确认；Provider/IdP/LiveKit、设备媒体、
  Keychain、签名、部署和生产仍属外部依赖边界。
- **最终 13 项门禁**：全部 `exit 0`。Vitest 为 `1309 passed / 60 files / 0 skip`；E2E 为
  `278 = Chromium 139 + WebKit 139`，每例恰有一个 passed result，retry、flaky、skip、
  unexpected 均为 `0`；backend 为 `1055 passed / 3 warnings / 0 skip`，raw coverage 为
  `81.77679679955855%`；Fake API 为 `117`、build 为 `47`、API 类型为 `8`，iOS 仅 Node runner
  为 `37`；lint 为 `132 warnings / 0 errors / 0 new`，诊断按 file/message/rule 的多重集与基线
  一致。
- **保护与资源**：`721` 个保护文件字节不变；`2` 个已跟踪 Vite 环境配置仅核验索引/metadata，
  未读取正文。本卡自有 PG 在精确 container ID、双 owner、loopback 与合成库身份核验后为
  `stop_exit0`、`auto_removed=true`，名称和 ID 均不存在，其他资源未动。本卡没有产品变更，也未
  新增镜像单元测试；完整三树由主控执行。
- **终态**：实施节点只写本文件与 [`TODO.md`](../TODO.md)，未执行测试、服务、数据库、CI、Git 写
  或依赖安装。最终格式、独立 Review、正常 commit/当前分支 push 以主控同卡回执为准，用户 Review
  待。所有候选仍只是建议，本卡不启动后续候选、不触发 CI、不修改 workflow 或保护规则、不开 PR、
  不合并，也不创建实施报告；本卡停在 `FINAL_READY`。

### WD-UI 周报“已记录会话时长”前端显示与浏览器验收（历史快照，原时点 `FINAL_READY`）

- **状态与源码基线**：唯一工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，原时点源码父 HEAD
  `917905057ff50c491ed7f69ba74efcd3fd57cdfc`。本卡产品、测试与四份文档停在 `FINAL_READY`；
  正式返修 `1/2`。测试前过程纠正 `1`、TDD oracle 修正 `2`：提前 Fake WIP 已保存并恢复原字节，
  产品恢复原字节后执行有效 RED，再 GO；两轮 TDD 修正均只改测试：第一轮纠正 bool 参数、保留
  既有 `requestAbort.signal` 语义、溢出向量/周总定位与显式时区，第二轮仅修正相对 URL 的测试
  解析基准。这些 WD-UI 修正与 WD-API 卡独立的 `1999us` floor / Singapore 跨日 oracle 分开。
  历史失败未抹除。
- **实现锚点**：`apps/vite-app/src/lib/api.ts` 仅让 weekly 请求固定增加
  `include_recorded_duration=true`，parser/requestAbort/baseURL 不动；
  `apps/vite-app/src/lib/weekly-recorded-duration.ts` 提供“可用 / 暂无可用 / 未知”日桶与周总
  计算，未知计数初值为 `null`，安全整数检查先 `typeof number` 再判断，typed 累计无 `as any`；
  `WeeklyProgress.tsx` 与 `i18n/zh-CN.ts` 显示周总、选中日、合法 0、暂无可用、未知及已知
  不完整计数；Fake 新增请求局部 `duration` 合成记录，默认/false 仍返回 count-only 数据，只有
  opt-in 响应新增两个时长扩展字段。普通 bool 参数与后端一致接受 `1/true` 并拒绝
  `not-a-boolean`。
- **兼容边界**：服务端默认仍为 `include_recorded_duration=false`，省略/false 返回旧四字段且
  count-only SQL 不读取 `ended_at`；旧服务忽略新增参数时，新客户端按缺失字段显示未知。周总只在
  七桶扩展可信、桶内关系统一且时长总和安全时显示；任一桶未知或求和溢出即整体未知；selected
  只读取所选桶，不受其他桶错误连带。全部 completed 不可计算显示“暂无可用时长”，无会话和
  可计算会话的合法零时长显示 `0秒`；至少一个可信计数为 0 时可显示“已知 0 条明细不完整”，
  零个可信计数时不显示伪造的已知 0。
- **TDD 与目标回归**：新组件测试最终 17 case；主控有效 RED 为 `15 pass / 2 fail / 0 skip`，
  两项分别命中全部不可计算仍显示周总 0、七桶全缺失仍显示“已知 0 条不可计算”。产品修复后
  `17/17` 通过。联合 3 个目标文件为 `231` 项全过，这是完整 Vitest 的联合子集，不是另加 231。
  最终一次默认运行发现的 React act 告警仅通过两次 `await flush()` 做同步收口，断言、fixture
  与产品均未改，复验 act 告警为 0；其他旧模块既有告警未改。
- **最终 13 项门禁**：主控实跑全部 `exit 0`。Vitest `1309 passed / 60 files`；双浏览器 E2E
  `278 = Chromium 139 + WebKit 139`，每例恰一个 passed result，retry、skip、flaky、
  unexpected 均为 `0`；backend `1055 passed / 3 warnings / 0 skip / raw coverage
81.77679679955855%`；Fake API `117`、build `47`、API 类型 `8`、iOS 仅 Node runner `37`；
  lint `132 warnings / 0 errors / 0 new`，逐 file/message/rule 多重集与基线相同。
- **私有变异与浏览器审阅**：4 组私有变异各只选中 `1` 个目标 case，并各由 `1` 个具体断言失败
  杀死；每轮另有 `16` 个未选用例，未选不计覆盖。各变异子进程 `exit 1`，组合 driver `exit 0`；
  恢复默认源后 17 项全过。首轮 quality `exit 2` 为 5 个不同位置的诊断、3 种错误代码：3 处
  TS2769，以及 TS18046、TS7022 各 1 处；两个私有边界 fail 原记录保留。4 张实际浏览器截图覆盖
  宽 1280 与窄 390，主控亲审可读且无新增截断/溢出。浏览器用例走真实 Fake HTTP；后端使用真实
  PostgreSQL 引擎上的自建合成库。两者分别实跑，未把两者冒充浏览器直连后端合成 PG 的整链路。
- **保护与数据库**：709 个保护文件 hash 与 2 份已跟踪 Vite 配置的索引/metadata 保持不变；
  原 21 个 parser 前缀 case 与 116 个 Fake 旧 case 保持完全原字节；192 个 api 旧 case 仅允许
  weekly URL 的 1 处字面量追加 flag，其余字节保持。controller、生成文件和 18 份迁移均未改。
  本批自有 PG 按精确 container ID、双 owner、`127.0.0.1` 与合成身份核验后停库，
  `stop_exit0`、`auto_removed=true`，名称和 ID 均不存在，其他资源未动。
- **终态与边界**：实施节点未自跑测试、服务、构建、数据库、截图或生成；以上均由主控实跑。
  最终格式、独立 Review、正常 commit/当前分支 push 以主控同卡回执为准，用户 Review 待，本文
  不自批 `APPROVED`。本卡仅核销“已记录会话时长”三卡范围；完整周报其他指标、CP-05、三端、
  真实 Provider/IdP/LiveKit、设备与生产仍未验收。

<a id="wd-api-周报已记录会话时长opt-in-聚合与兼容解析final_readyui-未实施"></a>

### WD-API 周报“已记录会话时长”opt-in 聚合与兼容解析（历史快照；后续 `APPROVED@9179050`）

- **状态与基线**：唯一工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD
  `9d3ab32da3469d87b29340d35106cfa0cd126128`。本卡已从真实 RED 完成实现、原生生成和最终机器
  验收，源码、测试与生成文件停写。正式返修 `1/2`、TDD 中间修正 `1`；两处 oracle 修正分别固定
  逐条 floor 后合计 `2ms` 和 Singapore 跨午夜按开始日归桶。
- **实现锚点**：`backend/schemas/session.py` 增加两个 optional/nullable 非负整数字段；
  `backend/services/session_queries.py` 在 false/omit 时保持 count-only 单 SELECT，在 true 时
  用一次有界 SELECT 聚合 count、逐行 floor 后的 duration sum 与 unavailable count；
  `backend/routers/sessions.py` 只在本路由接收 `include_recorded_duration` 并设置
  `response_model_exclude_none=True`；`apps/vite-app/src/lib/api.ts` 只扩展 weekly parser 的两个
  明确白名单键，未知键与坏基础字段仍拒绝，关系非法时两个扩展同时降级未知。
- **请求边界**：原 API 收口时点，`getWeeklyProgress` 仍不发送 `include_recorded_duration`；WD-UI
  随后才实施。省略或
  false 的响应形状和 SQL `ended_at` 禁区均由原有测试继续约束；true 的七个固定桶显式返回整数
  `0/0` 或实际聚合值，无顶层周总，其他 query、模型、迁移、CI、SDK 与 controller 未改。
- **最终机器验收**：主控最终 13 项门禁全部 `exit 0`。Vitest 为 `1292` 例、`59` 文件；
  Chromium `136` 加 WebKit `136` 共 `272` 例，每例恰一个 passed result、retry `0`，
  skip/flaky/unexpected 均为 `0`。backend 为 `1055 passed / 3 warnings / 0 skip`，raw coverage
  `81.77679679955855%`；build `47`、Fake API `116`、API types runner `8`、iOS 仅 Node 脚本
  `37`；lint 为 `132 warnings / 0 errors / 0 new`，逐 file/message/rule 多重集与基线完全一致。
  新目标 PG `45` 例与前端 `22` 例均为 GREEN，独立混合 PG `1` 例通过。目录中 `710` 个保护文件
  字节、`20` 个 RED 时 PG 函数 AST 与 `22` 个前端 case 均保持；首轮收口时的全部 `12` 个文件
  hash 已由主控保存至 `reviewer/r0`。
- **R1 与负对照**：首轮全量 E2E `272` 已通过；首轮 quality 为 `exit 2`，出现 `api.ts:839/840`
  的两个 TS2322 与 `842/844/845` 的三个 TS18046，共 `5` 个不同 TS 诊断；build 重复同一组
  `unknown` 收窄问题。R1 把两个原始属性捕获为 const 局部值，再沿用现有
  `isNonNegativeSafeInteger` 与关系判定，不改 parser 语义；之后 quality、完整 Vitest 与全量
  E2E 均重新执行并 `exit 0`。三个私有加载期变异分别去除逐行 floor、去除用户 guard、把默认
  flag 改为 true，均由原有具体断言杀死；正式源码保持，阻断、源码与断言未放宽。
- **诊断记录**：主控编排曾在 Python 3.15 与后端 Python 3.12 的 `ast.dump` 默认差异下得到预检
  `exit 1`；原源码完整前缀与同一 3.12 AST 已确认未变，不计产品回归。私有变异初轮验证 driver
  为 `exit 1` 是 pytest 捕获了导入确认 marker，首 floor 断言已正确失败。追加 pytest 退出后的
  确认 marker 后，三个变异各自的 pytest 子进程均按预期 `exit 1`，并分别由精确断言失败；最终
  一个组合验证 driver 为 `exit 0`。两类诊断均保留原始记录，不把故意失败的 pytest 写成 `0`，
  也不用后续通过抹除旧证据。
- **终态与边界**：本节 HEAD、数字与“WD-UI 未实施”均绑定原 API 收口时点；后续 WD-API 已独立
  Review `APPROVED` 并随 `9179050` 推送。主控已原生生成 `backend/openapi.json` 与
  `apps/vite-app/src/lib/api.generated.ts`。实施节点没有自跑测试、服务、数据库、构建或生成；
  最终格式、Review、正常 commit/当前分支 push 以主控同卡回执为准，用户 Review 待，本文不自批
  APPROVED。真实外部链路仍未验收；原时点本批合成 PG 继续活动供 WD-UI 验证，后续已按最终回执
  清理。

### WD-DESIGN 已确认周报时长合同（设计 `FINAL_READY`；API/UI 未实施）

- **基线与写集**：唯一工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD
  `caa409a9f36f8e4b28c221800930c1f3ec94cef2`，开工 clean。仓内只允许新增
  [`docs/WEEKLY_RECORDED_DURATION_CONTRACT.md`](./WEEKLY_RECORDED_DURATION_CONTRACT.md)，并更新
  [`TODO.md`](../TODO.md)、本文件与 [`docs/history/todo-done.md`](./history/todo-done.md)；产品源码、
  测试、OpenAPI、生成类型、配置、依赖与迁移均不改。
- **已确认产品口径**：API 继续接受既有任意合法 `end_date`，返回截至该日并包含该日的最近七个本地
  自然日；历史日期请求可正常处理，不宣称任意合法 `end_date` 都含今天。UI 默认以用户本地今天作为
  `end_date`，因此默认周视图含今天。沿用现有 IANA 时区与 UTC 半开窗口，按 `started_at` 归日；只算
  当前认证用户的 completed 会话。跨日会话整段归开始日；active/cancelled 不计。
  `ended_at >= started_at` 时，每条先在 UTC 截去不足 1 毫秒再求和；等待、静音、暂停均包含，分析
  任务失败不因本指标推断会话失败。UI 只称“已记录会话时长”。
- **显式 opt-in 与技术 r1**：`GET /api/sessions/weekly-progress` 新增
  `include_recorded_duration: bool = false`。省略/false 保持顶层恰 `days`、每桶恰四字段、count-only
  一次 SQL 且不读取 `ended_at`；路由 `response_model_exclude_none` 防止默认响应被两个 null 扩展。
  `true` 才给七桶增加 optional/nullable 非负整数 `recorded_duration_ms` 与
  `duration_unavailable_count`，不新增顶层周总。
- **兼容矩阵**：WD-API 同时扩展 `parseWeeklyProgressResponse` 和其测试，允许/保留两个明确扩展键，
  四个基础键仍严格校验、其他未知键仍拒绝；扩展缺失/null/非法只降级未知，不伪 0，但 WD-API 尚不
  请求 flag。parser 可独立保留合法扩展，但 WD-UI 必须同时取得可信的两个扩展，满足
  `unavailable <= completed` 与 `computable_count = completed - unavailable` 的关系后才可显示时长。
  `computable_count = 0` 且时长为正属于关系不一致，降为未知；有 completed 但全部不可计算时显示
  “暂无可用时长”，`computable_count > 0` 且时长为 0 才显示合法 0 秒。WD-UI 才固定请求 `true`；
  旧服务忽略参数返回四字段时显示未知。周总仅七个桶信息与关系都完整且严格相加仍为安全整数时显示，
  任一桶缺失即未知；selected-day 只取所选桶。
- **查询与交互**：opt-in 后端仍一次有界聚合，只读取
  `sessions.user_id/status/started_at/ended_at`，不加载实体/正文、不 join、不额外发七次日查询；
  默认既有 SQL 测试继续禁止 `ended_at`，另用 opt-in PG 用例证明读取它。选择、刷新、认证 revision、
  生命周期、query/cache 和历史分页沿用当前 controller；旧响应及已知缺失计数的显示语义不变。
- **主控机器核验**：本卡三测试树与 13 项门禁全部 `exit 0`。Vitest `1270 passed / 58 files /
0 skip`；E2E 共 `272` 例，Chromium `136`、WebKit `136`，每例恰一个 passed result，retry/skip/
  flaky/unexpected 均为 `0`；backend `1044 passed / 3 warnings / 0 skip / raw coverage
81.84461985874533%`；build `47`、Fake API `116`、API `8`、iOS 仅 Node `37`；lint 为
  `132 warnings / 0 errors / 0 new`，逐 file/message/rule 多重集与基线一致。717 个保护文件字节
  未变，18 个旧迁移未变。原时点本批合成 PG 新库创建与迁移成功，按计划保留给 WD-API/WD-UI；后续
  已按最终回执清理。
  以上均由主控实跑；实施节点没有自跑这些检查，二者不混写。
- **三卡状态**：本卡设计合同 `FINAL_READY`，正式返修 `0/2`，已停写；WD-API 先合成 PG RED，再实现
  opt-in 聚合/schema/OpenAPI/生成类型/parser；WD-UI 先 RED，再请求 flag、完成显示和真实
  Chromium/WebKit 用例。`ended_at` 缺失或早于 start 的 completed 会话另计不可计算；只有不可计算
  记录显示“暂无可用时长”，无会话与可计算会话中的合法零时长显示 0；时长为正但可计算会话数为 0
  时按关系不一致显示未知。时长父项、整个周报、三端交付和真实学习质量均不提前勾选。
  Review/commit/push 见主控同卡回执，用户 Review 待，当前不自批 APPROVED。以上是原时点快照；
  后续 WD-DESIGN 已独立 Review `APPROVED` 并随 `9d3ab32` 推送，当前状态以上方 WD-API 小节为准。

以下 CP04E 等小节是各自时点的历史快照，数字、HEAD、资源状态和结论均不并入本设计卡。

### CP04E 认证退出与活动 Room 组合补验（2026-11-15 历史快照；`FINAL_READY`）

- **基线与写集**：唯一工作树为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，
  分支 `codex/B1-learning-events-20261112`，冻结 HEAD
  `a75223aa38419c07b3786465ea3fade9c930469f`，开工 clean。仓内只允许新增
  `apps/vite-app/src/components/session/auth-exit.integration.test.tsx` 并更新
  `TODO.md`、本文件、`docs/history/todo-done.md` 与
  `docs/verification/cross-platform/CP-04.md`；产品源码、旧测试、helper、配置、依赖、迁移与
  715 保护文件均不改。
- **真实接线**：从真实 `AuthGate` 包真实 `App`，以公开合成 store 动作准备 active session，
  保留真实 `VoiceInterface`、`RoomSession`、`RoomContextSync`、`auth.ts`、真实用户 store、
  `api.ts`、`roomAudio` 与默认 Web 平台适配。认证边界使用真实离线
  `oidc-client-ts` `UserManager`/`User` 与合成 metadata/Storage；`automaticSilentRenew` 和
  `monitorSession` 关闭，`signoutRedirect` 只在 SDK 外部导航边界截获。
- **场景 1（logout）**：活动 Room 中调用真实 `beginLogout()`。断言私有 App/Voice/Room 卸载并
  出现登录边界，owned track 从 `live` 变 `ended` 且产品路径实际调用 `stop()`；conversation
  回 dashboard/idle，`sessionId/token/wsUrl/sessionPresentation` 清空且代际推进，
  settings/assessment seed 清除；退出前后业务请求数不增加，不新建/结束服务端会话，不取
  token、不 dispatch、不重建 Room、不申请媒体。
- **场景 2（当前请求 401）**：活动 Room 中经真实 `getSessionDetail()` 与真实 `api.ts` 发出
  唯一受控合成 GET，收到 401 后触发当前 revision 失效，并断言与 logout 相同的 App/Room、
  owned track、conversation、settings、assessment 清理终态。401 只新增该一次请求，不重放；
  无自动 Room 重建、新会话、end/token/dispatch 或媒体获取。
- **测试边界**：只 mock `@livekit/components-react` 的声明式 Room/Track 组件边界；mock Room
  不调用 stop，track 仅由真实 `stopRoomLocalTracks()` 停止。R2 在闭包中使用稳定非空
  `renderedApp`，以每次返回新元素的同一树工厂完成 rerender；准备期要求 Room render 调用数
  严格增加但不设固定上限，同时真实 effect 挂载数保持 `1`、卸载数保持 `0`，Room/track 对象
  身份不变且仍 live、未 stop。严格 fetch 在来源、认证与路由校验前记录每次尝试；拒绝尝试保留
  原因并失败关闭，最终断言拒绝为空且尝试总数等于允许记录数。测试 `finally` 卸载 UI 并
  `disposeEvents()` 退订；`afterEach` 的 `cleanup()` 恢复组件边界，并还原 fetch、OS、env 与
  store；所有 React 可见更新纳入 `act`。
- **R0 检查与返修依据**：主控已完成 target `2/2`、完整 Vitest `1270/58`、E2E `272/0 retry`
  与 backend `1044 passed / 3 warnings / 0 skip`，715 个保护文件仍一致。两项私有探针仍证明
  夹具缺口：同树合法 rerender 使固定 render 计数由 `1` 变 `2`，目标探针 `exit 1`；logout
  后被 fake 拒绝且被捕获的未知来源请求未进入旧 records，目标探针 `exit 0`。这些 R0 结果不能
  冲销 fixture finding；R1 局部绿色也不能冲销其 quality/typecheck `exit 2`，本文不写
  APPROVED。
- **R1 检查与 R2 依据**：R1 target `2/2` 与完整 Vitest `1270/58` 已通过；两项外部探针也
  正确翻转：未知拒绝请求命中具体失败断言，fresh tree 合法 rerender 通过。但 quality/build/
  typecheck 均因 `auth-exit.integration.test.tsx:600` 的 TS18047 `exit 2`，且原测试将同一
  React 元素引用重复传给 `rerender`，React 可合法 bail out，不能证明实际 render 增加。
- **R2 最终核验**：主控目标 `2/2`、target-final 再跑 `2/2`。两个私有核心负对照均在具体断言
  失败：停轨 disabled 时 track 仍 `live`；user-clear disabled 时 `appView` 仍为 `session`。
  严格请求探针拒绝未知尝试；fresh-tree 重渲染通过；独立观察者确认发布用例自身确实发生了
  rerender，且没有重挂载。SDK mock 不主动停轨，产品 `stopRoomLocalTracks()`、App/Room 卸载
  与用户 store 清理由本地断言真实触发；这不等价于真实 `MediaStreamTrack` 或 SDK 网络断开验收。
- **最终 13 门禁**：组合结果全部 `exit 0`。Vitest `1270 passed / 58 files / 0 skip`；E2E
  `272 passed = Chromium 136 + WebKit 136`，每例恰有一个 passed result，`retry=0`、`skip=0`、
  `flaky=0`、`unexpected=0`；backend `1044 passed / 3 warnings / 0 skip`，raw coverage
  `81.84461985874533%`；build-script `47`、Fake API `116`、API 类型 runner `8`、非 native iOS
  脚本仅 Node runner `37` 均通过；lint 为 `132 warnings / 0 errors / 0 new`，file + message +
  rule 多重集相同。Vitest 新增 2 例后总数为 1270，1268 个旧测试身份逐条保留；715 个保护文件
  字节未变，产品、旧测试、共享 helper、配置、依赖与迁移均未改。
- **证据复用边界**：R0 已通过的 E2E、backend 等结果绑定同卡源字节一致证据；R1/R2 分别补跑
  quality、完整 Vitest 与 format。最终 13 项按同源字节收口，不声称 R2 阶段又从空缓存重跑了
  全部测试树。所有新增范围仍是 logout 与当前请求 401 两例，CP04I 三场景未重做。
- **收口状态**：停在 `FINAL_READY`，正式实施返修 `2/2`，代码与测试停写。此次 next-local 新批
  合成 PG 已清理：`CP04E-stop-pg` `exit0`，在精确 ID、双 owner、loopback 与合成库身份核验后
  `stop0`、`auto_removed=true`，名称和 ID 均不存在，其他资源未动；本批清理与旧批独立。真实
  外部依赖、原生/设备、CI 与生产仍未验收。CP-04 父项保持不勾；Review/commit/push 见主控同卡
  回执，用户 Review 待，本文不自批 APPROVED。

### CP04I 真实入口换号与迟到响应组合（FINAL_READY）

- 唯一工作树为 `b1-continuation-20261115`、分支
  `codex/B1-learning-events-20261112`、基线
  `dacf7b3337b3e4640b040ad6ce048c8ee7f9a92e`。新增
  `apps/vite-app/src/App.identity-integration.test.tsx`，保留真实 `auth.ts`、根 `AuthGate`、
  `App`、四类 Dashboard 消费者、`SettingsDrawer`、相关 store 与 `api.ts`。认证边界使用真实
  `oidc-client-ts` 的离线 `UserManager`/`User`，注入合成用户、metadata 与 Storage；严格按合成
  Bearer token 分流的 `fetch`/`Response` 及 dialog、online/visibility、媒体接口为测试边界。
  未连接真实 SSO。产品、旧测试、helper、配置、依赖与迁移均未改。
- 场景 1：A 已显示活动会话、今日进度/历史、七日概览与语法错误且设置抽屉有草稿；生命周期刷新
  制造 A 在途读取后切换 B。B 完整返回后放行 A 成功 canary，断言 A 迟到 active/daily ID、
  抽屉、草稿、settings store 与 weekly 非默认选日计数均不覆盖 B。场景 2：A 在途时切 B，在 B
  仍 loading 时放行 A 全部失败与 finally，断言 B loading、无旧错误、settings store 与最终 UI
  不受污染。场景 3：同 principal 新 token/revision 更新不重挂载 App，设置草稿、焦点、
  按钮/输入 DOM 身份及 conversation store marker 保留，settings 不额外重取。
- 所有业务请求只允许合成身份上的 GET；未知路由/认证分流和非 GET 失败关闭。测试结束释放全部
  受控 promise、卸载 UI、移除 OIDC listener 并还原全局边界，终态断言零未知请求、零业务写、
  零 `getUserMedia()`。不同 principal 切换期间允许实际接线产生合法 B 重复读取，不冻结新的
  “恰一波”请求政策。
- **R0 历史（保留）**：主控实跑 target `1 passed / 2 failed`，全量 Vitest
  `1266 passed / 2 failed / 0 skip`。两例失败均为夹具无条件排除 `article_usage` 与
  `preposition`，把 B 正确显示 `preposition` 误判为旧 A 数据。quality/build/typecheck
  `exit 2` 均由 3 个 OIDC 事件 call-through spy 未返回原方法退订函数导致；unit `exit 1`、
  format `exit 1`，后者唯一命中新增测试。上述是夹具/类型/格式问题，不是产品 RED。
- **R1 修正**：负向夹具只排除当前 actor 对应的语法行，保留 B 正向断言；OIDC 事件 spy 原样
  透传并保留退订清理；补充 A late active/daily ID、B设置重新打开触发重取前真实 settings store 仍为 `b-model`
  以及 weekly 非默认选日 B 计数保留。默认选日与 history 契约不变。唯一新测试文件最后以
  Node `22.13.1` 下现有 Prettier 精确格式化。
- **最终机器验收**：目标 `green 3/3`，默认配置 target-final 再次 `3/3 exit 0`；最终 13 门禁
  全部 `exit 0`。Vitest `1268 passed / 57 files / 0 skip`；旧 1265 个测试身份逐条保留，714 个
  保护文件字节不变。双浏览器 E2E `272 = Chromium 136 + WebKit 136`，每例恰有一个 passed
  result，retry/skip/flaky/unexpected 均为 `0`。backend
  `1044 passed / 3 warnings / 0 skip`，raw coverage `81.84461985874533%`；build `47`、Fake
  API `116`、API 类型 `8`、iOS 仅 Node `37`；lint
  `132 warnings / 0 errors / 0 new`，file + message + rule 多重集一致。
- **私有负对照**：取消换号 key 后命中旧抽屉残留；取消旧 settings finally fence 后命中 B
  loading 被清为 false。两项均命中具体断言且各只有 `1 failed`，同轮各另有 `2` 个未选用例，
  未选不计为覆盖；默认源恢复后 target-final 全绿。
- **PG 收口**：`CP04I-stop-pg` 为 `exit 0`；完成精确 container ID、双 owner、loopback 与库
  身份核验后 stop `0`、`auto_removed=true`，名称与 ID 均不存在，其他资源未动。该资源属于本次
  local-followups 新批，不能引用或改写旧批清理事实。
- 正式实施返修 `1/2`。CP-04 父项仍不勾；真实 SSO/IdP、Keychain、三端设备、媒体、Provider、
  LiveKit、外部依赖与生产仍未验收。Review/commit/push 以主控最终同卡回执为准，用户 Review
  待，本节不写 APPROVED。

### CP05L Dashboard 生命周期实际组合缺口（FINAL_READY）

- 唯一工作树为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，
  分支 `codex/B1-learning-events-20261112`，冻结 HEAD
  `9a7ec847e36b3187f03076eb280f6b0bc78c7a4e`。新增
  `apps/vite-app/src/components/dashboard/Dashboard.lifecycle-integration.test.tsx` 与
  [验证说明](./verification/cross-platform/CP-05-LIFECYCLE-COMBINATION.md)，并更新三份状态
  文档；未改产品源码、既有测试、依赖、CI 或迁移。正式实施返修 `1/2`，R1 只补测试夹具的
  异常路径清理。新增测试停写后的 SHA-256 为
  `4f46f3ecba0529df2fa99390989bf0fcd3504de59a6971890237f819bfa51a35`。
- 测试直接渲染真实 Dashboard，保留 ActiveSessions、DailyProgress、WeeklyProgress 与
  WeeklyGrammar 的真实组件、query/controller/hook、默认 `createLifecycleAdapter()` 和实际
  `api.ts`；认证状态、Capacitor App 外部状态及严格 fake `fetch`/`Response` 只作测试隔离。
- 场景 1 验证 iOS pending 期间受管端点 0 GET，active 后首波 5 条受管 GET；WeeklyProgress
  概览 settle 后默认选日另发 1 条 history，不能把首波 5 条写成最终所有 GET。场景 2 验证
  Web `online`→`pageshow` 两次合格事件下 AS/WP/WG 的 ignore 合并、DP 的 override 多发和旧响应
  隔离，周概览 settle 后默认 history +1，手动选日再 +1。场景 3 验证整页 unmount 后迟到 App/
  Web 事件不增加请求、不产生非 GET 写且不采音。
- iOS 场景在 `beforeEach` 中以 `vi.stubEnv` 设置安全合成绝对 `VITE_API_BASE_URL`，并在
  `afterEach` 以 `vi.unstubAllEnvs()` 恢复；真实 `getApiBaseUrl()` 与 API 封装保留。Web 场景
  仍只证明生命周期组合接线，不冒充 Web 默认相对 `/api` 或 native 无配置 fail-fast 的独立证据；
  `api.ts` 缓存首个有效基址也使 Web 场景不能转作默认 `/api` 验证；这些 URL 策略由既有
  `platform/url.ts`、`platform/globalEnvironment.test.ts` 与 `lib/api.test.ts` 继续承担。
- **最终机器验收**：R0 target 与恢复默认源后的 target-final 均为 `3/3 exit 0`；R1 后最终
  13 门禁全部 `exit 0`。Vitest `1265 passed / 56 files / 0 skip`；E2E
  `272 = Chromium 136 + WebKit 136`，每个执行恰有一个 passed result，
  retry/skip/flaky/unexpected 均为 `0`；backend
  `1044 passed / 3 warnings / 0 skip`，raw coverage `81.84461985874533%`；build `47`、
  Fake API `116`、API 类型 `8`、iOS 仅 Node `37`；quality `0`；lint
  `132 warnings / 0 errors / 0 new`，且诊断的 file + message + rule 多重集一致。
- 1262 个旧测试身份逐条保持，新增 3 例后恰为 `1265 / 56`；713 个保护文件字节不变。R1 在
  第一例 `finally` 的 unmount 后补 `getStateDeferred.resolve({ isActive: false })`，保证前置
  监听/0 GET 断言失败时也释放受控状态 promise；其余断言、事件、计数与超时未改动。
- **负对照与恢复**：两个有效私有加载期负对照均命中目标断言且不是通用超时。WG 强制 Web
  接线后，命中 native 监听断言，expected `4` actual `3`；DP 将 `override` 改为 `ignore`
  后，命中第二轮请求断言，expected `2` actual `1`。两项各自仅选中 `fail 1`，各另有 `2`
  未选，未选不计通过；恢复默认源后的最终门禁全绿。
- 三个 UI 组合场景本身不连接 PG；backend `1044 passed` 在本批真实合成 PG 上完成，不能写成
  “PG 未验证”。真实 OS、真机 iOS pending/网络恢复、SSO、Cloud、LiveKit、媒体与生产仍未
  验收。最终 format、独立 Review、正常 commit 与当前分支 push 以主控同卡回执为准，用户
  Review 待，本状态不写 APPROVED。

### CP02I 通话占用本地组合补验（FINAL_READY）

- 唯一实施工作树 `b1-continuation-20261115`、分支 `codex/B1-learning-events-20261112`、基线
  `c69583808843c571081353378314f5bac5685e42`。新增 stdio 桥 + 6 场景 spec + 专用 vitest
  config，`package.json` 仅加 `test:call-lease-local`，默认 Vitest exclude
  `integration/**`；不新增依赖/CI/迁移，不改协议与默认行为。
- 组合链路为真实 controller + 实际 `api.ts` 封装 + stdio fetch 薄桥 + 真实 ASGI 路由 +
  真实合成 PG；Cloud 撤销仅经 `LiveKitAPI.room` 显式模拟。桥在导入 backend 前完成 strict
  URL/合成标志校验与进程级出站硬拦截（仅放行 `127.0.0.1:55433` PG），HTTP 身份取请求
  Bearer 合成 UUID 且限 owned 用户，仅接受本地相对 `/api/` 路径，内部失败发
  `bridge_error` 不伪造服务端响应。
- 晚到响应用确定性 hold/release 门：请求先真实 commit 再 hold，测试经 PG 确认后
  invalidate / authRevision 变化，分两个 case，无 sleep。独立 Review 7 项全部关闭后进入
  R1/R2 返修与最终格式收口，最终主控验收全过，状态 `FINAL_READY`。
- **最终机器验收数字**：13 门禁 exit0；Vitest `1262 passed / 55 files`、E2E
  `272 = Chromium 136 + WebKit 136`（single passed、retry/skip/flaky 0）、backend
  `1044 passed / 3 warnings / 0 skip`、raw coverage `81.85846835618335%`、lint
  `132 warnings / 0 errors / 0 new`（逐诊断相同）；build `47`、Fake API `116`、API 类型
  `8`、iOS 仅 Node `37`。本卡额外验证：extra types `0`、显式 backend 配置 Ruff 最终
  `0`、真实 PG 组合最终 `6/6`（retry 0 / skip 0）；707 保护文件未变。
- **负对照与恢复**：2 个私有加载期变异各精确 `fail 1`、未选 `5`，恢复后 PG 组合 6/6
  全绿（不写 mutant 零 skip）；安全源提取探针覆盖 3 合法 + 13 非法 URL、4 外来 ASGI
  路径、6 出站拒绝，零真实网络 PG；清理故障 3 模式经源提取注入从 R1 红修到 final 绿
  （源提取验证，非真实 PG 故障注入）；PG fixture 用户残留独立计数 0。
- **返修历史（保留）**：R0 静态失败；R1 integration 类型检查暴露 3 个真实新增 TS 错误
  （resolve 窄化、`err.code` 窄化）；R2 关闭 bridge finally 吞清理异常（清理失败现发静态
  fatal 非 0）；最终 I001 真实失败经机械格式收口闭合（仅 import 排序，bridge 最终 hash
  `03d3b6e9cba116db8cad5015791b39f05e92391d0209ed0a03a14aeb797d943e`）。正式实施返修
  `2/2`（产品源码未改，未重置）。私有前置路径/ambient 配置错误不计产品失败。
- **边界**：stdio 桥为 fetch 传输替换，ASGI 无真实 HTTP socket；Cloud 仅 `LiveKitAPI.room`
  显式模拟；真实 OS/SSO/Cloud/设备未验。该卡专用 config 的 `VITE_API_URL` 未被当前 URL
  模块读取，六例实际走 Web 默认 `/api`，不能当作 native 显式绝对 URL 证据；前卡代码无需
  修改。`cp05k-cp02i-cp05l-20261115` 三卡共用合成 PG 已在本批 CP05L 最终收口时按精确 ID
  清理完成。最终全仓 format、独立 Review、正常 Husky 与当前分支发布以主控同卡回执为准，
  用户 Review 待，本状态不自行写 APPROVED。

### CP05K 会话界面动态桌面与键盘覆盖（FINAL_READY）

- 唯一实施工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD
  `816e6adf740a476fb450580efb2681e2b6791775`。本卡只新增一份 5 场景 E2E、一份验证说明并
  更新根 `TODO.md`；真实产品组件、既有布局测试、夹具、配置、后端、依赖与迁移未改。新 E2E
  SHA-256 保持 `f46318553488ee3f0f2ed5f935398db6c0383b68b409ad9cad7fbc578e8a2d51`。
- 覆盖差集：既有固定 390/1280 静态用例没有证明同一页面跨断点、200% 根字号、会话控件键盘
  激活、缩放保持当前可见控件焦点和推荐展开状态，也没有在动态操作期间重新核验零 API 写。
- 新增 5 个场景：1280→1023/1024→390/1280 往返；根字号 `200%` 后宽/窄缩放；键盘到达并激活
  推荐开关和第一条推荐；缩放保持仍可见推荐按钮焦点及展开状态；动态交互零 `/api/` 写请求。
- 本卡性质是覆盖补证，不是产品缺陷修复；没有制造 RED，未发现需要产品变更的新回归，正式产品
  返修 `0/2`。全部 12 项行为门禁均 `exit 0`：Vitest `1262 passed / 55 files`；E2E
  `272 = Chromium 136 + WebKit 136`，全部 single passed，`retry / skip / flaky` 均为 `0`；
  backend `1044 passed / 3 warnings / 0 skip`，raw coverage `81.85846835618335%`；build `47`、
  Fake API `116`、API 类型 `8`、iOS 仅 Node `37` 通过；quality `0`。
- 新增 5 场景的 200 次重复补验为 `5 × Chromium/WebKit × 各 20 = 200 passed`。机器确认 10 组、
  每组 20 次，每个执行均只有一个 passed result；retry、skip、flaky、unexpected 均为 `0`，
  命令 `exit 0`。
- 两项私有产品响应负对照均有效命中：移除 layout class 后几何
  `toBeLessThanOrEqual` 目标断言失败 `1`；禁用 toggle 后 `aria-expanded` 目标断言失败 `1`。
  两项各 `exit 1`；变异未改动物理源码。正向 200 次重复是在恢复原响应后再次执行并全部通过。
  初次私有配置的 `cwd` 前置错误已保留为非产品执行错误，不纳入产品结果或负对照计数。
- 数据库资源必须按批次区分：旧 CP05D 所属批次的合成 PG 已完成
  `stop_exit0`/`auto_removed=true`；该卡当时保留的
  `cp05k-cp02i-cp05l-20261115` 三卡共用合成 PG 也已在本批 CP05L 最终收口时按精确 ID 停止
  并核验移除。两个批次均已完成各自的精确清理回执。
- CP05D 与 R2-11 小节均为此前卡片的明确历史交付，不并入本卡数字或结论。原生 desktop 关闭
  会话、真实 Media/设备、Provider、IdP、真实数据与生产仍未验收，也不由 LiveKit 模块桩覆盖。
- 本卡已停在 `FINAL_READY`；最终 format、独立 Review、commit 与 push 以主控同卡回执为准，
  用户 Review 待，本状态不自行写 APPROVED。覆盖边界与验收口径见
  [CP-05 会话界面动态桌面与键盘验证](./verification/cross-platform/CP-05-SESSION-DESKTOP-DYNAMICS.md)。

### CP05D 设置抽屉动态可见性

- 本节是 2026-11-15 CP05D 的历史交付 `FINAL_READY` 快照，与 CP05K 分开计数。唯一实施 W 为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，正式基线 HEAD
  `1df095fb89af7488b7618c73397345b6a11584f9`。只改 `SettingsDrawer.tsx`、
  `useSettingsDialog.ts` 与两份新增测试；其余产品、后端、配置和依赖未改。正式产品返修 `0/2`。
- 范围只覆盖设置抽屉的真实活动输入可见性：普通窗口 resize、根字号 200% 后再 resize、聚焦后仅改
  根字号。静态布局 6 例通过；该静态矩阵未复现固有尺寸裁切，本卡不修改布局或控件尺寸。未先建立
  input focus/value/完整可见前置的早期诊断不作为回归证据。
- 正式有效 RED：Vitest `7 failed / 0 passed / 0 skipped / exit 1`，失败均来自实际 Drawer 挂载后
  缺少 viewport reveal 资源。Playwright `4 failed / 2 passed / 6 total / retry 0 / exit 1`，四例
  均在严格初始 `focus/value/visibleRatio=1` 前置成立后发生于 factor 阶段，焦点保持；Chromium
  ordinary、200%、font-only 为 `visibleRatio=0`，WebKit ordinary 为部分可见 `0.0966`。WebKit
  200% 与 font-only 原通过，显式 Save 恰 `1 PUT` 已走通。
- 修复在既有中间 `overflow-y-auto` 滚动区上建立资源监听：`window.resize`、可用
  `visualViewport.resize` 与特征守卫的 `ResizeObserver` 统一合并到一个 rAF。帧执行时重新读取
  `document.activeElement`，仅对 connected 且属于该滚动区的当前活动元素执行
  `scrollIntoView({ block: "nearest", inline: "nearest" })`；不捕获旧 active 节点、不主动 focus、
  不改草稿/store、不新增请求，也不改变既有 focus trap/Tab 与初始 Close 聚焦语义。Close、卸载与
  StrictMode cleanup 取消 rAF、移除监听并断开 Observer；缺失 `visualViewport`/`ResizeObserver`
  时安全退化，迟到回调不作用于新周期。
- 主控实跑：quality `0`；Vitest `1262 passed / 55 files / 0 skip`；backend
  `1044 passed / 3 warnings / 0 skip`，raw coverage `81.94155934081152%`；本卡后端 5 门禁均为
  `0`；build `47`、Fake API `116`、API 类型 runner `8` 通过；iOS 侧仅 Node `37` 通过，不表示
  native iOS 或真机通过。
- 三项有效私有 load 变异分别模拟不滚动、帧内捕获旧焦点与 Observer 泄漏；每项命令均 `exit 1`、
  目标断言 `fail 1`、driver `0`。每命令 6 个未选用例不构成覆盖；恢复后冻结目标测试为 `7 passed /
0 failed`，全量 Vitest 零 skip 用于佐证没有全局放宽。
- 全量 E2E 为 `262 = Chromium 131 + WebKit 131`，全部 passed；每项恰有一个 passed result，
  skip / flaky / unexpected / retry 均为 `0`，命令 `exit 0`，主控已独立归档。新增三场景在
  Chromium/WebKit 各重复 20 次，机器核验为 `6` 组、每组 `20` 次，共 `120` 次；每项均为单
  passed result，skip/flaky/unexpected/retry 均为 `0`，`workers=1`，命令 `exit 0`。
- 两份测试完整行为 AST 与有效 RED 一致。最终收尾以 Node22 Prettier 纯格式化新 E2E 与四份仓内
  文档并保留结果，不再追 raw SHA，也不计产品返修；两份产品与 unit 测试文件未改动，断言未改。
- **旧 CP05D 所属批次**的所有数据库验证已完成，该旧批自有合成 PG 已回执 `stop_exit0`、
  `auto_removed=true`，精确 container ID、双 owner、loopback 与合成身份均核验，其他资源未动。
  `cp05k-cp02i-cp05l-20261115` 新批三卡共用 PG 后续也已在同批 CP05L 最终收口时按精确 ID
  完成 `stop_exit0`/`auto_removed=true`；两个批次均已有各自清理回执。四份仓内文档与
  `implementation/report.md` 已完成 CP05D 的 `FINAL_READY` 收口；
  独立 Review、正常 commit/当前分支 push 以主控同卡最终回执为准，用户 Review 待，本状态不自行
  写 APPROVED。真实 OS 键盘、非零 safe-area、设备、Media/Provider、IdP、真实数据和生产未验；
  CP-05 手机动态视口/键盘/safe-area 父项保持 `[ ]`。
- 范围、RCA、实现与验收口径见
  [CP-05 设置抽屉动态可见性](./verification/cross-platform/CP-05-SETTINGS-FOCUS-VIEWPORT.md)。

### R2-11 会话中界面本地子卡（FINAL_READY）

- 历史时点：本小节是 2026-11-15 R2-11 本地模块桩子卡当时的 `FINAL_READY` 快照；正式返修 `1/2`。主控机器最终
  验收的 13 项门禁全部 `exit 0`；独立技术 Review、正常 commit/当前分支 push 以主控同卡最终回执
  为准，用户 Review 待。父项 R2-11 保持未勾：真实 LiveKit 人工媒体验收未做，不得勾选整项。
- 唯一实施 W 为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，基线 HEAD `7d38f91dbc6fd5c00e5f3a89061cc8e9b6a503c5`。
  本卡只改写集内 9 个代码/测试文件与仓内四文档：store 新增内存只读 `sessionPresentation`
  （归属 `(sessionId, sessionGen)`，所有代际/失败/reset 清空）、`ActiveConversation` 页头场景/
  墙钟、thinking 独立文案、单实例回答推荐展开与 LiveKit 默认主题映射，另有 2 份单测与 3 个
  E2E 模块桩文件。未改连接判别联合、认证、API、后端或依赖。
- 有效 RED：主控实跑本卡单测 `22 failed / 4 passed / 26 total / 0 pending / exit 1`，22 项均来自
  缺失展示功能或目标顺序；browser RED 1 例失败（旧 Listening 挂载后页头缺失）。
- R0 主控实跑全量 Vitest `1254 passed / 1 failed`：唯一功能失败为新 logout 用例裸 slice 上期待
  auth 监听自动清元信息（真实清理链为 AuthGate → clearUserSessionData → goHome →
  resetWithShellCoordination）；quality `2` 为新测试两处非法 `AuthState` 字面量；format `1` 为三份
  新 TDD 文件；E2E `252 passed / 4 failed` 为四个新布局用例在 body 250ms 主题过渡未结束时过早
  取背景色。以上原始失败记录全部保留，不并入产品回归。
- R1 精确 GO 后修正：logout 用例接真实 `AuthGate` + 物理 store + 真实 `clearUserSessionData`；
  两处字面量改合法 `"anonymous"`；E2E 背景比较改 `expect.poll` 等待过渡结束的真实最终色（精确
  相等保留）；并移除 start 完成处本卡误加的外壳补丁，仅附加 `sessionPresentation`。
- R1 修正后主控机器验收：quality `0`；Vitest `1255 passed / 54 files / 0 skip`；format `0`；
  25 个完整 callback 按 AST 与 RED 相同（仅合法 `anonymous` 统一）；四新增布局 E2E 在
  Chromium/WebKit 的 390/1280 全 `4` 通过，覆盖精确主题背景、单实例推荐、字幕顺序、左右栏几何、
  无横向溢出与零 API 写。
- 最终全量 E2E 为 `256 = Chromium 128 + WebKit 128`，每个 test 恰有一个 passed result，
  `retry / skip / flaky / unexpected` 均为 `0`。最终 13 项门禁全部 `exit 0`。
- lint 最终机器核对为 `132 warning / 0 error / 0 new`，逐诊断（file+message+rule）与 132 基线完全
  一致。backend 此前 5 门禁全 0：`1044 passed / 3 warnings / 0 skip`，raw coverage
  `81.84461985874533%`；build `47`、Fake API `116`、API 类型 runner `8`、iOS 侧仅 Node `37` 均通过。
- 三项私有 load 变异均有效 killed：归属越界、resume 串旧场景、timer 不清理，各命令 `exit 1`、
  精确目标断言 `fail 1`、driver `0`，默认 26 项复核 `0` 失败；每命令 `12` 个未选用例不构成覆盖
  证明。全量 Vitest 默认 `1255` 零 skip 佐证无全局放宽。
- 实施端除主控 GO 下的 Node22 prettier 精确格式化（R1 时代码 9 路径、文档收口 4 文档）外，未
  运行 Vitest、E2E、lint、build 或服务；数字均来自主控机器回执。截图存于主控证据目录；截图
  CLI 前置不支持不是产品失败。

### R2-10 硬编码文案收口（FINAL_READY）

- 历史时点：本小节是 2026-11-15 的本地实现当时 `FINAL_READY` 快照，正式返修 `2/2`。主控机器最终验收的
  13 项门禁全部 `exit 0`；独立技术 Review、正常 commit/当前分支 push 以主控同卡回执为准，
  用户 Review 待。
- 唯一实施 W 为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，基线 HEAD
  `6240e2e31921efd1fa8e8731861c82cd183b7a9a`。本轮只在任务卡允许的推荐卡、语法提示、i18n、
  平台 URL 与三份冻结回归测试范围内修改，并新增共享标签解析器；未改后端技能集合、URL 校验行为、
  API、切面结构或依赖。
- 主控修正夹具后实跑冻结测试为
  `3 failed / 18 passed / 21 total / 0 skip / exit 1`，且当时产品零改动。3 项有效 RED 分别为推荐
  卡已知技能中文标签、语法提示扩展技能中文标签、`platform/url.ts` 纳入中文无豁免扫描。首轮第 4
  个 `toString` 失败已单独认定为测试预期错误并纠正为 `ToString`：`formatTitle` 只按下划线拆词；
  该夹具错误不混作产品回归，既有回退断言保持冻结。
- R0 独立完整 quality 为 `exit 2`，唯一错误是新增推荐测试的合成夹具
  `weakest_skill: null` 与当前 API 的 string 类型不符；该 RED 原始证据保留，不属产品运行回归。
- R1 精确 GO 后只把该值改为合法 `future_skill`，并在 Node `22.13.1` 下用现有 pnpm Prettier 格式
  化该测试文件。R1 复验 quality 仍为 `exit 2`：TypeScript 在同一新增响应对象继续指出
  `CurriculumNextResponse` 的必填 `target_level` 与 `weakest_skill_mastery` 缺失；该第二次失败
  记录同样保留，不覆盖 R0。
- R2 独立审查为 `CHANGES_REQUESTED`（正式返修 `2/2`）。按 `api.generated.ts` 的实际必填字段一次核齐该新增外层对象，只补
  `target_level: "B2"`、`weakest_skill_mastery: 0.25`；内层推荐原有五个必填字段保持。随后对同一
  测试重跑 Node `22.13.1` 现有 pnpm Prettier，输出 `unchanged / exit 0`。全部断言、API 类型与
  5 个产品源文件字节未变。
- R2 修正后的最终机器验收为 13 项门禁全部 `exit 0`：Vitest
  `1229 passed / 52 files / 0 skip`；完整 E2E
  `252 = Chromium 126 + WebKit 126`，每个 test 恰有一个 passed result，
  `retry / skip / flaky / unexpected` 均为 `0`。
- backend 为 `1044 passed / 3 warnings / 0 skip`，raw coverage
  `81.85846835618335%`；build-script `47`、Fake API `116`、API 类型 runner `8`、iOS 侧仅
  Node `37` 均通过。lint 为 `132 warning / 0 error / 0 new`，file/message/rule 多重集与父基线
  一致。
- 三项目标私有加载变异均被对应断言杀死。AST 独立核对覆盖 74 个源文件，CJK 字面量为 `0`；
  `platform/url.ts` 的 21 个抛点、20 条文案顺序与归一化 AST 不变，原有 `zhCN` 值不变；
  690 个保护文件字节不变。R2 修正后的 quality、Vitest、format 及全部 13 门禁均全绿。
- 初始完整 format 为 `exit 1`，R0/R1 的两次 quality `exit 2`、首轮 `ToString` 夹具误预期及
  首轮真实 RED 的原始记录均保留；这些历史失败不覆盖、也不被 R2 后全绿抹掉。
- 推荐卡保留场景名的 `formatTitle` 口径，只在技能标签命中 10 个后端真实技能时显示中文；语法提示
  复用同一技能目录并保留既有 6 类语法文案。两者的未知标签分别继续原 `formatTitle` 与原
  `skill_tag` 回退；`constructor`、`toString`、`__proto__` 等原型属性名不会误取继承值或导致渲染
  崩溃。
- `platform/url.ts` 的 20 条 `[EchoTalk]` 配置错误原文迁入 `zh-CN.ts`，21 个
  `PlatformConfigError` 构造原位保留并改为读取语言包；异常类型、校验顺序、返回行为、协议/凭据/
  Query/路径/Hash 等 URL 安全判断未改，硬编码扫描不再豁免该文件。
- 实施端除 R1/R2 精确 GO 下对同一推荐测试执行现有 formatter 外，未运行 Vitest、13 门禁、
  lint、typecheck、build、E2E 或服务；最终数字来自主控机器回执，不继承 SGEC-OFF、R2-UI、
  R2-LIVE 或其他历史轮次结果。最终文档收口只格式化 TODO、本状态页和历史归档。

### SGEC-OFF 严格离线校验与合成评测（FINAL_READY）

- 本小节是 2026-11-15 的 SGEC-OFF 本地实现 FINAL_READY 快照；SGEC 总项、真实 Provider、人工
  gold、BKT/learning events 接线与生产行为仍未勾，不称准确率或教学质量。
- 唯一 W 为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，本卡基线 HEAD
  `67f60b09bbab4dde61179a7c957612cf72a646e5`，开工 clean。本卡仅新增纯模块
  `services/sgec_offline.py`、CLI runner `scripts/evaluate_sgec_offline.py`、固定合成
  `tests/fixtures/sgec_offline_cases.json`、结构化单测 `tests/test_sgec_offline.py`，并回写四份
  文档；不改默认分析、API、ORM/迁移、BKT、learning events 或 Provider，依赖不变。
- 纯模块只做现有五核心字段的全批次严格结构校验、调用方合法 `skill_tag` 集合、受控合成元数据与
  每次白名单序列化；`run_offline` 的文件读取已归位到 scripts runner，纯模块导入/调用/序列化零
  ENV/clock/ORM/config/DB/network/file 写入副作用。任一坏值整批零接受，`{"errors": []}` 合法，
  裸字符串不拆成字符集，`other` 仅显式列入才合法，未知字段不回显原 key 或正文。调用方集合须为
  可重复读取 `Collection[str]`，裸 `str`/`bytes`/`bytearray`/一次性 iterator/generator 迭代前拒绝。
- 最终主控 13 项门禁全部 `exit 0`：Vitest `1225 passed / 52 files / 0 skip`；完整 E2E
  `252 = Chromium 126 + WebKit 126`，每项恰有一个 passed result，`retry / skip / flaky / unexpected`
  均为 `0`。backend `1044 passed / 3 warnings / 0 skip`，原 941 测试身份完整保留且只新增 SGEC 103，
  raw coverage `81.85846835618335%`；build-script `47`、Fake API `116`、API 类型 runner `8`、iOS 仅
  Node `37` 均通过。lint `132 warning / 0 error / 0 new`，file/message/rule 多重集与父基线一致。
- SGEC 103 目标 GREEN；五有效私有变异均被精确断言杀死、零 import/fixture 错误：unknown→other
  `1 selected / 1 fail`、coerce string `6/1`、accept bool `6/2`、metadata 透传 `9/4`、partial
  acceptance `1/1`，每命令 `exit 1` 预期、driver `0`；control `17/17 passed`，变异后原始 target 103
  再全 passed。未选项不计 skip 或覆盖。
- 纯模块冷 import/validate/to_dict 零 ENV/clock/ORM/config/DB/network/写与调用期读，stdout/stderr
  为 0；解释器导入仅同模块源/缓存试读 2。初次 private probe 错判同模块 pyc 读取 `exit 1` 已保留并
  修正，非产品失败；ENV 自检私有副本被 `BoundaryViolation/env_read` 正确拒绝 `exit 1` 预期。
- 固定标准 JSON 31 批次：结构接受 6、拒绝 25、matched 31 / mismatched 0；四 core 错类型、四 metadata
  伪造、原始顶层 shapes、空值边界、自定义 tag/other 正负、外层解释建议均已核。unknown raw + caller
  含 other 由直接 unit 与有效变异覆盖，不谎称固定 JSON 含该专例。CLI 默认 exit 0 输出 31/6/25/31/0；
  坏 expect、坏 tags、非标准 JSON 各 exit 2 固定诊断无 trace/原文；合法材料不匹配 exit 1。合成 PG 已
  stop 0 且精确 ID/双 owner/loopback/身份/auto-remove 全部确认；实际 PG 移除且子进程无 DB/Provider
  变量后 CLI 仍默认 exit 0。
- 原 TDD 16 函数/2 helper/39 assert/55 参数 case 保持；R1 既有 38 个顶层函数（含 2 helper）完整 AST
  保持，覆盖原 94 个参数化用例；692 保护不变。
  初始真正 TDD RED 3、首轮 68 pass 不足、R1 `23 fail / 71 pass`、R2 `3 fail / 100 pass` 历史保留；该
  逻辑问题属新离线工具合同缺口，不是原默认业务回归。
- 本地实现、门禁与边界已收口；独立技术 Review、最终文档 format、正常 Husky commit/当前分支 API 发布
  以主控同卡回执为准，用户 Review 待，本状态不自行写成 APPROVED。正式返修 `2/2`。精确合同见
  [SGEC_OFFLINE_CONTRACT.md](./SGEC_OFFLINE_CONTRACT.md)。

### R2-UI 设置标题与活动记录去 UUID（FINAL_READY）

- 唯一 W 为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，本卡开工基线 HEAD
  `7b5b770118807dc4b79bc9d32a80e14a0af27d9e`；开工 clean。
  baseline 初始允许 23 文件、保护 673 文件；R2 因既有 `session-start.spec.ts` 同样依赖 ID 正文，
  经确认调整为 allowed=`24`、protected=`672`；初始 23 个允许路径、扩展后的 24 个路径以及初始 673 pins/计数均保留。
  `baseline.json` 的 `scope_adjustment_R2` 记录新增路径与理由。
- 主控有效 TDD 历史保持：v1 两测试文件 `19 = 2 failed / 17 passed / 0 skip / exit 1`，失败分别来自
  活动行完整 UUID 与 dialog 仍名“自定义模型设置”；v1 长用例存在目标归属缺口。加强后的 v2 为
  `23 = 4 failed / 19 passed / 0 skip / exit 1`，四个失败独立来自活动行、结束面板、恢复面板和
  literal 设置名称；两个“两条同模式同时间记录都仍存在时操作第二条”的原实现 target 控制均 passed，
  证明错误首项会被独立捕获。这两个定向 Vitest 文件随后为主控 `GREEN 23 / 0 skip / exit 0`。
- GO 后四个生产文件只做显示/props 最小改动：`ActiveSessions.tsx` 复用现有
  `resolveModeLabel` / `formatStartedAt`，`SessionRow.tsx` 与 `ConfirmPanel.tsx` 改为显示模式和时间，
  `zh-CN.ts` 将共享设置名称改为“设置”。完整 ID 保留在 React key、原 API 闭包/参数、稳定
  `data-testid` 和精确目标归属；hooks/auth/store/data、请求、复制、格式、超时、重试和业务时序未改。
- 新 Vitest 将行、结束面板、恢复面板拆为独立可执行场景，检查正文、scope 根及子孙 `title`、最终
  computed accessible-name 和按钮 accessible-name；target 控制在两条同标签记录仍同时存在时，结束精确
  请求 `SECOND_ID`，恢复精确请求 `SECOND_ID` 且保留原 principal/revision。fixture 的 `afterEach`
  显式 `cleanup`、`goHome`，并恢复 `document.visibilityState`、`navigator.onLine` 原 descriptor。
- 旧 `ActiveSessions.test.tsx` 的 31 处同类 ID 正文定位全部迁移：22 个正向使用
  `expectDisplayedSessionRow(id, mode, startedAt)` 按各 case 原 fixture 精确校验目标行、模式、时间与
  无 UUID；9 个负向改为 `active-session-item-${ID}` 整行不在 DOM，防止 UUID 隐藏后空过。该旧文件的
  116 个测试条目保留（其中两条显示描述名按合同更新）；原 await/timer/动作顺序和 153 条 API/次数/principal/revision/busy/取消/迟到隔离
  expect 保持不变。`SettingsDrawer.test.tsx` 只追加 literal “设置” dialog/heading case，16 个旧
  callback 与 21 条 API/忙态 expect 保持；两个旧 unit 合计 174 条 API/忙态 expect。旧 105+16 个
  callback 除 expect 外的动作、await、timer AST 完全相同。
- 旧 E2E 中 11 份只同步已确认标题/显示口径，所有“设置”按钮查询使用 `exact: true`，未改 timeout、
  retry、skip、`only` 或 `fixme`。`session-start.spec.ts` 的首轮真实错误 trace 指向正向 `:98`；信令失败回主页后的正向目标检查，以及 token 失败后的负向目标检查，两处同类依赖均已迁移：正向改为精确目标行/模式/时间/无 UUID，负向改为目标行 `toHaveCount(0)`；WS/API、原 30 秒 timeout、completed detail、请求次数与顺序和 cleanup
  均不变。新 `settings-session-labels.spec.ts` 使用本地 Fake API，不连接 Room、麦克风、Provider 或
  生产，并对三张截图加局部 `animations: "disabled"` 以记录终态。
- 历史失败链保持区分：本卡首轮 full Vitest 为
  `1209 passed / 16 failed / 1225 total / 0 skip / exit 1`，16 个失败全部来自旧显示目标定位迁移不全；
  私有 overlay 迁移后旧 `ActiveSessions.test.tsx` 为 `116 passed / 0 failed / 0 skip / exit 0`，确认不是
  16 个产品 bug。首轮 full E2E 为 `250 passed / 2 failed / 252 / exit 1`：Chromium 与 WebKit 各在
  同一个正向 `session-start.spec.ts:98` 定位失败一次，合计两个失败；token 失败后的负向目标检查当时 passed，但因 UUID 已隐藏而会空过。两处均完成迁移，负向通过不等于旧断言仍有效；这两个失败都不是信令或行为回归。
  首轮全仓 `format:check` 为 `exit 1`，仅定位到 3 个文件；R1 对这 3 个文件精准格式化后，全仓
  `format:check` 为 `exit 0`。`expect(null).not.toContain` 仅是本地 matcher 诊断，从未冒充完整 E2E
  失败。
- 最终主控 13 项门禁全部 `exit 0`：Vitest `1225 passed / 52 files / 0 skip`；完整 E2E
  `252 = Chromium 126 + WebKit 126`，每个 test 恰有一个 passed result，
  `retry / skip / flaky / unexpected` 均为 `0`。backend 为 `941 passed / 3 warnings / 0 skip`，raw
  coverage 为 `81.55505107832009%`；build-script `47`、Fake API `116`、API 类型 runner `8`、iOS 仅
  Node `37` 均通过。lint 为 `132 warning / 0 error / 0 new`，file/message/rule 多重集与父基线一致。
- TDD v2 原 32 个 `expect` AST 全部保留并增加 scope root-title 1 项；4 项目标变异仅通过私有
  overlay 执行，跟踪源码始终保持未改。最终相关 5 文件已有 hash 绑定；672 个保护文件不变。四生产
  diff 已核仅有显示/props，无 API 闭包漂移。
- 主控已亲看实际 6 图：设置抽屉完整终态正常，end/resume 模式与时间布局正常且无 UUID。初轮 6 图保留，
  其中设置图处于滑入中，不把初轮部分画面称为完整布局通过。
- 本地实现、门禁与截图已收口；独立技术 Review、最终文档 format、commit/push 以主控同卡回执为准，
  用户 Review 待，本状态不自行写成 APPROVED。正式返修计数为 `2/2`，没有第三轮正式返修额度；本轮仅
  做文档最终收口。生产、真实 Provider/IdP/LiveKit、设备、部署和真实数据未验收。本批独占合成 PG
  当时尚未清理，现已于 SGEC-OFF 完成后清理。

### R2-LIVE 活动会话生命周期实时门禁（FINAL_READY）

- 唯一 W 为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，本卡基线 HEAD
  `f3fced9b10955a1285498b1315254917b3ff7048`。本轮仅触及生命周期 hook、`ActiveSessions` 调用点、
  新增黑盒测试及四份状态/合同文档；data/auth/store/platform 与旧测试未改。
- 主控已取得 TDD 证据：默认入口新 3 用例为 `2 failed / 1 passed / exit 1`，两个正向均缺服务端
  DOM 行；私有只替换事件门禁为实时 predicate 后为 `3 passed / exit 0`；再恢复默认入口仍为
  `2 failed / 1 passed / exit 1`。该过程两生产文件、687 个保护源文件与新增测试字节保持不变。
- GO 后最小实现仅在生命周期事件发生时从同一 conversation store 调用 `getState()`，并复用
  `isStartingConversationSession`；没有新增重新订阅、render-ref 或第二份会话状态。新增测试的
  `startSession()` 同步调用已放入 `act`，不 await 尚未释放的启动 Promise。修正后新 3 测试为
  `3 passed / exit 0` 且无 `act` 警告；冻结 RED 的全部 26 个 `expect` 经 AST 核验保持。
- 两项有效私有变异均未改跟踪源：挂载快照与 render 快照各使两个正向 DOM 断言失败、反向用例通过，
  两次均为 `2 failed / 1 passed / exit 1`。这证明目标行为由事件时实时 store/predicate 提供。
- 主控本轮新鲜 13 门禁全部 `exit 0`。Vitest 为 `1219 passed / 51 files / 0 skip`；旧
  `50 files / 1216 tests` 身份全部保持。完整 E2E 为
  `248 = Chromium 124 + WebKit 124`，每例恰有一个 passed result、`retry 0`，且
  `skip / flaky / unexpected` 均为 `0`。
- backend 为 `941 passed / 3 warnings / 0 skip`，raw coverage 为 `81.55505107832009%`；
  build-script `47`、Fake API `116`、API 类型 runner `8` 均通过，iOS 仅 Node `37 / exit 0`。
- lint 为 `132 warning / 0 error / 0 new`；file/message/rule 多重集与冻结基线完全一致，
  687 个保护文件保持不变。三代码/测试文件已冻结，本轮文档收口未再改动。
- 本地实现与门禁已收口，但独立技术 Review、最终文档 format、正常 Husky、提交/推送仍以主控同卡
  回执为准；不能自行写成 APPROVED。用户 Review 待。生产、真实 Provider/IdP/LiveKit、设备、
  部署和真实链路均未授权或验收。
- R2-LIVE 完成时 R2-UI 与 SGEC-OFF 仍未实施，不能提前勾选；R2-UI 后续已另行完成并达到 FINAL_READY，
  SGEC-OFF 当时也未实施（原时点），两者后续均已分别完成。本批独占合成 PG 当时尚未清理，现已于
  SGEC-OFF 完成后清理。R2-LIVE 当时正式返修为 `0/2`。

### DEC-A R2 与 SGEC 设计口径回写（FINAL_READY）

- 本小节是 2026-11-15 的历史快照，`FINAL_READY` 绑定 DEC-A 设计回写时点；以下“当前快照”
  “当前等待点”和全部数字均只描述当时状态，不表示 R2-LIVE 实施结果。R2-LIVE 当前完成情况以
  上方小节为准。
- 用户已确认 R2 与 SGEC 均采用推荐 A；本卡只把决定写回权威文档并更新索引、TODO 与历史，不改
  产品代码、测试、API、数据库、迁移、依赖、CI 或服务。唯一实施 worktree 为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，基线
  `codex/B1-learning-events-20261112@0aae655928cf046482627830aee9df6cb7fc1fc1`，开工 clean。
- R2-LIVE 规定生命周期事件发生时读取同一 conversation store 的实时启动状态；启动/恢复/结束
  在途不请求、不排队，退出在途不自动补发。R2-UI 规定设置名称为“设置”，活动行及结束/恢复
  确认面板用现有模式与开始时间标识记录，完整 UUID 只留内部 key、稳定定位及 API/目标归属。
  精确合同见 [R2_FOLLOWUP_CONTRACT.md](./R2_FOLLOWUP_CONTRACT.md)。
- SGEC-OFF 只定义现有五个核心字段的全批次严格离线校验、调用方合法技能集和固定合成材料；
  不新增 DB/API 字段，不接默认分析、BKT、learning events、Provider 或自动重试。合法标签不由
  校验模块硬编码，`other` 只可在调用方集合明确包含时使用；结构通过不称准确率。精确合同见
  [SGEC_OFFLINE_CONTRACT.md](./SGEC_OFFLINE_CONTRACT.md)。
- 本实施节点只改设计/状态文档，未运行测试、服务、PG 或真实外部依赖，新代码门禁为零；主控在独立
  控制面完成前端 `7` 项、后端 `5` 项及附加脚本的机器执行，全部 `exit 0`，其中 iOS 侧 Node 脚本
  `37` 项 `exit 0`。主控 12 项与 format 合计 13 项全部 `exit 0`；独立 Review、提交发布以主控回执为准。
- DEC-A 当时快照 Vitest 为 `1216 passed / 50 files / 0 skip`；完整 E2E 为
  `248 = Chromium 124 + WebKit 124`，每例恰有一个 passed result、`retry 0`，
  `skip / flaky / unexpected` 均为 `0`。
- backend 为 `941 passed / 3 warnings / 0 skip`，raw coverage 为 `81.55505107832009%`；
  build-script `47`、Fake API `116`、API 类型 runner `8` 均通过。
- lint 为 `132 warning / 0 error / 0 new`；主控机器复核 file/message/rule 多重集与上一冻结基线完全
  一致，687 个保护源文件未变。
- DEC-A 写入时 R2-LIVE、R2-UI 与 SGEC-OFF 三张实施卡均未实施；该未实施状态是 DEC-A 历史停点。
  R2-LIVE 的后续 FINAL_READY 见上方当前小节，当时并不代表其产品行为已经完成。
- DEC-A 独立 Review、当时任务分支提交与推送以该卡主控回执为准；用户 Review 待。
  本卡不开 PR、不合并、不部署，真实 Provider/IdP/LiveKit、设备与生产仍未验。

### RDOC 路线图历史快照口径修正（FINAL_READY）

- 本小节是 2026-11-15 的历史快照，`FINAL_READY` 绑定 RDOC 当时完成时点。R2-14 的
  `941 / 81.57% / 246` 等数字继续绑定各自历史快照，
  B1/WPH 的失败和证据不改；RDOC 当时把 §3.4 与 B1 实施顺序的实现/验证索引指向当时的 A18P2，
  这不表示当前 R2-LIVE 结果。
- 旧“停在此卡、不启动下一卡”明确为历史暂停边界；RDOC 之后的下一卡和未完成项以其当时
  [TODO.md](../TODO.md) 为准。路线图架构、业务政策、范围与阶段退出条件均未改变。
- 主控完整机器核验的 13 项门禁全部 `exit 0`；Vitest 为 `1216 passed / 50 files / 0 skip`。完整
  双浏览器 E2E 为 `248 = Chromium 124 + WebKit 124`，每项恰有一个 passed result，
  `retry / skip / flaky / unexpected` 均为 `0`。
- backend 为 `941 passed / 3 warnings / 0 skip`，coverage 原始值为
  `81.54086265607265%`。build-script 为 `47`、Fake API 为 `116`、API 类型 runner 为 `8`、
  iOS 侧仅 Node 脚本为 `37`，各命令均 `exit 0`。
- lint 为 `132 warning / 0 error / 0 new`；lint 比较按 file/message/rule 多重集，忽略行号；本卡
  源文件保持不变，687 个保护文件未变。路线图原有 37 处含数字的代码片段与全部代码围栏均保留；
  文中 `246` 代码片段只重述既有 R2-14 结果，不新增历史数字。
- 本批合成 PG 清理小结：`停止 0；原观察器 1；独立确认 0，原日志保留`。原 auto-remove
  观察器把预期 `No such object` 与实际 `error: no such object` 按大小写比较后误判；按原精确 ID、
  容器名分别 inspect 均为 `1 / [] / no such object`。独立 `docker ps` 的精确 ID 列表为空且命令
  `exit 0`，新的只读确认命令 `exit 0`，`pg-cleanup.json` 已实际落盘，auto-remove 已确认，其它
  资源未动。该 `exit 1` 属私有观察器问题，不是产品回归，仓内源码未为此修改。
- RDOC 当次为纯文档修改，实施节点不跑测试、服务或 PG，不读取 runtime 或凭据。其技术 Review、
  最终 format、正常提交发布以该卡回执为准，用户 Review 待。归档见
  [todo-done.md](./history/todo-done.md#2026-11-15-rdoc-路线图历史快照口径修正)。

### A18P2 启动/恢复生命周期减重与实例隔离（FINAL_READY）

- 本小节是 2026-11-15 的历史快照，`FINAL_READY` 绑定 A18P2 当时完成时点。以下任务分支、
  “最近产品”、详细数字和边界均为该时点状态，不表示 R2-LIVE 当前结果；R2-LIVE 的当前数字
  以上方小节为准。
- 只读基线：唯一实施 worktree 为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，基线 `da185dc095dd85fb3292c35c4e6cc7b9e3297c7c`，
  开工工作树 clean。允许写集仅为任务卡列出的两个 store 文件、三份 store 测试与四份文档；不改
  appStore、platform、RoomSession、API/auth、UI 文案/活动列表、后端/迁移、依赖锁或 E2E/CI。
- 实现：移除模块级 `currentStartupTracker`、`testingLifecycleOptions` 与全局测试注入
  `_setLifecycleOptionsForTesting`，删除 `conversation.ts` 对 setter 的 re-export；`isNativeIos()`
  直接读 `detectPlatform()`，`createLifecycleAdapter()` 改为无参调用；`createConversationSlice`
  内新增实例级 `currentStartupTracker`，把 start/resume 重复的生命周期创建/cleanup/就绪 guard 抽成
  实例内公共 `runStartupLifecycle`，两动作复用同一 tracker 身份与资源隔离。公共动作签名/返回值/
  状态机、认证 principal/revision/代际、Cloud disabled 能力门禁、原生 10 秒 deadline、先去重槽位
  再初始化及同步通知重入、旧回调/就绪/timeout/finally 隔离与全部请求顺序/取消不新增 end POST
  语义均不变；R1 将 `runStartupLifecycle` 由 async 改为同步返回（`awaitNativeReady` 仅在 native 分支
  异步等待 ready），Web 分支零额外 await，恢复共同 setup 与 Web guard 同步执行，既有 native 10 秒与
  同步重入/取消契约不动。
- 新增回归：`conversationLifecycleIsolation.test.ts` 用真实 `createConversationSlice` 构造两个
  独立 Zustand 物理容器，覆盖 start/start、start/resume、resume/start、resume/resume 与
  cancel/late 五条 A18P2 跨实例隔离断言：第二实例不得 dispose/退订第一实例，取消/完成一实例不影响
  另一实例资源，各自 late 结果不能写其他实例。两旧测试文件改为局部 `vi.mock("@/platform")` +
  `detectPlatform`/`createLifecycleAdapter` mock 控制 native/Web 分类与 adapter 事实，旧 expect 链
  保持；新增回归失败路径补异常安全 test-owned finally cleanup（取消各自 store、释放本例挂起 ready
  并 `Promise.allSettled` 收束 pending）。
- TDD/R1 历史（保留，不覆盖旧失败）：原新文件 5 条全行为 RED（`0 passed / 5 failed / 0 skip / exit 1`，
  四对动作均误 dispose 第一、cancel 误 dispose 第二）；私有 load 仅将 tracker 声明移入 factory 后
  同 5 条 `5 passed / 0 failed / 0 skip / exit 0`，恢复原杠杆默认配置再次 `5 failed / exit 1`，全程两个
  生产与测试 hash 保持（RED5 → 词法作用域私有 GREEN5 → 原 RED5 因果，仅证本次实例隔离）。首轮联合
  三文件 `130 = 110 passed / 20 failed / 0 skip / exit 1`（新增 5 条隔离全 pass，旧回归 20 失败，根因
  `runStartupLifecycle` 声明 async 让 Web 多一次微任务）；quality `exit 2` 唯一 TS2345 为新隔离测试约
  151 行 `api.endSession` mock 与真实 `Session` 返回不符；format `exit 1` 仅 conversation.test.ts 与
  conversationSlice.ts。R1 恢复 Web 同步 setup + 仅 native 等待 ready，并修新 fixture 类型。
- 最终门禁：13 项门禁组合全部 `exit 0`。完整 Vitest 为 `1216 passed / 50 files / 0 skip`；联合三文件
  默认配置正向复验为 `130 passed / 0 skip`，变异后默认配置再次 `130 passed / 0 skip`。
- 浏览器与后端：完整 E2E 为 `248 passed = Chromium 124 + WebKit 124`，每项测试恰有一个 passed result，
  `retry / skip / flaky / unexpected` 均为 `0`；backend 为 `941 passed / 3 warnings / 0 skip`，raw
  coverage 为 `81.66855845629966%`。
- 辅助门禁：build-script `47`、Fake API `116`、API 类型 runner `8`、iOS 侧仅 Node runner `37`，均通过；
  iOS 计数不代表真实 iOS 设备验收。lint 为 `132 warning / 0 error / 0 new`，文件、消息、规则多重集保持，
  行号允许随修改移位。
- 变异与保护：三项有效私有行为变异均为 `exit 1` 并被对应断言杀死——tracker 重置为模块级时新 5 项隔离
  断言 fail；native 期限 `10000→9000` 时旧 9999ms 仍 checking 断言 fail 1；Web 两入口恢复无条件 await 时
  旧立即 capabilities 调用断言 fail 1。各命令 `exit 1`，未选 119 项不计覆盖率，跟踪生产文件 hash 未改。
  旧 `610` 条既有 `expect` 语句 AST 保持（conversation `591` / navigation `19`）；`125` 个完整旧 callback
  （conversation `120` / navigation `5`）除 setter 标识符映射与空白注释外 token 一致；`682` 个保护文件未改。
- 交付边界（A18P2 时点）：A18P2 只进入 A18P2 当时任务分支的最终提交与推送；不开 PR、不合并、
  不部署。
  其最终文档 format、独立 Review、提交和推送以该卡主控回执为准，用户 Review 待。真实设备、
  真实 LiveKit/Provider/IdP、远端新 CI、部署和生产链路均未验收。旧「不 push/deploy」为 A18
  当时时点表述。

### A19 P2 Room 快照与引用所有权（FINAL_READY）

- 只读基线：唯一实施 worktree 为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，基线为
  `a0a54292da5352dd25e83de2840a4bd5f28341a4`。允许写集只为任务卡列出的两个平台/组件文件、
  两份对应测试及四份文档；不改后端、依赖、锁、迁移、服务或业务协议。
- Web 初始门禁：新增无订阅纯读取 `getWebLifecycleSnapshot`，每次实际调用都读取当前
  visibility/online；visible、hidden/offline 与 unknown/null 契约不变，读取本身不注册监听。
  `RoomSession` 不再为初始检查创建临时生命周期 adapter，也不再冻结首次快照。
- Room 所有权：`RoomContextSync` 只接收必需 `roomRef`，删除无人消费的可选 `onRoom` 和可选
  `roomRef`，且不再在 render 阶段写引用。所有权只在已提交的 layout effect 中发布；Room 替换
  或卸载时仍同步停止旧 Room 的本地音轨，并在引用仍属于该 Room 时清空。同步生命周期 callback、
  迟到 callback 隔离、A77 timer 所有权和 ActiveConversation 的第二清理链未改。
- 回归场景：A19P2 覆盖后续实际 render 读取 hidden、并发 render 已创建但未提交 Room、SDK Room
  commit 替换、StrictMode effect replay 与健康重渲染。首轮 TESTS RED 精准选中 5 项，结果为
  `2 passed / 3 failed`，其余 102 项未选；校验期间不用固定 sleep、retry、skip、延长 timeout 或
  直接调用内部 helper 制造行为结果。
- RCA 证据：修正测试夹具后，两文件为
  `107 total / 106 passed / 1 failed / 0 skip / exit 1`，唯一失败是并发所有权场景。主控私有 load
  反事实仅移除 render 写 `roomRef` 的块后，同一用例 `1 passed / exit 0`；恢复原杠杆后再次
  `1 failed / exit 1`，全程两个生产文件 hash 未改。该因果只绑定本卡新场景，不反推或改写 A82
  旧失败根因。
- 首轮 GREEN 历史：实现后两文件为 `107 total / 106 passed / 1 failed / 0 skip`，新并发等 5 项已
  通过，唯一失败是既有 CON-04 订阅后快照夹具；完整 Vitest 为
  `1210 passed / 1 failed / 1211 total / 0 skip`。全仓 format 当时
  `exit 1`，仅指向 `RoomSession.tsx`、`VoiceInterface.test.tsx` 与
  `docs/history/todo-done.md`。这些结果作为返修前历史保留，不覆盖原始 r0 与 ev。
- R1 修正：CON-04 的纯 getter 与 adapter 改为共享同一 `readSnapshot` 读取事实和计数；纯 getter
  使用仅覆盖本用例的 `mockImplementationOnce`，防止跨例泄漏。只迁移该既有 `it` 的非断言
  setup 与陈旧注释，四条原 `expect` 链字节未变；订阅后安全复核、产品门禁与断言均未放宽。
- 最终门禁：13 项门禁组合全部 `exit 0`。完整 Vitest 为
  `1211 passed / 49 files / 0 skip`；R1 后两文件默认配置正向复验为 `107 passed / 0 skip`。
- 浏览器与后端：完整 E2E 为 `248 passed = Chromium 124 + WebKit 124`，每项测试恰有一个
  result，`retry / skip / flaky / unexpected` 均为 `0`；backend 为
  `941 passed / 3 warnings / 0 skip`，raw coverage 为 `81.54086265607265%`。
- 辅助门禁：build-script `47`、Fake API `116`、API 类型 runner `8`、iOS 侧仅 Node runner
  `37`，均通过；iOS 计数不代表真实 iOS 设备验收。lint 为 `132 warning / 0 error / 0 new`，
  文件、消息、规则多重集保持，行号允许随修改移位。
- 变异与保护：三项有效私有行为变异均为 `exit 1` 并被对应断言杀死，分别是 render 提前发布、
  冻结 SDK ownership 依赖与冻结 Web 首次快照；最初一轮私有 Vite 路径解析失败未形成行为变异，
  不计有效杀死。两个旧测试文件共 `530` 条既有 `expect` 语句 AST 保持，仅 CON-04 发生非断言
  arrange 迁移；`682` 个保护文件未改。
- 交付边界：A19P2 只进入当前任务分支的最终提交与推送；不开 PR、不合并、不部署。最终文档
  format、独立 Review、提交和推送以主控同卡回执为准，用户 Review 待。真实设备、真实
  LiveKit/Provider/IdP、远端新 CI、部署和生产链路均未验收。

### A82C Native Room 夹具就绪证据与文档核销（历史快照；当时 FINAL_READY）

- 只读基线：唯一实施 worktree 为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，起始 HEAD/base 均为
  `18801fcb48a36d9ec751c948ff2ed34417794a19`，文档写入前工作树 clean。本轮仅允许修改
  `TODO.md`、`docs/PROJECT_STATUS.md`、`docs/history/todo-done.md` 与
  `docs/verification/cross-platform/CP-06-NATIVE-FIXTURE-READINESS.md` 四份文档。
- 历史证据链：主控已独立重读旧 A82
  [integration.json](/Users/sunpcm/code/EchoTalk/.review/reports/workflow-eval-r2/a82/reviewer/integration.json)
  的 15 份 `main_checks` 原始日志，SHA 全部匹配；旧提交
  `d8c9ff9d8f69ef0d55add4c955bb096b790f6e2c` 与当时 `APPROVED`、正常 hook 单提交、main
  精确 fast-forward、完整门禁均属于已核验历史，不是 A82C 当前定向验证或当前门禁结果。
- 隔离依赖与 PG：主控已恢复隔离 worktree/依赖，并以本轮新建的 empty tmpfs PostgreSQL `15.19`
  监听 `127.0.0.1:55433`；18 份既有迁移全部重放成功，`exit 0`。该 PG 当前仍由持续批次独占使用，
  整批结束才清理；本文不把迁移成功单独表述为测试或质量门禁通过。
- 当前卡只核销 Native Room 本地夹具就绪子项。既有两处跨异步 native/DOM 就绪用例先保存当前
  DOM 实例，再等待同一实例的 callback map 项及所需字段登记；目标用例仍在同一 native callback
  返回前读取 `stopCalledDuringCallback`，证明本地轨同步停止未被等待延后。本卡产品与测试字节仍
  零改，也不修改依赖、锁、迁移、服务或共享工具；权威实施边界见
  [CP-06 Native Room 回归夹具就绪](./verification/cross-platform/CP-06-NATIVE-FIXTURE-READINESS.md)。
- 源码审计：当前两条目标与旧 A82 完整 callback 并非完全相同；差异仅为 `6` 处
  `useConversationStore → useAppStore` 的 typed store facade 标识。当前 `conversation.ts` 明确
  以同一物理容器提供 typed facade；除上述标识外，guards 与 callback 返回前同步停轨断言一致。
  因此不得表述为“整段 AST 完全相同”。
- 当前门禁证据：主控机器回执为
  [verified-summary.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/continuation-20261115/A82C/reviewer/verified-summary.json)
  与
  [full-gates.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/continuation-20261115/A82C/reviewer/full-gates.json)。
  `full-gates.json` 的 `quality`、`vitest`、`build-script`、`fake`、`api-check`、`api-test`、
  `e2e`、`backend-format`、`backend-lint`、`schema`、`metadata`、`backend-test`、`format`
  共 13 项分组均为 `exit 0`。
- 当前完整测试树：Vitest 为 `1206 passed / 49 files / 0 skip`；完整双浏览器 E2E 为
  `248 passed = Chromium 124 + WebKit 124`，每个 test 恰有一个 passed result，
  `retry / skip / flaky / unexpected` 均为 `0`；backend 为
  `941 passed / 3 warnings / 0 skip`，raw coverage 为 `81.69693530079455%`。build-script 为
  `47`、Fake API 为 `116`、API 类型 runner 为 `8`；iOS 侧仅运行 Node runner `37`，不代表
  真实 iOS。lint 为 `132 warnings / 0 errors / 0 new`，且与 A84C 逐诊断精确一致。
- 当前 Native 定向证据：两条目标在 `20` 个独立进程中执行，每个进程均为 `retry=0`；每次恰选中
  `2` 项并全部通过，共 `40 passed`。每次另有 `84` 项未选，不计入目标覆盖率；该 `40` 是定向
  执行结果，不与 Vitest `1206` 相加。
- 语义边界：已观察到的直接事实是 callback map 项尚未就绪；显式等待只移除这一夹具竞态。
  触发旧失败的完整因果仍未独立证明，有限次重复通过也不能替代因果或概率证据，更不能据此宣称
  真实设备故障已修复。
- 外部边界：真实 LiveKit/Provider、IdP、设备、远端新 CI、部署与生产链路仍未验证；本子项不关闭
  RF-07、RF-09、RF-12 或其他 RF 总项，也不启动 A19/A18。当前停在 `FINAL_READY`，不推进产品或
  下一卡。
  独立Review/提交发布见主控同卡回执，用户Review待。

### A84C LiveKit 语音连接策略文档收口（2026-11-14 历史快照；当时 FINAL_READY）

- 只读基线：worktree 为 `/private/tmp/echotalk-b1-implementation-20261112`，分支
  `codex/B1-learning-events-20261112`，起始 HEAD/base 均为
  `44cb125493af4e46e38f7199e197b3cc9bd87bd3`，文档写入前工作树 clean。本轮只允许修改
  `TODO.md`、`docs/PROJECT_STATUS.md`、`docs/history/todo-done.md` 与
  `docs/verification/cross-platform/RF-10-SESSION-CONNECT-POLICY.md` 四份文档；交付报告写在
  `/private/tmp/A84C-implementation.md`。
- 历史事实：A84 r0 在源码内记录的“停在 Review”是旧交付时点，其后旧独立评审已正式
  APPROVED。旧快照为 `fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d`，最终提交为
  `42c251b3470aa5f7e9cfe5a1fb2655dc8f9b5aa9`；7 个变异均有效、lane/main 15 项复验通过。
  回执见 [review-final.md](/Users/sunpcm/code/EchoTalk/.review/reports/workflow-eval-r2/a84/reviewer/review-final.md)
  与 [milestone-summary.md](/Users/sunpcm/code/EchoTalk/.review/reports/workflow-eval-r2/a84/reviewer/milestone-summary.md)。
  该提交不是 A84C 的 `44cb125…` base 的祖先，因此旧 Review/提交/门禁结果不能转写为 A84C
  快照结果。
- A84C 快照测试与质量门禁：`A84C-full-gates.json` 的 13 个键分组执行均为 `exit 0`。最终
  Review/提交发布见主控同卡回执，用户 Review 待。证据见
  [A84C-full-gates.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/A84C-full-gates.json)。
  Vitest 为
  `1206 passed / 49 files`；完整双浏览器 E2E 为 `248 passed = Chromium 124 + WebKit 124`，
  每个 test 恰有一个 passed result，失败/跳过/flaky/retry 均为 0，`workers=1`；backend 为
  `941 passed / 3 warnings / 0 skip`，原生覆盖率 `rawCoverage=81.54086265607265%`；
  build-script 为 `47`、Fake API 为 `116`、API 类型 runner 为 `8`、非 native iOS Node runner
  为 `37`，均通过；lint 为 `132 warning / 0 error / 0 new`，逐诊断与 CF20 一致。
- A84C 快照针对性测试只运行当时三份相关文件，共 `29 passed`。旧 A84 的 `37` 目标包含另一文件，
  两者不混算或相加；该 `29` 是当时完整 backend `941` 的子集。
- A84C 快照专用 empty tempfs PostgreSQL 已按 `15.19` 启动并真跑 18 份既有迁移，`exit 0`；主控随后
  完成精确 container ID、双 owner 与 `127.0.0.1` 核验，stop `exit 0`，并验证
  `auto-remove=true`，资源不再保留。
- A84C 快照实际 SDK 为 `livekit-agents 1.6.10`，`pyproject.toml`、`uv.lock`、`requirements.txt`
  与 installed 四处一致，该快照无需升级或安装。旧 A84 的 `livekit-agents 1.4.3` 只属于更早的
  历史快照。A84C 快照三个 STT/LLM/TTS role 为 `10s / 3 / 2s`，独立不可恢复错误阈值仍为 3；窄适配器每次
  创建全新 SDK 选项，真实 entrypoint 通过零参数 wrapper 延迟读取快照时 `AgentSession`，通用
  orchestrator 注入合同未改。
- A84C 快照冷导入使用当时生产零参数 factory。在合法且各 role 不同的 Catalog 替代快照下创建 2 个
  未 start 的 SDK Session，真实公开 `conn_options` 的 9 个 role 字段与独立错误阈值均正确；两个
  对象隔离，修改第二个不污染第一个，当时 `AgentSession` 绑定被实际消费，`finally` 已关闭全部
  Session，asyncio 任务回到基线；真实 App 的 config/database 未被导入。
- 网络证据须区分能力探测与服务连接：导入 `urllib3._has_ipv6` 时曾有 1 次 `bind(::1, 0)`
  能力探测被拒；两次探针审计计数归类失败 `exit 1` 均保留，根因已由调用栈和本机源码证明。
  分阶段审计显示 Session 构造/关闭阶段零新增 IO，全程零 outbound connect、DNS、send、
  `Session.start` 与真实 dotenv 读取；正向 probe `exit 0`。不能把上述 1 次被阻断能力探测写成
  0 次“导入联网尝试”，也不能把它混同 0 次服务连接。
- 旧 7 个变异继续绑定历史回执。主控已逐个实核其原始 `check.log` SHA、kill marker 与变异前后
  源码指纹，并写
  [A84C-historical-mutations-verified.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/A84C-historical-mutations-verified.json)；
  这些结果仍只属于历史，不与 A84C 快照新增两项变异混算。A84C 快照只针对 `agent.py` 当时变化新验 2 个私有
  入口变异：删除 `conn_options` 被 `POLICY_CONSUMPTION_FAILED` 杀死；捕获旧构造绑定被
  `DYNAMIC_BINDING_FAILED` 杀死；两者均 `exit 1`，源码未改。
- 与旧
  [audit-r0.json](/Users/sunpcm/code/EchoTalk/.review/reports/workflow-eval-r2/a84/reviewer/audit-r0.json)
  逐文件比对，A84C 快照的 Catalog、session policy 和三份相关测试共 5 个源码/测试文件 hash 不变；
  `agent.py` 只多日志脱敏 import 与入口调用 3 行，Session factory 边界 AST 未变。
- A84C 快照的真实 Provider、IdP、
  LiveKit/Worker、设备、远端新 CI、生产部署和 RF-12 前置仍未由此关闭；RF-10 整项继续未勾选。
  独立Review/提交发布见主控同卡回执，用户Review待。

### RF04E 已有远端 CI 证据核对（2026-11-14 历史快照）

- 只读基线：worktree 为 `/private/tmp/echotalk-b1-implementation-20261112`，分支
  `codex/B1-learning-events-20261112`，起始 HEAD `4ec1a4d2c89ec453a833bb06034e6a806e0c9ee1`；
  文档写入前工作树 clean。`42c61bb`、`6bda2cd`、`ef6cb53` 是历史 main push attempt 1，
  `5c28e1b` 的 #128 聚合失败是可核实的历史反证；完整远端矩阵与来源链接集中在
  [CP-06 CI 质量门禁验证](./verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。
- 原始 R0 的完整 13 项本地门禁中 12 项 `exit 0`，`e2e` 为 `exit 1`，聚合也为 `exit 1`。Vitest
  为 `1206 passed / 49 files`；backend 为 `941 passed / 3 warnings / 0 skip`，原生 coverage JSON
  的 `percent_covered=81.55505107832009`，记为 `81.56% raw coverage`；build-script `47`、Fake API
  `116`、API 类型 runner `8`、非 native iOS Node runner `37` 均通过；lint 为
  `132 warning / 0 error / 0 new`，逐诊断与父基线精确相同。
- 首轮全量双浏览器 E2E 为 `245 passed / 1 failed / exit 1`，配置为 `--retries=0 --workers=1`。
  失败是 Chromium 的 `a11y-focus-touch.spec.ts:86`，第 93 行实际 `seen.length` 为 `5 < 6`。
  `error-context` 中七天区块仍为 loading；该当时快照尚未证明其与环境、产品或历史回归原因的关系，
  本轮不修改产品、源码、测试或断言。
- 追加的 `retain-on-failure` trace 零重试完整双浏览器 E2E 已结束 `exit 0`：原始 JSON 主控机器核验
  为 `246 passed`（Chromium `123` + WebKit `123`）；失败、跳过、flaky 和 retry 均为 0。每个
  test 恰有 1 个 passed result；诊断运行全局 `workers=1`，两个 project 的 `retries=0`。证据为
  `RF04E-e2e-diagnostic-results.json`、`RF04E-diagnostic-verified.json` 与
  `ev/ev-RF04E-e2e-diagnostic-full.txt`。这是追加诊断，不覆盖原始 R0 的 `245 passed / 1 failed`
  与 `exit 1`；该诊断当时未复现焦点失败，原因也仍未证明，不能写成已修复。
- RF04E 快照专用 empty tempfs PostgreSQL 已由主控核验精确 container ID、两个 owner 与 loopback 后停止，
  `stop_exit=0`，并确认 `AutoRemove=true`；683 份保护文件未改。该保全与其余 12 项门禁成功都不能
  覆盖原始 E2E/聚合 `exit 1`，因此该历史快照的本地结果不能概括为全绿。
- 原始证据保留在
  `/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/ev/ev-RF04E-full-e2e.txt`
  及同目录对应聚合记录；追加诊断证据见上述三个文件。远端历史正向 run 不复用本次本地失败，也不
  把本次失败写成远端 CI 结果；
  本轮核对时的起始树 `4ec1a4d` 的 run count 为 `0`，required check、PR fail-block 与真实
  Provider/IdP/LiveKit、设备、生产链路仍未验。最终 Review 与提交/发布见主控同卡回执；
  用户 Review 待。
- CF20 根因与验证转入下方独立历史快照；本段继续只绑定原始 R0 的 `245 passed / 1 failed` 与追加
  诊断的 `246 passed / 0 failed`，两者均不概括 CF20 快照的定向稳定性或完整 E2E。

### CF20 Chromium 焦点就绪竞态回归（2026-11-14 历史快照；最终 Review/发布见主控回执）

- 主控受控对照确认根因是测试就绪竞态：`weekly-progress` 请求 held 时七天区块保持 loading，
  原焦点遍历稳定得到 `5 < 6`；同一请求放行后 7 个日期按钮真实挂载，焦点序列为 `12`、包含
  “文档对话”且没有不可见焦点。`CF20-regression-RED-ports-clear` 的 3 次 Chromium RED 均在
  原 `seen >= 6` 处失败，`0 skip / 0 retry / exit 1`。更早的 `CF20-regression-RED` 因端口占用
  得到 0 tests，保留为执行失败记录，不混入任何正式通过数；占用者没有直接证据，保持未知。
- 本卡只读基线为 worktree `/private/tmp/echotalk-b1-implementation-20261112`、分支
  `codex/B1-learning-events-20261112`、base/HEAD
  `c5f9c7274ac85f6fb77212b8944c97e6edae41df`。仓库写集恰为 `TODO.md`、
  `apps/vite-app/e2e/a11y-focus-touch.spec.ts`、`docs/PROJECT_STATUS.md` 与
  `docs/history/todo-done.md`；不沿用上方 RF04E 历史快照的 base。
- CF20 快照实现只改 `apps/vite-app/e2e/a11y-focus-touch.spec.ts`，新增共享
  `waitForDashboardWeeklyProgress` 及其唯一 `toHaveCount(7)` 等待。正常 dashboard 用例与受控慢
  请求用例共同消费该 helper；慢请求用例在请求 held、真实 UI 往返完成后先证明 `ready === false`，
  再显式放行请求、等待 helper settle，随后原样执行 `tabThrough` 和原三条焦点断言。没有固定
  sleep、`test.step`、第二份 count7、产品 instrumentation 或算法变更；原共享 `openDashboard`
  和 Fake API 数据未改，weekly-progress route gate 是本次回归明确新增。
- 主控在私有副本只删除共享 helper 内唯一等待；Chromium 3 + WebKit 3 共 6 次均在
  `expect(ready).toBe(false)` 得到 `true`，`retry=0 / exit 1`，跟踪 spec 未变。该变异证明回归
  依赖真实异步就绪契约；`finally` 对正常路径和变异路径均幂等 release 并收束 readiness。
- 正式 `CF20-stability-20` 机器核验为原焦点与慢请求两个用例在 Chromium、WebKit 各重复 20 次，
  共 `80 passed / 0 failed / 0 skip / 0 flaky / 0 retry / exit 0`。每个 test 恰有 1 个 passed
  result；两个 project 均为 `repeatEach=20 / retries=0`，全局 `workers=1`。运行期间 spec 冻结
  hash 全程一致。
- 完整双浏览器 E2E 机器核验为 `248 passed = Chromium 124 + WebKit 124`，
  `0 failed / 0 skip / 0 flaky / 0 retry / exit 0`；每个 test 恰有 1 个 passed result。证据为
  `CF20-full-e2e-results.json`、`CF20-full-e2e-verified.json` 及对应主控日志。
- frontend 强制 lint、typecheck、build 均 `exit 0`；Vitest 为 `1206 passed / 49 files`，
  build-script `47 passed`，Fake API `116 passed`，API 类型 runner `8 passed`，均 `0 skip`。
  lint 为 `132 warning / 0 error / 0 new`，逐诊断精确等于父基线。
- backend 为 `941 passed / 3 warnings / 0 skip`，本轮实算 raw coverage
  `81.58342792281498%`；非 native iOS Node runner 为 `37 passed / 0 skip / exit 0`。这些数字
  绑定该历史快照的主控回执，不改写上方 RF04E 或 WG20 的历史 coverage。
- CF20 快照专用 PG 已按精确 container ID、两个 owner 与 `127.0.0.1` 核验后停止，
  `stop_exit=0`，并确认 `auto-remove`。原 dashboard 目标 body 去除新增
  `waitForDashboardWeeklyProgress(page)` 调用后与基线逐字等同；683 份保护文件全部未变。
- 该快照完整 13 项门禁及聚合 `exit 0`（后端、前端、浏览器与最终格式分组执行）。
  独立Review/提交发布见主控同卡回执，用户Review待。

### WG20（WebKit 周语法重复稳定性补验）历史快照；最终回执与用户 Review 待

- 只读基线：worktree 为
  `/private/tmp/echotalk-b1-implementation-20261112`，分支
  `codex/B1-learning-events-20261112`，起始 HEAD 为
  `0e69b3fa70dca61d0b8ba9ae7a7d29dc92cda91b`，起始工作树 clean。源码 `354` 文件 SHA 冻结
  未变；`apps/vite-app/playwright.config.ts`、根 `package.json`、`AGENTS.md` 和
  `docs/agent-review-loop.md` 这四个文件分别与父提交中的对应 Git blob 逐字节相同。
- 主控实跑完整 13 项门禁及聚合均 `exit 0`。Vitest 为 `1206 passed / 49 files`；backend 为
  `941 passed / 3 warnings / 0 skip`，原生 coverage JSON 的
  `percent_covered=81.55505107832009`，记为 `81.56% raw coverage`；完整双浏览器 E2E 为
  `246 passed / 0 failed / 0 skip / 0 retry`，其中 Chromium `123`、WebKit `123`
  （`--retries=0 --workers=1`）。Node 构建脚本 `47 passed`、Fake API `116 passed`、API 类型
  runner `8 passed`、非 native iOS 脚本 `37 passed`，均 `0 fail / 0 skip` 且 `exit 0`。
- 目标 WebKit 补验使用该快照 HEAD、macOS WebKit 与 Fake API 夹具，两个周语法用例各重复 20 次，
  共 `40 passed / 0 failed / 0 skip / 0 flaky / 0 unexpected`；所有 `result.retry=0`，每个
  test 恰有 1 个 result，耗时 `52.763s`，配置为
  `repeatEach=20 / retries=0 / workers=1`。未能发现该快照夹具重复失败，不靠放宽断言或增加重试。
- WG20 快照 PostgreSQL 为当时自建 empty tempfs PG `15.19`，仅监听 `127.0.0.1:55433`，18 份迁移
  `exit 0`。精确容器 ID、两个 owner 与 loopback 已核验后停库，停库 `exit 0`，并确认
  `AutoRemove=true`；该快照 PG 已清理，未启动其他卡环境。
- lint 为 `132 warning / 0 error`；逐项诊断与 R213 父基线字节完全一致，新增诊断 `0`。当前失败
  夹具在失败阶段会持续返回 `503`，直到测试显式放行；该快照中 `retry` 等同 `refresh`，认证快照
  变化可能触发额外读取。历史“无重试 5 次失败 1 次”保留，“认证刷新耗掉唯一一次 503”仍是未经
  证明的假说，不能把该快照夹具写成当时唯一一次 `503`。
- 该快照只做补验和文档收口，没有产品修改或源码修复。重复通过只证明该快照 HEAD/夹具在 macOS
  WebKit + Fake API 下的稳定性，不证明历史根因，也不替代真实后端身份、真实 Provider/IdP/
  LiveKit、设备、远端 CI、生产或部署验收。证据位于
  `/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/`：
  `WG20-full-gates.json`、`WG20-repeat-results.json`、`WG20-repeat-verified.json`、
  `WG20-full-coverage.json`、`WG20-lint-comparison.json`、`WG20-pg-ready.json`、
  `WG20-pg-cleanup.json`、`WG20-baseline-source-sha256.json`、
  `WG20-baseline-config-sha256.json` 与 `ev/ev-WG20-*`。最终 Review、提交和推送状态以主控
  回执为准，本文不预填成功；用户 Review 待。

### R2-13（历史快照：组件目录按页面边界归位）本地实施/验收完成；用户 Review 待

- `Dashboard` 已从 `App.tsx` 抽为独立组件，函数体、参数和三行常量初始化保持原逻辑；38 个文件
  按页面边界完成 `git mv`，其中 29 个文件字节不变，9 个仅修改模块路径或目录注释。12 个测试文件
  随之移动，`src` 测试文件保持 49 个一一对应，Vitest、backend 与 E2E 三测试树计数不变。
- Vitest 为 `1206 passed / 49 files`；backend 为
  `941 passed / 3 warnings / 0 skip / 81.56% raw coverage`；双浏览器 E2E 为
  `246 passed / 0 failed / 0 skip / 0 retry / exit 0`（`--retries=0 --workers=1`）。
- Node 构建测试为 `47 passed`，Fake API 为 `116 passed`，API 类型 runner 为 `8 passed`，非 native
  iOS 脚本 runner 为 `37 passed`。lint 为 `132 warning / 0 error`，逐诊断不增；完整 13 项门禁及
  聚合均为 `exit 0`。
- 私有结构检查为 `43/43`，2 个变异均已处理；80 个增改删路径冻结且未漂移。主控独立代码 Review
  为 APPROVED，正式产品返修 `0/2`。
- 本轮未验证生产、真实 Provider/IdP/LiveKit、native 设备或部署；远端 CI 未执行，因为现有 workflow
  仅由 `main`/`master` push 和 PR 触发，本卡不开 PR。提交/推送状态以主控最终回执为准，本文不预填
  成功。旧 docs 历史路径引用保持原样，待用户裁定的生命周期项只同步当前源码路径，不改待裁定状态
  或产品逻辑。

### R2-12（macOS 构建产物与同步脚本）本地实施/验收完成；用户 Review 待

- `build.mjs --platform macos` 生成共享 Vite 静态产物 `dist/macos/<mode>` 与 manifest；
  `sync-macos.mjs` 在调用任何外部工具前校验来源产物、平台和 mode。新增 Turbo 任务把 `ANALYZE`
  显式纳入环境输入并缓存 `stats.html`，同时保留 Vite 的 `ANALYZE` 配置和输出语义。本卡只交付纯
  脚本，不创建 `src-tauri/` 或正式壳，也不确认为 Tauri 选型。
- R1 独立代码 Review 为 APPROVED，8 文件 hash 未漂移；R1 format、quality、build-script 均为
  `0`。build-script 为 `47/47`，其中新增 `26`、`0 skip`；iOS 脚本为 `37/37`；私有控制为
  `26 pass`，`4` 个变异均被杀死。
- R0 其余十个门禁均为 `0`：Vitest `1206 passed / 49 files`，Fake API `116 passed`，API 类型
  `8 passed`，backend `941 passed / 3 warnings / 0 skip / 81.56% raw coverage`，E2E
  `246 passed / 0 failed / 0 skip / 0 retry`，schema、metadata 与 Ruff 均 `exit 0`。lint 为
  `132 warning / 0 error`，逐诊断与父基线相同。
- R0 聚合为 `1`，原因是 Turbo 缓存缺陷；R1 三个受影响门禁聚合为 `0`，按门禁汇总的 13 项均记录
  为 `0`。上述结果不是一次从空缓存开始的完整全零重跑。
- 三种 mode 的实际 TSC/Vite 静态构建均为 `0`；验证使用不带 dotenv 的合成源码副本和公开
  `example.test` 配置，产物 app hash 与 R1 相同。缺 native config 时的实际 CLI 预期为 `exit 1`，
  未调用 Tauri。
- 风险：旧默认 build task 仍使用 `$ANALYZE`；本卡不改，也不宣称旧任务缺陷已复现，缓存策略另行
  复核。
- 当前边界仅为 macOS 静态构建产物和同步前校验。正式壳、Tauri 选型、native 认证、真实设备、
  签名、公证与发布均未创建或验收。提交/推送状态以主控最终回执为准，本文不预填成功。

### R2-14（Compose 系统就绪与一次性迁移）当次快照；用户 Review 待

- 公开 `GET /api/health/system-ready` 不依赖用户身份，只使用共享 PostgreSQL 执行 `SELECT 1`；
  成功为 typed `200 {"status":"ready"}`，连接、查询、超时或释放失败为通用 typed
  `503 {"status":"not_ready"}`。连接 Context 完整释放后才响应；数据库操作预算为 `0.5s`，为当次
  asyncpg 约 `2s` 的 graceful close 留余量，完整响应目标 `<3s`。旧 `/api/health/ready` 的认证、
  用户配置判断和 OpenAPI 语义未改。
- Compose 的 `echotalk-migrate` 使用 API 角色、同一 `DATABASE_URL` 和既有环境边界执行
  `alembic upgrade head`，`restart: "no"` 且依赖 PostgreSQL `service_healthy`；API、Agent、
  analysis-worker 依赖迁移成功，Web 依赖 API `service_healthy`。API healthcheck 使用镜像已有
  Python 标准库和 `ProxyHandler({})` 绕过环境代理，HTTP timeout `4`、容器 timeout `5s`，不嵌入
  Token。完整合同见 [COMPOSE_STARTUP_CONTRACT.md](./COMPOSE_STARTUP_CONTRACT.md)。
- 当次快照的完整 13 项门禁及聚合 `exit 0`；backend `941 passed / 3 warnings / 0 skip / 81.57% raw Total
coverage`，Vitest `1206 passed / 49 files`，Fake API `116 passed / 0 skip`，双浏览器
  `246 passed / 0 failed / 0 skip / 0 retry / exit 0`（`--retries=0 --workers=1`）；build-script
  `21`、API 类型 runner `8`、非 native iOS 脚本 runner `37` 均 `exit 0`；lint 为
  `132 warning / 0 error`，逐诊断与父基线相同。
- Compose 原生 config 与迁移依赖图 `exit 0`，未解析 `env_file`、镜像或启动原整栈。健康探针实际
  Python 命令五类均符合预期：ready `exit 0`，unready、wrong-body、timeout 为 `exit 1`，
  `HTTP_PROXY` trap 被绕过且代理收到 0 请求。独立自有 PG pause 返回 `503`、耗时 `2.518465s`、
  checkedout 为 0；unpause 后 `200`，用户数不变；完整连接释放后再注入异常仍为 `503`。
- 真实路由无 Bearer/错误 Bearer 均 `200`，旧 ready 错误 Bearer 为 `401`。18 份旧迁移 SHA 未变，
  本卡新增 migration 为 0。源码 10 文件与主控
  `R214-R1-code-frozen-sha256.json` 逐项一致。
- 缺 route 的初始 backend `6 failed / 0 skip / exit 1` 是功能实施前的有效 TDD RED（当时新功能
  尚未实现，尚未进入真实 PG 故障验证）；`ModuleNotFound` 导入错误、延迟 `IncludedRouter` 的
  route 枚举及 format 问题属于夹具/格式。R0 真实自有 PG pause 在 4.5s 外层请求超时且未返回
  `503`，是有效产品失败证据；R1 新增的约 2s-cleanup 模拟用例在 3.5s 硬期限命中，是模拟回归
  RED；随后 R1 真实自有 PG pause 以 `2.518465s` 返回 `503`，为成功验证。R2-14 正式产品返修
  使用 `1/2`；最终 Review/发布见主控同卡回执，用户 Review 待。

以下 A6 Linux 测试基线继续作为已合并历史快照，绑定代码
`87e0fd5432fe649e3ee91e8851c61c7d281986cc`：
[CI 43180144291](https://github.com/sunpcm/EchoTalk/actions/runs/43180144291) 与
[PR Guard 43180144203](https://github.com/sunpcm/EchoTalk/actions/runs/43180144203) 六项成功。
主控已亲读原始日志；后续仅 Markdown 归档，最终 head 的门禁与合并回执见 PR。

| 测试树 / 门禁  | A6 历史快照（本轮 B1 结果另见下文）               | 日志     |
| -------------- | ------------------------------------------------- | -------- |
| Vitest         | 1206 passed（49 个文件；含原 45 项契约）          | frontend |
| Playwright E2E | 234 passed（0 skip、无 retry）                    | frontend |
| Fake API 契约  | 108 passed                                        | frontend |
| API 类型生成器 | 8 passed                                          | frontend |
| 构建脚本       | 21 passed                                         | frontend |
| backend pytest | 809 passed，3 warnings，80.19% 覆盖率（59% 门禁） | backend  |

表内旧计数只绑定 A6 历史快照，不能与下方 B1 本轮结果混用；两者都不能代替真实 LiveKit、
第三方 Provider、真实 IdP、iOS/macOS 设备或生产部署验收。
命令见 [Agent 评审手册 §2 与 §20](./agent-review-loop.md)。

历史基线继续按快照绑定：B1 source `3b418e8` 的 [CI run 43152122060](https://github.com/sunpcm/EchoTalk/actions/runs/43152122060)
与 [PR Guard run 43152122194](https://github.com/sunpcm/EchoTalk/actions/runs/43152122194) 为 Vitest
1161/45、E2E 234、pytest 809/80.19%、Fake API 108、类型生成器 8、构建脚本 21；PR #140 head `ed3ac8ba` 的 Fake API 为 75 passed；A3 原 head
`437f6ff8` 为 103 passed；修正提交 `45e5212` 的本地快照为 108 passed，但本机 macOS E2E
为 233/1，Linux ARM64 两轮为 233/1、232/2，均不能计为通过。这些记录只属于各自快照，
不替换上表绑定 A6 代码 `87e0fd5` 的 Linux CI。

### A3（Fake API 契约校验，PR #141/#147）合并收口

Fake API 的成功响应与缺失 operation 受仓内 OpenAPI 校验，既有偏差精确固定；A3 该轮为 108 项
通过；历史 B1-4 Fake API 为 `110 passed / 0 skip / exit 0`，历史 B1-5 为
`113 passed / 0 skip / exit 0`，见本文
[B1 小节](#b1学习事件台账与-wph-历史收口快照用户-review-待)。
最终实现 source `b1d3756` 合入 `main@a7841b7`，文档后由PR #147收口；历史及偏差清单见归档。

### A4a（只读 data 层，PR #149）合并收口

最小 controller/hook、契约及45项独立契约测试已合并；未引入依赖。默认键补修的三项官方
RED→GREEN与私有7探针证据见历史。source `250a582` 六项CI后合入整树一致的 `main@3daa0a4`。

### A4b（WeeklyGrammar 数据查询迁移，PR #151）合并收口

组件仅渲染与 retry 转发，认证、生命周期、请求槽与 timer 移入 data controller/hook；原
JSX/文案/ARIA/class 和 146 个测试/fixture/config 文件保持不变。原 WG14、data45、全量
Vitest1206/49、Linux E2E234（0 skip/retry）与 pytest809/80.19% 通过；三处真实变异均被原 WG
断言捕获。最终 source `7659808` 六项 CI 后合入 `main@2598867`。真实服务/设备边界仍未验证。

### A4c（WeeklyProgress 数据查询迁移，PR #152）合并收口

两个 controller 共用一套订阅；原 WP31、data45、146 份测试/fixture/config 与界面 AST 保持。
主控全量 Vitest1206/49、六项 CI、Linux E2E234（0 skip/retry）、pytest809/80.19% 通过；
额外 React/jsdom 探针6/6，认证 revision、重复 cursor、日窗口下界三处变异均被原 WP 断言捕获；
最终 source `d47c3aa` 的 CI `43162885071` 与 PR Guard `43162885101` 成功后，以整树一致的
`main@5c7ab36` 合入。只做行为等价抽取，未改变依赖、HTTP、数据库或外部服务边界；
真实服务/设备仍未验证。

### A4d（DailyProgress 数据查询迁移，PR #153）合并收口

保留单套认证/lifecycle/午夜+100ms、原读取时点与summary+rows原子发布；146原测试/渲染AST不变。
私有8行为/4重入、4原DP变异、1206/49、Linux234、pytest809/80.19%通过；source130bbb6六CI后合入整树一致maina1afaca。真实服务/设备未验。

### A4e（ActiveSessions 只读迁移，PR #154）合并收口

Data controller持有分页/请求归属/tombstone，UI/写流程/单订阅中枢与146原测试逐字保全。
R1统一内部cursor，取消/失败组合的两项回归RED→GREEN；主控9项、补充13项/DP6与3原AS变异通过。
代码fb47cf4六CI原始日志确认1206/49、Linux234零skip/retry、pytest809/80.19%、108/8/21。
最终b69c527六CI通过并已真实合入；本机233/1仍为既有WebKit高度差异，不计为通过。

### A6（分层依赖门禁，PR #155）代码验收完成

零依赖error规则落实三组禁止边；用户清理整体移至store，四份完整AST仅import/mock路径规范化后相同，
其余144份测试/fixture/config逐字保全。真实依赖7→0，主控22项、补充19项及真实逆向import失败验证通过。
force lint/typecheck/build零缓存、1206/49及上述六CI通过；全批冷启动总审APPROVED。
重构前后7份构建产物逐字节相同；无用户行为、HTTP、文案、依赖或数据库结构变化。
额外本机首轮全量232/2仍记失败：已知WebKit336×23px及一次DocTalk标题未出现。旧新普通/8会话预置
合计80次零重试定向均通过，旧新完整重放各233/1、DocTalk均通过，唯一失败仍为上述高度；
首次232/2独立保留为P2待查观察，根因未明，不归因基线、环境或本卡回归，本机全树均不计通过。
真实Provider/LiveKit/IdP、设备与生产环境未验；B1-1 已交付 ORM、新增迁移、schema 回归与
worker head fixture 适配，最终本机门禁和专用合成 PostgreSQL 结果见本文 B1 小节。

### A5（导航切片，PR #148）合并收口

导航与会话切片组合在同一原子容器，未引入Router；18文件的340个case与1624个expect相关调用
AST保持。最终source `ae13222` 六项CI后合入 `main@0ea16a4`，详细过程见历史与验证文档。

### B1（学习事件台账）与 WPH 历史收口快照；用户 Review 待

**WPH 历史快照（2026-11-13，后续 R2-14 之前）：** B1-5 之后的独立小修复已恢复设置抽屉三个
Provider select 的
44px 触控高度与可靠可见焦点。真实 RED 为 Chromium `7 passed`、WebKit `7 failed`，定向 GREEN 为
`14 passed / exit 0`；该轮修复后完整双浏览器 E2E 为
`246 passed / 0 failed / 0 skip / 0 retry / exit 0`，完整 backend 为
`934 passed / 3 warnings / 0 skip / 81.45% / exit 0`，Fake API `113 passed / 0 skip`。该轮全部
13 项完整门禁及聚合均 `exit 0`；
Chromium/WebKit 最终检查均为三个控件各 `336x44`、`appearance:auto`、2px solid outline。主控
代码/测试 Review 与真实截图 Review 均 APPROVED，P0/P1 未关闭为 0，正式返修 `0/2`。整卡 Review
与提交/推送以同卡最终回执为准；用户 Review 待。上述 backend/Fake/E2E 数字只属于 WPH 当时
快照，后续 R2-14 的当次快照见上方 R2-14 小节。

历史交付：B1 新增并独立归档 `docs/LEARNING_EVENTS_DESIGN.md`，当时定义只追加事件、Job 写入
幂等、合成结果排除、`knowledge_states` 重算校验、来源关系、保留选项及一条以
`c06_transcript_events` 为父 revision 的 Markdown Alembic 草案。主控完成设计审阅并 APPROVED；
Python 草案经 `ast.parse` 成功，父 revision 已核对存在。PR #150 的六项 CI 已通过，原始日志确认
Vitest 1161/45、E2E 234、pytest 809/80.19%，且已合入 `main@4ee8b35`。该段只描述当时的设计
交付，不表示表、代码或迁移已经实施。

2026-11-12 用户已确认七项政策：以 `legacy_unknown` 保存切换基线并明确旧趋势不可恢复；旧
`pending` 和可重试 `failed` Job 切换后走新事务且不回填成功旧 Job；存续期保留明细且不设固定
TTL/快照裁剪；本平台整账号注销硬删业务库事件、转录、分析和派生状态，不匿名化、不操作外部
IdP、不增加单会话删除；本人结构化 JSON 导出保留来源/合成/版本并排除密钥、内部提示词和
Provider 完整原始响应；本版不开放成功后的重新分析；现有四参数冻结为 `bkt-v1` 且新版本不改写
旧事件。备份/法定特殊保留的生产方案和音频采集仍另批处理。

主控已在专用合成 PostgreSQL 中重放现有迁移至 `c06_transcript_events`，并验证以下历史基线：
Vitest 1206 passed/49 files、backend 809 passed/3 warnings/80.19%、Fake API 108 passed、
类型生成器 8 passed、构建脚本 21 passed 且相关命令均 exit 0；本机全量 E2E 为 233 passed/
1 failed、exit 1，唯一失败是既有 WebKit select `336×23 < 44`。上述旧数字只属于该历史基线，
不与本轮新增结果相加或替代。
**历史 B1-1** 随后完成 RED（主控实跑 4 failed/0 skipped、exit 1）并新增 `LearningEvent` ORM/注册、
`b1_learning_events` 迁移与 schema/约束回归；两个 observation 分支兼容 `model_version=NULL`，
16 个旧迁移未改动。主控随后在本轮专用合成 PostgreSQL 完成空库 upgrade 至 b1、PG schema
GREEN `4 passed / 0 skip / exit 0`、current/downgrade 回 c06 后清除表/索引/identity、reupgrade
至 b1 exit 0，以及独立真实 PG 与 ORM 元数据 compare 零差异 exit 0。ORM 的 `idempotency_key`
唯一约束与 migration 同名一致；`algorithm_params` 使用 `JSONB(none_as_null=True)`，将 Python
`None` 绑定为 SQL `NULL`。既有 worker PostgreSQL fixture 原固定 `c06_transcript_events`，主控实跑
得到 `1 error` RED 后，已改为读取仓库 Alembic 源码 `get_current_head()` 并严格比较数据库
`alembic_version`；原 DB/user/PG15.19/DSN guard 不变。

**历史 B1-2** 已实现同事务事件写入、幂等、用户锁与 BKT 合成隔离，主控独立代码 Review 结论为
APPROVED。历史 B1-2 专用合成 PostgreSQL 目标套件为 `116 passed / 0 skip / exit 0`；完整 backend 为
`844 passed / 3 warnings / 0 skip`、覆盖率 `80.82%`。Vitest `1206 passed / 49 files`、
build-script `21`、Fake API `108`、API 类型生成器 `8` 均 `exit 0`；强制 lint/typecheck/build
`exit 0`，lint 为 `132 warning / 0 error`；Ruff 格式/规则、schema 与 metadata 导出校验均
`exit 0`。15 项完整门禁中 14 项 `exit 0`，Chromium+WebKit 零 retry 为
`233 passed / 1 failed / 0 skip / exit 1`，唯一失败仍是与既有基线相同的 WebKit Provider select
`336×23 < 44px`，DocTalk 通过，不能称本机全树全绿；聚合入口 `exit 0` 不表示 E2E 通过。

独立探针确认用户锁、实际 `apply_seq` 相反观察、原始 ordinal、缺观察拒绝、未知模型 `NULL`、
不复制 alignment、三类完成冲突，以及 10 条观察/3 个知识状态/知识状态单次读取/unmapped 计数均
`exit 0`。17 个既有迁移字节未改动。B1-0 的 `809 passed / 80.19%` 和 B1-1 的 `813` 是历史基线；
历史 B1-2 backend 为 `844 passed / 80.82%`，历史 Vitest 为 `1206 passed / 49 files`。

历史 B1-3（当时）的代码/测试 Review 由主控独立审阅为 APPROVED，目标套件为
`147 passed / 0 failed / 0 skip / exit 0`；完整 backend 为 `878 passed / 3 warnings / 0 skip`、
覆盖率 `80.51%`、exit 0。Vitest 保持 `1206 passed / 49 files`，Fake API `108`、构建脚本 `21`、
API 类型测试 `8`，lint 为 `132 warning / 0 error / 0 new warning`；除 E2E 外所列完整门禁均
exit 0。前端自 `f6007a2` 未改，前端/Fake API/契约/配置均未改。代码 Review 通过不代表完整 E2E
或用户验收通过。

历史 B1-3 E2E 首轮为 `232 passed / 2 failed / 0 skip / 0 retry / exit 1`，失败分别是 WebKit Provider select
`336×23 < 44` 与 WebKit readiness 引导 textarea 超时；随后 DocTalk 定向为
`3 passed / 0 failed / 0 skip / 0 retry / exit 0`，再次全量为
`233 passed / 1 failed / 0 skip / 0 retry / exit 1`，DocTalk 通过、只剩同一 WebKit Provider
select 失败。首轮失败与 DocTalk 定向结果均保留；DocTalk 首轮失败原因未确认，不能归因于环境、
历史基线或回归，也不能把最终 E2E 写成全树全绿。

新迁移 `b1_learning_event_cutover` 在专用合成 PostgreSQL 中 upgrade 至该 revision、downgrade 回
`b1_learning_events`、reupgrade 与 roundtrip 均 exit 0；既有事件保留，ORM 与真实 PG schema compare
零差异，既有 17 份迁移与执行到的 18 份迁移 pin 均未变。门控、整包快照、只读、CLI 导入隔离及
八项既往回归缺口探针退出符合预期；READ COMMITTED 反例 mutation 被杀死。早期 R2 的 8 个失败中有
4 个是 fixture 状态缺失错误，修正冻结 R1 的合法 fixture 后才形成 8 个真实目标失败；
10 deselected、exit 1 的 RED 历史不应被写成原先 8 个均为语义 RED。

五阶段切换期间，实际 Job 领取函数 `claim_next_job` 本身没有 gate，因此全部新旧 worker 必须保持
停止到 `traffic_resumed`。部署代码只提供门控，不会启动 worker；显式停写声明、数据库锁和表锁
都不能证明未知旧进程已退出。CLI 只接受已批准的合成库白名单，不隐式读取 `.env`，结果码/用法按
0/1/2 区分；baseline 默认 preview 零写，只有显式确认参数才进入写入事务。零语法错误没有持久来源
行，校验只能检查 coverage 结构与类型，并在来源存在时比对事实，不能独证“零错误”或虚构 Provider
事实。

**历史 B1-4** 的本人数据结构化 JSON 导出已实现，主控独立代码/测试 Review 为 APPROVED，产品返修使用
`1/2`；用户 Review 仍待。下列结果均由主控代跑，实施节点没有冒领测试或数据库执行。初始 backend
基线为 `878 passed / 3 warnings / 0 skip / 80.51% / exit 0`；首轮 RED backend 为
`10 failed / 0 skip / exit 1`，首轮 RED Fake API 为 `106 passed / 4 failed / 0 skip / exit 1`。
R1 非有限值 RED 为 `9 failed / 11 passed / 0 skip / exit 1`，覆盖真实 PG/HTTP 六例和全部 10 个
float 字段的模型矩阵；修后目标为 `20 passed / 0 skip / exit 0`。完整 backend 为
`898 passed / 3 warnings / 0 skip / 80.86% / exit 0`，20 项目标是 898 项的子集，不能相加。
Vitest 为 `1206 passed / 49 files / exit 0`，Fake API 为 `110 passed / 0 skip / exit 0`，构建脚本
为 21、API 类型测试为 8、均 exit 0。format、lint、typecheck、build、backend Ruff format/lint、
OpenAPI schema、provider metadata 和 TS 漂移检查均 exit 0；lint 为 132 warnings/0 errors，warning
行清单与 B1-3 相同，无新增。

完整双浏览器 E2E 的原始结果必须保留为
`233 passed / 1 failed / 0 skip / 0 retry / exit 1`。唯一失败是
`[webkit] e2e/a11y-focus-touch.spec.ts:94:5`：设置抽屉三个 Provider select 为
`336x23 < 44px`，断言位于第 127 行。对应 UI/样式、E2E 用例/配置相对父提交未改，保留同名范围外
遗留；不能归因于未经证实的环境原因，也不能称全树全绿。`run-gates.py` 会容忍 `e2e=1` 并返回 0，
因此聚合 exit 0 不能代表真实 E2E 通过，也不能覆盖原始 exit 1。

专用 `postgres:15.19-alpine` 使用 `127.0.0.1:55433/echotalk_b1_test`。主控从空库重放 18 份既有
迁移成功，迁移字节不变且没有新增 DDL。API 仅新增 `GET /api/user/data-export` 和 13 个 Pydantic
schemas；旧 OpenAPI path/schema 逐值未变，A3 固定的 missing/unmodeled/deviation 清单逐字未改。
OpenAPI 与 TypeScript 由主控原生生成器产出，生成物本身不替代 Fake API 成功响应契约。

导出响应固定 `schema_version=1`，只含 `schema_version`、`exported_at`、sessions、transcripts、
pronunciation assessments、grammar assessments、learning events 与 knowledge states。各节显式
白名单排除密钥、认证身份、内部 prompt/文档、音频、Provider 完整原始响应/引用、幂等键及未列明
字段；Session 仅保留解释子记录所需的最小元数据。独立导出会话使用单一
`REPEATABLE READ READ ONLY` 快照，不复用认证调用方事务，也不通过强制提交 auth 事务解决首次用户
映射；本人空导出仍正常返回空数组。服务验证 Event/Session、Event/AnalysisJob/来源评估及 Skill
关系，并只读取本人数据；空数据返回空数组，部分数据不补造，未知版本保留 `null`。NaN/±Inf 等非有限
float 失败关闭，合法 `None` 保留 `null`。完整模型构造后整体缓冲序列化，成功响应仅带 JSON、
`no-store`、固定附件名和 `nosniff`；失败返回无成功/下载头的通用 500。

主控独立探针确认六类 Job/来源跨归属失败关闭、真实 SQL 列白名单、服务端只读事务拒写、事件与
knowledge state 同快照、后段查询失败无成功头，以及 dev Bearer 缺失/错误和首次映射用户空导出。
READ COMMITTED mutation 被真实并发后提交事件泄漏断言杀死，产品文件未变；修后非有限值探针均为
500 且无下载头。同步导出会完整缓冲在内存中，内存占用和快照持续时间随账户数据增长；本卡没有新增
阈值、分页、异步任务、UI 或真实依赖。

**历史 B1-5（当时）** 已实现本平台整账号硬删除。`DELETE /api/user/account` 仅使用 Bearer 映射的本人 ID，
先完成无业务库读取的身份验签，再取得 learning-event control gate，最后复用同一身份完成本地 User
映射/flush。服务在调用方同一事务显式删除 12 类本人数据：users、user_profiles、user_settings、
sessions、transcripts、session_contexts、analysis_jobs、pronunciation_assessments、
grammar_errors、learning_events、knowledge_states 和 call_leases；全局 skills、控制行及其他用户
数据保留。成功固定返回 `200 {"status":"deleted"}` 且只在 commit 完成后发送；异常整体 rollback，
日志和正文只保留通用错误。重复删除幂等，旧 Job、stale recovery、worker 与晚到写入不能复活数据。

删除前验证原控制数量、摘要、canonical baseline 与跨归属关系，坏数据失败关闭，不通过删除或
`SET NULL` 漂白。删除合法 baseline 后按剩余真实事件更新全局数量/摘要，保留 singleton、revision、
cutover_at、phase 和既有 gate；无 control 时用 SREX 表锁封闭 prepare 窗口，不重新从
`knowledge_states` 锚定。`claim_next_job` 本身仍无 gate，全部新旧 worker 必须保持停止到
`traffic_resumed`；部署代码、数据库锁和表锁不能证明未知旧进程已经退出。

主控当时实测 B1-5 目标为 `36 passed / 0 skip / exit 0`，完整 backend 为
`934 passed / 3 warnings / 0 skip / 81.64% / exit 0`，36 项是完整树子集，不能相加。Vitest
`1206 passed / 49 files`，Fake API `113 passed / 0 skip / exit 0`，build-script 21、API 类型 8、
iOS 脚本 Node runner 37 均 exit 0；lint 为 `132 warning / 0 error`，warning 行清单与 B1-4 逐行
相同。独立合成 PG 正常探针覆盖 12 表删除/他人逐值保留、坏 baseline、跨 user lease、双删除、
首次 cutover、真实 Bearer、未链接旧 User 和 worker 锁序；两项运行时变异被真实 count/死锁断言
杀死。临时 PG 已停止并自动移除。

第一次完整 format 按原始事实返回 exit 1，唯一问题是 `apps/vite-app/scripts/fake-api-test.mjs`；
该文件与六份收口 MD 已由现有 Prettier 纯格式化，主控仍须补跑完整 format 后以最终回执为准。
OpenAPI/TypeScript 只新增 DELETE path 和一个响应 schema，旧 path/schema 逐值未变；18 份既有迁移
字节未变，无新 DDL、依赖、产品 UI 或 workflow。主控代码/测试 Review 为 APPROVED，产品返修使用
`1/2`；用户 Review 仍待。B1-0～B1-5 已完成本地实施与完成项归档，不启动下一卡。提交/推送状态以
同卡最终交付回执为准，当前不预填 SHA；不开 PR、不合并、不部署。生产 DDL/切换/部署、真实数据、
真实不可恢复删除、真实 Provider/LiveKit/IdP/设备、原生 iOS、远端 CI、备份与法定/特殊保留均未
验收。仓库 CI 仅在 `main`/`master` push 与 PR 上触发，任务分支 push 不触发远端 CI。设计与完成记录见
[`LEARNING_EVENTS_DESIGN.md`](./LEARNING_EVENTS_DESIGN.md) 和
[`history/todo-done.md`](./history/todo-done.md)。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、生产 Compose rollout、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，
  避免运行时安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，
  并在运行 E2E 前核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- R2-12 本轮前端 lint warning/error 数量与 R2-12 小节一致，主要是 `Unexpected any`。
- 输入框与卡片边框对比度约 1.2，低于非文字组件 3.0 的要求；会话中界面的 LiveKit 控制条未在真实连接下验收。
- 历史 B1-5 的完整双浏览器 E2E 当时为
  `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败是设置抽屉三个 Provider select
  的 `336x23 < 44px`；该历史快照及当时范围外判断继续保留。后续独立 WPH 已完成修复，其历史快照
  与 R2-14 当次快照的 E2E 数量分别在各自小节集中记录，不能把这些后续结果回写成当时已通过。
- Compose 的一次性迁移、公开 system-ready 和容器依赖门控已经形成本地合同并通过原生 config、
  HTTP 探针和独立自有 PG 验证；原 Compose 整栈、镜像、真实 `.env`、生产 rollout、真实
  Provider/IdP/LiveKit 与设备未验收，不能把本地门禁写成生产就绪。
- 根目录 `README.md` 仍含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准。

## 历史与决策

| 内容                                | 位置                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| 2026 年 11 月各轮实施记录与当时基线 | [history/2026-11.md](./history/2026-11.md)                           |
| 2026 年 10 月各轮实施记录           | [history/2026-10.md](./history/2026-10.md)                           |
| 已合并与明确未采纳的方案            | [history/decisions.md](./history/decisions.md)                       |
| 已完成的待办事项                    | [history/todo-done.md](./history/todo-done.md)                       |
| 评审手册的单轮回执                  | [history/review-loop-receipts.md](./history/review-loop-receipts.md) |

历史文件只追加、不改写；其中的计数和结论只属于当时的提交。

## 文档职责与更新规则

- `README.md`：项目入口、快速启动和稳定概览。
- `docs/PROJECT_STATUS.md`（本文）：当前功能、当前验证基线和已知限制；可以覆盖更新，目标不超过 150 行。
- `docs/ARCHITECTURE.md`：运行时、数据所有权、部署拓扑与架构风险。
- `TODO.md`：唯一未完成事项清单，必须带验收条件；勾选后移入 `docs/history/todo-done.md`。
- `docs/history/`：按月的实施记录与决策流水。一轮工作结束时在当月文件**顶部**追加一节，
  写明日期、PR 或提交、行为变化、验证证据和仍未覆盖的边界。
- `docs/PHASE_*_TECH_STACK.md` 与 `docs/PHASE_*_MANUAL_TEST.md`：阶段实现细节与人工验收步骤。

以下变更必须在同一个 PR 中更新本文的"当前功能"或"当前验证基线"：

1. 新增、删除或改变用户可见功能。
2. 改变认证、密钥、数据所有权、生产配置或外部 Provider 边界。
3. 改变 CI 能证明的范围，或完成此前只能人工验证的事项。

不要把"代码存在"、"CI 通过"和"生产已验证"混为同一状态。
