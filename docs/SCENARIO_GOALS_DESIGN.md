# 场景 goals 与 Task Completion 设计（GOAL-DESIGN）

> 状态分层：第 1–6、8–9 节保留 **GOAL-DESIGN / GOAL-DATA** 各自历史卡的时点、数字和边界；
> §7 在保留原决策项的同时写明后续确认/实施状态；§10 保留 G-CONTRACT 已发布的业务合同，并
> 由 G-WIRE、G-EVAL 与 G-VIEW 的落地状态更新当前说明。
> GOAL-DATA 已 Review APPROVED 并发布为 353e0c9，G-CONTRACT 发布为 882a1a9，G-WIRE 随后发布
> 为 2d6a916 并作为历史接线快照保留。G-EVAL 已实现 append-only run/results、completed 同事务
> 唯一 revision 1、精确学生 IDs/顺序/digest、四结果规则、worker 生命周期、owner-scoped goals
> GET、v3 同 RR 导出与整账号删除，并独立 APPROVED、正常 commit/push 为 3889e294。G-VIEW 已实现
> 目标预览、受控轮询、四状态与无百分比汇总。PR #197 RC1 修复两个 bot 报告的真实判定问题，将
> evaluator 升为 `deterministic-goal-v2`；本地目标 87/87、独立 22/22。四份文档已准备本轮收口，
> 完整 E2E 322 项已通过，12 个行为门禁全 0；四文档后的主控 format 为第 13 项。详细数字与
> 负对照历史数字见归档 PROJECT_STATUS；本文件不自称 APPROVED，用户 Review 待，最终
> format/Review/提交发布以主控同卡回执为准。
> 本页保留技术设计与原时点验收边界；当前功能、实施进度、待办与未验收只以根目录 [TODO 总账](../TODO.md) 为准。

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
GOAL-DATA 只落实该数据/版本化/privacy 合同；后续 `G-CONTRACT` 已确认采用 A、首批目标内容和
判定/展示口径，但目录内容、创建会话接线、判定与界面尚未实施，B/C 方案不采用。

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
完成。原草案的状态映射已由后续 `G-CONTRACT` 确认；当前代码仍没有自动判定器或结果产品状态。

## 5. 判定器候选

- (a) 确定性规则：必要句型/信息点命中，成本低但语义弱。
- (b) 人工/用户确认：适合初期标注与 gold 集，主观性需标注。
- (c) LLM 语义判定：需冻结 prompt/model/version、输出证据引用、confidence 与执行失败/不可判规则。

推荐初期 (a)+人工确认建立可审计闭环，LLM 仅作后续经用户批准的第三种 adjudicator，不默认真实
Provider、不新增录音。证据默认引用 transcript/assessment/job 的 ID 或有序范围，不复制原文。
该边界已由后续 `G-CONTRACT` 确认，当前尚未实施。

## 6. 总体完成度候选

- (a) 不展示汇总，只列每个 goal 状态（最保守）。
- (b) 显示 `achieved X / assessed Y / total Z`，不做百分比（推荐，后续已确认）：`X`=achieved 数，`Y`=achieved+not_achieved（成功判定数），`Z`=生效目标数，`0 ≤ X ≤ Y ≤ Z`；`unknown` 与 `not_assessed` 分开计、不计入 X/Y。
- (c) 仅在全部 goal 均成功评估后显示百分比。

没有目标定义、分母为 0 或部分未知分母时不得显示 100%/0%，并须明确标出未评估数量；存在
`unknown/not_assessed` 时不能用部分结果冒充整体完成。若未来允许重判，只能作为新的独立派生判定
`revision`，不改变原判，也不借此放开既有成功 analysis Job 重跑。

## 7. 原决策清单（历史草案与当前确认）

下列编号保留原草案结构；状态已按 2026-11-16 用户确认更新。历史卡当时“待确认”的事实不改写为
更早已经批准。

1. **已确认采用 A**：目标放在版本化 material 目录；B/C 不采用。
2. **已确认并完成接线**：GOAL-DATA 已实现 material/version 目录与 session snapshot 数据层；
   G-WIRE 已发布，首批目标内容和创建会话 API 接线已完成。

3. **已完成后端与展示**：achieved / not_achieved / unknown / not_assessed 四终态及
   pending / running 独立执行进度由 G-EVAL 持久化，G-VIEW 已接入受控轮询和结果展示。
4. **规则后端 RC1 已实现，人工 gold 待标注验证**：确定性规则已由 G-EVAL 实现并落盘四结果；
   PR #197 RC1 将 evaluator 升为 v2，修复直接自述证据边界与同 utterance 正反证据冲突，并保留
   整 utterance 引用/报告/假设门禁。旧 pending v1 保留 header/evidence 并由既有版本 guard 判
   `not_assessed`，旧成功 v1 不重判。离线人工 gold/复核与真实教学质量仍未完成；不启用真实 LLM，
   不允许用户自评覆盖判定，无法可靠判断时输出 unknown。

5. **合同已确认并完成展示**：总体 achieved X / assessed Y / total Z、
   0 ≤ X ≤ Y ≤ Z 与 unknown/not_assessed 分列已由 G-VIEW 接入；后端 counts 由 G-EVAL 提供。
6. **已完成后端与隐私配套**：新增 goal/evaluation/revision 数据进入账号结构化导出，并在既有
   整账号删除事务内同步删除。GOAL-DATA 覆盖目录/快照；G-EVAL 已补齐 v3 同 RR 导出与整账号同事务
   删除。

## 8. 拆卡与验收边界

本节保留旧拆卡及当时的完成事实；`G-CONTRACT` 已将后续范围重新拆为 §10 的四张卡。

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
> 新 36 目标测试。该卡后续已独立 Review `APPROVED` 并发布为
> `353e0c9f61693d0e1134843abd25da61bb7df1fa`；下述 `FINAL_READY`、返修和门禁数字保留为当时的
> Review 时点。GOAL-DATA 不包含创建接线、判定结果持久化、总体汇总或展示，这些由 §10 的后续卡
> 承担。

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
  只集中在 [PROJECT_STATUS](./archive/2026-11-21-document-consolidation/PROJECT_STATUS.md#goal-data-goal-a-持久化与合成-pg-数据层final_ready)。

### 9.6 非目标

- 本卡未实现判定器、四状态、总体完成度、周报派生指标或正式 i18n。判定与四状态后端后来由
  G-EVAL 实现；总体展示仍待 G-VIEW。
- 不填 10 条真实课程 goals，不改教学内容、scenario_id、BKT/Job、恢复 UI 或录音策略。
- 不声称真实 Provider、真实课程数据、教学效果、实际恢复流程或生产不可恢复性已验收。

## 10. G-CONTRACT 当前实施合同（`DRAFT_READY`）

### 10.1 状态与边界

- G-CONTRACT 合同已 APPROVED 并发布 882a1a9；本节标题保留既有 DRAFT_READY 锚点。
  G-WIRE 已发布 2d6a916 并作为历史接线快照；G-EVAL 已独立 APPROVED 并正常 commit/push 3889e294。
  G-VIEW 在该基线实现目标预览、受控轮询和四状态/汇总展示；四卡实现及合成验收已收口。
- PR #197 RC1 修复两个 bot 报告的真实判定问题，evaluator 当前为 `deterministic-goal-v2`。
  本地目标 87/87（67 纯规则 + 20 持久化 worker）与独立 22/22 已通过；旧 v1 加载负对照为
  75 passed / 12 项具体 AssertionError，去版本 guard 变异为 1 selected / 1 项具体
  AssertionError，两项 driver 均为 0。
- 四份文档已完成本轮收口；完整 E2E 322/322 已通过，12 个行为门禁全 0，四文档后的主控 format
  为第 13 项。完整实现、失败序列、保护边界和 PG 清理的历史数字见归档 PROJECT_STATUS；最终
  format/Review/提交推送/新 head CI/合并以主控同卡回执为准，用户 Review 待。
- 用户已确认 goal A、首批目标内容、四终态与无百分比汇总口径。判定与持久化遵守原判不可改、
  首期唯一 revision 1、仅学生证据、success analysis 不重跑和整账号同事务删除；详细实现与历史数字见归档 PROJECT_STATUS。
- 旧 pending v1 的 header/evidence 原样保留，由既有版本 guard 判 `not_assessed`；旧成功 v1 不重判。
  goal/material 版本、schema 与 20 份旧迁移保持；RC1 不新增迁移或重判入口。
- 本文件冻结业务合同、状态/汇总不变量与拆卡边界；没有新增业务开关、分数、阈值、重判入口或用户
  自评覆盖。

### 10.2 首批目标内容与目录兼容

| 首期课程 | 两个目标                                                      |
| -------- | ------------------------------------------------------------- |
| 商务寒暄 | 介绍自己的姓名及工作/角色；向对方提出一个与其工作相关的问题   |
| 酒店入住 | 表达入住需求并说明有无预订；询问退房时间                      |
| 餐厅点餐 | 明确点一道菜或饮品；说明一项偏好/限制，或明确表示没有特殊要求 |

- 中英文目录均使用既有版本化 material/goal 结构。首期只给以上 3 课各 2 个 goal；其他 7 课保持
  `goals=()` 与旧目录兼容。
- 商务寒暄目标 2 明确指询问**对方的工作**，不能泛化为询问自己的工作情况；其他 5 个目标保持
  上表内容。
- goal 只描述可观察的交际任务。不得把文本中的发音或重音作为判定项，也不得因关键词未命中直接
  判失败。

### 10.3 G-WIRE 已核技术约束与计划验收

以下约束原由主控核对，现由 G-WIRE 按原边界实现；标题保留既有计划锚点。R1 已修正 curriculum
从检索投影误读目标字段的问题，改为仅在显式 opt-in 时按检索 `material.id` 关联受控
`CatalogMaterial` 元数据。G-WIRE 后由主控独立 APPROVED 并发布为 2d6a916；历史数字见
PROJECT_STATUS。

- **旧请求兼容**：`POST /sessions` 不带目标时，请求语义和既有 `Idempotency-Key` fingerprint
  字节保持不变。旧客户端不得因目标能力上线而改变重放或错误行为。
- **绑定输入最小化**：新可选输入仅为 `goal_binding={material_id, material_version}`。服务端用
  当前目录校验该引用，并在创建 Session 的同一事务写入不可变目录记录和 snapshot；拒绝客户端
  传入 `goals`、判定结果或其他可伪造判定输入。
- **目录读取与提交时序**：前端在 await 前冻结 `material_id/material_version`；只有
  `mode=scenario` 时才提交该引用。`GET curriculum` 可显式 opt-in 获得
  `goal_binding`（ID/version 与 curriculum API 目标预览字段），默认旧响应保持不变；其他 7 课返回
  无目标兼容结构。用户界面目标预览已由 G-VIEW 以纯文本列表接入。
- **创建与幂等**：带目标创建时，必须先锁 User 再插入 Session，避免两个 Session 先各持 User
  FK key-share、再升级 `FOR UPDATE` 时形成死锁。已有 `Idempotency-Key` 重放必须先按原
  fingerprint 返回原 snapshot，即使目录随后发布新版本，也不得借重放改绑新版本。
- **既有字段与内容**：`sessions.scenario_id` 的整数旧字段不填、不做 material ID 转换或双向
  映射。首期三课新增的 6 个版本化 goal 只改变目标元数据；原 material 文档、排序和技能标签
  保持不变。
- **当前落地与验收**：首批 3 课 × 2 个中英文目标、默认 curriculum 兼容、显式 opt-in API 预览字段、
  最小 binding 请求、服务端目录校验、同事务 catalog+snapshot、User→Session 锁序、旧 fingerprint
  兼容和 scenario-only 提交均已实现；真实 backend 目标定向通过，仅使用主控合成 PostgreSQL 和
  合成目标数据。R1 历史与完整数字见 `PROJECT_STATUS.md`。通过结果不证明真实外部 Provider、IdP、
  LiveKit、媒体或教学效果；用户界面预览/dashboard 行为由后续 G-VIEW 单独验收。

### 10.4 判定生命周期与终态

- 只在会话进入 completed 后，针对该会话冻结的 goal 版本和转录证据范围启动自动判定。active 或
  cancelled 默认不自动判定，也不等于失败。
- `pending / running` 是执行进度，界面单独显示为“评估中”，不能冒充四种终态。
- 终态固定为：
  - `achieved`：证据充分且明确满足目标。
  - `not_achieved`：证据充分且明确不满足目标。
  - `unknown`：证据不足、证据范围不完整，或应执行但判定执行失败；不得写成学生失败。
  - `not_assessed`：未启用、未运行或不适用于该会话/目标。
- 首期判定为确定性规则加离线人工 gold/复核；仅学生发言可作为达成证据。不启用真实 LLM，不让
  用户自评覆盖判定；无法可靠判断时保持 `unknown`。
- evaluator v2 将肯定证据限制在可靠直接自述或分句，并保留整 utterance 引用、报告、假设与非直接
  语境门禁。同一 utterance 或跨 utterance 的正反证据分别收集后统一判 `unknown`；不通过枚举
  否定短语、修改已存 header/evidence 或将任意 `not/no` 前缀当作姓名来处理。

### 10.5 结果、汇总、版本与隐私

- 冻结集合目标数为 `Z`，`X` 为 `achieved` 数，`Y` 为 `achieved + not_achieved` 数，
  必须满足 `0 ≤ X ≤ Y ≤ Z`。`unknown` 与 `not_assessed` 分开计数；禁止用部分结果计算百分比。
- 汇总示例统一解释为 `1 / 2 / 4`，另有 `1` 项无法判断、`1` 项未评估；界面不得把示例折叠成
  完成率或伪造 `100% / 0%`。
- 无目标配置的历史或新建会话显示“未配置”，不伪造 goal 行，也不显示 `0 / 0`、`0%` 或 `100%`。
- 原判不可修改。后续重判必须创建新的 `revision`，首期不提供任意重跑入口，也不重跑已成功的
  analysis Job。
- 新目标与判定数据必须进入账号结构化导出，并与既有整账号删除在同一事务中删除。证据只保存
  transcript/assessment/job 的 ID 或有序范围，不复制正文、不新增录音。
- 合同验收只证明结构与确定性规则行为，不声明真实教学效果、真实 Provider 能力或生产质量。

### 10.6 G-EVAL 实施合同、只读读取与导出边界

- completed 结束事务为已绑定 snapshot 的会话创建唯一 revision 1 run；active/cancelled 不自动
  判定。append-only run header 与 per-goal results 保留不可变终态，首期无重判入口。
- completed 结束事务创建 run 时冻结精确 user transcript IDs、顺序与 digest；worker 只读取并验证；
  证据只引用既有记录，不复制正文、不新增
  录音。首批 6 个 goal 使用确定性规则输出四结果，不可靠或执行失败为 unknown，未运行/不适用为
  not_assessed；success analysis Job 不重跑。
- 旧 pending v1 run 保留 header 与 evidence，由既有版本 guard 判 `not_assessed`；旧成功 v1 保持原
  结果、不重判。RC1 只将新判定版本升至 v2，不改变 goal/material 版本、schema 或 20 份既有迁移。
- worker 在同一进程公平轮询，每轮最多 1 goal + 1 analysis，各自事务、失败隔离并保留停止/
  drain/stale 恢复。pending/running 只表示进度，与四终态分离。
- GET /api/sessions/{id}/goals 使用 owner-scoped 单 SELECT；无 snapshot 返回
  configured=false，有 snapshot 无 run 派生 not_assessed，GET 不创建 run 或修改 session。
- v1/v2 导出保持；显式 v3 在同一 repeatable-read 快照返回完整 goals/run/results，整账号删除在同一
  事务内删除新记录。真实外部服务、生产数据、人工 gold 准确率、设备与远端 CI 未验。
- G-VIEW 已接入用户界面目标预览、受控 pending/running 轮询、四终态与
  X / Y / Z + unknown / not_assessed 展示；严格解析、auth/session/lifecycle 隔离和未配置/404
  区分由独立查询合同验收，browser 截图与私有控件/加载变异的历史证据见归档 PROJECT_STATUS。

### 10.7 四卡拆分

| 卡           | 技术实现与当前验收状态                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `G-CONTRACT` | 已独立 Review `APPROVED` 并发布 `882a1a9853f37235d0a1ef5f1521e8d01d422ada`；冻结批准内容、状态含义、汇总不变量、四卡边界和文档状态，作为历史合同保留。                                                                                                                                                                    |
| G-WIRE       | 已独立 Review APPROVED 并发布 2d6a916；首批版本化 goals、snapshot 创建接线、curriculum opt-in 预览、旧指纹兼容和合成 PostgreSQL 验收完成。历史数字见 PROJECT_STATUS。                                                                                                                                                     |
| G-EVAL       | 已独立 Review APPROVED 并正常 commit/push 3889e294；PR #197 RC1 将 evaluator 升为 v2，修复两个 bot 报告的真实判定问题；目标 87/87、独立 22/22、完整 E2E 322/322 已通过。旧 pending v1 由版本 guard 判 `not_assessed`，旧成功 v1 不重判；当前进度与未验边界见根目录 [TODO 总账](../TODO.md)。                              |
| `G-VIEW`     | 已实现课程目标预览、受控 pending/running 轮询、四终态、`X / Y / Z`、独立 `unknown / not_assessed` 和未配置/404 区分；无百分比、重判入口或新业务开关。四卡实现及合成验收收口，原时点范围无未实现功能；用户 Review、人工 gold、真实教学质量与外部环境未验。完整数字见历史归档；当前状态只看根目录 [TODO 总账](../TODO.md)。 |
