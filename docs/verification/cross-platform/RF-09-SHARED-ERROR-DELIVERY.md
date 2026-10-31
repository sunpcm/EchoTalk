# RF-09 安全错误发送与断连出口收敛验证（A56）

## 1. 背景与边界

依据 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-09 单一 `ErrorMapper` 边界与 `TODO.md` RF-09 要求，此前 `backend/livekit_agent/agent.py` 的 `_send_error_and_disconnect` 与 `backend/livekit_agent/job_orchestrator.py` 的 `_default_send_error` 各自维护了一份完全相同的安全错误映射、JSON 序列化、`publish_data` 发送与 `room.disconnect` 断连实现。

本轮（A56）在不改变任何外部可观察行为、日志格式、异常传播语义及回调注入路径的前提下，将该重复逻辑收敛至单一共享模块 `backend/livekit_agent/error_delivery.py`。

## 2. 核心实现与契约

1. **纯净模块边界（`backend/livekit_agent/error_delivery.py`）**
   - 提供唯一异步函数 `send_error_and_disconnect(ctx, code, message=None, fallback_code="ERR_SYSTEM_RUNTIME")`。
   - 仅依赖 Python 标准库（`json`、`logging`、`typing`）及 `livekit_agent.error_mapper.AgentErrorMapper`。
   - 不读取配置、数据库或凭据，不反向导入 `agent` 或 `job_orchestrator`，模块导入期无任何网络或服务动作。
   - 复用 `logging.getLogger("echotalk-agent")`。

2. **安全载荷、日志与异常传播语义**
   - 先调用 `AgentErrorMapper.map_error(code, message, fallback_code=fallback_code)` 获取白名单 `safe_code` 与静态本地化 `safe_message`，并调用 `AgentErrorMapper.sanitize_session_id` 清洗 `ctx.room.name`。
   - 使用 `json.dumps({"type": "agent_error", "code": safe_code, "message": safe_message}, ensure_ascii=False)` 构造载荷，通过 `ctx.room.local_participant.publish_data(payload=payload, reliable=True, topic="agent_error")` 发送。
   - 发送成功记录 `INFO`：`"已发送错误消息到客户端: code=%s"`。
   - 普通 `Exception` 发送失败仅记录静态安全 `WARNING`：`"发送错误消息到客户端失败"`（不附带未脱敏异常正文或堆栈），随后继续执行 `await ctx.room.disconnect()`。
   - `publish_data` 阶段若抛出 `asyncio.CancelledError`，原样向上传播且不擅自执行 `ctx.room.disconnect()`。
   - `ctx.room.disconnect()` 若抛出异常，原样向上传播；断连成功记录 `INFO`：`"已断开房间连接: session=%s, code=%s"`。

3. **向后兼容包装与注入路径保持**
   - `agent._send_error_and_disconnect` 与 `job_orchestrator._default_send_error` 保留原有函数名、参数顺序 `(ctx, code, message=None, fallback_code="ERR_SYSTEM_RUNTIME")` 及可 patch 兼容包装，内部直接委托 `await send_error_and_disconnect(ctx, code, message, fallback_code=fallback_code)`。
   - `entrypoint` 向 `AgentJobOrchestrator` 注入 `send_error_fn=_send_error_and_disconnect` 及 `AgentJobOrchestrator` 默认回退 `_default_send_error` 的路径、调用次数、初始化与运行时错误分类均保持不变。

## 3. 自动化回归覆盖

- `backend/tests/test_error_delivery.py`：
  - AST 静态检查验证 `error_delivery.py` 仅导入标准库与 `livekit_agent.error_mapper`。
  - `inspect.signature` 校验 `send_error_and_disconnect`、`_send_error_and_disconnect`、`_default_send_error` 三者签名与默认值完全一致。
  - 参数化直接执行共享函数与两个真实包装入口（非 mock 共享函数）：
    - 全部 9 项已知错误码的精确 JSON payload（含 `ensure_ascii=False` 中文非转义校验）、`reliable=True`、`topic="agent_error"` 与精确日志断言。
    - 自定义轨 `ERR_CUSTOM_RUNTIME`、基础轨 `ERR_SYSTEM_RUNTIME` 及非法 `fallback_code` 的降级与恶意 `code`/`message`/`session_id` Canary 全链路零泄露。
    - `publish_data` 普通异常仅记静态警告并继续 `disconnect`。
    - `disconnect` 异常原样传播。
    - `publish_data` 抛出 `CancelledError` 原样传播且 `disconnect` 调用次数为 0。
  - 验证两个包装入口真实委托同一共享函数，且各自模块符号可独立 patch。
- `backend/tests/test_agent_errors.py` 与 `backend/tests/test_job_orchestrator.py`：
  - 全部既有 entrypoint、orchestrator 与错误分类回归保持通过，并补充 `CancelledError` 零断连断言。

## 4. 验证范围与未验边界

- 上述单元测试均基于离线 Mock `JobContext` 验证，不等同于真实 LiveKit Cloud / WebRTC DataChannel 环境验收。
- `agent.py` 顶层 `sys.path` / `dotenv` 清理及真实 SDK 联调仍待后续子项完成，`TODO.md` 中 RF-09 整项保持未勾选。
