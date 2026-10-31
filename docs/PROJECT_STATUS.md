# EchoTalk 当前状态与变更决策

> 本文是 EchoTalk “当前已经实现什么、最近改变了什么、明确没有采纳什么”的权威入口。
> 未完成工作维护在根目录 [`TODO.md`](../TODO.md)；具体架构和人工验收步骤仍由各阶段技术文档负责。

## 维护基线

- 最近本地核对日期：2026-11-01。
- 代码基线：`main@a92dc545d68f68e6267e0e97f98a5be5e7fc3739`
  （`feat: integrate locally reviewed cross-platform milestones (A45-A63)`，squash 合并）。
- 远端状态：`main` 为受保护分支（必需状态检查 `test-frontend` / `test-backend`、线性历史、对话已解决，
  admin 同样受限），直推会被保护钩子拒绝（GH006）。本地累积提交通过 PR + CI 送回远端：
  [PR #108](https://github.com/sunpcm/EchoTalk/pull/108) 已 squash 合并，`test-frontend`、`test-backend`
  与 `CI` 三项均通过。后续轮次沿用同一路径：分支 + PR，不直推 main。
- 自动化证据：PR #108 的 CI run 41217340177 是最近一次远端 CI 记录；
  更早的 #92（`286a3db`）CI run 39348513442 保留为历史发布证据。
  A45–A63 的本地增量另由本地固定门禁逐轮验证，详见各轮评审报告与
  `docs/verification/cross-platform/`。
- 证据范围：CI 与本地门禁已验证格式、Lint、TypeScript、前端构建、Vitest、Playwright、Ruff、
  PostgreSQL 迁移和后端覆盖率测试。它们都不能代替真实 LiveKit、第三方 Provider、移动端真机
  或生产部署验收；这些边界应在对应验收文档或 `TODO.md` 中单独记录。

## 2026-11-01 本地 RF-11 公共 API 取消入口实施记录（A66）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“保留小型自定义 Transport，统一处理
认证、超时、取消、错误解析和 API Origin”完成公共调用入口子项。新增只包含可选 `signal`
的 `ApiRequestOptions`，让调用方直接通过公开网络函数控制单请求取消。

- **接口契约**：`ApiRequestOptions` 只含 `readonly signal?: AbortSignal | null`；实际 22 个
  网络函数均在末尾追加该参数，保留 `owner`、`docContext`、`takeover`、查询参数及全部默认值。
  无 owner 的 `getSessionToken`、`dispatchAgent` 仍需显式传 `undefined` 占位，options 不会被
  误判为业务参数。
- **请求边界**：各函数只把 `options?.signal` 写入单请求 `RequestInit.signal`，不暴露任意
  `RequestInit`、Headers 或 timeout，也不把 options 展开进 body。请求继续复用 A64 组合句柄；
  预取消在 `fetch` 前零请求，在途取消抛出 `ApiRequestAbortedError`，一次请求不重放；普通
  请求保持 10s，`updateUserSettings` 保持 15s。
- **既有语义**：URL/query/body、method、`cache: "no-store"`、认证与 owner Header、认证
  revision 二次检查、HTTP 错误/`ApiError`、401 按原 revision 失效、错误解析及单请求行为不变；
  两个并发请求使用独立组合句柄，取消一个不会影响另一个。
- **测试覆盖**：`apps/vite-app/src/lib/api.test.ts` 以 24 个表驱动调用覆盖全部 22 个端点及
  owner/无 owner 分支，并通过真实公开函数覆盖预取消、在途取消、并发隔离、写请求 body 与
  owner Header、缺省/null signal、HTTP 401、认证 revision 竞争和设置更新 15s 预算；既有
  无外部取消超时及全部负向用例保留。本实施节点按流程停止写入，尚未运行 formatter、测试、
  类型、构建或后端门禁，不能宣称本轮已通过。
- **边界与记录**：未接入 UI/store 生命周期主动 abort，未验证浏览器/原生 WebView 与后端任务
  停止语义；OpenAPI 类型生成和 `VoiceInterface`、`SettingsDrawer` 大组件拆分仍未完成，RF-11
  整项保持未勾选。契约见
  [RF-11 公共 API 取消入口验证](./verification/cross-platform/RF-11-PUBLIC-CANCELLATION.md)。

## 2026-11-01 本地 RF-11 会话状态判别联合与 Reducer 实施记录（A65）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“将会话状态改为判别联合或 Reducer”
完成会话状态子项。新增纯模块 `apps/vite-app/src/store/conversationState.ts`，内部以明确
phase 表达健康检查、创建会话、获取令牌、凭据就绪、active、ending、失败与终态；生产 store
真实消费该模型的构造、守卫、Reducer 与投影，未增加未接线的并行状态。

- 单一真值与兼容面：Zustand 内部 `_sessionState` 为判别联合真值，九个外部
  `connectionState` 字符串及 nullable `sessionId/token/wsUrl` 在同一个原子 set 中投影；
  空闲态 token/wsUrl 仍为 null，全部既有 action、`appView/error/sessionGen/agentError/
selectedScenario/dispatched*` 与公开 `setState` 测试入口保持兼容。公开扁平夹具经同一层
  归一化，完整非空 sessionId/token/wsUrl 才能进入 credentials-ready 或 active。
- 启动语义纠偏：旧 `connecting + null token` 是 `startSession` 的刻意过渡态，内部进一步拆为
  `creating_session` 与 `fetching_token`；认证/生命周期“启动中”判定只覆盖
  `checking_health/creating_session/fetching_token`，有凭据的 connecting 不属于启动中。
  `resumeSession` 仍在校验、详情、健康检查与 token 全部成功后一次发布完整凭据。
- 状态机保持：`setActive` 仅允许 credentials-ready 转 active；dispatch/connection 失败只从
  connecting/active 生效并清凭据；ending、end_failed、ended 保留原 sessionId，包括无会话时
  直接 ended；reset/goHome 清内部模型与扁平投影；markDispatched 去重、全部 sessionGen 增量、
  写后复核、auth revision/principal 与迟到响应隔离保持。
- 消费面与 UI：`VoiceInterface` 通过模型类型收窄决定 idle/startup/终态/room-ready 分支，
  仅 `credentials_ready/active` 可挂载 LiveKitRoom，Room key/props、DOM、文案与释放行为不变；
  `ActiveSessions` 启动判定复用同一纯守卫。
- 验证范围与边界：新增纯模型矩阵、非法凭据与类型负向、真实 create/token 前后 phase、
  public setState 原子归一化、无效激活、reset/goHome、ending/end_failed/ended 身份以及 UI
  房间挂载回退回归。本实施节点按评审流程停写，固定质量门禁、Vite Vitest、Playwright、
  backend pytest 与变异检查待主 Agent 在受控权限下复验，未在本节点宣称通过。
- 契约与记录见 [RF-11 会话状态模型验证](./verification/cross-platform/RF-11-STATE-MODEL.md)。
  OpenAPI 类型生成与 `VoiceInterface`/`SettingsDrawer` 大组件按行为拆分仍未完成，RF-11
  整项保持未勾选。

## 2026-11-01 本地 RF-11 Transport 请求超时与取消边界实施记录（A64）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“保留小型自定义 Transport，统一处理认证、超时、取消、错误解析和 API Origin”完成本地实施。新增 `apps/vite-app/src/lib/apiRequestTimeout.ts` 与直接单测，并由 `apps/vite-app/src/lib/api.ts` 的真实 `request` 消费；普通请求默认预算 10s，`updateUserSettings` 显式采用 15s，以覆盖后端最多 10s 的 Provider 并行校验及连接/响应余量。

- 模块边界与非法值：解析仅接受正有限数，`0`、负数、`NaN`、无穷与非数字安全回退 10s；模块零网络、异步请求、DOM 节点、store、日志正文、全局可变配置与反向业务依赖，不修改传入参数，重复调用互相隔离。
- 取消与超时契约：组合调用方 `AbortSignal` 与内部计时器；已取消 signal 在 `fetch` 前零网络短路；预算耗尽抛出 `ApiRequestTimeoutError`，调用方取消抛出 `ApiRequestAbortedError`，两者均不是 `ApiError` 且文案不含 URL、token、Header 或正文；外部取消始终优先，超时与取消不自动重试或重放请求。
- 请求链路保持：认证 revision 读取、token 获取、revision 二次校验、Header 构造之后才创建组合 signal；原 `baseUrl/path`、`...options`、HTTP 错误与 `ApiError`、401 按原 revision 失效、非 JSON 回退、网络错误原样重抛及单次 `fetch` 均保持；超时/取消分别记录 `api_request_timeout` / `api_request_aborted` 结构化诊断。
- 验证范围：直接单测覆盖默认/覆盖/非法预算、已取消 signal 零请求、错误类型区分、外部取消优先、计时器清理、错误文案稳定、冻结参数与实例隔离；公共 API 消费回归验证最终 fetch signal、超时与取消错误、一次 fetch 及设置更新的较长预算。固定检查入口因子 Agent 沙箱不能写锁目录而以 exit 78 / `PermissionError` 拒绝，独立评审阶段由主 Agent 在受控权限下补跑全部门禁并通过（前端 quality 8/8、Vite Vitest 31 文件/854 项、Chromium E2E 148、后端 pytest 529 项/82.49%）；评审另修复 `RequestInit.signal` 的 `AbortSignal | null` 类型缺陷并补 `null` 边界单测，三项前端变异自检全部被杀死。
- 契约与记录见 [RF-11 Transport 请求超时与取消边界验证](./verification/cross-platform/RF-11-REQUEST-TIMEOUT.md)。OpenAPI 类型生成与会话状态模型重构仍待完成，RF-11 整项保持未勾选。

## 2026-10-31 本地 RF-11 API 请求 Header 合并边界抽离实施记录（A63）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“合并 `RequestInit.headers` 时保留默认 Header，不允许调用方无意覆盖认证信息”完成本地实施。将 `apps/vite-app/src/lib/api.ts` 的 `request` 内 Header 构造抽为独立同步纯函数 `apps/vite-app/src/lib/apiRequestHeaders.ts`，保持原请求链路时序与行为，并以直接单测和公共 API 消费回归验证。

- 模块边界：`buildApiRequestHeaders(inputHeaders, accessToken)` 仅使用标准 `Headers` 初始化语义，返回新 `Headers`；零网络/异步/DOM/store/日志/全局可变状态，且不反向导入 `api.ts`、`auth.ts` 或业务模块。
- 行为等价：未提供 `Content-Type` 时补 `application/json`；调用方已有值原样保留；有 token 时使用 `Bearer <token>` 覆盖认证 Header；无 token 时不删除调用方显式 `Authorization`；自定义 Header 与标准多值语义保持，不手动拼接字符串。
- 请求链路：`request` 在原有 `getAuthRevision()` 与 `await getAccessToken()` 及 revision 二次校验之后真实委托新模块；`baseUrl/path`、`...options`、最终 `headers`、诊断、`ApiError`、401 失效、非 JSON 回退和单次 fetch 均未改变。
- 验证范围：直接单测覆盖空、对象、数组、`Headers`、既有内容类型、显式认证、无 token、自定义 Header、冻结输入、多值和实例隔离；公共消费者测试用可证伪 spy 断言模块委托、最终 Headers 内容及一次 fetch。
- 契约与记录见 [RF-11 API 请求 Header 合并边界抽离验证](./verification/cross-platform/RF-11-REQUEST-HEADERS.md)。前端 API 类型生成、会话状态模型重构及超时/取消仍待完成，RF-11 整项保持未勾选。

## 2026-10-29 本地 RF-11 API 错误消息解析边界抽离实施记录（A62）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“保留小型自定义 Transport，统一处理认证、超时、取消、错误解析和 API Origin”与 `TODO.md` RF-11 要求完成本地实施。将 `apps/vite-app/src/lib/api.ts` 内错误响应体解析为错误消息的纯计算抽离为小型独立纯函数模块 `apiErrorMessage.ts`，由真实客户端 `request` 消费，新增直接单测及可证伪测试替身消费回归，并闭环 A61 两项文字 P2。

- 本地实现与模块边界：新建 `apps/vite-app/src/lib/apiErrorMessage.ts`，提供 `getApiErrorMessage(status: number, body: unknown): string` 纯计算函数；模块零网络、零 DOM/React/store/全局可变状态依赖，不发请求、不打日志、不缓存响应体；零反向导入 `api.ts`、`auth.ts` 或任何业务服务；`ApiError` 保持在原 `api.ts` 导出且签名与字段 100% 保持不变。
- 逐项行为等价契约保持：
  - 默认文案保持 `请求失败: <status>`。
  - 标准 FastAPI `detail` 字符串包括合法空字符串 `""` 均优先采纳。
  - 422 验证异常仅检查首项 `body.detail[0]`，非法首项不扫描后项；合法 `msg` 允许空字符串；`loc` 仅在全为 string/number 数组时安全拼接（空数组合法拼接为空字符串），其余非法或缺失结构统一安全回退 `"Unknown"`。
  - `detail.errors` 仅取首项有效非空字符串，首值为空时不扫描第二项；`detail.message` 仅在非空字符串时采纳；合法空嵌套 `message` 或空对象回退 `JSON.stringify` 兜底；序列化异常安全回退默认文案。
  - 外层 `errors` 仅取首项有效非空字符串；外层 `message` 支持合法空字符串。
- 客户端真实消费与请求链路保持：`apps/vite-app/src/lib/api.ts` 的 `request` 移除旧错误解析私有副本并真实消费 `getApiErrorMessage`；401 在读取 JSON 前按原 revision 触发会话失效、非 JSON 解析失败安全回退 `{}`、认证检查、单次请求无重放等完整保留原有时序；原 `status` 与 `body` 对象身份完全保留。
- 携带 A61 文字 P2 修正：
  - `RF-11-SETTINGS-PAYLOAD.md` §2.1 标题“纯纯计算”更正为“纯计算”。
  - `RF-11-SETTINGS-PAYLOAD.md` §2.2 首行测试统计数由笔误的“新增 7 项”更正为实际清单与执行的“新增 8 项”。
- 质量与回归测试：新增 `apiErrorMessage.test.ts`（7 个 describe 分组覆盖默认文案、detail 字符串、422 数组、detail 嵌套对象、外层 errors/message、优先级及冻结入参不变性）；在 `api.test.ts` 中新增可证伪测试替身（spy mockReturnValue 证实 request 真正委托新纯函数，断言单次 fetch 与 status/data 保留，并在 finally 恢复）；原约 2088 行测试断言全部原样保持。
- 契约与记录见 [RF-11 API 错误消息解析边界抽离验证](./verification/cross-platform/RF-11-API-ERROR-MESSAGE.md)。前端 API 类型生成与会话状态模型重构仍待完成，RF-11 整项保持未勾选。

## 2026-10-29 本地 RF-11 设置保存载荷行为抽取实施记录（A61）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“按行为拆分 SettingsDrawer”与 `TODO.md` RF-11 要求完成本地实施。将 `SettingsDrawer.handleSave` 内构建 `UserSettingsUpdate` 载荷的纯计算抽为小型独立纯函数模块 `settingsPayload.ts`，由真实组件消费，新增直接单测及真实保存回归，并修复两项维护 P2。

- 本地实现与模块边界：新建 `apps/vite-app/src/components/settings/settingsPayload.ts`，提供 `buildSettingsUpdate(input: SettingsPayloadInput): UserSettingsUpdate`；模块仅导入类型（`import type { UserSettingsUpdate }`），零 React/DOM/store/持久化依赖，零网络副作用，零全局可变状态与明文密钥保存；入参采用纯标量快照接口，绝不修改输入对象，每次调用返回全新独立对象。
- 逐项行为等价契约保持：
  - 始终携带 `is_custom_mode` 布尔值。
  - `isCustomMode: false` 时，返回且仅返回 `{ is_custom_mode: false }`，绝不携带 provider/model/key 字段。
  - `isCustomMode: true` 时，按原有确定性字段顺序设置 `stt_provider`、`llm_provider`、`tts_provider`；`llmModel.trim()` 非空才设置 `llm_model`；各 role 的 key 仅在 `trim()` 后非空才携带，全空白或空字符串表示省略不更新，不引入清空语义；严禁带入 `theme`、`has_key`、`status` 等额外字段。
- 组件真实消费与交互保持：`SettingsDrawer.tsx` 引入并直接在 `handleSave` 消费 `buildSettingsUpdate`；单次保存只调用一次 `updateSettings`；原 `saving` 状态管理、错误/成功提示与 toast 定时器、加载/后端同步清空密钥草稿、订阅权限判定及原生 dialog 模态焦点/键盘/动画/样式行为 100% 保持不变。
- P2 维护修正落地：
  - 修复 `backend/tests/test_user_settings_service.py` 中 `test_production_router_consumes_service_directly` 用例在退出时执行 `app.dependency_overrides = {}` 清空全局依赖字典的问题，改为基于 `try...finally` 精确保存与恢复 `get_db` 原有覆盖（原不存在则仅 `pop` 自身键），避免污染其他 fixture 的认证依赖。
  - 修正 `docs/verification/cross-platform/RF-10-SETTINGS-SERVICE.md` §2.2 首行测试数量笔误（13 项修为实际 14 项）。
- 质量与回归测试：新增 `settingsPayload.test.ts` 覆盖 on/off、单/多 key 分别与混合、全空白/前后空白截断、空/非空 model、冻结入参不变性、多调用独立对象及无额外字段测试；在 `SettingsDrawer.test.tsx` 中增加真实保存消费回归（离线 store 替身，验证消费 `buildSettingsUpdate` 且传给 `updateSettings` 的完整 payload，在 `finally` 完整恢复覆盖）。
- 契约与记录见 [RF-11 设置保存载荷行为抽取验证](./verification/cross-platform/RF-11-SETTINGS-PAYLOAD.md)。前端 API 类型生成与会话状态模型重构仍待完成，RF-11 整项保持未勾选。

## 2026-10-29 本地 RF-10 用户设置业务服务边界实施记录（A60）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-10“统一 Provider Registry 和设置服务”与 `TODO.md` RF-10 要求完成本地实施。将 `backend/routers/user.py` 中的设置响应构建、权限判断、按变更凭据验证与更新/加密业务逻辑抽入独立纯净服务 `backend/services/user_settings_service.py`，HTTP 路由仅保留认证依赖、当前用户限定数据库事务边界与薄兼容委托。

- 本地实现与服务边界：新建 `backend/services/user_settings_service.py`，提供 `get_key_status`、`decrypt_and_rotate`、`as_validation_result`、`build_user_settings_response`、`validate_custom_mode_permission`、`validate_provider_keys` 与 `apply_settings_update` 独立业务纯函数及无状态命名空间类 `UserSettingsService`；模块零反向导入 `routers/user`、`main` 或 HTTP 应用实例，保持最小公开面；禁止泛化框架与单例驻留用户凭据；无模块导入期默认值绑定与全局可变状态。
- 路由薄委托与依赖注入契约：`backend/routers/user.py` 的 `GET /api/user/settings` 与 `PUT /api/user/settings` 直接消费 `UserSettingsService`；保留原 7 项 helper 函数签名与薄委托；在调用时从路由命名空间动态传入 `decrypt_api_key`、`encrypt_api_key` 与 `ProviderValidationService`，保证已有测试对 `routers.user` 模块属性的 patch 100% 兼容生效。
- A54 与 A55 业务契约完全保持：未变化 role 保持零旧密文读取、零解密、零轮换、零拨测并复用原有有效性；显式新 key 仅拨测新 key 绝不解密旧密文；仅变更且沿用旧 key 时按需解密对应 role，并在 `needs_rotation` 时重加密写入；严格保持 STT → LLM → TTS 校验与 422 失败字典字段顺序；`has_key` 严格基于 `is not None` 判断；响应结构绝不返回明文、密文或版本号；free 用户禁止关闭 custom mode (403)。
- 质量与回归测试：新增 `backend/tests/test_user_settings_service.py`（14 项测试），覆盖状态三态映射矩阵、布尔测试替身转换、空记录默认值与指定 tier、响应字段脱敏与默认主题回退、free 用户 custom mode 权限阻断、空密文零解密、旧 key 沿用与按需旋转、无变更零拨测零解密、显式新 key 仅测新 key、422 detail.providers 顺序保持、字段写入与三路全 true 判定、路由 7 项薄委托与 patch 兼容性，以及通过 Spy 证实生产 HTTP GET/PUT 入口直接消费 `UserSettingsService`；全量后端测试由 515 项增加至 529 项全量通过（覆盖率 82.49%，`user_settings_service.py` 覆盖率 98%），Ruff 格式与 Lint 检查全部通过。
- 契约与记录见 [RF-10 用户设置业务服务边界验证](./verification/cross-platform/RF-10-SETTINGS-SERVICE.md)。真实外部 Provider 拨测与前端元数据展示统一仍待后续完成，RF-10 整项保持未勾选。

## 2026-10-28 本地 RF-09 重入回归测试有界失败与资源清理实施记录（A59）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` 与 `TODO.md` RF-09 要求完成本地实施。针对上一轮变异测试将重入查询置 False 导致 Event/回调等待互等直至 900 秒硬超时的门禁隐患，为重入与关闭测试建立独立外部完成观察预算与协调资源清理机制，修正显式 None 语义，补充确定性负向测试与故障路径验证。

- 独立外部完成观察预算与等待收拢：在 `test_sink_reentry_boundary.py`、`test_error_task_lifecycle.py` 与 `test_transcript_sink.py` 中引入命名测试预算常量（`TEST_REENTRY_BUDGET_SECONDS = 2.0` / `TEST_ERROR_LIFECYCLE_BUDGET_SECONDS = 2.0` / `TEST_SINK_BUDGET_SECONDS = 2.0`），抽取本地纯标准库异步等待 helper `_wait_bounded` 与轮询 helper `_poll_bounded`，针对性覆盖 Event 永不到达、关闭互等与 `while ...: await asyncio.sleep(0)` 无限循环场景；`_wait_bounded` 改为显式持有 Task 并通过 `asyncio.wait(timeout)` 观察，到期不在观察函数中无限等待取消完成（规避底层 shield 延迟响应取消导致测试卡死无法进入 finally），由 finally 接管，所有新建观察 Task 自动登记与回收。
- 协调 Try...Finally 资源清理与任务收束：在核心重入与关闭测试中建立严格的异常清理契约：测试无论因断言失败还是超时抛出 `TimeoutError`，`finally` 块均释放自建 gate（`allow_reentrant_close`、`disconnect_entered`、`gate1`、`gate2` 等）；通过 `_cleanup_test_resources` 一次性收集测试装置拥有的外部 Task、Orchestrator 共享 `_sink_close_task` 与错误任务以及 Sink worker/notify/close 任务，统一发起取消解开 shield 依赖并收束，检索所有（含早已完成）任务异常，对最终 pending 明确报错并给出任务名称；多资源清理保证前项失败不跳过后续资源。
- 严格区分正常关闭与强制清场：移除测试 helper 中直接写 `sink._closed=True` / `sink._accepting=False` 伪造关闭终态的做法；正常关闭由测试正常调用产品 `close()` 并验证其返回值、快照与任务状态；强制清场仅在异常/负向分支取消并等待自有任务，严禁伪造产品终态属性。
- 通知 Task 身份保持与显式 None 语义统一：澄清并修正文档与注释中对 `is_failure_notification_task(task=None)` 的误述，确立 `task=None` 与无参调用语义严格对齐，均指代当前任务（在通知任务内部返回 `True`，在外部任务返回 `False`）；重入测试直接在通知原 Task 中直接 await `sink.close()`，消除包装任务导致的身份漂移，并增加断言证明通知回调 Task 身份及重入非取消回退。
- 确定性负向测试与故障路径验证：新增 `test_negative_reentry_bounded_timeout_when_notification_event_never_arrives`（使用真实故障通知回调挂起装置证明通知未到达在短预算内可判定超时并收束任务）与 `test_negative_reentry_deadlock_detected_when_reentry_query_returns_false`（使用本地替身模拟重入查询返回 False 造成关闭互等，在短预算内捕获死锁并在 finally 完整收束所有任务）；新增 `test_sink_close_delayed_cancellation_response_external_budget_expires_first`（验证底层延迟响应取消时外部完成观察预算先到期抛错且随后在 finally 释放门控并清场）与 `test_cleanup_continues_and_cleans_remaining_resources_when_one_step_fails`（验证清理步骤中某个步骤失败时仍继续收束其余自有资源）；使重入回归在变异场景下确定性失败退出 (exit 1) 而非挂起 900 秒（单个观察预算为 0.05s~2.0s，整套变异回归在约 22 秒内产生 4 项预期失败并退出）。
- 质量与回归测试：后端测试由 511 项增加至 515 项全量通过（覆盖率 82.22%），Ruff 格式与 Lint 检查全部通过。
- 契约与记录见 [RF-09 重入回归测试有界失败与资源清理验证](./verification/cross-platform/RF-09-BOUNDED-REENTRY-TESTS.md)。`sys.path`/dotenv 清理与真实 LiveKit 环境验收仍待后续完成，RF-09 整项保持未勾选。

## 2026-10-27 本地 RF-09 公共 Sink 通知重入边界实施记录（A58）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-09 明确边界与 `TODO.md` RF-09 要求完成本地实施。建立 `TranscriptSink` 小型公共行为查询，重构 `AgentJobOrchestrator._close_sink` 关闭逻辑消除对 `sink._notify_task` 私有字段的耦合，保持各组件关闭预算、算法及状态记账不变，并闭环 A57 两项文字 P2。

- 本地实现与公共查询边界：在 `backend/livekit_agent/transcript_sink.py` 中新增公共行为查询方法 `is_failure_notification_task(task: asyncio.Task[Any] | None = None) -> bool`，仅返回当前或指定任务是否为本 Sink 的故障通知任务（`task=None` 与无参调用一致均指当前任务）；返回值严格为 `bool`，不暴露内部 Task 对象；查询为只读纯行为，零写入、零副作用，不改变 Sink 任何状态或记账快照；在无运行事件循环或外部普通任务调用时安全返回 `False`；Sink 自身 `close()` 重入检测改为使用该公共查询。
- 编排器解耦与零私有字段访问：在 `backend/livekit_agent/job_orchestrator.py` 的 `_close_sink()` 中，使用 `getattr(self.sink, "is_failure_notification_task", None)` 公共查询识别 Sink 故障通知重入，彻底消除对 `self.sink._notify_task` 的跨组件私有访问；识别到重入时直接 `await self.sink.close()` 避免死锁；对普通调用继续通过 `_sink_close_task` 共享关闭，保持 `TranscriptSink` 8.0 秒排空预算、异常传播语义及原布尔返回值不变；Orchestrator 自有 2.0 秒通知排空预算保持独立。
- 故障通知重入端到端闭环：通过真实 `TranscriptSink` 写入失败触发重试耗尽与 `on_failure`，经由真实 `AgentJobOrchestrator._on_sink_failure` 调用 `_send_error_fn` 并执行 `ctx.room.disconnect()`，进而触发注册的单一组合 shutdown callback（`orchestrator.close`），完成“Sink故障通知 → disconnect → Orchestrator.close → Sink.close”重入全链路闭环，证实无自锁、无自取消、任务全收束且并发外部 close 安全共享。
- A57 文字 P2 修复：修正 `PROJECT_STATUS.md` 中 A57 实际新增测试数为 12（此前误写为 10）；核验真实 `backend/tests/test_error_task_lifecycle.py` 文件（每项测试恰有一个 `@pytest.mark.asyncio`，无重复装饰器）。
- 质量与回归测试：新增 `backend/tests/test_sink_reentry_boundary.py`（6 项测试），覆盖公共查询多形态矩阵与状态不变性、真实 Sink 故障通知重入完整链路、严格零 `_notify_task` 私有字段访问保护、并发 Agent 运行时错误与 Sink 故障双重通知合作式排空、健康 Sink 正常关闭；扩展 `backend/tests/test_transcript_sink.py` 验证查询矩阵；扩展 `backend/tests/test_job_orchestrator.py` 验证边界查询；后端全量 511 项测试通过（覆盖率 81.99%）。
- 契约与记录见 [RF-09 公共 Sink 通知重入边界验证](./verification/cross-platform/RF-09-SINK-REENTRY-BOUNDARY.md)。`sys.path`/dotenv 清理与真实 LiveKit 环境验收仍待后续完成，RF-09 整项保持未勾选。

## 2026-10-27 本地 RF-09 运行时错误通知任务所有权与关闭收束实施记录（A57）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-09“追踪后台任务，在进程退出前排空或安全取消”及 `TODO.md` RF-09 要求完成本地实施。修复 `backend/livekit_agent/job_orchestrator.py` 的 `on_agent_error` 中未被所有者追踪的 `asyncio.ensure_future`，建立实例级运行时错误通知任务追踪、异常安全检索与 Job 关闭合作式排空机制，保持错误分类、A56 共享发送出口与 `TranscriptSink` 实现不变。

- 本地实现与任务所有权契约：`AgentJobOrchestrator` 实例独立维护自有运行时错误通知任务集合（`_error_tasks` / 只读属性 `error_tasks`）与关闭状态（`closing` / `closed`）；活动阶段每次符合既有 `AgentErrorMapper.classify_runtime_error` 的事件创建受追踪 `asyncio.Task`，基础轨与可恢复事件保持不派发；挂载完成回调 `_on_error_task_done` 自动移除任务并安全检索异常，失败仅记录静态安全日志 `"运行时错误通知任务执行失败: session=%s"`（使用清洗后的 `safe_session_id`），绝不记录异常正文、密钥、未清洗房间名或 traceback；`CancelledError` 安全检索，消除 `"Task exception was never retrieved"` 告警。
- 组合关闭、合作式排空与重入防自锁：正常 `run` 成功返回后保持在途通知与健康 `TranscriptSink` 存活直至 Job shutdown；以单一组合回调 `orchestrator.close` 替代原 `self.sink.close` 注册，保持单个 shutdown callback 与原 `sink.close()` 的 `bool` 返回值语义；`close()` 开始时同步标记 `closing = True` 并阻断迟到 `error` 回调创建新通知；对既有自有通知任务提供命名类常量 `ERROR_TASK_DRAIN_TIMEOUT_SECONDS = 2.0` 秒合作式排空预算（支持测试 patch），到期对剩余任务执行 `cancel()` 并 `await` 收束；随后关闭 `TranscriptSink` 且保持其 8.0 秒排空预算与异常传播语义不变；当通知内 `ctx.room.disconnect()` 触发 shutdown callback 重入时，自动排除当前任务自身（`asyncio.current_task()`）及重入集合，杜绝自等待死锁与自取消；重复与并发 `close()` 调用幂等安全；`setup` 失败、`start` 失败或 `run` 取消以及 `close` 自身被取消时均完整收束自有通知任务并关闭 `Sink`。
- 质量与回归测试：新建 `backend/tests/test_error_task_lifecycle.py`（12 项异步测试），全部通过真实注册保存的 `error` 回调触发，结合 `asyncio.Event` 与短预算 patch 覆盖活动阶段追踪与完成移除、异常静态安全检索与 Canary 防护、`CancelledError` 安全检索、`run` 成功返回不误关健康 `Sink`、2.0s 预算内合作式排空与超时取消且保留 `Sink` 8.0s 预算、shutdown 期间与之后迟到回调零通知、`setup`/`start` 失败与取消清理、双 Job 隔离、`disconnect` 触发 shutdown 重入无自锁、并发/重复 `close` 幂等及 `close` 取消清理与 `Sink` 异常传播；同步适配 `test_job_orchestrator.py` 与 `test_agent_errors.py`。
- 契约与记录见 [RF-09 运行时错误通知任务生命周期验证](./verification/cross-platform/RF-09-ERROR-TASK-LIFECYCLE.md)。`sys.path`/dotenv 清理与真实 LiveKit 环境验收仍待后续完成，RF-09 整项保持未勾选。

## 2026-10-27 本地 RF-09 安全错误发送与断连出口收敛实施记录（A56）

基于 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-09 单一 `ErrorMapper` 边界及 `TODO.md` RF-09 要求完成本地实施。收敛 `backend/livekit_agent/agent.py` 中 `_send_error_and_disconnect` 与 `backend/livekit_agent/job_orchestrator.py` 中 `_default_send_error` 重复的安全 payload 构造、DataChannel 发布与房间断连实现，保持全部既有可观察行为与测试注入边界不变。

- 本地实现与单一出口边界：新建 `backend/livekit_agent/error_delivery.py`，提供共享异步函数 `send_error_and_disconnect(ctx, code, message=None, fallback_code="ERR_SYSTEM_RUNTIME")`；模块仅依赖 Python 标准库（`json`、`logging`、`typing`）与既有 `AgentErrorMapper`，零配置/数据库/凭据读取，零反向导入 `agent` 或 `job_orchestrator`，导入期零网络或服务副作用；保留 `agent._send_error_and_disconnect` 与 `job_orchestrator._default_send_error` 原函数名、参数顺序、默认值及各自模块属性的 patch 兼容性，包装体仅委托调用 `send_error_and_disconnect`。
- 安全契约与异常传播保持：继续使用同一 `echotalk-agent` logger、原有安全日志文本、`{"type": "agent_error", "code": safe_code, "message": safe_message}`（`ensure_ascii=False`）、`reliable=True` 与 `topic="agent_error"`；先经 `AgentErrorMapper.map_error` 映射白名单错误码与静态文案并经 `sanitize_session_id` 清洗房间名；普通 `publish_data` 异常仅记录静态警告 `"发送错误消息到客户端失败"` 后继续执行 `ctx.room.disconnect()`；`disconnect()` 异常原样向上传播；`publish_data` 阶段 `asyncio.CancelledError` 原样传播且不擅自增加 `disconnect()` 调用；保留 `entrypoint` 与 `AgentJobOrchestrator` 全部回调注入路径、调用次数及初始化/运行时错误分类。
- 质量与回归测试：新建 `backend/tests/test_error_delivery.py`，对共享函数及两个真实包装函数执行直接端到端验证（不以 mock 共享函数代替真实逻辑验证），覆盖 AST 纯净导入边界、函数签名一致性、9 项白名单错误码与非转义中文 JSON payload、自定义轨/基础轨/非法 fallback 降级、恶意 `code`/`message`/`session_id` Canary 脱敏、普通 publish 失败仍断连、disconnect 失败原样传播、publish 阶段 `CancelledError` 传播且不断连、双包装委托一致性与模块级 patch 兼容；同步补充 `backend/tests/test_agent_errors.py` 中 `CancelledError` 不触发断连断言，既有 `test_agent_errors.py` 与 `test_job_orchestrator.py` 全部保持通过。
- 契约与记录见 [RF-09 安全错误发送出口收敛验证](./verification/cross-platform/RF-09-SHARED-ERROR-DELIVERY.md)。`sys.path`/dotenv 清理与真实 LiveKit 环境验收仍待后续完成，RF-09 整项保持未勾选。

## 2026-10-27 本地 RF-10 多 Provider 有界并行验证实施记录（A55）

基于 TODO.md RF-10“多个独立 Provider 需要验证时可以并行执行，但必须限制总超时”及 A55 冻结契约完成本地实施。在严格保留 A54 凭据惰性解密边界与公开 API 响应契约的基础上，将多路独立 Provider 凭据拨测由串行等待升级为统一总预算下的有界并发执行。

- 本地实现与有界并发契约：在 `backend/services/validation_service.py` 中新增类常量 `TOTAL_TIMEOUT_SECONDS = 10.0`（保留单请求 `REQUEST_TIMEOUT_SECONDS = 8.0`）与可复用入口 `ProviderValidationService.validate_parallel`；输入按 STT → LLM → TTS 确定顺序接收需拨测的 `(role, provider, key)`，基于标准库 `asyncio` 并发调度并在整批总预算内等待；总预算到期时保留已完成 role 的真实 `ProviderValidationResult`，未完成 role 统一标记为 `ProviderValidationResult(False, "timeout")`，并对所有 pending 任务执行 cancel 与 await 收束，杜绝后台遗留任务；底层出现未捕获编程异常时，先完整收束所有其他任务并消费已完成任务异常，再原样重抛；`validate_all` 改为复用 `validate_parallel` 并保持 `bool` 返回兼容。
- 路由接线与惰性解密保持：`backend/routers/user.py` 的 `_validate_provider_keys` 仅将 A54 判定为 changed 且同时具有 provider 与 key 的 role 加入拨测批次；未变化 role 保持零旧密文读取、零解密、零轮换、零拨测并复用既有 `is_valid`；变化但缺 provider/key 的 role 保持 invalid 且不创建空拨测；多 role 并发完成后，`detail.providers` 仍严格按 STT → LLM → TTS 顺序构造，不受实际完成先后影响。
- 质量与回归测试：新建 `backend/tests/test_settings_parallel_validation.py`（覆盖三 role Barrier 并发进入、逆序完成下 422 failures 保持 STT→LLM→TTS 顺序、总预算超时保留已完成结果并取消/等待 pending 任务、单 role 与零 role 无额外任务）；扩展 `backend/tests/test_validation_service.py`（覆盖空输入、稳定顺序、总超时与 pending 清理、意外异常清理后重抛、`validate_all` 并行复用与布尔兼容）；同步更新 `backend/tests/test_settings_lazy_decryption.py` 顺序说明注释，完整保留 7 项惰性解密边界断言。
- 契约与记录见 [RF-10 多 Provider 有界并行验证](./verification/cross-platform/RF-10-BOUNDED-PARALLEL-VALIDATION.md)。真实外部 Provider 拨测与前端展示元数据统一仍待完成，整项保持未勾选，RF-10 持续推进。

## 2026-10-26 本地 RF-10 用户设置凭据惰性解密实施记录（A54）

基于 TODO.md RF-10“非敏感设置不解密旧凭据”要求完成本地实施。修复用户设置更新路径（`PUT /api/user/settings`）无条件解密 STT/LLM/TTS 三路旧凭据的缺陷，确立严格的惰性解密契约：仅在某 role 实际变更且需要沿用既有密钥时才解密该 role，保证主题、模型偏好等非敏感设置更新不受历史旧密文解密失败或损坏的影响。

- 本地实现与惰性解密契约：在 `backend/routers/user.py` 的 `_validate_provider_keys` 中，先基于请求体与旧设置比对确定各 role（`stt_changed`, `llm_changed`, `tts_changed`）是否变更；同 provider 原值重复提交或未提供 provider/key 的 role 判定为未变化；未变化 role 绝不读取、不解密、不轮换其旧密文，且不触发 Provider 拨测，完整复用既有有效性状态；变化 role 且显式传入新 key 时直接使用新 key 拨测，绝不解密本 role 旧密文；仅在 role 变更且未显式给 key（需沿用已有密钥）时才针对该 role 调用 `_decrypt_and_rotate` 一次，保留既有轮换写入与解密异常行为。
- 原语义与响应契约保持：严格保持 STT → LLM → TTS 的校验顺序、422 `provider_key_validation_failed` 响应体结构、`_apply_settings_update` 加密与汇总逻辑不变；GET 接口行为、模式权限、密码清洗与超时设置严格保持。
- 质量与回归测试：新增 `backend/tests/test_settings_lazy_decryption.py` 覆盖非敏感字段（theme/llm_model）在密文损坏下成功更新、空请求零解密零拨测、同 provider 重复提交无解密无拨测、单 role 新 key 不解密旧密文、单 role 换 provider 沿用旧 key 仅解密该 role、解密失败异常不被吞掉、多 role 校验顺序 STT→LLM→TTS 与 422 结构保持；全量既有测试 `test_user.py` 全部保持通过。
- 契约与记录见 [RF-10 用户设置凭据惰性解密验证](./verification/cross-platform/RF-10-LAZY-KEY-DECRYPTION.md)。多 Provider 并行验证、超时机制与真实 Provider 拨测未验，整项保持未勾选，RF-10 持续推进。

## 2026-10-26 本地 RF-10 STT/TTS 静态元数据单一来源实施记录（A53）

基于 TODO.md RF-10“能力、模型、凭据、验证、超时、重试与错误映射统一”及 A53 契约完成本地实施。在 A50 的纯标准库不可变 `provider_catalog.py` 中补齐现有 Deepgram 与 Cartesia 静态元数据，使 `plugin_factory` 支持集合与 `validation_service` 语音校验从同一来源派生，消除分散配置并保持不可变性与凭据防污染隔离。

- 本地实现与元数据定义：在 `backend/provider_catalog.py` 中新增不可变元数据结构 `STTProviderMetadata` 与 `TTSProviderMetadata`（`frozen=True`），分别注册 Deepgram（`validation_url="https://api.deepgram.com/v1/projects"`, `auth_header_name="Authorization"`, `auth_header_prefix="Token "`）与 Cartesia（`validation_url="https://api.cartesia.ai/voices"`, `auth_header_name="X-API-Key"`, `auth_header_prefix=""`, `static_headers=MappingProxyType({"Cartesia-Version": "2024-06-10"})`）；以 `MappingProxyType` 导出不可变映射 `STT_PROVIDER_CATALOG` 与 `TTS_PROVIDER_CATALOG` 及只读查询函数；提供无副作用的 `build_validation_headers(api_key)`，每次生成独立 Header 字典，Catalog 内部零凭据驻留且跨请求防污染。
- 消费者接入与行为保持：`backend/livekit_agent/plugin_factory.py` 的 `SUPPORTED_STT_PROVIDERS` 与 `SUPPORTED_TTS_PROVIDERS` 统一派生自不可变 catalog，严格保留 `set[str]` 导出类型与原始值；`backend/services/validation_service.py` 的 `validate_stt_key` 与 `validate_tts_key` 统一通过 catalog 获取目标 URL 与独立 Headers；未知 provider 优先返回 `unsupported_provider`，空 key 保持 `missing_key` 短路且零网络请求；保留 8 秒超时、错误分类与脱敏日志；保留 LLM 全部既有导出与逻辑不变。
- 质量与回归测试：`test_provider_catalog.py` 验证 STT/TTS catalog 内容精确性、Mapping/Entry/Header 描述不可变性、`build_validation_headers` 跨调用凭据隔离与防篡改、消费者严格接线、未知/空 key 零网络及纯净子进程隔离导入；`test_plugin_factory.py` 补充 STT/TTS 支持集合派生断言；`test_validation_service.py` 验证拨测 URL/Headers 与 catalog 完全对齐且无凭据交叉污染。
- 契约与记录见 [RF-10 STT/TTS 静态元数据单一来源验证](./verification/cross-platform/RF-10-SPEECH-CATALOG.md)。多 Provider 并行验证、超时机制与设置服务重构仍待完成，整项保持未勾选，RF-10 持续推进。

## 2026-10-25 本地 RF-08 三项必要查询索引实施记录（A40）

基于 TODO.md RF-08 索引审计要求与已批准组合方案完成本地实施。为高频会话、转录及语法错误查询补齐三项必要非唯一 B-tree 索引，与既有唯一约束形成无冗余覆盖；ORM 模型元数据与下接 `c04_utc_timestamps` 的单链迁移脚本对齐，降级严格逆序 drop。

- 本地实现与模型元数据：`backend/models/session.py` 中 `Session.__table_args__` 声明 `Index("ix_sessions_user_started_id", "user_id", text("started_at DESC"), text("id DESC"))`，保留原有幂等键唯一约束；`Transcript.__table_args__` 声明 `Index("ix_transcripts_session_timestamp", "session_id", "timestamp_ms")`；`backend/models/exercise.py` 中 `GrammarError.__table_args__` 声明 `Index("ix_grammar_errors_session_created", "session_id", "created_at")`，保留置信度检查约束与既有 partial 索引。
- 索引复用与防冗余说明：`pronunciation_assessments(session_id)` 已具备模型级 `unique=True`，`knowledge_states(user_id, skill_id)` 已具备 `uq_user_skill` 复合唯一约束，均已天然具备底层唯一索引，不重复创建非唯一索引；`grammar_errors` 既有 partial 索引因现有查询未带 `is_synthetic = false` 谓词而保留并以全量复合索引补齐。不引入 active 部分索引以规避写放大。
- 迁移脚本与独立审查契约：新建 `backend/alembic/versions/c05_query_indexes.py`，单链下接 `c04_utc_timestamps`；使用 `op.create_index` 与 `sa.text` 明确 DESC 方向；downgrade 逆序 drop 三项索引，不删其它对象不迁数据；实施方未执行/未导入新迁移；Codex 已先独立静态审查并绑定 SHA256，在专用测试库空副本及 25 万行合成副本完成 upgrade/downgrade/re-upgrade 与自然 `EXPLAIN (ANALYZE, BUFFERS)` 验证，既有结构与数据保持；后续由已核全空专用副本实际 Alembic 升级至 c05，供完整后端回归。
- 契约与记录见 [RF-08 三项必要查询索引验证](./verification/cross-platform/RF-08-QUERY-INDEXES.md)。真实线上锁等待/大表构建耗时待验，有界分页待后续推进，整项保持未勾选，RF-08 持续推进。

## 2026-10-25 本地 RF-08 七列 UTC 时间语义统一实施记录（A39）

基于用户裁定“按 UTC 解释旧值，API 统一显式 UTC”以及 TODO.md RF-08 时间语义子项完成本地实施。基于已由 Codex 独立静态审查并通过多时区双向 SQL 演练的 `c04_utc_timestamps` 迁移 schema，将应用层、ORM 模型层及 API 响应层时间语义全面统一为 timezone-aware UTC。

- 本地实现与模型统一：ORM 模型七列（`users.created_at`、`sessions.started_at`、`sessions.ended_at`、`user_settings.updated_at`、`knowledge_states.updated_at`、`pronunciation_assessments.created_at`、`grammar_errors.created_at`）明确声明 `DateTime(timezone=True)`，完整保留原 nullability、约束与 `UserSettings.updated_at` 的 `onupdate` 行为；新增 `backend/time_utils.py` 提供纯标准库 `utc_now()`，全面替换业务写入路径中的 `datetime.utcnow()`；新增 `backend/schemas/time.py` 声明 `UtcDatetime`（基于 `AwareDatetime` 与 `AfterValidator`），严格拒绝 naive 输入并将任意时区偏移归一化为 UTC，响应 JSON 保持显式时区（`Z`），OpenAPI 保持 `date-time` 契约。
- 质量验证覆盖：新增 `test_utc_timestamps.py` 覆盖 7 列 ORM 元数据定义、`UtcDatetime` naive 拒绝与时区归一化校验、专用测试库 PostgreSQL 真实写读 aware UTC 值与 `UserSettings` onupdate 触发；修复 `test_assessment.py`、`test_call_leases.py`、`test_session_active_discovery.py` 中遗留的 naive UTC fixture 与 `datetime.utcnow()` 弃用警告；迁移文件 `c04_utc_timestamps.py` 严格保持只读（SHA256: `3cb19d3f39c166f7e5e93587779d99240a8e2ac90cdbc1edf4c476d80425f612`）。
- 契约与记录见 [RF-08 七列 UTC 时间语义验证](./verification/cross-platform/RF-08-UTC-TIMESTAMPS.md)。未执行生产/真实外部环境迁移，高频索引与分页待后续完成，整项保持未勾选，RF-08 持续推进。

## 2026-10-25 本地 RF-08 启动参考数据显式幂等化实施记录（A38）

基于 TODO.md RF-08 启动播种子项与 MVP 重构方案完成本地实施。移除 FastAPI 应用启动期（lifespan）向数据库隐式写库播种技能的逻辑；此前已移除的 Mock 用户播种保持禁用，仅保留运行时安全配置验证；提供独立显式播种模块与 CLI 入口，实现参考数据的原子无覆盖与并发幂等播种。

- 本地实现与原子契约：`backend/main.py` 的 `lifespan` 仅保留 `settings.validate_runtime()`，完全移除启动期数据库会话与写入；新增 `backend/seed_reference_data.py`，复用 `models.knowledge.SEED_SKILLS`（10 项），采用 PostgreSQL 原生 `INSERT ... ON CONFLICT (id) DO NOTHING RETURNING id`，不先查后插、不使用 delete/truncate/upsert 覆盖已有记录，单事务原子提交；CLI 强制校验显式 `DATABASE_URL`，缺失时拒绝退出并禁止回退 `.env`，使用 SQLAlchemy 解析协议仅支持 PostgreSQL 并安全转换为 asyncpg，`--help` 与导入零 DB 访问，错误路径严格脱敏不泄露凭据；专有 engine 在 `finally` 严格 `dispose`。
- 质量验证覆盖：更新 `test_lifespan_seeding.py` 验证启动期仅执行安全校验且 4 并发无 DB 访问，校验失败阻断 yield；新增 `test_reference_seeding.py` 覆盖空表 10 项初始化、重复幂等、已有自定义同 ID 内容保留且补齐缺项、至少 4 独立 session 真实并发无冲突、事务失败原子回滚、CLI 缺 URL 拒绝、--help 不连接、非法 URL 拒绝、凭据脱敏不泄露以及在受控隔离 test schema 下真实 CLI 执行与幂等重复。
- 契约与记录见 [RF-08 启动参考数据显式幂等化验证](./verification/cross-platform/RF-08-REFERENCE-SEED.md)。时间列 timezone-aware UTC、必要索引、有界分页与真实数据库迁移待后续子项完成，整项保持未勾选，RF-08 持续推进。

## 2026-10-25 本地 RF-07 Dev 依赖分组受控实施记录（A37）

基于用户裁定“先仅拆 Dev 四项，运行时保持共用（推荐）”完成本地实施。仅将 `ruff`、`pytest`、`pytest-asyncio`、`pytest-cov` 四项从 `[project].dependencies` 迁入标准 `[dependency-groups].dev`，其余 26 项依赖（含 `httpx` 及全部 LiveKit runtime）继续保留为默认运行时依赖；`uv.lock` 维持 192 包解析，`requirements.txt` 保持为单一只读 runtime-only 兼容导出镜像，开发工具从生产运行时导出彻底剥离。

- 依赖声明与锁导出：`backend/pyproject.toml` 拆分为 26 项 `[project].dependencies` 与 4 项 `[dependency-groups].dev`，保留原有版本约束与声明顺序，未改变 Ruff/pytest/coverage 设置与 `package = false`；受控步骤 `rf07-lock` 生成并锁定 192 个包（lock SHA256: `fba300031805120e7445665f3893ef9bc3521c33c15428c6ff9c2d8aba14598b`），严格维持 LiveKit 7 项 exact SDK 版本与 baseline 重叠版本；`requirements.txt` 通过 `uv export --frozen --no-dev --no-emit-project --no-header --no-annotate` 导出（SHA256: `e66ec8da7e973f9cb27a599d83e8e45fa3a726b6b446f7cd6dda16bcfc461e1f`），作为包含 184 条跨平台条件依赖的 runtime 只读镜像（本机安装 165 包），不再包含 pytest/ruff。
- CI 与 Docker 配方统一：`.github/workflows/ci.yml` 后端依赖安装步保持 `uv lock --check` 与 `cmp requirements.txt`，安装显式声明 `uv sync --frozen --group dev --no-python-downloads` 引入开发依赖；`backend/Dockerfile` 仅将原同步指令补齐 `--no-dev`（`uv sync --frozen --no-dev --no-python-downloads`），保证容器镜像不引入开发工具；保持 Python 3.12 / uv 0.9.18 配方、`/opt/venv` 虚拟环境与 COPY 顺序不变。
- 受控环境安装核验：受控步骤 `rf07-sync` 在固定独立开发环境 `cp00/.review/rf07-a37-dev-venv` 完成冻结同步，包含 172 个包（含 4 项 dev 依赖，`has_dev_packages: true`）；受控步骤 `rf07-runtime` 在固定独立运行时环境 `cp00/.review/rf07-a37-runtime-venv` 完成冻结同步，包含 165 个包（`has_dev_packages: false`，核验证实 4 项开发工具缺失）；两环境均证实核心 SDK 版本未变；旧 `backend/.venv` 及 A36 `.review/rf07-venv` 严格保持只读且未被覆盖。
- 质量验证覆盖：前端 8 项门禁（Format、Lint、Typecheck、Vitest 单测、Build Script 测试、Fake API 原生子进程回归、Build、双浏览器 E2E）全部通过；契约见 [RF-07 Dev 依赖分组验证](./verification/cross-platform/RF-07-DEV-GROUP.md)。未执行 Linux 真实 Docker 镜像构建，未连接真实外部 Provider，整项保持未勾选，RF-07 持续推进。

## 2026-10-25 本地 RF-07 可复现 Python 依赖与受控配方实施记录（A36）

基于 TODO.md RF-07“后端成为真实 uv 项目并提交完整 uv.lock；API、Agent、Dev 依赖分组；CI/Docker frozen 安装；Python 3.12 统一”完成本地实施。后端正式建立标准 Python 3.12 uv 项目体系，提交 192 个包的完整 `uv.lock`，严格保留既有 172 项 baseline 重叠版本与 LiveKit 7 项 exact SDK 版本；`requirements.txt` 作为锁导出的单一真相源，CI 与 Docker 构建配方全面对齐冻结安装规范。

- 本地实现与依赖声明：在 `backend/pyproject.toml` 中补齐标准 `[project]` 元数据（`name = "echotalk-backend"`, `version = "0.1.0"`, `requires-python = ">=3.12,<3.13"`），30 项直接依赖声明为默认 `dependencies`，配置 `[tool.uv] package = false`，Ruff、coverage 与 pytest 原配置与阈值全量保留；新增 `backend/.python-version` 声明 `3.12`；提交 192 个包完整解析的 `backend/uv.lock`，无跨平台/版本漂移；`backend/requirements.txt` 通过 `uv export --frozen --no-dev --no-emit-project --no-header --no-annotate` 导出，消除了手写两套直接依赖的双源隐患。
- CI 与 Docker 配方统一：`.github/workflows/ci.yml` 锁定 `astral-sh/setup-uv@v3` 版本为 `0.9.18`，依赖安装改为 `uv lock --check`、只读导出并与仓内 `requirements.txt` 进行 `cmp` 一致性检查，继而执行 `uv sync --frozen --no-python-downloads`；`backend/Dockerfile` 基础镜像升级至 `python:3.12-slim`，固定 uv 0.9.18 二进制，虚拟环境固定在 `/opt/venv` 并预先注入 `PATH`，先复制锁定文件执行 frozen sync 再复制源码，避免环境被源码覆盖；`backend/.dockerignore` 增强排除 `.env*`、`.review/` 及各类测试缓存。
- 质量验证覆盖：全新隔离环境 `.review/rf07-venv` 经受控 frozen 同步与离线 `uv sync --check` 验证，sys.prefix 与 site-packages 完全隔离，旧 `backend/.venv` 严格只读且元数据指纹未变；经 Codex 独立评审在隔离测试库运行 269 项 pytest（覆盖率 73.72%）与 Ruff 格式/lint 检查全部通过；前端 8 项门禁（Vitest、构建脚本、Fake API 原生子进程、双浏览器 E2E 等）持续通过。
- 契约与记录见 [RF-07 可复现 Python 依赖验证](./verification/cross-platform/RF-07-FROZEN-PYTHON.md)。未执行 Docker 真实镜像构建，未连接真实外部 Provider，整项保持未勾选，RF-07 持续推进。

## 2026-10-25 本地主要容器主题颜色过渡实施记录（A35）

基于 TODO.md P2“按主要容器补齐主题颜色过渡，避免子元素瞬间切色”契约完成本地实施。在复用既有三主题设计 Token 及 body 250ms ease 规范的基础上，为覆盖在 body 之上的应用主要容器、卡片、设置抽屉及显式语义文本补齐平滑的主题颜色过渡，消除切换主题时子元素的瞬间切色现象。

- 本地实现与过渡作用域：在 `index.html` 的既有 `#root` 上添加 `theme-transitions` 单个 scope class（不改动首帧主题脚本、head 或 DOM 结构）；在 `styles.css` 中为 `.theme-transitions` 作用域内的核心语义类（`.bg-bg`, `.bg-surface`, `.bg-surface-alt`, `.card`, `dialog.settings-drawer`, 粘性 header, `.text-text-default`, `.text-text-muted`, `.text-text-faint`, `.border-border-default` 等）声明 `0.25s ease` 颜色过渡；不影响 Webpack 或非应用 DOM，不引入全局 `transition: all` 或布局/尺寸过渡。
- 组合类保护与 hover 能力：针对使用 `transition-shadow` 的两处既有容器（`App.tsx` DocTalk 按钮与 `RecommendedScenarios.tsx` 卡片），组合 `transition-colors` 并在 `styles.css` 中声明复合过渡（保留 `box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)` 与颜色 `0.25s ease`），卡片 hover 阴影过渡保留原时长与 easing。
- 减少动态效果与双浏览器验证：完全继承 A27 的 `prefers-reduced-motion: reduce` 规则（过渡时间降为 0s，立即生效，drawer 动画为 none，功能性 spinner 保留）；新增 `e2e/theme-transitions.spec.ts` 双浏览器回归，通过 Web Animations API 真实捕获 CSSTransition 并在 125ms 中点证实插值中间态；窄屏与 200% 字号由 Codex 独立探针补验，0 溢出且主要根容器几何保持，仅发单次精确 PUT，0 pageerror。
- 契约与记录见 [主要容器主题过渡验证](./verification/cross-platform/CP-05-THEME-TRANSITIONS.md)。未推送、未部署、无真实外部 Provider 或多设备联调，不代表三端整体完成。

## 2026-10-25 本地安全诊断一期实施记录（A34）

基于 TODO.md CP-06“补充按版本/平台关联的诊断信息；验收：可定位 API、LiveKit、Agent 错误，不采集 Token、密钥或默认上传文档/对话正文”完成本地一期实施。新增结构化脱敏日志辅助模块 `diagnostics.ts`，统一按纯净白名单 record 记录关键异常，彻底消除此前在控制台直接输出未经脱敏外部 parsed 对象的缺陷。

- 本地实现与白名单脱敏契约：record 输出严格限定字段集合（`schema_version: 1`、`app_version` 取自 package.json、`platform` 取自 `detectPlatform()` 并安全回退 `"unknown"`、8 个冻结 `event` 枚举）；从零显式构造，严禁 spread 未知字段或正则脱敏；`status` 仅允许 100..599 整数且仅限 `api_http_failed`；`agent_code` 严格限制为 5 项白名单，敏感 token、恶意注入及未知非字符串一律安全映射为 `"unknown"`，绝不原样回显；控制台按 warn/log/error 分级输出；helper 本身故障局部隔离，绝不阻断业务逻辑；成功 API 请求零新增日志。
- 接线与原语义保持：`api.ts` 接入 `api_network_failed`（仅真实 fetch reject）与 `api_http_failed`（仅 status，不输出路径/头/正文），原 401 代际失效、错误解析与 `ApiError.data` 逐字节保持；`VoiceInterface.tsx` 替换 6 处自由日志（特别消除 `agent_error` 输出 parsed 对象风险），原状态转换、音轨停止、`setAgentError` 与 UI 错误卡片渲染保持原样。
- 质量验证覆盖：单测 `diagnostics.test.ts` 覆盖严格字段集合、平台检测与回退、所有 8 项枚举与日志级别、status 整数范围、`agent_code` 严格白名单与脱敏、序列化 canary 缺失保证及 console 异常隔离；`api.test.ts` 追加 7 项真实请求入口回归；`VoiceInterface.test.tsx` 追加 7 项真实入口回归（包含捕获 `useDataChannel` 注册真实回调并输入带敏感 canary 的 payload 验证脱敏输出与原 UI 终态）；`e2e/diagnostics.spec.ts` 双浏览器真实页面回归受控 HTTP 503 注入，验证安全 record 产生、全量控制台无敏感 canary 泄露、页面重试可恢复、0 pageerror 及零业务写。
- 契约与记录见 [本地安全诊断一期验证](./verification/cross-platform/CP-06-SAFE-DIAGNOSTICS.md)。未实现遥测上报，未连接真实外部 Provider 或多物理端联调，CP-06 整体继续推进。

## 2026-10-25 本地回答推荐作用域无歧义编码实施记录（A33）

基于 TODO.md A26 P2 后续候选“将回答推荐scope键的id/text直接拼接替换为无歧义元组编码，并覆盖分隔符外部ID”完成实施。消除直接冒号拼接导致外部包含冒号的合法 ID 与文本发生碰撞的缺陷（如 `id='seg', text='What:is your hobby?'` 与 `id='seg:What', text='is your hobby?'`），将 `AnswerRecommendations.tsx` 中的 `currentScopeKey` 编码升级为无歧义二元组 `JSON.stringify([latestQuestionSegment.id ?? "", latestQuestionSegment.text.trim()])`。

- 本地实现与作用域隔离：采用标准 JSON 序列化二元组，保持原 `isWaiting` 与 `null` 门禁，保持默认空 ID 与空白 trim 语义；同问题健康重渲染保留复制反馈，原 1500ms 定时器到期准时清除且不被重渲染重置计时，卸载清理机制不变；其他产品逻辑、布局、文案均逐字节保持。
- 质量验证覆盖：单测 `AnswerRecommendations.test.tsx` 新增 5 项真实回归用例（覆盖冒号边界碰撞切题即时清除、旧 pending 复制切题后延迟完成不污染新题目、冒号碰撞交叉竞争下新题目反馈不被旧回调/旧定时器篡改、同 tuple 重渲染不重置 1500ms 计时、缺少 ID/引号/反斜杠/Unicode/空白 trim 边界）；`e2e/answer-recommendations.spec.ts` 复用现有隔离 fixture 与 hook stub 新增双浏览器回归，覆盖冒号边界碰撞切题及迟到 clipboard 场景，断言新题目可再次成功复制、0 pageerror 及零会话/令牌/租约/调度隐式业务写。
- 契约与记录见 [回答推荐作用域编码验证](./verification/cross-platform/CP-05-ANSWER-SCOPE.md)。未推送、未部署、无真实外部 Provider 或多设备联调，不代表三端整体完成。

## 2026-10-25 本地主题 Token 引用清点与确认面板修复实施记录（A32）

基于 TODO.md P2“清点主题 token：保留 Webpack 正在使用的 brand-_，处理未使用的 scrollbar-thumb、header-bg”完成实施。经运行时引用审计，删除 `packages/configs/tailwind-config/theme-tokens.css` 中无运行时引用的 `--scrollbar-thumb` 与 `--header-bg` 在三主题下的定义（总 6 行）；保留 Webpack 应用正在活跃消费的 `brand-_`及全部其他主题 token。同时修复`ActiveSessions.tsx`确认面板因类名拼写缺失桥接导致的背景透明与边框继承缺陷，将结束/恢复两面板的`bg-surface-subtle`修复为既有`bg-surface-alt`，两面板及取消按钮的 `border-border-subtle`修复为既有`border-border-soft`（共 4 处元素替换）。

- 本地实现与样式修复：删除 2 个未被消费的主题 token；采用既有桥接语义色修复两面板弱背景与软边框，不添加 alias 掩盖拼写，不引入 transition 或动画，保留 44px 触控与全部已有业务交互；不改变 DOM 结构与文案。
- 质量验证覆盖：新增 `apps/vite-app/e2e/theme-tokens.spec.ts` 双浏览器真实页面回归，结合既有 active fixture 与主题选择器，逐主题（warm/cool/dark）验证结束与恢复两面板的 computed `backgroundColor` 与 `borderColor` 精确匹配真实 CSS 变量 `--surface-alt` 与 `--border-soft`，断言背景非透明；覆盖 390px 窄屏与 200% 根字号布局无横向溢出；验证取消后原列表可再次操作、确认前与取消零业务写、全流程 0 pageerror。
- 契约与记录见 [主题 Token 审计与确认面板验证](./verification/cross-platform/CP-05-THEME-TOKENS.md)。未推送、未部署、无真实外部 Provider 或多设备联调，不代表三端整体完成。

## 2026-10-25 本地主题缓存异常容错实施记录（A31）

基于 TODO.md P2“主题保存后端支持跨设备水合”与既有 CP-05-THEME-SYNC 契约完成浏览器 localStorage 异常容错实施。针对浏览器隐私模式、跨域限制或存储配额已满时 `localStorage` 抛出 `SecurityError` 或 `QuotaExceededError` 的场景，提供安全回退与持久化恢复能力，防止阻断 store 冷导入、UI 即时渲染或将成功后端水合误报为 API 失败。

- 本地实现与容错：`readStoredTheme` 对属性 getter 与 `getItem` 实施窄范围 `try/catch`，异常时安全回退 `"warm"` 默认主题；封装内部 `safeSetStoredTheme`，`setTheme` 写缓存失败不阻断 store/DOM 更新与认证状态下的后台 300ms 防抖 PUT 调度；`fetchSettings` 水合成功时写缓存失败被内部隔离，store 正常水合并清除 `loading`，`error` 保持为 `null` 且不误发额外 PUT；真正 API 失败原有错误报告不受影响；Storage 恢复后下一次显式选择正常持久化；仅拦截 `localStorage`，严格避免破坏 `sessionStorage` 中的认证凭据。
- 质量验证覆盖：单测 `settings.test.ts` 新增 12 项回归用例（覆盖 getter/getItem 抛错、非法值/空值、配额溢出与安全异常、默认值回退、匿名零请求、认证 PUT 不受阻、水合写缓存失败不误判、真实 API 报错完整保留、恢复后再次选择持久化）；新增 `e2e/theme-storage.spec.ts` 双浏览器真实页面回归，覆盖冷启动 getter 抛错安全回退、切主题写配额超限与恢复持久化、后端水合写缓存失败无报错，全流程 0 pageerror。
- 契约与记录见 [主题缓存容错验证](./verification/cross-platform/CP-05-THEME-STORAGE.md)。未推送、未部署、无真实外部 Provider 或多设备联调，不代表三端整体完成。

## 2026-10-24 本地 CI 质量门禁接线实施记录（A30）

基于 TODO.md RF-04 CI 真实性与 CP-06 完整质量门禁要求，完成本地 `.github/workflows/ci.yml` 的 `test-frontend` steps 顺序与命令对齐实施。将 CI 执行步骤对齐本地 8 项真实质量门禁（Format、Lint、Typecheck、直接 Vitest 单测、18 项构建脚本测试、Fake API 原生子进程测试、Build 以及双浏览器 E2E）。通过精确 `--filter vite-app` 入口排除根目录测试占位任务，并通过 `turbo --force` 避免 CI 缓存回放；保持依赖冻结安装、Playwright 安装步骤与 working-directory、Node 22 / pnpm 10.26.0、test-backend 与 ci 聚合 job 成功断言全部不变。

- 本地配置与命令映射见 [CI 质量门禁验证](./verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。
- 本节仅记录本地配置与实施事实，不宣称独立评审或验收结论；未触发远端 GitHub Actions，不把本地门禁通过当做远端 Linux CI 已通过。

## 2026-10-24 本地 Fake API 契约与真实进程回归增量（A29）

基于 TODO.md P2“Fake API严格解析带项目后缀的analysis-success grammar路径并补回归”及真实 `lib/api.ts` 的 `UserSettingsResponse.theme` 必需三值枚举契约完成实施。修复了 Mock 缺少 theme 字段的问题，重构了 assessment 与 grammar 的严格完整 pathname 锚定匹配，支持项目后缀 slug 并拒绝假命中；支持 `E2E_API_PORT=0` 并新增 Node 原生 `node:test` 真实子进程回归测试套件。本地增量经本地门禁与评审核验通过；无真实外部 Provider 或生产部署。

- 本地质量验证：新增真实 runner `pnpm test:fake-api`（`node --test scripts/fake-api-test.mjs`），覆盖 8 个测试套件/27 项断言，包括动态端口绑定、稳定就绪消息、无需认证的健康检查、401 缺/错 token、theme 必填三值枚举、带项目后缀的 assessment 与精确 session_id、带项目后缀的 grammar 与精确空数组返回、12 类负向 404 路由测试，以及有界子进程退出与清理保护。
- 门禁扩展与 E2E 保持：quality 门禁正式由 7 项扩展为 8 项（含 `fake-api-test`），648 项 Vitest、18 项构建脚本测试、120 项 Chromium/WebKit 双浏览器 E2E（0 skip / 0 failure）全部通过。
- 契约与记录见 [Fake API 契约验证](./verification/cross-platform/CP-06-FAKE-API-CONTRACTS.md)。真实 Provider、真实 LiveKit 及多设备仍待后续外部验收，不代表三端整体完成。

## 2026-10-24 本地主题持久化可靠性与稳定选择器增量

基于 TODO.md P2“主题保存后端支持跨设备水合”与“统一主题按钮边框宽度，消除选中时 1px 布局抖动”契约完成客户端本地实施。保持 local-first 体验，完善了认证代际与精确身份绑定、单在途串行意图合并、水合竞争防护及 2px 固定边框无抖动选择器。本地增量经 Codex 独立评审 APPROVED；无真实设备或 Provider 联调，未推送或部署。

- 本地质量验证：单元测试 648 项全部通过（相对基线 620 增加 28 项真实异步回归测试），覆盖匿名/未认证门禁、嵌套选择防覆盖（TH-01）、水合时序基准防回滚（TH-02）、fetch 槽位隔离与身份复核（TH-03）、过期 sequence 零发布与负向断言恢复（TH-04）、两门状态机防抖（TH-05）、换号同步拦截与旧 finally 隔离（TH-07）、跨身份 sequence 隔离水合与解死锁（TH-08）、通用保存操作所有权与换号防重入解死锁（TH-09）、未认证发送前门禁失败关闭（TH-10）、同账号 revision 变动物理串行占用与旧请求不发布（TH-11）、取消分支意图归属保护不误清他人新意图（TH-12）等。
- 双浏览器 E2E 覆盖：Chromium 与 WebKit 双浏览器共 120 项全部通过（新增 6 项），验证仅向后端 PUT `{ theme }`、防抖末值合并、独立 BrowserContext 水合（共享本地模拟服务状态，明确非真实双设备）、后端失败本地保持与再次选择恢复，以及在窄屏、默认和 200% 大字号下三个主题按钮统一 2px 固定边框且下方内容位移差为 0px。
- Codex 独立完整七门禁通过：648 产品 / 18 构建脚本 / 120 双浏览器、专用 PostgreSQL 269 项（73.72%）；另有 20 项私有时序与 8 项独立浏览器几何探针、两项有效变异通过。
- 契约与本地记录见[主题持久化验证](./verification/cross-platform/CP-05-THEME-SYNC.md)。真实跨物理设备与外部 IdP 仍待环境验收，CP-05 整体继续推进。

## 2026-10-24 本地颜色过渡与设置抽屉减少动态效果增量

基于 TODO.md P2“为颜色过渡和抽屉动画支持 prefers-reduced-motion”契约完成纯 CSS 媒体查询适配，零新增 JS 运行时监听或依赖。Codex 已独立验收；本轮从 PR #98 已合并的 `main@80fb8ec` 开始，仅本地提交/集成，未 push 或部署。

- Codex 独立质量验证：全量 7 项门禁通过，620 项产品 Vitest、18 项构建脚本测试、114 项双浏览器（Chromium/WebKit 各 57 项，含新增 10 项 prefers-reduced-motion 专用测试）通过。
- 另有 4 项独立双浏览器探针、2 项有效变异及专用 PostgreSQL 后端 269 项（73.72% 覆盖率）通过；既有迁移仅恢复空的专用测试库至 `c03_call_leases`，无本轮 schema 改动。
- 覆盖 reduce 与 no-preference 偏好下 body computed transition、抽屉 slideInRight 动画消除、实时动态切换偏好、功能性 loading spinner 动画保留、外观主题切换语义以及零隐式业务写请求。
- 契约与验收见[减少动态效果验证](./verification/cross-platform/CP-05-REDUCED-MOTION.md)。真实 OS 系统级联动与硬件屏幕阅读器仍待设备验收，CP-05 整体继续推进。

## 2026-10-21 本地认证里程碑

共享客户端的认证快照、精确账号身份、账号切换清理、异步数据代际与401请求绑定已通过独立评审，并在隔离分支 `codex/cross-platform-integration` 完成本地集成。代码提交 `e1018b9`，集成提交 `727e067`；未合入主 checkout，未 push、未运行本轮远端 CI、未部署。

- 本地验收：200项产品测试、27项独立竞态探针、18项构建隔离测试、6项 Chromium/Fake API E2E，以及格式/lint/类型/Vite与Webpack构建通过。
- 6个关键门禁变异均被产品断言杀死，恢复原字节后200项测试再次通过。
- 同一在途 OIDC code/state 只交换一次，即使期间退出/新登录也不重新消费旧state；旧callback不覆盖新身份或SDK凭据，正常新UserLoaded仍可恢复登录。
- 集成后端源码与本轮已通过269项专用PostgreSQL测试的指纹一致，覆盖率73.72%。本次前端增量未修改后端。
- 真实IdP、原生系统认证回跳/Keychain、自动续期、WebKit/真机和Cloud真实媒体接管仍未验收；**CP-04整体仍未完成**。见[本地认证验证规范](./verification/cross-platform/CP-04.md)及[跨平台计划](./CROSS_PLATFORM_ARCHITECTURE.md)。
- 按用户要求在此里程碑停止后续派发，复盘自动评审流程；原始报告、用量与证据只保存在本地 `.review/reports/workflow-pilot-auth/`。

## 2026-10-21 本地活动会话发现里程碑

共享 Dashboard 已消费既有 `GET /api/sessions/active`，展示当前账号尚未结束的记录、加载/空状态和失败显式重试；退出、换号、同账号重新登录以及迟到成功/失败/finally按身份和代际隔离。未知模式使用安全通用标签，不回显服务端错误详情。代码 `5a60333` 已通过独立评审并快进本地隔离集成分支；未推送、未部署、未运行远端 CI。

- 独立本地验收：228项产品Vitest、18项构建隔离测试、5项私有边界探针、既有6项与新增2项 Chromium/Fake API E2E、格式/lint/类型及Vite/Webpack构建通过；专用PostgreSQL后端269项、覆盖率73.72%通过。
- 窄屏390px截图已检查；本地集成全部批准文件hash与实施验收源码一致，后端源码与测试版本一致。
- 活动记录不等于媒体在线或持有占用；本轮不获取媒体Token，不恢复采音，不接管、不发心跳、不自动轮询或持久化列表。真实IdP/WebKit/原生回跳/iOS真机/Cloud媒体仍未验收，**CP-02整体仍未完成**。
- 到此停止下一批派发，按用户约定评估新版review-loop。完整证据仅存本地 `.review/reports/workflow-discovery/`；工作流变更不等于已证明节省Codex额度。

## 2026-10-22 本地通话能力门禁增量

客户端每次开始练习（含DocTalk）先读取已认证的`GET /api/call-capabilities`，严格验证协议1的精确两字段并禁用缓存。只有disabled进入既有health/create/token；查询失败、接口缺失、不兼容协议或livekit_cloud模式均失败关闭并允许用户显式重试。认证事件及异步完成边界会释放失效启动，旧回调不覆盖新启动，同principal更新不打断已启动的正常通话。代码`0753dab`已独立评审并快进本地隔离集成分支，未推送/部署。

- 本地独立证据：252产品测试、18构建脚本测试、20私有探针、既有6项与新增6项Chromium/Fake API用例，格式/lint/类型/双构建通过；3个关键变异被产品断言拦截，原字节恢复后重验通过。
- 专用测试容器恢复并核验空schema后，沿既有授权恢复已审查迁移；后端269项、覆盖率73.72%通过，原始环境失败记录保留。未访问应用/生产库或真实Provider。
- 新版skill的正式预检、解析和账本入口已用于本轮；新发现的5类工作流问题只存本地`.review/reports/workflow-capabilities/issues.md`，本轮未再改全局skill。文档见[能力门禁验证](./verification/cross-platform/CP-02-CAPABILITIES.md)。
- Cloud客户端claim/heartbeat/接管/媒体恢复、真实IdP/原生凭据/真机和三端真实链路仍未完成。发布前需服务端能力接口先就绪，旧服务端缺端点时新客户端会阻止开始；本次未发布，CP-02整体不勾选。

## 2026-10-22 本地客户端占用API前置增量

代码`03d50e0`已独立APPROVED并集成本地隔离分支：claim/heartbeat/release与token/dispatch可选owner头、输入/精确响应关联校验、默认不接管及无自动重放。仅两个API产品/测试文件，未接store/UI或解除Cloud门禁，默认disabled保持。

- 独立280产品测试、18构建测试、30私有探针、3变异、12项实施源码Chromium/Fake API及集成6项通过；后端269项/73.72%，专用库身份/ready/schema通过，本次不迁移。
- 新版skill7306f2b的文件清单预检/事件摘要已实接，agy一次模型尝试527.85活动秒，无产品返工；四项问题/局限只记本地。Token口径见[验证记录](./verification/cross-platform/CP-02-LEASE-API.md)，不声称已证明净节省。
- 集成7项固定门禁通过，未推送、部署或真实Provider联调。占用状态机/心跳/恢复/显式接管与原生链路仍待实现，CP-02整体未完成。此处停止下一模型派发。

## 2026-10-22 两条独立客户端前置工作线集成

A独立通话占用控制器`deacf3e`与B Web生命周期适配器`418d2cd`已分别APPROVED并串行合入本地组合`8c38a01`。两条agy在不同worktree实际并行，累计约560秒执行重叠；共享服务与集成串行，不能据此直接宣称净提速/节约。

- A修复旧挂起请求/Promise清理代际泄漏及实际写前取消守卫；B修复无监听期间旧快照与重订阅恢复失真。各有一次独立返工，原失败证据保留。
- 组合336产品Vitest、18构建隔离、40私有探针（A29/B11）、两线21项Chromium/Fake API及集成既有6项、6个有效变异、格式/lint/类型/双构建通过；后端269/73.72%与受保护schema前检通过。冗余候选变异未计入杀死数。
- 契约与验收见[占用控制器](./verification/cross-platform/CP-02-LEASE-CONTROLLER.md)、[Web生命周期](./verification/cross-platform/CP-01-WEB-LIFECYCLE.md)。未接conversation/UI、未开启Cloud开始门禁，无真实Provider/原生媒体验收，不代表CP-01/02/05整体完成。
- 本轮实际接入skill c133e3f的父/子运行摘要，问题及完整证据仅存`.review/reports/workflow-parallel-a8/`。Codex当前及中断turn的完整用量留待自然结束后提取，不伪造即时总额，不报告未经对照的省额比例。

## 当前功能

| 领域           | 当前实现                                                                           | 状态与边界                                                 |
| -------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离    | 代码和自动化已落地；真实 IdP 联调仍需环境验收              |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                  | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明 |
| 会话分析       | 持久化分析状态、发音评估、语法检测、BKT 知识追踪、失败/重试状态                    | 自动化覆盖核心状态机；真实发音 Provider 仍需外部验收       |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态 | 已实现                                                     |
| 自适应课程     | 读取薄弱技能，通过 ChromaDB/Krashen i+1 生成课程推荐                               | 存在真实 API 调用链；ChromaDB 客户端按进程复用             |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast | 已实现；密钥轮换和 Provider 连通性需按环境验收             |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                | 已实现 Web 流程；移动端文件选择仍在 TODO                   |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、关键组件键盘与可访问性支持        | 已实现；完整无障碍审计仍未完成                             |
| 周度学习报告   | 仅保留骨架，没有 API、调度器或任务队列调用入口                                     | **未实现，不可对外宣称可用**                               |
| 数字人和移动端 | 方案或待办存在，但没有完成可交付闭环                                               | **未实现**                                                 |

## 2026-10-20 PR 评审与处理

| PR                                                | 处理决定     | 内容与边界                                                                                              |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| [#92](https://github.com/sunpcm/EchoTalk/pull/92) | 已合并       | Vite 7.3.1 → 精确 7.3.7；只改声明和锁文件，其他依赖不变，未迁移 Vite 8                                  |
| [#90](https://github.com/sunpcm/EchoTalk/pull/90) | 修复后纳入   | DailyProgress 和 SkillTree 增加进度条角色、名称、范围和值；每日超过 20 时数值封顶，文本仍保留实际完成量 |
| [#91](https://github.com/sunpcm/EchoTalk/pull/91) | 重复，不纳入 | 与 #90 修改相同组件；#90 还包含每日进度测试和可读值文本，统一维护一份实现                               |

评审复现：原 #90 在完成 25 条转录时生成 `aria-valuenow=25`、`aria-valuemax=20`，
违反 [WAI-ARIA 数值范围约束](https://www.w3.org/TR/wai-aria-1.2/#aria-valuenow)。
修复后读数为 20，`aria-valuetext` 仍为 `25 / 20`，视觉条保持 100%，实际统计口径不变。
回归覆盖 0、5、20、25 四种完成量；补测技能树空列表，保留两类技能掌握度断言。

验证分层：#92 的前端、后端和聚合 CI 均通过，包括 Node 22 前端、PostgreSQL 空库迁移及
后端测试；#90 的最终检查见上方 PR 记录。安全补丁的本地验证还包括 102 项 Vitest、
6 项 Fake API E2E、HTTPS/模拟麦克风/WSS/代理和合成文件访问限制探针。
这些证据不代表真实 LiveKit、Provider、Windows/NTFS 漏洞复现、屏幕阅读器或 iOS 真机验收。

本次 Vite 安全补丁独立于 RF-12 大版本迁移；RF-12 的其他依赖升级和外部验收仍未完成。
回滚 #92 会恢复已知有漏洞的 Vite 7.3.1；如需回滚，应同步恢复 manifest/lockfile 并限制开发服务访问。

## 2026-10-17 变更记录

本轮对全部开放 PR 使用最新 `main`、文件重叠、生产调用链和 CI 结果进行复核。

### 已合并

| PR                                                | 合并内容                                   | 价值                                                                      |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| [#67](https://github.com/sunpcm/EchoTalk/pull/67) | ORM 模型包内改用相对导入                   | 降低包路径耦合                                                            |
| [#68](https://github.com/sunpcm/EchoTalk/pull/68) | LLM client/chat completion 单元测试        | 补充 Provider 配置和异常回归覆盖                                          |
| [#69](https://github.com/sunpcm/EchoTalk/pull/69) | 拆分用户设置响应、权限、Key 校验和更新逻辑 | 降低路由函数复杂度                                                        |
| [#71](https://github.com/sunpcm/EchoTalk/pull/71) | 将可选 `pronouncing` 导入移出逐词热路径    | 减少重复导入开销                                                          |
| [#73](https://github.com/sunpcm/EchoTalk/pull/73) | 进程内复用 ChromaDB client                 | 优化真实课程推荐调用链                                                    |
| [#74](https://github.com/sunpcm/EchoTalk/pull/74) | 转录持久化测试                             | 覆盖空输入、时间戳、角色、非法值和 DB 异常                                |
| [#78](https://github.com/sunpcm/EchoTalk/pull/78) | LiveKit PluginFactory 统一 API Key 校验    | 拒绝空值、错误类型和换行/null 等危险字符                                  |
| [#79](https://github.com/sunpcm/EchoTalk/pull/79) | CORS 安全校验                              | 评审中追加 Origin 结构校验，拒绝 path/query/userinfo/非法端口和不支持协议 |
| [#83](https://github.com/sunpcm/EchoTalk/pull/83) | LiveKit 消息类型收窄                       | 移除不安全的类型忽略后再读取 assistant 文本                               |
| [#84](https://github.com/sunpcm/EchoTalk/pull/84) | AnswerRecommendations 可访问性和复制反馈   | 评审中修复答案截断与剪贴板失败静默问题；定向测试 4/4 通过                 |
| [#86](https://github.com/sunpcm/EchoTalk/pull/86) | PhonemeVisualizer 键盘和辅助技术支持       | 增加可访问名称，并避免视觉 tooltip 重复朗读                               |
| [#87](https://github.com/sunpcm/EchoTalk/pull/87) | 焦点样式和禁用原因提示                     | 补齐键盘焦点与本地化说明                                                  |

### 未采纳

| PR                                                | 决策         | 原因                                                                                                   |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| [#82](https://github.com/sunpcm/EchoTalk/pull/82) | 关闭，不合并 | 周报代码超过 500 行，但没有 API、调度器或任务队列调用链，合并后仍不可达且只返回 partial 状态           |
| [#85](https://github.com/sunpcm/EchoTalk/pull/85) | 关闭，不合并 | 同时修改 14 个文件，与 #50/#51/#52/#59/#87 大量重叠，无法干净 rebase，并把已有本地化文案改回硬编码中文 |
| [#88](https://github.com/sunpcm/EchoTalk/pull/88) | 关闭，不合并 | 与 #86 重复；#86 的辅助技术语义更清晰，避免未关联 tooltip 的重复暴露                                   |

“未采纳”只表示不接受该 PR 的当前实现，不代表永久否定需求。仍有价值的需求应缩小范围、补齐调用链和验收标准后重新提交。

## 已知限制和近期风险

- CI 使用的部分 GitHub Actions 仍基于已弃用的 Node 20 runtime，当前被 runner 强制运行在 Node 24。
- `ubuntu-latest` 即将迁移到 Ubuntu 26，应固定或验证 runner 版本，避免工具链突然变化。
- 前端仍存在少量 `Unexpected any` 告警，应在独立维护 PR 中消除。
- 根目录 `README.md` 包含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准，并应在后续 PR 中修正 README。

## 文档职责与更新规则

- `README.md`：项目入口、快速启动和稳定概览，不维护逐项决策流水账。
- `docs/PROJECT_STATUS.md`：当前功能事实、最近合并/拒绝决策、验证边界和已知风险。
- `TODO.md`：唯一未完成事项清单，必须带验收条件。
- `docs/PHASE_*_TECH_STACK.md`：具体阶段的实现细节。
- `docs/PHASE_*_MANUAL_TEST.md`：不能由 CI 覆盖的人工验收步骤。

以下变更必须在同一个 PR 中更新本文：

1. 新增、删除或改变用户可见功能。
2. 改变认证、密钥、数据所有权、生产配置或外部 Provider 边界。
3. 接受或拒绝会影响架构方向的大型实现。
4. 改变 CI 能证明的范围，或完成此前只能人工验证的事项。

更新时必须写明日期、PR、行为变化、验证证据和仍未覆盖的边界；不要把“代码存在”、
“CI 通过”和“生产已验证”混为同一状态。

## 2026-10-22 Dashboard生命周期发现接线

产品`fbbd78e`独立APPROVED并快进隔离集成：ActiveSessions恢复前台/联网刷新只读列表，挂起/离线作废旧请求且释放槽位，旧成功/失败/finally不污染恢复后请求，认证/StrictMode/卸载隔离通过。仅两个产品文件，Cloud开始门禁与disabled默认保持。

355产品、18构建测试、10私有探针、6既有及3新增Chromium/Fake API、2有效变异通过；源码恢复后完整质量复验通过。后端269/73.72%及专用库前检通过，无迁移。独立验证与边界见[生命周期发现接线](./verification/cross-platform/CP-01-LIFECYCLE-DISCOVERY.md)。

使用skill2dcd162、agy一次676.84活动秒，无独立产品返工；评审结果分类、实施夹具及宿主中断恢复观察记本地issues.md。不据此声称净省额。未推送/部署/真实Provider联调，原生恢复/通话接管仍待实现；本里程碑停止下一模型派发。

## 2026-10-22 活动会话显式结束本地里程碑

产品`d07f9e7`独立APPROVED并快进隔离集成：Dashboard内联确认结束指定记录、失败同ID显式重试；确认意图绑定选择时身份/revision，后台离线不重放POST，旧列表/结束/finally隔离。仅三个产品文件，API/auth/store与Cloud门禁保持。

371产品、18构建、17私有探针、6既有+2新增Chromium（另320px1项）、2有效变异、完整前端quality以及专用测试库269/73.72%通过；无迁移。最终集成门禁以本地completion为准，验证细节见[显式结束入口](./verification/cross-platform/CP-02-DISCOVERY-END.md)。

3次模型尝试累计927.13活动秒，含两次拒绝记录；版本变化另被预检阻断。确认来源代际缺口及i18n返工已关闭，P2文件头注释下轮维护。所有新问题与原始证据存本地，不自动升级全局skill、不声称净省额。未push/deploy/真实Provider联调，恢复/接管和原生媒体验收未完成，停止下一派发。

## 2026-10-22 已有会话显式恢复本地里程碑

产品`ca7ecb0`独立APPROVED并快进隔离集成：活动列表确认恢复已有记录，disabled能力门禁后重新核验active详情、健康与新Token，不创建新会话。旧store/组件回调归属隔离，后台/离线/reset/goHome取消后控件立即释放且新操作可推进，真正end POST在途规则保持；Cloud恢复/开始门禁继续保留。

403产品/18构建/39私有探针/10浏览器/2有效变异及完整quality通过；后端本任务269/73.72%无变更证据复用，无迁移。验证和边界见[显式恢复](./verification/cross-platform/CP-02-EXPLICIT-RECOVERY.md)，最终集成状态以本地completion为准。

本任务6次、2552.22活动秒，含拒绝、超时与集中返工；用户中途正式改10次/不限时，保留历史且最终交付无拒绝。新问题仅记本地，不外推省额。未推送/部署/真实Provider或原生媒体联调，不代表三端整体完成；停止下一派发评估工作流。

## 2026-10-22 A12 Agent调度失败本地里程碑

此前三端至A11已通过PR96合入远端main@344e317；本轮从该合并基线继续，产品cdbe479通过独立APPROVED。调度失败停止本地音轨、清Token/卸载房间，显示安全错误并允许返回主页后显式恢复；同session/gen单次调度、同步通知后的发送前门禁及迟到结果隔离通过。

419产品/18构建脚本/21独立模拟Room探针/6既有Chromium、2有效变异和完整7门禁通过，详见[调度失败验证](./verification/cross-platform/CP-02-AGENT-DISPATCH.md)。后端未改，本轮未跑数据库，不冒充真实媒体、原生或Provider验收。仅本地提交与隔离集成，不push/deploy，Cloud严格接管和连接离线/Token失效仍待完成。

本轮skill cd09a3a、3次尝试/1400.71活动秒；初次模型识别失败、同步可重入缺口、报告指纹与评审入口问题均记本地日志。未证明净Codex额度收益，不自动优化全局skill；在本小里程碑停止下一模型派发。

## 2026-10-22 A13 Web连接中断本地增量

产品97e4c75独立APPROVED：SDK错误/断开及Web后台离线时停止本地音轨、清Token/卸载Room，安全提示与显式恢复，无reload/自动重连；SDK/effect清理、来源认证/代际与同步空窗经过独立验证。441产品/18构建、49私有探针、6既有Chromium和2有效变异及完整7门禁通过，详见[验证](./verification/cross-platform/CP-02-CONNECTION-FAILURE.md)。真实媒体、原生和Cloud仍未验。

同会话两次CLI终止ERROR保留，原模型同账本冷启动后完整交付恢复；不修改错误结果。账本和单调时间差异、探针语法错误及四类产品返工均记本地。用户最新要求连续推进，已授权并完成匹配WebKit下载/启动冒烟，下一步补CP-06双浏览器门禁；不自动改skill或推送部署。

## 2026-10-22 A14双浏览器本地门禁

产品be242b2独立APPROVED：默认Chromium/WebKit各11项共22 E2E，含5类新增真实UI恢复/401边界；保留全部质量门禁并更新CI安装接线。独立441产品/18构建、5项Fake API进程探针、2有效变异及完整7门禁通过。详见[验证](./verification/cross-platform/CP-06-WEBKIT.md)。无产品/依赖/锁变更，Linux CI、真实IdP/媒体/原生未验，P2 fixture grammar后缀已记TODO。

中断后原流SUCCESS但无OS退出码，正式记录未知退出而不伪造0；同账本冷启动补完整交付且源码不变。2次尝试、问题/用量口径记本地日志；继续后续任务，不自动推送部署。

## 2026-10-23 A15分析轮询本地增量

产品0edf750独立APPROVED：状态/结果/knowledge整个读取周期合并重复事件，后台离线立即取消读代际、释放槽位，恢复新查询不被旧挂起阻塞；认证/会话/pollVersion及同步通知隔离保持。472产品/18构建、27私有探针、22双浏览器与两个有效变异通过；完整集成门禁证据见[验证](./verification/cross-platform/CP-05-ANALYSIS.md)。本轮数据库、原生及真实Provider未验。

两次agy尝试，1044.37账本活动秒；同会话最后total408174，续跑不累加，非Codex节省证明。用户关于20–30分钟任务减少无变化轮询的建议记入本地问题和流程文档，待后续评估，不自动改全局skill。继续已授权@capacitor/app@8.1.2原生生命周期任务，仅本地build+sync，不Xcode/签名/真实服务或push/deploy。

## 2026-10-23 A16原生生命周期适配器

产品bcf008c独立APPROVED：统一factory/iOS官方App状态监听、异步就绪/事件版本/失败恢复/释放边界；509产品/18构建、22独立探针、22双浏览器、两个有效变异及完整门禁通过。固定App8.1.2新增依赖，iOS development与production示例模式build+sync生成插件SPM与AppPlugin注册，保留原production webDir。见[验证](./verification/cross-platform/CP-05-NATIVE-ADAPTER.md)。消费者尚未迁移，原生OS/真实Provider/Xcode/签名未验，不冒充三端完成。

用户要求先优化工作流后继续：skill a42fde9两端本地同步，66项离线回归及结构校验通过；项目固定诊断入口跨cwd一致，证据复用三种错误输入拒绝。A16同账本5次尝试，网络reset保留，CLI1.4.6漂移模型前拦截后受限接纳，同模型冷启动完整补交；报告P2实际路径在本验证文档纠正。新问题/用量原始记录仅本地，未证明净省额，不自动push/deploy；继续只读消费者接线。

## 2026-10-23 A17原生只读消费者

产品d1a69d1独立APPROVED：活动列表与分析轮询默认factory接原生App事件，pending/失败/后台关闭读取，恢复只GET，局部effect和旧响应/槽位守卫保持。独立525产品/18构建、35私有探针、22双浏览器与两个有效变异通过，见[验证](./verification/cross-platform/CP-05-NATIVE-CONSUMERS.md)。仅四文件，无依赖/后端改动，通话启动/Room、真实OS/Provider仍未验；仅本地隔离集成，不push/deploy。

skill a42fde9新矩阵用于本轮，agy一次651.89账本活动秒、完整无拒权交付；独立探针API名错误和P2未查询空态/旧注释已记录，未发现需产品返工的P0/P1。精确Codex净额度收益未测，外部累计不能当省额；继续下一通话生命周期阶段，原生就绪永久挂起的可达退出先落实设计。

## 2026-10-23 A18原生启动与显式恢复

产品91f80d2独立APPROVED：先保留槽位再等原生就绪，pending零外部调用，10秒安全退出、取消释放与旧setup/ready/Token隔离；同意图认证失效卡槽位及初始化同步重入P1已关闭。547产品/18构建、30独立探针、22双浏览器与两个有效变异通过，见[验证](./verification/cross-platform/CP-05-NATIVE-STARTUP.md)。通话Room尚未接原生、真实OS/Provider/Xcode/签名未验，整体CP-05仍未完成。

skill a42fde9在本轮继续应用，3次尝试，r1新版checkpoint事件未知被失败关闭；同模型冷启动补完整交付，保留旧流与检查hash，独立七门禁不减。夹具缺字段、时序返工、测试全局注入/重复逻辑维护候选及格式兼容新问题已记本地；收益未作对照，不报Codex净节省率。不push/deploy，下一本地增量为Room原生挂载与音轨中断。

## 2026-10-23 A19原生Room挂载与同步停轨

产品fdf3d5e独立APPROVED：native就绪前零采音Room，10秒失败退出，后台/离线同步stop本地音轨，旧回调隔离及前台不自动写。565产品/18构建、20独立探针、22双浏览器、两个有效变异及iOS development/production示例build+sync通过，见[验证](./verification/cross-platform/CP-05-NATIVE-ROOM.md)。三项P1独立复现后关闭，健康重渲染不会误停麦克风。真实OS音频中断/路由、Provider、Xcode/签名、Cloud接管仍待验。

同账本5次/3421.81活动秒；评审文件跨允许目录拒权、旧上下文误读旧报告、503与EOF保留。原模型冷启动补完整交付，hash保护8份旧检查，独立门禁不减；工作流新问题本地记录，未证明净Codex省额，不自动改全局skill或push/deploy。

## 2026-10-23 A20活动列表查询事实

产品9273c95独立APPROVED：尚未查询不误报空，成功事实绑定精确principal/revision，取消及旧响应隔离，同账号后台保留已知列表；分析hook仅更新过期注释。574产品/18构建、14私有探针、22双浏览器及两个有效变异通过，见[验证](./verification/cross-platform/CP-05-DISCOVERY-QUERY-STATE.md)。四文件，无后端/依赖改动，不改变结束/恢复语义。

首轮650.89活动秒，完整无拒权交付；本轮未发现需产品返工P0/P1，交接观察与契约适用边界记本地issues。外部累计237606不能换算Codex净省额。不push/deploy，真实OS音频/认证、Cloud及发布仍待独立验收。

## 2026-10-23 A21设置抽屉可用性

产品797f8e4独立APPROVED：原生dialog背景保护、安全聚焦/返回、完整双向Tab到达Save、44触控及可滚动动态视口，正常重渲染不丢草稿。578产品/18构建、38默认双浏览器、26独立浏览器与3资源所有权单测、两有效变异通过；见[验证](./verification/cross-platform/CP-05-SETTINGS-DRAWER.md)。键盘仅封闭却Save不可达的P1经集中返工关闭；真实系统键盘/硬件safe-area和全局响应式仍未验。

skill1c1b68d实际接入12/15必读路径预检，同源CLI目录及专用handoff读取成功，两次1105.32活动秒，完整无拒权交付。原始失败与评审夹具/路径/附属artifact问题保留日志，不自动改skill或推送部署。本地工作无需用户参与；真实环境公开配置与设备人工验收稍后独立交互。

## 2026-10-24 A22活动列表响应式与触控

产品9d40cc7独立APPROVED：窄屏/横屏/桌面缩小/200%根字号卡片与确认不横向溢出，完整确认UUID可见换行、操作44px。render前逻辑逐字节未改。578产品/18构建脚本/56默认双浏览器、22独立布局探针和两有效变异通过；见[验证](./verification/cross-platform/CP-05-ACTIVITY-LAYOUT.md)。另发现既有恢复失败错误呈现P2：24私有用例中2失败，在A21基线同样复现，原确认可重试且零Token/写，已排下一修复。未把失败算通过，真实OS/Provider/发布仍待验。

## 2026-10-24 A23恢复失败与取消终态

产品8b2df80独立APPROVED：通过sessionGen区分当前恢复正常失败与真正取消，专用安全错误/完整目标/44px重试及取消可用；reset/goHome等立即释放，旧请求不污染新意图。首轮共享error清理导致同步reset后旧错误回写的P1已删除触发路径，嵌套测试伪标识移除；旧E2E仅两处精确定位器迁移并增强断言。588产品/18构建脚本/60默认双浏览器、12独立真实store失败路径+2时序探针、原始2浏览器反例及两有效变异通过；见[验证](./verification/cross-platform/CP-05-RESUME-ERROR.md)。checkpoint交付流拒收后同模型冷启动短交付恢复，旧失败保留。仍仅本地隔离集成，真实OS/Provider/发布未验。

## 2026-10-24 A24 DocTalk本地文件导入可靠性

产品ce0e0b4独立APPROVED：仅支持既有文本扩展名，UTF-8含BOM、50k既有长度及保守字节界限；失败保稿/安全错误、再选恢复，旧读取不能覆盖新选择/编辑/已提交父value或卸载后状态。提交至passive清理间隙P1、未实际执行旧回调的测试缺口、BOM重复去除正文三项集中关闭。606产品/18构建脚本/62默认双浏览器、11独立时序+18真实浏览器与两有效变异通过；见[验证](./verification/cross-platform/CP-05-DOC-IMPORT.md)。两次Flash完整交付，无拒权/未知流，问题记录未触发全局skill扩展。仍仅本地隔离集成，真机OS选择器/Provider/发布未验。

## 2026-10-24 A25 DocTalk设置页响应式与触控

产品6604516独立APPROVED：窄屏返回与标题/副标题重排，全部动作至少44px，桌面窗口缩小/横屏/200%字号可读且草稿保留；两组件return前与A24文件读取哈希完全保持。首轮固定rem留白造成标题32px内部溢出的P1已关闭；606产品/18构建脚本/82默认双浏览器、22独立浏览器与两有效变异通过，见[验证](./verification/cross-platform/CP-05-DOC-LAYOUT.md)。首轮CLI配置拒读记录保留，权限不变，正式恢复后同Flash冷启动完整交付。仍仅本地隔离集成，不等同真机键盘/safe-area或发布验收。

## 2026-10-24 A29 独立验收与本地集成

Fake API 主题必需字段及 success/failure 项目后缀 assessment/grammar 严格路由修复经 Codex 独立评审 APPROVED；新增 Node 真实子进程 runner，使本地完整 quality 为 8 项。648 产品 / 18 构建 / 53 Fake API Node / 120 双浏览器与专用 PostgreSQL 269 通过，另 33 独立 HTTP、生命周期故障探针及两有效变异通过。启动失败/挂起 body/并发终止与断言异常清理均有本地证据。后续继续补齐 CI 显式执行步骤；远端 CI、真实链路与发布仍分别验收，未推送或部署。

## 2026-10-25 A30 CI 真实测试入口

Codex 独立评审 APPROVED：前端 CI 显式执行 Vitest、构建脚本与 Fake API Node 测试，lint/typecheck/build 强制执行；后端、触发器及聚合成功断言保持不变。648 产品 / 18 构建 / 53 Fake API Node / 120 双浏览器和专用 PostgreSQL 269 通过，YAML 语义不变量及两有效变异通过。见[验证](./verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。这仅完成本地配置与验证，远端 Linux CI、RF-04 整体验收及发布仍待执行；未推送或部署。

## 2026-10-25 A31 独立验收

Codex 独立评审 APPROVED：660 产品 / 18 构建脚本 / 53 Fake API Node / 126 双浏览器与专用 PostgreSQL 269（覆盖率73.72%）及 Ruff 通过；另35独立 Storage/时序探针、4独立双浏览器和2有效变异通过。Storage 访问失败安全回退，不阻断本地主题/认证同步或成功水合；恢复缓存后实际reload仍保留选择。测试维护P2与原报告计数偏差留存本地issues，未改skill、推送或部署。

## 2026-10-25 A32 独立验收

Codex 独立评审 APPROVED：103份运行源码引用审计、6项独立双浏览器与2有效变异通过，产品仅6处颜色utility替换、6行无用token定义删除，其他业务逻辑逐字节未变。完整8项门禁660单测/18构建脚本/53 Fake API Node/134双浏览器，专用PostgreSQL 269（73.72%）及Ruff通过。测试中主题PUT断言仅检查含theme的P2精度问题保留本地issues；实际源码没有新增写路径。未推送/部署，真实环境与远端CI仍待验。

## 2026-10-25 A33 独立验收

Codex 独立评审 APPROVED：无歧义tuple编码隔离冒号边界碰撞，665单测/18构建脚本/53 Fake API Node/138双浏览器及269专用库后端（73.72%）与Ruff通过；5独立时序探针含真实旧timer调用，2有效变异通过。新增测试旧timer空回调/剪贴板断言精度P2已记录，不将其计为实际覆盖；产品只改一行编码和注释。未推送、部署或连接真实外部环境。

## 2026-10-25 A34 独立验收

Codex 独立评审 APPROVED：698单测/18构建脚本/53 Fake API Node/140双浏览器及269专用库后端（73.72%）与Ruff通过。另40独立API/真实DataChannel/日志边界探针与2独立双浏览器通过，验证完整console参数白名单、敏感canary缺失、API503后重试恢复与零新增业务写；放宽错误码白名单及恢复raw payload日志两变异分别导致1/2项产品测试失败。全部冻结源码/测试字节恢复后全门禁通过。

r0直接grep拒权后早停，用户明确重新授权原范围读取，r1完成源码和8项门禁但流ERROR；原失败保留，同模型r2冷启动只补完整交付，绑定复用源码和8日志hash，3次尝试/1395.31活动秒。独立验收未省略，不改skill、权限配置或真实环境；本地console一期不隐含遥测上报要求，CP06三端真实联动仍待验。

## 2026-10-25 A35 独立验收

Codex 独立评审 APPROVED：698单测/18构建脚本/53 Fake API Node/144双浏览器与专用PostgreSQL 269（73.72%）及Ruff通过；另10项独立双浏览器覆盖普通/reduce computed、真实背景与文字插值、warm→dark→cool、390px/200%字号、完整根容器几何、精确主题PUT与零业务写。根scope缺失及reduce时长破坏两有效变异各导致1项产品测试失败，逐字节/整树恢复后完整8门禁通过。

新增E2E未实际设置窄屏/200%，spinner为条件分支，均不计作该新增用例实际覆盖；前者由独立探针实测补足，后者由保留的A27专门回归验证，原报告/失败批次留存本地issues，不改skill。scope只含CSS/既有HTML属性与两处class组合，业务逻辑未改；真实设备视觉仍待验，未推送或部署。

## 2026-10-25 A36 / RF-07 本地阶段独立验收

Codex 独立评审 APPROVED：真实192包锁、原172项重叠版本/七项SDK保持；cp00全新环境frozen安装172项及离线check通过，新env269 pytest/73.72%与Ruff通过。13控制入口护栏、CI/Docker源码不变量、导出逐字节一致及2有效变异通过；完整前端8门禁698单测/18构建脚本/53 Fake API Node/144双浏览器通过。旧环境未同步安装，所有数据库检查仅专用测试库；权限仍限cp00，不扩其他lane。

原工具草案未绑定执行，缺陷和私有文件拒权记录保留；评审维护小型固定控制入口，agy完成项目/CI/Docker配方源码。API/Agent/Dev分组尚未做，192包锁含19项Linux/CUDA条件分支；未运行Docker build/远端Linux CI、未选择CPU专用源、未部署或触真实业务，RF07整项仍未完成。

## 2026-10-25 A41 / RF-08 会话分页与每日聚合独立实施

- **前后端契约对齐**：会话列表（`GET /api/sessions` 及 `GET /api/sessions/active`）统一升级为 `{ items: SessionListItem[], next_cursor: string | null }`；客户端严格校验 `items.length <= 100`，`next_cursor` 为非空字符串且 `<= 1024` 字节，且每个 item 必须显式包含 `ended_at`（ISO 字符串或 `null`）；新增 `GET /api/sessions/daily-progress` 聚合端点（返回 `completed_sessions` 与 `total_turns`）。
- **稳定与校验游标**：游标基于 `(started_at, id)` keyset 稳定排序，标准库 canonical URL-safe base64 编码，严格要求 `v=1` 为整数（拒绝 bool/float），严格绑定 endpoint、当前用户、status 及时间窗上下文白名单进行绝对比对；长度限制 `<= 1024` 字节；自包含无状态校验，非 HMAC 签名凭证，不提供抗恶意改写完整性保证；数据库查询始终强制当前 `user_id` 过滤；非法格式、超长或上下文不匹配一律返回 422。
- **性能与生命周期健壮性**：DailyProgress 消除 N+1 会话详情与正文拉取，采用单次 SQL 统计，0 条转录 completed 会话计为 1 且 total_turns 为 0；前端采用本地自然日（00:00 - 次日 00:00，DST 兼容）；午夜定时器安排与窗口变化彻底解耦，不进行 24h 硬夹值，支持 25h/23h/24h 本地自然日及 StrictMode 双挂载重建；离线与切后台挂起时同步作废在途分页请求并清空游标状态，使“加载更多”按钮即时隐藏；跨午夜时不论在线离线立即清空昨日数据，离线跨日不发网络；首屏与分页追加实施严格 ID 去重；ActiveSessions 显式点击加载更多，在途加载与结束/恢复操作互锁；more 分支覆盖换号、revision 更新、旧 finally 隔离、错误同 cursor 重试及双击去重。
- **全量门禁结果**：前端 743 Vitest / 18 构建脚本 / 61 Fake API / 148 Playwright E2E（WebKit & Chromium）及格式与类型检查全部 0 错误通过；后端 303 项 pytest 全部通过（覆盖率 74.48% >= 59.0% 门禁），Ruff 格式与检查 0 错误。停在 Review，未提交 Git 或部署。

## 2026-10-25 A42 / RF-09 Agent 安全错误映射与出口边界实施

基于 TODO.md RF-09 与 MVP 重构方案 RF03（秘密不入日志与响应）及 RF09（AgentErrorMapper）规范完成本地实施。建立单一安全错误映射边界 `AgentErrorMapper`，固化既有 9 项错误码全集及静态安全本地化文本映射，阻断异常正文、URL、密钥向客户端回显及日志泄露；守护最终 DataChannel 发送入口，清理 SDK 私有属性读取与 raw identity 输出。

- **本地实现与安全边界**：新增 `backend/livekit_agent/error_mapper.py`，完整保留 9 项既有错误码白名单（`ERR_CUSTOM_KEY_INVALID`、`ERR_UNSUPPORTED_STT_PROVIDER`、`ERR_UNSUPPORTED_LLM_PROVIDER`、`ERR_UNSUPPORTED_TTS_PROVIDER`、`ERR_SYSTEM_CONFIG`、`ERR_SESSION_NOT_FOUND`、`ERR_CUSTOM_RUNTIME_AUTH`、`ERR_CUSTOM_RUNTIME`、`ERR_SYSTEM_RUNTIME`），未知或恶意 code/message 安全兜底已有常量，不回显 raw 文本片段；`classify_runtime_error` 严格保留 typed `APIStatusError` 401/403 与 legacy 文本线索的 custom runtime 认证分类，且两分支严格互斥（typed 429/500 正文含 401/403 不误判 AUTH，不可恢复映射为 `ERR_CUSTOM_RUNTIME`，可恢复与基础轨交 SDK 默认处理，零额外断连与通知）；提供严格字段净化（UUID session_id、100..599 HTTP 状态码、布尔与白名单类型过滤）；异常 `__str__` 抛错安全兜底；`agent.py` 发送入口接入安全 mapper，普通 publish 异常日志脱敏（无 exc_info）且仍执行 disconnect，disconnect 失败与取消异常正常向上传播；删除入口日志对 `ctx._info.url` 私有字段读取与原始 `participant.identity` 输出。
- **质量验证覆盖**：新增 `test_agent_errors.py` 覆盖纯 mapper 映射、typed 互斥与恶意降级、运行时错误矩阵、字段净化与 `__str__` 容错；使用 synthetic canary 注入异常消息/repr、URL/Authorization、PluginInitError 与 publish 异常，挂载 `ExplodingPrivateInfo` 证实零私有 `_info.url` 访问；断言应用自有全部日志记录（包括 args/extra/exc_info/stack_info）及 publish payload 绝对不含 canary，wire 格式 `{type: "agent_error", code, message}`、reliable=True、topic="agent_error" 逐项保持；确定性 task 等待消除任意 sleep；保持 `test_livekit_agent.py` 原 4 项转录测试语义。
- **契约与界限**：契约见 [RF-09 Agent 安全错误映射验证](./verification/cross-platform/RF-09-SAFE-AGENT-ERRORS.md)。脱敏与零泄漏结论仅限于本地测试覆盖的应用自有路径，LiveKit SDK 自身内部日志行为本轮未宣称覆盖；Orchestrator/CredentialResolver/Registry/TranscriptSink 拆分、sys.path/dotenv/环境变量清理及真实 SDK/外部 Provider 联调仍待后续完成，整项保持未勾选，RF-09 持续推进。

## 2026-10-25 A43 / RF-09 转录事件幂等与数据库一致性落地实施

基于 TODO.md RF-09“后台写入可排空、可观测、可重试”要求与用户批准的“先做事件ID与数据库幂等”完成本地实施。在 `transcripts` 表新增可选 `event_id` 并建立 `(session_id, event_id)` 复合唯一约束（普通 NULL 语义保留历史兼容，禁止 `NULLS NOT DISTINCT`）；升级 `save_transcript` 实现原子幂等写入与重放保护；两生产入口接入基于 `ChatMessage.id` 的稳定 UUID5 派生。

- **本地实现与原子幂等契约**：`backend/models/session.py` 中 `Transcript` 模型添加 `event_id: Mapped[uuid.UUID | None]` 及 `UniqueConstraint("session_id", "event_id", name="uq_transcripts_session_event")`；`backend/services/transcript_service.py` 扩展 keyword-only `event_id`，无 key 时保留原 legacy 行为（两次插入两条），有效 key 时采用 PostgreSQL 原生原子 `INSERT ON CONFLICT (uq_transcripts_session_event) DO NOTHING RETURNING id`，冲突时读取原记录并执行严格重放一致性校验（相同 role/content/emotion_state 及显式传入的 timestamp_ms 返回原记录；不同 payload 安全拒绝返回 None 且零改写；未提供 timestamp_ms 允许时钟前进但仍返回首写时间戳）；无效 event_id 失败关闭零写；commit 成功后确认失败重试保证单条；无 `logger.exception` 或敏感正文泄漏。
- **两生产入口稳定派生**：新增 `backend/livekit_agent/transcript_events.py`，纯标准库无副作用，基于 `ChatMessage.id`、session 与 role 稳定派生 UUID5，不同 item/session/role 严格域隔离；`backend/livekit_agent/agent.py` 的 user turn hook 与 assistant event 分别接入稳定派生，缺失或非法 item_id 拒绝写入零降级。
- **质量验证覆盖**：新增 `test_transcript_idempotency.py` 覆盖专用 PostgreSQL 真实并发 Barrier、顺序幂等重发、不同 key 同文本同时间不抑制、legacy 多 NULL 记录、跨 session 相同 key 隔离、冲突 payload 拒绝、非目标外键违规安全失败、commit 成功 ack 失败显式重试单条以及每日聚合转录总条数不因重试多算；`test_livekit_agent.py` 覆盖两生产入口真实接线与派生属性；`test_transcript_service.py` 补充非法 event_id 拒绝用例；所有自建数据库记录均在 finally 中按所属严格清理。
- **契约与界限**：契约见 [RF-09 转录事件幂等验证](./verification/cross-platform/RF-09-TRANSCRIPT-EVENTS.md)。本次未实现外部消息队列、自动 retry 调度、优雅 shutdown 排空或跨进程恢复，不宣称 exactly-once 交付保证；Orchestrator/CredentialResolver/Registry 拆分、sys.path/dotenv/环境变量清理及真实 SDK 联调仍待后续完成，整项保持未勾选，RF-09 持续推进。

## 2026-10-25 A44 / RF-09 有界内存 TranscriptSink 与故障终止实施

基于 TODO.md RF-09“后台写入可排空、可观测、可重试”要求与已批准的 A44 策略完成本地实施。建立会话级独立有界内存 `TranscriptSink`，消除每消息 `ensure_future(save_transcript)` 无归属后台任务与无界内存膨胀风险；生产双入口接入统一 Sink 实例，实现尝试与失败收束、优雅排空与单次安全故障会话终止。

- **本地实现与接口契约**：新增 `backend/livekit_agent/transcript_sink.py`，实现 `TranscriptSink(session_id, on_failure, writer=save_transcript, capacity=256, max_attempts=3, attempt_timeout=2.0, backoff=(0.25, 1.0), drain_timeout=8.0)`；`submit` 采用同步非阻塞，严格限制 256 pending + 1 active 事件条数上限（非字节硬上限），拒绝空白文本、坏 UUID `event_id`、非法角色与非法 `session_id`；接纳时深拷贝快照，未显式传入的时间戳严格保留 `None`；单 worker 顺序处理；每事件最多 3 次写入尝试（1 首次 + 2 重试），支持通用 Awaitable/Future，单次 2.0s 合作式超时，(0.25, 1.0) 秒固定阶梯退避；满队列或重试耗尽同步停止接纳，至多触发一次异步故障通知（自定义轨 `ERR_CUSTOM_RUNTIME`，基础轨 `ERR_SYSTEM_RUNTIME`），故障通知回调先行检查参数签名（内部抛错不重试）且支持重入调用 close 消除死锁，异常安全吸收不遗留未取 Task；8.0s 总排空预算，超时或取消强制收束自有 worker/writer/notify 任务，未落库项目统一记入 `failed`，记账恒等式 `accepted == succeeded + failed + pending + inflight` 严格保持；并发与多次 `close` 幂等共享结果，外部 caller 取消传播 CancelledError 但底层生成可复用布尔结果，`close() == True` 仅表示所有已接纳（accepted）事件保存成功。
- **生产接线与生命周期**：`agent.py` 中 `EchoTalkAgent` 与 `_persist_assistant_conversation_item` 统一接入单一 Job Sink 实例，透传稳定 UUID5 `event_id`；未注入 Sink 安全丢弃零隐式写；`entrypoint` 在建立连接与取得 `session_id` 后立即实例化 Sink，早于任何事件接纳前通过 `ctx.add_shutdown_callback(sink.close)` 挂载生命周期；采用整体 `try ... finally: if not started: await sink.close()` 所有权保护，初始化失败、配置异常与 `agent_session.start` 异常/取消均保证显式关闭 Sink 杜绝任务残留；启动成功后保持 Sink 活跃供会话生命周期使用。
- **质量验证覆盖**：新增 `test_transcript_sink.py`（19 项测试）覆盖双入口提交与记账恒等式、两 Job 隔离、256 真实容量边界与单次故障通知、输入校验防御、重试耗尽矩阵、单次超时退避、通用 Awaitable 与 Future 支持、writer 意外取消单次 task_done、故障回调签名检查与内部 TypeError 不重试、故障回调重入调用 close 消除死锁、排空超时收束物理清空队列、并发与重复 close 幂等、调用者取消资源清理与结果复用、深拷贝与 None 时间戳保持、Canary 安全日志脱敏审计、entrypoint 真实双入口写入与 shutdown callback 捕获执行排空、启动失败清理以及专用 PostgreSQL 模拟首次 commit 成功后确认丢包重试幂等单条；`test_livekit_agent.py` 调整 Sink 接线期望并完整保留 A43 非法 source/非 assistant/空文本/域隔离/日志全部旧语义；`test_agent_errors.py` 保持全部安全/断连/取消断言；`test_transcript_idempotency.py` 修复 A43 P2 并发 Barrier 观测（在实际 service 使用的 session 取得 PID 并持有到 Barrier 再写）。
- **契约与界限**：契约见 [RF-09 有界内存 TranscriptSink 验证](./verification/cross-platform/RF-09-TRANSCRIPT-SINK.md)。内存有界缓冲不提供跨进程持久化保证，进程强杀可丢失未落库事件；Orchestrator/CredentialResolver/Registry 拆分、sys.path/dotenv/环境变量清理及真实 SDK/外部 Provider 联调仍待后续完成，整项保持未勾选，RF-09 持续推进。

## 2026-10-25 A45 / RF-09 提取自定义凭据解析边界实施

基于 TODO.md RF-09 与 MVP 重构方案 §RF03、§RF09 规范完成本地实施。将自定义轨（BYOK）凭据预检、解密与敏感字段封装从 `agent.py` 中彻底解耦，提取独立纯净模块 `CredentialResolver`；统一异常定义迁移至标准库 `plugin_errors.py`，消除对 LiveKit SDK 与网络依赖；保持双轨运行生命周期与原有错误出口安全码。

- **本地实现与接口契约**：新增 `backend/livekit_agent/plugin_errors.py`，承载标准 `PluginInitError` 异常定义，`plugin_factory.py` 保持向后兼容导出（`is` 严格同一类身份）；新增 `backend/livekit_agent/credential_resolver.py`，提供 `CredentialResolver.resolve_custom(user_settings, default_llm_model)`，生成不可变 `ResolvedCustomCredentials` 快照，明文密钥显式标记 `repr=False` 并在 repr/str 中输出为掩码 `***`，禁止记录、持久化或序列化输出明文、密文及 key_version；严格保证 6 项必填预检顺序（3 provider -> 3 key），未齐备前零解密、零 factory 构造；按 STT/LLM/TTS 顺序依次解密，任一解密失败立即抛出静态安全 `ERR_CUSTOM_KEY_INVALID`，终止后续解密，底层异常正文脱敏绝不泄露；透传各 key_version（含 None legacy 值），支持 custom model 与 default fallback；模块无 LiveKit SDK、PluginFactory、网络或环境副作用。
- **生产接线与生命周期**：`backend/livekit_agent/agent.py` 移除内部重复的 6 项校验与 3 次解密逻辑，`_build_custom_plugins` 接入统一 `CredentialResolver`，敏感系统环境变量临时清除与 `finally` 恢复逻辑保持原语义；基础轨 `entrypoint` 零 resolver、零 decrypt、零 encrypted 字段访问；自定义轨安全捕获解析失败并向客户端推送安全的错误码及断连。
- **质量验证覆盖**：新增 `backend/tests/test_credential_resolver.py`（20 项测试）覆盖 6 项缺失快速失败与严格顺序、解密失败 3 处位置终止、3 版本及 None legacy 透传、模型选择与 provider 提取、不可变 snapshot 与原配置无副作用、Canary 安全日志与 repr 脱敏审计、`_build_custom_plugins` 真实传参与异常环境恢复、双轨 entrypoint 隔离与安全错误码断连、模块无 SDK 依赖；更新 `test_plugin_factory.py` 补充异常类身份与捕获互通性验证（1 项测试），保留全部既有用例。
- **契约与界限**：契约见 [RF-09 自定义凭据解析边界验证](./verification/cross-platform/RF-09-CREDENTIAL-RESOLVER.md)。本轮仅完成自定义轨凭据边界与异常解耦（RF-09 子项）；Orchestrator/ProviderRegistry 拆分、sys.path/dotenv/环境变量清理及真实 SDK 联调仍待后续完成，整项保持未勾选，RF-09 持续推进。

## 2026-10-25 A46 / RF-09 自定义插件显式凭据构造与零进程环境改写实施

基于 TODO.md RF-09“无敏感环境变量临时删除”与 MVP 重构方案 §RF09 规范完成本地实施。彻底移除 `backend/livekit_agent/agent.py` 中 `import os`、`_SENSITIVE_ENV_VARS` 敏感环境变量列表及 `_build_custom_plugins` 内部基于 `os.environ.pop` / `os.environ.update` 的临时修改与 finally 恢复逻辑；基于已审冻结 SDK 行为与 PluginFactory 既有 API Key 校验机制，实现显式传参直连 SDK 构造器，生产运行全流程实现零 `os.environ` 写操作。

- **本地实现与接口契约**：`agent.py` 中移除 `import os`（全模块证实无其他 os 使用）、移除 `_SENSITIVE_ENV_VARS` 5 项敏感变量定义；`_build_custom_plugins` 仅保留 `CredentialResolver.resolve_custom` 结果显式传入 `PluginFactory.create_stt`、`create_llm`、`create_tts` 与 `create_vad` 并返回；不引入任何替代全局 mapping 或上下文管理工具隐藏改写，生产整个构造过程零进程环境写；PluginFactory 既有 `_validate_api_key` 严格拒绝非 str、空、全空白及含 `\n`/`\r`/`\x00` 危险字符并返回 strip 净化后的 key，非法凭据严格抛出静态安全 `ERR_CUSTOM_KEY_INVALID` 失败关闭，杜绝静默降级或回退读取系统 key；三角色 provider、model、base_url 及构造顺序严格保持。
- **质量验证覆盖**：新增 `backend/tests/test_agent_explicit_keys.py` 覆盖 5 项敏感环境变量均存在时每个 SDK constructor 调用瞬间与返回后环境严格不变、SDK 接收到净化后的 custom key 且 STT/LLM/TTS 归属不串、部分敏感环境变量缺失时保持缺失不补写、resolver/factory 异常流程环境不变且后续 role 零调用、非法 key 矩阵拒绝且零环境回退、并发与嵌套两用户自定义配置互不干扰、OpenRouter 与模型选择支持、VAD 始终 mock 零网络/下载以及全链路 Canary 日志与载荷脱敏审计；更新 `backend/tests/test_credential_resolver.py` 删除已移除常量的 import，使用 `patch.dict` 精确隔离环境（关闭 A45 P2 遗留的环境恢复风险），保持既有 20 项测试语义。
- **契约与界限**：契约见 [RF-09 自定义插件显式凭据构造验证](./verification/cross-platform/RF-09-EXPLICIT-KEYS.md)。本轮仅完成自定义插件构造显式传参与零进程环境变量改写；Orchestrator/ProviderRegistry 拆分、sys.path/dotenv 清理及真实外部 Provider 网络联调仍待后续完成，整项保持未勾选，RF-09 持续推进。

## 2026-10-26 A47 / RF-06 根元数据与一次性诊断脚本清理实施

基于 TODO.md RF-06 架构减法与 MVP 重构方案完成本地实施。对根包元数据进行规范化清理，并安全清理无调用的历史一次性诊断脚本，明确 monorepo 根目录定位。

- **本地实现与元数据规范**：根目录 `package.json` 更新 `name` 为 `"echotalk"`，添加准确项目 `description`（`"EchoTalk - AI-powered real-time English learning and speaking practice platform"`），显式声明 `"private": true` 杜绝意外发布，删除指向不存在文件的无效 `"main": "index.js"`；严格未修改版本号、license、packageManager、脚本命令、devDependencies 或 lock 文件；保持 Turbo、Docker、Capacitor 及子应用配置一致。
- **一次性诊断脚本清理**：全局引用审计确认根目录 `test_api_err.ts` 仅在评审手册 §2 中提及，无任何源码、构建脚本、CI 或自动化测试引用；完成安全删除；同步更新 `docs/agent-review-loop.md` 说明该历史诊断脚本已移除且明确不属于测试树。
- **质量验证覆盖**：全量前端 8 项门禁（格式检查、Lint、类型检查、Vitest 单元测试、构建脚本测试、Fake API 子进程回归、应用构建、Playwright 双浏览器 E2E）全部通过；根元数据与脚本清理零回归。
- **契约与界限**：契约见 [RF-06 根元数据与一次性诊断清理验证](./verification/cross-platform/RF-06-ROOT-CLEANUP.md)。本轮仅完成根元数据与无调用一次性诊断脚本清理；Webpack 移除、ui-lib 模板精简、Plop/Changesets 评估等前端深度清理仍待后续阶段推进，整项保持未勾选，RF-06 持续推进。

## 2026-10-26 A48 / RF-09 ProviderRegistry 插件集构造收口实施

基于 TODO.md RF-09 与 MVP 重构方案 §RF09 规范完成本地实施。将 Agent 中的已解析凭据到插件集构造及基础轨默认插件集构造收口至独立模块 `ProviderRegistry`，严格按 STT → LLM → TTS → VAD 顺序构造并在失败时阻断后续；`agent.py` 移除直接 `PluginFactory` 依赖并完全委托 `ProviderRegistry`，保持双轨生命周期、错误码与零环境改写。

- **本地实现与接口契约**：新增 `backend/livekit_agent/provider_registry.py`，提供 `ProviderRegistry.from_custom(resolved: ResolvedCustomCredentials)` 与 `ProviderRegistry.from_system_defaults()`；`from_custom` 仅接收已解密不可变快照，严格类型校验（非 `ResolvedCustomCredentials` 抛出 `TypeError`），模块有运行时 snapshot 依赖（import 用于 isinstance 校验），基础轨零 resolver 调用/零解密，不接触 ORM 模型、不改写环境变量、不自行兜底；严格保证 STT → LLM → TTS → VAD 构造顺序与任一角色失败立即短路；实际插件构造严格委托 `PluginFactory.create_stt`、`create_llm`、`create_tts` 与 `create_vad`；`from_system_defaults()` 委托 `PluginFactory.from_system_defaults()`，基础轨零用户加密字段读取、零解密操作、零 resolver 调用；返回字典严格包含四角色实例 `{"stt", "llm", "tts", "vad"}`。
- **生产接线与生命周期**：`backend/livekit_agent/agent.py` 移除未使用的 `PluginFactory` 导入，改由 `from livekit_agent.provider_registry import ProviderRegistry`；`_build_custom_plugins` 保留 `CredentialResolver.resolve_custom` 后直接委托 `ProviderRegistry.from_custom(resolved)`；`entrypoint` 基础轨直接调用 `ProviderRegistry.from_system_defaults()`；双轨生命周期、安全错误码映射及出口断连行为逐项保持。
- **质量验证覆盖**：新增 `backend/tests/test_provider_registry.py`（真实新增 14 函数/19 用例，原有文案误称 8 项）覆盖 `ProviderRegistry` 正确角色 key/model/provider 归属（防串扰断言）、wrong-role key 与漏构造某 role 变异防御、严格构造顺序（STT → LLM → TTS → VAD）与失败短路矩阵、非 snapshot 类型严格拒绝、基础轨零凭据委托、真实 `_build_custom_plugins` 委托、`entrypoint` 双轨消费；Canary 新测试只验证 repr 且 env 新测试仅前后，构造中 env 与日志原 A46 回归承担；更新 `backend/tests/test_credential_resolver.py` 适配 Factory patch 路径，完整保留原有 20 项断言；全链路回归（A42 错误出口、A43 幂等、A44 Sink、A45 Resolver、A46 显式 Key）全部通过。
- **契约与界限**：契约见 [RF-09 ProviderRegistry 插件集构造验证](./verification/cross-platform/RF-09-PROVIDER-REGISTRY.md)。本轮仅完成插件集构造收口与 `ProviderRegistry` 边界落地（RF-09 子项）；Orchestrator 拆分、`sys.path` / `dotenv` 清理及真实 SDK 联调仍待后续完成，整项保持未勾选，RF-09 持续推进。

## 2026-10-26 A49 / RF-11 异常 HTTP 错误体健壮解析实施

基于 TODO.md RF-11 与 MVP 重构方案 §RF11 规范完成本地实施。修复前端 API 客户端 `request` 在遇到非预期格式错误响应体（如 `detail: [null]`、非数组或非法 `loc`、非 string 的 `msg` / `errors` 等）时抛出 `TypeError` 导致 HTTP 状态码丢失的问题，保障所有 HTTP 错误一致包装为携带正确状态码和原始数据的 `ApiError`。

- **本地实现与接口契约**：在 `apps/vite-app/src/lib/api.ts` 中实现局部类型守卫 `isRecord` 与 `getFirstTruthyString`；FastAPI 校验异常分支严格校验 `firstError` 对象与 `msg` 字符串类型（空字符串合法透传），未通过数组类型收窄的非法或非数组 `loc` 安全回退为 `"Unknown"` 且杜绝调用任何对象方法，正常 string/number 数组安全 join（空数组安全拼接为空字符串）；保持 `detail.errors` 与顶层 `errors` 首空值 fallback 和 `detail.message` 原 truthy 语义，仅在首值为有效字符串时采纳，杜绝将对象误赋为 `Error.message`；非字典或异常数据安全回退到原默认文案 `请求失败: <status>`；完整保持既有有效分支优先级（detail 字符串、FastAPI 校验异常、嵌套 errors、detail.message、顶层 errors/message 及无 message/errors 的合法 detail 对象 `JSON.stringify` 兜底）。
- **生命周期与安全边界**：401 会话失效逻辑保留在响应体解析前执行，严格绑定请求发起时的 `reqRevision`，迟到的 401 响应安全短路不影响更新的会话；错误处理全流程不重放任何写请求，请求单次发出；安全诊断日志严格遵循脱敏白名单，不记录任何响应体正文或凭据。
- **质量验证覆盖**：在 `apps/vite-app/src/lib/api.test.ts` 新增表驱动回归用例，通过真实公共 API 调用覆盖 422 异常/有效 detail、非法/缺省 loc、非 string msg、异常 errors、嵌套 detail 结构、顶层 message、原始非对象 body 等 34 种场景；覆盖非 JSON 响应拒绝、401 异常错误体下的 session 失效与 ApiError 保留、迟到 401 保护机制及写请求 fetch 仅调用一次断言；原有 4 项测试及全部既有断言完整保留。
- **契约与界限**：契约见 [RF-11 异常 HTTP 错误体健壮解析验证](./verification/cross-platform/RF-11-ERROR-BODY-GUARDS.md)。本轮仅完成 Transport 层异常错误体健壮解析（RF-11 子项）；OpenAPI 客户端/类型生成、会话状态模型收敛与组件重构仍待后续完成，整项保持未勾选，RF-11 持续推进。

## 2026-10-26 A50 / RF-10 LLM 静态元数据单一来源实施

基于 TODO.md RF-10 与 MVP 重构方案 §RF10 规范完成本地实施。收敛消除 `plugin_factory.py`、`llm_service.py` 与 `validation_service.py` 三处重复的 LLM Provider 静态配置，提取纯标准库不可变目录 `provider_catalog.py`；同时落实 A49 遗留 P2 合法空嵌套 message 对象的 JSON 字符串回退保护。

- **本地实现与接口契约**：新增 `backend/provider_catalog.py`，定义不可变条目 `LLMProviderMetadata`（`frozen=True`）与 `MappingProxyType` 导出的不可变字典 `LLM_PROVIDER_CATALOG`；严格保持 SiliconFlow 与 OpenRouter 两家 Provider 及其顺序与现有常量值；纯标准库实现，零第三方依赖，不存储 key 值，不读取 `os.environ`，不导入 SDK/config/crypto/DB，无网络或文件 I/O；`livekit_agent/plugin_factory.py` 的 `LLM_PROVIDER_BASE_URL`、`SUPPORTED_LLM_PROVIDERS` 与 `_SYSTEM_LLM_KEY_FIELD` 统一从 Catalog 派生，保留原导出变量名、类型及顺序；`services/llm_service.py` 的 `PROVIDER_CONFIG` 从 Catalog 派生，保留原字典结构与键名；`services/validation_service.py` 的 `validate_llm_key` 端点表改为由 Catalog 提供，保持 Bearer Authorization Header、超时、错误分类以及未知 Provider 与空 key 的快速失败短路机制；前端 `api.ts` 恢复对合法空嵌套 message（`{detail: {message: ""}}` 及包含额外非错误字段）的 `JSON.stringify` 兜底回退，同步更新测试 oracle 与 RF11 验证文档。
- **质量验证覆盖**：新增 `backend/tests/test_provider_catalog.py`，覆盖 Catalog 结构与常量精确值、映射与条目双重不可变性、三处消费者元数据接线一致性、未知 Provider 与缺失 key 的零网络调用保护，并在最小无凭据干净子进程环境中验证纯标准库独立安全导入与零多余模块加载；`test_plugin_factory.py`、`test_llm_service.py` 与 `test_validation_service.py` 分别追加单一来源接线断言并完整保留既有用例；前端 8 项门禁（Vitest、构建脚本测试、Fake API 子进程测试、双浏览器 E2E 等）全数通过。
- **契约与界限**：契约见 [RF-10 LLM 静态元数据单一来源验证](./verification/cross-platform/RF-10-LLM-CATALOG.md)。本轮仅完成 LLM 静态元数据单一来源收敛（RF-10 子项）与 A49 遗留 P2 回退修复；STT/TTS 静态元数据收敛、多 Provider 并行拨测与总超时控制、设置服务重构仍待后续完成，整项保持未勾选，RF-10 持续推进。

## 2026-10-26 A51 / RF-09 AgentJobOrchestrator 生命周期边界实施

基于 TODO.md RF-09 与 MVP 重构方案 §RF09 规范完成本地实施。从 `agent.py` 的 `entrypoint` 中提取任务编排与生命周期管理逻辑至独立模块 `AgentJobOrchestrator`，负责连接、参与者等待、TranscriptSink 单实例管理与单一 shutdown callback 挂载、AgentSession 事件接线及启动异常安全收束；`agent.py` 保留 DB 配置查询、双轨策略路由、ProviderRegistry 插件集与 EchoTalkAgent 创建。

- **本地实现与接口契约**：新增 `backend/livekit_agent/job_orchestrator.py`，实现 `AgentJobOrchestrator(ctx, session_factory, sink_factory, send_error_fn, persist_assistant_fn)`；纯净编排职责，零反向 import agent、零 DB/config/凭据读取；每次任务独立实例化，各 Job 状态（session_id、is_custom、sink、agent_session）完全隔离；生命周期严格保证 safe session id 在 connect 前、原 session_id 在 wait_participant 后获取；连接/等待失败时尚无 Sink 实例；分配 Sink 后注册唯一 shutdown callback（`sink.close`）；调用外部 `setup_fn` 传入 `(session_id, sink)`，配置缺失/失败或插件异常安全退出并触发自有 Sink 关闭；模式读取时点不漂移（`set_custom_mode`）；接线 `conversation_item_added` 委托 assistant 转录持久化，`error` 运行时异常按分类断连；管线启动成功后 Sink 保持 accepting，管线启动失败或外部取消异常时安全向外传播并确保关闭自有 Sink。
- **生产接线与生命周期**：`agent.py` 的 `entrypoint` 委托 `AgentJobOrchestrator`，显式注入 `AgentSession`、`TranscriptSink`、`_send_error_and_disconnect` 与 `_persist_assistant_conversation_item`，保持既有测试 patch 路径完全生效；移除 `agent.py` 中未使用的 `asyncio`、`AutoSubscribe` 与 `ErrorEvent` 导入；原有 helper 与业务函数导出入口与逻辑逐项保持。
- **质量验证覆盖**：新增 `backend/tests/test_job_orchestrator.py`（8 项测试）覆盖完整成功生命周期与排空、两 Job 独立状态隔离与关闭互不影响、setup 失败安全退出与 Sink 关闭、start 启动失败双轨错误通知与 Sink 关闭、CancelledError 取消异常正常向上传播且任务收束、Sink 故障 `_on_sink_failure` 双轨安全错误码映射、assistant 事件接线及 entrypoint 真实委托 Orchestrator；全链路回归（A42 安全错误、A43 幂等、A44 Sink、A45 Resolver、A46 显式 Key、A48 ProviderRegistry）通过。
- **契约与界限**：契约见 [RF-09 AgentJobOrchestrator 生命周期边界验证](./verification/cross-platform/RF-09-JOB-ORCHESTRATOR.md)。本轮仅完成任务编排与生命周期边界解耦（RF-09 子项）；sys.path/dotenv 清理及真实 SDK/外部 Provider 联调仍待后续完成，整项保持未勾选，RF-09 持续推进。
