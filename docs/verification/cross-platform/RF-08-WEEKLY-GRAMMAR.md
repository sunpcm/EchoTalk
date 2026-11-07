# RF-08 七天语法 Top 3 与宿主 HTTP — 资源边界与验收手册

> 对应契约：`/Users/sunpcm/code/EchoTalk/.review/reports/overnight-grammar-http-20261104/contract.md`。
> 2026-11-05 文档收口基于主控已确认的最终功能证据。产品代码与测试由实施方编写；后端测试、
> OpenAPI 生成、迁移、镜像和 HTTP 由主控受控代跑。凭据只在主控 `R/protected` runtime，
> 不进 Git 或报告正文；本节点只完成文档字节。

## 1. 产品口径摘要

认证只读接口为 `GET /api/assessments/weekly-grammar?end_date=YYYY-MM-DD&timezone=IANA`。
窗口是截至 `end_date` 的滚动七个本地自然日，从 `end_date - 6` 至 `end_date`，不是周一
开始的 ISO 周。

- 窗口精确复用 `services/session_queries.py` 的 `weekly_day_windows`，不放宽既有
  daily/history 的 48 小时校验，不改既有 API、游标或 ≤48h 窗口行为。
- 以 `Session.started_at ∈ [start, end)`、`status=completed`、`user_id=当前用户` 确定会话；
  语法分析写入时间（`GrammarError.created_at`）不作为窗口过滤，迟到分析仍归原会话周。
- 只消费 `GrammarError.is_synthetic=false` 且 `source ∉ {demo_rule, demo_mock}` 的既有记录；
  当前分析生产链仍写 demo 数据，因此零条可统计记录和空态是合法结果。测试中带 `real`
  语义标记的行仍是显式合成 fixture，不代表真实 Provider 分析结果。
- 固定归类：`article_usage`、`verb_tense_past`、`verb_tense_present`、
  `subject_verb_agreement`、`preposition`；空白、未知和发音类标签在聚合前合并为 `other`。
- 按 count 降序、再按规范 `skill_tag` 升序稳定排序，取前三；`total_errors` 包含全部可统计
  记录，包括榜外类。零记录返回 `total_errors=0`、`items=[]`。
- 响应 `WeeklyGrammarSummary` 为
  `{start:UTC, end:UTC, total_errors:非负整数, items:[WeeklyGrammarItem]}`；
  `WeeklyGrammarItem={skill_tag:六类枚举, count:正整数}`，最多三项。响应不含正文、原句、
  改正文本、用户 ID、密钥、Provider 错误正文或生成式建议。
- 单条有界 SQL 聚合，仅读取必要列；不加载会话 ORM/关系、不逐会话查表、不读正文。

## 2. 精确资源边界

| 项目                | 值                                                              |
| ------------------- | --------------------------------------------------------------- |
| scope               | `echotalk-grammar-http-20261104`                                |
| 产品 PG 容器名      | `echotalk-grammar-http-20261104-test-pg`                        |
| network             | `echotalk-grammar-http-20261104-product-host`                   |
| 数据库 / 用户       | `echotalk_grammar_http_test`                                    |
| 宿主 PG 端口        | `127.0.0.1:55444`                                               |
| tmpfs               | 仅本轮独占 tmpfs，不复用其它轮次                                |
| runtime 容器名/网络 | 由同 scope 派生；runtime 库使用全新独占 PG 实例与 internal 网络 |
| 宿主 HTTP 端口      | `127.0.0.1:18800`（可 `18801..18809`）                          |

建 PG 前由实施 owner 追加精确边界；主控亲读迁移和 SQL 空库身份并单独批准后才迁移。仅允许
本轮全新专用库和显式合成数据，禁止旧库、应用库、QA、生产库、降级或清表。API 测试的
`DATABASE_URL` 缺失时不得启动 pytest，不能回退 dotenv 或默认应用库。

## 3. API 实现、测试与 Review

API 候选在 HEAD `8fa9c0a8f2170eb21b38f0bdca8d551e9dd94ef3` 上经独立 Review 判为
APPROVED，冻结源指纹为
`0c62b0137d30c05d9943722639fc4525b729c8bc2b9929dcb52e2a54e3afb169`。该输入含路由、
schema、单 SQL 聚合、真实 PostgreSQL 回归、OpenAPI、生成器输出和当时的两份文档；
`backend/openapi.json` 只由主控原生生成，未手写。

主控在专用 PostgreSQL 与受控 Python 环境中执行 backend 五项，结果均为 process/gate
exit 0：实际 **773 passed、3 warnings、覆盖率 78.48%**，保持 59% 门禁。完整 pytest 和
独立源码 Review 是一次受控执行的两类证据，不记作实施者自测与主控测试两份独立通过。

新增回归覆盖以下边界：

- UTC、新加坡、纽约春季 23 小时日与秋季 25 小时日的七个连续 UTC 半开窗口，以及整周首尾
  微秒边界；`Pacific/Apia` 跳过的本地日期不会造成重复统计。
- `CurrentUser` 隔离、completed 状态、合成记录、`demo_rule`/`demo_mock` 排除；
  窗口内与窗口外会话交叉配置相反的 `GrammarError.created_at`，最终只统计窗口内 session，
  证明归周依据是 `Session.started_at`，不是错误分析写入时间。
- 六类固定标签、unknown/空白/发音类归入 `other`、榜外错误计入总数、count 降序与同分
  `skill_tag` 升序、空态、匿名 401 和非法日期/时区 422。
- 实际捕获恰好一条有界 SELECT，核对半开边界、当前用户、状态、合成与 demo 过滤、必要列，
  并拒绝正文、关系加载、写语句和无关列。

有意义变异分别删除当前用户过滤、合成记录过滤和 host-gateway IP forward guard；对应真实
PostgreSQL 断言或安全断言均杀死变异，之后已精确恢复。r0/r1 的首次失败与中断记录继续保留，
没有用恢复后的通过结果覆盖历史。

## 4. 最终宿主 HTTP 验收

历史事实继续有效：先前仅有 internal 网络时，宿主 `127.0.0.1:18800` 不可达，
`host_loopback_health_verified=false`。本节的最终宿主 HTTP 使用后续单独审批的
host-gateway 拓扑，不改写该历史结论，也不声称原 Compose 或通用 internal-only 入口已通。

最终集成输入通过宿主 `urllib` → loopback 固定网关 → internal 真实 uvicorn TCP 完成 16 次
GET，进程与 gate 均 exit 0：

- `/api/health` 返回 200，匿名 weekly-grammar 返回 401，缺 Key 的 readiness 返回 503；
  weekly-grammar 有效请求 3 次返回 200、非法参数 2 次返回 422。
- 静态合成夹具的语法结果为 `total_errors=21`，Top 3 是 `other=7`、`article_usage=5`、
  `verb_tense_past=5`；窗口为 `2026-10-26T04:00:00Z` 至 `2026-11-02T05:00:00Z`，覆盖
  纽约秋季 25 小时日。
- weekly-progress 与历史分页通过；历史共 55 条、4 页。cursor 负向请求实际改变 `status`
  而非只换窗口，返回 422；另覆盖超过 48 小时的 session 窗口、非法 date 与非法 timezone
  的 422。鉴权失败返回 401，请求前后数据库计数保持不变。
- API 与 PG 均只连接本轮 internal 网络，无宿主端口和默认公网路由；仅固定网关同时连接
  internal 网络和专用 bridge，宿主只发布 `127.0.0.1:18800`。网关 `ip_forward=0`，
  网关容器内 `docker exec` 可直连同 bridge 的本地 canary，同探测从 API 容器被阻断；
  这分别证明 bridge 可达性与 API 隔离，不证明网关提供任意 relay/代理，未接触公网。

本次 HTTP 使用合成测试夹具，不是真实 Provider、IdP、LiveKit、语音或设备验收。网关通过也
不扩展为任意上游代理能力。

## 5. 资源清理与外部边界

最终 runtime-cleanup 与 product-cleanup 两项均为 process/gate exit 0；容器和网络按本轮
不可变 ID、scope、label、镜像与网络归属核验后移除，自有资源清单为空，未执行全局 prune。
产品 PG 的 runtime fixture 与运行资源均已清理；测试、停写、证据与 worktree 保留。

状态按边界分列：

- 本地：最终组合功能门禁通过；完整计数为 1133 Vitest、21 build-script、72 Fake API、
  8 API type、773 pytest/3 warnings/78.48%、31 runtime unittest、178 Chromium/WebKit E2E
  且 retries 0。
- Review：API、UI、runtime 分项已 APPROVED；本次文档修改后仍需主控独立完成最终总 Review。
- commit/push/CI：本轮候选保持 dirty，未 commit、push、merge 或部署；当前 dirty 候选没有
  远端 CI 结果。
- 外部：真实 Provider、IdP、LiveKit、语音、设备、native 编译与生产部署未验证；原 Compose
  整栈未启动。它们不由本地测试、Fake API、合成 HTTP 或容器内 canary 代为通过。

## 6. 证据索引

证据根 `R=.review/reports/overnight-grammar-http-20261104/`：

- `R/api/REVIEW-r1.md`、`R/api/approval-for-copy-r1.json`：API 实现审批输入与冻结 SHA。
- `R/final-quality-checks-r1/summary.json`：最终组合 15 项质量门禁与 backend 773 项。
- `R/final-runtime-checks-r2/summary.json`：runtime format/lint/31 unittest/wrapper。
- `R/runtime/host-http-checks-r2/summary.json` 与 `R/runtime/host-http-r2/result.json`：
  最终宿主 HTTP、拓扑、隔离和请求结果。
- `R/runtime/cleanup-checks-r2/summary.json`：runtime 与产品资源清理回执。

## RESTORE-20261107 收口

本段替换 delivery r0 候选追加，不改写上方从
`42c61bb08f5e234989198ef46ed7534a80c70796` 恢复的原文。上方历史 CI 与已验记录只属于
当时提交。本候选没有 push，也没有本轮远端 CI。这里的 Node 回归不能代替 native
App、Xcode、Rust 构建或设备验收。真实 Provider、IdP、LiveKit、语音、生产部署和原
Compose 整栈未验。根格式与保全回执见主控交付报告，这里不预告根格式通过。

本轮宿主 HTTP 覆盖 weekly grammar。全部 HTTP 数据都是合成 fixture，包括 real-flag
行，不是实际用户或真实 Provider 数据。`total_errors` 为 21，其中含榜外记录；榜内
三项 `other` 7、`article_usage` 5、`verb_tense_past` 5，合计 17。Worker 演练另有一条
synthetic grammar，与这批 HTTP fixture 分开。读请求前后数据库计数不变。
`WeeklyGrammar` 请求 slot 归属守卫的 suspend 与 offline 迟到失败均被杀死，源码指纹
已恢复，没有产品补丁。此结果不证明真实 Provider 或语音链路。
