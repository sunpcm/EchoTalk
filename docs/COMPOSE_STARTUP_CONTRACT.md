# Compose 启动与系统就绪合同

状态：方案 A 已确认。本文约束 EchoTalk 的基础设施就绪和容器启动顺序，不表示某个用户具备练习
权限，也不把 schema 升级等同为 B1 生产数据切换。

## 系统就绪

`GET /api/health/system-ready` 是公开的基础设施 readiness 接口：

- 不依赖用户身份、`get_db`、套餐、BYOK、Provider、IdP 或 LiveKit 配置；无 Bearer 或携带错误
  Bearer 都不改变结果。
- 只使用共享 PostgreSQL 连接执行 `SELECT 1`，不读取或写入用户表，不映射或创建 `User`。
- 查询、连接或资源释放失败时返回 typed `503` 和固定通用正文 `{"status":"not_ready"}`，不得返回
  底层异常、数据库地址、凭据或配置。
- 本次连接和会话资源必须在 HTTP 响应开始前释放。数据库连接/查询操作使用 0.5 秒预算，为当前
  asyncpg graceful close 最多约 2 秒的清理预留余量；完整 readiness 响应目标小于 3 秒。
- 成功返回 typed `200` 和固定正文 `{"status":"ready"}`。

既有 `GET /api/health/ready` 继续要求认证，并继续根据当前用户及练习配置判断就绪。新系统探针
不得复用、覆盖或改变该接口的函数、认证和 OpenAPI 语义。

## Compose 启动顺序

启动依赖固定为：

1. `echotalk-postgres` 通过自身 healthcheck。
2. 一次性 `echotalk-migrate` 使用既有 backend API 角色镜像、同一 `DATABASE_URL` 和现有环境边界
   执行 Alembic `upgrade head`；它设置 `restart: "no"`，成功退出后才放行其他后端服务。
3. `echotalk-api`、`echotalk-agent`、`echotalk-analysis-worker` 均同时依赖 PostgreSQL
   `service_healthy` 与迁移 `service_completed_successfully`。
4. `echotalk-api` 使用镜像已有 Python 标准库在容器内请求
   `http://127.0.0.1:8000/api/health/system-ready`。探针使用
   `urllib.request.ProxyHandler({})` 构建无环境代理 opener，确保 `HTTP_PROXY`、`HTTPS_PROXY`
   等变量不会把 loopback 请求导向代理；HTTP 超时为 4 秒，容器 healthcheck 超时保留 5 秒。
   请求不嵌入用户 Token。
5. `echotalk-web` 仅在 `echotalk-api` 为 `service_healthy` 后启动。

迁移失败、非零退出或超时不得放行 API、Agent 或 worker。不得硬编码新凭据，不得新增真实外部
服务、迁移文件、依赖或公开配置。

## 切换边界

Compose 的 `upgrade head` 只升级 schema。它不会自动执行 B1 `prepare`、`baseline` 或
`traffic_resumed`，也不会恢复旧 worker。B1 切换期间全部新旧 worker 必须保持停止，直到人工确认
`traffic_resumed`；不能把容器启动或 schema 升级写成生产数据切换已完成。

容器 readiness、Fake API、Compose 静态依赖图和真实 B1 切换验收是不同证据。真实 Provider、IdP、
LiveKit、原 Compose 整栈、生产数据和设备验收仍需分别记录。
