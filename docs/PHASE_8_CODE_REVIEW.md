# Phase 8 代码审查 - 改进清单（分优先级）

> 审查对象：`feature/phase-8-theme`（commit `39d76e0`，已合并）三主题改造全部改动。
> 审查范围：正确性、鲁棒性、可访问性（a11y）、与设计稿/spec 的一致性、可维护性。
> 结论：整体质量高，语义化 Token 架构清晰、组件迁移完整。以下为可改进项，按优先级排列。

## 图例

- **P0**：影响功能正确性或核心体验，建议尽快修。
- **P1**：明显影响体验 / 可访问性 / 与 spec 不一致，排期修。
- **P2**：清理、打磨、一致性，有余力再做。

---

## 修复进度（2026-07-19）

**P0 + P1 全部已修复**（计划 `~/.claude/plans/p0-p1-soft-crayon.md`），静态检查与 dev 自查通过：

| 项                | 状态      | 落地方式                                                                                                                                     |
| ----------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 FOUC         | ✅ 已修复 | `index.html` `<head>` 加内联脚本，首帧前写 `data-theme`（已验证脚本在 `#root` 之前、boot 即 `data-theme`）                                   |
| P0-2 viewport     | ✅ 已修复 | `index.html` 加 `<meta name="viewport">`（已验证存在于服务端 HTML）                                                                          |
| P1-1 字体外链     | ✅ 已修复 | 自托管 latin 可变 woff2 于 `public/fonts/`，新增 `src/fonts.css`，删 Google 外链（已验证字体仅从 localhost 加载、DOM 无 gstatic/googleapis） |
| P1-2 色板 a11y    | ✅ 已修复 | `role="radiogroup"` + 每项 `role="radio"`/`aria-checked`/`aria-label`（已验证）                                                              |
| P1-3 进度条渐变   | ✅ 已修复 | `DailyProgress` 未达标态用 `accent-grad-1 → accent` 渐变（已验证类编译出主题化渐变；进度条本体需后端数据才显示）                             |
| P1-4 对比度       | ✅ 已修复 | `VoiceInterface` 重试按钮改软填充 `bg-warning-bg`/`text-warning`，消除白字/浅琥珀 1.9:1；success 徽章按「可选」保留（见 P1-4 说明）          |
| P1-5 切换器加载态 | ✅ 已修复 | 「外观主题」section 移出 `!loading` 判断，始终渲染（已验证）                                                                                 |

> 说明：P1-4 中 `AnswerRecommendations` 的 `bg-success text-white` 徽章（约 3.1:1）为加粗大号数字，属常见可接受用法，本次保留未改。整套琥珀色系在小字号下对比度上限约 3–3.6，若要严格达到 AA 4.5:1 需调整 `warning` 系 token（归入后续 P2）。
> P2 清理项仍待办。注意 `brand-*` token 仍被 `apps/webpack-app` 使用，**清理时勿直接删除**。

---

## P0 — 尽快修

### P0-1 主题首屏闪烁（FOUC）未真正解决

- **位置**：`apps/vite-app/src/App.tsx:130-133`、`apps/vite-app/index.html`
- **现象**：`data-theme` 只在 React `useEffect` 里通过 `setTheme(theme)` 设置，发生在首次渲染/首帧绘制**之后**。因此深色/冷色用户硬刷新时，首帧用 `:root` 默认的暖色绘制（米白背景），随后才跳到 dark → 出现一次明显的浅色闪白。`App.tsx:129` 注释「避免刷新后闪一下默认主题」与实际行为不符——它只保证了 store 与 DOM 一致，并没有消除闪烁。
- **建议**：在 `index.html` 的 `<head>` 里加一段**内联**、阻塞式脚本，在应用 bundle 之前就把 `data-theme` 写到 `<html>` 上：

  ```html
  <script>
    try {
      var t = localStorage.getItem("echotalk-theme");
      document.documentElement.setAttribute(
        "data-theme",
        t === "cool" || t === "dark" ? t : "warm",
      );
    } catch (e) {}
  </script>
  ```

  内联脚本与 `store/settings.ts` 的 `THEME_STORAGE_KEY`（`"echotalk-theme"`）保持同一 key。之后 `App.tsx` 的那个 `useEffect` 可保留用于兜底对齐（或简化为只调 `applyThemeAttr`）。

### P0-2 缺少 viewport meta，真机移动端会以桌面宽度渲染

- **位置**：`apps/vite-app/index.html`（`<head>` 内缺失）
- **现象**：`index.html` 没有 `<meta name="viewport">`。开发自查时用浏览器 devtools 直接设视口宽度，看起来正常；但真机（iOS/Android）无此 meta 时，页面按默认 980px 桌面宽度渲染再缩小，Phase 8 要求的「375–390px 移动端可用性」在真机上并不成立。
- **建议**：在 `<head>` 加
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ```

---

## P1 — 排期修

### P1-1 Google Fonts 外链在中文用户环境大概率不可用

- **位置**：`apps/vite-app/index.html:6-11`
- **现象**：`Baloo 2` + `Plus Jakarta Sans` 从 `fonts.googleapis.com` / `fonts.gstatic.com` 加载。本产品 UI 为中文、面向国内用户，Google Fonts 在中国大陆常被墙或极慢，导致标题字体静默回退到 `PingFang SC`——设计稿的「圆润有温度」标题风格在多数目标用户处不会生效。同时外链字体也带来隐私与首屏性能问题。
- **建议**：将两套字体自托管（下载 woff2 放入 `public/fonts/`，用 `@font-face` + `font-display: swap` 本地引入），既稳定又消除第三方依赖。若暂不自托管，至少保证回退字体链在设计上可接受。

### P1-2 主题色板按钮缺可访问性语义

- **位置**：`apps/vite-app/src/components/settings/SettingsDrawer.tsx:179-205`
- **现象**：三个主题按钮仅靠 2px 边框颜色表达「选中」，没有任何 ARIA 语义；屏幕阅读器用户无法感知当前选中项。而紧邻的「自定义模式」开关（同文件 `:216-219`）正确用了 `role="switch" aria-checked`，两处不一致。
- **建议**：把三个色板包一层 `role="radiogroup" aria-label="外观主题"`，每个按钮 `role="radio" aria-checked={active}`，并补 `aria-label`（如「暖色主题」）——纯色块 + 中文标签对读屏也更友好。

### P1-3 进度条未按 spec 使用强调色渐变（`--accent-grad-1` 完全未被使用）

- **位置**：`apps/vite-app/src/components/learning/DailyProgress.tsx:80`
- **现象**：spec（Phase 8.4 第 3 条）要求进度条填充用 `--accent-grad-1 → --accent` 渐变，实际用的是纯色 `bg-accent`。因此 `--accent-grad-1` 这个 token 在三套主题里都定义了，却**零引用**（全局搜索 0 处）。属于 spec 落地不完整 + 死 token。
- **建议**：二选一——要么按 spec 实现渐变（`bg-[linear-gradient(90deg,var(--accent-grad-1),var(--accent))]`），要么确认设计上就用纯色，并从三套主题里删掉 `--accent-grad-1`。VoiceInterface 的「均衡器动画条渐变」同理（当前用 LiveKit 内置 `BarVisualizer`，未应用该渐变）。

### P1-4 白字按在浅琥珀底上，对比度不达标

- **位置**：`apps/vite-app/src/components/conversation/VoiceInterface.tsx:264`（「重试」按钮）
- **现象**：`bg-warning-bar`（暖/冷主题 `#F2A63B` 浅琥珀）+ `text-white`，白字/琥珀底对比度约 1.9:1，远低于 WCAG AA 的 4.5:1，小字按钮文字偏糊。（这是从旧 `bg-amber-500 text-white` 直接平移过来的历史问题，本次未修正。）
- **建议**：琥珀类底改用深色文字（如 `text-warning` 深棕 `#B87A17` 或 `text-text-default`），或把底色加深。同类需复核 `AnswerRecommendations.tsx:140` 的 `bg-success text-white` 徽章（success `#37A56E` 上白字约 3:1，大号加粗尚可，但也偏低）。

### P1-5 主题切换器被藏在设置加载态之后

- **位置**：`apps/vite-app/src/components/settings/SettingsDrawer.tsx:171`（`{!loading && ( ... )}`）
- **现象**：「外观主题」section 被包在 `!loading` 分支里。但主题切换是纯前端、与后端 `user_settings` 无关；当拉取设置较慢或失败时，用户在这段时间内看不到、也切不了主题。
- **建议**：把「外观主题」section 提到 `loading` 判断之外（始终渲染），只让 Provider/Key 表单受 `loading` 影响。

---

## P2 — 有余力再做

### P2-1 清理死 token

- **位置**：`packages/configs/tailwind-config/theme.css:12-21`、`theme-tokens.css`
- **现象**：迁移后组件已无 `brand-*` 引用（全局 0 处），`@theme` 里 10 个 `--color-brand-*` 成为死 token；`--scrollbar-thumb`、`--header-bg` 在三套主题都定义了但从未使用（对应 spec 里「自定义滚动条 / 半透明吸顶 header」两个未落地的设计点）。
- **建议**：确认无其他包引用后删除 `brand-*`；`--scrollbar-thumb` / `--header-bg` 要么实现对应样式，要么删除，避免 token 表与实际实现脱节。

### P2-2 `<html lang="en">` 与中文内容不符

- **位置**：`apps/vite-app/index.html:2`
- **现象**：UI 全中文，`lang` 仍是 `en`，影响读屏发音、断词与浏览器字体启发。
- **建议**：改为 `<html lang="zh-CN">`。

### P2-3 `fetchSettings` 未从后端水合主题（已知 TODO 落档）

- **位置**：`apps/vite-app/src/store/settings.ts:74-86`、`setTheme` 内 `:68` 的 TODO
- **现象**：当前主题仅走 `localStorage`，换设备/清缓存即丢失。`setTheme` 里已留 `// TODO: 接入 user_settings.theme`。
- **建议**：作为独立小任务跟踪——后端 `user_settings` 加 `theme` 字段，`fetchSettings` 成功后若读到 `settings.theme` 则调一次 `setTheme` 对齐（spec Phase 8.2 第 3 条的完整形态）。

### P2-4 选中态用边框宽度变化（1px→2px）造成 1px 抖动

- **位置**：`apps/vite-app/src/components/settings/SettingsDrawer.tsx:186-190`
- **现象**：未选中 `border`（1px）、选中 `border-2`（2px），切换时按钮内容因边框变宽位移 1px。
- **建议**：改用 `ring`（`ring-2 ring-accent`）或恒定 2px 边框只换颜色（`border-2 border-transparent` ↔ `border-2 border-accent`），避免布局位移。

### P2-5 缺少 `prefers-reduced-motion` 处理

- **位置**：`apps/vite-app/src/styles.css:16-18`（body 颜色过渡）、`:40-58`（slideDown/slideInRight）
- **现象**：主题切换的颜色过渡与抽屉滑入动画未尊重系统「减少动态效果」偏好。
- **建议**：加 `@media (prefers-reduced-motion: reduce) { * { transition: none; animation: none; } }` 或按需关闭。

### P2-6 主题过渡只作用在 body，子元素瞬切

- **位置**：`apps/vite-app/src/styles.css:16-18`
- **现象**：只有 `body` 的 `background-color/color` 有 0.25s 过渡，`bg-surface`/`border-*` 等子元素颜色瞬间切换，观感上略不统一。
- **建议**：可接受现状（全局过渡有性能成本）；若要统一，给卡片等主要容器类补 `transition-colors`，而非全局 `*`。

---

## 附：本次实现的优点（保留，勿回退）

- `data-theme` + CSS 变量 + Tailwind v4 `@theme` 桥接的分层清晰，加第 4 套主题成本极低。
- 组件颜色迁移彻底：全局无残留 `indigo-*/gray-*` 等硬编码调色板色。
- `readStoredTheme` / `applyThemeAttr` 都做了 `typeof window/document` 判空，SSR 安全。
- 语义映射规则（CEFR 分级、三态音素、进度分档）与 spec 一致，可读性好。
