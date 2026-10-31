# RF-06 无消费者前端模板清理验证

> 对应任务：A73 b/r0  
> 日期：2026-11-01  
> 状态：只文件实施完成并停在 Review；锁文件原生重生成、全部检查、实际构建/同步、Docker 镜像
> 与独立 Review 待主 Agent 执行。

## 1. 引用审计与删除范围

以 `b2b02b3bf647676e903b3d9b837e2be4b1133b90` 为基线，使用 tracked 文件清单与
`git grep` 审计 import、workspace、Turbo、CI、Vite Dockerfile、Compose、README 和脚本引用。
Vite 产品源码没有 `@biu/ui-lib` 消费者，CI/Compose/Vite Dockerfile 没有 Webpack、Plop 或
Changesets 的直接调用。根脚本入口不代表产品消费，因此随无价值模板一并移除。

共删除 31 个 tracked 文件：

- `apps/webpack-app/`：15 个 Webpack/Babel 模板、配置、环境和页面文件。
- `packages/ui-lib/`：9 个无产品消费者包文件；其中 4 份品牌 SVG 先迁移保留。
- `.changeset/`：2 个 Changesets 配置文件。
- `plop-templates/`：4 个生成模板。
- `plopfile.cjs`：1 个生成器入口。

目录内 ignored 缓存、`node_modules` 和不明本地文件未递归删除。A47 根清理与 CP-05 主题
token 文档中的历史 Webpack 消费证据保持原样，不解释为“从未存在消费者”。

## 2. 品牌资产迁移

4 份 SVG 在删除源文件前复制到 `docs/assets/branding/`，逐份 SHA-256 与源文件一致：

| 文件                           | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `echotalk-app-icon.svg`        | `4102241954d8661a2d1ede5a07bb888a5401109aa8fbb80173647e31e1fee804` |
| `echotalk-logo-dark.svg`       | `30ad218de6898f2216ac4c62aff59cedceec7633ac544200979ba817db945e51` |
| `echotalk-logo-light.svg`      | `35c6cfbc123e76b84eaf253239e103a148660175700ab7b96322d9040e37c367` |
| `echotalk-logo-monochrome.svg` | `5f67681e4536bbfe48452cb73c61aeb9e4e9feb387848648ad8212d2c5d88a66` |

README 的 logo 相对路径已更新到新位置。没有重绘 SVG、新增 npm 包或改动主题 token。

## 3. 配置减法

- 根 `package.json` 移除 Webpack dev/analyze、Plop 生成脚本及 `@changesets/cli`、`plop`；
  其他脚本与依赖保持。
- `apps/vite-app` 只移除 `@biu/ui-lib` 声明和 Vite `optimizeDeps` 项，其余构建、代理、认证、
  安全与 Capacitor 配置保持。
- `pnpm-workspace.yaml` 只移除 Webpack 专属 `type-fest` peer override，catalog 保持。
- `turbo.json` 只移除 Babel/Webpack/`SOURCE_MAP` 等无消费者输入，保留 Vite、Web、iOS、
  Fake API、类型、测试、构建输出与安全门禁。
- 四个共享配置 package 只删除 no-tests 占位脚本；真实配置、依赖和 `theme.css` token 保持。
- `.prettierignore` 只移除已删除 Plop 模板条目。

`pnpm-lock.yaml` 未由实施方手写、编辑、安装或生成。主 Agent 须在停写后使用 Node 22、
pnpm 10.26.0 原生执行 lockfile-only 与 offline frozen install，并审查所有存活 package
记录。

## 4. 待主 Agent 验收

本 b/r0 未运行检查、formatter、安装、build、原生同步、服务或 Git 写操作。以下均待主 Agent
受控执行并独立核验：

- lockfile-only 原生重生成、offline frozen install 与存活依赖审计。
- formatter、lint、typecheck、完整 frontend10、OpenAPI schema、Ruff 与专用 PostgreSQL
  backend pytest。
- Turbo/root 任务不再出现 no-tests 伪任务。
- 完整 tracked 引用审计、4 份 SVG 字节一致性与 README 资源存在。
- 实际本地 Web/iOS build 与 Capacitor sync 不依赖删除目录。
- Vite Docker 配方静态检查与真实镜像构建；未能实际执行时 RF-06 整体保持未勾选。
- 未签名、未联网 Xcode/SPM、未访问设备或执行发布；这些边界不得由本地脚本替代。

后端源码、`backend/uv.lock`、schema/types 产物以及产品 UI/认证/API/store/主题/原生生命周期
本轮均未修改。
