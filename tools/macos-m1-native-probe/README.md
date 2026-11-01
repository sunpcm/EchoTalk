# macOS M1 原生认证探针

可丢弃的独立 Tauri 2 探针，仅验证系统浏览器 OIDC 授权及冷暖回跳，不接共享业务或媒体。
截至 r4，主控已独立验证 r3 最终源码的 Node 86/86、原 offline 70/70、真实 Rust 23/23 及 arm64 `.app` 构建通过，并在已安装包中确认正文、登录按钮和 IPC 状态正常，完成真实冷暖登录、取消、迟到回跳拒绝及再次登录。r4 仅收口文档和归档，实施节点没有重跑测试或操作系统；交付停在 Review，不代表 M1 整体验收通过。

## 认证入口与边界

- 唯一 `main` 窗口从固定配置创建，只允许bundled `tauri://localhost`（空path）、`tauri://localhost/` 或 `tauri://localhost/index.html`；origin、窗口、无userinfo/port/query/fragment限制同时生效。
- 静态模块脚本只调用 `auth_begin`、`auth_cancel`、`auth_status`，均传 `{}`；native 同时核实际窗口 label、当前 URL 及空参数。ACL 仅授予这三项本地命令，无 remote、插件、shell/fs/http/opener/Keychain IPC 权限。
- CSP 的 script/style 仅 self；connect 只含 Tauri IPC 的 `ipc:`、`http://ipc.localhost`，没有 IdP/API 外网 fetch。所有 OIDC 请求在 native 进行。
- 只由 native 校验完整授权 URL 后通过固定 `/usr/bin/open`、单个 URL 参数启动系统浏览器；无 shell 拼接和任意 URL 命令。该子进程最多等待三秒，输出丢弃。
- `Info.plist` 与 deep-link 插件冻结 `echotalk-m1://oauth/callback`。暖 `on_open_url` 先注册，再读冷 `get_current`；二者进入容量 8 的 native 队列，单 worker 消费，不向 JS 发送 URL。队列满则拒收，不创建无限线程。
- 固定 bundle ID 的 app-local-data 目录仅放一个无秘密 `auth-process.lock`，进程生命周期持有非阻塞排他锁，避免同一 Keychain account 出现多个写者；锁文件永不 unlink。此为内置实例保护，不是文件系统 IPC。

## 公有配置

唯一输入 `src-tauri/public-config.json` 编译进二进制，不读 env、dotenv 或 IPC 配置。严格 schema：

```json
{
  "version": 1,
  "oidc": null
}
```

`null` 关闭认证且不访问 Keychain/浏览器/HTTP。非 null 时只允许 `issuer`、`client_id`、`redirect_uri`、`authorization_endpoint`、`token_endpoint`、`jwks_uri` 六项。端点必须规范 HTTPS URL，不含用户信息、query、fragment、百分号或反斜线；redirect 必须是上述固定值。缺文件构建失败；无效文件由入口拒绝，绕入口构建时 native 解析仍失败关闭。未知字段、重复字段不能变成环境覆盖。

本候选使用主控 r0b 公有文件提供的本机 Keycloak：`https://localhost:19444/realms/echotalk-m1`，client `echotalk-m1-native`；替代 r0a Dex。这是隔离验收配置，不承诺临时服务持续运行；主控正在独立清理环境。reqwest 使用 macOS native TLS 正常信任链，不内置 CA、不禁 TLS、不继承代理。本节点没有操作服务/证书、读取私有日志或自行复验系统环境。

主控提供的真实浏览器验证中，Chrome 曾在 macOS 证书校验通过时仍报 `ERR_CERT_AUTHORITY_INVALID`；证书信任记录的 hostname `policyString` 与 Chromium 公开源码行为不兼容。经用户明确批准，主控备份并调整同一两天有效、`CA:FALSE`、SAN 仅 localhost/127.0.0.1 的叶证书在用户登录钥匙串中的 SSL 信任记录，去掉该额外字段，保留正常主机名校验。localhost/127.0.0.1 成功、example.invalid 明确主机名不匹配，默认 Chrome 正常显示 discovery 与登录页，未越过警告。此为临时测试环境策略；仍待主控精确撤销并另交清理回执，不作为永久全局信任。

## 事务和凭据

事务 TTL 300 秒。native 安全随机生成 32-byte state/nonce 和 PKCE S256 verifier；发现完成后，在打开浏览器前保存到唯一 Keychain 项：service `org.echotalk.m1nativeprobe.auth`、account `pending-auth-v1`。事务包含完整公有绑定、绝对期限、创建时间及代际。Keychain 写入失败禁止打开浏览器。

两种回跳均经同一状态机：严格检查参数和固定回调地址、constant-time state、期限及配置；错 state 保留有效新事务。只有成功删除匹配项后才可兑换，ItemNotFound 不算成功。并发/重复回跳不重复兑换。取消/退出先推进代际并清掉 native session，再撤销持久事务；旧发现/交换的成功或失败均不能发布身份或触碰新事务。存储失败进入 blocked，显式取消成功后可恢复。等待事务过期后，下一次显式登录可替换旧项。

r1 修正 Keycloak 标准回跳字段兼容：仅增加可选 `session_state`，解码后须为 1～256 bytes 的 ASCII 字母、数字或 `-_.~`。验证后直接丢弃，不写事务/状态、不传 JS、不参与身份或 issuer 选择。重复字段、空值、超长、控制字符、非允许字符及其他未知参数仍拒绝。回归使用主控独立观察到的 `code/iss/session_state/state` 字段组合与合成值，测试真实控制器的冷暖成功、坏值不消费、重复/重放及错 state 保留新事务；已纳入主控独立通过的 Rust 23 项。

`openidconnect =4.1.0` 负责 discovery、签名/JWKS、issuer/audience、nonce 和 expiry 校验；应用补 `azp` 与 `at_hash` 检查。HTTP 仅允许冻结的 discovery/JWKS GET、token POST，禁止 redirect；connect timeout 3 秒、单请求 timeout 10 秒、响应最多 256 KiB。discovery 返回端点也须逐项匹配公有配置，不能根据回调选择 issuer。

r1 候选经主控 locked/offline 编译实际 exit101（E0521），未运行Rust测试：授权 URL 的 state/nonce 生成闭包借用了短生命周期 `tx`，与库要求的静态生命周期冲突。r2 改为闭包拥有该持久事务值的副本，不重新随机生成，不改变nonce/state/PKCE绑定；保留生产HTTP替身测试及全部JWT负例。r2 随后经主控 22 项 Rust 测试及构建均 exit0，r3 最终源码已由主控独立通过 Rust 23/23 和构建。

r3针对主控实际UI全白P1：Tauri2.12.5将默认App(index.html)简化为`tauri://localhost`，其URL path为空；原trusted_page只接受`/`和`/index.html`，因此导航在加载前拒绝默认入口，IPC guard也不兼容同一地址。r3仅增加空path，继续共用该guard；新增回归断言实际无斜杠URL的path确实为空，并保留外部/非main/其他host/路径及userinfo/port/query/fragment拒绝。主控已用新包确认正文/按钮及 IPC 正常；定向还原旧根路径拒绝的变异被真实 Rust 断言杀死（22 passed/1 failed，exit101），恢复后 23/23。ACL/CSP、导航边界及 devtools 策略未扩大。

只请求 `openid`，不请求 offline_access 或刷新 grant；服务端附带 refresh token 时立即从 SDK response 移除，不保存或使用。access token 与已验证 subject 仅留 native session 内存，以 ID token exp 和 access-token expires_in 的较早者到期，显式重登；没有 ID token 冒充 API token 的路径。JS 只取得固定 phase/authenticated/非敏感 expires_at/error。应用拥有的事务和 session 敏感缓冲使用 zeroize；SDK/HTTP 临时内存的所有内部副本不承诺完整物理擦除。退出是本地清理，不撤销系统浏览器的 IdP SSO 会话。

## 已验证状态与验证入口

以下真实结果来自主控在 `handoff/implementation-r4.md` 中提供的独立核验摘要；实施节点没有读取私有探针或自行执行系统验证。已安装 r3 arm64 包的二进制 SHA256 为 `63573a4c2b3825b95bd680bd390771a5ea025bf79062ec7c5cc7fbfce4fe5577`。

- 冷回跳：App 完全退出且 pending 事务保留，主控精确进程检查确认候选不在；用户手动浏览器登录并允许打开 App，`/Applications` 中的已安装包显示已登录，固定 pending 条目 absence44，已消费。
- 暖回跳：App 保持运行，退出登录后重新浏览器登录并及时确认打开 App，原生 UI 已登录。首次暖尝试等待浏览器确认较久后出现 `OIDC_EXCHANGE_FAILED`；失败保留，授权码过期仅为未单独证实的解释。
- 取消与恢复：浏览器打开 App 确认框等待时，原生取消显示已取消；随后允许旧回跳，仍已取消且非已登录；再次新发合法登录成功。最后已退出登录并 CmdQ。临时服务/证书和最终进程清理由主控独立收口，尚无最终清理回执。

没有原始 callback、Token、身份、密码或音频落盘。上述结果只覆盖 auth-only 接线，剩余系统边界见 AUTH 文档。

实施节点 Node 测试（不安装依赖、不调用 Cargo）：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-20261101
/Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node --test --test-timeout=5000 \
  tools/macos-m1-native-probe/scripts/build.test.mjs \
  tools/macos-m1-native-probe/scripts/auth-ui.test.mjs
```

历史执行均经指定 `ev.sh` 留证；当前测试脚本仍将 fixture 临时目录固定到 implementer/r3/test-tmp，r4 未运行或修改该脚本，也不回写历史目录。fixture按固定输入清单复制，排除主控编译生成的gen/permissions/target；fixture的锁、CLI、Mach-O header都是结构测试替身。plutil和Node子进程双流/退出/超时实际运行，候选程序不运行。原53项构建测试保留，新增测试验证公有配置、CSP/ACL、输入hash、UI竞态及合成JWT fixture签名。Node签名通过不等于Rust OIDC验证通过。

主控已使用以下固定生产入口完成 Rust 测试与构建；保留命令用于追溯，不是 r4 重跑指令（本节点不运行）：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-20261101/tools/macos-m1-native-probe
env -i HOME="$HOME" PATH=/Users/sunpcm/.nvm/versions/node/v22.13.1/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node scripts/auth-test.mjs
env -i HOME="$HOME" PATH=/Users/sunpcm/.nvm/versions/node/v22.13.1/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node scripts/build.mjs
```

`probe:auth-test` 固定 cargo test、arm64、locked/offline、jobs2；`probe:build` 保持 CLI 2.12.4、tauri 2.12.5、tauri-build 2.7.4。HOME 原样保留；其他环境白名单、祖先 Cargo config 拒绝、独立 `.review/m1-native-host` 缓存、20 分钟上限、双流完整传递及非零传播保持。入口不安装/fetch/签名/执行应用，不接受额外 argv。两锁只读，由主控原生生成/维护。r3 使用隔离官方 Rustfmt 收口全部 Rust 源码与 build.rs，主控独立精准 Rustfmt/Prettier/diff 也已通过；r4 只格式化两份 MD，代码/测试/锁字节与批准基线相同，可复用既有执行证据，不虚增测试计数。

build 成功必须有新鲜固定 `target/aarch64-apple-darwin/debug/bundle/macos/EchoTalk M1 Native Probe.app`，核 plist scheme/identifier/version/minimum OS、arm64 Mach-O 和可执行位；旧包改名保留。回执绑定所有白名单 Rust/静态输入（包括公有配置）、两锁和产物 hash；构建期间输入变化拒绝。Tauri 自动生成的三个命令权限文件为 ignored 构建输出，额外权限文件拒绝。旧图标保持原字节。

完整证据映射、历史失败与未验边界见 [AUTH 验证文档](../../docs/verification/cross-platform/MACOS-M1-NATIVE-AUTH.md)。r4 最终源码/两锁归档及格式/范围检查在主 checkout 的 `.review/reports/macos-m1-auth-media-20261101/implementer/r4/`；历史 r0～r3 报告保留原样。业务 frontend10/backend5 本轮未运行、不记通过，原合同与 59% 门槛保持。API token/共享 React/媒体/麦克风/Provider/LiveKit 真实语音均未接线；5 分钟 5 轮、耳机/休眠、最低 OS 与分发未验，不宣称 M1 整体通过或进入 M2。readiness 的既有 P2 另列，不修改 backend。
