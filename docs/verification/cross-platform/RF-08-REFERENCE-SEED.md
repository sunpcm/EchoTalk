# RF-08 启动参考数据显式幂等化验证

> 本文档记录 RF-08 启动播种子项重构规范与验证记录。
> 解决每个 Uvicorn Worker 在应用启动（lifespan）时隐式写库播种技能的问题，实现参考数据播种的显式化、原子化与幂等化。

## 1. 背景与重构契约

### 1.1 移除 lifespan 隐式播种

在多 Worker 部署（如 Uvicorn 4 Worker）场景下，各进程在 lifespan 阶段同时向数据库查询并写入参考技能存在并发冲突风险与启动延迟。
重构后：

- `backend/main.py` 的 `lifespan` 仅保留 `settings.validate_runtime()` 执行安全配置校验。
- 移除了启动期所有数据库连接与写入操作，绝不自动创建 Mock 用户或播种技能。
- 安全校验失败时立即阻断并抛错，绝不进入 yield 阶段。

### 1.2 显式参考数据播种模块 (`seed_reference_data.py`)

为避免因移除自动播种而导致生产/测试环境技能缺失，提供独立的显式参考数据播种命令：

- **调用方式**：在 backend 目录下显式指定 `DATABASE_URL` 执行：
  ```bash
  DATABASE_URL=postgresql://user:pass@host:5432/db python -m seed_reference_data
  ```
- **单一数据源**：严格复用 `models.knowledge.SEED_SKILLS` 中的 10 项初始技能，不复制冗余数据。
- **原子无覆盖**：采用 PostgreSQL 方言原生的 `INSERT ... ON CONFLICT (id) DO NOTHING RETURNING id`。
  - 不使用“先 SELECT 后 INSERT”机制；
  - 不使用 `delete`/`truncate`；
  - 不使用 `upsert` 覆盖已有行字段，已有同 ID 自定义记录内容得到完整保留。
- **并发与幂等**：支持多进程/多会话真实并发执行，无唯一键冲突风险；重复执行新增为 0 项，保证 10 项参考技能均存在，并保留表中其它技能及已有自定义内容。
- **CLI 安全边界**：
  - 加载数据库与创建引擎前，强制检查进程显式 `DATABASE_URL`，缺失时直接退出并报错，禁止回退 `.env` 或默认开发库；
  - 使用 SQLAlchemy URL 解析仅支持 PostgreSQL/postgres 协议并转为 asyncpg，严格拒绝 SQLite 等其它协议；
  - 导入模块或传入 `--help` 时完全不读环境变量且不连接数据库；
  - 错误路径对 stdout/stderr 严格脱敏，不泄露异常堆栈、URL、密码或凭据；
  - 使用独立专有 async engine，事务在单一连接内原子提交/回滚，`finally` 严格 `dispose`。

### 1.3 运维操作说明

上线部署或新环境初始化前，运维人员或 CD 管道需显式执行一次播种命令：

```bash
DATABASE_URL="${PROD_DATABASE_URL}" python -m seed_reference_data
```

本轮为本地架构测试与单元验证，不执行真实生产或 QA 数据库播种。

## 2. 自动化验证覆盖

- **Lifespan 单元测试** (`backend/tests/test_lifespan_seeding.py`):
  - `test_lifespan_executes_runtime_validation_and_no_db_access`: 验证启动期仅执行安全验证，零 DB 访问。
  - `test_lifespan_validation_failure_raises_and_never_yields`: 验证校验失败阻断 yield。
  - `test_lifespan_concurrent_startup_no_db_access_or_write`: 验证 4 并发 Worker 启动均无数据库会话与操作。
- **参考数据播种回归测试** (`backend/tests/test_reference_seeding.py`):
  - `test_seed_empty_table_inserts_10_skills`: 空表初始化 10 项。
  - `test_seed_idempotent_duplicate_call`: 重复执行完全幂等（新增 0 项）。
  - `test_seed_preserves_existing_custom_content_and_fills_missing`: 已有同 ID 内容保留且补齐缺项。
  - `test_seed_concurrent_4_independent_sessions`: 4 独立会话真实并发执行无冲突。
  - `test_seed_transaction_rollback_on_failure`: 异常原子回滚。
  - `test_cli_help_flag_does_not_connect`: `--help` 不连接 DB。
  - `test_cli_missing_database_url_refuses_without_db_connection`: 缺显式 URL 立即拒绝。
  - `test_cli_invalid_database_url_refuses`: 非 PG 协议拒绝且脱敏。
  - `test_validate_and_format_postgres_url`: 协议与驱动转换验证。
  - `test_cli_secrets_not_leaked_in_stdout_stderr`: 凭据与密码安全脱敏。
  - `test_cli_successful_run_and_repeat_in_test_schema`: 隔离 test schema 下 CLI 真实执行与重复幂等。
  - `test_cli_engine_disposed_on_error`: 异常关闭与资源释放。
