# SGEC 纯离线契约实施（SGEC-OFF）

> 日期：2026-11-16；用户已确认方案 A（PR193 答复，非旧 DEC-A 自述）。分支
> `codex/sgec-offline-contract-implementation-20261116`；基线 main
> `f70c6810e5055b6533d3ecf058893cc1590ade7d`（SGECD 设计已合并）。仅 4 个离线文件，不整并旧
> 133 paths、不接 default 分析/DB/API/BKT/真实 Provider。

## 范围

- 复用固定旧 commit `9a9d6c10519e46880a20f5cb7112f3cde5170933` 的 4 个候选：初始提取时逐文件 sha256 与旧 blob 一致；最终 `backend/services/sgec_offline.py` 与 `backend/tests/fixtures/sgec_offline_cases.json` 同字节，`backend/scripts/evaluate_sgec_offline.py`（R0 修 except ValueError）与 `backend/tests/test_sgec_offline.py`（R0/R1 补回归）已差异，
  按当前 `docs/SGEC_OFFLINE_DESIGN.md` 重审并实施：
  `backend/services/sgec_offline.py`、`backend/scripts/evaluate_sgec_offline.py`、
  `backend/tests/test_sgec_offline.py`、`backend/tests/fixtures/sgec_offline_cases.json`。
- 只实现严格结构校验 + 固定合成 fixture CLI，不接真实 Provider/BKT/default 分析，不改 I1 GrammarProvider。

## 实施与评审缺口（R0 → R1）

- R0：复用旧候选（103 用例基线绿），父私有精确候选验证发现 CLI 含 5000 位整数时 `json.loads` 抛
  `ValueError`（int 位数限制），旧只 catch `JSONDecodeError` → exit1 + Traceback，
  违反「坏材料 exit2 固定安全诊断」。R0 修正 `except ValueError`（保留 int 限制、不增大/接收/截断），补
  `test_cli_giant_integer_is_safe_material_error`。
- R1：评审指出 `test_empty_string_fields_allowed` 只覆盖 original/corrected/error_type 空串，缺 caller 显式
  允许 `""` 的 skill_tag 正例；补 `test_empty_skill_tag_allowed_when_explicitly_allowed` 与
  `test_empty_skill_tag_rejected_when_not_allowed`（对照）。

## 阶段计数（父 Harness 亲跑）

- R0 17 必需门禁 exit0：Vitest 1270/57、Fake 125、类型 10、构建 21、pytest 1066/3warnings/81.00%/79.41s
  （命令 84.16s）、E2E 258 C129/W129 0retry/skip/flaky/80.170353s（命令 82.08s）。两个误带旧诊断 NOT_RUN exit125
  不计 19 项通过。
- R1 完整 backend pytest：1068 passed/3warnings/81.00%/54.27s（命令 58.87s）；backend-format/lint 与 format 8.33s 成功，
  源字节稳定。代码独立 APPROVED R1。
- 纯模块自测（作者，pure-check.py）：import PURE_IMPORT_OK、ruff、format、tests 106、cli 31 用例全匹配，均 exit0。

## 七项有效变异（父私有临时副本，正式四文件未变异）

| 变异           | 改动                                               | 目标测试（断言）                  | 结果                              |
| -------------- | -------------------------------------------------- | --------------------------------- | --------------------------------- |
| unknown        | sgec_offline.py:203 让 unknown 回退 other          | test:133 unknown_skill_tag 拒绝   | R0 目标 RED；恢复 104 GREEN       |
| coerce         | sgec_offline.py:223 coerce 数字字符串              | test:229 invalid_confidence 拒绝  | R0 目标 RED；恢复 104 GREEN       |
| boolean        | sgec_offline.py:128 接受 bool                      | test:229 invalid_confidence 拒绝  | R0 目标 RED；恢复 104 GREEN       |
| metadata       | sgec_offline.py:28 extra 伪 metadata 透传          | test:262 unknown_field 拒绝       | R0 目标 RED；恢复 104 GREEN       |
| partial        | sgec_offline.py:242 单条坏值部分接受               | test:278 整批零接受               | R0 目标 RED；恢复 104 GREEN       |
| cli-valueerror | evaluate_sgec_offline.py:42 移除 except ValueError | test:513 exit2 安全诊断           | R0 目标 RED；恢复 104 GREEN       |
| emptytag       | sgec_offline.py:204 添加空 tag 禁令                | test:154 assert result.ok is True | R0 104 存活；R1 目标 RED/恢复 106 |

## 首工具失败（非产品 RED/变异存活）

- 私有复制未完 pure01 exit4/0 用例；pure 旧 cacheprovider warning 1 条（父已禁 cacheprovider）；六变异首版 JUnit type
  缺失误判，v2 完成。

## 未验证

- 真实 Provider/LLM Key、人工 golden、BKT/learning events 接线、default 分析/API/DB 集成、整栈、设备、部署均未验。
- 最终 source/main/CI 回执由 PR 正文，不在本文件自引用。

停 Review，不 commit/stage/push/merge。
