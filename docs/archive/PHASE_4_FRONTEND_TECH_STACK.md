# Phase 4 前端技术文档 — 自适应课程推荐 Dashboard

## 概述

Phase 4 前端将应用从单一语音对话界面改造为 **Dashboard + Session** 双视图架构，新增自适应课程推荐卡片、每日练习进度追踪，并与 Phase 2 的技能树集成，形成完整的学习闭环。

## 架构设计

### 视图状态机

使用 Zustand store 中的 `appView` 字段驱动顶层视图切换，无需引入 react-router：

```
                        ┌────────────────────────┐
                        │   appView: "dashboard"  │
                        │                        │
                        │  ┌──────────────────┐  │
                        │  │ RecommendedScen. │  │
                        │  │   [进入练习]      │──┼──┐
                        │  └──────────────────┘  │  │
                        │  ┌──────────────────┐  │  │
                        │  │  DailyProgress   │  │  │
                        │  └──────────────────┘  │  │
                        │  ┌──────────────────┐  │  │
                        │  │    SkillTree     │  │  │
                        │  └──────────────────┘  │  │
                        └────────────────────────┘  │
                                                    │ setSelectedScenario()
                                                    │ startSession("scenario")
                                                    │ → appView = "session"
                                                    │ → connectionState = "connecting"
                                                    ▼
                        ┌────────────────────────┐
                        │   appView: "session"    │
                        │                        │
                        │   connectionState:     │
                        │   connecting → active  │
                        │   → ended              │
                        │                        │
                        │   ended 时自动展示:     │
                        │   - PronunciationFeedback │
                        │   - SkillTree          │
                        │   - [返回主页] 按钮     │
                        └───────────┬────────────┘
                                    │
                                    │ goHome()
                                    │ → 重置 conversation + assessment store
                                    │ → appView = "dashboard"
                                    ▼
                              回到 Dashboard
                        (组件重新挂载，数据自动刷新)
```

### 状态字段说明

| 字段               | 类型                                            | 说明               |
| ------------------ | ----------------------------------------------- | ------------------ |
| `appView`          | `"dashboard" \| "session"`                      | 顶层视图选择       |
| `connectionState`  | `"idle" \| "connecting" \| "active" \| "ended"` | LiveKit 连接状态   |
| `selectedScenario` | `CurriculumRecommendation \| null`              | 用户选中的推荐场景 |
| `sessionId`        | `string \| null`                                | 当前会话 ID        |
| `token` / `wsUrl`  | `string \| null`                                | LiveKit 连接凭证   |

### 关键 Action

| Action               | 触发时机         | 状态变化                                |
| -------------------- | ---------------- | --------------------------------------- |
| `startSession(mode)` | 点击"进入练习"   | `idle/dashboard` → `connecting/session` |
| `setActive()`        | LiveKit 连接成功 | `connecting` → `active`                 |
| `endSession()`       | 点击"结束对话"   | `active` → `ended`                      |
| `goHome()`           | 点击"返回主页"   | 全部重置 → `idle/dashboard`             |

## 组件结构

```
App.tsx
├── Dashboard (appView === "dashboard")
│   ├── RecommendedScenarios  ← GET /api/curriculum/next
│   ├── DailyProgress         ← GET /api/sessions + 详情聚合
│   └── SkillTree             ← GET /api/assessments/knowledge/states
│
└── VoiceInterface (appView === "session")
    ├── ConnectingView        (connectionState: connecting, 无 token)
    ├── LiveKitRoom + ActiveView  (connecting 有 token / active)
    └── EndedView             (connectionState: ended)
        ├── PronunciationFeedback
        ├── SkillTree
        └── [返回主页]
```

## 新增 API 客户端方法

| 方法                         | 端点                       | 说明                   |
| ---------------------------- | -------------------------- | ---------------------- |
| `getRecommendedCurriculum()` | `GET /api/curriculum/next` | 获取自适应课程推荐     |
| `listSessions()`             | `GET /api/sessions`        | 列出用户所有会话       |
| `getSessionDetail(id)`       | `GET /api/sessions/{id}`   | 获取会话详情（含转录） |

## 新增 TypeScript 类型

- `CurriculumRecommendation` — 单个推荐场景
- `CurriculumNextResponse` — 推荐响应（含 weakest_skill、target_level）
- `SessionListItem` — 会话列表项（不含转录）
- `AppView` — 视图枚举类型

## DailyProgress 数据流

1. 组件挂载 → `listSessions()` 获取全部会话
2. 前端过滤当日已完成会话（`status === "completed"` + `started_at` 日期匹配）
3. 对每个今日会话调用 `getSessionDetail(id)` 获取转录记录
4. 聚合 `transcripts.length` 计算总轮次
5. 渲染进度条：`totalTurns / 20`，达标时变绿 + 显示 "Goal reached!"

## i18n

所有新增中文文案集中在 `zhCN.dashboard` 命名空间下，包括：

- 推荐标题、难度、技能标签
- 进度条文案、目标达成提示
- 加载/错误/空状态文案
- 导航按钮文案（进入练习、返回主页）

## 技术选型说明

| 决策     | 选择                        | 理由                                                                    |
| -------- | --------------------------- | ----------------------------------------------------------------------- |
| 路由方案 | Zustand `appView` 条件渲染  | 仅两个视图，无需引入 react-router                                       |
| 数据刷新 | 组件卸载/重挂载             | Dashboard 切走时卸载，返回时 useEffect 自动重新请求                     |
| 状态归属 | conversation store 扩展     | `appView` 与 `connectionState` 强耦合，放在同一 store 减少跨 store 协调 |
| 样式方案 | TailwindCSS utility classes | 与项目现有方案一致，CEFR 等级色彩编码                                   |
