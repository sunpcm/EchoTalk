# 文档导航

本目录只保留能解释当前实现、指导验收或记录仍有效设计约束的文档。

- **功能、子功能、当前进度、未验收、待办、卡点、开单**统一维护在根目录 [`TODO.md`](../TODO.md)，这是唯一事实来源。
- 根目录 [`README.md`](../README.md) 负责项目入口、开发启动/配置命令与安全边界，不维护第二份进度。
- 有效技术契约、操作手册、验收证据与历史记录仍保留在本目录，作为实施参考与证据，不承载“当前是否完成”的口径。

## 架构与治理

- [系统架构](./ARCHITECTURE.md)：当前运行时、数据所有权、部署拓扑与仍然成立的风险。
- [三端架构与交付门禁](./CROSS_PLATFORM_ARCHITECTURE.md)：Web/iOS/macOS 业务规则、网络/认证契约与 §8.2 构建同步契约；状态见 `TODO.md`。
- [Agent 评审手册](./agent-review-loop.md)：三端评审循环、测试树、环境和并行边界。
- [外部 CLI 自动评审接入](./REVIEW_LOOP_AUTOMATION.md)：本地状态门禁、授权、预算、暂停恢复及交付判定。
- [实时语音栈选型与升级决策](./REALTIME_VOICE_SELECTION.md)：媒体、语音与教学职责分层、公开证据、候选路线及验收口径。

## 有效契约与验收

- [macOS M1 原生认证验证](./verification/cross-platform/MACOS-M1-NATIVE-AUTH.md)：auth-only 探针安装包真实冷暖回跳及取消场景；API/媒体、真实 Provider 5 分钟 5 轮与设备测试尚欠，不代表 M1 整体通过。
- [macOS M1 离线媒体接线](./verification/cross-platform/MACOS-M1-OFFLINE-MEDIA.md)：默认禁用的 native API、真实 SDK 自托管和离线回归；离线接线不代表 M1 真实通过。
- [CP-02 客户端占用 API 前置验证](./verification/cross-platform/CP-02-LEASE-API.md)：API 原语与本地独立证据，未开放 Cloud 通话。
- [CP-02 独立占用控制器验证](./verification/cross-platform/CP-02-LEASE-CONTROLLER.md)：未接 UI/Cloud 的本地前置模块。
- [CP-01/05 Web 生命周期验证](./verification/cross-platform/CP-01-WEB-LIFECYCLE.md)：事件边界、恢复快照与清理，真实原生事件后验。

| 阶段               | 技术说明                                         | 验收手册                                           | 补充设计                                                     |
| ------------------ | ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------ |
| Phase 5：双轨 BYOK | [PHASE_5_TECH_STACK.md](./PHASE_5_TECH_STACK.md) | [PHASE_5_MANUAL_TEST.md](./PHASE_5_MANUAL_TEST.md) | —                                                            |
| Phase 6：BYOK 校验 | [PHASE_6_TECH_STACK.md](./PHASE_6_TECH_STACK.md) | [PHASE_6_MANUAL_TEST.md](./PHASE_6_MANUAL_TEST.md) | —                                                            |
| Phase 7：DocTalk   | [PHASE_7_TECH_STACK.md](./PHASE_7_TECH_STACK.md) | [PHASE_7_MANUAL_TEST.md](./PHASE_7_MANUAL_TEST.md) | [PHASE_7_DOC_CHAT_DESIGN.md](./PHASE_7_DOC_CHAT_DESIGN.md)   |
| Phase 8：三主题    | [PHASE_8_TECH_STACK.md](./PHASE_8_TECH_STACK.md) | [PHASE_8_MANUAL_TEST.md](./PHASE_8_MANUAL_TEST.md) | [PHASE_8_UI_THEME_UPGRADE.md](./PHASE_8_UI_THEME_UPGRADE.md) |

## 历史实现资料

`history/` 保存按月的实施记录、已合并与未采纳决策、已完成待办和评审回执；只追加不改写，
其中的计数与结论只属于当时提交。当前状态一律以根目录 [`TODO.md`](../TODO.md) 为准。

`archive/` 保留 Phase 1–4 技术说明与回归步骤，以及
[2026-11-21 文档统一归档](./archive/2026-11-21-document-consolidation/) 中被 `TODO.md` 取代的旧状态页与阶段计划。
归档内容不代表当前配置或项目状态；执行命令前必须对照现有代码和根目录 `README.md`。

## 文档维护规则

- 不新增阶段 Prompt、临时聊天上下文或重复的全局开发规则。
- 计划、功能、进度、卡点、待办、开单统一落入根目录 `TODO.md`；实现细节和人工验收分别进入对应技术说明与验收手册。
- 命令、端口、依赖、功能状态或安全边界变化时，同一变更内同步更新文档。
- 失效设计可直接删除，历史内容由 Git 保存，无需重复建立归档副本。
