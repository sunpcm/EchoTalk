# WGGC 有界取证 — 调查与验收记录

> 日期：2026-11-16；任务包：WGGC（weekly-grammar 历史 5/1 与 READ2 session-flow Promise GC 有界取证）；分支
> `codex/weekly-gc-bounded-investigation-20261116`；核验基线 main `0422c9e9828c6e81bb474fccaf5c026727d30483`。
> 纯调查：源码/全部测试/config/依赖锁/DB/生成物字节零改，不做变异、不声称修复。

## 范围与目标

- 历史目标一：WebKit `weekly-grammar.spec.ts` 偶发失败（TODO 记录 :57 无重试 5 次失败 1 次，CI retries:2 掩盖）。
- 历史目标二：READ2 PR182 首轮 CI 的 `page.evaluate` Promise GC 偶发（257 passed / 1 flaky）。

## 历史目标纠错（Chromium neutral notice，非 grammar-only）

父重读 PR182 原始 Linux CI（公开链接 https://github.com/sunpcm/EchoTalk/actions/runs/43723516574）确认：历史 GC
失败目标是 `e2e/session-flow.spec.ts:109` 的 `shows a neutral saved notice when neither pronunciation nor grammar
feedback exists`（即 `showEndedSession(page, "grammar-only-empty")`），浏览器为 **Chromium**；旧 :98 的 grammar-only
用例成功（366ms）。原日志关键行：

- `✘ 61 [chromium] › e2e/session-flow.spec.ts:109:5 › shows a neutral saved notice... (360ms)`
- `✓ 62 [chromium] › e2e/session-flow.spec.ts:109:5 › shows a neutral saved notice... (retry #1) (806ms)`
- `Error: page.evaluate: Resulting promise was garbage collected.`（指向 helper 第 4 行 `await page.evaluate(...)`）

首次失败 360ms、retry #1 成功 806ms，最终 257 passed / 1 flaky / 4.6m。前述摘要/prompt 误选相邻 grammar-only 用例，
责任为 Harness，已更正。

## 实验事实（父 Harness macOS fresh，非作者执行）

- 全量 E2E 258（expected 258 / skipped 0 / unexpected 0 / flaky 0；C129/W129；max_actual_retry 0；configured[0,0]；
  原生 74.509862s，命令 75.9s）。
- 目标定向 mixed60（误选相邻旁证，grammar-only + weekly 两 case × C/W × repeat10）：60（C30/W30）retry0/skip0/flaky0，
  30.335842s，trace60。只作相邻路径诊断，不算历史目标复现。
- 目标定向 corrected60（历史范围：neutral notice + weekly 两 case × C/W × repeat10）：60（C30/W30）retry0/skip0/flaky0，
  29.659917s，trace60。其中 weekly 两 case 占 40（2×C/W×10），neutral notice 占 20（1×C/W×10），合计 60。
- Vitest 1270/57（原生 11.50s，命令 15.93s）；backend pytest 962/3 warnings/80.63%（pytest 80.64s，命令 93.37s）。
- 亲跑检查阶段 `all_baseline_non_env_tracked_files_identical` 722、worktree clean、源码零改；该 clean 为文档收口前的
  亲跑阶段状态，当前文档收口已改 5 MD（非 clean）。

本轮正确诊断 CLI（父受控，两个文件/精确 grep/重复/worker/重试/trace）：

```text
pnpm exec playwright test e2e/weekly-grammar.spec.ts e2e/session-flow.spec.ts --grep '七天语法|shows a neutral saved notice when neither pronunciation nor grammar feedback exists' --repeat-each=10 --workers=4 --retries=0 --trace=on
```

## 结论与边界

- corrected60 与全量 258 均零重试零 flaky 通过，近期目标未复现；mixed60 仅相邻旁证。
- GC 触发根因仍未知：`Resulting promise was garbage collected` 只是 Playwright 报错文案，不据此确定具体 GC 触发根因；
  浏览器为 Chromium（原日志），GC 触发根因未定。weekly-grammar 历史 5/1 根因未知保持开放。
- 不声称修复、不归档原缺陷、不做变异；本包为有界调查，正式测试一行未改。

## 审计 clock 错误纠正

`page.clock.setFixedTime` 只固定 `Date`，timer（`setTimeout`/`setInterval`）仍按真实时间运行（官方
Clock#set-fixed-time「keeps all timers running」）。本轮 corrected60 单 case 实测约 1–2s，小于 60s interval 与 midnight
timeout 延时，观测区间内 timer 未触发；不据此排除未来更长运行或特殊时序下的触发。测试期内可能的额外读来源是
`window focus`、auth 快照、lifecycle 事件。

## 未验证

- 其余源码门禁（lint/typecheck/build/Fake/api-types/后端 Ruff/schema 等）本轮 WGGC 未 fresh 亲跑，为 A18 阶段/CI 与
  新 PR CI 分列，不冒称 WGGC 全量 17 门禁重跑。
- 真实 Provider/LiveKit/IdP/设备未验；未读 `.env`。backend pytest 连已核验专用 `echotalk-test-pg`（PostgreSQL 15.19、
  库 `echotalk_test`、loopback 5432、版本 `c06_transcript_events`），无迁移、无其它库。

停 Review；本文件为文档收口，不 commit / stage / push / merge。
