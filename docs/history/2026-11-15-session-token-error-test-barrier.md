# Token 失败自动清理测试前提（ST2）— 受控验收与因果边界记录

> 日期：2026-11-15；任务包：ST2（ST 第三 case 前提窗口审计的确定补丁）；分支 `codex/session-token-error-test-barrier-20261115`；
> 开工 HEAD `cf104bb`，最终核验基线 main `3d246c3`（READ2 PR182 之后，非发布快照）。测试文件目标 git blob 冻结 `154ba935b4d75ce478b132ed7e4da49b0fb28edf`（12 行纯添加）。
> 本文件记录源码范围、受控对照、17 分阶段门禁、单文件静态 tsc 与未验证边界；不冒充已发布 main/CI，不预填 ST2 PR 编号或发布终点 SHA。

## 范围与最终改动

唯一改 `apps/vite-app/e2e/session-start.spec.ts` 第三 case `a failed token request ends the just-created session and shows a generic message`：
click 前注册 `page.waitForResponse` 等待真实自动 `POST /api/sessions/<id>/end` 200 响应，`await` 后再保留全部原断言
（generic 文案、heading、canary 不展示、请求计数、`GET /api/sessions/:id` status `completed`、sessionId 消失、`finally` 清理）；
其余 case / helpers / beforeEach 与文件外代码逐字节保留。未增加 timeout / retry / sleep；未 mock store / 产品；
未改产品 / Fake / 其他测试 / 配置 / 依赖。

目标：先确认真实自动 end 成功响应已到达（即 call-capabilities→health-ready→createSession→token(502)→自动 endSession 已串行完成、
且该 end 位于 generic UI error 之前）后再断言 generic 文案，消除 5s UI 断言与合法 10s API 窗口之间的结构性缺口。

## 事实时序

- 审计（report-audit-r0）：静态确认第三 case 存在与 first case 同类的结构性前提缺口；历史根因未知，未观察到已存在的历史第三 case CI 首败。
- 实施 R0（report-r0）：仅第三 case 加真实 end 200 屏障；本 lane 静态 Prettier 真实通过、`pnpm typecheck` 为 Turbo cache hit（非真实重跑，不视为通过）。
- 父 Harness 受控对照：有限 6s 输入下旧 C/W 4 目标 RED、新 R0 同 4 GREEN；702 源文件恢复；首 WebKit 私有复制执行位丢失 EACCES 不计目标 RED，v2 有效。
- 父 Harness 17 门禁全 success + 额外单文件 `tsc --strict` 真实 exit 0。
- READ2 PR182 为回读（见下方「回读」），非本 ST2 亲跑。

## 验收结果（父 Harness，受控，未发布）

17 分阶段门禁全 success：

- Vitest 1249 passed / 53 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 957 passed / 3 warnings / 80.63%（68.35s / 命令 72.62s）
- 完整 E2E 258（C129/W129，实际 retry/skip/flaky 0）：52.759254s / 命令 53.82s
- 压力（session-start 第三 case 目标）：C/W 各 30 共 60，0 retry，31.3s

受控反例（父私有副本，有限 6s 延迟，合法 < 产品 10s 门禁）：

- 旧 C/W 4 目标 RED；新 R0 同 4 GREEN；702 个源文件逐字节恢复。
- 首 WebKit 私有复制因未保留 Git 100755 导致 wrapper EACCES、0 执行，不计有效目标 RED；恢复执行位后 v2 有效。

额外单文件静态类型（父，真实运行，不依赖 Turbo 缓存）：

- 首次额外文件 `tsc`（无 `--strict`）因缺 Node 类型根报 TS2688 失败，保留（属命令/环境准备，非源码类型错误）。
- 第二次（`tsc --strict`）仅指向既有 `node_modules/.pnpm/node_modules/@types`，真实 exit 0，未新增依赖。

本 lane 亲跑静态（实施者）：

- Prettier `--check` 改动文件真实 exit 0。
- `pnpm typecheck` 为 Turbo cache hit（FULL TURBO），非真实重跑，不视为通过；且 vite-app `tsconfig.json` 仅含 `src`、不含 `e2e/`。

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。三树/门禁/压力/受控变异由父 Harness 在本 lane 实际执行；实施 Agent 未运行浏览器/PG/三树/压力/受控变异。

## 输入因果界限与未验证

- 结构性前提缺口（静态已证）：第三 case click 后立即以默认 5s expect 断言 generic 文案，而产品须先串行完成
  call-capabilities/health-ready/createSession/token(502)/自动 endSession（各默认 10s）才 emit 文案；自动 end 位于 generic UI
  error 之前（`conversationStartup.ts` catch 先 `await endOrphanedSession()` 再 emit reset）。
- 受控可复现（父已执行）：有限 6s 延迟下旧 C/W 4 目标 RED、新 R0 同 4 GREEN；受控反例不证明历史根因。
- 历史根因（未知）：本审计无已观察的历史第三 case CI 首败；Fake 同步响应不足排除网络/编译/首响应抖动；不写"历史根因已成立"
  或"不是环境偶发"。
- 未发布 ST2 PR/CI；不预填编号或发布终点 SHA；真实设备/服务/整栈未验。

## 计划外与未验证（诚实记录）

- 父曾在主 checkout 误 cwd 跑 `pnpm` 返回 Already up to date；源码/index/锁未改、`.modules.yaml` 刷新忽略、原日志保留；
  缺前依赖快照，不声称依赖逐字节恢复；随后在正确独立 lane 重装。
- 旧 WebKit wrapper EACCES 非目标、首次额外文件 `tsc` 失败、本 lane cache typecheck 均保留，不并入"通过"。
- READ2 PR182 的 session-flow GC 为新观察另项，不在本 ST2 扩范围，不顺手改。

## 回读（非亲跑）：上游 READ2 PR182

- READ2 PR182 已合 main `3d246c3`。
- PR CI 43723516574 / Guard 43723516557：六 success，但 257 pass + 1 flaky / retry 1（C session-flow 109 evaluatePromiseGC，
  4.6m，pytest 71.07s）。
- 最终 main CI 43725277315：首五 success，258 / 0 retry，4.5m，pytest 57.81s。
- 以上为回读非亲跑；不借 main 绿洗掉 GC flaky；GC 为独立新观察，不在本 ST2 范围。

停 Review；本文件为文档收口，不 commit / push / merge。
