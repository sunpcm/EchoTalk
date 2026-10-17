# EchoTalk 当前状态与变更决策

> 本文是 EchoTalk “当前已经实现什么、最近改变了什么、明确没有采纳什么”的权威入口。
> 未完成工作维护在根目录 [`TODO.md`](../TODO.md)；具体架构和人工验收步骤仍由各阶段技术文档负责。

## 维护基线

- 最近核对日期：2026-10-17
- 代码基线：`main@97dbfe5ddb50bda96cf9a857f6de31efae410d50`
- 自动化证据：[CI run 39010922925](https://github.com/sunpcm/EchoTalk/actions/runs/39010922925)
- 证据范围：上述 CI 已验证格式、Lint、TypeScript、前端构建、Vitest、Playwright、Ruff、
  PostgreSQL 空库迁移和后端覆盖率测试。它不能代替真实 LiveKit、第三方 Provider、移动端真机
  或生产部署验收；这些边界应在对应验收文档或 `TODO.md` 中单独记录。

## 当前功能

| 领域           | 当前实现                                                                           | 状态与边界                                                 |
| -------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离    | 代码和自动化已落地；真实 IdP 联调仍需环境验收              |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                  | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明 |
| 会话分析       | 持久化分析状态、发音评估、语法检测、BKT 知识追踪、失败/重试状态                    | 自动化覆盖核心状态机；真实发音 Provider 仍需外部验收       |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态 | 已实现                                                     |
| 自适应课程     | 读取薄弱技能，通过 ChromaDB/Krashen i+1 生成课程推荐                               | 存在真实 API 调用链；ChromaDB 客户端按进程复用             |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast | 已实现；密钥轮换和 Provider 连通性需按环境验收             |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                | 已实现 Web 流程；移动端文件选择仍在 TODO                   |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、关键组件键盘与可访问性支持        | 已实现；完整无障碍审计仍未完成                             |
| 周度学习报告   | 仅保留骨架，没有 API、调度器或任务队列调用入口                                     | **未实现，不可对外宣称可用**                               |
| 数字人和移动端 | 方案或待办存在，但没有完成可交付闭环                                               | **未实现**                                                 |

## 2026-10-17 变更记录

本轮对全部开放 PR 使用最新 `main`、文件重叠、生产调用链和 CI 结果进行复核。

### 已合并

| PR                                                | 合并内容                                   | 价值                                                                      |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| [#67](https://github.com/sunpcm/EchoTalk/pull/67) | ORM 模型包内改用相对导入                   | 降低包路径耦合                                                            |
| [#68](https://github.com/sunpcm/EchoTalk/pull/68) | LLM client/chat completion 单元测试        | 补充 Provider 配置和异常回归覆盖                                          |
| [#69](https://github.com/sunpcm/EchoTalk/pull/69) | 拆分用户设置响应、权限、Key 校验和更新逻辑 | 降低路由函数复杂度                                                        |
| [#71](https://github.com/sunpcm/EchoTalk/pull/71) | 将可选 `pronouncing` 导入移出逐词热路径    | 减少重复导入开销                                                          |
| [#73](https://github.com/sunpcm/EchoTalk/pull/73) | 进程内复用 ChromaDB client                 | 优化真实课程推荐调用链                                                    |
| [#74](https://github.com/sunpcm/EchoTalk/pull/74) | 转录持久化测试                             | 覆盖空输入、时间戳、角色、非法值和 DB 异常                                |
| [#78](https://github.com/sunpcm/EchoTalk/pull/78) | LiveKit PluginFactory 统一 API Key 校验    | 拒绝空值、错误类型和换行/null 等危险字符                                  |
| [#79](https://github.com/sunpcm/EchoTalk/pull/79) | CORS 安全校验                              | 评审中追加 Origin 结构校验，拒绝 path/query/userinfo/非法端口和不支持协议 |
| [#83](https://github.com/sunpcm/EchoTalk/pull/83) | LiveKit 消息类型收窄                       | 移除不安全的类型忽略后再读取 assistant 文本                               |
| [#84](https://github.com/sunpcm/EchoTalk/pull/84) | AnswerRecommendations 可访问性和复制反馈   | 评审中修复答案截断与剪贴板失败静默问题；定向测试 4/4 通过                 |
| [#86](https://github.com/sunpcm/EchoTalk/pull/86) | PhonemeVisualizer 键盘和辅助技术支持       | 增加可访问名称，并避免视觉 tooltip 重复朗读                               |
| [#87](https://github.com/sunpcm/EchoTalk/pull/87) | 焦点样式和禁用原因提示                     | 补齐键盘焦点与本地化说明                                                  |

### 未采纳

| PR                                                | 决策         | 原因                                                                                                   |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| [#82](https://github.com/sunpcm/EchoTalk/pull/82) | 关闭，不合并 | 周报代码超过 500 行，但没有 API、调度器或任务队列调用链，合并后仍不可达且只返回 partial 状态           |
| [#85](https://github.com/sunpcm/EchoTalk/pull/85) | 关闭，不合并 | 同时修改 14 个文件，与 #50/#51/#52/#59/#87 大量重叠，无法干净 rebase，并把已有本地化文案改回硬编码中文 |
| [#88](https://github.com/sunpcm/EchoTalk/pull/88) | 关闭，不合并 | 与 #86 重复；#86 的辅助技术语义更清晰，避免未关联 tooltip 的重复暴露                                   |

“未采纳”只表示不接受该 PR 的当前实现，不代表永久否定需求。仍有价值的需求应缩小范围、补齐调用链和验收标准后重新提交。

## 已知限制和近期风险

- CI 使用的部分 GitHub Actions 仍基于已弃用的 Node 20 runtime，当前被 runner 强制运行在 Node 24。
- `ubuntu-latest` 即将迁移到 Ubuntu 26，应固定或验证 runner 版本，避免工具链突然变化。
- 前端仍存在少量 `Unexpected any` 告警，应在独立维护 PR 中消除。
- 根目录 `README.md` 包含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准，并应在后续 PR 中修正 README。

## 文档职责与更新规则

- `README.md`：项目入口、快速启动和稳定概览，不维护逐项决策流水账。
- `docs/PROJECT_STATUS.md`：当前功能事实、最近合并/拒绝决策、验证边界和已知风险。
- `TODO.md`：唯一未完成事项清单，必须带验收条件。
- `docs/PHASE_*_TECH_STACK.md`：具体阶段的实现细节。
- `docs/PHASE_*_MANUAL_TEST.md`：不能由 CI 覆盖的人工验收步骤。

以下变更必须在同一个 PR 中更新本文：

1. 新增、删除或改变用户可见功能。
2. 改变认证、密钥、数据所有权、生产配置或外部 Provider 边界。
3. 接受或拒绝会影响架构方向的大型实现。
4. 改变 CI 能证明的范围，或完成此前只能人工验证的事项。

更新时必须写明日期、PR、行为变化、验证证据和仍未覆盖的边界；不要把“代码存在”、
“CI 通过”和“生产已验证”混为同一状态。
