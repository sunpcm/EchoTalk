# SGEC 严格离线校验与合成评测合同

> 状态：**DEC-A 设计已确认；SGEC-OFF 离线准备待实施**。
> 确认日期：2026-11-15；确认范围：SGEC 推荐 A。
> 设计基线：`codex/B1-learning-events-20261112@0aae655928cf046482627830aee9df6cb7fc1fc1`。
> 本文件只定义纯离线边界，不改默认分析、数据库/API、BKT、learning events 或依赖。

## 1. 目标与边界

SGEC-OFF 只实现两个离线能力：

1. 对调用方给出的现有语法错误核心字段做严格、全批次结构校验。
2. 用固定的合成 JSON fixtures 和解释/建议材料准备离线评测输入，统计结构接受/拒绝结果。

现有核心字段为 `skill_tag`、`original`、`corrected`、`error_type` 与可空 `confidence`。
解释和练习建议只能存在于离线评测材料，不进入本卡输出合同、数据库列或公开 API。

本卡不接真实 Provider，不修改默认分析，不写数据库，不创建 API，不接 BKT、learning events、
自动重试或生产切换。GitHub #126 的研究不是已确认的存储/API 或教学质量合同。

## 2. 输入形状

离线 runner 接收 JSON 解码后的批次对象：

```json
{
  "errors": [
    {
      "skill_tag": "article_usage",
      "original": "I saw a elephant.",
      "corrected": "I saw an elephant.",
      "error_type": "article",
      "confidence": 0.82
    }
  ]
}
```

顶层只允许 `errors`，其值必须是数组。每个元素只允许：

| 字段         | 严格要求                                               |
| ------------ | ------------------------------------------------------ |
| `skill_tag`  | 字符串，且精确属于本次调用方提供的合法集合             |
| `original`   | 字符串                                                 |
| `corrected`  | 字符串                                                 |
| `error_type` | 字符串                                                 |
| `confidence` | 缺失、`null` 或有限、非布尔数字 `0 <= confidence <= 1` |

`original`、`corrected` 或 `error_type` 的空串不在本轮新增业务语义禁令；只校验它们的类型。
`null` 不能替代其它必填字符串。数值字符串、`bool`、`NaN`、正负无穷和越界数字一律拒绝。

`skill_tag` 的合法集合完全由调用方传入，可由真实技能清单构造。校验模块不得导入 ORM、
application config、数据库或环境变量，也不得硬编码周报六类。`other` 只有在调用方集合明确包含时
才合法，绝不作为未知标签的默认回退。空集合会拒绝所有标签，不自行补默认集合。

输入不得包含 `id`、`session_id`、`source`、`provider`、`model_version`、`is_synthetic`、
`created_at`、解释、建议或任何未声明扩展字段。出现任一 extra/unknown 字段即整份批次拒绝，
不得由调用方决定受控元数据。

## 3. 全批次原子拒绝

校验是严格纯函数：相同输入与合法集合产生相同结果，不读时钟、不写文件、不访问网络、不记录原始
文本。只要任一记录或顶层形状不合法：

- 返回 `ok: false`；
- 不返回部分可用记录；
- 不修补、不 coerce、不截断、不把未知标签改为 `other`；
- 每条 issue 只含稳定的路径、字段和机器可读错误码，不回显原始业务文本。

`{"errors": []}` 是合法输入，返回 `ok: true`、`accepted: []`、`issues: []`。现有合同没有语法错误时
可以合法返回空数组，本轮不新增“至少一条错误”的业务禁令。完整 shape 中的缺失 `errors`、`errors`
非数组以及其它顶层 shape 错误仍然拒绝。上述整批原子性适用于类型错误、未知标签、extra 字段、坏
confidence，以及缺失或非数组的 `errors`。

## 4. 受控合成输出

合法批次由受控代码重新构造结果，不接受输入中的任何受控元数据：

- `source = "offline_synthetic"`；
- `provider = null`；
- `model_version = null`；
- `is_synthetic = true`；
- 五个核心字段保持校验后值。

输出对象与内部接受项应为不可变结构；runner 每次只按白名单重新序列化这些不可变值。即使调用方
修改某个已序列化 JSON，也不能改变共享合同常量或使下一次结果从 synthetic 变为 real。任何持久化
适配器都不是本卡范围。

建议最小接口保持技术实现自由但语义固定：

```text
validate_sgec_batch(raw_json_value, allowed_skill_tags) -> immutable result
run_offline(fixture_path) -> exit code + accepted/rejected summary
```

成功结果包含重新构造的 accepted 项；失败结果的 accepted 必须为空并包含 issues。真实业务文本不
进入日志、错误码或质量统计。

## 5. 固定合成材料

仓库测试 fixtures 只使用虚构英语句子与固定 synthetic 元数据。至少提供：

- 一个合法批次，覆盖 confidence 缺失、显式 `null`、边界 `0` 与 `1`；
- 一个合法 `{"errors": []}`，验证 `ok: true`、`accepted: []` 与 `issues: []`；
- 未知 `skill_tag`、`other` 不在调用方集合的拒绝样例；
- 顶层非对象、缺 `errors`、`errors` 非数组；
- 每类核心字段的错类型；
- 固定 JSON fixtures 只用标准 JSON，覆盖 `confidence` 的 bool、数值字符串、越界值与 extra 字段；
  NaN、正无穷与负无穷在 Python 单元测试中直接构造并传给校验函数，不能写成非标准 JSON token；
- 一个多记录批次，其中单条坏值验证整批零接受；
- 一个合法输入尝试伪造 `source/provider/model_version/is_synthetic`，必须整批拒绝；
- 一个输出生成后尝试修改的样例，证明共享值与下一次序列化仍固定为 synthetic；
- 解释/建议仅作为离线材料出现，不属于 accepted 项。

结构接受/拒绝只能称作“校验结果”，不能称为准确率。没有人工审定质量 golden 与真实模型结果时，
不发布纠错或多段教学反馈质量结论。

## 6. SGEC-OFF 实施卡

该卡预期新增一个无副作用纯模块、固定 JSON fixtures、结构化 fixtures 测试及一个离线 runner。
只使用现有依赖与标准库，不引入新框架或数据库适配器。

实施顺序：

1. 先提交有效 RED：合法最小批次与至少一个必须整批拒绝的坏值。
2. 实现严格形状、调用方标签集合、confidence 与受控元数据，再实现 runner/固定材料。
3. 完整 backend 测试树通过；主控执行当前三测试树与全部门禁。
4. 至少做针对性变异：未知标签回退 `other`、coerce 数字字符串、接受 bool、extra 元数据透传、
   单条坏值时部分接受；每项必须被对应断言杀死。
5. 验证模块导入不触达 ORM/config/DB/env/network，输出不落 DB。

## 7. 验收边界

- SGEC-OFF 设计确认不等于离线实现完成。
- 离线结构通过不等于 SGEC 教学质量、纠错正确性或真实模型准确率通过。
- `WeeklyGrammarSkillTag.other` 不在当前 `SEED_SKILLS` 十项中，且周报六类不是技能全集；合法标签
  必须由调用方明确提供。
- SGEC 总项、真实 Provider、人工 gold、BKT/learning events 接线和生产行为仍未验。
- 最终 Review、提交和发布由主控回执；实施节点不自批。
