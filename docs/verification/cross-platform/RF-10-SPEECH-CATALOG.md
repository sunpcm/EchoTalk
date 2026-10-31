# RF-10 STT/TTS 静态元数据单一来源验证

> 实施日期：2026-10-26
> 代码分支：`codex/rf10-speech-catalog`
> 对应任务：A53 / RF-10 STT/TTS 静态元数据单一来源（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF10“统一 Provider 能力/模型/凭据/验证元数据”与 A53 冻结契约：

1. **消除配置分散与单一来源**：在 A50 已落地的纯标准库不可变 `provider_catalog.py` 基础上，补齐当前系统中现有的语音提供商（STT Deepgram 与 TTS Cartesia）静态元数据，使 `plugin_factory.py` 的支持集合（`SUPPORTED_STT_PROVIDERS`、`SUPPORTED_TTS_PROVIDERS`）与 `validation_service.py` 语音拨测端点（`validate_stt_key`、`validate_tts_key`）从统一不可变 Catalog 派生。
2. **纯净标准库与不可变性**：
   - 仅依赖 Python 标准库（`dataclasses.dataclass(frozen=True)`、`types.MappingProxyType`）。
   - 映射、条目及 Header 描述均不可变，杜绝运行时篡改。
   - Catalog 内部绝不存储真实 API Key，不读取 `os.environ`，不加载 SDK/网络/配置模块。
3. **消费者接口与恒定语义保持**：
   - STT 仅支持 `"deepgram"`：验证 URL 为 `GET https://api.deepgram.com/v1/projects`，Authorization Header 为 `"Token " + api_key`。
   - TTS 仅支持 `"cartesia"`：验证 URL 为 `GET https://api.cartesia.ai/voices`，X-API-Key Header 为 `api_key`，附加只读 Header `Cartesia-Version: 2024-06-10`。
   - `SUPPORTED_STT_PROVIDERS` 与 `SUPPORTED_TTS_PROVIDERS` 保持 `set[str]` 导出类型与原始值。
   - `PluginFactory` 显式 `cleaned_key` 构造 SDK 顺序与参数不变，系统默认 provider/key 字段不变。
   - 未知 provider 优先返回 `unsupported_provider`，空 key 保持 `missing_key` 短路且零外部网络调用；8 秒超时、错误分类映射、脱敏日志及 LLM 既有行为严格保持。
4. **跨请求凭据防污染隔离**：
   - Catalog 提供 `build_validation_headers(api_key)`，每次调用生成全新、独立的 Header 字典。
   - 保证两次不同 key 调用互不污染，外部修改返回值不影响 Catalog 内部状态或后续调用。

## 2. 本地实现与变更

### 2.1 扩展标准库不可变目录 (`backend/provider_catalog.py`)

- 新增不可变数据类 `STTProviderMetadata` 与 `TTSProviderMetadata`（`frozen=True`），声明 `id`、`api_key_field`、`validation_url`、`auth_header_name`、`auth_header_prefix` 与只读映射 `static_headers`（`MappingProxyType`）。
- 注册私有字典 `_STT_PROVIDERS`（包含 `deepgram`）与 `_TTS_PROVIDERS`（包含 `cartesia`），以 `MappingProxyType` 导出不可变映射 `STT_PROVIDER_CATALOG` 与 `TTS_PROVIDER_CATALOG`。
- 导出只读查询函数 `get_stt_provider(provider_id: str)` 与 `get_tts_provider(provider_id: str)`。
- 实现 `build_validation_headers(api_key: str) -> dict[str, str]` 方法，根据静态配置与传入 key 生成独立字典，无内部状态驻留。

### 2.2 改造语音消费者接入单一来源

1. `backend/livekit_agent/plugin_factory.py`：
   - `SUPPORTED_STT_PROVIDERS` 改为由 `set(STT_PROVIDER_CATALOG.keys())` 派生。
   - `SUPPORTED_TTS_PROVIDERS` 改为由 `set(TTS_PROVIDER_CATALOG.keys())` 派生。
   - 保持 `set[str]` 导出类型与值不变。
2. `backend/services/validation_service.py`：
   - `validate_stt_key` 改由 `STT_PROVIDER_CATALOG.get(provider)` 查询，未知短路返回 `unsupported_provider`，已知则使用 `meta.validation_url` 与 `meta.build_validation_headers(api_key)` 执行拨测。
   - `validate_tts_key` 改由 `TTS_PROVIDER_CATALOG.get(provider)` 查询，同样具备未知短路与独立 Header 生成。
   - 空 key 在 `_validate` 处立即返回 `missing_key`，零网络请求。

### 2.3 质量与回归测试

1. `backend/tests/test_provider_catalog.py`：
   - 验证 STT/TTS Catalog 结构、键名集合与确切属性值。
   - 验证 Catalog Mapping、条目自身以及 `static_headers` 映射的全方位不可变性（篡改触发 `TypeError` / `FrozenInstanceError`）。
   - 验证 `PluginFactory` 与 `validation_service` 的消费者接线严格一致。
   - 验证 `build_validation_headers` 凭据隔离：两次不同 key 调用生成独立实例，修改一处不污染另一处及 Catalog 内部；元数据实例不保留 key 字符串。
   - 验证不支持的 provider 及空 key 均实现短路返回，零网络调用。
   - 验证在纯净子进程隔离环境中导入，零 SDK（livekit/deepgram/cartesia 等）及业务模块副作用。
2. `backend/tests/test_plugin_factory.py`：
   - 增加 `test_speech_metadata_derived_from_catalog`，验证集合类型与派生一致性。
3. `backend/tests/test_validation_service.py`：
   - 增加 `test_validate_speech_keys_derived_from_catalog`，逐 Provider 验证拨测 URL 与 Headers，并测试多调用独立性。

## 3. 边界与未验界限

- 本轮仅收敛现有 Deepgram 与 Cartesia 静态元数据（RF-10 子项），未勾选 RF-10 整体。
- 多 Provider 并行拨测与总超时控制、Provider Registry 动态注册机制仍待后续实现。
- 用户设置持久化、BYOK 凭据模型及前端展示仍保持现状。
- 未连接真实外部 Provider 网络，未修改真实依赖环境。
