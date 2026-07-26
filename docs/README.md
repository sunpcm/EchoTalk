# 文档导航

本目录只保留能解释当前实现、指导验收或记录仍有效设计约束的文档。项目状态以根目录 `README.md` 为准，未完成工作统一维护在 `TODO.md`。

## 当前架构与验收

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
- 计划落入 `TODO.md`；实现完成后再更新技术说明和验收手册。
- 命令、端口、依赖或功能状态变化时，同一变更内同步更新文档。
- 失效设计可直接删除，历史内容由 Git 保存，无需重复建立归档副本。
