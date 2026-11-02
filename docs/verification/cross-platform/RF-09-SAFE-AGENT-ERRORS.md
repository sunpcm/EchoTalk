# RF-09 Agent 安全错误映射与出口边界验证

> 实施日期：2026-10-25
> 代码分支：`codex/rf09-safe-agent-errors`
> 对应任务：A42 / RF-09 Agent 安全错误映射（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF03（禁止日志、异常、响应输出明文密钥）与 §RF09（建立 `AgentErrorMapper`），结合 [Phase 5 技术架构](../../PHASE_5_TECH_STACK.md) §5 DataChannel 错误协议及 [CP-06 安全诊断一期](./CP-06-SAFE-DIAGNOSTICS.md) 控制台白名单规范落地本地实施。

此前 `agent.py` 存在以下安全隐患：

1. 入口日志读取 LiveKit SDK 私有属性 `ctx._info.url`（私有且可能包含内网敏感地址或凭据参数），并直接输出未脱敏的原始 `participant.identity`。
2. 在捕获 `_fetch_user_settings` 异常、运行时 `on_agent_error` 及 `agent_session.start` 异常时，将包含原始异常正文与 `exc_info=True` 写入日志。
3. 自定义轨不可恢复错误及管线启动失败时，直接使用 `f"自定义 API 服务请求失败: {actual_exception}"` 将动态异常正文送入 DataChannel 消息，可能向客户端泄露内部堆栈、URL 或密钥。
4. DataChannel publish 失败时日志记录 `exc_info=True`。

## 2. 本地实现与安全边界

### 2.1 AgentErrorMapper (`backend/livekit_agent/error_mapper.py`)

- **纯标准库与零副作用**：纯函数优先，无数据库、dotenv、插件构建或网络访问副作用。
- **固化既有 9 项错误码全集**：
  - `ERR_CUSTOM_KEY_INVALID`
  - `ERR_UNSUPPORTED_STT_PROVIDER`
  - `ERR_UNSUPPORTED_LLM_PROVIDER`
  - `ERR_UNSUPPORTED_TTS_PROVIDER`
  - `ERR_SYSTEM_CONFIG`
  - `ERR_SESSION_NOT_FOUND`
  - `ERR_CUSTOM_RUNTIME_AUTH`
  - `ERR_CUSTOM_RUNTIME`
  - `ERR_SYSTEM_RUNTIME`
- **静态安全本地化文本映射**：每项错误码映射至自包含、无动态插值的静态中文安全指引，任何未知/恶意 code 均安全降级为兜底安全码，绝不向客户端回显 raw 文本片段。
- **运行时错误安全分类**：
  - 自定义轨 typed `APIStatusError` 与 legacy 文本线索分支严格互斥：typed 401/403 分类为 `ERR_CUSTOM_RUNTIME_AUTH`；typed 429/500 正文即使包含 401/403/unauthorized 也绝不误判为 AUTH。
  - 普通非 APIStatusError 异常文本包含 401/403/unauthorized 判定为 `ERR_CUSTOM_RUNTIME_AUTH`。
  - 自定义轨不可恢复错误（`recoverable is False`）映射为 `ERR_CUSTOM_RUNTIME`。
  - 自定义轨可恢复错误（`recoverable is True`）与基础轨所有运行时错误返回 `None`，交由 SDK 原生处理，零额外断连与通知。
  - 异常 `__str__` 抛错时提供安全兜底，不扩散异常。
- **严格字段净化辅助函数**：
  - `sanitize_session_id`：严格校验标准 UUID 格式，非法值/恶意注入统一返回 `"unknown"`。
  - `extract_status_code`：仅提取 100..599 整数范围内的 HTTP 状态码。
  - `sanitize_bool`：严格校验布尔类型。
  - `sanitize_error_type`：限制在安全类型白名单（`unknown`, `connection`, `runtime`, `audio`, `stt`, `llm`, `tts`, `vad`）。

### 2.2 最终发送入口与 Agent 内部日志脱敏 (`backend/livekit_agent/agent.py`)

- **守住最终发送出口**：`_send_error_and_disconnect` 自身强制调用 `AgentErrorMapper.map_error`，确保实际发送的 payload 严格满足 `{"type": "agent_error", "code": safe_code, "message": safe_message}`，保持 `topic="agent_error"` 与 `reliable=True`。普通 publish 异常由局部捕获并记录静态脱敏警告（无 `exc_info`），随后安全尝试断开房间连接；disconnect 失败与取消异常正常向上传播。
- **清除私有属性与原始身份**：入口日志仅记录经合法 UUID 校验的 `safe_session_id`，彻底移除对 `ctx._info.url` 的访问；参与者加入日志仅记录 `"参与者已加入房间: session=%s"`，不输出任意原始 `participant.identity`。
- **消除异常泄露**：移除全部自有日志中的异常 str/repr、`exc_info=True` 与动态异常类名，仅输出经净化的枚举/UUID/布尔/HTTP 状态。

## 3. 本地质量验证与回归覆盖

### 3.1 覆盖范围

1. **纯 Mapper 单元测试 (`backend/tests/test_agent_errors.py`)**：
   - 9 项已知错误码完备性、无插值占位符及映射验证。
   - 未知/恶意错误码安全降级及 Canary 隔离验证。
   - 自定义轨 typed APIStatusError 与文本分支互斥、429/500 正文含 401 不误判 AUTH 验证。
   - 自定义轨与基础轨运行时异常分类规则验证。
   - 字段净化辅助函数边缘输入与异常容错验证。
2. **真实入口离线 Mock 回归 (`backend/tests/test_agent_errors.py`)**：
   - 挂载 `ExplodingPrivateInfo` 属性探针，证实 `entrypoint` 绝不读取 `ctx._info.url`。
   - 使用自定义 `AssertNoCanaryHandler` 在 DEBUG 级别下严格审查捕获的全部 `echotalk-agent` 日志全字段（包括 args/extra/exc_info/stack_info），证实全流程零 Canary 泄露且 exc_info/stack_info 为 None。
   - 覆盖 settings 查库异常（`ERR_SESSION_NOT_FOUND`）、settings 为 None（`ERR_SESSION_NOT_FOUND`）、自定义插件构建异常（`ERR_CUSTOM_KEY_INVALID`）、管线启动异常（custom: `ERR_CUSTOM_RUNTIME`, system: `ERR_SYSTEM_RUNTIME`）。
   - 覆盖真实注册的 `on_agent_error` 回调执行矩阵（typed 401/403、typed 500/429 × recoverable True/False、普通文本、基础轨零动作），采用确定性 Task 屏障（无任意 sleep）。
   - 覆盖 `_send_error_and_disconnect` 恶意输入拦截、publish 失败后依然 disconnect、disconnect 失败正常向上传播以及 CancelledError 取消异常正常向上传播。
3. **保持既有测试语义**：`backend/tests/test_livekit_agent.py` 原 4 项 assistant 消息转录测试语义保持完整。

## 4. 边界与未验界限

1. **RF-09 整体仍未完成**：本轮仅落地 AgentErrorMapper 安全错误映射与出口边界；`AgentJobOrchestrator`、`CredentialResolver`、`ProviderRegistry`、`TranscriptSink` 拆分、`sys.path` 注入清理、导入期 `.env` 清理及进程环境变量操作清理仍待后续子任务推进。
2. **外部服务未验**：未连接真实 LiveKit Server、未访问真实 Deepgram / SiliconFlow / Cartesia / OpenRouter 等第三方外部 Provider，未进行真机音频测试。
3. **SDK 自有日志边界**：本次改造严格保证 `echotalk-agent` 应用级日志与 DataChannel 出口安全脱敏；第三方 LiveKit SDK 自身的内部日志行为不由本轮证明全部脱敏。
