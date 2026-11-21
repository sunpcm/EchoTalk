# SGEC 正式接线方案与离线交付状态

> 状态：本文从文件/函数级接线设计升级为当前已交付的离线接线说明。`codex/sgec-wiring-20261121`
> 已完成 Core 纯离线接线、PG 集成测试代码与受控验收文档；本地合成 PG 定向回归 53 项通过，
> 完整门禁见本 PR 验证。真实 API、真实密钥、生产/应用 DB、迁移、教学质量与人工 gold 仍未执行；
> 真实 LLM Provider 与外部验收取得真实 API 配置后单独验收。SGEC 开关默认 false，运行仍走 DemoRule。

## 1. 目标与边界

把现有 SGEC 严格离线结构校验映射为 I1 领域评估结果
`GrammarEvaluation`/`GrammarFinding`，并把新 `SGECGrammarProvider` 接入默认分析链、BKT 与
learning events。SGEC-OFF 仍是结构校验输入，其固定
`source="offline_synthetic"`、`provider=null`、`model_version=null` 不直接进入 real 持久化；
真实 SGEC 身份事实来自受信调用配置。

复用严格核心校验，不重复造结构校验；标签集合由调用方注入，不硬编码周报六类、不回退 `other`。
任一坏项整批拒绝，不部分接受、不伪造 unknown 版本。

## 2. 现状事实（已读源码）

### 2.1 I1 类型与校验

`backend/services/assessment_providers.py`：

- `AssessmentMetadata(source, provider, model_version, is_synthetic, confidence)`。
- `GrammarFinding(skill_tag, original, corrected, error_type, metadata)`。
- `GrammarEvaluation(metadata, findings: tuple[GrammarFinding, ...])`。
- `GrammarProvider` Protocol：`metadata` + `async evaluate(TranscriptAssessmentInput) -> GrammarEvaluation`。
- `validate_grammar_evaluation`：遇重复 `skill_tag` 是**拒绝**（`ValueError("Duplicate grammar skill")`），
  不是去重；`DemoRuleGrammarProvider` 内部才用 `detected` set 避免重复。

### 2.2 当前接线点

`backend/services/analysis_service.py`：

- `_select_grammar_provider()` 默认返回 `DemoRuleGrammarProvider()`；仅在
  `SGEC_GRAMMAR_PROVIDER_ENABLED=true` 且受信配置齐全时构造 `SGECGrammarProvider`。
- `_detect_grammar_errors(session_id, text, db, *, progress)` 调用 `provider.evaluate` →
  `validate_grammar_evaluation` → 逐 finding 构造 `GrammarError`（id/session_id/skill_tag/original/
  corrected/error_type/source/provider/model_version/is_synthetic/confidence）→ `flush` → 返回 created。
- `analyze_session(...)` 编排发音 + 语法；`update_knowledge`/`_apply_bkt_updates` 只对非合成观察更新 BKT。

### 2.3 SGEC-OFF 与 I1 的差异（不冒充）

`backend/services/sgec_offline.py` 是**结构校验输入**，不去重（允许多个相同 `skill_tag`），metadata
是固定受控输出、不从输入接收。它与 I1 层次不同，可并存；不把 offline batch 输出冒充 I1 实现。

### 2.4 B2 记账约束

`backend/services/learning_event_canonical.py` 的 `build_canonical_observations` 与
`docs/B2_LEDGER_CONTRACT.md`：

- 语法观察按 `(skill_tag, error_type)` 排序并分配规范位置；`build_canonical_observations`
  核重复稳定键并拒绝（`_grammar_stable_keys` helper 本身只取键）。
- mapped 语法观察必须 `skill_tag ∈ valid_skill_ids`、`model_version` 非空、`observation_code`
  （即 `error_type`）非空、`observation_correct=False`。
- 完整批次、七键 coverage、同事务 events/真实 BKT/Job succeeded、生命周期锁 Job→User 均沿 B2。

**关键差异**：I1 按 `skill_tag` 去重拒绝；B2 按 `(skill_tag, error_type)` 排序。首期不能静默压缩多错
或放宽 I1；扩展另行裁定。SGEC adapter 已显式拒绝空 `original/corrected/error_type`，不让
「SGEC 结构接受」直接等于「可入账」。

## 3. 接线方案

### 3.1 DTO 映射

未来 adapter 从 SGEC 核心字段重建 I1 对象，metadata 来自**受信调用事实**而非模型输出：

```text
SGEC finding(skill_tag, original, corrected, error_type, confidence)
  -> GrammarFinding(
       skill_tag, original, corrected, error_type,
       AssessmentMetadata(source, provider, model_version, is_synthetic, confidence))
  -> GrammarEvaluation(metadata, findings=(...))
```

`source/provider/model_version/is_synthetic` 是受信身份事实，由调用方按本次调用事实注入，不取自输入
payload；SGEC 结构校验的 `offline_synthetic`/null 元数据不直接进入 real 结果。`confidence` 是已校验的
可空数值，按 SGEC finding 的 `confidence` 保真映射到 `GrammarFinding.metadata.confidence`
（null 保持 null），不参与身份判定，也不从原始模型 payload 接收受控身份事实。

### 3.2 文件/函数级改动（已交付）

1. 新增纯模块 `backend/services/sgec_adapter.py`：
   - `build_grammar_evaluation(sgec_batch, allowed_skill_tags, metadata) -> GrammarEvaluation`。
   - 先 `validate_sgec_batch` 整批原子校验，再重建 `GrammarFinding` 并 `validate_grammar_evaluation`。
   - 对多错同 `skill_tag` 不做静默压缩：缺省整批拒绝并返回稳定错误码，是否允许去重/合并为待裁定项。
2. 新增 `backend/services/sgec_provider.py` 的 `GrammarProvider` 实现：
   - `metadata` 来自受信事实；`evaluate` 内部调用 adapter。
   - 保持 `DemoRuleGrammarProvider` 为默认，新 provider 由显式配置门控，默认关闭。
3. `analysis_service._select_grammar_provider()` 已增加门控分支（默认仍 demo_rule）。
4. B2 记账前门禁（**已批准契约，不能自行在 unmapped 与拒绝之间二选一**）：
   - `skill_tag ∉ valid_skill_ids`：计入 `unmapped_grammar` 并跳过观察，**不是**整批拒绝；
   - `skill_tag ∈ valid_skill_ids` 但 `model_version` 为空串：`build_canonical_observations`
     抛 `CanonicalObservationError`，**整批拒绝**，不静默 unmapped；
   - mapped 语法观察的 `observation_code`（即 `error_type`）有 DB 非空 CHECK，空串不能入账，
     adapter 必须在入账前显式门禁，不能把「SGEC 结构接受」当作「可入账」。

   七键 coverage、零错误 `evaluated/0`、provider 可 null、mapped 版本 known 非空、完整批次、
   同 Job retry、Job→User 锁、同事务 events/真实 BKT/succeeded 均沿 B2。

5. 真实传输模块 `backend/services/sgec_llm.py` 保持显式参数、默认关闭、严格 JSON、有限超时、
   `max_retries=0` 与安全关闭；解释/建议只存在于离线材料，不进 DB/API。

### 3.3 拆卡

| 卡  | 范围                                                                                     |
| --- | ---------------------------------------------------------------------------------------- |
| A   | 纯 adapter：重建 + 严格校验 + 多错同 skill_tag 门禁，无 DB/网络                          |
| B   | provider 选择门控（默认 demo_rule，显式开关，不改变默认分析）                            |
| C   | B2 记账门禁（unmapped 跳过计数；mapped 空 error_type/model_version 整批拒绝）与 coverage |
| D   | 集成 + 变异测试（unknown 回退 other、coerce、bool、extra 透传、部分接受）                |

### 3.4 测试矩阵

- 合法最小批次、整批坏值零接受、未知 skill_tag、extra/unknown 字段、坏 confidence。
- 重复 `skill_tag`：I1 校验拒绝；B2 稳定键 `(skill_tag, error_type)` 排序/重复拒绝。
- 空 `error_type`（即 `observation_code`）：结构接受但 B2 记账门禁拒绝（mapped `observation_code` 非空）。
  adapter 同时显式拒绝空 `original/corrected`，不把结构接受当作可入账。
- mapped 版本空串：B2 整批拒绝，不伪造 `"unknown"`。
- 零错误：`grammar.status=evaluated`、`result_count=0`、0 条观察（不写正确语法观察）。
- 合成批次：仍保存事件但不读/建/改 `knowledge_states`。

## 4. 失败 / 取消 / 重试 / 回滚

- 任一坏项整批拒绝，不部分接受、不修补、不 coerce、不回退 `other`。
- `asyncio.CancelledError`/异常 → Job 回滚，`failed` 不进 completed，事件与 BKT 整体回滚。
- 失败重试复用同一 Job 与幂等键（`MAX_ATTEMPTS=3`、`RETRY_DELAYS_SECONDS=(5,30)`、stale 5min）。
- 成功后的重新分析本版不开放；锁序 Job→User，同用户串行化。

## 5. 待裁定 / 提案（未批准，不写成已确认）

- 多错同 `skill_tag` 的表示（整批拒绝 / 显式多错误结构 / 合并），首期不静默压缩。
- 文本对齐、纠错阈值、教学准确率、新字段与真实 Provider 模型版本。

## 6. 验收边界

SGEC-OFF 与 SGEC 接线代码已完成离线实现与合成测试代码；离线结构通过不等于教学质量/纠错正确性/
真实模型准确率通过。
`WeeklyGrammarSkillTag.other` 不在当前 `SEED_SKILLS` 十项中，周报六类不是技能全集。真实 Provider、
真实 API、教学质量、生产行为与人工 gold 仍未验。本地合成 BKT/learning-events PG 定向回归
53 项已通过，完整门禁见本 PR 验证。
本包完成不表示正式接线完成。
