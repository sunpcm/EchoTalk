# RF-10 LiveKit 语音连接策略验证

> 状态：A84 b/r0 已完成文件实施并停在 Review；主 Agent 固定入口检查、独立 Review 与
> main 复验尚未由实施方执行。
> 日期：2026-11-01。
> 基线：`codex/rf10-session-connect-policy@fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d`。
>
> **后续核销注记（A84C，2026-11-14）：** 上方状态保留旧交付时点。后续独立评审已在旧快照
> `42c251b3470aa5f7e9cfe5a1fb2655dc8f9b5aa9` 正式 APPROVED；7 个变异均有效，lane/main
> 15 项复验通过，并完成旧 main 精确 fast-forward。该回执只属于 2026-11-01 旧快照及其授权，
> 不是当前 `44cb125493af4e46e38f7199e197b3cc9bd87bd3` 的测试、Review 或提交结论。上方 main
> 精确 fast-forward 是旧轮授权；本卡按当前授权只提交并推送当前任务分支，不更新 main、不建 PR、
> 不 merge。当前 A84C 状态为 `FINAL_READY`；旧 `livekit-agents 1.4.3` 数值只作历史保留。
> 最终 Review/提交发布见主控同卡回执，用户 Review 待。

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

## 5. A84C 当前核销边界（FINAL_READY）

- 当前只读基线为 worktree `/private/tmp/echotalk-b1-implementation-20261112`、分支
  `codex/B1-learning-events-20261112`、HEAD/base
  `44cb125493af4e46e38f7199e197b3cc9bd87bd3`，起始工作树 clean。旧 APPROVED 提交
  `42c251b…` 不是当前 base 的祖先，不能把旧 15 项门禁、旧 main 复验或旧提交状态平移到当前树。
- 当前 13 项门禁分组执行均 `exit 0`，由
  [A84C-full-gates.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/A84C-full-gates.json)
  核验；最终 Review/提交发布见主控同卡回执，用户 Review 待。当前三份目标测试文件为
  `29 passed`，是完整 backend
  `941 passed` 的子集。旧 A84 的 `37` 目标含另一文件，保持历史，不与当前相加。详细门禁计数、
  PG、冷导入和审计口径集中在
  [PROJECT_STATUS 的 A84C 小节](../../PROJECT_STATUS.md)。
- 当前实际 SDK 为 `livekit-agents 1.6.10`，四个依赖/安装来源一致，无需升级或安装；上文
  `1.4.3` 只保留为旧 A84 快照事实。当前策略仍为三个 role 的 `10s / 3 次 / 2s` 与独立错误
  阈值 3；每次创建全新公开选项，真实 entrypoint 使用动态绑定后的零参数 wrapper。
- 冷导入正向 probe 创建 2 个未 start 的真实 SDK Session，9 个 role 字段、独立错误阈值、对象
  隔离、当前绑定消费和 `finally` 关闭均通过，真实 App config/database 未导入，任何
  `Session.start`、真实 dotenv 或 outbound 服务连接均被阻断。导入期间另有 1 次
  `urllib3._has_ipv6` 的 `bind(::1, 0)` 能力探测被拒；两次探针审计计数归类失败保留为执行事实，
  不能笼统写成“所有导入联网尝试为 0”。
- 当前 2 个私有入口变异分别被 `POLICY_CONSUMPTION_FAILED` 与 `DYNAMIC_BINDING_FAILED` 杀死，
  均 `exit 1` 且源码还原。旧 7 个变异的原始 `check.log` SHA、kill marker 与变异前后指纹已由
  主控写入
  [A84C-historical-mutations-verified.json](/Users/sunpcm/code/EchoTalk/.review/reports/b1-implementation-20261112/A84C-historical-mutations-verified.json)，
  仍只属于历史回执，不与当前 2 个变异混算。
- 真实 Provider、IdP、LiveKit/Worker、设备、远端新 CI、生产部署与真实既有库迁移仍未验收；
  RF-10 整体保持未勾选，RF-12 前置与业务口径不因本页变更。
- 最终 Review/提交发布见主控同卡回执，用户 Review 待。当前授权只提交并推送当前任务分支，
  不更新 main、不建 PR、不 merge、不部署。
