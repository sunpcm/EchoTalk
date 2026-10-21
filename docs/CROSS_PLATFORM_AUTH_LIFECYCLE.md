# CP-04 本地认证状态与账号清理契约（2026-10-21）

## 1. 本轮范围

真实测试环境尚未准备好，先修复共享客户端可独立验证的认证事件竞态、账号切换清理、迟到数据回填及401受控退出。不实现真实IdP配置、原生系统认证/Keychain、自动续期、跨客户端账号关联或外部环境验收，不新增依赖/锁/存储。保留OIDC Code+PKCE与显式dev边界，不能因本轮通过而宣称CP04整体完成。

## 2. 认证快照和初始化

新增`AuthPrincipal {issuer:string, subject:string}`及`AuthSnapshot {state:AuthState, principal:AuthPrincipal|null}`；authenticated必须有principal，其余principal为null。OIDC身份只取现有oidc-client-ts已验证User.profile的非空iss/sub，不能靠email或自行解码access_token识别账号；按原始issuer/subject精确比较，内部键可用JSON数组编码，禁止歧义拼接。缺身份或配置不全受控失败；过期/退出匿名。显式DEV Token使用固定仅本地dev principal，不扩大production认证。

新增`initializeAuthSnapshot()`、`subscribeAuthSnapshot(listener)`；保留现有`initializeAuth():Promise<AuthState>`、`subscribeAuth(listener)`、token provider/getAccessToken/登录退出导出兼容。Auth模块不导入store或API，避免auth→store→api→auth循环。可以另建`lib/user-state.ts`集中清理，由AuthGate调用。

认证事件单调revision；新增`getAuthRevision()`供请求绑定，`invalidateAuthSession(expectedRevision)`只使当前匹配revision失效。初始化异步结果/异常若已被较新的认证事件或初始化操作超越，不能回写当前快照或恢复私有视图。取消订阅后不再更新。必须覆盖StrictMode重挂载，避免重复监听及旧初始化污染。初始化与事件身份快照均不能含access_token或刷新凭据，不新增日志里的身份/Token。

## 3. AuthGate和清理

登录失效、退出、初始化终止错误或principal改变时，同步清理conversation（goHome使A3代际失效及清空Token）、settings、assessment的用户数据/错误及在途归属；卸载旧App让A3停止owned tracks。两个不同principal即使状态都authenticated，也必须清理并用账号代际key重挂载children，使组件内草稿等内存不跨账号。仅同principal的UserLoaded/Token更新应保留当前会话和数据，不因正常续期自动断音频。清理不创建/结束服务端会话、不自动claim或dispatch。

可保留本机非敏感theme偏好；但清理/新App挂载不能把上一账号设置或主题自动写入新账号。App启动只应用主题样式，不能通过setTheme触发后台PUT；用户主动选择主题仍保留既有同步。后端新账号设置返回后按原逻辑水合。没有principal时不得挂载私有children。Gate真正卸载也须清理；重复清理幂等，不能把StrictMode旧初始化结果当新登录。

## 4. Store归属与迟到响应

settings.reset与assessment.reset必须递增独立操作代际（不重置成0），保留现有公共调用兼容。所有async成功、失败及finally写入都先确认仍属当前代际；settings.fetch/update、主题防抖的发送与回填、assessment.refreshAnalysis两阶段(status→并行结果)、retryFailedAnalysis、fetchKnowledgeStates均覆盖。旧请求不能覆盖新账号数据/loading/error/theme/localStorage/DOM；reset后新请求不被旧完成状态关闭。过期settings保存返回非成功结果，不能误导新UI成功；不自动重放请求。主题防抖需取消并防止旧任务用新账号Token发送。

A3 conversation仍使用既有sessionGen，不复制新一套会话状态机；账号清理必须使旧health/create/token/end和Room回调失效。当前Hook轮询取消及账号子树重挂载共同阻止旧分析重新触发。

## 5. 401及请求竞态

request在等待getAccessToken前捕获auth revision；等待期间revision变化则在fetch之前中止（明确的本地登录状态变化错误，走i18n），不能用新账号凭据发送旧意图。HTTP401只调用与本次请求绑定的invalidateAuthSession，不影响后来新principal或新Token事件，随后仍抛既有ApiError(401)。同revision连续401幂等失效；不得自动重放POST/其他请求或自动重连音频。

失效需立即发布匿名/受控失败并停止继续取得旧SDK Token，然后清理SDK User；本地清理失败也不能重新暴露旧Token。正常手动重新登录/新的已验证UserLoaded才恢复。dev Token失效可显示配置错误，不伪装真实OIDC登录成功。保留setAccessTokenProvider测试接缝和restore语义；API状态码/错误解析及现有请求格式保持，不顺带重写客户端或续期机制。

## 6. 必须测试

模拟SDK/认证事件及deferred响应，不访问真实IdP/Provider：旧initialize成功/失败晚于退出/新登录、StrictMode订阅清理；失效后全部用户store及音频所有权清理；同principal更新不清理，不同principal直接切换清理并重挂载草稿；settings fetch/update/theme、assessment status/结果/retry/knowledge迟到成功与失败均不能回填；新代际在途不被旧finally覆盖；401只影响原revision（旧请求401不退出新登录）、取Token期间换身份不发送fetch、401不重放写请求；启动主题只读且主动选主题仍同步。产品回归必须能杀死清理/代际/revision门禁移除变异。常规前端测试、格式/lint/类型/双构建、Chromium/FakeAPI E2E仍必跑，真实原生/IdP与WebKit分别记录未验证项。
