# RF-08 七日本地自然日会话概览

本轮新增独立只读聚合接口，供 Dashboard 的七天概览与按日历史使用。已有
[每日聚合与分页契约](./RF-08-PAGINATION-DAILY-PROGRESS.md)、认证、业务模型及迁移保持原样。
本文件记录已获 APPROVED 的 A 产品/测试及主控最终组合、镜像/真实 HTTP 的分项验收。
本 r2 仅文档收口；测试和服务均由主控受控代跑，实施者未执行。
最终功能 16 项及独立 E2E 已通过，最终输入新镜像与真实 HTTP 已验；
**root format 待主控最终回执**，当前不能声称完整 15 项全绿。

## 接口与数据口径

认证 `GET /api/sessions/weekly-progress?end_date=YYYY-MM-DD&timezone=IANA`，两个参数必填。
`end_date` 严格采用有效 ISO 日期；`timezone` 非空、最多 128 字符，通过标准库 `ZoneInfo`
验证。非法日期/时区、本地日期加减或转换 UTC 溢出均返回 422。

响应固定 `{ days: [{ date, start, end, completed_sessions }] }`，恰好七桶，按本地日期
`end_date - 6` 至 `end_date` 升序，空日仍返回 0。`date` 为 ISO 日期，`start/end` 均为
显式 UTC 时间戳。日期端点分别从当地午夜转换为 UTC，采用 `start <= started_at < end`，
支持纽约 23/25 小时自然日。Apia 等跳过的日期可以返回 `start == end` 的零桶；客户端应
直接展示该日空态，不把零长度窗口发送给既有历史接口。

统计只包含 `CurrentUser.id` 的 `completed` 会话，零转录会话仍计 1；不接纳客户端指定的
`user_id` 为归属依据。指标名为“已完成会话数”，不返回转录轮数、会话历时、学习时长、
掌握度走势或生成式建议。转录多条不会让会话重复计数。

## 查询边界与兼容性

- 新静态路由在 `/sessions/{session_id}` 之前，沿用 `get_current_user`，未认证返回 401。
- 先计算八个 UTC 午夜边界，再在单条 SELECT 内对七个半开区间做条件计数；WHERE 同时
  限定当前用户、completed 状态及整周起止，不逐日或逐会话发查询，不使用 OFFSET。
- SQL 只访问 `sessions.user_id/status/started_at` 和计数，无实体加载、关联表查询或正文，
  不触发模型现有的 selectin 关系，不写入、结束会话或创建分析任务。
- 原 `validate_window` 的成对、带时区、`start < end`、不超过 48 小时的规则原样保留。
  原 daily 的 distinct 会话数及所有角色 transcript 条数保持；weekly 不复用 daily SQL。
- 选中非零长度日后，历史复用 `GET /api/sessions?status=completed&start=...&end=...`，
  仍按 `(started_at DESC, id DESC)` keyset 分页。游标对用户、端点、状态和窗口的绑定不改，
  换日/换人/换端点复用均拒绝为 422。游标仍是上下文校验，未新增签名或授权能力。

## 本轮回归与主控后端验收

新增 `backend/tests/test_session_weekly_progress.py`，使用真实 PostgreSQL 与真实 ASGI 路由，
测试自建用户/会话/正文仅存在于每例的独立事务，finally 关闭会话并回滚事务、释放引擎。
`DATABASE_URL` 缺失直接失败，不靠 skip 或 dotenv 回退通过。

| 回归        | 断言范围                                                                            | 验收归属与状态               |
| ----------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| 时区/空桶   | UTC、新加坡、纽约春秋 DST 的七桶顺序、显式 UTC、连续边界、23/25h                    | 主控 A r1 完整 pytest 已通过 |
| 计数/归属   | 每日午夜与结束前微秒、整周前后界、零转录、多角色转录、active/cancelled 排除、跨账号 | 主控 A r1 完整 pytest 已通过 |
| 极端日期    | Apia 零长度日不重复计数、非法日期/时区/路径、输入长度、本地日期及 UTC 溢出 422      | 主控 A r1 完整 pytest 已通过 |
| 只读 SQL    | 实际捕获恰好一条有界 SELECT、必要列、零关联/正文/写语句                             | 主控 A r1 完整 pytest 已通过 |
| 历史兼容    | 使用 weekly 的 25h 桶分页，无重复/遗漏，换日/换人/换端点游标 422                    | 主控 A r1 完整 pytest 已通过 |
| 旧窗口/鉴权 | daily/history/active 七日窗口仍 422、无凭据及非法凭据 401                           | 主控 A r1 完整 pytest 已通过 |

主控在本 lane 的独立 Python 3.12 dev 环境、专用真实 PostgreSQL 上受控执行完整 pytest，
实际 **678 passed、3 warnings、覆盖率 78.67%**，59% 门禁保持；含新增 34 项 weekly
回归及原分页、活动发现和转录幂等测试。A r1 的 backend-format、backend-lint、backend-test、
schema-check、provider-metadata-check 五项 process/gate exit 均为 0，独立 Review 为
APPROVED；主控还记录真实 PG 的跨用户过滤变异被四个计数断言杀死并恢复原指纹。
原测试文件和断言未弱化。以上为主控执行结果，不计作实施者独立自测，也不代表最终组合。

本轮本地证据根 R 为主 checkout 的 `.review/reports/overnight-product-runtime-20261103/`：

| 检查              | 主控实际结果                                                        | 证据                                                           |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| r0 首次后端格式   | exit 1，仅新增测试文件四处排版；其余 126 文件已格式化，历史失败保留 | `R/api/checks-r0/02-backend-format/command.log` 及对应 summary |
| r0 lint/pytest    | 分开补跑 exit 0，678 passed / 3 warnings / 78.67%；不改称 r0 全绿   | `R/api/functional-checks-r0/summary.json`                      |
| 原生 OpenAPI 导出 | 主控已生成，仅新增 weekly 路径及两个 schema；实施者只读             | `R/api/schema-diff-r0.txt`、`R/api/review-r0.md`               |
| r1 后端完整五项   | 五项 exit 0；678 passed / 3 warnings / 78.67%，59% 门禁保持         | `R/api/checks-r1/summary.json`                                 |
| r1 独立 Review    | APPROVED；允许冻结字节机械复制，无 commit/merge 或最终组合放行      | `R/api/REVIEW-r1.md`                                           |

首次 r0 pytest、lint 与格式检查绑定指纹
`5e7d0d19609f1e83054da6d1fbe1a0357a65b8500e800a276da7465f24d93e08`。
当时主控 Review 为 CHANGES REQUESTED。r1 仅四处格式与事实文档修订，修后主控五项
完整验收绑定指纹 `e70aec5f656600672c1378d593ade55f3d97775f2052182e1b26257ca3ef912a`。
本 r2 不修改这些已 APPROVED 的产品、测试或 OpenAPI；仅交付两份文档增量并停写。

## UI、运行时与最终组合验证索引

| 范围                  | 已知结果                                                                                                                                                                        | 证据与尚待边界                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| B frontend10          | 十项 exit 0：1098 Vitest、21 build-script、69 Fake API、8 types，类型漂移/构建等通过                                                                                            | `R/ui/quality-fixed-r1/summary.json`；仅 B 冻结输入                                                                                                 |
| B 双浏览器            | 174 场景 = 173 clean + 1 flaky；process/gate exit 0                                                                                                                             | `R/ui/quality-fixed-r1/10-e2e/command.log`；WebKit 旧 `settings-drawer.spec.ts` 的 beforeEach `page.goto` 首试 30s 超时，重试通过，归因未定         |
| C 工具质量            | runtime-format/runtime-lint/runtime-unit 三项 exit 0；19 unittest                                                                                                               | `R/runtime/c2-project-quality-checks-r1/summary.json`；精确命令见手册 §2.2，manifest 显式绑定 C lane `backend/pyproject.toml`，Ruff 使用 `--config` |
| C1 真实隔离服务       | 独立 Review APPROVED；真实 uvicorn TCP 的 container-http health 200 / anonymous 401 / missing Key ready 503                                                                     | `R/runtime/c1-review-r1.md`、`R/runtime/c1-r1/exercise/result.json`；宿主 18800 false、Worker 137、仅预置过期任务恢复                               |
| 最终功能 16 项        | 前端除 format/e2e 的 8 项 + backend5 + runtime3 全部 process/gate 0；1098 Vitest、21 build-script、69 Fake API、8 types、678 pytest/3 warnings/78.67%、19 runtime，59% 门禁保持 | `R/final-functional-checks-r1/summary.json`；这 16 项不含 root format/E2E                                                                           |
| 最终双浏览器          | 173 clean + 1 flaky = 174，process/gate 0；8 条新增 weekly 场景全部通过                                                                                                         | `R/final-e2e-checks-r1/summary.json`、`R/final-e2e-checks-r1/01-e2e/command.log`                                                                    |
| 最终 root format      | **pending：待主控最终回执**；首败 exit 1 仅两份 A 文档未原生 Prettier                                                                                                           | `R/final-quality-checks-r1` 保留首败；owner 全停写后主控统一原生 Prettier/机械 copy，再重跑 root format                                             |
| 最终镜像测量          | 包含最终 A 源码的 154 文件新 API/Agent 镜像已构建和测量                                                                                                                         | `R/runtime/final-measure-r1/receipt.json`；只作为最终输入验收，不混入旧配对收益                                                                     |
| 最终镜像完整性        | 两角色各 154 文件核验、dev_absent/frozen_export_matches 均通过                                                                                                                  | `R/runtime/final-integrity-r1/result.json`                                                                                                          |
| 最终真实服务          | 真实 runtime/uvicorn TCP HTTP、显式过期任务恢复/幂等已验；Worker 137/API 0/宿主 18800 false 保留                                                                                | `R/runtime/final-services-r1/exercise/result.json`                                                                                                  |
| 最终 weekly 真实 HTTP | GET-only：7 桶、2 completed、23h DST、历史两页各 1、换窗口 cursor/非法时区 422、匿名 401                                                                                        | `R/runtime/final-services-r1/weekly-http-r1b/result.json`、`R/runtime/final-http-recheck-checks-r1b/summary.json`                                   |
| 自有资源清理          | 主控确认 C1/C2/final 已清，final HTTP/cleanup 两项 exit 0；最后产品 PG 正由主控清理                                                                                             | final HTTP/cleanup summary 同上；产品 PG 最新状态以 `R/report.md`、`R/progress.json` 为准                                                           |

B 结果绑定指纹 `761a7c6bf84409d756e23ae5fb013ca627e481c474a56b5cc6661d2c2c23a8e6`；
E2E summary 的 count=173 是 clean 数，另有一条 flaky，不能写为 174 条 clean。
最终组合 E2E 又在同一 `settings-drawer.spec.ts` 的 beforeEach `page.goto('/')` 首试
30s 超时，retry 通过；本轮多次出现，根因及与本轮变更的关系尚未裁定，不能确定归为
既有问题或环境问题。保留 lane 与最终原日志/重试记录，不写成 174 条 clean。
C 工具三项绑定指纹 `7f5add2cb20657dfaa811d3b9c06ab7cf164b95d4e5d6f0085de9c56089ea3c5`，
与真实服务/镜像验收独立，均不计入旧 frontend10/backend5 的 15 项。
最终组合的 16 项与 E2E 有独立回执，不再以 lane 结果替代；实施者未运行这些验收。
root format 首败只指向本批两份 A 文档，主控将统一原生格式化/复制并重跑，
当前完整 15 项尚不能写为全绿。本轮停写不等待格式回执继续改写；后续最新整体结论、
格式与最后产品 PG 清理状态，以主控 `R/report.md` 和 `R/progress.json` 为权威。

最终镜像为 linux/arm64：API
`sha256:eecbd997b19725256b7391eb1d4c068025f08bef41df62d4aee4eec9e8111cde`，Agent
`sha256:ba556d437c23d178e2eeea887137368ccadd15d87ca85a5c0bb6e1766ebf2e9e`。
体积收益仅用 `R/runtime/paired-comparison-r1.json` 的独立 before/after 配对：
API **0.1803%**、Agent **0.2728%**。最终 154 文件新 ID 与该配对 after ID 不同，
不得混算收益，也不据体积差推导真实语音冷启动改善。

## 数据库与验收限制

本轮专用数据库、端口、协调锁及空库迁移审核边界见
[评审手册 §3.2](../../agent-review-loop.md)。实施者不读取凭据，不执行测试、安装、服务、
数据库操作或生成器；`backend/openapi.json` 和前端生成类型仅由主控原生生成。
主控资源回执确认产品 PG 为 `echotalk-overnight-20261103-test-pg`，库/用户均为
`echotalk_overnight_test`，PostgreSQL `150019`。初次 internal-only 网络无实际端口发布，
宿主连接失败且未迁移；之后对同一 PG 改用本轮专用普通 bridge
`echotalk-overnight-20261103-product-host`，仅 `127.0.0.1:55444`。空库 SQL 核验
relations/types/functions 为 0 后，主控迁移至 `c06_transcript_events`；详见
`R/setup/product-pg-resource-r1.json`、`R/setup/product-db-empty-before.json`、
`R/setup/product-db-migrated.json`、`R/setup/product-network-review-r0.md`。
实施者只读这些无凭据回执，
没有独立连接或执行 SQL，C 运行时 internal 硬边界保持。没有性能实测或生产查询计划证据。
新增 runtime runner 的精确清单见[手册 §2.2](../../agent-review-loop.md)，真实命令按
[RF-07 隔离服务文档](./RF-07-ISOLATED-SERVICES.md)由主控审核，不属于既有 15 项。

C1 专用 PG 为 `echotalk-overnight-20261103-runtime-pg`，用户/库均为
`echotalk_overnight_runtime`，tmpfs、全新 internal 网络、无 PG 宿主端口。主控真实 HTTP
通过 API 容器内 stdlib 客户端，经 TCP 访问实际 uvicorn；
`host_loopback_health_verified=false`，不声称宿主 `127.0.0.1:18800` 已可用。
过期任务是主控显式准备的合成 running 任务，重启后 attempt2/succeeded，产出一份 synthetic
assessment、一条 synthetic grammar、零 KnowledgeState；再次重启与真实分析调用保持幂等。
该范围不证明任意崩溃恢复。exercise 回执中三个 Worker 已停、exit 137，API 已停、exit 0，
未证明 Worker 优雅关闭。历史 exercise 时点的 PG 保留不等于后续未清；主控现已确认
C1/C2/final 自有资源清理通过，final-cleanup 的 process/gate 0 另有上述 summary。
最终镜像复验仍是三个 Worker 137/API 0/宿主 18800 false、prepared_expired_job_only；
不外推任意崩溃恢复，不把强杀退出写成优雅关闭。最后产品 PG 清理由主控收尾，
本节点未操作，最新结果以主控总报告/进度为准。

真实 IdP/Provider/LiveKit、语音、原 Compose 整栈、设备、native 编译、远端 CI 与部署
均未验证；只读聚合实现
不证明真实语音、学习能力走势或生产查询延迟。本轮不新增索引/依赖/迁移，若未来数据量
显示查询瓶颈，再凭真实查询计划评估复用索引或其他优化。
