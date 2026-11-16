# theme-storage 冷启动输入/水合时序可靠性（TS）— 本机验收与边界记录

> 日期：2026-11-15；任务包：TS（theme-storage 冷启动输入/水合时序）；分支 `codex/theme-storage-reliability-20261115`。
> 本文件记录本机（Harness）验收、命令、首失败/存活变异与未验证边界；不冒充已发布 main/CI，不预填 PR 编号或发布终点 SHA。

## 范围与最终改动

唯一仓内改一个测试文件 `apps/vite-app/e2e/theme-storage.spec.ts`（R3 最终 blob
`8ad8c37687377350d7b3d7417f678658c007614f`），仅第一用例新增：冷启动本地 fallback 与远端 GET
水合两阶段、导航前真实 request 事件零 PUT 观测、浏览器内旁路计数器、300ms 防抖窗口用页面时钟确定性跨过。
第二、第三用例正文原字节；产品 / 其他测试 / 配置 / 锁零改。同包本轮确有 4 个 Markdown 更新：
TODO.md、docs/PROJECT_STATUS.md、docs/history/todo-done.md、本文件。

## 验收结果（本机 Harness，未发布，不冒充已发布 main）

17 项门禁全部 success；三树计数与已发布 main76d9d6ba 一致：

- Vitest 1249 passed / 53 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 957 passed / 3 warnings / 80.63%（80.63339413%）；pytest 80.40s / 命令 86.17s
- 完整 E2E 234（Chromium117 / WebKit117，retry/skip/flaky 0），命令 61.84s
- 目标全文件（theme-storage.spec.ts）300（C150/W150，retry/skip/flaky 0），263375.914ms（263.375914s）

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。17 门禁与三树为本机 Harness 分阶段亲跑
（初始 15 门禁 + 后续补全 backend pytest、完整 E2E 与目标 300 压力），不是单条命令一次全绿。

## 首失败与存活变异（如实保留，不改写 R2 历史）

- R1 首失败：GET 在途快进 60 秒触发默认 10s 真实请求超时（trace 为 `api_request_timeout`），
  warm/cool 两阶段断言 0/2。修复为把时钟 pauseAt 移到 `goto` 之前、尚无在途 GET 时冻结，
  并 `finally` 释放 GET 门禁。
- R2 存活变异：直接证据是 trace.network 已记录实际 PUT、而 Node 计数仍为 0，零写未被真实抓住；
  `page.on("request")` 事件经网络拦截/CDP 异步送达晚于同步 `expect(settingsPutCount).toBe(0)`
  仅为推断，本轮不下协议根因结论、不进一步定位投递机制。
- R3 修复：导航前 `addInitScript` 完整委托原 `fetch`，在真实调用点同步旁路计数，并经确定性
  `page.evaluate` 往返收束异步微任务；坏 PUT 由 spec125 `expect(themePutCount).toBe(0)` 抓住。
- 另有两次端口占用未进入目标测试、不算产品失败，不计入测试断言失败。

R3 代码预算是 Harness 基于用户持续修复授权显式追加的一轮有界返修（R3/3），不重置也不改写 R0/R1/R2
记录；R2「坏 PUT 存活」仍是真实历史，R3 是其后闭合。

## 有效变异（Harness 私有，均目标 RED + 逐字节恢复 GREEN）

- fallback：`store/settings.ts:223` fallback warm→cool → `spec:105` 目标 `data-theme="warm"` RED。
- hydrate：`store/settings.ts:436` backendTheme→warm → `spec:112` 目标 `data-theme="cool"` RED。
- badput：`store/settings.ts:436` 插 300ms 坏 PUT → `spec:125` `expect(themePutCount).toBe(0)` RED
  （Expected 0 / Received 1）。
  以上三变异均已私有逐字节恢复 GREEN。

## 输入因果界限与未验证

- 本修复固化本地 fallback 与远端水合两阶段，并补零写观测；不改产品语义、Fake、超时策略或依赖。
- 历史 H1 两次 233/1 warm/cool 的完整根因仍未证明；原自然 100/100 与本次 300/300 均不证明
  因果或稳定性。只归档本次前提固化与零写保护，不把有限次通过当成稳定性证明；旧 snapshot 历史不改写。
- weekly-grammar / rootCause 未知项保留（TODO 未勾选），不与本次 theme-storage 混淆。
- PR/CI 待建，不填编号或发布终点 SHA；真实 Provider/LiveKit/IdP、设备、整栈与部署仍未验。

停 Review；本文件为文档收口，不 commit/push/merge。
