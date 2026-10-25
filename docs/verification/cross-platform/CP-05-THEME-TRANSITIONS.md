# CP-05 主要容器主题颜色过渡验证（A35）

本轮实施基于 TODO.md P2“按主要容器补齐主题颜色过渡，避免子元素瞬间切色”契约。在复用既有三套主题设计 Token 及 body 250ms ease 规范的基础上，为覆盖在 body 之上的应用主要容器、卡片、设置抽屉及显式语义文本补齐平滑的主题颜色过渡，消除切换主题时子元素的瞬间切色现象。

## 实现细节

1. **作用域明确的主题颜色过渡范围（CSS-first）**：
   - 在 `apps/vite-app/index.html` 的既有 `#root` 容器上添加 `class="theme-transitions"` 单个 scope class，严格不改动 head、首帧主题脚本或 DOM 结构。
   - 在 `apps/vite-app/src/styles.css` 中，针对 `.theme-transitions` 作用域内实际使用的核心语义类做集中、小范围规则声明：
     - 主要背景容器（`.bg-bg`, `.bg-surface`, `.bg-surface-alt`, `.card`, `dialog.settings-drawer`, 抽屉粘性 header）：声明 `background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease`。
     - 显式语义文字（`.text-text-default`, `.text-text-muted`, `.text-text-faint`, `.text-accent`, `.text-accent-soft-text`）：声明 `color 0.25s ease, background-color 0.25s ease, border-color 0.25s ease`。
     - 显式边框类（`.border-border-default`, `.border-border-soft`, `.border-accent-soft-border`）：声明 `border-color 0.25s ease, background-color 0.25s ease, color 0.25s ease`。
   - 规则不套用于全局通配符 `*`，完全不影响 Webpack 构建产物或外部 DOM。

2. **保留容器原 box-shadow 过渡与 hover 能力**：
   - 识别应用内使用 `transition-shadow` 的两个既有容器（`App.tsx` 中的 DocTalk 入口卡片按钮与 `RecommendedScenarios.tsx` 中的推荐场景卡片）。
   - 在 JSX 现有 `transition-shadow` 处精简组合 `transition-colors`（`transition-shadow transition-colors`），并在 `styles.css` 中针对 `.theme-transitions .transition-shadow` 显式声明：
     `transition: box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease;`
   - 确保卡片在 hover 时继续保持默认 150ms 的 box-shadow 平滑展开能力，不因颜色过渡规则丢失阴影动画。

3. **完全兼容 prefers-reduced-motion（A27 规范保持）**：
   - 继承既有 `@media (prefers-reduced-motion: reduce)` 规则（`transition-duration: 0s !important; transition-delay: 0s !important;`）。
   - 在 `reduce` 偏好下，所有容器与文字的持续过渡时间严格降为 `0s`，颜色立即达到最终 token 值，设置抽屉无 slideInRight 位移动画，且功能性 loading spinner 动画不受任何影响。

4. **双浏览器自动化 E2E 验证覆盖**：
   - 新增 `apps/vite-app/e2e/theme-transitions.spec.ts`：
     - 普通模式（`no-preference`）下验证 Dashboard 根、推荐卡片、设置抽屉、抽屉内粘性 header 及显式文字的 computed transition 均包含对应属性与 `0.25s`；
     - 验证卡片 computed transition 包含 `box-shadow` 与 `0.15s`，且 hover 时 box-shadow 正常变化；
     - 通过 Web Animations API（`element.getAnimations()`）在真实主题 radio 切换时捕获实际生成的 `CSSTransition`，暂停动画并 seek 到中点（125ms），断言计算样式处于初值与终值之间的平滑插值中间态；
     - `reduce` 模式下验证 transitionDuration 为 0s，颜色立即生效，drawer 动画为 none；spinner 条件检查不计实际覆盖，功能性 spinner 依保留的 A27 专门回归验收；
     - 新增用例仅在默认视口检查无水平溢出及卡片宽高；390px/200% 根字号、完整根容器位置尺寸由 Codex 独立探针补足；
     - 监听网络请求，断言仅触发精确的 `{ theme }` PUT，零 `session/lease/token/dispatch` 等隐式业务写请求，0 pageerror。

## 边界与说明

- 本轮仅修改 `index.html`、`styles.css`、`App.tsx`、`RecommendedScenarios.tsx` 四处文件，未修改其他组件、业务逻辑、状态、认证或后端代码。
- CSS 渐变（如 `--panel-gradient`）在当前浏览器中不支持直接插值过渡，本轮仅针对可插值的 `background-color`、`border-color` 与 `color` 实现平滑过渡，不引入额外 crossfade DOM 层或 Houdini 属性注册。

## Codex 独立验收（2026-10-25）

APPROVED。修前普通模式缺少主容器过渡的真实反例失败、reduce基线通过；修后10独立双浏览器通过：4项普通/reduce computed及焦点恢复，4项默认与390px/200%字号的背景/显式文字真实CSSTransition中间态、两次正反主题选择、根容器完整boundingBox一致、精确{theme} PUT与零其他写，2项真实390px/200%布局不溢出。

根scope去除与reduce时长改为250ms分别导致1项新增浏览器测试失败；备份finally逐字节与整树指纹恢复后8项门禁698 Vitest/18构建脚本/53 Fake API Node/144双浏览器通过，0skip；本轮专用库269 pytest、覆盖率73.72%及Ruff通过。首轮浏览器失败由实施方正常修正后完整重跑，原日志保留。

P2证据说明：新增E2E描述窄屏/200%但未设置对应参数，且spinner仅存在时才测，不能将这些分支当已执行覆盖；独立实际参数测试与旧A27 spinner专测分别补足。保留原始报告并校正文档，不扩全局skill。CSS渐变资产不重构、不宣称渐变background-image可插值；本地验证不替代真实设备视觉验收。
