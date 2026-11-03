# macOS M1 原生登录与隔离媒体探针

这是独立、可丢弃的 M1 探针，尚非正式 macOS 产品客户端，也没有进入 M2。原生认证的历史实机结果见 [AUTH 验证记录](../../docs/verification/cross-platform/MACOS-M1-NATIVE-AUTH.md)；本轮仅补最小 native API、真实 SDK 装配和离线回归，不复用历史包来宣称新媒体已验。

本轮状态与步骤见 [离线媒体验证记录](../../docs/verification/cross-platform/MACOS-M1-OFFLINE-MEDIA.md)。媒体默认未配置，开始按钮禁用；不会自动采音。真实 Provider 5 分钟 5 轮、WKWebView/TCC、耳机、休眠、close/quit 和当前新包的构建结果以独立回执为准，设备场景仍须各自验收。

当前 CI 入口与最终组合结果见 [macOS M1 探针 CI 门禁](../../docs/verification/cross-platform/MACOS-PROBE-CI.md)。

## 固定接口与安全边界

- 单一 `main` 本地窗口：只接纳 `tauri://localhost`、尾斜线根路径或 `/index.html`，同时拒绝其他窗口、外部 URL、userinfo/port/query/fragment。导航与所有 IPC 使用同一生产 guard。
- Auth IPC 仍是 `auth_begin({})`、`auth_cancel({})`、`auth_status({})`。原系统浏览器、Keychain、PKCE/state/nonce、冷暖回跳、匹配代际 401 和内存凭据边界保留。
- 媒体只暴露 `media_prepare({})`、`media_dispatch({generation})`、`media_stop({})`、`media_status({})`；generation 是正安全整数，严格拒绝多余字段。无任意 URL/method/header/body 或凭据输入。
- OIDC token 永不返回 JS；JS 仅临时取得 LiveKit 房间 token。native 固定 capabilities → create → token，Room 真实连接并发布后才 dispatch；连接与收到远端音频分别显示，均不冒称双向实际有声。
- HTTP 只用正常 TLS、HTTPS、no_proxy、禁 redirect、有限 connect/request 超时及有界响应。只支持隔离 `call_lease_mode=disabled`，Cloud 明确拒绝，不伪造占用协议。
- 单个媒体工作槽，不把重复 IPC 排进无限队列。Auth begin/cancel 先同步作废媒体代际，再分别执行 Auth 工作与有界媒体清理；Auth 取消不等待媒体 HTTP。
- JS 在 begin/cancel 之前同步发布未认证，停止本地轨和重连；旧 Auth 异步结果不能复活媒体，同一登录的重复状态订阅不误停会话。
- stop 可能先返回 stopping/pending，用户可显式“核实结束”。已确认取消终态 error=null；真实 failed/ended 保留安全失败提示并允许下一次显式开始。blocked/unknown 禁止新开；已知旧 ID 可显式重试 end，create 结果未知则须人工核查，重启不证明旧会话已结束。
- offline、hidden、pagehide、身份/授权过期会同步停本地音轨，不自动恢复。唯一 webview Destroyed 时 native 请求进程退出；CmdQ 保留默认退出路径，无后台/托盘。JS 清理与进程退出的真实 OS/TCC 效果仍待设备验证。

## 编译期公开配置

认证只读 `src-tauri/public-config.json` 的既有严格 schema；没有 dotenv、环境或 IPC 覆盖。本候选仍保留历史隔离 IdP 公有地址，服务当前不承诺运行，本轮没有恢复服务或证书。

媒体另读 `src-tauri/media-config.json`：

```json
{
  "version": 1,
  "api_origin": null,
  "media_origins": []
}
```

启用时必须显式填规范 HTTPS API origin 和 WSS origin 白名单，均不带路径/尾斜线/userinfo/query/fragment。默认禁用；不提供隐式 fake/tone/replay。还必须在 Tauri CSP 的 connect-src 精确列出这些 WSS 及其同源 HTTPS（SDK 所需）项；缺失或额外源都拒绝。API/OIDC REST 仍在 native，不允许 WebView 任意 HTTP 代理。

script/style 仅 self，media-src 仅 self/blob，保留明确 Tauri IPC 源，不使用 CDN、unsafe-inline、unsafe-eval 或通配连接源。

## 固定离线入口

依赖由唯一所有者准备：Node 22.13.1、CLI 2.12.4、SDK 2.17.2；Cargo manifest/lock 及 root pnpm 锁不由本探针重写。所有入口拒绝额外 argv，保留隔离缓存、环境白名单、祖先 Cargo config 拒绝、双流、真实退出、超时、旧包保留与产物校验。

从仓库根执行 Node 回归（不启动 App/服务/录音）：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-offline-media-20261102
mkdir -p .review/m1-native-host/tmp/node-tests
TMPDIR="$PWD/.review/m1-native-host/tmp/node-tests" \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node --test --test-timeout=30000 \
  tools/macos-m1-native-probe/scripts/build.test.mjs \
  tools/macos-m1-native-probe/scripts/media-build.test.mjs \
  tools/macos-m1-native-probe/scripts/auth-ui.test.mjs \
  tools/macos-m1-native-probe/scripts/media.test.mjs \
  tools/macos-m1-native-probe/scripts/livekit-media.test.mjs \
  tools/macos-m1-native-probe/scripts/media-ui.test.mjs \
  tools/macos-m1-native-probe/scripts/main.test.mjs \
  tools/macos-m1-native-probe/scripts/ci.test.mjs
```

`--test-timeout=30000` 为每份 Node 测试文件提供有限的 30 秒整体预算，包含该文件内的大流与真实子进程回归；各子进程保留自身 timeout。CI Node 整批外层仍限时 120000ms，job 仍限时 60 分钟。

等价 package 入口为 `probe:test`。fixture 使用本次 TMPDIR 下每测试唯一目录，退出时只删除自身目录，不再写历史 implementer/r3。

以下固定入口由唯一 worktree 锁所有者串行运行；它们不是安装、签名、执行 App 或服务的入口：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-offline-media-20261102/tools/macos-m1-native-probe
# 只生成受验证的自托管 SDK/许可证和精确权限；无编译、无联网。
env -i HOME="$HOME" PATH=/Users/sunpcm/.nvm/versions/node/v22.13.1/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node scripts/assets.mjs
# 真实 Rust 测试，locked/offline/arm64/jobs2。
env -i HOME="$HOME" PATH=/Users/sunpcm/.nvm/versions/node/v22.13.1/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node scripts/auth-test.mjs
# 真实 arm64 .app 构建；不执行包。
env -i HOME="$HOME" PATH=/Users/sunpcm/.nvm/versions/node/v22.13.1/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node scripts/build.mjs
```

SDK 原始 UMD 必须为 479042 bytes、SHA256 `800b013b0a0c9f8b8194d76225bf3dc9837028739fa641215068b112627edd15`。入口在任何生成/子进程之前核独立 node_modules 的版本、SDK 和许可证字节；仅补缺失生成文件，已有错误输出拒绝覆盖，不能通过下载或 fake SDK 回退。生成的 `web/vendor/` 和七项 permissions 是 ignored 输出，参与构建输入 hash；入口用 SRI 加载本地 UMD，并实际检查 SDK 导出的版本/API。最终回执同时绑定两锁、所有编译与静态输入、SDK 源/生成字节和 `.app` 二进制/plist，构建后变化或麦克风说明缺失均失败。

历史离线媒体增量当时未执行业务 Vitest/Playwright/backend pytest/frontend10/backend5；本节离线入口不代替业务 15 项验收。当前已验最终组合结果见上方 CI 门禁记录。离线测试、静态格式或构建成功都不等于真实登录/媒体/设备通过。
