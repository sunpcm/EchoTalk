# EchoTalk 外部 CLI 评审循环

本文件维护项目落地约定。通用方法及状态工具由本机 `review-loop` skill 维护，不在项目里复制第二份实现。采用自动模式须有用户对外部实施 Agent、源码外发与执行范围的授权；模式变更不扩大既有授权。

2026-11-01 的局部接线候选见文末与手册 §17；下文各日期记录保留其历史口径，不能作为
恢复任务、当前预算、模型可用性或原生执行权限的证明。

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

## A16流程优化与真实恢复（2026-10-23）

本地通用skill a42fde9（Codex/Claude两checkout同步，未推送）新增最小时序矩阵、长任务低频检查和同账本增量交付；66项离线回归及quick_validate通过，不等同未来Agent遵循/额度收益证明。已知较慢CLI可从3–5分钟元数据检查起步，宿主沟通频率独立遵守，不额外读原始流或承诺不存在的后台事件。

项目只读固定入口：python3 -B /Users/sunpcm/code/EchoTalk/.review/reports/tools/task-status.py workflow-native-a16 b r5；显式task/lane/round，路径从脚本位置确定，不依赖cwd。--diagnose仅失败时离线重放解析元数据，不改旧交付；未知行仅给行号，无正文/代理值。根目录与临时目录结果一致，旧r2失败保持不动。

A16网络reset后复用旧门禁：reuse-r3/r4.json钉源码snapshot和8个证据hash，控制器begin前/结束后复核，任一变化拒绝。离线破坏源码指纹/hash/证据根均阻断，无模型调用/账本变化；补交不从头实现，独立评审与集成门禁保留。r3复用长会话仍失败，原模型新会话r5完整交付，不能据此断言网络根因。r4因CLI从1.4.5到1.4.6在模型前阻断，help/有限fixture后受限固定新版，真实流仍失败关闭。

已记录后续讨论点：仅补交付不改源码仍递增no_progress，连续传输失败可能比10次总预算先触发2次门禁；当前不改定义/预算、不用无关改动绕限。短报告仍须提供完整实际产物路径，本次精简丢路径导致P2误报目录，由最终验证纠正。shell初始化可返回非零，必须核实所需proxy函数/环境和模型前预检；生成/检查仍fail-fast。全部新问题仅本地issues.md，暂不继续叠加全局规则。

## A17/A18新流程观测（2026-10-23）

A17首轮完整交付、无产品返工；35独立探针/两个接线变异通过。A18预置时序矩阵仍发现同步身份复核不释放与初始化早于槽位的P1，集中r1关闭；独立fixture字段错误另行更正并保留原失败，不误归因产品。矩阵是验收约束，不是实现正确/节省额度的证明。

CLI1.4.6 r1流出现step_update.step_type=checkpoint（DONE），终止SUCCESS也因未知schema失败关闭。未临时扩大解析；同模型冷启动仅短交付，绑定旧源码和8个证据hash后完整恢复。后续支持checkpoint需专门脱敏fixture、字段和工具拒权边界验证，不直接放行任意step_type；事件原文和SHA仅本地报告。

仅补交付回执补真实三文件绝对路径，A18短报告已准确；仍保留报告错误/传输与no_progress计数等后续讨论。项目诊断入口固定绝对路径与cwd无关，模型等待稀疏摘要检查，宿主沟通频率独立遵守。新问题只记本地，不因每个事故再膨胀通用skill；最终实际收益待可比较的Codex额度数据。

## A22/A23里程碑观测（2026-10-24）

最新本地skill1c1b68d继续实际运行，A22完成活动列表布局，A23修复真实store正常失败与取消的通知区分。每次浏览器采用独立output目录，旧失败附件保留。A23首轮仍出现测试选择器约束诱发的产品状态写，独立同步订阅反例后集中关闭；仅放开两处过期定位器迁移，不弱化旧副作用断言。r1 checkpoint未知流继续失败关闭，同模型冷启动短交付+源码和8旧证据hash复用恢复，不临时放宽解析。

新问题在本地workflow-resume-error-a23/issues.md，包含长等待沟通噪声、选择器与行为断言范围区分、私有Vitest依赖解析及产品测试名称不代表同步订阅事实；不自动再改skill。用量见本轮验证文档，按每会话末累计去重，不把agy用量等量当Codex节约。

## A24 本地导入里程碑（2026-10-24）

继续使用本地skill1c1b68d，Flash首轮与集中返工均完整交付，无权限或流恢复问题。独立审查在七门禁全绿后仍发现提交至passive清理间隙P1、旧回调测试optional空调用未实际触发、BOM二次删除正文三项；集中关闭，11时序/18真实浏览器与两有效变异证实。细节与用量见[验证](./verification/cross-platform/CP-05-DOC-IMPORT.md)，问题保存在本地workflow-doc-import-a24/issues.md，当前不再扩全局skill；真机与真实环境边界保留。

## A25 中断恢复与布局验收（2026-10-24）

从已核实的A24完成点续做A25，无重复启动。首轮非必需CLI配置读取命中deny，保持规则与失败记录，正式reconcile后同Flash冷启动恢复；未请求新增权限。独立审查在全页几何通过后发现标题自身32px/scroll59溢出，集中关闭并补默认回归。完整最终证据与用量见[验证](./verification/cross-platform/CP-05-DOC-LAYOUT.md)。快速三项检查与完整七项可能共享task名，必须据确定summary的实际check ids判断，不只读finished/checks_passed。其余候选留本地workflow-doc-layout-a25/issues.md，不自动扩skill。

## 2026-10-24 检查范围与拒权早停优化

本次只优化工作流，不启动新的产品任务或模型会话。固定runner的baseline/quality清单现在分别声明check_kind和required_check_ids；当前B线完整quality为format、lint、typecheck、test、build-script-test、build、e2e，baseline仅前三项。组合进度显示声明范围及预期/结束/通过ID，不能凭task名或checks_passed认定完整验收；coverage=complete也可能包含失败，必须结合逐项状态。

下一轮本地控制器模板为`.review/reports/tools/pilot-frontend-next-agy.py`，需要评审方准备`workflow-frontend-next/plan.json`、task_id、prompt_prefix、分支/基线及既有授权文件后才能启动；不得复用已完成A25账本。模板读取既有完整行时接通通用permission_denied辅助函数，命中已验证tool ERROR拒权即记录early-stop.json、停止自有进程组，原始流不改，最终normalize与finish仍保留blocked_permission和消费。CLI及累计任务时间默认沿用用户选择的不限时；不修改权限。A24/A25旧控制器和证据原样保留。

迟到回调实际执行规则进入通用评审指南；几何范围与截图经验留[项目布局清单](./verification/cross-platform/UI-LOCAL-CHECKLIST.md)。无阶段变化时等待沟通简短，详细日志仅在诊断或验收读取。

验证仅使用临时Git仓、本地子进程及脱敏流，覆盖拒权早停、进程组清理、部分交付分类、账本计数和范围缺项预检。没有用真实agy调用验证新模板，也没有净Codex额度节约的新结论；下一次真实开发继续观察并记录问题。

本轮同步skill提交为`b09b925`（Codex/Claude两份一致），各79项离线测试及quick_validate通过。实际固定runner的B线baseline已通过三项检查，回执明确kind=baseline、expected/completed/passed均为三项；没有以此声称完整七项quality或真实模型验收通过。

## A26 使用新工作流的实际观测（2026-10-24）

skill b09b925完成回答推荐本地增量，过程见[验证](./verification/cross-platform/CP-05-ANSWER-RECOMMENDATIONS.md)。r0 lint失败即停，check_scope准确显示quality覆盖未完成；r1七项全绿时才显示完整。未触发真实拒权，不能声称早停已在本轮真实CLI验证。

独立评审仍发现作用域文本遗漏、StrictMode效果重放、render取消已提交timer与16px逐字竖排，集中返工关闭；这属于已有评审规则/项目几何清单的实施遗漏，不自动增加通用规则。版本漂移在模型前阻断，20项本地适配回归和help核对后受限接纳1.4.7，实际流完整无拒绝，计数不洗掉。完整账本输出应由控制器capture后只给小元数据；长任务宿主沟通与低频状态读取分别记录。原证据与问题留本地，未push或连接真实业务服务。

## PR #98 后单 cp00 工作线与 A27（2026-10-24）

用户要求核验 main/远端/worktree 后继续，实际均为 `80fb8ec`，仅主目录和 cp00 保留；旧 lane 已归档。评审备份本地 runner/基线后，将既有 b 角色重绑 cp00，控制器也使用同一精确 worktree；旧报告命名空间保留，旧账本不重置。通用 skill 使用本地最新版 `a93a1a8`，未因新问题修改 skill。

Flash Medium 首轮正常交付，Codex 自行审源码、复跑 7 项 quality/后端测试，并做独立浏览器探针与有效变异。文档用语和评审探针 cwd 失误原始记录保存在 `.review/reports/workflow-reduced-motion-a27/issues.md`。专用库初始停止且为空，按既有授权核验身份、审查既有迁移后恢复；未触应用库。未扩模型/权限/源码外发范围，不推送或连接真实业务环境。净额度收益仍未证实。

## 2026-10-24 本地 CI 质量门禁对齐（A30）

基于 RF-04 与 CP-06 门禁真实性要求，将 `.github/workflows/ci.yml` 的 `test-frontend` 执行步骤对齐本地 8 项质量门禁（format、全 workspace lint、全 workspace typecheck、直接 Vite Vitest、构建脚本测试 `test:build`、Fake API 原生进程测试 `test:fake-api`、全 workspace build、Chromium/WebKit 双浏览器 E2E）。

lint、typecheck 与 build 经 `turbo --force` 避免 CI 缓存回放；直接使用 `--filter vite-app` 排除根 `pnpm run test` 中的空任务占位，使所有步骤均对应真实测试 runner。保持既有依赖冻结安装、Playwright 两浏览器安装步骤与 working-directory、Node 22 与 pnpm 10.26.0、test-backend 与 ci 聚合 job 成功断言不变。不修改旧授权策略，未触发远端 Actions，不把本地通过视为远端 Linux CI 已通过。

## 2026-11-01 局部接线候选（停在 Review）

本次按已批准方案局部适配项目工具，没有恢复 A85/业务、启动模型/子 Agent/服务、安装
依赖或执行真实 Git 集成。实施验收仍待独立 Review。准确文件/hash、备份与离线退出记录见
`.review/reports/skill-wiring-20261101-68c0632/implementer/r0/`，不覆盖原评估 review-r0。

r1 增量交付位于 `.review/reports/skill-wiring-20261101-53cb562/implementer/r1/`，仍待独立
Review。本地复核 68c0632..53cb562 后固定 shared_head 为
`53cb562160d9a29f0ca560efff765a2c35e98832`；launch_preflight/loop_gate 字节不变，固定
runtime 不升级。r0 文档修改继续保留，r0 历史报告/日志/指针不改写。

稳定入口保持 `<lane> <step>`，从新的 `tools/review-loop-local-wiring/config.json` 和
`tasks.json` 消费评审方独立批准的 manifest/approval。a/b/c 槽位均为 null，默认拒绝
业务动作。旧 `review-loop-launch-baselines.json`、A84 脚本及 runtime 固定快照不改。
不得为适配新 runner 而修改历史 hash/任务、重置账本或自动补当前 Git 指纹。

接新轮次由评审方依次完成：

1. 核 worktree、批准分支/HEAD、文件归属和暂停记录；用户另行恢复业务后才准备业务任务。
2. 在新命名空间建立当轮不可变 manifest，绑定文件级修改/formatter 清单、检查集合、
   通道及报告路径；approval 绑定 manifest 和独立评审依据的 SHA，批准后发布新指针。
   bool `require_clean=false` 须绑定另行批准的 expected_fingerprint，拒绝自动反填。
3. 通道分别生成官方预检清单：native 无 CLI 字段，CLI 保留权限/代理检查。主节点预检
   不能代替实施节点权限验证；受限节点继续由主控代跑，不改报告目录/锁根的权限。
4. 实施停止写入后，formatter/原生生成全部完成；评审最终 diff，另建最终字节批准。
   固定 checks 非零即停，零测试/无效摘要不得作为通过或有效 mutation kill。
   三项生成准备仅允许 api-types-generate、provider-metadata-generate、schema-export 在
   批准文件范围内写入，保留真实非零和其他门禁；只读步骤写入批准文件也仍拒绝。
   命令前持久化输入 approval 消费回执，阻止无变化、失败或中断后复用旧批准；不改批准文件、
   任务指针或反填指纹。评审方审 diff 后另建最终批准，依赖后步/旧冻结才不能越过重批。
5. 经新 `review-stage.py` 在原锁根保护下 freeze，评审方批准 frozen receipt 后再 audit。
   独立 Review APPROVED 仍须真实完整验收；frontend10 + backend5 与59%覆盖率合同不变。
   真实集成将来的动作必须与复核处于同一 `integration_guard`，本轮只有只读 guard 检查
   和临时仓 `integrate-fixture`，不能先查锁再在锁外 commit/ff。

双锁按 canonical worktree 路径排序，继承锁不由子方释放；冲突、未还原 journal、低序
嵌套及异常释放均使用原 `worktree_lock`。原锁根始终为
`/Users/sunpcm/.local/state/review-loop/locks`。锁不能阻止直接编辑，也不代替停写声明；
普通静态分析不新增全面串行。拥有锁者提供有界进程组；可信继承检查保留外层
check_batch/mutate 的超时责任，不修改 bounded_step 或 DB helper。

项目 ev 的三参数仍流式并传播命令非零，`--quiet` 才减少回显；完整双流和真实 `# exit`
均保存。已有路径（含悬空链接）/排他创建失败在命令执行前拒绝，同编号并发只能执行一次，
日志失败不能成功。共享 legacy 的 tee 返回值与本项目兼容行为不同，不能整文件替换。
双模式在原始双流字节后额外追加一个 LF，再写独立末行 # exit=N；已有换行/空输出也会多
一个分隔换行，二进制原始字节保留，逐字节消费方须按此格式核对，历史日志不改写。

后续 prompt/交付报告分列 `execution_mode`、`source_writes_stopped`、`task_processes`、
`known_session_ids`、`evidence_basis`，细则见手册 §5。节点声明、独立观察和真实工具退出
分开；unknown/空 session 列表不代表 OS 无进程，合成失败标记不代替实际 exit。

备份/精确回退见手册 §17.4：先核本轮最终 hash 和归属，再 `cp -p` 恢复目标文件/模式；
旧 pin/指针核原值，新路径仅在仍属本轮时移出活动路径，报告保留。不得 reset/stash 或
覆盖其他会话变化。离线 suite 运行拟交付实际工具，只用临时仓/进程；它不替代15项业务
门禁，不证明真实原生权限或额度收益。共享 skill 若再更新，先审差异再改必要 pin，不能
顺带升级整套 runtime；本次不扩大预算、权限或依赖。
