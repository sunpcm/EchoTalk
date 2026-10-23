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

## A8后续评审规范补强（2026-10-22）

用户授权后，review-loop在Codex与Claude两份checkout同步至本地提交`2dcd162`，未推送。仅更新reviewer-lessons、CHANGELOG、TODO，项目原始问题与证据仍保留在`.review/reports/workflow-parallel-a8/`，维护备份与校验记录在`.review/reports/skill-a8-update/`。

涉及异步恢复时按风险检查：旧请求仍pending即发起新操作、旧请求成功/失败后的清理归属、实际副作用前有效性，以及监听停用期间环境变化后的真实状态同步。独立探针先排除自身等待顺序自锁；变异须证实破坏目标行为，无效/未证实候选保留记录，不计入已杀变异或直接判覆盖缺口。

58项既有工具回归、skill格式与diff检查通过；不等同真实Agent行为验证或净额度收益证明。本次没有产品修改、外部模型调用或新权限，不派发下一开发任务。

## A9 新版skill真实接线试点（2026-10-22）

采用2dcd162、单B线将Web生命周期接入Dashboard只读发现；agy首轮676.84活动秒完成，无独立产品返工，普通fixture/lint失败自行闭环。额度中断后核实原交付及进程退出，未重复派发。355产品/18构建/10独立组件/9浏览器/269后端与2有效变异通过；集成最终门禁见本地completion.json。

本轮记录评审变异日志判据过窄、实施fixture事件顺序、宿主中断恢复，以及评审把文档写入与集成检查交错（input_changed阻断后冻结重跑）。完整原始失败保留`.review/reports/workflow-lifecycle-a9/`，不在产品阶段自动修改全局skill。

外部会话total186849，缓存与思考单列；不折算Codex节省。本轮到小里程碑停止，不推送/部署、不接真实Provider、不解除Cloud门禁。

## A9后续两项小修正：判定与收尾顺序（2026-10-22）

变异结果不按异常类名直接判killed。本轮只读复核脚本位于`.review/reports/workflow-lifecycle-a9/workflow-fix/mutation_review.py`，关联真实退出码、目标失败用例、断言来源与日志hash；正常退出、编译/超时/无关失败、或只有关键字的文本均不能判有效杀死。自动输出保持needs_review，评审仍需确认变异确实破坏不变量、失败对应目标行为；此前独立APPROVED及原始results/log保持不改。旧临时变异入口备份后改为只读复核，防止误在已完成工作树重跑变异。7项离线测试及两份真实日志回放通过，不代表跨版本通用解析。

后续收尾固定顺序：

1. 完成产品、测试、TODO、状态和验收文档；运行必要formatter。报告区可记“待验证”，不能提前写检查已通过。
2. 核对diff、基线与允许范围，完成已获批准的提交；钉住待验HEAD、源码指纹及固定检查manifest。
3. 串行执行集成门禁。此期间禁止在该worktree改源码、文档、运行formatter或做变异；日志/截图只写指定ignored证据区。
4. 如果任何输入改变，本轮证据作废并保留原记录，回到步骤1完成修改后，以新目录重新验证。
5. 成功后只在本地证据区补completion和问题索引，再准备下一分支；若仍需补仓内文档，回到步骤1，不沿用之前的最终绿灯。

这是现有指纹门禁的执行顺序澄清，不新增编排器/权限，不修改产品或全局skill，不启动外部模型/数据库/服务。

## A10显式结束记录试点（2026-10-22）

沿用2dcd162、单B线与Gemini3.8FlashMedium。首轮目录枚举拒绝，r1内部任务日志读取拒绝，均保留原始流/账本，未扩权限或洗掉消费；跳过非必要资源后末次r2正常交付。CLI1.4.4→1.4.5变化触发模型前预检阻断，核对本地参数/10项有限fixture与实际r2原始流后受限接纳，未改全局解析器。

确认来源代际缺口由两项扩展探针发现，与硬编码文案集中返工关闭。最终371产品/18构建/17独立探针/8浏览器（另320px1项）/269后端及2有效变异通过，集成状态见`.review/reports/workflow-end-a10/completion.json`。全部仓内文档完成后才冻结最终HEAD串行验收；不与文档写入交错。

新问题含命令约束未遵守、内部日志访问拒绝、版本漂移、确认意图归属及评审自身一次测试文件名/路径误用，均有原证据。3次模型累计927.13活动秒，最后同会话total501180只计一次；不折算Codex省额。P2文件头注释下轮带修，不增加模型轮次；不启动下一开发或改全局skill。

## A10后续skill优化（2026-10-22）

用户授权后，两份review-loop同步到本地`4b6df27`，未推送。通用变更仅6个文档/模板/测试文件，生产脚本、权限、模型和产品保持；精确文件入口优先、预先绑定检查回执/任务标识/报告根、后台返回后禁止读内部受保护日志或重复派发、版本漂移核验与剩余预算均明确。确认意图来源代际、零测试及探针生成失败、小注释遗留与最终冻结顺序补入评审指南。

60项离线工具回归、格式/skill检查通过；A10三份完整原始流回放分别blocked_permission、blocked_permission、ready_for_review，旧账本/原日志不改。实现已存在的拒绝门禁继续保留，本次不宣称新版本全兼容或Agent必然遵守。维护备份与证据位于`.review/reports/skill-a10-update/`。

下一真实项目控制器应在派发指令中传入本轮nonce绑定的项目回执确切路径，并验证实施方能消费该回执和其绑定summary，而非内部背景任务日志。通用文档新增字段不等同所有旧controller已接入；不因本段自动派发新产品任务。

## 用户执行策略调整（2026-10-22）

用户明确要求暂不设agy超时、保留可配置超时、尝试上限10。当前A11通过正式amend-budget把max_attempts调10、max_active_seconds设null；已用3次/1313.65活动秒及原始拒绝/超时/评审保留，剩余7次。CLI print-timeout=0，controller timeout_seconds=null，耗时仍累计。无进展2次、权限/交付/独立评审及用户取消门禁保持；不是无限自动重试。

本地execution-policy.json保留正数秒数配置路径，日后可重新启用；总时长上限亦可正式amend恢复，必须大于已消费时间。通用skill显式支持关闭/恢复时间门禁，两端同步cd09a3a，其他项目默认策略不变。64项回归和controller实际策略AST四场景验证通过，没有调用外部模型/DB。

ls被拒来自现有精确command/unsandboxed白名单，不是文件不可读；本次不改permissions、不开放通用shell。当前只更新执行策略，未自动启动下一模型尝试。证据/备份见`.review/reports/skill-time-policy/`。

## A11显式恢复最终记录（2026-10-22）

使用最新skill，当前cd09a3a，用户批准10次/不限时策略实际应用；任务共6次累计2552.22活动秒。REC-01同步取消、REC-03组件旧回调、REC-04取消后UI控件锁死均经独立复现和回归关闭。最终403产品/18构建/39私有/10浏览器/2有效变异通过，集成结果见`.review/reports/workflow-recovery-a11/completion.json`。

确定回执传递13个required_reads与nonce绑定pointer/summary/status/log；仍有目录枚举拒绝、一次超时及读取历史报告目录被拒，原始证据和预算不洗掉。最后通过跳过非必要旧报告、只读当前批准证据正常交付，不扩权限。需要观察完整绝对路径、单轮任务规模与局部状态机组合验收，尚不能宣称拒绝消除或净额度收益。

一次同会话最终total1907693只计最后累计值，缓存/思考单列。状态/契约/验证文档先完成并冻结，再串行最终集成；结束后仅证据区补completion。停止下一开发，不自动修改全局skill。
