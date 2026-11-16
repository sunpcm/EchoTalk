# B2 干净起步决策与实施计划评审输入

> 日期：2026-11-16。评审范围：开发期 B2 决策在本轮文档中的一致性，以及
> [B2 实施计划](../B2_IMPLEMENTATION_PLAN.md) 的可执行门禁。用户已经确认相关决策，评审者不应再把它
> 写成“等待用户批准”的候选；正式数据政策、实际迁移执行与测试环境放行仍另需用户决定。

## 1. 本轮材料

本轮完整基线为 `da37683e6579e479f0ab46315555b24c850360da`（PR196）。分支
`codex/b2-clean-start-decisions-20261116` 的最终提交与 source/tree 由交付回执确定；本文不自引用
尚未生成或尚未核验的提交。本轮只修改下列 8 个 Markdown 文件：

1. `TODO.md`
2. `docs/LEARNING_EVENTS_DESIGN.md`
3. `docs/NEXT_PHASE_DECISIONS.md`
4. `docs/B2_IMPLEMENTATION_PLAN.md`
5. `docs/NEXT_ACTIONS.md`
6. `docs/README.md`
7. `docs/history/2026-11-16-b2-clean-start-decision.md`
8. `docs/reviews/2026-11-16-b2-clean-start-review-input.md`（本文）

产品源码、测试和迁移文件未修改；用于事实核验的源码以只读 Git 对象和当前源码为来源。实际数据清理、
Alembic 执行、PG 新表验证、部署、环境创建和真实服务访问均未执行。

Harness 在 macOS 亲跑本轮基线的三树（命令均 exit 0）：Vite Vitest 1270 passed/57 files，命令
21.37s；backend pytest 1068 passed/3 warnings/81.00%，pytest 92.82s、命令 107.47s；Playwright
E2E 258 passed，Chromium/WebKit 各 129，原生 114261.212ms、命令 116.54s。实际
retry/skip/flaky/unexpected 均为 0，配置重试为 0，三树均 exit 0，源码前后字节稳定。仅 backend
pytest 使用原专用 PG 15.19 并核身份；Vitest 不使用 PG，E2E 使用 Fake API。上述是基线回归结果，
不表示 B2 新表、迁移或数据库写入验证通过。命令可从交付回执及 Harness 日志核对；本地的实施报告
只能作为可选内部索引，云端评审不依赖它。评审应同时对照：

- [学习事件设计](../LEARNING_EVENTS_DESIGN.md) 的顶部边界、§6/§7/§9。
- [下一阶段决策](../NEXT_PHASE_DECISIONS.md) 的 §3/§4/§6/§7。
- 根目录 [TODO](../../TODO.md)、[下一步行动](../NEXT_ACTIONS.md)、[文档导航](../README.md)。
- [实施计划](../B2_IMPLEMENTATION_PLAN.md) 与 [决策记录](../history/2026-11-16-b2-clean-start-decision.md)。

本轮先冻结的 R0 独立 Review 判定为 CHANGES REQUESTED，未改变已批准的 PR190–196 结果或 B1 设计
§1–5、§8 草案字节。R1 只修正本决策文档包的文字、公开评审材料和逐包门禁，不扩大产品范围。
历史背景参看 [PR196](https://github.com/sunpcm/EchoTalk/pull/196) 和
[PR195](https://github.com/sunpcm/EchoTalk/pull/195)；不把它们或旧 B1 材料当作 B2 实现结果。

R0 文档阶段由实施作者在 Node 22 下首次执行 8 个 Markdown 的 Prettier `--check`，exit 1，
报告 `docs/NEXT_PHASE_DECISIONS.md`、`docs/B2_IMPLEMENTATION_PLAN.md` 两文件存在格式问题。
修复时直接调用本地 Prettier `--write` 处理这两个文件，没有经由验收包装入口执行修复；随后以**新证据 ID**
对同一 8 路径重放 `--check`，exit 0、全部使用 Prettier 格式。首次失败和重放均非 Harness 的正式
R1/R2 返修轮，不从失败退出码推断内容没写盘；此次补记只保证公开可审，R0 的原始证据仍作内部索引。

## 2. 请判定的政策一致性

1. 开发期旧测试数据与 Job 可丢弃，从 `p_init=.1` 干净起步；不建旧知识状态基线、不承接旧 Job、不回填历史。
2. 必要的课程/技能种子和结构保留；保留策略只适用于开发数据，正式用户政策上线前另定。
   旧时点基线和旧 Job 切后处理仅保留为“原推荐/未来备选”，不能按它们实施当前开发期。
3. 不开放重新分析；`bkt-v1` 冻结四参数与 posterior/transit 数值语义，Job 并发不在冻结范围。
4. 会话经过时长和同技能百分点环比的口径已确认，但对应指标没有因此被写成已实现。
5. 阶段 C 仅获授权先出资源费用方案，没有冒充费用方案已交付或预算、账号和基础环境已获准。

## 3. 请判定的计划质量

计划是否把表结构/迁移文件、同事务写入、只读一致快照重算拆成可逐包评审的范围；是否明确旧候选
`46ef95494b23c3dcdc05a0ddbc18f03856c2462e`、共同基线 `80c57a4a780387d2fdada120697509ba5c620852` 与
`main` 的 39/44 分叉事实，以及旧候选不是可直接承接的实现。

计划是否要求每个代码修改或测试工作包均跑 Vite Vitest、Playwright E2E、backend pytest 三树；
未跑某树时明确原因并保留门禁未通过。P0 纯只读审计若未改产品或测试，也须说明未跑原因；不能以
局部 pytest、“测试零改动”、旧候选结果或基线三树代替未来的包验证。P1–P3 可完成获准的离线代码
准备，但新表 PG/数据库验证未放行时不得标完整验收或合 main；不能跨包提前通过绕门禁。

还需检查契约负例、有效变异和首失败保留。相关验证的实际入口及环境须由包回执提供；数据库变异和
新表集成只可在获批专用的环境执行。实施者不得通过 skip、`create_all`、旧候选回执或前端测试
代替 backend、数据库门禁。正式数据策略或产品契约发生变化时，实施应停下等待裁定。

## 4. 明确不纳入本次评审扩展

PR190–196 的已发布结果、旧 B1 候选的冻结记录和原始材料不因本轮重开；只评审新政策在八个路径中的
一致性和 B2 计划。旧集成现场的冲突、旧候选的 goals/导出/删除等相邻能力，不在本实现文档包内修复。
正式 retention、删除/导出政策和测试迁移/数据库执行仍须另行放行。
