# RF-07 隔离 API / PostgreSQL / 分析 Worker 验收

## 2026-11-04 grammar-http 资源边界（已实际收口，跨 11-04 夜间至 11-05）

本轮 scope 固定为 `echotalk-grammar-http-20261104`。runtime PG 容器固定为
`echotalk-grammar-http-20261104-runtime-pg`，用户和数据库均为
`echotalk_overnight_runtime`，使用全新独占 PG 实例、`/var/lib/postgresql/data` tmpfs，
不发布端口。internal 网络为 `echotalk-grammar-http-20261104-runtime-<run_id>-internal`；
仅 `host-gateway` 模式另建普通 bridge
`echotalk-grammar-http-20261104-runtime-<run_id>-gateway`。API、PG 只能接 internal；
固定上游 gateway 同时接这两个本轮网络，只有 gateway 发布 `127.0.0.1:18800..18809`。
API 与 gateway 容器名分别由同一 scope/run_id 派生为
`echotalk-grammar-http-20261104-api-<run_id>` 和
`echotalk-grammar-http-20261104-host-gateway-<run_id>`，其他探针/Worker 同样按 scope
派生。所有资源带该 scope、不可变 run/role/source 标签；创建前拒绝名字、网络或端口冲突。

`manifest.scope` 必须显式等于上述值；旧 `echotalk-overnight-20261103` manifest 保持原兼容
默认值和 `container-http` 行为，新 scope 不允许隐式继承旧数据库或资源名。gateway 复用
已批准 API 镜像内的 stdlib，只绑定已核验 API 容器 internal IP:8000，不读取 app env、
不携带数据库或 Provider/IdP/LiveKit 凭据，不提供 CONNECT、任意 URL 或客户端指定上游。
每个网络/容器先写创建意向、创建后立即写不可变 ID journal；失败只停止/清理本轮已核验
资源，不能按模糊名称或全局 label/prune 清理。真实服务、数据库、HTTP 和清理已由主控
实际执行并通过（见下方最终收口）。

### 初始 manifest 与受控验收矩阵

初始镜像输入只读使用本轮 `R/runtime/base-image-receipt-r0.json`、
`base-image-provenance-r0.json`、`base-inputs-r0.json` 和 `base-source-r0`。
主控指定 baseline API ID 为
`sha256:d045deddd63d44a4860f0ce86e4243c15c78fe9a8229a40121dfda260027e112`；
它不含新 weekly-grammar，仅用于 PID1 诊断；health/GET、拓扑与 weekly-grammar 业务均由
最终 157 文件新镜像验收，不能把 baseline 结果改记为最终接口通过。

新 manifest 在原有字段上显式加入：

```json
{
  "scope": "echotalk-grammar-http-20261104",
  "database": "echotalk_overnight_runtime",
  "postgres_name": "echotalk-grammar-http-20261104-runtime-pg",
  "http_transport": "host-gateway",
  "http_port": 18800,
  "gateway_sha256": "<host_gateway.py 实际 SHA256>"
}
```

`http_port` 可在 18800..18809 中选择主控核验未占用者。其余字段继续填写实际冻结的
schema/run_id、snapshot/source_inputs 及其 SHA、api/postgres image ID、api source SHA、
platform、probe SHA、report_root、受保护 env 路径和 migration_head；此处不包含任何
secret 值。runner 从已核验 API internal IP 派生唯一 `FIXED_UPSTREAM=<IP>:8000`，
manifest 不接受任意 upstream。主控使用同一冻结工具快照执行：

```sh
python -B <冻结工具快照>/runtime.py provision --manifest <冻结manifest.json>
python -B <冻结工具快照>/runtime.py exercise --manifest <冻结manifest.json> \
  --provision <report_root>/provision/provision.json --approval <主控独立approval.json>
python -B <冻结工具快照>/runtime.py cleanup --manifest <冻结manifest.json>
```

初始真实验收矩阵为宿主 TCP GET health 200、匿名401、missing-key readiness503
（只核安全字段）、既有 weekly-progress/history 分页、坏 cursor 和非法时区422。
同时核验 PG/API 仅 internal 且无端口发布、gateway 恰接 internal+普通 bridge 且只发布
loopback、固定 upstream、labels/不可变 IDs/image/tmpfs 与 journal。最终镜像另验
weekly-grammar 过滤、稳定排序、空态及实际 HTTP。应用无外网路径由拓扑和本轮无用户数据
canary 验证，未拨真实公网。HTTP 主体与 Authorization 不进入证据日志。

新增 stdlib 离线回归仍由主控在批准源码根执行：

```sh
python -B -m unittest discover -s tools/keyfree-runtime -p 'test_*.py'
```

覆盖 manifest/scope 派生与旧 `host-loopback` 真实初始化、固定 upstream、loopback 发布、
网络/凭据/资源篡改拒绝、真实 CRLF 与合法分片 socket 转发、超限/不完整超时拒绝、
worker/forward/连接有界回收及 partial-failure 安全清理。gateway 常规退出0是 exercise
通过的必要条件。

### 最终收口（实际通过）

上述资源边界已由主控全部真实验收通过并清理。真实结果：

- 31 项 stdlib unittest 与 6 文件 Ruff 通过；真实 PID1 SIGTERM exit0/280ms（长驻
  17s）、SIGINT exit0/247ms；`max_connections=2` 第三个连接被拒绝、活跃 socket 关闭
  200ms、header 累计上限内总超时 150ms。
- 真实宿主 HTTP：health 200、匿名 401、missing-key ready 503（安全字段
  livekit/llm/stt/tts）；独立 16 次宿主请求 weekly-grammar Top3 `total_errors=21`
  （other 7 / article_usage 5 / verb_tense_past 5，含榜外/同分/unknown 合并/过滤空态）；
  55 条历史 4 页 / 25h；cursor/date/timezone/48h 均 422。
- 拓扑：API/PG 仅 internal 且无实际发布、无默认路由；gateway 双网络仅宿主 loopback
  发布、ip_forward=0；本地 canary 仅证明同本地目标 gateway 容器直连可达、API 不可达及
  拓扑无外网路径，未拨公网（public_network_contacted=false）。
- 生命周期：三 Worker、API 与 gateway 均 exit0；预置过期任务恢复/幂等 synthetic 1
  assessment + 1 grammar + knowledge 0。
- 最终业务镜像为 157 文件新镜像（baseline155 只用于 PID1 诊断，不构成完整业务 HTTP
  通过）：API `sha256:5444d92f1ad20449e858ccc017a87ea63a053a200a93e3ca93f16bd255a8973d`
  （1,542,377,979 bytes / 55 包 / ldd 6）、Agent
  `sha256:f9fb6b9cff828c131dfbe05d50896ada90a043b532458b17f066cc9dbfab61c5`
  （1,930,847,986 bytes / 83 包 / ldd 79）；同一依赖/export、无 dev、各 3 次导入、
  ffmpeg/native 通过。
- 本轮全部容器/网络已按 ID 精确清理。

旧 internal-only 宿主18800不可达、旧 worker137/gateway137、r0 27项1failure/2errors、
r1 IndentationError 与中断 r2 socketpair timeout124/F841/I001 均保留为历史，不冒充
本轮通过。当前 dirty 无 CI/native/真实 Provider 语音设备/原 Compose 整栈验收。

## 2026-11-04 补充轮：Worker 真实停机已验，最终组合待主控

本补充轮证据根为 `R=.review/reports/overnight-followup-20261104`，仅在新 worker lane
实施；资源与独立 runner 边界见[评审手册 §2.3/§3.3](../../agent-review-loop.md)。
旧轮32文件 APPROVED seed 为合法 dirty 输入，旧四树/旧 R 只读；下文旧结果继续作为
before事实，不重写历史137。主控已独立批准Worker四文件集成；backend5真实全部0，
730 pytest/3 warnings/78.43%（59%门禁不变），新模块52通过，见
`R/worker/quality-checks-r1/summary.json`、`REVIEW-r1.md`。claim后stop检查的删除变异
由主控确认被pending/running断言杀死并还原，实施者未读取私有probe或执行测试。

本轮只修改 `backend/workers/analysis_worker.py`、新增 `backend/tests/test_analysis_worker.py`、
手册的新增资源/runner小节及本文；不改分析业务、状态机、STALE_AFTER、重试/租约、模型、
数据库层、Compose、SDK/锁或Provider配置。CLI仍为 `python -m workers.analysis_worker`。

生命周期：SIGTERM/SIGINT仅请求停止，重复信号不重置预算、不反复取消cleanup；
空闲和recover/claim阶段即时结束，未提交的事务回滚。信号若交叉到已确认的claim commit，
保留已持久化running供原stale恢复，不再启动该任务分析，也不立即制造重试。
已在处理的一个任务最多自然收尾2秒，未完成则请求取消并给1秒事务回滚/连接释放；
CLI engine dispose另有1秒预算，常规4秒内给docker stop5秒留余量。以下实际时长来自
主控真实PID1回执，不是仅按预算推断。

`run_forever` 不安装信号、不dispose调用方的session factory；CLI独占信号和默认engine
生命周期。import不安装全局信号或创建task。原生`add_signal_handler`不可用时，仅在允许
`signal.signal`的主线程降级，并在正常/异常路径恢复旧handler；无法安装就失败，不静默
运行。外部取消、未请求的任务取消和普通异常保持失败，只有本worker明确请求的取消可
作为正常停机结果，不把取消记为分析成功/失败重试。

清理拒绝取消的异步任务不能靠无限等待结束：仅CLI在取消或engine关闭超出预算时以1
失败退出，避免`asyncio.run`收尾无限等候。这条兜底不伪称优雅退出/连接已正常释放，
也不证明真实Provider调用可终止。极端拒绝取消只在本地子进程验证exit1；本轮Linux成功
优雅路径退出0，未走强退兜底。

新增回归以Event/barrier控制空闲、recover/claim/commit交错、处理中完成/超时、外部取消；
实际PG验证未提交评估/语法回滚、running保留及明确准备过期后的原stale恢复、后续任务不
再领取、无挂起worker task/借出连接。PG缺少或错`DATABASE_URL`必须失败，不skip。
真实POSIX子进程覆盖SIGTERM/SIGINT、fallback、多信号、handler恢复、engine释放及非零
失败；宿主证据与下面真实Linux PID1矩阵分别记录。

主控以155源码快照 `ea09a8cdb5ab1642ee2ec9c3d15948994266533d70d27fe38103e70c8ff812af`
重建本轮角色镜像：

- API `sha256:d045deddd63d44a4860f0ce86e4243c15c78fe9a8229a40121dfda260027e112`，
  1,542,335,021 bytes。
- Agent `sha256:ca5e8a2ab9e0f8720609a3048363ed07daa6fd3b0d8b0fcafa9e80aceb09601c`，
  1,930,805,028 bytes。

各155文件/source/frozen export/dev absent、API55/Agent83分发版本与旧最终集合相同；
ldd6/79均无missing、ffmpeg和各3次导入退出0，见
`R/worker/final-measure-r1/receipt.json`、`final-integrity-r1/result.json`。
新源体积不与旧cache-only收益混算，也不据导入样本声称冷启动提速。

同轮新资源before旧程序的三Worker137/API0仍保存在
`R/worker/runtime-before-r0/exercise/result.json`；新程序
`runtime-after-r1/exercise/result.json` 为三Worker0/API0，预置过期任务恢复/幂等未变。
真实container TCP HTTP的健康检查200、匿名会话401、缺配置ready503；宿主18800仍false，
唯一internal网络保持，见同目录`http.json`，不是ASGI内调用或宿主入口已验。

主控真实PID1矩阵（`R/worker/runtime-after-r1/`）：

- `sigint/result.json`：真实 `python -B -m workers.analysis_worker` 收SIGINT，exit0，
  283.312ms、数据库状态未变，无Provider或mock override。
- `inflight/result.json` 的natural：自有SQL锁确认实际合成分析处理中，TERM后在grace内
  完成，exit0/469.739ms；第二pending未领取，synthetic评估1/语法1/knowledge0。
- 同回执的timeout：TERM+INT后有界取消，exit0/2459.229ms；running attempt1保留，
  error/retry/finished均空，零评估/语法产物，第二pending未领。
- 仅显式按原300秒STALE_AFTER准备过期后，重启attempt2成功且唯一产物；随后再次INT
  exit0/444.508ms且终态未变。自有fixture已删除，原基线恢复。这不是任意crash或真实
  Provider调用终止已验证，也没有更改业务重试/租约语义。

`R/worker/runtime-after-services-checks-r1/summary.json` 的矩阵及runtime清理均process/
gate0，`runtime-after-r1/cleanup/cleanup.json` 保留删除ID。**仅runtime资源已清理**；
产品测试PG仍保留供最终pytest，不能写全部scope资源已清。最终组合frontend10/backend5
仍待主控，整体状态以[补充轮总报告](../../../.review/reports/overnight-followup-20261104/report.md)
为权威。本节点不执行安装/格式/测试/服务/DB、不改已审Worker/测试；原Compose、真实
Provider/语音/native/设备/远端CI等仍未验证，历史137与宿主false保留。

## 上一轮 overnight-product-runtime-20261103 已验事实（历史）

2026-11-04 状态：C1 已由主控独立 Review APPROVED；C2 配对测量、安装完整性和最终组合
两角色重建、真实服务、补充 HTTP 与清理均已完成。实施节点只编辑源码/文档并阅读无凭据
回执，未运行测试、服务、安装或数据库操作；本次仅收口三份运行时文档，六个代码文件停写。
本批运行时通过不等于整项 RF-07 或完整产品门禁通过。

完整门禁与最终 Review 权威为主控
[本轮总报告](../../../.review/reports/overnight-product-runtime-20261103/report.md)，
本文不替代总报告的最终状态。

本批本地证据根 `R=.review/reports/overnight-product-runtime-20261103`，不纳入 Git。
运行时最终证据为 `R/runtime/final-measure-r1/receipt.json`、`final-integrity-r1/result.json`、
`final-services-r1/` 和 `final-http-recheck-checks-r1b/summary.json`；C1 原始 Review、
schema 回归、首次 r0 失败、首次补充 HTTP helper 失败与全部中间回执仍保留。
历史镜像配方与旧任务证据另见 [Linux 运行时记录](./RF-07-LINUX-RUNTIME.md) 和
[角色契约](./RF-07-RUNTIME-ROLES.md)，不能当作本批验收结果。

## 1. 独立 runner 与执行方

`tools/keyfree-runtime/runtime.py` 是主控受控执行的入口，使用 Python stdlib；
`container_probe.py` 只在已核镜像内执行固定探针，复用真实已锁依赖。
不启动原 Compose、不读取 dotenv、不复用现有资源、不接任意 SQL/应用命令。
`measure.py` 已由主控受控执行。首轮 main before 适配器证据完整保留；收益依据另行配对的
`matrix-before-r1` / `matrix-after-r1`，两者使用同一格式冻结版本的 `measure.py`。
新协议含进程清单监督开销，不与首轮 main before 的计时混算。

新增离线测试独立于原 frontend10/backend5。在本轮批准的源码根、Python 3.12 下：

```sh
python -B -m unittest discover -s tools/keyfree-runtime -p 'test_*.py'
```

环境 `PYTHONDONTWRITEBYTECODE=1`，不携带数据库或 Provider 配置；主控通过本轮受控入口、
共享锁及原 `ev.sh` 执行。当前主控实测 19 项通过，包含冲突拒绝、精确 ID/标签/镜像清理、
进程超时与 SIGTERM、凭据不进入日志、空库/审批/源码边界、真实 symlink/owner/权限拒绝。
离线 SQL 回归在 SQLite 最小 catalog fixture 执行实际四段计数查询，不连接数据库；
PostgreSQL 语法和完整身份查询另由真实 PG 探针证明。新增入口由手册唯一 owner 登记。

## 2. 冻结输入与凭据

主控先审查源码并冻结 manifest、输入 map、探针和工具字节；runner 不将当前指纹自动
当作批准。snapshot 只含本轮已核后端源码，逐文件 SHA256 与 source_inputs 完全一致；
拒绝 dotenv、本地环境、缓存、软链接或额外文件。镜像使用完整 `sha256:` ID，平台显式
为本批 `linux/arm64`，不从标签猜测来源或外推 amd64。

manifest 的必要字段如下，路径均由主控显式填写：

| 字段                                                  | 含义                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `schema` / `run_id`                                   | schema=1；本轮唯一资源标识，不能重用半失败资源             |
| `snapshot` / `source_inputs` / `source_inputs_sha256` | 后端快照、完整逐文件输入 map 与文件自身 hash               |
| `api_image` / `api_image_source_sha256`               | 不可变 API image ID 与主控已核的 source 标签值             |
| `postgres_image` / `platform`                         | PostgreSQL 15.19-alpine 的不可变本机 ID 与相同平台         |
| `probe_sha256`                                        | 已审 `container_probe.py` 的实际 hash                      |
| `report_root`                                         | 全新独立证据目录，拒绝覆盖                                 |
| `pg_env` / `app_env`                                  | 主控生成的受保护 env 文件绝对路径                          |
| `http_port` / `http_transport`                        | 18800..18809；显式选择 `container-http` 或 `host-loopback` |
| `migration_head`                                      | 本批固定 `c06_transcript_events`                           |

API 镜像 source 标签可沿用主控明确记录的聚合算法，容器内仍须逐文件核真实源码；
资源自身 source 标签采用 sorted/indent2 JSON(files)+LF 的 SHA256，不混称两个算法。

凭据只由主控在 0700 目录内生成 0600 文件，实施者不读取。PG 文件只允许
`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`，库与用户均为
`echotalk_overnight_runtime`。密码和 dev token 使用主控新生成的 URL-safe 随机串。
应用文件只允许 `DATABASE_URL`、`AUTH_MODE`、`DEV_AUTH_TOKEN`、`CALL_LEASE_MODE`、
六个 `USE_MOCK_*`、`ANALYSIS_WORKER_POLL_SECONDS`、`CREDENTIAL_ENCRYPTION_KEYS` 和
`ACTIVE_CREDENTIAL_KEY_VERSION`；拒绝 Provider/LiveKit 变量或额外字段。

数据库 URL 只能指向本轮 PG 名字/5432/上述库和用户，不能携带 query/fragment；
AUTH_MODE=dev、CALL_LEASE_MODE=disabled、所有基础 mock flags=false、poll=0.2；
keyring 仅含主控生成的 `runtime-test` 版本。只有合成任务专用 Worker/探针显式覆盖
现有 USE_MOCK_ELSA=true，不替换分析实现，不改变生产认证或默认配置。

env 文件通过 `--env-file` 传 Docker，值不进入命令行/日志。宿主命令不继承 Provider、
DATABASE_URL 或代理环境；不打印 raw stdout/stderr 或配置异常正文。
`read_protected_env` 仍拒绝实际文件/祖先符号链接、错误 owner、非 0600 文件及非 0700
父目录；macOS fixture 只规范化自己的临时根，未放宽这个门禁。

## 3. 分阶段执行与空库迁移门禁

以下占位路径由主控替换为已核绝对路径，并经本轮受控入口/锁/超时执行，实施者不直接跑：

```sh
python -B <冻结工具快照>/runtime.py provision --manifest <冻结manifest.json>
python -B <冻结工具快照>/runtime.py exercise --manifest <冻结manifest.json> \
  --provision <report_root>/provision/provision.json --approval <主控独立approval.json>
python -B <冻结工具快照>/runtime.py cleanup --manifest <冻结manifest.json>
```

provision 先拒绝名字和 loopback 端口冲突，再创建全新 internal 网络和仅 tmpfs 的 PG，
PG 不发布端口。PG 固定名字 `echotalk-overnight-20261103-runtime-pg`；网络名字为
`echotalk-overnight-20261103-runtime-<run_id>`。所有资源标记 scope
`echotalk-overnight-20261103`，另带 run/role/source；先记录创建意向，再记录不可变 ID。
其他任务、应用、QA、生产或旧 lane 的资源不能停止、迁移、复用或清空。

SQL 核 PostgreSQL 15.19、database/user、database OID/`system_identifier`，计数所有非系统
schema 的关系、类型、函数和额外 schema。系统前缀按 `substr(nspname,1,3)='pg_'`
精确判断；`pgx` 普通 schema 及其对象必须被计数。public 的用户对象同样计数。
任一计数非零即拒绝，不 DROP/TRUNCATE/downgrade 清库。provision 只输出空库回执，
不迁移。初始迁移含 DROP CASCADE，必须由主控独立审查并另发批准。

approval 必须绑定 manifest/provision 文件 SHA256、全部 `alembic/` 文件与
`alembic.ini` 的已审 hash、`reviewed_empty_database=true` 和审查证据索引。
exercise 再核原资源和 SQL identity/空库，逐文件验证实际镜像源码、检查 frozen export，
才允许真实 Alembic base→head；迁移后核实际 revision。

主控真实 PG 回归已在迁移前的同一新库事务内执行：空库四计数0；创建普通 pgx schema 后
extra_schemas=1；加入表/enum/function 后 relations=1、types=4、routines=1、extra=1，
两次非空均被门禁拒绝；rollback 后及再次查询均恢复原身份与四计数0，无 fixture 残留。
初始 C1 与 cache-only 配对使用 153 个源码文件；最终组合使用 154 个文件，分别核验实际
镜像内文件 SHA256 与对应输入 map。真实迁移至 c06 和 frozen export 均通过。

## 4. 真实 HTTP 与 internal 网络边界

API 使用真实 `uvicorn main:app --host 0.0.0.0 --port 8000` 长期进程，保留原 lifespan、
路由和认证。主控已接受 `container-http`：通过 `docker exec` 在 API 容器内启动 stdlib
HTTP 客户端，经 `127.0.0.1:8000` TCP 请求真实 uvicorn；没有 ASGI 内调用或依赖替换。
health=200、匿名 sessions=401、带合成 token 的 ready=503；503 明确来自
livekit/llm/stt/tts 缺配置，数据库未报错。health 成功不表示 Provider 就绪。

Docker Desktop 29.9.2 arm64 上，唯一 internal 网络虽可声明 HostConfig 的 loopback
发布，宿主连接仍被拒绝。本批 `host_loopback_health_verified=false`，不声称
`127.0.0.1:18800` 用户入口已通过。API 仍只请求 loopback 发布，PG 不发布端口；
未增加可出公网的第二网络。`host-loopback` 模式若不通会失败，不自动切换绕过。
宿主转发/网络替代需要独立裁定，不借本次验收放宽认证或网络边界。

## 5. 真实 Worker、预置过期任务与幂等

真实 `python -m workers.analysis_worker` 首先在 USE_MOCK_ELSA=false 下消费合成任务，
持久化 analysis_unsupported、failed、attempt1，评估/语法/KnowledgeState 均为空。
主控停止该进程后，显式准备一个 started_at 早于 STALE_AFTER 的 running 合成任务。
新 CLI 使用现有合成分析开关消费，恢复为 attempt2/succeeded，产生一份 demo_mock
synthetic assessment、一条 synthetic grammar、零 KnowledgeState。

再次新启 CLI 后，成功任务不被重新领取；另两次调用真实 analyze_session 返回同一评估
ID，最终产物 ID、计数、attempt 不变。这分别覆盖重启不重复消费与分析实现幂等。
它只证明明确预置过期任务的恢复，不证明任意实际崩溃时点、真实 Provider 或语音链路。

真实退出以 result.json 为准：worker-missing、worker-demo、worker-restarted 都是
**137**，API 是 **0**，四个进程均停止。三个 Worker 在 docker stop 的 5 秒窗口后被强杀；
C1 没有证明 Worker 优雅 SIGTERM 退出，也不把137改写成0或143。
这是既有运行遗留：真实运维停止可能依赖强杀，后续需单独审查信号与终止行为；
本轮不改业务入口、重试、租约或弱化断言来隐藏它。

## 6. 超时、失败现场和清理

命令继承外层受控进程组，避免另建 session 逃逸外层超时；TERM/INT/异常/命令超时均进入
有限子树回收，记录真实退出、信号、观测进程组、残留 PID 与 command_tree_cleared。
共享进程组中主控/runner 仍存活，不能把子树已清理说成整个组已消失；最终由主控整组核验。

Docker daemon 不属于 CLI 子树。探针/服务依靠创建意向与资源 ID 回执保持归属；失败时核
ID+labels+image 后停止本阶段自建服务，记录真实退出，主控接管保留的 PG/网络。
SIGKILL 无法被 Python 捕获，不声称容器会随父 CLI 自动消失。
cleanup 只消费本轮已知目录中的显式 journal，核不可变 ID、标签与镜像，不按 tag/global
labels 扫描删除，不 prune；网络仍有其他成员就拒绝。初始 C1 与最终组合的主控清理均已
完成，分别见 `R/runtime/c1-r1/cleanup/cleanup.json` 和
`R/runtime/final-services-r1/cleanup/cleanup.json`；最终回执列出四个应用容器、PG 和网络
的六个已删除不可变 ID，不扩大为其他项目资源已清理。
主控 `R/resource-cleanup-final.json` 进一步确认本轮 scope 为0容器/0网络，产品PG亦已清理。

## 7. C2 实测与收益边界

两轮 before、配对镜像 ID、固定基础 digest 与完整计时见
[Linux 运行时记录](./RF-07-LINUX-RUNTIME.md)。
本次 Dockerfile 只在既有 frozen uv sync 的同一 RUN 末尾加 `uv cache clean`；
不在后层删除已提交缓存，不改角色/锁/SDK/Python/uv/gcc/libpq/ffmpeg，也不拆 stage。

同平台 arm64、同基础 digest/锁、每份 153 文件且仅 Dockerfile 不同的配对结果：

| 角色  | before bytes  | after bytes   | 实减 bytes | 实减比例   |
| ----- | ------------- | ------------- | ---------- | ---------- |
| API   | 1,545,036,632 | 1,542,251,419 | 2,785,213  | 0.1802684% |
| Agent | 1,936,003,477 | 1,930,721,426 | 5,282,051  | 0.2728327% |

缓存目录分别从 120,456 / 398,460 KiB 降至各 4 KiB，不等于镜像实减；未采集 inode/硬链接
证据，不断言差异原因。两角色 `/usr` 仍各 971,248 KiB，系统依赖保留。
配对包版本集合完全相同（API 55 / Agent 83）、无 dev 工具、源码与 frozen export 一致，
API 6 / Agent 79 项 ldd 无 missing，ffmpeg 与各三次导入均通过。不据样本宣称冷启动提速。
证据为 `R/runtime/paired-comparison-r1.json`、`pair-integrity-r1/result.json` 及其受控回执。

## 8. 最终组合镜像、真实消费者与首次失败

最终组合从包含七天接口等已审后端内容的独立 154 文件快照重建两角色，未复用 cache-only 包：

- API `sha256:eecbd997b19725256b7391eb1d4c068025f08bef41df62d4aee4eec9e8111cde`，
  1,542,284,611 bytes。
- Agent `sha256:ba556d437c23d178e2eeea887137368ccadd15d87ca85a5c0bb6e1766ebf2e9e`，
  1,930,754,618 bytes。

`final-integrity-r1/result.json` 确认各 154 文件、frozen export、无 dev 工具与 55/83 包；
逐角色读取包版本 map 与 cache-only after 对照完全一致。该回执仅含一组最终镜像且
`pair_packages_equal=false`，未将该字段当作跨快照相等的证明。最终动态库/ffmpeg/三次导入
也通过；Agent 首样本 34,594.359 ms 原样保留，不用于 cache-only 配对的性能结论。

最终全新 internal PG 服务复验保持上述边界：真实 TCP HTTP 200/401/503、预置过期任务
attempt2 合成成功、重启及两次真实分析幂等、Worker137/API0、宿主18800 false，随后清理。
补充仅 GET 的七天接口实际消费者验证七桶/2 completed、limit1 的两页各1条、换窗 cursor422、
23小时 DST、非法时区422、匿名401，补充 API 退出0。见
`R/runtime/final-services-r1/weekly-http-r1b/{result,stop}.json`。

首轮 `final-services-checks-r1` 并非整批全绿：服务 exercise 通过、HTTP 产品断言通过，
主控 helper 错将 stop 返回 dict 当 int 导致 weekly-http 退出1，批次 incomplete/failed。
主控只修 helper 的 exit/running 读取后在新目录 r1b 重跑，通过补充 HTTP 与最终清理。
原首败、`http-helper-correction-r1b.md` 与原 stop0 回执均保留，不算产品失败或 mutation kill；
新 `final-http-recheck-checks-r1b/summary.json` 的 complete/all_passed 均为 true。

## 9. 整体门禁与仍未验证项目

主控 `R/final-functional-checks-r1/summary.json` 的16项（排除根 format 与 E2E）全通过：
1,098 Vitest、21 build-script、69 Fake API、8 类型 runner、678 pytest/78.67% coverage、
19 runtime-unit，及 lint/typecheck/build/schema/metadata/backend/runtime 格式与 lint。
这是主控执行证据，不是实施者独立自测，也不能当作完整 frontend10/backend5 全绿。

主控 `R/final-e2e-checks-r1` 已结束：双浏览器174项、exit0，其中173 clean+1 flaky；新增
weekly8项双浏览器通过。settings goto30秒超时多次出现retrypass，根因未定，不写174全clean。
根 format 此前因 A 的两份文档失败，待 owner 收口后主控统一原生格式化复核；本次三份文档
未由实施者运行 formatter。完整15项/最终 Review 以主控总报告与其选定回执为权威。
本轮 native 构建、远端 CI、真实 IdP/Provider/
LiveKit/语音、原 Compose、设备及部署均未验证，RF-07 整项继续保留边界。

## RESTORE-20261107 收口

本段替换 delivery r0 候选追加，不改写上方从
`42c61bb08f5e234989198ef46ed7534a80c70796` 恢复的原文。上方历史 CI 与已验记录只属于
当时提交。本候选没有 push，也没有本轮远端 CI。这里的 Node 回归不能代替 native
App、Xcode、Rust 构建或设备验收。真实 Provider、IdP、LiveKit、语音、生产部署和原
Compose 整栈未验。根格式与保全回执见主控交付报告，这里不预告根格式通过。

本轮 runtime 已按手册 §19.2 的私有内存命名创建、审批、验收并清理。产品 runtime 工具
字节未改，不构成通用新 scope。PG 不发布端口；gateway 只发布 `127.0.0.1:18800`，
`ip_forward=0`。宿主 16 次 GET 已核验 health 200、匿名 401、缺 Key 503。API/PG 仅
internal，同机 canary 为 gateway 正向、API 负向，没有公网调用。五个进程 exit 0。
runtime 8 个自有 ID 已删除。上方 internal-only 时宿主不可达的历史失败不改写。
