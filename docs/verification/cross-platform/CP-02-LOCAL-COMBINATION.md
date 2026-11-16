# CP-02 通话占用本地组合补验（CP02I）

## 目标与边界

补齐「真实 controller + 实际 `api.ts` 请求/校验封装 + stdio 传输桥 + 真实 ASGI 路由 +
真实合成 PG」的覆盖差集。仅 LiveKit Cloud 撤销经 `LiveKitAPI.room` 显式模拟；真实
PG/ASGI/事务/JSON/controller/api.ts 不 mock。不连真实网络、不开 Cloud 门禁、不改协议与
默认行为、不接 conversation/UI、不持久化设备 ID/Token、不新增依赖/CI/迁移。

## 安全闭环

- 桥在导入 backend 前校验 `DATABASE_URL`：必须显式 `ECHOTALK_CALL_LEASE_LOCAL_PG=1`、
  scheme 为 `postgresql://` / `postgres://` / `postgresql+asyncpg://`（后者原样接纳，前两者
  归一为 asyncpg）、精确 `127.0.0.1:55433`、非空密码、无 query/fragment、用户与库均为
  `echotalk_b1_test`；缺失/非法/解析失败一律静态 `exit 2` fatal（不打印异常原文），不允许
  skip。
- 进程级出站硬拦截：`socket.connect/connect_ex/sendto/getaddrinfo` 在导入 backend 前被
  替换，除 `127.0.0.1:55433` 的真实 PG 连接外全部失败；真实 DNS 与 Cloud 无出站机会。
- HTTP 身份逐请求从 `Authorization: Bearer <合成UUID>` 解析并映射到本桥创建的 owned
  集合内对应用户；缺头、无效或非 owned UUID 一律 401；合法 owned 用户之间的切换按逐
  请求身份生效，不使用 fixture 可变 current id 替代请求身份。
- HTTP 只接受本地相对 `/api/` 路径；桥内部失败发独立 `bridge_error` 事件使测试失败，
  不伪造服务端 HTTP 响应；错误信息不含 URL/密码/原始异常。
- backend 导入路径由 `__file__` 显式定位并插入 `sys.path`，不依赖裸 python/cwd 偶然成功。

## 晚到响应门（确定性，无 sleep）

`hold` 先让真实请求在 ASGI 中完成并 commit，桥再发 `held` 事件并 hold 响应；测试等
`held` 后经真实 PG 确认已 commit，再 invalidate / authRevision 变化，随后 `release` 放行
迟到响应。晚到场景拆成两个独立 case，不同时叠加两层门禁。

## 场景（6）

1. 首次 claim → held gen1；同 owner 重复 claim 保持 gen1；同用户第二 session+device
   `takeover=false` → 409 `call_in_use`。
2. `takeover=true` → gen2；旧 owner heartbeat/token/dispatch/release 全部 409
   `call_lease_lost`（负向触发点在出站硬拦截保护下，不依赖产品门禁防外联）。
3. Cloud 撤销失败：takeover claim → 502 且 DB 保持旧 owner；controller release →
   `release_failed` 保留 tuple，仅显式重试（撤销恢复）→ free。
4. 真实 DB 过期（fixture 直改 `expires_at`）+ 虚拟时钟推进 20 秒心跳：显式观察实际
   heartbeat `ApiError` 的 `status=409`、`detail.code=call_lease_expired`；现有 controller
   在服务端 409 路径为 lost/`heartbeat_failed`（本地 watchdog 才映射 expired，非产品
   Bug），owner 清空、timer 清零、后续推进无自动 claim，以桥真实请求计数证明。
5. claim 已 commit、响应被 hold：invalidate 后迟到成功不覆盖，也不为服务端已提交的
   claim 自动回写/补偿。
6. authRevision 变化（真实 `invalidateAuthSession`）后迟到成功不覆盖；服务端真实 held
   保留。

## 写集与入口

- 本组合是显式入口（`pnpm test:call-lease-local` 或专用 vitest config）；默认 `src` 的
  lint/typecheck 与默认 Vitest 均不覆盖它，默认 CI 不运行这六例。
- 新增：`apps/vite-app/integration/call-lease/bridge.py`、`call-lease.local.spec.ts`、
  `vitest.config.ts`。
- 修改：`apps/vite-app/package.json` 仅加 `test:call-lease-local` 脚本；
  `apps/vite-app/vitest.config.ts` 默认 exclude 增加 `integration/**`，防误收集。
- 专用 config：`root` 指向 app 根、alias `@`、jsdom、`fileParallelism:false`、include 仅
  本 spec；`envDir:false` 完全禁用 dotenv 文件加载，`import.meta.env.VITE_API_URL=/api`
  内联合成（与 `.env.development` 等价、不读任何 .env）；不继承 base exclude，避免
  no-tests。

## 状态与建议命令

状态：FINAL_READY。主控最终验收全过：13 门禁 exit0；额外 types 0、显式 backend 配置
Ruff 最终 0、真实 PG 组合最终 6/6（retry 0 / skip 0）；707 保护文件未变。R2 期间自报
Ruff 绿实为默认规则误报，I001 真实失败已在最终机械格式收口闭合（bridge hash
`03d3b6e9cba116db8cad5015791b39f05e92391d0209ed0a03a14aeb797d943e`，仅 import 排序，
AST 不变）；R0 静态失败、R1 三 TS 错误、R2 清理吞错与 I001 历史保留。正式实施返修
`2/2`（产品源码未改）。本卡未自跑测试/服务/构建；未验边界：真实 OS/SSO/Cloud/设备，
stdio 桥为 fetch 传输替换、ASGI 无真实 HTTP socket、Cloud 仅显式模拟。

```bash
cd apps/vite-app
DATABASE_URL='<主控注入的合成 127.0.0.1:55433/echotalk_b1_test URL>' \
  pnpm vitest run --config integration/call-lease/vitest.config.ts
```

清理边界：桥进程 finally 取消并 await 在途任务后，按 user→session→lease 倒序清理本次
owned 数据；绝不 truncate 公共数据，父进程 EOF/child crash 不留悬挂 future。
