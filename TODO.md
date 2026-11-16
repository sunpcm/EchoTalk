# EchoTalk TODO

> 当前唯一待办清单，只保留未完成事项。新增待办需写明验收条件；完成后勾选并移入
> [已完成事项归档](./docs/history/todo-done.md)，不在本文累积历史。各节标题沿用原分组，
> 标题中的"历史""已通过"指该轮整体状态，节内列出的是其中仍未完成的项。

> **G-CONTRACT 场景目标实施合同（当前文档卡，2026-11-16，`FINAL_READY`）：** 唯一工作树为
> `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
> `codex/B1-learning-events-20261112`，开工 HEAD
> `353e0c9f61693d0e1134843abd25da61bb7df1fa`，开工 clean。用户已确认 goal A、首批 3 课各 2 个
> goal、确定性规则加离线人工 gold/复核、四终态与 `achieved X / assessed Y / total Z` 汇总口径。
> 商务寒暄目标 2 为“向对方提出一个与其工作相关的问题”；其他 5 个目标按已确认内容保持。
> 本卡只更新 `docs/SCENARIO_GOALS_DESIGN.md`、本文件、`docs/PROJECT_STATUS.md` 与
> `docs/history/2026-11.md`；产品、测试、依赖、迁移、锁文件和其他历史文件不改，实施节点不运行
> 测试、服务或 PostgreSQL，也不执行 Git 写操作。
>
> 后续拆为 `G-CONTRACT / G-WIRE / G-EVAL / G-VIEW` 四卡。`G-CONTRACT` 已完成作者交付并停在
> `FINAL_READY`；创建会话接线、自动判定、判定结果持久化和界面展示均未实施，具体技术接线
> 由主控在后续卡决定。完整合同、逐卡最小目标与验收见
> [§10.3 G-WIRE 已核技术约束](./docs/SCENARIO_GOALS_DESIGN.md#103-g-wire-已核技术约束与计划验收) 与
> [SCENARIO_GOALS_DESIGN.md §10](./docs/SCENARIO_GOALS_DESIGN.md#10-g-contract-当前实施合同draft_ready)。
> 主控已完成本卡 12 项现有行为/工程门禁，机器 behavior 核验全 `0`；这是现有应用回归，不是
> 最终 13 项全仓 format 门禁，完整数字集中在
> [PROJECT_STATUS 的 G-CONTRACT 小节](./docs/PROJECT_STATUS.md#g-contract-场景目标实施合同final_ready)。
> 正式返修 `0/2`。技术 Review、最终全仓 format、commit/push 以主控同卡回执为准；用户 Review
> 待；本文件不自称 `APPROVED`。

> **GOAL-DATA goal A 持久化与合成 PG 数据层（历史实施卡，2026-11-16）：** 该卡只覆盖 goal A 的
> 版本化 material 目录、`material_version`、会话目标快照、默认 v1/显式 v2 导出、整账号删除配套
> 和仅使用合成目标的 synthetic PostgreSQL 数据层，后已由主控独立 Review `APPROVED` 并发布为
> `353e0c9f61693d0e1134843abd25da61bb7df1fa`。实现限定为两张不可变表、严格目标 schema/目录
> 解析、caller-owned 写原语、owner-scoped 读取、显式 v2 同 RR 只读导出与账号删除；当前创建会话
> API 仍未绑定快照，历史会话没有快照，也没有回填、恢复 UI 或 10 条生产 goals。
>
> 新 36 目标测试、正式返修 `R1/2`、12 项门禁与保护边界继续作为该卡历史快照记录在
> [PROJECT_STATUS 的 GOAL-DATA 小节](./docs/PROJECT_STATUS.md#goal-data-goal-a-持久化与合成-pg-数据层final_ready)。
> 数据层已实现不等于创建接线、判定、结果持久化或展示已完成；
> 这些后续工作以 `G-WIRE / G-EVAL / G-VIEW` 为准。
> goals 父项及其他 RF/CP 复选框不连带勾选。

> **HHTTP-CLOSE 历史宿主 HTTP 待办核销（历史卡，2026-11-16，已 `APPROVED` 并发布
> `1d75250824e9b50173ac20f0faed928240e54208`）：** 只核销两条 2026-11-04 TODO 记录。旧
> internal-only 拓扑下宿主 `18800` 不可达的失败原文保留在新月档；对应动作后来由独立
> host-gateway 合成拓扑完成。该通过只绑定旧历史拓扑，不是当前 HEAD 重跑、原 Compose、真实外链
> 或 RF/CP 父项通过。两条记录移入已完成归档后，原始未勾记录由 `58` 降到 `56`，这里的 `56`
> 是原始记录数，不是开发卡数。完整机器结果、保护边界与 PG 清理只留在
> [PROJECT_STATUS 的 HHTTP-CLOSE 历史小节](./docs/PROJECT_STATUS.md#hhttp-close-历史宿主-http-待办核销final_ready)，
> 不冒充 GOAL-DATA 当前数字。

> **I18N-DESIGN 正式 i18n 迁移设计（历史子卡，2026-11-16，已 `APPROVED` 并发布
> `4c3bd1accfa06d66b2d21b560b5db69eb4a7920b`）：** 推荐 i18next/react-i18next 渐进迁移，FormatJS
> 为标准 ICU 备选，自研 typed dictionary 只能作为改目标/延期方案，不能冒充正式框架完成。首期
> 建议仅 `zh-CN`，A/B/C、fallback 与何时进入依赖/兼容/试点仍待用户确认；依赖安装尚未授权。
> 四维度分离、Provider catalog 原值、现有中文/ARIA/日期兼容及显式插值转换与渲染回归属于固定
> 技术前置。已批准的时长方案 A 不自动授权本稿 i18n 路线；既有 R2/SGEC 等确认不受本稿变更，未
> 实施。设计见
> [I18N_MIGRATION_DESIGN.md](./docs/I18N_MIGRATION_DESIGN.md)，状态见
> [PROJECT_STATUS 的 I18N-DESIGN 小节](./docs/PROJECT_STATUS.md#i18n-design-正式-i18n-迁移设计final_ready)。
> 三项路线/范围决策仍待用户确认。

> **GOAL-DESIGN 场景 goals 与 Task Completion 设计（历史子卡，2026-11-16，已 `APPROVED` 并发布
> `3322bef719947342b3c5c805524a512aa45efb16`）：** 其中“goal 持久化 A/B/C、判定器、状态机与
> 总体完成度仍待用户确认、未实施”是历史卡时点口径。后续 GOAL-DATA 已发布 A 的数据层，
> `G-CONTRACT` 又确认 A、首批目标内容、确定性判定、四状态与无百分比汇总；创建接线、判定、结果
> 持久化和展示仍未实施。
> 设计见
> [SCENARIO_GOALS_DESIGN.md](./docs/SCENARIO_GOALS_DESIGN.md)，状态与数字见
> [PROJECT_STATUS 的 GOAL-DESIGN 小节](./docs/PROJECT_STATUS.md#goal-design-场景-goals-与-task-completion-设计final_ready)。

> **WR-DESIGN 周报剩余指标设计（历史子卡，2026-11-16，已 `APPROVED` 并发布 `929fb0ea91d2c9937c1414be192e5f5cad47d02c`）：** 把私有已内容评审的周报
> 剩余指标设计草案写回，`p_mastery` 环比 A/B/C、报告/对比窗口与 IANA 时区均待用户确认，未实施。
> 设计见 [WEEKLY_REMAINING_METRICS_DESIGN.md](./docs/WEEKLY_REMAINING_METRICS_DESIGN.md)，状态与
> 数字见 [PROJECT_STATUS 的 WR-DESIGN 小节](./docs/PROJECT_STATUS.md#wr-design-周报剩余指标设计final_ready)。
>
> **WDI 周报时长真实本地组合补验（历史子卡，2026-11-16，已 `APPROVED` 并发布
> `9d75fb0a67c835eb7b29af6f88b284a28ca9263a`）：** 唯一工作树为
> `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
> `codex/B1-learning-events-20261112`，冻结 HEAD 为
> `ad4f61e70fe471cb7ef3c8e5351fb2d0aa177410`，开工 clean。本卡只补齐浏览器 → 真实 HTTP →
> 本地 FastAPI/main lifespan/dev 认证/生产 `get_db` → 真实 SQLAlchemy/asyncpg → 自有 PostgreSQL →
> 现有 parser/controller/UI 的当前组合缺口，产品业务、既有测试、默认 Playwright/Vite 配置、旧
> bridge、迁移与依赖锁未改。本机合成链路子范围已完成，完整机器计数、保护边界、变异与资源回执
> 只集中在
> [PROJECT_STATUS 的 WDI 小节](./docs/PROJECT_STATUS.md#wdi-周报时长真实本地组合补验final_ready)；
> 验证边界见
> [CP-06 周报时长验证说明](./docs/verification/cross-platform/CP-06-WEEKLY-DURATION-LOCAL.md)。
>
> 从仓库根目录的显式入口为
> `pnpm --filter vite-app test:weekly-duration-local --retries=0 --workers=1`。运行前须自建专用
> PostgreSQL、完成迁移并注入仅指向 `127.0.0.1:55433`、`echotalk_b1_test` 数据库/用户的合成
> `DATABASE_URL`；该入口负责真实 API/Vite 与 fixture 生命周期，不负责起停 PG。正式 harness 返修
> `2/2`，产品业务返修 `0/2`，测试 oracle 修正为第 3 轮。R0 的四例 CSS 初始化失败属于测试启动
> 基础设施问题；R1 两例通过、两例仅为时间字符串 oracle 写法；R2 已实证同端口
> `TIME_WAIT` 的 `errno 48`→启用 `SO_REUSEADDR` 成功→移除后再次 `errno 48`，存活监听者仍被
> 真实 `bind` 拒绝。首轮私有 API stderr 未保留，不声称当时直接采到 errno；R0 trace 未单独复制且
> 后续 output 清理后仅保留原日志/JSON/RCA，R1 及之后各轮 trace 分别保存在独立 output 目录。
>
> 默认 E2E 与新增真实 HTTP+PG 组合分别计账，不混算；完整后端套件也不因含 PG 用例就宣称全树
> 无 mock。仅 API/Vite 自有 PID、监听资源及 WDI marker fixture rows 已回收；本批合成 PG 仍由
> 后续三张设计卡的后端验证独占保留。WDI 完成只关闭本机合成链路子项，CP-06 父项、Linux CI、
> 真实 IdP/LiveKit、设备、生产、真实学习质量与完整周报父项均不勾；后续三份设计分别为周报剩余
> 指标、goals/Task Completion 与正式 i18n，仍待逐卡写回和用户决策。代码/测试已停写；全仓最终
> format、独立 Review、正常 commit 与当前分支 push 以主控同卡回执为准。

> **TDOC 剩余待办与项目状态核对（历史文档卡，2026-11-16，FINAL_READY）：** 唯一工作树为
> `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
> `codex/B1-learning-events-20261112`，本次核对业务基线（原开工 HEAD）
> `3134a0ccb47d5c75e570117d2eb534cd265f712e`，开工 clean。本卡只核对并写回 `TODO.md` 与
> `docs/PROJECT_STATUS.md`，不实施候选功能，不修改产品、测试、迁移、依赖或其他文档。实施节点
> 不执行 Git 写操作；最终主控独立 Review 后的正常 commit/push 以主控同卡回执为准，本卡不会
> 新开 PR。实施节点只写两份文档，未运行测试、服务、数据库、CI 或依赖安装；主控按
> `AGENTS.md` 负责完整三树，只有自有 PG 用于门禁。主控最终 13 项门禁全部 `exit 0`，完整
> Vitest、双浏览器 E2E、backend、构建、Fake API、API 类型和 lint 结果及自有 PG 清理证据集中写入
> [PROJECT_STATUS 的 TDOC 小节](./docs/PROJECT_STATUS.md#tdoc-剩余待办与项目状态核对final_ready)。
> WD-DESIGN `9d3ab32`、WD-API `9179050`、WD-UI `3134a0c` 已由主控分别独立 Review `APPROVED`
> 并推送当前分支；用户 Review 仍待。`9179050` 只保留为 WD-UI 原源码父提交，本次核对业务基线
> 是 `3134a0c`。
>
> 本次核对得到 58 条未勾选的原始复选框记录：R2 为 2；候选产品 6 加 P1 的 7，合计 13；
> 历史维护待验为 9；RF 为 8；CP 及后续候选为 26。58 是原始复选框记录数，包含父项、重复的
> 外部验收要求和远期候选，不能解释为 58 张独立开发卡，也不是精确工期。本卡不改变任何复选框
> 状态，不新增复选框，也不为重复条目另造新卡。
>
> 本卡只证实本次核对业务基线 `3134a0c` 的两个远端 CI 查询结果：GitHub 对
> `/commits/3134a0ccb47d5c75e570117d2eb534cd265f712e/check-runs` 与
> `/actions/runs?head_sha=3134a0ccb47d5c75e570117d2eb534cd265f712e&per_page=100` 均返回
> `total_count=0`。该证据绑定原业务基线 `3134a0c`，不随本次文档后续提交改写；本卡不据此推断
> 其他远端状态。RF-04、CP-06 与已实现的 iOS 预下载有限重试继续保留未验证；后续触发 CI、修改
> workflow 或分支保护规则均未获本卡授权，也不以历史 `main` 运行覆盖该业务基线。下一张建议改为
> 已确认时长的浏览器→真实本地 API→合成 PG 整链路补验，先查既有覆盖与隔离启动条件，只补实际
> 断点；本卡不实施，不能提前承诺可启动，也不重复单元或既有 Fake HTTP 用例。
>
> 只读源码可见 `backend/main.py` 的 lifespan 调用 `settings.validate_runtime()`，
> `backend/config.py` 提供显式 `DEV_AUTH_TOKEN` 入口，且 `validate_runtime()` 还校验 active key
> 与 keyring 等完整安全配置。准确边界是：存在显式 dev 鉴权入口，仍须满足完整安全配置校验；
> 本卡未启动产品 API 或整链路，运行条件待下一卡实证。其他可先做的内容是 `p_mastery` 环比、
> 其他周报指标、场景 `goals[]`/Task Completion 的产品/数据设计草案，以及正式 i18n 迁移的范围、
> 语言、fallback 与依赖取舍草案；草案不等于批准业务口径，不安装库，也不进入实施。
>
> 仍需用户确认的业务口径包括指标历史快照/对比窗口/有效口径、goals 完成判据、音频采集的保留与
> 授权删除策略、macOS 方案。真实 Provider/IdP/LiveKit、设备媒体、Keychain、签名、部署与生产
> 属外部依赖组，RF-12 前置未齐；bot required-check/label 与 worktree 清理仍保留用户决定，
> 本卡均不执行。全部候选仍只是建议：本卡不启动后续候选、不触发 CI、不修改 workflow 或保护
> 规则、不开 PR，也不合并；最终格式、独立 Review、正常 commit/当前分支 push 以主控同卡回执为
> 准，用户 Review 待。本卡停在 `FINAL_READY` 并停写，不创建实施报告。

> **WD-UI 周报“已记录会话时长”前端显示与浏览器验收（历史快照，原时点 2026-11-16，FINAL_READY）：**
> 客户端 `getWeeklyProgress` 现只固定增加 `include_recorded_duration=true`，已有 parser、
> requestAbort、baseURL 与 controller 不改；服务端仍保持默认 `false` 的旧四字段/count-only
> 兼容路径。周总与选中日共用“可用 / 暂无可用 / 未知”三态：合法零和无会话显示 `0秒`，有会话但
> 全部不可计算显示“暂无可用时长”，任一桶未知或周总溢出保持未知；零个可信不可计算计数不再以
> 初值 0 冒充已知。新组件回归、Chromium/WebKit 真实 Fake HTTP、Fake bool 参数兼容和宽窄
> 截图已由主控验收。浏览器用例走真实 Fake HTTP，后端使用真实 PostgreSQL 引擎上的自建合成库；
> 两者分别实跑，不冒充浏览器直连后端合成 PG 的整链路。R1 先精确命中目标边界，修后全过；正式
> 返修 `1/2`。测试前过程纠正 `1`、TDD oracle 修正 `2`，首轮 quality `exit 2` 为 5 个不同位置的
> 诊断（3 种错误代码：3 处 TS2769，以及 TS18046、TS7022 各 1 处），两个私有边界失败及最终私有
> 变异原始记录均保留。全部门禁
> 最终 `exit 0`，详细数字、联合计数口径、保护 SHA、截图与变异只集中在
> [PROJECT_STATUS 的 WD-UI 小节](./docs/PROJECT_STATUS.md#wd-ui-周报已记录会话时长前端显示与浏览器验收final_ready)，
> 归档见[已完成事项](./docs/history/todo-done.md#2026-11-16-wd-ui-周报已记录会话时长前端显示与浏览器验收final_ready)。
> WD-API 已独立 `APPROVED` 并随 `9179050` 推送，WD-DESIGN 已独立 `APPROVED` 并随 `9d3ab32`
> 推送，两者数字只属于各自历史时点。时长三卡父项现按本范围完成核销；完整周报其他指标、CP-05、
> 三端、真实外部环境和真实学习质量均不连带核销。主控已完成本批自有 PG 的精确身份核验与清理；
> 最终格式、Review、正常 commit/当前分支 push 以主控同卡回执为准，用户 Review 待，本文件不自批
> `APPROVED`。上述原时点门禁、失败和保护事实保留；后续主控独立 Review 为 `APPROVED`，正常提交
> 并推送为 `3134a0c`，用户 Review 仍待。

> **CP04E 认证退出与活动 Room 组合补验（历史卡片，2026-11-15，FINAL_READY）：**
> 新增 `apps/vite-app/src/components/session/auth-exit.integration.test.tsx`，只以“活动会话内真实
> `beginLogout()`”和“当前认证请求经真实 `api.ts` 收到 401”两条参数化场景，补验真实
> `AuthGate → App → VoiceInterface → RoomSession/RoomContextSync`、认证状态机、用户 store、
> `roomAudio` 与默认 Web 平台适配的组合退出终态。离线 OIDC、LiveKit Room/Track、严格合成
> fetch/Response 与必要 OS 边界只作测试隔离；SDK mock 不代替产品停止 owned tracks。
> 两场景断言私有 App/Voice/Room 卸载并出现登录边界，track 从 live 到 ended 且实际调用
> `stop()`，conversation 回 dashboard/idle，sessionId/token/wsUrl 清空、代际推进、presentation
> 清空，settings/assessment seed 清除；logout 不新增业务请求，401 只新增一次请求且不重放，
> 全程无 end/token/dispatch/create、无媒体获取、无 Room 重建。
> R1 根据独立 Review 修复两处夹具：Room 改按真实挂载/卸载周期计数，并在退出前对相同树合法
> rerender 验证仍单挂载、track 仍 live；严格 fetch 在来源/认证/路由校验前记录全部尝试与拒绝，
> 最终断言拒绝为空且尝试数等于允许记录数。R0 机器检查均通过，但不能冲销这两处夹具 finding。
> R1 target `2/2` 与完整 Vitest `1270/58` 为绿，外部两探针也已正确翻转；但 quality/build/typecheck
> 因本测试 TS18047 为 `exit 2`，且同一 React 元素重复传给 `rerender` 可被 React bail out。R2
> 用稳定非空 render 结果消除空值，并以每次返回新元素的同一树工厂完成真实 rerender；准备期要求
> Render 调用数严格增加但不设固定上限，同时保持 Room 挂载 `1`、卸载 `0`、同一 Room/track 仍 live
> 且未 stop。
> 主控最终独立核验目标与 target-final 均 `2/2`，两项核心负对照均命中具体断言；最终 13 项
> 同源字节门禁全 `exit 0`，正式实施返修 `2/2`。完整机器数字、证据复用边界与 SDK/外部边界只在
> [PROJECT_STATUS 的 CP04E 小节](./docs/PROJECT_STATUS.md#cp04e-认证退出与活动-room-组合补验final_ready)。
> 代码与测试已停写；此次 next-local 新批合成 PG 已清理：`CP04E-stop-pg` `exit0`，在精确 ID、
> 双 owner、loopback 与合成库身份核验后 `stop0`、`auto_removed=true`，名称和 ID 均不存在，
> 其他资源未动；本批清理与旧批独立。CP04I 的换号/迟到响应三场景不重做，CP-04 父项继续不勾；
> Review/commit/push 见主控同卡回执，用户 Review 待，不自批。

> **CP05L Dashboard 生命周期实际组合缺口（历史卡片，2026-11-15，FINAL_READY）：** 真实
> Dashboard + 四类消费者 + 实际 `api.ts` 的 3 场景组合覆盖已完成并归档，正式实施返修
> `1/2`。两项有效私有加载期负对照命中后，恢复默认源并完成最终 13 项机器门禁；完整
> 数字、Mock/API 基址边界、负对照与外部链路边界的唯一集中说明见
> [PROJECT_STATUS 的 CP05L 小节](./docs/PROJECT_STATUS.md#cp05l-dashboard-生命周期实际组合缺口final_ready)，
> 验证口径见 [CP-05 Dashboard 生命周期验证](./docs/verification/cross-platform/CP-05-LIFECYCLE-COMBINATION.md)。
> `cp05k-cp02i-cp05l-20261115` 三卡共用合成 PG 已按精确 container ID、双 owner、
> `127.0.0.1` 与合成身份核验后 `stop_exit0`、`auto_removed=true`。测试 SHA-256 冻结为
> `4f46f3ecba0529df2fa99390989bf0fcd3504de59a6971890237f819bfa51a35`。本批三张本地范围卡
> 均已收口，用户 Review 待；CP-05 与 CP-02 父项继续保留真实验收条件，不能因本地子卡完成而
> 全勾。

> **CP02I 通话占用本地组合补验（历史快照，2026-11-15，FINAL_READY）：** 真实
> controller + `api.ts` + stdio 桥 + ASGI + 真实合成 PG 的 6 场景组合补验已通过主控最终
> 验收（13 门禁 exit0、真实 PG 6/6、707 保护文件未变），正式实施返修 `2/2`（产品未改）。
> 完整数字见 [PROJECT_STATUS 的 CP02I 小节](./docs/PROJECT_STATUS.md#cp02i-通话占用本地组合补验final_ready)；
> 独立组合为显式入口，默认 src lint/typecheck 不覆盖六例，默认 CI 也不运行；该卡专用 config
> 的 `VITE_API_URL` 未被当前 URL 模块读取，六例实走 Web 默认 `/api`，不能当作 native 显式
> 绝对 URL 证明；前卡代码无需修改。CP-02 父项保持 `[ ]`。

> **CP05K 会话界面动态桌面与键盘覆盖（历史卡片，2026-11-15，FINAL_READY）：** 5 个新增 E2E 覆盖补证已完成，正式产品返修 `0/2`。完整门禁、重复与负对照回执见 [PROJECT_STATUS 的 CP05K 小节](./docs/PROJECT_STATUS.md#cp05k-会话界面动态桌面与键盘覆盖final_ready)，归档见 [已完成事项](./docs/history/todo-done.md#2026-11-15-cp05k-会话界面动态桌面与键盘覆盖final_ready)。CP-05 桌面缩放/键盘父项保持 `[ ]`。
> 该卡当时保留的 `cp05k-cp02i-cp05l-20261115` 共用合成 PG，已在同批 CP05L 最终收口时按精确
> ID 清理；旧 CP05D 批次更早独立清理，两段回执均已完成。

> **CP05D 设置抽屉动态可见性（历史交付，2026-11-15，FINAL_READY）：** 设置抽屉已打开且输入
> 聚焦后，普通 resize、根字号 200% 后 resize、聚焦后仅改字号三种场景以当前活动元素归属、
> 单帧合并和 `nearest` 滚动保持可见。有效 RED、实现与最终门禁事实已写回
> [PROJECT_STATUS 的 CP05D 小节](./docs/PROJECT_STATUS.md#cp05d-设置抽屉动态可见性)，
> 验证口径见
> [设置抽屉动态可见性验证](./docs/verification/cross-platform/CP-05-SETTINGS-FOCUS-VIEWPORT.md)。
> 全量 E2E `262` 全部 passed；新增三场景双浏览器各重复 `20` 次、共 `120` 次补验全部 passed，
> 六组各 `20` 次，每次执行恰有一个 passed result，skip/flaky/unexpected/retry 均为 `0`、命令 `exit 0`。两份测试完整
> 行为 AST 与有效 RED 一致，E2E 与四份文档已完成 Node22 纯格式化；正式产品返修 `0/2`。
> 独立 Review、正常 commit/当前分支 push 以主控同卡最终回执为准，用户 Review 待；本文件不写
> APPROVED。所有数据库验证及 **旧 CP05D 所属批次**的自有合成 PG
> `stop_exit0`/`auto_removed=true` 核验均已完成，其他资源未动。该旧清理不代表当前
> CP05K/CP02I/CP05L 批次当时状态；该新批三卡共用 PG 后续也已按精确 ID 完成
> `stop_exit0`/`auto_removed=true`。真实 OS 键盘、非零 safe-area、设备、
> Media/Provider、IdP 与生产未验，CP-05 父项继续保留 `[ ]`。

> **R2-11 会话中界面本地子卡（历史时点，2026-11-15，当时 FINAL_READY，已归档）：** 本地模块桩子卡
> （LiveKit 主题背景、场景/墙钟页头、移动字幕优先、thinking 独立文案、单实例回答推荐）已完成并
> 归档；13 项门禁最终机器验收全部 `exit 0`，完整机器数字集中在
> [PROJECT_STATUS 的 R2-11 小节](./docs/PROJECT_STATUS.md)，归档见
> [已完成事项](./docs/history/todo-done.md)，实现边界见
> [R2-11 验证说明](./docs/verification/cross-platform/R2-11-SESSION-LAYOUT.md)。
> 独立 Review、正常 commit/当前分支 push 以主控同卡最终回执为准，用户 Review 待；
> 本文件不写 APPROVED。父项 R2-11 保持 `[ ]`：真实 LiveKit 人工媒体验收未做，不得勾选整项。
> 该历史时点，本批独占合成 PG 仍由 R2-11/CP05 等共用运行；该 **旧 CP05D 所属批次**已按回执
> 停止并确认自动移除，不涉及当前 `cp05k-cp02i-cp05l-20261115` 新批资源。

> **R2-10 硬编码文案收口（历史时点，2026-11-15，当时 FINAL_READY，已归档）：** 父项原有 14 处中文文案与
> `goalReached` 英文迁移、设置标题和活动记录去 UUID 已由既有完成回执承接；本卡补齐 10 个真实技能
> 中文标签复用与 `platform/url.ts` 20 条配置错误原文入 i18n，保持 21 处抛点和全部 URL 安全行为。
> R2 夹具修正后的最终 13 项门禁均 `exit 0`；完整机器数字、变异、AST 与保护矩阵集中在
> [PROJECT_STATUS 的 R2-10 小节](./docs/PROJECT_STATUS.md#r2-10-硬编码文案收口final_ready)，
> 父项验收、原文案迁移和 R2-UI 既有回执见
> [已完成事项](./docs/history/todo-done.md#2026-11-15-r2-10-硬编码文案收口final_ready)。
> 独立 Review、正常 commit/当前分支 push 见主控同卡回执，用户 Review 待；产品与测试已冻结。
> 该历史时点，本批独占合成 PG 仍由 R2-10/R2-11/CP05 共用运行；该 **旧 CP05D 所属批次**已按
> 回执停止并确认自动移除，不涉及当前 `cp05k-cp02i-cp05l-20261115` 新批资源。

> **SGEC-OFF 严格离线校验与合成评测（历史交付，2026-11-15，FINAL_READY，已归档）：** 纯模块
> `services/sgec_offline.py`、CLI runner `scripts/evaluate_sgec_offline.py`、固定合成
> `tests/fixtures/sgec_offline_cases.json` 与结构化单测 `tests/test_sgec_offline.py` 已完成；只做现有
> 五核心字段全批次严格结构校验、调用方合法集合与受控合成元数据，不接默认分析/API/DB/BKT/events/Provider。
> 详细数字、5 有效变异、纯模块冷进程边界、runner 真实 CLI 与边界集中在
> [PROJECT_STATUS 的 SGEC-OFF 小节](./docs/PROJECT_STATUS.md#sgec-off-严格离线校验与合成评测final_ready)。
> 独立技术 Review、最终文档 format、正常 Husky commit/当前分支 API 发布以主控同卡回执为准；
> 用户 Review 待，本文件不写 APPROVED。SGEC 总项仍 `[ ]`（真实 Provider、人工 gold 与教学质量未验）；
> SGEC-OFF 所属历史批次的独占合成 PG 已在完成后清理；R2-10/R2-11/CP05 共用的 **旧 CP05D
> 所属批次**也已停止并确认自动移除；两段旧回执都不涉及当前
> `cp05k-cp02i-cp05l-20261115` 新批资源。

> **R2-UI 设置标题与活动记录去 UUID（历史交付，2026-11-15，FINAL_READY，已归档）：** 用户已确认的方案 A
> 已实施完成：共享设置入口与 dialog 名为“设置”，活动行及结束/恢复确认面板复用既有模式与开始时间，
> 用户可见正文、`title` 和最终计算可访问名称均不暴露完整 UUID；完整 ID 只保留内部 key、稳定定位、
> API 参数和精确目标归属。本卡 13 项门禁已通过，详细历史、数字、变异、截图与边界见
> [PROJECT_STATUS 的 R2-UI 小节](./docs/PROJECT_STATUS.md#r2-ui-设置标题与活动记录去-uuidfinal_ready)。
> 独立技术 Review、最终 format、commit/push 以主控同卡回执为准；用户 Review 待，本文件不写 APPROVED。

> **R2-LIVE 活动会话生命周期实时门禁（历史交付，2026-11-15，FINAL_READY 并归档）：** 生命周期事件现从同一
> conversation store 实时读取当前启动状态，复用 `isStartingConversationSession`；本轮 GO 仅指本地实现，
> 本地实现与主控新鲜门禁已完成。完整数字、变异和边界集中在
> [PROJECT_STATUS 的 R2-LIVE 小节](./docs/PROJECT_STATUS.md#r2-live-活动会话生命周期实时门禁final_ready)，
> 归档见 [已完成事项](./docs/history/todo-done.md#2026-11-15-r2-live-活动会话生命周期实时门禁)。
> 独立技术 Review、最终文档 format、提交和推送以主控同卡回执为准；用户 Review 待。生产、真实
> Provider/IdP/LiveKit、设备与部署从未获本轮 GO 授权。R2-LIVE 完成时 R2-UI 与 SGEC-OFF 仍未实施；
> R2-UI 后续已另行完成并达到 FINAL_READY，SGEC-OFF 当时也未实施（原时点），两者后续均已分别完成。
> 本批独占合成 PG 当时尚未清理，现已于 SGEC-OFF 完成后清理。

> **A18P2 历史快照（2026-11-15，当时 FINAL_READY 并归档）：** 启动/恢复生命周期减重与实例隔离已完成；
> 移除模块级 `currentStartupTracker`、`testingLifecycleOptions` 与全局测试注入 setter，start/resume
> 复用实例内公共 `runStartupLifecycle`，新增跨实例隔离回归；R1 恢复 Web 同步 setup + 仅 native 等待
> ready、并修新 fixture 类型后，13 项门禁组合均 `exit 0`，Vitest `1216 passed / 50 files / 0 skip`，
> 三项有效私有行为变异均被对应断言杀死。这里的“最近产品”与 A18P2 当时详细数字只绑定 A18P2
> 当时快照，不表示 R2-LIVE 当前结果；当次数字、TDD/R1 历史与边界集中在 PROJECT_STATUS，归档见
> 已完成事项。A19 P2、A82C、A84C、CF20、RF04E 与 WG20 的数字、失败和 Review 状态继续绑定各自时点；
> A82 旧完整失败因果仍未证明。
> 详见
> [PROJECT_STATUS 的 A18P2 小节](./docs/PROJECT_STATUS.md#a18p2-启动恢复生命周期减重与实例隔离final_ready)与
> [已完成事项归档](./docs/history/todo-done.md#2026-11-15-a18p2-启动恢复生命周期减重与实例隔离)。
> A18P2 当时最终文档 format、独立 Review、当时任务分支提交和推送以该卡主控同卡回执为准；
> 用户 Review 待。
> 本卡不开 PR、不合并、不部署，真实设备与真实外部链路仍未验收。

> **RDOC 路线图历史快照口径修正（2026-11-15，当时 FINAL_READY 并归档）：** RDOC 当时仅修正
> `ARCHITECTURE_ROADMAP.md` §3.4 与 B1 实施顺序中的历史时点、当时的验证索引和旧暂停边界；
> R2-14 的 `941 / 81.57% / 246` 等数字、B1/WPH 失败与证据、路线图架构和产品范围均保持原样。
> RDOC 当时把实现/验证索引统一指向
> [PROJECT_STATUS 的当前验证基线](./docs/PROJECT_STATUS.md#当前验证基线)；RDOC 之后的下一卡以用户
> 最新授权和本文件当前未完成事项为准。RDOC 当时完整机器门禁数字、技术 Review、最终 format、
> 当时任务分支提交发布与用户 Review 状态见
> [PROJECT_STATUS 的 RDOC 小节](./docs/PROJECT_STATUS.md#rdoc-路线图历史快照口径修正final_ready)；
> 本文不复制细数字。归档见
> [已完成事项](./docs/history/todo-done.md#2026-11-15-rdoc-路线图历史快照口径修正)。

## 2026-11-10 云端评审后续（R2）

来源：[2026-11 云端评审](./docs/reviews/2026-11-cloud-review.md) §3。R2-01～R2-08 已完成，
证据见该报告 §3.1～§3.4；以下为剩余项，括号内编号对应报告中的发现。

- [ ] **R2-09 平台接缝：认证会话、安全存储、麦克风权限**（2026-11-10 已删除 `utils/env.ts`；三个平台接口与能力标志待 CP-03/CP-04 设备证据后与原生实现同轮完成）（P-1，P1）：在 `src/platform/` 增加三个接口及
      Web 实现，`lib/auth.ts` 改为经接口装配；把 `RoomSession.tsx:50` 与 `store/conversation.ts:69` 的
      平台名判断改为读取适配器能力；删除 `src/utils/env.ts`。验收：`auth.test.ts`、`VoiceInterface.test.tsx`
      零改动通过；`src/` 中 `platform/` 之外不再出现 `=== "ios"` 这类平台名比较；不新增依赖。
      原生实现不在本项范围。
- [x] **R2-10 硬编码文案收口（FINAL_READY，已归档）**：父项原有中文字面量与
      `goalReached` 迁移、设置标题、活动记录去 UUID 和扫描验收完整保留；R2-UI 的标题/UUID 回执
      继续作为父项既有证据。本卡补齐 10 个真实技能中文标签与 URL 配置错误入 i18n，并通过最终
      13 门禁。详见
      [PROJECT_STATUS](./docs/PROJECT_STATUS.md#r2-10-硬编码文案收口final_ready)与
      [已完成事项](./docs/history/todo-done.md#2026-11-15-r2-10-硬编码文案收口final_ready)。
- [ ] **R2-11 会话中界面**（U-3，P1；真实媒体验收受外部条件阻断）：本地模块桩子卡（LiveKit 容器
      背景主题色、场景名与墙钟计时页头、手机字幕优先、`thinking` 独立文案、单实例回答推荐）已
      完成并归档，见
      [已完成事项](./docs/history/todo-done.md#2026-11-15-r2-11-会话中界面本地子卡final_ready)。剩余验收：
      真实 LiveKit 下的人工媒体验收单列，未做不得勾选整项。
- [x] **R2-12 macOS 构建产物与同步脚本**（纯脚本实施/本地验收完成；用户 Review 待）：
      `build.mjs --platform macos` 产出 `dist/macos/<mode>` 与 manifest；`sync-macos.mjs` 在调用
      外部工具前校验来源产物和 mode；新增 Turbo 任务将 `ANALYZE` 纳入缓存输入。正式客户端、壳与
      Tauri 选型仍未创建或确认。详细门禁和边界见
      [PROJECT_STATUS 的 R2-12 小节](./docs/PROJECT_STATUS.md)。
- [x] **R2-13 组件目录按页面边界归位**（纯目录归位与 `Dashboard` 抽取完成；独立代码 Review 为
      APPROVED，用户 Review 待）：抽出 `Dashboard`，按 §2.4 P-3 的目标结构 `git mv` 38 个文件，
      其中 29 个内容不变、9 个仅改模块路径或目录注释，12 个测试文件移动；三测试树计数不变。
      详细门禁和边界见 [PROJECT_STATUS 的 R2-13 小节](./docs/PROJECT_STATUS.md)。
- [x] **R2-14 Compose 就绪与迁移编排**（A-1 的 P1-3、P1-5，P2）：本文记录的本地合成实施、完整
      门禁与独立代码 Review 已完成；该勾选仅表示本地合成实施/验证完成，用户 Review 待。新增不依赖
      用户身份的公开
      `GET /api/health/system-ready`，只用共享 PostgreSQL 执行 `SELECT 1`；成功为 typed `200`，
      连接/查询/释放失败为通用 typed `503`，0.5 秒数据库操作预算为 asyncpg 约 2 秒 graceful
      close 留余量，并在连接完整释放后才响应。Compose 新增使用 API 角色和同一
      `DATABASE_URL` 的一次性 `echotalk-migrate`，`restart: "no"` 且依赖 PostgreSQL
      `service_healthy`；API、Agent、analysis-worker 等待迁移
      `service_completed_successfully`，Web 等待 API `service_healthy`。API 探针使用仓库镜像已有
      Python 标准库和 `ProxyHandler({})` 显式绕过环境代理，HTTP timeout `4`、容器 timeout `5s`。
      旧 `/api/health/ready` 的认证、用户配置判断和 OpenAPI 语义保持不变。完整合同见
      [Compose 启动与系统就绪合同](./docs/COMPOSE_STARTUP_CONTRACT.md)。
      当次快照的完整 13 项门禁及聚合 `exit 0`；backend
      `941 passed / 3 warnings / 0 skip / 81.57% raw Total coverage`，Vitest
      `1206 passed / 49 files`，Fake API `116 passed / 0 skip`，双浏览器
      `246 passed / 0 failed / 0 skip / 0 retry / exit 0`，build-script `21`、API 类型 runner `8`、
      非 native iOS 脚本 runner `37` 均 `exit 0`，lint 为 `132 warning / 0 error` 且诊断与父基线
      相同。Compose 原生 `config` 和迁移依赖图 `exit 0`，但未解析 `env_file`、镜像或启动原整栈；
      健康探针的 ready/unready/wrong-body/timeout/HTTP proxy trap 五类实际命令均符合预期，代理
      请求为 0。R0 真实自有 PG pause 在 4.5s 外层请求超时且未返回 `503`，是有效产品失败证据；
      R1 新增的约 2s-cleanup 模拟用例在 3.5s 硬期限命中，是模拟回归 RED；R1 真实自有 PG pause
      得到 `503 / 2.518465s / checkedout 0`，unpause 后为 `200`，用户数不变；完整连接释放后再
      注入异常也为 `503`。缺 route 的初始 backend `6 failed / 0 skip / exit 1` 是功能实施前的
      有效 TDD RED（当时新功能尚未实现，尚未进入真实 PG 故障验证）；`ModuleNotFound` 导入错误、
      延迟 `IncludedRouter` 的 route 枚举及 format 问题属于夹具/格式。18 份旧迁移 SHA 不变，本卡
      新增 migration 为 0。最终 Review/发布见主控同卡回执；整栈启动、生产切换与真实外部依赖仍未
      验收。

## 2026-11-06 候选任务（无 Provider Key 前提，未开工）

来源：#120、#123、#126、#127，以及本地 Issue 评估与 2026-11-07 只读核实（均不纳入 Git）。
已定：继续使用 LiveKit（主要用户不在中国大陆），只做安全升级、RF-12 后的 1.8.x 评估和
学习者 turn-taking；不迁移框架、不做 S2S。

**无需 Key，可直接开发：**

- [x] **RF-04 远端证据核对**：`42c61bb`、`6bda2cd`、`ef6cb53` 的历史 main push 与
      `5c28e1b` 的失败传播已只读核对，完整矩阵见
      [CI 质量门禁验证](./docs/verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。本勾选只关闭
      本次证据文档子卡；RF-04 总项、iOS 有限重试、required check、真实链路和本轮核对时的起始树
      `4ec1a4d` 的 CI 仍未勾选。
- [ ] **周报剩余指标**：会话次数、语法 Top3 与“已记录会话时长”均已完成（见 P1）；时长仍只表示
      会话经过时长，不等于有效说话或成功练习。`p_mastery` 环比缺历史数据，需单独设计快照/事件，
      C-1 也补不出历史；发音准确率、焦虑指数、语速与学习重点等其他指标仍待完成。

**被 Key 或外部条件阻断：**

- [ ] 语法 LLM SGEC（方案 C-2；推荐 A/严格离线边界已确认；SGEC-OFF 子卡 FINAL_READY 已归档）：SGEC-OFF
      子卡已实现纯离线全批次严格结构校验、调用方合法 `skill_tag` 集合、固定合成 fixtures 与本地 CLI
      runner 并完成主控验收；详细数字、5 变异与边界见
      [PROJECT_STATUS 的 SGEC-OFF 小节](./docs/PROJECT_STATUS.md#sgec-off-严格离线校验与合成评测final_ready)。
      解释/建议只作离线材料，不新增 DB/API 字段，不接默认分析、BKT、learning
      events、Provider 或自动重试。结构通过不称准确率；SGEC 总项（真实 Provider、人工 gold 与教学
      质量）仍未验，保持未勾。合同见
      [SGEC_OFFLINE_CONTRACT](./docs/SGEC_OFFLINE_CONTRACT.md)。
- [ ] 场景 `goals[]` + Task Completion（方案 D-1，#115）：业务合同已确认 A，GOAL-DATA 的
      持久化/privacy 数据层已 `APPROVED` 并发布 `353e0c9`。后续拆为 G-CONTRACT / G-WIRE /
      G-EVAL / G-VIEW；G-WIRE 已核的旧请求/幂等兼容、服务端 binding 校验、只有
      `mode=scenario` 才提交冻结引用、User→Session 锁序和真实 PostgreSQL 实例（仅合成库/合成
      数据）并发/回滚/跨账号验收都已列为计划，但创建接线、判定结果
      持久化、四状态/汇总展示尚未实施。逐卡验收见
      [SCENARIO_GOALS_DESIGN.md §10](./docs/SCENARIO_GOALS_DESIGN.md#10-g-contract-当前实施合同draft_ready)。
- [ ] 发音真实评估：先单独设计会话音频切片采集（存储、保留期、授权、删除）。
- [ ] 部署侧日志 Key 排查与轮换、#102 部署证据：需部署环境访问。
- [ ] 1.8.x / Turn Detector / `language_hint`（#30、#116、#127）：等 RF-12 前置完成。

## 2026-11-07 历史发现与当前待验项

来源：#128 评审与本地重跑。以下问题均为 #119 原有代码问题，恢复时未改动。

- [x] **WebKit 周语法补验达标；旧根因仍未证实**：2026-11-07 无重试单独跑 5 次失败 1 次及 CI
      `retries: 2` 的历史事实保留；“认证刷新耗掉唯一一次 503”仍是未经证明的旧假说。
      当前失败夹具在失败阶段持续返回 503 直到测试显式放行，不能据此反推历史唯一一次 503。
      当前 HEAD 在 macOS WebKit + Fake API 下满足零重试重复补验门槛，未放宽断言或增加重试；结果
      只证明当前 HEAD/夹具稳定性，不代表真实链路；完整数字、证据与边界见
      [PROJECT_STATUS 的 WG20 小节](./docs/PROJECT_STATUS.md)。
- [ ] **iOS CI 预下载有限重试**：`5c28e1b` 的 `test-ios-build` 因 GitHub 资产单次 504 且
      `--retry 0` 失败；已改为 curl 原生有限重试（3 次、`--retry-max-time 240`），校验不变。
      验收：分支 CI 的 `test-ios-build` 通过后勾选。
- [ ] **防止 bot 推送导致误合并**（2026-11-09 已加 `.github/workflows/pr-guard.yml`：删除 ≥1000 且 >5× 新增时失败，
      `allow-mass-deletion` label 放行；剩余：用户在仓库创建该 label 并把 `mass-deletion-guard` 设为 required check）：#118 合并前 google-labs-jules[bot] 在更新分支后推送
      删除 1.3 万行的提交，squash 后回退了 #119（#128 恢复）。验收：二选一或组合——
      限制 bot 推送他人 PR 分支，或加大规模删除的 CI 告警；合并前人工核对 head SHA 与 diff 规模。
- [ ] **本地 worktree 清理**：`.review/worktrees/` 下 17 个 worktree（含无新提交的
      `restore-backend`/`restore-delivery`/`restore-ui`）待用户决定是否清理，清理前核对各分支是否已合并。

## 2026-11-04 补充轮：WebKit 首导航与 Worker 停机

Worker 运行时与 UI 三文件范围独立 Review 均 APPROVED，已机械集成。以下为本次文档
收口前已落地的真实回执；本次两文档仍待主控原生格式、机械复制、最后格式/代码 hash
保全与整体 Review，最新结论见[补充轮总报告](.review/reports/overnight-followup-20261104/report.md)
及[进度回执](.review/reports/overnight-followup-20261104/progress.json)。
以下证据路径相对 `.review/reports/overnight-followup-20261104/`。

- [ ] 真实 Provider/IdP/LiveKit、语音、设备、签名、本轮原生 App 编译与远端 CI 仍待；
      原 Compose 整栈未启动，显式预置过期任务恢复不代表任意真实崩溃恢复。
      RF-04/05/07/08/09/12 等外部边界保留，next2 未融合；停在 Review，未 commit/push/部署或发布。

## 2026-11-04 七天概览与隔离运行时收口（上一轮历史）

以下保留上一轮32路径任务的验收数字与失败记录；后续修复及当前边界以上方补充轮为准。

Dashboard 已实现含今天的最近七个本地自然日已完成会话分布，单次认证聚合返回七桶，
选择日期后显式分页查看只读历史；保留今日进度，支持空态、加载、失败重试与日期/时区、
身份 revision、前后台及离线请求隔离，不新增评分、时长或掌握度趋势。

本节是文档停写时的分项快照；最终格式、组合与总 Review 状态以主控持续更新的
[本轮总报告](.review/reports/overnight-product-runtime-20261103/report.md)和
[进度回执](.review/reports/overnight-product-runtime-20261103/progress.json)为最新权威。
以下证据路径相对本轮 `.review/reports/overnight-product-runtime-20261103/`。

- [ ] 真实 Provider/IdP/LiveKit、语音、设备、签名、本轮 native 编译与远端 CI 继续未验；
      原 Compose 整栈未启动，未发布。RF-04/05/07/08/09/12 等大项外部边界不因此勾选。

本轮所有 owner 停在 Review，无 commit/push/merge/部署；未融合 next2 草稿。

## 2026-11-03 无 Key 工作与当时验收边界（历史）

主控当日实时核验 [PR #117](https://github.com/sunpcm/EchoTalk/pull/117) 已合并，
远端 main 为 `b3493a3a40c5c6743c9c3df609790368b2b76435`，已包含练习前置检查与
macOS 探针 CI；该 PR 及对应 main 运行此前均已全绿。下方具名轮次的计数和失败历史保留，
不再将它们当时的未 push/未 CI 状态视为当前远端状态。

本次验证记录（2026-11-03）：`checks/combined-r1` 的 frontend10/backend5 全部通过：
1034 Vitest/39 files、21 build-script、61 Fake API、8 types、166 双浏览器、
644 pytest/3 warnings/78.61%（59% 门禁）；补充验证及未发布边界见状态页。

- [ ] Key 准备后再验真实 IdP/Provider/LiveKit、5 分钟 5 轮语音、WKWebView/TCC、
      设备、签名与部署；这些边界本批全部未验，RF-05/07/09/12 等整项继续未勾选。

正式交付与最终 head CI 状态以 PR #119 和主控报告为准。

next2 草稿未融合；下一阶段优先继续无 Key 可做且有价值的工作，本轮不扩大实现范围。
C 四阶段验收与 Web 三构建已结束，主控按归属核验后已清理本批专用 PG/内部网络，cp00
未动；镜像、快照和证据保留。B 六文件已组合进 A，文档停写不等待远端或后续测试。

## 2026-11-02 练习前置检查与探针 CI（最终组合检查通过）

2026-11-03，主控完成最终组合 21 项检查，全部 passed/exit0。readiness 保持配置检查
不解密、不拨测，失败停止下游会话与采音；显式重新检查成功只提示重新选择练习，
不重放旧场景、文档或恢复意图，保留安全兜底及既有 Token、认证、Cloud 协议。

- [ ] 真实外部验收：Provider/LiveKit/IdP、设备、TCC/媒体仍需相应证据；本批新增的
      Linux/Docker 无 Key 验收范围见上方摘要，不替代真实服务或原 Compose 整栈。

最终组合证据：主 checkout 的
`.review/reports/practice-readiness-20261102/checks/combined-final-r0/summary.json`。
详见[练习前置检查验证](./docs/verification/cross-platform/PRACTICE-READINESS.md)及
[探针 CI 验证](./docs/verification/cross-platform/MACOS-PROBE-CI.md)。
首次失败及修复证据保留在本地评审报告。

该轮已通过 PR #117 合入 main，历史本地 21 项计数不变；本次无 Key 增量仍待组合验收与
独立 Review，不据此宣称已合并或发布。未部署，未融合 next2 候选。

## MVP 产品化修复（RF-01～RF-12）

> 权威边界与验收细则见
> [MVP 技术债修复与重构方案](./docs/MVP_REFACTORING_REMEDIATION_PLAN.md)。
> 执行顺序固定为“可靠性修复 → 架构减法 → 内部重构 → 受控升级”；只有对应自动化、
> 迁移、运行时和外部边界证据齐全后才能勾选。

### 执行基线

- 历史远端快照：主控 2026-11-03 核验的 `main@b3493a3`（PR #117 已合并），
  本轮未刷新远端；夜间任务的组合分项与剩余门禁见顶部 2026-11-04 摘要。
- 历史具名已验收维护基线：
  `main@fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d`（A83）。A84 b/r0 的正式本地
  receipt 记录 A83 已 Review APPROVED，并以正常 hook 单提交、main 精确 fast-forward
  和完整 15 项门禁核销；门禁计数为 972 Vitest/36 files、18 build-script、61 Fake API、
  8 类型生成器、148 E2E、598 backend/78.14% coverage，以及 schema/Ruff 等相关检查。
  历史基线与计数保留如下：A77 完成 967 Vitest/576 backend 本地集成；A78 为 969
  Vitest/34 files、586 backend/76.98%；A80 为 972 Vitest/36 files、586 backend/76.98%；
  A81 为 972 Vitest/36 files、594 backend/78.10%；A82 为 594 backend/78.10%。A83
  具名基线相对本地 tracking reference
  `c704925bc9150d153fc951c2727e7472dad00d78` 领先 19 个提交；该计数与上述
  receipt 绑定，不表示未来 lane HEAD 或远端当前状态。
- 基线：`origin/main@30f51f3175de20bc827ebdf29789ad934096133d`
- 分支：`codex/mvp-remediation`
- Worktree：
  `/Users/sunpcm/Documents/Codex/2026-09-08/new-chat/work/EchoTalk-mvp-remediation`
- 初始前端基线：冻结锁安装成功；格式检查失败；Lint/Typecheck 通过但复用了旧 worktree
  Turbo 缓存；Vitest 71 项通过但包含 6 个 “no tests” 伪任务；Playwright 仅有 1 个
  `expect(true)` 占位测试。
- 初始后端基线：Pytest 113 项通过并有 8 个 warning；Black 有 9 个文件待格式化；
  Flake8 报告 38 项；当前依赖未锁定且一次安装解析出 176 个包。
- 初始运行时基线：`docker compose config --quiet` 因干净检出缺少强制 `.env`
  失败；尚无 PostgreSQL 空库迁移门禁。

### Phase 0：可信质量基线

- [ ] **RF-04 CI 真实性**：真实 Web + Fake API E2E 覆盖健康检查、创建/结束会话、
      分析成功、分析失败与失败后退出；统一 Ruff；PostgreSQL 空库迁移与合理覆盖率进入
      CI；聚合 `CI` 仅在必要任务全部成功后通过。当前本地配置已将 `test-frontend` 对齐
      10 项真实质量门禁，并在 backend job 增加 tracked OpenAPI schema 漂移检查。A64 的
      PR #109 已有真实远端 Linux 证据：精确 head
      `b7585d140ecc6ad4f45580fabe71e32c9c51466b`、merge
      `c704925bc9150d153fc951c2727e7472dad00d78` 的 run 41220439360 中，
      `test-frontend`、`test-backend` 与聚合 `CI` 三 job 均 success，前端旧 8 项门禁为
      854 Vitest/18 build-script/61 Fake API/Chromium+WebKit 148，后端为空库迁移至
      `c06_transcript_events` 后 529 passed、82.49%；见
      [CI 质量门禁验证](./docs/verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。
      上述 A64 旧运行不包含 A67 新增的两层门禁；2026-11-03 主控已确认 PR #117 及其
      main 运行全绿。B r1 runner 修复已通过本地四项检查；PR #119 仍为验证 draft，
      其远端新结果、原生 iOS CI 与本批组合验收待收口，RF-04 整项继续保持未勾选。

### Phase 1：分析可靠性

本节事项已全部完成，见[已完成事项归档](./docs/history/todo-done.md)。

### Phase 2：模拟结果隔离

本节事项已全部完成，见[已完成事项归档](./docs/history/todo-done.md)。

### Phase 3：鉴权与密钥生命周期

本节事项已全部完成，见[已完成事项归档](./docs/history/todo-done.md)。

### Phase 4：架构减法

- [ ] **RF-05 精简基础设施**：确认调用证据后删除无价值的 Redis/Celery/周报骨架和
      Chroma/重型 ML 依赖；确定性课程推荐保持业务用例，并记录镜像体积与冷启动对比。
      A71 b/r0 已定向确认生产分析链使用 PostgreSQL Job：删除 Celery/Redis 直接依赖、
      配置、Compose 服务/卷与无调用周报骨架，保留 `analysis_worker` 和 Chroma 课程推荐；
      主 Agent 已在实施停写后按 uv 0.9.18 离线配方原生重生成 `uv.lock`（192→179 包）并
      重新导出 `requirements.txt`：删除 amqp/billiard/celery/click-didyoumean/
      click-plugins/click-repl/kombu/prompt-toolkit/redis/tzdata/tzlocal/vine/wcwidth
      13 包，存活包版本逐值相同，LiveKit 7 个 exact SDK 保持。指定 dev/runtime 环境冻结同步
      为 159/152 包（原 172/165）；A71 已由独立 Review APPROVED 并以 `dd0fbc0` 完成本地精确
      集成与全绿复验。
      A72 r0 已把 10 条种子迁入版本化 JSON，完成严格目录校验、CEFR/技能/priority 确定性检索、
      Compose/Chroma 引用清理、五个无消费者重依赖的声明删除，以及离线校验工具和真实课程路由
      回归。主 Agent 已用 uv 0.9.18 离线原生生成 lock/export 并完成 frozen sync：lock
      179→107、删除 72 条跨平台记录，本机 dev/runtime 安装包 159→106、152→99；全部存活
      package 记录逐值相同，7 个 LiveKit exact SDK 保持。完整后端首次运行 565 passed/1 failed，
      失败已定位为测试期望漏掉 restaurant 的次级 tag；A72 r1 已修正该 expected，并把空白包裹
      等级 `' B2 '` 收窄回原规则的 B1 回退。A72 已由独立 Review APPROVED，定格为单提交
      `b2b02b3bf647676e903b3d9b837e2be4b1133b90` 并精确 fast-forward 本地 main；main 复验为
      566 backend passed、80.10% coverage。首轮 565 passed/1 failed 保留为历史事实；镜像/CI
      体积与部署冷启动对比仍未完成，故整项保持未勾选。
      2026-11-03 已补 API/Agent Linux arm64 角色镜像运行证据，当前体积约 1.545/1.936 GB；
      缺少旧版同环境 before，仍不报告优化比例或冷启动收益，也不等于原 Compose 整栈通过。
- [ ] **RF-06 清理前端模板**：引用审计后删除无调用者的 Webpack、UI 模板、Changesets、
      Plop 和一次性脚本；根包元数据、workspace、Turbo、Docker 和 Capacitor 保持一致。
      A73 b/r0 已按全部 tracked 引用审计删除 Webpack/UI 模板、Changesets、Plop 等 31 个
      tracked 文件，并将 4 份品牌 SVG 逐字节迁入 `docs/assets/branding/`；根脚本/依赖、
      Vite 消费者声明、workspace/Turbo 残留和共享配置占位 test 已同步收敛。A73 已定格为
      单提交 `5291207fcaf27025d0b7fae5782d439efc7f6654` 并精确 fast-forward 本地 main；
      Node 锁原生重生成与 offline frozen install 后，A73 lane 独立验证 root 强制 test 仅
      运行 Vite 的 917 项真实用例；main 最终复验完整前端 10 项门禁（917 Vitest、
      18 build-script、61 Fake API、8 类型生成器、148 E2E）、schema、Ruff 和 566 backend
      （80.10%），不包含上述 root test 复跑。合成 OIDC 下 Web/iOS production-mode 构建与
      真实 Capacitor 资源同步在 lane 通过，未据此冒认 main 重跑、真实登录、原生编译或设备
      链路。A73 当时未验的 Docker/CI 边界已有本批增量；Web production guard 的真实
      三构建复验已通过，本批组合与发布边界仍待完成，RF-06 整项保持未勾选。A47
      根元数据与诊断脚本历史证据见
      [RF-06 根清理记录](./docs/verification/cross-platform/RF-06-ROOT-CLEANUP.md)。

### Phase 5：依赖、迁移和运行时统一

- [ ] **RF-07 可复现依赖**：后端成为真实 uv 项目并提交完整 `uv.lock`；API、Agent、
      Dev 依赖分组；CI/Docker frozen 安装；Python 3.12、Node 22 与固定 pnpm 版本统一。
      A36/A37 历史上已完成后端 Python 3.12 标准 uv 项目化（`echotalk-backend`，
      `.python-version` 3.12），当时生成并本地集成 192 包 `uv.lock`，严格保留 172 项
      baseline 版本及 LiveKit 7 项 exact SDK 版本；
      A37 完成依赖分组裁定落地（先拆 Dev 四项，运行时保持共用）：26 项保留默认 runtime，`ruff`、`pytest`、`pytest-asyncio`、`pytest-cov` 迁入 `[dependency-groups].dev`；
      `requirements.txt` 作为锁导出的单一 runtime-only 兼容入口（A37 当时跨平台导出 184 条，本机安装 165 包，排除四项开发工具）；
      CI 安装显式指定 `--group dev`，Docker 配方统一补 `--no-dev`，保持环境与生产镜像最小化；
      A37 当时全新隔离环境 `.review/rf07-a37-dev-venv` (172包) 与
      `.review/rf07-a37-runtime-venv` (165包，0 dev工具) 经受控离线护栏工具核验通过；
      旧 `backend/.venv` 及 A36 `.review/rf07-venv` 保持只读；
      A72 已把离线 lock 收敛至 107 个包，本机 dev/runtime 安装为 106/99，7 个 LiveKit exact
      SDK 保持；A74 r0 将 Web builder 统一为 Node 22，并由根 `packageManager` 通过 Corepack
      选择 pnpm 10.26.0，移除未固定的全局 npm 安装；仓根新增 Web build-context 允许列表，
      排除本地 dotenv、`.review/`、Git/Agent 元数据、缓存和 iOS 原生资源。A79 进一步完成
      API/Agent 运行角色分组：project common 仅保留共用运行时依赖，`api` 组承载
      FastAPI/uvicorn/Alembic/python-jose，`agent` 组承载 LiveKit RTC/Agents 与四个现有
      插件，`dev` 组保持四项工具；默认组合并 `api/agent/dev`。主 Agent 已用 uv 0.9.18
      离线原生重生成 lock/export，全部存活锁记录与全局 metadata 保持不变，只删除
      `passlib 1.7.4`/`bcrypt 5.0.0`，七个 LiveKit exact pins 不变；受控角色验证为 dev
      104、API 55、Agent 83，最终恢复 merged runtime 97。后端 Dockerfile 使用受控
      `BACKEND_ROLE=api|agent` 并排除 dev，Compose 将 API/analysis-worker 绑定 `api`、
      语音 Agent 绑定 `agent`。A79 已获独立 Review APPROVED，以单提交
      `eaac89d0f4f008e77ba51b26a590412a03541acb` 精确 fast-forward 本地 main 并通过完整
      15 项 main 门禁。2026-11-03 C 线真实 Linux arm64 API/Agent 角色镜像、frozen export
      与无 Key 运行边界已通过，PR #117 及对应 main CI 此前已绿，Web guard 三构建复验
      也已通过；原 Compose 整栈、真实 Provider/LiveKit/设备、部署与最终组合仍待完成，
      RF-07 整项保持未勾选，契约见
      [RF-07 运行角色依赖与容器配方](./docs/verification/cross-platform/RF-07-RUNTIME-ROLES.md)。
- [ ] **RF-08 迁移与时间语义**：移除 lifespan Mock 播种；参考数据显式且幂等；
      timezone-aware UTC、必要索引和有界分页完成；空库及现有数据库副本迁移均通过。
      本地已完成启动播种子项显式幂等化（A38）：lifespan 仅保留安全配置验证并移除隐式写库播种；
      新增 `seed_reference_data.py` 显式播种模块与 CLI 入口，严格复用 `models.knowledge.SEED_SKILLS`（10 项），
      使用 PostgreSQL 原生 `INSERT ... ON CONFLICT DO NOTHING` 保持已有记录不变；强制校验显式 `DATABASE_URL`，
      禁止回退 `.env`，模块导入及 `--help` 零 DB 访问，错误路径严格脱敏；回归测试在隔离 test schema 下验证并发与幂等；
      上线前运维需显式执行播种命令（见 [RF-08 启动参考数据显式幂等化验证](./docs/verification/cross-platform/RF-08-REFERENCE-SEED.md)）；
      本地已完成时间列 timezone-aware UTC 语义统一（A39）：ORM 模型七列（users.created_at、sessions.started_at/ended_at、user_settings.updated_at、knowledge_states.updated_at、pronunciation_assessments.created_at、grammar_errors.created_at）显式声明 DateTime(timezone=True)，保留既有 nullable 属性；新建纯 stdlib time_utils.utc_now 并替换全量 datetime.utcnow()；schemas/time.py 声明 UtcDatetime 拒绝 naive 输入并将偏移归一至 UTC，响应 JSON 显式时区；c04_utc_timestamps 迁移脚本经 Codex 独立审查通过（SHA256: 3cb19d3f39c166f7e5e93587779d99240a8e2ac90cdbc1edf4c476d80425f612）且在专用测试库合成副本完成演练；新增 test_utc_timestamps.py 覆盖元数据、归一化、PG 真实读写与写入路径，既有测试消除弃用警告（见 [RF-08 七列 UTC 时间语义验证](./docs/verification/cross-platform/RF-08-UTC-TIMESTAMPS.md)）；
      本地已完成必要查询索引方案与迁移声明（A40）：新增三项非唯一 B-tree 索引（sessions(user_id, started_at DESC, id DESC) 名 ix_sessions_user_started_id、transcripts(session_id, timestamp_ms) 名 ix_transcripts_session_timestamp、grammar_errors(session_id, created_at) 名 ix_grammar_errors_session_created）；模型元数据与 Alembic c05_query_indexes 脚本对齐，降级严格逆序 drop；复用 assessment(session_id) 与 knowledge(user_id, skill_id) 已有唯一约束/索引避免冗余；保留 grammar_errors 既有 partial 索引；新迁移经 Codex 独立静态审查，专用测试库空副本与 25 万行合成副本 upgrade/downgrade/re-upgrade 通过，自然 EXPLAIN 均使用目标新索引（不代表真实环境性能验收）（见 [RF-08 三项必要查询索引验证](./docs/verification/cross-platform/RF-08-QUERY-INDEXES.md)）；
      本地已完成会话游标分页与每日聚合方案（A41）：`GET /api/sessions` 与 `GET /api/sessions/active` 升级为 `{ items, next_cursor }`，严格仅读取 5 个必要列，彻底杜绝 ORM selectin 级联查询与正文加载；游标采用标准库 canonical URL-safe base64、严格整型版本与端点/用户/窗口上下文严格比对校验，每页数据库查询始终强制 `user_id == current_user.id` 过滤（自包含无状态校验，非 HMAC 签名凭证，不提供抗恶意改写完整性保证，格式或上下文不符返回 422）；新增 `GET /api/sessions/daily-progress` 单 SQL 服务端聚合；前端 `DailyProgress` 并行双只读请求与自然日 DST 兼容时间窗，跨午夜清空旧数据与生命周期挂起作废在途；`ActiveSessions` 仅显式点击加载更多，结束/恢复操作与加载更多互锁，生命周期挂起作废在途；Fake API 与 E2E 测试严格对齐后端契约与边界校验（见 [RF-08 会话游标分页与每日聚合验证](./docs/verification/cross-platform/RF-08-PAGINATION-DAILY-PROGRESS.md)）；
      2026-11-04 已完成七天已完成会话聚合与按日只读分页的前后端闭环，保留旧 48 小时
      窗口、completed 与半开 started_at 口径；组件/双浏览器及最终镜像真实 HTTP 分项已验，
      最终格式与总 Review 以顶部主控回执为准。有界分页已完成本地代码与测试闭环，
      真实环境性能与生产迁移待后续完成，整项保持未勾选。

### Phase 6：内部边界

- [ ] **RF-09 LiveKit Agent 拆分**：Orchestrator、CredentialResolver、ProviderRegistry、
      TranscriptSink 和 ErrorMapper 边界落地；无 `sys.path` 注入、导入时 dotenv、敏感
      环境变量临时删除或 SDK 私有属性访问；后台写入可排空、可观测、可重试。
      本地已完成 Agent 安全错误映射与出口边界落地（A42）：建立单一安全边界 `AgentErrorMapper`，
      固化 9 项错误码全集与静态安全本地化文本映射，阻断异常正文、密钥与 URL 向客户端回显；
      运行时错误严格分类（401/403 映射为 ERR_CUSTOM_RUNTIME_AUTH，不可恢复错误映射为 ERR_CUSTOM_RUNTIME，
      可恢复与基础轨交 SDK 原生处理）；最终发送入口接入安全 mapper，publish 异常脱敏且保持断连；
      清理入口日志中私有 `ctx._info.url` 读取与 raw identity 输出；离线 Mock 与 Canary 审查回归通过；
      本地已完成转录事件稳定标识与数据库幂等落地（A43）：基于 c06_transcript_events 迁移建立 (session_id, event_id) 复合唯一约束（普通 NULL 语义保留历史兼容，禁止 NULLS NOT DISTINCT）；ORM 模型声明 event_id 与同名约束；save_transcript 支持原子幂等 INSERT ON CONFLICT DO NOTHING，首写 metadata 严格保持，重放一致性校验（相同 role/content/emotion 及显式时间戳返回原记录，冲突 payload 安全拒绝，未传时间戳允许时钟前进），commit 成功确认失败重试保证单条；两生产入口基于 SDK ChatMessage.id 稳定派生 UUID5，缺失/非法拒绝写入零降级；真实 PostgreSQL 并发 Barrier、跨 session 隔离、多 NULL 及每日聚合不重复回归通过；
      本地已完成有界内存 TranscriptSink 与故障会话终止（A44）：建立会话级独立有界队列（256 pending + 1 inflight），同步非阻塞接纳，拒绝空白/非法角色/坏 UUID 事件；深拷贝快照与未显式时间戳严格保持 None；每事件最多 3 次写入尝试（1 首次 + 2 重试），单次 2.0s 合作式超时，(0.25, 1.0) 秒退避；满队列或重试耗尽同步停止接纳，至多触发一次异步故障通知（自定义轨 ERR_CUSTOM_RUNTIME / 基础轨 ERR_SYSTEM_RUNTIME），保持安全错误分类与会话终止；8.0s 总排空预算，超时或取消强制收束自有 worker/writer/notify 任务，记账恒等式 accepted == succeeded + failed + pending + inflight 严格保持；双入口接线共享同一 job sink 并通过 ctx.add_shutdown_callback 注册生命周期；修复 A43 P2 并发 Barrier 实际连接 PID 观测；离线矩阵与真实 PostgreSQL 确认丢包重发回归通过（见 [RF-09 有界内存 TranscriptSink 验证](./docs/verification/cross-platform/RF-09-TRANSCRIPT-SINK.md)）；
      本地已完成自定义凭据解析边界落地（A45）：将 PluginInitError 抽离至无 SDK/网络依赖的统一异常模块 plugin_errors，plugin_factory 保持完全向后兼容导出与异常捕获兼容；新增独立纯净 CredentialResolver，封装 ResolvedCustomCredentials 不可变快照，明文密钥 repr=False 并在 repr/str 中脱敏掩码，禁止记录明文、密文与 key_version；严格保证 6 项必填预检顺序（3 provider -> 3 key），未齐备前零解密、零 factory 构造；按 STT/LLM/TTS 顺序依次解密，任一解密失败立即抛出静态安全 ERR_CUSTOM_KEY_INVALID，终止后续解密，底层异常脱敏不泄露；透传各 key_version（含 None legacy 值），支持 custom model 与 default fallback；agent.\_build_custom_plugins 接入统一 resolver，消除重复预检解密逻辑，原敏感系统环境变量防护与 finally 恢复保持原语义；基础轨 entrypoint 零 resolver/零 decrypt/零 encrypted 访问，自定义轨安全断连错误码保持不变（见 [RF-09 自定义凭据解析边界验证](./docs/verification/cross-platform/RF-09-CREDENTIAL-RESOLVER.md)）；
      本地已完成自定义插件显式凭据构造与零进程环境改写落地（A46）：彻底移除 agent.py 中 import os、\_SENSITIVE_ENV_VARS 常量定义及 \_build_custom_plugins 内对 os.environ 的临时 pop/update 改写逻辑；基于 PluginFactory 既有 API Key 强校验（拒绝 None/空/空白/换行/CR/null/非 str 并返回 clean key），实现显式传参直连 SDK 构造器，杜绝降级回退读取系统环境变量；每个 SDK constructor 调用瞬间及返回后环境严格不变；测试适配精确 patch.dict 隔离环境，消除 A45 P2 遗留的环境恢复风险；覆盖五敏感 env 均存在/部分缺失、成功/异常/invalid role key/并发与嵌套构造、三 role 归属互不串扰、VAD 纯 mock 无网络及全链路 Canary 脱敏审计（见 [RF-09 自定义插件显式凭据构造验证](./docs/verification/cross-platform/RF-09-EXPLICIT-KEYS.md)）；
      本地已完成 ProviderRegistry 插件集构造收口边界落地（A48）：新增独立 pure-boundary ProviderRegistry，提供 from_custom(resolved: ResolvedCustomCredentials) 与 from_system_defaults() 统一收口自定义轨与基础轨插件集构造逻辑；仅接收已解密不可变快照，杜绝接触 ORM、零自行解密、零环境改写且零配置兜底；实际构造严格委托 PluginFactory，保持 STT → LLM → TTS → VAD 顺序与任一失败快速短路；agent.py 移除未使用的 PluginFactory 导入，\_build_custom_plugins 与 entrypoint 统一委托 ProviderRegistry；基础轨零用户凭据与解密访问；既有测试适配 ProviderRegistry patch 路径且断言不削减；真实新增 14 函数/19 用例，模块有运行时 snapshot 依赖（import 用于 isinstance 校验），基础轨零 resolver 调用/零解密；Canary 新测试只验证 repr 且 env 新测试仅前后，构造中 env 与日志原 A46 回归承担；变异测试（wrong-role key 与漏构造 role）及全链路回归通过（见 [RF-09 ProviderRegistry 插件集构造验证](./docs/verification/cross-platform/RF-09-PROVIDER-REGISTRY.md)）；
      本地已完成 AgentJobOrchestrator 生命周期边界落地（A51）：新增独立 `job_orchestrator.py`，承载单次 Job 的连接、等待参与者、TranscriptSink 实例与单一 shutdown callback 管理、AgentSession 事件接线与启动及未成功时清理；entrypoint 保留 DB 配置查询、双轨分支、ProviderRegistry 与 EchoTalkAgent 构造；显式传入工厂与回调保留测试 patch 路径；零反向 import agent、零 DB/config/凭据读取；每 job 独立状态隔离，模式读取时点不漂移；失败与取消正确收束自有 Sink；全链路回归通过（见 [RF-09 AgentJobOrchestrator 生命周期边界验证](./docs/verification/cross-platform/RF-09-JOB-ORCHESTRATOR.md)）；
      本地已完成安全错误发送与断连出口收敛（A56）：新增纯标准库 + `AgentErrorMapper` 依赖的独立 `error_delivery.py`（`send_error_and_disconnect`），消除 `agent._send_error_and_disconnect` 与 `job_orchestrator._default_send_error` 重复的错误映射、JSON 载荷构造、`publish_data` 与 `disconnect` 实现；保留两个旧包装函数签名、默认值与可 patch 兼容委托；保持 `echotalk-agent` 安全日志文本、普通 publish 异常仅告警仍断连、disconnect 异常原样传播及 publish 阶段 `CancelledError` 原样传播不擅自断连；全链路回归通过（见 [RF-09 安全错误发送出口收敛验证](./docs/verification/cross-platform/RF-09-SHARED-ERROR-DELIVERY.md)）；
      本地已完成运行时错误通知任务所有权与关闭收束（A57）：消除 `AgentJobOrchestrator` 中未被追踪的 `asyncio.ensure_future`，每个编排器实例独立追踪自有运行时错误通知任务，完成回调自动移除任务并安全检索异常（仅写静态安全警告，杜绝异常正文/密钥/room 原文或 traceback 泄露，`CancelledError` 安全检索无 unretrieved 告警）；单一组合 shutdown callback（`orchestrator.close`）替代原 `sink.close` 注册，同步标记 `closing` 阻断迟到错误回调，按命名类常量 `ERROR_TASK_DRAIN_TIMEOUT_SECONDS = 2.0` 合作式排空并在超时或取消时强制 cancel + await 收束，保留 `TranscriptSink` 8.0s 排空预算与原 `bool` 返回值语义，排除当前任务自身防 `disconnect` 重入自锁；`setup`/`start` 失败与取消均完整清理，全链路回归通过（见 [RF-09 运行时错误通知任务生命周期验证](./docs/verification/cross-platform/RF-09-ERROR-TASK-LIFECYCLE.md)）；
      本地已完成公共 Sink 通知重入边界落地（A58）：在 `TranscriptSink` 建立小型公共行为查询 `is_failure_notification_task(task=None) -> bool`，只返回目标任务（默认当前任务）是否为本 Sink 的故障通知任务，不暴露内部 Task 对象，不改变 Sink 内部状态；`AgentJobOrchestrator._close_sink` 接入该公共行为查询，彻底消除对 `sink._notify_task` 私有属性的耦合；保持 `TranscriptSink` 原 close 流程、8.0s 排空预算、状态记账与 A57 错误通知 2.0s 预算完全不变；真实 Sink 故障通知回调触发“通知→disconnect→Orchestrator.close→Sink.close”重入经真实用例验证无自锁、无自取消且所有自有任务完全收束；关闭 A57 遗留两项文字 P2（`PROJECT_STATUS` 修正新增测试数实际为 12，核验并记录 `test_error_task_lifecycle.py` 装饰器真实文件情况）；全链路回归通过（见 [RF-09 公共 Sink 通知重入边界验证](./docs/verification/cross-platform/RF-09-SINK-REENTRY-BOUNDARY.md)）；
      本地已完成重入回归测试有界失败与资源清理落地（A59）：为 `test_sink_reentry_boundary.py`、`test_error_task_lifecycle.py` 与 `test_transcript_sink.py` 建立独立外部完成观察预算与轻量等待 helper（`_wait_bounded` / `_poll_bounded`，2.0s 预算），`_wait_bounded` 改为显式持有 Task 并通过 `asyncio.wait(timeout)` 观察，到期不在观察函数中无限等待取消完成（规避底层 shield 延迟响应取消导致测试卡死无法进入 finally），由 finally 接管，新建观察 Task 自动登记与回收；建立协调任务收束机制（`_cancel_and_wait_tasks` / `_cleanup_test_resources`），在 `finally` 块中释放自建 gate（`allow_reentrant_close`、`disconnect_entered` 等），一次性收集测试装置拥有的外部 Task、Orchestrator 共享 `_sink_close_task` 与错误任务以及 Sink worker/notify/close 任务，统一发起取消解开 shield 依赖并收束，检索所有（含早已完成）任务异常，对最终 pending 明确报错并给出任务名称；多资源清理保证前项失败不跳过后续资源；严格区分“真实正常关闭”与“强制清场”，移除测试 helper 篡改 `sink._closed=True` / `sink._accepting=False` 伪造终态的做法；重入调用直接在通知原 Task 中 await 保持 Task 身份，断言通知 Task 身份与非取消回退；修正并统一文档与注释中显式 `task=None` 语义（明确与无参调用一致均指当前任务，纠正任何情况下均 False 的错误表述并在矩阵中覆盖）；新增 2 项负向测试（验证通知未到达在短预算内超时并收束任务，及模拟重入查询失效关闭互等死锁并收束清场）与 2 项故障路径验证（验证延迟响应取消外部完成观察预算先到期抛错及步骤失败时清理其余自有资源）；使重入回归在变异场景下确定性失败退出 (exit 1) 而非挂起 900 秒（单个观察预算 0.05s~2.0s，整套变异回归在约 22 秒内产生 4 项预期失败并退出，见 [RF-09 重入回归测试有界失败与资源清理验证](./docs/verification/cross-platform/RF-09-BOUNDED-REENTRY-TESTS.md)）；
      本地已完成显式 Agent 启动与无配置副作用导入落地（A75）：移除 `agent.py` 的运行时
      `sys.path` 注入与导入期 dotenv；新增无启动副作用的 `livekit_agent.__main__/bootstrap`，
      官方入口改为 `python -m livekit_agent dev|start`，Compose 同步为模块 start；显式启动严格
      先 root dotenv `override=False`，再加载并验证 config，最后导入真实 SDK/业务 CLI，且保持
      `WorkerOptions(entrypoint_fnc=entrypoint, num_idle_processes=1)`。`CredentialResolver`、
      系统 `PluginFactory`、`TranscriptSink` 与 Agent 数据访问改为窄延迟边界，Prompt 纯函数提取
      至 `services.agent_prompt` 并由 `llm_service` 兼容重导出；新增真实新进程全模块导入、合成
      dotenv 优先级、配置失败不启动和真实 PostgreSQL 默认 writer 回归。A75 已独立 Review
      APPROVED，定格于本地单提交 `1e871c2dbf1b202112a544e6507c9ad00bf43bff` 并精确
      fast-forward 本地 main；main 完整门禁为 917 Vitest、18 build-script、61 Fake API、
      8 类型生成器、148 E2E、576 backend、80.09% coverage、OpenAPI schema 与 Ruff 通过。
      真实 LiveKit/Provider 连接、真实 start/dev、联网 CLI、Agent worker、Docker 镜像与部署
      未验，RF-09 整项及 RF-12 前置均不提前完成。
- [ ] **RF-10 Provider Registry**：能力、模型、凭据、验证、超时、重试与错误映射统一；
      非敏感设置不解密旧凭据；多 Provider 验证并行且有总超时。
      本地已完成 LLM 静态元数据单一来源收敛（A50）：新增纯标准库不可变 `provider_catalog.py`（MappingProxyType 与 frozen dataclass 双重保护），收敛 `plugin_factory`（`LLM_PROVIDER_BASE_URL`、`_SYSTEM_LLM_KEY_FIELD`）、`llm_service`（`PROVIDER_CONFIG`）与 `validation_service`（`validate_llm_key`）三处重复定义；保持 SiliconFlow 与 OpenRouter 两 Provider 顺序、URL、Header 与变量类型；未知 provider 与空 key 零外部网络请求；携带 A49 遗留 P2 合法空嵌套 message 回退至 JSON 字符串；见 [RF-10 LLM 静态元数据单一来源验证](./docs/verification/cross-platform/RF-10-LLM-CATALOG.md)；
      本地已完成 STT/TTS 静态元数据单一来源收敛（A53）：在不可变 `provider_catalog.py` 中补齐现有 Deepgram 与 Cartesia 静态元数据（`STTProviderMetadata`、`TTSProviderMetadata`、`STT_PROVIDER_CATALOG`、`TTS_PROVIDER_CATALOG`），收敛 `plugin_factory`（`SUPPORTED_STT_PROVIDERS`、`SUPPORTED_TTS_PROVIDERS`）与 `validation_service`（`validate_stt_key`、`validate_tts_key`）来源；保持 Deepgram（Token 认证）与 Cartesia（X-API-Key 与 Cartesia-Version 头）精确 URL 与 Headers；Catalog 保持纯标准库不可变且不驻留凭据，每次请求独立生成 Headers 防污染；未知 provider 与空 key 保持零外部网络请求；见 [RF-10 STT/TTS 静态元数据单一来源验证](./docs/verification/cross-platform/RF-10-SPEECH-CATALOG.md)；
      本地已完成用户设置惰性解密与非敏感更新解耦（A54）：修复设置更新无条件解密三路旧凭据缺陷，确立仅在 role 发生变化且需要沿用旧 key 时才按需解密该 role 旧密文；未变化 role（含主题/模型偏好/自定义模式等非敏感配置更新及同 provider 原值重复提交）零读取、零解密、零拨测，避免因旧密文版本漂移或损坏导致非敏感设置更新失败；显式提供新 key 仅拨测新 key 绝不解密旧密文；严格保持 STT→LLM→TTS 校验顺序与 422 失败响应形状；见 [RF-10 用户设置凭据惰性解密验证](./docs/verification/cross-platform/RF-10-LAZY-KEY-DECRYPTION.md)；
      本地已完成多 Provider 有界并行验证与统一总预算控制（A55）：`ProviderValidationService.validate_parallel` 以 `TOTAL_TIMEOUT_SECONDS = 10.0` 整批并发执行需拨测的独立 role，单请求 `REQUEST_TIMEOUT_SECONDS = 8.0` 保持；总预算到期保留已完成真实结果，未完成 role 标为 `timeout` 并强制 cancel 与 await 收束全部 pending task，意外异常先清理在途任务再原样抛出；设置路由仅调度 changed 且同时具备 provider/key 的 role，严格保持 A54 惰性解密边界与 STT→LLM→TTS 响应/错误字段顺序；`validate_all` 复用同一有界并行入口并保持 `bool` 返回兼容；见 [RF-10 多 Provider 有界并行验证](./docs/verification/cross-platform/RF-10-BOUNDED-PARALLEL-VALIDATION.md)；
      本地已完成用户设置业务服务边界抽离（A60）：把 `backend/routers/user.py` 中的设置响应构建、权限判断、按变更凭据验证与更新/加密业务逻辑抽入独立纯净服务 `backend/services/user_settings_service.py`；HTTP 路由保留认证依赖、当前用户限定数据库查询/创建/flush/refresh 与对原 helper 签名（`get_key_status`、`_decrypt_and_rotate`、`_as_validation_result`、`_build_user_settings_response`、`_validate_custom_mode_permission`、`_validate_provider_keys`、`_apply_settings_update`）及测试 patch（`routers.user.decrypt_api_key`、`encrypt_api_key`、`ProviderValidationService`）的薄兼容委托；路由在调用服务时显式从当前命名空间注入依赖，服务导入期零路由反向依赖、零模块默认值绑定及零全局可变状态；A54 惰性解密与 A55 有界并行边界与响应脱敏完全保持；新增 `test_user_settings_service.py` 覆盖状态三态映射、响应脱敏、权限校验、零副作用、密钥旋转、失败顺序、字段写入及生产路由直接消费与 patch 兼容回归（见 [RF-10 用户设置业务服务边界验证](./docs/verification/cross-platform/RF-10-SETTINGS-SERVICE.md)）；真实外部 Provider 拨测与前端展示元数据统一仍待完成，整项保持未勾选。
      A78 b/r0 已完成 Provider 前端展示元数据单一来源实施并通过 Review：不可变 catalog 为
      STT/LLM/TTS 条目补充带默认值的 `role`、`label` 与默认标记；新增纯标准库离线 exporter，
      从真实 catalog 生成仅含 role/id/label/default 的 canonical JSON，并覆盖 timeout、安全
      异常、原子失败保护、缺失/stale 不写与敏感字段零透出回归；前端 adapter、真实设置视图和
      `useSettingsForm` 初始/水合 fallback 改由生成 JSON 消费，保持既有顺序、文案、默认和
      LLM 自由文本模型；CI 后端新增独立 byte check，`.prettierignore` 精确排除生成文件。
      主 Agent 已原生生成 tracked JSON、接线本地 fixed runner 独立
      `provider-metadata-check`，并以单提交
      `8efb92387ac0bf3b9489a20b6080d78d6ec91ab4` 精确 fast-forward 本地 main；15 项 main
      门禁为 969 Vitest/34 files、18 build-script、61 Fake API、8 类型生成器、148 E2E、
      586 backend/76.98% coverage，以及 schema/Ruff 等检查通过。远端 CI、真实外部
      Provider、部署与设备仍未验证，RF-10 整项保持未勾选。
      A83 b/r0 已完成普通 OpenAI 兼容聊天 HTTP 客户端的 timeout/retry 显式化，并经独立
      Review APPROVED、正常 hook 单提交
      `fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d` 与本地 main 精确 fast-forward；完整
      15 项 main 门禁为 972 Vitest/36 files、18 build-script、61 Fake API、8 类型生成器、
      148 E2E、598 backend/78.14% coverage，以及 schema/Ruff 等相关检查。纯标准库不可变
      Catalog 策略冻结现有 connect 5 秒、read/write/pool 默认 600 秒和 SDK
      `max_retries=2`；真实 `services.llm_service._get_client` 显式构造
      `httpx.Timeout` 并传重试值。
      600 秒仅是 HTTP 客户端各阶段默认配置，不是完整聊天 deadline；该策略不用于 LiveKit
      语音连接或 Provider key 验证，OpenAI HTTP 2 次重试也不与 LiveKit
      APIConnectOptions 3 次混同。远端 CI、真实 Provider 与部署仍未验证，RF-10 整项继续
      保持未勾选；见
      [RF-10 普通 OpenAI 兼容客户端策略验证](./docs/verification/cross-platform/RF-10-LLM-CLIENT-POLICY.md)。
      A84 LiveKit AgentSession 连接策略的旧实现与 A84C 文档收口均已完成；A84C 于 2026-11-14
      达到 `FINAL_READY`，其 SDK 版本、门禁、目标测试与变异数字只属于该历史快照，不作为
      A82C 的当前结果。证据边界见
      [PROJECT_STATUS A84C 小节](./docs/PROJECT_STATUS.md)、
      [RF-10 LiveKit 语音连接策略验证](./docs/verification/cross-platform/RF-10-SESSION-CONNECT-POLICY.md)
      及[已完成事项归档](./docs/history/todo-done.md#2026-11-14-a84c-文档收口历史快照)。真实外部链路和
      RF-10 整体仍保持未完成。

### Phase 7：受控升级

- [ ] **RF-12 独立 SDK 升级**：仅在 RF-01、RF-04、RF-07、RF-09 完成后，分别升级并
      提交 LiveKit Agents、OpenAI SDK、Vite、Vitest 和 TypeScript；保留回滚边界；真实
      语音、Provider 与 iOS 真机等外部验证在获得凭据/设备后补证，未验证前不得完成。

## P0 — 安全边界

本节事项已全部完成，见[已完成事项归档](./docs/history/todo-done.md)。

## P1 — 功能完整性

周度学习报告已实现最近七个本地自然日的 completed 会话计数、按日只读历史与“已记录会话时长”
本范围。其他周报指标仍需分别定义、实现并验证，不能据此认定完整周报已完成：

- [x] “已记录会话时长”三卡（本范围已实施并验收，已归档）：
  - `WD-DESIGN`（历史）：原时点为设计合同 `FINAL_READY`；随后主控独立 Review `APPROVED` 并随
    `9d3ab32` 推送。该合同以 `include_recorded_duration=false` 保持旧四字段/count-only 路径，
    opt-in 才计算时长；原时点机器收口、保护字节与 PG 边界见
    [PROJECT_STATUS 的 WD-DESIGN 小节](./docs/PROJECT_STATUS.md#wd-design-已确认周报时长合同设计-final_readyapiui-未实施)；
    该节继续作为历史快照，不再表示当前待 Review。
  - [x] `WD-API`（历史）：`FINAL_READY`，随后独立 Review `APPROVED` 并随 `9179050` 推送。
        默认四字段/count-only 路径、opt-in 单次有界聚合、生成 OpenAPI/types、parser 兼容与
        测试均已完成；主控最终 13 项机器门禁全部 `exit 0`。正式返修 `1/2`、TDD 中间修正 `1`。
        详细回执见
        [已完成事项归档](./docs/history/todo-done.md#2026-11-16-wd-api-周报已记录会话时长opt-in-聚合与兼容解析final_ready)。
  - [x] `WD-UI`：`FINAL_READY`。客户端固定 opt-in，周总、选中日、缺失提示及兼容未知态均完成；
        R1 目标失败修复后回归全过，全部门禁最终 `exit 0`，真实 Chromium/WebKit 宽窄路径与截图
        通过主控验收。归档见
        [已完成事项](./docs/history/todo-done.md#2026-11-16-wd-ui-周报已记录会话时长前端显示与浏览器验收final_ready)；
        合同见[周报“已记录会话时长”合同](./docs/WEEKLY_RECORDED_DURATION_CONTRACT.md)。
        本范围完成不勾选完整周报、CP-05、三端或真实学习质量父项。

周报剩余指标设计稿已产出、待用户确认：见
[WEEKLY_REMAINING_METRICS_DESIGN.md](./docs/WEEKLY_REMAINING_METRICS_DESIGN.md)（WR-DESIGN，
`DRAFT_READY`）。`p_mastery` 环比 A/B/C、报告/对比窗口与 IANA 时区均待确认，未实施、未勾选父项；
下一步等主控补详细数字并独立 Review。

- [ ] 计算各技能 `p_mastery` 环比趋势：历史数据、对比窗口与指标口径仍待明确。
- [ ] 按会话聚合发音准确率趋势。
- [ ] 基于 RAG/Krashen i+1 生成下周学习重点。
- [ ] 汇总平均焦虑指数与语速趋势。
- [ ] 接入正式 i18n 框架，用语言包替换当前 TypeScript 字符串对象。
- [ ] 实现数字人前端与音视频同步，并补充独立设计和验收标准。
- [ ] 在完整后端与 LiveKit 环境补验 Session、评估页面及深色主题可读性。

## P2 — 质量与维护

本节事项已全部完成，见[已完成事项归档](./docs/history/todo-done.md)。

## 三端交付计划（Web / macOS / iOS）

> 制定日期：2026-10-21；初始分析基线：`main@66a64fe`；执行准备基线：远端 `main@a8f0895`。
> 以用户已确认可运行的 iOS 为起点；完整闭环、异常恢复和 Release 分发分别记录验收结果。
> 架构、默认策略与证据规范见 [跨平台架构与交付门禁](./docs/CROSS_PLATFORM_ARCHITECTURE.md)。
> 本节替代原 Phase 9 移动端计划；任务完成状态只在此维护。

### 范围与推进规则

- 本轮交付 Web、iOS 和 macOS；Android、Windows、实时跨设备语音接力、离线 AI 不在本轮范围。
- 共用 React 页面、API 和后端；保留 Capacitor iOS，macOS 先验证再确定包装方案。
- 首版默认以前台练习为目标；中断时停止或暂停采音，回前台核对状态，并由用户确认恢复采音。
- 历史、报告和设置跨端同步；同一账号同时只允许一端通话，另一端须显式接管，不静默踢出已有端。
- CP 编号表示验收门禁。CP-00 通过后，CP-01、CP-02 后端与 CP-03 最小验证可并行；接口稳定后再并行开展认证、会话恢复和独立 UI 适配，最终串行集成验收。
- 现有 RF 任务保持独立状态；跨端工作不顺带升级 SDK、清理基础设施或重写全部前端状态。
- 真实 IdP、设备或签名条件缺失时，继续无依赖工作；相关外部验收保留未完成，不以 Mock 通过替代。

### CP-00：基线与验收准备

CP-00 自动化准备已于 2026-10-21 独立评审通过；已补录 iPhone 17 Pro / iOS 26.0 模拟器安装证据；真机、真实链路及发布验收仍未通过。

### CP-01：平台边界与配置（首个代码阶段）

- [ ] 在 `apps/vite-app/src/platform/` 建立薄适配接口；验收：环境、认证、生命周期能力具有明确边界，Web 默认实现可运行，尚未支持的能力显式返回不可用。

### CP-02：会话可靠性与恢复契约

- [ ] 完善Cloud占用下恢复入口与真实媒体/三端恢复验收；验收：刷新或重启后可选择恢复/结束，已结束会话不能重连，不持久化 LiveKit Token。
- [ ] 明确并落实单设备会话占用、过期释放及显式接管；验收：双端竞争不造成隐式踢人，旧设备失去占用后不能自动抢回，会话中断后的遗留状态有回收路径。
- [ ] 完成真实网络离线、Token失效与原生系统中断验收；验收：API 502、离线、Token 失效不再只写 console 或长期显示假在线。

Cloud 占用后端协议已于 2026-10-21 通过本地独立评审（`d76da01`）：专用 PostgreSQL、模拟媒体、失败回滚与迁移往返通过。恢复/接管 UI、真实 Cloud 撤销及三端旧 SDK 重连尚未验收，`CALL_LEASE_MODE` 默认保持 `disabled`。
CP02I 本地组合补验（真实 controller + api.ts + stdio 桥 + ASGI + 真实 PG，6 场景）已于 2026-11-15 主控最终验收通过并归档（FINAL_READY），见 [CP-02 本地组合补验](./docs/verification/cross-platform/CP-02-LOCAL-COMBINATION.md)与 [PROJECT_STATUS](./docs/PROJECT_STATUS.md)；Cloud 撤销仅显式模拟且桥进程硬拦非本地 PG 出站，真实 OS/SSO/Cloud/设备未验，父 CP02 验收项保持未勾。

### CP-03：macOS 最小验证与方案定案

- [ ] 比较 Web/可安装 Web、Apple Silicon 上运行 iOS App、独立 Tauri macOS；验收：记录目标芯片/OS、发布渠道、桌面能力需求和维护取舍。
- [ ] 对候选方案做最小语音与授权回跳验证；验收：麦克风授权、双向音频、耳机切换、断网重连、休眠唤醒、文件选择和系统认证回跳有设备证据。
- [ ] 形成 macOS 方案决策；验收：若需独立客户端且 Tauri 验证通过，再维护正式桌面工程；验证失败则分析具体失败点再评估替代方案，不无条件迁移 iOS 或引入 Electron。

### CP-04：三端真实登录与凭据生命周期

- [ ] 保留 Web OIDC Code + PKCE，接入原生系统认证会话及冷/热启动回跳；验收：state/nonce/PKCE、取消、重复回调、错误回调和退出均正确处理。
- [ ] 原生长期凭据使用 Keychain，补齐续期、撤销及 401 恢复；验收：并发请求只触发一次续期，失败后受控退出，不盲目重放创建/结束等写请求，不在 Web Storage 保存原生长期凭据。
- [ ] 配置各客户端的 IdP 回调白名单与 API audience；验收：三端同一账号映射同一本地用户；核实 IdP 是否使用 pairwise subject，禁止靠 email 自动合并账号。
- [ ] 登录失效/退出时停止音频并清理用户相关内存及本地恢复提示；验收：切换账号不显示上一账号的会话、设置或报告。
      CP04E 本地组合子卡已归档为 `FINAL_READY`：logout 与当前请求 401 均从真实认证入口验证活动 `VoiceInterface/RoomSession` 卸载、产品真实停轨及用户 store 清理；R2 最终目标 `2/2`、target-final `2/2`，最终 13 门禁全 `exit 0`，正式实施返修 `2/2`。完整数字与边界见 [PROJECT_STATUS](./docs/PROJECT_STATUS.md#cp04e-认证退出与活动-room-组合补验final_ready)。本地子卡完成不勾选 CP-04 父项；next-local 新批合成 PG 已清理，`CP04E-stop-pg` `exit0`，精确 ID、双 owner、loopback 与合成库身份核验后 `stop0`、`auto_removed=true`，名称和 ID 均不存在，其他资源未动，本批与旧批独立；真实外部/SDK 网络/设备/CI/生产仍未验收。
      CP04I 本地组合子卡已完成并归档为 `FINAL_READY`，覆盖真实入口换号、旧请求迟到隔离和同 principal 续期保活；目标、13 门禁与两个私有负对照均完成，本次合成 PG 已精确清理。R0/R1 历史、最终数字与 PG 清理细节统一见 [PROJECT_STATUS](./docs/PROJECT_STATUS.md#cp04i-真实入口换号与迟到响应组合final_ready)。本地子卡完成不勾选 CP-04 父项；真实 SSO/IdP、Keychain、设备、媒体、Provider、LiveKit、外部依赖与生产仍未验收。Review/commit/push 以主控最终同卡回执为准，用户 Review 待。

### CP-05：生命周期与响应式体验

- [ ] Web visibility/online 与原生前后台/唤醒统一进入恢复流程；验收：重新校验身份、服务端状态和 LiveKit 连接，回前台立即刷新分析，避免并行轮询或重复 dispatch。
      CP05L 本地组合子卡已归档：[归档记录](./docs/history/todo-done.md#2026-11-15-cp05l-dashboard-生命周期实际组合缺口final_ready)。父项不勾选；真机 iOS 网络/OS、真实 SSO/LiveKit/媒体与生产仍未验。
- [ ] 完善 iOS 音频中断与路由变化；验收：来电、锁屏、蓝牙插拔后无假在线或意外采音，恢复遵守用户选择；后台持续通话另立后续范围。
- [ ] 完善手机动态视口、键盘避让、safe area 与触控目标；验收：窄屏/横屏/大字号无关键按钮遮挡，设置面板按可用空间适配。
      CP05D 本地子卡已归档：[归档记录](./docs/history/todo-done.md#2026-11-15-cp05d-设置抽屉动态可见性)。
- [ ] 完善桌面窗口缩放、宽屏布局、键盘导航和关闭会话行为；验收：缩小窗口可用，快捷键不抢输入焦点，关闭窗口不遗留采音。
      CP05K 本地子卡已归档：[归档记录](./docs/history/todo-done.md#2026-11-15-cp05k-会话界面动态桌面与键盘覆盖final_ready)。父项不勾选；原生 desktop 关闭会话与真实媒体不在本轮模块桩证明范围。
- [ ] 真机验收 DocTalk 文件导入；验收：`.txt/.md` 可选、取消不丢草稿，读取失败、空文件、编码问题和超限有提示；仅在 Web 文件接口不满足时增加原生插件。

### CP-06：自动化与真实链路回归

- [ ] 取得当前增量树 Linux CI 双浏览器与完整真实链路回归证据；验收：Chromium/WebKit 均覆盖登录边界、会话恢复和分析状态，Mock 测试与真实 Provider 验收分别报告。A64 旧 8 项门禁及其具名计数属于原卡历史回执，保留在 [CI 质量门禁验证](./docs/verification/cross-platform/CP-06-CI-QUALITY-GATES.md)；PR #117 及对应 main 运行“已绿”、PR #119 frontend 与组合门禁“待收口”也均为各自原历史时点结论，不代表今日状态。当前增量树 Linux 双浏览器与真实链路仍须另行取证，不能用上述旧回执替代；真实链路未验。

> **WDI 子项（`FINAL_READY`，本机合成链路完成）：** 新增显式
> `test:weekly-duration-local` 入口和专用 Chromium/WebKit 组合用例，补验现有
> Dashboard/WeeklyProgress、parser/controller/UI 经真实 HTTP、FastAPI/main、生产 `get_db`、dev
> 认证、SQLAlchemy/asyncpg 与自有 PostgreSQL 的当前组合路径。真实 HTTP/PG、两项业务变异、
> `POST/PUT` 与 unsafe GET 服务端负对照、guard/快速重启和两文件格式等价均已通过；完整数字只见
> [PROJECT_STATUS 的 WDI 小节](./docs/PROJECT_STATUS.md#wdi-周报时长真实本地组合补验final_ready)。
> 仅自有 API/Vite 资源和 marker rows 已回收，合成 PG 为后续三张设计卡继续独占保留。该子项只关闭
> 本机合成链路，CP-06 父项、Linux CI、真实 IdP/LiveKit、设备、生产、50+5 分页与真实学习质量
> 继续未验，不勾父项。

- [ ] 接入 macOS runner 的 iOS 构建和所选 macOS 方案构建；验收：普通 PR 可无发布密钥验证编译，签名仅在受控发布任务使用。macOS 探针 CI 已随 PR #117 合并、B r1 已修复 Node runner 误收集并通过主控本地四项检查、PR #119 为验证 draft，均为原历史时点回执，不代表今日状态。当前增量树原生 CI 仍须另行取证，不能用旧回执替代；原生 iOS 仍待真实 CI。
- [ ] 完成三端真实链路矩阵；验收：真实 IdP → 创建 → LiveKit/Agent 双向语音 → 结束 → 分析 → 报告，并验证拒绝权限、弱网、中断、重启、双端冲突和账号切换。
- [ ] 补充按版本/平台关联的诊断信息；验收：可定位 API、LiveKit、Agent 错误，不采集 Token、密钥或默认上传文档/对话正文。本地一期已通过独立评审，完成控制台结构化脱敏诊断（严格白名单 record、8项冻结事件、版本与平台自动关联、status/agent_code白名单过滤、控制台敏感parsed/canary彻底消除，见 [本地安全诊断一期验证](./docs/verification/cross-platform/CP-06-SAFE-DIAGNOSTICS.md)）。A76 已 Review APPROVED、以单提交 `f8b9dad3e2af2062d9dbbf59943cc2a7fc72aa7a` 精确 fast-forward 本地 main，并完成 main 完整门禁；lane 独立消费探针与 3 项有效变异未在 main 重复。A77 已把 Room 物理 adapter/Room 与认证业务监听归属分离；r1 产品 Vitest 为 940 passed/25 failed/965 total，r2 已修复 native pending 占位 hidden 被误判为真实 inactive，并把 Web 订阅后快照与 native pending 分开：Web 立即失败，native 等 `whenReady` 后重读 snapshot/能力并按原 10 秒 deadline 对账；旧 timer 不得清空新句柄，刷新后当前 native 业务监听仍可停轨。r2 独立 9 项时序与 A76 compat 5 项在 formatter 前通过，随后 format/lint/typecheck 通过，完整 Vitest 为 958 passed/9 failed/967 total，失败均由 stale timer fixture 残留 fake 全局时钟导致后续 A76 异步等待超时；r3 已清理该 fixture，并通过 967 Vitest/33 files、18 build-script、61 Fake API、8 type generator、148 双浏览器 E2E、576 backend/80.09% coverage、schema 与 Ruff。auth revision、原 deadline、ready snapshot 三个产品变异产生 11/6/4 项失败并精确还原；第四项 timer-handle 变异未被原 967 测试杀死，但实际 timer 队列确认卸载后残留本 Room timer，因此 r4 已补真实队列与卸载清理回归，产品逻辑不变。r1 只执行官方返修 native 预检，baseline3 是历史 r0 实测，当前 r4 仍待主 Agent 停写后完整代跑、复验第四项变异必被杀死并由独立 Review 判定，见 [A76 冻结实施记录](./docs/verification/cross-platform/CP-06-AGENT-ERROR-OWNERSHIP.md) 与 [A77 本地实施记录](./docs/verification/cross-platform/CP-06-ROOM-AUTH-REFRESH.md)；三端真实异常联动仍待外部验收，本计划不要求新增遥测上报，整项保持未勾选。

### CP-07：发布候选与交付

- [ ] Web 验证真实 HTTPS/WSS、API 兼容和回滚；验收：保留上一可用版本，新旧客户端均通过关键接口验证。
- [ ] iOS 完成 Release Archive、签名、权限/隐私材料与 TestFlight 验收；验收：使用生产构建配置完成完整闭环。
- [ ] macOS 按 CP-03 决策交付；验收：独立包完成签名及渠道所需公证/审核、全新安装验证；Web 方案则验证目标浏览器及安装入口。
- [ ] 记录各端版本、最低支持 OS、已知限制与回滚步骤；验收：发布候选通过不等于已对外发布，部署、上传和商店提交由用户确认发布边界后执行。

### 后续候选（不阻断本轮）

- [x] 在回归保护下减少start/resume重复生命周期逻辑及全局测试注入入口；A18维护候选，不阻断本地增量。已由 A18P2 收口，见 [CP-05 原生启动与显式恢复](./docs/verification/cross-platform/CP-05-NATIVE-STARTUP.md)。

- [ ] Android / Windows：产品确认进入范围后独立做平台最小验证。
- [ ] 后台持续语音、实时跨设备接力、桌面托盘/全局快捷键与自动更新：有明确需求后单独设计和验收。

## 维护规则

- `README.md` 只记录已验证现状，不承载待办。
- `docs/PHASE_*_TECH_STACK.md` 记录已实现架构，`docs/PHASE_*_MANUAL_TEST.md` 记录验收步骤。
- 已完成任务应同步删除对应源码 `TODO` 注释；重大取舍写入相关技术文档。
