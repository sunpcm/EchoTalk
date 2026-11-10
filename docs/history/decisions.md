# EchoTalk 已合并与未采纳决策流水

> 原文自 `docs/PROJECT_STATUS.md` 搬运（2026-11-10），除相对链接上移一层外未改动内容；各节只代表当时提交的事实，不外推为当前状态。当前状态见 [PROJECT_STATUS.md](../PROJECT_STATUS.md)。

## 2026-10-20 PR 评审与处理

| PR                                                | 处理决定     | 内容与边界                                                                                              |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| [#92](https://github.com/sunpcm/EchoTalk/pull/92) | 已合并       | Vite 7.3.1 → 精确 7.3.7；只改声明和锁文件，其他依赖不变，未迁移 Vite 8                                  |
| [#90](https://github.com/sunpcm/EchoTalk/pull/90) | 修复后纳入   | DailyProgress 和 SkillTree 增加进度条角色、名称、范围和值；每日超过 20 时数值封顶，文本仍保留实际完成量 |
| [#91](https://github.com/sunpcm/EchoTalk/pull/91) | 重复，不纳入 | 与 #90 修改相同组件；#90 还包含每日进度测试和可读值文本，统一维护一份实现                               |

评审复现：原 #90 在完成 25 条转录时生成 `aria-valuenow=25`、`aria-valuemax=20`，
违反 [WAI-ARIA 数值范围约束](https://www.w3.org/TR/wai-aria-1.2/#aria-valuenow)。
修复后读数为 20，`aria-valuetext` 仍为 `25 / 20`，视觉条保持 100%，实际统计口径不变。
回归覆盖 0、5、20、25 四种完成量；补测技能树空列表，保留两类技能掌握度断言。

验证分层：#92 的前端、后端和聚合 CI 均通过，包括 Node 22 前端、PostgreSQL 空库迁移及
后端测试；#90 的最终检查见上方 PR 记录。安全补丁的本地验证还包括 102 项 Vitest、
6 项 Fake API E2E、HTTPS/模拟麦克风/WSS/代理和合成文件访问限制探针。
这些证据不代表真实 LiveKit、Provider、Windows/NTFS 漏洞复现、屏幕阅读器或 iOS 真机验收。

本次 Vite 安全补丁独立于 RF-12 大版本迁移；RF-12 的其他依赖升级和外部验收仍未完成。
回滚 #92 会恢复已知有漏洞的 Vite 7.3.1；如需回滚，应同步恢复 manifest/lockfile 并限制开发服务访问。

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
