# CP-06 Agent 错误消息归属与载荷边界

> 实施轮次：A76 b/r0
> 日期：2026-11-01
> 状态：本地实施停写，待主 Agent 代跑门禁与独立 Review

## 1. 问题与权威边界

既有 `agent_error` callback 直接读取可变 store，未绑定实际 Room 的
`sessionId/sessionGen`、认证 principal/revision 或仍可收取错误的 phase；payload 仅检查
`code/message` 是否为真值。因此旧 Room callback 可达新会话，同 principal 的 revision
变化存在订阅通知空窗，数字等错误类型也可能进入 UI。

本增量只依据现有跨平台契约收窄错误收取边界，不修改 LiveKit SDK、网络协议、服务端错误
消息、认证策略、HTTP/schema、锁、依赖或平台生命周期能力。用户可见有效错误卡片、本地音轨
停止和房间卸载行为保持不变。

## 2. 收取契约

1. `agent_error` 主题的 payload 必须是 JSON 普通对象，`type` 精确为 `agent_error`，
   `code/message` 均为非空字符串；额外字段不得进入 store 或诊断。
2. 数字、对象、数组、布尔、null、空白字符串、无效 JSON、数组根和其他 type 静默拒绝。
   未知但合法的字符串 code 保留现有 UI 兼容，诊断仍由既有白名单映射为 `unknown`。
3. callback 在捕获时绑定实际 Room 的 `sessionId/sessionGen` 和当前可采纳认证 revision；
   触发时重新核对认证 snapshot/revision、Room 归属、组件挂载、`appView` 与可收取 phase。
4. 同一 principal 的认证事件可以把保留 Room 的新 callback 推进到新 revision；旧 revision
   callback 即使仍在通知空窗内也必须拒绝。该重绑只更换数据消息处理闭包，不重连、不停轨或
   发起网络请求。
5. store 在提交 `agent_error` 时再次原子核验会话归属：`sessionId/sessionGen`、`appView`
   与 Room 可收取 phase 必须仍对应捕获时实际 Room。principal/revision 仍由
   `ActiveConversation` 的组件门禁核验，不把认证身份检查混入 store。同步订阅者若在通知内
   切换到新会话，旧消息不得继续终止或清理新会话；不匹配的 callback 不得触发诊断、状态
   写入或 startup tracker cleanup。
6. valid current error 在 connecting/credentials-ready 与 active phase 均可收取。首个有效
   错误保留既有结束、token 清除、Room 卸载、本地音轨停止和错误卡片行为；终态 replay
   静默忽略。

## 3. 实施边界

- `ActiveConversation` 只消费 `RoomSession` 传入的实际 `sessionId/sessionGen`，维护
  subscribe-before-read 的 principal/revision 门禁和本地挂载所有权。
- `agentErrorMessage.ts` 是无 React/store/网络依赖的纯解析边界。
- `conversation` store 的 `setAgentError` 只要求会话 ownership，并在最终 set updater 内
  复核 `sessionId/sessionGen`、`appView` 与 Room 可收取 phase；principal/revision 留在
  `ActiveConversation` 门禁。其他 action、phase 模型和公开扁平投影不变。
- 未新增未知消息 UI，未记录 payload、文档正文、账号、token 或密钥。

## 4. 已写入回归

- 纯解析器覆盖合法/未知 code、额外字段丢弃、非对象根、字段类型矩阵、空白字符串、错误
  type、无效 JSON 与无效字节。
- 真实 `VoiceInterface` + store 覆盖保存后主动调用旧 callback、旧/新代际、principal
  变化未通知空窗、同 principal revision 未通知后通知恢复、卸载、终态 replay、无关重渲染、
  StrictMode 和新 Room 正常错误。
- store 覆盖 ownership mismatch 零写入、connecting 可收取、终态拒绝、同步观察者替换新
  会话，以及 stale callback 不取消新 startup tracker。
- 既有合法未知 string code/诊断脱敏测试保持不变。

## 5. 验证状态与未验边界

本 r0 按 prompt 不运行 formatter、lint、typecheck、测试、构建、服务或 Git 写操作。待主
Agent 通过固定 `ev.sh` 入口代跑 format-fix、完整 frontend10、backend Ruff、专用 PostgreSQL
pytest、OpenAPI schema、独立探针与有效变异，并由独立 Review 判定。

真实 LiveKit DataChannel、真实 IdP/Provider、Agent worker、Docker、远端 CI、设备与部署
均未验证。本文只记录本地代码与回归设计，不代表外部链路通过。
