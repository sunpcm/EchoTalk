# EchoTalk 下一步行动评估

> 2026-11-16。本文件只做行动分层与执行状态，未完成待办以根目录 [TODO.md](../TODO.md) 为唯一来源；
> 不授权任何新产品实现、重构或迁移。截至本次文档核对，当前已发布 main 为 A19 `0151223`（PR190，mainCI 43788320370
> 首五 success）；A18 本机候选已源码 APPROVED R0，其发布与 CI 回执在 PR 正文另给，避免合并后误读为主线未前进。

## 执行状态

- **A19 RoomSession 所有权收窄**：已完成并已发布（PR190 merged main `0151223`，PR/Guard 首六、mainCI 43788320370
  首五 success）。无用回调/ref 收窄 + 新 4 条同层回归；初始 Web 临时 adapter 经审计非泄漏且保留即时语义。见
  [history](./history/2026-11-16-a19-room-ownership-maintenance.md)。
- **A18 生命周期测试边界收窄**：已完成（源码独立 APPROVED R0，本机候选、尚未发布）。移除产品测试注入及
  start/resume 重复的测试选项 plumbing，测试平台假对象移入 test-only fixture。见
  [history](./history/2026-11-16-a18-lifecycle-testing-boundary.md)。

## 行动分层

### ① 现在可做：只读范围审计 / 设计（不写产品代码）

- A18 scope 审计已完成并落地实施（见「执行状态」）；当前无新的只读审计候选。
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

下一可做为 ② 的 weekly/GC 有界调查与 ③ 的 SGEC Mock 契约收敛；④ 全部等待对应裁定、设备或前置。
候选先审计收敛范围，再按用户已授范围进入单包实施/独立评审；仅出现新产品口径、契约/权限变化、迁移等才需裁定。
