# RF-10 多 Provider 有界并行验证

> 实施日期：2026-10-27
> 代码分支：`codex/rf10-bounded-parallel-validation`
> 对应任务：A55 / RF-10 多 Provider 有界并行验证（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF-10“多个独立 Provider 需要验证时可以并行执行，但必须限制总超时”与 A55 冻结行为契约：

1. **可复用有界并行验证入口**：
   - `backend/services/validation_service.py` 提供 `ProviderValidationService.validate_parallel(validations, *, total_timeout=None)`。
   - 输入按 STT、LLM、TTS 的确定顺序组织，仅包含确实需要拨测的 `(role, provider, key)`。
   - 输出严格按输入顺序稳定映射为 `dict[str, ProviderValidationResult]`。
2. **统一总预算与单请求超时**：
   - 类常量 `TOTAL_TIMEOUT_SECONDS = 10.0` 限制整批独立验证的总耗时，不为每个 role 串行累加 10 秒。
   - 单次 HTTP 拨测 `REQUEST_TIMEOUT_SECONDS = 8.0` 保持不变。
3. **总预算到期与任务收束**：
   - 使用标准库 `asyncio` 并发执行。
   - 总预算到期时：保留已完成 role 的真实 `ProviderValidationResult`；所有未完成 role 统一返回 `ProviderValidationResult(False, "timeout")`。
   - 对所有 pending task 执行 `cancel()` 并 `await asyncio.gather(*pending, return_exceptions=True)`，禁止遗留后台任务或未等待告警。
4. **未捕获编程异常清理与重抛**：
   - 任一底层验证出现未被既有 `validate_*` 捕获的异常时，先取消并等待本批其余任务完成（同时消费全部已结束任务的异常以防未检索告警），再原样抛出首个异常；不吞掉异常、不伪装成功、不记录敏感内容。
5. **设置路由惰性解密边界与稳定响应顺序**：
   - `backend/routers/user.py::_validate_provider_keys` 仅调度 A54 判定为 changed 且同时具有 provider 与 key 的 role。
   - 未变化 role 保持零旧密文读取、零解密、零轮换、零拨测并复用原 `is_valid`。
   - 变化但缺 provider/key 的 role 保持 invalid 且不创建空拨测任务。
   - 响应中的 422 `detail.providers` 严格按 STT → LLM → TTS 顺序构造，不受并发完成先后顺序影响。
6. **`validate_all` 布尔兼容与并行复用**：
   - `ProviderValidationService.validate_all` 复用 `validate_parallel`，保持 `bool` 返回值兼容；任一 role 失败或超时返回 `False`。

## 2. 本地实现与测试覆盖

### 2.1 服务层与路由层实现

- `backend/services/validation_service.py`：定义 `TOTAL_TIMEOUT_SECONDS = 10.0`，实现 `validate_parallel` 并重构 `validate_all` 复用该入口。
- `backend/routers/user.py`：`_validate_provider_keys` 收集需拨测的 `(role, provider, key)` 列表后调用 `ProviderValidationService.validate_parallel`，并按 `("stt", "llm", "tts")` 固定顺序汇总有效性与 `validation_failures`。

### 2.2 自动化回归测试

- `backend/tests/test_settings_parallel_validation.py`（新增 4 项集成回归）：
  1. `test_three_roles_enter_in_parallel_with_barrier`：使用 `asyncio.Barrier(3)` 证明 STT、LLM、TTS 三路校验并行进入，非串行等待。
  2. `test_reverse_completion_order_preserves_failure_order`：使用 `asyncio.Event` 强制按 TTS → LLM → STT 逆序完成，验证 422 `detail.providers` 键顺序仍严格为 `["stt", "llm", "tts"]`。
  3. `test_total_timeout_preserves_completed_and_cancels_pending`：验证总预算超时下已完成的 STT/LLM 保持成功（不进入 failures），挂起的 TTS 标记为 `"timeout"` 且任务被取消并等待收束。
  4. `test_single_role_and_zero_role_no_extra_tasks`：验证零 role、单 role 及缺 key 的变化 role 不产生多余拨测任务。
- `backend/tests/test_validation_service.py`（扩展 5 项单测）：
  - 覆盖 `validate_parallel` 空输入、事件驱动逆序完成下的稳定输出顺序、总超时保留已完成结果并清理 pending 任务、意外异常先清理 pending 再原样重抛，以及 `validate_all` 并发 Barrier 验证与 `bool` 返回兼容。
- `backend/tests/test_settings_lazy_decryption.py`：
  - 更新第 7 项顺序测试注释，明确其验证确定性调度顺序与 422 响应顺序，保留全部 7 项惰性解密断言。

## 3. 边界与未验界限

- 本轮完成 RF-10 多 Provider 有界并行验证与统一总超时子项，RF-10 整项保持未勾选。
- 所有测试均使用本地 Mock/Event/Barrier，未发起真实外部 Provider 网络请求。
