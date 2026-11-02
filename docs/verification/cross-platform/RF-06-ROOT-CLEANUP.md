# RF-06 根元数据与一次性诊断脚本清理验证

> 实施日期：2026-10-26
> 代码分支：`codex/rf06-root-cleanup`
> 对应任务：A47 / RF-06 根元数据与一次性诊断清理（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF06“清理前端模板”与 A47 实施契约：

1. **根元数据规范化**：修复历史遗留的模板元数据（原 `name: "monorepo-study-note"`、空的 `description` 及指向不存在根文件的无效 `main: "index.js"`）。将 `name` 正式更新为 `"echotalk"`，添加准确的项目 `description`，显式声明 `"private": true` 杜绝意外发布至包管理器，并彻底删除无效的 `main` 字段。
2. **不变性约束**：严格保持既有版本号、license、packageManager、脚本命令定义、devDependencies 依赖及 pnpm-lock.yaml 锁文件不变；保持 Turbo、Docker、Capacitor 及各 workspace 子应用配置一致。
3. **一次性诊断脚本安全清理**：全局引用审计确认根目录 `test_api_err.ts` 仅在评审手册 §2 中提及，非自动化测试 runner，亦无任何构建脚本、源码或 CI 流程调用。完成该历史诊断脚本的安全清理，并同步更新评审手册说明。
4. **范围有界**：本轮不做 Webpack、ui-lib 共享包、Plop 或 Changesets 的清理，整项 RF-06 保持未勾选。

## 2. 本地实现与变更

### 2.1 根包元数据更新 (`package.json`)

- 将 `"name": "monorepo-study-note"` 修改为 `"name": "echotalk"`。
- 添加项目描述：`"description": "EchoTalk - AI-powered real-time English learning and speaking practice platform"`。
- 显式声明 `"private": true`。
- 删除指向不存在根入口文件的 `"main": "index.js"`。
- 其他字段（scripts, devDependencies, lint-staged, prettier, packageManager 等）保持逐字节不变。

### 2.2 一次性脚本清理与引用审计 (`test_api_err.ts`)

- 全局搜索审计结果：`test_api_err.ts` 仅在 `docs/agent-review-loop.md` §2 中作为独立诊断脚本被提及，在 `apps/vite-app`、`apps/webpack-app`、`packages/*`、`backend/*` 以及 CI 配置中均无任何调用者。
- 完成对 `test_api_err.ts` 的安全清理与删除。

### 2.3 评审手册与项目状态同步

- `docs/agent-review-loop.md` §2：更新说明文字，明确根目录历史独立诊断脚本 `test_api_err.ts` 已移除，不属于测试树。
- `TODO.md`：在 RF-06 架构减法条目下追加本地增量记录，整项保持未勾选。
- `docs/PROJECT_STATUS.md`：末尾追加 A47 / RF-06 本地实施记录与决策界限。

## 3. 质量门禁与验证

本地前端质量检查通过固定入口 `python3 /Users/sunpcm/code/EchoTalk/.review/reports/tools/cross-platform-local-check.py b quality` 执行全量 8 项门禁：

1. **格式检查**：`pnpm format:check` 通过，无未格式化文件。
2. **前端 Lint**：`turbo lint --force` 通过，覆盖所有 workspace。
3. **前端类型**：`turbo typecheck --force` 通过。
4. **前端单测**：Vitest 全部通过，无回归。
5. **构建脚本测试**：18 项构建隔离测试全部通过。
6. **Fake API 测试**：真实 Node 子进程回归测试全部通过。
7. **前端构建**：Turbo build 强制构建全部应用通过。
8. **双浏览器 E2E**：Chromium 与 WebKit 双浏览器全量端到端测试全部通过。

## 4. 边界与未验界限

- 本轮仅完成根包项目元数据修正与无调用一次性诊断脚本清理（RF-06 子项），RF-06 整体保持未勾选。
- 未删除 Webpack 构建链路、未清理 packages/ui-lib 共享组件库、未移除 Plop 或 Changesets 相关脚手架与依赖。
- 未修改任何产品业务代码、测试用例或后端服务代码。
- 本地工作停在 Review，未执行 git commit、push 或部署。
