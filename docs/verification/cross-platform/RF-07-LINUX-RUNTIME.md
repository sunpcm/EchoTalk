# RF-07 Linux/Docker 与专用测试库验收

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
