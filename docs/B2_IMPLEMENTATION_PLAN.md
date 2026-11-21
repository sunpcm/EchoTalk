# B2 新 main 增量实施计划

> 日期：2026-11-17。基线：`5d3641203484d66454a45f6d43547648b99dc05c`。
> 本文为当时的增量实施计划与已确认口径；进度与是否合入/生产切换见根目录 [TODO 总账](../TODO.md)。

## 1. 已确认口径

B2 在 EchoTalk 应用仓 `sunpcm/EchoTalk` 内增量实施。当前 main 已包含学习事件及相邻
能力，本计划不搬入旧 P1 的 CREATE TABLE，也不改 review-loop 框架或其他项目。

开发期事件链从干净 Job 起步：

- 不承接旧测试 Job、旧状态或旧事件；
- 不写 baseline、不回填、不从派生状态反推观察；
- 不开放成功 Job 的重新分析；
- 冻结 `bkt-v1`；
- 历史 cutover 表、维护代码和迁移保留，新成功链不以它为准入；
- 删除、导出和 goals 保留，真实 retention 未批准。

## 2. S0：契约与当前 main 对齐

状态：已独立 `APPROVED R1` 并本地提交。

交付：

- [B2 学习事件契约](./B2_LEDGER_CONTRACT.md)；
- [学习事件设计](./LEARNING_EVENTS_DESIGN.md) 的 B2 增量附录；
- [下一阶段决策](./archive/2026-11-21-document-consolidation/NEXT_PHASE_DECISIONS.md) 的 B2 增量附录；
- [Agent 评审手册](./agent-review-loop.md) §21 的专用 namespace 与执行边界。

验收：

- 干净起步、无旧 Job/状态承接、无回填、无重新分析、`bkt-v1`、七键 coverage、完整批次、
  Job→User、RR/READ ONLY 与首 watermark 均落到当前 main；
- 明确 S2 的删除 `User→Job` 与 writer `Job→User` 兼容锁序风险；
- 不把历史 cutover 的存在解释为新成功链必须经过 cutover；
- 不把本包写成 S2/S3、真实服务或部署完成。

## 3. S1：已有表增量加固

状态：已独立 `APPROVED R1` 并本地提交。

### 3.1 写集

- `backend/models/learning_event.py`：24 列、6 FK、索引与 9 CHECK 的 ORM 契约；
  `apply_seq` 表达 ALWAYS identity。
- 新增 `backend/alembic/versions/b2_ledger_hardening.py`，唯一父版本
  `b1_goal_evaluation`。
- 新增 `backend/tests/test_b2_ledger_hardening.py`：离线 DDL 契约与严格 namespace 的
  真实 PG 探针。
- 10 个既有 B1 guard 仅增加 `127.0.0.1:55446/echotalk_b2_main_test`，该 tuple 额外
  要求 role 精确同名；原 55433/CI 行为不变。
- 新增 `test_learning_event_write.py` 的唯一例外：未知 mapped model version 从旧
  “成功且 NULL”改为 S1 shape 约束拒绝，验证整批无残留；writer 与 I1 DTO 不改。

### 3.2 迁移行为

upgrade 只做：

1. 删除旧 `ck_learning_events_shape`；
2. `apply_seq` 改为 `GENERATED ALWAYS`；
3. 新增 5 个 CHECK；
4. 重建冻结 B2 shape CHECK。

禁止 CREATE/DROP `learning_events`、UPDATE/DELETE/TRUNCATE、SETVAL、回填或伪造
unknown。已有非法行让 upgrade 失败并回滚。

downgrade 只移除 5 个新增 CHECK 和新 shape，恢复 B1 shape 与 BY DEFAULT identity；
保留数据、列、索引、FK、其他表和历史 revision。

### 3.3 验收

主控先静态审阅 upgrade/downgrade 真实 SQL，再在专用空库执行：

- B1 head 到 B2 head 的 upgrade/current；
- 24 列、6 FK、索引、identity ALWAYS、9 CHECK；
- details JSON object 与数值 1、algorithm_params object、空串、NULL 与布尔正负例；
- 合法旧行保留、非法旧行阻止迁移且无自动清理；
- downgrade 回 B1 精确形状/BY DEFAULT，再 reupgrade；
- 原迁移、其他表与无关对象不变。

实施作者不连接 Docker、55446、数据库或读取凭据。主控执行真实迁移流与三树。

## 4. S2：同事务成功链

状态：已独立 `APPROVED R1` 并本地提交。

适配现有 `analysis_service`、`analysis_jobs`、`learning_event_canonical`、
`learning_events` 和共享 BKT，不新建平行 writer/API。

目标：

- 固定 rich coverage 与完整来源集合，生成七键 coverage；
- mapped `model_version` 未知、空串、异质来源或不完整证据整批拒绝，不伪造 unknown；
- 发音保留原数组位置，语法稳定排序并拒绝重复稳定键；
- Job→User 锁内重验 running、Session/User/Job/来源归属；
- completed 与全部观察、真实 BKT、Job succeeded 同事务；
- 全合成写事件但零状态读写，失败/取消整体回滚；
- 成功链不依赖历史 cutover/baseline，但保留删除/导出/goals。

必须单独解决账号删除 `User→Job` 与 writer `Job→User` 在退出旧共享 control 锁后的
兼容锁序。设计、代码与真实 PG 并发证据通过前，不切运行路径。

S2 实现把生命周期屏障前移到 Job/GoalRun/User 行锁和真实删除 router 身份映射之前；
success writer、直接 writer、worker 与删除使用同一屏障。七键 coverage 保留调用级
`metadata`，有持久化来源行时 `source_facts` 投影完整同质行，零来源零错误时从本次调用
metadata 投影四事实。导出继续从新七键 `source_facts` 投影既有五字段 DTO，响应 schema
不变。真实 BKT 更新只检查本批参与更新的技能：旧状态须有排除当前 Job 的真实 B2 历史，
该历史可以是 `evaluated/current_invocation` 或 `not_called/persisted_rows`，但都须有完整
七键 coverage 与真实非合成 `source_facts`；旧状态无历史、或有真实历史但状态缺失，均整批
拒绝。只有既无旧状态也无真实历史时从 `p_init=.1` 起步，全合成保持零状态读取。

S2 测试覆盖规范顺序、幂等残批、完整来源、并发锁序、删除屏障、取消/回滚、导出投影和
上述三类状态起点；真实 PostgreSQL 与三树由主控执行。

## 5. S3：只读重算

状态：已独立 `APPROVED R2` 且本地实现验证完成、未 push/合 main/部署。完整 backend
1505 passed / 3 warnings / 82.55%，前端复用 R0 的 Vitest 1429/73、E2E 326（C163/W163）
零 retry/skip/flaky/unexpected 与 285 同字节输入；19 项独立 PG 探针全绿、19/19 有效
变异 RED 后恢复 GREEN。综合 20 门禁为 R0 完整运行、R1 受影响检查与 R2 完整后端复测综合
核算，R2 未重跑全 20。实施含共享 `learning_event_canonical` 的非法 falsy JSON guard
修复（显式区分 `None`、合法 `[]` 与非法 falsy JSON，复用 `_pronunciation_entries`）。
生产、真实 Provider、真实学习质量、业务清理、push、CI 与 main 合并均未执行。

适配现有 replay：

- `REPEATABLE READ READ ONLY`，首条数据查询固定 `MAX(apply_seq)` watermark；
- 同一快照读取事件、成功 Job、来源和状态；
- 从 `p_init=.1` 重放真实非合成观察；
- 校验完整批次、七键 coverage、规范键/顺序、算法版本参数、成功 Job 和状态；
- 意外 baseline 报告 `unexpected_baseline`；
- 只报告，不修数据；watermark 后提交不误报。

并发证据使用双连接屏障，记录 `watermark 返回 → writer 提交 → observer 后续读取`。
旧 `ACCESS EXCLUSIVE` 锁等待不能替代该证据。

## 6. 公共门禁

每个后续代码包由主控运行 Vite Vitest、Vite Playwright、backend pytest，以及适用的
格式、lint、类型、构建、schema 和漂移检查。真实 PG 只在 §21 指定的专用 namespace。

实施作者自行执行 Ruff、compileall、纯离线 pytest。没有执行某树或真实 PG 时，必须
明确列为未验证，不能用 skip、缓存日志、旧报告或旧 P1 证据代替。

## 7. 非范围

- 执行 Alembic、访问 Docker/DB/.env/凭据、读取 reviewer 私有探针；
- 清理业务数据、承接旧 Job、写 baseline、回填或重新分析；
- 真实 retention、生产切换、部署、commit、push 或 merge main；
- 宣称真实服务、CI 或生产已通过（S2/S3 代码与测试仅本地独立 Review 通过，未上线运行）。
