# RF-09 公共 Sink 通知重入边界验证（A58）

## 1. 背景与目标

依据 [`docs/MVP_REFACTORING_REMEDIATION_PLAN.md`](../../MVP_REFACTORING_REMEDIATION_PLAN.md) RF-09 明确边界与 [`TODO.md`](../../../TODO.md) RF-09，A57 新增的 `AgentJobOrchestrator` 关闭逻辑为识别 Sink 故障通知重入，此前直接读取 `self.sink._notify_task` 私有字段，造成跨组件内部私有字段耦合。

本轮在 `TranscriptSink` 建立小型公共行为查询 `is_failure_notification_task()`，只返回当前或指定 asyncio 任务是否为本 Sink 的故障通知任务（`bool`，不暴露 Task 对象），`AgentJobOrchestrator` 使用此边界彻底消除对 `sink._notify_task` 的访问。同时严格保持 `TranscriptSink` 原 `close()` 流程、8.0 秒排空预算、状态记账与 A57 错误通知 2.0 秒预算完全不变；并关闭 A57 遗留的两项文字 P2。

## 2. 实施契约与边界

1. **TranscriptSink 公共行为查询契约**：
   - 提供公共方法 `is_failure_notification_task(self, task: asyncio.Task[Any] | None = None) -> bool`。
   - 当未传入 `task` 时，默认检测 `asyncio.current_task()`。
   - 仅在指定任务非空且确为本 Sink 内部创建并持有的 `self._notify_task` 时返回 `True`；在无通知任务、普通外部调用、其他 Sink 实例的通知任务或无事件循环时安全返回 `False`。
   - 查询为严格只读纯行为，零状态修改、零内部记账变更、不暴露内部 `asyncio.Task` 对象。
   - `TranscriptSink.close()` 内部重入判断同样对齐使用该公共方法。
2. **AgentJobOrchestrator 解耦与零私有属性访问**：
   - `_close_sink()` 内部通过 `getattr(self.sink, "is_failure_notification_task", None)` 查询当前任务是否为 Sink 故障通知任务。
   - 若为重入，直接 `await self.sink.close()`，避免等待整体 `_sink_close_task` 产生自等待死锁；
   - 若非重入，正常复用或创建 `_sink_close_task` 共享关闭，保留 `TranscriptSink` 自有 8.0 秒排空预算与原布尔返回值；
   - 彻底消除对 `self.sink._notify_task` 的私有属性读取。
3. **真实重入闭环链路**：
   - 端到端链路为：“真实 Sink 故障（写入失败重试耗尽） → 触发 `_on_sink_failure` → 调用 `_send_error_fn` 发送错误码并 `disconnect()` → 触发注册的单一组合 shutdown callback (`orchestrator.close`) → `orchestrator._close_sink` 经公共查询识别重入 → 直接 `await sink.close()` 完成排空”。
   - 验证无自锁（deadlock）、无自取消（self-cancel）且所有自有任务（notify task、worker task）完全收束。
   - 并发外部调用 `orchestrator.close()` 安全共享并返回一致的布尔结果。
4. **关闭预算与原有逻辑保持**：
   - 不修改 `TranscriptSink` 8.0 秒排空预算、尝试重试次数（3 次）、退避策略（0.25s, 1.0s）及状态记账恒等式。
   - 不修改 `AgentJobOrchestrator` 2.0 秒自有错误通知排空预算与 A57 错误分类行为。
   - 不重写任一组件的关闭算法。

## 3. A57 遗留文字 P2 关闭

1. **新增测试数修正**：
   - A57 在 `docs/PROJECT_STATUS.md` 中记录的新建 `backend/tests/test_error_task_lifecycle.py` 测试数此前误记为 10 项，实际包含 12 项测试；已在此前记录中修正为 12 项。
2. **测试装饰器核验**：
   - 依据指令对真实 `backend/tests/test_error_task_lifecycle.py` 进行核对：该文件所有 12 项测试函数均仅声明恰好一个 `@pytest.mark.asyncio` 装饰器，不存在重复堆叠的装饰器，因此保持文件原有有效内容不变。

## 4. 验证矩阵与自动化覆盖

新增 [`backend/tests/test_sink_reentry_boundary.py`](../../../backend/tests/test_sink_reentry_boundary.py) 并扩展既有测试：

- `test_sink_is_failure_notification_task_comprehensive_matrix`：验证无通知、普通外部任务、本 Sink 内部任务（无参及传参）、跨 Sink 实例任务等全部矩阵形态，断言状态及快照完全不变。
- `test_sink_is_failure_notification_task_without_running_loop`：验证无运行事件循环下调用安全返回 `False`，不抛出异常。
- `test_real_sink_failure_notification_disconnect_reentry_full_chain`：端到端验证真实 Sink 故障重入全链路，验证无死锁、无自取消、任务全收束且外部并发 close 正常共享。
- `test_orchestrator_close_sink_zero_private_attribute_access`：通过拦截 `__getattribute__` 严格证明 `Orchestrator._close_sink` 零访问 `_notify_task`。
- `test_sink_reentry_with_concurrent_agent_error_cooperative_drain`：验证 Agent 运行时错误（401）与 Sink 故障同时发生时，双重通知安全合作式排空，无死锁。
- `test_healthy_sink_shutdown_reentry_query_returns_false`：验证健康 Sink 正常关闭时 query 返回 `False`，正常走共享 close 并返回 `True`。
- `test_sink_is_failure_notification_task_query_and_immutability`（在 `test_transcript_sink.py`）：补充 Sink 基础测试集中的查询矩阵与状态不变性。
- `test_orchestrator_close_sink_uses_is_failure_notification_task_boundary`（在 `test_job_orchestrator.py`）：补充 Orchestrator 单元测试对公共边界的严格使用验证。

## 5. 已知未覆盖边界

- 本轮重构仅限于 `TranscriptSink` 与 `AgentJobOrchestrator` 之间的重入查询公共边界，未改动 `agent.py` 中的 `sys.path` 注入与导入期 `dotenv` 加载。
- 本地验证基于纯 Mock/Event 驱动的确定性异步环境，未连接真实 LiveKit Cloud、生产数据库或第三方 Provider，RF-09 整项保持未勾选。
