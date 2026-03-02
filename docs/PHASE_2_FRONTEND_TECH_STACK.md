# Phase 2 前端 — 技术栈说明

> Phase 2 前端新增内容：发音评估结果可视化、语法错误反馈、BKT 技能掌握度展示、评估轮询机制。

---

## 1. 目录结构（Phase 2 新增部分）

```
apps/vite-app/src/
├── lib/
│   └── api.ts                                    ← 扩展：ApiError 类 + 评估类型 + 4 个 API 函数
├── i18n/
│   └── zh-CN.ts                                  ← 扩展：assessment 字符串集
├── store/
│   ├── conversation.ts                           （Phase 1，未改动）
│   └── assessment.ts                             ← 新建：评估数据 zustand store
├── hooks/
│   └── usePollingAssessment.ts                   ← 新建：指数退避轮询 Hook
└── components/
    ├── conversation/
    │   └── VoiceInterface.tsx                    ← 扩展：EndedView 集成评估展示
    ├── pronunciation/
    │   ├── PhonemeVisualizer.tsx                 ← 新建：音素序列彩色可视化
    │   └── PronunciationFeedback.tsx             ← 新建：得分 + 音素 + 语法反馈
    └── learning/
        └── SkillTree.tsx                         ← 新建：技能掌握度进度条
```

---

## 2. 技术栈清单

| 技术                       | 版本               | 用途                            |
| -------------------------- | ------------------ | ------------------------------- |
| React                      | 19                 | UI 框架                         |
| TypeScript                 | 5.x（严格模式）    | 类型安全                        |
| Vite                       | 7.3+               | 开发服务器 + 构建工具           |
| Tailwind CSS               | v4                 | 样式（CSS-first 配置）          |
| zustand                    | 5.0+               | 对话 + 评估状态管理             |
| livekit-client             | 2.17+              | LiveKit WebRTC 客户端 SDK       |
| @livekit/components-react  | 2.9+               | LiveKit React 组件              |
| @livekit/components-styles | 1.2+               | LiveKit 默认样式                |
| @vitejs/plugin-react       | 5.1+               | Vite React 插件（Fast Refresh） |
| ESLint                     | 9.x（flat config） | 代码质量检查                    |
| pnpm                       | workspace          | Monorepo 包管理                 |

> Phase 2 前端未引入新依赖，所有新功能基于现有技术栈实现。

---

## 3. 核心模块说明（Phase 2 新增）

### 3.1 API 客户端扩展 (`src/lib/api.ts`)

**新增 `ApiError` 类**：携带 HTTP 状态码，支持轮询逻辑区分 404 与其他错误。

| 函数                          | 方法 | 路径                                | 说明             |
| ----------------------------- | ---- | ----------------------------------- | ---------------- |
| `getAssessment(sessionId)`    | GET  | `/api/assessments/{id}`             | 获取发音评估结果 |
| `getGrammarErrors(sessionId)` | GET  | `/api/assessments/{id}/grammar`     | 获取语法错误列表 |
| `getKnowledgeStates()`        | GET  | `/api/assessments/knowledge/states` | 获取知识状态     |
| `getSkills()`                 | GET  | `/api/assessments/knowledge/skills` | 获取技能定义     |

**新增 5 个 TypeScript 接口**：`PhonemeAlignmentItem`、`AssessmentResponse`、`GrammarErrorResponse`、`KnowledgeStateResponse`、`SkillResponse`，完全镜像后端 Pydantic schema。

### 3.2 评估状态管理 (`src/store/assessment.ts`)

独立的 zustand store，管理评估数据生命周期：

```
idle → polling → loaded
              ↘ error
```

| 状态      | 含义                       | 触发条件                 |
| --------- | -------------------------- | ------------------------ |
| `idle`    | 初始状态                   | 页面加载 / `reset()`     |
| `polling` | 正在获取评估数据或等待重试 | `fetchAssessment()` 发起 |
| `loaded`  | 数据加载完成               | API 返回 200             |
| `error`   | 加载失败（非 404 错误）    | API 返回非 404 错误      |

Store 字段：`loadState`、`assessment`、`grammarErrors`、`knowledgeStates`、`error`。

### 3.3 轮询 Hook (`src/hooks/usePollingAssessment.ts`)

自定义 Hook，在 `sessionId` 非空时自动获取评估数据：

- 首次立即请求
- 404 → 指数退避重试（1s, 2s, 4s, 8s, 10s 封顶，最多 15 次）
- 200 → 停止轮询，触发知识状态获取
- 其他错误 → 停止轮询，标记 error
- 组件卸载自动清理计时器

### 3.4 PhonemeVisualizer (`src/components/pronunciation/PhonemeVisualizer.tsx`)

纯展示组件，接收 `phoneme_alignment` 数组，渲染音素彩色序列：

| 类型           | 颜色         | 含义     |
| -------------- | ------------ | -------- |
| `correct`      | 绿色         | 发音正确 |
| `substitution` | 红色         | 音素替换 |
| `deletion`     | 红色虚线边框 | 音素缺失 |
| `insertion`    | 琥珀色       | 多余音素 |

Hover 时显示 CSS-only Tooltip，展示具体错误信息（如"替换：期望 θ，实际 s"）。

### 3.5 PronunciationFeedback (`src/components/pronunciation/PronunciationFeedback.tsx`)

综合反馈组件，三区域布局：

1. **得分区**：`XX/100`，颜色编码（≥80 绿 / 60-79 黄 / <60 红）
2. **音素区**：嵌入 PhonemeVisualizer
3. **语法区**（条件渲染）：语法错误列表，含 skill_tag 标签和错误原文

### 3.6 SkillTree (`src/components/learning/SkillTree.tsx`)

技能掌握度展示组件：

- 按 `pronunciation` / `grammar` 分组
- 每个技能显示进度条（`p_mastery × 100%`）
- `p_mastery ≥ 0.95` 显示"已掌握"绿色标签

---

## 4. 关键设计决策

1. **独立 Assessment Store**：评估数据与对话连接有独立的生命周期（idle/polling/loaded/error），不与 conversation store 耦合。`reset()` 时可分别清理。
2. **ApiError 类向下兼容**：`ApiError extends Error`，现有 `catch (err instanceof Error)` 逻辑无需修改，同时支持 `err.status` 区分 404。
3. **setTimeout 而非 setInterval**：每次请求完成后才调度下一次，避免慢请求时堆积。
4. **CSS-only Tooltip**：使用 Tailwind `group` + absolute positioned span 实现，无需引入额外 tooltip 库。
5. **手动 groupBy**：避免依赖 `Object.groupBy`（需 ES2024 lib），用简单 `reduce` 实现分组。
6. **纯展示与容器分离**：PhonemeVisualizer 为纯展示组件（无 API 调用），PronunciationFeedback 为组合容器。

---

## 5. 数据流

```
用户点击"结束对话"
  → conversation.endSession()
    → API: POST /api/sessions/{id}/end （后端同步执行分析管线）
    → store: connectionState = "ended"
  → VoiceInterface 渲染 <EndedView>
    → usePollingAssessment(sessionId) 启动
      → assessment.fetchAssessment(sessionId)
        → Promise.all([getAssessment, getGrammarErrors])
        → 成功 → loadState = "loaded", 数据写入 store
        → 404  → loadState = "polling", 指数退避重试
        → 错误 → loadState = "error"
      → 成功后 → fetchKnowledgeStates()（fire-and-forget）
  → EndedView 渲染:
    - polling  → 加载动画 + "正在分析发音..."
    - loaded   → PronunciationFeedback + SkillTree
    - error    → 错误提示
  → 用户点击"再来一次"
    → assessment.reset() + conversation.reset()
    → 回到 idle 状态
```
