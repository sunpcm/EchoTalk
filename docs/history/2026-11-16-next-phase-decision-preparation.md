# 下一阶段决策准备（仅文档）

> 日期：2026-11-16；仅决策准备文档，不把用户「开始」当作 B2 五问/隐私/费用/迁移/真实服务已批准。分支
> `codex/next-phase-decisions-20261116`；基线 main `dac4d254`（Overview 已合并 PR195）。

- 新增 `docs/NEXT_PHASE_DECISIONS.md`：现状事实、B2 五问（各给推荐/备选/代价与剩余门禁）、周报推荐口径、真实环境用例/期望/证据矩阵、
  阶段实施顺序与放行条件、集中待用户确认表。每项用「已核事实/技术建议/待用户确认/外部待验」区分。
- NEXT_ACTIONS 纠正 SGEC（PR194 main d33f236）与 Overview（PR195 main dac4d25）已发布事实，并加决策文档入口；TODO 给 B2/阶段C/周报
  相关未完成卡加方案指针（仍 unchecked）；docs/README 加导航。
- 现状按源码复核：learning_events 源码未实现该表、knowledge_states 无历史维度、BKT 四参数 p_init=.1/p_transit=.2/p_slip=.1/p_guess=.2、
  分析当前 demo/synthetic、转录 timestamp_ms 非音频分段、周报仅 rolling7 三项；0 转录 completed 计 1，Top3 已排除 synthetic/demo 且按 started_at 归属。
- 本轮仅文档，作者未运行任何服务/DB/迁移/真实 Provider 操作；父独立三树已通过：Vitest 1270/57、pytest 1068/3 warnings/81.00%/84.7s（命令 97.66s）、E2E 258 expected
  C129/W129、0 skip/unexpected/flaky、max actual retry 0（configured_retries [0,0]），源码前后字节稳定。

- R1 返修：按独立评审补具体推荐与真实环境验收（正向链路/负面用例/证据矩阵），纠正 0 转录计 1、Top3 排除 synthetic/demo 等事实表述，补 SGEC/Overview 完整 7 位 sha 与 PR194 最终 CI 43818985856；未重跑三树，未改 B1/源码/环境。

- R2 返修：retention A 补具体边界候选（删除联动、首期导出默认排除转录原文/音频/供应商原始数据、法定保留与备份复活门禁）；bkt-v1 冻结对象澄清为数值更新语义（posterior/transit 执行顺序），不含 Job 并发调度；§3.2 备选排空仅需维护门控+等待，不引入新状态。

本文件为决策准备收口记录，最终方案与实施需用户逐条确认后另拆工作包。
