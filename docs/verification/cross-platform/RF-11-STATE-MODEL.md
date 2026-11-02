# RF-11 会话状态模型验证

> 对应任务：A65 / RF-11 会话状态判别联合与 Reducer
> 状态：独立 Review APPROVED，本地单提交
> `356f69e9ceecf8868b6f11db7b53d566032bb2f6`，main 精确 fast-forward 并完成当时 8 项前端
> 门禁与 backend 复验。
> 未 push/部署；日期：2026-11-01。

## 1. 重构前事实与目标

旧 store 以 `connectionState`、`sessionId`、`token`、`wsUrl` 四个独立扁平字段表达会话。
这种兼容形状允许类型系统表示旧代码实际不会主动生成、但公共 `setState` 或测试夹具仍可注入的组合，例如：

- `active` 但缺少 `token`、`wsUrl` 或 `sessionId`；
- `connecting` 却只存在部分凭据；
- 终态仍残留 token/wsUrl；
- `ending` 没有会话身份。

`connecting` + `token: null` 不能简单视为产品缺陷。`startSession` 在健康检查通过后先切换
session 视图，随后依次等待 `createSession` 与 `getSessionToken`；这一阶段旧代码刻意以
`connectionState === "connecting" && token === null` 表达“启动中，尚未可挂载 LiveKitRoom”。
本轮保留该外部投影，但在内部拆成 `creating_session` 与 `fetching_token`。

目标是把生产迁移收敛到独立纯状态模块，使启动过渡态、凭据就绪、活动会话、结束过程与终态
都有明确 phase；同时保持九个外部 `connectionState` 值、nullable 扁平字段、action 签名、
`sessionGen`、认证/生命周期所有权及 UI 文案/DOM 不变。

## 2. 判别联合与投影

纯模块：`apps/vite-app/src/store/conversationState.ts`。

| 内部 phase          | 载荷                                  | 外部 `connectionState` | 外部扁平字段                      |
| ------------------- | ------------------------------------- | ---------------------- | --------------------------------- |
| `idle`              | 无                                    | `idle`                 | 全部 null                         |
| `checking_health`   | 无                                    | `checking_health`      | 全部 null                         |
| `creating_session`  | 无                                    | `connecting`           | 全部 null                         |
| `fetching_token`    | `sessionId`                           | `connecting`           | sessionId；token/wsUrl 为 null    |
| `credentials_ready` | `sessionId`、token、wsUrl，三者均非空 | `connecting`           | 完整凭据                          |
| `active`            | `sessionId`、token、wsUrl，三者均非空 | `active`               | 完整凭据                          |
| `ending`            | `sessionId`                           | `ending`               | sessionId；token/wsUrl 为 null    |
| `end_failed`        | `sessionId`                           | `end_failed`           | sessionId；token/wsUrl 为 null    |
| `ended`             | 可选 `sessionId`                      | `ended`                | 保留已有身份；token/wsUrl 为 null |
| `dispatch_failed`   | 可选 `sessionId`                      | `dispatch_failed`      | 保留已有身份；token/wsUrl 为 null |
| `connection_failed` | 可选 `sessionId`                      | `connection_failed`    | 保留已有身份；token/wsUrl 为 null |

`checking_health`、`creating_session` 与 `fetching_token` 是启动阶段；`idle` 表示尚未启动，
不满足 starting guard。`credentials_ready` 虽然仍投影为外部 `connecting`，但已经持有完整
凭据，不属于启动中，也不会被认证或生命周期回调误取消。

## 3. 单一真值与原子兼容投影

Zustand 的 `_sessionState` 是内部判别联合真值。`connectionState/sessionId/token/wsUrl` 每次
均由同一个 Reducer/投影结果在同一 `set` 调用中生成，不通过订阅监听补写，因此不会形成中间
不一致、循环通知或同步取消丢失。

公开 `setState` 仍可用于既有测试夹具。store 对其会话字段进行归一化：完整凭据才可进入
`credentials_ready/active`；缺少任意一项时回落到明确启动 phase；空闲、失败和结束态不携带
凭据。这样既保留扁平兼容面，也避免新增第二份可独立修改的状态。

公开 `setState` 的冲突规则固定如下：不同引用的 `_sessionState` 是显式模型迁移，优先于同一
更新中的扁平字段并立即重新投影；展开旧 state 带入同一个 `_sessionState` 引用时，明确变化的
扁平会话字段优先，再归一化为内部模型；仅更新非会话字段时不重建会话模型。同对象 patch 保持
Zustand 的 no-op 引用与零通知语义。

对外兼容语义：

- 九个 `connectionState` 字符串保持不变；
- 所有既有 action 名称、参数、返回值和 `appView/error/sessionGen/agentError/selectedScenario/dispatched*` 保持不变；
- 空闲态 `token` 与 `wsUrl` 仍为 `null`，不使用 `undefined`；
- `ended` 同时支持无 sessionId 的本地取消与有 sessionId 的服务端结束；
- `ending/end_failed` 在合法生产迁移中保留结束目标 sessionId。

## 4. 迁移对照

| 既有迁移点                                   | 本轮内部迁移                                               | 外部兼容结果                                      |
| -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| `startSession` 占位去重                      | `idle -> checking_health`，立即 `sessionGen + 1`           | `checking_health`                                 |
| 健康检查完成、切换 session 视图              | `checking_health -> creating_session`                      | `connecting`、无凭据                              |
| `createSession` 成功                         | `creating_session -> fetching_token`                       | `connecting`、仅公开 sessionId                    |
| 获取到合法 token/ws_url                      | `fetching_token -> credentials_ready`                      | `connecting`、完整凭据                            |
| `resumeSession` 校验、详情、健康检查与 token | 保持 `checking_health`，全部成功后发布 `credentials_ready` | 一次性发布完整扁平字段                            |
| `setActive`                                  | 仅 `credentials_ready -> active`                           | `active`                                          |
| `failDispatch`                               | 任一外部 connecting/active phase -> `dispatch_failed`      | 清 token/wsUrl，保留已有 sessionId                |
| `failConnection`                             | 任一外部 connecting/active phase -> `connection_failed`    | 清 token/wsUrl，保留已有 sessionId                |
| `endSession`，已有 session                   | `ending`，调用服务端；成功 `ended`，失败 `end_failed`      | 立即清 token/wsUrl，保留目标 sessionId            |
| `endSession`，无 session                     | 直接 `ended` 且无 sessionId                                | 不调用服务端，不伪造已关闭记录                    |
| `setAgentError`                              | 任意 phase -> `ended`                                      | 保留已有 sessionId，清凭据                        |
| `reset`                                      | 任意 phase -> `idle`                                       | 清 sessionId/token/wsUrl/agentError/dispatched\*  |
| `goHome`                                     | 任意 phase -> `idle`                                       | 额外 `appView: "dashboard"` 并清 selectedScenario |
| `markDispatched`                             | 不改变会话 phase                                           | 原 sessionId/sessionGen 去重语义不变              |
| 迟到结果隔离                                 | 所有既有 `sessionGen` 增量与写后复核保留                   | 旧 auth/lifecycle/create/token/end 结果继续丢弃   |

## 5. 消费面

- `VoiceInterface` 直接消费 store 的内部 phase，再按 `idle`、启动、终态与 room-ready 分支渲染。
  只有 `credentials_ready/active` 类型可挂载房间；Room key 和 props 规则保持不变。
- Room 内部生命周期、超时、dispatch、断连与错误回调统一通过 room-ready 类型守卫检查凭据完整性。
- `ActiveSessions` 的“启动中”判定改为消费同一个 `isStartingConversationSession`，只覆盖
  `checking_health`、`creating_session`、`fetching_token`。
- `DocChatSetup` 与 `RecommendedScenarios` 的既有 loading/checking 规则未发生业务语义变化。

## 6. 覆盖清单

- 纯模型：全部 phase 构造、外部投影、空/空白/null/undefined 凭据拒绝、旧夹具归一化、
  starting 判定、完整启动/激活/结束矩阵、失败保留身份、无 session ended、冻结输入和实例隔离。
- 类型层：`credentials_ready` 与 `active` 缺少 token、URL 或 sessionId 时由
  `@ts-expect-error` 固定为不可构造。
- store：真实 `createSession` 前后观察 `creating_session`、`fetching_token`，token 返回后进入
  `credentials_ready`；公开 `setState` 覆盖函数 patch、对象/完整快照、replace、显式内部模型、
  仅 `appView` 更新、同步订阅一致性与同对象 no-op 零通知；无效 URL 不激活；
  reset/goHome 双投影清理；ending/end_failed/ended 路径保留原断言与身份。
- UI：idle 错误回退、连接就绪时挂载 LiveKitRoom、无 token/异常状态回退 ConnectingView，
  以及既有 Room 卸载、代际隔离和生命周期用例。

## 7. 未验边界

三项有效变异是 A65 lane 私有验证，均在提交前被真实断言杀死并完整还原源码，main 未重跑。
该提交精确 fast-forward 后，main 按 A65 当时范围完成原 8 项前端门禁与 529 backend
pytest，其中 Vitest 876、双浏览器 E2E 148。当时尚无 A67 才新增的 OpenAPI schema 门禁，
也不把其他轮次或 lane 的 Ruff 结果追加为本次 main 事实。该结论固定在上述单提交，后续
A66–A69 的测试增量不回写为 A65 当时的数量。

真实 LiveKit、iOS 原生生命周期、真实认证服务与生产发布不在本轮实施节点验收范围内。
A65 也没有把 UI 主动 abort 接入全部 store；该能力不由状态模型或后续公共 signal 入口
自动证明。A67–A69 已补齐 OpenAPI 类型生成与两个组件行为边界，因此 RF-11 现按
“本地代码验收完成”勾选，外部服务和未迁移 domain 适配仍是独立边界。
