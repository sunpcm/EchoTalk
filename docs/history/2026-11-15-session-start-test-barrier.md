# 启动视图测试前提（ST）— 受控验收与因果边界记录

> 日期：2026-11-15；任务包：ST（启动视图偶发的确定前提）；分支 `codex/session-start-test-barrier-20261115`；当前 HEAD main
> `c9f3131a0c7bfef85afe79702d848234c1cc8382`（READ PR179 之后）。测试文件 blob 冻结 `cfac9c33`。本文件记录源码范围、
> 受控对照、17 分阶段门禁与未验证边界；不冒充已发布 main/CI，不预填 ST PR 编号或发布终点 SHA。

## 范围与最终改动

唯一改 `apps/vite-app/e2e/session-start.spec.ts` first case：click 前注册 `page.waitForResponse` 等待
`POST /api/sessions` 200 响应，`await` 后再保留全部原 UI/HTTP/order 断言；第二、三 case 与文件外代码逐字节保留。
未增加 timeout / retry / 任意 sleep；未 mock store/产品；`routeWebSocket` 挂起保持不变。

目标：先确认真实“创建会话”成功响应到达（即 call-capabilities + health-ready 两次 HTTP 门禁已完成）后再断言
“正在连接...”，消除 5s UI 断言与 10s API 窗口之间的结构性缺口；DASH lane 保持只读、其拆分相对基线测试零改，ST 在独立
lane 修改同路径 E2E first case；不改产品/其他测试/Fake/配置/依赖/锁/生成物/数据库。

## 验收结果（本机 Harness，受控，未发布）

17 分阶段门禁全 success；首次 6 个后端步骤因父误在根目录准备 Python 未运行，修正 backend 后新系列 6 全 0，保留首环境错误。

- Vitest 1249 passed / 53 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 957 passed / 3 warnings / 80.63%（71.82s / 命令 79.07s）
- 完整 E2E 258（C129/W129，实际 retry/skip/flaky 0）：53.020272s / 命令 53.97s
- 压力（session-start first case）：C/W 各 30 共 60，0 retry，40.5s

受控反例（父私有副本，有限 6s `GET /api/call-capabilities` 延迟）：

- st-old-sixsecond01：私有基线探针因 case 正则首锚不能匹配完整测试标题，No tests found、0 测试，不属于产品失败或有效 RED。
- st-old-sixsecond02：Chromium 在原 UI 目标断言 RED；WebKit 因父私有复制未保留 Git 100755 导致 wrapper EACCES、0 执行，
  不能算有效 RED。
- st-old-sixsecond03：父恢复私有 wrapper 执行位后，C/W 均目标 RED。
- st-new-sixsecond01：新候选 C/W 2 GREEN，最后 698 个源文件逐字节恢复。

延迟为合法 API 耗时（< 产品 10s 门禁），信令仍挂起，不连接真实服务；正式测试不加延迟/timeout/sleep/retry。

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。三树为本机 Harness 分阶段亲跑，不是单条命令一次全绿；
未验证真实设备/服务/整栈。

## 输入因果界限与未验证

- 结构性前提缺口（静态已证）：first case click 后立即以 Playwright 默认 5s expect 断言“正在连接...”，而产品真实契约
  要求 click 后先串行完成 call-capabilities + health-ready 两次 HTTP 门禁（各默认 10s）才渲染该文案，故 5s 与 10s 存在
  缺口——纯静态可证，不依赖历史 trace。
- 受控可复现（父已执行）：有限 6s 延迟私有副本最终旧 C/W RED、新 C/W GREEN（st-old-sixsecond01 首探针 No tests found 不计
  有效 RED，WebKit wrapper EACCES 已由父恢复执行位后重跑）；受控反例不证明历史根因。
- 历史根因（未知）：尚无原失败 trace 证明 Vite 首次按需编译、机器负载、网络抖动等为当时 DASH 首次全量 C 超时的实际原因；
  Fake API 同步响应不足排除网络/编译/首响应抖动。不写“历史根因已成立”或“不是环境偶发”。
- 未发布 PR/CI；不预填编号或发布终点 SHA；真实设备/服务/整栈未验。

停 Review；本文件为文档收口，不 commit/push/merge。
