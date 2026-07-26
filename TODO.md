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
- [ ] 将 Vite 入口的 `<html lang="en">` 改为 `zh-CN`。
- [ ] 将主题保存到后端 `user_settings.theme`，支持跨设备水合。
- [ ] 统一主题按钮边框宽度，消除选中时 1px 布局抖动。
- [ ] 为颜色过渡和抽屉动画支持 `prefers-reduced-motion`。
- [ ] 按主要容器补齐主题颜色过渡，避免子元素瞬间切色。
- [ ] 移除 LiveKit 消息访问处的 SDK 类型忽略，改用类型收窄或兼容适配层。

## 维护规则

- `README.md` 只记录已验证现状，不承载待办。
- `docs/PHASE_*_TECH_STACK.md` 记录已实现架构，`docs/PHASE_*_MANUAL_TEST.md` 记录验收步骤。
- 已完成任务应同步删除对应源码 `TODO` 注释；重大取舍写入相关技术文档。
