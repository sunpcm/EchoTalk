# 前端 Data 层契约设计（A4a）

> 状态：**实施已冻结，整卡保持在 Review**。方案 A 已获用户确认；最小只读查询控制器
> （`apps/vite-app/src/data/readonly-query.ts`）、React hook
> （`apps/vite-app/src/data/use-readonly-query.ts`）与四个不依赖业务组件的契约测试文件
> （17+15+8+4 项，共 44 项）均已落地；阶段 3 允许范围实施自查为 4 文件 44/44 通过。
> 主控独立 Review 与完整质量门禁结果以 PR #142 绑定最终 head 的回执为准。四个业务组件尚未迁移，
> A4a 尚未集成：本状态不代表"已集成"或自批，仍保留下方 §5/§9 的全部未决行为差异与业务问题。

## 1. 范围与前提

本文档是 A4a（前端 data 层契约与契约测试）的契约与实施记录，目标是把四个现有数据区块
（`WeeklyGrammar`、`WeeklyProgress`、`DailyProgress`、`ActiveSessions`）的**实际行为**、
已落地的**只读 data 层接口边界**与一组**不依赖具体组件的契约测试矩阵**写成可审阅记录。
任务以 [TODO.md](../TODO.md)「架构演进工作包（阶段 A / B）」为准；[PR #138](https://github.com/sunpcm/EchoTalk/pull/138) 是引入该规划的来源。

- 语义以现有代码为准，逐条落到代码行；差异之处列明并交用户裁定。
- data 层的目标结构与"契约先于实现"原则见 [ARCHITECTURE_ROADMAP.md](../docs/ARCHITECTURE_ROADMAP.md#L35-L57) §3.1。
- 本文只定义"读"路径；变更（end/resume）、Cloud 门禁、会话 store 状态机、API URL/解析、
  组件渲染、i18n 均不在 data 层职责内。
- A4a 不引入新依赖、不迁移任何组件；本轮新增四个 `apps/vite-app/src/data/` 下的契约测试文件。

## 2. 认证与生命周期基线

- **principal**：`issuer + subject` 精确相等，见 [auth.ts](../apps/vite-app/src/lib/auth.ts#L5-L8)、
  [auth.ts](../apps/vite-app/src/lib/auth.ts#L111-L115)；subject 只做 trim 非空校验、不归一化，
  见 [auth.ts](../apps/vite-app/src/lib/auth.ts#L126-L139)。
- **revision**：全局单调递增，任何认证事件发布都 `currentRevision += 1`，
  见 [auth.ts](../apps/vite-app/src/lib/auth.ts#L153-L177)；读取入口见
  [auth.ts](../apps/vite-app/src/lib/auth.ts#L179-L185)。
- **请求绑定**：API 请求发起时捕获 `reqRevision`，取 token 前后各校验一次；401 只
  `invalidateAuthSession(reqRevision)` 失效请求绑定代际，见 [api.ts](../apps/vite-app/src/lib/api.ts#L56-L61)、
  [api.ts](../apps/vite-app/src/lib/api.ts#L87-L91)。
- **hidden/offline 门禁**：`visibility !== "hidden" && online !== false` 才允许读，这是四组件的实际判定——
  WG [WeeklyGrammar.tsx](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L64-L67)、
  WP [WeeklyProgress.tsx](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L95-L98)、
  DP [DailyProgress.tsx](../apps/vite-app/src/components/learning/DailyProgress.tsx#L120-L126)、
  AS [shared.ts](../apps/vite-app/src/components/conversation/active-sessions/shared.ts#L74-L79)（`isLifecycleBlocked`）。
  `unknown`/`null` 的归一化只发生在 [webLifecycle.ts](../apps/vite-app/src/platform/webLifecycle.ts#L46-L59)
  的 `resolveVisibility`/`resolveOnline`，本身不是门禁判断；data 层须复用这一 snapshot 语义，不得自造门禁。

## 3. 四区块实际语义矩阵

缩写：WG=WeeklyGrammar、WP=WeeklyProgress、DP=DailyProgress、AS=ActiveSessions（列表 + 结束/恢复 + 生命周期订阅）。

| 维度                       | WG                                                                                                                                                                                                                | WP                                                                                                                                                                                                                                                                     | DP                                                                                                                                                                                          | AS                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| origin 与 context          | principal+revision+endDate+timezone [WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L22-L27)                                                                                                      | 同左，origin 变化使 week/history/more 全失效 [WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L32-L37)                                                                                                                                                 | 首屏捕获 snapshot/revision + 本地日窗口，窗口另存 windowRef [DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L78-L83)                                                        | 发起时捕获 principal+revision，结算再读当前 [shared.ts](../apps/vite-app/src/components/conversation/active-sessions/shared.ts#L40-L46)、[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L75)                                                                           |
| hidden/offline             | 初始 paused 不请求；suspend abort + idle + paused [WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L64-L67)、[WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L133-L146)            | 不请求；suspend 作废 week/history/more、清 cursor，保留 days/items [WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L293-L306)                                                                                                                         | 不发；suspend 作废在途、退 loading、清 cursor，保留 stats/sessions [DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L328-L344)                                               | 不发；suspend 作废 list/more、清 cursor，保留 sessions [shared.ts](../apps/vite-app/src/components/conversation/active-sessions/shared.ts#L74-L79)、[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L222-L234)                                                          |
| 迟到 success/error/finally | 单 slot + AbortController；disposed/slot/origin/gate 不写回 [WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L93-L100)、[WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L112-L125) | 三独立 slot，各自 finally 只在 slot 匹配时释放 [WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L125-L133)、[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L179-L192)                                                                | 数字请求 id；success/error/finally 均校验 mounted+id+principal+revision [DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L150-L215)                                          | 数字请求 id；isRequestCurrent 校验 mounted+id+身份 [shared.ts](../apps/vite-app/src/components/conversation/active-sessions/shared.ts#L61-L68)、[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L107-L136)                                                              |
| auth 清空重查              | origin 变化 abort + 清 view，订阅后重查 [WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L85-L92)、[WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L129-L132)                      | principal/revision/日窗口/时区变化全失效清空 [WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L289-L292)                                                                                                                                               | 未认证清空；principal 或 revision 变化递增两代际、清空重查 [DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L360-L408)                                                       | 未认证或代际变化 reset end/resume/list、清 tombstone+cursor，authenticated 代际变化后重查 [Lifecycle](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionsLifecycle.ts#L104-L127)、[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L250-L257) |
| 分页与去重                 | 无分页                                                                                                                                                                                                            | limit 50、completed+窗口校验、大小写不敏感去重、重复 cursor 检测 [WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L135-L156)、[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L248-L286)                                              | 原始 ID 精确去重、无 cursor 循环防护 [DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L169-L178)、[DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L267-L278) | 原始 ID 精确去重 + ended tombstone 防旧响应复活；无 cursor 循环防护 [List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L111-L118)、[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L204-L207)                                  |
| 显式重试 / 本地错误        | 固定文案 + refresh [WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L120-L122)、[WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L188-L195)                                         | week/history/more 各阶段独立重试 [WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L349-L356)、[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L388-L399)、[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L419-L432) | 首屏 retry 重发并行请求；more 失败保留 cursor 同按钮重试 [DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L460-L473)                                                         | 列表/更多显式重试，仍过 auth/lifecycle/互锁 [ActiveSessions.tsx](../apps/vite-app/src/components/conversation/ActiveSessions.tsx#L90-L105)、[ActiveSessions.tsx](../apps/vite-app/src/components/conversation/ActiveSessions.tsx#L192-L214)                                                                         |
| 错误不回显                 | 异常只置错误态 + 固定文案 [zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L155)                                                                                                                                     | 三阶段本地文案 [zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L135)、[zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L138)、[zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L144)                                                                                           | 布尔错误 + 固定文案 [zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L119)、[zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L123)                                                                | 列表/更多只布尔错误；end/resume 也不回显正文 [zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L182)、[zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L195)、[zh-CN.ts](../apps/vite-app/src/i18n/zh-CN.ts#L202)                                                                                                          |

## 4. 只读 data 层边界

A4a 已定义一个最小的"只读查询控制器"，而不是完整服务端状态框架。核心是策略注入，把现有四组行为建模为可配置 profile，未来可替换实现。

- **Origin**：同步捕获 `principal + revision + query context`。WG/WP 的 context 是 `endDate+timezone`，
  DP 是本地日 `[start,end)`，AS 为空。origin 变化即清空并按资格重查。
- **Read gate**：统一消费 lifecycle snapshot，并允许调用方注入额外业务 gate（`true` = 允许读，`false` = 拒绝且不排队）。
  options 更新会立即重新评估当前 gate；关闭时作废在途请求、按 profile 退出 loading 与处理可见数据/首屏错误。
  状态已稳定时同义 options 重建保持幂等。gate 重开本身不排队、不自动请求，需显式 retry 或合格生命周期事件。
  AS 的结束/恢复/启动互锁应经 gate 注入，data 层不得依赖 conversation store。
- **Operation slots**：每个控制器实例只提供固定的 primary 与 more 两个请求槽，不承诺任意命名槽。
  旧 success/error/finally 均不得写回新代际或释放同槽的新请求。WP 以两个控制器的组合实现
  weekly→history：只有 current weekly 经 `phase: "ready"` 提交后才启动 history，旧 weekly 晚到不会
  启动跨代 history。DP 的双路 HTTP 请求由单个 fetcher 内部 `Promise.all` 聚合成一个
  `Page<{stats,items}>`，控制器仍只管理 primary/more。AS 使用控制器 primary/more，外部 mutation gate
  与 `removeItem` tombstone 由组合层注入/调用。
- **Page policy**：由查询声明首页重置、ID key、dedupe key、重复 cursor 检测与整页校验。
  tombstone 不是 `PagePolicy` 配置项；AS 组合层在结束成功后调用 `removeItem(key)`，控制器内部记录
  removed key，并在 origin/revision 变化时清空，避免旧页复活或新账号同 ID 被误删。
- **Suspend policy**：由查询声明挂起时保留或退出可见数据、是否保留首屏错误；默认不新增错误。
  lifecycle `suspend()` 与 hidden/offline 门禁清 cursor；后者的 `refresh`、`loadMore`、`updateOptions`
  直接命中路径遵循同一语义。额外业务 gate 拒绝只按 profile 处理数据/错误并保留 cursor。各入口均将
  more 退出 loading、清 more 错误，不合并业务 gate 与 lifecycle 环境的 cursor 语义。
- **Retry**：只显式重试；lifecycle/auth 触发的是重新 reconcile，不是自动循环重试；重试重新读取当前 origin 与 gate。
- **Error**：只返回本地安全错误分类（`http`/`parse`/`network`），不透出服务端正文；文案由组件经 i18n 映射。
  fetcher 的同步 throw 与 Promise reject 进入同一错误边界；primary/more 均释放自身锁，more 保留 cursor
  供显式重试，错误分类器仍可检查原始抛出对象。
  门禁关闭（hidden/offline/业务 gate 拒绝）不是错误，而是静默 `paused`/`idle`（WG/WP）或不发起并退 loading（DP/AS）：
  不制造新错误；各阶段旧错误的清除/保留按 profile 原样保留（见 §5 差异 7）；可见数据是否保留按 per-query `preserveOnSuspend` 区分。
- **Transport cancellation**：控制器可创建 cancellation token；各 query fetcher 决定是否传给 API，以保留
  WG/WP（abort 传输）与 DP/AS（仅结果作废）的现状。
- **不负责**：API URL/解析、组件渲染、i18n、结束/恢复业务流、Cloud 门禁、会话 store 状态机、任何共享缓存。

以下为方案确认前的设计草图，只用于说明设计演进，不是当前签名：

> 用户已确认方向 A（自研最小只读控制器 + per-query profile）。实际签名以
> `apps/vite-app/src/data/readonly-query.ts` / `use-readonly-query.ts` 为准；草图里的
> `ReadOnlyQueryController.query()`、`retryOnError`、任意命名槽和 profile 内 tombstone
> 均不是当前实现。控制器接收注入式认证/生命周期 source；clock/scheduler 是 hook 的可选宿主适配入口。

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
  page?: PagePolicy<C, D>;
  preserveOnSuspend?: boolean; // WG=false（phase 隐藏）、WP/DP/AS=true
  abortTransport?: boolean; // WG/WP=true、DP/AS=false
  retryOnError?: "explicit"; // 只允许显式重试，不自动循环
}

interface PagePolicy<C, D> {
  resetOnFirstPage: boolean;
  keyOf(item: D): string;
  dedupeKey?(item: D): string; // WP=toLowerCase，DP/AS=原始 id
  detectRepeatedCursor?: boolean; // WP=true，DP/AS=false
  validatePage?(page: D[], ctx: C): void; // WP=completed+窗口校验
  tombstone?: Set<string>; // AS=endedSessionIds
}

interface QueryHandle<D> {
  refresh(): void; // 重新读取当前 origin 与 gate
  loadMore?(): void;
  retry(): void;
  dispose(): void;
}

interface ReadOnlyQueryController {
  query<C, D>(profile: QueryProfile<C, D>, fetcher: Fetcher<C, D>): QueryHandle<D>;
}
```

当前实现的关键签名如下；本节代码以源码为准：

```ts
interface QueryProfile<C, D> {
  resolveContext(): ContextResolution<C>;
  gate?(snapshot: WebLifecycleSnapshot): boolean;
  sameContext?(a: C, b: C): boolean;
  nextContextChange?(now: number): number | null;
  resetOnFirstPage?: boolean;
  preserveOnSuspend?: boolean;
  clearPrimaryErrorOnSuspend?: boolean;
  abortTransport?: boolean;
  concurrent?: "ignore" | "override";
  page?: PagePolicy<C, D>;
}

interface PagePolicy<C, D> {
  keyOf(item: D): string;
  dedupeKey?(item: D): string;
  detectRepeatedCursor?: boolean;
  validatePage?(items: D[], context: C): void;
}

type Fetcher<C, D> = (
  context: C,
  options: { signal?: AbortSignal | null; cursor?: string | null },
) => Promise<Page<D>>;

interface ReadQuerySource {
  getPrincipal(): AuthPrincipal | null;
  getRevision(): number;
  getLifecycle(): WebLifecycleSnapshot;
  classifyError?(error: unknown): ReadErrorKind | undefined;
}

interface UseReadOnlyQueryOptions<C, D> {
  profile: QueryProfile<C, D>;
  fetcher: Fetcher<C, D>;
  classifyError?(error: unknown): ReadErrorKind;
  clock?: () => number;
  scheduler?: ReadOnlyQueryScheduler;
}

interface ReadOnlyQueryScheduler {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}
```

`createReadQuery(profile, fetcher, source, onChange)` 暴露 `refresh/loadMore/retry/removeItem/dispose`、
显式 `updateOptions()`、`reconcile()/suspend()/resume()/getState()`。hook 为 clock/scheduler 提供上述
可选入口；缺省时分别使用 `Date.now` 与 `window.setTimeout/window.clearTimeout`，因此生产默认行为不变。

该控制器持有实例内状态、不共享缓存；`Fetcher` 决定是否把 cancellation token 传给 API。
错误统一映射为 `http`/`parse`/`network` 的本地分类，不携带服务端正文；门禁关闭不属于错误分类。

## 5. 关键差异与用户裁定

1. **挂起后可见数据不一致**。WG 挂起把 `phase` 置为 `idle`，渲染只看 `phase === "ready"`
   （[WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L196)），因此旧数据虽未清空但不再展示；
   WP 保留七天桶与历史列表（[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L297)）；
   DP 保留 stats/sessions（[DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L333-L344)）；
   AS 保留 sessions（[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L222-L234)）。
   建议建模为 per-query 的 `preserveOnSuspend` 策略；WG 与其余三者在"挂起后是否仍可见旧数据"上产品表现不同，
   若要统一，需用户裁定。
2. **传输取消 vs 仅结果作废不一致**。WG/WP 用 `AbortController` 并传 `signal` 给 API
   （[WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L109-L111)、
   [WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L175-L178)）；
   DP/AS 只用数字请求 id、不传 `signal`（[DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L141-L149)、
   [List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L106)）。
   契约应先区分"结果作废"（硬语义）与"传输取消"（可选保留策略）；是否统一 abort 由用户另行决定。
3. **分页防护等级不一致**。WP 有 limit 50、大小写不敏感去重、重复 cursor 检测、窗口校验
   （[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L135-L156)、
   [WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L267-L273)）；
   DP/AS 是原始 ID 精确去重且无 cursor 循环防护；AS 额外有 ended tombstone
   （[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L62)、
   [List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L204-L207)）。
   不应悄悄统一，先抽象为可配置 page policy。
4. **查询粒度不同**。WG 单请求；WP 是 weekly→history 依赖链（weekly 成功后自动加载当日 history，更多页由按钮显式触发，[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L195-L229)）；
   DP 是聚合+列表并行后 more（[DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L141-L149)）；
   AS 是列表/更多与结束/恢复写操作互锁。通用控制器只负责 primary/more，不假设"一个 hook = 一个
   请求"；WP 的跨查询依赖、DP 的双请求聚合、AS 的外部 mutation gate 由组合层实现。
5. **AS 业务互锁**。列表刷新与更多页都实时读 store 的启动态，并在结束/恢复/启动在途时拒绝且不排队
   （[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L66-L72)、
   [List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L139-L151)）；
   结束/恢复通过同一 `ActiveSessionsRuntime` 的 `endInFlight`/`resumeInFlight` 互斥
   （[shared.ts](../apps/vite-app/src/components/conversation/active-sessions/shared.ts#L18-L23)）。
   该互斥应经 gate 注入 data 层，而非 data 层直接依赖 store。

6. **同 origin 重复触发处理不一致**。WG/WP/AS 在途时忽略重复触发、不排队
   （WG [WeeklyGrammar.tsx](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L105)、
   WP [WeeklyProgress.tsx](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L164)、
   AS [useActiveSessionList.ts](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L89)）；
   DP 的 `fetchDailyData` 直接递增 `activeRequestIdRef` 重发、旧在途作废（最新覆盖）
   （[DailyProgress.tsx](../apps/vite-app/src/components/learning/DailyProgress.tsx#L130)）。
   应作为 per-query 去重策略保留，不写成所有 profile 强制合并。

7. **suspend/门禁关闭时旧错误清除与保留不一致**。WG suspend 置 `phase: "idle"`，其 error 是 phase 值之一、随之清除
   （[WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L137)）；WP suspend 把 `week`/`history`/`more` 三阶段置 `idle`，
   三阶段 error 随之清除（[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L297)）；DP suspend 清 `loadMoreError`
   但保留首屏 `error`（[DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L341)）；AS 列表 suspend 清 `loadMoreError`
   但保留列表首屏 `error`（[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L231)）。
   应建模为 per-query 的"错误清除/保留"策略，不写成统一硬约束。
   当前控制器让 lifecycle suspend、hidden/offline 门禁与业务门禁暂停都套用 `preserveOnSuspend` /
   `clearPrimaryErrorOnSuspend`；lifecycle suspend 及 hidden/offline 直接阻断清 cursor，额外业务
   gate 拒绝保留 cursor。

**DP 并行 vs WP 依赖链**：DP 首屏用 `Promise.all` 并行聚合与列表、失败时整体进入错误态
（[DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L141-L149)、
[DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L182-L197)）；
WP 是 weekly 成功后释放自身槽位、再启动单日 history 的依赖链
（[WP](../apps/vite-app/src/components/learning/WeeklyProgress.tsx#L195-L229)）。
两者合并语义不同，须作为 Merge policy 分别建模，不能统一成"并发 all-or-nothing"或"串行链"。

**推荐**：先以 per-query profile 保留现行为，不悄悄统一；差异点 1/2/3 是否统一，交由用户逐项裁定。

## 6. 自研 vs 封装现成库

推荐 A4a/A4b **自研一个最小的无共享缓存查询控制器，并把接口设计成策略注入、未来可替换实现**，暂不引入任何服务端状态库。

理由全部来自现有代码；本节未通过新增依赖或网络核验第三方库默认行为，因此**不**断言任何库的当前默认值：

- 现有认证代际是"任意事件即递增全局 revision"（[auth.ts](../apps/vite-app/src/lib/auth.ts#L153-L177)），
  任何仅以 principal 为键的缓存都会在换号/重登时污染数据；四区块当前都是实例内状态、无共享 cache/refetch
  （[WG](../apps/vite-app/src/components/learning/WeeklyGrammar.tsx#L44-L51)、
  [DP](../apps/vite-app/src/components/learning/DailyProgress.tsx#L34-L54)）。
- 现有门禁是"`unknown`/`null` 视为未阻断"的显式语义（[webLifecycle.ts](../apps/vite-app/src/platform/webLifecycle.ts#L46-L59)），
  且四组件的重复触发、挂起、分页、tombstone 策略彼此不同；封装库时需先逐项核验并适配其缓存、
  重试与 focus/network 恢复等能力是否满足本契约，而不是默认其现成行为。
- 跨控制器依赖、双请求聚合、per-query 挂起策略、per-query 分页去重、AS 的 tombstone 与业务互锁，
  都超出"单 key 查询"的通用模型。

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

## 8. 契约测试矩阵

当前四个契约测试文件共 44 项（17+15+8+4），使用注入式 auth source、lifecycle adapter、deferred fetcher、
可选 clock/scheduler 与通用 hook harness，不 import 四个业务组件；同时保留既有 fake-timer
跨午夜测试。应按 `single`、`primary+paged`、`parallel+paged`、`list+paged+external-gate`
四类组合覆盖。

| 类别         | 必测契约                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin       | 未认证不请求且清空；issuer/subject 任一不同即换号；同 principal 新 revision 也重置；endDate/timezone/day window 变化重置；同 origin 重复触发按 profile：WG/WP/AS 在途忽略不排队，DP 递增代际重发（最新覆盖）                                                                                                                                                                                                                                         |
| Gate         | hidden/offline 初始不请求；`unknown`/`null` 允许；suspend/offline 作废在途并清 cursor；`refresh`、`loadMore`、`updateOptions` 直接遇 hidden/offline 同样清 cursor；resume 仅 visible 且非 offline；connectivity 仅 online 且非 hidden；业务 gate 为 false（拒绝）及 options 更新关闭业务 gate 时立即作废在途、按 profile 退 loading/处理数据与首屏错误、保留 cursor、不排队；重开不自发请求，需合格事件或显式 retry；同义 options 重建不重发、不循环 |
| Race         | 旧 success/error/finally 均不能写入新 origin 或释放新 slot（含"旧 finally 不能释放新 slot"专项）；新请求可在旧请求未完成时发起；unmount/StrictMode 后零写入；401 只失效原 revision，不误伤新登录                                                                                                                                                                                                                                                     |
| Pagination   | 首页重置、更多页追加；按配置去重；重复 cursor 按配置且先校验整页再提交；窗口/状态校验按配置执行；more 失败保留 cursor 并允许显式重试；lifecycle suspend 及 hidden/offline 直接门禁清 cursor，额外业务 gate 暂停保留 cursor                                                                                                                                                                                                                           |
| Merge policy | WP 用两个控制器组合，仅 current weekly 提交为 ready 后启动 history，旧 weekly 晚到不启动跨代 history；DP fetcher 内部 `Promise.all`，双路成功才提交合成 Page，单路失败不写部分结果；AS 由组合层外部 gate 与 `removeItem` tombstone 隔离 mutation/list 行为                                                                                                                                                                                           |
| Retry/error  | 显式 retry 重新过全部 gate；同步 throw 与异步 reject 均只产生 `http`/`parse`/`network` 本地安全分类并释放对应锁；不出现 API body/message；各阶段错误不互相覆盖；门禁关闭不制造新错误；各阶段旧错误清除/保留按 profile（WG/WP 清空、DP/AS 清 loadMoreError 保留首屏 error）                                                                                                                                                                           |
| Time         | 本地午夜/时区变化立即清旧 context；离线跨午夜不发网络；恢复后按新 context 请求；注入 clock/scheduler 验证 context 检查、重排与卸载清理，同时保留 fake-timer 路径                                                                                                                                                                                                                                                                                     |
| AS profile   | 启动/结束/恢复的外部 mutation gate 同时拦 list 与 more；结束成功后的 `removeItem` tombstone 阻止旧页复活且不跨 origin；mutation 关闭时 suspend 不越权释放外部写槽；事件里的启动判断按已保留的待裁定行为单独标注                                                                                                                                                                                                                                      |

## 9. 未决问题（独立，不在 A4a 内裁定）

- **AS 生命周期事件里的"启动在途"取挂载时快照**：`useActiveSessionsLifecycle` 用 `isStartingAtMountRef`
  （[useActiveSessionsLifecycle.ts](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionsLifecycle.ts#L47-L49)），
  订阅期间不更新；列表刷新本身实时读 store（[List](../apps/vite-app/src/components/conversation/active-sessions/useActiveSessionList.ts#L69)）。
  影响限于 resume/connectivity 事件是否触发刷新。该问题已列入 [TODO.md](../TODO.md)
  「2026-11-10 云端评审后续（R2）」的"待用户裁定：活动会话订阅里的启动在途取值"项，本稿不修、也不把它规范成永久正确行为。
- 差异点 1/2/3（挂起可见数据、abort 传输、分页统一）是否统一，见 §5/§7，需用户逐项确认。
