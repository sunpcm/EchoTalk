# EchoTalk TODO

> 当前唯一待办清单。完成事项应直接勾选；新增待办需写明验收条件，避免继续散落到阶段文档和源码注释中。

## MVP 产品化修复（RF-01～RF-12）

> 权威边界与验收细则见
> [MVP 技术债修复与重构方案](./docs/MVP_REFACTORING_REMEDIATION_PLAN.md)。
> 执行顺序固定为“可靠性修复 → 架构减法 → 内部重构 → 受控升级”；只有对应自动化、
> 迁移、运行时和外部边界证据齐全后才能勾选。

### 执行基线

- 基线：`origin/main@30f51f3175de20bc827ebdf29789ad934096133d`
- 分支：`codex/mvp-remediation`
- Worktree：
  `/Users/sunpcm/Documents/Codex/2026-09-08/new-chat/work/EchoTalk-mvp-remediation`
- 初始前端基线：冻结锁安装成功；格式检查失败；Lint/Typecheck 通过但复用了旧 worktree
  Turbo 缓存；Vitest 71 项通过但包含 6 个 “no tests” 伪任务；Playwright 仅有 1 个
  `expect(true)` 占位测试。
- 初始后端基线：Pytest 113 项通过并有 8 个 warning；Black 有 9 个文件待格式化；
  Flake8 报告 38 项；当前依赖未锁定且一次安装解析出 176 个包。
- 初始运行时基线：`docker compose config --quiet` 因干净检出缺少强制 `.env`
  失败；尚无 PostgreSQL 空库迁移门禁。

### Phase 0：可信质量基线

- [ ] **RF-04 CI 真实性**：真实 Web + Fake API E2E 覆盖健康检查、创建/结束会话、
      分析成功、分析失败与失败后退出；统一 Ruff；PostgreSQL 空库迁移与合理覆盖率进入
      CI；聚合 `CI` 仅在必要任务全部成功后通过。

### Phase 1：分析可靠性

- [x] **RF-01 持久化分析状态机**：PostgreSQL Job 支持原子领取、幂等、超时恢复、
      有限重试和人工重试；状态 API 与前端明确展示四种状态；任意状态均可返回主页；
      重复消费、Worker 崩溃和最终失败均有测试。

### Phase 2：模拟结果隔离

- [x] **RF-02 评估来源可信**：评估带来源、Provider、模型版本、Synthetic 与置信度；
      Synthetic 不更新真实知识状态；生产缺 Provider 时返回 `unsupported`；API、迁移、
      前端和测试同步。

### Phase 3：鉴权与密钥生命周期

- [ ] **RF-03 真实鉴权和版本化密钥**：采用单一明确的 AuthProvider 方案；移除生产
      Mock 用户和固定 Token；资源归属、过期/伪造 Token、认证密钥与凭据加密密钥分离、
      旧密文读取/重加密、Provider 错误分类和日志脱敏均有测试。

### Phase 4：架构减法

- [ ] **RF-05 精简基础设施**：确认调用证据后删除无价值的 Redis/Celery/周报骨架和
      Chroma/重型 ML 依赖；确定性课程推荐保持业务用例，并记录镜像体积与冷启动对比。
- [ ] **RF-06 清理前端模板**：引用审计后删除无调用者的 Webpack、UI 模板、Changesets、
      Plop 和一次性脚本；根包元数据、workspace、Turbo、Docker 和 Capacitor 保持一致。

### Phase 5：依赖、迁移和运行时统一

- [ ] **RF-07 可复现依赖**：后端成为真实 uv 项目并提交完整 `uv.lock`；API、Agent、
      Dev 依赖分组；CI/Docker frozen 安装；Python 3.12、Node 22 与固定 pnpm 版本统一。
- [ ] **RF-08 迁移与时间语义**：移除 lifespan Mock 播种；参考数据显式且幂等；
      timezone-aware UTC、必要索引和有界分页完成；空库及现有数据库副本迁移均通过。

### Phase 6：内部边界

- [ ] **RF-09 LiveKit Agent 拆分**：Orchestrator、CredentialResolver、ProviderRegistry、
      TranscriptSink 和 ErrorMapper 边界落地；无 `sys.path` 注入、导入时 dotenv、敏感
      环境变量临时删除或 SDK 私有属性访问；后台写入可排空、可观测、可重试。
- [ ] **RF-10 Provider Registry**：能力、模型、凭据、验证、超时、重试与错误映射统一；
      非敏感设置不解密旧凭据；多 Provider 验证并行且有总超时。
- [ ] **RF-11 前端 API 与状态模型**：OpenAPI 生成类型/客户端；Transport 统一认证、
      超时、取消、Header 合并和错误解析；会话使用判别联合/Reducer；大组件按行为拆分。

### Phase 7：受控升级

- [ ] **RF-12 独立 SDK 升级**：仅在 RF-01、RF-04、RF-07、RF-09 完成后，分别升级并
      提交 LiveKit Agents、OpenAI SDK、Vite、Vitest 和 TypeScript；保留回滚边界；真实
      语音、Provider 与 iOS 真机等外部验证在获得凭据/设备后补证，未验证前不得完成。

## P0 — 安全边界

- [ ] 后端用真实 JWT 校验替换 `get_current_user` Mock；验收：无效或过期 Token 返回 401。
- [ ] 前端从 Auth 模块获取 Bearer Token，移除固定的 `mock-token`；验收：登录态变化能正确影响 API 请求。

## P1 — 功能完整性

周度学习报告目前仅返回 `status: "skeleton"`，以下维度应分别实现并验证：

- [ ] 统计最近 7 天练习时长与会话次数。
- [ ] 计算各技能 `p_mastery` 环比趋势。
- [ ] 按会话聚合发音准确率趋势。
- [ ] 统计语法错误 Top 3 并生成改善建议。
- [ ] 基于 RAG/Krashen i+1 生成下周学习重点。
- [ ] 汇总平均焦虑指数与语速趋势。
- [ ] 接入正式 i18n 框架，用语言包替换当前 TypeScript 字符串对象。
- [ ] 实现数字人前端与音视频同步，并补充独立设计和验收标准。
- [ ] 在完整后端与 LiveKit 环境补验 Session、评估页面及深色主题可读性。

## P2 — 质量与维护

- [ ] 清点主题 token：保留 Webpack 正在使用的 `brand-*`，处理未使用的 `scrollbar-thumb`、`header-bg`。
- [x] 将 Vite 入口的 `<html lang="en">` 改为 `zh-CN`。
- [ ] 将主题保存到后端 `user_settings.theme`，支持跨设备水合。
- [ ] 统一主题按钮边框宽度，消除选中时 1px 布局抖动。
- [ ] 为颜色过渡和抽屉动画支持 `prefers-reduced-motion`。
- [ ] 按主要容器补齐主题颜色过渡，避免子元素瞬间切色。
- [ ] 移除 LiveKit 消息访问处的 SDK 类型忽略，改用类型收窄或兼容适配层。

## Phase 9 — 移动端交付

> 设计与工作量评估见 [`docs/CROSS_PLATFORM_ARCHITECTURE.md`](./docs/CROSS_PLATFORM_ARCHITECTURE.md) §3.0。
> 目标 M1「iOS 真机跑通」估算 4~6 人日；对外分发另需 P0 安全边界两项完成。

### 前置验证（阻断项）

- [ ] 手机浏览器访问 `https://<局域网IP>:5173` 完成一次完整语音对话；验收：麦克风采集正常、听到 Agent 回复，并记录 LiveKit 是否可直连、布局问题清单、DocTalk 文件选择器能否选中 `.md` 文件。
- [ ] 确认 Apple 开发者账号状态与本轮交付范围（iOS 单端 / iOS + Android）。

### M1：真机跑通

- [ ] `backend/config.py` 的 `CORS_ORIGINS` 放行原生 Origin；验收：原生 Origin 请求 `/api/health` 返回 200，无 CORS 拦截。
- [ ] 实现 `apps/vite-app/src/utils/env.ts` 并以惰性求值接入 `lib/api.ts`；验收：原生容器内 API 正确拼接 `/api` 前缀并派发到配置 Host，无 404。
- [ ] `VoiceInterface.tsx` 顶层读取 store 的 `wsUrl`，补 `VITE_LIVEKIT_FORCE_PROXY` 兜底；验收：原生按配置直连或降级代理，Web 端默认代理不受影响。
- [ ] 接入 Capacitor 工程（webDir 指向 `apps/vite-app/dist`，补 `cap sync` 脚本）；验收：`pnpm build` 后可同步并在模拟器启动。
- [ ] iOS 原生配置：`Info.plist` 麦克风权限描述 + `AVAudioSession` 通话模式与中断恢复；验收：真机完成一轮完整对话，来电挂断后音频自动恢复。
- [ ] Android 原生配置：Manifest 权限与运行时权限请求；验收：导出 Debug APK，真机完成一轮完整对话。

### M1 后续：移动端体验

- [ ] `index.html` 补 `viewport-fit=cover`，根容器补 `env(safe-area-inset-*)`；验收：灵动岛与底部横条不遮挡内容。
- [ ] `SettingsDrawer.tsx`（406 行、0 处响应式断点）移动端改为 Bottom Sheet；验收：≤414px 宽度下从底部弹出，支持下滑关闭。
- [ ] `VoiceInterface.tsx` 双栏布局在窄屏折叠为上下结构；验收：iPhone 竖屏下语音区与字幕区均不横向溢出。
- [ ] 接入 `appStateChange` 监听，回前台时校准 `usePollingAssessment` 退避计数与 LiveKit 房间状态；验收：会话中切后台 30 秒再回前台，评估结果仍能拉到，且房间断开时不再显示「假在线」。
- [ ] 按第 0 步结论处理 DocTalk 的 `accept` 过滤（放宽为 `text/*` + 读取后校验扩展名，或改用原生选择器）；验收：iOS 真机可选中 `.md` 文件并完成一次 DocTalk 会话。

## 维护规则

- `README.md` 只记录已验证现状，不承载待办。
- `docs/PHASE_*_TECH_STACK.md` 记录已实现架构，`docs/PHASE_*_MANUAL_TEST.md` 记录验收步骤。
- 已完成任务应同步删除对应源码 `TODO` 注释；重大取舍写入相关技术文档。
