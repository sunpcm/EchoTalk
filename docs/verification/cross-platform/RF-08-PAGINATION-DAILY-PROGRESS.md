# RF-08 会话游标分页与每日聚合验证记录

> 对应待办：[TODO.md](../../../TODO.md) RF-08 迁移与时间语义。  
> 本次范围：后端 GET `/api/sessions` 与 `/api/sessions/active` keyset 游标分页与成对时间窗口校验、新增 GET `/api/sessions/daily-progress` 单次服务端聚合、前端 API 客户端契约校验、ActiveSessions 与 DailyProgress 组件显式“加载更多”及本地自然日窗口适配、Fake API 契约与 E2E 回归。

---

## 1. 背景与方案契约

- **契约决策**：落实用户已裁定的组合方案，替代原全量数组旧接口契约：
  - `GET /api/sessions` 与 `GET /api/sessions/active` 统一返回 `{ items: SessionListItem[], next_cursor: string | null }`，默认 limit=50，范围 1..100。
  - 基于 `(started_at DESC, id DESC)` 稳定 keyset 排序，取 `limit + 1` 计算下一页游标，不使用低效 OFFSET。
  - 后端分页查询严格仅 SELECT 5 个必要列（`id`, `mode`, `status`, `started_at`, `ended_at`），杜绝 ORM `selectin` 级联触发 `transcripts/context/analysis_job` 关联查询与文档/转录正文拉取；单页查询严格单条 SQL。
  - 游标采用标准库 canonical URL-safe base64 编码的版本化 JSON，长度严格 `<= 1024` 字节；严格要求 `v=1` 为整数且排除 bool/float；严格绑定 endpoint、当前用户、status 及时间窗口筛选上下文进行绝对比对（自包含无状态校验，非 HMAC 签名凭证，不提供抗恶意改写完整性保证）；格式非法、超长或上下文不匹配统一返回 422 安全错误。
  - 新增静态 `GET /api/sessions/daily-progress`，严格定义在动态 `/api/sessions/{session_id}` 之前；单次服务端 SQL 聚合当前用户指定自然日窗口内 completed 状态会话数及全部角色 transcript 条数，0 条转录仍计会话，零正文拉取、零 N+1。
  - 前端 `DailyProgress` 不再逐会话 `getSessionDetail`；通过 `localDayWindow.ts` 计算浏览器本地自然日（00:00:00 至次日 00:00:00）转 UTC，严格兼容 23/25 小时 DST；跨午夜或刷新时清空旧日数据与统计，刷新失败提供安全 `role="alert"` 与满足 `>=44px` 触控目标的重试按钮。
  - 列表显式“加载更多”，按 ID 去重并保留结束门禁；`suspend`/`offline` 挂起生命周期同步作废在途分页请求并释放槽位；`ActiveSessions` 在结束或恢复在途时与加载更多互锁，杜绝旧页复活已结束会话或污染新操作。
  - Fake API 严格对齐后端契约（limit 范围与整型、status 白名单、半开时间窗、绝对时间戳比对、游标严格上下文校验）。

---

## 2. 接口设计与安全游标契约

### 2.1 API 契约定义

| 接口路径                       | 方法 | 参数                                                                                  | 响应结构                                                    | 行为与边界说明                                              |
| :----------------------------- | :--- | :------------------------------------------------------------------------------------ | :---------------------------------------------------------- | :---------------------------------------------------------- |
| `/api/sessions`                | GET  | `status` (可选), `start`/`end` (成对可选), `limit` (1..100, 默认 50), `cursor` (可选) | `{ items: SessionListItem[], next_cursor: string \| null }` | 历史会话 keyset 分页，支持状态与时间窗口过滤，5 列必要字段  |
| `/api/sessions/active`         | GET  | `start`/`end` (成对可选), `limit` (1..100, 默认 50), `cursor` (可选)                  | `{ items: SessionListItem[], next_cursor: string \| null }` | 活跃会话 keyset 分页，强制 `status=active`，5 列必要字段    |
| `/api/sessions/daily-progress` | GET  | `start`, `end` (必填成对时间窗口)                                                     | `{ completed_sessions: int, total_turns: int }`             | 单次服务端聚合，仅统计 `completed`，半开区间 `[start, end)` |

### 2.2 游标安全机制

- **编码载荷**：`{"v": 1, "u": "<user_id>", "ep": "<endpoint>", "st": "<status>", "s": "<start>", "e": "<end>", "t": "<started_at_iso>", "id": "<session_id>"}`
- **安全验证**：
  - 字符集严格白名单：正则校验 URL-safe base64 字符集 `^[A-Za-z0-9_-]+={0,2}$`，拒绝包含 `!` 等非法字符；
  - 载荷严格校验：严格包含 8 个必需键，版本号 `type(v) is int and not isinstance(v, bool) and v == 1`（排除 `True`/`1.0`）；
  - 跨用户复用拒绝（校验 `u == current_user.id`）；
  - 跨端点复用拒绝（校验 `ep == endpoint`）；
  - 跨筛选上下文复用拒绝（校验 `st`, `s`, `e` 与当前 query 一致）；
  - 时间戳时区要求：`started_at` 必须带有显式时区（不进行 naive 强转）；
  - 坏游标、非 base64、非 JSON、超长（>1024 字节）统一返回 422 安全错误，不回显 raw cursor 或异常回溯；
  - 游标不是授权凭证，所有数据库查询始终强制 `Session.user_id == current_user.id`。

---

## 3. 实施与修复清单

### 3.1 后端实施与修复 (P1-01 / P2-06)

- **`backend/services/session_queries.py`**：
  - `paginate_sessions`：严格仅查询 `(Session.id, Session.mode, Session.status, Session.started_at, Session.ended_at)` 5 列，彻底消除 `selectin` 级联子查询与转录/正文拉取。
  - `decode_cursor`：canonical URL-safe base64 正则校验、8 键必需性、整数版本 `type(v) is int and not isinstance(v, bool)` 校验、时区与 UUID 格式校验。
  - `encode_cursor`：严格校验输入时间必须带有明确时区。
- **`backend/tests/test_session_pagination.py`**：
  - 新增 `test_pagination_sql_query_count_and_column_isolation`：利用 SQLAlchemy event 监听捕获 SQL，验证每页单条 SQL、0 正文查询，且 `daily-progress` 也是单条聚合 SQL。
  - 扩展 `test_pagination_corrupted_cursor_safety`：覆盖 `v=True`, `v=1.0`, `token!!`, naive datetime 等非法游标均返回 422。

### 3.2 前端与 Fake API 实施与修复 (P1-02 / P1-03 / P1-04 / P1-05)

- **`apps/vite-app/src/components/learning/DailyProgress.tsx`**：
  - 窗口变更时立即清空 `stats` 与 `sessions`，自然日计算与网络发包解耦；跨午夜即使离线亦清空昨日数据且不发网络，杜绝昨日数据残留或误显为今日。
  - 午夜定时器安排与窗口变化彻底解耦，不进行 24h 硬夹值，支持 25h/23h/24h 本地自然日及 StrictMode 双挂载重建。
  - 离线或切后台挂起时同步作废在途分页请求并清空游标状态，使“加载更多”按钮即时隐藏。
  - 首屏与分页追加实施单页内与跨页严格 ID 去重。
  - 刷新失败展示 `role="alert"` 错误提示及 `>=44px` 触控面积的重试按钮。
- **`apps/vite-app/src/components/conversation/ActiveSessions.tsx`**：
  - `confirmResumeSession`、`confirmEndSession` 与挂起生命周期中，同步作废在途加载更多请求、清空游标并释放槽位，杜绝旧页复活已结束会话。
  - 首屏与分页追加实施单页内与跨页严格 ID 去重。
- **`apps/vite-app/src/lib/localDayWindow.test.ts`**：
  - 补充独立子进程真实时区运行验证：`America/New_York` 春季夏令时切换日（2026-03-08）为 23h、秋季冬令时切换日（2026-11-01）为 25h、`Asia/Singapore` 严格 24h。
- **`apps/vite-app/e2e/fake-api.mjs`** 与 **`scripts/fake-api-test.mjs`**：
  - 严格校验 limit、status 白名单、成对 timezone-aware 半开窗口、跨度 <=48h，按绝对数值比对时间戳（兼容等价 offset）；游标按 8 键、整数版本与上下文严格校验（含 user 校验与标准 RFC 4122 UUID 校验）。
  - 使用独立 Fake 子进程，完整多页 keyset 遍历核对所有 ID 唯一且不遗漏，并使用等价 UTC 与 +08:00 窗口精确断言 2 个零转录 completed 会话（2/0）聚合结果一致（pass 61）。
- **`DailyProgress.test.tsx`** 与 **`ActiveSessions.test.tsx`**：
  - 补充 25h（纽约 2026-11-01 拆两段 clock 推进）、23h、24h 自然日午夜定时器与 StrictMode 双挂载回归；
  - 补充 more 分支换号、同账号 revision 变动、恢复新 more 在途时旧 finally 结算隔离、错误同 cursor 显式重试及双击去重等有序 deferred 回归。

---

## 4. 验证结论

- **后端测试**：303 项 pytest 全部通过（耗时 15.50s，覆盖率 74.48% >= 59.0% 门禁），Ruff 格式与 lint 检查 0 错误。
- **前端单测**：Vitest 27 个测试文件、743 项测试全部通过（耗时 4.69s）。
- **Fake API 测试**：61 项原生子进程契约测试全部通过（pass 61, fail 0）。
- **未验边界**：本地测试库及 Fake API 回归不代表真实外部 IdP、生产数据库长事务锁等待或真机环境。整项在 `TODO.md` 中保持未勾选，RF-08 持续推进。
