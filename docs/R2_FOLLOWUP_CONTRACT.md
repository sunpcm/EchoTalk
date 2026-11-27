# R2 活动会话生命周期与显示合同

> 状态：**DEC-A 设计已确认；R2-LIVE 本地实施 FINAL_READY；R2-UI 本地实施 FINAL_READY**。
> 确认日期：2026-11-15；确认范围：R2 推荐 A 与 SGEC 推荐 A。
> 设计基线：`codex/B1-learning-events-20261112@0aae655928cf046482627830aee9df6cb7fc1fc1`。
> 本文件只写已确认合同，不改代码、测试、API、数据库、依赖或服务。

## 1. 范围与权威

来源为 [TODO.md](../TODO.md) 的 R2 待办与 2026-11-15 已确认草案。此前 A4a 只记录了当时行为，
不能把“生命周期事件读取挂载时快照”解释成永久正确合同。现行实现事实以源码为准，目标行为以本文件
以及 [FRONTEND_DATA_LAYER_CONTRACT.md](./FRONTEND_DATA_LAYER_CONTRACT.md) §8/§9 的后续回写为准。

本范围只包含：

1. 活动会话在 `resume` 或 `connectivity` 生命周期事件到来时的启动/恢复/结束门禁。
2. 设置抽屉的共享标题。
3. 活动记录行及结束/恢复确认面板中的会话目标展示。

第 1 项单独形成 **R2-LIVE** 实施卡，第 2、3 项单独形成 **R2-UI** 实施卡。两卡各自 Review，
顺序为先 R2-LIVE、后 R2-UI。

## 2. 设计基线下的实现事实（历史基线）

以下事实绑定 `0aae6559` 设计基线；R2-LIVE 的最终实施状态以 §5.1 的 FINAL_READY 时点为准。

- `useActiveSessionsLifecycle` 用 `isStartingAtMountRef` 保存挂载时值，订阅期间不更新。
- 列表请求由 data 层实时读取同一 conversation store 的当前启动状态，并在结束/恢复/启动门禁
  命中时拒绝且不排队。
- 生命周期事件目前受 `runtime.endInFlight`、`runtime.resumeInFlight` 与挂载时启动快照共同阻断。
  因此如果挂载时快照为真，旧 `true` 会在整个订阅存续期间持续抑制本来合格的事件；只有重新挂载
  才会重新读取启动状态。
- `SessionRow` 当前直接显示 `session.id`，并把完整 ID 放入 `title`。
- `ConfirmPanel` 当前也直接显示 `sessionId`；结束与恢复面板分别通过
  `confirm-session-id-*`、`confirm-resume-session-id-*` 暴露内部测试定位。
- 中文资源中的设置标题当前为“自定义模型设置”。

## 3. R2-LIVE 行为合同

### 3.1 事件时读取真实状态

`resume` 与 `connectivity` 回调在**事件发生时**从同一个 conversation store 读取当前
`isStarting`，不得继续使用挂载时的布尔快照，也不得另建第二份会话状态。列表自身的实时 gate 仍是
最终防线；两边读取的必须是同一物理 store。

### 3.2 在途不请求、不排队

事件到达时，若当前启动状态为真，或 `endInFlight`/`resumeInFlight` 为真，则不发起活动会话列表
HTTP 请求，也不登记任何延迟任务、重放标记或回调队列。

| 事件时状态               | `resume`       | `connectivity` | 退出在途后的行为 |
| ------------------------ | -------------- | -------------- | ---------------- |
| 当前启动为真             | 不请求、不排队 | 不请求、不排队 | 不自动补发       |
| 结束在途                 | 不请求、不排队 | 不请求、不排队 | 不自动补发       |
| 恢复在途                 | 不请求、不排队 | 不请求、不排队 | 不自动补发       |
| 已空闲且事件自身资格满足 | 只读刷新一次   | 只读刷新一次   | 不适用           |

“退出在途”本身不是触发源。只有此后新到来的、自身 snapshot 资格满足的 `resume` 或
`connectivity` 事件才可以发起下一次只读刷新。`resume` 仍要求 `visibility === "visible"` 且
`online !== false`；`connectivity` 仍要求 `online === true` 且 `visibility !== "hidden"`。

### 3.3 双向状态转换

必须覆盖以下两种方向：

1. **启动在途 → 空闲**：挂载时或上一次事件时正在启动，随后变为空闲；下一次合格事件必须读取
   列表并呈现服务端当前行，修复旧挂载快照导致的漏刷新。
2. **空闲 → 启动在途**：事件到达时正在启动；不得请求或排队。之后变为空闲时也不得自动刷新，
   下一次独立合格事件才可请求。

事件触发的刷新使用当前认证主体与 revision，并继续执行 data 层现有的 hidden/offline、业务 gate、
请求归属与重复触发策略。挂载、StrictMode replay、卸载或认证变化产生的旧 success/error/finally
仍不得写回或释放新槽位。

### 3.4 既有安全语义不变

R2-LIVE 不改变：

- `auth`、principal、revision 的发起与结算校验；
- hidden/offline 不请求及 suspend 作废在途的语义；
- 请求晚到结果、旧 finally 与新 slot 的隔离；
- 首页替换、分页 cursor、more 请求槽位和 ended tombstone；
- 结束/恢复写操作槽位、失败重试、取消和 unmount 收束；
- 同一 origin 在途重复触发的既有 `ignore` 策略。

## 4. R2-UI 显示合同

### 4.1 设置标题

共享设置抽屉入口和对话框的用户可见名称统一为“设置”。模型提供商、密钥、主题、诊断、权限或
保存行为不变；只调整现有语言资源以及依赖该名称的内部测试/E2E 断言。

### 4.2 活动记录行

活动记录行用现有模式标签与开始时间区分记录：

- 用户可见正文不显示完整 UUID；
- 不把完整 UUID 放入 `title`；
- 按钮、行或容器最终计算出的可访问名称不得包含完整 UUID；
- `aria-labelledby` 等内部 IDREF 是关联机制，不等同于可见文本；引用机制本身不受限，被引用文本
  仍须满足可见正文与最终可访问名称约束；
- 完整 ID 继续作为 React `key`、API 参数、写操作目标、精确状态归属和稳定的
  `data-testid` 内部定位值；
- 不新增复制按钮，不新增请求，也不为展示引入新模式或时间格式。

### 4.3 结束/恢复确认面板

展开的 `ConfirmPanel` 必须继续明确指向同一活动记录，但用户可见目标改为该记录现有的模式标签与
开始时间，并同时满足：

- 不使用“目标ID:”加完整 UUID 的正文；
- 不把完整 ID 放入 `title`，且面板及相关控件的最终可访问名称不得包含完整 ID；
- 内部 `aria-labelledby` IDREF 可以继续用作合法关联；它本身不是可访问名称或可见文本，其指向的
  文本仍不得包含完整 ID；
- 完整 ID 只保留在内部 `data-testid`、React key、API 路径/参数与目标归属比较中；
- 结束、恢复、取消、失败、重试、busy 和互锁状态继续绑定原 session ID；
- 迟到的结束/恢复回调不得因展示值相同而错误归属到另一条记录。

显示组合必须复用现成的 `resolveModeLabel` 与 `formatStartedAt` 行为，不额外请求数据。完整 UUID
只用于内部用途，确认面板不能豁免。

## 5. 实施卡与可观察验收

### 5.1 R2-LIVE

预期触及 `useActiveSessionsLifecycle.ts` 及 `ActiveSessions.test.tsx` 或同职责行为测试；实际写集以
该卡任务说明为准。先写有效 RED，再写最小修复。

原时点实施状态为 **FINAL_READY（2026-11-15，本地实现）**；当前功能与实施进度只看根目录
[TODO 总账](../TODO.md)。有效 TDD 链
`2 failed / 1 passed → 3 passed → 2 failed / 1 passed`、修正后的新测试 `3 passed / exit 0`
且无 `act` 警告，以及两项有效私有变异均由主控新鲜执行。完整数字、保护文件与边界集中于
[归档 PROJECT_STATUS 的 R2-LIVE 小节](./archive/2026-11-21-document-consolidation/PROJECT_STATUS.md#r2-live-活动会话生命周期实时门禁final_ready)，
本文件不重复。最小实现只在生命周期事件发生时读取同一 conversation store，并复用
`isStartingConversationSession`；未改 data/auth/store/platform 或新增订阅。

本轮 GO 只指本地实现与门禁；生产、真实 Provider/IdP/LiveKit、设备与部署从未获授权。独立技术
Review、最终文档 format、提交和推送以主控同卡回执为准；用户 Review 待。本状态不能自行写成
APPROVED 或已获用户批准。

两个生命周期事件各自至少验证：

1. 挂载时启动在途，随后空闲；事件到达后发生一次真实可观察的 HTTP GET，页面出现对应服务端行。
2. 事件到达时启动在途，不发生 HTTP GET；退出在途本身仍不发生 GET。
3. 结束/恢复在途时不发生 GET；清除在途后不发生自动补发，下一次合格事件才发生一次 GET。
4. 上述场景保留认证 revision、hidden/offline、分页、tombstone、卸载/StrictMode 与写槽位归属。

测试以 fake HTTP、实际 store 与渲染行/分页结果为证据，不以源码扫描、内部函数调用次数代替行为
验证。`resume` 和 `connectivity` 必须分别覆盖，不能只测一个事件来推断另一个。

### 5.2 R2-UI

预期触及 `ActiveSessions.tsx`、`activeSessions/ConfirmPanel.tsx`、
`activeSessions/SessionRow.tsx`、`i18n/zh-CN.ts` 及既有 Vitest/E2E 断言；实际写集以该卡任务说明
为准。测试同时覆盖行、结束确认和恢复确认：

- 设置入口、dialog 标题与 heading 的可访问名称是“设置”；
- 行与两个确认面板显示模式与开始时间；
- 完整 UUID 不出现在可见正文、`title` 或可访问名称；
- 稳定 `data-testid` 仍可精确定位原记录；
- 确认、取消、失败、重试、busy、互锁和目标归属断言不削减。

R2-LIVE 已按先有效 RED、再最小实现、完整三测试树与私有变异完成本地合同。R2-UI 当前为
**FINAL_READY（2026-11-15，本地实现）**：四个生产文件只完成显示/props 最小实现，复用既有
`resolveModeLabel` / `formatStartedAt`，完整 ID 仍只用于内部 key、稳定定位、API 参数与目标归属；
hooks/auth/store/data、请求、复制、格式、超时、重试和业务时序保持不变。

显示验收边界为：设置入口/dialog/heading 的可访问名称为“设置”；行与结束/恢复面板显示既有模式和时间，
用户可见正文、`title` 与最终计算可访问名称不出现完整 UUID；两条同模式同时间记录同时存在时，结束与
恢复都精确操作第二条并保留原 principal/revision。旧安全、取消、失败、重试、busy、互锁和归属断言不削减；
既有 E2E 的同类正负向检查迁移为精确目标行，新 E2E 只使用本地 Fake API，不连接 Room、麦克风、外部
Provider 或生产。

TDD、首轮失败、全仓 format 链、最终门禁、变异/hash、保护集、截图与 Review 边界集中在
[PROJECT_STATUS 的 R2-UI 小节](./archive/2026-11-21-document-consolidation/PROJECT_STATUS.md#r2-ui-设置标题与活动记录去-uuidfinal_ready)。
独立技术 Review、最终文档 format、commit/push 以主控同卡回执为准；用户 Review 待，本文件不写
APPROVED。生产、真实 Provider/IdP/LiveKit、设备、部署和真实数据未验收；SGEC-OFF 仍待实施。

## 6. 非目标

- 不统一 WG/WP/DP 的 query profile。
- 不引入服务端状态库、全局缓存、后台重放或自动重试。
- 不改变结束/恢复 API、会话状态机、分页协议或 tombstone。
- 不新增复制 UUID、详情页、模式过滤或数据字段。
- 不处理周报时长、掌握度、场景目标、正式 i18n 框架或原生方案。
