# EchoTalk 下一步行动评估

> 2026-11-16。本文件只做行动分层与执行状态，未完成待办以根目录 [TODO.md](../TODO.md) 为唯一来源；
> 不授权任何新产品实现、重构或迁移。本轮前置主线为 `da37683e6579e479f0ab46315555b24c850360da`
> （PR196），mainCI 43846796935 首五 success；WGGC 有界调查完成、缺陷仍开放，未完成待办见 TODO。
> 用户已确认 B2 开发期干净起步、周报 §6/7 口径和相关决策，并授权开发 B2 工作包；阶段 C 只获授权先出
> 资源费用方案。决策见 [NEXT_PHASE_DECISIONS.md](./NEXT_PHASE_DECISIONS.md)，执行门禁见
> [B2 实施计划](./B2_IMPLEMENTATION_PLAN.md)。

## 执行状态

- **A19 RoomSession 所有权收窄**：已完成并已发布（PR190 merged main `0151223`，PR/Guard 首六、mainCI 43788320370
  首五 success）。无用回调/ref 收窄 + 新 4 条同层回归；初始 Web 临时 adapter 经审计非泄漏且保留即时语义。见
  [history](./history/2026-11-16-a19-room-ownership-maintenance.md)。
- **A18 生命周期测试边界收窄**：已完成并已发布（PR191 merged main `0422c9e`，PR/Guard 首六、mainCI 43800300024 首五 success）。移除产品测试注入及
  start/resume 重复的测试选项 plumbing，测试平台假对象移入 test-only fixture。见
  [history](./history/2026-11-16-a18-lifecycle-testing-boundary.md)。
- **SGEC 纯离线契约（SGEC-OFF）**：已发布（PR194 merged main `d33f236`，mainCI 43818985856 首五 success）。纯离线结构校验 + 合成 fixture CLI，未接 default 分析/DB/API/BKT/events。见 [history](./history/2026-11-16-sgec-offline-implementation.md)。
- **Overview 文档**：已发布（PR195 merged main `dac4d25`，mainCI 43836513150 首五 success）。新增技术架构/功能/使用方法导览。

## 行动分层

### ① 现在可做：B2 工作包开发 / 文档与契约审计

- A18 scope 审计已完成并落地实施（见「执行状态」）；当前无新的只读审计候选。
- B2 开发已获用户授权，可先审计旧候选，再从当前 `main` 和本轮决策文件分包开发表结构/迁移文件、
  同事务写入与只读重算校验。每包独立 Review；实际清理、迁移执行、部署和 PG 新表环境另需放行。
- 周报 §6/7 只确认了指标口径；具体指标实现仍须逐项设计、验收，不能以决策确认代替交付。

### ② 有界复现 / 现有 CI 留证分析（WGGC 已完成调查，缺陷仍开放）

- `apps/vite-app/e2e/weekly-grammar.spec.ts` 与 `apps/vite-app/e2e/session-flow.spec.ts` 的 GC/偶发调查已完成：
  corrected60 与全量 E2E 258 均零重试零 flaky，近期无复现；GC 因果与 weekly 5/1 根因仍未知，继续开放。见
  [history](./history/2026-11-16-weekly-gc-investigation.md)。不承诺"复现即修复"，不改产品、断言或 retries。

### ③ 可做 Mock 结构化输出 / 契约收敛（不接真实 Provider）

- SGEC（方案 C-2，语法 LLM）：纯离线子项（validator/CLI/测试/合成 fixture）已实施并发布（PR194 main `d33f236`），
  见 [SGEC_OFFLINE_DESIGN.md](./SGEC_OFFLINE_DESIGN.md) 与 [实施记录](./history/2026-11-16-sgec-offline-implementation.md)；本包无接线（不接真实 Provider、不接 BKT，不接入 assessment_providers.py）。
- 不把未经用户确认的新接口当"已批准"。

### ④ blocked（需用户裁定 / 设备 / 外部前置，本轮不做）

- **B2 的实际数据清理 / 迁移执行 / 部署 / PG 新表验证**：开发期策略与新表代码工作可推进，但这些
  有副作用的操作仍须具体环境与执行放行，保持阻断。
- **阶段 C 资源费用方案**：已获准先出方案，尚无费用或环境授权；账号、密钥、预算和真实服务决策
  （[ARCHITECTURE_ROADMAP.md](./ARCHITECTURE_ROADMAP.md) §3.6）另批处理。
- **周报指标实现、自然周快照与有效练习时长**：口径已确认，但真实评估输入、快照设计和实现仍未完成，见 [TODO.md](../TODO.md)。
- **场景 `goals[]` + Task Completion（方案 D-1，#115）**：先由用户裁定产品口径。
- **发音真实评估 / 会话音频切片采集**：存储、保留期、授权、删除属隐私决定，需用户授权。
- **正式用户 retention / 删除 / 导出**：开发期丢弃旧测试资料不批准正式政策，上线前须另定。
- **仓库 required-check 权限 / 防 bot 推送**：需用户在仓库配置。
- **CP-03 / CP-04 设备前置**：需设备证据，见 [TODO.md](../TODO.md)。
- **其余目录迁移**：按 [ARCHITECTURE_ROADMAP.md](./ARCHITECTURE_ROADMAP.md) §7"明确不做"。
- **Compose 真实栈 / 设备服务 / SDK 升级前置**：需外部前置与真实环境证据，未验证前不勾选。

## 推荐顺序（仅建议，非授权）

② 调查已完成；③ SGEC 离线子项已发布，真实 Provider 接线仍待；① B2 按 [实施计划](./B2_IMPLEMENTATION_PLAN.md)
逐包开发/独立评审，实际有副作用的迁移、清理与部署仍留在 ④；阶段 C 先从资源费用方案开始。
出现新产品口径、正式数据政策、契约/权限变化或执行放行需求时停下裁定。
