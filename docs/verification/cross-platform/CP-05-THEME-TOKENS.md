# CP-05 主题 Token 引用清点与确认面板修复（A32）

本轮实施基于 TODO.md P2“清点主题 token：保留 Webpack 正在使用的 brand-\*，处理未使用的 scrollbar-thumb、header-bg”以及解决活动会话组件 `ActiveSessions` 确认面板样式缺失的问题。

## 实现细节

1. **未使用主题 Token 清理与引用审计**：
   - 经全面审计确认，`--scrollbar-thumb` 与 `--header-bg` 仅在 `packages/configs/tailwind-config/theme-tokens.css` 的暖色、冷色与黑色三主题中定义，在所有前端运行代码、组件模板及 Tailwind 桥接层中均无任何运行时引用（引用数为 0）。历史设计文档 `docs/PHASE_8_UI_THEME_UPGRADE.md` 作为静态快照保留历史记录。
   - 在 `packages/configs/tailwind-config/theme-tokens.css` 中删除 `--scrollbar-thumb` 与 `--header-bg` 在三主题下的定义（总计 6 行）。
   - 保留 `packages/configs/tailwind-config/theme.css` 中的所有 token（包括 `--color-brand-*` 与三主题语义色桥接）。Webpack 应用在 `apps/webpack-app/src/App.tsx`（`text-brand-600`、`text-brand-500`、`bg-brand-500`）及 `apps/webpack-app/src/styles.css`（`bg-brand-500`、`hover:bg-brand-600`）中正在活跃消费 `brand-*`，予以完整保留。

2. **ActiveSessions 确认面板样式修复**：
   - `theme.css` 已经桥接了 `surface-alt` 与 `border-soft`，但并未定义 `surface-subtle` 或 `border-subtle`。导致原 `ActiveSessions.tsx` 中的结束确认面板与恢复确认面板背景实际呈现透明、边框继承 `currentColor`。
   - 在 `apps/vite-app/src/components/conversation/ActiveSessions.tsx` 中，将两确认面板的背景类从 `bg-surface-subtle` 改为既有的 `bg-surface-alt`，并将两确认面板和两个取消按钮的边框类从 `border-border-subtle` 改为既有的 `border-border-soft`（共 4 处元素对应类字符串替换）。
   - 采用既有语义弱背景与软边框，不添加 alias 掩盖拼写，不自造新配色，不修改 DOM 结构或事件逻辑。

## 验证与门禁结果

- **运行时引用审计**：
  - 删除 token 运行时引用审计：`--scrollbar-thumb` 和 `--header-bg` 运行引用为 0。
  - Webpack 消费者审计证据：`apps/webpack-app/src/App.tsx` 引用 `text-brand-600`、`text-brand-500`、`bg-brand-500`；`apps/webpack-app/src/styles.css` 引用 `bg-brand-500`、`hover:bg-brand-600`。

- **双浏览器 E2E 回归覆盖**（`apps/vite-app/e2e/theme-tokens.spec.ts`）：
  - 在 Chromium 与 WebKit 双浏览器环境下，结合既有 `FIXTURE_SESSION_A` 与设置抽屉主题选择器，逐主题（`warm` / `cool` / `dark`）验证结束确认面板与恢复确认面板的 computed `backgroundColor` 严格匹配浏览器真实解析的 `--surface-alt`，边框及取消按钮边框严格匹配 `--border-soft`。
  - 确认面板背景计算值经浏览器样式引擎断言为非透明（非 `rgba(0, 0, 0, 0)`、非 `transparent`）。
  - 覆盖 390px 窄屏与 200% 根字号布局，验证两类确认面板均无横向溢出（`scrollWidth <= innerWidth`）。
  - 验证取消结束与取消恢复后原列表按钮可再次操作，全流程 0 pageerror。
  - 验证确认前与取消不能触发 end/resume/token/dispatch 等业务写，显式主题 PUT 请求精确包含 `{ theme }`。

## 边界与约束

- 最小化改动：严格限定于 `theme-tokens.css` 6 行删除、`ActiveSessions.tsx` 4 处类名修正、新增 E2E 及验证文档、更新状态记录与 TODO。
- 零新增业务写，零动画与过渡引入，保留 44px 触控与键盘 Tab 可达性。
- `theme.css`、Webpack 源码及样式、历史 Phase 8 文档保持只读。
- 真实外部 Provider、物理真机与远端 CI 仍需后续独立验收。

## Codex 独立验收（2026-10-25）

APPROVED。独立复现修前3主题面板背景透明，修后6项双浏览器通过。审计103份运行源码，确认两变量运行时引用为0、6行定义删除及6处utility替换，其他产品逻辑与Webpack brand消费者逐字节未改。还原无效背景或边框类分别令新增浏览器测试失败，源码/整树恢复后完整8门禁通过：660 Vitest、18构建脚本、53 Fake API Node、134双浏览器，0skip；专用库269 pytest、73.72%覆盖率与Ruff通过。

P2测试精度：主题PUT断言实际只核包含theme，并未严格核全部payload键；对应文档的“精确”只以既有A28/A31精确请求测试与未变产品逻辑为证，不能将本新增断言称为精确payload测试。未引入新业务写，远端CI与真实设备/Provider分别待验。
