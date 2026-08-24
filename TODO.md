# EchoTalk TODO

> 当前唯一待办清单。完成事项应直接勾选；新增待办需写明验收条件，避免继续散落到阶段文档和源码注释中。

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
