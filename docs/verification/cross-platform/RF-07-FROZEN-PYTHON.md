# RF-07 可复现 Python 依赖与受控安装配方验证（A36）

契约来源：`TODO.md` RF-07 可复现依赖。

## §1 依赖规范与单一真相源

本次重构确立了标准 Python 3.12 uv 项目体系，消除了此前未锁定的依赖漂移风险与手动维护 requirements 的双源缺陷：

1. **项目元数据与解释器声明**：
   - `backend/pyproject.toml` 补齐标准 `[project]` 元数据：`name = "echotalk-backend"`、`version = "0.1.0"`、`requires-python = ">=3.12,<3.13"`。
   - 既有 30 项依赖全量声明为默认 `dependencies`，配置 `[tool.uv] package = false`。
   - 保留 `[tool.ruff]`、`[tool.coverage]` 与 `[tool.pytest.ini_options]` 既有全部配置与覆盖率阈值。
   - 新增 `backend/.python-version` 明确声明 `3.12`，统一 CI 与开发入口。
2. **完整依赖锁与导出镜像**：
   - 提交包含 192 个包完整解析与内容哈希的 `backend/uv.lock`。
   - 严格锁定 LiveKit 7 项核心 SDK（`livekit==1.1.2`, `livekit-api==1.1.0`, `livekit-agents==1.4.3` 及 4 项插件 `1.4.3`）以及与既有已验证环境重叠的全部 172 项 baseline 包版本，不借锁定升级任何 SDK。
   - `backend/requirements.txt` 通过 `uv export --frozen --no-dev --no-emit-project --no-header --no-annotate` 导出，作为单一只读兼容镜像，不再手写维护。

## §2 CI 与 Docker 配方统一

| 环境 / 入口             | 原配置                                                                           | 新受控配方                                                                                                                                                                                                                                                                                      | 说明与安全语义                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **CI (GitHub Actions)** | `setup-uv` version: `latest`<br>`uv venv` + `uv pip install -r requirements.txt` | `setup-uv` version: `0.9.18`<br>`uv lock --check`<br>`uv export ... /tmp/req.txt && cmp requirements.txt /tmp/req.txt`<br>`uv sync --frozen --no-python-downloads`                                                                                                                              | 固定 uv 版本；强校验锁状态；校验仓内 requirements 一致性；冻结安装且禁止下载新 Python；保持 `.venv` 原调用路径。                 |
| **Docker (Dockerfile)** | `python:3.11-slim`<br>`pip install -r requirements.txt`                          | `python:3.12-slim`<br>`COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /usr/local/bin/uv`<br>`ENV UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH"`<br>`COPY pyproject.toml uv.lock .python-version ./`<br>`RUN uv lock --check && uv sync --frozen --no-python-downloads`<br>`COPY . .` | 对齐 Python 3.12；固定 uv 0.9.18；隔离虚拟环境至 `/opt/venv`，先装依赖再拷源码，防止源码覆盖环境；保持 `/app` 与 8000 端口兼容。 |
| **Docker 忽略规则**     | 仅排除 `.venv/`, `__pycache__/`, `*.pyc`, `.chromadb/`, `.git/`                  | 在原基础上补充排除 `.env`, `.env.*`, `.review/`, `.pytest_cache/`, `.ruff_cache/`, `.coverage`, `htmlcov/`                                                                                                                                                                                      | 杜绝私密环境变量、本地 review 隔离环境与测试缓存泄露入 Docker build context。                                                    |

## §3 保持的不变量与隔离边界

1. **4 项核心锁定产物精确匹配**：
   - `backend/pyproject.toml` (SHA256: `ca8dc5bc0201502f38b1c4fead572ef3b84d3c9dbb193d1f6004870f9a902f37`)
   - `backend/.python-version` (SHA256: `7b55f8e67b5623c4bef3fa691288da9437d79d3aba156de48d481db32ac7d16d`)
   - `backend/uv.lock` (SHA256: `220635986b5cd7caabb63d6d68e1ee4d3cb6534701720b864c98133abaca011d`)
   - `backend/requirements.txt` (SHA256: `de5106235a93ee0d5374bcc4c374ef1549d2ef003ae725a2138e190e2872da1e`)
   - 其中项目声明由 agy 按原依赖实现，锁与兼容 requirements 由受控 uv 流程生成；四项冻结后未再修改。
2. **环境隔离与只读保护**：
   - 旧环境 `backend/.venv` 严格保持只读，其元数据与 `.dist-info` 指纹保持不变。
   - 新环境固定位于 `cp00/.review/rf07-venv`，完全独立于 backend 源码目录，不进入 Docker build 上下文。
3. **安全与依赖源限制**：
   - 所有依赖源仅限公网 PyPI (`https://pypi.org/simple`) 与 `files.pythonhosted.org`，无 Git、本地路径或含凭据 URL。
   - 未增加直接依赖，原本机 172 项安装版本保持；锁中另含 19 项 Linux/CUDA 条件分支及虚拟项目，不能称跨平台新增包为零。未修改 Compose 服务定义或读取 `.env`。实施方不读取受保护密钥；评审仅通过原受保护测试入口使用专用库凭据。

## §4 质量验证与门禁执行

- **前端 8 项质量门禁**：通过 `cross-platform-local-check.py b quality` 验证：
  - Format (`pnpm format:check`)
  - Lint (`turbo run lint --force`)
  - Typecheck (`turbo run typecheck --force`)
  - Vitest 单测 (`pnpm --filter vite-app test`)
  - Build Script 测试 (`pnpm --filter vite-app test:build`, 18 项断言)
  - Fake API 测试 (`pnpm --filter vite-app test:fake-api`, 53 项断言)
  - Build (`turbo run build --force`)
  - E2E (`playwright test`, 144 项双浏览器测试全部通过)
- **后端质量门禁**：Codex 独立在隔离新环境 `.review/rf07-venv` 运行专用测试库 269 项 pytest（覆盖率 73.72%）及 Ruff 检查全部通过。

## §5 边界与未验项说明

- **未执行 Linux 真实 Docker 镜像构建**：因当前处于本地代码与配方受控改造阶段，Linux 平台真实构建与镜像体积验证保留为后续阶段目标。
- **未连接真实外部 Provider 或部署**：无真实第三方 AI Provider 或 LiveKit 云端联调，无部署或发布。
- **状态维持**：实施停在 Review 状态，`TODO.md` 中的 RF-07 整体项保持未勾选，等待 API/Agent/Dev 依赖分组和后续 Linux CI／镜像验收，不要求以生产部署作为本轮代码验收。

## §6 Codex 独立验收（2026-10-25）

APPROVED（本地锁定与配方源码阶段）。192包锁的所有marker分支均经过来源/HTTPS/artifact SHA256审计，SDK七项及全部172个baseline重叠版本保持；临时constraints移除后重新求解并离线check，不保留长期人工约束；requirements二次导出逐字节一致。全新cp00隔离环境实际frozen安装172包、离线check、SDK版本/prefix/site-packages与锁hash核验通过，旧环境metadata哈希保持；在新环境而非旧环境跑269 pytest（覆盖率73.72%）及Ruff通过。

13项离线控制入口护栏通过；独立配置probe核前端job、聚合、PG服务/环境、Ruff/Alembic/pytest原入口保持，Docker只作Python3.12/uv0.9.18/frozen路径与秘密排除的静态验收。SDK声明偏离锁时真实uv offline lock --check拒绝，CI移除frozen标志时配置probe拒绝；两变异备份finally逐字节/整树恢复后完整8门禁698 Vitest、18构建脚本、53 Fake API Node、144双浏览器通过，0skip。

原草案缺陷、私有清单拒权及全部尝试留存，不改skill。受控执行入口由Codex reviewer维护并哈希绑定，产品声明/CI/Docker源码与文档由agy实施，生成物只由uv产生。只向实施方提供公开结果，不传数据库凭据或私有评审清单。

限制：API/Agent/Dev尚未分组，30项暂保留默认安装集合；Linux/CUDA条件分支不等同本机安装，也未选择CPU专用wheel源。Docker build/新镜像与远端Linux CI未运行，无Provider或真实业务服务操作；因此RF07整项不勾选。跨环境同一锁不表示同一wheel或镜像体积，未来分组和CPU/GPU运行策略须独立定案。
