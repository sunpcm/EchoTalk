# CP-06 Fake API 契约与真实进程回归（A29）

契约来源：`TODO.md` P2“Fake API严格解析带项目后缀的analysis-success grammar路径并补回归”，以及真实 `apps/vite-app/src/lib/api.ts` 的 `UserSettingsResponse.theme` 必需三值枚举契约。

## §1 契约规范与修复内容

1. **用户设置 Theme 字段**：
   - `GET /api/user/settings` 补齐必需的 `theme: "warm"`，符合前端 `UserSettingsResponse` 定义（服务端三值 `"warm" | "cool" | "dark"`）。
   - 不增加伪造的 Provider 验证或全量写 API，保持 Fake API 契约严谨。

2. **Assessment 与 Grammar 严格路由锚定**：
   - 彻底移除原有的 `pathname.startsWith` 与 `pathname.includes` 模糊匹配。
   - 严格采用正则完整 pathname 锚定：
     - Grammar 路由：`^/api/assessments/((?:analysis-success|analysis-failure)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?)/grammar$`，精确返回数组 `[]`。
     - Assessment 路由：`^/api/assessments/((?:analysis-success|analysis-failure)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?)$`，返回完整评估对象，且 `session_id` 必须恰等于路径中的完整 ID（基础 ID 或带小写字母/数字/内部连字符 slug 的项目后缀，如 `analysis-success-chromium`、`analysis-failure-webkit`）。
   - 严格拒绝 lookalike prefix（如 `analysis-successful`）、空后缀（如 `analysis-success-`）、连续短横线（如 `analysis-success--test`）、前缀垃圾、额外路径段、重复 grammar（如 `/grammar/grammar`）以及把 `/grammar` 当成 ID 等异常路径，统一返回 404，不造成假命中。

3. **动态端口与无固定端口冲突**：
   - 保持默认 loopback `127.0.0.1:18181` 与既有 Playwright 配置兼容。
   - 增加对 `E2E_API_PORT=0` 的支持，当传入端口 0 时由 OS 自动分配未被占用的端口。
   - 在 `server.listen` 成功后稳定输出 `[fake-api] ready on http://${host}:${actualPort}` 就绪消息，且绝对不输出 env 或凭据。测试只消费该消息核对 loopback 与合法端口并实际发起 HTTP 通信。

4. **真实 Node 子进程回归测试套件 (`test:fake-api`)**：
   - 新增 `apps/vite-app/scripts/fake-api-test.mjs`，由 Node 内置 `node:test` 执行。
   - 覆盖动态端口绑定、就绪消息格式、健康检查认证边界（仅 `/api/health` 免 token，`/api/health/ready` 需有效 token）、401 缺/错 token、theme 必填枚举、assessment 路径与 session_id 严格一致、grammar 路径空数组以及 负向 404 路由解析。
   - 严格管理子进程生命周期：有界等待就绪与超时保护，`after` 钩子及异常场景下通过两段等待（`SIGTERM` -> `SIGKILL`）确保子进程可靠终止并核验 OS 进程真实退出（非简单信号标志），测试用例异常与独立实例测试均通过 `try/finally` 清理，并覆盖启动失败、重复终止幂等性与断言异常回收。

## §2 验证与门禁

- 新增真实 runner `pnpm test:fake-api`（`node --test scripts/fake-api-test.mjs`），列入 `docs/agent-review-loop.md` §2 测试树。
- 本轮 quality 门禁共 8 项：format、lint、typecheck、Vitest、build-script-test、fake-api-test、build、e2e。
- 完整质量门禁验证全部通过，所有正反向用例与双浏览器 E2E 均保持 0 skip / 0 failure。

## §3 边界与遗留

- 本次修改仅限本地 Fake API 契约与配套回归测试，不改变真实后端 FastAPI 实现。
- 本地 Fake API 仅用于 Playwright 与本地轻量回归，不能替代真实 Provider、真实 LiveKit 或端到端真实语音链路验收。
- 未推送、未合并远端、未部署。

## §4 Codex 独立评审（2026-10-24）

结论 APPROVED。独立源码/全部新增测试审查、33 项真实 HTTP 路由/schema/认证探针及 body deadline、清理错误聚合、并发终止/忽略 SIGTERM 强杀退出探针均通过。仅 `/api/health` 免认证，`/api/health/ready` 保留原认证条件。

完整 8 项门禁由 Codex 复跑：648 产品 Vitest、18 构建脚本、53 Fake API Node、120 Chromium/WebKit（0 skip）通过；专用 PostgreSQL 后端 269 项、73.72% 覆盖率及 Ruff 通过。独立 summary 为 `.review/reports/track-b/implementer/batches/20261024-234624-482052/summary.json`，实际 worktree 是 cp00。

两项有效变异：删除 theme 导致 1 项失败，破坏项目后缀 grammar 导致 6 项失败；逐字节/整树指纹恢复后再完整验收。原失败全部保留：首轮固定 runner cwd 由评审纠正；健康认证 fixture 误读、body deadline 与清理错误遗漏经两次集中返工关闭。3 次原 Flash 尝试、约 1198.27 活动秒，未扩权限或修改 skill，不折算 Codex 净省额。精确文件 SHA256、裁定及完整原日志仅存本地 `.review/reports/workflow-fake-api-a29/reviewer/`。

本轮不改变真实后端/Provider、不代表远端 Linux CI 已执行；下一增量将把构建脚本与 Fake API 两个真实 runner 显式接入现有 CI。未推送、远端合并、部署或同步 Notion。
