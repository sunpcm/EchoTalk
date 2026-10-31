# RF-11 公共 API 取消入口验证

> 实施日期：2026-11-01
> 任务：A66 / RF-11 公共 API 取消入口（本地单轮实施，停 Review）
> 基线：`codex/rf11-public-cancellation@356f69e9ceecf8868b6f11db7b53d566032bb2f6`

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

本实施节点未运行测试或 formatter，因此以上覆盖只代表待执行的测试源码，不能视为已通过。

## 5. 待代跑门禁与未验边界

主 Agent 需在实施节点停止写入后，通过固定入口代跑 format-fix、完整 quality 与后端三项；
Vite Vitest、Vite Playwright 和 backend pytest 缺一不可。固定入口、依赖或数据库边界失败时，
应记录为阻断并交回实施节点修复。

本轮只完成前端公共 API 取消入口。UI/store 生命周期尚未主动创建 controller 并 cancel，
不宣称全应用自动取消完成；真实浏览器、原生 WebView 和后端对断连后的服务端任务停止语义也未验证。
OpenAPI TypeScript 类型/客户端生成及 `VoiceInterface`、`SettingsDrawer` 大组件拆分仍待完成，
RF-11 整项保持未勾选。
