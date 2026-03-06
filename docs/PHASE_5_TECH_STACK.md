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
