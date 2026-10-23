# EchoTalk 外部 CLI 评审循环

本文件维护项目落地约定。通用方法及状态工具由本机 `review-loop` skill 维护，不在项目里复制第二份实现。采用自动模式须有用户对外部实施 Agent、源码外发与执行范围的授权；模式变更不扩大既有授权。

## 入口与职责

- 通用入口：`~/.agents/skills/review-loop/SKILL.md`。
- 自动模式、工具命令及限制：`~/.agents/skills/review-loop/references/cli-automation.md`。
- Claude Code 对应 checkout：`~/.claude/skills/review-loop`。两个 checkout 应保持相同提交；更新前保留各自未提交改动。
- 当前三端项目详细测试树、测试库身份与工作线所有权，沿用实施 lane 的 `docs/agent-review-loop.md`。具体身份必须运行前核验，不能由本文推断本机服务状态。
- 架构/评审方落盘 prompt、派发、保存执行状态并独立核验；外部实施方只修改授权 worktree 的代码、测试和文档，停在 Review，不 commit/push/部署。
- 用户已明确的产品及模型决策持续有效；产品口径变化、权限扩大、真实外部依赖或发布动作仍进入交互门禁。

## 本地目录与执行策略

prompt、报告、原始流、reviewer probes、账本和授权记录放在 `.review/`，依照现有约定保持本地排除，不纳入 Git。账本必须位于实施 worktree 之外；原始流保留，交接仅给摘要和索引。禁止把 `.env`、密钥、凭据或用户数据传给外部服务。

代理依照本机约定，在运行外部 CLI 的同一个 zsh 进程中执行 `proxy on`，本地测试保留 localhost 的 no_proxy；不修改全局代理。实际端点不写死进通用 skill。

当前模型沿用用户已批准的工作线策略；不因权限错误、额度耗尽或返工而自动切模型。并行工作线须具有独立文件所有权；共享测试数据库、迁移与本地端口另行互斥。缺失测试库变量时不得回退应用库或默认 `.env`。

## 新任务接入门禁

1. 核验 CLI 版本、授权、目标 worktree 的 HEAD/dirty 与相应项目约定，记录命令与依赖环境。
2. 采用 `loop_gate.py init` 建立私有账本，记录 provider/model、授权记录与上限。起始建议上限为总计 3 次实施尝试、1800 秒活动时间、连续 2 次源码无变化；按任务耗时和用户策略调整，不把示例当硬性项目验收标准。
3. 项目控制器必须在 CLI 启动前成功执行 `begin`，并为进程组实施硬超时。账本不负责启动、监控、暂停或终止进程，也不会自动修复现有 launcher。
4. provider adapter 从完整原始流及退出记录归一化交付 JSON，再执行 `finish`。通用skill已有有限格式的agy stream-json解析器，接入前仍须用当前CLI的脱敏输出验证，不能仅从 SUCCESS 或退出码推断成功。
5. 只有 `ready_for_review` 才进入独立评审；评审者独立运行所需检查并落盘裁定，最后以 `review` 记录 `approved` 或 `changes_requested`。交付后的源码和证据若变化，旧交付不能直接评审。尚未裁定时可经有记录的 `refreeze` 更新冻结；已批准任务不得覆盖。账本逐轮保留交付指纹与评审绑定，报告原文仍使用新轮次路径。
6. 达到预算、无进展或新决策门禁就停止派发，保留产物并向用户提供选项。不能删除账本重置计数，不能用实施方自述替代独立评审。

通用工具只冻结所列源码/证据，并检查状态转换；不验证权限真伪、报告内容、测试质量、ignored 文件或外部环境，也不是安全沙箱。

## 暂停与历史任务

用户暂停时，停止后续派发，核验完整进程组身份并实际暂停/取消，确认后再更新账本。仅写 paused 字段不会停止进程。SIGSTOP 不能证明远端模型请求已取消或停止计费。

现有旧 launcher 使用墙钟超时，不能只恢复子进程：父 launcher 可能立即判定超时。恢复前检查用户已撤销暂停、父子进程身份、输出是否完整、源码是否变化以及超时设置，先修正控制器再恢复。已完成的任务直接核验现有产物，不重复启动。

旧任务没有新账本时，沿用旧记录，不把它重新 init 成零轮次。确需重新派发时确认旧进程组已退出，记录历史尝试及消耗，并明确剩余预算。历史迁移不由通用工具自动完成。

本轮已按用户指令完成认证线本地里程碑后停止派发，结果记录在隔离集成分支的 `docs/PROJECT_STATUS.md`。本手册本身不授权未来自动恢复。

## 验证与维护

```bash
python3 -m unittest discover -s ~/.agents/skills/review-loop/tests -v
```

此检查只使用临时 Git 仓和文件；不调用外部模型或数据库。本轮本地试点已实际接入 agy、项目 runner 与交付门禁，完成两次有限尝试；项目 adapter 位于本地 `.review/reports/tools/pilot-auth-agy.py`，用真实日志 fixture 验证了假成功/超时、拒权和不完整流。它只验证当前 CLI 输出格式，不是通用 provider adapter。通用取消/暂停恢复、启动失败与孤儿进程处理仍需专门的端到端验证，不能用这些测试替代。

记录每个最终验收任务的返工、人工介入、耗时与分提供方用量；区分单次与会话累计、缓存与真实计费。自动化减少手动复制，尚不能据此认定降低总 Token 或成本。

## 优先节约 Codex 额度

本项目采用新版 review-loop 的节约主评审额度模式：agy 完成读码、实现、测试和预算内的普通 fixture、类型、格式排错；Codex 定义边界、集中提出有证据的评审问题并独立验收。产品契约、权限和模型策略变化仍停下来交互。实际节约额度尚未量化，不能用 agy Token 直接折算 Codex 节省量。

实施前先完成编辑和格式修复，然后按 lane 一次提交固定检查；完整日志保留本地，仅返回状态和证据索引：

```bash
python3 /Users/sunpcm/code/EchoTalk/.review/reports/tools/cross-platform-local-check.py a quality
# 后端、Tauri 工作线分别将 a 替换成 b、c。
```

A 包含构建脚本测试、单测、格式、lint、类型和构建；B 包含格式、lint 和既有受保护测试库入口；C 包含生命周期测试和隔离离线构建。此入口不执行安装、格式修复或 E2E，不改变原有分支及数据库迁移审查门禁。命令失败即停止后续检查；源码或 manifest 漂移不得判成功。外层控制器仍负责进程和工作线互斥。

Codex 按变更风险保留独立检查与必要 E2E；已有且输入未变化的证据通过索引读取，避免只为查看输出重复执行。返工交接集中给问题编号、代码事实、契约、复现与关闭标准，不进行逐条遥控编码；等候优先使用完成事件或有界等待。不能以省额为由跳过源码审查、冻结或必需测试。

本地策略记录：`.review/reports/skill-quota-update/policy.json`。本次仅更新工作流和检查入口，业务仍停在认证线本地里程碑；本段不授权自动恢复业务开发。

## 2026-10-22 可靠性修复

通用skill本地更新到`d718539`，Codex与Claude Code两份checkout已同步；未推送。可靠启动、轻量交接及正式恢复规范见`references/reliable-launch.md`，不改变既有外发、测试库、模型或发布边界。

下一次已授权任务的控制器应先运行固定预检和快速基线，成功后才begin/启动模型。代理在同一zsh按本机约定加载，预检不输出代理值；下面的命令只用于已经批准的目标工作线：

```bash
python3 /Users/sunpcm/code/EchoTalk/.review/reports/tools/cross-platform-local-check.py a preflight &&
  python3 /Users/sunpcm/code/EchoTalk/.review/reports/tools/cross-platform-local-check.py a baseline
```

预检核对CLI可用性、分支/审查过的HEAD、干净状态、固定runner hash及现有精确权限条目；不会调用模型或测试网络，也不能证明宿主有效权限。基线配置在本地`.review/reports/tools/review-loop-launch-baselines.json`，由评审在新任务前维护，不能用动态当前HEAD冒充已审查基线。授权dirty须明确核验并配置，不得关闭检查掩盖未知修改。A快速基线为格式/lint/类型；完整quality顺序为格式/lint/类型/单测/构建脚本测试/构建，测试树不删减。B保持格式/lint/受保护测试库入口，C保持原生命周期/离线构建。

后续新控制器复用skill的`agy_delivery.py`，绑定完整原始流hash；只识别已测试的有限格式，精确等待提示单独计数，未知事件/拒权/超时失败关闭。旧已完成controller和账本保留，不因升级重跑任务。等待优先完成事件，无事件时用有界等待；只取`loop_gate.py <state> status --compact`，进程存活另行核实。最终明确本轮是否已结束和是否继续派发。

预算变化使用`amend-budget`，只增加已获用户决定的上限，不重置消费；交付解析修正使用`reparse-delivery`，原始流和源码不得变化，运行事实不能洗掉，结果只回到待评审。两者均禁止直接编辑账本字段，命令中的授权记录不等于工具证明人类同意。旧任务没有原始流绑定时不能伪造绑定以恢复。

本次验证：41项离线测试、独立检查通过；新固定A预检实跑通过且`model_started=false`。历史三份agy原始流脱网回放仍阻断真实拒权，并正确识别两份含精确等待通知的完整交付，原始记录及既有裁定未改写。真实Claude/Codex双宿主模型调用与净省额效果尚未新增验证。EchoTalk业务仍停在A5里程碑，本次不恢复派发。

## 2026-10-22 A6 使用记录

本轮实际使用预检/快速基线、有限agy解析器、账本begin/finish/reconcile/review；未直接修改账本、未更换模型或增加命令权限。新增问题记录于本地`.review/reports/workflow-capabilities/issues.md`：精确文件路径/新建状态不足、运行状态粒度、可重试断言缺口、跨日临时测试库就绪/schema，以及评审变异与浏览器验证的路径/依赖调度。保留原始失败和修正证据，本轮不据此再改全局skill；净Codex额度收益仍未证实。

## 交接、恢复验收与事件摘要补强（2026-10-22）

用户要求优化后，通用skill本地更新至`7306f2b`，Codex/Claude独立checkout已同步，未推送。通用变更见skill的CHANGELOG.md；本地证据见`.review/reports/skill-a6-update/`。

新任务交接列关键现有/新建文件，launch_preflight可选task_files检查实际路径；返工后根据已创建文件刷新声明。恢复流程同时验收禁止副作用、最终状态与再次操作。变异与消费同一源码的验证串行，固定入口使用绝对路径与fail-fast。

check_batch新增run-status.json元数据；下一次agy控制器需显式接入runtime_status接口，不能把当前账本running当实时阶段。只报告实际观察到的事件，未知阶段不猜测。摘要不是进程存活/交付完整/评审通过证明，展示计时不改预算。

EchoTalk数据库前置检查仍由项目维护：核对专用容器/数据库身份，再有界pg_isready，再检查schema/Alembic版本。当前项目wrapper尚未自动集成全部预检，应在后续任务执行前落实；本次未启动服务或迁移。业务代码维持A6本地里程碑，没有派发下一开发任务。

独立检查发现并补修新建文件祖先冲突；48项离线回归通过。真实CLI进度、双宿主模型调用和净额度收益继续待验收，离线通过不替代这些结论。

## A7 真实任务接入结果（2026-10-22）

用户授权继续后，7306f2b的task_files预检与RuntimeStatus事件摘要已用于A7。外部CLI实际运行一次并正常退出，固定检查自产run-status.json；父摘要尚未聚合子batch，仅有provider_event时阶段unknown。不能把未知阶段当卡死，也不把finished当APPROVED。

专用数据库wrapper已补30秒pg_isready及schema/Alembic/必要表检查，失败即停，不自动迁移。实际269项后端回归通过。未启动其他数据库、未访问真实Provider。

A7 API前置里程碑本地通过，四项新工作流问题在`.review/reports/workflow-lease-api/issues.md`，原失败与报告保留。后续收益仍需观察，精确Codex任务Token不可得，不报节省率；未继续下一模型任务。

## A7后续skill优化（2026-10-22）

用户另行授权后，通用skill本地更新`c133e3f`，两端同步未推送。新增codex_usage.py用于指定本地JSONL的已完成turn核算，真实A7回放与原追溯一致；历史报告/账本不覆盖。父turn/子Agent、缓存/非缓存与会员扣减分开，不报告未经对照的节省率。

runtime_status要求绝对路径，可用--child显式读取本轮子batch。控制器必须传递确认过的路径，不能扫描“最新文件”猜归属；子状态不替代父完成或APPROVED。契约格式先于基线，测试数字引用runner证据。详细边界和验证见skill CHANGELOG/usage-accounting以及本地`.review/reports/skill-a7-update/`。

本次只修改skill与本地过程文档，业务继续停在A7里程碑；真实新任务接入子batch路径和收益观察仍待后续，不自行派发。

## A8双工作线本地试点（2026-10-22）

用户要求继续后，从共同基线并行启动A独立占用控制器与B Web生命周期适配器，均Gemini3.8FlashMedium；每线独立3次/1800活动秒/连续2次无进展、单轮900秒，固定命令与路径范围，未扩权限。两线各2次模型尝试（首轮+一次同会话返工），Codex亲自独立review，B先集成、A后合并，最终组合336产品测试及7门禁通过。

运行摘要实接父进程和由nonce绑定的本轮子batch路径，聚合仅元数据，不把子checks_passed当父APPROVED。日志`.review/reports/workflow-parallel-a8/`保留生命周期恢复快照缺陷、评审去重Promise夹具问题、跨代际在途标记/写前检查缺口，以及行为冗余候选变异等四项新记录。

实际模型活动累计约1783.48秒，其中重叠约560.36秒，只是观测值，不是对照测得提速。两会话最终累计agy total分别498165与211777，续跑累计不再叠r0；缓存/思考单列，不能等同账单或Codex节省。本轮跨中断与继续turn，Codex完整用量在自然结束后另提取，不特意唤醒模型。

本地阶段不push/deploy、不接真实Provider，Cloud/UI/原生恢复后续仍需实现。此里程碑停止下一产品派发，不因文档自动启动新任务。

## A12 调度失败闭环和最新项目策略（2026-10-22）

当前通用skill cd09a3a。EchoTalk按用户最新决定，每独立开发任务最多10次尝试，包含首轮及返工；继续/中断不重置预算，不能换名绕限。暂时关闭agy print-timeout、控制器单次与累计活动时限，继续记录真实活动耗时，保留连续2次无进展、权限拒绝/交付格式及独立评审等全部门禁。其他项目默认不随之改动，配置仍可恢复有限时间上限。

A12从PR96合并后main@344e317建立独立账本，3次累计1400.71秒。首次CLI1.4.5却拒绝已授权Flash Medium，而只读models仍列出该ID；正式reconcile保留历史后同模型重试成功，不能宣称模型下架，也未擅自换模型或扩权限。预检可后续考虑模型目录可用性，目录存在仍不保证实际推理成功。

r1常规quality通过但独立探针发现markDispatched同步通知订阅者后，取消/结束/认证revision/卸载仍发POST；r2补发送前复验关闭。报告起点指纹和原始错误日志一起修正。评审错误runner入口保留并纠正，只有正确lane结果作裁定；两有效变异、21私有探针和完整门禁通过。问题原文在本地.review/reports/workflow-dispatch-a12/issues.md；不自动扩全局skill。

同一agy会话最后累计total733111，不能把r1与r2累计相加；cache_read14093775、thinking39150单列。Codex完整任务额度未测，不给净省额结论。在小里程碑停止下一模型任务，后续再按用户决定评估/优化流程。

## A13与连续推进策略（2026-10-22）

用户已要求顺利时直接进入下一里程碑，不逐里程碑请示/汇报，更新本地问题日志及仓内验证/计划，待集中查看。此策略替代先前各轮“里程碑后停止下一派发”的默认约定；既有授权范围内常规修复/检查/本地commit/隔离集成连续执行，产品决策、新权限/模型或不能继续的阻塞仍交互。单任务预算不重置，独立评审不减少，不自动push/远端merge/deploy或修改全局skill。

A13同会话两次终止ERROR stream interrupted而代码/quality已完成，原始事实保留；同账本冷启动同模型形成完整交付，未改产品，不reparse伪造成功。源码四类P1由集中独立探针定位并修复；49私有探针/有效变异和完整门禁通过。复现及证据在本地.review/reports/workflow-connection-a13，不把项目事故原文写入通用skill。

账本wall活动时间与RuntimeStatus单调时间在宿主暂停/时钟变化情况下可能不一致，原因尚未核实；分别保存原始来源，不重写历史或用墙钟推断精确计费/净省额。后续可考虑用量展示与模型目录预检优化，先积累证据。

用户另行明确批准仅下载匹配WebKit，未升级Playwright/锁文件；现有旧WebKit不匹配，安装webkit-2336并本地启动通过，为后续双浏览器验收准备。仍不冒充Safari/WKWebView真机或真实Provider结果。

## A14宿主中断退出证明与双浏览器（2026-10-22）

宿主中断后先核对PID/进程组与账本，原controller/child均gone而无OS退出记录，尽管raw终止SUCCESS也不推断exit0。使用exit_code:null正式finish并保留原流，经授权范围内reconcile在同账本冷启动原模型补完整交付；消耗次数与活动时间不重置，源码与前轮相同。账本time含恢复等待，不能冒充精确模型计算/计费。

Chromium/WebKit真实收集11/11、0skip；独立Fake API进程探针与行为变异验证新增测试有实际断言。双项目共享analysis-failure ID状态污染由独立项目后缀修复，P2 success grammar派生路径留TODO。报告的媒体mock/本轮未改源码用语在最终验证文档明确边界，不外推真实链路。原始证据在本地.review/reports/workflow-webkit-a14，通用skill未自动改动。

## A15等待频率讨论点（2026-10-23）

用户观察agy常需20–30分钟，希望减少无变化检查；WORKFLOW-WAIT-01保存在本地workflow-analysis-a15/issues.md。后续优先完成事件或较稀疏的有界等待，只导入状态/停止原因/证据索引；遵守宿主沟通要求，但不把重复摘要当新进展、不反复读原始流。轮询间隔具体策略尚待讨论和测量，本次不改通用skill。独立验收、失败关闭、取消及退出核验保持。

A15关闭知识请求在途范围缺口；报告hook数量小错据实际runner更正，不增加模型轮。一个冗余守卫候选变异存活，两个行为关键变异确实失败，保留全部原始证据。后续原生插件新增和本地iOS build+sync已有用户明确授权，超出Xcode/签名/真实服务仍须交互。
