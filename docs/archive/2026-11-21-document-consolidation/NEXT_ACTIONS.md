# EchoTalk 下一步行动评估

> 2026-11-16。本文件只做行动分层与执行状态，未完成待办以根目录 [TODO.md](./TODO.md) 为唯一来源；
> 不授权任何新产品实现、重构或迁移。原始评估绑定 main `dac4d254`；本页并入时的 main 为 `da37683`，均不含
> B1 分支实现。B1 `46ef954` 已本地完成 §9 学习事件源码、合成验证与隐私 API；生产切换、真实环境与本次合并集成验证仍未完成。
> 下一阶段决策准备见 [NEXT_PHASE_DECISIONS.md](./NEXT_PHASE_DECISIONS.md)，其中 main 五问已被 B1 §9 覆盖；未授权项只余生产与新业务门禁。

## 执行状态

- **A19 RoomSession 所有权收窄**：已完成并已发布（PR190 merged main `0151223`，PR/Guard 首六、mainCI 43788320370
  首五 success）。无用回调/ref 收窄 + 新 4 条同层回归；初始 Web 临时 adapter 经审计非泄漏且保留即时语义。见
  [history](../../history/2026-11-16-a19-room-ownership-maintenance.md)。
- **A18 生命周期测试边界收窄**：已完成并已发布（PR191 merged main `0422c9e`，PR/Guard 首六、mainCI 43800300024 首五 success）。移除产品测试注入及
  start/resume 重复的测试选项 plumbing，测试平台假对象移入 test-only fixture。见
  [history](../../history/2026-11-16-a18-lifecycle-testing-boundary.md)。
- **SGEC 纯离线契约（SGEC-OFF）**：已发布（PR194 merged main `d33f236`，mainCI 43818985856 首五 success）。纯离线结构校验 + 合成 fixture CLI，未接 default 分析/DB/API/BKT/events。见 [history](../../history/2026-11-16-sgec-offline-implementation.md)。
- **Overview 文档**：已发布（PR195 merged main `dac4d25`，mainCI 43836513150 首五 success）。新增技术架构/功能/使用方法导览。
- **SGEC 正式接线离线交付**：已新增 `backend/tests/test_sgec_pipeline.py` 与
  `docs/SGEC_API_ACCEPTANCE.md`，并完成可评审离线接线与文档。本地合成 PG 定向回归 53 项通过，
  完整门禁见本 PR 验证；真实 API、教学质量、人工 gold、发布与外部验收仍未完成。
  SGEC 开关默认 false，运行仍走 DemoRule。

## 行动分层

### ① 现在可做：只读范围审计 / 设计（不写产品代码）

- A18 scope 审计已完成并落地实施（见「执行状态」）；当前无新的只读审计候选。
- 产出限于只读审计结论、契约边界与候选范围说明；候选先审计收敛范围，再按用户已授范围进入单包实施/独立评审，
  出现新产品口径、契约/权限变化、迁移等才需裁定。

### ② 有界复现 / 现有 CI 留证分析（WGGC 已完成调查，缺陷仍开放）

- `apps/vite-app/e2e/weekly-grammar.spec.ts` 与 `apps/vite-app/e2e/session-flow.spec.ts` 的 GC/偶发调查已完成：
  corrected60 与全量 E2E 258 均零重试零 flaky，近期无复现；GC 因果与 weekly 5/1 根因仍未知，继续开放。见
  [history](../../history/2026-11-16-weekly-gc-investigation.md)。不承诺"复现即修复"，不改产品、断言或 retries。

### ③ 可做 Mock 结构化输出 / 契约收敛（不接真实 Provider）

- SGEC（方案 C-2，语法 LLM）：纯离线子项（validator/CLI/测试/合成 fixture）已实施并发布（PR194 main `d33f236`），
  见 [SGEC_OFFLINE_DESIGN.md](../../SGEC_OFFLINE_DESIGN.md) 与 [实施记录](../../history/2026-11-16-sgec-offline-implementation.md)；本包无接线（不接真实 Provider、不接 BKT，不接入 assessment_providers.py）。
- 不把未经用户确认的新接口当"已批准"。

### ④ blocked（需用户裁定 / 设备 / 外部前置，本轮不做）

- **B2 生产切换与真实数据验收**：B1 `46ef954` 已按 [LEARNING_EVENTS_DESIGN.md](../../LEARNING_EVENTS_DESIGN.md) §9 完成本地源码与合成 PG 验证；这里不再等待表/API 业务确认，只待生产维护窗口、停写、DDL/基线/门控、备份复活/法定保留和真实数据授权。历史事件仍无法补录，不并入本轮。
- **阶段 C 预发布环境**：需账号、密钥与费用决定（[ARCHITECTURE_ROADMAP.md](./ARCHITECTURE_ROADMAP.md) §3.6）。
- **周报剩余口径**：“已记录会话时长”名称与技术实现已确认；有效说话时长需媒体/说话区间，`p_mastery` 环比仍缺可比历史快照/事件，见 [TODO.md](./TODO.md)。
- **场景 `goals[]` + Task Completion（方案 D-1，#115）**：先由用户裁定产品口径。
- **发音真实评估 / 会话音频切片采集**：存储、保留期、授权、删除属隐私决定，需用户授权。
- **仓库 required-check 权限 / 防 bot 推送**：需用户在仓库配置。
- **CP-03 / CP-04 设备前置**：需设备证据，见 [TODO.md](./TODO.md)。
- **其余目录迁移**：按 [ARCHITECTURE_ROADMAP.md](./ARCHITECTURE_ROADMAP.md) §7"明确不做"。
- **Compose 真实栈 / 设备服务 / SDK 升级前置**：需外部前置与真实环境证据，未验证前不勾选。

## 推荐顺序（仅建议，非授权）

② 调查已完成；③ SGEC 离线子项已发布，B1 §9 学习事件源码/合成实现也已完成；④ 只余生产切换、真实环境/费用/设备与新业务口径等裁定。
候选先审计收敛范围，再按用户已授范围进入单包实施/独立评审；仅出现新产品口径、契约/权限变化、迁移等才需裁定。

## offline-readiness 准备包阶段状态（2026-11-18，仅记录，非新授权）

- 本地准备包实施已完成，独立 APPROVED R1：SGEC 接线方案、真实链路验收脚本（默认离线 + 未来
  `execute` 子命令受控 GET）、24+24 合成候选与两份单 corpus 盲标模板。候选 `source=synthetic`、
  `review_status=unreviewed`、人工栏全空（filled=0）；live 全部 NOT_RUN。
- 真实执行、正式接线与人工 gold 审定仍待用户后续授权。
