# Phase 8：视觉重设计 + 三主题（暖色 / 冷色 / 黑色）落地计划

> 面向执行者：Claude Code（或其他能读写本仓库的 AI Agent）。
> 本文档是自包含的执行说明——不依赖任何外部会话上下文，包含全部所需的设计取值。

## 0. 背景

当前 `apps/vite-app` 的实现（`App.tsx`、`components/**`）用的是通用 Tailwind 调色板（`indigo-600`、`gray-50`、`gray-800` 等），来自 `packages/configs/tailwind-config/theme.css` 里的默认 `brand-*` 蓝色系。这套视觉和产品最终设计稿（品牌名 EchoTalk，圆润有温度的口语练习 App）不一致，且**没有任何主题切换能力**。

本阶段目标：

1. 把现有页面的视觉换成设计稿的样式语言（更大的圆角、暖色卡片阴影、`Baloo 2` 标题字体 + `Plus Jakarta Sans` 正文字体）。
2. 引入三套可切换主题：**暖色**（默认，橙色系）、**冷色**（蓝色系）、**黑色**（深色系，金色点缀）。
3. 主题切换做成运行时可切、可持久化的设置项，挂在 `SettingsDrawer` 里。

设计基准页面（原型）：Dashboard / 对话 Session / 评估 Ended / DocChat 设置 / 设置抽屉 —— 分别对应本仓库现有的 `Dashboard`（`App.tsx` 内）、`VoiceInterface.tsx`、`PronunciationFeedback.tsx` + `PhonemeVisualizer.tsx`、`DocChatSetup.tsx`、`SettingsDrawer.tsx`。

---

## 1. 设计 Token（三套主题的完整取值）

在 `packages/configs/tailwind-config/` 下新增 `theme-tokens.css`，定义为**语义化 CSS 自定义属性**（不是 Tailwind 的 `--color-brand-*` 那种直接生成 utility 的写法，而是先定义语义变量，再在 Tailwind `@theme` 里桥接一层，理由见第 2 节）。

三套主题变量表（key 为语义名，值为最终 hex/rgba）：

### 暖色（`data-theme="warm"`，默认）

```
--bg:#FBF7F1  --surface:#FFFFFF  --surface-alt:#FBF7F1
--border:#EFE7DC  --border-soft:#F0E7DA
--text:#2C2620  --text-muted:#8A8178  --text-faint:#B0A69A
--accent:#F76B4A  --accent-hover:#E85632  --accent-grad-1:#FB9268
--accent-soft-bg:#FDEBE3  --accent-soft-bg-strong:#FBDCCD
--accent-soft-text:#C9482A  --accent-soft-border:#F9C7B4
--accent-contrast:#FFFFFF
--accent-shadow:rgba(247,107,74,0.45)  --card-shadow:rgba(80,50,20,0.18)
--panel-gradient:linear-gradient(105deg,#FDEBE3 0%,#FCE3D6 55%,#FBEFD6 100%)
--scrollbar-thumb:#E7DCCB  --header-bg:rgba(251,247,241,0.82)
--success:#37A56E  --success-bg:#E4F3EA  --success-border:#BEE3CD  --success-text:#1F5C3D
--warning-bar:#F2A63B  --warning:#B87A17  --warning-bg:#FBEFD6  --warning-border:#F0D399
--danger:#E24C4C  --danger-hover:#CE3B3B  --danger-bg:#FBE7E4  --danger-border:#F1C4BD
--danger-text:#B83A3A  --danger-shadow:rgba(226,76,76,0.45)
--mid-green:#5FBE8A
```

### 冷色（`data-theme="cool"`）

```
--bg:#F1F5FB  --surface:#FFFFFF  --surface-alt:#E7EFF9
--border:#DCE6F2  --border-soft:#E3ECF6
--text:#202634  --text-muted:#74808F  --text-faint:#9BA7B5
--accent:#3D6FE0  --accent-hover:#2E58BE  --accent-grad-1:#6D93EE
--accent-soft-bg:#E1EAFB  --accent-soft-bg-strong:#CFE0FB
--accent-soft-text:#2C4F9E  --accent-soft-border:#C4D6F6
--accent-contrast:#FFFFFF
--accent-shadow:rgba(61,111,224,0.45)  --card-shadow:rgba(40,70,120,0.16)
--panel-gradient:linear-gradient(105deg,#E7EEFB 0%,#DCE7FA 55%,#E1EAFB 100%)
--scrollbar-thumb:#D7E2EF  --header-bg:rgba(241,245,251,0.82)
--success:#37A56E  --success-bg:#E4F3EA  --success-border:#BEE3CD  --success-text:#1F5C3D
--warning-bar:#F2A63B  --warning:#B87A17  --warning-bg:#FBEFD6  --warning-border:#F0D399
--danger:#E24C4C  --danger-hover:#CE3B3B  --danger-bg:#FBE7E4  --danger-border:#F1C4BD
--danger-text:#B83A3A  --danger-shadow:rgba(226,76,76,0.45)
--mid-green:#5FBE8A
```

（语义色沿用暖色的数值——两套浅色主题共享同一组成功/警告/危险色，只有背景/文字/强调色换了色相。）

### 黑色（`data-theme="dark"`）

```
--bg:#17181B  --surface:#202227  --surface-alt:#26282E
--border:#33353C  --border-soft:#2B2D33
--text:#EDEBE6  --text-muted:#97949E  --text-faint:#726F78
--accent:#E8A23D  --accent-hover:#F2B156  --accent-grad-1:#F2C16B
--accent-soft-bg:#3A2E1A  --accent-soft-bg-strong:#4E3C22
--accent-soft-text:#F0BE72  --accent-soft-border:#4A3A20
--accent-contrast:#1C1408
--accent-shadow:rgba(232,162,61,0.45)  --card-shadow:rgba(0,0,0,0.55)
--panel-gradient:linear-gradient(105deg,#2A2313 0%,#332815 55%,#241f14 100%)
--scrollbar-thumb:#3A3C43  --header-bg:rgba(23,24,27,0.82)
--success:#45B37F  --success-bg:#17301F  --success-border:#26492F  --success-text:#7BDDA8
--warning-bar:#E0A63A  --warning:#E0A63A  --warning-bg:#302711  --warning-border:#4A3B18
--danger:#E5646A  --danger-hover:#EF7A80  --danger-bg:#32191B  --danger-border:#4A2427
--danger-text:#F0898D  --danger-shadow:rgba(229,100,106,0.45)
--mid-green:#4FA87A
```

字体：标题用 `'Baloo 2'`（weight 500/600/700/800），正文用 `'Plus Jakarta Sans'`（400/500/600/700/800），通过 Google Fonts 引入，中文兜底 `'PingFang SC'`。圆角风格：卡片 20–22px，按钮 12–16px，胶囊/徽章 999px。卡片阴影统一用 `--card-shadow`。

---

## 2. Phase 8.1 — Token 基础设施

**文件**：新增 `packages/configs/tailwind-config/theme-tokens.css`，内容为三个 `:root[data-theme="xxx"] { ... }` 块（把第 1 节的变量抄进去，`warm` 块不需要 `[data-theme]` 限定，直接写在 `:root` 上作为默认值即可，`cool`/`dark` 用 `:root[data-theme="cool"]`、`:root[data-theme="dark"]` 覆盖）。

在 `packages/configs/tailwind-config/theme.css` 的 `@theme` 块里做一层桥接，把 Tailwind 的颜色 token 指向这些语义变量，这样组件里可以继续写 `bg-surface`、`text-muted`、`border-default` 这类 utility class，同时运行时换 `data-theme` 全站颜色跟着变：

```css
@theme {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-alt: var(--surface-alt);
  --color-border-default: var(--border);
  --color-text-default: var(--text);
  --color-text-muted: var(--text-muted);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  /* ……按需补全，命名避免和已有 brand-* 冲突 */
}
```

在 `apps/vite-app/src/styles.css` 里 `@import` 这个新文件（在 `@import "@biu/tailwind-config";` 之后）。

验收：`document.documentElement.setAttribute('data-theme','dark')` 后，页面背景/文字应立即变化（此时组件还没迁移，可能只有 `body` 背景变化，属预期，组件迁移在 8.4）。

---

## 3. Phase 8.2 — 主题状态管理

**文件**：`apps/vite-app/src/store/settings.ts`（已存在，Phase 5 建的双轨制设置 store）。

- 新增字段 `theme: "warm" | "cool" | "dark"`，默认 `"warm"`。
- 新增 action `setTheme(theme)`：更新 store + `document.documentElement.setAttribute('data-theme', theme)` + 持久化（沿用该 store 现有的持久化机制，若已有后端 `user_settings` 表，理想情况是新增一个 `theme` 字段一起存；若暂不想动后端，先用 `localStorage`，并留 `// TODO: 接入 user_settings.theme 字段` 注释）。
- `fetchSettings` 水合时，如果读到已保存的 `theme`，调用一次 `setTheme` 保证 `<html data-theme>` 和 store 一致。
- `App.tsx` 顶层 `useEffect` 里确保应用启动即设置一次 `data-theme`（避免刷新后闪一下默认主题）。

---

## 4. Phase 8.3 — 视觉基础对齐

- 在 `apps/vite-app/index.html` 或 `styles.css` 引入 Google Fonts：`Baloo 2`（500;600;700;800）+ `Plus Jakarta Sans`（400;500;600;700;800）。
- 全局 `body` 字体栈改为 `'Plus Jakarta Sans','PingFang SC','Microsoft YaHei',system-ui,sans-serif`；各页面 `<h1>/<h2>/<h3>` 标题字体改为 `'Baloo 2'`。
- 卡片类组件统一圆角/阴影：`rounded-[20px]` 或等价自定义 class，阴影用 `shadow-[0_6px_22px_-14px_var(--card-shadow)]`（Tailwind v4 支持任意值语法，直接引用 CSS 变量）。

---

## 5. Phase 8.4 — 组件级别迁移（逐个替换硬编码颜色）

按文件清单执行，每个文件内把 `indigo-*` / `gray-*` / `red-*` / `green-*` / `amber-*` 之类的写死色替换为语义 class（`bg-surface`、`text-muted`、`border-default`、`bg-accent`、`text-accent-contrast` 等，对应第 2 节桥接出来的 token）：

1. `App.tsx`（Dashboard 区块）：标题、问候语、DocTalk 入口卡片渐变（对应 `--panel-gradient`）、设置按钮。
2. `components/learning/RecommendedScenarios.tsx`：卡片背景/边框、难度徽章（A2 用 success 色系、B1 用 warning 色系、B2 用 accent-soft 色系）、"进入练习"按钮。
3. `components/learning/DailyProgress.tsx`：进度条轨道用 `surface-alt`，填充用 `accent` 渐变（`--accent-grad-1` → `--accent`）。
4. `components/learning/SkillTree.tsx`：三档进度条颜色规则——高分用 `success`，中等用 `mid-green`，低分用 `warning-bar`。
5. `components/conversation/VoiceInterface.tsx`：均衡器动画条渐变、"正在聆听"文字用 `success`、麦克风按钮用 `accent-soft-bg`、"结束对话"按钮用 `danger`。
6. `components/conversation/ChatSubtitles.tsx`：AI 气泡用 `surface-alt`，用户气泡用 `accent` 渐变 + `accent-contrast` 文字。
7. `components/learning/AnswerRecommendations.tsx`：面板背景/边框用 `success-bg`/`success-border`，标题用 `success-text`。
8. `components/pronunciation/PhonemeVisualizer.tsx`：正确/替换缺失/多余三态分别对应 `success`/`danger`/`warning-bar`。
9. `components/pronunciation/PronunciationFeedback.tsx`：分数环用 `success`，轨道用 `surface-alt`。
10. `components/doc-chat/DocUploadCard.tsx` / `PromptBuilder.tsx` / `DocChatSetup.tsx`：上传区 dashed 边框、预设按钮（`accent-soft-bg` + `accent-soft-text`）、"开始对话"主按钮。
11. `components/settings/SettingsDrawer.tsx`：见 Phase 8.5，同时把抽屉自身背景/分割线/输入框换语义色。

每完成一个文件，跑一次 `pnpm --filter vite-app lint` + `pnpm --filter vite-app typecheck`，确认无报错再进入下一个。

---

## 6. Phase 8.5 — 设置抽屉新增主题切换

在 `SettingsDrawer.tsx` 顶部新增一个 section（标题「外观主题」，副标题「选择暖色、冷色或黑色界面风格」），渲染三个色板按钮：暖色（预览色块 `#FBF7F1` + `#F76B4A`）、冷色（`#F1F5FB` + `#3D6FE0`）、黑色（`#17181B` + `#E8A23D`）。当前选中项用 2px `accent` 描边高亮。点击调用 Phase 8.2 的 `setTheme`，切换应立即生效、无需刷新。

---

## 7. Phase 8.6 — 测试与交付

按仓库当前文档规范交付：

- `docs/PHASE_8_TECH_STACK.md`：记录新增的 `theme-tokens.css`、`settings.ts` 的 `theme` 字段、涉及改动的组件清单。
- `docs/PHASE_8_MANUAL_TEST.md`：至少覆盖——
  - 三个主题分别在 Dashboard / Session / 评估 / DocChat / 设置抽屉 五个界面下的截图核对（对照第 1 节 token 表）。
  - 刷新页面后主题是否保持（持久化验证）。
  - 移动端宽度（375–390px）下三主题的可用性检查。
  - 文字对比度目视检查（暗色主题下强调色文字/危险色文字是否清晰可读）。
- 更新根目录 `README.md`「项目当前状态与进度」与「当前已支持的功能特性」，加入"三主题切换（暖色/冷色/黑色）"。
- 提交前跑通 Husky 钩子（lint + typecheck）。

---

## 附：为什么用 CSS 变量而不是 Tailwind 的 `dark:` 前缀

三个主题不是简单的明暗二值切换，而是三套完全独立的色板（含语义色的位置都不同），用 `dark:` 变体没法表达"冷色/暖色"这种同为亮色但色相不同的主题。用 `data-theme` + CSS 变量可以支持任意数量的主题，且未来加第 4 套主题时只需要在 `theme-tokens.css` 里加一个 `[data-theme="xxx"]` 块，组件代码零改动。
