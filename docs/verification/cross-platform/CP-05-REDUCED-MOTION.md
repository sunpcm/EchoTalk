# CP-05 颜色过渡与设置抽屉减少动态效果（A27）

本轮实施基于 TODO.md P2“为颜色过渡和抽屉动画支持 prefers-reduced-motion”契约（本地独立评审 APPROVED）。通过 CSS 媒体查询响应系统偏好，无需新增 JS 运行时监听、依赖或额外配置项。

## 实现细节

1. **CSS prefers-reduced-motion 媒体查询支持**：
   - 在 `apps/vite-app/src/styles.css` 声明 `@media (prefers-reduced-motion: reduce)`。
   - `reduce` 模式下：
     - `*, *::before, *::after` 设置 `transition-duration: 0s !important; transition-delay: 0s !important;`，消除所有装饰性颜色、阴影、宽度、transform 的持续插值过渡。
     - `body` 设置 `transition: none !important;`，彻底禁用主题颜色过渡。
     - `dialog.settings-drawer` 设置 `animation: none !important;`，消除 slideInRight 入场位移动画，抽屉直接呈现于最终停靠位置。
     - 不使用全局 `animation: none`，保留功能性加载旋转（例如 `animate-spin` loading spinner）。
   - `no-preference` 模式下：
     - 保留既有 body `0.25s` 背景与文字颜色平滑过渡。
     - 保留设置抽屉 `0.25s` slideInRight 入场动画及各类组件装饰性 transition。

2. **浏览器真实组件回归验证**：
   - 新增 `apps/vite-app/e2e/reduced-motion.spec.ts`，涵盖：
     - `no-preference` 基准验证：body 0.25s transition、抽屉 slideInRight 动画、外观主题切换、Escape 关闭与焦点恢复、再次打开仍可用。
     - `reduce` 偏好验证：body computed transition 为 0s/none，装饰性 button transition 为 0s，抽屉 animationName 为 none；未隐藏元素，尺寸可用，独立探针另验最终 transform 为 none，外观主题切换正常。
     - 抽屉打开前与保持打开时实时切换 `reduce` / `no-preference` 偏好，通过 `expect.poll` 验证 computed 动画与过渡实时生效。
     - 真实功能性 loading spinner 动画在 `reduce` 下未被误禁（animationName 包含 `spin` 且 animationPlayState 为 `running`）。
     - 偏好切换与打开/关闭抽屉过程中，捕获并验证零隐式业务写请求（PUT /user/settings）。

## 验证与门禁结果

- 完整 7 项 quality 门禁已通过：
  - `format`: 通过
  - `lint`: 通过
  - `typecheck`: 通过
  - `test`: 25 文件 620 测试全部通过
  - `build-script-test`: 5 suites 18 测试全部通过
  - `build`: 通过
  - `e2e`: 114 项双浏览器测试全部通过（Chromium 57 项 + WebKit 57 项，含本轮 10 项新增用例）
- 批次报告摘要与证据：
  - summary: `.review/reports/track-b/implementer/batches/20261024-210414-573220/summary.json`
  - batch-pointer: `.review/reports/track-b/implementer/batches/3b543ab0-1198-4431-9be7-e247ffa2e42e-batch-pointer.json`

## 边界与说明

- 本轮仅修改 `styles.css` 并补充 e2e 测试与文档，未修改组件逻辑、认证、媒体、store、API、配置或依赖。
- 自动化测试基于 Chromium 和 WebKit 双浏览器环境，不声称真实操作系统（macOS/iOS/Windows/Android）的全局设置集成或独立 APPROVED。

## Codex 独立验收

- 基线：本地 main、origin/main 与远端 refs/heads/main 均核验为 `80fb8eca0dcfd76d41d9cfd26f91398f95b43745`；cp00 从同一干净基线开工。
- 7 项完整质量门禁由 Codex 亲自复跑，620 产品 / 18 构建脚本 / 114 双浏览器全部通过，0 skip。独立 summary：`.review/reports/track-b/implementer/batches/20261024-211045-566532/summary.json`。该目录只是历史证据命名空间，实际 cwd 是 cp00。
- 4 项独立 Chromium/WebKit 探针覆盖重复实时偏好切换、所有可见元素过渡、dialog 最终 transform、焦点/主题/再次打开，以及 component/utility 过渡停止而 spin 保留。证据 `.review/reports/workflow-reduced-motion-a27/reviewer/ev/ev-08.txt`。
- 两项有效变异分别移除抽屉 animation 保护、破坏全局 transition duration；新增 Chromium 用例分别出现 2 项和 1 项失败。逐字节恢复后再跑完整门禁。变异日志和文件恢复 hash 见本地 reviewer 目录，失败原文保留。
- 后端专用库身份及空 schema 复核后，独立审查并执行既有迁移至 c03_call_leases；pytest 269 通过，覆盖率 73.72%，Ruff 格式/lint 通过。初始停止/空库阻断保留，未用应用库回退。
- 文档实施方曾提前使用“独立验证”措辞及冗余 0s 时长，由评审按真实证据纠正；无 P0/P1 产品返工。探针初始 cwd 错误保留并修正，不归因产品。
- Flash Medium 首轮完整交付，账本活动时间约 796.25 秒；会话末累计 input 203490 / output 34096 / total 237586，cache_read 4902632、thinking 20278 分列，不代表账单或 Codex 净省额。本 Codex turn 尚未结束，不伪报完整用量。
- 完整裁定、精确文件 SHA256 与证据索引保存在 `.review/reports/workflow-reduced-motion-a27/reviewer/`，不跟踪进 Git。未访问真实 IdP/LiveKit/Provider/设备链路，未 push、远端 merge 或部署。
