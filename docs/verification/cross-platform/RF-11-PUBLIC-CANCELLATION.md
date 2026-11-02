# RF-11 公共 API 取消入口验证

> 实施日期：2026-11-01
> 任务：A66 / RF-11 公共 API 取消入口
> 基线：A65 `356f69e9ceecf8868b6f11db7b53d566032bb2f6`
> 状态：独立 Review APPROVED，本地单提交
> `fedc5f39d659bf591a7c8b42b087d46a13eb4349`，main 精确 fast-forward 并完成当时 8 项前端
> 门禁与 backend 复验。
> 未 push/部署。

## 1. 公共参数契约

`apps/vite-app/src/lib/api.ts` 新增导出类型：

```ts
export interface ApiRequestOptions {
  readonly signal?: AbortSignal | null;
}
```

该类型只允许调用方传入单请求取消信号。公共函数不接受任意 `RequestInit`、Headers 或超时覆盖，
也不会把 options 对象展开到请求体或 Header 中。公共函数只把 `options?.signal` 写入内部
`RequestInit.signal`，再由既有 A64 组合句柄与内部超时合并。

实际 22 个网络函数的末尾参数如下；原有参数位置和默认值保持不变：

- `getCallCapabilities(options?)`
- `claimCallLease(sessionId, deviceId, takeover = false, options?)`
- `heartbeatCallLease(sessionId, owner, options?)`
- `releaseCallLease(sessionId, owner, options?)`
- `checkHealthReady(options?)`
- `createSession(mode, docContext?, options?)`
- `getSessionToken(sessionId, owner?, options?)`
- `endSession(sessionId, options?)`
- `dispatchAgent(sessionId, owner?, options?)`
- `listSessions(params?, options?)`
- `listActiveSessions(params?, options?)`
- `getDailyProgress(start, end, options?)`
- `getSessionDetail(sessionId, options?)`
- `getAnalysisStatus(sessionId, options?)`
- `retryAnalysis(sessionId, options?)`
- `getAssessment(sessionId, options?)`
- `getGrammarErrors(sessionId, options?)`
- `getKnowledgeStates(options?)`
- `getSkills(options?)`
- `getRecommendedCurriculum(options?)`
- `getUserSettings(options?)`
- `updateUserSettings(data, options?)`

`getSessionToken` 与 `dispatchAgent` 的 owner 仍占第二参数。只传 signal 时必须显式保留
`undefined` 占位；options 不会被误判为 owner。`createSession` 的 `docContext` 和
`claimCallLease` 的 `takeover` 同样保留原位置。

## 2. 真实公共调用

带 owner 的调用直接在公开函数末尾传入 signal：

```ts
const controller = new AbortController();
const pending = dispatchAgent(sessionId, owner, { signal: controller.signal });

controller.abort();
```

无 owner 的调用保留第二参数占位：

```ts
const pending = getSessionToken(sessionId, undefined, {
  signal: controller.signal,
});
```

已经取消的 signal 也可直接交给任一公共网络函数：

```ts
controller.abort();
await getSkills({ signal: controller.signal });
```

以上路径都经过真实公开函数进入 `request`，不依赖给私有 `request` 注入测试信号。

## 3. 请求语义

- 预取消 signal 在认证读取、token 获取和 revision 二次校验之后、调用 `fetch` 之前被识别；
  网络请求次数为零并抛出 `ApiRequestAbortedError`。
- 在途取消通过公开 controller 触发 A64 组合句柄，当前请求最多调用一次 `fetch` 并以
  `ApiRequestAbortedError` 结束；不自动重试或重放，包括 `POST` 与 `PUT`。
- 未传 options 或传 `signal: null` 均等价于没有调用方取消，继续使用普通请求 10 秒预算；
  `updateUserSettings` 仍使用 15 秒预算。
- endpoint、query、method、body、认证 Header、owner Header、`cache: "no-store"`、
  HTTP 错误、401 失效与错误解析逻辑均保持原有行为。
- 认证 revision 变化仍在组合句柄和 `fetch` 之前阻止旧请求。并发请求各自创建独立组合句柄，
  一个 signal 取消不会影响另一个请求。

## 4. 测试覆盖

`apps/vite-app/src/lib/api.test.ts` 新增公共取消测试：

1. 24 个表驱动调用覆盖全部 22 个网络函数，其中 `getSessionToken` 与 `dispatchAgent`
   分别覆盖带 owner 和无 owner 分支；每项均使用真实预取消 controller，断言 `fetch` 为零。
2. 使用两个真实公开请求证明在途取消可达，且只取消其中一个；另一个请求可正常完成。
3. 带 signal 的 lease claim 与 dispatch 写请求保持精确 body、owner Header、认证 Header
   和每个请求一次 `fetch`。
4. 在途取消 `updateUserSettings` 写请求时精确保留 body 与 PUT，并断言一次 `fetch`、不重放。
5. 省略 options 与 `signal: null` 等价，冻结的 options 输入不被修改。
6. 带 signal 的 HTTP 401 仍抛 `ApiError` 并按原 revision 失效认证；认证 revision 竞争
   仍先于预取消 signal 生效。
7. `updateUserSettings` 接收公开 signal 时仍向 A64 句柄传入 15 秒覆盖值。
8. 既有无外部取消超时测试继续断言 `ApiRequestTimeoutError`、一次 `fetch` 与无重放。

独立 Review 已核验 lane 覆盖：22 个公开 API、24 个 request 分支末位 signal；两项有效变异
由 lane 私有验证执行，均被真实断言杀死并完整还原源码，main 未重跑。精确 fast-forward
后，main 按 A66 当时范围完成原 8 项前端门禁与 529 backend pytest，其中 Vitest 907、
双浏览器 E2E 148；当时尚无 A67 才新增的 OpenAPI schema 门禁，也不把其他轮次或 lane 的
Ruff 结果追加为本次 main 事实。以上数字属于 A66 冻结证据，不追溯回写 A65 的
876/148/529。

## 5. 完成状态与未验边界

A66 已完成独立 Review、lane 私有变异、main 按当时范围的 8 项前端与 backend 复验并精确
fast-forward，不再有待代跑门禁；main 未重跑私有变异。本轮只完成前端公共 API 取消入口；
UI/store 生命周期尚未主动创建 controller 并 cancel，不宣称全应用自动取消完成；真实浏览器、
原生 WebView 和后端对断连后的服务端任务停止语义也未验证。
OpenAPI TypeScript 类型/客户端生成及 `VoiceInterface`、`SettingsDrawer` 大组件拆分已由
A67–A69 完成本地代码验收，RF-11 现按“本地代码验收完成”勾选；UI 主动 abort 全部 store
仍未交付。
