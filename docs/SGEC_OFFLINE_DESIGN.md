# SGEC 旧离线产出复用设计（已确认 A，纯离线候选已验收）

> 状态：**用户已确认方案 A，纯离线候选已实施并经独立验收（代码 APPROVED R1，未发布）**。旧分支 DEC-A/FINAL_READY 自述不作为当前许可依据；真实确认来源为 2026-11-16 PR193 用户答复。
> 本文件此前为待确认设计；本包已按确认进入实施并验收。
> 基线：main `9dbc7a8e210398d68c3562433b608ced76226bdd`（WGGC 最终 main）。§2 契约冻结保留；本节只记录确认与实施状态。

## 1. 目标与边界

> 注：本节与 §5 中「不写 `.py`/`.json`」「旧 4 源码待实施授权」「未来实施」等均为原设计阶段冻结时点表述；
> 本包已按用户确认进入实施并验收（见 §6 与 [实施记录](./history/2026-11-16-sgec-offline-implementation.md)）。§2 契约逐字保留。

复用冻结旧 commit `9a9d6c10519e46880a20f5cb7112f3cde5170933` 中 5 个纯离线候选，重审为「SGEC 严格离线结构校验与合成评测」
的最小设计；**绝不整并旧分支 133 路径**，不写任何 `.py`/`.json`/测试/产品代码，不改 default 分析/API/BKT/learning events/依赖/DB，
不扩大到适配器或接生产。

5 个候选（本机 Git 冻结 commit `9a9d6c10519e46880a20f5cb7112f3cde5170933` + 逐文件 SHA256；本轮未发布，GitHub 当前连接
对该 commit GET404，故不作为云端可复核或已核实远端）：

- `backend/services/sgec_offline.py` `32652d63b16f901c5a1967228894c0b89bdaed1d7dd9591013ada3abdffedd33`
- `backend/scripts/evaluate_sgec_offline.py` `2fb6add5467641edeee75840102f154b4b6faebe6941004f6df19c47e6ffe8b7`
- `backend/tests/test_sgec_offline.py` `47172713c5940a3b54e3915eb7d2b3ca5fcdb5dcd430545a122e24813829bf2f`
- `backend/tests/fixtures/sgec_offline_cases.json` `a58eccf35da6dcffd222108225316fd0c9b00285ff2538ffcd30ce527331ba12`
- `docs/SGEC_OFFLINE_CONTRACT.md` `0fa0cf17602cb00a4a2233e1272625cce71b57a284fc9811fd18e6d6afa8e1e4`

本设计已完整写出输入/输出/边界，云端可直接 review 本提案；旧 4 个源码（`.py`/`.json`）待获实施授权后在独立候选 PR
中带入并 fresh 验收，现在不上传旧 133 路径、不新增 `.py`。代码冻结仍为 PR190–192 的 16 路径。

## 2. 推荐 A：纯离线校验 + CLI runner（具体约束）

复用/重审四个纯离线候选，语义固定为「严格结构校验 + 固定合成 fixture 评测」，不称准确率、不接真实 Provider。

### 2.1 输入形状

- 顶层只允许 `{"errors": [...]}`；`errors` 缺失或非数组拒绝；顶层出现 `errors` 之外的 key 整批拒绝。
- 每个元素只允许 `skill_tag`/`original`/`corrected`/`error_type`/`confidence` 五字段；出现 extra/unknown 字段整批拒绝。
- 四个字符串字段必填：`skill_tag`/`original`/`corrected`/`error_type` 必须是字符串；空串保留、不新增业务禁令。
- `skill_tag` 精确属于调用方合法集合；`other` 只在调用方集合显式包含时合法，绝不作为 unknown 的默认回退。
- `confidence` 缺失、`null` 或有限非布尔 `0<=x<=1` 数字；bool、数值字符串、NaN、正负无穷、越界一律拒绝。

### 2.2 调用方合法标签集合

- 必须是 `collections.abc.Collection[str]`（如 list/tuple/set/frozenset）；裸 `str`/`bytes`/`bytearray` 或一次性
  iterator/generator 非法，且迭代前拒绝、不消费输入；空集合合法但会拒绝所有标签。合法空 Collection 且 `{"errors":[]}`
  仍成功。

### 2.3 整批原子拒绝

- 任一记录或顶层形状不合法，返回 `ok:false`、accepted 为空、issues 非空；无部分可用、不 coerce、不截断。
- issues 每条只含稳定 `path`/`field`/`code`，不回显原始业务文本或未知字段名。

### 2.4 受控 synthetic 输出与序列化

- 最小接口 `validate_sgec_batch(raw_json_value, allowed_skill_tags) -> immutable result`、`run_offline(fixture_path) ->
exit code + summary`。
- accepted 为不可变结构；输出固定 `source="offline_synthetic"`、`provider=null`、`model_version=null`、
  `is_synthetic=true`，5 核心字段保持校验后值；每次按白名单重新序列化，不接收输入元数据。

### 2.5 CLI 与材料入口

- CLI 只处理合成 fixture，三退出码：0 = 全部接受/拒绝与 `expect_accept` 一致，1 = 期望不匹配，2 = 坏 fixture（坏 JSON、
  非标准 JSON token、坏 UTF-8、非 bool `expect_accept`、非法 `allowed_skill_tags`）；固定安全诊断不回显原文。
- 拒绝 NaN/Infinity 等非标准 JSON 常量的材料入口（`parse_constant` 拒绝）；禁止真实外部服务/env/ORM/config/DB 导入或默认接入。

## 3. 与当前 I1 GrammarProvider 的差异（不冒充）

- I1 `GrammarEvaluation`/`GrammarFinding` 是**领域评估结果类型**；当前 `DemoRuleGrammarProvider` 为 demo 合成输出
  （`source="demo_rule"`、`provider=None`、`model_version="demo-grammar-rules-v1"`、`is_synthetic=True`），Protocol 本身
  不承诺真实评估。`validate_grammar_evaluation` 遇重复 `skill_tag` 是**拒绝**（抛 `ValueError("Duplicate grammar skill")`），
  不是去重；`DemoRule` 实现内部才用 `detected` set 避免重复。
- 旧 SGEC 离线 batch 是**结构校验输入**，不去重（允许多个相同 `skill_tag`），metadata 是固定受控输出、不从输入接收。
- 结论：不把旧离线 batch 输出冒充 I1 实现；不设计持久化 adapter，不改 default 分析/API/BKT/events；两者层次不同，
  无硬冲突，可并存。

## 4. 方案 B 对比（可选）

- B：只留契约文档 + fixtures，**不引入 validator 与 CLI**（无任何可执行校验代码）。
- 收益：更少代码、无 validator/CLI 维护面。
- 成本：没有可执行的结构校验回归，只能靠文档 + fixtures 人工核对。
- 取舍：推荐 A（validator + CLI 提供可执行、稳定退出码的离线结构回归，长期维护价值高于 B）；B 作为备选保留，
  最终以用户确认的维护成本偏好为准。

## 5. 验收边界与风险

- 已确认 A、候选已验收（代码 APPROVED R1，未发布）；旧 FINAL_READY 计数不照搬。
- 未来实施需 ≥5 项有效变异（unknown 回退 other、coerce 数字字符串、接受 bool、extra 元数据透传、单条坏值部分接受）
  被对应断言杀死 + 纯导入 fence（模块导入不触达 ORM/config/DB/env/network）+ 旧产出 fresh 测试/范围审查。
- 结构接受/拒绝不证明 SGEC 教学质量、纠错正确性或真实模型准确率；真实 Provider、人工 gold、BKT/events 接线仍未验。

## 6. 确认与实施状态

- 方案 A（validator + CLI）已由用户确认（2026-11-16，PR193 答复）；纯离线候选（4 个离线文件）已实施并独立验收
  （代码 APPROVED R1，未发布）。方案 B 仅作为已放弃备选保留在 §4。
- SGEC 真实 LLM Provider、人工 golden 评测集、BKT/learning events 接线仍不在本设计范围，需另行裁定。

本文件已从设计进入实施：纯离线候选已实现并验收；真实 Provider/BKT 接线仍待另行裁定。
