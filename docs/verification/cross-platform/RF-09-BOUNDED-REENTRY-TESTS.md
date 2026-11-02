# RF-09 重入回归测试有界失败与资源清理验证（A59）

## 1. 背景与目标

依据 [`docs/MVP_REFACTORING_REMEDIATION_PLAN.md`](../../MVP_REFACTORING_REMEDIATION_PLAN.md) 与 [`TODO.md`](../../../TODO.md) RF-09，上一轮独立变异测试将 `TranscriptSink` 当前任务重入查询置 `False`，真实重入测试在 Event/回调等待中互等死锁，直到 900 秒整批硬超时。这表明测试本身缺少短超时和异常清理，影响可信门禁效率。

本轮在不改动产品源码的前提下，只增强回归保护的故障诊断与资源清理：

1. 为重入与关闭测试引入独立外部完成观察预算与轻量 helper，覆盖 Event 永不到达、close 互等、回调异常及 while sleep(0) 无限循环；
2. 建立确定性 `try...finally` 协调资源清理机制，超时或断言失败时释放自建 gate、协调解开依赖并取消等待自建外部与底层任务；
3. 严格区分“正常关闭”与“强制清场”，移除测试 helper 人为篡改 `sink._closed=True` / `sink._accepting=False` 伪造终态的做法；
4. 修正显式 `task=None` 语义说明，明确与无参调用一致均指当前任务；
5. 新增负向测试与故障路径验证（延迟响应取消预算先到期、部分步骤失败仍清理其余资源），证明超时可判定失败与清理。RF-09 整项保持未勾选。

## 2. 实施契约与边界

1. **独立外部完成观察预算与轻量 Helper**：
   - 在相关测试中统一定义短预算常量 `TEST_REENTRY_BUDGET_SECONDS = 2.0`（建议 1~3 秒）。
   - 提供纯标准库 helper `_wait_bounded(awaitable, timeout=2.0, name="...")` 与 `_poll_bounded(predicate, timeout=2.0, name="...")`，替代无超时的 `while ...: await asyncio.sleep(0)` 循环。
   - `_wait_bounded` 改为真正独立的外部完成观察预算：显式持有 Task 并通过 `asyncio.wait(timeout)` 观察，到期不在观察函数中无限等待取消完成（规避因 `Sink.close` 与 `Orchestrator._close_sink` 内部 shield 延迟传播取消导致 `wait_for` 挂死无法进入 `finally` 的缺陷），由 `finally` 接管；所有新建观察 Task 均自动登记与回收，不泄漏任务或吞异常。
2. **协调 Try...Finally 资源清理与任务收束**：
   - 测试即使发生 `TimeoutError` 或断言失败，也在 `finally` 块中收束自有资源。
   - 释放测试自建 `asyncio.Event`（`allow_reentrant_close`、`disconnect_entered`、`gate1`、`gate2` 等），避免协程死锁。
   - 通过 `_cleanup_test_resources` 一次性收集测试装置拥有的所有外部 Task、Orchestrator 共享 `_sink_close_task`、错误任务和 Sink worker/notify/close 任务（仅限自建，不碰其他测试），统一发起取消解开内外依赖关系并协调收束；检索所有（含早已完成）任务的异常，对最终 pending 明确报错并给出任务名称。
   - 严格区分“真实正常关闭”与“强制清场”：正常关闭由测试正常调用产品 `close()` 并验证其返回值、快照与任务状态；强制清场仅在异常/负向分支取消并等待自有任务，严禁在 helper 中伪造 `sink._closed = True`。
3. **通知 Task 身份保持与显式 None 语义统一**：
   - `is_failure_notification_task(task=None)` 中，`task=None` 与无参调用语义严格对齐，均指代当前运行中任务（`asyncio.current_task()`）。
   - 在通知任务内部无参、显式当前任务及显式传 `task=None` 均返回 `True`；在外部任务中均返回 `False`；非任何情况下传 None 均返回 False。
   - 身份敏感的重入测试（如 `test_sink_reentrant_close_from_on_failure`）直接在通知原 Task 中直接 await `sink.close()`，不使用 `_wait_bounded` 包裹协程以防生成新 Task 导致身份判定失效；增加断言证明任务身份与非取消回退。
4. **负向测试、故障路径与死锁判定证明**：
   - 使用真实故障通知回调挂起装置，证明通知未到达时在短预算内可判定抛出 `TimeoutError` 并收束任务。
   - 使用本地替身模拟重入查询返回 `False` 导致关闭互等，证明在短预算内捕获死锁并在 `finally` 完整收束所有在途任务。
   - 补充覆盖“关闭会延迟响应取消/外部完成预算先到期”验证：当底层 writer 延迟导致 close 内部 shield 延迟响应取消时，外部预算先到期抛错且随后在 finally 释放门控并清场。
   - 补充覆盖“某个清理步骤失败时仍清理其余自有资源”验证：即使前置步骤出现异常，后续资源依然全部收束，无悬挂遗留。
   - 明确区分单个观察预算（0.05s~2.0s）、整套变异回归耗时（在约 22 秒内产生 4 项预期失败并安全退出），避免挂起 900 秒硬超时。

## 3. 验证矩阵与自动化覆盖

新增与增强测试覆盖如下：

- `test_sink_is_failure_notification_task_comprehensive_matrix`（在 `test_sink_reentry_boundary.py`）：覆盖显式 None 语义（内部 True，外部 False），施加独立观察预算与 release 保护，双 Sink 清理保证前项失败不跳过第二项。
- `test_sink_is_failure_notification_task_without_running_loop`（在 `test_sink_reentry_boundary.py`）：验证无事件循环下无参及传 None 安全返回 `False`。
- `test_real_sink_failure_notification_disconnect_reentry_full_chain`（在 `test_sink_reentry_boundary.py`）：核心真实重入测试，施加 2.0s 独立观察预算与 `_cleanup_test_resources` 协调收集收束，变异场景下在预算内确定性失败退出防 900s 超时。
- `test_orchestrator_close_sink_zero_private_attribute_access`（在 `test_sink_reentry_boundary.py`）：私有属性隔离验证施加短预算。
- `test_sink_reentry_with_concurrent_agent_error_cooperative_drain`（在 `test_sink_reentry_boundary.py`）：双重通知排空施加短预算与协调资源清理。
- `test_healthy_sink_shutdown_reentry_query_returns_false`（在 `test_sink_reentry_boundary.py`）：健康 Sink 关闭施加短预算与清理保护。
- `test_negative_reentry_bounded_timeout_when_notification_event_never_arrives`（在 `test_sink_reentry_boundary.py`）：负向测试，使用真实故障通知回调挂起装置，验证通知未到达在短预算内超时并收束任务，断言真实清场终态。
- `test_negative_reentry_deadlock_detected_when_reentry_query_returns_false`（在 `test_sink_reentry_boundary.py`）：负向测试，使用本地替身模拟重入查询失效关闭互等死锁并收束清理，断言真实清场终态。
- `test_sink_close_delayed_cancellation_response_external_budget_expires_first`（在 `test_sink_reentry_boundary.py`）：故障路径测试，验证底层延迟响应取消时外部完成观察预算先到期抛错且随后在 finally 释放门控并清场。
- `test_cleanup_continues_and_cleans_remaining_resources_when_one_step_fails`（在 `test_sink_reentry_boundary.py`）：故障路径测试，验证清理步骤中某个步骤失败时仍继续收束其余自有资源，不跳过后续资源。
- `test_active_error_tasks_tracked_and_removed_on_normal_completion`（在 `test_error_task_lifecycle.py`）：`_poll_bounded` 替代 `while sleep(0)`，协调清理保护。
- `test_disconnect_reentrant_shutdown_no_deadlock_or_self_cancel`（在 `test_error_task_lifecycle.py`）：重入 shutdown 施加独立观察预算与协调任务清理。
- `test_shutdown_timeout_cancels_and_awaits_pending_error_tasks_preserving_sink_8s_budget`（在 `test_error_task_lifecycle.py`）：`_poll_bounded` 替代 `while sleep(0)`，协调清理保护。
- `test_sink_reentrant_close_from_on_failure`（在 `test_transcript_sink.py`）：故障回调内部重入 close 保持通知原 Task 身份直接 await，断言任务身份与非取消回退，外部施加预算并在 finally 有界清理。
- `test_sink_is_failure_notification_task_query_and_immutability`（在 `test_transcript_sink.py`）：显式 None 语义对齐（内部 True，外部 False），释放保护与双 Sink 协调清理。

## 4. 已知未覆盖边界

- 本轮仅针对重入回归测试的外部等待预算与异常资源清理进行增强，产品源码保持零改动。
- 本地验证基于确定性异步环境与专用 PostgreSQL，未连接真实 LiveKit Cloud 或第三方语音 Provider，RF-09 整项保持未勾选。
