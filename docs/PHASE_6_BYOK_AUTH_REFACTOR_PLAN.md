# 双轨制鉴权与 BYOK 验证重构计划 (BYOK Auth Refactor Plan)

## 0. 背景与目标

根据最新需求，我们需要对当前的双轨制 (Dual-track) 鉴权思路进行重构。主要目标：

1. **默认使用自定义模式 (BYOK)**：非 VIP 用户的默认（且唯一）选择必须是使用自带的 API 密钥及模型（BYOK）。BYOK 的连接联通性默认为 `false`。
2. **保存时校验连通性**：当用户在设置页填写自定义 Provider 和 API 密钥并保存时，后端需实时（或异步）校验改配置能否联通。只有联通成功，BYOK 的有效状态才为 `true`。
3. **VIP 特权分离**：仅 VIP 用户可以关闭自定义模式，使用系统的默认模型和密钥。非 VIP 用户一律禁止使用系统配置。

---

## 1. 代码冲突分析 (Current Conflicts)

目前的实现与该计划存在以下**直接冲突**：

1. **默认模式相反**：当前代码中 `UserSettings` 的 `is_custom_mode` 默认值为 `False`（即所有用户默认使用系统配置）。而新计划要求所有用户默认 `is_custom_mode = True`。
2. **缺乏连通性验证状态**：当前并未持久化“自定义配置是否可用”的状态，前端/后端在开课时仅进行硬性 API Key 存在性检查，并在运行时进行连接尝试。
3. **缺少 VIP 鉴权拦截**：目前 `PUT /api/users/me/settings` 端点允许任何级别的用户将 `is_custom_mode` 设为 `False`。当前代码未在设置修改和 AI Session 连接时，校验 `user.subscription_tier`（目前包含 `free`, `pro`, `premium`）。
4. **保存即生效，不加校验**：当前的更新接口只是将提供的明文 KEY 加密后盲注（Blind Write）进数据库。

---

## 2. 方案设计 (Architecture & Design)

### 2.1 数据库结构提议

在 `backend/models/user.py` 的 `UserSettings` 中：

- 将 `is_custom_mode` 的 default 改为 `True`。
- 新增字段 `is_custom_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)`，用于标记用户的 BYOK 记录是否已验证通过。

### 2.2 核心模块重构提议

遵循**依赖倒置与抽象 (Abstraction & Decoupling)**及**副作用管理 (Side-effect Management)**原则：

1. **配置接口重构 (`backend/routers/user.py`)**：
   - 增加验证服务 `ProviderValidationService` 隔离第三方网络发包请求。
   - `PUT /api/users/me/settings` 逻辑修改：
     - 若当前用户为 `free` 层级，且请求体中包含 `is_custom_mode=False`，强制拒绝并抛出 `403 Forbidden`（或强行覆盖为 `True`）。
     - 调用验证服务，针对用户传入的新 Key 执行“拨测”（探测请求）。
     - 根据“拨测”结果决定保存后将 `is_custom_verified` 置为 `True` 或 `False`。

2. **鉴权与 Session 接管 (`backend/routers/sessions.py` / `livekit_agent`)**：
   - 入口处增加断言检查：
     - 如果用户正在以 BYOK 模式开课，且 `is_custom_verified == False`，需抛出 `400 Bad Request`，提示“请先完成密钥验证”。
     - 如果用户请求系统通道 (`is_custom_mode == False`)，但层级为 `free`，阻断连接请求。

### 2.3 前端交互与拦截 (Frontend Interactions)

- **设置页 UI 拦截**：在前端设置页面，当非 VIP 用户（如 `free` 级别）尝试关闭“自定义模式” (即 `is_custom_mode` 设为 `False`，试图使用系统预设) 时，前端应进行拦截，并弹窗提示“该功能仅限 VIP 用户使用（或引导升级）”，同时将开关状态重置/保持为开启（BYOK 模式）。

---

## 3. 具体执行步骤 (Small, Verifiable Steps)

参照 `CLAUDE_CODE_REFACTOR_GUIDE.md` 这应当分为四个小步快跑的合并点：

- **Step 1: 基础设施变更**
  - 在 Alembic 中生成迁移脚本：为 `user_settings` 添加 `is_custom_verified` 列，并修改 `is_custom_mode` 的默认值为 `True`（同时梳理存量数据以符合新策略）。
  - 更新对应的 `UserSettings` / `User` Schema，补齐相关单元测试。

- **Step 2: 创建服务类与拦截逻辑**
  - 新建 `services/validation_service.py` 内部包含调用 LLM/STT/TTS 第三方基本服务的轻量拨测逻辑。
  - 在 `user.py` （修改设置 API）中注入 `ValidationService`，落实 403 权限拒绝与 `is_custom_verified` 自动标记。

- **Step 3: AI 对话连接层的业务调整**
  - 修改 `routers/sessions.py` 逻辑：当用户启动 LiveKit Token 生成时，实施严格的（校验 + 订阅等级）检查。

- **Step 4: 测试与对齐验收**
  - 运行系统整体联调。
  - 测试免费用户的被拒 case、测试验证失败即拒绝开课请求的 case、测试 VIP 取消自定义模式的请求。
