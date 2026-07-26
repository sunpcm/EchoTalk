# Phase 8 三主题切换 手工验收测试手册

## 1. 测试准备与前置环境

- 运行前端服务：`pnpm --filter vite-app dev`（默认 https，端口 5173）。
- 纯视觉/主题验收无需后端；但 **Session（对话）** 与 **评估（Ended）** 两个界面需完整链路才能进入，需额外启动：
  - 后端：`cd backend && python main.py`
  - LiveKit Agent：`cd backend && python livekit_agent/agent.py dev`
- 三套主题的取值基准见 [PHASE_8_UI_THEME_UPGRADE.md](./PHASE_8_UI_THEME_UPGRADE.md) 第 1 节 Token 表。

> 说明：本手册中标注 ✅ 的用例已在开发自查（Dashboard / DocChat 设置 / 设置抽屉 / 移动端 / 持久化）通过；标注 ⏳ 的用例（Session / 评估）依赖后端 + LiveKit 实时链路，需在完整环境下手动补验。

## 2. 主题基础设施验收

### Test Case 1: 桥接层生效 ✅

- **操作**：打开应用，在 DevTools Console 执行
  `document.documentElement.setAttribute('data-theme','dark')`。
- **预期结果**：页面背景、文字颜色立即变化，无需刷新。再执行
  `getComputedStyle(document.documentElement).getPropertyValue('--bg')` 返回 `#17181b`。

### Test Case 2: 三主题变量取值核对 ✅

- **操作**：分别切换到 warm / cool / dark，读取 `--bg` 与 `--accent`。
- **预期结果**：
  - warm：`--bg=#fbf7f1`，`--accent=#f76b4a`
  - cool：`--bg=#f1f5fb`，`--accent=#3d6fe0`
  - dark：`--bg=#17181b`，`--accent=#e8a23d`

## 3. 设置抽屉主题切换（Phase 8.5）

### Test Case 3: 「外观主题」切换器 UI ✅

- **操作**：Dashboard 右上齿轮 → 打开设置抽屉，查看顶部「外观主题」section。
- **预期结果**：
  1. 副标题显示「选择暖色、冷色或黑色界面风格」。
  2. 三个色板按钮：暖色（`#FBF7F1` 底 + `#F76B4A` 圆点）、冷色（`#F1F5FB` + `#3D6FE0`）、黑色（`#17181B` + `#E8A23D`）。
  3. 当前主题对应按钮有 2px `accent` 描边高亮。

### Test Case 4: 即时切换 ✅

- **操作**：在抽屉内依次点击 冷色 → 黑色 → 暖色。
- **预期结果**：每次点击**立即**全站变色（标题、背景、卡片渐变、抽屉自身），无刷新、无闪烁；选中描边同步移动。

## 4. 五界面 × 三主题视觉核对

对照 Token 表逐一核对以下界面在 warm / cool / dark 下的呈现：

### Test Case 5: Dashboard ✅

- **操作**：Dashboard 页切三套主题。
- **预期结果**：标题用 `accent` 色 + Baloo 2 字体；DocTalk 入口卡片用 `--panel-gradient` 渐变 + `accent-soft-border` 边框；副文字 `text-muted`；箭头 `text-faint`。dark 下为金色强调 + 深色卡片渐变。

### Test Case 6: DocChat 设置页 ✅

- **操作**：Dashboard →「文档对话 (DocTalk)」进入设置页，切三套主题。
- **预期结果**：标题 `accent` 色；dashed 上传区边框 `border-default`、hover 变 `accent-soft`；`.txt/.md` 文件类型文字 `accent`；预设胶囊（模拟面试/论文研讨/自由讨论）`accent-soft-bg` + `accent-soft-text`；字符计数超限时变 `danger`。

### Test Case 7: Session 对话界面 ⏳

- **前置**：需后端 + LiveKit 运行，从 Dashboard 发起一次对话。
- **预期结果**：左侧语音卡片 `surface` + 卡片阴影；"结束对话"按钮 `danger` / hover `danger-hover`；右侧微信风格气泡——AI 气泡 `surface-alt`、用户气泡 `accent` 渐变 + `accent-contrast` 文字；回答推荐面板 `success` 色系。三主题下均需可读。

### Test Case 8: 评估（Ended）界面 ⏳

- **前置**：完成一次对话进入评估结算页。
- **预期结果**：发音分数环按分段（≥80 success / ≥60 warning / <60 danger）着色，轨道 `surface-alt`；音素可视化三态——正确 `success` / 替换缺失 `danger` / 多余 `warning-bar`；语法错误列表原文 `danger` 删除线、修正 `success`；agent 错误卡片 `danger` 色系。

### Test Case 9: 设置抽屉整体 ✅

- **操作**：设置抽屉内切三套主题。
- **预期结果**：抽屉背景 `bg`、分割线 `border-default`、输入框/下拉 `border-default` + focus `accent-soft`、开关激活态 `accent`、Key 状态徽章（verified→success / error→danger / 未配置→surface-alt）均随主题变化且清晰可读。

## 5. 持久化与响应式

### Test Case 10: 刷新保持主题 ✅

- **操作**：切到 dark → 刷新页面（F5）。
- **预期结果**：刷新后仍为 dark，`localStorage["echotalk-theme"] === "dark"`，`<html data-theme="dark">`，无默认主题闪烁。

### Test Case 11: 移动端宽度（375–390px）✅

- **操作**：DevTools 切 375px 宽度，三套主题下浏览 Dashboard / DocChat 设置。
- **预期结果**：布局自适应，卡片全宽，无横向溢出；三主题配色正常。

### Test Case 12: 暗色主题文字对比度 ✅ / ⏳

- **操作**：dark 主题下目视检查各界面文字。
- **预期结果**：正文 `text` / 次要 `text-muted` / 弱化 `text-faint` 在深色背景上清晰；强调色文字（`accent-soft-text` 金）、危险色文字（`danger-text`）、成功色文字（`success-text`）均可读。Session/评估界面文字对比度需在完整环境补验（⏳）。

## 6. 交付前检查

- [x] `pnpm --filter vite-app typecheck` 通过
- [x] `pnpm --filter vite-app lint` 通过（仅剩 `src/lib/api.ts` 既有 warning）
- [x] Prettier 格式化通过（含 Tailwind class 排序）
- ⏳ Session / 评估两界面仍需在完整后端 + LiveKit 环境补验；进度统一跟踪于根目录 [TODO.md](../TODO.md)。
