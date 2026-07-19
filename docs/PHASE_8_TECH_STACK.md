# Phase 8 视觉重设计 + 三主题切换 - 技术栈与架构文档

## 1. 核心目标

Phase 8 为 EchoTalk 引入**可运行时切换、可持久化的三套界面主题**（暖色 / 冷色 / 黑色），并把现有页面从通用 Tailwind 调色板（`indigo-*` / `gray-*`）迁移到语义化设计 Token。核心技术选型是 **`data-theme` + CSS 自定义属性 + Tailwind v4 `@theme` 桥接**，而非 Tailwind 的 `dark:` 二值变体——因为三套主题是三组独立色板（含语义色位置都不同），`dark:` 无法表达"暖色 / 冷色"这种同为亮色但色相不同的主题。未来新增第 4 套主题只需在 `theme-tokens.css` 里追加一个 `[data-theme="xxx"]` 块，组件代码零改动。

## 2. 新增与修改文件结构

```text
packages/configs/tailwind-config/
├── theme-tokens.css        # [新增] 三套主题的语义化 CSS 变量（warm 写 :root，cool/dark 用 [data-theme] 覆盖）
└── theme.css               # [改] @import theme-tokens.css + @theme 桥接层（--color-* → var(--语义变量)）

apps/vite-app/
├── index.html              # [改] 引入 Google Fonts：Baloo 2 + Plus Jakarta Sans
└── src/
    ├── styles.css          # [改] body 字体栈/背景语义色、h1~h3 用 Baloo 2、.btn-primary/.card 换语义色
    ├── App.tsx             # [改] Dashboard 去硬编码色 + 启动 useEffect 应用 data-theme
    ├── store/
    │   └── settings.ts     # [改] 新增 theme 字段 + setTheme + readStoredTheme/applyThemeAttr + localStorage
    └── components/
        ├── settings/SettingsDrawer.tsx        # [改] 新增「外观主题」色板切换 + 抽屉自身换语义色
        ├── conversation/VoiceInterface.tsx    # [改] 去硬编码色
        ├── conversation/ChatSubtitles.tsx     # [改] AI/用户气泡语义色
        ├── doc-chat/DocChatSetup.tsx          # [改] 去硬编码色
        ├── doc-chat/DocUploadCard.tsx         # [改] dashed 上传区/字符计数语义色
        ├── doc-chat/PromptBuilder.tsx         # [改] 预设胶囊语义色
        ├── learning/RecommendedScenarios.tsx  # [改] 卡片/CEFR 难度徽章语义色
        ├── learning/DailyProgress.tsx         # [改] 进度条轨道/填充语义色
        ├── learning/SkillTree.tsx             # [改] 三档进度色规则
        ├── learning/AnswerRecommendations.tsx # [改] success 色系面板
        ├── pronunciation/PhonemeVisualizer.tsx    # [改] 正确/替换缺失/多余三态语义色
        └── pronunciation/PronunciationFeedback.tsx # [改] 分数环/语法错误语义色
```

## 3. Token 基础设施（Phase 8.1）

### 3.1 语义变量层 `theme-tokens.css`

定义三套主题的语义化 CSS 变量，`warm` 直接写在 `:root` 上作为默认值，`cool` / `dark` 用属性选择器覆盖：

```css
:root {
  --bg: #fbf7f1;
  --accent: #f76b4a; /* …暖色 */
}
:root[data-theme="cool"] {
  --bg: #f1f5fb;
  --accent: #3d6fe0; /* …冷色 */
}
:root[data-theme="dark"] {
  --bg: #17181b;
  --accent: #e8a23d; /* …黑色 */
}
```

变量分为：背景层（`--bg` / `--surface` / `--surface-alt`）、边框（`--border` / `--border-soft`）、文字（`--text` / `--text-muted` / `--text-faint`）、强调色（`--accent` 及其 hover/渐变/soft 变体/contrast）、阴影与渐变（`--card-shadow` / `--accent-shadow` / `--panel-gradient`）、语义色（success / warning / danger / mid-green，各含 bg/border/text 变体）。两套浅色主题（warm / cool）共享同一组 success/warning/danger 数值，仅背景/文字/强调色换色相；dark 主题的语义色单独调暗。

### 3.2 桥接层 `theme.css`（`@theme`）

Tailwind v4 的 `@theme` 块把 `--color-*` 指向语义变量，从而生成 `bg-surface` / `text-muted` / `border-default` / `bg-accent` 等 utility class：

```css
@theme {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-text-muted: var(--text-muted);
  --color-accent: var(--accent);
  /* …完整桥接见文件，命名带语义后缀避免与既有 brand-* 冲突 */
}
```

`@import "./theme-tokens.css"` 放在 config 包内（随包被各应用消费），无需额外 exports 子路径。组件写 utility class，运行时切换 `<html data-theme>` 即全站颜色跟随变化。

## 4. 主题状态管理（Phase 8.2）

`apps/vite-app/src/store/settings.ts`（Zustand store）扩展：

- **类型**：`export type ThemeName = "warm" | "cool" | "dark"`。
- **字段**：`theme: ThemeName`，初值取自 `readStoredTheme()`（读 `localStorage["echotalk-theme"]`，无则回退 `warm`）。
- **Action** `setTheme(theme)`：`applyThemeAttr`（写 `<html data-theme>`）+ 写 localStorage + `set({ theme })`。切换即时生效、无需刷新。
- **SSR/持久化守卫**：`readStoredTheme` / `applyThemeAttr` 均对 `window` / `document` 做 `typeof` 判空。
- **App 启动**：`App.tsx` 顶层 `useEffect` 调一次 `setTheme(theme)`，把 `<html data-theme>` 与 store 初值对齐，避免刷新后闪默认主题。

> 当前主题持久化走 `localStorage`；`setTheme` 中保留 `// TODO: 接入 user_settings.theme 字段` 注释，后续可接后端 `user_settings` 表实现跨设备同步。

## 5. 视觉基础对齐（Phase 8.3）

- **字体**：`index.html` 通过 Google Fonts 引入 `Baloo 2`（500/600/700/800）+ `Plus Jakarta Sans`（400/500/600/700/800）；`styles.css` 中 body 正文字体栈 `'Plus Jakarta Sans','PingFang SC','Microsoft YaHei',system-ui,sans-serif`，`h1~h3` 标题字体 `'Baloo 2'`，中文兜底 `PingFang SC`。
- **圆角/阴影**：卡片 `rounded-[20px]`、按钮 `rounded-[14px]`、胶囊 `rounded-full`；卡片阴影统一 `shadow-[0_6px_22px_-14px_var(--card-shadow)]`（Tailwind v4 任意值语法直接引用 CSS 变量）。
- **过渡**：body 加 `transition: background-color/color 0.25s`，主题切换时颜色平滑过渡。

## 6. 组件级颜色迁移（Phase 8.4）

11 个组件把 `indigo-*` / `gray-*` / `red-*` / `green-*` / `amber-*` / `emerald-*` 等硬编码色替换为语义 utility。典型语义映射规则：

| 组件                                               | 迁移规则                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `RecommendedScenarios`                             | CEFR 徽章：A1/A2 → success 色系、B1 → warning、B2/C1/C2 → accent-soft |
| `DailyProgress`                                    | 进度条轨道 `surface-alt`，填充 `accent`（达标态切 `success`）         |
| `SkillTree`                                        | 三档进度：高分 `success` / 中等 `mid-green` / 低分 `warning-bar`      |
| `AnswerRecommendations`                            | 面板 `success-bg` / `success-border` / `success-text`                 |
| `PhonemeVisualizer`                                | 正确 `success` / 替换缺失 `danger` / 多余 `warning-bar`               |
| `PronunciationFeedback`                            | 分数环按分段 success/warning/danger，轨道 `surface-alt`               |
| `ChatSubtitles`                                    | AI 气泡 `surface-alt`，用户气泡 `accent` + `accent-contrast` 文字     |
| `VoiceInterface`                                   | 结束按钮 `danger`，卡片语义色（均衡器/控制栏为 LiveKit 内置组件）     |
| `DocUploadCard` / `PromptBuilder` / `DocChatSetup` | dashed 上传区、预设胶囊 `accent-soft`、主按钮 `accent`                |

## 7. 设置抽屉主题切换（Phase 8.5）

`SettingsDrawer.tsx` 顶部新增「外观主题」section（副标题「选择暖色、冷色或黑色界面风格」），渲染三个色板按钮，每个含预览色块（背景色 + 强调色圆点）：

```ts
const THEME_SWATCHES = [
  { value: "warm", label: "暖色", bg: "#FBF7F1", accent: "#F76B4A" },
  { value: "cool", label: "冷色", bg: "#F1F5FB", accent: "#3D6FE0" },
  { value: "dark", label: "黑色", bg: "#17181B", accent: "#E8A23D" },
];
```

当前选中项用 2px `accent` 描边高亮，点击调用 `setTheme` 即时切换。抽屉自身背景、分割线、输入框、开关、状态徽章同步迁移为语义色。

## 8. 验证要点

- `pnpm --filter vite-app typecheck`、`pnpm --filter vite-app lint` 均通过（lint 仅剩 `src/lib/api.ts` 2 处既有 `no-explicit-any` warning，非本阶段引入）。
- 详细手工验收步骤见 [PHASE_8_MANUAL_TEST.md](./PHASE_8_MANUAL_TEST.md)。
