# RF-11 Transport 请求超时与取消边界验证

> 实施日期：2026-11-01
> 代码分支：`codex/rf11-request-timeout`
> 对应任务：A64 / RF-11 Transport 请求超时与取消边界（本地单轮实施，停 Review）

## 1. 超时预算依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF-11“保留小型自定义 Transport，统一处理认证、超时、取消、错误解析和 API Origin”完成本轮子项。默认预算与设置更新覆盖值均有既有预算作为依据：

| 场景                 | 预算 | 依据                                                                                                                                                                                                                       |
| -------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 普通 API 请求        |  10s | `apps/vite-app/src/store/conversation.ts:495` 的原生就绪门禁已采用 10s；`backend/services/validation_service.py:47-48` 也将一次 Provider 校验上限设为 8s、并行总预算设为 10s。                                             |
| `updateUserSettings` |  15s | 该请求可能触发 Provider 凭据验证；后端单请求上限为 `backend/services/validation_service.py:47` 的 8s，整批总预算为同文件 `:48` 的 10s。前端额外保留 5s 覆盖连接、响应传输和客户端处理，避免把后端 10s 预算直接压成零余量。 |
| 云通话占用参考       |   3s | `backend/services/call_leases.py:25` 对云端占用调用使用 3s；它证明外部调用已有按场景设置独立预算的先例，本轮不改变该值。                                                                                                   |

`resolveApiRequestTimeout` 只接受正有限数。`0`、负数、`NaN`、正负无穷、非数字及其他运行时非法值统一回退到 10s，避免立即超时或永不超时。只有 `updateUserSettings` 通过内部调用参数显式覆盖为 15s，未引入全局可变配置。

## 2. 取消与超时契约

`apps/vite-app/src/lib/apiRequestTimeout.ts` 是无网络、无异步请求、无 DOM 节点/store/日志正文/全局可变状态的纯计算边界。它提供固定默认值、超时值解析、取消与超时错误类型，以及组合外部 `AbortSignal` 与内部超时的句柄。

- 调用方已取消时，组合 signal 立即进入 aborted 状态，`request` 在调用 `fetch` 前抛出 `ApiRequestAbortedError`，网络请求次数为零。
- 调用方未取消且预算耗尽时，句柄自行中止组合 signal，并抛出 `ApiRequestTimeoutError`。
- 两类错误均有稳定的 `name`、`message` 与 `kind`；两者都不是 `ApiError`，不包含 URL、路径、Header、token、请求体或响应正文。
- 外部 signal 与内部超时共用同一个最终请求 signal。即使内部超时先发生，只要调用方 signal 此时也已 aborted，句柄仍将失败原因报告为调用方取消。
- 超时和取消均不触发自动重试或请求重放；包括 `POST`、`PUT` 在内的任何路径最多调用一次 `fetch`。

## 3. 与既有请求链路逐项对照

| 环节                   | 本轮实现                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 认证读取               | 先调用 `getAuthRevision()`，再 `await getAccessToken()`；位置和顺序未改变。                                       |
| revision 二次校验      | token 获取后立即重读 revision，变化时仍在 Header 构造及任何 `fetch` 前抛出 `sessionChanged`。                     |
| Header 构造            | 仍真实委托既有的 `buildApiRequestHeaders`；默认 `Content-Type`、Bearer 覆盖、调用方 Header 保留与多值语义未改变。 |
| fetch 次数             | 组合 signal 在认证与 Header 阶段之后创建，最终请求只调用一次 `fetch`；超时/取消不重放。                           |
| `...options` 与 Origin | `baseUrl + path` 及 `...options` 保持，只有 `signal` 在展开后先写入组合 signal，以支持取消和超时。                |
| 非 2xx                 | 仍先记录 `api_http_failed`，再按原逻辑解析错误正文并构造携带原 `status`/`data` 的 `ApiError`。                    |
| 401                    | 仍在读取响应 JSON 前按原 `reqRevision` 调用 `invalidateAuthSession`；迟到旧 revision 的 401 保护未改动。          |
| 非 JSON 错误体         | 非超时/非取消的解析失败仍回退 `{}`；成功响应的解析行为未扩权。                                                    |
| 网络错误               | 非超时/非取消的 fetch 拒绝仍原对象重抛，并记录 `api_network_failed`。                                             |
| 请求超时               | 独立记录无正文的 `api_request_timeout`，抛出 `ApiRequestTimeoutError`。                                           |
| 调用方取消             | 独立记录无正文的 `api_request_aborted`，抛出 `ApiRequestAbortedError`。                                           |

## 4. 覆盖清单

`apps/vite-app/src/lib/apiRequestTimeout.test.ts` 直接覆盖：

1. 10s 默认值与设置更新 15s 预算。
2. 正有限数覆盖、非法值回退及冻结参数不变性。
3. 已 aborted signal 在消费者调用 fetch 前被识别，网络替身零调用。
4. 超时错误与调用方取消错误的类型、`kind` 和实例区分。
5. 调用方取消会清理内部计时器；调用方取消优先于已耗尽的内部预算。
6. 错误名称/固定文案稳定且不含请求数据。
7. 重复调用的句柄、signal 与计时状态互相隔离。

`apps/vite-app/src/lib/api.test.ts` 通过公共 API 消费回归覆盖：

1. `checkHealthReady` 真实消费组合句柄，最终 `fetch` 携带 signal；10s 到期后抛出非 `ApiError` 的超时错误，`fetch` 恰好一次，并记录 `api_request_timeout`。
2. 模拟组合句柄在途取消时抛出独立的取消错误，`fetch` 恰好一次，并记录 `api_request_aborted`。
3. `updateUserSettings` 显式传递 15s 覆盖值。
4. 既有认证 revision、401、错误体、Header 与单请求断言保留。

`diagnostics.ts` 仅新增 `api_request_timeout` 与 `api_request_aborted` 两个白名单事件；白名单校验、字段构造、脱敏与错误隔离逻辑未改变。

## 5. 门禁结果与未验边界

固定入口首次命令：

```text
python3 /Users/sunpcm/code/EchoTalk/.review/reports/tools/cross-platform-local-check.py b inventory
```

以 exit 78 结束并输出 `Runner error: PermissionError`。该入口需要写入 `/Users/sunpcm/.local/state/review-loop/locks`，当前实施子 Agent 沙箱不允许写该路径。按本轮停止规则，未执行后续 backend-format、backend-lint、backend-test、quality 门禁，也未运行其他替代命令或绕过锁目录。

独立评审阶段由主 Agent 在受控权限下补跑并通过全部门禁：前端 quality 8/8（format、lint、typecheck、Vite Vitest 31 文件/854 项、build-script 18、Fake API 61、build、Chromium E2E 148）、后端 Ruff format/lint 与隔离测试库 pytest 529 项（覆盖率 82.49%）。另有三项前端变异自检（移除超时定时器、移除调用方取消处理、让取消与超时抛同一错误）全部被杀死，变异前后源码指纹一致。

评审另发现并修复一处类型缺陷：`RequestInit.signal` 的类型为 `AbortSignal | null`，而新模块原签名只接受 `AbortSignal | undefined`，导致 `api.ts` 无法通过 typecheck。已放宽为 `AbortSignal | null`（与标准 `RequestInit` 对齐）并补充 `null` signal 的直接单测。

仍未验证：未访问真实后端、第三方 Provider、LiveKit 或其他业务服务；未验证各浏览器/原生运行时对 AbortSignal 传播与服务端请求取消的实际语义；导出函数尚未对外暴露取消参数，调用方取消路径目前只经内部测试覆盖（超时路径对全部请求已实际生效）。

本轮仅完成 RF-11 的超时/取消子项。OpenAPI TypeScript 类型/客户端生成和会话状态模型重构仍未完成，RF-11 整项保持未勾选。
