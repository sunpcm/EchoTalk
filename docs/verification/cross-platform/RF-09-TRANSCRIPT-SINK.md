# RF-09 有界内存 TranscriptSink 与故障终止验证契约

## 1. 背景与目标

在实时语音对话中，LiveKit Agent 后台转录持久化需要具备有界队列缓冲、失败重试、优雅排空与异常会话终止能力。在 A43 完成事件稳定 UUID5 派生与数据库原子幂等之后，本轮根据已批准的 A44 策略落地 `TranscriptSink`，消除每消息 `ensure_future(save_transcript)` 无归属后台任务。

维持内存已接纳（accepted）不等于持久化（durable）的设计界限，明确接受进程强杀可丢失未落库事件；本轮不引入外部消息队列、不更改数据库 Schema、不升级 SDK，RF-09 整体保持未完成状态。

## 2. 核心架构与接口契约

- **模块位置**：`backend/livekit_agent/transcript_sink.py`。
- **构造接口与生产默认值**：
  ```python
  TranscriptSink(
      session_id: str | uuid.UUID,
      on_failure: Callable[..., Any] | None = None,
      *,
      writer: Callable[..., Any] = save_transcript,
      capacity: int = 256,
      max_attempts: int = 3,
      attempt_timeout: float = 2.0,
      backoff: tuple[float, ...] = (0.25, 1.0),
      drain_timeout: float = 8.0,
  )
  ```
- **提交接口**：
  `submit(role, content, *, event_id, emotion_state=None, timestamp_ms=None) -> bool`
  - 同步非阻塞，禁止创建每消息 `ensure_future`。
  - 队列容量上限为 256 pending 条数（另含 1 active/inflight）；该上限为事件条数边界，非 payload 字节硬上限；仅成功入队时 `accepted++`，满队列、关闭中或非法参数被拒不算 `accepted`。
  - 空白文本、坏 UUID `event_id`、非法角色（非 `user`/`assistant`）或非法 `session_id` 零写安全拒绝（`rejected++`）。
  - 接纳时对 `content` 及 `emotion_state` 进行 `copy.deepcopy` 深拷贝快照，调用方后续修改不影响实际写入。
  - 未显式传入的 `timestamp_ms` 严格保留 `None` 快照，禁止在提交时生成新显式时间戳导致重放冲突。
- **状态与记账快照**：
  `snapshot() -> SinkSnapshot`
  - 快照字段：`accepted`、`succeeded`、`failed`、`pending`、`inflight`、`rejected`、`status`、`closed`、`failure_reason`。
  - 记账恒等式：任何时刻 `accepted == succeeded + failed + pending + inflight` 严格成立；关闭后物理清空队列，`pending == 0`，`inflight == 0`。

## 3. 尝试、重试与故障通知契约

- **尝试次数与退避**：
  - 每条接受事件最多 3 次写入尝试（1 次首次 + 2 次重试）。
  - 支持通用 `Awaitable` 及 `asyncio.Future`，不将未 resolve 的 Awaitable 误判为成功；单次写入采用合作式 `asyncio.wait_for(..., timeout=2.0)` 上限约束；超时、抛错或返回 `None` 均视作单次失败。
  - 失败后按 `(0.25, 1.0)` 秒固定阶梯退避重试，重试使用完全相同的 `event_id` 与原 payload。
- **故障触发与终止会话**：
  - 当队列达到 256 pending 满载，或某条记录 3 次尝试重试耗尽时，Sink 同步关闭接纳（`accepting = False`），状态置为 `failed`。
  - 故障回调先经 `inspect.signature` 检查参数签名，内部抛出 `TypeError` 等异常不重复执行（至多一次）；异步故障通知中重入调用 `close()` 消除自我等待与递归取消。
  - 在真实 Agent entrypoint 中按模式调用既有 `_send_error_and_disconnect`（自定义轨 `ERR_CUSTOM_RUNTIME`，基础轨 `ERR_SYSTEM_RUNTIME`），不引入新错误码或暴露原始异常。
  - 故障通知自身的异常被安全吸收，不成为未取 Task 异常；已接纳的存量事件在后续关闭排空总预算内继续尝试落库。

## 4. 关闭与生命周期契约

- **排空总预算**：`drain_timeout = 8.0s`（涵盖 worker 排空与通知任务收束共享总预算，禁止给通知任务新增独立 8 秒预算，整体预算小于 SDK 默认 10s 进程终止上限）。
- **立即停止接纳**：`close()` 被调用后立即拒绝新提交；通过队列 Sentinel 优先唤醒 worker 处理存量队列。
- **任务收束与未落库标记**：
  - 排空超时或外部调用方取消时，在预算内合作式取消并等待收束内部自有 worker、writer、sleep 及 notify 任务，合作式超时不保证强杀不响应取消的操作，并在收束后物理清空队列，确保无残留后台任务。
  - 无论正常结束、超时或取消，所有未成功落库的项目一律记入 `failed`，绝不伪称落库成功。
- **幂等性、并发与调用者取消**：
  - `close()` 串行或并发重复调用共享同一底层 Task，返回相同布尔值。
  - 外部调用方取消时，先确保底层共享清理任务收束完成后再抛出 `CancelledError`；当调用方捕获到 `CancelledError` 时，所有内部任务已严格结束且 `closed = True`；底层形成的布尔结果供后续 closer 正常复用，不使任务被取消 poison。
  - 子任务取消隔离：通知任务自身内部抛出 `CancelledError` 被天然隔离在通知子任务边界内，不将子任务取消误判为外部共享清理取消，底层 close 正常完成终态并将 `closed = True` 且返回 `False`。
  - 重入安全：故障通知任务自身调用 `await sink.close()` 时，只等待 worker 排空与队列清空，消除自等待死锁；外部 closer 完成后无任何挂起通知任务残留。
  - `close()` 返回 `True` 仅表示所有已接纳（accepted）事件均成功落库保存，不表示被容量或校验拒绝（rejected）的事件也已保存；任一失败返回 `False`。

## 5. 生产接线与 Agent 生命周期

- **单一 Job Sink 共享**：
  - `EchoTalkAgent.on_user_turn_completed` 与 `_persist_assistant_conversation_item` 统一接入同一 Job Sink 实例，透传基于 SDK `ChatMessage.id` 的稳定 UUID5 `event_id`。
  - 未注入 Sink 时安全告警并丢弃，严禁生产回退至无归属 `ensure_future(save_transcript)`。
- **生命周期挂载与整体所有权**：
  - `entrypoint` 在建立连接与取得 `session_id` 后立即实例化 `TranscriptSink`。
  - 将 `add_shutdown_callback` 注册与后续配置加载、语音管线启动均纳入整体所有权保护边界：注册抛出异常、用户不存在、插件失败、prompt 异常、start 失败或取消均触发 `finally: if not started: await sink.close()` 关闭 Sink 并收束 worker，绝不产生 worker 泄漏，且保持原异常/取消信号正常传播。
  - `agent_session.start` 成功返回不代表会话结束，保持 Sink 活跃供整个语音对话生命周期使用。

## 6. 质量验证与证伪矩阵

| 测试用例                                                                          | 覆盖场景与验证手段                                                          |
| :-------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| `test_sink_normal_persistence_and_snapshot_accounting`                            | 双入口（user/assistant）提交至同一 Sink，全部成功，记账恒等式验证           |
| `test_sink_two_jobs_isolation`                                                    | 两会话独立 Sink 队列、状态与写入互不影响                                    |
| `test_sink_capacity_boundary_default_256_deterministic`                           | 默认 256 pending + 1 active 真实边界：确定性同步，满后拒绝且单次通知        |
| `test_sink_rejects_invalid_inputs`                                                | 空白文本、坏 UUID、非法角色、非法 session_id 安全拒绝且零写                 |
| `test_sink_retry_exhaustion_and_single_failure_notification`                      | 3 次写入重试耗尽，相同 event_id，耗尽后关停并单次通知                       |
| `test_sink_attempt_timeout_deterministic`                                         | 单次超过 attempt_timeout 确定性视作失败，带退避重试，第 3 次成功            |
| `test_sink_future_and_general_awaitable_writer`                                   | 同步 writer 直接返回 Future 与 CustomAwaitable，未 resolve 前等待，驱动执行 |
| `test_sink_writer_cancelled_error_handling_single_task_done`                      | writer 抛 CancelledError 恰好一次 task_done（无 ValueError），停接并通知    |
| `test_sink_failure_callback_signature_inspection_no_retry_on_internal_type_error` | 同步故障回调内部 TypeError 绝不二次执行（严格至多一次）                     |
| `test_sink_reentrant_close_from_on_failure`                                       | 故障回调重入调用 close() 消除自我等待与递归取消，正常排空并退出             |
| `test_sink_close_drains_hanging_notify_task_within_budget`                        | 外部 close() 时通知任务挂起在同一总预算内超时取消收束，无 pending 残留      |
| `test_sink_notify_task_cancellation_does_not_poison_shared_close`                 | 通知子任务抛 CancelledError 不污染共享 close，正常 closed=True 并返回 False |
| `test_sink_close_timeout_explicit_failure_and_cleanup`                            | 排空超时显式返回 False，收束自有任务，物理清空队列，未处理计入 failed       |
| `test_sink_close_concurrent_and_repeated_calls_idempotent`                        | 并发 close 与多次重复 close 幂等共享结果                                    |
| `test_sink_caller_cancellation_preserves_semantics_and_allows_subsequent_closer`  | caller 取消时先收束底层任务再传播 CancelledError，后续 close 正常复用结果   |
| `test_sink_deep_copy_and_timestamp_preservation`                                  | 输入字典后续篡改不影响写入，None 时间戳严格保持                             |
| `test_sink_safe_logging_no_canary_leak`                                           | 注入 Canary 字符，日志全 record 字段绝对干净                                |
| `test_sink_real_entrypoint_two_entries_and_shutdown_callback_drain`               | entrypoint 两入口真实写入后捕获执行 shutdown callback 证明排空              |
| `test_sink_entrypoint_start_failure_asserts_sink_closed_and_tasks_done`           | 管线启动失败时断言真实 Sink closed 且 worker done                           |
| `test_sink_entrypoint_early_failure_asserts_sink_closed_and_tasks_done`           | 用户配置查询等早期失败时断言真实 Sink closed 且 worker done                 |
| `test_sink_entrypoint_registration_failure_asserts_sink_closed_and_tasks_done`    | shutdown callback 注册异常断言 Sink 真实 closed 且 worker done，异常传播    |
| `test_sink_with_real_pg_and_idempotent_commit_ack_retry`                          | 专用 PostgreSQL 模拟首次 commit 成功但 ack 丢失，重试原子幂等单条           |
| `test_transcript_concurrent_barrier_idempotent`                                   | 修复 A43 P2：在实际 service 使用的 session 取得 PID 并持有到 Barrier 再写   |

## 7. 界限与未完成范围

- **内存 Sink 界限**：内存有界缓冲为条数上限而非字节硬上限，不提供跨进程持久化保证，进程强杀或主机掉电将丢失尚未落库的 accepted 事件；未引入外部 Broker 或 WAL。
- **后续待办**：Orchestrator、CredentialResolver、ProviderRegistry 拆分、系统环境变量与 dotenv 清理、真实 LiveKit/外部 Provider 端到端验收仍待后续轮次完成。
- **跟踪状态**：TODO.md 中 RF-09 整项保持未勾选。
