# Phase 1 前端 — 技术栈说明

> Phase 1 前端完整内容：Vite + React SPA、LiveKit 实时语音 UI、zustand 状态管理、API 客户端封装、i18n 字符串集中管理。

---

## 1. 目录结构

```
apps/vite-app/                           # Vite React 前端
├── vite.config.ts                       # Vite 配置（代理、别名、构建）
├── tsconfig.json                        # TypeScript 严格模式配置
├── package.json                         # 依赖清单
├── index.html                           # SPA 入口 HTML
└── src/
    ├── index.tsx                         # React 挂载入口
    ├── App.tsx                           # 根组件（渲染 VoiceInterface）
    ├── lib/
    │   └── api.ts                        # 后端 API 客户端封装
    ├── i18n/
    │   └── zh-CN.ts                      # 中文字符串集中映射
    ├── store/
    │   └── conversation.ts               # zustand 对话状态管理
    └── components/
        └── conversation/
            └── VoiceInterface.tsx         # 语音对话核心组件
```

---

## 2. 技术栈清单

| 技术                           | 版本               | 用途                                          |
| ------------------------------ | ------------------ | --------------------------------------------- |
| React                          | 19                 | UI 框架                                       |
| TypeScript                     | 5.x（严格模式）    | 类型安全                                      |
| Vite                           | 7.3+               | 开发服务器 + 构建工具                         |
| Tailwind CSS                   | v4                 | 样式（CSS-first 配置）                        |
| **zustand**                    | **5.0+**           | **对话状态管理（轻量 store）**                |
| **livekit-client**             | **2.17+**          | **LiveKit WebRTC 客户端 SDK**                 |
| **@livekit/components-react**  | **2.9+**           | **LiveKit React 组件（Room、Visualizer 等）** |
| **@livekit/components-styles** | **1.2+**           | **LiveKit 默认样式**                          |
| @vitejs/plugin-react           | 5.1+               | Vite React 插件（Fast Refresh）               |
| ESLint                         | 9.x（flat config） | 代码质量检查                                  |
| pnpm                           | workspace          | Monorepo 包管理                               |

---

## 3. 核心模块说明

### 3.1 API 客户端 (`src/lib/api.ts`)

统一封装所有对 FastAPI 后端的请求：

| 函数                         | 方法 | 路径                       | 说明                  |
| ---------------------------- | ---- | -------------------------- | --------------------- |
| `createSession(mode)`        | POST | `/api/sessions`            | 创建练习会话          |
| `getSessionToken(sessionId)` | GET  | `/api/sessions/{id}/token` | 获取 LiveKit 房间令牌 |
| `endSession(sessionId)`      | POST | `/api/sessions/{id}/end`   | 结束会话              |

- 通用 `request<T>()` 封装：自动添加 `Authorization` header、统一错误处理
- Mock 鉴权：硬编码 `Bearer mock-token`（TODO: 后续接入真实 JWT）
- Vite dev server 代理 `/api` → `http://localhost:8000`，无跨域问题

### 3.2 状态管理 (`src/store/conversation.ts`)

使用 zustand 管理对话生命周期，4 状态机：

```
idle → connecting → active → ended
 ↑                              |
 └──────── reset ───────────────┘
```

| 状态         | 含义                           | 触发动作                              |
| ------------ | ------------------------------ | ------------------------------------- |
| `idle`       | 初始待命                       | 页面加载 / `reset()`                  |
| `connecting` | 创建会话 + 获取 token 中       | `startSession(mode)`                  |
| `active`     | LiveKit 房间已连接，语音对话中 | `setActive()`（LiveKit 连接成功回调） |
| `ended`      | 对话已结束                     | `endSession()`                        |

Store 字段：`connectionState`, `sessionId`, `token`, `wsUrl`, `error`。

### 3.3 语音对话组件 (`src/components/conversation/VoiceInterface.tsx`)

根据 `connectionState` 渲染 4 个子视图：

| 子组件                       | 渲染条件                            | 功能                               |
| ---------------------------- | ----------------------------------- | ---------------------------------- |
| `IdleView`                   | `idle`                              | "开始练习"按钮 + 错误提示          |
| `ConnectingView`             | `connecting`（无 token）            | loading 动画                       |
| `LiveKitRoom` + `ActiveView` | `connecting`（有 token）或 `active` | LiveKit 房间 + 语音可视化 + 控制栏 |
| `EndedView`                  | `ended`                             | "再来一次"按钮                     |

**ActiveView 内部**使用 LiveKit React SDK：

- `useConnectionState()` — 监听 LiveKit 连接状态
- `useVoiceAssistant()` — 获取 Agent 音频轨道和状态
- `BarVisualizer` — 7 条音频可视化
- `VoiceAssistantControlBar` — 麦克风静音等控制
- `RoomAudioRenderer` — 播放 Agent 语音

### 3.4 i18n 字符串 (`src/i18n/zh-CN.ts`)

所有中文 UI 文案集中管理，便于后续接入 react-i18next：

```typescript
export const zhCN = {
  conversation: {
    title: "AI 英语口语练习",
    startButton: "开始练习",
    endButton: "结束对话",
    // ... 全部 13 个字符串
  },
} as const;
```

---

## 4. 关键设计决策

1. **Vite SPA（非 Next.js）**：项目 monorepo 已有 Vite + Webpack 两个 React SPA，Phase 1 选择 Vite app 作为开发目标。
2. **zustand 状态管理**：比 Redux 轻量，API 简洁，无 boilerplate。4 状态机清晰表达对话生命周期。
3. **LiveKit React SDK**：使用官方 `@livekit/components-react` 提供的 hooks 和组件，避免手动管理 WebRTC 连接。
4. **Vite 代理**：开发环境 `/api` 请求代理到 `http://localhost:8000`，无需处理 CORS。
5. **i18n 集中管理**：所有中文字符串抽取到 `zh-CN.ts`，标记 `TODO: i18n`，为后续国际化做准备。
6. **Mock 鉴权**：API 客户端硬编码 `Bearer mock-token`，与后端 `dependencies.py` 的 mock 用户匹配。

---

## 5. 数据流

```
用户点击"开始练习"
  → store.startSession("conversation")
    → API: POST /api/sessions          → 创建会话
    → API: GET /api/sessions/{id}/token → 获取 LiveKit token + ws_url
    → store: connectionState = "connecting", token/wsUrl 就绪
  → VoiceInterface 渲染 <LiveKitRoom>
    → LiveKit SDK 连接到 ws_url
    → ↳ useConnectionState() === Connected
    → ↳ store.setActive()              → connectionState = "active"
    → ↳ useVoiceAssistant() 获取 Agent 音频
  → 用户语音 → STT → LLM → TTS → Agent 语音回复（全部在 LiveKit 服务端完成）
  → 用户点击"结束对话"
    → store.endSession()
      → API: POST /api/sessions/{id}/end
      → store: connectionState = "ended"
```
