# CP-06 Room 同 principal 认证刷新与媒体归属

> 实施轮次：A77 b/r4
> 日期：2026-11-01
> 状态：本地实施停写，待主 Agent 代跑门禁与独立 Review

## 1. 问题与边界

既有 `RoomSession` 把进入会话时的 revision 固定用于 SDK callbacks、Web/native lifecycle
和 pending 门禁。同一 principal 正常认证更新后，Room 虽未替换，旧 revision 却使后续
`onConnected/onError/onDisconnected`、suspend/offline 与 native ready 永久失效。直接删除
revision/principal 门禁又会允许旧 callback 或旧在途结果影响后来会话。

r1 的 native 业务订阅后快照检查把“注册/getState 尚未完成”的架构占位 hidden 当成真实
后台，导致 940 passed/25 failed/965 total 的产品 Vitest 失败。该 hidden 是未就绪门禁，
不是可信后台结论；native 必须等待 `whenReady`，Web 才可在订阅后立即按 hidden/offline
失败关闭。

本增量只修复 Room 监听归属和 native pending/快照时序，不修改认证模块、store/API、平台
适配器能力、后端、schema、锁、依赖或真实 SDK。模拟 SDK/lifecycle 事件不等同真实设备
音频、IdP 或 Provider 验收。

## 2. ownership 契约

1. 每个 Room 实例首次绑定精确 principal；同一 `sessionId/sessionGen` 内只接受该 principal。
2. 已验证的同 principal 认证通知到达后，新 callback 绑定该通知交付时的当前 revision；
   通知到达前的旧 revision callback 与旧在途结果继续拒绝。同一 Room 的物理生命周期
   adapter 可以复用，但每次认证交付都必须生成新的业务监听归属；已保存的旧业务函数永久
   失效，不能因新 revision 已交付而重新取得写权限。
3. 同一 Room 的刷新不替换 `LiveKitRoom`、不停止健康本地音轨、不重发
   `sessionId/sessionGen` 已去重的 dispatch，也不重置 native 10 秒预算。
4. Web/native lifecycle 事件只由当前业务监听归属接收。当前 SDK 错误/断连、后台、可信
   hidden 或 offline 仍同步停止本 Room 音轨，清除 Token/URL 并进入 `connection_failed`。
   Web 的订阅后快照立即可信；native 在能力就绪前返回的 hidden 只表示门禁尚未完成，不能
   挂音或失败，必须等 `whenReady` 后复核。
5. native ready 若在认证通知空窗中完成，结果保留但不挂载；通知交付后只挂载一个 Room。
   挂载前必须重新读取当前 snapshot 与 native 能力；inactive、hidden、offline、能力未就绪
   或原 deadline 已过时安全失败。身份变化、超时、初始化失败、结束、取消或卸载仍最终
   关闭资源。
6. 同 principal 认证刷新保留 native pending 的原 deadline。空窗中触发的旧 timer 不得
   改写新归属；认证通知交付后立即按原 deadline 对账，已过期就失败关闭，不重新获得
   10 秒预算，也不永久停留于 connecting 或遗留 Token。旧 timer 只能清理自己安装的句柄，
   不能清空新 revision 已登记的 timer。

## 3. 实施

- 新增 `useRoomAuthOwnership`，分别维护首次 principal、通知已交付 revision 与实时
  snapshot/revision 核验。旧 callback 捕获旧 revision 后不能因当前账号升级而复活。
- `RoomSession` 的 SDK/lifecycle/dispatch/native ready 门禁接入统一 ownership；物理
  lifecycle adapter 在认证刷新时保持稳定，每次业务监听交付则先安装新订阅、再永久失效并
  退订旧订阅。媒体清理仍只由当前 session/gen/auth 错误、中断或真实卸载触发。
- native pending 独立保存 ready 完成事实、原 deadline 与结算状态。通知前完成的 ready
  只更新内部事实，不写 store、不停止轨道也不挂载音频；通知交付后重新读取当前 snapshot
  与能力并按原 deadline 结算。
- 业务订阅后的快照检查按平台区分：Web 保持 CON-04 的立即检查；native 仅在
  `nativeAppState` 能力可信时把 hidden/offline 当成后台事实。pending 占位 hidden 保留
  给 `whenReady` 和原 deadline 对账，不提前 failConnection。
- native timer callback 与自己的 handle 绑定；旧 revision 的已排队 callback 即使被主动
  调用，也不能清空当前 revision 的 pending timer。旧 adapter 的 disposed/late
  `whenReady` 继续由 effect ownership 拒绝，不作用于新归属。
- r3 只修正 timer 测试 fixture：测试直接包装已安装的 fake `setTimeout`，并在 `finally`
  中先恢复 fake 函数、再调用 `vi.useRealTimers()`；不再用 `vi.spyOn` 注册可由外层
  `restoreAllMocks()` 二次恢复的全局计时器 spy。fake-time 推进、主动调用旧 callback、
  新 handle 保留与其后超时关闭断言不变，产品逻辑不变。
- r4 只补强 timer-handle 回归：包装后的 `setTimeout` 继续调用真实 fake timer 队列并保存
  callback。初始 timer 入队后推进 9 秒，再触发同 principal 通知，新 callback 的剩余延迟
  必须仍是 1 秒；旧 callback 主动执行不得改变 state 或队列所有权。立即卸载后队列必须回到
  测试前基线，后续旧/当前 callback 与时钟推进均不得写入 store、发起网络请求或产生音轨
  副作用。删除生产 handle 身份门禁会使该卸载队列断言失败，产品逻辑不变。
- `ActiveConversation` 消费同一个已交付 revision，不再维护可能与 RoomSession 分叉的
  第二套认证订阅。
- `VoiceInterface` 测试 fixture 的 Web lifecycle dispose 只移除本实例 listener，保留其他
  adapter 所有权；CON-04 的跨 adapter 两次 snapshot 读取和健康默认 fixture 保持不变。

## 4. 已写入回归

- 同 principal 通知前旧 SDK callback 拒绝，通知后新 callback 可安全失败关闭。
- 通知前保存的旧 Web/native 业务监听函数在通知后仍永久无效；当前新监听可安全停轨，
  Room 实例与物理 adapter 保持不变且只保留一个业务订阅。
- native 注册/getState pending 期间明确保持 connecting、Token 与零音频 Room；真实
  getState active 后只挂载一个 Room。真实 inactive、注册失败与初始 hidden/offline 仍
  安全失败。
- native 刷新后的当前业务监听仍能在 App inactive 时同步停止当前 Room 音轨。
- 认证刷新不重发 session/gen dispatch，旧在途失败不覆盖后来 active 状态。
- native ready 在通知空窗前完成时零挂载/零 dispatch，通知交付后重新读取健康 snapshot
  并只挂载一个 Room；active 结果之后 App 转 inactive 时，通知后安全失败且不挂 audio Room。
- 空窗中完成的 inactive ready 在通知前零状态/网络副作用，通知后安全清 Token；
  空窗中耗尽原 10 秒 deadline 时，通知后立即失败且只产生一次 timeout diagnostic。
- 连续同 principal 通知不重置原始 10 秒 pending 预算。
- 旧 revision 的 timer callback 被主动调用后，新 revision 的 timer 仍由本 Room 持有并
  留在真实 fake timer 队列；立即卸载会把本 Room timer 全部清理，迟到 callback 与时间推进
  不改变 store、不发起网络请求也不产生跨 Room 音轨副作用。正常 deadline 失败关闭与刷新后
  当前业务监听停轨仍由既有用例覆盖。
- timer fixture 结束并经过外层 `restoreAllMocks()` 后，`globalThis.setTimeout` 必须保持
  测试前真实函数；后续异步 A76 Agent error ownership 测试不得继续依赖 fake clock。
- 既有 principal/issuer/logout、session/gen、结束、卸载、StrictMode、旧 timer/ready、
  dispatch、Web offline/suspend 与 native 失败回归保持。

## 5. 验证状态

r0 的完整门禁是历史事实。r1 产品 Vitest 为 `940 passed / 25 failed / 965 total`，独立
消费为 `4 passed / 4 failed`；r1 只执行官方返修 native 预检，baseline3 是 r0 派发前的
历史实测，没有新的 r1 三项 baseline 回执。

r2 的独立 9 项时序回归及 A76 compat 5 项在 formatter 前通过；随后 format/lint/typecheck
通过，真实完整 Vitest 为 `958 passed / 9 failed / 967 total`。9 项失败全部位于后续
A76 Agent error ownership 测试，5 秒等待超时由 stale timer 测试污染全局时钟引起；
stale timer 单项自身通过，不能解释为 Agent error 产品失效。r2 未执行后续完整 E2E、
build、backend 和 schema，不冒认为全绿。

r3 实施阶段按 prompt 未运行 formatter、lint、typecheck、Vitest、构建、后端、schema、
服务、真实 CLI 或 Git 写操作；主 Agent 随后通过固定 `ev.sh` 入口完成 formatter、
完整 frontend10、backend、schema、独立消费和有效变异复验。

r3 停写后完整 frontend10 通过：967 Vitest/33 files、18 build-script、61 Fake API、
8 type generator 与 148 双浏览器 E2E；576 backend 测试及 80.09% coverage、OpenAPI
schema 与 Ruff 通过。独立 9 项时序、A76 compat 5 项及真实时钟恢复通过；auth revision、
原 10 秒 deadline、ready snapshot 三个产品变异分别产生 11/6/4 项真实断言失败并精确还原。
第四项 timer-handle 变异未杀死 967 产品测试，但独立实际 timer 队列确认旧 callback 会清掉
新 handle 登记并在卸载后残留本 Room timer，因此 r4 只补回归，结论仍是产品逻辑当前未坏。

本 r4 未运行 formatter、Lint、TypeScript、Vitest、构建、后端/schema、服务或真实 CLI。
待主 Agent 停写后通过固定 `ev.sh` 入口完整代跑并再次验证第四项 handle 变异必被新回归杀死，
所有变异必须精确还原；之后由独立 Review 判定。

真实 LiveKit SDK、真实 IdP/Provider、iOS/macOS/Android 设备音频、真实后台/断网、Docker、
远端 CI 与部署均未验证；本地模拟事件不冒充设备实测。
