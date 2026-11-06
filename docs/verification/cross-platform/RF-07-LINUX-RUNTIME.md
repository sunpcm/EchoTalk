# RF-07 Linux/Docker 与专用测试库验收

## 2026-11-04 grammar-http host-gateway（已实际收口，跨 11-04 夜间至 11-05）

本轮仅新增可选 `host-gateway` 运行拓扑，保留旧 `container-http` 与原 internal-only
宿主18800不可达历史。API/PG 仍只在本轮 internal 网络；短生命周期 gateway 复用已批准
API 镜像的 stdlib，固定转发到已核验 API internal IP:8000，另接独占普通 bridge，
只有 gateway 发布 `127.0.0.1:18800..18809`。不新增依赖、不改原 Compose、不启用全局
IP forwarding 或系统代理；gateway 不带 DB/Provider/IdP/LiveKit 凭据，不支持 CONNECT、
任意 URL 或客户端上游。

scope、资源派生、初始 baseline 镜像 ID、manifest 和主控阶段命令见
[隔离服务验收](./RF-07-ISOLATED-SERVICES.md)。baseline 仅用于 PID1 诊断；health/GET、
拓扑与 weekly-grammar 业务均由最终 157 文件新镜像验收。stdlib 回归覆盖双网络/端口/
固定上游/资源拒绝、合法分片、线程/信号生命周期与 partial-failure journal/cleanup。
旧 `host-loopback` 枚举和默认资源身份继续兼容。修复前真实 PID1 exit137/资源已清理
保留为负向事实。

### 最终收口（实际通过）

本新增 `host-gateway` 拓扑已由主控真实验收通过并清理。最终业务镜像为
157 文件新镜像，不是 baseline155；baseline155 只用于 PID1 诊断，不构成完整业务 HTTP
通过声明：

- API `sha256:5444d92f1ad20449e858ccc017a87ea63a053a200a93e3ca93f16bd255a8973d`，
  1,542,377,979 bytes / 55 包 / ldd 6。
- Agent `sha256:f9fb6b9cff828c131dfbe05d50896ada90a043b532458b17f066cc9dbfab61c5`，
  1,930,847,986 bytes / 83 包 / ldd 79。

两角色同一依赖/export、无 dev、各 3 次导入、ffmpeg/native 通过，不断言新性能收益。
真实 PID1：SIGTERM exit0/280ms（长驻 17s）、SIGINT exit0/247ms；`max_connections=2`
第三个连接被拒绝、活跃 socket 关闭 200ms、header 总超时 150ms。31 项 stdlib unittest
与 6 文件 Ruff 通过。拓扑：API/PG 仅 internal 且无实际发布、无默认路由；gateway 双
网络仅宿主 loopback 发布、ip_forward=0；本地 canary 仅证明同本地目标 gateway 容器直连
可达、API 不可达及拓扑无外网路径，未拨公网。三 Worker、API 与 gateway 均 exit0。修复前
真实 PID1 exit137、旧 worker137/gateway137、宿主18800 不可达、r0 27 项 1failure/2errors、
r1 IndentationError 与中断 r2 失败均保留为历史，不冒充本轮 exit0。本轮全部容器/网络已
按 ID 精确清理；当前 dirty 无 CI/native/真实 Provider 语音设备/原 Compose 整栈验收。

## 2026-11-04 夜间任务：C1、配对优化与最终组合实测

本批基线 `0e09f5e7f3c16b5bb6562632880003e59369e372`，C lane
`codex/overnight-runtime-20261103`。主控已独立批准真实隔离服务 C1；工具、输入门禁、
分阶段命令和证明边界见 [隔离服务验收](./RF-07-ISOLATED-SERVICES.md)。
实施者未运行测试/服务或读取凭据，本节读取的是主控无凭据实际回执。
完整门禁与最终 Review 以主控
[本轮总报告](../../../.review/reports/overnight-product-runtime-20261103/report.md) 为权威。

- 独立 offline runner 19 项通过；真实新 PG 空库门禁、普通 pgx schema/objects 非空拒绝、
  事务 rollback 后身份/四类计数复原、base→c06、初始153/最终154文件镜像源码核验和
  frozen export 通过。
- 真实 uvicorn 的容器 loopback TCP/HTTP：health200、匿名401、缺 Key ready503，错误字段为
  livekit/llm/stt/tts；没有用 ASGI 内调用替代 HTTP，也没有绕开认证。
- 主控明确准备的过期 running 任务经新 Worker CLI 恢复为 attempt2/succeeded；一份
  synthetic assessment、一条 synthetic grammar、零 KnowledgeState；再次 CLI 重启与
  两次真实 analyze_session 后 ID/计数/attempt 均未变化。只证明预置过期任务恢复与幂等。
- 三个 Worker 的实际退出均为137：docker stop 5秒后被强杀；API退出0，四进程均停止。
  **未证明 Worker 优雅 SIGTERM 退出**，作为既有运行遗留保留；本轮不改业务终止/重试/租约。
- Docker Desktop29.9.2 arm64 的唯一 internal 网络无法从宿主访问18800，
  `host_loopback_health_verified=false` 单列。保留 internal，未加可出公网 bridge，
  不声称宿主用户入口或原 Compose 整栈已验。初始 C1 与最终新 PG/四应用容器/网络的
  主控清理均已完成，最终六个删除 ID 见 `runtime/final-services-r1/cleanup/cleanup.json`。

本批证据根 `R=.review/reports/overnight-product-runtime-20261103`，C1权威索引：
`runtime/c1-review-r1.md`、`runtime/c1-r1/exercise/result.json`、`http.json`、
`runtime/c1-r1/schema-regression/result.json`。失败 r0 和实际137退出不覆盖。

### 首轮 main before：保留原证据，不作新配对的收益分母

主控已用仅 tracked/非 dotenv 的冻结后端快照真实构建与测量。平台 linux/arm64，
Python基础 `python@sha256:b18b261e1b4974b4f321451ad5251ded85abb22c2b8b262da527dda1d031ab30`，
uv0.9.18基础 `ghcr.io/astral-sh/uv@sha256:5713fa8217f92b80223bc83aac7db36ec80a84437dbc0d04bbc659cae030d8c9`。

| 角色  | before bytes  | /root/.cache KiB | /opt/venv KiB | /usr KiB |
| ----- | ------------- | ---------------- | ------------- | -------- |
| API   | 1,545,036,601 | 120,456          | 120,132       | 971,248  |
| Agent | 1,936,003,446 | 398,460          | 397,800       | 971,248  |

API ID `sha256:6915f019dabdac87bb4b395aefbb0e90b49743096929225c4f34bd436f49a6cf`；
Agent ID `sha256:1cb6c7c1177cf5747891b5c9f5a60cdcea131f2a3d719341e3077353ca8f6c6f`。
cache几乎全来自uv（API120,452KiB、Agent398,456KiB）；这是容器目录占用，不能直接等同于
可减少的镜像bytes。主控核API6个/Agent79个native文件ldd均无missing，ffmpeg通过。

每角色3个新容器，before各导入退出0：API 2989.926/2637.698/2623.955ms，
Agent 4265.958/3346.492/3737.990ms。时间从宿主 docker start --attach 到成功退出，
不含create，包含CLI/容器启动/import；before构建层全命中缓存、宿主页缓存未清理，
首样本与后两样本分开保留。不叫真实语音冷启动，不从3个样本推定稳定性能收益。
证据 `R/runtime/before-measure-main-r0/receipt.json`、`before-summary-r0.json`；
该首轮测量使用主控受控适配；后续另用同版 measure.py 配对重测 before/after，
两轮 before 原始证据均保留。首轮适配样本不与含进程清单监督开销的新配对样本混算。

### C2 同版 measure.py 的独立配对协议与结果

Dockerfile 仅在原 frozen uv sync 的同一 RUN 末尾增加 `uv cache clean`。
Python3.12/uv0.9.18、SDK/锁、角色、gcc/libpq-dev/ffmpeg、基础镜像引用与阶段结构保持。
主控使用格式冻结后的同一 measure.py、上述同一基础 digest、linux/arm64 与锁，对各153个
文件的快照真实重建两角色；输入 map 对照仅 Dockerfile 不同。两份回执都为 measured，
每角色10个层，完整层/history/目录保留在 `matrix-before-r1/receipt.json` 与
`matrix-after-r1/receipt.json`，不是拿首轮 main before 旧包重标。

| 角色  | 配对 before bytes | 配对 after bytes | 实减 bytes | 实减比例   |
| ----- | ----------------- | ---------------- | ---------- | ---------- |
| API   | 1,545,036,632     | 1,542,251,419    | 2,785,213  | 0.1802684% |
| Agent | 1,936,003,477     | 1,930,721,426    | 5,282,051  | 0.2728327% |

四个配对不可变 ID：

- API before `sha256:05090909a040ab966762514d571274f12af3f98cfe118857cf42e9355317e3f2`；
  after `sha256:a01435b31f173ff05c9e95e1fd4812246e2c7423adc32c20b7abb04bcebe11c9`。
- Agent before `sha256:622d6bc3cd500ce6576da3683a0b7714245e4f2dcc8131c02a7e95843bcb30c3`；
  after `sha256:5b75c62cbd736635b322c4ac20e7d5041a73881a2d28e61b38e2eed34dc68e1c`。

`/root/.cache` 的API120,456 / Agent398,460 KiB都降为4 KiB；镜像实减仅上表bytes，
不能把目录降幅当镜像收益。未采集inode/硬链接证据，不断言差异原因。两角色 `/usr`
仍各971,248 KiB，`/opt/venv` 仍为API120,132 / Agent397,800 KiB，系统依赖保留。
包版本集合逐角色完全相同（55/83），无dev工具、各153文件与frozen export一致；
ldd6/79均无missing、ffmpeg通过。证据 `paired-comparison-r1.json`、
`pair-integrity-r1/result.json`、`pair-integrity-checks-r1/summary.json`。

新配对计时从受控 docker start --attach 到核验退出，不含create，含CLI/容器/import及
进程清单监督开销。构建缓存复用，宿主页缓存未驱逐，每个样本是新容器，首样本单列。

| 角色  | before三次导入 ms              | after三次导入 ms               |
| ----- | ------------------------------ | ------------------------------ |
| API   | 2712.751 / 2712.134 / 2774.794 | 2853.315 / 2848.851 / 2719.269 |
| Agent | 3567.362 / 3538.383 / 3505.658 | 3462.165 / 3545.867 / 3407.580 |

每次导入退出0；不从三次样本宣称冷启动提速或真实语音启动收益。

### 最终组合输入：154文件，两角色重新构建

最终组合有新增后端内容，从独立冻结快照重新build，不能用于cache-only收益的分母/分子。
`final-measure-r1/receipt.json` source SHA256 为
`99eb1561457e9d683b33997cb13f90c1005aa75a462a803c004c263bf7d30698`，最终镜像为：

- API `sha256:eecbd997b19725256b7391eb1d4c068025f08bef41df62d4aee4eec9e8111cde`，
  1,542,284,611 bytes。
- Agent `sha256:ba556d437c23d178e2eeea887137368ccadd15d87ca85a5c0bb6e1766ebf2e9e`，
  1,930,754,618 bytes。

`final-integrity-r1/result.json` 实测各154文件SHA、frozen export、无dev与55/83包，
逐角色包版本map与cache-only after完全一致；ldd6/79、ffmpeg与各三次导入通过。
最终API导入2690.620/2687.643/2701.416ms；Agent34594.359/4350.064/3765.583ms，
包括Agent首样本34.6秒均保留，不因较慢而删样本或替代配对计时。

最终全新internal PG服务与补充GET消费者已实测并清理：HTTP200/401/503，预置过期任务
attempt2合成成功，重启/真实分析幂等，三个Worker137/API0，宿主18800仍false。
新GET七天概览返回七桶/2completed，limit1两页各1条，换窗cursor422、23小时DST、非法
时区422、匿名401，补充API退出0。索引 `final-services-r1/exercise/`、
`final-services-r1/weekly-http-r1b/`、`final-http-recheck-checks-r1b/summary.json`。

首次 `final-services-checks-r1` 保留failed/incomplete：HTTP业务断言通过，但主控helper
将stop返回dict当int导致退出1；产品未因此失败。见 `http-helper-correction-r1b.md`。
主控修helper后在新r1b目录复验HTTP/cleanup全绿，未覆盖首败，也不把它当mutation kill。

整体门禁以主控 `R/report.md` 及其选定回执为权威；本次文档停写时
`R/final-functional-checks-r1` 排除根format/E2E的16项通过（1098 Vitest、21构建脚本、
69 Fake API、8类型runner、678 pytest/78.67%、19 runtime-unit）。双浏览器最终174项/exit0，
173clean+1flaky，新增weekly8项双浏览器通过；settings goto30秒多次retrypass，根因未定，
不写174全clean。根format前次因A两份文档失败，待owner收口后统一原生格式和复核，
本节点未运行formatter。`R/resource-cleanup-final.json` 确认scope0容器/0网络，产品PG亦清理。
不写完整15项全绿。本轮native/远端CI/真实IdP/Provider/LiveKit/语音/原Compose/设备/部署
仍未验证，Worker优雅终止与宿主18800限制保留，RF-07整体未据此关闭。

## 2026-11-03 keyfree-delivery 历史记录

以下保持上轮证据边界，其中“本次/当前”均指该历史任务；本批最新状态以上节为准。

本次验证记录（2026-11-03）：组合 Web 镜像真实构建通过，`artifact-receipt.json` 确认 Nginx 根 index、
production OIDC manifest、诊断 UI 编译产物及无 dev token，镜像 77,366,316 bytes；未启动 App 容器。
主控 `checks/combined-r1` 完整 frontend10/backend5 已通过；记录时最终 A 尚未正式交付，
正式交付及 PR #119 最终 head CI 以主控报告为准，API/Agent/迁移/清理及未测边界沿用。

> 2026-11-03 最终状态补记：主控 Web r1 真实构建 OIDC exit0、dev exit1、oidc-token exit1，
> 两个负向均命中 production guard。后端角色与专用库沿用既有主控验收；本节点未运行检查。
> 基线：`codex/linux-runtime-acceptance-20261103`，
> `b3493a3a40c5c6743c9c3df609790368b2b76435`，r0 开工工作树干净；r1 保留已知 r0 文档改动。

依据：`TODO.md` RF-05/06/07/08、重构计划对应章节、
[运行角色契约](./RF-07-RUNTIME-ROLES.md)、
[Web 配方边界](./RF-07-WEB-DOCKER-RECIPE.md) 与
[评审手册 §3](../../agent-review-loop.md)。r0 新增验收记录与授权补充；r1 仅增加 Web Docker
构建入口/产物路径修复及现有构建隔离回归。后端配方、锁文件、历史迁移与认证逻辑不变；
RF-05/06/07/08 不据此勾选。

## 验收范围与结果

| 项目               | 预期证据                                                                                                      | 当前状态                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 宿主与架构         | 记录实际 Docker server/OS/arch，不外推其他架构                                                                | 主控已实测 Docker 29.9.2 server、Linux arm64；不宣称 amd64                                                       |
| API/Agent 冻结镜像 | 同一基线与锁、不同角色，镜像 ID/digest、实际依赖版本/角色排除项、模块导入、无 dev Python 工具                 | 主控 r1 确认通过，本节点未执行                                                                                   |
| lock/export        | uv 0.9.18 只读 frozen export 与 tracked requirements 完整字节比较                                             | 主控 r1 确认通过，本节点未执行                                                                                   |
| Web                | 公开合成 OIDC 构建成功；生产 dev 构建拒绝；缺 OIDC 运行时认证拒绝；Node 22/Corepack/pnpm 10.26.0 真正构建证据 | 主控真实 r1：OIDC exit0，dev/oidc-token exit1，负向均命中目标 guard；原坏 dev exit0 保留；缺 OIDC 运行时状态单列 |
| 全新空库           | SQL 空库硬前置，再 base 到唯一 head；再次 head 不改变 schema/数据                                             | 主控 r1 确认通过，本节点未执行                                                                                   |
| 合成旧库升级       | base 到 c03、合成数据、c03 到 c06，七列 UTC/null、三项索引与事件约束、重复 head、显式 seed 幂等               | 主控 r1 确认通过，本节点未执行                                                                                   |
| 无 Key 路径        | API 导入/生命周期/健康与未认证拒绝；Worker 单次非 Provider 失败持久化；Agent 空 Key 受控拒绝                  | 主控 r1 确认通过，不代表真实语音                                                                                 |
| 镜像体积           | Linux arm64 当前镜像精确 bytes                                                                                | `c/build-r1/receipt.json`：API 1,545,036,678 bytes，Agent 1,936,003,523 bytes；本次已亲读回执核对                |
| 导入计时/收益对比  | 有限次数新容器计时，注明缓存状态/样本及同环境 before                                                          | 尚未完成独立计时与 before 对比；角色模块导入通过不等于冷启动/导入耗时已全验，不计算优化比例或收益                |
| 必跑测试树         | Vitest、Playwright、backend pytest 及 frontend10/backend5                                                     | 本节点未执行；最终组合由主控在 A lane 代跑                                                                       |

## C 资源与迁移硬前置

- 仅新建 `echotalk-keyfree-20261103-pg`，`postgres:15.19-alpine`，
  label `codex.scope=echotalk-keyfree-20261103`；仅发布 `127.0.0.1:55443`，
  运行容器只加入本任务全新 `--internal` 网络，无真实服务出站。
- 仅 `echotalk_keyfree_empty` 与 `echotalk_keyfree_upgrade`，凭据由主控生成于受保护 runtime，
  实施方不读取。主控保存新建回执、容器/网络不可变 ID、两库 OID 与镜像 ID。
- 初始迁移包含 `DROP TABLE/TYPE ... CASCADE`。脚本在任意从 base 开始的操作前，
  用 SQL 核对当前库/用户/服务版本/OID，检查所有非系统 schema 的关系与自定义类型，
  必须无用户对象及迁移版本表；非空即拒绝，绝不先删除再继续。
- 旧版本固定 `c03_call_leases`，不是对任意历史生产副本的兼容保证。纯合成旧记录包含
  七列时间的微秒、非 UTC 连接时区、已结束/未结束会话及 NULL，迁移后比较 UTC epoch、
  非时间内容和行数。c05 验索引列顺序、DESC/非唯一；c06 验历史 NULL、同会话事件去重、
  不同会话可复用 event、多个 NULL 可共存。再 head 不改变数据/schema。
- 只对本任务资源做身份与 label 核验后的停止/删除；失败日志保留。禁止全局 prune，
  不动已有容器、镜像、卷，不降级既有库。失败演练库保留，后续重建由主控另行审核。

### 2026-11-03 验收后资源清理

C 四阶段验收与 Web 三构建结束后，主控按不可变 ID、label、内部网络与 tmpfs 归属核验，
已清理本批专用 PG `078e16b160a7` 与网络 `e4ac7a75ec7b`。依据为本批 C 报告
`c/cleanup-receipt.json`（仅本任务资源、tmpfs-only、removed 均为 true）及
`ev/ev-c-cleanup-owned-r0.txt`（exit0）。原 `echotalk-cp00-pg` 未动，C 镜像、快照和证据保留。
这是已完成的主控清理记录，不新增实施节点服务权限；上述迁移硬前置仍适用于后续重新验收。

## r0 静态发现与运行前裁定

1. 根 `.dockerignore` 显式放行两份 Vite 公开 dotenv，`scripts/build.mjs` 调用 `loadEnv`。
   本轮禁止读取任何 `.env`，因此不能直接把原根 context 交给构建并称符合本轮边界。
   主控已在 r0 交付前批准“只由 tracked 非 dotenv 输入制作的报告内最小任务快照 +
   合成公开 OIDC args”，不改仓内配方。它是隔离输入验收，原 dotenv 输入路径不在本轮证明；
   本节点仍不读取 dotenv，不构建镜像。
2. 后端 Dockerfile 当前在最终镜像安装 `gcc`、`libpq-dev`、`ffmpeg` 并保留 uv。
   “无 dev Python 包”不能扩大解释为“无构建工具”或“镜像已最小化”。先测实际内容与 bytes，
   若长期需要精简，再以实际证据申请独立多阶段构建改造。
3. 基础镜像使用可变 tag。主控需记录本轮解析 digest 与生成镜像不可变 ID，后续探针
   `--pull=never` 使用该 ID；本轮不改基础镜像版本/配方，不冒称长期 bit-for-bit 可复现。
4. 运行阶段内部网络隔离不等于构建阶段离线。apt/uv/Corepack/pnpm/registry 下载须由
   主控明确受控构建窗口；不得携带宿主 Provider、代理凭据或私有 registry 配置。
5. Web `config-validator.mjs` 对 production 禁止 dev/token，缺 OIDC 参数不必导致构建失败；
   `auth.ts` 在缺配置时返回 `misconfigured`、无 principal。负向须按构建与运行时各自契约验证，
   不借验收改变产品口径。后端 API/Agent 角色镜像由主控负责，tags 固定
   `echotalk-keyfree-20261103-api:b3493a3`、`echotalk-keyfree-20261103-agent:b3493a3`。
   DockerHub 原直连构建在解析 `python:3.12-slim` 时 DeadlineExceeded，未产 image；
   主控后续已从 Docker 官方 ECR 公开分发拉取 arm64 镜像，并仅创建原先不存在的本地
   `python:3.12-slim` 别名，Dockerfile 不变。源回执为 C 报告
   `official-python-distribution.json`；补充角色构建在 `build-r1/`。两条路径分别报告，
   ECR 拉取成功不等于角色构建/运行已通过，也未取得 DockerHub 内容对比。
   验收从 `build-r1/inputs.json` 读取 source，不假设聚合算法；精确核 label
   `codex.scope`、`codex.role`、`codex.source-sha256`。

## r1 Web production 构建入口修复（主控真实镜像复验通过）

主控真实基线 `c/web-baseline/results.json` 记录 OIDC 与 dev 两种构建均 exit0，
`build-dev.log` 记录 dev 镜像成功导出。根因是 Dockerfile 原 `RUN pnpm build` 对应
package.json 中直接 tsc/vite 命令，绕过现有 `scripts/build.mjs` 的平台/模式校验。
这与缺 OIDC 时运行态 `misconfigured` 的既有 fail-closed 是两个问题。

本轮最小修复为 Docker 显式执行
`node scripts/build.mjs --platform web --mode production`，Nginx 精确复制
`/app/apps/vite-app/dist/web/production`，让根 `index.html` 与成功 `build-manifest.json`
对应同一 Web production 产物。Node22/Corepack/pnpm/frozen/context 边界保持。

现有 `scripts/build-isolation-test.mjs` 增补三项回归：从 Dockerfile 读取实际 RUN/COPY，
在无 dotenv、仅合成环境的临时工程中运行未改写的真实 build.mjs/validator 子进程，
仅替代下游 tsc/vite；OIDC 正向核生产参数与 Nginx 根产物，两个负向分别核 dev 和
OIDC+dev token 被目标 guard 拒绝、旧成功 manifest 失效、未执行 tsc/vite、token 不外泄。
本节点未运行这些用例。主控 `c/web-r1/results.json` 已记录真实镜像构建：OIDC exit0、
dev exit1、oidc-token exit1；`build-dev.log`、`build-oidc-token.log` 两个负向均明确命中
`production 环境下的 Web 构建禁止使用 dev 认证或配置 VITE_DEV_AUTH_TOKEN`，不是网络/工具失败。
原 `c/web-baseline/results.json` 与坏 dev exit0 证据保留，不覆盖。
test:build 与相关完整门禁继续以主控回执为准；这条镜像复验不代替测试树，不扩展为缺 OIDC
运行态、Compose 整栈或冷启动 before/收益已验证，原 dotenv 输入路径也不在本轮证明。

## 本地交付与证据边界

本批报告根：`/Users/sunpcm/code/EchoTalk/.review/reports/keyfree-delivery-20261103/c/`。
实施计划与停写报告：`implementer/plan-r0.md`、`implementer/report-r0.md`、`implementer/report-r1.md`；
固定候选入口：`tools/acceptance.py`。它们仅本地保存，不入 Git。
运行、语法/质量检查、所有测试/镜像/迁移/服务操作均由主控经既有固定
`ev.sh`/runtime 与原共享锁边界代跑；本节点不执行，不读含密码的 runtime。原已通过的后端
输入与 acceptance.py 冻结，本轮不修改，也不因 Web 返工重置已有失败或通过证据。
没有本轮实际执行证据的项目继续显示待验，真实 IdP/Provider/LiveKit/语音/设备/部署均未验证。
