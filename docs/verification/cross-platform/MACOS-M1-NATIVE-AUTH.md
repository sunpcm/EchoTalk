# macOS M1 原生 AUTH 验证

截至 r4，auth-only 探针已由主控完成 r3 最终源码的独立测试、真实 arm64 包构建，以及已安装包的冷暖登录、取消、迟到回跳拒绝和再次登录。r4 仅收口两份文档和最终归档，停在 Review；不代表 M1 整体通过，也不进入 M2。

依据 `MACOS_MVP_DEVELOPMENT_PLAN.md` §3.1/§4/§5 M1、`CROSS_PLATFORM_AUTH_LIFECYCLE.md` 的失败关闭和旧结果隔离规则。真实设备结果仅覆盖以下明确列出的认证场景。

## 候选、来源与执行分工

- worktree：`/Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-20261101`；分支 `codex/macos-m1-auth-media`；HEAD `b288d299a1e71ac7435ba7c7ddb9e94290bceeb8`。r0 开工前干净；r4 开工核对批准的 27 路径 dirty（26 份已有成果加主控生成的 Cargo.lock）及未变图标，共 28 个批准 hash，全部一致，保留现有成果。
- `native-preflight-r4.json` 为 `preflight_passed`，fingerprint 与 `continuation-baseline-r4.json` 一致；预检本身不证明 OS 权限、网络或 native 验收通过。此前共享 HEAD 漂移由主控按用户授权处理，实施节点未改 pin/runtime/config。
- 主控是两锁/依赖唯一所有者，负责真实 Rust 单测/编译、安装包、Keychain、证书信任、系统浏览器及冷暖回跳。以下独立核验事实由 `handoff/implementation-r4.md` §2 提供；本节点没有读取 reviewer、私有探针/账号/环境或自行操作系统复验。
- r4 实施节点仅修改本 AUTH 文档及探针 README，精准 Prettier、冻结归档后检查格式/diff/范围/hash。报告和最终清单在主 checkout 的 `.review/reports/macos-m1-auth-media-20261101/implementer/r4/`，不进入 Git；r0～r3 报告/证据保持原样。r4 不重跑 Node、Cargo 或业务 15 门禁，代码/测试/锁与批准基线相同，既有测试按相同字节复用，不增加本轮测试计数。
- 公有配置以 r0b Keycloak 为准：issuer `https://localhost:19444/realms/echotalk-m1`、client `echotalk-m1-native`、固定 `echotalk-m1://oauth/callback`。这是隔离验收输入，不承诺临时服务持续可用；主控正在独立清理服务/证书，最终清理回执尚待提供。

## 主控已独立验证的当前状态

| 层级                 | 已提供的事实                                                                                                                                                                                 | 证据边界                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 离线/格式            | r3 最终源码 Node 86/86、原 offline 70/70、精准 Rustfmt/Prettier/diff 全部通过                                                                                                                | Node 中 CLI/Cargo/Mach-O 为替身；不据此声称原生 App 成功                                                        |
| 真实 Rust            | 23/23 通过；根 URL 修复定向变异被真实断言杀死（22 passed/1 failed，exit101），还原后 23/23                                                                                                   | 合成存储/HTTP/JWT 的确定时序与负例不等于全部系统故障均已设备实测                                                |
| 真实包与 UI          | r3 arm64 包已构建/安装，实际正文、登录按钮和 IPC 状态正常                                                                                                                                    | 对应二进制 SHA256 `63573a4c2b3825b95bd680bd390771a5ea025bf79062ec7c5cc7fbfce4fe5577`；r2 全白不再是当前未解决项 |
| 正常 TLS 与浏览器    | 主控调整专用叶证书的临时用户 SSL 信任记录后，localhost/127.0.0.1 成功；example.invalid 明确 Host name mismatch；默认 Chrome 正常显示 discovery/登录页，未越过警告                            | 产品保持 OS 信任/主机名校验，不内置 CA、不禁 TLS；撤销尚待最终回执                                              |
| 真实冷回跳           | App 完全退出，Keychain pending 保留；精确进程检查确认候选不在。用户手动浏览器登录并允许打开 App，已安装包原生 UI 显示已登录，进程路径在 `/Applications`；固定 pending 条目 absence44，已消费 | 不是把关窗口或旧进程仍在记为冷启动；未落盘原始 callback/Token/身份/密码/音频                                    |
| 真实暖回跳           | App 保持运行，退出登录后重新浏览器登录，及时确认打开 App，原生 UI 显示已登录                                                                                                                 | 首次暖尝试等待浏览器确认较久后 `OIDC_EXCHANGE_FAILED`，失败保留；授权码过期只是未单独证实的解释                 |
| 取消、迟到回跳与恢复 | 浏览器打开 App 确认框等待时先原生取消，显示已取消；随后允许旧回跳，仍已取消且非已登录；再次新发合法登录成功                                                                                  | 覆盖所述真实时序；其他旧发现/交换时序由 Rust 确定测试证明                                                       |
| 收尾                 | 最后已退出登录并 CmdQ                                                                                                                                                                        | 主控继续独立清理/核进程；不宣称服务/证书/所有进程已清理                                                         |

Chrome 曾在 macOS 证书校验通过时仍报 `ERR_CERT_AUTHORITY_INVALID`。主控提供的精确信任记录含 hostname `policyString`，Chromium 公开源码忽略该字段。用户明确批准：仅调整同一两天有效、`CA:FALSE`、SAN 仅 localhost/127.0.0.1 的叶证书在用户登录钥匙串中的 SSL 信任，去掉这一不兼容额外字段；正常主机名校验保留。主控已备份、应用并读回验证，结果如上表。这是临时测试环境策略，不是产品源码变更或永久全局信任方案；仍须精确撤销并由主控另交回执。

## 安全行为与测试映射

下列 Rust 用例已纳入主控独立通过的 23 项；“Rust 通过”指真实库/控制器在合成依赖下运行。系统实测仅以当前状态表中的明确场景为准。

| 门禁                                | 实现及回归                                                                                                                                | 当前证据与边界                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 先保存事务再开浏览器                | `auth.rs` + `native.rs`，固定 Keychain 项及 `/usr/bin/open`；`storage_and_browser_failures_refuse_auth_and_recover_explicitly`            | Rust 通过；真实登录接线已验，Keychain 锁定/拒绝/写失败未列为设备通过                           |
| 冷恢复、期限及配置绑定              | Store 恢复；`cold_restore_and_expired_or_changed_binding_rejected`                                                                        | Rust 通过；真实退出后冷恢复成功                                                                |
| 严格 callback / 错 state 不删新事务 | `malformed_wrong_state_and_denial_preserve_or_consume_correct_item`；`session_state` 冷暖、坏值、重复与旧事务测试                         | Rust 通过；真实 Keycloak 冷暖回跳成功，恶意参数矩阵仍属合成回归                                |
| 原子消费、重复/并发至多一次         | mutex + 严格 Keychain delete，进程生命周期锁；`strict_missing_delete_never_becomes_success`、`concurrent_callbacks_exchange_at_most_once` | Rust 通过；冷回跳 pending absence44；设备重复/并发和第二进程拒绝未单独实测                     |
| 取消/登出/旧发现与交换迟到          | `cancel_old_prepare_or_exchange_success_and_failure_cannot_touch_new_login`                                                               | Rust 通过；设备取消→允许旧回跳→新登录成功，其他确定时序仍以 Rust 为据                          |
| 过期后重登及交换中到期              | `expired_waiting_login_can_begin_again_without_sticking_busy`、`cancelled_cold_callback_and_expiry_during_exchange_never_publish`         | Rust 通过；未将首次暖失败解释当作已证实的过期测试                                              |
| 成熟 OIDC 验证                      | `oidc.rs` 调用 openidconnect，`oidc_tests.rs` 已签合成 JWT：nonce/issuer/aud/signature/expiry/azp/at_hash、多 aud 无 azp                  | 真实 Rust OIDC 库测试及真实登录通过；Node 仅验证 fixture 签名控制                              |
| 公有配置/HTTP 失败关闭              | Rust config/oidc；Node null、HTTPS/schema/注入/重复字段拒绝；native 限流向、时间、响应及 redirect                                         | Node/Rust 通过，正常 TLS 登录已验；环境故障全矩阵未设备实测                                    |
| 最小 IPC/CSP/本地窗口               | 空参数三命令、实际 URL、ACL、导航及新窗口拒绝；Rust origin/arguments 与根路径回归                                                         | Node/Rust 通过；已安装 bundled main 实际正文与 IPC 状态正常，远端/非 main 攻击入口仍属合成回归 |
| UI 竞态与脱敏                       | `auth-ui.test.mjs` 固定空参数、旧轮询/旧登录结果不覆盖取消、脱敏与卸载                                                                    | Node 通过；真实取消/迟到回跳状态保持已验，不向 JS 传 Token 或身份正文                          |
| 构建与输入绑定                      | 原 53 构建断言及新输入/ACL/配置/非零回归；白名单输入/两锁/产物 hash                                                                       | Node 替身通过及主控真实 arm64 构建通过；r4 仅 MD 更新，重新归档而不重建                        |

`production_oidc_flow_with_injected_http_uses_public_pkce_and_keeps_access_token_distinct` 使用合成 discovery/JWKS/token 响应运行生产授权与兑换函数，断言 public client、S256 verifier、固定 redirect、无 client secret/refresh grant、原 state/nonce 绑定，以及 session 保存 access token 而非 ID token。真实 Rust 测试已由主控执行，但本轮未用此 token 请求业务 API。

## 历史缺陷与追溯索引

| 阶段           | 当时失败及处理                                                                                                                                                        | 当前状态                                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r0             | 共享 skill HEAD 漂移，主控叫停并保留全部成果；后经用户批准仅更新 shared_head 元数据恢复门禁                                                                           | 不改 pin/runtime、不清理历史；r0 报告保持原样                                                                                                                                                                                                        |
| r1 回跳契约    | 主控真实 Keycloak 26.8.1 回跳键为 `code/iss/session_state/state`；r0 白名单缺 `session_state`，兑换前 `CALLBACK_INVALID`                                              | r1 只允许可选 1～256 bytes ASCII 字母数字或 `-_.~`，校验后丢弃；重复/坏值/其他未知参数继续拒绝，后续真实冷暖成功                                                                                                                                     |
| r1 编译 → r2   | locked/offline 真实外层/子进程 exit101，唯一 E0521，当时 Rust 测试未运行；`authorization_with_http` 闭包短借用 tx 却要求静态生命周期                                  | r2 先复制原事务 state/nonce，再用 move 闭包拥有副本；不重生成随机值或削弱 PKCE/JWT。主控 r2 Rust 22 项及构建 exit0                                                                                                                                   |
| r2 UI → r3     | r2 包二进制 SHA256 `9ea9cd4f9e1a6462d4768e52ac14385adf6618545adccbdaf111a4d684c0fb2d`，安装后 AX 仅空 HTML content、480×400 截图全白；当时已退出，未开登录浏览器/事务 | Tauri 2.12.5 默认 `App(index.html)` 使用无斜杠 `tauri://localhost`，path 为空；旧 guard 只收 `/` 和 `/index.html`。r3 仅增加精确空 path，保留 main/scheme/host/userinfo/port/query/fragment 等限制；新包 UI/IPC 通过，定向变异 exit101、还原后 23/23 |
| 系统浏览器验收 | Chrome 证书警告和首次暖尝试 `OIDC_EXCHANGE_FAILED`                                                                                                                    | 专用临时信任策略按用户授权调整后浏览器与冷暖登录成功；首次暖失败仍保留，未宣称其根因已单独证明                                                                                                                                                       |

r1 的回归包括 `keycloak_observed_callback_keys_succeed_warm_and_cold_once`、`optional_session_state_has_bounded_opaque_metadata_semantics`、`bad_or_duplicate_session_state_is_rejected_before_consuming_valid_transaction`、`session_state_cannot_replace_state_issuer_or_cancel_new_transaction`。元数据不参与身份、issuer、事务查找/删除或状态发布，不修改服务端剥参数绕过入口。

r3 的 `packaged_tauri_default_root_without_slash_is_trusted` 先断言实际 URL 字符串和空 path，再断言可信；保留 `/`、`/index.html` 正例及非 main/外部 scheme/其他 host/path/userinfo/port/query/fragment 负例。导航与 IPC 继续共用 guard，未扩 ACL/CSP、任意导航、新窗口或 devtools。

本地追溯根目录：主 checkout `.review/reports/macos-m1-auth-media-20261101/`。各轮指令/公有事实在 `handoff/implementation-r0.md`、r0a/r0b、r1/r1a、r2、r3、r4 对应文件；实施报告、ev、冻结清单和归档在 `implementer/r0/`～`implementer/r4/`。r3 实施报告只证明当时本节点离线检查；当前主控真实结果以 r4 handoff 明确给定摘要为据，不读取私有材料，也不将历史测试写成 r4 新执行。

## 未验边界与待收尾

- 主控继续精确撤销临时证书信任、清理临时服务并核进程；最终回执尚未提供。本节点不操作系统、服务、证书或 Keychain。
- 设备负例尚未逐项实测：Keychain 锁定/拒绝/写失败、缺项/删除失败；错误回跳/OAuth error/无事务/过期/重放/并发；第二进程拒绝；远端/非 main IPC；到期显式重登及旧发现/兑换的其他时序。对应合成测试已通过，不补记为设备通过。后续仅按主控授权针对缺口验收，无需重复已证实的正常冷暖路径。
- 这是 auth-only 极小探针，无 API token/共享 React/媒体/麦克风/Provider/LiveKit 真实语音接线。正常 TLS/本机合成 IdP 成功不证明现有账号、backend audience、跨 client principal、真实 API 或媒体通过。
- 真实 5 分钟 5 轮、耳机/休眠、最低 OS、签名与分发未验；不标 M1 整体通过，不进入 M2。
- 业务 frontend10/backend5 本轮未运行、不计通过，原合同与 59% 门槛保持。无 Provider 仍误报 ready 的既有 readiness P2 另列，本轮不改 backend。

后续系统验收记录应绑定设备/OS、源码/配置/两锁、包 hash、步骤、预期/实际与固定错误码，避免保存完整授权 URL、回调、账号、Token、身份或音频。具体入口及限制见探针 [README](../../../tools/macos-m1-native-probe/README.md)。

## 取舍、锁与回退

主控已原生生成并维护 Cargo.lock，SHA256 为 `0af33ca77ddea9daabb3e8fff76f5953655d1df6827615d7c5a1a7c0a10e1481`。本节点对 native 两锁、根 pnpm 锁及图标保持只读；r4 最终清单证明生产 Rust/JS/测试与批准基线相同，归档与 r3 相同的完整白名单输入及两锁快照，只纳入两份 MD 的新字节，不含缓存、账号、私钥或运行数据。

Token 留 native 内存，无 JS token getter；scope 仅 `openid`，无 profile/email/offline_access 或 refresh grant，服务端附带 refresh token 立即移除。应用自有事务/session 缓冲使用 zeroize，不声称 SDK/HTTP 内部所有副本已物理擦除。取消使旧结果失效，不承诺撤回已发到 IdP 的请求；worker HTTP/浏览器等待有上限，Keychain 系统授权对话等待仍未设备实测。回调队列容量 8，满队列拒收后可取消并显式重登。退出只清本地 session，不等于退出浏览器 IdP SSO。

回退须先核当前 hash 和归属，从对应备份/起始提交逐文件审阅还原，保留历史证据，不 reset/stash 或覆盖其他写者。公有配置若退回 null，须另审新输入并重新构建/hash；现有 Keycloak 包回执不适用于新配置。临时证书信任撤销由主控执行并另交精确回执。
