# 设置可读性（READ）— 本机验收与边界记录

> 日期：2026-11-15；任务包：READ（设置可读性）；分支 `codex/settings-readability-20261115`；基线 main
> `94037c0c10f1cbe798b25b05d03aebf9d682a0ce`（TS PR178）。本文件记录本机（Harness）验收、命令、
> 首失败/存活变异与未验证边界；不冒充已发布 main/CI，不预填 READ PR 编号或发布终点 SHA。

## TS 基线发布回执（已发布，非 READ 本机）

theme-storage（TS）已发布 [PR178](https://github.com/sunpcm/EchoTalk/pull/178) 至 main
`94037c0`。PR CI43704920189 / Guard43704920061 首轮六 success（E2E 4.4m、pytest 46.52s）；
最终 mainCI43706220054 首轮五 success，实际 checkout `94037` 由 Harness 回读（非实施者）：Linux 日志回读 Vitest1249/53、
Fake125、types10/build21、E2E234 C117/W117 实际 retry/skip/flaky0（3.8m）、pytest957/3warnings/80.63%（60.31s）。
PR CI（4.4m/46.52s）与 mainCI（3.8m/60.31s）分开记录。READ 未来 PR/CI 仍待建，不预填编号或发布终点 SHA。

## 范围与最终改动

唯一仓内改五路径（源码/样式/测试）：

- apps/vite-app/src/components/settings/SettingsProviderFields.tsx
- apps/vite-app/src/components/settings/SettingsDrawer.tsx（仅说明/开关布局，标题/流程不变）
- packages/configs/tailwind-config/theme-tokens.css
- packages/configs/tailwind-config/theme.css
- apps/vite-app/e2e/settings-readability.spec.ts（新增，24 测试）

目标：改善三主题 Provider 文字/功能控件边界、手机 200% 说明/开关重叠；去 fieldset 整组 opacity0.5、
保留真实 disabled 语义与禁用反馈；为功能输入/select 增加独立边界语义 token 仅用于本组；说明区可收缩
换行、开关保持 44px 不重叠。不换自绘 select、不增依赖、不改 Provider 业务/提交/键盘行为、品牌配色或其他页面。

同包本轮 4 个 Markdown 更新：TODO.md、docs/PROJECT_STATUS.md、docs/history/todo-done.md、本文件。

## 验收结果（本机 Harness，未发布，不冒充已发布 main）

17 门禁全 success；完整 E2E 258 两次——首次旧 `76` 基线、第二次继承 TS（PR178）至 main `94037c0` 后：

- Vitest 1249 passed / 53 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 957 passed / 3 warnings / 80.63%（77.15s / 命令 81.94s）
- 完整 E2E 258（C129/W129，实际 retry/skip/flaky 0）：首次 Playwright 66.802518s / 命令 68.04s；继承后 Playwright 53.773359s / 命令 54.86s

READ 证据：24 测试（48 启/禁用阶段），before/after 各 48 条计算样式与截图（before 是移除标量断言的
私有只读观测，非旧版契约通过）；实际 root 16/32px、控件 14/28px；禁用 select 文字 min 3.124→4.943、
功能边界 min 1.148→3.646。

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。三树为本机 Harness 分阶段亲跑，不是单条命令一次
全绿；未验证真实设备/服务/整栈。

## 首失败与存活变异（如实保留，不改写 R0/R1/R2 历史）

- R0 首失败：假 200% 根字号（html=null 时 metrics 仍 14px）与 opacity 私有变异曾存活（已按真实
  字体/几何/对比修复）。
- R1 首失败：0/24，focus.ratio 均为 -1，boxShadow 按逗号 split 拆碎 rgba 并 fallback 透明占位，
  测量失败。
- R2 修复：真实可见 ring 层解析/相邻面、聚焦后边界；200% Provider 目标取景；保留前置实际字体/
  几何/对比与原强断言，不降阈值。
- 变异初次使用不存在的 border-border，实际为 currentColor 强边界故存活（非低对比反例或 kill）；
  v2 按真实原 border-border-default 才目标 RED。

## 有效变异（Harness 私有，均目标 RED + 逐字节恢复 GREEN）

- opacity：`SettingsProviderFields.tsx:51` → `settings-readability.spec.ts:429`
  `expect(disabledText.ratio).toBeGreaterThanOrEqual(disabledText.required)`。
- boundary：`SettingsProviderFields.tsx:89` → `spec:466` `expect(boundary.min).toBeGreaterThanOrEqual(3)`。
- focus：`SettingsProviderFields.tsx:89` → `spec:474` `expect(focus.ratio).toBeGreaterThanOrEqual(3)`。
- font：`settings-readability.spec.ts:76` → `spec:410` `expect(font.root).toBeCloseTo(rootFontSize.rootPx, 0)`。

以上四变异均已私有逐字节恢复 GREEN；所有正式/私有字节恢复。

## 输入因果界限与未验证

- 修复把功能输入边界提升至 3:1、禁用 select 文字至 4.943；禁用可读性属产品增强，装饰卡边框不统一
  套 WCAG 3:1，不宣称全产品 AA。
- 保留旧 theme-contrast 扫描算法/断言、旧 Storage/键盘测试零改；焦点态保持可见。
- 未验证真实设备、真实 Provider/LiveKit/IdP、整栈与部署；READ PR/CI 待建，不填编号或发布终点 SHA。
- READ2 遗留：主题 radio 内容/色点在 200% 根字号下于按钮内重排/溢出（390/1280、正常/200 字号，本机前后观察，本轮未修），保留 44px/原颜色/角色/事件与业务；原生/OS 下拉边界归入未验/非范围，见根 TODO 新卡。

停 Review；本文件为文档收口，不 commit/push/merge。
