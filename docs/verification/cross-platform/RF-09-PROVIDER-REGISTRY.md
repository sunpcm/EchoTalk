# RF-09 ProviderRegistry 插件集构造收口验证

> 实施日期：2026-10-26
> 代码分支：`codex/rf09-provider-registry`
> 对应任务：A48 / RF-09 LiveKit Agent ProviderRegistry 插件集构造收口（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF09“拆分 LiveKit Agent：ProviderRegistry 承担 Provider 能力和插件构造”与 A48 冻结契约：

1. **构造收口与纯净边界**：新增独立 `backend/livekit_agent/provider_registry.py`，提供 `ProviderRegistry.from_custom(resolved: ResolvedCustomCredentials)` 与 `ProviderRegistry.from_system_defaults()` 收口双轨插件集组织。
2. **零 ORM / 零解密 / 零环境改写**：`ProviderRegistry` 仅接收已解密的不可变快照 `ResolvedCustomCredentials`。不接触 ORM 对象（非 snapshot 输入抛出 `TypeError`），不自行解密，不改写进程环境变量，不自行兜底配置。实际插件实例创建严格委托 `PluginFactory.create_*` 与 `PluginFactory.from_system_defaults()`。
3. **严格构造顺序与失败短路**：自定义轨插件构造严格遵循 `STT → LLM → TTS → VAD` 顺序。若前序角色构造抛出异常（如 `PluginInitError`），后续角色构造严格零调用并立即短路向上抛出。
4. **参数归属防串扰与完整四键契约**：STT、LLM、TTS 各角色 API Key 及模型严格按角色归属，互不串扰。返回值严格为四键字典 `{"stt": ..., "llm": ..., "tts": ..., "vad": ...}`。
5. **Agent 委托与基础轨隔离**：`agent.py` 移除直接 `PluginFactory` 导入；`_build_custom_plugins` 在 `CredentialResolver.resolve_custom` 之后完全委托 `ProviderRegistry.from_custom`；基础轨 `entrypoint` 直接调用 `ProviderRegistry.from_system_defaults()`，基础轨零用户凭据、零解密、零 `CredentialResolver` 依赖。
6. **变异抵御能力**：针对 wrong-role key（错误传递角色 Key）与漏构造某角色（漏调某角色构造器或返回缺失 key），测试必须可确定性检测并使其失败。

## 2. 本地实现与变更

### 2.1 新增 `backend/livekit_agent/provider_registry.py`

- 声明 `ProviderRegistry` 类。
- `from_custom(resolved)`：校验 `isinstance(resolved, ResolvedCustomCredentials)`，依次调用 `PluginFactory.create_stt`、`create_llm`、`create_tts`、`create_vad` 并返回完整四键字典。
- `from_system_defaults()`：直接委托并返回 `PluginFactory.from_system_defaults()`。
- 无 SDK 直接导入，无网络调用，纯净无状态边界。

### 2.2 重构 `backend/livekit_agent/agent.py`

- 移除未使用的 `from livekit_agent.plugin_factory import PluginFactory`，引入 `from livekit_agent.provider_registry import ProviderRegistry`。
- `_build_custom_plugins` 委托 `ProviderRegistry.from_custom(resolved)`。
- `entrypoint` 基础轨委托 `ProviderRegistry.from_system_defaults()`。

### 2.3 适配既有测试 (`backend/tests/test_credential_resolver.py`)

- 将 `agent.PluginFactory.*` 的 patch 路径平移更新至已迁移的 `livekit_agent.provider_registry.PluginFactory.*`。
- 完整保留原有 20 项断言，未削减任何断言或测试用例。

### 2.4 新增回归测试 (`backend/tests/test_provider_registry.py`)

新增 8 个独立回归测试用例，覆盖：

1. **角色归属与防串扰**：验证 `stt_key`、`llm_key`、`tts_key`、`model` 准确传入对应构造器，显式断言其他角色的 key 绝未传入。
2. **变异防御**：针对 wrong-role key 与漏构造某 role 进行精准断言。
3. **构造顺序与失败短路**：验证 STT → LLM → TTS → VAD 调用顺序，以及 STT/LLM/TTS 任一环节抛错时后续构造器零调用。
4. **输入严格类型校验**：传入非 `ResolvedCustomCredentials`（如 ORM、dict、None 等）抛出 `TypeError`。
5. **基础轨委托**：验证 `from_system_defaults` 准确委托 `PluginFactory`，零自定义凭据读取。
6. **Agent 联动与 entrypoint 消费**：双轨分别验证真实包装与消费。
7. **环境变量不变性与脱敏**：调用前后 `os.environ` 严格不变，日志中绝不含 Canary 密钥。

## 3. 边界与未验界限

- 本轮仅完成自定义与基础轨插件集构造收口至 `ProviderRegistry`（RF-09 子项），未勾选 RF-09 整体。
- `AgentJobOrchestrator` 拆分、`sys.path` / `dotenv` 重构、真实 SDK 大版本升级仍待后续完成。
- 所有测试均基于纯 Mock 环境（无真实网络、无第三方 API 请求、无模型下载）。
