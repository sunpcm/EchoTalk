# RF-10 用户设置业务服务边界

> 实施日期：2026-10-29
> 代码分支：`codex/rf10-settings-service`
> 对应任务：A60 / RF-10 用户设置业务服务边界抽离（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF-10“统一 Provider Registry 和设置服务”与 A60 冻结实施规范：

1. **设置业务逻辑抽离至独立服务**：
   - 新建 `backend/services/user_settings_service.py`，集中承载设置响应构建、权限判断、按变更凭据验证、密钥读取旋转及更新加密业务逻辑。
   - 保持最小公开面，提供小型纯函数与无状态命名空间类 `UserSettingsService`，禁止泛化框架，禁止持有全局可变状态或单例驻留用户凭据。
   - 服务纯净独立，零反向 import `routers/user`、`main` 或 HTTP 应用实例，杜绝循环依赖与适配层耦合。

2. **HTTP 路由职责收敛与薄兼容委托**：
   - `backend/routers/user.py` 仅保留认证依赖（`CurrentUser`）、当前用户限定数据库查询/创建/flush/refresh 事务边界。
   - 路由生产入口（`GET /api/user/settings` 与 `PUT /api/user/settings`）直接消费 `UserSettingsService`。
   - 保留原 helper 入口及签名的薄兼容委托：
     - `get_key_status(has_key, is_valid)`
     - `_decrypt_and_rotate(row, prefix)`
     - `_as_validation_result(result)`
     - `_build_user_settings_response(row, tier)`
     - `_validate_custom_mode_permission(user_obj, is_custom_mode)`
     - `_validate_provider_keys(row, body)`
     - `_apply_settings_update(row, body, stt_valid, llm_valid, tts_valid)`
   - 保留现有测试的 `routers.user.decrypt_api_key`、`encrypt_api_key`、`ProviderValidationService` patch 兼容：在调用时从路由动态传递当前依赖，不在服务模块导入时绑定默认值。

3. **A54 凭据惰性解密边界保持**：
   - 非敏感字段更新、同 provider 原值重复提交：零旧密文读取、零解密、零拨测。
   - 显式传入新 key：仅拨测新 key，绝不解密旧密文。
   - 仅在 role 发生变更且未传新 key（沿用旧 key）时，才按需解密该 role 旧密文；若 `needs_rotation` 为 True 则以 active key 重加密并写回。
   - 严格区分 None 与空值，不自行增加清空 key 语义；任何凭据、异常正文与 URL 绝不进入新日志、响应或报告。

4. **A55 多 Provider 有界并行边界保持**：
   - 仅变更且同时具备 provider/key 的 role 才进入 `validate_parallel`。
   - 维持 10 秒总超时与 8 秒单请求超时，取消清理算法由 `validation_service` 负责。
   - 保持 STT → LLM → TTS 失败字段顺序、422 detail 结构与 bool 测试替身兼容。
   - 未变 role 保留既有有效性状态，`is_custom_verified` 仍由三路有效性共同决定。

5. **响应构建与安全脱敏保持**：
   - `has_key` 基于 `is not None` 判断（不使用 truthy）。
   - 状态映射规则（`verified` / `error` / `unconfigured`）及默认 `theme="warm"` / `tier="free"` 保持不变。
   - 响应结构绝不返回明文、密文或密钥版本号。
   - Free 用户禁止关闭 custom mode（403 Forbidden），无用户/无设置记录路径不漂移。

## 2. 本地实现与测试覆盖

### 2.1 服务层与路由层实现

- `backend/services/user_settings_service.py`：
  - `get_key_status`：三态映射规则计算。
  - `decrypt_and_rotate`：接收 `decrypt_fn` 与 `encrypt_fn` 依赖注入，按需重加密旋转。
  - `as_validation_result`：兼容测试替身与生产分类结果。
  - `build_user_settings_response`：构建安全脱敏的设置响应。
  - `validate_custom_mode_permission`：校验 free 用户 custom mode 关闭权限。
  - `validate_provider_keys`：差异比对、按需解密、调度并行校验与 422 顺序失败响应。
  - `apply_settings_update`：更新 ORM 字段、加密新密钥、更新有效性与 `is_custom_verified` 旗标。
  - `UserSettingsService`：提供无状态静态方法命名空间。
- `backend/routers/user.py`：
  - 路由入口直接调用 `UserSettingsService` 方法，并在调用时从自身命名空间显式注入 `decrypt_api_key`、`encrypt_api_key`、`ProviderValidationService`。
  - 提供 7 项兼容委托函数，保持已有外部调用方与 patch 路径 100% 兼容。

### 2.2 自动化回归测试

- `backend/tests/test_user_settings_service.py`（新增 14 项单元与委托测试）：
  1. `test_get_key_status_mapping`：验证三态映射矩阵。
  2. `test_as_validation_result_behavior`：验证分类结果与布尔替身转换。
  3. `test_build_user_settings_response_none_row`：验证空记录默认值与指定 tier。
  4. `test_build_user_settings_response_redaction_and_defaults`：验证响应字段脱敏、`is not None` 判定与默认主题回退。
  5. `test_validate_custom_mode_permission`：验证 free 用户禁止关闭 (403) 与 pro/premium 允许。
  6. `test_decrypt_and_rotate_empty_or_none`：验证空密文零解密调用。
  7. `test_decrypt_and_rotate_without_rotation`：验证无需旋转时不重加密。
  8. `test_decrypt_and_rotate_with_rotation`：验证 `needs_rotation` 触发重加密并写回行版本。
  9. `test_validate_provider_keys_no_change`：验证无变更更新零解密、零拨测。
  10. `test_validate_provider_keys_explicit_new_key`：验证显式新 key 仅拨测新 key，零解密旧密文。
  11. `test_validate_provider_keys_failure_preserves_order`：验证多 role 失败 422 detail 严格保持 STT→LLM→TTS 顺序。
  12. `test_apply_settings_update_field_writes_and_verified_flag`：验证字段写入、Key 加密与三路全 true 判定。
  13. `test_router_delegates_to_service`：验证路由层 7 项薄委托与路由级 patch 兼容性。
  14. `test_production_router_consumes_service_directly`：通过 Spy 证实生产 HTTP GET/PUT 入口直接消费 `UserSettingsService`。
- 原回归测试保持原样通过：
  - `backend/tests/test_user.py`：包含旧有 `test_reading_old_credential_reencrypts_with_active_version`、`test_update_user_settings` 等。
  - `backend/tests/test_settings_lazy_decryption.py`：7 项 A54 惰性解密测试原样通过。
  - `backend/tests/test_settings_parallel_validation.py`：4 项 A55 有界并行测试原样通过。

## 3. 边界与未验界限

- 本轮完成 RF-10 用户设置业务服务边界抽离子项，RF-10 整项保持未勾选。
- 真实外部 Provider 拨测、前端元数据展示统一仍待后续推进。
- 所有测试均使用本地 Mock/替身，未连接真实第三方 Provider。
