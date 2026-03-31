# Phase 7 DocTalk 手工验收测试手册

## 1. 测试准备与前置环境

- 确保已应用最新迁移: `alembic upgrade head`
- 运行后端服务: `cd backend && python main.py`
- 运行前端服务: `pnpm --filter vite-app dev`
- 运行 LiveKit Agent: `cd backend && python livekit_agent/agent.py dev`
- 准备一份测试文档（如 `test_resume.md`，内含具体的工作经历、项目名称等可验证的细节内容）

## 2. 核心功能验收

### Test Case 1: 边界防御测试（前端拦截）

#### 1a. 空值拦截

- **操作**: 从 Dashboard 点击「文档对话 (DocTalk)」入口卡片 → 进入 DocChatSetup 页面 → 不输入任何内容，直接查看底部「开始对话」按钮。
- **预期结果**: 按钮处于 `disabled` 状态（半透明、不可点击），无法触发会话创建。

#### 1b. 超字符限制拦截

- **操作**: 在文档输入区粘贴一段超过 50,000 字符的文本。
- **预期结果**:
  1. 字符计数器变为红色，显示当前字符数超过 `50,000` 的上限。
  2. 输入区下方出现红色警告条："文档内容超过 50,000 字符限制"。
  3. 「开始对话」按钮变为 `disabled` 状态。
- **操作 (恢复)**: 删减文本至 50,000 以下。
- **预期结果**: 红色警告消失，按钮恢复可用。

#### 1c. 预设水合测试

- **操作**: 在 PromptBuilder 区域依次点击「模拟面试」、「论文研讨」、「自由讨论」三个预设按钮。
- **预期结果**: 每次点击后，Prompt 输入框内容被替换为该预设对应的完整 i18n 文案。用户可以在预设基础上继续编辑。

#### 1d. 文件读取测试

- **操作**: 点击上传区域，选择一个本地 `.md` 或 `.txt` 文件。
- **预期结果**: 文件内容被读取并填充到 textarea 中，**无任何网络请求发出**（浏览器 DevTools Network 面板中不应有文件上传请求）。字符计数实时更新。

### Test Case 2: 核心链路联调（端到端）

- **前置条件**: 后端服务、LiveKit Agent 正常运行；用户配置（BYOK 或系统默认）可用。
- **操作**:
  1. 从 Dashboard 点击「文档对话 (DocTalk)」进入设置页。
  2. 粘贴或上传一份真实简历 Markdown 文档（约 2000-5000 字符）。
  3. 点击「模拟面试」预设按钮。
  4. 点击「开始对话」按钮。
- **预期结果**:
  1. 按钮显示加载动画（"正在连接..."）。
  2. 页面切换到 VoiceInterface (LiveKit 语音房间)。
  3. AI Agent 主动基于简历内容开始面试提问（而非通用英语教学）。
- **后端验证**:
  - `POST /api/sessions` 请求体包含 `{"mode": "doc_chat", "doc_context": {...}}`。
  - 数据库 `sessions` 表新增一条 `mode=doc_chat` 的记录。
  - 数据库 `session_contexts` 表新增对应的一对一关联记录，包含 `custom_prompt` 和 `document_content` 字段。
  - Agent 日志中可见初始 Prompt 包含 `[Reference Document]` 和 `<document>` 标记。

### Test Case 3: 情绪突变防覆盖测试（终极测试）

这是验证三层 Prompt 架构正确性的**关键测试**。

- **前置条件**: 已通过 Test Case 2 成功进入 DocTalk 语音房间，AI 正在基于文档提问。
- **操作**:
  1. 故意表现出焦虑行为：频繁使用犹豫词（"um", "uh", "er..."），说话断断续续，降低语速，让情绪分析器的 `anxiety_level` 超过 0.6 阈值。
  2. 观察 Agent 日志，确认出现"教学模式切换: normal → encouragement"的日志。
  3. 切换成功后，**立即向 AI 提出一个只有阅读过文档才能回答的极度细节问题**（例如：文档中提到的某个具体项目名称、某个具体的技术栈版本号、某段特定的工作经历时间线）。
- **预期结果**:
  1. Agent 日志显示 `update_instructions` 被调用，且日志中可见 `custom_prompt=` 和 `document_content=` 不为 None。
  2. AI 回复中**准确引用了文档中的具体细节**，证明文档上下文未丢失。
  3. AI 的语气切换为鼓励模式（更简短、更温和的回复），但**内容仍然基于文档**。
- **失败判定**: 如果 AI 在模式切换后回复变成通用英语教学内容，无法回答文档细节问题 → 说明三层架构存在缺陷，文档上下文被覆盖。

## 3. 回归测试

### Test Case 4: 非 doc_chat 模式无影响

- **操作**: 从 Dashboard 直接点击推荐场景卡片的「进入练习」按钮（scenario 模式）。
- **预期结果**: 一切行为与 Phase 6 完全一致，LiveKit 语音正常运行，AI 进行通用英语教学，无任何异常日志。
- **验证要点**: `build_dynamic_prompt` 在 `custom_prompt=None, document_content=None` 时，输出与之前完全等价（不包含 `[Custom Role Instruction]` 或 `[Reference Document]` 段落）。

## 4. i18n 检查清单

以下 `zhCN.docChat` 命名空间下的字段均需在界面中可见且正确渲染：

| Key                                | 预期展示位置            |
| ---------------------------------- | ----------------------- |
| `title`                            | DocChatSetup 页面标题   |
| `subtitle`                         | DocChatSetup 页面副标题 |
| `uploadHint`                       | 文档上传区域标签        |
| `promptLabel`                      | Prompt 编辑区域标签     |
| `presets.interview / paper / free` | 三个预设按钮文本        |
| `charCount` / `charMax`            | 字符计数器              |
| `charOverLimit`                    | 超限红色警告            |
| `startButton`                      | 底部按钮文案            |
| `dashboardEntry` / `dashboardDesc` | Dashboard 入口卡片      |
| `goBack`                           | 返回按钮 title          |

## 5. 排障指南

- **Agent 启动后无法回答文档问题**: 检查 `session_contexts` 表是否有对应记录；检查 Agent 日志中初始 Prompt 是否包含 `<document>` 标记。
- **「开始对话」按钮始终 disabled**: 检查 textarea 中是否确实有文本内容（字符数 > 0 且 ≤ 50,000）。
- **文件选择后 textarea 无变化**: 确认文件扩展名为 `.txt`、`.md` 或 `.markdown`；检查浏览器控制台是否有 `FileReader` 相关错误。
- **模式切换后文档上下文丢失**: 检查 `agent.py` 中 `on_user_turn_completed` 是否正确传递了 `custom_prompt` 和 `document_content` 参数。
