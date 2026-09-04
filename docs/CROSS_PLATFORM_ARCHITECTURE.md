# EchoTalk 多端跨平台架构设计方案 (Cross-Platform Architecture) — v2.3

> **版本**: v2.3 (最终生产就绪版 / Production-Ready Final)  
> **适用终端**: Web / iOS / Android / macOS / Windows  
> **核心原则**: 风险前置探针 (Spike First)、安全鉴权门禁 (Auth Gated)、原生体验增强、最小改动同构 (Single Vite Dist)。

---

## 1. 架构总览与分层设计

EchoTalk 基于现有的 **React 19 + TypeScript + Zustand + Tailwind CSS** 前端技术栈与 **FastAPI + LiveKit** 后端，通过 **Capacitor (移动端)** 与 **Tauri 2.0 (桌面端)** 容器化包装，实现 100% 同构前端产物 (`apps/vite-app/dist`) 在全平台上的分发。

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                             EchoTalk 跨端应用全景                              │
├───────────────────┬───────────────────────────────────┬────────────────────────┤
│     Web 平台      │          桌面端 (Desktop)         │     移动端 (Mobile)    │
│  (Chrome/Safari)  │         (macOS / Windows)         │     (iOS / Android)    │
│   apps/vite-app   │          apps/desktop-app         │    apps/mobile-app     │
│                   │        (Tauri 2.0 / Rust)         │   (Capacitor Runtime)  │
├───────────────────┴───────────────────────────────────┴────────────────────────┤
│                      统一表现与交互层 (Single Vite Dist)                       │
│  ├── 响应式视图: Dashboard (自适应网格), VoiceInterface (上下/双栏折叠), DocTalk │
│  ├── 交互形态: 移动端 Bottom Sheet / 桌面端侧滑抽屉 / 3套主题系统                │
│  ├── 辅助功能: 保持单词/句子可选中文本 (user-select 仅限按钮禁用, 满足查词需求)   │
│  └── 安全区适配: viewport-fit=cover + safe-area-inset 边距防穿透               │
├────────────────────────────────────────────────────────────────────────────────┤
│                        应用与业务运行时 (In-App Runtime)                       │
│  ├── 状态流转: Zustand (conversation, assessment, settings [含 theme])         │
│  ├── 环境感知: detectPlatform() / getApiBaseUrl() 动态解析 BaseURL 与路由      │
│  ├── 鉴权安全: 内存 access_token + 原生 Keychain/Keystore 加密持久化 refresh   │
│  └── 业务逻辑: BKT 知识追踪、音素对齐解析 (Phoneme Align)、i18n 字典 (zh-CN)   │
├────────────────────────────────────────────────────────────────────────────────┤
│                         平台原生能力桥接 (Platform Bridges)                    │
│  ├── Web: 标准 WebRTC, Web Audio API, LocalStorage                             │
│  ├── iOS: AVAudioSession (.playAndRecord + .voiceChat), 麦克风权限, ATS (TLS)   │
│  ├── Android: RECORD_AUDIO, Android 14+ 麦克风前台服务, 网络安全配置            │
│  └── Desktop: macOS WKWebView 权限描述与 Entitlements, 托盘/全局快捷键 (Spike后) │
└────────────────────────────────────────────────────────────────────────────────┘
```

> **Monorepo 演进与现有包说明**:
>
> 1. **关于 `shared-core`**: 当前阶段三端均装载 `apps/vite-app/dist`，无第二原生 UI 运行时（如 React Native），因此**暂不进行 Monorepo 抽包**，避免无收益的构建与类型映射负担。
> 2. **关于 `apps/webpack-app`**: 仓库中的 Webpack 客户端保留作为 Monorepo 的备用打包器参考实现，移动端与桌面端构建流水线仅以 `apps/vite-app` 为基准。

### 1.1 核心链路时序与跨端差异点

一次完整语音会话的调用链如下（括号内为现有实现位置），跨端改造的所有触点都落在这条链上：

```text
用户点击场景卡片 (RecommendedScenarios.tsx)
  │
  ├─[1] checkHealthReady()          GET  /api/health/ready
  ├─[2] createSession(mode, docCtx) POST /api/sessions
  ├─[3] getSessionToken(sessionId)  GET  /api/sessions/{id}/token → { token, ws_url }
  │        └─ ws_url 落入 useConversationStore.wsUrl (conversation.ts:95)
  │           ← 跨端 WebSocket 路由决策的唯一数据源
  ├─[4] <LiveKitRoom serverUrl={effectiveWsUrl} token={token}>   建立 WSS 信令
  ├─[5] onConnected → dispatchAgent()  POST /api/sessions/{id}/dispatch  (幂等)
  ├─[6] 会话进行中
  │        ├─ 双向音频轨 (WebRTC / SRTP)
  │        └─ DataChannel topic="agent_error" 监听自定义轨 fail-fast (VoiceInterface.tsx:143)
  ├─[7] endSession()                POST /api/sessions/{id}/end
  └─[8] usePollingAssessment        GET /api/assessment/{id}
           指数退避 1s → 10s，最多 15 次 (usePollingAssessment.ts)
```

| 步骤               | 跨端差异                                                            | 处理章节    |
| :----------------- | :------------------------------------------------------------------ | :---------- |
| [1][2][3][5][7][8] | 原生端相对路径 `/api` 会打到本地虚拟源；跨源请求受 CORS 与 ATS 约束 | §2.1 / §2.4 |
| [4]                | Web 走 Nginx 代理、原生默认直连，且两端代理地址推导方式不同         | §2.2        |
| [6]                | 麦克风权限、音频会话类别、来电打断、弱网切换                        | §2.5        |
| [8]                | 应用切后台时 JS 计时器被系统挂起，退避轮询会停摆                    | §2.9        |

> **要点**：步骤 [3] 是整条链的枢纽——后端已下发官方 `ws_url` 且已存入 store，跨端连接策略只需在步骤 [4] 做路由选择，无需引入任何新的地址解析逻辑。

---

## 2. 核心技术方案与避坑设计

### 2.1 后端 CORS 与 iOS ATS 网络适配 (P0 级门禁)

#### 1. 后端 CORS 显式白名单 (`backend/config.py`)

由于后端启用了 `allow_credentials=True`，根据 W3C CORS 规范，**严禁使用通配符 `["*"]`**（否则浏览器与 WebView 会静默拦截跨域请求）。必须在 `backend/config.py` 显式声明原生源：

```python
# backend/config.py
CORS_ORIGINS: list[str] = [
    "http://localhost:3000",        # Web 本地开发
    "capacitor://localhost",        # iOS Capacitor 默认 Origin
    "tauri://localhost",            # macOS Tauri v2 默认 Origin
    "http://tauri.localhost",       # Windows Tauri v2 默认 Origin
    "https://tauri.localhost",      # Windows Tauri v2 HTTPS Origin
]
```

> ⚠️ **部署提示**: `CORS_ORIGINS` 在 Pydantic-Settings 中定义为 `list[str]`。如果在 `.env` 环境变量中覆盖该配置，**必须使用标准 JSON 数组字面量**（例如 `CORS_ORIGINS='["https://app.echotalk.com","capacitor://localhost"]'`），不可使用逗号分隔字符串，否则会导致后端启动崩溃。

#### 2. iOS App Transport Security (ATS) 与 Nginx TLS

- **生产环境**：iOS 强制要求全链路 HTTPS/WSS。生产 `nginx.conf` 必须配置 SSL 证书并监听 443 端口。
- **本地联调 (`ios/App/App/Info.plist`)**：仅在本地开发调试阶段允许局域网 HTTP，生产构建由 CI 自动剔除：
  ```xml
  <key>NSAppTransportSecurity</key>
  <dict>
      <key>NSAllowsLocalNetworking</key>
      <true/>
  </dict>
  ```

---

### 2.2 真实 LiveKit 连接策略：直连为主 + 代理兜底

#### 现状梳理与极性设计

1. **现有能力**：后端在 `GET /api/sessions/{id}/token` 下发了官方 `ws_url`，且 [`conversation.ts:95`](file:///Users/sunpcm/code/EchoTalk/apps/vite-app/src/store/conversation.ts#L95) **已经将其实例化存入 `useConversationStore.getState().wsUrl`**。
2. **代理背景与直连风险**：[`vite.config.ts:41`](file:///Users/sunpcm/code/EchoTalk/apps/vite-app/vite.config.ts#L41) 原始注释说明该代理有两个作用——“解决浏览器/特定国内网络无法直连 LiveKit Cloud WSS 的问题” + “绕过 SDK 的 region routing”。
3. **分端连接极性与降级设计**：
   - **Web 端**：**默认保留 `/livekit-ws` 代理**（保证本地与浏览器环境正常工作），仅在显式声明 `VITE_LIVEKIT_DIRECT=true` 时开启直连；
   - **原生 App 端**：**默认直连** Store 中的 `wsUrl`（减少 Nginx 代理开销）；同时保留 `VITE_LIVEKIT_FORCE_PROXY=true` 兜底开关。
   - **原生端代理地址推导**：原生容器内 `location.host` 恒为 `localhost`（指向本地离线 Webview 源，无 Nginx 存在）。因此，**原生端代理兜底地址必须由配置的 API Host 推导**，严禁使用 `location.host`。

#### React Hook 合规调用与实现

在 [`VoiceInterface.tsx`](file:///Users/sunpcm/code/EchoTalk/apps/vite-app/src/components/conversation/VoiceInterface.tsx) 顶部无条件解构 `wsUrl`，避免在 Early Return 后调用 Hook 导致渲染报错：

```typescript
// apps/vite-app/src/components/conversation/VoiceInterface.tsx
import { getApiBaseUrl, detectPlatform } from "@/utils/env";

export function VoiceInterface() {
  // 1. 组件顶层无条件解构 wsUrl（合规避免 React Hook 规则错误）
  const { connectionState, sessionId, token, wsUrl, error, goHome } = useConversationStore();
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState(false);

  // Early returns (idle / connecting / ended)...

  // 2. 解析最终连接 URL（原生默认直连，支持配置降级；Web 默认代理，支持配置直连）
  const isNative = detectPlatform() !== "web";

  // 原生端代理兜底：仅在需要时惰性求值；无有效 API Host 时返回 null，由上层报配置错误，不静默产出 localhost 死地址
  const getNativeProxyWsUrl = (): string | null => {
    try {
      const apiOrigin = new URL(getApiBaseUrl(), location.href).origin;
      return `${apiOrigin.replace(/^http/, "ws")}/livekit-ws`;
    } catch {
      return null;
    }
  };

  const effectiveWsUrl = isNative
    ? (import.meta.env.VITE_LIVEKIT_FORCE_PROXY === "true"
        ? getNativeProxyWsUrl()
        : (wsUrl || import.meta.env.VITE_LIVEKIT_URL))
    : (import.meta.env.VITE_LIVEKIT_DIRECT === "true"
        ? (wsUrl || import.meta.env.VITE_LIVEKIT_URL)
        : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/livekit-ws`);

  // 若 effectiveWsUrl 为 null (如原生强制代理但未配置有效 Host)，不拉起 LiveKitRoom，直接走已有错误卡片提示
  if (!effectiveWsUrl) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <div className="bg-danger-bg text-danger-text w-full max-w-sm rounded-[20px] p-6 text-center text-sm">
          <p className="font-semibold">连接配置错误</p>
          <p className="mt-1">无法获取有效的 WebSocket 服务器地址，请检查 VITE_API_BASE_URL 配置。</p>
        </div>
        <button onClick={goHome} className="btn-primary px-6 py-2.5">
          {tDash.goHome}
        </button>
      </div>
    );
  }

  // ...
}
```

---

### 2.3 真实 JWT 鉴权与分层安全存储 (P0 级门禁)

#### 1. 鉴权门禁 (Gatekeeper)

在向移动端分发（TestFlight 或 APK）之前，必须接入真实 JWT 登录：

- 替换后端 `get_current_user` 的 Mock 行为，无效/缺失 Token 严格返回 `401 Unauthorized`；
- 前端全局 API 拦截器附加 `Authorization: Bearer <token>`，移除硬编码 `mock-token`。

#### 2. 分层 Token 存储架构

- **短效 `access_token`**：仅保存在内存中（Zustand Store），不落盘，杜绝 XSS 窃取风险；
- **长效 `refresh_token`**：
  - **Web 端**：使用 `HttpOnly; Secure; SameSite=Lax` Cookie；
  - **原生 App 端**：使用硬件级加密存储 `@aparajita/capacitor-secure-storage`（iOS 映射到 **Keychain**，Android 映射到 **Keystore**，严禁使用明文的 `@capacitor/preferences` 或 `localStorage`）。

```typescript
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

export async function getNativeRefreshToken(): Promise<string | null> {
  try {
    const res = await SecureStorage.get("echotalk_refresh_token");
    return typeof res === "string" ? res : null;
  } catch {
    return null;
  }
}
```

---

### 2.4 环境感知与 BaseURL 规范解析 (`src/utils/env.ts`)

在 `apps/vite-app/src/utils/env.ts` 中实现严谨的平台判定，**确保原生与 Web 返回一致带有 `/api` 前缀的 BaseURL**，并在 [`apps/vite-app/src/lib/api.ts`](file:///Users/sunpcm/code/EchoTalk/apps/vite-app/src/lib/api.ts) 中通过**惰性求值**接入，避免顶层抛错导致整包白屏：

```typescript
// apps/vite-app/src/utils/env.ts
export type PlatformType = "ios" | "android" | "macos" | "windows" | "web";

export function detectPlatform(): PlatformType {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    return cap.getPlatform() as "ios" | "android";
  }
  if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("win")) return "windows";
    return "macos";
  }
  return "web";
}

export function getApiBaseUrl(): string {
  const platform = detectPlatform();
  const isNative = platform !== "web";

  // 1. 仅在开发环境下允许通过 localStorage 进行本地局域网调试覆盖 (需加 /api)
  if (import.meta.env.DEV) {
    const devHost = localStorage.getItem("dev_server_host");
    if (devHost && /^https?:\/\/.+/.test(devHost)) {
      return `${devHost.replace(/\/+$/, "")}/api`;
    }
  }

  // 2. 生产环境读取注入的 VITE_API_BASE_URL (如 https://api.echotalk.com，自动补齐 /api)
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl && /^https?:\/\/.+/.test(envUrl)) {
    return `${envUrl.replace(/\/+$/, "")}/api`;
  }

  // 3. 原生环境无配置时 Fail-Fast 报警 (在 API 请求时被 catch，不会在首帧加载期让页面变砖)
  if (isNative) {
    throw new Error("[EchoTalk] 原生环境未配置有效的 VITE_API_BASE_URL");
  }

  // 4. Web 端默认相对路径 /api (与 api.ts 路由无缝匹配)
  return "/api";
}
```

```typescript
// apps/vite-app/src/lib/api.ts 接入 (采用惰性求值)
import { getApiBaseUrl } from "@/utils/env";

let cachedBaseUrl: string | null = null;
export function getBaseUrl(): string {
  if (cachedBaseUrl === null) {
    cachedBaseUrl = getApiBaseUrl();
  }
  return cachedBaseUrl;
}

// 在 request/fetch 中调用 getBaseUrl() 拼接子路由 (如 `${getBaseUrl()}/sessions`)
// 异常沿 Promise 链抛出，由现有的 useConversationStore 错误卡片优雅展示
```

---

### 2.5 实时语音硬件控制与弱网/中断恢复

#### 1. iOS 音频会话与来电中断恢复 (`AppDelegate.swift`)

```swift
import AVFoundation

func configureAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
        try session.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
        )
        try session.setActive(true)
    } catch {
        print("[AudioSession] 配置失败: \(error)")
    }

    // 监听来电与音频中断恢复
    NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification,
        object: nil,
        queue: .main
    ) { notification in
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        if type == .ended {
            try? session.setActive(true)
        }
    }
}
```

#### 2. 弱网切换 (WiFi ↔ 蜂窝网络) 与重连机制

- 依赖 LiveKit SDK 内置的 ICE 自动重启与信令重连机制；
- 前端监听 `RoomEvent.Reconnecting` 与 `RoomEvent.Reconnected`，展示全屏轻量重连 Toast，避免用户误判为崩溃。

#### 3. Android 14+ 麦克风前台服务合规

```xml
<!-- AndroidManifest.xml -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />

<service
    android:name=".VoiceForegroundService"
    android:foregroundServiceType="microphone"
    android:exported="false" />
```

---

### 2.6 OTA 热更新方案与风险防范 (Capacitor Live Update)

基于 `@capgo/capacitor-updater` 实现前端秒级热修复，但必须满足以下四大安全与合规红线：

1. **Apple 审核指南 2.5.2 / 3.3.1 合规边界**：OTA 仅用于修复 Bug、文案纠正与 UI 微调，**严禁通过热更新引入未送审的全新功能模块**，否则面临 App 下架风险。
2. **Bundle 完整性与防篡改**：全链路强制 HTTPS，下发的 `dist.zip` 必须包含 SHA256 校验和与 RSA 公钥签名验签机制，杜绝中间人攻击。
3. **原生插件版本门禁 (`minNativeVersion`)**：热更新包如果调用了新原生插件 API，必须设置最低原生版本门禁，旧版壳自动忽略更新并提示前往应用商店更新。
4. **服务部署模式**：开发期可使用 Capgo 官方云服务，生产环境推荐基于自建 S3/MinIO 与简单版本接口托管静态 Bundle。

---

### 2.7 平台合规与上架要求矩阵

| 平台              | 核心合规项                                                                | 落地措施                                                                                         |
| :---------------- | :------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------- |
| **iOS App Store** | • 账号注销入口 (5.1.1(v))<br>• 麦克风用途说明<br>• 隐私政策与数据收集清单 | • 设置抽屉中提供“注销账户”入口<br>• `Info.plist` 详述用途：“EchoTalk 需要麦克风进行实时口语纠错” |
| **Google Play**   | • Android 14 麦克风前台服务声明<br>• 目标 API 等级 (Target SDK 34+)       | • 常驻通知栏显式展示“EchoTalk 正在进行口语对练”                                                  |
| **国内应用市场**  | • ICP 备案<br>• 软件著作权 (软著)<br>• 首次启动隐私协议授权弹窗           | • 首次启动前拦截所有原生 SDK 初始化，用户点击同意后方可继续                                      |

---

### 2.8 构建产物流水线与环境变量契约

#### 1. 单一产物、三端分发

```text
apps/vite-app/  ──pnpm build──▶  dist/
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
   Nginx 静态托管            cap sync (webDir)         Tauri frontendDist
   (Web，同源 /api)      apps/mobile-app/ios|android     apps/desktop-app
        │                         │                         │
   .env.web                  .env.native               .env.native
   (无 VITE_API_BASE_URL)    (绝对 Host)               (绝对 Host)
```

**关键约束**：Web 端依赖同源相对路径 `/api`，原生端依赖绝对 Host。二者互斥，**必须用不同的构建模式产出**，不能共用一份 `.env`：

```bash
pnpm --filter vite-app build                  # Web：走 .env.production，不注入 VITE_API_BASE_URL
pnpm --filter vite-app build --mode native    # 原生：走 .env.native，注入绝对 Host
```

> ⚠️ 若原生构建误用了 Web 的 env，`getApiBaseUrl()` 会落到 §2.4 第 4 分支返回 `/api`，请求打到本地虚拟源并静默 404——这是最容易误判为「后端挂了」的故障。原生构建后建议校验 `dist/assets/*.js` 中确实包含目标 Host 字符串。

#### 2. 环境变量清单

| 变量                       | 适用端       | 默认    | 说明                                                            |
| :------------------------- | :----------- | :------ | :-------------------------------------------------------------- |
| `VITE_API_BASE_URL`        | 原生（必填） | 无      | 只填 origin，不含 `/api`；缺失时原生端 Fail-Fast（§2.4）        |
| `VITE_LIVEKIT_DIRECT`      | Web（可选）  | `false` | 置 `true` 时 Web 端绕过 `/livekit-ws` 直连（§2.2）              |
| `VITE_LIVEKIT_FORCE_PROXY` | 原生（可选） | `false` | 置 `true` 时原生端降级走 Nginx 代理，用于直连受阻的网络（§2.2） |
| `VITE_LIVEKIT_URL`         | 原生（兜底） | 无      | store 中 `wsUrl` 缺失时的静态兜底地址                           |
| `LIVEKIT_URL`              | 后端 / Nginx | 无      | 已存在；后端签发 token 时随 `ws_url` 下发                       |

---

### 2.9 应用生命周期与前后台恢复

Web 端页面常驻，原生端则会被系统挂起——现有代码里有两处依赖「JS 持续运行」的假设，切后台即失效：

| 受影响能力                          | 后台时行为                                                            | 恢复策略                                                                             |
| :---------------------------------- | :-------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| `usePollingAssessment` 指数退避轮询 | iOS 挂起 WebView JS，`setTimeout` 停摆；15 次重试可能在前台永远走不完 | 监听 `appStateChange`，回前台时若 `loadState` 仍为加载中则重置退避计数并立即重试一次 |
| LiveKit 房间连接                    | 未开启后台音频时连接被系统回收，回前台后 UI 仍显示 `active`           | 回前台校验 `room.state`，已断开则显式切到 `ended` 并提示重新开始，避免「假在线」     |

```typescript
import { App } from "@capacitor/app";

App.addListener("appStateChange", ({ isActive }) => {
  if (isActive) {
    // 回前台：重新校准轮询与房间状态
  }
});
```

> 开启 §2.5 的后台音频模式后，LiveKit 连接可在后台保活，但轮询计时器仍会被限流——两个问题需要分别处理。

---

### 2.10 数据存储分层

| 数据                      | 存储位置                                          | 跨端差异                                    | 备注                                                        |
| :------------------------ | :------------------------------------------------ | :------------------------------------------ | :---------------------------------------------------------- |
| `access_token`            | 内存（Zustand）                                   | 一致                                        | 不落盘（§2.3）                                              |
| `refresh_token`           | Web: HttpOnly Cookie<br>原生: Keychain / Keystore | 实现完全不同                                | §2.3                                                        |
| 界面主题 `echotalk-theme` | localStorage                                      | 原生 WebView 数据可能被系统在存储紧张时清理 | 丢失仅回退默认暖色，可接受；长期方案见 `TODO.md` 后端持久化 |
| `dev_server_host`         | localStorage                                      | 仅 DEV 构建读取                             | §2.4                                                        |
| 用户设置 / BYOK 密钥      | 后端 `user_settings`                              | 一致                                        | 密钥不落前端                                                |
| OTA bundle                | 原生沙盒                                          | 仅原生                                      | §2.6                                                        |

> **原则**：凡是丢失后会导致「用户需要重新登录」或「数据不可恢复」的内容，一律不放 WebView 的 localStorage。

---

### 2.11 平台能力支持矩阵

| 能力                   |   Web    |    iOS    |  Android  |     macOS     | Windows |
| :--------------------- | :------: | :-------: | :-------: | :-----------: | :-----: |
| 实时语音对练 (LiveKit) |    ✅    |    ✅     |    ✅     | ⚠️ Spike 待验 |   ✅    |
| 发音评估 / 技能树      |    ✅    |    ✅     |    ✅     |      ✅       |   ✅    |
| DocTalk 文档上传       |    ✅    |  ⚠️ 见下  |  ⚠️ 见下  |      ✅       |   ✅    |
| 后台 / 锁屏对练        |    ❌    | ✅ (§2.5) | ✅ (§2.5) |      ✅       |   ✅    |
| OTA 热更新             | 天然具备 |    ✅     |    ✅     |      ❌       |   ❌    |
| 全局快捷键 / 托盘      |    ❌    |    ❌     |    ❌     | ✅ (Spike后)  |   ✅    |

#### DocTalk 文件选择的跨端差异

现有实现为 `<input type="file" accept=".txt,.md,.markdown">`（[`DocUploadCard.tsx:68`](file:///Users/sunpcm/code/EchoTalk/apps/vite-app/src/components/doc-chat/DocUploadCard.tsx#L68)），文件内容在前端读取为文本后随 `doc_context` 提交，**不经过上传接口**。跨端风险：

- **iOS**：文件选择器按 UTI 过滤，`.md` / `.markdown` 无标准 UTI 映射，可能导致目标文件在选择器中呈灰色不可选；
- **Android**：WebView 的 `onShowFileChooser` 由 Capacitor 接管，`.md` 通常可选，但部分文件管理器行为不一致。

处理方式二选一：放宽为 `accept="text/*"` 并在读取后做扩展名校验（改动最小），或在原生端改用 `@capacitor/filesystem` 的原生选择器。**建议在第 0 步浏览器预验证时一并确认 iOS 的实际表现**，再决定投入。

---

## 3. 实施演进路线图与验收标准 (Roadmap & Acceptance Criteria)

### 3.0 交付工作量评估与推进顺序 (Effort & Sequencing)

> **移动端设计稿**：[EchoTalk 移动端界面](https://claude.ai/code/artifact/21051810-7621-4626-ae2f-2554079ac4fc)
> —— 首页、设置 Bottom Sheet、会话页折叠、空态与错误态、移动端规格，共 5 块画板。
> 样式取自 `packages/configs/tailwind-config/theme-tokens.css`，未引入新色值。
> 该链接为过渡产物，落地进代码后以组件源码为准。

> **本节结论**：移动端「真机跑通」iOS 单端 **4~6 人日**，iOS + Android **6~8 人日**（日历约 1.5~2 周）。
> 「可对外分发」在此之上另需 **7~11 人日**。估算前提：1 名熟悉本仓库的开发者、已有 Mac 与真机、Apple 开发者账号就绪。

#### 第 0 步：浏览器预验证（0.25 人日，不写任何代码）

[`vite.config.ts`](file:///Users/sunpcm/code/EchoTalk/apps/vite-app/vite.config.ts) 已配置 `basicSsl()` 与 `server.host: true`，因此可直接用手机浏览器访问 `https://<局域网IP>:5173`（自签证书，手机端手动信任），`/api` 与 `/livekit-ws` 两个代理照常工作。

该步骤零成本验证三个最大未知数：

1. 手机 Safari 的 `getUserMedia` + LiveKit 通话能否跑通（iOS WKWebView 与 Safari 同内核，此关通过则 Capacitor 基本无阻）；
2. 目标网络下 LiveKit Cloud 是否可直连（即 §2.2 的核心前提假设）；
3. 现有布局在 6 寸屏的实际可用度——直接决定下方任务 6 的工作量区间。

- _验收标准_：手机浏览器完成一次完整语音对话；记录直连是否可达、布局问题清单。
- **⚠️ 前置约束**：第 0 步不通过，则后续所有 Capacitor 工作无意义，必须先解决。本步骤同时是 9.0.1 Spike 的低成本前置。

#### Tier A：真机跑通（内部可用，不对外分发）

| #   | 任务                                                                                  | 人日        | 说明                          |
| :-- | :------------------------------------------------------------------------------------ | :---------- | :---------------------------- |
| 1   | CORS 放行 + `env.ts` + `getApiBaseUrl()` 接入 `api.ts`                                | 0.5         | 见 §2.1 / §2.4                |
| 2   | LiveKit `wsUrl` 路由改造 + `FORCE_PROXY` 兜底                                         | 0.5         | 见 §2.2                       |
| 3   | Capacitor 工程接入（config、webDir 指向 vite dist、pnpm/turbo 脚本、`cap sync` 流程） | 0.5~1       | Monorepo 路径调整，琐碎但不难 |
| 4   | iOS 原生：`Info.plist` 权限 + `AVAudioSession` + 真机签名跑通                         | 1           | 首次配置签名易卡住            |
| 5   | Android 原生：Manifest 权限 + 运行时权限请求 + 导出 APK                               | 0.5~1       | 前台服务留到 9.4              |
| 6   | **Safe Area + 移动端布局适配**                                                        | **1.5~2.5** | 详见下方，最易低估            |
| 7   | 真机联调缓冲（白屏 / 权限 / 音频 / 网络）                                             | 1~1.5       | 经验值，不建议压缩            |

**合计：iOS 单端 4~6 人日；iOS + Android 6~8 人日**（Android 复用 iOS 成果，增量集中在权限与调试）。

#### 关于任务 6：移动端布局适配的现状基线

当前 `apps/vite-app/src` 共 2008 行 TSX，**仅 4 处响应式断点**：

| 文件                 | 行数  | 断点数 |
| :------------------- | :---- | :----- |
| `SettingsDrawer.tsx` | 406   | **0**  |
| `VoiceInterface.tsx` | 390   | 3      |
| 其余 11 个组件       | ~1200 | 1      |

该 UI 按桌面端编写。布局以 `space-y` + 流式卡片为主，**不会崩溃但会拥挤**；§1 承诺的「移动端 Bottom Sheet」「VoiceInterface 上下折叠」需实际开发，其中零断点的 406 行设置抽屉是主要成本。

**这是整个估算中唯一可主动缩放的杠杆**：若第 0 步结论为「凑合可用」，本项可压缩至 1 人日（仅做 safe-area 与关键触控区）；要达到 §1 描述的完整形态则为 2.5 人日。

#### Tier B：可对外分发（TestFlight / 应用商店）

§2.3 已将真实 JWT 设为分发硬门禁，该部分在 Tier A 之上另计：

| 任务                                           | 人日    | 备注                                                                                                                                  |
| :--------------------------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------------ |
| 真实 JWT 端到端                                | **4~6** | 前端当前**无任何登录 UI**（`components/` 下无 auth 目录），需从零实现登录/注册页 + Token 刷新 + SecureStorage。属产品功能而非接线工作 |
| Nginx TLS + 域名 + 证书                        | 0.5~1   | iOS ATS 硬要求，见 §2.1                                                                                                               |
| 图标 / 启动屏 / 应用名 / 版本号                | 0.5     |                                                                                                                                       |
| 合规落地（隐私政策页、账号注销入口、权限文案） | 1~2     | 见 §2.7                                                                                                                               |
| 首次提交 TestFlight / Play Console             | 1~2     | 不含审核等待时间                                                                                                                      |

**合计：+7~11 人日。**

#### 外部前置项（不消耗工时，但拖长日历，需尽早启动）

| 事项                            | 周期                                    | 影响                                                                  |
| :------------------------------ | :-------------------------------------- | :-------------------------------------------------------------------- |
| Apple 开发者账号                | 个人 1~3 天；公司（需邓白氏编码）2~4 周 | 无账号无法进行稳定真机调试（免费账号证书 7 天过期）                   |
| 国内上架资质（软著 / ICP 备案） | 软著 30~60 天                           | 若国内商店在计划内，这是最长前置项                                    |
| 目标网络 LiveKit 可达性         | 第 0 步即可测出                         | 若不可达，需在生产 Nginx 落地 LiveKit 代理（+1~2 人日）并重估带宽成本 |

#### 建议推进顺序与里程碑

```text
Day 0.5    第 0 步：手机浏览器预验证        ← 结论决定后续排期
Day 1-2    任务 1 + 2 + 3（前端接线 + Capacitor 壳）
Day 3-4    任务 4（iOS 真机跑通）           ← 里程碑 M1：移动端正常运行
Day 5-6    任务 6（移动端布局适配）
Day 7-8    任务 5（Android）+ 任务 7（联调缓冲）
```

- **里程碑 M1（Day 4）**：iPhone 真机安装 App，完成一轮完整英语对话。这是第一个可演示成果。
- Tier B 的 7~11 人日建议在 M1 拿到实际反馈后再排期，避免过早投入登录体系。

#### 待确认项（影响上述估算）

- [ ] Apple 开发者账号是否已就绪？若未申请，建议立即启动，等待期正好用于第 0 步与任务 1~3。
- [ ] 本轮范围为 iOS 单端还是 iOS + Android 双端？

---

### 阶段 9.0：双端 Spike 探针验证 (1~2天)

- [ ] **[9.0.0 CORS 预配置]** 在 [`backend/config.py`](file:///Users/sunpcm/code/EchoTalk/backend/config.py) 放行 `capacitor://localhost` 与 `tauri://localhost`。
- [ ] **[9.0.1 iOS Capacitor Spike]** 使用空壳工程装载当前 `vite-app/dist`，在 iOS 模拟器/真机上验证 `getUserMedia` 录音与 LiveKit WebRTC 通话。
  - _验收标准 1_：真机在目标网络环境下**直连 `wss://*.livekit.cloud` 建连成功**；若受阻，验证通过代理路径降级连通。
  - _验收标准 2_：真机麦克风波形正常跳动，能正常听到 LiveKit Agent 回复。
- [ ] **[9.0.2 macOS WKWebView Spike]** 使用 Tauri 最小壳验证 macOS WKWebView 下 LiveKit 的 WebRTC 连接与 AEC 回声消除表现。
  - _验收标准_：输出 macOS WKWebView WebRTC 兼容性报告，确定桌面端技术可行性。

---

### 阶段 9.1：连通性、安全门禁与网络就绪 (Phase 9.1)

- [ ] **[真实 JWT 门禁]** 后端替换 `get_current_user` Mock，前端移除 `mock-token`，接入真实登录态与内存 Token 注入。
  - _验收标准_：无 Token / 过期 Token 请求返回 401；登录后携带真实 Bearer Token 请求成功。
- [ ] **[Nginx TLS 配置]** 在 Nginx 补齐 HTTPS (443) 与 SSL 证书配置，满足 iOS ATS 规范。
  - _验收标准_：iOS 真机通过 `https://` 与 `wss://` 完成一次完整会话。
- [ ] **[BaseURL 接入]** 实现 `src/utils/env.ts` 并通过惰性 `getBaseUrl()` 接入 [`apps/vite-app/src/lib/api.ts`](file:///Users/sunpcm/code/EchoTalk/apps/vite-app/src/lib/api.ts)。
  - _验收标准_：原生 App 容器内所有 API 请求正确拼装 `/api` 并派发到配置的后端 Host，无 404 错误。
- [ ] **[LiveKit 路由适配]** [`VoiceInterface.tsx`](file:///Users/sunpcm/code/EchoTalk/apps/vite-app/src/components/conversation/VoiceInterface.tsx) 改为顶层读取 Store 中的 `wsUrl`，Web 端保留 `/livekit-ws` 代理。
  - _验收标准_：原生端直连 LiveKit Cloud，信令不再穿透自建 Nginx（以 9.0.1 Spike 结论为准，若直连受阻则验收降级路径连通性）；Web 端默认代理正常工作。
- [ ] **[Safe Area 适配]** `index.html` 补充 `viewport-fit=cover`，根容器补充 `env(safe-area-inset-*)`。
  - _验收标准_：iPhone 灵动岛和底部 Home 横条不遮挡界面内容。

---

### 阶段 9.2：移动端 (iOS / Android) 交付 (Phase 9.2)

- [ ] 初始化 `apps/mobile-app` Capacitor 工程。
- [ ] iOS 原生配置：`Info.plist` 权限描述、`AVAudioSession` 通话配置、集成 `@aparajita/capacitor-secure-storage`。
- [ ] Android 原生配置：`AndroidManifest.xml` 权限、网络安全配置与前台服务。
- [ ] 接入 `@capgo/capacitor-updater` 配置热更新通道与验签。
  - _验收标准_：导出 iOS Xcode 归档与 Android Release APK，真机完整完成一次 5 分钟口语会话与发音评估。

---

### 阶段 9.3：桌面端 (macOS / Windows) 交付 (Phase 9.3)

- [ ] 基于 9.0.2 Spike 结论，初始化 `apps/desktop-app` (Tauri 2.0)。
- [ ] 配置 macOS Entitlements 麦克风录音权限。
- [ ] 实现系统托盘与全局快捷键静音/对讲。
  - _验收标准_：生成 macOS `.dmg` 与 Windows `.exe` 安装包，本地安装运行无报错。

---

### 阶段 9.4：后台音频增强与 CI/CD 自动化 (Phase 9.4)

- [ ] iOS Background Audio Mode 完善与 Android 14+ 麦克风前台服务通知。
- [ ] GitHub Actions 配置多平台自动化构建流水线。
  - _验收标准_：Git Tag 触发后自动产出 APK、IPA 与桌面端 Release 产物。
