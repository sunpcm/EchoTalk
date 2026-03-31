# Phase 1 后端 — 人工测试手册

> 本文档覆盖 Phase 1 后端全部功能的人工测试步骤。
> 所有 curl 示例假设后端运行在 `http://localhost:8000`。

---

## 一、前置条件

### 1.1 激活虚拟环境

```bash
cd backend
source .venv/bin/activate
```

### 1.2 确认数据库迁移

```bash
alembic upgrade head
```

应输出：`INFO  [alembic.runtime.migration] Running upgrade ...`（或 `No new upgrade operations`）。

### 1.3 确认 .env 配置

确保项目根目录 `.env` 包含以下配置：

```
# LLM
SILICONFLOW_API_KEY=sk-xxx    # 或 OPENROUTER_API_KEY
DEFAULT_LLM_PROVIDER=siliconflow
DEFAULT_LLM_MODEL=Qwen/Qwen2.5-7B-Instruct

# LiveKit
LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
LIVEKIT_API_KEY=APIxxxxx
LIVEKIT_API_SECRET=xxxxx

# STT / TTS
DEEPGRAM_API_KEY=xxxxx
CARTESIA_API_KEY=xxxxx
```

### 1.4 启动后端服务

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## 二、基础接口测试

### 2.1 健康检查

```bash
curl -s http://localhost:8000/api/health
```

**期望响应**：

```json
{ "status": "ok", "service": "echo-talk" }
```

**验收**：HTTP 200，`status` 为 `"ok"`。

---

### 2.2 创建会话

```bash
TOKEN="mock-token"
SESSION_ID=$(curl -s -X POST http://localhost:8000/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"conversation"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "SESSION_ID=$SESSION_ID"
```

**验收**：

- HTTP 200
- `id` 为合法 UUID
- `status` 为 `"active"`

---

## 三、对话接口测试（核心链路）

### 3.1 发送第一条消息

```bash
curl -s --max-time 60 -X POST http://localhost:8000/api/conversation/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"message\":\"Hello, can you help me practice English?\"}"
```

**期望响应**：

```json
{
  "reply": "<AI 回复文本>",
  "transcript_id": 2,
  "audio_base64": null
}
```

**验收**：

- HTTP 200
- `reply` 非空字符串，内容为英语对话回复
- `transcript_id` 为正整数
- `audio_base64` 为 null（TTS 留到 WebRTC 阶段）

---

### 3.2 发送第二条消息（多轮对话）

```bash
curl -s --max-time 60 -X POST http://localhost:8000/api/conversation/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"message\":\"I want to improve my pronunciation.\"}"
```

**验收**：

- HTTP 200
- AI 回复内容合理，能延续上一轮对话语境（验证多轮上下文传递）

---

### 3.3 查询会话详情（含转录记录）

```bash
curl -s http://localhost:8000/api/sessions/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN"
```

**验收**：

- HTTP 200
- `transcripts` 数组包含 4 条记录（2 条 `role: "user"` + 2 条 `role: "assistant"`）
- 按 `timestamp_ms` 升序排列

---

## 四、结束会话测试

### 4.1 结束会话

```bash
curl -s -X POST http://localhost:8000/api/sessions/$SESSION_ID/end \
  -H "Authorization: Bearer $TOKEN"
```

**期望响应**：

```json
{
  "id": "<SESSION_ID>",
  "status": "completed",
  "ended_at": "<iso8601>",
  "transcripts": [...]
}
```

**验收**：

- HTTP 200
- `status` 变为 `"completed"`
- `ended_at` 非 null

---

### 4.2 重复结束（异常测试）

```bash
curl -s -X POST http://localhost:8000/api/sessions/$SESSION_ID/end \
  -H "Authorization: Bearer $TOKEN"
```

**验收**：HTTP 400，返回错误信息。

---

### 4.3 向已结束的会话发消息（异常测试）

```bash
curl -s -X POST http://localhost:8000/api/conversation/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"message\":\"Can we keep talking?\"}"
```

**验收**：HTTP 400，返回 `"会话已结束，无法发送消息"`。

---

## 五、其他测试

### 5.1 无效 mode 测试

```bash
curl -s -X POST http://localhost:8000/api/sessions \
  -H "Authorization: Bearer mock-token" \
  -H "Content-Type: application/json" \
  -d '{"mode":"invalid_mode"}'
```

**验收**：HTTP 400，返回错误信息包含有效 mode 值列表。

### 5.2 不存在的会话

```bash
curl -s http://localhost:8000/api/sessions/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer mock-token"
```

**验收**：HTTP 404，返回 `{"detail": "会话不存在"}`。

---

## 五.五 LiveKit 令牌接口

> 前置条件：确保 `.env` 包含 LiveKit 配置：
>
> ```
> LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
> LIVEKIT_API_KEY=APIxxxxx
> LIVEKIT_API_SECRET=xxxxx
> ```

### 5.5.1 获取令牌

先创建一个新的 active 会话（或复用前面创建的未结束的会话）：

```bash
TOKEN="mock-token"
SESSION_ID=$(curl -s -X POST http://localhost:8000/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"conversation"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -s http://localhost:8000/api/sessions/$SESSION_ID/token \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**期望响应**：

```json
{
  "token": "<jwt-string>",
  "ws_url": "wss://your-livekit-server.livekit.cloud"
}
```

**验收**：

- HTTP 200
- `token` 为合法 JWT（可用 jwt.io 解码验证）
- JWT payload 中 `video.room` 等于 `SESSION_ID`
- JWT payload 中 `sub` 等于 mock 用户 ID

### 5.5.2 不存在的会话获取令牌

```bash
curl -s http://localhost:8000/api/sessions/00000000-0000-0000-0000-000000000000/token \
  -H "Authorization: Bearer mock-token"
```

**验收**：HTTP 404

### 5.5.3 已结束会话获取令牌

```bash
# 先结束会话（如果尚未结束）
curl -s -X POST http://localhost:8000/api/sessions/$SESSION_ID/end \
  -H "Authorization: Bearer $TOKEN" > /dev/null

curl -s http://localhost:8000/api/sessions/$SESSION_ID/token \
  -H "Authorization: Bearer $TOKEN"
```

**验收**：HTTP 400，返回 `{"detail":"会话已结束，无法生成令牌"}`

---

## 五.六 LiveKit Agent 启动验证

### 5.6.1 启动 Agent（新终端）

```bash
cd backend
source .venv/bin/activate
python livekit_agent/agent.py dev
```

**验收**：

- 无 Python `ImportError` / `ModuleNotFoundError`
- 日志显示已连接到 LiveKit Cloud（类似 `registered worker` 或连接成功信息）
- Agent 进程持续运行，等待房间创建事件

### 5.6.2 端到端语音测试（需 LiveKit Playground）

完整测试需要三个终端：

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

**终端 3** — 创建会话并获取令牌：

```bash
TOKEN="mock-token"
SESSION_ID=$(curl -s -X POST http://localhost:8000/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"conversation"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -s http://localhost:8000/api/sessions/$SESSION_ID/token \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

然后使用 [LiveKit Agents Playground](https://agents-playground.livekit.io)
连接到房间，对着麦克风说英语。

**验收**：

- Agent 终端显示 "参与者加入" + "语音管线已启动" 日志
- 说英语后，Agent 产生语音回复
- 查询会话详情验证转录记录已写入：

```bash
curl -s http://localhost:8000/api/sessions/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

`transcripts` 数组应包含 `role: "user"` 和 `role: "assistant"` 记录。

---

## 六、代码质量验证

```bash
cd backend && source .venv/bin/activate
black --check .
flake8 .
```

**验收**：两个命令均无报错输出。

---

## 七、排障指南

| 问题                           | 可能原因               | 解决方案                                                                |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------------- |
| `ModuleNotFoundError`          | 未激活虚拟环境         | `source backend/.venv/bin/activate`                                     |
| 数据库连接失败                 | PostgreSQL 未启动      | 检查 `.env` 中 `DATABASE_URL`，确认 PostgreSQL 运行                     |
| ENUM 类型错误                  | 旧表/类型残留          | `alembic downgrade base && alembic upgrade head`                        |
| 端口被占用                     | 其他进程占用 8000      | `fuser -k 8000/tcp`                                                     |
| `.env` 未找到                  | 工作目录不对           | 确保从 `backend/` 目录启动                                              |
| LLM 调用超时                   | API Key 无效或网络问题 | 检查 `SILICONFLOW_API_KEY` 是否有效                                     |
| LLM 返回 502                   | SiliconFlow 服务端错误 | 切换 provider 为 openrouter 重试                                        |
| curl 返回空                    | LLM 响应时间较长       | 增加 `--max-time 60` 参数                                               |
| Agent 连接失败                 | LiveKit 配置错误       | 检查 `.env` 中 `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` |
| Agent STT 无输出               | Deepgram API Key 无效  | 验证 `DEEPGRAM_API_KEY`                                                 |
| Agent TTS 无声音               | Cartesia API Key 无效  | 验证 `CARTESIA_API_KEY`                                                 |
| Agent 转录未写入 DB            | 数据库连接不可达       | 确认 Agent 进程能连接 PostgreSQL                                        |
| `ModuleNotFoundError: livekit` | LiveKit 包未安装       | `pip install livekit-agents livekit-plugins-deepgram ...`               |

---

## 八、Phase 1 后端验收结论

| 检查项           | 通过条件                                                         |
| ---------------- | ---------------------------------------------------------------- |
| 健康检查         | `GET /api/health` 返回 200                                       |
| 创建会话         | `POST /api/sessions` 返回 UUID + status=active                   |
| 查询会话         | `GET /api/sessions/{id}` 返回完整会话对象                        |
| 会话列表         | `GET /api/sessions` 返回数组                                     |
| **发送消息**     | **`POST /api/conversation/chat` 返回 AI 回复 + transcript_id**   |
| **多轮对话**     | **第二条消息能延续上一轮语境**                                   |
| **结束会话**     | **`POST /api/sessions/{id}/end` 返回 status=completed**          |
| **LiveKit 令牌** | **`GET /api/sessions/{id}/token` 返回合法 JWT + ws_url**         |
| **Agent 启动**   | **`python livekit_agent/agent.py dev` 无报错，成功连接 LiveKit** |
| **语音转录写入** | **Agent 对话后 `GET /api/sessions/{id}` 包含 transcripts**       |
| 数据库建表       | 4 张表存在                                                       |
| 代码质量         | `black --check .` 和 `flake8 .` 零错误                           |
