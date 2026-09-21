# EchoTalk 跨平台架构与交付门禁

> 状态：目标架构，审计基线 `main@1f9a1b0`（2026-09-20）。
>
> 当前系统全景见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。本文用“已实现 / 部分实现 / 未实现”区分代码事实与规划，不再使用“生产就绪”表述。

## 1. 当前平台基线

| 平台            | 仓库状态                                                              | 可声明的完成度                                        |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| Web             | `apps/vite-app`、Vite/Nginx 代理、LiveKit 语音链路已实现              | 主客户端；完整外部 Provider E2E 仍依赖环境            |
| iOS             | Capacitor 8 工程、`webDir: dist`、麦克风描述、`AVAudioSession` 已提交 | 基础壳已接入；未见真机全链路、Archive/TestFlight 证据 |
| Android         | 无 Android 工程                                                       | 未实现                                                |
| macOS / Windows | 无 Tauri 工程                                                         | 未实现                                                |
| Webpack         | `apps/webpack-app` 备用实现                                           | 不属于跨端交付基线，也不承诺与 Vite 功能等价          |

当前不是 `apps/mobile-app + apps/desktop-app` 的多应用结构。iOS 工程位于 `apps/vite-app/ios`，Android 与 Tauri 只能作为后续决策，不能画成既有组件。

## 2. 跨端共享边界

所有已实现终端复用 `apps/vite-app/dist`：

```text
React UI / Zustand / API Client / LiveKit Client
                       │
          ┌────────────┴────────────┐
          │                         │
       Web 浏览器              Capacitor iOS
       同源 /api               配置的 API origin
       /livekit-ws 代理         LiveKit 默认直连
```

现阶段不抽取 `shared-core`，原因是仓库里没有第二套原生 UI 运行时。只有在 React Native、SwiftUI 或其他客户端需要复用纯领域逻辑时，才值得拆出无 DOM、无 Zustand、无 Vite 环境依赖的共享包。

## 3. 网络与地址契约

### 3.1 REST API

`apps/vite-app/src/utils/env.ts` 和 `lib/api.ts` 已实现以下策略：

- Web 默认使用同源 `/api`；
- 原生读取 `VITE_API_BASE_URL`，校验为 HTTP(S) 后统一补 `/api`；
- 开发模式可用 `localStorage.dev_server_host` 临时覆盖；
- Base URL 在请求时惰性求值，配置错误不会在模块加载阶段直接白屏。

生产构建必须显式注入原生 API origin。不得把 Capacitor WebView 的 `localhost` 当作后端地址。

### 3.2 LiveKit

```text
GET /api/sessions/{id}/token → { token, ws_url }
                                    │
                          conversation store
                                    │
                ┌───────────────────┴──────────────────┐
                │                                      │
        Web 默认 /livekit-ws                    原生默认 ws_url 直连
        VITE_LIVEKIT_DIRECT=true                VITE_LIVEKIT_FORCE_PROXY=true
        时可改为直连                            时由 API origin 推导代理
```

这是已经实现的路由逻辑。上线仍需验证代理对 LiveKit region routing、长连接超时、弱网切换和企业网络的实际影响。

### 3.3 CORS、TLS 与 ATS

- 后端已显式配置 Web、Capacitor 与 Tauri Origin，并限制允许的方法和 Header；
- iOS `Info.plist` 仅放行本地网络，没有全局关闭 ATS；
- 仓库内 Nginx 只监听 HTTP 80，因此生产 TLS 必须由外部入口或新增的 TLS 配置承担；
- `CORS_ORIGINS` 等列表型环境变量必须使用 JSON 数组格式。

CORS 放行不是鉴权。即使 Origin 正确，真实 Bearer Token 门禁仍是外部分发的阻断项。

## 4. 原生能力边界

### 4.1 iOS 已实现

- Capacitor App ID 与 `webDir: dist`；
- 麦克风用途描述；
- `AVAudioSession.playAndRecord + voiceChat`；
- 默认扬声器、蓝牙选项与中断结束后的重新激活；
- 本地网络 ATS 例外。

### 4.2 iOS 尚未证明或尚未实现

- 真机上的完整“创建会话 → 语音 → 结束 → 评估”闭环；
- Wi-Fi/蜂窝切换、来电、锁屏、后台 30 秒后的状态恢复；
- App 前后台事件与评估轮询校准；
- Release Archive、签名、TestFlight、隐私清单与审核材料；
- Keychain 中的 refresh token（真实登录本身也尚未实现）；
- 移动端设置 Bottom Sheet 与全部 44pt 触控目标验收。

### 4.3 Android 与 Desktop

两者均未实现。开始前应分别做最小 Spike：

- Android：WebRTC 麦克风、运行时权限、文件选择器、后台策略；
- macOS/Windows：WKWebView/WebView2 的 WebRTC、音频回声消除、权限与签名。

只有 Spike 通过且产品确实需要该平台时才创建工程，避免长期维护空壳。

## 5. 鉴权与本地存储

当前前端固定发送 `Bearer mock-token`，后端忽略 Token 并返回固定用户。以下目标架构**尚未实现**：

- 短效 access token 仅驻留内存；
- Web refresh token 使用 `HttpOnly; Secure; SameSite` Cookie；
- 原生 refresh token 使用 Keychain/Keystore；
- Token 刷新、撤销、设备退出与 401 恢复流程。

不要先安装 secure-storage 插件来制造“安全已完成”的错觉。正确顺序是先确定认证协议、会话生命周期和服务端撤销语义，再接平台存储。

主题当前保存在 `localStorage`，丢失时回退默认主题可接受；它不需要安全存储。Provider API Key 只在后端加密保存，原生端不应持久化明文。

## 6. 生命周期与恢复策略

跨端恢复必须以服务端和 LiveKit 的真实状态为准，不能只依赖 WebView 内存：

| 场景               | 当前行为             | 目标行为                                            |
| ------------------ | -------------------- | --------------------------------------------------- |
| 短暂切后台         | JS 计时器可能暂停    | 回前台重新校准评估轮询和 LiveKit 连接状态           |
| WebView 被系统回收 | Zustand 会话状态丢失 | 基于登录态和服务端活动会话决定恢复或结束            |
| LiveKit 非正常断开 | UI 提示并允许刷新    | 区分网络、Agent fail-fast、Token 过期并给出确定动作 |
| 分析延迟/失败      | 前端轮询后超时       | 服务端暴露持久分析状态、重试和失败原因              |

在分析任务仍是请求内同步执行且没有持久状态时，仅调整前端轮询无法解决可靠性问题；应先修服务端任务语义。

## 7. DocTalk 跨端策略

当前 DocTalk 在客户端读取文本并把最多 50,000 字符随会话请求上传。跨端验收重点是：

- iOS/Android 文件选择器能否选取 `.md` / `text/*`；
- 编码异常、空文件和超限文件的提示；
- 切后台选择文件后 WebView 是否保持状态；
- 文档内容只进入 PostgreSQL `session_contexts`，当前没有对象存储或文件生命周期管理。

如未来支持 PDF、Office 或大文件，应改为对象存储 + 异步解析 + 内容安全检查，不应继续扩大同步 JSON 请求体。

## 8. 构建与配置契约

| 变量                       | Web    | 原生   | 说明                               |
| -------------------------- | ------ | ------ | ---------------------------------- |
| `VITE_API_BASE_URL`        | 可省略 | 必填   | 原生不能使用 WebView localhost     |
| `VITE_LIVEKIT_DIRECT`      | 可选   | 不适用 | Web 显式绕过代理                   |
| `VITE_LIVEKIT_FORCE_PROXY` | 不适用 | 可选   | 原生网络无法直连时兜底             |
| `VITE_LIVEKIT_URL`         | 兜底   | 兜底   | 优先使用 Token API 返回的 `ws_url` |

推荐流水线：

```text
pnpm install --frozen-lockfile
  → lint + typecheck + unit test
  → vite build（唯一 Web 产物）
  → Web 镜像构建
  → cap sync ios/android（仅对已维护的平台）
  → 平台构建、签名与真机 E2E
```

当前 CI 只覆盖前后端 lint/type/test/E2E，不覆盖 Docker 镜像、iOS 构建、Android 构建或商店签名。CI 的 Node 22 与 Docker builder 的 Node 20 也应统一。

## 9. 交付门禁

### M0：Web 生产边界

- [ ] 真实认证替换 Mock，未授权请求返回 401；
- [ ] HTTPS/WSS、CORS 与安全 Header 在真实域名验证；
- [ ] 数据库迁移以一次性 Job 串行执行；
- [ ] API、Agent、Provider、LiveKit 的健康/错误指标可观测；
- [ ] 会话分析具备持久状态、幂等重试与补偿入口。

### M1：iOS 内部真机可用

- [x] Capacitor iOS 基础工程与音频会话配置已入库；
- [x] 原生 API Base URL 与 LiveKit 路由逻辑已入库；
- [ ] 真机完成完整语音与评估闭环；
- [ ] 验证前后台、来电、锁屏、弱网切换和文件选择；
- [ ] 完成 safe area、窄屏布局、Bottom Sheet 与触控目标验收；
- [ ] Debug/Release 使用明确分离的 API 配置。

### M2：iOS 外部分发

- [ ] M0 全部通过；
- [ ] Keychain 登录态、登出与 Token 撤销闭环；
- [ ] Release Archive、签名、隐私清单、崩溃采集与 TestFlight 验证；
- [ ] 明确版本兼容与强制升级策略。当前不建议引入 JS OTA。

### M3：Android / Desktop

- [ ] 平台 Spike 通过并记录设备、OS、网络和结果；
- [ ] 产品确认维护成本与发布范围；
- [ ] 再创建原生工程和平台 CI，不复用 iOS “已完成”结论。

## 10. 明确不做的过早设计

- 不把尚不存在的 Android/Tauri 工程写成当前架构；
- 不为单一 React UI 提前抽 `shared-core`；
- 不在真实认证之前引入 refresh token 存储插件；
- 不用客户端重试掩盖服务端分析无持久状态的问题；
- 不把模拟器启动、TypeScript 通过或 `cap sync` 等同于真机可用/可上架。
