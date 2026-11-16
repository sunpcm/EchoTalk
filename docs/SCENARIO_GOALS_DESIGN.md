# 场景 goals 与 Task Completion 设计（GOAL-DESIGN）

> 状态分层：第 2–8 节保留原 **GOAL-DESIGN** 历史设计卡的时点与未批准口径；§9 的
> **GOAL-DATA** 是后续独立实施卡，当前为 `FINAL_READY`。原设计卡写“未实施/业务未确认”只描述
> 其在 `codex/B1-learning-events-20261112@929fb0ea91d2c9937c1414be192e5f5cad47d02c` 上的历史
> 状态，不否定后续批准。GOAL-DATA 只确认 goal A 的 material/version 目录、session snapshot、
> 默认 v1/显式 v2 导出、整账号删除 privacy 和 synthetic PG 数据层；判定器、四状态、总体汇总、
> 真实课程 goals/教学内容、周报剩余指标及正式 i18n 仍待确认。设计基线仍为冻结
> `1d75250824e9b50173ac20f0faed928240e54208`；正式返修 `R1/2`，本文件不自称 `APPROVED`；
> 最终 Review/commit/push 以主控同卡回执为准，用户 Review 待。
> 状态与数字见
> [PROJECT_STATUS 的 GOAL-DATA 小节](./PROJECT_STATUS.md#goal-data-goal-a-持久化与合成-pg-数据层final_ready)。

## 1. 原 GOAL-DESIGN 范围与非目标（历史）

- 历史范围：场景目标（scenario goal）的持久化、生效版本/快照、完成判定与状态机、总体完成度
  展示口径。
- 原设计卡的非目标：该卡本身不改 DB/API/目录/前端，不决定录音留存授权，不把 `scenario_id`
  自动补填，不启动真实 Provider，不重定义每日 20 轮，不放开既有成功 analysis Job 重跑，不复制
  转录正文、不新增录音。
- 后续变化：GOAL-DATA 已为 goal A 新增两张表、目录 optional 结构、caller-owned service、owner
  scoped 读取、显式 v2 export 与删除配套；判定器、状态机、汇总和真实课程内容仍未实施。

## 2. 代码事实与边界

- 课程目录 `backend/data/teaching_materials.json` 只有 10 条 material
  （`id/document/scenario_name/difficulty_cefr/category/primary_skill/skill_tags/priority`），没有
  `goals[]`、任务清单或完成判据；校验器在 `backend/services/material_catalog.py`。`material.id` 是
  `mat_biz_greet_b1` 等字符串，不能直接填入 `sessions.scenario_id`（nullable Integer），两者语义不同，
  本卡不建映射、不改表。
- 创建会话请求 `backend/schemas/session.py::SessionCreate` 只有 `mode` 与 `doc_context`；
  `sessions.scenario_id` 存在但当前创建路径未填。前端只在内存冻结 `selectedScenario.scenario_name`
  用于标题，不落库；恢复会话时 `scenarioName=null`。旧客户端、DocTalk/临时对话与既有恢复缺素材
  版本时应保持兼容，不强行要求 goal；不从前端标题、每日 20 轮或历史 `completed` 反推“已达成”。
- 现有“goalReached”不是场景任务完成：`apps/vite-app/src/components/dashboard/DailyProgress.tsx` 仅用
  当日总转录条数 `totalTurns >= 20`。`user_profiles.learning_goals` 是长期偏好数组，不是本次场景目标。
  `SessionStatus` 有 completed/cancelled；结束 completed 会创建分析 Job，本版成功后不重新分析。

## 3. 目标持久化方案（A/B/C）

### A. 目录内版本化目标（GOAL-DATA 已确认数据合同）

每条 material 可增加 optional `goals[]` 与 `material_version`；goal 使用稳定
`goal_id={material_id}:{slug}`、独立 `goal_version`、中英文描述、结构字段与声明式 criteria。
会话 snapshots 只引用已记录的 material/version，不复制目录 JSON。旧 10 条 JSON 不含这些字段时
仍按 `goals=()`、`material_version=None` 载入；当前生产目录不填 goals，也不写教学内容。
GOAL-DATA 只确认该数据/版本化/privacy 合同；goal 内容、判定、报表比较及 B/C 方案仍未确认。

### B. 运行时动态生成 goals

按用户弱项/LLM 动态生成，体验灵活且可审计，但必须额外持久化生成版本、生效快照、去重与证据归属，
维护成本高于 A；在真实 Provider 与评测口径未批准前不推荐。

### C. 仅前端本地 checklist

改动最小，但换端/恢复丢失，无法解释推荐与学习结果，只能作原型，不作为数据口径。

## 4. 完成判据与状态机

把“练习量”与“语义任务完成”彻底分开：轮次/20 与已记录时长仍是练习量；场景 Task Completion 只由
goal 判据得出。每个 goal 输出 `achieved / not_achieved / unknown / not_assessed`：

- `achieved`：评估成功且判据明确满足。
- `not_achieved`：评估成功且判据明确未满足。
- `unknown`：证据不足，或执行失败（超时、异常、坏输出，或计划已启用且应执行的 Provider 调用未完成/失败），**不是**学生失败。
- `not_assessed`：目标不适合该会话，或未运行判定（含主动未启用/未运行 Provider）。

会话 cancelled 不自动等于 goal 失败；completed 会话中 goal 未满足可判 `not_achieved`，但不阻止会话
完成。该状态映射本身仍是待确认推荐，不伪装已有产品状态。

## 5. 判定器候选

- (a) 确定性规则：必要句型/信息点命中，成本低但语义弱。
- (b) 人工/用户确认：适合初期标注与 gold 集，主观性需标注。
- (c) LLM 语义判定：需冻结 prompt/model/version、输出证据引用、confidence 与执行失败/不可判规则。

推荐初期 (a)+人工确认建立可审计闭环，LLM 仅作后续经用户批准的第三种 adjudicator，不默认真实
Provider、不新增录音。证据默认引用 transcript/assessment/job 的 ID 或有序范围，不复制原文。

## 6. 总体完成度候选

- (a) 不展示汇总，只列每个 goal 状态（最保守）。
- (b) 显示 `achieved X / assessed Y / total Z`，不做百分比（推荐，待确认）：`X`=achieved 数，`Y`=achieved+not_achieved（成功判定数），`Z`=生效目标数，`0 ≤ X ≤ Y ≤ Z`；`unknown` 与 `not_assessed` 分开计、不计入 X/Y。
- (c) 仅在全部 goal 均成功评估后显示百分比。

没有目标定义、分母为 0 或部分未知分母时不得显示 100%/0%，并须明确标出未评估数量；存在
`unknown/not_assessed` 时不能用部分结果冒充整体完成。若未来允许重判，只能作为新的独立派生判定
`revision`，不改变原判，也不借此放开既有成功 analysis Job 重跑。

## 7. 决策清单与当前批准状态（待用户确认）

1. 目标持久化方案：GOAL-DATA 已确认 A 的 material/version 目录与 session snapshot 数据合同；
   B/C 方案仍未确认。
2. `material_id/material_version` 与 goal snapshot 持久化：数据合同与 synthetic PG 实现已确认；
   生产目标内容与当前创建路径接线未确认。
3. 状态机：`unknown / not_assessed / not_achieved / achieved` 的边界与执行失败归为 `unknown`
   仍待确认，没有判定器或状态产品实现。
4. 判定器：初期确定性规则 + 人工确认、LLM 后续经批准启用，仍待确认和实现。
5. 总体完成度：`achieved X / assessed Y / total Z`、不展示或全评估后百分比，均仍待确认。
6. 新 goal/evaluation/revision 的结构化导出与同事务整账号删除前置仍必须保持；GOAL-DATA 已对
   两张新表完成该 privacy 配套，不扩大为未批准判定数据。

## 8. 拆卡与验收边界

- 卡 1 的 goal schema、optional 目录兼容与新迁移已由 GOAL-DATA 完成；旧 18 份迁移保持原字节。
- 卡 2 的目录/快照写原语、同绑定幂等、版本保留、owner 校验和调用方事务原子性已完成；当前创建
  会话 API 尚未调用 snapshot 写原语，历史会话没有 snapshot，也没有回填。
- 卡 3 的 completion adjudicator 与四状态、卡 4 的 UI/周报展示与历史版本产品流程均未实现。
- 合成验收覆盖 strict schema、稳定 id/版本、旧目录兼容、目录幂等/异内容、两版本保留、snapshot
  首次 active、completed/cancelled 拒绝、同绑定/变更绑定、跨账号、caller rollback、并发锁、
  v1/v2 export 和账号删除全回滚。这只是数据合同与工程行为验证。
- 合成目标不等于生产课程 goals；没有把 10 条真实课程内容写入目录，没有声称实际恢复 UI 或教学
  效果已验。真实会话、人工 gold、判据质量、四状态和总体完成度仍须用户确认后另卡验证。

## 9. GOAL-DATA 数据持久化合同（`FINAL_READY`）

> 状态：GOAL-DATA 已实现 goal A 的最小数据层，并通过主控完整 12 项门禁、机器 behavior 核验和
> 新 36 目标测试；正式返修仍为 `R1/2`。判定器、四状态、总体完成度、真实课程内容、周报与正式
> i18n 均未获批准，不在本卡实施。最终 Review/commit/push 以主控同卡回执为准，用户 Review 待；
> 本文不自称 `APPROVED`。

### 9.1 目标结构与目录

- `GoalDefinition` 为 strict/frozen；`goal_id={material_id}:{slug}` 稳定，每个 goal 有独立
  `goal_version`。material 独立使用 `material_version`，不得与 sessions 的 integer
  `scenario_id` 互填。材料 ID 是稳定 ASCII slug，允许连字符，拒绝空白、额外 colon 等非法结构。
- strict int 拒绝 bool 和字符串；合法 JSON array 规范为 immutable tuple。`criteria` 只是声明
  文本，`evidence_types` 只是非空结构字符串；二者没有判定语义，也不声明或读取真实证据。
- `CatalogMaterial` 增加 optional `goals: tuple[GoalDefinition, ...]` 与
  `material_version: int | None`。旧 10 条 JSON 不含新字段时保持 `goals=()`、
  `material_version=None`；生产 JSON 与教学内容不改。

### 9.2 两张不可变表

- `goal_catalog_versions`（全局目录）：复合主键 `(material_id, material_version)`；严格校验的
  完整 `goals` JSONB 与 `created_at`。新版本追加；同版本同内容幂等返回，同版本不同内容拒绝；
  两个不同版本可并存。
- `session_goal_snapshots`（个人数据）：`session_id` 为主键并 FK `sessions.id`；
  `(material_id, material_version)` 复合 FK `goal_catalog_versions`，引用时使用 `RESTRICT`。
  不复制 goals JSON，不冗余 `user_id`；owner 始终由 session join 推导。快照随整账号删除，仍被
  引用时目录版本禁止删除。
- 模型、新迁移的主键/FK/check 互相一致。两表都由数据库 trigger 拒绝直接 SQL UPDATE；旧 18 份
  迁移保持原字节，新迁移由主控亲审。

### 9.3 写读原语与事务

- `record_goal_catalog_version(db, *, material_id, material_version, goals)`：追加、幂等或拒绝异
  内容；普通读取不持有 `FOR UPDATE`，不会阻塞另一事务插入合法 snapshot。同版本并发仍保持幂等。
- `write_session_goal_snapshot(db, *, user_id, session_id, material_id, material_version)`：
  锁 User 后以 owner + session 条件读取最小元数据，不锁其他账号 Session，再执行 FK 写入。首次
  snapshot 只允许 active；completed/cancelled 拒绝。同 binding 幂等，已绑定后 completed 仍可读
  旧值；version/binding 变更拒绝，跨账号读写拒绝。
- service 不 commit/rollback，由 caller 拥有事务。新 Session 可先 `flush()`，再在同一事务写入
  snapshot；caller rollback 使新 Session 与 snapshot 一起回滚。两连接并发相同 binding 不会产生
  死锁；被拒绝的跨账号事务不锁 victim session。
- 当前创建会话 API 尚未调用 `write_session_goal_snapshot`，历史会话没有 snapshot；无回填、无
  restore UI 接线，也不预填 10 条生产 goals。

### 9.4 v1/v2 结构化导出

- v1 八个顶级字段与 `SessionExport` 五个字段完全保持；默认
  `build_user_data_export(...)` 调用参数和旧 schema 文案/默认/字段不变。
- HTTP query 显式接受整数 `schema_version`，默认 1，仅允许整数范围 1–2；OpenAPI 使用
  `minimum=1`、`maximum=2`、`default=1`，不是 enum。`schema_version=2` 才在同一 repeatable-read/read-only 事务内，以严格投影返回完整生效
  snapshot + 不可变目录定义；默认请求仍走 v1。
- 坏目录/坏结构统一返回 500，且不发送下载成功头；v2 全量目标只返回本人数据。生成物
  `backend/openapi.json` 与 `apps/vite-app/src/lib/api.generated.ts` 由主控机械生成，本节点不写。

### 9.5 删除、并发与验证边界

- `delete_user_account` 在既有整账号事务内删除快照；失败整体回滚，其他用户数据不变。隐私配套
  不依赖 v2 导出的成功。
- 新 36 目标测试全绿；3 个私有变异各命中一个具体 assertion failure，未选中项不算覆盖，恢复后
  36 例重绿。两独立真实 PG 锁探针在 R1 均为 `0 blocker`；迁移 up/down/re-up 与 ORM diff 均为
  0；旧虚构 session scenario_id 17 保持且哨兵清理。
- RED 历史为 28→34；首交 `16 pass / 18 fail`（17 个 fixture 连字符材料 ID regex 被旧策略拒绝、
  1 个 HTTP `schema_version` 为 422）另加 format `exit 1`。这不是 18 个独立产品回归，首交未部署。
  R1 两锁例先为 `2 selected / 2 具体 assert fail / 34 deselected`，修四类问题后 36 绿。
- synthetic PostgreSQL 身份已验证并清理：`stop 0`、`auto_removed=true`，exact ID
  `a97fd3ae372cfdd3021f6e1cc1c2901246ffef620def5f49a7568d3be7b84d35`，其他资源未动。详细数字
  只集中在 [PROJECT_STATUS](./PROJECT_STATUS.md#goal-data-goal-a-持久化与合成-pg-数据层final_ready)。

### 9.6 非目标

- 不确认判定器、四状态、总体完成度、周报派生指标或正式 i18n。
- 不填 10 条真实课程 goals，不改教学内容、scenario_id、BKT/Job、恢复 UI 或录音策略。
- 不声称真实 Provider、真实课程数据、教学效果、实际恢复流程或生产不可恢复性已验收。
