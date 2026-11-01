# RF-10 LLM 静态元数据单一来源验证

> 实施日期：2026-10-26
> 代码分支：`codex/rf10-provider-catalog`
> 对应任务：A50 / RF-10 LLM 静态元数据单一来源（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF10“统一 Provider 能力/模型/凭据/验证元数据”与 A50 冻结契约：

1. **消除重复与单一来源**：将散落在 `livekit_agent/plugin_factory.py`（`LLM_PROVIDER_BASE_URL`、`_SYSTEM_LLM_KEY_FIELD`）、`services/llm_service.py`（`PROVIDER_CONFIG`）及 `services/validation_service.py`（`validate_llm_key` 端点表）中的重复 LLM Provider 静态配置，统一收敛至标准库不可变模块 `provider_catalog.py`。
2. **纯净标准库与不可变性**：`provider_catalog.py` 仅使用纯 Python 标准库（`dataclasses.dataclass(frozen=True)`、`types.MappingProxyType`），同时保护 mapping 与 entry 不可篡改；不存任何 key 值、不读取 `os.environ`、不导入 SDK/config/crypto/DB、不做网络或文件 I/O。
3. **消费者接口与恒定语义保持**：
   - 保留两家现有 Provider 及其顺序：`"siliconflow"`、`"openrouter"`。
   - 保留现有常量：SiliconFlow（base `https://api.siliconflow.cn/v1`，keyfield `SILICONFLOW_API_KEY`，validate `https://api.siliconflow.cn/v1/user/info`）；OpenRouter（base `https://openrouter.ai/api/v1`，keyfield `OPENROUTER_API_KEY`，validate `https://openrouter.ai/api/v1/auth/key`）。
   - 保留三个消费者原导出变量名（`LLM_PROVIDER_BASE_URL`、`SUPPORTED_LLM_PROVIDERS`、`_SYSTEM_LLM_KEY_FIELD`、`PROVIDER_CONFIG`）、dict/set 类型及顺序。
   - LLM 验证请求 Bearer Header、超时、重试、错误分类及对空 key / 未知 provider 的短路拒绝行为严格保持。
4. **P2 最小兼容继承**：恢复 `api.ts` 对合法空嵌套 message（`{detail: {message: ""}}` 及包含额外非错误字段）的 `JSON.stringify` 兜底回退，同步更新测试用例与验证文档。

## 2. 本地实现与变更

### 2.1 新增标准库不可变目录 (`backend/provider_catalog.py`)

- 定义不可变条目 `LLMProviderMetadata(id, base_url, api_key_field, validation_url)`（`frozen=True`）。
- 定义私有字典并以 `MappingProxyType` 导出不可变映射 `LLM_PROVIDER_CATALOG`。
- 提供只读查询函数 `get_llm_provider(provider_id: str) -> LLMProviderMetadata | None`。
- 零第三方依赖，零运行时副作用。

### 2.2 改造三大消费者接入单一来源

1. `backend/livekit_agent/plugin_factory.py`：
   - `LLM_PROVIDER_BASE_URL`、`SUPPORTED_LLM_PROVIDERS`、`_SYSTEM_LLM_KEY_FIELD` 统一派生自 `LLM_PROVIDER_CATALOG`。
   - 保留原导出变量名、类型与插入顺序。
2. `backend/services/llm_service.py`：
   - `PROVIDER_CONFIG` 统一派生自 `LLM_PROVIDER_CATALOG`。
   - 保留原字典结构与键名。
3. `backend/services/validation_service.py`：
   - `validate_llm_key` 改由 `LLM_PROVIDER_CATALOG.get(provider)` 获取验证端点 URL，统一组装 Bearer 认证 Header。
   - 未知 provider 立即短路返回 `unsupported_provider`，空 key 保持 `missing_key` 短路，零多余网络请求。

### 2.3 质量与回归测试

- 新增 `backend/tests/test_provider_catalog.py`：
  - 验证 Catalog 内容、字段值及硅基流动与 OpenRouter 的顺序。
  - 验证 Mapping 与 Entry 的不可变性（篡改抛出 `TypeError` / `FrozenInstanceError`）。
  - 验证三大消费者（`plugin_factory`、`llm_service`、`validation_service`）元数据严格接线一致。
  - 验证未知 provider 与空 key 的零网络调用保护。
  - 验证在完全无凭据的纯净子进程中可独立安全导入，且零 SDK/业务依赖加载。
- 对应旧测试文件（`test_plugin_factory.py`、`test_llm_service.py`、`test_validation_service.py`）追加派生来源一致性断言，完整保留全部既有用例。

## 3. 边界与未验界限

- 本轮仅针对 LLM 静态元数据单一来源收敛（RF-10 子项），未勾选 RF-10 整体。
- STT/TTS 静态元数据尚未收敛至 Catalog；多 Provider 验证并行与超时控制仍待后续实现。
- 用户设置 schema、模型能力与默认值定义、前端展示配置保持只读。
