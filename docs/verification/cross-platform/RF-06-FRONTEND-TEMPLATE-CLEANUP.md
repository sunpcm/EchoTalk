# RF-06 无消费者前端模板清理验证

> 对应任务：A73 b/r0  
> 日期：2026-11-01  
> 状态：A73 已完成文件实施、原生锁重生成、本地门禁与 main 精确集成；真实 Docker 镜像、
> 远端 CI 与 API/Agent 角色分组仍未验收，RF-06 整项保持未勾选。

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

`pnpm-lock.yaml` 未由实施方手写、编辑、安装或生成。主 Agent 使用 Node 22、pnpm 10.26.0
原生执行 lockfile-only 与 offline frozen install：packages/snapshots 由 1288/1289 收敛为
656/657；所有存活 packages 的 version/integrity、保留下来的解析依赖边与 importer 保持。
逐项审查的原生 metadata 变化仅为 6 个精确 optional metadata 字段由缺省状态新增为 true
（原生锁新增该字段），另移除 1 个无消费者 catalog 锁项；它们不构成 metadata 任意漂移的
通用放行。正常 Prettier 规范化后，最终 `pnpm-lock.yaml` SHA-256 为
`37d4ddf0aec83ff8501b7daff87263ae3f4c2c8a8d608efc07b17a9685c276fe`，随后复验冻结安装。

## 4. 已完成验证与剩余边界

A73 已定格为单提交 `5291207fcaf27025d0b7fae5782d439efc7f6654`，并精确 fast-forward
本地 main；正常 hook 后批准文件 hash 一致。main 最终复验结果如下：

- formatter、lint、typecheck、完整 frontend10 通过：917 Vitest、18 build-script、
  61 Fake API、8 类型生成器、148 E2E。
- OpenAPI schema、Ruff 与专用 PostgreSQL backend pytest 通过：566 passed，覆盖率 80.10%。
- A73 lane 独立执行 root 真实强制 test，确认只运行 Vite 的 917 项且不含共享配置占位任务；
  main 未复跑该 root test。
- lane 在合成 OIDC 下完成 Web/iOS production-mode 构建及真实 Capacitor 资源同步；guard
  未触发网络或原生工具，临时 tracked native config 已逐字还原。main 未重跑平台构建。
- 4 份品牌 SVG 的最终 SHA-256 与迁移前一致，README 资源路径存在。
- 未验证真实登录、签名、Xcode/SPM 网络、原生编译或设备链路，不能由上述本地检查替代。
- Web Docker 的真实镜像构建、基础镜像 Corepack 签名链、实际 COPY/context 与远端 CI 仍待独立
  验收；这些边界不因本轮新增
  [RF-07 Web Docker 配方验证](./RF-07-WEB-DOCKER-RECIPE.md)的静态配方而关闭。

后端源码、`backend/uv.lock`、schema/types 产物以及产品 UI/认证/API/store/主题/原生生命周期
本轮均未修改。
