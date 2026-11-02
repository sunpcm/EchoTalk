# RF-09 自定义凭据解析边界 (CredentialResolver) 验证

> 实施日期：2026-10-25
> 代码分支：`codex/rf09-credential-resolver`
> 对应任务：A45 / RF-09 提取自定义凭据解析边界（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF03（秘密不入日志与响应、版本化密钥解密）与 §RF09（提取 `CredentialResolver` 边界），落实本地单轮实施：

1. **统一异常隔离**：将 `PluginInitError` 抽离至无 SDK、无网络依赖的标准库模块 `backend/livekit_agent/plugin_errors.py`，`plugin_factory.py` 保持向后兼容导出，保证类身份单一（`is` 恒真）与异常捕获兼容。
2. **凭据解析边界**：新增 `backend/livekit_agent/credential_resolver.py`，提供 `CredentialResolver.resolve_custom(user_settings, default_llm_model)`，生成不可变 `ResolvedCustomCredentials` 快照。
3. **安全脱敏与日志保护**：明文密钥字段显式标记 `repr=False` 并实现安全 `__repr__` / `__str__`（展示为 `***`），禁止记录、持久化或序列化明文、密文及 key_version。
4. **严格预检与零解密契约**：严格保持 6 项必填预检顺序（`stt_provider` -> `llm_provider` -> `tts_provider` -> `encrypted_stt_key` -> `encrypted_llm_key` -> `encrypted_tts_key`），未齐备前零解密、零 factory 构造。
5. **解密失败收束**：按 STT、LLM、TTS 顺序依次解密，任一解密失败立即抛出静态安全 `ERR_CUSTOM_KEY_INVALID`，终止后续解密，不泄露底层异常正文或密钥。
6. **双轨生命周期与环境隔离**：基础轨完全不走 resolver、不读取加密字段；自定义轨通过 resolver 预检解密后传参给 `PluginFactory`，敏感系统环境变量临时清除并在 `finally` 中严格恢复。

## 2. 本地实现与模块架构

### 2.1 统一异常定义 (`backend/livekit_agent/plugin_errors.py`)

- 纯 Python 标准库类，无 LiveKit SDK、无配置模块、无网络依赖。
- 逐字保持原有 `code` 与 `message` 字段及 `[code] message` 字符串格式。

### 2.2 凭据解析器 (`backend/livekit_agent/credential_resolver.py`)

- `ResolvedCustomCredentials`：不可变 frozen dataclass，封装 3 个 provider 字符串、3 个明文 key（repr=False）、以及 model。
- `CredentialResolver.resolve_custom`：
  - 严格 6 项必填前置校验。
  - 透传各自存储的 `key_version`（含 None legacy 标记）调用 `utils.crypto.decrypt_api_key`。
  - 模型回退契约：优先使用 `user_settings.llm_model`，缺失时使用 `default_llm_model`。
  - 纯净依赖：禁止导入 `livekit` SDK、`PluginFactory` 或 `Agent`，不构造插件实例，不改动环境变量。

### 2.3 生产接入 (`backend/livekit_agent/agent.py` & `plugin_factory.py`)

- `plugin_factory.py` 导入并导出 `PluginInitError`，原有 factory 构造参数与逻辑保持只读。
- `agent.py` 移除内部重复的 6 项校验与 3 次解密，`_build_custom_plugins` 接入 `CredentialResolver.resolve_custom`，保留原有敏感系统环境变量防护。
- `entrypoint` 接入保持：基础轨零 resolver / 零 decrypt；自定义轨安全捕获解析失败并向客户端推送安全的错误码及断连。

## 3. 质量验证与覆盖

### 3.1 覆盖范围 (`backend/tests/test_credential_resolver.py` & `test_plugin_factory.py`)

1. **必填 6 种缺失快速失败**：分别验证 3 个 provider 及 3 个 encrypted key 缺失，抛出 `ERR_CUSTOM_KEY_INVALID` 且解密零调用。
2. **预检顺序验证**：验证 provider 缺失早于 encrypted key 缺失报错。
3. **解密失败 3 处位置终止**：STT / LLM / TTS 解密失败时后续解密与 factory 零调用，底层异常正文不泄露。
4. **版本透传验证**：验证各自 key_version（含 None legacy 值）原样透传至 `decrypt_api_key`。
5. **模型与 Provider 提取**：验证 custom model 与 default fallback、Enum.value 提取、不可变快照及原配置无副作用。
6. **Canary 脱敏与安全日志**：注入 `CANARY_KEY`，验证 repr/str 及 logging 输出绝对不含敏感明文。
7. **`_build_custom_plugins` 真实联动**：验证正常传参、resolver 失败零 factory 调用、factory 构造异常环境完整恢复。
8. **双轨 entrypoint 隔离**：基础轨使用 `ExplodingEncryptedSettings` 证实零 encrypted 访问与零 resolver；自定义轨捕获安全错误码。
9. **类身份与异常捕获兼容**：验证 `agent.PluginInitError is plugin_factory.PluginInitError is plugin_errors.PluginInitError` 且 catch 互通。
10. **模块纯洁性验证**：验证 `credential_resolver` 与 `plugin_errors` 命名空间无 LiveKit SDK 或 PluginFactory 泄漏。

## 4. 边界与未验界限

- 本轮仅完成自定义轨凭据解析与异常类抽离（RF-09 子项），未勾选 RF-09 整体。
- 未重构 `ProviderRegistry`、未进行 `sys.path` / dotenv 改造、未升级 SDK。
- 不访问真实外部 Provider API，不连接外部网络，仅在隔离测试环境核验。
