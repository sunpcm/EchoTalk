# 前端 Data 层契约设计（A4a）

## 1. 范围与前提

本文档是前端 data 层的现行只读契约，记录四个数据区块
（`WeeklyGrammar`、`WeeklyProgress`、`DailyProgress`、`ActiveSessions`）的**实际行为**、
已落地的**只读 data 层接口边界**与一组**不依赖具体组件的契约测试矩阵**。
该契约经 A4a–A4e 落地并合入；未完成工作见 [TODO.md](../TODO.md)，已归档收口见
[todo-done.md](./history/todo-done.md)。[PR #138](https://github.com/sunpcm/EchoTalk/pull/138) 是引入该规划的来源。

- 语义以现有代码为准，逐条落到代码行；差异之处列明，并按用户已确认的方案 A 保留现状。
- data 层的目标结构与"契约先于实现"原则见 [ARCHITECTURE_ROADMAP.md](../docs/ARCHITECTURE_ROADMAP.md#L35-L57) §3.1。
- 本文只定义"读"路径；变更（end/resume）、Cloud 门禁、会话 store 状态机、API URL/解析、
  组件渲染、i18n 均不在 data 层职责内。
- A4a 不引入新依赖、不迁移任何组件；契约测试只依赖通用注入源，不 import 四个业务组件。

本文的现状证据固定于 `main@a7841b7486b14af01e535e5e3f4e0472c621d198`，下方源码行号链接使用
该提交的永久链接，避免 A4b～A4e 迁移后行号和实现变化使原有行为证据失效。

## 2. 认证与生命周期基线

- **principal**：`issuer + subject` 精确相等，见 [auth.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/lib/auth.ts#L5-L8)、
  [auth.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/lib/auth.ts#L111-L115)；subject 只做 trim 非空校验、不归一化，
  见 [auth.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/lib/auth.ts#L126-L139)。
- **revision**：全局单调递增，任何认证事件发布都 `currentRevision += 1`，
  见 [auth.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/lib/auth.ts#L153-L177)；读取入口见
  [auth.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/lib/auth.ts#L179-L185)。
- **请求绑定**：API 请求发起时捕获 `reqRevision`，取 token 前后各校验一次；401 只
  `invalidateAuthSession(reqRevision)` 失效请求绑定代际，见 [api.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/lib/api.ts#L56-L61)、
  [api.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/lib/api.ts#L87-L91)。
- **hidden/offline 门禁**：`visibility !== "hidden" && online !== false` 才允许读，这是四组件的实际判定——
  WG [WeeklyGrammar.tsx](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L64-L67)、
  WP [WeeklyProgress.tsx](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L95-L98)、
  DP [DailyProgress.tsx](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L120-L126)、
  AS [shared.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/shared.ts#L74-L79)（`isLifecycleBlocked`）。
  `unknown`/`null` 的归一化只发生在 [webLifecycle.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/platform/webLifecycle.ts#L46-L59)
  的 `resolveVisibility`/`resolveOnline`，本身不是门禁判断；data 层须复用这一 snapshot 语义，不得自造门禁。

## 3. 四区块实际语义矩阵

缩写：WG=WeeklyGrammar、WP=WeeklyProgress、DP=DailyProgress、AS=ActiveSessions（列表 + 结束/恢复 + 生命周期订阅）。

| 维度                       | WG                                                                                                                                                                                                                                                                                                                                                                            | WP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | DP                                                                                                                                                                                                                                                                                                                                                      | AS                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| origin 与 context          | principal+revision+endDate+timezone [WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L22-L27)                                                                                                                                                                                    | 同左，origin 变化使 week/history/more 全失效 [WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L32-L37)                                                                                                                                                                                                                                                                                                             | 首屏捕获 snapshot/revision + 本地日窗口，窗口另存 windowRef [DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L78-L83)                                                                                                                                      | 发起时捕获 principal+revision，结算再读当前 [shared.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/shared.ts#L40-L46)、[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L75)                                                                           |
| hidden/offline             | 初始 paused 不请求；suspend abort + idle + paused [WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L64-L67)、[WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L133-L146)            | 不请求；suspend 作废 week/history/more、清 cursor，保留 days/items [WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L293-L306)                                                                                                                                                                                                                                                                                     | 不发；suspend 作废在途、退 loading、清 cursor，保留 stats/sessions [DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L328-L344)                                                                                                                             | 不发；suspend 作废 list/more、清 cursor，保留 sessions [shared.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/shared.ts#L74-L79)、[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L222-L234)                                                          |
| 迟到 success/error/finally | 单 slot + AbortController；disposed/slot/origin/gate 不写回 [WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L93-L100)、[WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L112-L125) | 三独立 slot，各自 finally 只在 slot 匹配时释放 [WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L125-L133)、[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L179-L192)                                                                                                                                              | 数字请求 id；success/error/finally 均校验 mounted+id+principal+revision [DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L150-L215)                                                                                                                        | 数字请求 id；isRequestCurrent 校验 mounted+id+身份 [shared.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/shared.ts#L61-L68)、[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L107-L136)                                                              |
| auth 清空重查              | origin 变化 abort + 清 view，订阅后重查 [WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L85-L92)、[WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L129-L132)                      | principal/revision/日窗口/时区变化全失效清空 [WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L289-L292)                                                                                                                                                                                                                                                                                                           | 未认证清空；principal 或 revision 变化递增两代际、清空重查 [DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L360-L408)                                                                                                                                     | 未认证或代际变化 reset end/resume/list、清 tombstone+cursor，authenticated 代际变化后重查 [Lifecycle](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionsLifecycle.ts#L104-L127)、[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L250-L257) |
| 分页与去重                 | 无分页                                                                                                                                                                                                                                                                                                                                                                        | limit 50、completed+窗口校验、大小写不敏感去重、重复 cursor 检测 [WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L135-L156)、[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L248-L286)                                                                                                                            | 原始 ID 精确去重、无 cursor 循环防护 [DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L169-L178)、[DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L267-L278) | 原始 ID 精确去重 + ended tombstone 防旧响应复活；无 cursor 循环防护 [List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L111-L118)、[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L204-L207)                                  |
| 显式重试 / 本地错误        | 固定文案 + refresh [WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L120-L122)、[WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L188-L195)                                         | week/history/more 各阶段独立重试 [WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L349-L356)、[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L388-L399)、[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L419-L432) | 首屏 retry 重发并行请求；more 失败保留 cursor 同按钮重试 [DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L460-L473)                                                                                                                                       | 列表/更多显式重试，仍过 auth/lifecycle/互锁 [ActiveSessions.tsx](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/ActiveSessions.tsx#L90-L105)、[ActiveSessions.tsx](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/ActiveSessions.tsx#L192-L214)                                                                         |
| 错误不回显                 | 异常只置错误态 + 固定文案 [zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L155)                                                                                                                                                                                                                   | 三阶段本地文案 [zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L135)、[zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L138)、[zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L144)                                                                                           | 布尔错误 + 固定文案 [zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L119)、[zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L123)                                                                | 列表/更多只布尔错误；end/resume 也不回显正文 [zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L182)、[zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L195)、[zh-CN.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/i18n/zh-CN.ts#L202)                            |

## 4. 只读 data 层边界

A4a 定义一个最小的"只读查询控制器"，而不是完整服务端状态框架。核心是策略注入，把现有四组行为建模为可配置 profile，未来可替换实现。

- **Origin**：同步捕获 `principal + revision + query context`。WG/WP 的 context 是 `endDate+timezone`，
  DP 是本地日 `[start,end)`，AS 为空。origin 变化即清空数据、cursor 消费历史与同 origin tombstone，
  并按资格重查；普通首屏 refresh 也开启新的 cursor 消费轮次。
- **Read gate**：统一消费 lifecycle snapshot，并允许调用方注入额外业务 gate（`true` = 允许读，`false` = 拒绝且不排队）。
  gate 关闭时取消只读在途、退 loading 并解除只读槽，保留 profile 约定的可见数据/错误策略；显式 retry 必须
  读取当前 gate 并可立即发起新只读请求。AS 的结束/恢复/启动互锁经 gate 注入，data 层不读取也不释放
  conversation store 的外部 mutation。
- **Operation slots**：每个控制器提供固定的 primary/more 两个请求槽。WG 使用 primary；WP 用两个控制器组合
  weekly→history 依赖链（more 由按钮显式触发）；DP 由单个 fetcher 内部 `Promise.all` 聚合并使用 primary/more；
  AS 使用 primary/more。新首屏 refresh 立即使旧 more success/error/finally 失效；旧回调不得写回或释放新 more 槽。
  primary/more 在发布 loading 后、调用 transport 前再次校验 disposed、请求 epoch、origin 身份与 gate；同步通知内
  dispose、切 origin 或关 gate 都不得继续发起旧轮请求。
- **Page policy**：由查询声明首页是否重置 items、是否仅清 cursor、追加、ID key、cursor 记录、
  重复 cursor 检测、窗口校验、tombstone。首页开始清 cursor 而保留 items 时，取消或失败后不得重新公开、
  继续消费刷新前的旧 cursor。
  重复 cursor 在追加前原子失败，不改 items/cursor/cursor 消费历史，并保留同一 cursor 的显式重试能力。
  未配置 `page`/显式 `keyOf` 时不去重，首屏与更多页均保留全部原始条目；此时 `removeItem` 没有安全
  身份，静默 no-op 且不记录 tombstone。当前四策略原样保留。
- **Suspend policy**：由查询声明挂起时保留或退出可见数据、是否清 cursor、是否保留错误；默认不新增错误。
- **Retry**：只显式重试；lifecycle/auth 触发的是重新 reconcile，不是自动循环重试；重试重新读取当前 origin 与 gate。
- **Error**：只返回本地安全错误分类（`http`/`parse`/`network`），不透出服务端正文；文案由组件经 i18n 映射。
  fetcher 同步抛错也在原调用栈内捕获、分类并释放请求槽，使显式 retry 可立即重试；正常 fetcher 不被包装成额外
  microtask，保留原发起时序。
  门禁关闭（hidden/offline/业务 gate 拒绝）不是错误，而是静默 `paused`/`idle`（WG/WP）或不发起并退 loading（DP/AS）：
  不制造新错误；各阶段旧错误的清除/保留按 profile 原样保留（见 §5 差异 7）；可见数据是否保留按 per-query `preserveOnSuspend` 区分。
- **Transport cancellation**：控制器可创建 cancellation token；各 query fetcher 决定是否传给 API，以保留
  WG/WP（abort 传输）与 DP/AS（仅结果作废）的现状。`concurrent: "override"` 在启动新 primary 前 abort 旧
  primary；abort 回调可能同步 dispose 或触发代际变化，回调返回后必须再次校验，旧轮不得继续 publish、启动
  transport，旧 finally 也不得释放新轮槽位。
- **不负责**：API URL/解析、组件渲染、i18n、结束/恢复业务流、Cloud 门禁、会话 store 状态机、任何共享缓存。

以下为 R2 已实现边界的摘要；精确签名以源码为准：

> 用户已确认方向 A（自研最小只读控制器 + per-query profile）。R2 的实际签名以
> `apps/vite-app/src/data/readonly-query.ts` / `use-readonly-query.ts` 为准，接口草图只作
> 设计示意、并非逐字实现约束；控制器为框架无关，并注入认证、生命周期与错误分类源。Hook 负责
> 订阅真实认证与生命周期，并用浏览器时钟触发 `nextContextChange` 重新检查 context。

```ts
type ReadGate = (snap: LifecycleSnapshot) => boolean; // true = 允许读

interface QueryOrigin {
  principal: AuthPrincipal;
  revision: number;
  context: unknown; // WG/WP: endDate+timezone；DP: [start,end)；AS: null
}

type ContextResolution<C> = { eligible: true; context: C } | { eligible: false };

interface QueryProfile<C, D> {
  resolveContext(): ContextResolution<C>; // eligible:false=无资格（未认证等）；AS 合法 context 可为 null
  gate?: ReadGate; // 注入式业务门禁；true=允许，false=拒绝（不发、不排队、静默非错误态）
  sameContext?(a: C, b: C): boolean;
  nextContextChange?(now: number): number | null; // 返回传给 setTimeout 的延时，不是 epoch
  contextCheckIntervalMs?: number; // 可选分钟级 context-only 复检
  resetOnFirstPage?: boolean;
  clearCursorOnFirstPage?: boolean; // 保留 items，但首页开始时清内部 cursor
  page?: PagePolicy<C, D>;
  preserveOnSuspend?: boolean; // WG=false（phase 隐藏）、WP/DP/AS=true
  clearPrimaryErrorOnSuspend?: boolean;
  abortTransport?: boolean; // WG/WP=true、DP/AS=false
  concurrent?: "ignore" | "override";
  settlementDrift?: "revalidate" | "discard"; // 默认 revalidate；DP/AS 使用 discard
}

interface PagePolicy<C, D> {
  keyOf(item: D): string;
  dedupeKey?(item: D): string; // WP=toLowerCase，DP/AS=原始 id
  detectRepeatedCursor?: boolean; // WP=true，DP/AS=false
  validatePage?(page: D[], ctx: C): void; // WP=completed+窗口校验
}

interface QueryHandle {
  refresh(): void; // 重新读取当前 origin 与 gate
  loadMore(): void;
  removeItem(key: string): void;
  cancel(): void; // 仅作废在途并退出相应 loading，保留数据、cursor、错误与 tombstone
  retry(): void;
  dispose(): void;
}

interface QueryState<D> {
  phase: "idle" | "loading" | "ready" | "error";
  items: D[];
  cursor: string | null;
  errorKind: "http" | "parse" | "network" | null;
  paused: boolean;
  more: "idle" | "loading" | "ready" | "error";
  moreErrorKind: "http" | "parse" | "network" | null;
}

interface ReadQuery<C, D> extends QueryHandle {
  updateOptions(
    profile: QueryProfile<C, D>,
    fetcher: Fetcher<C, D>,
    classifyError?: (error: unknown) => "http" | "parse" | "network",
  ): void;
  reconcile(): boolean;
  suspend(): void;
  resume(): void;
  getState(): QueryState<D>;
}
```

该控制器持有实例内状态、不共享缓存；React hook 在 options 重建时更新同一控制器，只有 origin 真正变化才重查，
因此相同语义的新 profile/fetcher 对象不会多发请求，后续操作使用最新回调。`Fetcher` 决定是否把 cancellation token 传给 API。
错误统一映射为 `http`/`parse`/`network` 的本地分类，不携带服务端正文；门禁关闭不属于错误分类。

`nextContextChange(now)` 返回相对延时毫秒数，hook 直接交给 `setTimeout`。可选的
`contextCheckIntervalMs` 只周期执行 `reconcile()`；日期、时区、principal 或 auth revision
实际变化时才 refresh，缺省时不创建 interval。分钟 interval 从首次启用时保持自己的相位；focus、
context 变化或午夜重排只更新 `setTimeout`，仅 interval 频率实际变化时才重建 interval。

`settlementDrift` 只约束已经发起传输后的 success/error 结算。默认 `revalidate` 保留完整
origin/gate 复核；DP/AS 使用 `discard`：disposed、请求 seq、当前 authenticated principal 与
auth revision 仍匹配才结算；认证漂移只丢弃，不自动 `reconcile()` 或 refresh；日窗口/
lifecycle 不新增为结算门禁。transport 发起前的 seq、origin 与 gate 复核不受该选项影响。

一个组件需要“上游概览 → 下游分页”依赖链时，可以在同一个 React effect 内共享一套认证、
生命周期与计时器订阅，再创建两个彼此独立的 `createReadQuery` controller。上游成功提交
principal、revision、窗口与数据后，下游 `resolveContext` 才能读取这份不可变提交并变为 eligible。
旧下游结算发现身份或窗口漂移时，先 `reconcile()` 上游并刷新；上游提交后下游才可读取新窗口。
下游正常成功、失败或分页完成时，上游与下游 `reconcile()` 均返回 false 必须直接 no-op，不能额外
刷新上游。hidden/offline 时本地合法选择仍可更新，但 controller gate 必须阻止网络请求。

`DailyProgress` 使用一个专用 React hook 直接消费 `createReadQuery`，只保留一套认证、生命周期
与午夜 `+100ms` timer 订阅；不配置 focus 或分钟 interval。首屏把并行聚合与列表结果包装为同一个
判别联合 Page，summary 与 rows 在 controller 的一个 success 分支原子发布，more 沿用发起时窗口并
只追加 rows。相同 authenticated 代际的广播只更新 snapshot；principal/auth revision 变化才重查。
DP profile 使用 `preserveOnSuspend:true`、`clearPrimaryErrorOnSuspend:false`、
`abortTransport:false`、`concurrent:"override"` 与 `settlementDrift:"discard"`，保留原始 API
参数、精确字符串 ID 去重、非物理取消及挂起可见数据语义。

`ActiveSessions` 的专用 data hook 直接消费 `createReadQuery`，不增加认证或生命周期订阅；既有
`useActiveSessionsLifecycle` 仍为唯一订阅中枢，结束/恢复写操作及共享 runtime 互锁保持原归属。
AS 使用 `resetOnFirstPage:false`、`clearCursorOnFirstPage:true`、`concurrent:"ignore"`、
`settlementDrift:"discard"` 与 `abortTransport:false`；首屏 refresh 开始即清内部 cursor 而保留 items，
使取消或失败后 more 不再消费刷新前 cursor。首屏零参数、分页仅传 cursor，精确 ID 去重与 ended
tombstone 由 controller 持有。业务互锁或生命周期不允许时，适配入口原样 no-op，避免把拒绝读取误当作
suspend 清 cursor。

`cancel()` 只处理在途槽位：作废旧结果并退出相应 loading，保留 items/cursor/error/tombstone；
区别于会清 cursor/more 错误的 `suspend()` 与不可复用的 `dispose()`。AS 取消前清除待提交身份，
不会把取消误记为首屏成功；queriedIdentity 只在有效首屏成功提交时更新。`hasSession` 继续读取
最近一次 React 已呈现的行，不能替换为 controller 已结算但尚未呈现的数据。

## 5. 关键差异与已确认处理

1. **挂起后可见数据不一致**。WG 挂起把 `phase` 置为 `idle`，渲染只看 `phase === "ready"`
   （[WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L196)），因此旧数据虽未清空但不再展示；
   WP 保留七天桶与历史列表（[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L297)）；
   DP 保留 stats/sessions（[DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L333-L344)）；
   AS 保留 sessions（[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L222-L234)）。
   建模为 per-query 的 `preserveOnSuspend` 策略；WG 与其余三者在"挂起后是否仍可见旧数据"上产品表现不同。
   方案 A 保留这一现状，不在 A4a 统一。
2. **传输取消 vs 仅结果作废不一致**。WG/WP 用 `AbortController` 并传 `signal` 给 API
   （[WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L109-L111)、
   [WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L175-L178)）；
   DP/AS 只用数字请求 id、不传 `signal`（[DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L141-L149)、
   [List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L106)）。
   契约区分"结果作废"（硬语义）与"传输取消"（可选保留策略）；方案 A 保留当前 profile 的
   `abortTransport` 差异，不在 A4a 统一。
3. **分页防护等级不一致**。WP 有 limit 50、大小写不敏感去重、重复 cursor 检测、窗口校验
   （[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L135-L156)、
   [WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L267-L273)）；
   DP/AS 是原始 ID 精确去重且无 cursor 循环防护；AS 额外有 ended tombstone
   （[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L62)、
   [List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L204-L207)）。
   不应悄悄统一；方案 A 将其抽象为可配置 page policy 并保留四区块现状。
4. **查询粒度不同**。WG 单请求；WP 是 weekly→history 依赖链（weekly 成功后自动加载当日 history，更多页由按钮显式触发，[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L195-L229)）；
   DP 是聚合+列表并行后 more（[DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L141-L149)）；
   AS 是列表/更多与结束/恢复写操作互锁。data 层不能假设"一个 hook = 一个请求"，至少要有命名 slot 与阶段策略。
5. **AS 业务互锁**。列表刷新与更多页都实时读 store 的启动态，并在结束/恢复/启动在途时拒绝且不排队
   （[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L66-L72)、
   [List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L139-L151)）；
   结束/恢复通过同一 `ActiveSessionsRuntime` 的 `endInFlight`/`resumeInFlight` 互斥
   （[shared.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/shared.ts#L18-L23)）。
   该互斥应经 gate 注入 data 层，而非 data 层直接依赖 store。

6. **同 origin 重复触发处理不一致**。WG/WP/AS 在途时忽略重复触发、不排队
   （WG [WeeklyGrammar.tsx](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L105)、
   WP [WeeklyProgress.tsx](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L164)、
   AS [useActiveSessionList.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L89)）；
   DP 的 `fetchDailyData` 直接递增 `activeRequestIdRef` 重发、旧在途作废（最新覆盖）
   （[DailyProgress.tsx](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L130)）。
   应作为 per-query 去重策略保留，不写成所有 profile 强制合并。

7. **suspend/门禁关闭时旧错误清除与保留不一致**。WG suspend 置 `phase: "idle"`，其 error 是 phase 值之一、随之清除
   （[WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L137)）；WP suspend 把 `week`/`history`/`more` 三阶段置 `idle`，
   三阶段 error 随之清除（[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L297)）；DP suspend 清 `loadMoreError`
   但保留首屏 `error`（[DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L341)）；AS 列表 suspend 清 `loadMoreError`
   但保留列表首屏 `error`（[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L231)）。
   应建模为 per-query 的"错误清除/保留"策略，不写成统一硬约束。

**DP 并行 vs WP 依赖链**：DP 首屏用 `Promise.all` 并行聚合与列表、失败时整体进入错误态
（[DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L141-L149)、
[DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L182-L197)）；
WP 是 weekly 成功后释放自身槽位、再启动单日 history 的依赖链
（[WP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyProgress.tsx#L195-L229)）。
两者合并语义不同，须作为 Merge policy 分别建模，不能统一成"并发 all-or-nothing"或"串行链"。

**已确认处理**：用户确认方案 A。A4a 以 per-query profile 保留差异 1/2/3 的现状，不悄悄统一，
也不在 A4a 内改变产品行为；A4b～A4e 迁移时继续沿用对应 profile。

## 6. 自研 vs 封装现成库

推荐 A4a/A4b **自研一个最小的无共享缓存查询控制器，并把接口设计成策略注入、未来可替换实现**，暂不引入任何服务端状态库。

理由全部来自现有代码，不依赖对任何第三方库默认行为的核验（本稿未安装依赖、无网络访问，故**不**断言任何库的当前默认值）：

- 现有认证代际是"任意事件即递增全局 revision"（[auth.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/lib/auth.ts#L153-L177)），
  任何仅以 principal 为键的缓存都会在换号/重登时污染数据；四区块当前都是实例内状态、无共享 cache/refetch
  （[WG](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L44-L51)、
  [DP](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/learning/DailyProgress.tsx#L34-L54)）。
- 现有门禁是"`unknown`/`null` 视为未阻断"的显式语义（[webLifecycle.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/platform/webLifecycle.ts#L46-L59)），
  且四组件的重复触发、挂起、分页、tombstone 策略彼此不同；封装库时需先逐项核验并适配其缓存、
  重试与 focus/network 恢复等能力是否满足本契约，而不是默认其现成行为。
- 多个命名 slot、per-query 挂起策略、per-query 分页去重、AS 的 tombstone 与业务互锁，都超出"单 key 查询"的通用模型。

自研风险是范围膨胀，因此边界必须停在上述只读控制器：不新增全局缓存、不接管 mutation、不做 DevTools。若未来需要典型服务端状态能力，
可在同一契约测试下替换为库实现，而不是把库 API 泄漏给组件。

## 7. 用户可选方向

| 方向          | 内容                                                                         | 是否改变现行为                                                                                           |
| ------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **A（推荐）** | 自研最小只读控制器 + per-query profile，保留全部现行为；A4b 迁移时逐区块配置 | 否                                                                                                       |
| **B**         | 自研 + 统一部分策略（如统一 abort 传输、统一挂起清空、统一分页去重）         | 是，需额外回归相应组件                                                                                   |
| **C**         | 封装现成服务端状态库 + 外层 origin/gate/invalidation 适配器                  | 是，需先核验并适配其缓存、重试、focus/network 恢复等能力，使其符合本契约的 origin/gate/invalidation 语义 |
| **D**         | 只出契约测试，暂不实现任何控制器，把实现推迟到 A4b                           | 否，但 A4a 交付价值降低                                                                                  |

推荐 **A**：零行为变化、长期维护成本最低、后续可平滑替换；统一（B）或封装库（C）都需额外的行为变更与回归证明。

**用户已确认方向 A**，R1 按 A 落地为最小只读查询控制器与 hook，并保留四组 per-query profile
的差异化策略；未做方向 B/C 的行为统一，也未引入任何现成服务端状态库。

## 8. 契约测试矩阵（只读数据层，不依赖业务组件）

测试应使用注入式 auth source、lifecycle adapter、deferred fetcher、fake clock 与通用 hook harness，不 import 四个业务组件。
建议按 `single`、`primary+paged`、`parallel+paged`、`list+paged+external-gate` 四个 profile 覆盖。

| 类别         | 必测契约                                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin       | 未认证不请求且清空；issuer/subject 任一不同即换号；同 principal 新 revision 也重置；endDate/timezone/day window 变化重置；同 origin 重复触发按 profile：WG/WP/AS 在途忽略不排队，DP 递增代际重发（最新覆盖）                                            |
| Gate         | hidden/offline 初始不请求；`unknown`/`null` 允许；suspend/offline 作废在途；resume 仅 visible 且非 offline；connectivity 仅 online 且非 hidden；业务 gate 为 false（拒绝）时不发、不排队、静默 paused/idle 且不制造新错误，取消后需合格事件或显式 retry |
| Race         | 旧 success/error/finally 均不能写入新 origin 或释放新 slot（含"旧 finally 不能释放新 slot"专项）；新请求可在旧请求未完成时发起；unmount/StrictMode 后零写入；401 只失效原 revision，不误伤新登录                                                        |
| Pagination   | 首页重置、更多页追加；按配置去重；重复 cursor 按配置失败；窗口/状态校验按配置执行；more 失败保留 cursor 并允许显式重试；挂起按配置移除或保留 cursor                                                                                                     |
| Merge policy | WP 历史链式加载、DP 并行 all-or-nothing、AS 的 tombstone 均作为策略测试，不要求实现细节相同                                                                                                                                                             |
| Retry/error  | 显式 retry 重新过全部 gate；失败只产生 `http`/`parse`/`network` 本地安全分类；不出现 API body/message；各阶段错误不互相覆盖；门禁关闭不制造新错误；各阶段旧错误清除/保留按 profile（WG/WP 清空、DP/AS 清 loadMoreError 保留首屏 error）                 |
| Time         | 本地午夜/时区变化立即清旧 context；offline 跨午夜不发网络；恢复后按新 context 请求；可选分钟检查仅在 context 变化时 refresh                                                                                                                             |
| AS profile   | 启动/结束/恢复互锁列表与更多页；结束成功后的 tombstone 阻止旧页复活；挂起不释放写操作槽位；事件里的启动判断按已保留的待裁定行为单独标注                                                                                                                 |

## 9. 未决问题（独立，不在 A4a 内裁定）

- **AS 生命周期事件里的"启动在途"取挂载时快照**：`useActiveSessionsLifecycle` 用 `isStartingAtMountRef`
  （[useActiveSessionsLifecycle.ts](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionsLifecycle.ts#L47-L49)），
  订阅期间不更新；列表刷新本身实时读 store（[List](https://github.com/sunpcm/EchoTalk/blob/a7841b7486b14af01e535e5e3f4e0472c621d198/apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L69)）。
  影响限于 resume/connectivity 事件是否触发刷新。该问题已列入 [TODO.md](../TODO.md)
  「2026-11-10 云端评审后续（R2）」的"待用户裁定：活动会话订阅里的启动在途取值"项；本稿不修，
  也不把它规范成永久正确行为，留给后续业务问题单独裁定。
- 差异点 1/2/3（挂起可见数据、abort 传输、分页统一）按 §5/§7 的方案 A 保留现状，不再请求
  A4a 确认；未来是否统一属于后续独立范围。

## 10. 分层依赖工程门禁（A6）

根 `eslint.config.js` 的 `echotalk/no-cross-layer-imports` 为 error：
`platform` 不得依赖 `lib/store/components`，`lib` 不得依赖 `store/components`，
`data` 不得依赖 `components`；不增加其他禁止方向或豁免。规则覆盖别名和规范化相对路径，
包括类型导入/重导出、动态静态字面量及 import 类型；未知运行时表达式不猜测目标。

用户清理编排位于 `store/user-state.ts`，由 AuthGate 调用；顺序仍为诊断清理、goHome、
settings.reset、assessment.reset，不引入 reset registry/bus。验收及限制见 PR #155。
