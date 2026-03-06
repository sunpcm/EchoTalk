# Phase 5 技术栈与架构文档

## 1. 双轨制概览

EchoTalk 的 Phase 5 引入"基础轨 / 自定义轨"双轨路由机制。用户通过 `is_custom_mode` 布尔开关选择使用系统默认服务还是自带 API Key (BYOK)。

| 模式               | `is_custom_mode` | 密钥来源                     | 失败策略                                     |
| ------------------ | ---------------- | ---------------------------- | -------------------------------------------- |
| 基础轨 (Track A)   | `False`（默认）  | `.env` 系统环境变量          | 正常异常传播                                 |
| 自定义轨 (Track B) | `True`           | 数据库加密存储 + Fernet 解密 | Fail-Fast: DataChannel 报错 → 断连，绝不降级 |

---

## 2. 数据层 (`user_settings` 表)

### 表结构

| 列名                | 类型                              | 说明                    |
| ------------------- | --------------------------------- | ----------------------- |
| `user_id`           | UUID (PK, FK → users.id)          | 一对一关联              |
| `is_custom_mode`    | Boolean (NOT NULL, default False) | 双轨制主开关            |
| `stt_provider`      | Enum('deepgram')                  | STT 提供商              |
| `llm_provider`      | Enum('siliconflow', 'openrouter') | LLM 提供商              |
| `llm_model`         | String(100)                       | 模型标识符              |
| `tts_provider`      | Enum('cartesia')                  | TTS 提供商              |
| `encrypted_stt_key` | Text                              | Fernet 加密后的 STT Key |
| `encrypted_llm_key` | Text                              | Fernet 加密后的 LLM Key |
| `encrypted_tts_key` | Text                              | Fernet 加密后的 TTS Key |
| `updated_at`        | DateTime                          | 最后更新时间            |

### 加密方案

- 对称加密: `cryptography.fernet.Fernet`
- 密钥派生: `SHA-256(JWT_SECRET_KEY)` → `base64url_encode` → Fernet Key
- 加密入口: `backend/utils/crypto.py` — `encrypt_api_key()` / `decrypt_api_key()`

### API 端点

| 方法 | 路径                 | 说明                                         |
| ---- | -------------------- | -------------------------------------------- |
| GET  | `/api/user/settings` | 返回配置状态，密钥仅返回 `has_xxx_key: bool` |
| PUT  | `/api/user/settings` | 部分更新，明文 Key 加密后入库                |

---

## 3. PluginFactory 插件工厂

**文件**: `backend/livekit_agent/plugin_factory.py`

### 类结构

```
PluginInitError(Exception)
    .code: str       # 机器可读错误码
    .message: str    # 中文人类可读描述

PluginFactory
    +create_stt(provider, api_key) → deepgram.STT
    +create_llm(provider, api_key, model, temperature=0.7) → lk_openai.LLM
    +create_tts(provider, api_key) → cartesia.TTS
    +create_vad() → silero.VAD
    +from_system_defaults() → dict[str, Any]
```

### LLM Provider 映射

| Provider      | base_url                        | 系统 Key 字段         |
| ------------- | ------------------------------- | --------------------- |
| `siliconflow` | `https://api.siliconflow.cn/v1` | `SILICONFLOW_API_KEY` |
| `openrouter`  | `https://openrouter.ai/api/v1`  | `OPENROUTER_API_KEY`  |

### 预检校验规则

所有 `create_*` 方法在实例化前执行:

1. Provider 是否在受支持列表中
2. API Key 是否为空或纯空白
3. (LLM) 模型名称是否为空

校验失败抛出 `PluginInitError`，携带对应的错误码和中文消息。

---

## 4. 双轨路由流程 (`agent.py` entrypoint)

```
Agent 收到任务
  │
  ├── 连接房间 → 等待参与者
  │
  ├── session_id = room.name
  │
  ├── _fetch_user_settings(session_id)
  │     ├── SELECT user_id FROM sessions WHERE id = :session_id
  │     └── SELECT * FROM user_settings WHERE user_id = :user_id
  │
  ├── IF is_custom_mode == True (自定义轨):
  │     ├── 预检 provider + encrypted_key 字段
  │     ├── decrypt_api_key() 解密三组 Key
  │     ├── PluginFactory.create_stt/llm/tts/vad()
  │     └── 失败 → _send_error_and_disconnect() → return
  │
  ├── ELSE (基础轨):
  │     └── PluginFactory.from_system_defaults()
  │
  ├── EchoTalkAgent(**plugins) 创建
  ├── AgentSession 注册转录钩子
  └── agent_session.start()
```

**隔离保证**: 自定义轨失败后 `return` 退出 entrypoint，不存在任何代码路径能回落到 `from_system_defaults()`。

---

## 5. DataChannel 错误协议

### 载荷格式

```json
{
  "type": "agent_error",
  "code": "ERR_CUSTOM_KEY_INVALID",
  "message": "自定义模式下 LLM API Key 为空。请在设置页面输入密钥。"
}
```

### 错误码表

| 错误码                         | 触发条件                                          |
| ------------------------------ | ------------------------------------------------- |
| `ERR_CUSTOM_KEY_INVALID`       | Provider 未选、Key 未配、解密失败、Key 为空       |
| `ERR_UNSUPPORTED_STT_PROVIDER` | STT provider 不在 `{"deepgram"}`                  |
| `ERR_UNSUPPORTED_LLM_PROVIDER` | LLM provider 不在 `{"siliconflow", "openrouter"}` |
| `ERR_UNSUPPORTED_TTS_PROVIDER` | TTS provider 不在 `{"cartesia"}`                  |

### 传输参数

```python
await ctx.room.local_participant.publish_data(
    payload=json_string,    # UTF-8 JSON, ensure_ascii=False
    reliable=True,          # TCP 语义保证送达
    topic="agent_error",    # 前端按此 topic 过滤
)
await ctx.room.disconnect()  # 发送后断连
```

---

## 6. 文件清单

### Phase 5 Step 1 新增/修改

| 文件                                         | 说明                              |
| -------------------------------------------- | --------------------------------- |
| `backend/utils/__init__.py`                  | 工具包 init                       |
| `backend/utils/crypto.py`                    | Fernet 加解密                     |
| `backend/models/user.py`                     | UserSettings 模型 + Provider 枚举 |
| `backend/models/__init__.py`                 | 导出新符号                        |
| `backend/schemas/user.py`                    | 请求/响应 Pydantic 模型           |
| `backend/routers/user.py`                    | GET/PUT /api/user/settings        |
| `backend/main.py`                            | 注册路由                          |
| `backend/requirements.txt`                   | 添加 cryptography                 |
| `backend/alembic/versions/0a45d96ff7fb_*.py` | 数据库迁移                        |

### Phase 5 Step 2 新增/修改

| 文件                                      | 说明                            |
| ----------------------------------------- | ------------------------------- |
| `backend/livekit_agent/plugin_factory.py` | PluginFactory + PluginInitError |
| `backend/livekit_agent/agent.py`          | 双轨路由重构                    |
| `docs/PHASE_5_TECH_STACK.md`              | 本文档                          |

### Phase 5 Step 3 新增/修改

| 文件                                                       | 说明                                     |
| ---------------------------------------------------------- | ---------------------------------------- |
| `apps/vite-app/src/lib/api.ts`                             | 新增 UserSettings 类型与 API 函数        |
| `apps/vite-app/src/store/settings.ts`                      | Zustand 设置 Store（水合 + 更新）        |
| `apps/vite-app/src/store/conversation.ts`                  | 新增 agentError 字段与 setAgentError     |
| `apps/vite-app/src/i18n/zh-CN.ts`                          | 新增 settings / agentError i18n 命名空间 |
| `apps/vite-app/src/styles.css`                             | 新增 slideInRight 动画关键帧             |
| `apps/vite-app/src/components/settings/SettingsDrawer.tsx` | 设置抽屉组件（Switch + 表单 + 保存）     |
| `apps/vite-app/src/App.tsx`                                | 集成设置抽屉 + 齿轮图标 + 水合           |

### Phase 5 Step 4 新增/修改

| 文件                                                           | 说明                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/vite-app/src/components/conversation/VoiceInterface.tsx` | DataChannel 错误拦截 + EndedView 错误卡片 + 防重复警告守卫 |

---

## 7. 前端状态管理与水合

### useSettingsStore (`store/settings.ts`)

Zustand store，管理双轨制配置的前后端同步：

| 字段/方法          | 类型                                             | 说明                                        |
| ------------------ | ------------------------------------------------ | ------------------------------------------- |
| `settings`         | `UserSettingsResponse \| null`                   | 从后端获取的最新配置                        |
| `loading`          | `boolean`                                        | GET 请求加载中                              |
| `saving`           | `boolean`                                        | PUT 请求保存中                              |
| `error`            | `string \| null`                                 | 最近一次操作的错误消息                      |
| `fetchSettings()`  | `() => Promise<void>`                            | 调用 GET /api/user/settings 并水合 settings |
| `updateSettings()` | `(data: UserSettingsUpdate) => Promise<boolean>` | 调用 PUT /api/user/settings，成功返回 true  |
| `reset()`          | `() => void`                                     | 重置到初始状态                              |

**水合时机**：`App.tsx` 的 `useEffect` 在应用挂载时调用 `fetchSettings()`。

### useConversationStore 扩展

新增字段：

| 字段/方法         | 类型                                                 | 说明                                            |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `agentError`      | `{ code: string; message: string } \| null`          | DataChannel 接收到的 Agent 错误                 |
| `setAgentError()` | `(error: { code: string; message: string }) => void` | 设置 agentError 并将 connectionState 切到 ended |

`setAgentError()` 将 `connectionState` 设为 `"ended"`，触发 `<LiveKitRoom>` 卸载，从根本上阻止自动重连。

---

## 8. 前端设置抽屉 (SettingsDrawer)

**文件**: `apps/vite-app/src/components/settings/SettingsDrawer.tsx`

### UI 结构

```
Overlay（半透明黑背景，点击关闭）
└── 抽屉面板（从右侧滑入，max-w-sm）
    ├── 头部：「自定义模型设置」 + 关闭按钮
    ├── Switch 开关：is_custom_mode（核心控制）
    ├── 分割线
    ├── Provider 配置区（is_custom_mode=false 时 disabled + opacity-50）
    │   ├── STT Provider: <select>（deepgram）
    │   ├── STT API Key: <input type="password"> + 「已配置」徽章
    │   ├── LLM Provider: <select>（siliconflow / openrouter）
    │   ├── LLM Model: <input type="text">
    │   ├── LLM API Key: <input type="password"> + 「已配置」徽章
    │   ├── TTS Provider: <select>（cartesia）
    │   └── TTS API Key: <input type="password"> + 「已配置」徽章
    └── 保存按钮（全宽）+ 成功/错误提示
```

### 关键行为

- 打开时调用 `fetchSettings()` 拉取最新配置
- API Key 为 `type="password"`，仅在用户输入新值时发送后端（空=不更新）
- `has_xxx_key=true` 且用户未输入新值时，显示绿色「已配置」徽章
- 动画：`slideInRight` CSS 关键帧（0.25s ease-out）

---

## 9. DataChannel 错误拦截（前端）

### 监听入口

`ActiveView` 组件内使用 `@livekit/components-react` 的 `useDataChannel` hook：

```typescript
useDataChannel("agent_error", (msg) => {
  const text = new TextDecoder().decode(msg.payload);
  const parsed = JSON.parse(text);
  if (parsed.type === "agent_error") {
    setAgentError({ code: parsed.code, message: parsed.message });
  }
});
```

### 自动重连阻止机制

```
DataChannel 消息到达 (reliable=True, 保证先于 disconnect)
  ↓
setAgentError() → connectionState = "ended"
  ↓
VoiceInterface 重渲染 → EndedView 替代 LiveKitRoom
  ↓
LiveKitRoom 卸载 → WebRTC 连接释放 → 自动重连不可能
```

### EndedView 双模式

| 模式       | 触发条件              | UI 渲染                                        |
| ---------- | --------------------- | ---------------------------------------------- |
| 正常结束   | `agentError === null` | 评估轮询 + 发音反馈 + 技能树 + 返回主页        |
| Agent 错误 | `agentError !== null` | 红色错误卡片（标题 + 消息 + 错误码）+ 返回主页 |

### onDisconnected 守卫

`onDisconnected` 回调在检测到 `agentError` 已设置时提前 `return`，避免与红色错误卡片重叠显示琥珀色连接警告。
