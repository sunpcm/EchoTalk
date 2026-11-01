# RF-09 运行时错误通知任务所有权与关闭收束验证（A57）

## 1. 背景与目标

依据 [`docs/MVP_REFACTORING_REMEDIATION_PLAN.md`](../../MVP_REFACTORING_REMEDIATION_PLAN.md) RF-09“追踪后台任务，在进程退出前排空或安全取消”及 [`TODO.md`](../../../TODO.md) RF-09，解决 `backend/livekit_agent/job_orchestrator.py` 的 `on_agent_error` 中使用未追踪 `asyncio.ensure_future` 派发后台错误通知的问题，消除通知任务异常无人检索告警及 Job 关闭后仍有后台任务悬挂的风险。

## 2. 实施契约与边界

1. **实例级任务所有权与异常安全检索**：
   - 每个 `AgentJobOrchestrator` 实例独立维护自有 `_error_tasks` 集合（只读属性 `error_tasks`），跨 Job 状态完全隔离。
   - 活动阶段每次符合 `AgentErrorMapper.classify_runtime_error` 分类的不可恢复自定义轨错误均创建一次受追踪通知任务，不合并多事件；基础轨与可恢复事件仍不派发。
   - 任务完成回调 `_on_error_task_done` 自动将任务从集合移除并安全检索异常；普通异常仅输出静态安全日志 `"运行时错误通知任务执行失败: session=%s"`（`safe_session_id`），不输出异常正文、密钥、原始房间名或 traceback；`asyncio.CancelledError` 安全检索，不产生 `"Task exception was never retrieved"`。
2. **单一组合 Shutdown Callback 与排空预算隔离**：
   - 正常 `run()` 成功返回后不提前取消在途错误通知或关闭健康 `TranscriptSink`。
   - `ctx.add_shutdown_callback(self.close)` 注册单一组合关闭入口，保留单回调结构与原 `TranscriptSink.close()` 的 `bool` 返回值语义。
   - `close()` 启动时同步标记 `closing = True`，禁止迟到 `error` 回调创建新通知任务。
   - 既有在途错误通知享有命名类常量 `ERROR_TASK_DRAIN_TIMEOUT_SECONDS = 2.0` 秒合作式排空预算（支持测试短值 patch），超时则对 pending 任务执行 `cancel()` 并 `await` 收束，不遗留后台任务。
   - 错误通知收束后执行 `TranscriptSink.close()`，完整保留 `TranscriptSink` 自有 8.0 秒排空预算，不将 2.0 秒通知预算误作 `Sink` 预算。
3. **重入防自锁、幂等与取消清理**：
   - 当错误通知任务内 `ctx.room.disconnect()` 间接调用 shutdown callback 重入 `close()` 时，自动排除 `asyncio.current_task()` 与重入任务集合，不发生自等待死锁或自取消。
   - 重复或并发调用 `close()` 幂等安全，`TranscriptSink.close()` 仅执行一次并返回一致结果。
   - `setup` 失败、`start` 失败或 `run` 被取消时，均通过 `finally` 收束已派发通知并关闭 `Sink`；普通通知异常不阻断其余资源关闭。
   - `close()` 自身被取消时，仍取消并等待自有 pending 错误通知任务完成清理，随后保持 `CancelledError` 传播；`Sink` 异常按原行为向上传播。

## 3. 验证矩阵与本地门禁

新增 [`backend/tests/test_error_task_lifecycle.py`](../../../backend/tests/test_error_task_lifecycle.py) 并同步适配 [`backend/tests/test_job_orchestrator.py`](../../../backend/tests/test_job_orchestrator.py) 与 [`backend/tests/test_agent_errors.py`](../../../backend/tests/test_agent_errors.py)：

- `test_active_error_tasks_tracked_and_removed_on_normal_completion`：验证活动期多错误事件独立追踪、完成即移除、可恢复与基础轨零派发。
- `test_error_task_exception_retrieved_with_static_safe_log_and_no_canary`：验证通知异常安全检索、零 Canary/堆栈泄露、GC 后零未检索异常告警、后续 `Sink` 正常关闭。
- `test_error_task_cancelled_error_retrieved_safely`：验证 `CancelledError` 安全检索与移除。
- `test_successful_run_does_not_cancel_error_tasks_or_close_healthy_sink`：验证 `run()` 成功返回后在途通知与健康 `Sink` 保持存活直至 shutdown。
- `test_shutdown_cooperative_drain_within_budget_and_bool_return_semantics`：验证 2.0s 预算内合作式排空及 `True`/`False` 返回值透传。
- `test_shutdown_timeout_cancels_and_awaits_pending_error_tasks_preserving_sink_8s_budget`：验证超时取消并等待 pending 通知任务，且不影响 `TranscriptSink` 8.0s 排空完成。
- `test_late_error_callback_during_and_after_shutdown_spawns_zero_tasks`：验证 `closing`/`closed` 阶段迟到回调零通知。
- `test_setup_failure_start_failure_and_run_cancellation_clean_up_tasks_and_sink`：验证 `setup` 失败、`start` 失败及 `run` 取消完整收束通知任务与 `Sink`。
- `test_two_jobs_independent_error_task_isolation`：验证双 Job 状态与通知任务互不干扰。
- `test_disconnect_reentrant_shutdown_no_deadlock_or_self_cancel`：验证 `disconnect` 触发 shutdown callback 重入无自锁、无自取消。
- `test_concurrent_and_repeated_shutdown_idempotent`：验证并发与重复 shutdown 幂等。
- `test_close_cancelled_cancels_and_awaits_pending_tasks_and_sink_exception_propagates`：验证 `close` 被取消仍清理 pending 任务并传播取消，以及 `Sink` 异常原样传播。

## 4. 已知未覆盖边界

- 本轮仅管理 `AgentJobOrchestrator` 运行时错误通知任务的生命周期，未清理 `agent.py` 中的 `sys.path` 注入与导入期 `dotenv` 加载。
- 本地验证基于确定性事件与隔离测试环境，未连接真实 LiveKit Cloud 或第三方语音 Provider，RF-09 整项保持未勾选。
