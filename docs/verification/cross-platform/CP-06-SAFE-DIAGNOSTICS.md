# CP-06 本地安全诊断一期验证

> 实施日期：2026-10-25
> 代码分支：`codex/cp06-safe-local-diagnostics`
> 对应任务：CP-06 补充按版本/平台关联的诊断信息（本地一期）

## 1. 契约与设计依据

基于 TODO.md CP-06“补充按版本/平台关联的诊断信息；验收：可定位 API、LiveKit、Agent 错误，不采集 Token、密钥或默认上传文档/对话正文”以及 `safe-diagnostics-a34-b-r0.md` 规范落地本地安全诊断一期。

当前客户端在遇到网络故障、HTTP 错误或 LiveKit/Agent 异常时，此前存在自由文本日志缺乏统一版本和平台标识、以及在 `agent_error` 时向控制台打印未经脱敏的外部 parsed 对象的缺陷。

本一期实施严格遵循以下原则：

1. **纯净白名单 record 结构**：
   - `schema_version`: 固定 `1`。
   - `app_version`: 来自 `apps/vite-app/package.json` 的 `version` 字段（本地静态导入）。
   - `platform`: 调用 `detectPlatform()` 获取已知集合（`"ios" | "android" | "macos" | "windows" | "web"`），检测失败或未知平台安全回退为 `"unknown"`。
   - `event`: 严格限制为 8 个冻结枚举之一。
   - `status`: 仅限 `api_http_failed` 事件，且必须为 `100..599` 范围内的安全整数；非法值或非此事件时不附加。
   - `agent_code`: 仅限 `agent_error_received` 事件，且必须命中 5 项白名单（`ERR_CUSTOM_KEY_INVALID`、`ERR_SESSION_NOT_FOUND`、`ERR_CUSTOM_RUNTIME_AUTH`、`ERR_CUSTOM_RUNTIME`、`ERR_SYSTEM_RUNTIME`）；其他任何值（包括敏感 token、恶意注入、未知字符串或非字符串）一律映射为 `"unknown"`，绝不原样回显。
2. **从零显式构造**：严禁对未知输入进行对象 spread 或“序列化后再正则脱敏”。
3. **零敏感信息泄露保证**：不输出 Error 实例/raw 对象/自由 message/URL/path/header/body/ID/账号/正文/用户或设备指纹。
4. **控制台级别映射**：
   - `lifecycle_audio_interrupted`: `console.warn`
   - `native_lifecycle_ready_timeout`: `console.warn`
   - `livekit_disconnected`: `console.log`
   - 其他（`api_network_failed`、`api_http_failed`、`agent_dispatch_failed`、`livekit_connection_failed`、`agent_error_received`）: `console.error`
5. **故障隔离**：helper 内部对平台检测、控制台 sink 等任何潜在异常实施完全的局部隔离，绝不影响或阻断原有产品业务逻辑和异常流程。成功 API 请求不增加任何日志。

## 2. 诊断接线与原语义保持

### 2.1 API 客户端 (`apps/vite-app/src/lib/api.ts`)

- **网络失败 (`api_network_failed`)**：仅在底层 `fetch` 真正 reject 时记录；原 Error 对象原样 rethrow；单次请求，不增加额外重试或请求延迟；auth 凭据获取失败不误转为网络错误。
- **HTTP 非 OK (`api_http_failed`)**：仅记录 HTTP 状态码，不输出响应 URL、路径、请求头或响应正文；原 401 认证会话失效顺序/代际、错误结构解析与 `ApiError.data` 完全保持原语义。
- **成功请求**：零诊断日志输出。成功读取响应 body 失败原行为保持，不创造不准确事件。

### 2.2 语音通话界面 (`apps/vite-app/src/components/conversation/VoiceInterface.tsx`)

替换原有的 6 处自由文本日志：

1. `lifecycle_audio_interrupted`: 替换原第 216 行 `console.warn`，保持同步停止音轨与 `failConnection`。
2. `native_lifecycle_ready_timeout`: 替换原第 268 行 `console.warn`，保持 10 秒超时门禁与安全退出。
3. `agent_dispatch_failed`: 替换原第 525 行 `console.error`，保持调度失败后的停止音轨与 `failDispatch`。
4. `livekit_connection_failed`: 替换原第 554 行 `console.error`，保持连接失败后的停止音轨与 `failConnection`。
5. `livekit_disconnected`: 替换原第 583 行 `console.log`，保持非主动断开后的停止音轨与状态流转。
6. `agent_error_received`: 替换原第 770 行 `console.error`。特别消除原先直接输出整个外部 `parsed` 对象的安全风险，仅将解析出的原始 code 传入 helper 进行白名单校验，绝不输出 message 或未脱敏 payload；原 `setAgentError` 状态更新与 UI 错误卡片渲染保持原样。

## 3. 验证与测试覆盖

1. **Helper 单元测试 (`diagnostics.test.ts`)**：
   - 严格字段集合验证：无多余键，无未知字段展开。
   - `app_version` 精确对应 `package.json` 版本号。
   - 平台检测及异常回退（各已知平台、未知平台、异常抛错均安全处理）。
   - 全部 8 项合法枚举及对应控制台分级输出验证。
   - 非法事件静默拒绝（返回 null，控制台零输出，不回显非法事件名）。
   - HTTP 状态码 100..599 边界校验及非整数/非法类型安全过滤。
   - `agent_code` 5 项白名单校验，敏感 token、恶意代码及超长字符串安全脱敏为 `"unknown"`。
   - 序列化 canary 缺失验证（URL/路径/token/密钥/正文均不泄露）。
   - 控制台 sink 异常隔离验证。
2. **API 回归测试 (`api.test.ts`)**：
   - 成功请求零日志。
   - HTTP 503 / 401 脱敏记录及原 `ApiError`、`data`、401 失效代际保持。
   - 网络失败单次请求、同 Error 对象原样抛出。
   - Auth 模块异常不误记为网络失败。
   - 控制台 sink 抛错不影响产品逻辑。
3. **VoiceInterface 真实入口回归 (`VoiceInterface.test.tsx`)**：
   - Mock Room `useDataChannel` 真实回调捕获，传入携带恶意 canary 与正文的 payload，验证发出脱敏安全 record，控制台绝无敏感数据，原 UI 与 store 状态正确更新。
   - 真实 `dispatchAgent` 失败入口触发 `agent_dispatch_failed` 且停止音轨。
   - 真实 `LiveKitRoom onError` 触发 `livekit_connection_failed` 且停止音轨。
   - 真实 `LiveKitRoom onDisconnected` 触发 `livekit_disconnected` 且停止音轨。
   - 原生后台中断与 10 秒超时真实触发 warn record。
4. **双浏览器端到端回归 (`e2e/diagnostics.spec.ts`)**：
   - 覆盖 Chromium 与 WebKit 双浏览器。
   - 模拟受控 HTTP 503 并注入带敏感 canary 的响应 body。
   - 验证控制台捕获到纯净安全的 `[diagnostic]` record，包含版本、平台、事件与状态码。
   - 验证全量控制台日志无 canary 敏感内容泄露。
   - 验证页面展示重试按钮，恢复 200 后点击重试成功恢复。
   - 验证 0 `pageerror` 及零 session/lease/token/dispatch 等非预期业务写操作。

## 4. 边界与后续

本阶段仅完成本地控制台结构化安全诊断一期建设。
未实现遥测上报服务端、未采集持久化文件/WebStorage、未增加设备指纹或用户追踪、未连接真实外部 Provider 或多物理端联调。
`TODO.md` 中的 CP-06 整体验收项继续保持未完成状态。

## 5. Codex 独立验收（2026-10-25）

APPROVED。40项独立探针通过：直接调用实际API request及组件注册的agent_error callback，严格核record全部键、版本/平台、未知事件/原型名拒绝、错误码白名单、status范围及不可读额外字段；原401按请求revision失效、Error对象/data与请求次数保持，console sink失败不替换业务错误。两个独立浏览器案例完整序列化console参数（补充产品E2E仅msg.text的显示边界），验证503精确record、敏感canary缺失、重试恢复、0pageerror和零写请求。

两项有效变异：移除Agent code白名单1项产品测试失败；恢复原raw DataChannel payload日志2项失败。备份finally逐字节和整树指纹恢复后完整8门禁通过：698 Vitest、18构建脚本、53 Fake API Node、140双浏览器，0skip；本轮专用PostgreSQL 269 pytest、73.72%覆盖率及Ruff通过，后端/迁移未改。未连接真实IdP/LiveKit/Provider或设备。

原拒权、用户新授权及ERROR交付流均保留本地证据，未把SUCCESS伴随拒权或ERROR流判通过；冷启动短交付完整后才进入正式评审。产品E2E console文本并非完整对象序列化证据，隐私结论以独立console参数与真实callback探针补全。既有UI仍接收原Agent message/code，本轮只限制诊断输出；未改变用户可见错误策略。三端真实关联验收未完成，本地console契约不要求未来新增遥测服务。
