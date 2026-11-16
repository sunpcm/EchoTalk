# SGEC 旧离线产出复用设计 — 设计与复核记录

> 日期：2026-11-16；任务包：SGECD（SGEC 旧离线产出复用设计，仅 MD，不写实施）；分支
> `codex/sgec-offline-reuse-design-20261116`；核验基线 main `9dbc7a8e210398d68c3562433b608ced76226bdd`（WGGC 最终 main）。
> 本包只交可审阅设计，不拿旧分支 DEC-A/FINAL_READY 自述当当前许可；实施需用户确认后另开包。

## 范围

- 只读参考冻结旧 commit `9a9d6c10519e46880a20f5cb7112f3cde5170933` 的 5 个纯离线候选，不整并旧分支 133 路径，
  不写任何 `.py`/`.json`/测试/产品代码，不改 default 分析/API/BKT/events/依赖/DB。
- 复用 5 文件：`backend/services/sgec_offline.py`、`backend/scripts/evaluate_sgec_offline.py`、
  `backend/tests/test_sgec_offline.py`、`backend/tests/fixtures/sgec_offline_cases.json`、`docs/SGEC_OFFLINE_CONTRACT.md`。

## 设计结论（详见 [SGEC_OFFLINE_DESIGN.md](../SGEC_OFFLINE_DESIGN.md)）

- 推荐 A：复用/重审四个纯离线候选，严格 5 字段结构校验 + 调用方传合法标签 `Collection[str]` + 整批原子拒绝 +
  受控 synthetic 输出 + CLI 只处理合成 fixture（稳定退出码 0/1/2 与 safe 诊断）。
- 与 I1 `GrammarProvider` 差异：I1 `validate_grammar_evaluation` 遇重复 `skill_tag` 拒绝（非去重）；当前
  `DemoRuleGrammarProvider` 为 demo 合成输出（source demo_rule/is_synthetic true），Protocol 不承诺真实；旧离线 batch
  不去重、metadata 固定受控。两者层次不同，不冒充，无硬冲突。
- 方案 B（仅留契约/fixture，不引入 validator/CLI，无任何可执行校验代码）为备选，推荐 A（validator/CLI 提供可执行结构回归）长期维护价值更高。
- 当前不是已确认实现；未来实施需 ≥5 有效变异 + 纯导入 fence + 旧产出 fresh 测试/范围审查。

## 本波基线（WGGC 已发布，摘要，详情见复核材料）

- WGGC main `9dbc7a8e`，mainCI 43804969728 首五 success，E2E 258 C129/W129 actual0retry/skip/flaky、5.5m，
  pytest 962/3w/80.63%/51.16s；PR192 CI 43803930628 六 success 但 E2E 257pass/1flaky/2actualretries（Chromium
  a11y:80 首次/retry1 两次 Promise GC，retry2 绿），两真实 trace 已留、因果未知；本机 a11y repeat20 20/20 未复现。
- A19/A18/WGGC 逐包完整 SHA/tree/PR/CI 见 [复核材料](../reviews/2026-11-16-maintenance-next-wave-review-input.md)。

停 Review；本文件为设计/复核收口，不 commit / stage / push / merge。
