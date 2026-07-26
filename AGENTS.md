# Repository Guidelines

## Project Structure & Module Organization

EchoTalk is a pnpm/Turborepo monorepo with a Python backend. Frontends live in `apps/`: `vite-app` is the primary React 19 client and `webpack-app` is the alternate bundler implementation. Shared UI and SVG assets are in `packages/ui-lib`; reusable tooling configuration is under `packages/configs`. FastAPI, LiveKit, Celery, SQLAlchemy, and Alembic code lives in `backend/`. Architecture notes and phase-specific manual checks belong in `docs/`; active work belongs in `TODO.md`.

## Build, Test, and Development Commands

- `pnpm install`: install all workspace dependencies (Node 20+, pnpm 10.26).
- `pnpm dev:vite`: run the main HTTPS client; use `pnpm dev:webpack` for the alternate app.
- `pnpm build`: build all Turbo packages and applications.
- `pnpm lint && pnpm typecheck && pnpm format:check`: run the frontend quality gates.
- `cd backend && uv venv && uv pip install -r requirements.txt`: prepare the Python 3.12 environment.
- `cd backend && uvicorn main:app --reload --port 8000`: run the API locally.
- `cd backend && black --check . && flake8 .`: validate backend formatting and linting.
- `docker compose up -d --build`: start the complete local stack.

## Coding Style & Naming Conventions

Prettier enforces 100-character lines, semicolons, double quotes, trailing commas, and LF endings. ESLint uses `@biu/eslint-config`; justify any suppression. Use two spaces in TypeScript/CSS, PascalCase for React components, `useCamelCase` for hooks, camelCase for variables, and kebab-case package directories. Python follows Black/Flake8 with 88-character lines; use snake_case for modules/functions and PascalCase for classes. Route frontend copy through `apps/vite-app/src/i18n/`.

## Testing Guidelines

Automated coverage is limited: Turbo `test` tasks are placeholders, and `backend/test_user_router.py` is incomplete. Run lint, typecheck, build, and the relevant flow in `docs/PHASE_*_MANUAL_TEST.md`. Name future frontend tests `*.test.ts(x)` and backend tests `test_*.py`; prefer Vitest/React Testing Library and pytest. Add regression tests for defects.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects such as `feat: ...`, `fix: ...`, and `feat(phase6): ...`. Keep commits focused and imperative. Pull requests should summarize behavior, list verification commands, link the issue or phase document, call out migrations/configuration changes, and include UI screenshots. Husky runs lint-staged formatting and ESLint fixes before commit.

## Security & Configuration

Never commit `.env`, credentials, provider API keys, or user data. Use local environment overrides, preserve the existing mock-auth boundary unless the task explicitly changes authentication, and review Alembic migrations before applying them outside development.
