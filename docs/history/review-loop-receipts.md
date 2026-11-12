# EchoTalk 评审手册单轮回执归档

> 原文自 `docs/agent-review-loop.md` 搬运（2026-11-10），章节编号与内容不变，仅相对链接上移一层。现行规则见 [Agent 评审手册](../agent-review-loop.md)。

### 2026-11-12 A4b 最终合入与 A4c WeeklyProgress 实施自测

A4b（PR #151）最终 source `7659808f34a9f0a26254eb21f13efafe9c6c8ace` 的
CI `43158276662` 与 PR Guard `43158276685` 六项成功，原始日志为 Vitest 1206/49、
Linux E2E 234（0 skip/retry）、pytest 809/80.19%、Fake API 108、类型生成器 8、构建脚本 21。
squash 后 `main@25988673a5cb5342d6ddde5c3c92b9e3b002399b` 与 source 整树一致。该回执替代
此前基于中间 head `496326c` 的待合并说法，不扩展到真实服务或设备。

A4c 实现节点在 `/private/tmp/echotalk-autonomous-20261112/A4c`、分支
`claude/A4c-weekly-progress`、基线 `2598867` 上只改 WeeklyProgress、新 data hook 和授权文档。
官方 runner 证据 `ev-wp-vitest.txt` 保留首轮 29/31 RED，`ev-wp-vitest-r1.txt` 与
`ev-wp-vitest-final.txt` 为修复后原 WP 31/31 GREEN；`ev-data-contract.txt` 为原 data 契约
45/45。Vite typecheck、目标 ESLint、Prettier 与 `git diff --check` 通过。

以上只是实施节点自测：未运行候选 E2E，未启动服务、数据库或真实外部依赖，未读取主控私有
probes，未做独立变异和完整三树评审。交付停在 Review，未 commit/push/merge；A4c TODO 保持
未勾选，等待主控独立评审。

### §2.2 2026-11-04 夜间运行时新增 runner 与实际验收索引

本轮证据根 R 为主 checkout 的 `.review/reports/overnight-product-runtime-20261103/`。
新增 runtime-format/runtime-lint/runtime-unit 独立于 frontend10/backend5；真实服务与镜像
另列，不将这些新增检查计入旧 15 项。全部由主控经本轮已审 `R/tools` 控制器和只读
`/Users/sunpcm/code/EchoTalk/.review/reports/tools/ev.sh` 执行，实施者不运行。

C 三项实际清单固定于 `R/runtime/c2-project-quality-manifest-r1.json`，cwd 为
`/Users/sunpcm/code/EchoTalk/.review/worktrees/overnight-runtime-20261103`。manifest 绑定
该 C lane `backend/pyproject.toml` 的 SHA256
`b65ac36452e41aee661541c64d2c6377b2251467ffcc757341d3afda390473b6`；Ruff 两项均显式
`--config backend/pyproject.toml`，19 项 unittest 与之属于同一 manifest/源码指纹。
以下列出与 manifest 等价的精确命令；环境由主控清理，`PYTHONDONTWRITEBYTECODE=1`，
不继承数据库/Provider 配置，单项 timeout 120 秒。命令仅供主控封装，不授予实施者执行权。

```sh
RUNTIME_TREE='/Users/sunpcm/code/EchoTalk/.review/worktrees/overnight-runtime-20261103'
RUNTIME_RUFF='/Users/sunpcm/code/EchoTalk/.review/worktrees/overnight-product-runtime-20261103/backend/.venv/bin/ruff'
RUNTIME_PYTHON='/Users/sunpcm/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/bin/python3.12'
export PYTHONDONTWRITEBYTECODE=1
cd "$RUNTIME_TREE"
"$RUNTIME_RUFF" format --check --config backend/pyproject.toml \
  tools/keyfree-runtime/container_probe.py tools/keyfree-runtime/measure.py \
  tools/keyfree-runtime/runtime.py tools/keyfree-runtime/runtime_support.py \
  tools/keyfree-runtime/test_runtime.py
"$RUNTIME_RUFF" check --config backend/pyproject.toml \
  tools/keyfree-runtime/container_probe.py tools/keyfree-runtime/measure.py \
  tools/keyfree-runtime/runtime.py tools/keyfree-runtime/runtime_support.py \
  tools/keyfree-runtime/test_runtime.py
"$RUNTIME_PYTHON" -B -m unittest discover -s tools/keyfree-runtime -p 'test_*.py'
```

以上 Ruff 是主控集成 lane 的受控工具，Python 是主控核验的 3.12.12；此清单不扩展
实施者读取或借用环境的权限。`R/runtime/c2-project-quality-checks-r1/summary.json`
记录三项 process/gate exit 均为 0、runtime-unit 19 项，绑定 C 指纹
`7f5add2cb20657dfaa811d3b9c06ab7cf164b95d4e5d6f0085de9c56089ea3c5`。
离线测试不证明真实服务、镜像或宿主 HTTP 入口通过。

真实服务入口 `tools/keyfree-runtime/runtime.py` 按下列参数协议执行；冻结快照、manifest、
provision 与独立 approval 的实际绝对路径由主控绑定，禁止直接使用占位值：

```sh
python -B <冻结工具快照>/runtime.py provision --manifest <冻结manifest.json>
python -B <冻结工具快照>/runtime.py exercise --manifest <冻结manifest.json> \
  --provision <report_root>/provision/provision.json --approval <主控独立approval.json>
python -B <冻结工具快照>/runtime.py cleanup --manifest <冻结manifest.json>
```

顺序为 provision → 独立空库 SQL 回执与迁移审查 → 主控独立批准 → exercise → cleanup；
provision 不批准迁移，cleanup 以实际回执为准。命令、manifest/approval、身份与清理边界
由主控按 [RF-07 隔离服务文档](../verification/cross-platform/RF-07-ISOLATED-SERVICES.md)
审核。`measure.py` 是独立镜像测量入口；C before 使用的主控冻结测量适配及其证据另列，
不把候选脚本当作已执行。配对收益只引用 `R/runtime/paired-comparison-r1.json`：API
0.1803%、Agent 0.2728%。包含 A 源码的最终 154 文件新镜像另有新 ID 和验收回执，
不与上述 before/after 配对混算收益，不据体积降幅推导冷启动改善。

| 范围                     | 本轮已知结果                                                                                                                                                                    | 权威索引与限制                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A backend5               | 五项 exit 0；678 pytest、3 warnings、78.67%，59% 门禁保持；Review APPROVED                                                                                                      | `R/api/checks-r1/summary.json`、`R/api/REVIEW-r1.md`；仅批准 A 冻结输入                                                                                                                                                                         |
| B frontend10             | 十项 exit 0；1098 Vitest、21 build-script、69 Fake API、8 types；双浏览器 173 clean + 1 flaky = 174                                                                             | `R/ui/quality-fixed-r1/summary.json`、`R/ui/quality-fixed-r1/10-e2e/command.log`；旧 settings-drawer 文件 goto 首试超时，重试通过，归因未定                                                                                                     |
| C 工具三项               | 格式/lint/19 unittest 均 exit 0，显式绑定上述 pyproject                                                                                                                         | `R/runtime/c2-project-quality-checks-r1/summary.json`；不属于旧 15 项                                                                                                                                                                           |
| C1 隔离服务              | Review APPROVED；真实 uvicorn TCP 的 container-http，宿主 18800 未通；Worker 137                                                                                                | `R/runtime/c1-review-r1.md`、`R/runtime/c1-r1/exercise/result.json`；见 §3.2                                                                                                                                                                    |
| 最终组合功能 16 项       | 前端除 format/e2e 的 8 项 + backend5 + runtime3 全部 process/gate 0；1098 Vitest、21 build-script、69 Fake API、8 types、678 pytest/3 warnings/78.67%、19 runtime，59% 门禁保持 | `R/final-functional-checks-r1/summary.json`；不含 root format 与 E2E                                                                                                                                                                            |
| 最终组合双浏览器         | 173 clean + 1 flaky = 174，process/gate 0；8 条新增 weekly 场景全部通过                                                                                                         | `R/final-e2e-checks-r1/summary.json`、`R/final-e2e-checks-r1/01-e2e/command.log`；同 settings-drawer beforeEach goto 首试 30s 超时、retry 通过，本轮多次出现，归因未定                                                                          |
| 最终 root format         | **pending：待主控最终回执**；首败 exit 1 仅提示两份 A 文档未 Prettier                                                                                                           | `R/final-quality-checks-r1` 保留首败；owner 全部停写后主控统一原生 Prettier、机械 copy、重跑 root format，不能提前写旧 15 项全绿                                                                                                                |
| 最终输入新镜像与真实服务 | 最终 154 后端文件新镜像、完整性、runtime/真实 HTTP 已验                                                                                                                         | `R/runtime/final-measure-r1/receipt.json`、`final-integrity-r1/result.json`、`final-services-r1/exercise/result.json`、`final-services-r1/weekly-http-r1b/result.json`、`final-http-recheck-checks-r1b/summary.json`（后四项同在 `R/runtime/`） |
| 自有资源清理             | 主控确认 C1/C2/final 清理通过；最终 HTTP/cleanup 两项 exit 0；最后产品 PG 正由主控清理                                                                                          | `R/runtime/final-http-recheck-checks-r1b/summary.json`；产品 PG 最终状态以 `R/report.md`、`R/progress.json` 为准                                                                                                                                |

本表为同一 r2 文档收口时点的真实分项结果；最终总报告 `R/report.md` 与
`R/progress.json` 是后续格式、产品 PG 清理及整体状态的最新权威。实施者不运行原生
formatter，也不等待格式结果继续改写；真实 Provider/语音/设备/native 编译/远端 CI
均未验证，停止在 Review，无 commit/push。

### §2.3 2026-11-04 Worker 停机补充轮 runner 与实测

本补充轮新证据根为 `.review/reports/overnight-followup-20261104/`，以下入口由主控使用
本轮新树的独立 Python 3.12 环境、受控 `R/tools`/原只读 `ev.sh`/全局锁代跑。
不使用旧 R 的成功日志或旧 lane 虚拟环境冒充新验证，实施者不安装/执行。

| 检查                | 工作目录               | 命令                                                                            | 环境与边界                                                                              |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Worker 新回归模块   | 新 worker 树 `backend` | `.venv/bin/python -B -m pytest tests/test_analysis_worker.py`                   | 本机主控仅允许 §3.3 新产品测试 PG；仓内 guard 按下述可移植测试库规则验证；无 DB 不 skip |
| Worker 离线时序子集 | 同上                   | `.venv/bin/python -B -m pytest tests/test_analysis_worker.py -k 'not postgres'` | 仅独立定位，不代替上行或完整 pytest；无 Provider 配置                                   |
| 完整后端树          | 新集成树 `backend`     | `.venv/bin/python -B -m pytest --cov=. --cov-report=term-missing`               | §3.3 专用库，59% 门禁保持，主控串行协调                                                 |

所有 Python 入口保持 `PYTHONDONTWRITEBYTECODE=1`；新模块不注册测试进程全局信号。
主控 `R/worker/quality-checks-r1/summary.json` 已验 backend5 全部 process/gate0：
730 pytest/3 warnings/78.43%，59%门禁不变；新 Worker 模块另列52通过。
`R/worker/REVIEW-r1.md` 已批准四文件集成，并确认claim后stop守卫的真实变异被
pending/running断言杀死且还原；实施者未读取私有probe或自行运行检查。

真实 Linux PID1 命令 `python -B -m workers.analysis_worker` 已由主控在新镜像验证：
TERM/INT正常退出0，处理中drain0、超时取消回滚0、明确预置过期后的恢复幂等保持。
镜像/服务索引为 `R/worker/final-measure-r1/receipt.json`、`final-integrity-r1/result.json`、
`runtime-after-r1/{exercise,sigint,inflight}/` 与 `runtime-after-services-checks-r1/summary.json`
（后面三个路径同在 `R/worker/`），详细边界见 RF07 隔离服务文档。
这是Worker范围实测；最终组合 frontend10/backend5 与 runtime3 仍以新 `R/report.md`
为准，不因单项通过取消完整检查，不把旧结果或宿主子进程替代Linux PID1证据。

仓内 Worker 回归不能把一次性本地日期库名写成 CI 的唯一目标。guard 仅接受显式
PostgreSQL/asyncpg、loopback host、有效显式端口、非空 user、以独立 test/pytest token
命名且不含 QA/production 等环境标记的数据库，拒绝额外 URL query；缺省/非法目标在
连接前失败、不 skip/读 dotenv。SQL 再核 current_database/current_user 与已验证 URL
相同，server15.19/c06仍固定。当前 CI 的 localhost:5432、user echotalk/db echotalk_test
因此可移植；正例测试只解析地址、不在本机创建或访问5432。主控本机许可仍严格只有§3.3。

### §3.1 2026-11-03 三线任务与组合验收专用边界

本节仅追加本批已授权边界，不替换上文历史授权，不将执行权限交给受限实施节点。
凭据仅由主控在受保护 runtime 中保管；实施节点不得读取 cp00 runtime、dotenv 或密码。

| 工作线       | 授权 worktree                                                                     | 主控可用测试库                                                                                               | 执行限制                                                                                      |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A 与最终组合 | `/Users/sunpcm/code/EchoTalk/.review/worktrees/diagnostics-export-20261103`       | 原 `echotalk-cp00-pg` / `127.0.0.1:55432` / `echotalk_cp00_test`                                             | 仅完整 pytest 测试写入，不迁移；沿用原 cp00 协调锁；最终组合在 A 执行完整 frontend10/backend5 |
| B            | 本批 B lane（本节不增加其文件写入权限）                                           | 无                                                                                                           | 仅前端/原生检查，不连接数据库                                                                 |
| C            | `/Users/sunpcm/code/EchoTalk/.review/worktrees/linux-runtime-acceptance-20261103` | 新 `echotalk-keyfree-20261103-pg` / `127.0.0.1:55443` / `echotalk_keyfree_empty`、`echotalk_keyfree_upgrade` | 与 55432 库独立；仅主控审核脚本与迁移后代跑，运行于全新内部网络                               |

C 固定 PostgreSQL `postgres:15.19-alpine`，资源 label 为
`codex.scope=echotalk-keyfree-20261103`。不得复用任何已有应用库、QA/生产库或其它 lane 的库，
不得读取/复制真实用户数据。密码由主控随机生成，仅写本任务报告下受保护 runtime，
不进文档、命令回显或报告。主控核验容器 ID、label、镜像、内部网络、端口绑定与 SQL 数据库
身份后才运行。初始迁移含 `DROP ... CASCADE`，从 base 开始前必须 SQL 确认全新专用库
不存在业务表/用户对象；发现对象立即拒绝，不清表、不 downgrade、不复用部分失败库。
旧版本合成演练固定 `c03_call_leases → c06_transcript_events`，只覆盖该前置状态。
迁移审查与输入 hash 在本批 C 报告 `migration-review.md`、`migration-inputs.json`；
审查记录不等于脚本或服务已获执行放行。C 实施节点只准备文档/工具，不运行测试、安装或服务。

### §3.2 2026-11-03 夜间产品与运行时专用边界

本轮源码基线为 `0e09f5e7f3c16b5bb6562632880003e59369e372`。产品测试只允许新容器
`echotalk-overnight-20261103-test-pg`，镜像 `postgres:15.19-alpine`，绑定
`127.0.0.1:55444`，用户和数据库均为 `echotalk_overnight_test`。仅 A lane
`overnight-progress-api-20261103` 与主控组合 lane `overnight-product-runtime-20261103`
共享同一协调锁串行使用；实际测试、安装、迁移及服务操作均由主控受控代跑，实施者不执行。

运行时只允许新容器 `echotalk-overnight-20261103-runtime-pg`，同一 PostgreSQL 镜像，
数据库 `echotalk_overnight_runtime`，仅接本轮全新 internal 网络，不发布 PG 端口；
隔离 API 仅绑定 `127.0.0.1:18800`。所有资源必须带
`codex.scope=echotalk-overnight-20261103`。创建前核对名字和端口未占用，不能停止或复用
占用资源；若主控选用已授权候选产品端口 55445..55449 或 HTTP 18801..18809，须先追加
精确 manifest 和本节边界，再创建资源。禁止启动原 Compose 或连接应用库、QA、生产、
其他 lane 的库，禁止复制真实用户数据。

凭据只由主控随机生成并保存在本任务 R/protected（目录 0700、文件 0600），不进源码、
命令回显或报告，A/C 实施者不读取。空库迁移必须先独立审查迁移输入，再用 SQL 核验
专用数据库身份、业务表及用户对象均为空；发现对象即拒绝，不清表、不 downgrade。
主控同时核验容器 ID、镜像、label、网络、端口绑定和迁移版本。以上为授权边界，
本轮执行事实与限制见下文；新增 runner 清单及验收索引见 §2.2，不由旧 15 项自动覆盖。

2026-11-04 主控执行事实补充：初次产品 PG 仅接 internal 网络，虽有 HostConfig 端口配置，
实际 `NetworkSettings.Ports` 为空，宿主 55444 连接被拒绝；该失败阶段没有执行迁移，
失败 SQL 回执保留。主控随后将同一本轮专用 PG 接入新独占普通 bridge
`echotalk-overnight-20261103-product-host`，核验不可变容器 ID、scope、镜像与实际端口，
仅发布 `127.0.0.1:55444`，并按 ID/scope 核验后断开、移除本轮旧 internal 网络。
本次产品 PG 网络修正不用于 C；C 运行时强制 internal 的边界不放宽。

回执根 R 为主 checkout 的 `.review/reports/overnight-product-runtime-20261103/`。
`R/setup/product-pg-resource-r1.json` 与 `R/setup/product-network-review-r0.md`
记录资源和审查；
`R/setup/product-db-empty-before.json` 记录库/用户均为 `echotalk_overnight_test`、
PostgreSQL `150019`，业务 relations/types/functions 均为 0、无 Alembic 版本；
`R/setup/product-db-migrated.json` 记录主控迁移后版本 `c06_transcript_events`。
这些是已读取的主控执行回执，实施者没有独立连接或执行 SQL/迁移。
产品 PG 协调锁根仍为 `/Users/sunpcm/.local/state/review-loop/locks`，
资源锁为 `R/resource-locks/product-db`；本轮 `backend_action.py` 严格限定 loopback 55444。
本轮新增 runner 精确清单见 §2.2，按新 RF-07 文档由主控审核执行，旧 15 项不自动覆盖。

C1 实际边界：运行时 PG 用户/库均为 `echotalk_overnight_runtime`，只在本轮全新
`echotalk-overnight-20261103-runtime-<run_id>` internal 网络内，PG 使用 tmpfs 且不发布端口。
provision 要求关系、类型、函数及额外 schema 四类用户对象计数均为 0，主控另审迁移后
独立批准 exercise；非空即拒绝，不清表/downgrade。C1 主控回执确认 base→c06，
只授权本轮隔离资源，不连接产品 PG、应用、QA、生产或其他 lane。

API 使用真实 `uvicorn main:app --host 0.0.0.0 --port 8000`，主控以 `container-http`
在 API 容器内经 `127.0.0.1:8000` TCP 请求；health 200、匿名 sessions 401、缺 Key 的
ready 503 已验。宿主 `127.0.0.1:18800` 的
`host_loopback_health_verified=false`，internal 约束保持，不承诺宿主用户入口可达。
真实 Worker 只证明主控预置过期任务的恢复与幂等，不外推任意崩溃或真实 Provider。
`R/runtime/c1-r1/exercise/result.json` 中三个 Worker 均 stopped、退出 137，API stopped、
退出 0；Worker 未证明优雅关闭。该历史 exercise 回执中 PG 曾保留待清理；主控本次交接
已确认 C1/C2/final 自有资源后续清理通过，final 的 cleanup exit 0 另见
`R/runtime/final-http-recheck-checks-r1b/summary.json`，不以 exercise passed 代替清理证据。

最终 154 文件新镜像的真实服务与 weekly HTTP 也已通过，仍保留三个 Worker 137/API 0、
`host_loopback_health_verified=false`，不改变 internal/宿主端口边界。真实 weekly HTTP
独立验证 7 桶、2 个 completed、23h DST、两页各 1 条历史、换窗口 cursor 422、非法时区
422 和匿名 401；GET-only，不与 Fake API 浏览器场景混称一条真实语音链路。
prepared stale 仍仅证明显式准备过期任务的恢复及幂等。主控正在清最后产品 PG，
本节点不自行核验或写为已清；最终 root format 回执和产品资源状态以 `R/report.md`、
`R/progress.json` 为准。

### §3.3 2026-11-04 Worker/WebKit 补充轮独立资源边界

本节只增加用户已授权补充轮边界，不授权任何实施节点执行安装、测试、服务或数据库。
本轮三个新树为 `overnight-followup-{integration,worker,ui}-20261104`；唯一 Worker owner
树为 `/Users/sunpcm/code/EchoTalk/.review/worktrees/overnight-followup-worker-20261104`。
32文件已审 seed 是合法 dirty 输入，原任务四树、main/next2、旧 R 与旧资源保持只读。

| 用途                            | 全新 PG 容器                            | 用户 / 数据库                                             | 端口与唯一网络                                                                      | 存储与标签                                                                    |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Worker PG 回归及最终完整 pytest | `echotalk-followup-20261104-test-pg`    | `echotalk_followup_test` / `echotalk_followup_test`       | 仅 `127.0.0.1:55444`；独占普通 bridge `echotalk-followup-20261104-product-host`     | `/var/lib/postgresql/data` 用 tmpfs；`codex.scope=echotalk-followup-20261104` |
| 真实 API / Worker CLI 验收      | `echotalk-followup-20261104-runtime-pg` | `echotalk_followup_runtime` / `echotalk_followup_runtime` | PG 不发布端口；独占全新 internal 网络 `echotalk-followup-20261104-runtime-internal` | 同一 PG 数据目录用 tmpfs；同一本轮 scope 标签                                 |

两套 PG 均为 `postgres:15.19-alpine`；执行前由主控核实际本地不可变 image ID 并冻结到
新 R 资源 manifest，不能只信 tag 或复用旧回执。创建前查名字、端口和网络未占用，冲突
直接拒绝，不停止/改名/连接占用资源，不复用已存在的同名 PG。测试与迁移在主控同一
协调锁下串行；Worker 与最终集成的 pytest 不并行消费共享库。

runtime API 只请求 `127.0.0.1:18800` 发布，优先真实 `container-http` TCP 验收；
internal 网络下宿主端口不可达时单列 false，不加可出公网网络，不用 ASGI 内调用冒充 HTTP。
本轮任何端口/资源替代必须先由主控冻结精确新 manifest 并更新本节，再创建资源。

凭据只由主控随机生成于新 R/protected（目录0700/文件0600），实施者不读、不复制旧
protected/真实dotenv/Provider模板，不把值写入命令行/日志。本机 R 受控适配必须在执行前
严格固定 `127.0.0.1:55444`、user/db `echotalk_followup_test` 及本节精确容器/镜像/
scope/网络身份；`DATABASE_URL` 缺失或不符即拒绝启动，不 skip/回退默认应用库。
仓内测试guard按§2.3兼容显式loopback测试库，并在SQL中复查身份；该可移植规则不扩大
本机执行许可，不允许通过给其他test库URL绕过主控R适配。当前CI地址仅纯解析正例，
不授权本机访问5432、其他user/database或现存测试资源。
禁止连接原 cp00、旧轮产品/运行时 PG、应用/QA/生产或其他 lane 的库；仅用新合成数据。

主控先亲读全部迁移文件及其 SHA，再独立 SQL 核 server15.19、database/user、数据库
OID/`system_identifier` 与关系/类型/函数/额外 schema 四计数为空。系统 schema 用精确
`pg_` 前缀排除，普通 `pgx` schema 必须计数；任一用户对象非空即拒绝，不清表、downgrade
或复用半失败库。初始迁移含 DROP CASCADE，必须独立审批后才 base→c06，并核实际revision。
PG 新回归只删除自身随机 fixture 的记录；不修改业务 stale/重试/租约语义来清状态。

收尾只按本轮不可变容器/网络 ID、scope、镜像和网络归属核验后清理，不做 global prune。
`R/worker/implementer/db-boundary-ready.json` 仅标记本节资源边界及当时手册 SHA 已准备，
不是整体停写/执行批准。主控可只读手册准备新资源，不能冻结、编译或测试仍在写入的源码。

本轮 runtime 矩阵与其专用资源清理已由主控验收，见
`R/worker/runtime-after-services-checks-r1/summary.json` 及
`R/worker/runtime-after-r1/cleanup/cleanup.json`。产品测试PG仍保留给最终pytest，
不能据此写本轮全部资源已清或最终组合全绿；后续整体状态以新 `R/report.md` 为权威。

## §18 七天语法 + 宿主 HTTP / api 资源与 runner 边界（2026-11-05 收口）

本节记录本轮 scope=echotalk-grammar-http-20261104 的资源、runner 与最终验收事实，旧节不重排。

- 四树 HEAD=8fa9c0a8f2170eb21b38f0bdca8d551e9dd94ef3；API 树分支
  `codex/overnight-grammar-api-20261104`。API 候选 7 文件已以源指纹
  `0c62b0137d30c05d9943722639fc4525b729c8bc2b9929dcb52e2a54e3afb169` 获独立 APPROVED；
  产品代码、测试、生成物和 OpenAPI 随后冻结，2026-11-05 只允许两份已验证文档收口。
- 产品 PG 容器 `echotalk-grammar-http-20261104-test-pg`，network
  `echotalk-grammar-http-20261104-product-host`，数据库/用户 `echotalk_grammar_http_test`，
  宿主 `127.0.0.1:55444`，仅本轮独占 tmpfs。runtime 宿主 HTTP `127.0.0.1:18800..18809`；
  凭据只在主控 `R/protected` runtime，不进 Git 或报告正文。
- 建 PG 前实施 owner 先追加精确边界到
  `docs/verification/cross-platform/RF-08-WEEKLY-GRAMMAR.md`；主控亲读迁移与 SQL 空库身份、
  单独审批后才迁移。禁止旧库/应用库/QA/生产/降级或清表。
- 产品代码和测试由实施方编写；后端 pytest、Ruff、OpenAPI schema 生成/漂移检查、迁移、
  镜像与 HTTP 由主控受控代跑。
  最终组合质量 15 项 exit 0，其中 backend5 为 773 passed、3 warnings、78.48%，59% 门禁
  保持；单次完整 pytest 与独立源码 Review 是同一冻结输入的两类证据，不重复算两次自测。
- 新 host-gateway 最终通过 16 次宿主 GET：health 200、匿名 401、缺 Key ready 503、
  weekly-grammar 有效 200/非法 date/timezone 422，周窗口覆盖纽约 25 小时日；历史 55 条、
  4 页，cursor 负向请求改变 status 并返回 422，另覆盖 >48h 等负向边界，请求前后数据库计数
  不变。API/PG 仍只在 internal 网络，只有固定网关连接 internal 与专用 bridge 并发布
  `127.0.0.1:18800`，`ip_forward=0`。同 bridge canary 由网关容器内 `docker exec` 直连通过，
  API 侧同探测被阻断；该结果不证明任意 relay/代理能力，也未接触公网。此前 internal-only
  时宿主 18800 不可达的历史失败继续保留，不改写成原 Compose 或真实 Provider 链路通过。
- API 的 user、synthetic 与 gateway IP-forward 变异均被对应断言杀死并恢复，首败与中断日志
  保留。最终 runtime/product cleanup 均 exit 0，按本轮不可变身份与 label 清理且无全局 prune。
  当前文档改动仍需主控最终 format 和整体 Review；真实 Provider/IdP/LiveKit、语音、设备、
  native、远端 CI 与部署仍为独立未验边界。

## §19 RESTORE-20261107 资源收口

本段替换 delivery r0 候选追加，不改写上方从
`42c61bb08f5e234989198ef46ed7534a80c70796` 恢复的原文。上方历史 CI 与已验记录只属于
当时提交。本候选没有 push，也没有本轮远端 CI。这里的 Node 回归不能代替 native
App、Xcode、Rust 构建或设备验收。真实 Provider、IdP、LiveKit、语音、生产部署和原
Compose 整栈未验。根格式与保全回执见主控交付报告，这里不预告根格式通过。

本节只收口本轮追加的资源记录。§18 及更早的原文不动。

### §19.1 产品测试库

该库已经创建、独立审批、迁移验收，并在验收后删除。身份没有改变：

| 项            | 实际值                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| scope         | `echotalk-restore-20261107`                                               |
| 容器          | `echotalk-restore-20261107-test-pg`                                       |
| 容器 ID       | `47327ca68f5618b7bf7e8493edaf62892a622c41147fc83b1ed8144958e2cc2a`        |
| 网络          | 普通 bridge `echotalk-restore-20261107-product-host`                      |
| 网络 ID       | `38db83768419d55c612bb13fcc5bfae79828dbdb22af1a5b4703d1cb16c8bd85`        |
| 镜像          | `sha256:a46e076249ce434e41203b8c1dadfaa025b9726331d72390df038385d6dc29cd` |
| 发布          | 只绑定 `127.0.0.1:55444`                                                  |
| 用户 / 数据库 | `echotalk_restore_test`                                                   |
| 存储          | `/var/lib/postgresql/data` 仅 tmpfs                                       |

迁移前真实 SQL：server `150019`，database OID `16384`，`system_identifier`
`7705103694990835753`，`relations`、`types`、`functions`、`extra_schemas` 均为 0，
`alembic_version` 为空。独立迁移审查和空库审批之后才 upgrade。迁移后仍是同一 OID
和 `system_identifier`，`alembic_version` 为 `c06_transcript_events`，`relations`
42、`types` 44、`functions` 0、`extra_schemas` 0。随后 backend pytest 794 passed、
3 warnings、覆盖率 78.84%，59% 门禁保持。清理回执 `removed: true`、
`tmpfs_only: true`，删除的是上面同一对容器和网络 ID。它没有继续运行，也没有连接
旧 cp00、应用库、QA 或生产库。

### §19.2 runtime 私有命名适配

产品 `tools/keyfree-runtime/runtime.py` 的恢复字节没有修改，磁盘上的
`LEGACY_SCOPE`、`PG_NAME` 和 allowlist 仍是旧常量。这不是产品对新 scope 的通用支持。
主控私有 harness 只在本轮进程内存中绑定名称，原隔离、身份和 approval guards 仍执行。

本轮实际绑定并已创建的资源是：

- scope `echotalk-restore-20261107`，run `restore-r0`。
- PG 容器 `echotalk-restore-20261107-runtime-pg`，用户和数据库都是
  `echotalk_overnight_runtime`，不发布宿主端口，数据目录只用 tmpfs。
- internal 网络 `echotalk-restore-20261107-runtime-restore-r0-internal`。
- gateway 网络 `echotalk-restore-20261107-runtime-restore-r0-gateway`。
- gateway 以 `host-gateway` 只发布 `127.0.0.1:18800`，`ip_forward=0`。
- Postgres 镜像与产品库相同；API 镜像
  `sha256:523ef5c5638bb4b8f18289da21c3b8b27ca0cfc0f1d8ec8406b0298f60c7de6a`，
  Agent 镜像
  `sha256:ce02c1505bf5c91d4eb8ff71c21ba015a3837d134698266578dc0b7b65eb170a`。
  后端源 159 个文件，SHA256
  `44c04778fccd391e4d0f420a3adf7959a9820cb6ae7b34e16c6efa6d1e381ba6`。

provision 时库为空：server `150019`，`relations`、`types`、`routines`、
`extra_schemas` 均为 0。独立 run manifest 和空库审批后，exercise、宿主 HTTP、
runtime cleanup、产品库 cleanup 均 exit 0。宿主 16 次 GET 的数据均为合成 fixture，
包括 real-flag 行，不是实际用户或真实 Provider 数据：health 200、匿名 401、
缺 Key ready 503，loopback 已核验。API 与 PG 只在 internal 网络，没有默认路由和
发布端口；固定 gateway 同时连接 internal 与本轮 gateway 网络。同机 canary 为
gateway 正向、API 负向，没有公网调用。五个进程最终 exit 0。这不改写上方历史中
internal-only 时宿主 18800 不可达的记录。

验收后 runtime 的 8 个自有 ID 已删除，清单在
`.review/reports/restore-integrations-20261107/runtime/services-r0/cleanup/cleanup.json`。
产品库和它的 bridge 也已删除。凭据只在主控 protected runtime，没有进入本文。
最终保全审计见主控交付报告，本段不把该审计预告为通过。

### §19.3 本轮 Node 回归与未验边界

Vitest 1137、构建脚本 21、Fake API 72、API 类型 runner 8、Chromium+WebKit E2E 178
且 retry 0、runtime 标准库测试 31、iOS 编排 Node 测试 28。actionlint 通过。ESLint
0 error、136 warnings。macOS probe 首轮 47 项中 17 项 ENOENT，原因是探针自身缺少
`node_modules`；离线 `npm ci --ignore-scripts` 后 47 项通过，无产品补丁，首败日志
保留。`WeeklyGrammar` slot 归属守卫变异被杀死，完整源码指纹已恢复。

API 与 Agent 镜像分别有 55 和 83 个包、ldd 6 和 79，dev 依赖不在镜像内，冻结导出
一致，各 3 个导入样本和 ffmpeg 通过。宿主 HTTP 的全部数据都是合成 fixture，包括 real-flag 行，不是实际用户或真实
Provider 数据。`total_errors` 为 21，其中含榜外记录；榜内三项是 `other` 7、
`article_usage` 5、`verb_tense_past` 5，合计 17。历史 55 条共 4 页、纽约 25 小时日；
读请求前后数据库计数不变。Worker 演练另有一条 synthetic assessment 和一条 synthetic
grammar、零 KnowledgeState，与上述 HTTP fixture 分开。恢复范围只包括显式准备的过期
running job，重启和重复执行保持幂等，不证明任意崩溃恢复。gateway TERM/INT 为
272/262 毫秒且 exit 0；PID1 服务长驻 17 秒，前后有健康 listener 检查，不是单条连接
持有 17 秒。最多 2 个连接，第 3 个被拒绝，active shutdown 199 毫秒，header timeout
153 毫秒。

以上不是 native App、Xcode、Rust、设备、真实 Provider、IdP、LiveKit、语音、生产
部署或原 Compose 整栈的验收，也不是本轮远端 CI。
