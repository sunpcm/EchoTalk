# RF-09 AgentJobOrchestrator 生命周期边界验证

> 实施日期：2026-10-26
> 代码分支：`codex/rf09-job-orchestrator`
> 对应任务：A51 / RF-09 LiveKit Agent AgentJobOrchestrator 生命周期边界（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF09“拆分 LiveKit Agent：AgentJobOrchestrator 负责连接、参与者和会话生命周期”与 A51 冻结契约：

1. **编排职责解耦**：从 `agent.py` 的 `entrypoint` 中抽取 SDK 房间连接、等待参与者、`TranscriptSink` 生命周期管理、单一 shutdown callback 挂载、`AgentSession` 事件接线（`conversation_item_added` 与 `error`）及启动异常清理至独立模块 `backend/livekit_agent/job_orchestrator.py`。
2. **纯净边界与零循环依赖**：`AgentJobOrchestrator` 不反向 import `agent` 模块，不直接读取数据库、用户配置或 Provider 凭据；通过构造参数显式接收工厂与回调（`session_factory`、`sink_factory`、`send_error_fn`、`persist_assistant_fn`），保持既有测试针对 `agent.AgentSession`、`agent._send_error_and_disconnect` 等 patch 路径真实生效。
3. **时序与状态不漂移**：safe session id 在 connect 前读取净化；原 session_id 在 wait_participant 后获取；连接与等待参与者失败时尚未创建 Sink；每任务实例化独立 `AgentJobOrchestrator` 对象，多 Job 状态严格隔离；模式读取时点不后移，在 `_setup_agent` 中查出用户配置后立即同步更新 `is_custom`。
4. **生命周期闭合与资源收束**：仅注册 1 个 shutdown callback（`sink.close`）；启动成功后 `entrypoint` 返回时 Sink 保持 `accepting`，仅在 shutdown 时排空并返回 `True`；setup 失败（查库异常、配置不存在、插件初始化失败）、管线启动失败或任务取消时，`try ... finally` 保证安全关闭自有 Sink 且自有任务 done，不泄露后台 worker 任务；错误分类与安全日志保持逐字一致。

## 2. 本地实现与变更

### 2.1 新增 `backend/livekit_agent/job_orchestrator.py`

- 声明 `AgentJobOrchestrator` 类。
- `__init__(ctx, session_factory, sink_factory, send_error_fn, persist_assistant_fn)` 接收必要工厂与安全回调。
- `set_custom_mode(is_custom)` 显式设置轨模式。
- `_on_sink_failure(reason)` 根据 `is_custom` 发送安全错误码并断连。
- `run(setup_fn)` 顺序执行连接、等待参与者、分配 Sink、挂载单一 shutdown callback、调用业务 setup 回调、创建并接线 AgentSession、启动管线，并在未启动成功时由 `finally` 安全收束 Sink。

### 2.2 重构 `backend/livekit_agent/agent.py`

- 引入 `AgentJobOrchestrator`。
- `entrypoint(ctx)` 内部定义 `_setup_agent(session_id, sink)`，保留 DB 查询、双轨分支、`ProviderRegistry` 插件集与 `EchoTalkAgent` 实例化。
- 显式实例化 `AgentJobOrchestrator` 并调用 `await orchestrator.run(_setup_agent)`。
- 清理 `agent.py` 中未使用的 `asyncio`、`AutoSubscribe` 与 `ErrorEvent` 导入。
- 原有 helper 函数与类（`EchoTalkAgent`、`_fetch_user_settings`、`_fetch_session_context`、`_build_custom_plugins`、`_send_error_and_disconnect`、`_persist_assistant_conversation_item`）保持可导入与原签名。

### 2.3 新增测试 (`backend/tests/test_job_orchestrator.py`)

新增 9 项独立异步测试用例，覆盖：

1. **完整生命周期与排空**：验证完整连接、等待、单 Sink 分配、唯一 shutdown callback、启动成功后 Sink 保持 accepting、shutdown 排空返回 True。
2. **两 Job 状态隔离**：验证两 Job 独立 session_id、sink、agent_session 互不干扰，一个关闭不影响另一个。
3. **setup 失败资源清理**：验证 setup 失败（返回 None）时安全退出并关闭自有 Sink，自有 worker 任务 done。
4. **start 启动失败处理**：双轨参数化验证启动异常时发送对应安全错误码断连且关闭自有 Sink。
5. **异步取消异常传播**：验证取消异常正常向上传播且自有 Sink 正常关闭。
6. **Sink 故障安全通知**：双轨参数化验证 Sink 故障回调 `_on_sink_failure` 正确根据 `is_custom` 发送错误码并断连。
7. **assistant 转录事件接线**：验证 `conversation_item_added` 事件接线与 `persist_assistant_fn` 调用。
8. **运行时错误安全断连**：验证 `error` 事件接线与运行时错误安全断连。
9. **entrypoint 真实消费**：验证 `entrypoint(ctx)` 真实创建并执行 `AgentJobOrchestrator.run`。

## 3. 边界与未验界限

- 本轮仅完成任务编排与生命周期边界从 `agent.py` 中抽取（RF-09 子项），未勾选 RF-09 整体。
- 仅移动既有行为，未治理旧 `asyncio.ensure_future` 错误通知任务未受控跟踪问题（列为 RF09 后续）。
- `sys.path` / `dotenv` 清理、SDK 升级及真实外部 LiveKit Server 联调仍待后续完成。
- 所有测试均基于纯 Mock 环境（零网络、零外部请求）。
