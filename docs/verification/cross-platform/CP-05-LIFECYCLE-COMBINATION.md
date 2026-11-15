# CP-05 Dashboard 生命周期实际组合验证

## 范围与状态

本卡只补 Dashboard 整页中四类生命周期消费者的真实组合覆盖，不修改产品源码、契约、依赖、
CI 或迁移，不制造 RED。主控已完成 R0 target、R1 完整复验、13 项最终门禁、两项有效私有
加载期负对照与恢复，当前状态为 `FINAL_READY`；测试已停写并冻结。本批真实合成 PG 已用于
backend 测试并完成精确清理，本文件三个 UI 场景本身不连接 PG。

新增
`apps/vite-app/src/components/dashboard/Dashboard.lifecycle-integration.test.tsx`，直接渲染真实
`Dashboard`，保留 ActiveSessions、DailyProgress、WeeklyProgress 与 WeeklyGrammar 的真实组件、
query/controller/hook、默认 `createLifecycleAdapter()` 和实际 `api.ts` 封装。认证状态与
Capacitor `App` 外部状态源只做合成，`fetch`/`Response` 为严格 fake 路由器；没有 mock 四个
组件、query、hook、默认工厂或 `api.ts`。测试停写后的 SHA-256 为
`4f46f3ecba0529df2fa99390989bf0fcd3504de59a6971890237f819bfa51a35`。

## 最终机器验收

- R0 target 为 `3/3 exit 0`；恢复默认源后的 target-final 亦为 `3/3 exit 0`，R1 后最终 13
  项门禁全部 `exit 0`。1262 个旧测试身份逐条保持，713 个保护文件字节不变。
- 两项有效私有加载期负对照均命中目标断言，不是通用测试超时；恢复默认源后最终门禁全绿。
  每项只选中一个目标 failure，各另有 2 个未选用例，未选用例不构成通过证据。
- R1 只在场景 1 的 `finally` 中、unmount 后补
  `getStateDeferred.resolve({ isActive: false })`，保证前置监听或 0 GET 断言失败时也释放
  外部状态 promise；原有断言、事件、计数与超时均未改。
- 其余完整机器数字与两项负对照的精确 expected/actual 集中在
  [PROJECT_STATUS](../../PROJECT_STATUS.md#cp05l-dashboard-生命周期实际组合缺口final_ready)。

## 场景 1：iOS pending 到 active

- 四个真实消费者各自通过默认生命周期工厂注册 `App.addListener("appStateChange")`，并读取
  共享的 deferred `App.getState()`。
- pending 期间只允许挂载原有的 knowledge/recommendation 读取；生命周期管控端点
  `active / daily-progress / completed sessions / weekly-progress / weekly-grammar` 的 GET
  必须为 0。
- `getState()` 返回 inactive 后仍保持 0；随后真实投递 active 事件，断言 ActiveSessions 1 条、
  DailyProgress 的 progress 与 sessions 各 1 条、WeeklyProgress 1 条、WeeklyGrammar 1 条，
  初始未选日首波合计 5 条受管 GET。
- WeeklyProgress 首次响应释放后再默认选日，额外产生 1 条 history GET；因此 5 条只是首波，
  不是本场景的最终请求总数。所有受控响应完成后，断言四个区块分别渲染有效结果。

## 场景 2：Web online 到 pageshow

- 全程保持 `document.visibilityState === "visible"`，初始 `navigator.onLine === false`；先真实
  改为 true 并派发 `online`，作为第一个合格事件，再派发 `pageshow`，作为第二个合格事件。
- 两次事件之间不派发同值 `online`，也不用 `pagehide` 改写前一次事件的资格。
- ActiveSessions、WeeklyProgress、WeeklyGrammar 的在途读取按现有 `ignore` 策略合并在途事件，
  仍各只有初始一次 GET；DailyProgress 按现有 `override` 策略允许每个合格事件各发
  progress 与 sessions 两条 GET。
- 先释放 DailyProgress 第二组并断言新结果渲染，再释放第一组并断言旧响应不会覆盖新结果。
  WeeklyProgress 概览释放后自动选日，产生第 1 条 history GET；随后点击另一个有效日期，
  再产生第 2 条 history GET，并精确核验 `status=completed`、`start`、`end`、`limit=50`
  与渲染切换。这里区分周概览单独的 1 条首波 GET、默认选日增量 1 条和手动选日增量 1 条。

## 场景 3：整页 unmount

- 先释放所有受控请求，再卸载 Dashboard；卸载后重新投递 App callback、offline、online 与
  pageshow。
- 断言所有受管 GET 数量不再增加、没有新增 POST/其他业务写、没有调用
  `navigator.mediaDevices.getUserMedia`，且四个消费者的监听句柄已清理。

## 请求与隔离边界

- fake fetch 只接受已知 API 路径，未知路径、未知方法或未匹配路由直接抛错；不会回退到原始
  网络。DailyProgress 的路径与 history 路径按 query 总量和各自 DOM 结果区分。
- 测试只合成认证快照、Capacitor 检测/App 状态与 `fetch`/`Response`。iOS 场景通过
  `vi.stubEnv` 显式设置安全合成绝对 `VITE_API_BASE_URL`，让真实 `getApiBaseUrl()` 与
  `api.ts` 成功发起请求；`afterEach` 用 `vi.unstubAllEnvs()` 恢复，不 mock URL 解析或 API
  封装。
- `api.ts` 会缓存首个有效基址，因此本整页组合文件中的 Web 场景证明的是生命周期与并发接线，
  不冒充 Web 默认相对 `/api` 或 native 无配置 fail-fast 的独立证据；首个基址缓存限制如实
  保留。这两条 URL 策略继续由既有 `platform/url.ts`、`platform/globalEnvironment.test.ts`
  与 `lib/api.test.ts` 承担，本卡不扩大产品范围。
- 不使用 fixed sleep 或任意等待；使用明确请求、deferred settlement、真实事件与 finally
  清理受控资源。
- 三个 UI 场景本身不连接 PG；backend 全量测试已在本批真实合成 PG 上实际运行。真机 iOS
  pending→active、真实 iOS 网络恢复、真实 OS、SSO、Cloud、LiveKit、媒体与生产仍未验证；
  本卡不把模拟结果当作这些外部验收。

## 交接

精确写入文件与测试断言已停写并冻结，正式实施返修 `1/2`。最终机器数字集中在
[PROJECT_STATUS](../../PROJECT_STATUS.md#cp05l-dashboard-生命周期实际组合缺口final_ready)。
本批三卡共用合成 PG 已按精确 container ID、双 owner、`127.0.0.1` 与合成身份核验后
`stop_exit0`、`auto_removed=true`。最终 format、独立 Review、正常 commit/当前分支 push 与
用户 Review 状态以主控同卡回执为准。
