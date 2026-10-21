# CP-02：客户端结束释放与会话代际保护验证

## A3：客户端结束释放与代际保护（2026-10-21）

基线 `bdae64f9cbe982d73453b12e74237284481f9d19`，分支 `codex/cp02-client-end-release`。
遵守 `docs/CROSS_PLATFORM_ARCHITECTURE.md` §8.4 契约及实施约定：

### 1. 客户端结束释放与本地音轨同步停止 (P1-1)

- **主动同步停止 owned local tracks**：针对 LiveKit SDK `useLiveKitRoom` 卸载仅触发异步 `room.disconnect()`，而 `Room.disconnect()` 需先 `await sendLeave()/close()` 导致网络慢/挂起时本地麦克风音轨无法及时停止的缺陷，在 `VoiceInterface` 及 `ActiveView` 中引入主动同步停止逻辑：
  - 点击“结束对话”时立即提取 `useRoomContext()` 中的 `room.localParticipant.trackPublications`，同步调用其 `pub.track.stop()`；
  - 在组件卸载/代际变更的 cleanup 路径中同样同步执行 `pub.track.stop()`；
  - 严格限定操作当前 Room 实例自身拥有的 tracks，不影响其他 Room，且不等待网络 disconnect 完成；
  - 新增自有集成测试禁止 Mock 卸载代为自动 stop，设置 disconnect 永不完成，真实验证产品代码主动同步停止音轨。
- **失败状态与显式重试**：服务端 `endSession` 接口异常或网络超时进入独立 `end_failed` 状态，页面明确提示“本地音频已停止，服务端结束待重试”，保留同一 `sessionId` 但绝不恢复 `token` 或音频采集；只提供显式“重试结束”按钮向同一 `sessionId` 发起幂等结束重试。
- **在途去重**：已处于 `ending` 状态时的并发或连点重复调用自动去重，不发起冗余请求。
- **分析延迟触发**：`usePollingAssessment` 仅在 `connectionState === "ended"` 且确认成功后才被触发挂载，在 `ending` 与 `end_failed` 状态下绝不启动评估分析轮询。
- **文案国际化**：所有新增提示与按钮文案（`ending`、`endingHint`、`endFailedTitle`、`endFailedMessage`、`retryEndButton`）统一收拢至 `zhCN.conversation`。

### 2. 在途两阶段取消与 Token 迟到防复活 (P1-2)

- **创建成功立即保存归属 ID**：`createSession` 返回后立即持久化 `sessionId` 到 store，杜绝原先在 `getSessionToken` 在途时无法结束且误报“尚未创建”的缺陷。
- **在途启动取消**：调用 `endSession` 时同步递增代际 `sessionGen`，废弃旧启动代际：
  - 若在 `getSessionToken` 在途时结束，发向服务端的 `apiEndSession(sessionId)` 正常执行，后续迟到的 Token 响应因代际不符被静默丢弃，绝不复活房间；
  - 若在 health/create 尚未返回、无 ID 时结束，取消本地启动代际，不伪称已关闭未知服务端记录，随后迟到的 health/create 结果被丢弃，不发起 Token 获取与房间创建；
  - `setAgentError` 发生时同步递增代际，终止旧启动流程。

### 3. Room 实例代际隔离与回调门禁 (P1-3, P2)

- **Room 实例代际隔离**：针对 SDK `useLiveKitRoom` 以组件内部 state 保持实例、新代际复用旧实例导致音轨与状态串连的问题，在 `VoiceInterface` 中为 `<LiveKitRoom>` 绑定 `key={`lk-room-${mountedGen}-${mountedSessionId}`}`，确保同一 React 批次或跨代操作强制销毁并重新实例化独立的 Room。
- **非连接态严禁渲染 Room**：仅在 `connecting`（且有 token）或 `active` 状态渲染 `<LiveKitRoom>`，在 `idle`、`checking_health`、`ending`、`end_failed`、`ended` 状态下坚决不挂载。`checking_health` 状态明确展示 `ConnectingView`。
- **无 ID 在途取消体验与安全隔离**：在未取得 `sessionId` 前在途取消时，展示独立取消视图“本地已取消，服务端状态未知”，不启动分析轮询、不自动补写未知会话，保留用户返回主页路径。
- **全回调代际门禁**：`LiveKitRoom` 的 `onConnected`、`onError`、`onDisconnected` 回调均核验挂载时的代际与 SessionId，代际不匹配时绝不激活新会话、不调用 `dispatchAgent`、不展示过时警告 Toast。

### 4. 回归验证与测试覆盖

- **Store 单元测试** (`apps/vite-app/src/store/conversation.test.ts`)：
  - 验证 deferred end 在 API resolve 前即时清空 token/wsUrl 并处于 `ending`；
  - 验证 API 失败时进入 `end_failed`，token 为 null，保留同一 sessionId，并支持显式重试；
  - 验证在途结束连点去重；
  - 验证在途返回主页后，迟到的 end 响应不覆盖 `idle` 状态；
  - 验证旧 session end 响应不覆盖新 session；
  - 验证 `createSession` 成功且 Token 在途时能够正常结束，且迟到 Token 不复活会话；
  - 验证 health/create 在途时调用结束能够取消启动代际，迟到响应被丢弃；
  - 验证跨代相同状态（同为 connecting）严格隔离；
  - 验证 `setActive` 无法复活 ending/end_failed/ended/idle 状态，且不接受不匹配的代际/sessionId；
  - 验证 `setAgentError` 取消启动在途。
- **组件集成测试** (`apps/vite-app/src/components/conversation/VoiceInterface.test.tsx`)：
  - 验证 disconnect 永不完成时，用户点击结束仍能主动同步触发本地 tracks 的 `stop()`；
  - 验证组件 unmount 时主动同步触发本地 tracks 的 `stop()`；
  - 验证新旧 Room 实例跨代隔离 (P1)：Mock LiveKitRoom 基于 `useState` 生成独立实例标识；在同一次 `act` 内由旧 active 状态切换到新代际/新 sessionId/新 Token 的 connecting 状态，验证旧实例卸载、owned track 同步停止且新实例标识不同，调用捕获的旧回调不激活或 dispatch 新会话（删除 Room key 变异已被该测试杀死）；
  - 验证 `checking_health` 渲染 `ConnectingView`，除 connecting/active 且 token 存在外绝不挂载 LiveKitRoom (P2-1)；
  - 验证无 ID 在途取消展示“本地已取消，服务端状态未知”，不启动分析轮询且支持返回主页 (P2-2)；
  - 验证 `end_failed` 状态展示本地停止/待重试文案，无 Room，且重试调用针对同一 session；
  - 验证只有 `ended` 状态才启动分析轮询，`ending` 和 `end_failed` 绝不轮询；
  - 验证组件旧 `onConnected` 在 session 已变或 ending 时不触发 `dispatchAgent`；
  - 验证旧 Room 实例的 `onError`/`onDisconnected` 在代际变更后不弹 Toast；
  - 验证 ending 与 end_failed 视图下的返回主页操作。

未修改其他业务组件或后端，不增加依赖、不改锁。停在 Review。

## 独立复验

APPROVED。独立172项Vitest、格式/lint/类型/Vite+Webpack构建通过，保留4项既有ESLint warning。6项原有Chromium/FakeAPI E2E通过；另外两项真实浏览器探针覆盖390px/1280px宽度的失败结束、显式重试、提交中无Room/Token及无提前分析请求、成功后返回主页，截图已独立检查无横向溢出或按钮遮挡。

6项独立生命周期/Room探针通过；移除owned-track停止、Room代际key、启动代际检查三个变异均被仓内回归测试杀死，分别触发3/1/8项失败，源文件逐字节恢复后完整门禁再次通过。此前169项测试未能发现删除key的缺口已补齐，本轮172项可捕获该问题。证据保留本地.review/reports/track-a/client-end-release/reviewer/ev（probes-r1、mutations-r2、final-gates-r2）；截图在私有reviewer-probes/wave3-a/ui/screenshots。

这些证明本地代码/SDK所有权和模拟轨道的释放时序，不替代三端真实设备麦克风、来电/休眠中断、真实IdP/LiveKit/Provider验收。临时Vite/FakeAPI已退出；未push/部署。
