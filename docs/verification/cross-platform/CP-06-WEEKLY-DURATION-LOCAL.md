# CP-06 周报时长真实本地组合验证

## 状态与范围

- 当前状态：`FINAL_READY`。本机浏览器→真实 HTTP→FastAPI→真实 SQLAlchemy/asyncpg→自有合成 PG
  →现有 UI 的组合子范围已完成；完整机器计数与资源回执集中在
  [PROJECT_STATUS](../../PROJECT_STATUS.md#wdi-周报时长真实本地组合补验final_ready)。
- 本卡只补浏览器 → 真实 HTTP → 本地 FastAPI → 真实 SQLAlchemy/asyncpg → 自有 PostgreSQL →
  现有 parser/controller/UI 的组合缺口，不修改产品业务、默认 E2E、迁移或依赖锁。
- 产品路径为真实默认入口中的 `Dashboard`、`WeeklyProgress`、现有 data query、`api.ts`、
  `backend/main.py` 的 `app`/lifespan、生产 `get_db` 与 dev 认证。不覆盖认证依赖，不使用
  ASGITransport、stdio、Fake HTTP、`route.fulfill` 或伪造后端响应。
- 本子项完成不勾 CP-06 父项；Linux CI、真实 IdP/LiveKit、设备、生产、真实学习质量与完整周报
  父项继续未验收。

## 运行入口与隔离

- 从仓库根目录的显式命令入口：
  `pnpm --filter vite-app test:weekly-duration-local --retries=0 --workers=1`。
- 环境开关：命令固定设置 `ECHOTALK_WDI_LOCAL_PG=1`；主控在进程外注入
  `DATABASE_URL`，其目标必须精确为 `127.0.0.1:55433`、数据库与用户均为
  `echotalk_b1_test`。运行前须自建专用 PG 并完成迁移；该入口不负责起停 PG。缺少 URL、目标不符、
  密码为空或查询参数多余时 fail-closed。
- API 仅监听 `127.0.0.1:18183`，前端 HTTPS 仅监听 `127.0.0.1:4175`。两者端口被占用时启动
  失败，不复用、不终止占用者。
- Chromium 与 WebKit 各运行 2 个场景，共 4 个结果。WebKit 沿用仓库既有 launcher，不安装新浏览器。
- 前端使用专用 `weekly-duration.local.vite.config.ts`：显式指定 `envDir: false`，不导入旧
  `vite.config.ts` 的 `loadEnv` 路径，同时保留 HTTPS、React plugin、`@` alias 与 `/api` 代理。
- runner 执行现有 `node_modules/.bin/vite` 标准 shim，使已缓存 PostCSS 插件按 pnpm 预期解析；
  dotenv preload 通过精简合成 `NODE_OPTIONS=--require=<guard>` 传入，shim 最终 `exec node` 保持
  自有直接子 PID。不安装依赖、不手写版本化 `.pnpm` 路径、不修改 PostCSS/样式。
- API 子进程与前端子进程在测试结束或启动失败时均按自身 PID 收束。fixture cleanup 独立于进程
  退出执行；任何清理失败保留临时 state 并返回非零，不用无 state 的 `seeded=false` 路径丢弃现场。
- 测试 API 进程在真实产品 app 外包一层最小 ASGI envelope。它只放行本卡 Dashboard 所需的 11 个
  GET 路径；产品 lifespan 原样透传，其他方法在进入产品路由前返回 `405`，未知 GET 返回 `403`，
  WebSocket 直接关闭。该拒绝不依赖浏览器 `page.route`，APIRequestContext 调用同样受限；产品 app、
  路由、认证与依赖覆盖不变。

## 安全边界

- API 进程只允许出站连接 `127.0.0.1:55433`；其他 TCP、DNS、非 PG `sendto` 均硬拒绝。
- Python 进程对 `.env*` 的真实打开读取硬拒绝；Pydantic BaseSettings 被隔离为仅使用 init/env
  source。Vite 的 `.env*` 探测按“不存在”处理，任何实际读取仍拒绝，真实 `.env` 内容不会被加载。
- 浏览器只允许自身 HTTPS origin 的页面资源、必要真实只读 API GET 与 `/api` 代理。外部 origin、
  媒体路径、业务写、会话详情动态 GET、token/end/dispatch/claim/heartbeat/release 等均 abort；
  不允许用网络拦截隐藏 weekly flag、认证或历史窗口错误。
- 正常 Dashboard 读取的真实路由白名单包括 `/api/health`、`/api/health/ready`、
  `/api/user/settings`、knowledge states/skills、weekly grammar、curriculum next、active sessions、
  daily progress、sessions 与 weekly progress。若产品新增其他正常读取，`capture.blocked=[]`
  会明确失败并要求评审重新确认，而不是静默伪造。
- 浏览器场景固定到约定历史本地日期，使用同一合成 dev token 与 `Asia/Singapore`。token 由 runner
  随机生成，Fernet key、key version 与临时目录也仅为本进程合成；不读取真实 runtime、
  reviewer-probes 或主控预检原 token。

## 冻结合成数据

fixture 按 `urn:echotalk:dev` / `local-developer` 查找预检 dev 用户；存在时复用，不存在时允许以
固定 dev ID 初始化。仅当本卡新创建 dev 用户时才创建 settings/profile。另建固定合成他人用户，
全部会话使用 marker `wdi-local-weekly-duration-20261116`，并在 finally cleanup 中只删除本卡
创建的会话、他人用户及必要时新建的 profile/settings。

| 本地日期   | completed | recorded_duration_ms | unavailable | 说明                                                      |
| ---------- | --------: | -------------------: | ----------: | --------------------------------------------------------- |
| 2026-10-28 |         3 |                  999 |           0 | 3 × 333666µs；逐条 floor 为 999，错误汇总后 floor 为 1000 |
| 2026-10-29 |         1 |                61500 |           0 | 1 分 1.5 秒                                               |
| 2026-10-30 |         1 |                    0 |           0 | 合法零时长                                                |
| 2026-10-31 |         0 |                    0 |           0 | active 与 other-user completed 均排除                     |
| 2026-11-01 |         2 |                    0 |           2 | missing-end 与 negative-end                               |
| 2026-11-02 |         1 |              3600000 |           0 | 整小时                                                    |
| 2026-11-03 |         0 |                    0 |           0 | 默认选中日，真实 UI 空态                                  |

冻结 session ID 为 `c0600000-0000-4000-8000-000000000001` 至
`c0600000-0000-4000-8000-000000000010`。其中 1–3 为逐条 floor 向量、4 为分钟向量、5 为合法零、
6–7 为不可计算、8 为整小时、9 为当前用户 active、10 为他人 completed。

独立 oracle 固定周总为 `3,662,499ms`，UI 显示“1小时1分2秒”，不可计算计数为 `2`。这些常量由
fixture 输入独立推导并冻结，不从 HTTP 响应或服务端计算动态生成。

## 组合场景

1. 真实 opt-in 主场景：断言七日七桶与两个扩展字段、逐条 floor、合法零、11-01 选中日两条均
   不可计算、周总值；默认零日只检查 UI 空态、DOM 无历史项和“无更多”，不假设产品会为该窗口
   额外发送 history HTTP。
   正数日点击后只按 `/api/sessions` 路径捕获本次 `Request`，再由同一 `Request.response()` 校验
   状态、`completed/50/start/end` 与无初始 cursor，并同时核对真实 HTTP IDs 与 DOM listitem IDs。
   10-31 排除日和 11-03 零日通过同源真实 GET 携带捕获 Bearer 独立验证窗口为空，不把未发生的
   浏览器请求冒充实跑。
2. 真实兼容场景：现有 UI 仍发 opt-in 请求；同源真实 HTTP 分别以省略 flag 与 `false` 请求，
   断言默认四字段兼容载荷；无 Bearer 请求断言 `401` 与 `WWW-Authenticate: Bearer`。

每个场景最终均断言 `capture.blocked=[]` 与 `pageErrors=[]`，并断言无业务写、无 token/end/dispatch
等禁用调用。既有 Fake/Vitest 已覆盖布局、parser 兼容和未知字段；本卡不重复堆同类用例。

## 分页边界

本次没有新增大于 50 条的真实 PG 分页场景，也不宣称本卡验证了 50+5 分页。历史分页继续复用既有
controller、backend 与 Fake API 覆盖；本卡只验证所选日首次 50 条窗口的真实 HTTP 与 UI 消费。

## 最终验证与交接

主控最终机器门禁、默认 E2E 与新增真实 HTTP+PG 的分别计账、两项语义变异、Python/Node 隔离
guard、服务端 `POST/PUT`/unsafe GET/无认证负对照、快速连续启动及格式等价证据，统一见
[PROJECT_STATUS 的 WDI 小节](../../PROJECT_STATUS.md#wdi-周报时长真实本地组合补验final_ready)。
完整 backend 套件包含既有单元、mock 与 PostgreSQL 测试，不因包含 PG 用例而把整树描述为无 mock；
新增真实链路只属于本卡显式 opt-in 入口。

正式 harness 返修最终 `2/2`，产品业务返修 `0/2`，测试 oracle 修正为第 3 轮。R0 的四例 CSS
初始化失败属于测试启动基础设施问题，R1 两例时间字符串差异属于 oracle 写法；R2 的快速重启修复
只启用 `SO_REUSEADDR`，不启用 `SO_REUSEPORT`，存活监听者仍被真实 bind 拒绝。首轮私有 API
stderr 未保留，不声称当时直接采到 errno；同端口控制已复现该机制。R0 trace 未单独复制且后续
output 清理后仅保留原日志/JSON/RCA，R1 及之后各轮 trace 分别保存在独立 output 目录。

API/Vite 自有进程/监听资源与 WDI marker fixture rows 已回收；本批专用合成 PG 仍为后续三张设计
卡的后端验证独占保留，入口本身不负责起停该 PG。WDI 子项完成不勾 CP-06、Linux CI、真实
IdP/LiveKit、设备、生产、真实学习质量或完整周报父项。代码/测试已停写；全仓最终 format、独立
Review、正常 commit 与当前分支 push 以主控同卡回执为准。

真实 Provider、LiveKit、IdP、设备、生产部署与真实数据均未验证；默认 E2E 配置、现有产品、
旧测试、旧 bridge、迁移与锁保持只读。
