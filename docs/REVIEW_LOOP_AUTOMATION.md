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
