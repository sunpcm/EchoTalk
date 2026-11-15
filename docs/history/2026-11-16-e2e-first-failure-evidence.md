# CI 首失败取证（EV）— 证据保存配置与验收记录

> 日期：2026-11-16；任务包：EV（CI 首失败取证，轻量维护）；分支 `codex/e2e-first-failure-evidence-20261115`；
> 开工 HEAD `3d246c3`，最终核验基线 `3d00d31e`（CPB PR186 source `e0a6250` 合入之后，未发布）。
> 本文件记录既有 CI 首失败取证缺口、2 配置改动、受控负/正对照、17 门禁亲跑与未验证边界；不冒充已发布 PR/main CI，
> 不预填 EV PR 编号或发布终点 SHA。

## 范围与取证缺口

既有 CI 首失败取证缺口（静态已证）：

- 原始首失败无 trace：旧 `trace: on-first-retry` 仅录重试而非首失败。
- 仅 `list` reporter，不生成原生 JSON 报告。
- 缺 runner 结束后可取回的上传：旧 trace / 显式截图仍落本地盘（test-results），但无 artifact upload 步骤，
  runner 回收后不可取回。

本轮只改 2 个配置补证据保存，不宣称修复 GC 根因：

1. `apps/vite-app/playwright.config.ts`：`use.trace` 由 `on-first-retry` 改 `retain-on-failure`；新增 `use.screenshot: only-on-failure`。
2. `.github/workflows/ci.yml`：E2E 步骤 reporter 改 `list,json`，加 `env.PLAYWRIGHT_JSON_OUTPUT_NAME=playwright-report/results.json`；
   其后新增 `Upload E2E evidence` 步骤（always 上传 JSON 报告与 test-results，7 天 retention，run_id/run_attempt 区分名，
   复用既有 `actions/upload-artifact@v4`）。

未改：其他步骤、检查名称、容器、retry/worker/timeout、测试断言、业务源码、依赖/锁、`.env`；未加 `continue-on-error`；未弱断言。

## 事实时序

- 实施 R0（report-r0）：仅 2 配置；实施者亲跑 Prettier、单文件 `tsc --noEmit`、YAML 1.2 解析均 exit 0；未开浏览器/服务/DB。
- 父 Harness 受控对照：未覆盖 trace/screenshot 策略、retries0（探针另以 CLI 指定 workers/reporter/output）；
  负 C/W 直接目标失败 → trace/失败 PNG/原生 JSON；正成功 → trace0/失败 PNG0；705 个源文件 formal/private 逐字节恢复。
- 父独立结构化审计：原 workflow/job 除 E2E reporter/env/新增 always artifact 外全部等价；严格单文件 config `tsc` 通过；
  首次 YAML require 根路径 module-not-found 失败保留，改用既有 pnpm 锁定传递路径（新 ID）后通过。
- 父将已发布且 APPROVED 的 CPB source `e0a6250` 合入本 lane（PR186 已发布）；相对 CPB source 仅 EV 两配置差异，
  410 个 17 门禁 source manifest 同字节，唯一 WIP 新 history 逐字节保全。CPB PR186 首六 success 已合 main `53d2a409`
  （tree 全等、mainCI 43737179366 pending）；父将在本 round 停写后再将 main `53d2a409` 合入本 lane，当前 lane HEAD 仍 `3d00d31`。

## 验收结果（父 Harness，亲跑，未发布）

17 门禁全 success：

- Vitest 1260 passed / 55 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 962 passed / 3 warnings / 80.63%
- 完整 E2E 258（C129/W129，retry0；共享 JSON：expected 258 / skipped 0 / unexpected 0 / flaky 0，
  startTime 2026-11-15T15:47:14.980Z，duration 70379.681ms ≈ 70.38s）

受控负/正对照（父私有副本，未覆盖 trace/screenshot 策略、retries0）：

- 负：C/W 各 1（共 2）直接目标失败（`expect(1).toBe(2)`）→ trace 2 / 失败 PNG 2 / 原生 JSON；负 2 为取证反例，不计正式 passed。
- 正：C/W 各 1（共 2）成功 → trace 0 / 失败 PNG 0 / 原生 JSON；705 个源文件 formal/private 逐字节恢复。

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。三树/门禁/受控对照由父 Harness 在本 lane 实际执行；
实施 Agent 未运行浏览器/PG/三树/受控对照。

## 输入因果界限与未验证

- 本轮补证据保存配置，不修复也不宣称修复 GC；历史 GC 60 自然（stress）未复现、根因未知，不可据后续 main 绿结案。
- 负 2 为取证反例，不并入"正式 passed"；本机 Harness 17 门禁 + 受控对照为亲跑，与实际远端 CI 未跑区分。
- 实际远端 artifact 上传待发布（EV PR/main CI 尚未创建/运行），不预填编号或发布终点 SHA。
- 未验真实服务/设备/整栈/迁移/部署，未读 `.env`，未新增依赖。

停 Review；本文件为文档收口，不 commit / stage / push / merge。
