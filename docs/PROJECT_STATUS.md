# EchoTalk 当前状态

> 最后核对：2026-11-13。当前 Linux 基线仍按 A6（PR #155）代码 `87e0fd5` 的历史快照记录；
> B1-0～B1-5 已完成本地实施、主控代码/测试 Review 与完成项归档，当前停在 B1-5 用户 Review；
> 生产发布、真实数据和真实依赖仍未验收。历史 B1-1～B1-4 的合成 PostgreSQL、完整本机门禁与
> 独立代码 Review 结果见下文，各自数字只属于当时卡。
> 本文只回答"现在实现了什么、验证到哪一步、有哪些已知限制"。未完成工作只在根目录
> [`TODO.md`](../TODO.md)；架构与风险见 [ARCHITECTURE.md](./ARCHITECTURE.md)；逐轮实施记录在
> [`history/`](./history/)，不在本文追加。

## 当前功能

| 领域           | 当前实现                                                                             | 状态与边界                                                              |
| -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 认证与用户边界 | 开发模式显式 Token；生产模式 OIDC issuer/audience/JWKS 校验；用户资源按身份隔离      | 代码和自动化已落地；真实 IdP 联调、原生系统登录与 Keychain 未验收       |
| 实时对话       | LiveKit WebRTC、STT → LLM → TTS、转录持久化、Agent 调度和错误回传                    | 代码已实现；真实语音质量和外部 Provider 可用性不由 CI 证明              |
| 会话生命周期   | 创建/结束幂等、活动会话发现、显式结束与恢复、连接中断安全关闭、取 Token 失败自动结束 | 浏览器 E2E 覆盖到"进房前"；单端通话占用协议已实现但默认关闭             |
| 会话分析       | 持久化分析 Job、发音评估、语法检测、BKT 知识追踪、失败/重试状态                      | 自动化覆盖状态机；语法为 demo 规则，真实发音 Provider 未验收            |
| 结果可信度     | 评估记录来源、Provider、模型版本、Synthetic 和置信度；Synthetic 不更新真实知识状态   | 已实现                                                                  |
| 本人数据导出   | `GET /api/user/data-export` 输出固定 v1 JSON，显式白名单并读取单一一致只读快照       | 已实现；代码/测试 Review APPROVED，用户 Review 待、无导出 UI            |
| 本人账号删除   | `DELETE /api/user/account` 在受控事务硬删本人 12 类业务数据，保留控制行和他人数据    | 已实现；代码/测试 Review APPROVED，用户 Review 待；生产不可恢复性未验收 |
| 自适应课程     | 读取薄弱技能，通过版本化离线目录与 Krashen i+1 生成确定性的课程推荐                  | 真实 API 调用链；无 Chroma、embedding 下载或外部检索服务                |
| BYOK           | 用户设置、版本化 Fernet keyring、Provider Key 校验、基础轨/自定义轨路由、Fail-Fast   | 已实现；密钥轮换和 Provider 连通性需按环境验收                          |
| DocTalk        | 文档输入、Prompt 构建、文档会话入口                                                  | 已实现 Web 流程；原生端文件选择未验收                                   |
| 前端体验       | Dashboard、课程推荐、每日进度、评估反馈、三主题、键盘焦点、44px 触控目标             | 三主题文字对比度有 E2E 回归；边框对比度与读屏实测未完成                 |
| 周度学习       | 最近七个本地自然日的 completed 会话次数、按日只读历史、语法错误 Top 3                | **部分实现**：练习时长、掌握度环比、发音趋势、下周重点均未实现          |
| iOS            | Capacitor 工程、前后台生命周期适配、CI 无签名模拟器编译                              | 真机全链路、原生登录与发布未验收                                        |
| macOS          | 仅 `tools/macos-m1-native-probe` 探测工程                                            | **未实现**正式客户端，等待 CP-03 设备证据                               |
| 数字人         | 只有待办                                                                             | **未实现**                                                              |

## 当前验证基线

当前 Linux 测试基线绑定 A6（PR #155）代码 `87e0fd5432fe649e3ee91e8851c61c7d281986cc`：
[CI 43180144291](https://github.com/sunpcm/EchoTalk/actions/runs/43180144291) 与
[PR Guard 43180144203](https://github.com/sunpcm/EchoTalk/actions/runs/43180144203) 六项成功。
主控已亲读原始日志；后续仅 Markdown 归档，最终 head 的门禁与合并回执见 PR。

| 测试树 / 门禁  | A6 历史快照（本轮 B1 结果另见下文）               | 日志     |
| -------------- | ------------------------------------------------- | -------- |
| Vitest         | 1206 passed（49 个文件；含原 45 项契约）          | frontend |
| Playwright E2E | 234 passed（0 skip、无 retry）                    | frontend |
| Fake API 契约  | 108 passed                                        | frontend |
| API 类型生成器 | 8 passed                                          | frontend |
| 构建脚本       | 21 passed                                         | frontend |
| backend pytest | 809 passed，3 warnings，80.19% 覆盖率（59% 门禁） | backend  |

表内旧计数只绑定 A6 历史快照，不能与下方 B1 本轮结果混用；两者都不能代替真实 LiveKit、
第三方 Provider、真实 IdP、iOS/macOS 设备或生产部署验收。
命令见 [Agent 评审手册 §2 与 §20](./agent-review-loop.md)。

历史基线继续按快照绑定：B1 source `3b418e8` 的 [CI run 43152122060](https://github.com/sunpcm/EchoTalk/actions/runs/43152122060)
与 [PR Guard run 43152122194](https://github.com/sunpcm/EchoTalk/actions/runs/43152122194) 为 Vitest
1161/45、E2E 234、pytest 809/80.19%、Fake API 108、类型生成器 8、构建脚本 21；PR #140 head `ed3ac8ba` 的 Fake API 为 75 passed；A3 原 head
`437f6ff8` 为 103 passed；修正提交 `45e5212` 的本地快照为 108 passed，但本机 macOS E2E
为 233/1，Linux ARM64 两轮为 233/1、232/2，均不能计为通过。这些记录只属于各自快照，
不替换上表绑定 A6 代码 `87e0fd5` 的 Linux CI。

### A3（Fake API 契约校验，PR #141/#147）合并收口

Fake API 的成功响应与缺失 operation 受仓内 OpenAPI 校验，既有偏差精确固定；A3 该轮为 108 项
通过；历史 B1-4 Fake API 为 `110 passed / 0 skip / exit 0`，当前 B1-5 为
`113 passed / 0 skip / exit 0`，见本文
[B1 小节](#b1学习事件台账b1-5-本轮实现完成用户-review-待)。
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

### A4d（DailyProgress 数据查询迁移，PR #153）合并收口

保留单套认证/lifecycle/午夜+100ms、原读取时点与summary+rows原子发布；146原测试/渲染AST不变。
私有8行为/4重入、4原DP变异、1206/49、Linux234、pytest809/80.19%通过；source130bbb6六CI后合入整树一致maina1afaca。真实服务/设备未验。

### A4e（ActiveSessions 只读迁移，PR #154）合并收口

Data controller持有分页/请求归属/tombstone，UI/写流程/单订阅中枢与146原测试逐字保全。
R1统一内部cursor，取消/失败组合的两项回归RED→GREEN；主控9项、补充13项/DP6与3原AS变异通过。
代码fb47cf4六CI原始日志确认1206/49、Linux234零skip/retry、pytest809/80.19%、108/8/21。
最终b69c527六CI通过并已真实合入；本机233/1仍为既有WebKit高度差异，不计为通过。

### A6（分层依赖门禁，PR #155）代码验收完成

零依赖error规则落实三组禁止边；用户清理整体移至store，四份完整AST仅import/mock路径规范化后相同，
其余144份测试/fixture/config逐字保全。真实依赖7→0，主控22项、补充19项及真实逆向import失败验证通过。
force lint/typecheck/build零缓存、1206/49及上述六CI通过；全批冷启动总审APPROVED。
重构前后7份构建产物逐字节相同；无用户行为、HTTP、文案、依赖或数据库结构变化。
额外本机首轮全量232/2仍记失败：已知WebKit336×23px及一次DocTalk标题未出现。旧新普通/8会话预置
合计80次零重试定向均通过，旧新完整重放各233/1、DocTalk均通过，唯一失败仍为上述高度；
首次232/2独立保留为P2待查观察，根因未明，不归因基线、环境或本卡回归，本机全树均不计通过。
真实Provider/LiveKit/IdP、设备与生产环境未验；B1-1 已交付 ORM、新增迁移、schema 回归与
worker head fixture 适配，最终本机门禁和专用合成 PostgreSQL 结果见本文 B1 小节。

### A5（导航切片，PR #148）合并收口

导航与会话切片组合在同一原子容器，未引入Router；18文件的340个case与1624个expect相关调用
AST保持。最终source `ae13222` 六项CI后合入 `main@0ea16a4`，详细过程见历史与验证文档。

### B1（学习事件台账）B1-5 本轮实现完成；用户 Review 待

历史交付：B1 新增并独立归档 `docs/LEARNING_EVENTS_DESIGN.md`，当时定义只追加事件、Job 写入
幂等、合成结果排除、`knowledge_states` 重算校验、来源关系、保留选项及一条以
`c06_transcript_events` 为父 revision 的 Markdown Alembic 草案。主控完成设计审阅并 APPROVED；
Python 草案经 `ast.parse` 成功，父 revision 已核对存在。PR #150 的六项 CI 已通过，原始日志确认
Vitest 1161/45、E2E 234、pytest 809/80.19%，且已合入 `main@4ee8b35`。该段只描述当时的设计
交付，不表示表、代码或迁移已经实施。

2026-11-12 用户已确认七项政策：以 `legacy_unknown` 保存切换基线并明确旧趋势不可恢复；旧
`pending` 和可重试 `failed` Job 切换后走新事务且不回填成功旧 Job；存续期保留明细且不设固定
TTL/快照裁剪；本平台整账号注销硬删业务库事件、转录、分析和派生状态，不匿名化、不操作外部
IdP、不增加单会话删除；本人结构化 JSON 导出保留来源/合成/版本并排除密钥、内部提示词和
Provider 完整原始响应；本版不开放成功后的重新分析；现有四参数冻结为 `bkt-v1` 且新版本不改写
旧事件。备份/法定特殊保留的生产方案和音频采集仍另批处理。

主控已在专用合成 PostgreSQL 中重放现有迁移至 `c06_transcript_events`，并验证以下历史基线：
Vitest 1206 passed/49 files、backend 809 passed/3 warnings/80.19%、Fake API 108 passed、
类型生成器 8 passed、构建脚本 21 passed 且相关命令均 exit 0；本机全量 E2E 为 233 passed/
1 failed、exit 1，唯一失败是既有 WebKit select `336×23 < 44`。上述旧数字只属于该历史基线，
不与本轮新增结果相加或替代。
**历史 B1-1** 随后完成 RED（主控实跑 4 failed/0 skipped、exit 1）并新增 `LearningEvent` ORM/注册、
`b1_learning_events` 迁移与 schema/约束回归；两个 observation 分支兼容 `model_version=NULL`，
16 个旧迁移未改动。主控随后在本轮专用合成 PostgreSQL 完成空库 upgrade 至 b1、PG schema
GREEN `4 passed / 0 skip / exit 0`、current/downgrade 回 c06 后清除表/索引/identity、reupgrade
至 b1 exit 0，以及独立真实 PG 与 ORM 元数据 compare 零差异 exit 0。ORM 的 `idempotency_key`
唯一约束与 migration 同名一致；`algorithm_params` 使用 `JSONB(none_as_null=True)`，将 Python
`None` 绑定为 SQL `NULL`。既有 worker PostgreSQL fixture 原固定 `c06_transcript_events`，主控实跑
得到 `1 error` RED 后，已改为读取仓库 Alembic 源码 `get_current_head()` 并严格比较数据库
`alembic_version`；原 DB/user/PG15.19/DSN guard 不变。

**历史 B1-2** 已实现同事务事件写入、幂等、用户锁与 BKT 合成隔离，主控独立代码 Review 结论为
APPROVED。历史 B1-2 专用合成 PostgreSQL 目标套件为 `116 passed / 0 skip / exit 0`；完整 backend 为
`844 passed / 3 warnings / 0 skip`、覆盖率 `80.82%`。Vitest `1206 passed / 49 files`、
build-script `21`、Fake API `108`、API 类型生成器 `8` 均 `exit 0`；强制 lint/typecheck/build
`exit 0`，lint 为 `132 warning / 0 error`；Ruff 格式/规则、schema 与 metadata 导出校验均
`exit 0`。15 项完整门禁中 14 项 `exit 0`，Chromium+WebKit 零 retry 为
`233 passed / 1 failed / 0 skip / exit 1`，唯一失败仍是与既有基线相同的 WebKit Provider select
`336×23 < 44px`，DocTalk 通过，不能称本机全树全绿；聚合入口 `exit 0` 不表示 E2E 通过。

独立探针确认用户锁、实际 `apply_seq` 相反观察、原始 ordinal、缺观察拒绝、未知模型 `NULL`、
不复制 alignment、三类完成冲突，以及 10 条观察/3 个知识状态/知识状态单次读取/unmapped 计数均
`exit 0`。17 个既有迁移字节未改动。B1-0 的 `809 passed / 80.19%` 和 B1-1 的 `813` 是历史基线；
历史 B1-2 backend 为 `844 passed / 80.82%`，历史 Vitest 为 `1206 passed / 49 files`。

B1-3 的本轮代码/测试 Review 由主控独立审阅为 APPROVED，目标套件为
`147 passed / 0 failed / 0 skip / exit 0`；完整 backend 为 `878 passed / 3 warnings / 0 skip`、
覆盖率 `80.51%`、exit 0。Vitest 保持 `1206 passed / 49 files`，Fake API `108`、构建脚本 `21`、
API 类型测试 `8`，lint 为 `132 warning / 0 error / 0 new warning`；除 E2E 外所列完整门禁均
exit 0。前端自 `f6007a2` 未改，前端/Fake API/契约/配置均未改。代码 Review 通过不代表完整 E2E
或用户验收通过。

E2E 首轮为 `232 passed / 2 failed / 0 skip / 0 retry / exit 1`，失败分别是 WebKit Provider select
`336×23 < 44` 与 WebKit readiness 引导 textarea 超时；随后 DocTalk 定向为
`3 passed / 0 failed / 0 skip / 0 retry / exit 0`，再次全量为
`233 passed / 1 failed / 0 skip / 0 retry / exit 1`，DocTalk 通过、只剩同一 WebKit Provider
select 失败。首轮失败与 DocTalk 定向结果均保留；DocTalk 首轮失败原因未确认，不能归因于环境、
历史基线或回归，也不能把最终 E2E 写成全树全绿。

新迁移 `b1_learning_event_cutover` 在专用合成 PostgreSQL 中 upgrade 至该 revision、downgrade 回
`b1_learning_events`、reupgrade 与 roundtrip 均 exit 0；既有事件保留，ORM 与真实 PG schema compare
零差异，既有 17 份迁移与执行到的 18 份迁移 pin 均未变。门控、整包快照、只读、CLI 导入隔离及
八项既往回归缺口探针退出符合预期；READ COMMITTED 反例 mutation 被杀死。早期 R2 的 8 个失败中有
4 个是 fixture 状态缺失错误，修正冻结 R1 的合法 fixture 后才形成 8 个真实目标失败；
10 deselected、exit 1 的 RED 历史不应被写成原先 8 个均为语义 RED。

五阶段切换期间，实际 Job 领取函数 `claim_next_job` 本身没有 gate，因此全部新旧 worker 必须保持
停止到 `traffic_resumed`。部署代码只提供门控，不会启动 worker；显式停写声明、数据库锁和表锁
都不能证明未知旧进程已退出。CLI 只接受已批准的合成库白名单，不隐式读取 `.env`，结果码/用法按
0/1/2 区分；baseline 默认 preview 零写，只有显式确认参数才进入写入事务。零语法错误没有持久来源
行，校验只能检查 coverage 结构与类型，并在来源存在时比对事实，不能独证“零错误”或虚构 Provider
事实。

**历史 B1-4** 的本人数据结构化 JSON 导出已实现，主控独立代码/测试 Review 为 APPROVED，产品返修使用
`1/2`；用户 Review 仍待。下列结果均由主控代跑，实施节点没有冒领测试或数据库执行。初始 backend
基线为 `878 passed / 3 warnings / 0 skip / 80.51% / exit 0`；首轮 RED backend 为
`10 failed / 0 skip / exit 1`，首轮 RED Fake API 为 `106 passed / 4 failed / 0 skip / exit 1`。
R1 非有限值 RED 为 `9 failed / 11 passed / 0 skip / exit 1`，覆盖真实 PG/HTTP 六例和全部 10 个
float 字段的模型矩阵；修后目标为 `20 passed / 0 skip / exit 0`。完整 backend 为
`898 passed / 3 warnings / 0 skip / 80.86% / exit 0`，20 项目标是 898 项的子集，不能相加。
Vitest 为 `1206 passed / 49 files / exit 0`，Fake API 为 `110 passed / 0 skip / exit 0`，构建脚本
为 21、API 类型测试为 8、均 exit 0。format、lint、typecheck、build、backend Ruff format/lint、
OpenAPI schema、provider metadata 和 TS 漂移检查均 exit 0；lint 为 132 warnings/0 errors，warning
行清单与 B1-3 相同，无新增。

完整双浏览器 E2E 的原始结果必须保留为
`233 passed / 1 failed / 0 skip / 0 retry / exit 1`。唯一失败是
`[webkit] e2e/a11y-focus-touch.spec.ts:94:5`：设置抽屉三个 Provider select 为
`336x23 < 44px`，断言位于第 127 行。对应 UI/样式、E2E 用例/配置相对父提交未改，保留同名范围外
遗留；不能归因于未经证实的环境原因，也不能称全树全绿。`run-gates.py` 会容忍 `e2e=1` 并返回 0，
因此聚合 exit 0 不能代表真实 E2E 通过，也不能覆盖原始 exit 1。

专用 `postgres:15.19-alpine` 使用 `127.0.0.1:55433/echotalk_b1_test`。主控从空库重放 18 份既有
迁移成功，迁移字节不变且没有新增 DDL。API 仅新增 `GET /api/user/data-export` 和 13 个 Pydantic
schemas；旧 OpenAPI path/schema 逐值未变，A3 固定的 missing/unmodeled/deviation 清单逐字未改。
OpenAPI 与 TypeScript 由主控原生生成器产出，生成物本身不替代 Fake API 成功响应契约。

导出响应固定 `schema_version=1`，只含 `schema_version`、`exported_at`、sessions、transcripts、
pronunciation assessments、grammar assessments、learning events 与 knowledge states。各节显式
白名单排除密钥、认证身份、内部 prompt/文档、音频、Provider 完整原始响应/引用、幂等键及未列明
字段；Session 仅保留解释子记录所需的最小元数据。独立导出会话使用单一
`REPEATABLE READ READ ONLY` 快照，不复用认证调用方事务，也不通过强制提交 auth 事务解决首次用户
映射；本人空导出仍正常返回空数组。服务验证 Event/Session、Event/AnalysisJob/来源评估及 Skill
关系，并只读取本人数据；空数据返回空数组，部分数据不补造，未知版本保留 `null`。NaN/±Inf 等非有限
float 失败关闭，合法 `None` 保留 `null`。完整模型构造后整体缓冲序列化，成功响应仅带 JSON、
`no-store`、固定附件名和 `nosniff`；失败返回无成功/下载头的通用 500。

主控独立探针确认六类 Job/来源跨归属失败关闭、真实 SQL 列白名单、服务端只读事务拒写、事件与
knowledge state 同快照、后段查询失败无成功头，以及 dev Bearer 缺失/错误和首次映射用户空导出。
READ COMMITTED mutation 被真实并发后提交事件泄漏断言杀死，产品文件未变；修后非有限值探针均为
500 且无下载头。同步导出会完整缓冲在内存中，内存占用和快照持续时间随账户数据增长；本卡没有新增
阈值、分页、异步任务、UI 或真实依赖。

**当前 B1-5** 已实现本平台整账号硬删除。`DELETE /api/user/account` 仅使用 Bearer 映射的本人 ID，
先完成无业务库读取的身份验签，再取得 learning-event control gate，最后复用同一身份完成本地 User
映射/flush。服务在调用方同一事务显式删除 12 类本人数据：users、user_profiles、user_settings、
sessions、transcripts、session_contexts、analysis_jobs、pronunciation_assessments、
grammar_errors、learning_events、knowledge_states 和 call_leases；全局 skills、控制行及其他用户
数据保留。成功固定返回 `200 {"status":"deleted"}` 且只在 commit 完成后发送；异常整体 rollback，
日志和正文只保留通用错误。重复删除幂等，旧 Job、stale recovery、worker 与晚到写入不能复活数据。

删除前验证原控制数量、摘要、canonical baseline 与跨归属关系，坏数据失败关闭，不通过删除或
`SET NULL` 漂白。删除合法 baseline 后按剩余真实事件更新全局数量/摘要，保留 singleton、revision、
cutover_at、phase 和既有 gate；无 control 时用 SREX 表锁封闭 prepare 窗口，不重新从
`knowledge_states` 锚定。`claim_next_job` 本身仍无 gate，全部新旧 worker 必须保持停止到
`traffic_resumed`；部署代码、数据库锁和表锁不能证明未知旧进程已经退出。

主控实测 B1-5 目标为 `36 passed / 0 skip / exit 0`，完整 backend 为
`934 passed / 3 warnings / 0 skip / 81.64% / exit 0`，36 项是完整树子集，不能相加。Vitest
`1206 passed / 49 files`，Fake API `113 passed / 0 skip / exit 0`，build-script 21、API 类型 8、
iOS 脚本 Node runner 37 均 exit 0；lint 为 `132 warning / 0 error`，warning 行清单与 B1-4 逐行
相同。独立合成 PG 正常探针覆盖 12 表删除/他人逐值保留、坏 baseline、跨 user lease、双删除、
首次 cutover、真实 Bearer、未链接旧 User 和 worker 锁序；两项运行时变异被真实 count/死锁断言
杀死。临时 PG 已停止并自动移除。

第一次完整 format 按原始事实返回 exit 1，唯一问题是 `apps/vite-app/scripts/fake-api-test.mjs`；
该文件与六份收口 MD 已由现有 Prettier 纯格式化，主控仍须补跑完整 format 后以最终回执为准。
OpenAPI/TypeScript 只新增 DELETE path 和一个响应 schema，旧 path/schema 逐值未变；18 份既有迁移
字节未变，无新 DDL、依赖、产品 UI 或 workflow。主控代码/测试 Review 为 APPROVED，产品返修使用
`1/2`；用户 Review 仍待。B1-0～B1-5 已完成本地实施与完成项归档，不启动下一卡。提交/推送状态以
同卡最终交付回执为准，当前不预填 SHA；不开 PR、不合并、不部署。生产 DDL/切换/部署、真实数据、
真实不可恢复删除、真实 Provider/LiveKit/IdP/设备、原生 iOS、远端 CI、备份与法定/特殊保留均未
验收。仓库 CI 仅在 `main`/`master` push 与 PR 上触发，任务分支 push 不触发远端 CI。设计与完成记录见
[`LEARNING_EVENTS_DESIGN.md`](./LEARNING_EVENTS_DESIGN.md) 和
[`history/todo-done.md`](./history/todo-done.md)。

## 已知限制和近期风险

- 架构层面的风险（无 TLS 入口、分析可观测性、Compose 就绪门禁、原生认证未适配等）统一维护在
  [ARCHITECTURE.md §7](./ARCHITECTURE.md)，本文不重复。
- CI 前端固定使用与锁文件一致的 Playwright 1.62.1 / Ubuntu 26.04 官方预装镜像及 digest，
  避免运行时安装浏览器系统依赖反复受软件源 DNS 故障阻断；保留 Node 22、全部原有测试与检查名，
  并在运行 E2E 前核验两个浏览器可执行文件。具体结果仍需绑定相应 head 的 CI 日志。
- 前端 lint 有 132 条 warning（0 error），主要是 `Unexpected any`。
- 输入框与卡片边框对比度约 1.2，低于非文字组件 3.0 的要求；会话中界面的 LiveKit 控制条未在真实连接下验收。
- B1-5 完整双浏览器 E2E 仍为 `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败是设置
  抽屉三个 Provider select 的 `336x23 < 44px`；UI/样式/E2E/配置相对父提交未改，按同名范围外
  遗留保留，不能据此称全树全绿或未经证实归因环境。聚合门禁 exit 0 不覆盖该原始失败。
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
