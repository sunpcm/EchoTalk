# Phase 1 前端 — 人工测试手册

> 本文档覆盖 Phase 1 前端全部功能的人工测试步骤。
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

## 三、页面渲染测试

### 3.1 访问首页

打开浏览器访问 `http://localhost:5173/`。

**验收**：

- 页面正常渲染，无白屏
- 显示标题「AI 英语口语练习」
- 显示副标题「与 AI 教练进行实时语音对话，提升你的英语口语能力」
- 显示「开始练习」按钮
- 浏览器控制台无 JS 错误

### 3.2 IdleView 错误展示

在浏览器开发者工具 Network 面板中，将 `/api` 请求设为离线模式（或停止后端服务），然后点击「开始练习」。

**验收**：

- 短暂显示 loading 后回到 idle 状态
- 出现红色错误提示框，显示「连接出错」标题和具体错误信息
- 再次显示「开始练习」按钮

---

## 四、完整对话流程测试（端到端）

> 此测试需要后端 FastAPI + LiveKit Agent 同时运行。

### 4.1 开始对话

1. 确保后端和 Agent 均已启动
2. 在浏览器中点击「开始练习」
3. 浏览器弹出麦克风权限请求 → 允许

**验收**：

- 点击后短暂显示 loading 动画（"正在连接..."）
- 3-5 秒后进入对话界面
- 显示音频可视化条（BarVisualizer）
- 显示控制栏（麦克风按钮等）
- 显示「结束对话」按钮
- Agent 终端显示 "参与者加入" + "语音管线已启动" 日志

### 4.2 语音交互

1. 对着麦克风说一句英语（如 "Hello, can you help me practice English?"）

**验收**：

- 可视化条在说话时有动态反应
- 状态文案显示变化：「正在聆听...」→「正在连接...」→「AI 正在说话...」
- 几秒后 Agent 产生语音回复，可从扬声器听到
- 回复结束后状态恢复为「等待你开讲...」

### 4.3 多轮对话

继续说 2-3 句话，验证多轮持续工作。

**验收**：每轮都能正常识别用户语音并产生 AI 回复。

### 4.4 结束对话

点击「结束对话」按钮。

**验收**：

- 界面切换为结束视图
- 显示「对话已结束」标题
- 显示「你可以开始新一轮练习」提示
- 显示「再来一次」按钮

### 4.5 再来一次

点击「再来一次」按钮。

**验收**：

- 界面回到 idle 状态，显示「开始练习」按钮
- 可以重新开始完整对话流程

### 4.6 验证转录写入

完成一轮完整对话后，在终端中运行：

```bash
TOKEN="mock-token"

# 列出最近会话
SESSION_ID=$(curl -s http://localhost:8000/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# 查看转录
curl -s http://localhost:8000/api/sessions/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**验收**：

- `transcripts` 数组包含 `role: "user"` 和 `role: "assistant"` 记录
- 用户的转录对应你说的英语内容
- AI 的转录对应你听到的回复内容

---

## 五、状态机测试

### 5.1 状态流转验证

使用浏览器开发者工具 React DevTools 或在控制台执行：

```javascript
// 查看当前 zustand store 状态（需在 React 组件树中）
// 或通过 React DevTools 查看 useConversationStore 的值
```

按顺序操作，验证状态流转：

| 操作             | 期望 connectionState | 期望 token       |
| ---------------- | -------------------- | ---------------- |
| 页面加载         | `idle`               | `null`           |
| 点击"开始练习"   | `connecting`         | `null` → 非 null |
| LiveKit 连接成功 | `active`             | 非 null          |
| 点击"结束对话"   | `ended`              | 非 null          |
| 点击"再来一次"   | `idle`               | `null`           |

---

## 六、异常场景测试

### 6.1 后端未启动

停止 FastAPI 后端，点击「开始练习」。

**验收**：不会白屏，显示错误提示并回到 idle 状态。

### 6.2 Agent 未启动

启动 FastAPI 但不启动 Agent，点击「开始练习」。

**验收**：

- 能成功进入 connecting 状态（token 获取成功）
- LiveKit 连接可能成功但无 AI 回复
- 不会白屏或 JS 报错

### 6.3 麦克风权限拒绝

在浏览器设置中拒绝麦克风权限，点击「开始练习」。

**验收**：不会白屏，LiveKit SDK 应显示权限错误。

---

## 七、排障指南

| 问题             | 可能原因              | 解决方案                                                |
| ---------------- | --------------------- | ------------------------------------------------------- |
| 页面白屏         | 编译错误              | 检查终端 Vite 输出和浏览器控制台                        |
| `/api` 请求 502  | 后端未启动            | 启动 FastAPI：`uvicorn main:app --port 8000`            |
| 获取 token 失败  | 后端 LiveKit 配置不全 | 检查 `.env` 中 `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` |
| LiveKit 连接失败 | ws_url 不可达         | 检查 `.env` 中 `LIVEKIT_URL`                            |
| 无 AI 语音回复   | Agent 未启动          | 启动 Agent：`python livekit_agent/agent.py dev`         |
| 语音识别无输出   | 麦克风权限未授予      | 浏览器地址栏点击锁图标，允许麦克风                      |
| 样式异常         | LiveKit 样式未加载    | 确认 `@livekit/components-styles` 已安装且被 import     |
| TypeScript 报错  | 类型不匹配            | 运行 `pnpm --filter vite-app exec tsc --noEmit` 检查    |

---

## 八、Phase 1 前端验收结论

| 检查项     | 通过条件                                |
| ---------- | --------------------------------------- |
| ESLint     | `pnpm --filter vite-app lint` 零错误    |
| TypeScript | `tsc --noEmit` 零错误                   |
| 页面渲染   | 首页正常显示 idle 视图                  |
| 开始对话   | 点击后进入 connecting → active 状态     |
| 语音交互   | 用户说话后收到 AI 语音回复              |
| 多轮对话   | 连续多轮语音交互正常                    |
| 结束对话   | 点击后进入 ended 状态                   |
| 再来一次   | 点击后回到 idle 状态                    |
| 转录写入   | 对话结束后可通过 API 查询到 transcripts |
| 错误处理   | 后端不可用时不白屏，显示错误提示        |
