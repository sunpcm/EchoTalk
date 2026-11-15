# 周报“已记录会话时长”合同

> 状态：**WD-DESIGN 历史快照 `APPROVED`@`9d3ab32`；WD-API `FINAL_READY`；WD-UI 尚未实施**。
> 用户确认：2026-11-15，选择完整方案 A。
> 设计基线：`codex/B1-learning-events-20261112@caa409a9f36f8e4b28c221800930c1f3ec94cef2`。
> 本文是设计卡 WD-DESIGN 的唯一新增合同；后端聚合、OpenAPI/类型和前端显示分别由后续两张卡实施。

## 1. 指标名称与目标

用户界面统一称“**已记录会话时长**”。它只表示现有 completed 会话的
`ended_at - started_at`，包含连接等待、静音、暂停和其他非说话时段，不能解释为“有效练习时长”、
“有效说话时长”或“练习成功时长”。

首版只使用已有会话时间字段，不新增录音、计时事件、会话状态事件、分析成功判定、依赖、迁移或历史
回填。本指标不因分析任务失败或缺少转录推断练习成功，也不改变现有会话状态生命周期；当前数据不能
可靠区分这些情况。

## 2. 产品口径

- API 继续接受现有合同允许的任意合法 `end_date`，返回截至该日并包含该日的最近七个本地自然日；
  不拒绝历史日期请求，也不宣称任意合法 `end_date` 都包含今天。UI 默认以用户本地今天作为
  `end_date`，因此默认周视图包含今天。
- 时区和窗口复用现有合同：请求携带 IANA 时区，服务端把每个当地午夜转换为 UTC，按七个
  `start <= started_at < end` 的半开窗口归日；支持 23/25 小时日、跳过的自然日和
  `start == end` 的零长度桶。
- 只统计当前认证用户、`status = completed` 的会话。`active` 与 `cancelled` 不计；不信任客户端
  传入的用户身份。
- 会话按 `started_at` 归入开始日。跨本地日或跨 DST 边界的会话把整段时长归开始日，不按午夜或 DST
  切段，也不把一个会话重复计入结束日。
- 单条会话在 UTC 下计算非负整数毫秒，先截去该条不足 1 毫秒的小数部分，再对日桶求和。不能先求整桶
  的总时间差再截取。
- `ended_at` 为空或 `ended_at < started_at` 的 completed 会话不产生时长，计为“不可计算”；
  合法的 `ended_at == started_at` 产生 0 毫秒，是有效零时长。
- 日时长只汇总该桶中可计算的 completed 会话。不可计算会话不会用 0 冒充可计算会话，也不能从
  completed 次数中删除。

## 3. 显式 opt-in 接口增量

复用现有认证只读接口
`GET /api/sessions/weekly-progress?end_date=YYYY-MM-DD&timezone=IANA`，新增布尔查询参数：

```text
include_recorded_duration: bool = false
```

省略或传 `false` 时，服务端必须继续返回与当前合同完全相同的响应：顶层恰为 `{days}`，每个日桶恰为
`{date,start,end,completed_sessions}` 四字段；不得因 schema 扩展额外序列化两个 `null`，也不得读取
`ended_at`。该布尔参数由新客户端显式传 `true` 时才计算时长，并只在七个已有
`WeeklyProgressDay` 中增加以下两个非负整数字段：

| 字段                         | opt-in 新服务语义                                                 | 兼容语义                           |
| ---------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `recorded_duration_ms`       | 该日桶可计算 completed 会话的毫秒和；无可用记录时为数值 0         | 字段缺失或 `null` 表示该桶时长未知 |
| `duration_unavailable_count` | 该日桶因结束缺失或为负而不可计算的 completed 会话数；无会话时为 0 | 字段缺失或 `null` 表示该缺失数未知 |

两个字段在响应 schema 中保持 optional/nullable 以实现单一路由内的能力开关；路由使用
`response_model_exclude_none`，默认响应不出现扩展键。`include_recorded_duration=true` 时，新服务对
每个固定桶都返回两个显式非负整数，不返回 `null`；无会话桶返回 `0/0`。契约约束
`0 <= duration_unavailable_count <= completed_sessions`，且不可计算数与可计算数共同覆盖该桶的
completed 次数。令 `computable_count = completed_sessions - duration_unavailable_count`；
`computable_count == 0` 时 `recorded_duration_ms` 必须为 0，若为正数则响应关系不一致。合法零时长
对应 `computable_count > 0` 且 `recorded_duration_ms == 0`。该 exclude-none 只适用于本路由，不放宽
其他响应。

现有顶层 `days`、七桶顺序、`date/start/end/completed_sessions`、计数图数据和历史分页不变。不增加
重复的顶层周总字段；周总只能由客户端对七个桶中的 `recorded_duration_ms` 严格相加，避免同一事实出现
两个服务端来源。

当前 `parseWeeklyProgressResponse` 原本要求日桶恰四字段并丢弃扩展；WD-API 必须把它扩展为：

- 顶层仍只允许 `days`，四个基础字段仍按现有严格归属、时间戳、安全非负整数和零长度窗口规则校验；
- 日桶允许四个基础键以及明确白名单内的两个扩展键，其他未知键继续整体拒绝；
- 有效扩展值需要保留在解析结果中；扩展键缺失、`null`、类型或安全整数非法时只把该扩展降级为
  未知，不破坏基础四字段，也绝不补成 0；
- WD-API 只扩展 parser 和测试能力，尚不修改 `getWeeklyProgress` 的请求参数。

parser 可以独立保留任一合法扩展值；显示层不能只凭 `recorded_duration_ms` 合法就判定完整。UI 必须
同时取得可信的两个扩展值、满足 `unavailable <= completed` 与可计算会话数关系，才能显示该桶时长。
任一扩展降级为未知只影响时长完整性，不破坏已严格校验的 completed 次数。

旧服务端忽略新增 query 参数并返回原四字段，WD-UI 的新客户端必须降级显示未知。旧响应没有新字段时，
客户端不能用 history 分页或 completed 次数推算时长：history 可能分页，且不包含完整会话时长数据。
旧 API 字段为 `null` 时同样按未知处理。

## 4. 后端查询约束

默认路径保持当前 `query_weekly_progress` 的 count-only 单次有界 SELECT 和响应四字段，沿用当前用户、
completed 状态和整周 UTC 半开窗口条件。现有默认 SQL 测试对 `ended_at` 的禁用断言必须保留，不能为
接受新能力而放宽。

只有 `include_recorded_duration=true` 才扩展现有单次有界聚合并读取 `ended_at`。对每个日桶同时聚合：

```text
completed_sessions
recorded_duration_ms =
  sum(floor(UTC毫秒差(ended_at - started_at)))
  只覆盖 ended_at is not null and ended_at >= started_at 的记录
duration_unavailable_count =
  count(ended_at is null or ended_at < started_at)
```

opt-in 服务端实现必须让负值或缺失结束的会话只进入不可计算计数，绝不进入毫秒和。SQL 只读取
`sessions.user_id/status/started_at/ended_at` 和聚合结果；不加载 ORM 实体、转录、正文或分析记录，
不 join，不写库，不逐会话读取，也不新增七次日查询。七个桶仍由一次 SELECT 返回。默认路径与 opt-in
路径各保持一次查询，不引入查询缓存、额外框架或请求扇出。

OpenAPI schema 和前端生成类型由 WD-API 在有效 RED 后按现有原生生成流程更新。不得手改
`backend/openapi.json` 或 `apps/vite-app/src/lib/api.generated.ts`。

## 5. 前端状态与校验

前端沿用现有 WeeklyProgress controller、认证 revision、生命周期、午夜/时区刷新、选择日期和历史
分页。新增显示必须使用已经提交的同一个 weekly response；仅为格式化或切换已有桶的时长不得新增
weekly/history 请求。

WD-API 阶段先让 parser 能接受并保留白名单扩展，但 `getWeeklyProgress` 仍不发送新参数。WD-UI 阶段
才让 `getWeeklyProgress` 固定设置 `include_recorded_duration=true`；不改变 query key/cache、生命周期、
请求次数或历史分页策略。旧服务忽略未知参数并返回四字段时，新客户端降级到未知态。

每个时长先做严格检查：

- `recorded_duration_ms` 与 `duration_unavailable_count` 都必须存在且为
  `Number.isSafeInteger(value) && value >= 0`；只有时长字段合法、缺失计数未知时，该桶时长仍为未知；
- `duration_unavailable_count <= completed_sessions`；
- `computable_count = completed_sessions - duration_unavailable_count`；当
  `computable_count == 0` 时，`recorded_duration_ms` 必须为 0；`computable_count > 0` 时，
  `recorded_duration_ms == 0` 是合法零时长，`> 0` 是合法正时长；
- 七个桶求和以及整秒格式化的中间值必须保持 JavaScript 安全整数；
- 只有两个扩展字段都有效、各自安全且桶内关系完整一致时，该桶时长才可显示。超出安全整数、字段
  类型错误、字段不完整或关系非法时降为“未知”。

不得用 `Math.min`/`max` 静默夹断，不得用 `Number(...)` 把字符串等非法值强制转数，不得用 0 替代
未知。单个桶未知不会使已有 completed 次数失效，只使对应桶的时长显示为未知。

周总规则：

- 只有七个桶的两个扩展值都存在、各自有效、桶内可计算会话数关系完整一致，且七项时长之和为安全
  整数时，周总才可显示；
- 任意一个桶缺少任一扩展信息、任一字段非法或桶内关系不一致时，周总整体显示未知，不能把剩余已知
  桶之和包装成完整周总；
- 独立可用的不可计算计数必须同时提示。若七个计数都可验证，可显示准确总数；若仅部分计数可用，
  只可显示明确标注为“已知”的子计数并说明明细不完整，不能把子计数冒充完整总数。
- 选中日只读取所选的同一个日桶，不重新计算其他日期，不发起额外请求。

状态必须区分：

| 状态                                                   | 显示语义                                           |
| ------------------------------------------------------ | -------------------------------------------------- |
| 无会话：`completed = 0`、两个扩展为 `0/0`              | `已记录会话时长 0 秒`（`computable_count = 0`）    |
| 有 completed 会话且 `computable_count > 0`、时长恰为 0 | `已记录会话时长 0 秒`                              |
| 部分会话可计算                                         | 显示已知时长，并提示“另有 N 条不可计算”            |
| 有 completed 会话但 `computable_count = 0`、时长为 0   | 显示“暂无可用时长”，同时提示不可计算数量，不显示 0 |
| 任一扩展缺失、`null`、非法或桶内关系不一致             | 显示时长未知，不夹断、不静默改写为 0               |

显示可以使用整秒格式，但 `0 < recorded_duration_ms < 1000` 必须显示“不到1秒”，不能显示 0 秒；
精确 0 才显示“0秒”。累计达到或超过 24 小时时必须继续显示完整天数/小时数，不得按 24 小时回绕。
无障碍名称和窄屏布局必须保留“已记录会话时长”的限定语义，不出现“有效说话”或“成功练习”等误称。

## 6. 三张实施卡

### WD-DESIGN：本设计卡

- 状态：原时点为设计合同 `FINAL_READY`、待主控独立 Review；随后独立 Review `APPROVED` 并随
  `9d3ab32` 推送。本节作为历史快照保留，不是 API/UI 实施完成。
- 交付：本文及 `TODO.md`、`docs/PROJECT_STATUS.md`、`docs/history/todo-done.md` 的状态说明。
- 验收：产品口径、兼容策略、查询边界、前端未知/缺失语义和三卡测试范围无冲突；实施节点不运行
  测试、服务或数据库检查。

### WD-API：后端聚合与兼容契约

当前状态为 `FINAL_READY`。实现锚点为 `backend/schemas/session.py` 的两个 optional/nullable
字段、`backend/services/session_queries.py` 的显式 opt-in 单次有界聚合、
`backend/routers/sessions.py` 的本路由 flag/`exclude_none`，以及
`apps/vite-app/src/lib/api.ts` 的 weekly parser 白名单扩展。主控已原生生成 OpenAPI/types，
最终 13 项机器门禁全部 `exit 0`；R1 首轮 TS `unknown` 收窄问题通过 const 原始值捕获修正，
随后 quality、完整 Vitest 与全量 E2E 均复跑通过。正式返修 `1/2`、TDD 中间修正 `1`，
详细数字、负向变异、AST/保护和编排诊断只集中在
[PROJECT_STATUS 的 WD-API 小节](./PROJECT_STATUS.md#wd-api-周报已记录会话时长opt-in-聚合与兼容解析final_readyui-未实施)。
本阶段 `getWeeklyProgress` 仍不发送 flag，WD-UI 尚未实施。

本卡已按“真实合成 PostgreSQL RED → opt-in 聚合/schema/生成类型/parser 兼容扩展 → 完整门禁”
的顺序完成。实施节点仍不把主控实跑写成自身验证；最终格式、Review、正常 commit/当前分支 push
以主控同卡回执为准，用户 Review 待。

至少覆盖：

- 当前用户隔离、其他账号不计；active/cancelled 不计，completed 次数旧语义不变；
- 固定七桶、无会话零桶、合法零时长；
- ended 缺失与负值只进入不可计算计数，不伪 0；
- `computable_count = completed_sessions - duration_unavailable_count`；有 completed 会话但全部不可
  计算时必须为 0 时长并显示“暂无可用时长”，`computable_count > 0` 且时长为 0 时显示合法 0 秒；
  `computable_count == 0` 与正时长同时出现时按关系不一致处理；
- 每条会话先截去不足 1 毫秒，再加总；跨日、DST、整周前后界和半开窗口；
- 默认 omit/false 响应保持顶层恰 `days`、每日恰四字段，且既有 count-only SQL 测试继续禁止
  `ended_at`；opt-in 七桶计数、时长与不可计算计数来自一次有界 SELECT，无实体/正文读取、join 或
  额外七次查询，并以新增 PG 断言证明实际读取 `ended_at`；
- opt-in 的每个桶始终给出两个非负数值；parser 保留白名单扩展，未知 key 仍拒绝，扩展缺失/null/
  非法时仅降级未知；WD-API 的 `getWeeklyProgress` 尚不请求该能力。

以上验收目标最终均由主控机器回执覆盖；产品、测试与生成文件已停写，时长父项仍因 WD-UI 未实施
而保持未勾。本批合成 PG 继续活动供 WD-UI 使用，尚未清理。

### WD-UI：前端显示与真实浏览器

先补有效 RED，再让前端固定请求 `include_recorded_duration=true`，完成周总、选中日、缺失提示和
旧 API 未知态。主控统一运行现有质量门禁与真实 Chromium + WebKit 用例；不得修改或放宽既有计数、
认证、刷新、分页或 query/cache 断言。

至少覆盖：

- 旧 API 缺字段/null；部分桶缺失与全部桶缺失；
- 七桶全部有效时的精确总和；任一桶未知时周总未知，同时保留已知缺失计数提示；
- 两个扩展同时可信、安全非负整数、`unavailable <= completed`、可计算会话数关系、安全整数溢出和
  不夹断；任一桶缺少扩展信息或关系不完整时周总未知；
- 合法 0、全部不可计算、`0 < ms < 1000` 与至少 24 小时不回绕；
- 选中日只显示所选桶；切日、认证 revision、生命周期刷新和旧响应隔离沿用现有 controller；
- 请求固定包含 opt-in 参数但不增加查询次数；旧服务忽略参数返回四字段时必须降级未知。新增时长
  显示不额外重请求既有 weekly/history 数据；宽屏与窄屏布局可用且标签不误导。

## 7. 非目标与停止边界

本指标及三卡不新增采音、计时事件、分析状态事件或依赖，不新增数据库实体/列/迁移，不回填历史数据；
不修改 BKT、learning events、通话占用、分析任务、认证、分页或会话次数图。真实 Provider、LiveKit、
语音质量、设备与生产数据不在验收范围。

时长父项在 WD-API 与 WD-UI 均完成并通过主控门禁前保持未勾；整个周报、三端交付和真实学习质量
也不因本设计合同完成而勾选。Review、commit 与 push 由主控按同卡回执处理，实施节点不自批
APPROVED。
