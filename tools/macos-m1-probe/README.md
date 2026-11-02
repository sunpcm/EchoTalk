# macOS M1 离线探针

本目录是可丢弃的 Node 22 离线可执行探针，不是桌面应用。只验证 OAuth 事务协调和媒体资源所有权假设；没有 Tauri、WKWebView、系统浏览器、Keychain、真实 JWT 校验、API 或 LiveKit 实现。测试替身只在 `test/` 定义。源码版本化不代表 M1 设备门禁通过。

## 运行

无需安装第三方依赖，不读取 `.env`，不启动服务。当前机器的精确入口：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-20261101/tools/macos-m1-probe
PATH=/Users/sunpcm/.nvm/versions/node/v22.13.1/bin:/usr/bin:/bin \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/npm run probe:test
```

`probe:test` 真实执行 `node --test --test-timeout=5000 test/*.test.mjs`；每个用例有 5 秒上限，失败退出非零。交付验收必须再套主控指定的 `ev.sh` 记录真实退出码。没有 `probe:build`、`probe:install` 或正式 native 入口，它们未实现，不能声称构建/安装通过。本 package 没有第三方依赖，也没有独立 lock：没有进行安装或手写锁文件；归档绑定仓库现有 `pnpm-lock.yaml`，未来引入 Tauri 必须经授权原生生成精确 Cargo/JS 锁。

## 模块与调用顺序

| 模块            | 职责                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `bootstrap.mjs` | 验证显式公开配置、复制冻结 allowlist、检查必需 ports，返回 auth/media |
| `auth.mjs`      | 标准库 CSPRNG/S256 PKCE；事务保存、回跳匹配/消费、取消和代际门禁      |
| `media.mjs`     | 显式开始/恢复，短期资源 lease 归属，中断停轨和迟到资源清理            |
| `ports.mjs`     | 统一静态错误与必需方法检查；不含任何系统能力实现                      |
| `test/`         | 内存事务存储、可计数资源与可手动完成的 Promise，全部是测试替身        |

外部调用只经 `bootstrap(publicConfig, { auth, media })` 装配；底层工厂导出用于离线测试，要求传入已验证配置，不作为 IPC。无配置、缺 port 时立即拒绝，既不连接真实环境也不降级为 mock。装配本身不打开浏览器、不采音。`createAuthProbe` 的可注入时钟仅用于测试边界；实际装配使用系统时间。

公开配置必须显式提供 `apiOrigin`、非空 `mediaOrigins`，以及 auth 的 `issuer/clientId/authorizationEndpoint/tokenEndpoint/redirectUri/transactionTtlMs`。API 为精确 HTTPS origin；媒体为精确 WSS origin allowlist，连接路径采用 API 返回的 `wsUrl`。认证 endpoint 在该小探针里限制为与 issuer 同 origin 的 HTTPS URL（无 query/hash/凭据），redirect 为无 query/hash/凭据的固定 custom-scheme URL，事务 TTL 为 1～600 秒。这里没有默认服务地址或 dev token；`example.test` 只存在测试 fixture。未来 IdP 如需要跨 origin endpoint，须另审 metadata/pinning 规则，不在 native 桥接受任意 URL。

### 认证 port

1. `auth.begin()` 创建互相独立的 state/nonce/verifier，使用 `node:crypto` 随机数及 S256。
2. `transactions.save(record)` 成功后才调用 `openAuthorization(url, {signal})`。保存项绑定 issuer/client/redirect/创建及过期时间；浏览器 URL 含 challenge，不含 verifier。
3. 冷/暖入口统一调用 `handleCallback(rawUrl)`。先精确比较 redirect 字节及参数唯一性，核可选 `iss`，拒绝错 state、额外参数、code/error 歧义和 fragment；不输出原始 URL。暖回跳等待未完成的保存；冷回跳从受保护存储恢复。
4. `transactions.consume(state)` 必须跨入口/进程原子地先删除再返回，保证只交换一次；探针再次核事务绑定和期限。provider denial 也消费，不交换。不能用普通异步 get→delete 代替此原子 port。
5. `exchangeCode({code, verifier, issuer, clientId, redirectUri, tokenEndpoint, signal})` 返回临时 token bundle；`validateIdentity({tokens, nonce, issuer, clientId, signal})` 必须完成真实性校验才返回 `{issuer, subject}`。探针只发布 principal，随后同步 `discardTokens(tokens)`；它不建立持久登录态，也不实现 refresh 或共享 AuthGate 接线。
6. `cancel()` 立即废弃本地代际/AbortSignal、销毁已取得的 token，再等待正在保存的事务完成后 `revoke(state)`；取消完成才代表持久撤销已确认。迟到交换/验证结果不能登录，迟到 token 仍销毁。失败路径也先销毁 token 再等待撤销，避免存储缓慢延迟凭据清理。`close()` 永久禁止新登录和回跳。

r1 修正 opener 与回跳并行的失败路径：即使身份校验仍等待中，opener 失败也立即废弃该操作并销毁已到手 token，再等待持久撤销；清理抛错会锁住控制器，不重复销毁，也不发布迟到身份。成功路径在同步 token 清理回调后再次检查操作有效性，避免清理中发生取消/关闭后仍返回已认证。所有清理只指向所属操作，不清理新登录的 token。

生产 port **本轮均未实现**：

| port                | 未来 Tauri 2/native 责任                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `transactions`      | 受保护持久存储、唯一插入、原子消费、幂等撤销和过期清理；verifier 不放 Web Storage；错误必须拒绝读写            |
| `openAuthorization` | 固定授权入口的系统浏览器/必要时系统认证会话；遵守取消 signal；不能提供任意 URL opener                          |
| `exchangeCode`      | public client Code+PKCE 交换，固定端点，无 client secret；取消/失败时内部未返回的 token 也须由 native 自行销毁 |
| `validateIdentity`  | 成熟 OIDC/JWT 实现验证签名、可信 JWKS、issuer、audience/azp、期限和 nonce；仅解码 JWT 不合格                   |
| `discardTokens`     | 同步销毁临时 token；长期 refresh 留应用限定 Keychain，未来另轮实现单飞轮换/安全发布，不提供任意 Keychain 读写  |

测试中的内存存储不能证明跨进程/掉电原子性，假 `validateIdentity` 不能证明 nonce、PKCE 或 JWT 的 IdP 端校验。存储撤销/凭据清理失败会锁住当前控制器；跨重启安全仍依赖生产 store 的事务及失败关闭保证。失败信息只返回固定错误码，不透传 native 错误文本。已消费事务在后续失败时不恢复，因此不会自动重试交换。

### 媒体 port

`media.start({intent: "start" | "resume", userConfirmed: true})` 才可执行：

1. `prepare({intent, apiOrigin, signal})` → `{token, wsUrl, dispose()}`。未来适配现有认证/能力/会话/Token 合同；无 API 业务实现，无自动创建/dispatch/接管。返回地址需通过 WSS allowlist，失败不请求麦克风。
2. `acquireMicrophone({signal})` → 独占麦克风 lease；由用户真实权限决定。
3. `connect({access, microphone, signal})` → 独占连接 lease，必须禁止自动重连。连接完成立即销毁临时 access lease。
4. `stop()` / `close()` / `interrupt("offline" | "sleep" | "inactive" | "device_lost" | "auth_invalid")` 立即取消操作，先停本地麦克风，再释放连接和临时 Token。关闭永久拒绝启动。中断后必须 `ready()`，再由用户显式开始/恢复；`ready()` 不采音、不重连。

状态为 `waiting → connecting → connected`，停止同步经过 `stopping → waiting/closed`，失败进入 `failed`。snapshot 只含状态和固定原因，不含 Token、URL 或用户内容。无自动恢复、定时器、后台采音或重连循环。

所有 lease 的 `dispose()` 必须同步且可安全调用，停止本地音轨/重连并清除临时凭据。native/SDK 的异步网络断开应在 lease 内另行跟踪，不能先等待网络才停本地轨；探针不宣称本地释放等于服务端 `end/release` 成功。每次操作及每个返回 lease 必须独占，旧 disposer 不得操作全局“当前 Room”。port 在尚未返回 lease 时就获取到的内部资源，也须自行在 AbortSignal/异常下清理。

取消后才 resolve 的麦克风/连接/access 仍被逐个 dispose，旧操作不会覆盖新状态。若任何清理抛错或返回没有 dispose 的非法资源，探针尝试其余清理并锁住重启；旧迟到资源清理失败会同时停新会话，以免在旧采音无法确认关闭时继续录音。这是 fail-closed，不是系统已经清理成功的证明。

r1 在每次资源 await 返回后和最终 access 同步清理后重新核对所属操作；若清理触发 sleep/stop/close 或替代操作，旧 start 拒绝而非虚报 connected。停止/失败释放资源后的状态写入同时核对当前操作和回调前 snapshot，保留清理回调产生的生命周期状态及新会话状态。

## 未来 Tauri 安全接线

本轮没有 native 注册、窗口、IPC capability、CSP/CORS 配置或生命周期订阅。未来必须将逻辑迁移/适配到 native 可信边界：`node:crypto` 不能直接放进 WKWebView，随机数/事务/交换应由 Rust 或明确 native auth 实现持有。不要把本探针作为共享业务的新依赖。

- 只允许 bundled 受信窗口调用有限的登录/取消/状态命令；校验窗口、origin、参数和操作代际。远端 IdP 页面不能获得桥权限，任意 callback URL 不应由不受信页面主动注入。
- native 接收冷启动启动 URL 和暖事件，待 JS ready 后经有界队列合并；只传固定回调给同一 broker/原子 store。安装包的 static scheme 注册及冷暖事件必须单独实测，不能用本地函数调用替代。
- Keychain 按应用固定 service/account 封装，只提供业务所需操作；不得给 JS 任意读写或枚举身份的能力。code/verifier/token 和完整 callback URL 不进入日志或诊断。
- IPC allowlist、CSP `connect-src`、REST CORS/Authorization/租约头预检各自验证；WSS 与 ICE/TURN 分开验。不引入任意 URL 的 native HTTP 代理。
- 系统 close/sleep/网络及设备事件映射到相应 interrupt；正常窗口失焦不能伪装成系统休眠。未来订阅必须有取消/释放句柄及 ready 验证；这里不宣称已经收到系统事件。
- 业务侧仍复用现有 API/LiveKit/Cloud 占用契约，默认 Cloud 不可用门禁保持；不复制 React 或 backend，也不提前建 shared-core。

## 验证与下一授权

本轮测试断言实际 opener/exchange 调用、原子替身消费、实际资源句柄 dispose 计数/Token 清除、迟到结果与新操作隔离及失败副作用。它们证明本目录离线协调逻辑，不能替代原生系统、物理媒体或真实服务。

见 [离线验证记录](../../docs/verification/cross-platform/MACOS-M1-OFFLINE.md)。真实 M1 仍需专用 API/IdP/LiveKit/Provider/Agent 环境、固定 native 依赖/缓存及单独的安装/录音授权；packaged `.app` 冷暖登录、至少 5 分钟/5 轮可听双向对话、TCC 拒绝/撤销、耳机、断网/休眠及 ICE/TURN 均未运行。后续共享业务增量保留 frontend10/backend5 与 backend 59% 下限。本轮按明确范围不运行业务 15 门禁，不标为通过。

归档时将本目录源码/测试、验证文档、现有仓库 lock 及 formatter 配置打包到指定 implementer 证据目录，生成逐文件 SHA256 和工具版本记录。无音频、dotenv、凭据、私有评审材料或第三方包进入归档。
