# RF-07 Web Docker 配方与上下文边界验证

> 对应任务：A74 b/r0  
> 日期：2026-11-01  
> 状态：静态配方已修正并停在 Review；未拉取或构建镜像，RF-07 整项保持未勾选。

## 1. 基线

本轮从 `codex/rf07-web-docker-recipe` 的
`5291207fcaf27025d0b7fae5782d439efc7f6654` 启动，工作树干净。Compose 的
`echotalk-web` build context 是仓库根，Dockerfile 位于 `apps/vite-app/Dockerfile`。
基线仍使用 Node 20、未固定的 `npm install -g pnpm`，且仓库根没有 `.dockerignore`。

## 2. Node 与 pnpm 配方

- builder 镜像改为 `node:22-alpine`，与 CI 的 Node 22 对齐。
- 删除 `npm install -g pnpm`，改为 `corepack enable pnpm && corepack install`。
- `corepack install` 从仓库根 `package.json` 的 `packageManager` 读取唯一版本声明
  `pnpm@10.26.0`，Dockerfile 不再维护重复版本号。
- 未设置 `COREPACK_INTEGRITY_KEYS`，也未关闭下载提示或签名校验；版本下载、签名校验或
  frozen install 任一失败都会令 Docker `RUN` 非零退出。
- 既有 Vite build args、认证环境变量、`pnpm install --frozen-lockfile --filter vite-app...`、
  Nginx 配置、LiveKit 代理转换、端口与启动命令保持不变。

Node 22 基础镜像内 Corepack 的具体版本及其对 pnpm 10.26.0 的签名校验链未在本轮实测；
不能仅由静态写法推断所有镜像版本均可下载。

## 3. 根构建上下文

新增仓库根 `.dockerignore`，先以 `**` 排除整个上下文，再显式放行：

- 根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`；
- `packages/configs` 下真实 workspace 配置；
- Vite 的 `package.json`、`index.html`、源码、脚本、Vite/TypeScript/PostCSS/Capacitor
  配置、公开字体资源、生成 API 类型、Nginx 配置与 Dockerfile；
- 两份 tracked 公开环境文件 `apps/vite-app/.env.development` 与 `.env.production`。

允许列表未读取环境文件内容。除上述两份公开文件外的 dotenv、根 `.env*`、`.review/`、
`.git/`、`.agents/`、`.codex/`、`node_modules`、dist/Turbo/Vite/test 缓存、iOS 原生工程、
Playwright E2E 与其他无关仓库内容均不进入 Web 上下文。根规则只服务当前 `context: .` 的
Web 构建；`backend/.dockerignore` 和独立后端 build context 未修改。

规则顺序以 Docker 的末次匹配语义为准：`public/**`、`scripts/**`、`src/**` 等宽泛目录放行
之后，统一排除任意层级的本地 dotenv、Git/Agent/review 元数据及 node_modules、dist、Turbo、
Vite、coverage 与常见测试缓存；最后才精确恢复 `apps/vite-app/.env.development` 与
`apps/vite-app/.env.production`。因此嵌套目录不会仅因祖先曾被放行而绕过排除。

## 4. 待独立验收

- 主 Agent 停写后运行固定入口的格式、完整三测试树、前端 quality10、schema 与 Ruff 门禁。
- 静态审 Dockerfile 的 Node/Corepack/frozen 命令，以及 `.dockerignore` 与 Dockerfile
  `COPY` 的输入映射。
- 真实 Docker 镜像需在独立授权窗口中验证基础镜像 Corepack 签名链、pnpm 下载、上下文内容、
  frozen install 和最终 Nginx 行为；静态 pattern 模拟不能替代 Docker 引擎结果。
- 远端 CI、真实登录/Provider/LiveKit、部署与发布不在本轮范围。

上述真实镜像与 CI 边界关闭前，不能把 RF-07 整体标记完成。
