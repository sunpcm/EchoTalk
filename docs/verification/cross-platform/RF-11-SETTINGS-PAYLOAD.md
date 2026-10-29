# RF-11 设置保存载荷行为抽取

> 实施日期：2026-10-29
> 代码分支：`codex/rf11-settings-save-payload`
> 对应任务：A61 / RF-11 设置保存载荷行为抽取（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF-11“按行为拆分 SettingsDrawer”与 A61 冻结实施规范：

1. **设置更新载荷构建抽取为纯函数**：
   - 新建 `apps/vite-app/src/components/settings/settingsPayload.ts`，提供 `buildSettingsUpdate` 纯计算函数。
   - 接受当前表单标量快照 `SettingsPayloadInput`，返回现有 `UserSettingsUpdate`。
   - 模块仅引入类型定义（`import type { UserSettingsUpdate } from "@/lib/api"`），禁止引入 React、DOM 或 store，不发起网络请求、不写日志、不持久化、不全局保存明文密钥。
   - 纯函数具备不可变性契约：不修改入参（支持 `Object.freeze` 入参），不共享可变返回对象（每次调用返回全新对象）。

2. **行为逐项严格等价**：
   - 始终携带 `is_custom_mode` 布尔值。
   - `isCustomMode: false` 时，返回且仅返回 `{ is_custom_mode: false }`，绝不携带 provider/model/key 字段。
   - `isCustomMode: true` 时：
     - 按原顺序声明 `stt_provider`、`llm_provider`、`tts_provider`。
     - `llmModel.trim()` 非空时才设置 `llm_model`（值为 trim 后的结果）。
     - 三路 key 仅在 `trim()` 后非空时才分别携带对应的 `stt_key`、`llm_key`、`tts_key`（值为 trim 后的结果）。
     - 空字符串或全空白字符代表省略不更新，绝不引入清空语义。
     - 严禁携带 `theme`、`has_key`、`status` 等额外字段。
     - 不自行引入 Provider 额外校验、类型转换或回退逻辑。

3. **组件真实消费与行为保持**：
   - `SettingsDrawer.tsx` 真实消费 `buildSettingsUpdate`，替代原本在 `handleSave` 内直接拼装对象的逻辑。
   - 单次保存仍只触发一次 `updateSettings`；原 `saving` 状态管理、错误/成功提示与 toast 定时器、加载/后端同步清空密钥草稿、订阅权限判定及原生 dialog 模态焦点/键盘/动画/样式行为 100% 保持不变。

## 2. 本地实现与测试覆盖

### 2.1 模块纯纯计算实现与组件消费

- `apps/vite-app/src/components/settings/settingsPayload.ts`：
  - 定义 `SettingsPayloadInput` 纯标量输入快照接口。
  - 实现 `buildSettingsUpdate` 纯函数。
- `apps/vite-app/src/components/settings/SettingsDrawer.tsx`：
  - 导入并直接在 `handleSave` 消费 `buildSettingsUpdate`。

### 2.2 自动化回归测试

- `apps/vite-app/src/components/settings/settingsPayload.test.ts`（新增 7 项直接行为测试）：
  1. `returns only is_custom_mode: false when custom mode is disabled`：验证自定义模式关闭时仅发送 `is_custom_mode: false`，不带 provider/model/key。
  2. `includes provider fields when custom mode is enabled with empty keys and empty model`：验证自定义模式开启且无新 key/model 时按顺序输出三路 provider。
  3. `trims and includes llm_model when non-empty, but omits when whitespace-only`：验证 llm_model trim 非空保留与全空白省略。
  4. `handles three role keys individually with trim and omissions`：验证三路 key 分别设置时的 trim 与空值省略。
  5. `handles mixed keys and trims all non-empty keys`：验证三路 key 与 model 混合设置时的全字段输出。
  6. `does not mutate frozen input object`：验证冻结入参不变性。
  7. `returns distinct independent objects across multiple calls`：验证多次调用返回独立引用与防污染。
  8. `does not include extra unrequested fields like theme, has_key, or status`：验证严格白名单字段契约。

- `apps/vite-app/src/components/settings/SettingsDrawer.test.tsx`（新增真实组件消费与保存回归）：
  1. `consumes buildSettingsUpdate and passes full payload to updateSettings on save`：验证表单输入新 key 后点击保存，真实调用 `buildSettingsUpdate` 并将完整 payload 传递给 `updateSettings`。
  2. `consumes buildSettingsUpdate when custom mode is disabled`：验证自定义模式关闭时保存调用 `buildSettingsUpdate` 并传递 `{ is_custom_mode: false }`。
  3. 使用离线 store 替身与 spy，并在 `finally` 完整恢复原始方法与 store 状态，绝不污染后续用例。

### 2.3 携带 P2 维护修正

1. **`backend/tests/test_user_settings_service.py` 依赖清理**：
   - 将 `test_production_router_consumes_service_directly` 末尾粗暴的 `app.dependency_overrides = {}` 改为 `try...finally` 结构。
   - 在 `finally` 中恢复 `get_db` 原有覆盖（若此前不存在则仅 `pop` 自身键），避免清空其他全局/外部 fixture 的认证覆盖。
2. **`docs/verification/cross-platform/RF-10-SETTINGS-SERVICE.md` 文档笔误**：
   - §2.2 首行测试统计数由笔误的“13 项”更正为实际清单与执行的“14 项”。

## 3. 边界与未验界限

- 本轮仅完成 RF-11 设置保存载荷行为纯计算抽取子项，RF-11 整项保持未勾选。
- 前端 API 类型尚未由 OpenAPI 生成，会话状态模型重构尚未实施。
- 未连接真实第三方 Provider 或外部网络，未引入新的外部依赖。
