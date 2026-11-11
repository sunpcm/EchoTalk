# A5 导航切片：逻辑解耦与单一原子容器

> 实施轮次：A5
> 日期：2026-11-12
> 状态：代码 18 文件冻结于 head 3413912；草稿 PR #145 已发布，目标 Linux CI 与代码独立 Review 已通过；停用户 Review、未合并

## 1. 目标与边界

本增量把「在哪个页面」与「通话处于什么阶段」从同一份会话状态里拆开：会话模块不再
包含 `appView`、页面概念，也不引用 Router。导航成为独立逻辑切片，但底层仍是同一个
物理原子容器，不拆成两个独立 store 后靠 React 批处理或放宽断言冒充原子。

唯一产品写集限定在前端最小范围，不改后端、依赖锁、schema、Fake API、i18n 文案、平台
协议或其他业务状态机。

## 2. 单一物理容器与窄 façade

- [conversation.ts](../../../apps/vite-app/src/store/conversation.ts) 改为兼容 façade，
  对外只暴露 `ConversationSlice`（别名 `ConversationStore`），不再完整 re-export
  `AppStore`，因此在 TypeScript 类型检查下不公开 `appView` 或 `goHome` 等外壳动作。
  这层收窄是类型视图边界：共享物理容器的运行时状态仍是 `AppStore`，接口收窄不等于运行时字段隔离。
- [appStore.ts](../../../apps/vite-app/src/store/appStore.ts) 是唯一物理容器：
  `useAppStore = create<AppStore>`，组合 `initialNavigationSlice` 与
  `createConversationSlice`。`useNavigationStore` 与 `useConversationStore` 都指向这同一个
  容器，只是暴露的类型视图不同。
- [navigation.ts](../../../apps/vite-app/src/store/navigation.ts) 只保存 `appView` 枚举
  （`dashboard | session | doc-chat-setup`），不创建独立物理 store。

## 3. 原子发布

会话切片通过 [conversationSlice.ts](../../../apps/vite-app/src/store/conversationSlice.ts)
的 `setSession(event, extra)` 发布状态，内部是单次 `set((state) => ({
...reduceStoreSession(...), ...extra(state) }))`。同一次同步 `set` 同时写入内部判别联合
`_sessionState`、扁平投影（`sessionId/token/wsUrl/connectionState`）以及组合层补丁
（如 `appView`）。resume Token 成功路径沿用既有「凭据与 session 视图一次提交」合同
（见 [CROSS_PLATFORM_SESSION_DISCOVERY.md](../../CROSS_PLATFORM_SESSION_DISCOVERY.md)），
没有拆成两个 store 顺序更新。

组合层通过 coordinator 把「开始连接 / 凭据就绪 / 启动关闭」映射为 `appView` 补丁：
`beginConnectingPatch` 与 `credentialsReadyPatch` 返回 `appView: "session"`，
`startupClosedPatch` 返回 `appView: "dashboard"`。会话切片本身不理解这些字段，只负责在
同一次 `set` 里带上补丁。

## 4. 视图所有权

coordinator 的 `isRoomOwningState: (state) => state.appView === "session"` 仍是 `setAgentError`
收取 Room 错误时的防线之一。`setAgentError` 在最终 set updater 内复核
`sessionId/sessionGen`、`appView` 与 Room 可收取 phase，未因切片化而扩大接受范围或去掉
视图所有权校验。

## 5. reset 与 goHome / DocChat 入口语义

- `reset()` 只重置会话切片并递增 `sessionGen`，保留导航 `appView` 与 `selectedScenario`。
- `goHome()` 走 `resetWithShellCoordination({ appView: "dashboard", selectedScenario: null })`，
  清场景并返回主页。
- `openDocChatSetup()` 走 `resetWithShellCoordination({ appView: "doc-chat-setup" })`，
  保留 `selectedScenario`、重置会话并进入 DocChat 设置入口。

`reset` / `goHome` 语义与 resume 凭据/视图原子发布在
[navigation.test.ts](../../../apps/vite-app/src/store/navigation.test.ts) 有新增覆盖；DocChat
设置入口行为由既有 App 回归覆盖。

## 6. 窄 façade 的 setState replace 语义

`useAppStore.setState` 被 `setStateWithSessionProjection` 覆写，统一经
`normalizeConversationSessionPatch` 走投影路径。`replace === true` 时先按传入的窄
`ConversationSlice` 生成投影，随后由组合层补回当前 `appView`、`goHome`、
`openDocChatSetup` 三个外壳/导航键——仅当调用者显式提供这些键时才不覆盖，从而同时保留
「窄 façade 不能抹掉另一切片」与「AppStore 完整 replacement 语义」两条合同。需要同时改
导航与会话的场合仍由 `goHome` / `openDocChatSetup` 组合层动作协调，页面字段没有搬名藏进
`conversationSlice`。

该 replace 回归由独立 Review 发现并补测：从完整 AppStore 剥离三个非 ConversationSlice 键后，
以对象与函数两种形式对窄 `ConversationStore` 调用 `setState(..., true)`，断言导航/外壳动作
不丢、会话投影一致，且仍只产生一次同步通知。

## 7. 消费者迁移

真实导航消费者改用 navigation/app 组合 API：

- [App.tsx](../../../apps/vite-app/src/App.tsx) 经 `useAppStore` 读取 `appView` 与
  `openDocChatSetup`，会话字段仍走 `useConversationStore`。
- [ConversationStatusViews.tsx](../../../apps/vite-app/src/components/conversation/ConversationStatusViews.tsx)、
  [EndedConversation.tsx](../../../apps/vite-app/src/components/conversation/EndedConversation.tsx)、
  [DocChatSetup.tsx](../../../apps/vite-app/src/components/doc-chat/DocChatSetup.tsx)、
  [user-state.ts](../../../apps/vite-app/src/lib/user-state.ts) 的 `goHome` 改走 `useAppStore`，
  会话字段仍走 `useConversationStore`。

既有单测与 E2E 仅对状态归属与 import 做机械替换（`useConversationStore` → `useAppStore`），
行为断言不弱化、不删除、不 skip，测试计数不降。

## 8. 门禁与验收状态

实施侧本地验证（node 22.13.1 + pnpm 10.26.0）：

- typecheck（`tsc --noEmit`）：exit 0。
- store 子集（navigation + conversation）：125 passed（含 2 个新增 replace 回归）。
- 迁移组件/库子集（App + ActiveSessions + VoiceInterface + DocChatSetup + user-state）：
  216 passed。
- lint：0 errors，132 warnings。
- prettier --check：本增量改动文件全部通过。
- 前端全量单测（`vitest run`，非 E2E/浏览器/DB）：45 files / 1161 passed（较返修前 1159
  新增 2 个 replace 回归，计数不降）。

主控本地门禁（macOS，完整 15 项门禁 14 项 exit 0，源码逐 hash 未变）：

- Vitest 1161 / 45 files；backend pytest 809 / 80.19%（单元 / mock / 合成 PG 集成，非
  809 全 PG）；lint 132 warning / 0 error；FakeAPI 75 / API 类型 8 / 构建脚本 21；0 skip。
- macOS E2E 233 pass / 1 fail，仍为 a11y Provider select 高度 23px（WebKit）的既有失败。

目标 Linux CI 回执（已测试 head 3413912，草稿 [PR #145](https://github.com/sunpcm/EchoTalk/pull/145)）：

- CI [run 43080936815](https://github.com/sunpcm/EchoTalk/actions/runs/43080936815) 与
  Guard [run 43080936655](https://github.com/sunpcm/EchoTalk/actions/runs/43080936655) 全绿；
  Vitest 1161/45、E2E 234/234 零 skip 无 Retry、FakeAPI 75/API 类型 8/构建脚本 21、
  lint 132/0、pytest 809/80.19%（混合单元/mock/PG）；代码 18 文件未改。

状态为「代码已测试、Review 通过」而非整卡已完成；停用户 Review、未合并。真实外部服务
与设备验收未执行。
