# EchoTalk Phase 5 实施蓝图：双轨制明确路由架构

## 📐 核心重构逻辑

引入一个明确的状态标识（`is_custom_mode`）。

- **开关关闭（基础轨）**：UI 隐藏密钥输入框，后端 Agent 强制读取 `.env` 中的 LiveKit 官方环境变量，提供兜底的极速体验。
- **开关打开（自定义轨）**：UI 展开输入框，后端 Agent 强制读取数据库中的用户加密 Key。**生死隔离**：在此模式下，任何初始化失败或连接拒绝，直接抛出 `Agent_Error` 结束房间，**绝对不**触发系统环境变量降级。

---

## 第一步：数据层重构与 API 网关（先打地基）

**目标**：在数据库层面增加“总开关”字段，并提供配置读写的 API。

- **数据模型更新**：在 `user_settings` 表中，新增一个 Boolean 类型的核心字段 `is_custom_mode`（默认 `False`）。
- **加密模块**：引入 `cryptography.fernet`，用系统环境变量的哈希值作为主密钥，确保用户的 API Key 落盘即加密。
- **API 改造**：
  - `GET /api/user/settings`：返回 `is_custom_mode` 的状态，以及脱敏后的 Key 状态（`has_stt_key: bool` 等）。
  - `PUT /api/user/settings`：接收前端的更新（包含开关状态和填写的 Provider/Key），处理加密并入库。

---

## 第二步：Agent 工厂重构与严格隔离（核心路由）

**目标**：重构 VoicePipelineAgent 的初始化逻辑，让“开关”真正掌握生杀大权。

- **实现 PluginFactory**：建立工厂类，专门负责实例化具体的插件（Deepgram, SiliconFlow, Cartesia 等）。
- **严密的分流逻辑 (`agent.py`)**：
  - Agent 接收到用户的连房请求，查询 DB 获取该用户的配置。
  - **IF `is_custom_mode == False`**：不管数据库里有没有存用户的 Key，直接闭眼使用 `.env` 里的基础轨配置。
  - **IF `is_custom_mode == True`**：强制将数据库里的 Provider 和解密后的 Key 传给 PluginFactory。
- **实现“报错不降级”**：如果在“自定义轨”模式下，PluginFactory 实例化插件失败，或者 LiveKit 抛出 `401 Unauthorized`。Agent 必须捕获异常，通过 LiveKit DataChannel（或直接断开连接并附带 Reason）向前端发送明确的错误代码（如 `ERR_CUSTOM_KEY_INVALID`），随后优雅自毁。绝对禁止写 `try...except... fallback_to_system_key` 这样的逻辑。

---

## 第三步：前端状态水合与 UI 呈现（视觉与交互）

**目标**：提供符合直觉的“抽屉开关”交互，并实现前后端状态同步。

- **状态管理 (`useSettingsStore`)**：存储 `isCustomMode` 开关状态和各提供商选择。应用初始化时，主动调用 GET 接口拉取最新状态（Hydration）。
- **Settings Drawer UI 开发**：
  - 顶部放置一个显眼的 Switch (开关)：“启用自定义大模型与语音服务”。
  - **联动逻辑**：当 Switch 为 Off 时，下方的提供商下拉框和密钥输入框全部置灰（Disabled）或折叠隐藏，文案提示“当前使用平台系统默认的高速通道”。
  - 当 Switch 为 On 时，展开输入框，允许用户挑选如硅基流动等模型，并输入自己的 Key。

---

## 第四步：前端异常捕获与优雅提示（闭环体验）

**目标**：接住后端抛出的“自定义 Key 无效”错误，转化为用户看得懂的提示。

- **异常监听**：在前端 LiveKit 的 `useVoiceAssistant` 或 Room 事件监听器中，捕捉连接断开（Disconnected）事件或自定义的 DataChannel 消息。
- **错误分发**：如果捕获到 `ERR_CUSTOM_KEY_INVALID` 错误，阻止默认的重新连接机制，弹出清晰的 Toast 或 Modal：
  > ❌ 连接失败：您提供的自定义 API Key 无效或已欠费。请在设置中检查您的密钥，或关闭“自定义模式”以使用系统默认通道。
