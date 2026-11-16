# EchoTalk 下一步行动评估

> 2026-11-16。本文件只做行动分层与执行状态，未完成待办以根目录 [TODO.md](../TODO.md) 为唯一来源；
> 不授权任何新产品实现、重构或迁移。截至本次文档核对，当前已发布 main 为 DOC 收口 `0a4b6fdf`（mainCI 43744058036）；
> A19 本机候选的发布与 CI 回执在 PR 正文另给，避免合并后误读为主线未前进。

## 执行状态

- **A19 RoomSession 所有权收窄**：已完成（源码独立 APPROVED R1，截至本次文档核对为本机候选、尚未发布）。无用回调/ref 收窄 + 新 4 条同层回归；
  初始 Web 临时 adapter 经审计非泄漏且保留即时语义，未为整洁强改。见 [history](./history/2026-11-16-a19-room-ownership-maintenance.md)。
- **A18 减少 start/resume 重复生命周期逻辑及全局测试注入入口**：未开工（维护候选，不阻断本地增量）。

## 行动分层

### ① 现在可做：只读范围审计 / 设计（不写产品代码）

- **A18**：H1 已把 `runStartup` 抽取到 `apps/vite-app/src/store/conversationStartup.ts`（:53 定义、:478 返回），
  `apps/vite-app/src/store/conversationSlice.ts`（:306、:401、:406 接线）消费，见
  [CONVERSATION_STARTUP_EXTRACTION_DESIGN.md](./CONVERSATION_STARTUP_EXTRACTION_DESIGN.md)。A18 须结合这份已落地的
  runStartup 抽取现状重新评估，不能沿用"抽取前"的假设直接改。
- 产出限于只读审计结论、契约边界与候选范围说明；候选先审计收敛范围，再按用户已授范围进入单包实施/独立评审，
  出现新产品口径、契约/权限变化、迁移等才需裁定。

### ② 可做有界复现 / 现有 CI 留证分析（无根因不改产品）

- `apps/vite-app/e2e/weekly-grammar.spec.ts`（[TODO.md](../TODO.md) 记录 :57 偶发失败，历史无重试 5 次失败 1 次）：
  只做有界复现与现有 CI/留证分析；根因未证实前，不改产品、断言或 retries。
- `apps/vite-app/e2e/session-flow.spec.ts`（READ2 首轮记录的 `showEndedSession` 内 `page.evaluate` 的 Promise GC 观察，
  见 [legacy-maintenance-closeout](./history/2026-11-16-legacy-maintenance-closeout.md)）：同样只做有界复现与留证分析；
  根因未知保持开放，不承诺"复现即修复"。

### ③ 可做 Mock 结构化输出 / 契约收敛（不接真实 Provider）

- SGEC（方案 C-2，语法 LLM）：可先在 Mock 下做结构化输出、`skill_tag` 校验与离线评测集的设计和契约收敛。
  确有依据的入口为 `backend/services/assessment_providers.py` 的 `GrammarProvider` 协议（:64，真实语法 provider 接入点）
  与 `validate_grammar_evaluation`（:242，含 `GrammarFinding.skill_tag` :43 的结构化校验）；
  `backend/services/weekly_grammar_queries.py` 是周度聚合查询，不作为 SGEC 注入点。Mock 结构化输出契约与离线评测集的
  具体范围需另行设计确认。
- 不接真实 Provider、不接 BKT；不把未经用户确认的新接口当"已批准"。

### ④ blocked（需用户裁定 / 设备 / 外部前置，本轮不做）

- **B2 学习事件表实施**：等 [LEARNING_EVENTS_DESIGN.md](./LEARNING_EVENTS_DESIGN.md) §9 五问；历史事件无法补录、有时效性，与阶段 C 为独立裁定。不并入本轮。
- **阶段 C 预发布环境**：需账号、密钥与费用决定（[ARCHITECTURE_ROADMAP.md](./ARCHITECTURE_ROADMAP.md) §3.6）。
- **周报口径**：练习时长口径（会话经过时长 ≠ 有效说话时长）、`p_mastery` 环比缺历史快照/事件，见 [TODO.md](../TODO.md)。
- **场景 `goals[]` + Task Completion（方案 D-1，#115）**：先由用户裁定产品口径。
- **发音真实评估 / 会话音频切片采集**：存储、保留期、授权、删除属隐私决定，需用户授权。
- **仓库 required-check 权限 / 防 bot 推送**：需用户在仓库配置。
- **CP-03 / CP-04 设备前置**：需设备证据，见 [TODO.md](../TODO.md)。
- **其余目录迁移**：按 [ARCHITECTURE_ROADMAP.md](./ARCHITECTURE_ROADMAP.md) §7"明确不做"。
- **Compose 真实栈 / 设备服务 / SDK 升级前置**：需外部前置与真实环境证据，未验证前不勾选。

## 推荐顺序（仅建议，非授权）

先做 ① 的只读审计/设计（不依赖真实外部服务），再视结果决定 ② 的有界复现与 ③ 的 Mock 契约收敛；④ 全部等待对应裁定、设备或前置。
候选先审计收敛范围，再按用户已授范围进入单包实施/独立评审；仅出现新产品口径、契约/权限变化、迁移等才需裁定。
