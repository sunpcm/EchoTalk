# RF-03 真实鉴权与版本化凭据密钥实施报告

> 状态：READY FOR INDEPENDENT REVIEW
>
> 报告日期：2026-09-21
>
> 工作分支：`codex/mvp-remediation`
>
> 实施提交：`66bdf3c01703f9a4260e90e3ef873dc13ffc59d4`
>
> 实施父提交：`2da20be245169cf365f8536a9c81141ce4bfb200`
>
> 审查范围：`2da20be245169cf365f8536a9c81141ce4bfb200..66bdf3c01703f9a4260e90e3ef873dc13ffc59d4`

## 1. 结论摘要

本次改动以外部 OIDC 作为唯一生产鉴权方案，没有在 EchoTalk 内自建密码、找回、
MFA 或会话体系。Web 使用 Authorization Code + PKCE；API 校验 JWT 签名、`issuer`、
`audience`、`exp` 与 `sub`，并按不可变的 `(issuer, subject)` 映射本地用户。

本地开发保留单独的 `AUTH_MODE=dev`，但必须显式配置 `DEV_AUTH_TOKEN`；无 Token、
错误 Token 或缺失关键配置不会回退为固定用户。所有受保护路由统一消费强类型
`CurrentUser`，会话、评估、设置和学习状态继续以本地 `user_id` 做资源归属限制。

BYOK 凭据加密已与认证材料彻底分离。新写入使用独立、带版本号的 Fernet keyring；
历史 JWT 派生密文被保留并标记为 `legacy-jwt-derived-v1`，在提供旧解密秘密时仍可读取，
并可在设置更新路径惰性重加密为 active key。

`TODO.md` 中 RF-03 和两项 P0 鉴权任务已标记完成，但该状态仍以本次独立 review 结论为准。

## 2. 范围与明确排除项

### 本次范围

- 后端 OIDC JWT/JWKS 校验与 JWKS TTL 缓存。
- 显式、隔离的本地 dev-auth。
- 外部身份到本地用户的映射与首次登录自动建用户。
- 全路由统一 `CurrentUser` 类型和资源归属查询。
- 前端 OIDC AuthProvider、PKCE 回调、登录门禁、退出和过期状态处理。
- 认证材料与 BYOK 加密材料分离。
- 密文 key version、历史数据迁移和惰性重加密能力。
- Provider 凭据验证错误分类与日志脱敏。
- Docker/Vite 构建参数、环境样例、README、计划和 TODO 同步。
- 单元、PostgreSQL 集成、迁移和浏览器 E2E 证据。

### 不在本次范围

- 不选择或创建具体生产 IdP tenant/client。
- 不验证真实生产 IdP、真实 Provider 凭据或 iOS 真机。
- 不 push、不创建 PR、不部署、不修改远端分支保护。
- 不在本阶段完成 RF-05 至 RF-12。
- 不顺带修复既有 timezone-naive `datetime.utcnow()`、前端 `any` 警告或大 bundle；
  它们分别属于 RF-08/RF-11 等后续阶段。

## 3. 关键设计裁决

### 3.1 认证方案：外部 OIDC，不自建账号体系

选择 `oidc-client-ts@3.5.0` 处理 Web Authorization Code + PKCE、state/nonce、回调和
session storage；后端使用现有 `python-jose` 校验 Bearer JWT。这样避免在仓库内新增密码
哈希策略、注册、找回、邮箱验证和 MFA 等长期安全维护面。

后端模式互斥：

- `AUTH_MODE=oidc`：必须配置 HTTPS issuer、audience、JWKS URL 和非开发凭据 keyring。
- `AUTH_MODE=dev`：必须显式配置 `DEV_AUTH_TOKEN`；仅供本地开发和 E2E。
- 非法模式、缺失 Token 或关键配置缺失均 fail closed。

### 3.2 用户身份：不可变外部主体映射本地 UUID

`users` 增加 `auth_issuer` 和 `auth_subject`，并建立联合唯一约束
`uq_users_auth_identity`。授权和资源归属仍使用本地 UUID，绝不按可变 email 匹配已有账号，
避免 email claim 变化或碰撞导致账号接管。

### 3.3 凭据加密：独立版本化 keyring

- `CREDENTIAL_ENCRYPTION_KEYS`：`{version: fernet_key}` 映射。
- `ACTIVE_CREDENTIAL_KEY_VERSION`：新密文使用的版本。
- `LEGACY_CREDENTIAL_DECRYPTION_SECRET`：仅用于迁移历史 JWT 派生密文。
- `stt_key_version`、`llm_key_version`、`tts_key_version`：逐字段保存版本，避免部分更新时
  一个共享版本破坏未更新字段。

生产 OIDC 模式拒绝仓库内置的 dev Fernet key。认证签名材料轮换不再影响 BYOK 解密。

### 3.4 Provider 错误分类和脱敏

拨测结果不再只返回布尔值，现区分：

- `verified`
- `auth_error`
- `rate_limited`
- `timeout`
- `network_error`
- `provider_error`
- `unsupported_provider`
- `missing_key`

日志只记录 provider 和稳定错误码，不记录 API key、Authorization header、上游响应体或原始
异常正文。设置 API 的 422 响应只返回分类后的 provider 错误映射。

## 4. 实现明细

### 后端认证

- `backend/auth.py`
  - `AuthIdentity` / `CurrentUser`。
  - RS256/ES256 allowlist。
  - `kid` 查找和未知 key 强制刷新一次 JWKS。
  - issuer/audience/signature/expiration/subject 校验。
  - JWKS 5 秒请求超时和 TTL 缓存。
- `backend/dependencies.py`
  - 严格解析 Bearer header。
  - dev token 使用 constant-time comparison。
  - 按 `(issuer, subject)` 查找或创建本地用户。
  - 不按 email 合并现有账号。
- `backend/config.py`
  - 启动期安全配置检查。
  - OIDC 模式强制 HTTPS 和独立生产 keyring。
- `backend/main.py`
  - 删除 lifespan 中固定 Mock 用户播种。
  - lifespan 首先执行安全配置验证。

### 路由与资源归属

以下路由由 `dict` 当前用户迁移为强类型 `CurrentUser`，并统一使用 `current_user.id`：

- `routers/sessions.py`
- `routers/assessment.py`
- `routers/conversation.py`
- `routers/curriculum.py`
- `routers/health.py`
- `routers/user.py`

PostgreSQL 集成测试使用两个真实用户确认：攻击者读取 owner session 返回 404，owner 读取返回 200。

### 前端认证

- `apps/vite-app/src/lib/auth.ts`
  - 唯一 token provider 边界。
  - OIDC callback、登录、退出、过期和 user unloaded 事件。
  - token 只保存在 `sessionStorage`；无生产默认 token。
- `components/auth/AuthGate.tsx`
  - 恢复登录态前不渲染业务应用。
  - 未登录、配置错误和 callback 错误有明确状态。
- `lib/api.ts`
  - 每次请求从 AuthProvider 获取当前 token。
  - 登录态退出后立即停止发送 Authorization header。
- E2E fake API 除基础 health 外强制要求显式 `e2e-dev-token`。

### 数据迁移和旧密文

迁移 `b6d7e8f901a2_add_oidc_identity_and_key_versions.py`：

- 添加用户外部身份字段和联合唯一约束。
- 为 STT/LLM/TTS 各自添加 key version。
- 已存在且非空的密文保持原值，并标记 `legacy-jwt-derived-v1`。
- downgrade 删除新增字段/约束，不删除原密文。

实际历史行升级验证结果：

```text
legacy-jwt-derived-v1|legacy-jwt-derived-v1||legacy-stt|legacy-llm
```

## 5. 验证证据

### 后端完整门禁（真实 PostgreSQL）

```bash
docker run --rm -d --name echotalk-rf03-review-pg \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_USER=echotalk \
  -e POSTGRES_DB=echotalk \
  -p 127.0.0.1:25433:5432 \
  postgres:15.19-alpine
docker exec echotalk-rf03-review-pg pg_isready -U echotalk -d echotalk

cd /Users/sunpcm/Documents/Codex/2026-09-08/new-chat/work/EchoTalk-mvp-remediation/backend
DATABASE_URL=postgresql://echotalk:test@127.0.0.1:25433/echotalk \
  uv run alembic upgrade head
DATABASE_URL=postgresql://echotalk:test@127.0.0.1:25433/echotalk uv run ruff check .
DATABASE_URL=postgresql://echotalk:test@127.0.0.1:25433/echotalk \
  uv run pytest --cov=. --cov-report=term-missing -q

docker stop echotalk-rf03-review-pg
```

结果：`131 passed`，总覆盖率 `66.53%`，超过门禁 `59%`。

### 迁移验证

已在 `postgres:15.19-alpine` 临时实例执行：

1. 空库 `alembic upgrade head`。
2. `head -> a5c6d7e8f901` downgrade。
3. 再次 upgrade 到 `b6d7e8f901a2`。
4. 在旧 schema 插入历史密文，再升级并核对密文未变化、版本正确标记。
5. 运行分析任务和资源归属 PostgreSQL 集成测试。

临时容器 `echotalk-rf03-pg` 已停止并自动删除。

### 前端门禁

```bash
cd /Users/sunpcm/Documents/Codex/2026-09-08/new-chat/work/EchoTalk-mvp-remediation
pnpm format:check
pnpm --filter vite-app lint
pnpm --filter vite-app typecheck
pnpm --filter vite-app test
pnpm --filter vite-app build
pnpm --filter vite-app test:e2e
docker compose config --quiet
```

结果：

- Vitest：`80 passed`。
- Playwright Chromium：`6 passed`。
- TypeScript、Prettier、生产构建、Compose 渲染通过。
- ESLint 无 error，保留 `api.ts` 两个既有 `no-explicit-any` warning。
- Vite 保留大于 500 kB 的 bundle warning；当前主 bundle约 `761.47 kB`，gzip约
  `216.94 kB`。

### 核心安全用例

- 无 Authorization、非法 scheme、空 Bearer、伪造 dev token：401。
- 有效 OIDC RS256 token：通过。
- 过期或错误私钥签发 token：401。
- OIDC 关键配置缺失、HTTP issuer/JWKS、默认 dev keyring：启动配置校验失败。
- 不同用户读取他人 session：404。
- 旧 keyring 版本：可读取并提示 rotation。
- 历史 JWT 派生密文：无 migration secret 时 fail closed；配置后可读取。
- 日志测试：测试密钥和模拟上游原始正文未进入日志。
- 前端 token provider 切换到 null 后，后续请求不再带 Authorization。

## 6. 已知边界与 reviewer 必查项

以下内容不是“已验证通过”的声明，请 reviewer 独立裁决严重度：

1. **未连接真实 IdP。** 当前证明来自本地 RSA 签名测试和标准客户端行为，不构成生产 tenant、
   redirect URI、CSP、登出回调或真实 JWKS 可用性证据。
2. **首次 OIDC 自动建用户没有并发竞争集成测试。** 数据库联合唯一约束能防止重复身份，
   但两个完全并发的首次请求可能让其中一个事务收到唯一约束异常，而不是自动读取胜出的用户。
3. **惰性重加密的持久化触发点有限。** `PUT /api/user/settings` 读取已有凭据时会重加密并随
   事务回写；LiveKit Agent 能按旧版本解密，但该读取路径目前不把新密文持久化回数据库。
   请判断这是否满足 RF-03 的“逐步迁移”，或应要求 Agent/CredentialResolver 统一回写。
4. **没有 silent renew。** `automaticSilentRenew=false`；token 到期后 AuthGate 回到登录页，
   用户必须重新登录。这是 fail-closed 选择，但可能影响长时间会话体验。
5. **历史 Phase 5 文档仍描述旧 JWT 派生方式。** README、活跃修复计划和 TODO 已同步；
   `docs/PHASE_5_*` 作为历史阶段文档未重写。请判断是否需要显式加“已过时”横幅。
6. **现有告警未在本阶段消除。** 包括 timezone-naive datetime、前端两个 `any`、Browserslist
   数据陈旧和大 bundle；这些已分别留给 RF-08/RF-11/依赖阶段。

## 7. 建议审查顺序

1. 先确认 Git 基线和范围没有漂移。
2. 审查 migration 的 upgrade/downgrade 与历史数据兼容。
3. 审查 `backend/config.py`、`backend/auth.py`、`backend/dependencies.py` 的 fail-closed 边界。
4. 审查所有 route 的 owner filter，没有只做认证、遗漏授权。
5. 审查 `utils/crypto.py`、`routers/user.py`、Agent 解密路径的 key version 行为。
6. 审查 Provider 拨测是否可能把 key、header、响应体或异常正文写入日志/API。
7. 审查前端 AuthGate、callback、退出、过期事件和 API token 注入。
8. 运行与风险相称的测试；不要只依据本报告给出的数字。
9. 最后检查 README、TODO 和实施计划是否与代码一致。

## 8. Reviewer 输出契约

Reviewer 应创建独立 review 报告，至少包含：

- 实际核对的 HEAD、父提交和 diff 范围。
- 按严重度排序的 findings；每项包含文件、行号、触发条件、影响和建议修复。
- 对第 6 节每个已知边界的裁决。
- 实际运行的命令和结果；无法运行的验证必须明确写出。
- 迁移/回滚、认证/授权、密钥生命周期、日志脱敏和前端登录态的分别结论。
- 唯一最终结论：`APPROVED` 或 `CHANGES REQUESTED`。

若存在任何会造成认证绕过、跨用户读取、旧密文不可恢复、生产静默使用 dev 配置、密钥泄露、
迁移破坏或无法证明的关键验收条件，应返回 `CHANGES REQUESTED`。

## 9. 可直接交给另一个 Agent 的 Review 指令

```text
你只负责独立 review，不修改代码、不提交、不 push、不创建 PR、不部署。

工作目录：
/Users/sunpcm/Documents/Codex/2026-09-08/new-chat/work/EchoTalk-mvp-remediation

目标分支：codex/mvp-remediation
RF-03 实施父提交：2da20be245169cf365f8536a9c81141ce4bfb200
RF-03 实施提交：66bdf3c01703f9a4260e90e3ef873dc13ffc59d4
唯一代码审查范围：
2da20be245169cf365f8536a9c81141ce4bfb200..66bdf3c01703f9a4260e90e3ef873dc13ffc59d4

先阅读：
1. docs/RF-03_IMPLEMENTATION_REPORT.md
2. docs/MVP_REFACTORING_REMEDIATION_PLAN.md 的 RF-03
3. TODO.md 的 RF-03 与 P0 鉴权条目
4. 上述精确 diff

约束：
- 不要相信实施报告中的测试数字，必须从当前 Git、源码、迁移和实际测试独立验证。
- 不得 stash/reset/rebase/checkout 覆盖，不得修改原始工作区或其他 worktree。
- 如果 HEAD、父提交、工作树或审查范围发生漂移，立即停止并报告，不要自行修复。
- 重点审查认证绕过、issuer/audience/JWKS、过期与伪造 token、首次用户并发创建、
  跨用户资源归属、生产 fail-closed、key version/旧密文/惰性重加密、Provider 错误分类、
  日志脱敏、OIDC callback/退出/过期登录态、迁移升级与回滚。
- 将真实 IdP、真实 Provider、iOS 真机、push/PR/deploy 视为未授权且未验证边界。

请把 review 报告写到：
docs/RF-03_INDEPENDENT_REVIEW.md

最终回复必须以且仅以以下之一结束：
APPROVED
CHANGES REQUESTED
```
