# 键盘焦点遍历可靠性（A11Y）— 受控验收与因果边界记录

> 日期：2026-11-15；任务包：A11Y（`a11y-focus-touch` 偶发的确定前提）；分支
> `codex/dashboard-focus-test-reliability-20261115`；当前 HEAD main
> `f91515795becc3453e9004f6fef3c05d36f95e22`（tree `b0c087862d93e01a00bd0f0b72a78f0afa2763f3`）。
> 测试文件 blob 冻结 `0f85ab99ced88af04843b494998624d1d7bfc0cf`。本文件记录源码范围、受控 R0→R1 对照、
> 三测试树与压力、未验证边界；不冒充已发布 main/CI，不预填 A11Y PR 编号或发布终点 SHA。

## 范围与最终改动

唯一改 `apps/vite-app/e2e/a11y-focus-touch.spec.ts` 的 `openDashboard`：在 `page.goto("/")` 之前注册
`page.waitForResponse` 等待 `GET /api/sessions/weekly-progress` 200 响应（方法/路径/状态），`await` 后再保留
新增日期按钮可见等待与全部原焦点可见性、`seen>=6`、`文档对话`、44px、landmark、失败重试 44px 断言。

目标：weekly blocks（`最近七天` 的 7 个日期按钮）是键盘遍历第 6 个及之后唯一可聚焦控件来源，且其合法响应
窗口（产品默认 10s）可能长于按钮可见等待的默认 5s；先等真实响应到达、再等 UI 就绪，消除把缺前提窗口转移到
UI 断言上导致的超时。

未增加 timeout / retry / 任意 sleep；未去掉 `tabThrough` 的 break、未降低 `>=6` 下限、未靠循环重复凑 6；
未 mock store/产品/原生焦点；未改产品、其他测试、Fake API、配置、依赖/锁、后端/数据库。第二、三用例正文与文件外
代码逐字节保留。

## 受控反例 R0→R1（父私有副本，有限 6s `GET /api/sessions/weekly-progress` 延迟）

- 旧基线：受控 6s 下 Chromium / WebKit 均被原 `seen>=6` 断言抓住（seen 5），与 CI 症状一致。
- R0（按钮可见等待，默认 5s）：同一输入下 C/W 均在 `openDashboard` 新等待超时（2 RED）——只是把缺前提窗口移到
  UI 断言，未覆盖合法 10s 响应窗口。
- R1（goto 前注册响应等待）：同一输入 C/W 2 GREEN，最后 700 个源文件逐字节恢复。
- 首次旧 probe 端口被别 lane 占用、0 测试，属环境占用，不计入有效 RED。

延迟为合法 API 耗时（< 产品 10s 门禁），不连接真实服务；正式测试不加延迟/timeout/sleep/retry。

## 验收结果（本机 Harness，受控，未发布）

17 门禁全 success，分阶段亲跑（不是单条命令一次全绿）：

- Vitest 1249 passed / 53 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 957 passed / 3 warnings / 80.63%（68.56s / 命令 72.73s）
- 完整 E2E 258（C129/W129，retry/skip/flaky 0）：54.444006s / 命令 55.41s
- 压力（首用例，`seen>=6` 目标）：C/W 各 30 共 60，retry 0，31.3s
- 继承 ST 后再次完整 E2E 258（C129/W129，retry/skip/flaky 0）：Playwright 51.243352s / 命令 52.29s

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。三树为本机 Harness 分阶段亲跑；未验证真实设备/服务/整栈。

ST 最终 mainCI 已回读（父提供，属 ST 自身 CI，非 A11Y CI）：mainCI43717223939 首 5 success、actual checkout
`f915157`；Vitest1249/53、Fake125、types10、build21、E2E258 C129/W129 实际 retry/skip/flaky 0（5.4m）、
pytest957/3warnings/80.63%/68.44s。ST PR180 的 257/1flaky/retry1 原样保留。

## 输入因果界限与未验证

- 结构性前提缺口（静态已证）：weekly blocks 尚未渲染时键盘遍历只有 5 个可聚焦控件，与 CI `seen.length === 5`
  症状一致；R0 把该缺口转移到默认 5s UI 等待，无法覆盖 10s 合法响应窗口，故受控 6s 下仍超时。
- 受控可复现（父已执行）：旧 C/W RED、R0 C/W RED、R1 C/W GREEN；受控反例只证明该前提窗口被补丁覆盖，不证明历史
  根因。
- 历史根因（未知）：本轮尚未取得对应首失败完整 trace，历史归因未确认，不能断定该历史偶发“确定不是焦点可见性本身”或“确定 retry 时区块已
  就绪”；不写“历史根因已成立”或“不是环境偶发”。不猜 CI 编号。
- 未发布 PR/CI；不预填编号或发布终点 SHA；真实设备/服务/整栈未验。

停 Review；本文件为文档收口，不 commit/push/merge。
