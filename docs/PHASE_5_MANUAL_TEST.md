# Phase 5 双轨制（BYOK）— 人工测试手册

> 本文档覆盖 Phase 5 全部 4 个步骤的人工测试：数据层 API、Agent 双轨路由、前端设置抽屉、DataChannel 错误拦截。
> 测试前需确保后端服务、LiveKit Agent 和前端开发服务器均已启动。

---

## 一、前置条件

### 1.1 启动后端服务

**终端 1** — FastAPI：

```bash
cd backend && source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**终端 2** — LiveKit Agent：

```bash
cd backend && source .venv/bin/activate
python livekit_agent/agent.py dev
```

### 1.2 启动前端开发服务器

**终端 3**：

```bash
pnpm --filter vite-app dev
```

应输出 `Local: https://localhost:5173/`（注意是 **HTTPS**）。

### 1.3 数据库迁移

确保已执行 Phase 5 的数据库迁移：

```bash
cd backend && source .venv/bin/activate
alembic upgrade head
```

**验收**：`user_settings` 表已创建，含 `user_id`, `is_custom_mode`, `stt_provider`, `llm_provider`, `llm_model`, `tts_provider`, `encrypted_stt_key`, `encrypted_llm_key`, `encrypted_tts_key`, `updated_at` 列。

### 1.4 确认 .env 配置

确保 `.env` 包含以下 Phase 5 相关配置：

```bash
# 基础轨环境变量（已有）
SILICONFLOW_API_KEY=sk-xxxxx
DEEPGRAM_API_KEY=xxxxx
CARTESIA_API_KEY=xxxxx

# Fernet 加密密钥派生来源（已有）
JWT_SECRET_KEY=your-secret-key
```

---

## 二、代码质量验证

### 2.1 后端类型检查

```bash
cd backend && source .venv/bin/activate
# 确认无导入错误
python -c "from utils.crypto import encrypt_api_key, decrypt_api_key; print('crypto OK')"
python -c "from models.user import UserSettings, STTProvider, LLMProvider, TTSProvider; print('models OK')"
python -c "from schemas.user import UserSettingsUpdate, UserSettingsResponse; print('schemas OK')"
python -c "from routers.user import router; print('router OK')"
```

**验收**：四条命令均输出 OK，无 ImportError。

### 2.2 前端 ESLint 检查

```bash
pnpm --filter vite-app lint
```

**验收**：零错误零警告。

### 2.3 前端 TypeScript 类型检查

```bash
pnpm --filter vite-app exec tsc --noEmit
```

**验收**：零错误。

---

## 三、数据层 API 测试（Step 1）

### 3.1 GET /api/user/settings — 默认状态

```bash
TOKEN="mock-token"
curl -s http://localhost:8000/api/user/settings \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**验收**：

```json
{
  "is_custom_mode": false,
  "stt_provider": null,
  "llm_provider": null,
  "llm_model": null,
  "tts_provider": null,
  "has_stt_key": false,
  "has_llm_key": false,
  "has_tts_key": false
}
```

- 首次调用时自动创建 `user_settings` 记录（get-or-create）
- `is_custom_mode` 默认为 `false`
- 所有 `has_xxx_key` 为 `false`

### 3.2 PUT /api/user/settings — 开启自定义模式并写入配置

```bash
TOKEN="mock-token"
curl -s -X PUT http://localhost:8000/api/user/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "is_custom_mode": true,
    "stt_provider": "deepgram",
    "llm_provider": "siliconflow",
    "llm_model": "Qwen/Qwen2.5-7B-Instruct",
    "tts_provider": "cartesia",
    "stt_key": "test-stt-key-123",
    "llm_key": "test-llm-key-456",
    "tts_key": "test-tts-key-789"
  }' | python3 -m json.tool
```

**验收**：

```json
{
  "is_custom_mode": true,
  "stt_provider": "deepgram",
  "llm_provider": "siliconflow",
  "llm_model": "Qwen/Qwen2.5-7B-Instruct",
  "tts_provider": "cartesia",
  "has_stt_key": true,
  "has_llm_key": true,
  "has_tts_key": true
}
```

- 密钥以 Fernet 加密后存入数据库，响应中不返回明文
- `has_xxx_key` 全部变为 `true`

### 3.3 PUT /api/user/settings — 部分更新

```bash
TOKEN="mock-token"
curl -s -X PUT http://localhost:8000/api/user/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "llm_provider": "openrouter"
  }' | python3 -m json.tool
```

**验收**：

- `llm_provider` 更新为 `"openrouter"`
- 其他字段保持不变（`is_custom_mode` 仍为 `true`，密钥仍存在）

### 3.4 加密验证

直接查询数据库，确认密钥已加密：

```bash
docker compose exec echotalk-postgres psql -U echotalk -d echotalk \
  -c "SELECT encrypted_stt_key, encrypted_llm_key FROM user_settings LIMIT 1;"
```

**验收**：

- `encrypted_stt_key` 和 `encrypted_llm_key` 为 Base64 编码的 Fernet 密文（以 `gAAAAA` 开头），而非明文

---

## 四、Agent 双轨路由测试（Step 2）

### 4.1 基础轨 — 正常对话

1. 确保用户配置为基础轨模式：

```bash
TOKEN="mock-token"
curl -s -X PUT http://localhost:8000/api/user/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_custom_mode": false}' | python3 -m json.tool
```

2. 在浏览器中点击推荐场景卡片进入对话
3. 正常进行语音对话

**验收**：

- Agent 终端日志显示 `基础轨：使用系统默认插件配置` 或类似消息
- 对话正常进行，STT/LLM/TTS 均使用 `.env` 中的系统密钥
- 结束对话后正常显示评估结果

### 4.2 自定义轨 — 有效密钥

1. 将用户配置切换到自定义轨，并写入**真实有效的** API Key：

```bash
TOKEN="mock-token"
curl -s -X PUT http://localhost:8000/api/user/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "is_custom_mode": true,
    "stt_provider": "deepgram",
    "llm_provider": "siliconflow",
    "llm_model": "Qwen/Qwen2.5-7B-Instruct",
    "tts_provider": "cartesia",
    "stt_key": "<你的真实 Deepgram Key>",
    "llm_key": "<你的真实 SiliconFlow Key>",
    "tts_key": "<你的真实 Cartesia Key>"
  }' | python3 -m json.tool
```

2. 在浏览器中进入对话

**验收**：

- Agent 终端日志显示 `自定义轨：使用用户自定义插件配置` 或类似消息
- 对话正常进行

### 4.3 自定义轨 — 无效密钥（Fail-Fast）

1. 写入无效密钥：

```bash
TOKEN="mock-token"
curl -s -X PUT http://localhost:8000/api/user/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "is_custom_mode": true,
    "stt_provider": "deepgram",
    "llm_provider": "siliconflow",
    "llm_model": "Qwen/Qwen2.5-7B-Instruct",
    "tts_provider": "cartesia",
    "stt_key": "invalid-key",
    "llm_key": "invalid-key",
    "tts_key": "invalid-key"
  }' | python3 -m json.tool
```

2. 在浏览器中进入对话

**验收**：

- Agent 通过 DataChannel 发送 `agent_error` 消息后断开连接
- Agent 终端日志显示错误信息，**不会**回落到系统默认配置
- 前端显示红色错误卡片（见第六节 DataChannel 错误拦截测试）

### 4.4 自定义轨 — 缺少密钥

1. 开启自定义模式但不提供 Key：

```bash
TOKEN="mock-token"
curl -s -X PUT http://localhost:8000/api/user/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "is_custom_mode": true,
    "stt_provider": "deepgram",
    "llm_provider": "siliconflow",
    "llm_model": "Qwen/Qwen2.5-7B-Instruct",
    "tts_provider": "cartesia"
  }' | python3 -m json.tool
```

注意：先用 3.2 中的命令清除已有密钥（重新创建用户或手动清数据库），再执行上述请求。

2. 进入对话

**验收**：

- Agent 检测到缺少 Key，发送 `ERR_CUSTOM_KEY_INVALID` 错误
- 前端显示红色错误卡片，消息提示 Key 为空

---

## 五、前端设置抽屉测试（Step 3）

### 5.1 打开/关闭抽屉

1. 在 Dashboard 页面，点击右上角齿轮图标

**验收**：

- 抽屉从右侧滑入（`slideInRight` 动画）
- 半透明黑色遮罩覆盖背景
- 点击遮罩或右上角关闭按钮，抽屉关闭

### 5.2 设置水合

1. 先通过 API 写入一些配置（见 3.2）
2. 打开设置抽屉

**验收**：

- 抽屉打开后自动加载最新配置
- `is_custom_mode` 开关反映数据库中的状态
- 各 Provider 下拉框显示已选择的提供商
- 已配置 Key 的输入框旁显示绿色「已配置」徽章
- Key 输入框为空（不回显明文密钥）

### 5.3 Switch 联动

1. 将自定义模式开关切换为 OFF

**验收**：

- 所有 Provider 下拉框和 Key 输入框变为禁用状态（置灰 + opacity-50）
- 无法操作下方表单元素

2. 将开关切换为 ON

**验收**：

- 所有表单元素恢复可用
- 可以选择 Provider 和输入 Key

### 5.4 保存设置

1. 开启自定义模式
2. 选择 LLM Provider 为 `openrouter`
3. 输入 LLM Model 为 `google/gemma-2-9b-it`
4. 在 LLM API Key 输入框中输入一个测试 Key
5. 点击「保存设置」

**验收**：

- 保存按钮显示"保存中..."加载状态
- 保存成功后显示绿色「设置已保存」提示
- 重新打开抽屉，配置已持久化

6. 通过 API 确认：

```bash
TOKEN="mock-token"
curl -s http://localhost:8000/api/user/settings \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**验收**：`llm_provider` 为 `openrouter`，`llm_model` 为 `google/gemma-2-9b-it`，`has_llm_key` 为 `true`。

### 5.5 API Key 更新逻辑

1. 打开设置抽屉，确认某个 Key 旁有"已配置"徽章
2. 不在该 Key 框中输入任何内容
3. 只修改 LLM Model 名称
4. 点击保存

**验收**：

- 保存成功
- 已配置的 Key 不会被覆盖或清除
- "已配置"徽章依然显示

---

## 六、DataChannel 错误拦截测试（Step 4）

### 6.1 Agent 错误红色卡片

1. 通过 API 设置无效的自定义轨配置（见 4.3）
2. 在浏览器中进入对话

**验收**：

- 连接建立后，Agent 发送错误消息并断开
- 前端显示红色错误卡片：
  - 标题：「AI 服务启动失败」
  - 消息：Agent 返回的中文错误描述
  - 错误码：`ERR_CUSTOM_KEY_INVALID` 等（灰色 monospace 字体）
- 卡片下方有「返回主页」按钮

### 6.2 自动重连阻止

1. 触发上述 Agent 错误
2. 观察浏览器控制台和网络面板

**验收**：

- `LiveKitRoom` 已被卸载（React DevTools 可确认）
- 浏览器不会尝试 WebSocket 重新连接
- 不会出现琥珀色连接警告 Toast（`onDisconnected` 守卫生效）

### 6.3 错误码映射

测试不同错误场景，确认错误码正确：

| 场景                         | 预期错误码                     |
| ---------------------------- | ------------------------------ |
| STT/LLM/TTS Key 为空或未配置 | `ERR_CUSTOM_KEY_INVALID`       |
| STT Provider 不支持          | `ERR_UNSUPPORTED_STT_PROVIDER` |
| LLM Provider 不支持          | `ERR_UNSUPPORTED_LLM_PROVIDER` |
| TTS Provider 不支持          | `ERR_UNSUPPORTED_TTS_PROVIDER` |

### 6.4 从错误恢复

1. 触发 Agent 错误，看到红色卡片
2. 点击「返回主页」

**验收**：

- 回到 Dashboard 页面
- `agentError` 状态被清除
- 可以正常开始新的对话

3. 打开设置抽屉，修正配置（输入有效 Key），保存
4. 重新进入对话

**验收**：

- 修正配置后对话正常进行

---

## 七、排障指南

| 问题                                | 可能原因                            | 解决方案                                                        |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| GET/PUT /api/user/settings 返回 401 | Mock 鉴权未配置                     | 确认请求头包含 `Authorization: Bearer mock-token`               |
| GET /api/user/settings 返回 500     | 数据库迁移未执行                    | 运行 `alembic upgrade head`                                     |
| 设置抽屉不显示                      | SettingsDrawer 未正确导入           | 检查 App.tsx 是否包含 `<SettingsDrawer>` 渲染                   |
| 齿轮图标不可见                      | Dashboard 组件缺少 `onOpenSettings` | 检查 App.tsx 的 Dashboard 调用是否传入了 prop                   |
| 保存设置报错                        | 后端路由未注册                      | 检查 `main.py` 是否包含 `app.include_router(user_router)`       |
| Agent 错误卡片不显示                | DataChannel 消息未到达前端          | 检查 Agent 终端日志确认 `publish_data` 执行成功                 |
| 连接断开后显示琥珀色警告            | onDisconnected 守卫失效             | 检查 VoiceInterface.tsx 中 `getState().agentError` 检查是否存在 |
| 加密/解密失败                       | JWT_SECRET_KEY 变更                 | 密钥变更后已存储的加密数据无法解密，需用户重新输入 Key          |
| Fernet 密文格式错误                 | `encrypted_xxx_key` 列被手动篡改    | 清除对应列数据，让用户重新保存 Key                              |
| 自定义轨错误后自动重连              | LiveKitRoom 未正确卸载              | 确认 `setAgentError` 将 `connectionState` 设为 `"ended"`        |

---

## 八、Phase 5 验收结论

| 检查项                 | 通过条件                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| 后端导入               | `crypto`, `models`, `schemas`, `router` 四模块均可正常导入       |
| ESLint                 | `pnpm --filter vite-app lint` 零错误                             |
| TypeScript             | `tsc --noEmit` 零错误                                            |
| GET /api/user/settings | 首次返回默认值，`is_custom_mode=false`，所有 `has_xxx_key=false` |
| PUT /api/user/settings | 部分更新生效，密钥加密入库，响应不含明文                         |
| 基础轨对话             | `is_custom_mode=false` 时正常使用系统密钥进行对话                |
| 自定义轨对话           | `is_custom_mode=true` + 有效密钥时正常使用用户密钥进行对话       |
| Fail-Fast 不降级       | 自定义轨失败后 Agent 报错断连，绝不回落到系统默认配置            |
| 设置抽屉UI             | 齿轮图标打开抽屉，Switch 联动开关，保存/加载正常                 |
| 已配置徽章             | 有 Key 时显示绿色「已配置」，空提交不覆盖已有 Key                |
| DataChannel 错误拦截   | Agent 错误消息被正确解析并显示红色错误卡片                       |
| 自动重连阻止           | 错误后 LiveKitRoom 卸载，无 WebSocket 重连尝试                   |
| onDisconnected 守卫    | Agent 错误时不显示琥珀色连接警告                                 |
| 返回主页恢复           | 错误卡片「返回主页」清除 agentError，回到 Dashboard              |
