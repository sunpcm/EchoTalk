# RF-10 用户设置凭据惰性解密验证

> 实施日期：2026-10-26
> 代码分支：`codex/rf10-lazy-key-decryption`
> 对应任务：A54 / RF-10 用户设置凭据惰性解密（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF10“非敏感设置不解密旧凭据”与 A54 冻结契约：

1. **非敏感更新与旧密文解密彻底解耦**：用户更新设置时（`PUT /api/user/settings`），主题、模型偏好等非敏感设置不得因为旧密钥无法解密而更新失败。此前 `_validate_provider_keys` 在执行任何更新前无条件解密三路凭据（`_decrypt_and_rotate`），导致旧密文损坏或版本未配置时非敏感更新失败。
2. **Role 变化严格判定**：
   - 先行判定各 role（STT、LLM、TTS）是否发生变化：`body.provider is not None and body.provider != old_provider` 或 `body.key is not None`。
   - 同 provider 原值重复提交或未传递 provider/key 均不构成变化。
3. **未变化 Role 零副作用**：
   - 零读取、零解密、零轮换旧密文。
   - 零 Provider 外部拨测调用。
   - 完整复用数据库中既有的 `is_valid` 状态。
4. **变化 Role 按需解密**：
   - **显式提供新 key**：仅使用该新 key 参与验证，绝不解密本 role 及其他 role 的旧密文。
   - **未提供新 key（需沿用已有旧 key）**：仅对该 role 触发一次 `_decrypt_and_rotate`。若旧密文有效且需轮换，更新为 active 版本；若解密失败，保留既有异常行为，不吞掉异常。
   - 其他未变化 role 绝不受牵连。
5. **校验顺序与错误契约保持**：
   - 严格保持 STT → LLM → TTS 校验执行顺序。
   - 保持 422 `provider_key_validation_failed` 响应体结构与字段分类。
   - 保持公开接口契约、权限检查、密码加密保存与账户隔离不变。

## 2. 本地实现与测试覆盖

### 2.1 路由层惰性解密 (`backend/routers/user.py`)

- 重构 `_validate_provider_keys` 函数，先行计算 `stt_changed`、`llm_changed` 与 `tts_changed`。
- 将 `_decrypt_and_rotate` 的调用严格收敛至各 role 的 `changed` 分支内部，且仅在未显式传递新 key 时才执行。
- 保持原返回值 `tuple[bool, bool, bool]` 及 `_apply_settings_update` 调用逻辑。

### 2.2 新增回归测试 (`backend/tests/test_settings_lazy_decryption.py`)

新增 7 个独立回归测试用例，覆盖：

1. **非敏感更新密文损坏安全**：验证主题与模型偏好更新在旧密文损坏（解密抛错）时正常成功，解密函数零调用。
2. **空请求零副作用**：空请求体 `{}` 零解密、零拨测。
3. **同 provider 原值重复提交**：同 provider 原值重复提交不触发解密与验证。
4. **显式新 key 绝不解密旧密文**：提交单 role 新 key 时，仅验证新 key，不解密本 role 及其他 role 旧密文。
5. **切换 provider 仅解密该 role**：切换 provider 未给 key 时，仅对该 role 解密一次并触发轮换，其他 role 零解密。
6. **需沿用旧 key 损坏异常外抛**：切换 provider 且需沿用旧 key 时，若旧密文损坏，解密异常正常抛出不被掩盖。
7. **校验顺序与错误形状保持**：多 role 校验失败顺序严格保持 STT → LLM → TTS，422 结构保持。

## 3. 边界与未验界限

- 本轮仅完成用户设置凭据惰性解密与非敏感更新解耦（RF-10 子项），未勾选 RF-10 整体。
- 多 Provider 并行拨测与总超时控制仍待后续实现。
- 未连接真实外部 Provider 网络，不进行真实网络请求。
