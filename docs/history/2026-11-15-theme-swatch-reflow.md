# 主题按钮大字号重排（READ2）— 本机验收与边界记录

> 日期：2026-11-15；任务包：READ2（主题按钮大字号重排窄包）；分支 `codex/theme-swatch-reflow-20261115`；
> 核验基线 main `cf104bb9b71662f4d020911663333c35c70a24aa`（A11Y PR181 已合，含 READ PR179 源码）。
> 候选两路径 blob（本包实施，未发布）：
> `apps/vite-app/src/components/settings/SettingsAppearance.tsx` = `3943bd1b3b3d1640773c03dc51c0a1fecfdb4890`、
> `apps/vite-app/e2e/settings-readability.spec.ts` = `e799093e48aa571fe954e658f56db667aed7b93f`。
> 本文件记录本机（Harness）验收、命令、受控反例/恢复验证与未验证边界；不冒充已发布 main/CI，不预填 READ2 PR 编号或发布终点 SHA。

## 范围与最终改动

本轮仅两源路径（产品 CSS token、Provider 字段、其他测试、Fake/store/API、配置/依赖/锁、后端/DB 全部零改）：

- `apps/vite-app/src/components/settings/SettingsAppearance.tsx`：仅从 radio 按钮 `className` 删除 `flex-1`
  一个 token（根因：`flex-1` + `min-w-[44px]` 在 200% 根字号下把按钮内容挤小），保留 `min-h-[44px] min-w-[44px]`、
  颜色 class、`onClick`、`role="radio"`、`aria-checked`、`aria-label`、label、44px、i18n；无固定大字号特例。
- `apps/vite-app/e2e/settings-readability.spec.ts`：新增 `measureSwatchGeometry(page)` 辅助函数，定位
  `[role="radiogroup"]`，遍历 `[role="radio"]`，读取按钮外框、外圈 swatch、内点、label 文字的
  `getBoundingClientRect()` 真实矩形，以 0.5px 亚像素容差断言三者均在按钮边界内（不只看 class）；在禁用态
  阶段接入一次测量并把 `swatchGeometry` 追加进 `metrics-disabled`。未新增用例，保持 3 主题 × 390/1280 ×
  正常/200% × C/W = 24 用例；全部 READ 旧断言、计数、输入/测量算法与截图逻辑不动。

## 验收结果（本机 Harness，未发布，不冒充已发布 main）

17 门禁分阶段亲跑全 success；完整 E2E 258 两次——首次旧 READ 基线、第二次继承 ST+A11Y 后：

- Vitest 1249 passed / 53 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 957 passed / 3 warnings / 80.63%（71.00s / 命令 75.40s）
- 完整 E2E 258（C129/W129，实际 retry/skip/flaky 0）：首次 Playwright 57.0121s / 命令 58.20s；继承 ST+A11Y 后
  Playwright 51.99941s / 命令 53.01s

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。三树为本机 Harness 分阶段亲跑，不是单条命令一次全绿。

## 变异（Harness 私有，目标 RED + 逐字节恢复 GREEN）

- flex-1 私有恢复：`SettingsAppearance.tsx:36` 恢复 `flex-1` 后，warm/cool/dark × 390 × 200% × C/W 六项由
  `settings-readability.spec.ts:504`（`swatchWithin`）、`:505`（`dotWithin`）、`:506`（`textWithin`）几何断言
  目标 RED；候选布局恢复 24 GREEN。
- formal/private 均逐字节恢复；原 READ 四个生产路径未改；矩阵原断言/输入/算法保留，仅新增几何观察，文档按本轮授权归档。

## 视觉证据

父在自有副本仅加截图观察（原布局 C 三项几何 RED → 候选 C 12 GREEN、700 文件恢复），并亲看截图：前图文字/色点
溢出按钮，后图内容随字号自动换行。两张 PNG 由父指定路径精确复制（未编辑图像），均为 macOS Chromium / 390px /
根字号 32（合成暗色主题）：

- 修改前：[2026-11-15-theme-swatch-before.png](../assets/verification/2026-11-15-theme-swatch-before.png)
- 修改后：[2026-11-15-theme-swatch-after.png](../assets/verification/2026-11-15-theme-swatch-after.png)

## 上游已发布回执（非 READ2 本机，只保留不重写过程）

A11Y 上游 PR181 已合 main `cf104bb`，PR CI43719682252 / Guard43719682165 首 6 绿；最终 mainCI43720667762 首 5 绿。
CI 回读 258 C129/W129 实际 retry/skip/flaky 0、5.4m，pytest 957/3/80.63%/74.25s（非亲跑，仅回读）。

## 未验证与边界

- 仅证明 CSS 根字号 200%（32px），未验证 OS 缩放/真实设备。
- 未验证真实 Provider/LiveKit/IdP、真实服务、整栈与部署。
- READ2 PR/CI 待建，不填编号或发布终点 SHA；原 READ 四个生产路径未改；矩阵原断言/输入/算法保留，仅新增几何观察，文档按本轮授权归档；其它 lane 未改。

停 Review；本文件为文档收口，不 commit/push/merge。
