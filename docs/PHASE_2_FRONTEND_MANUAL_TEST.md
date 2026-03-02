# Phase 2 前端 — 人工测试手册

> 本文档覆盖 Phase 2 前端新增功能的人工测试步骤。
> 测试前需确保后端服务和 LiveKit Agent 均已启动。

---

## 一、前置条件

### 1.1 启动后端服务

**终端 1** — FastAPI：

```bash
cd backend && source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**终端 2** — LiveKit Agent：

```bash
cd backend && source .venv/bin/activate
python livekit_agent/agent.py dev
```

### 1.2 启动前端开发服务器

**终端 3**：

```bash
pnpm --filter vite-app dev
```

应输出 `Local: http://localhost:5173/`。

### 1.3 确认 .env 配置

确保项目根目录 `.env` 包含完整配置（LiveKit、Deepgram、Cartesia、LLM 等）。

---

## 二、代码质量验证

### 2.1 ESLint 检查

```bash
pnpm --filter vite-app lint
```

**验收**：零错误零警告输出。

### 2.2 TypeScript 类型检查

```bash
pnpm --filter vite-app exec tsc --noEmit
```

**验收**：零错误输出。

---

## 三、发音评估展示测试

### 3.1 完整流程测试

1. 启动后端和 Agent
2. 在浏览器中点击「开始练习」
3. 进行几轮对话（尝试说含 "th" 音的词如 "the thing"）
4. 点击「结束对话」

**验收**：

- 对话结束后显示「对话已结束」标题
- 短暂显示"正在分析发音..."加载动画（mock 模式下可能闪过）
- 显示发音评分 `XX/100`
- 评分颜色编码：≥80 绿色 / 60-79 黄色 / <60 红色
- 评分下方显示音素对齐详情区域

### 3.2 PhonemeVisualizer 组件测试

在发音评估结果显示后，查看音素序列：

**验收**：

- 音素以 monospace 色块排列，水平自动换行
- 绿色块 = 正确发音
- 红色块 = 发音替换（substitution）或缺失（deletion）
- 琥珀色块 = 多余音素（insertion）
- Hover 任意色块，出现黑底白字 Tooltip
  - 绿色块 Tooltip：「正确」
  - 红色块 Tooltip：「替换：期望 XX，实际 YY」或「缺失：XX」
  - 琥珀色块 Tooltip：「多余：XX」

### 3.3 语法错误展示测试

1. 开始新对话
2. 对 AI 说 "Yesterday I go to school"
3. 继续几轮后结束对话

**验收**：

- 评估结果中出现「语法提示 (N)」区域
- 列表显示检测到的语法错误
- 每条错误含 `skill_tag` 标签（如 `verb_tense_past`）
- 原文以红色删除线显示

### 3.4 无语法错误场景

1. 开始新对话
2. 使用语法正确的句子进行对话
3. 结束对话

**验收**：

- 评估结果中不显示「语法提示」区域
- 仅显示发音评分和音素序列

---

## 四、技能树测试

### 4.1 技能树展示

在完成至少一轮对话并查看评估结果后：

**验收**：

- 评估结果下方显示「技能掌握度」区域
- 技能按「发音」和「语法」两组分类显示
- 每个技能显示名称 + 进度条 + 百分比
- 进度条宽度与 `p_mastery × 100%` 一致

### 4.2 掌握度标记

通过 API 手动验证（如果有 p_mastery ≥ 0.95 的技能）：

```bash
TOKEN="mock-token"
curl -s http://localhost:8000/api/assessments/knowledge/states \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**验收**：

- `p_mastery ≥ 0.95` 的技能显示绿色「已掌握」标签
- `p_mastery < 0.95` 的技能显示百分比数字

### 4.3 技能进度条颜色

**验收**：

- `p_mastery ≥ 0.95`：绿色进度条
- `0.6 ≤ p_mastery < 0.95`：绿色进度条
- `0.3 ≤ p_mastery < 0.6`：黄色进度条
- `p_mastery < 0.3`：红色进度条

---

## 五、轮询与异常测试

### 5.1 评估数据 404 轮询

在后端 `services/analysis_service.py` 的 `analyze_session` 函数开头临时添加：

```python
import asyncio
await asyncio.sleep(5)
```

重启后端，重复完整对话流程。

**验收**：

- 结束对话后显示"正在分析发音..."加载动画
- 5 秒后自动显示评估结果
- 无需手动刷新

### 5.2 后端不可用

停止 FastAPI 后端，然后在已有的「已结束」页面刷新：

**验收**：

- 显示红色"加载评估数据失败"提示
- 不会白屏或 JS 报错

### 5.3 再来一次状态重置

完成一轮对话并查看评估结果后，点击「再来一次」：

**验收**：

- 界面回到 idle 状态，显示「开始练习」按钮
- 评估数据被清除（不残留上一轮结果）
- 开始新对话后，结束时显示新的评估结果

---

## 六、API 验证

### 6.1 评估数据 API

完成一轮对话后，在终端中运行：

```bash
TOKEN="mock-token"

# 列出最近会话
SESSION_ID=$(curl -s http://localhost:8000/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# 查看评估数据
curl -s http://localhost:8000/api/assessments/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 查看语法错误
curl -s http://localhost:8000/api/assessments/$SESSION_ID/grammar \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 查看知识状态
curl -s http://localhost:8000/api/assessments/knowledge/states \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**验收**：

- 评估 API 返回 `overall_score`（0-100）和 `phoneme_alignment` 数组
- 前端展示的数据与 API 返回数据一致

---

## 七、排障指南

| 问题                   | 可能原因                  | 解决方案                                        |
| ---------------------- | ------------------------- | ----------------------------------------------- |
| 评估结果不显示         | 后端分析管线失败          | 检查后端终端日志是否有"会话分析失败"            |
| 持续显示"正在分析发音" | API 持续返回 404          | 确认后端 `end_session` 是否正常触发分析         |
| 音素全为绿色           | Mock 模式未注入替换错误   | 尝试说含 "th" 的词，Mock 会将 TH 替换为 S       |
| 技能树为空             | 无知识状态数据            | 确认后端 `update_knowledge` 执行成功            |
| Hover Tooltip 不显示   | Tailwind CSS 未扫描新文件 | 确认 `styles.css` 中 `@source` 包含新组件路径   |
| TypeScript 报错        | 类型不匹配                | 运行 `pnpm --filter vite-app exec tsc --noEmit` |

---

## 八、Phase 2 前端验收结论

| 检查项     | 通过条件                                       |
| ---------- | ---------------------------------------------- |
| ESLint     | `pnpm --filter vite-app lint` 零错误           |
| TypeScript | `tsc --noEmit` 零错误                          |
| 发音评分   | 结束对话后显示 XX/100 分数，颜色编码正确       |
| 音素可视化 | 绿色/红色/琥珀色块正确渲染，Hover Tooltip 正常 |
| 语法提示   | 存在语法错误时列表正确显示                     |
| 技能树     | 按分类分组，进度条和百分比正确，已掌握标签正确 |
| 404 轮询   | 分析未完成时显示加载动画并自动重试             |
| 错误处理   | 后端不可用时显示错误提示而非白屏               |
| 状态重置   | "再来一次"清除评估数据，新轮次显示新结果       |
