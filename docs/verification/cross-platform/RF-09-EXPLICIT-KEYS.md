# RF-09 自定义插件显式凭据构造与零进程环境改写验证

> 实施日期：2026-10-25
> 代码分支：`codex/rf09-explicit-keys`
> 对应任务：A46 / RF-09 移除自定义插件构造的进程环境变量临时删除（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF09“无敏感环境变量临时删除”与 A46 冻结契约：

1. **零进程环境变量改写**：彻底移除 `backend/livekit_agent/agent.py` 中的 `import os`、`_SENSITIVE_ENV_VARS` 敏感环境变量列表，以及 `_build_custom_plugins` 内对 `os.environ` 的 `pop()` / `update()` 操作。构造全流程实现零 `os.environ` 写，杜绝并发竞争与环境污染隐患。
2. **显式凭据直连构造**：`CredentialResolver.resolve_custom` 产出的不可变凭据直接显式传参给 `PluginFactory` 对应的 `create_stt`、`create_llm`、`create_tts` 与 `create_vad`。
3. **Fail-Closed 防御保障**：基于冻结 SDK 源码核验与 PluginFactory `_validate_api_key` 既有校验规则（严格拒绝非 str、空串、全空白、包含 `\n`/`\r`/`\x00` 危险字符并返回 strip 后的 clean key），非法凭据直接在 Factory 阶段阻断并抛出静态安全 `ERR_CUSTOM_KEY_INVALID`，绝不回退或降级读取系统环境变量。
4. **角色隔离与安全归属**：STT、LLM、TTS 三角色的 key 归属严格隔离，互不串扰。
5. **基础轨不变**：基础轨 `PluginFactory.from_system_defaults()` 保持读取系统配置，所有已有安全与生命周期契约完全保持。

## 2. 本地实现与变更

### 2.1 `backend/livekit_agent/agent.py` 精简

- 移除 `import os`（经全局审计，模块内无其他 `os` 使用）。
- 移除全局常量 `_SENSITIVE_ENV_VARS` 定义及注释。
- `_build_custom_plugins` 移除 `saved_env` 保存、`os.environ.pop` 临时清除及 `finally: os.environ.update` 恢复块，直接由 `CredentialResolver` 解析后返回各 `PluginFactory.create_*` 构建结果。

### 2.2 测试适配与 A45 P2 修复 (`backend/tests/test_credential_resolver.py`)

- 移除对已删除 `_SENSITIVE_ENV_VARS` 常量的 import。
- 改为使用本地明确的 `SYNTHETIC_SENSITIVE_ENV_VARS` 列表。
- 使用 `patch.dict(os.environ, ..., clear=False)` 进行精确环境隔离测试，彻底修复 A45 遗留的直接修改 `os.environ` 并通过 finally pop 可能破坏既有环境变量的 P2 问题。

### 2.3 新增全面回归测试 (`backend/tests/test_agent_explicit_keys.py`)

新增 8 个独立回归测试用例，覆盖：

1. **调用期间环境变量不变**：5 项敏感环境变量均存在时，各 SDK constructor 调用瞬间捕获的环境变量逐键逐值与系统环境一致，SDK 接收到净化后的 custom key 而非 env key。
2. **部分环境变量缺失**：敏感环境变量部分未设置时，构造期间与构造后保持缺失，不补写任何临时变量或默认值。
3. **异常流程环境不变**：resolver 预检/解密失败、中间 role 失败抛错场景下，环境变量前中后保持不变，且后续 role 零调用。
4. **非法 Key 矩阵拒绝**：所有 role 传入非法 key（None、空、全空白、换行、回车、null、非 str）时，在系统 env 存在的情况下依然安全失败关闭，不降级回退读取系统 key。
5. **并发与嵌套构造**：嵌套两个不同用户的自定义配置构造，互不影响 env 和 key 归属，无全局状态串扰。
6. **OpenRouter 与模型选择**：覆盖 OpenRouter 提供商及首尾空白清洗、自定义模型透传。
7. **全链路 Canary 脱敏审计**：注入 Canary 敏感密钥，验证 logging 记录全字段（message、args、extra 等）零泄漏。
8. **基础轨生命周期保持**：验证 `PluginFactory.from_system_defaults()` 正常工作，与自定义轨严格隔离。

## 3. 边界与未验界限

- 本轮仅完成自定义插件构造显式传参及进程环境变量修改移除（RF-09 子项），未勾选 RF-09 整体。
- 不进行 `ProviderRegistry` 拆分、不进行 `sys.path` / `dotenv` 重构、未升级第三方 SDK。
- 不访问真实外部 Provider API，不进行真实网络请求或模型文件下载，仅在隔离本地测试环境验证。
