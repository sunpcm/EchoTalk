# RF-11 OpenAPI 类型生成验证

> 状态：真实 FastAPI schema、TypeScript types、生成工具和后端验证已完成；精确 peer override
> 已通过原生 lock 重生成与冻结安装。完整前端曾在 r2 编译断言的 `no-empty-object-type` lint
> 非零停止，r3 修复尚待主 Agent 复验；完整前端、变异、main 复验和独立 Review 未完成。
> 日期：2026-11-01。本文不把尚未复验的 r3 或未运行项记为通过。

## 目标与非目标

本轮从实际 FastAPI 路由导出 OpenAPI 3.1 schema，再从仓内 schema 生成 TypeScript 类型，并由
生产 `api.ts` 消费六类 DTO。保留既有小型 Transport、运行时 parser 和 HTTP 行为。

本轮不迁移全部 domain 手写类型，不引入运行时 HTTP 客户端，不修改后端字段/default/状态值，
不连接数据库、真实 IdP、LiveKit 或 Provider，不在生成器 import 时自动改写文件。

## Schema 导出隔离

`backend/export_openapi.py` 分为父子进程：

1. 父进程只加载 Python 标准库，解析 `--check`/`--output`，不导入 config、database、FastAPI
   或任何业务模块。
2. 父进程用当前 Python 解释器启动 `-I` 子进程，向子进程提供完整且最小的合成环境；没有
   `os.environ.copy()`，也不读取根 `.env`。
3. 子进程在业务 import 前同时安装 socket API 与 Python audit hook 两层网络失败关闭屏障；
   TMP/TEMP 与 XDG 目录重定向到受控临时目录，`HOME` 不重设。应用 Settings 的默认
   `model_config` 不改；导出子进程在导入 config 前包装 `BaseSettings` 构造，强制传入 Pydantic
   文档化的 `_env_file=None` 与 `_secrets_dir=None`，使 DotEnvSettingsSource 在构造阶段也无法
   读取 env_file。随后按真实签名实现 `settings_customise_sources`，仅保留 init 与 env source。
4. 子进程导入真实 `main.app`，只调用 `app.openapi()`；不运行 lifespan，不调用 API handler，
   不连接数据库。
5. schema 用 UTF-8、排序 key、2 空格缩进和末尾换行序列化。父进程成功取得完整字节后才通过
   同目录临时文件与 `os.replace` 原子写入 canonical `backend/openapi.json`。
6. 实际导出子进程有 120 秒本地 timeout；超时非零、只报安全固定消息且不写部分产物。子进程
   异常只输出阶段和异常类型，不回显任意 `str(exc)`；父进程也只接受该受限协议，其他 stderr
   一律安全回退。
7. `--check` 只比较字节。缺 schema、stale、参数错误、子进程失败、超时、网络意图或输出失败均
   非零，且不修改既有 schema。

合成配置只用于 schema 元数据和惰性 engine 构造，不构成数据库、认证或 Provider 验收。任何
意外网络连接都会抛出 `OpenApiExportError`，不会吞掉后继续产生产物。真实导出、所有 probe
和测试子进程均设置有限 timeout；超时和合成异常 canary 回归不需要真实长时间等待。

受控事实：`backend/openapi.json` 已由真实 `main.app.openapi()` 生成，当前包含 22 条路径、
27 个模型；`export_openapi.py --check` 已通过。r1 的 dotenv/file-secret 隔离、零文件
`BaseSettings`、异常 canary、父进程 stderr 与 timeout 合成探针通过；离线导出 pytest 11 项、
backend Ruff 格式/lint 与专用测试库全量 pytest 540 passed/3 warnings、79.41% coverage 均通过。
新增导出工具主要在隔离子进程中执行，不进入父 pytest coverage 统计，既有 59% 门禁不变。

## TypeScript 生成

`apps/vite-app/scripts/generate-api-types.mjs` 使用 `openapi-typescript@7.13.0` 的 Node API：

- 默认只读 `backend/openapi.json`，默认只写 `src/lib/api.generated.ts`。
- 要求 OpenAPI 3.1，遍历并验证所有 `$ref`；仅允许文档内 `#/...` JSON Pointer，remote、
  unsupported anchor 越界或缺失目标均拒绝。
- 类型文本按 `apps/vite-app/package.json` 中的项目 Prettier 配置格式化。
- `--check` 比较完整字节，不写入；缺产物或 drift 返回非零。
- 写入采用同目录临时文件与 rename，失败不会留下 canonical 半成品。
- 生成模块只含 types，不产生 fetch、状态、日志或运行时依赖副作用。

受控事实：Node 22 与 pnpm 10.26.0 下已完成冻结安装，`openapi-typescript@7.13.0` 已从真实
schema 生成 `api.generated.ts`；types `--check`、Node 生成器 8 项和 TypeScript typecheck 均
通过。六类 DTO 对真实生成模块的类型适配已通过 typecheck，完整前端测试树仍需完成。

## 依赖图与精确 peer 接线

首次生成 lock 时，新增 `openapi-typescript@7.13.0` 带入的 `type-fest@4.41.0` 被 pnpm 重新用于
既有 `@pmmmwh/react-refresh-webpack-plugin@0.6.2` 的可选 peer，而既有图选择的是
`type-fest@0.21.3`。为避免业务依赖图漂移，`pnpm-workspace.yaml` 仅增加一个带精确父包版本边界的
override：

```yaml
overrides:
  "@pmmmwh/react-refresh-webpack-plugin@0.6.2>type-fest": "0.21.3"
```

该规则只保留 Webpack 0.6.2 的既有 peer 选择，不全局降级 `type-fest`；
`openapi-typescript` 及必要传递依赖仍使用其需要的 4.41.0。不得增加其他 override、
packageExtension 或 pnpmfile 补丁。主 Agent 已使用 pnpm 10.26.0 完成原生 lock 重生成和
`--frozen-lockfile` 安装。

同类 lock 更新必须从仓库根执行：

```bash
pnpm install --lockfile-only --prefer-offline --config.dedupe-peer-dependents=false
pnpm install --frozen-lockfile
```

`--config.dedupe-peer-dependents=false` 只用于本次命令，不写入全局或 workspace 默认设置；它用于
保留既有 `debug@4.4.3` 无 `supports-color` 的旧 peer 图。受控语义比对结果：既有 `packages`
的 version/integrity 与全部既有 resolved `snapshots`/`importers` 不变；新增 17 个 packages、
18 个 snapshots 及 vite-app 的精确 devDependency。唯一既有 package 元数据变化是批准 override
将 `@pmmmwh/react-refresh-webpack-plugin@0.6.2` 的 peer range 记录为 `0.21.3`；generator 所需
`type-fest@4.41.0` 继续保留。不能把这处 native metadata 变化说成完全未变，也不能用手写、
恢复整份 lock 或放宽 peer range 代替受控重生成。

## 六类生产 DTO 兼容

| DTO                        | generated 字段来源                            | 客户端适配                                                                     |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `DailyProgressResponse`    | `components.schemas.DailyProgressResponse`    | 两个计数字段保持必需                                                           |
| `SessionListItem`          | `components.schemas.SessionListItem`          | schema 默认值导致可选的 `ended_at` 通过 `Required` 恢复为必需 `string \| null` |
| `SessionListResponse`      | `components.schemas.SessionListResponse`      | `next_cursor` 恢复必需；`items` 复用领域适配后的 `SessionListItem`             |
| `CallCapabilitiesResponse` | `components.schemas.CallCapabilitiesResponse` | `protocol_version=1` 与 `call_lease_mode` 保持必需和窄范围                     |
| `CallLeaseResponse`        | `components.schemas.CallLeaseResponse`        | generated 字符串 `state` 收窄为客户端既有成功值 `"held"`                       |
| `CallReleaseResponse`      | `components.schemas.CallReleaseResponse`      | generated boolean `released` 收窄为既有成功值 `true`                           |

`api.ts` 只使用 `import type` 消费 generated 模块。运行时 `parseCallCapabilities`、
`parseCallLeaseResponse`、`parseCallReleaseResponse`、`parseSessionListResponse` 和
`parseDailyProgressResponse` 继续执行真实格式、长度、UUID、时间、关联值与额外字段校验；
生成类型不替代 runtime guard。其余手写 domain 类型本轮未迁移。

## CI 分层

- `test-backend`：既有 frozen `uv sync` 后运行
  `.venv/bin/python export_openapi.py --check`，再由 full pytest 执行
  `tests/test_openapi_export.py`。本地对应 schema `--check`、导出 pytest 11 项和 full pytest
  已通过；该 job 将在 CI 验证真实 app 与 tracked schema 未漂移。
- `test-frontend`：既有 frozen pnpm install 后运行 `check:api-types` 与 `test:api-types`，随后
  保持 format/lint/typecheck/Vitest/build/Fake API/E2E。该 job 验证 schema 到 generated types
  未漂移，且不安装 Python 全栈。本地 types check、Node runner 8 项和 typecheck 已通过，
  完整 10 门禁尚未完成。
- 两层都成功后，schema→types 链路才完整；单独一层通过不能代表另一层可复现。
- 远端 CI 尚未运行，不能宣称 A67 已被远端流水线覆盖。

## 当前验证状态与剩余门禁

Python 固定使用 lane 内 `.review/rf07-a37-dev-venv/bin/python`；Node 固定 Node 22 与
pnpm 10.26.0。schema、lock、types、生成工具和后端验证已完成，不需要重跑未变更的生成器或
重写产物。仅有变更时才执行：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/cp00/backend
../.review/rf07-a37-dev-venv/bin/python export_openapi.py
../.review/rf07-a37-dev-venv/bin/python export_openapi.py --check
../.review/rf07-a37-dev-venv/bin/python -m pytest tests/test_openapi_export.py
```

完整前端只能由主 Agent 在本轮实施停写后复验。固定 10 门禁为：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/cp00
pnpm run format:check
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm --filter vite-app test
pnpm --filter vite-app test:build
pnpm --filter vite-app test:fake-api
pnpm --filter vite-app check:api-types
pnpm --filter vite-app test:api-types
pnpm exec turbo run build --force
pnpm --filter vite-app test:e2e
```

r3 把编译期必需字段判断从空对象类型改为 `Pick<T, K>` 与
`Required<Pick<T, K>>` 的赋值关系，保留 13 个断言且没有新增 runtime 常量。该源码修复本身
尚未验证。固定 10 门禁通过后，仍需完成变异、main 复验和独立 Review。

## 未验证边界

- 完整前端 10 门禁目前没有全绿证据；此前在 r2 lint error 处停止，r3 修复尚待复验。
- 变异、main 复验和独立 Review 尚未完成。
- 远端 Linux CI 尚未运行，不能由本地结果推断 A67 已被远端 CI 覆盖。
- 未验证真实外部依赖、移动端或生产部署。
- 导出隔离是导入期网络失败关闭与最小环境边界，不等于操作系统级密封沙箱。
