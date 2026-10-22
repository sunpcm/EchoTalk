# 文档导航

本目录只保留能解释当前实现、指导验收或记录仍有效设计约束的文档。

- 当前已实现功能、近期变更和取舍以
  [EchoTalk 当前状态与变更决策](./PROJECT_STATUS.md) 为准。
- 未完成工作统一维护在根目录 [`TODO.md`](../TODO.md)。
- 根目录 [`README.md`](../README.md) 负责项目入口和快速启动；若历史描述与当前状态文档冲突，
  应以当前代码、CI 和 `PROJECT_STATUS.md` 为准，并在后续 PR 中同步修正。

## 架构与治理

- [当前状态与变更决策](./PROJECT_STATUS.md)：记录当前功能、验证边界、已合并和未采纳的实现及维护规则。
- [MVP 技术债修复与重构方案](./MVP_REFACTORING_REMEDIATION_PLAN.md)：定义 MVP 产品化修复的范围、实施顺序、验收和回滚要求；完成状态仍以根目录 `TODO.md` 为准。

- [Agent 评审手册](./agent-review-loop.md)：三端评审循环、测试树、环境和并行边界。
- [外部 CLI 自动评审接入](./REVIEW_LOOP_AUTOMATION.md)：本地状态门禁、授权、预算、暂停恢复及交付判定。

## 当前架构与验收

- [系统架构](./ARCHITECTURE.md)：系统边界和核心链路。
- [三端架构与交付门禁](./CROSS_PLATFORM_ARCHITECTURE.md)：Web/iOS/macOS 当前事实与交付目标。

| 阶段               | 技术说明                                         | 验收手册                                           | 补充设计                                                     |
| ------------------ | ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------ |
| Phase 5：双轨 BYOK | [PHASE_5_TECH_STACK.md](./PHASE_5_TECH_STACK.md) | [PHASE_5_MANUAL_TEST.md](./PHASE_5_MANUAL_TEST.md) | —                                                            |
| Phase 6：BYOK 校验 | [PHASE_6_TECH_STACK.md](./PHASE_6_TECH_STACK.md) | [PHASE_6_MANUAL_TEST.md](./PHASE_6_MANUAL_TEST.md) | —                                                            |
| Phase 7：DocTalk   | [PHASE_7_TECH_STACK.md](./PHASE_7_TECH_STACK.md) | [PHASE_7_MANUAL_TEST.md](./PHASE_7_MANUAL_TEST.md) | [PHASE_7_DOC_CHAT_DESIGN.md](./PHASE_7_DOC_CHAT_DESIGN.md)   |
| Phase 8：三主题    | [PHASE_8_TECH_STACK.md](./PHASE_8_TECH_STACK.md) | [PHASE_8_MANUAL_TEST.md](./PHASE_8_MANUAL_TEST.md) | [PHASE_8_UI_THEME_UPGRADE.md](./PHASE_8_UI_THEME_UPGRADE.md) |

## 历史实现资料

`archive/` 仅保留 Phase 1–4 仍可辅助排障或理解模块演进的技术说明与回归步骤。归档内容不代表当前配置或项目状态；执行命令前必须对照现有代码和根目录 `README.md`。

## 文档维护规则

- 不新增阶段 Prompt、临时聊天上下文或重复的全局开发规则。
- 计划落入 `TODO.md`；功能和关键决策落入 `PROJECT_STATUS.md`；实现细节和人工验收分别进入对应技术说明与验收手册。
- 命令、端口、依赖、功能状态或安全边界变化时，同一变更内同步更新文档。
- 失效设计可直接删除，历史内容由 Git 保存，无需重复建立归档副本。

- [CP-02 客户端占用API前置验证](./verification/cross-platform/CP-02-LEASE-API.md)：API原语与本地独立证据，未开放Cloud通话。
