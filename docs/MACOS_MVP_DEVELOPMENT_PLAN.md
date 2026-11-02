# macOS MVP 开发计划

> 规划基线：2026-11-01，`codex/macos-mvp-plan-20261101`，
> `396f392f4e10a8320f0820e4cfd8c52c64b4b0cb`。
> 本文是待独立 Review 的实施计划，不表示 macOS 产品、真实服务或分发已经验收。
> 任务状态继续由 [TODO](../TODO.md#三端交付计划web--macos--ios) 维护。

## 1. 结论与交付边界

沿用已定方向：独立 macOS 应用，优先 Tauri 2；共享 `apps/vite-app` 的 React、API、状态与业务页面，共用 FastAPI、LiveKit、Agent 和分析 Worker，保留 Web 与 Capacitor iOS。不再重新选择产品形态，不提前抽大型 shared-core，不把 RF-01～RF-12 全部完成当作桌面前置。

最短路径是 **M1 最小真实媒体与授权可行性 → M2 共享 UI、原生认证和构建 → M3 单端占用及中断安全 → M4 本地可用 `.app` → M5 可给他人安装的首版**。M1 只建可丢弃的极小探针；M1 未过，不搭完整正式桌面工程。认证、占用和生命周期直接影响共享客户端，必须分轮冻结接口、独立评审，再组合验收。

| 交付层次                  | 完成定义                                                                                                           | 不能替代的下一层                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 本地开发可用 `.app`（M4） | 在约定设备安装的开发/ad-hoc 包，系统浏览器登录后完成真实双向练习、结束、分析、报告；中断可解释、同账号显式接管通过 | 只证明开发者设备及测试环境；不表示 Gatekeeper、公证、他人安装或外部发布通过 |
| 他人可安装首版（M5）      | 同一候选包完成 Developer ID 签名、公证、渠道材料、另一台目标 Mac 的全新下载安装及真实闭环                          | Release candidate 通过仍须另行授权上传/发布；不等于商店上架                 |

推荐规划假设：首轮开发验证使用 Apple Silicon；首版先承诺 arm64，Intel/universal 暂不承诺。最低 OS 暂按 macOS 14 作为候选产品目标，不是已证明支持；M1 至少在实际主机测通，M4 必须补 macOS 14 的实体设备证据，否则将最低版本收窄到实际通过版本并明确告知用户，不能仅设置 `minimumSystemVersion=14.0` 就宣布兼容。主控只读观察为 arm64/macOS 27.0；本轮未自行检查宿主工具链或设备。渠道建议 Developer ID 直接下载的 `.dmg`，先不走 Mac App Store。芯片、OS 和渠道的最终确认时点见 §8。

### 用户主路径

1. 打开 `.app` → 登录按钮唤起系统浏览器 → 冷/暖回跳均回到同一应用，显示正确账号。
2. Dashboard 读取学习状态、历史/活动记录和设置；沿用当前 Provider/BYOK 权限及验证规则，不将 Provider 服务端密钥打包入应用。
3. 选择练习 → 能力发现 → 创建或显式恢复已有会话 → 占用确认；别端通话时提示冲突，由用户明确接管。
4. 用户确认采音并授权 → 真人语音到 Agent，Agent 语音在选定设备可听见；连接与失败状态可信。
5. 结束立即停止本地采音 → 服务端幂等结束 → 分析进度/失败重试 → 已有学习报告；重启后先认证并重新查询服务端。
6. DocTalk 共享文本粘贴/文件导入；系统文件选择不稳定时可先保留粘贴，明确文件导入限制，不阻断基本语音练习。

不纳入首版：后台持续通话、关闭窗口仍录音、离线 AI、跨设备无缝接力、Windows/Android、新分析指标、数字人、新周报、全局快捷键、菜单栏常驻、自动更新及 SDK 集体升级。现有报告能力直接复用，不顺带修复所有算法质量债务。

## 2. 依据与当前真实状态

### 2.1 本地依据及证据等级

- 架构与默认产品行为：[跨平台架构 §2/3/5/6](./CROSS_PLATFORM_ARCHITECTURE.md)，单账号与 Cloud 约束以[通话占用契约](./CROSS_PLATFORM_CALL_LEASE.md)为准。
- 认证、失效清理和中断分别遵守[认证生命周期](./CROSS_PLATFORM_AUTH_LIFECYCLE.md)、[连接失败](./CROSS_PLATFORM_CONNECTION_FAILURE.md)、[原生生命周期](./CROSS_PLATFORM_NATIVE_LIFECYCLE.md)。原生生命周期文件明确当前只实现 iOS，Tauri 走 Web 分支。
- [CP-03 记录](./verification/cross-platform/CP-03.md)是历史实验记录：arm64/macOS 27.0 下曾编译、开窗口并经用户确认短录音回放有声及结束释放音轨；不是本轮复测。
- 本轮只核明确路径：`/Users/sunpcm/code/EchoTalk/.review/worktrees/track-c/.review/spike/` 和本 lane 的 `.review/spike/` 均不存在。未读取旧 spike 源码、历史报告或评审探针。当前 tracked 源码未发现 `Cargo.toml` 或 `tauri.conf*`，正式桌面工程尚未建立。
- `TODO.md` CP-01～04 分项已包含 URL 隔离、本地认证/发现/恢复、占用 API/控制器等成果；相关 CP 大门禁仍未完成。TODO 中较早的“包装方案待定/比较候选”文字不推翻架构 §6 已定的独立应用/Tauri 优先决策。本计划只细化既定方向，不修改 TODO。
- RF 方案只用于界定债务范围；其旧基线中的 Mock 认证、占位 E2E 等描述不作为当前实现事实。没有找到按 PRD 命名的独立文件，本轮不据此新增产品口径，沿用已冻结架构/跨端契约和用户本轮范围。

“源码存在”“离线测试”“历史设备实验”“当前真实设备验收”“分发验收”必须分列。Fake API、平台探测分支和旧截图都不能计作 macOS 产品交付。

### 2.2 源码/契约复用矩阵

下表的“直接复用”指保留业务实现及契约，仍须在 macOS 集成验证，不代表现有代码无需任何接线。

| 能力                     | 真实路径与符号/契约                                                                                                                                                                                                                                                                                       | 分类与实施缺口                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享页面与视图           | `apps/vite-app/src/components/conversation/VoiceInterface.tsx`、`ActiveConversation.tsx`、`EndedConversation.tsx`、`ActiveSessions.tsx`；`store/conversationState.ts`                                                                                                                                     | 直接复用页面、状态模型和发现/显式恢复交互；加桌面窗口尺寸/键鼠验收，不复制页面到第二套 React 应用                                                                                                                          |
| API Transport 与类型     | `apps/vite-app/src/lib/api.ts` 的 `request`、`ApiRequestOptions`、`getSessionToken`、`dispatchAgent`；`apiRequestTimeout.ts`、`apiRequestHeaders.ts`、`api.generated.ts`                                                                                                                                  | 直接复用认证 revision、AbortSignal、超时、错误和类型；401 不自动重放写请求。schema/types 继续原生生成，禁止手改生成文件                                                                                                    |
| 地址与平台识别           | `apps/vite-app/src/platform/detection.ts` 的 `detectPlatform`；`url.ts` 的 `resolveApiBaseUrl`、`resolveLiveKitUrl`                                                                                                                                                                                       | URL 逻辑直接复用，Tauri 探测只识别环境。原生必须 HTTPS API/WSS，默认使用 Token `ws_url`；代理须从 API origin 构造，不能拿 WebView localhost                                                                                |
| 平台构建                 | `apps/vite-app/scripts/build.mjs` 的 `executeBuild`、`config-validator.mjs` 的 `ALLOWED_PLATFORMS`；`vite.config.ts`、根 `turbo.json`                                                                                                                                                                     | 薄适配；当前 allowlist 仅 `web/ios`，没有 macOS 构建脚本/产物。需新增 `macos`、独立 manifest/输出及 Tauri 校验；不能直接宣称 `build --platform macos` 已可用                                                               |
| 身份与清理               | `apps/vite-app/src/lib/auth.ts` 的 `AuthSnapshot`、`getAuthRevision`、`initializeAuthSnapshot`、`invalidateAuthSession`；`components/auth/AuthGate.tsx`、`lib/user-state.ts` 的 `clearUserSessionData`                                                                                                    | 精确 principal/revision 和清理语义直接复用；原生登录、冷启动事务、系统浏览器回调、Keychain、并发续期未实现。当前 `beginLogin` 为 `signinRedirect`，OIDC 用户存于 sessionStorage、关闭自动 silent renew，不能当原生认证方案 |
| 后端身份                 | `backend/auth.py` 的 `OIDCVerifier`；`backend/dependencies.py` 的 `get_current_user`；`backend/models/user.py` 的 `uq_users_auth_identity`                                                                                                                                                                | 直接复用 JWT/JWKS、issuer/audience 与 `(issuer, subject)` 映射；新增 native client 需核 pairwise sub、audience 和回调白名单，不按 email 合并用户                                                                           |
| 会话创建/结束/发现/恢复  | `backend/routers/sessions.py`、`backend/services/session_idempotency.py`、`session_queries.py`；前端 `lib/api.ts` 的 `createSession`、`listActiveSessions`、`endSession`；`store/conversation.ts` 的 `startSession`、`resumeSession`                                                                      | 直接复用服务端幂等/归属及当前 disabled 模式显式恢复。后端可选 `Idempotency-Key` 不等于前端已发送：当前 `createSession` 未加该头；保持无自动创建重试，若将来加恢复重试须另轮补同一意图键和冲突测试                          |
| 媒体与 Agent 调度        | `apps/vite-app/src/components/conversation/RoomSession.tsx` 的 `RoomSession`、`LiveKitRoom`、`RoomAudioRenderer`；`roomAudio.ts` 的 `stopRoomLocalTracks`；`useRoomAuthOwnership.ts`；后端 `sessions.py` 的 token/dispatch                                                                                | 共享逻辑直接复用，macOS 权限与物理媒体薄适配/待实测。当前 `dispatchAgent(sessionId)` 没有传 owner；不因已有可选 API 参数就宣称 Cloud 调度接线完成                                                                          |
| 单端占用                 | `backend/routers/call_capabilities.py`；`services/call_leases.py` 的 `claim_call_lease`、`heartbeat_call_lease`、`release_call_lease`、`revoke_cloud_participant`；前端 `lib/api.ts` 的 `claimCallLease/heartbeatCallLease/releaseCallLease`、`lib/callLeaseController.ts` 的 `createCallLeaseController` | 协议与独立控制器直接复用，通话接线/冲突 UI/显式接管未完成。`startSession/resumeSession` 当前只接受 `disabled`，Cloud 失败关闭；macOS 不能单独移除门禁或改变服务端默认模式                                                  |
| 生命周期                 | `platform/lifecycle.ts` 的 `LifecycleAdapter/createLifecycleAdapter`；`platform/webLifecycle.ts`；`store/conversation.ts` 的 `isNativeIos`、Room 中仅 iOS 的 pending 门禁                                                                                                                                 | 公共接口与所有权规则直接复用；macOS 原生 close、sleep/wake、设备变化未实现。当前 Tauri 返回 Web wrapper；新增适配后须同步检查两个 iOS 特判消费者，不能只改工厂就宣称 native readiness 已接入                               |
| 分析、设置和报告         | `store/assessment.ts` 的 `refreshAnalysis`、`hooks/usePollingAssessment.ts`；`store/settings.ts`；`components/settings/SettingsDrawer.tsx`；后端 `services/analysis_jobs.py`、`routers/user.py`                                                                                                           | 直接复用现有查询、重试、账号隔离及 Provider 校验；生命周期接入仍需验证，后台不新增重复轮询，不用客户端实现第二个分析 Worker                                                                                                |
| DocTalk 与诊断           | `components/doc-chat/DocUploadCard.tsx`、`DocChatSetup.tsx`；`lib/diagnostics.ts` 的 `logDiagnostic`；`backend/services/agent_prompt.py` 的 `build_dynamic_prompt`                                                                                                                                        | 文本/校验及脱敏诊断直接复用；先试 Web File API，必要时才加受限文件选择桥。当前允许 `.txt/.md/.markdown`、50,000 字符和 200,003 bytes；不改上传契约、不默认采集音频或正文                                                   |
| 桌面工程、安全存储、分发 | 当前不存在正式 Tauri 工程、native Keychain/OAuth 桥及签名流水线                                                                                                                                                                                                                                           | 未实现；M1 验证后在 M2 新建薄壳，M5 新建分发入口。iOS 工程和旧实验均不冒充 macOS 产品源码                                                                                                                                  |

## 3. 官方约束与待实测假设

以下公开链接来自主控 2026-11-01 核对并提供的 `handoff/official-notes-r0.md`。本实施节点没有独立联网核文档，也未运行 SDK/设备验证；具体 API 与兼容性还须绑定未来选定版本和锁文件。

| 官方依据                                                                                                                                                                                                                                                                         | 本计划吸收的约束                                                                                                                                                                                                                | 未来项目证据                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Tauri deep-link](https://v2.tauri.app/plugin/deep-linking/)                                                                                                                                                                                                                     | macOS 配置静态 scheme，不用动态 register；以 `getCurrent` 处理启动 URL、`onOpenUrl` 处理运行时 URL，合并去重。需打包并安装到 `/Applications` 验证，`tauri dev` 不替代冷暖回跳；页面当前最低 Rust 1.90，旧实验版本不是现有工具链 | 安装包冷启动、运行中、重复/迟到/伪造回调、取消及过期记录；不打印完整 code/state URL                       |
| [Tauri capabilities](https://v2.tauri.app/security/capabilities/)                                                                                                                                                                                                                | 仅 bundled 受信页面最小 IPC 权限；不向远端 IdP 页面开放 Keychain、Token 或任意 opener。IPC allowlist、CSP `connect-src` 和后端 CORS 是三个独立边界                                                                              | 非允许窗口/远端页面不能调用桥；真实 packaged origin 下 REST、OIDC、WSS 可达；精确 CORS 与 Header 预检通过 |
| [macOS app bundle](https://v2.tauri.app/distribute/macos-application-bundle/)                                                                                                                                                                                                    | `minimumSystemVersion` 可配置；框架默认 OS 不等于本应用音频支持下限                                                                                                                                                             | 候选最低 OS 实体设备上的权限、登录、双向媒体、生命周期及安装证据                                          |
| [ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/)、[Native OAuth / RFC 8252](https://www.rfc-editor.org/info/rfc8252/)                                                                                  | 公共原生 client 使用外部 user-agent 和 PKCE，不嵌 client secret。推荐先验证系统浏览器+静态 deep-link；ASWebAuthenticationSession 作为必要时的原生桥备选，目前未实现                                                             | `state/nonce/PKCE` 校验、一次消费、外部浏览器、冷启动事务恢复/过期清理；pairwise sub 同账号映射单独核实   |
| [麦克风用途描述](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)、[hardened runtime audio-input](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input) | 用途描述与 hardened runtime 音频输入 entitlement 分开配置；sandbox 的 microphone entitlement 又是另一项，不混为一项开关                                                                                                         | 实际 WKWebView/TCC 允许、拒绝、系统撤销后状态，以及选定签名配置下的双向媒体；配置存在不算通过             |
| [Tauri macOS 签名](https://v2.tauri.app/distribute/sign/macos/)、[分发](https://tauri.app/distribute/)                                                                                                                                                                           | 本地开发/ad-hoc `.app` 与 Developer ID 签名、公证、他人安装分层。直接下载是推荐渠道，不默认启用 App Sandbox，也不假定同一套 entitlement 适用于所有渠道                                                                          | M5 对最终签名包复验权限、Keychain、回跳和语音，附公证/安装结果；无需本轮读取签名身份或申请资源            |

### 3.1 原生认证及网络最小接口

未来在共享 `platform/` 定义小接口，例如 `NativeAuthAdapter`（初始化/登录/退出/令牌获取/快照订阅/释放）与 `CredentialStore`，维持现有 AuthSnapshot/principal/revision 对消费者的语义。它们是拟新增接口名，不是当前导出。Web 保留现有路径，macOS 通过适配器发布经过验证的身份与短期内存 Token，不能只调用 `setAccessTokenProvider` 而遗漏 AuthGate 状态、401 和退出清理。

授权事务必须在打开浏览器前保存，至少含 state、nonce、PKCE verifier、预期 issuer/client/redirect、过期时间和消费状态。verifier 及需要跨进程的敏感事务放 native 受保护存储；冷启动不能依赖 sessionStorage。启动 URL 与运行时事件先由原生入口接收，待 JS ready 后经有界队列交付，以事务 ID 单次消费。无事务/过期/取消/重复回调失败关闭；回调不得选择任意 issuer、redirect 或打开任意 URL。

推荐授权码交换和 refresh token 操作在 native 层完成，refresh token 留 Keychain，access token 短期传给共享 API 使用且只驻内存；不通过 IPC 提供任意 Keychain 读写。需验证 SDK 对 code/state/nonce/PKCE 及 ID token 的实际校验能力，不手写仅解码 JWT 的认证捷径。刷新采用单次并发协调及账号/操作代际；轮换安全写回后才发布新身份状态，失败受控退出。若 IdP 不提供 refresh token，可降级为到期后显式系统浏览器重新登录，不能降级为 Web Storage 保存长期凭据或嵌 secret。

原生交换可以避开 WebView 对 IdP token endpoint 的 CORS 依赖，但共享 API 仍是 WebView fetch：API 必须允许实际 dev/package origins 及 Authorization/租约头，CSP 允许明确 API、OIDC 所需 endpoint 和 WSS origin。媒体 ICE/TURN 与 WSS 分开验证；放宽 `connect-src` 或 REST CORS 不会自动修好 RTP/UDP。不得以关闭全局安全策略、通配原点或把所有 API 搬进任意 URL 的 native HTTP 代理解决接线问题。

## 4. 可证伪门禁及失败处理

| 分级                             | 必须证明/建议阈值                                                                                                                                                                    | 失败时处理                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| M1 硬阻断：采音和双向媒体        | 用户操作后允许采音；拒绝/撤销权限不假在线；真实 Agent 连续至少 5 分钟并完成至少 5 轮可听问答，双向实际有声；停止后音轨结束、系统采音指示停止。API 成功、WSS 连接、媒体上下行分别记证 | 不进入正式壳；定位 TCC/WKWebView、播放策略、CSP、ICE/TURN、Provider/Agent 各层，不把本地回放当双向通过                 |
| M1 硬阻断：原生认证              | 已安装 `.app` 的冷/暖回跳成功；取消、错 state/nonce、错 verifier、重复/过期回调不能登录；事务跨进程仍可校验                                                                          | 不把 dev token 或 WebView 登录作为替代交付；先核 IdP 与回跳设计，必要时验证 ASWebAuthenticationSession，再评估框架差异 |
| M3/M4 硬阻断：安全关闭及单端占用 | close/quit/断网/休眠/账号失效后不继续采音；20 秒心跳、90 秒租约遵守契约；旧 generation 不能取 Token、dispatch、release 新 owner 或抢回；真实 Cloud 撤销旧媒体并拒绝旧 Token 重连     | 保持 Cloud 不可用门禁或停止候选交付；disabled 只能标记为隔离开发探针，不可冒充“同账号单端首版”                         |
| 可降级：设备/恢复体验            | 耳机拔插/蓝牙切换不一定无缝，但必须安全停止并可由用户显式重选/恢复；网络或唤醒只刷新状态，不能自动采音                                                                               | 先交付中断提示和显式恢复，不用自动重连掩盖旧 owner/权限问题；若无法停止或找回可用输入输出，则是硬阻断                  |
| 可降级：登录续期/文件导入        | 没有 IdP refresh grant 时允许到期重登；原生文件选择不可用时保留粘贴                                                                                                                  | 写明限制；不能牺牲凭据安全、清理或文档大小/编码校验                                                                    |
| 后置                             | Intel/universal、后台通话、自动更新、商店、多窗口高级交互                                                                                                                            | 不阻断 arm64 前台练习；后续独立 lane、测试和发布决策                                                                   |

所有阈值是本计划建议的首轮验收下限，不是统计可靠性承诺；失败必须留设备、OS、包 hash、环境、步骤和实际现象。诊断只保留白名单版本/平台/阶段/错误码，不写 Token、身份正文、完整回调 URL、私有对话或原始音频。

## 5. 分阶段实施

### 命令状态与目录约定

本节所有原生命令均为**拟新增入口**，当前仓库没有，不能现在执行或报告通过。未来每轮 prompt 先明确绝对 lane、分支/HEAD、允许文件、证据目录及固定 `ev.sh`/受控 runner，入口由该 runner 调用。`<lane>` 是后续主控分配的工作目录占位，不能照抄为路径。

M1 建议仅在未来授权 lane 的 `.review/macos-probe/` 放独立极小 Cargo/Tauri 工程与锁文件、页面及测试，不扫描/恢复旧 spike，不触碰共享锁文件。新增的探针入口就位后，拟在 `<lane>/.review/macos-probe/` 使用 `pnpm run probe:test`、`pnpm run probe:build`、`pnpm run probe:install`；最后一个入口会写 `/Applications`，须显式授权、确认 bundle 身份及备份同名旧包后才运行。探针不成为产品架构依赖，M1 的有限 UI 仅用于验证。该 ignored 临时工程无论完成还是失败，都须将最小可复现源码、精确锁文件、工具版本、构建配置和源码 hash 归档到该轮指定证据目录，排除 `.env`、凭据及原始音频，避免临时源码丢失后无法复现。此为未来 M1 的归档要求，本轮未创建探针源码或上述归档产物。

M2 建议正式壳放 `apps/vite-app/src-tauri/`，同一 Vite app 共用入口；拟新增 `Cargo.toml/Cargo.lock`、`tauri.conf.json`、`capabilities/main.json`、`Info.plist`、`Entitlements.plist` 和 `src/{lib,auth,lifecycle}.rs`，按实际插件再补少量 native 源文件。共享端仅增加 `src/platform/` 的接口、macOS 实现及注册；原生依赖只在 macOS 装配时加载，不污染 Web/iOS 包。

M2 需先在 `apps/vite-app/package.json` 新增并落实 `dev:macos`、`build:macos`、`test:macos-bridge` 脚本。拟从 app 目录运行 `pnpm run dev:macos`、`pnpm run build:macos -- --mode development`、`pnpm run test:macos-bridge`；要求 build 同时负责前端 mode/manifest 校验和原生 `.app`，不能仅打静态 dist 就返回“桌面构建成功”。公开环境由主控提供，产物拟隔离到 `dist/macos/<mode>`；dev server 不沿用会自动加载根 dotenv 的默认 serve 路径，另设受控桌面入口。M5 再实现 `release:macos` 与 `verify:macos-release`，签名凭据由发布环境注入，不进仓库。

### M1：最小真实媒体与授权可行性（CP-03 补证）

**目标**：用少量按钮和状态显示排除 Tauri/WKWebView 的生死风险，而非先实现 Dashboard、设置或完整工程。复验 packaged `.app`，不能只测浏览器/开发 server。

**拟改范围/接口**：仅未来探针目录与 `docs/verification/cross-platform/CP-03.md` 的新增证据。探针通过既有 API 的 capabilities、session、token、dispatch/end 调用及已有 LiveKit JS 能力验证真实媒体；优先复用最小 API/URL 逻辑，探针可独立装配，不复制成第二套业务架构。极小原生桥验证系统浏览器、静态 scheme、回跳队列与受保护事务存储。初次媒体探针可用专用账号、单设备隔离环境的 disabled 模式；明确该结果不证明单端协议，M3 另验。

**顺序与依赖**：先盘点获准工具链及锁定版本；缺工具必须先获安装授权。媒体和授权探针可在同一最小壳分项实现，设备录音、应用安装、IdP 白名单、API/LiveKit/Provider/Agent 均需独立授权与可用测试环境；没有这些条件，保留 M1 阻断，可以先写离线测试，不能转而造完整壳。

**验收命令/可证伪标准**：新增入口后跑 `probe:test` 与 `probe:build`，保存真实退出码；按授权执行 `probe:install`，人工完成 §4 双向媒体和冷暖回跳；另测 API HTTPS、WSS 和 ICE/TURN，内建扬声器/麦克风、至少一副耳机、断网及一次休眠。拒绝麦克风、关闭窗口、取消登录后不得有采音或残留授权消费。probe:test/本地构建绿而真实问答或回跳失败，M1 仍不通过。

**回退**：保持现有 Web/iOS 与 backend 行为；保留最小复现与脱敏失败证据，不提升探针为正式工程。只有证明失败属于框架限制且无低成本修复时，才提出备选（ASWebAuthenticationSession/小型 native bridge，仍失败再评估其他独立桌面壳）；不无条件改 Electron 或将 Catalyst 当现成输出。

**工作量/不确定性**：3～5 人日；外部 IdP 配置、WebRTC/TCC/工具链兼容可能追加 2～5 人日，等待授权/设备/服务时间另计。

### M2：共享 UI、正式薄壳和安全认证（本地可测试工程）

**目标**：M1 通过后接入现有 React 全路径，在开发 `.app` 内显示同一账号数据，并完成安全登录/退出/过期处理；本阶段不标记整体产品可用。

**拟改范围/接口**：新增上述 `src-tauri/`；修改 `platform/`、`lib/auth.ts` 的平台装配、AuthGate 必要接线及 i18n；扩展 `scripts/build.mjs`、`config-validator.mjs`、构建隔离测试、`package.json` 和 `turbo.json`。若引入 Tauri JS/插件依赖，由单一依赖所有者在独立批准后原生更新 pnpm/Cargo 锁文件，不手写锁。沿用 §3.1 的接口、Keychain 和 refresh 单飞；生产包 fail-closed OIDC，禁止 dev token/开发 API。

**依赖/可并行**：依赖 M1 的权限/认证实测结论与接口冻结。构建隔离、安全存储、共享 auth 适配可按文件所有权分轮；多个 lane 不同时写 `auth.ts`、package/锁文件。CSP/IPC 和 API CORS 配置由对应所有者变更；不默改线上服务。

**验收命令/可证伪标准**：新增后运行 `test:macos-bridge`、`build:macos -- --mode development` 及 §6 frontend10/backend5；原生 Cargo 测试入口随工程新增，建议 `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline`（仅依赖已齐时适用，缺缓存如实阻断）。测试 state/nonce/verifier 错误、冷/暖一次消费、Keychain 锁定/写入失败、并发刷新、退出/新账号与旧请求迟到。同 principal 正常续期不得因 revision 变化误停健康 Room。以相同源码轮流构建 Web/iOS/macOS，manifest、输出及缓存互不串用；缺失/旧/错平台 manifest 必须在打包前拒绝。

**回退**：保留 Web 原有登录和 iOS 行为；macOS 适配不可用时显示能力不可用，不回退 WebView 内嵌 IdP、明文长期存储或宽松 CORS。构建扩展可独立回退，现有 web/ios 脚本不改默认语义。

**工作量/不确定性**：5～8 人日；安全 OIDC 客户端/native 插件选型和 IdP grant 差异是主要不确定性。若仅显式到期重登，减少 refresh 接线但不能删冷启动事务/安全存储边界。

### M3：共享占用流程、显式接管与 macOS 生命周期

**目标**：落实已定“同账号只允许一端通话”；原生窗口/网络/设备/睡眠中断不遗留采音，不自动争抢占用。这是首版硬门禁，不能留到签名后。

**拟改范围/接口**：复用 `createCallLeaseController` 和 API 原语，接入 `store/conversation.ts`、`conversationState.ts`、`RoomSession.tsx`、ActiveSessions/冲突提示与 i18n；新增 `platform/macosLifecycle.ts`（拟名）及 native 生命周期事件桥，并扩展 `LifecycleAdapter` 所需能力信息。将 store 和 Room 的 iOS 特判改为经过验证的能力/就绪判断，保留订阅后快照、原生 pending deadline、取消、迟到回调及当前 Room 停轨断言。不能只给 macOS 开 Cloud，而让同账号 Web/iOS 仍走旧协议。

**冻结的业务顺序**：认证与能力 → 显式开始/恢复意图 → health/创建或查询原会话 → `claim(takeover=false)` → owner 绑定的 token → 用户确认采音/连接 → owner 绑定且单次 dispatch。若 claim 冲突，显示当前用户冲突信息并等待明确 `takeover=true`；取消不得取 Token、dispatch 或采音。结束/退出/中断立即停止本地轨道并清内存 Token；租约 release/end 的网络结果分别展示，不假定本地关窗已结束服务端会话。end 已有服务端释放语义，不能并发发送互相竞争的 end/release；单一状态机协调，失败只允许同意图/同 tuple 显式重试。

**占用与恢复**：20 秒串行 heartbeat、90 秒 TTL 和到期 watchdog 沿现有契约；device UUID 只作非敏感安装标识，不用硬件指纹，存储/重装策略与原生适配一起冻结。失去占用立即停轨，旧 owner 不自动 claim；唤醒按当前时间核期限，不能等冻结 timer 补跑才判断。服务端先撤销旧 Cloud 媒体再授予新 generation，撤销失败不得乐观进入通话；本地超时不证明远端撤销。恢复顺序固定认证 → 能力/占用与会话 → 新 Token → 用户确认音频 → 查询分析，不重建原会话。

**生命周期策略**：首版 close 明确结束当前本地媒体并退出应用，不隐藏常驻采音；断网、休眠、系统 inactive/不可信状态安全关闭，重新可用时仅查询，显式恢复。耳机丢失或输入输出不可用时停止并提示重选，允许首版不无缝切换。正常窗口失焦和系统后台/休眠不同，具体 native 事件映射须实测，不把 DOM focus 当睡眠证据；事件缺失、native readiness 失败不得仍宣称原生能力。进程崩溃无法可靠发 release，以服务端租约与下一次显式接管收尾，不承诺 quit hook 永远执行。

**依赖/可并行**：M2 的 auth/revision 接口固定后，占用接线和 macOS native adapter 可分轮开发；共享 store/Room 最终串行组合。后端协议直接复用，只有出现经证实的协议缺口才另提契约/迁移，不借本计划扩后台范围。Cloud 正式启用前须所有后端/存量客户端升级、旧房间/Token 切换和 UTC 偏差不超过 5 秒等既定前提通过；测试环境启用与生产启用分开授权。

**验收命令/可证伪标准**：§6 完整 15 门禁、`test:macos-bridge`、`build:macos`，控制器/Room 合同覆盖 owner 头、默认不接管、显式确认、失败无重放、过期停轨、账号变更/代际和 listener/timer 清理。在真实 Web/macOS 双设备以及 iOS 相关版本上按账号竞争；验证旧 Token/旧 SDK 自动重连不能取回媒体、502 撤销失败不授新 owner，休眠超过 90 秒唤醒不采音。观察旧端麦克风/媒体实际停止；仅 DB 变更或模拟 RemoveParticipant 通过不算通过。

**回退**：保持默认 `CALL_LEASE_MODE=disabled`，不做本轮外部环境切换；开发探针可继续在隔离单设备条件验证，但 M4 的单端交付门禁保持未通过。已启用环境发生问题不能靠重新放宽认证/占用回滚；须由主控按旧 Token/房间及版本兼容方案回退。

**工作量/不确定性**：5～8 人日；Cloud 真实撤销、存量客户端协调及 macOS 睡眠/设备事件可能追加 2～4 人日。该工作是跨平台共有缺口，只实施一次共享流程，避免 macOS 私有分叉。

### M4：本地开发可用 `.app` 与完整设备闭环

**目标**：开发者可日常用本地包完成主路径，不依赖 Fake API、开发 server 或手工塞 Token；形成可审查的本地交付。

**拟改范围/接口**：前述 adapter/UI 的缺陷修复、`DocUploadCard.tsx` 必要兼容、桌面布局与 i18n、原生配置；新增 `docs/verification/cross-platform/MACOS-MVP.md`（拟名）记录包 hash、设备矩阵及已知限制。分析/设置/文件继续用既有 API，不增加桌面业务接口。普通窗口尺寸、键盘可达、恢复提示由共享 UI 调整实现，不为平台新建页面系统。

**依赖/可并行**：M1～M3 均过，真实 IdP、LiveKit Cloud、Provider/Agent 与 analysis-worker 可用；在稳定测试环境逐项执行。最低 OS 设备可提前准备，最终完整集成与回归串行；工具安装、录音、服务启动/修改不随本计划自动授权。

**验收命令/可证伪标准**：§6 完整门禁与新增 native tests；`build:macos -- --mode development` 输出实际 `.app`，安装后完成系统登录 → 创建/恢复 → 真实问答 → 结束 → 分析 → 报告 → 重启查询；验证错误 Provider、API 502、权限拒绝/撤销、账号切换、断网/睡眠/耳机和冲突/接管。重复运行至少 3 次基础闭环，包重启后不保留 LiveKit Token；检查没有重复创建/dispatch/分析任务或并行轮询，取消文件选择保留草稿、非法/空/超限文件有提示。验收当前主机和拟承诺最低 OS，离线/模拟 WebKit 不替代系统 WKWebView。

**回退**：保留上一个本地通过包、配置摘要和来源提交；新包失败可安装已知本地包恢复开发使用。安装覆盖前核 bundle identifier、路径/版本并备份；不删除未知 `/Applications` 内容。当前阶段不修改服务器契约或数据库，因此不产生隐藏迁移回退任务。

**工作量/不确定性**：2～4 人日；最低 OS/蓝牙硬件矩阵未到位时保持对应支持声明未验证，不用一台当前主机外推。

### M5：他人可安装首版与发布候选（CP-07 macOS）

**目标**：将 M4 的功能行为带到受信任分发包，另一台 Mac 的用户可自行安装并运行；晚期签名资源只阻断此阶段，不阻断本轮规划或 M1。

**拟改范围/接口**：原生 bundle/entitlements、受控发布 CI、新增 `scripts/release-macos.*`/`verify-macos-release.*`（拟名）及发布手册/版本说明。不把 Apple 身份/证书/公证凭据写入 Vite env、Git 或日志。Developer ID/hardened runtime 与可能的 sandbox 权限按最终渠道分开核；native Keychain 的应用身份/升级访问亦用最终签名包重测。

**依赖/可并行**：M4 通过；用户确认团队/Developer ID、分发渠道、arm64/最低 OS、隐私说明、下载位置及版本号。可以提前写无秘密编译 CI 和发布步骤，签名/申请/安装/发布需各自授权。CI 普通 PR 无发布密钥也能验证编译；签名凭据只在受控 release job 提供。

**验收命令/可证伪标准**：先实现 `pnpm run release:macos -- --mode production`、`pnpm run verify:macos-release`；后者对最终产物执行并记录 `codesign --verify --deep --strict --verbose=2`、`spctl --assess --type execute --verbose=2`、`xcrun stapler validate` 等适用检查的精确产物参数/退出码。具体签名、公证提交命令由发布手册按选定版本落实；本轮不调用、不枚举 Keychain 身份。实际从下载渠道在另一台干净 Mac 上保留 quarantine 安装，验证 Gatekeeper、首次权限、冷暖回跳、真实语音/退出、升级覆盖及回退。不能用关闭 Gatekeeper、移除 quarantine、仅本机签名成功或旧签名前媒体结果作为发布通过。

**回退**：保留上一签名公证包、校验和、发布说明和兼容 API；受控撤下失败候选/回指旧下载，用户数据继续在服务端，不提供隐式破坏性迁移。若凭据/Keychain 访问身份变化影响旧版回退，先记录受控重新登录路径并验收，不能承诺令牌无缝回滚。自动更新首版后置，避免额外更新信任链。

**工作量/不确定性**：2～4 人日，不含 Apple 账号/证书、公证排队及渠道资源等待。

### 进度估算与 RF 边界

基础实施合计约 17～29 人日，风险追加约 4～9 人日；是规划估算，不是完成承诺或历史耗时，设备/外部资源等待另计。每里程碑按独立可评审增量拆轮，M1、接口冻结、最终组合验收为关键依赖，不能把所有工作并行后相加压缩工期。

RF-04 的真实 CI、RF-07 的可复现依赖和 RF-11 的 Transport/state/type 门禁继续使用；RF-09/10 的 Agent/Provider 行为只按现有契约复用，出现真实阻断时单列修复。RF-05 基础设施清理、RF-06 模板债务、RF-08 数据债务和 RF-12 SDK 升级不整体插入桌面关键路径；具体完成状态看当前 TODO，历史 A 编号不代表桌面版本。桌面新依赖与 Cargo lock 是单独受控变更，不借 RF-12 升级现有 LiveKit/Provider SDK。

## 6. 分层验证与现有门禁保留

| 层次             | 何时执行                             | 合格证据与局限                                                                                                                        |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 文档/只读盘点    | 本轮                                 | 基线、真实源码符号、契约与来源检查；未运行业务树、原生构建、录音或真实服务。格式入口由主控停写后代跑，不计作实施节点自测              |
| 单测/契约/离线   | M1 探针完成后；M2 起每个共享代码轮次 | 新增 OAuth/桥/生命周期/占用回归；保留完整 Vite Vitest、Playwright 和 backend pytest。Mock 不证明物理媒体、TCC、真实 IdP 或 Cloud 撤销 |
| 原生构建         | M1 探针；M2 起正式工程每轮           | 绑定源码、Node/Rust/Tauri/SDK 锁文件与 OS/Xcode 的真实 build/test 退出码；只编译不计设备通过，离线缓存不足列阻断                      |
| 真实设备与服务   | M1 可行性；M3 占用；M4 完整本地包    | 专用账号、明确测试环境、安装包 hash、设备/OS、人工步骤和结果；IdP、API、WSS、ICE/TURN、Provider、Agent、Worker 各层状态可区分         |
| 签名、公证和分发 | M5                                   | 最终签名包检查、公证与全新下载安装、升级/回退记录；不等同已经发布                                                                     |

### 6.1 frontend10 + backend5

保留[评审手册 §2/§17.2](./agent-review-loop.md)的原完整门禁与数据库边界，不减少用例、放宽断言、增加 skip 或用缓存日志制造通过。前端为 Node 22/pnpm 10.26，后端 Python 3.12 与当前 lane 获准解释器；缺少环境或测试库绑定则阻断，不借另一 lane 可变环境。

未来从主控指定 `<lane>`，经该轮固定验收入口执行以下**现有命令/等价映射**；不是本轮执行清单：

| 门禁 ID                 | 工作目录        | 实际命令                                                                      |
| ----------------------- | --------------- | ----------------------------------------------------------------------------- |
| format                  | lane 根         | `pnpm format:check`                                                           |
| lint                    | lane 根         | `pnpm exec turbo run lint --force`                                            |
| typecheck               | lane 根         | `pnpm exec turbo run typecheck --force`                                       |
| test                    | `apps/vite-app` | `pnpm test`，真实 Vitest runner                                               |
| build-script-test       | `apps/vite-app` | `pnpm test:build`                                                             |
| fake-api-test           | `apps/vite-app` | `pnpm test:fake-api`                                                          |
| api-types-check         | `apps/vite-app` | `pnpm check:api-types`                                                        |
| api-types-test          | `apps/vite-app` | `pnpm test:api-types`                                                         |
| build                   | lane 根         | `pnpm exec turbo run build --force`                                           |
| e2e                     | `apps/vite-app` | `pnpm test:e2e`，按当前配置保留 Chromium/WebKit，端口与输出目录由固定入口隔离 |
| backend-format          | `backend`       | 获准解释器同环境的 `ruff format --check .`                                    |
| backend-lint            | `backend`       | 同环境 `ruff check .`                                                         |
| backend-test            | `backend`       | 同环境 `python -m pytest --cov=. --cov-report=term-missing`                   |
| schema-check            | `backend`       | 同环境 `python export_openapi.py --check`                                     |
| provider-metadata-check | `backend`       | 同环境 `python export_provider_metadata.py --check`                           |

backend coverage 以 `backend/pyproject.toml` 的 `fail_under = 59` 为原合同下限，不能以桌面任务为由调低，也不拿历史更高覆盖率替代当前 runner 结果。原库 helper 仅绑定 cp00，本规划 lane 没有后端测试授权：未来必须明确如何由主控在批准的源码/环境/专用库组合验证，不能将 cp00 的库/venv 直接指向任意新 worktree。数据库迁移非默认验收动作；发生真实 schema 变化时先审查、再授权专用库迁移。

M2/M3 涉及共享 auth/Room/store/platform 时，每轮编码交付保留全部 15 项，macOS 入口追加，不替换原门禁；M4/M5 集成及最终候选重新跑相关完整门禁与设备矩阵。仅文档轮次按本轮授权不运行业务树。原生/格式代跑的真实执行结果由主控单列；主节点声明预检、实施节点自报停写和真实工具退出分别记录，任何一个都不能替代另一个。

## 7. 实施治理与交付材料

每轮 prompt 只给一个明确增量：核对绝对 lane、分支、HEAD 和初始状态；文件 allowlist、接口与验收入口同时冻结。共享 auth/Room/store、锁文件、schema 生成及服务配置各有单一写入所有者，不能以多 lane 并行绕过互斥。新工程与依赖安装、录音、`/Applications` 写入、外部 IdP/Cloud 配置、签名与发布分别确认授权，普通资料不足由实施节点在可读范围内解决。

交付报告至少列源码/测试改动、原始命令退出码、门禁结果、设备/包 hash、未验证项和回退边界；停在 Review，不 commit/push/merge。主控独立检查 diff、测试树及最终字节后给 APPROVED/CHANGES REQUESTED。规划批准不自动派发 M1 或恢复 A85、历史自动任务；本轮仅允许写本文及指定报告目录，日志/Notion 交由主控后续按授权处理。

## 8. 仍需用户决策与外部条件

独立应用、Tauri 优先、共用 React/后端、保留 Web/iOS、前台练习和同账号显式接管均已确定，不再次提问。下表为后续阶段才需确认的范围；目录布局、脚本命名和常规实现细节按本计划推荐推进，由主控在具体 prompt 冻结。

| 待确认/外部条件              | 推荐与取舍                                                                                                                                                                                                  | 阻断时点                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 首版芯片覆盖                 | arm64 优先，降低打包/硬件验证成本；有明确 Intel 用户再加 x86_64/universal 及设备矩阵                                                                                                                        | 最迟 M2 构建目标冻结前；不阻断本轮规划，M1 可先用已有 arm64 主机   |
| 最低 macOS                   | 暂以 14 为候选，必须拿到设备证明；没有设备就收窄支持范围，不能仅沿框架默认值                                                                                                                                | M4 支持声明；M1 先验证当前主机，不宣称覆盖旧系统                   |
| 可用测试账号/IdP 原生 client | public client、PKCE、静态回跳白名单，核 audience 和 pairwise sub；优先沿现有账户体系，不按 email 自动合并                                                                                                   | M1 真实登录门禁；凭据由主控/用户安全提供，不写计划或交付报告       |
| 真实媒体/占用环境            | 专用 LiveKit Cloud、Provider/Agent/Worker；先隔离验证，再按契约准备存量升级和时钟前提                                                                                                                       | M1 媒体与 M3 严格接管；离线工作可继续，相应阶段不标通过            |
| 录音、应用安装和工具链授权   | 用户主动短时实测需明确同意并使用专用测试环境；不额外落盘原始音频或上传诊断音频，真实语音仍经已授权 LiveKit/Provider 实时传输，不将无额外音频落盘等同于无音频外传；安装/覆盖前确认路径和备份；缺依赖另行授权 | M1 对应动作前；本轮不安装、不录音、不启动或连接服务                |
| 渠道及签名身份               | Developer ID + 公证的直接下载 `.dmg`；团队/费用/账号资源由用户确定，Mac App Store 后置                                                                                                                      | M5；不是本轮规划或媒体可行性的阻断                                 |
| 没有 refresh grant 时的体验  | 首版允许过期显式重登，降低 IdP 改造范围；仍保留 Keychain/冷启动事务和退出清理                                                                                                                               | M2 认证验收；若用户要求无感续期，需先具备 IdP grant 与安全轮换验证 |

当前最大交付风险是将“壳编译通过”误认为“原生登录和真实通话已完成”，以及将现成占用原语误认为共享通话链已支持 Cloud。M1 尽早证伪平台可行性，M3 一次补齐共享接线，能避免在签名与 UI 完工后才发现关键缺口。
