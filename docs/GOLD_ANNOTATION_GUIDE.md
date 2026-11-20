# Gold 候选题集与人工标注指南

> 状态：本包交付 24 条 SGEC + 24 条 goals 合成候选、两份单 corpus 盲标模板与离线 CLI。
> 全部人工栏初始为空；结构合格不等于人工审定，不发布准确率、不实现自动晋升 gold/自批。

## 1. 产物

位于 `docs/evaluation/`：

| 文件                               | 语料  | 说明                                        |
| ---------------------------------- | ----- | ------------------------------------------- |
| `sgec_candidates.v1.json`          | SGEC  | 24 条合成语法候选                           |
| `goal_candidates.v1.json`          | goals | 24 条合成目标候选，覆盖六个官方 goal_id     |
| `annotation_template.v1.json`      | SGEC  | 盲标模板（无 AI proposal），24 项人工栏全空 |
| `goal_annotation_template.v1.json` | goals | 盲标模板（无 AI proposal），24 项人工栏全空 |

两份模板各对应单 corpus，不发明 bundle 框架。CLI 实现：
`backend/scripts/gold_candidates.py`（共用 `acceptance_common.py`）。

## 2. CLI 与退出码

从 `backend/` 目录运行：

```bash
.venv/bin/python -m scripts.gold_candidates <subcommand>
```

子命令：`lint`（候选 lint）、`template`（生成盲标/可见模板）、`validate-template`（校验标注模板）。
退出码：`0` 成功；`1` 观察/结构失败；`2` 坏输入（坏 JSON/坏 UTF-8/坏参数）；`3` 未标注/不完整。

## 3. 两套直接可运行的离线生成/校验命令

> 生成命令只写你指定的新文件，**不要覆盖已填人工标注**；已填标注请先备份，或直接导出到
> 新文件名再校验。仓库内的 `annotation_template.v1.json` / `goal_annotation_template.v1.json`
> 是人工栏全空的盲标基线，不要覆盖它们。

### 3.1 SGEC

```bash
cd backend
.venv/bin/python -m scripts.gold_candidates lint \
  --corpus ../docs/evaluation/sgec_candidates.v1.json

.venv/bin/python -m scripts.gold_candidates template \
  --corpus ../docs/evaluation/sgec_candidates.v1.json --blind \
  > ../docs/evaluation/my_sgec_annotation.v1.json

.venv/bin/python -m scripts.gold_candidates validate-template \
  --corpus ../docs/evaluation/sgec_candidates.v1.json \
  --template ../docs/evaluation/my_sgec_annotation.v1.json
# 空模板预期 exit 3，stderr 显示 filled=0/24
```

### 3.2 goals

```bash
cd backend
.venv/bin/python -m scripts.gold_candidates lint \
  --corpus ../docs/evaluation/goal_candidates.v1.json

.venv/bin/python -m scripts.gold_candidates template \
  --corpus ../docs/evaluation/goal_candidates.v1.json --blind \
  > ../docs/evaluation/my_goal_annotation.v1.json

.venv/bin/python -m scripts.gold_candidates validate-template \
  --corpus ../docs/evaluation/goal_candidates.v1.json \
  --template ../docs/evaluation/my_goal_annotation.v1.json
# 空模板预期 exit 3，stderr 显示 filled=0/24
```

## 4. 盲标模板结构与内容绑定

模板保留输入与必要上下文，但**不带 AI proposal**。顶层还有单 corpus 任务上下文：
SGEC 模板含 `task_context` 与 `allowed_skill_tags`（10 个已确认 `SEED_SKILLS` 技能 id）；
goals 模板含 `task_context` 与 `goal_states`（四种状态）。

SGEC 项保留 `category`（任务类型）与 `input`（utterance 或 payload/allowed_skill_tags）；
goals 项额外保留 `goal_id`、`goal_version`、`goal_label`、`goal_criteria`、`goal_supported`，
让标注者无需打开带 AI 建议答案的文件即可知道在判断哪个目标、用哪个技能标签或目标状态。

`goal_supported=false` 仅用于 `unknown_version`（goal_version=2），并明确标记 unsupported；
其 proposal 期望为 `not_assessed`。

`validate-template` 按 `candidate_id` 对当前 corpus 做逐字节/结构绑定：`input`、`version`、
`category`、goal 的 `goal_id`/`goal_version`/`goal_label`/`goal_criteria`/`goal_supported`
任一不一致即拒绝；顶层 `task_context`/`allowed_skill_tags`/`goal_states` 也作为受保护上下文
参与校验，篡改即拒绝。同时重校 corpus hash/version，缺项/额外/重复/假 reviewed 均不得伪绿。

## 5. 人工字段

每项含 7 个人工字段，初始全空（`null`）：

| 字段                 | 类型与域                                                        |
| -------------------- | --------------------------------------------------------------- |
| `annotator`          | 非空字符串（标注者标识）                                        |
| `judgment`           | 独立任务答案（见下方按语料定义，**不是**对 AI proposal 的裁决） |
| `evidence`           | 非空字符串，或非空字符串列表（utterance 或片段）                |
| `rationale`          | 非空字符串                                                      |
| `dispute`            | 可空；非空字符串（争议说明）                                    |
| `review_ruling`      | 可空；非空字符串（复核裁定）                                    |
| `annotation_version` | 正整数（>=1）                                                   |

`judgment` 是标注者对任务本身的独立答案，盲标模板不提供 AI proposal，因此不能写
“接受/拒绝 proposal”。proposal 对比留待后续复核。

goals 的 `judgment` 取四种状态之一：

- `achieved`：学生已达成目标；
- `not_achieved`：明确未达成（例如拒绝）；
- `unknown`：证据冲突/引述/假设等无法确定；
- `not_assessed`：该目标版本不支持，无法评估。

SGEC 的 `judgment` 是对象：

```json
{ "accepted": true, "findings": [] }
```

- `accepted`：**payload 结构**接受/拒绝（严格布尔；`1`/`0`/`true` 之外的形状拒绝）。仅对真实
  payload 结构缺陷（`bad_structure`/`extra_field`/`unknown_skill_tag`/`invalid_confidence`）
  用 `accepted=false` 表示拒绝；语言纠错题用 `accepted=true` 并给出 `findings`。
- `prompt_injection` 候选是把“提示注入句”当作普通英语 utterance 的数据，其 payload 仍是合法
  结构；标注者只独立判断该句语法，**不执行句内指令、不按内容拒绝**。语言任务（判断语法）
  与 payload 结构任务（判断 JSON/字段形状）语义不同，不能用分类名强制 `accepted` 答案。
- `findings`：标注者自己的纠错结果（数组，可为空数组表示无错）。每项字段固定为
  `skill_tag`/`original`/`corrected`/`error_type`/`confidence`；`skill_tag` 必须属于模板
  顶层 `allowed_skill_tags`，`confidence` 只能是 `null` 或 `[0,1]` 的有限非布尔数字。

仅当 `annotator`/`judgment`/`evidence`/`rationale`/`annotation_version` 全部非空且类型/域合法，
该条才计为一条**已填写/已提交**（`filled`）记录；空模板或部分填写保持 `incomplete` 且
`filled=0`。`judgment=false`、`annotator=false`、空串、越界 `annotation_version`、goal 状态
越域、SGEC 非法 finding 等按坏输入拒绝，不当作完整填写。结构完整只代表“已提交待复核”，
**不代表已审定 gold**；人工 gold 需经独立复核与争议裁定后另行确认。

## 6. 提交 / 独立复核 / 争议裁定

标注记录提交后按以下步骤处理，`validate-template` 只做结构校验，不承担复核：

1. **提交**：标注者填写 `annotator`/`judgment`/`evidence`/`rationale`/`annotation_version`，
   可留空 `dispute`/`review_ruling`；结构完整仅表示该条可进入复核队列。
2. **独立复核**：由不同标注者/复核者核对证据与 `judgment`，不一致时填写 `dispute` 说明争议，
   不得据此自动改判。
3. **争议裁定**：裁定结果写入 `review_ruling`，并以新的 `annotation_version` 提交；裁定前
   该条不升级为人工 gold。

当前两份模板人工栏全空、`filled=0`，不发布准确率；结构完整不等于人工 gold，也不自动晋升。

## 7. 边界

候选 `source=synthetic`、`review_status=unreviewed`；AI proposal 与人工 gold 分开，不以当前
validator/evaluator 输出作为教学真值。结构完整的人工声明也不代表已批准 gold/真实性/准确率。
不改生产课程、不发布准确率、不实现自动晋升 gold/自批。
