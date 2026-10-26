# Repository Guidelines

## Project Structure & Module Organization

EchoTalk is a pnpm/Turborepo monorepo with a Python backend. Frontends live in `apps/`: `vite-app` is the primary React 19 client and `webpack-app` is the alternate bundler implementation. Shared UI and SVG assets are in `packages/ui-lib`; reusable tooling configuration is under `packages/configs`. FastAPI, LiveKit, Celery, SQLAlchemy, and Alembic code lives in `backend/`. Architecture notes and phase-specific manual checks belong in `docs/`; active work belongs in `TODO.md`.

## Build, Test, and Development Commands

- `pnpm install`: install all workspace dependencies (CI uses Node 22; pnpm 10.26).
- `pnpm dev:vite`: run the main HTTPS client; use `pnpm dev:webpack` for the alternate app.
- `pnpm build`: build all Turbo packages and applications.
- `pnpm lint && pnpm typecheck && pnpm format:check`: run the frontend quality gates.
- `cd backend && uv venv && uv pip install -r requirements.txt`: prepare the Python 3.12 environment.
- `cd backend && uvicorn main:app --reload --port 8000`: run the API locally.
- `cd backend && .venv/bin/ruff format --check . && .venv/bin/ruff check .`: validate backend formatting and linting.
- `docker compose up -d --build`: start the complete local stack.

## Coding Style & Naming Conventions

Prettier enforces 100-character lines, semicolons, double quotes, trailing commas, and LF endings. ESLint uses `@biu/eslint-config`; justify any suppression. Use two spaces in TypeScript/CSS, PascalCase for React components, `useCamelCase` for hooks, camelCase for variables, and kebab-case package directories. Python follows Ruff with 88-character lines; use snake_case for modules/functions and PascalCase for classes. Route frontend copy through `apps/vite-app/src/i18n/`.

## Testing Guidelines

The Vite app has real Vitest tests and Playwright + Fake API E2E; the backend uses pytest with PostgreSQL integration cases. Some other Turbo package test scripts are placeholders and must not be counted as coverage. Run lint, typecheck, build, and the relevant flow in `docs/PHASE_*_MANUAL_TEST.md`. Name future frontend tests `*.test.ts(x)` and backend tests `test_*.py`; prefer Vitest/React Testing Library and pytest. Add regression tests for defects.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects such as `feat: ...`, `fix: ...`, and `feat(phase6): ...`. Keep commits focused and imperative. Pull requests should summarize behavior, list verification commands, link the issue or phase document, call out migrations/configuration changes, and include UI screenshots. Husky runs lint-staged formatting and ESLint fixes before commit.

## Security & Configuration

Never commit `.env`, credentials, provider API keys, or user data. Use local environment overrides, preserve explicit dev/OIDC isolation and fail-closed authentication unless the task explicitly changes authentication, and review Alembic migrations before applying them outside development.

## Agent 协作规范（评审 / 实施分离）

始终使用中文回答。由本地 `.review/prompts/` 驱动的任务遵守
[`docs/agent-review-loop.md`](./docs/agent-review-loop.md)，本节优先于历史阶段文档中的旧流程。

- 权威顺序：PRD → 跨系统契约 → 实施计划 → 代码与测试；prompt 是指令，不是事实依据。
- 修改前核对 prompt 指定的绝对 worktree、分支、HEAD 和工作树状态；不符就报告，不自行 pull、stash、reset 或切分支。
- 实施只能改指定 lane；主 checkout、其他 lane 及未授权仓库只读。一个 prompt 只执行一轮范围。
- 实施停在 Review，不 commit、push、pull、rebase、merge、部署或发布。
- 验收命令经 prompt 指定的 ev.sh，证据与报告只写指定本地目录，不读取 reviewer-probes。
- 独立评审由架构 Agent 亲自执行；不信交付报告，自查 diff、全部测试树与证据，结论为 APPROVED 或 CHANGES REQUESTED。
- 用户已确认 prompt、报告与证据仅保存在主 checkout 的 `.review/`，不纳入 Git。
- 测试仅使用手册 §3 确认的专用库；迁移先独立审查，再按既有授权执行。禁止应用库、QA、生产及其他 lane 的库。
- 新依赖/工具安装、真实外部依赖访问和服务操作遵守用户授权，未知条件报告为未验证，不编造通过。
- 文档冲突无法判定、产品口径变化或已上线契约行为漂移：停下、列证据、等用户裁定。

必跑测试树为 Vite Vitest、Vite Playwright 和 backend pytest；目录、解释器、环境与命令见手册 §2。
未授权或缺失依赖导致不能执行时必须列为阻断，不能把 skip、缓存日志或占位任务当作通过。

## Cursor Cloud specific instructions

Cloud Agent VMs are not the review-lane machines in `docs/agent-review-loop.md`. They use host
PostgreSQL 15.19 and Redis 7, not Docker Compose. Node.js 22, pnpm 10.26, `uv`, and
`backend/.venv` are already installed. Boot starts tmux sessions `echotalk_api`
(`http://127.0.0.1:8000`, log `/tmp/echotalk-api.log`) and `echotalk_web`
(`https://127.0.0.1:5173`, self-signed, log `/tmp/echotalk-web.log`). The first boot writes
gitignored `/workspace/.env` with `AUTH_MODE=dev` and a local `DEV_AUTH_TOKEN`.

The app database is `echotalk`. Pytest must use `echotalk_test`. Role `echotalk` and password
`echotalk_test` match `.github/workflows/ci.yml`. From `backend/`:

```bash
DATABASE_URL=postgresql+asyncpg://echotalk:echotalk_test@127.0.0.1:5432/echotalk_test \
  .venv/bin/python -m pytest --cov=. --cov-report=term-missing
```

`GET /api/health` does not need provider keys. `GET /api/health/ready` stays 503 until LiveKit
and an LLM key exist, so resuming a call cannot connect. Creating and ending a session still
persists. ChromaDB is a local directory and starts empty, so curriculum recommendations stay
empty until `python scripts/seed_corpus.py` is run from `backend/`. Playwright E2E uses the Fake
API on ports 4173 and 18181 and does not need those keys. Vitest is `pnpm --filter vite-app test`.
