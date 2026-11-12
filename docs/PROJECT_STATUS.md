# EchoTalk 当前状态

> 最后核对：2026-11-12，A4d（PR #153）代码 head `05e76fe` 的六项 CI 与原始日志已复核，
> Vitest1206/49、Linux E2E234、pytest809/80.19% 通过；四处原测试变异均被捕获。
> 最终文档收尾提交与合并状态见 PR。
> 本文只回答"现在实现了什么、验证到哪一步、有哪些已知限制"。未完成工作只在根目录
> [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；逐轮实施记录在
> [`history/`](./history/)，不在本文追加。

## 当前功能

| 领域           | 当前实现                                                                             | 状态与边界                                                        |
| -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离      | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收 |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                    | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明        |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束 | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭       |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态                      | 自动化覆盖状态机；语法为 demo 规则，真实发音 Provider 未验收      |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态   | 已实现                                                            |
| 自适应课程     | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                  | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务          |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast   | 已实现；密钥轮换和 Provider 连通性需按环境验收                    |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                  | 已实现 Web 流程；原生端文件选择未验收                             |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、键盘焦点、44px 触控目标             | 三主题文字对比度有 E2E 回归；边框对比度与读屏实测未完成           |
| 周度学习       | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3                | **部分实现**：练习时长、掌握度环比、发音趋势、下周重点均未实现    |
| iOS            | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                              | 真机全链路、原生登录与发布未验收                                  |
| macOS          | 仅 `tools/macos-m1-native-probe` 探测工程                                            | **未实现**正式客户端，等待 CP-03 设备证据                         |
| 数字人         | 只有待办                                                                             | **未实现**                                                        |

## 当前验证基线

当前 Linux 测试基线绑定 A4d（PR #153）代码 head `05e76fec5e66a946eba6fcb227c6944d9950b140`：
[CI run 43166753495](https://github.com/sunpcm/EchoTalk/actions/runs/43166753495) 与
[PR Guard run 43166753508](https://github.com/sunpcm/EchoTalk/actions/runs/43166753508) 六项通过。
原始日志已回读；后续仅文档收尾，最终提交与合并状态见 PR #153。

| 测试树 / 门禁  | 最近实测结果（各行来源见下文）                    | 日志     |
| -------------- | ------------------------------------------------- | -------- |
| Vitest         | 1206 passed（49 个文件；含原 45 项契约）          | frontend |
| Playwright E2E | 234 passed（0 skip、无 retry）                    | frontend |
| Fake API 契约  | 108 passed                                        | frontend |
| API 类型生成器 | 8 passed                                          | frontend |
| 构建脚本       | 21 passed                                         | frontend |
| backend pytest | 809 passed，3 warnings，80.19% 覆盖率（59% 门禁） | backend  |

这些结果都不能代替真实 LiveKit、第三方 Provider、真实 IdP、iOS/macOS 设备或生产部署验收。
命令见 [Agent 评审手册 §2 与 §20](./agent-review-loop.md)。

历史基线继续按快照绑定：B1 source `3b418e8` 的 [CI run 43152122060](https://github.com/sunpcm/EchoTalk/actions/runs/43152122060)
与 [PR Guard run 43152122194](https://github.com/sunpcm/EchoTalk/actions/runs/43152122194) 为 Vitest
1161/45、E2E 234、pytest 809/80.19%、Fake API 108、类型生成器 8、构建脚本 21；PR #140 head `ed3ac8ba` 的 Fake API 为 75 passed；A3 原 head
`437f6ff8` 为 103 passed；修正提交 `45e5212` 的本地快照为 108 passed，但本机 macOS E2E
为 233/1，Linux ARM64 两轮为 233/1、232/2，均不能计为通过。这些记录只属于各自快照，
不替换上表绑定 A4d 代码 head 的 Linux CI。

### A3（Fake API 契约校验，PR #141/#147）合并收口

Fake API 的成功响应与缺失 operation 受仓内 OpenAPI 校验，既有偏差精确固定；当前108项通过。
最终实现 source `b1d3756` 合入 `main@a7841b7`，文档后由PR #147收口；历史及偏差清单见归档。

### A4a（只读 data 层，PR #149）合并收口

最小 controller/hook、契约及45项独立契约测试已合并；未引入依赖。默认键补修的三项官方
RED→GREEN与私有7探针证据见历史。source `250a582` 六项CI后合入整树一致的 `main@3daa0a4`。

### A4b（WeeklyGrammar 数据查询迁移，PR #151）合并收口

组件仅渲染与 retry 转发，认证、生命周期、请求槽与 timer 移入 data controller/hook；原
JSX/文案/ARIA/class 和 146 个测试/fixture/config 文件保持不变。原 WG14、data45、全量
Vitest1206/49、Linux E2E234（0 skip/retry）与 pytest809/80.19% 通过；三处真实变异均被原 WG
断言捕获。最终 source `7659808` 六项 CI 后合入 `main@2598867`。真实服务/设备边界仍未验证。

### A4c（WeeklyProgress 数据查询迁移，PR #152）合并收口

两个 controller 共用一套订阅；原 WP31、data45、146 份测试/fixture/config 与界面 AST 保持。
主控全量 Vitest1206/49、六项 CI、Linux E2E234（0 skip/retry）、pytest809/80.19% 通过；
额外 React/jsdom 探针6/6，认证 revision、重复 cursor、日窗口下界三处变异均被原 WP 断言捕获；
最终 source `d47c3aa` 的 CI `43162885071` 与 PR Guard `43162885101` 成功后，以整树一致的
`main@5c7ab36` 合入。只做行为等价抽取，未改变依赖、HTTP、数据库或外部服务边界；
真实服务/设备仍未验证。

### A4d（DailyProgress 数据查询迁移，PR #153）代码验收完成

专用hook单套认证/lifecycle/午夜+100ms，保留原读取时点、非物理取消与汇总/列表原子发布。
146份原测试/fixture/config与所有渲染分支AST不变；私有8场景与4重入探针通过。原DP23、data45、
全量Vitest1206/49与Linux E2E234（0 skip/retry）、pytest809/80.19%通过；去重、挂起、旧more
代际、25h午夜四处真实变异均被原DP断言捕获。无用户可见行为或依赖/HTTP/数据库变化。

### A5（导航切片，PR #148）合并收口

导航与会话切片组合在同一原子容器，未引入Router；18文件的340个case与1624个expect相关调用
AST保持。最终source `ae13222` 六项CI后合入 `main@0ea16a4`，详细过程见历史与验证文档。

### B1（学习事件台账）设计交付

B1 已新增并独立归档 `docs/LEARNING_EVENTS_DESIGN.md`，定义只追加事件、Job 写入幂等、
合成结果排除、`knowledge_states` 重算校验、来源关系、保留选项及一条以
`c06_transcript_events` 为父 revision 的 Markdown Alembic 草案。主控已完成设计审阅并
APPROVED；Python 草案经 `ast.parse` 成功，父 revision 已核对存在。

本次仅交付设计，未建表、未创建迁移文件、未执行 DDL。legacy 基线切换、旧 pending/failed Job、
retention、未来重分析身份与 `bkt-v1` 参数冻结仍等待用户政策确认；A4a 方案 A 不属于 B1 授权。
PR #150 的六项 CI 已通过，原始日志确认 Vitest 1161/45、E2E 234、pytest 809/80.19%，
且已合入 `main@4ee8b35`；B1 仍仅设计交付。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、Compose 就绪门禁、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，
  避免运行时安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，
  并在运行 E2E 前核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- 前端 lint 有 132 条 warning（0 error），主要是 `Unexpected any`。
- 输入框与卡片边框对比度约 1.2，低于非文字组件 3.0 的要求；会话中界面的 LiveKit 控制条未在真实连接下验收。
- 本机 E2E 开工基线为 233 passed / 1 failed，仍是已记录的 WebKit Provider select 高度
  336×23px 问题，没有新增失败；最终 A3 基线以 Linux CI 为准。
- 根目录 `README.md` 仍含历史阶段叙述，若与本文冲突，以本文和当前代码/CI 为准。

## 历史与决策

| 内容                                | 位置                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| 2026 年 11 月各轮实施记录与当时基线 | [history/2026-11.md](./history/2026-11.md)                           |
| 2026 年 10 月各轮实施记录           | [history/2026-10.md](./history/2026-10.md)                           |
| 已合并与明确未采纳的方案            | [history/decisions.md](./history/decisions.md)                       |
| 已完成的待办事项                    | [history/todo-done.md](./history/todo-done.md)                       |
| 评审手册的单轮回执                  | [history/review-loop-receipts.md](./history/review-loop-receipts.md) |

历史文件只追加、不改写；其中的计数和结论只属于当时的提交。

## 文档职责与更新规则

- `README.md`：项目入口、快速启动和稳定概览。
- `docs/PROJECT_STATUS.md`（本文）：当前功能、当前验证基线和已知限制；可以覆盖更新，目标不超过 150 行。
- `docs/ARCHITECTURE.md`：运行时、数据所有权、部署拓扑与架构风险。
- `TODO.md`：唯一未完成事项清单，必须带验收条件；勾选后移入 `docs/history/todo-done.md`。
- `docs/history/`：按月的实施记录与决策流水。一轮工作结束时在当月文件**顶部**追加一节，
  写明日期、PR 或提交、行为变化、验证证据和仍未覆盖的边界。
- `docs/PHASE_*_TECH_STACK.md` 与 `docs/PHASE_*_MANUAL_TEST.md`：阶段实现细节与人工验收步骤。

以下变更必须在同一个 PR 中更新本文的"当前功能"或"当前验证基线"：

1. 新增、删除或改变用户可见功能。
2. 改变认证、密钥、数据所有权、生产配置或外部 Provider 边界。
3. 改变 CI 能证明的范围，或完成此前只能人工验证的事项。

不要把"代码存在"、"CI 通过"和"生产已验证"混为同一状态。
