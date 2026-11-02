# RF-10 LiveKit 语音连接策略验证

> 状态：A84 b/r0 已完成文件实施并停在 Review；主 Agent 固定入口检查、独立 Review 与
> main 复验尚未由实施方执行。
> 日期：2026-11-01。
> 基线：`codex/rf10-session-connect-policy@fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d`。

## 1. 问题与 SDK 事实

生产 entrypoint 原先把 `AgentSession` 类直接作为零参数 factory 注入
`AgentJobOrchestrator`。会话创建时因此没有传入 `conn_options`，实际依赖 LiveKit Agents
的隐式默认连接策略。

A84 b/r0 公开正式本地 receipt 锁定 `livekit-agents 1.4.3`：

- `SessionConnectOptions` 是
  `livekit.agents.voice.agent_session` 中的公开 dataclass，不从顶层包 re-export；
- `APIConnectOptions` 可从 `livekit.agents` 公开导入；
- STT、LLM、TTS 三个 role 当前 SDK 默认均为 `timeout=10.0`、`max_retry=3`、
  `retry_interval=2.0`；
- `max_unrecoverable_errors=3` 是 LLM/TTS 连续不可恢复错误的独立阈值，不是第四次连接
  重试。

这些 LiveKit role 选项不同于 A83 普通 OpenAI 兼容 HTTP 客户端的 connect 5 秒、
read/write/pool 600 秒与 `max_retries=2`，两类策略不得互相套用。

## 2. 实施契约

- `backend/provider_catalog.py` 新增 frozen `SessionConnectRolePolicy`、
  `SessionConnectPolicy` 与 `SESSION_CONNECT_POLICY`。Catalog 分开描述三个 role 的
  timeout、max retry、retry interval，并独立保存不可恢复错误阈值；仍为纯标准库，
  不读取 config、环境或凭据，也不进入公开 Provider JSON。
- 新 `backend/livekit_agent/session_policy.py` 仅消费上述公开字段，使用公开
  `APIConnectOptions` 与 `SessionConnectOptions` 完成窄转换。每次调用都创建全新的外层
  选项和三个 role options，避免 mutable `SessionConnectOptions` 跨 Job 共享。
- `backend/livekit_agent/agent.py` 提供零参数 `_create_agent_session()`，在调用时读取
  当前模块的 `AgentSession` 绑定，构造时传入 Catalog 策略。entrypoint 实际注入该
  wrapper；没有捕获旧类作默认参数或使用 partial。
- `AgentJobOrchestrator` 的通用零参数注入合同、默认 factory、错误发送、关闭与清理时序
  不改；`session_policy.py` 不在模块导入时创建 Session 或任务。

## 3. 回归覆盖

- `test_provider_catalog.py` 验证冻结策略的精确默认值、不可变性与纯标准库隔离导入；
  livekit 仍必须在 Catalog 子进程导入中保持零加载。
- 新 `test_session_connect_policy.py` 直接读取真实 SDK
  `SessionConnectOptions()` dataclass 默认值，与 Catalog 三个 role 及独立错误阈值逐项
  对齐。
- 同一新测试文件注入三个 role 均不同且合法的替代策略，逐字段证明 STT/LLM/TTS 与
  `max_unrecoverable_errors` 均被真实消费；另一用例证明两次构建的外层及三个 role
  options 身份独立，修改第二次不会污染第一次。
- `test_job_orchestrator.py` 既有 entrypoint 回归在 patch 当前
  `livekit_agent.agent.AgentSession` 后执行真实生产入口，断言 construction boundary
  收到 Catalog 策略；既有零参数自定义 factory、启动错误、取消与 Sink 清理断言保留。
- 本轮未构造或启动真实 `AgentSession`、Worker 或 Room；验证范围是真实 SDK dataclass
  默认值与真实生产构造边界的参数捕获，不冒充真实语音管线或外部服务验收。

## 4. 未执行与边界

- 实施方按授权只写文件，未运行 formatter、lint、类型检查、测试、build、安装、数据库、
  服务或 Git 写操作。
- 主 Agent 仍需通过固定入口运行相关后端回归、完整 frontend10/backend 专用 PostgreSQL
  测试树、Ruff、OpenAPI 与 Provider metadata 字节检查，并证明各 role 与独立错误阈值的
  有效消费变异会被杀死。
- 本轮不调整现有 10 秒/3 次/2 秒时限，不增加应用重试，不升级 SDK，不接真实 Provider、
  Worker、Room 或设备，也不修改锁文件、公开 schema 或 A83 HTTP 行为。
- 只有独立 Review APPROVED 后才进入正常 hook 本地单 commit、main 精确 fast-forward 与
  main 完整复验；不 push、部署或发布。RF-10 的 Provider Registry 统一与真实外部链路
  验收仍未完成，整项保持未勾选。
