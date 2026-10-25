# RF-07 Dev 依赖分组受控实施与环境验证（A37）

契约来源：`TODO.md` RF-07 可复现依赖，以及用户已裁定依赖分组方案“先仅拆 Dev 四项，运行时保持共用（推荐）”。

## §1 依赖分组结构与单一真相源

本次增量将开发测试工具与生产运行时依赖清晰拆分，消除了生产镜像和兼容 requirements 冗余携带开发测试工具的问题：

1. **项目依赖分组声明**：
   - `backend/pyproject.toml` 拆分为 26 项默认 `dependencies` (runtime) 与 4 项 `[dependency-groups].dev`。
   - 迁入 `dev` 组的 4 项依赖及版本约束原样保持：
     - `ruff>=0.16.0,<1.0.0`
     - `pytest>=8.0.0,<9.0.0`
     - `pytest-asyncio>=0.23.0,<1.0.0`
     - `pytest-cov>=7.0.0,<8.0.0`
   - 其余 26 项依赖（含 `httpx>=0.27.0,<1.0.0` 以及全部 LiveKit runtime 依赖）继续保留在默认 `dependencies`。
   - 保留原有声明顺序与版本约束，未新增依赖，未改变 `[tool.uv] package = false` 及 `[tool.ruff]`, `[tool.coverage]`, `[tool.pytest.ini_options]` 配置。
2. **锁求解与 runtime-only 导出**：
   - `backend/uv.lock` 由受控步骤 `rf07-lock` 生成并锁定 192 个包（SHA256: `fba300031805120e7445665f3893ef9bc3521c33c15428c6ff9c2d8aba14598b`），严格保持 LiveKit 7 项 exact SDK 版本与 baseline 重叠版本。
   - `backend/requirements.txt` 通过 `uv export --frozen --no-dev --no-emit-project --no-header --no-annotate` 导出（SHA256: `e66ec8da7e973f9cb27a599d83e8e45fa3a726b6b446f7cd6dda16bcfc461e1f`），明确定义为单一只读 runtime-only 兼容导出镜像，不再包含 ruff、pytest 等开发工具。

## §2 CI 与 Docker 配方统一

| 环境 / 入口             | 配方改动                                                                                                                                                      | 说明与安全语义                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **CI (GitHub Actions)** | `.github/workflows/ci.yml` 后端步骤保持 `uv lock --check` 与 `cmp requirements.txt`；安装指令显式为：<br>`uv sync --frozen --group dev --no-python-downloads` | 显式同步 `dev` 依赖组，提供测试与格式化所需的 ruff 与 pytest 工具；保持原 `.venv` 调用路径、Alembic 迁移与测试覆盖率门禁不变。   |
| **Docker (Dockerfile)** | `backend/Dockerfile` 仅将原同步指令补齐 `--no-dev`：<br>`uv sync --frozen --no-dev --no-python-downloads`                                                     | 容器镜像中严格排除开发依赖，保证运行时镜像最小化；保持 Python 3.12-slim / uv 0.9.18 配方、`/opt/venv` 虚拟环境与 COPY 顺序不变。 |

## §3 受控环境隔离与实际安装验证

通过受控工具（`cross-platform-local-check.py b rf07-sync` 与 `rf07-runtime`）在独立路径验证了安装事实：

1. **Dev 独立环境 (`cp00/.review/rf07-a37-dev-venv`)**：
   - 实际安装 172 个包（含 4 项 dev 依赖）。
   - `mode: dev`，`has_dev_packages: true`，`sdk_versions_unchanged: true`。
2. **Runtime 独立环境 (`cp00/.review/rf07-a37-runtime-venv`)**：
   - 实际安装 165 个包（排除 dev 依赖及其专属传递依赖）。
   - `mode: runtime`，`has_dev_packages: false`（核验证实 4 项开发工具缺失），`sdk_versions_unchanged: true`。
3. **环境只读隔离**：
   - 旧 `backend/.venv` 及 A36 `.review/rf07-venv` 保持严格只读，元数据与指纹未变。
   - 新环境完全独立于 backend 源码目录，不进入 Docker build 上下文。

## §4 质量验证与门禁执行

- **前端 8 项完整质量门禁**：通过 `cross-platform-local-check.py b quality` 执行：
  - Format (`pnpm format:check`)
  - Lint (`turbo run lint --force`)
  - Typecheck (`turbo run typecheck --force`)
  - Vitest 单测 (`pnpm --filter vite-app test`)
  - Build Script 测试 (`pnpm --filter vite-app test:build`, 18 项断言)
  - Fake API 测试 (`pnpm --filter vite-app test:fake-api`, 53 项断言)
  - Build (`turbo run build --force`)
  - E2E (`playwright test`, 144 项双浏览器测试全部通过)
- **后端质量门禁**：由架构评审端在独立含 Dev 新环境连接专用测试库执行 269 项 pytest 及 Ruff。

## §5 边界与未验项说明

- **未执行真实 Linux Docker 镜像构建**：当前完成代码、依赖拆分与受控配方阶段，Docker 镜像构建与体积优化保留为后续独立验收。
- **未连接真实外部 Provider 或部署**：无真实第三方 AI Provider 或 LiveKit 云端联调，无部署或发布。
- **状态维持**：实施停在 Review 状态，`TODO.md` 中的 RF-07 整体项保持未勾选。
