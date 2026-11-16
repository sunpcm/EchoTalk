# 场景 goals 与 Task Completion 设计（GOAL-DESIGN）

> 状态：`FINAL_READY`。本卡只产出待确认设计草案，未实施、未获业务批准。用户此前仅批准方案 A 的
> “已记录会话时长”（WD-DESIGN/API/UI 三卡）；本卡 goal 持久化、判定器与总体完成度各选项均待确认。
> 设计基线：`codex/B1-learning-events-20261112@929fb0ea91d2c9937c1414be192e5f5cad47d02c`。
> 实施节点不安装依赖、不改代码/测试/迁移/锁、不运行测试/服务/PG，不执行 Git 写操作（允许只读核基线）；
> 主控 12 项行为/工程门禁已全 `exit 0`（机器核验 behavior `0`），数字集中在
> [PROJECT_STATUS 的 GOAL-DESIGN 小节](./PROJECT_STATUS.md#goal-design-场景-goals-与-task-completion-设计final_ready)。
> 合成验收不替代业务确认或真实环境，不称真实准确率或教学效果；最终全仓 format/独立 Review/正常 commit/本分支 push 见主控同卡回执，用户/业务确认仍待。

## 1. 范围与非目标

- 范围：场景目标（scenario goal）的持久化、生效版本/快照、完成判定与状态机、总体完成度展示口径。
- 非目标：本轮不改 DB/API/目录/前端，不决定录音留存授权，不把 `scenario_id` 自动补填，不启动真实
  Provider，不重定义每日 20 轮，不放开既有成功 analysis Job 重跑，不复制转录正文、不新增录音。

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

### A. 目录内版本化目标（推荐，待确认）

每条 material 增加 `goals[]`，稳定 `goal_id=material_id:slug`、`goal_version`、中英文描述、证据类型与
可判定 criteria。会话创建时持久化 material id/version 与生效 goal 集，报表只比较同版本；目录演进时
保留旧版本映射，不改写历史会话。`scenario_id` 仍保留旧语义，不改为 material 字符串。

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

## 7. 决策清单（待用户确认）

1. 目标持久化方案选 A / B / C（推荐 A 目录内版本化目标）。
2. 是否新增 `material_id/version` 与 goal 快照（推荐是；映射/迁移合同另建，本卡不改表）。
3. 状态机确认：`unknown / not_assessed / not_achieved / achieved` 的边界与执行失败归为 `unknown`。
4. 判定器确认：初期确定性规则 + 人工确认，LLM 仅经批准后启用。
5. 总体完成度：`achieved X / assessed Y / total Z`（推荐 b）/ 不展示 / 全评估后百分比。
6. 新持久化 goal/evaluation/revision：账号结构化导出与同事务整账号删除是**必须配套的实施前置**，
   未准备好只能延期新增（本卡不实施）。

## 8. 拆卡与验收边界

- 卡 1：goal schema 与目录版本/迁移合同；卡 2：创建会话持久化 scenario/material/goal 快照；
  卡 3：completion adjudicator 与状态机；卡 4：UI/周报展示及历史版本兼容。
- 合成验收：10 条目录全量校验、稳定 id/版本、会话恢复、cancelled/failed/no evidence、多目标部分
  达成、重判 append-only、同用户归属与跨账号保护。
- 真实验收：用户确认产品口径后，用真实会话与人工 gold 评估判据质量；不能用合成目标或规则命中数
  宣称教学有效性。
