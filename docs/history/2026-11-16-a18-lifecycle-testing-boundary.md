# A18 生命周期测试边界收窄 — 维护候选实施与验收记录

> 日期：2026-11-16；任务包：A18（移除产品测试注入及 start/resume 重复的测试选项 plumbing，测试平台假对象移入
> test-only fixture）；分支 `codex/a18-startup-lifecycle-maintenance-20261116`；开工与最终核验基线 `0151223`
> （A19 已发布 main，mainCI 43788320370 首五 success）。源码已独立 APPROVED R0，尚未发布；source/main/PR 与 CI 回执
> 由 PR 正文另给，本页不预填、不自引用。

## 范围与实施

A18 候选完成项（最小收窄，白名单 7 路径）：

- 移除产品 store 的全局测试注入：`conversationSlice.ts` 删除模块级 `testingLifecycleOptions` 与公开
  `_setLifecycleOptionsForTesting`，`conversation.ts` 删除对应再导出。
- 移除 start/resume 重复的测试选项 plumbing：`getLifecycleOptions` 恒 `null`（经 `conversationStartup.ts:116`
  `?? undefined` 与原生产语义等价）、`createLifecycleAdapter()` / `isNativeIos()` 不再读测试选项。
- 平台判定严格经 `detectPlatform()` 判 `ios`，未改用 `nativeAppState` / `capabilities` 替代运行时平台身份。
- 测试平台假对象移入 test-only fixture `conversationLifecycle.test-support.ts`：spyOn `detectPlatform` 与
  `createLifecycleAdapter` 并委托真实 Native/Web adapter，不 mock 空同步订阅/清理。
- 原生命周期业务差异与准备段重复经审计保留（不抽认证 helper、不合并 resume/start 流程），不声称完整统一 runner。
- 新增同层回归 `conversationPlatform.test.ts`（6 条）覆盖 iOS start/resume 挂起零下行、10s 超时 fail-close、
  Web 快路/拒绝、每次调用动态读平台；H1 一条断言改「动态读 `detectPlatform()`」的更强等价边界。

代码冻结 hash（frozen R0，`shared-validation-r0.json` 为准）：

- `apps/vite-app/src/store/conversationSlice.ts` =
  `71896dba718c7a0ff9cc829327da97726608ac862f6e6b78f7fc71651738b9e2`
- `apps/vite-app/src/store/conversation.ts` =
  `e8b2f141795fecc3a737e72335fd9de1774938979e0be8c93fbda2be682f0af8`
- `apps/vite-app/src/store/conversation.test.ts` =
  `fc1ff161c58449d0fa0104e301a7fcd7e652c8c8ddfa5b25dc88ab87ef03f4d2`
- `apps/vite-app/src/store/navigation.test.ts` =
  `46089052d48f74b033d3c1c7c049f2c0b642bf9977bf47980354329507a88221`
- `apps/vite-app/src/store/conversationStartup.test.ts` =
  `b1adfe635f4cb2815d30eb1d9b6f5ad7cfc654741086d6f1673b844cc6aeb80a`
- `apps/vite-app/src/store/conversationLifecycle.test-support.ts` =
  `0ba17e6bc88fcb9ecde216e2ece58f224d97cfc5183181a6a91c25578e111c3d`
- `apps/vite-app/src/store/conversationPlatform.test.ts` =
  `8595f6cea8ca0b9d3cdb780830c8ff6a2424b0f8ae4c4d59fe7b84fb0f7ca47b`

## 事实时序（scope 审计 → 代码实施）

- scope 审计 R0 → R1（只读，无代码白名单）：R1 撤销 R0「setter 无法消除」「唯一办法 resume 走同款 ports」「唯一零风险」
  等未证绝对结论，更正 Roadmap §7 引用、reset 差异可由闭包参数保留、行号（`startSession` 实现 399/401 非 385）与
  契约测试场景（§7 健康重渲染/StrictMode/SDK 对象替换是 A19 组件用例，非 store 工厂验收）。
- scope-decision-r1：授权 7 路径代码实施——只删产品 `testingLifecycleOptions` 及公开 setter，测试平台假对象移 test-only
  fixture；保留 `currentStartupTracker` 与全部业务流/代际/返回值/补偿/同步读/await 边界，`conversationStartup.ts` 及其
  ports 原契约不改。
- 代码实施一次通过独立 APPROVED R0，无代码返修（scope 审计 R0/R1 属只读审计修正，不计代码返修）。

## 变异证据（父私有副本，3 目标 AssertionError RED 后逐字节恢复 146 GREEN）

| 变异                  | 生产位置                   | 目标断言                                                           | 结果            |
| --------------------- | -------------------------- | ------------------------------------------------------------------ | --------------- |
| 缓存首次平台          | `conversationSlice.ts:47`  | `conversationPlatform.test.ts:214` idle 应为 connecting            | RED；恢复 GREEN |
| start 原生门禁 false  | `conversationSlice.ts:305` | iOS start keeps pending...expected 'idle' to be 'checking_health'  | RED；恢复 GREEN |
| resume 原生门禁 false | `conversationSlice.ts:631` | iOS resume keeps pending...expected 'idle' to be 'checking_health' | RED；恢复 GREEN |

筛选 RED 仅跑目标 case，其他 filter 未运行不充当全量通过；恢复 GREEN 跑 4 文件 146 条，0 skip。formal 未变异，正式 7 文件
SHA 未变（`shared-mutation-evidence-r0.md` 可读）。

## 验收结果（父 Harness macOS 亲跑，非 CI）

17 门禁分阶段过（以 `shared-validation-r0.json` 为事实依据）：

- Vitest 1270 passed / 57 文件
- Fake API 契约 125 passed、API 类型生成器 10 passed、构建脚本 21 passed
- backend pytest 962 passed / 3 warnings / 80.63%（原生 81.45s，命令 86.89s）
- 完整 E2E 258（expected 258 / skipped 0 / unexpected 0 / flaky 0；C129/W129；有效 projects retries[0,0]，实际
  max retry / skip / flaky 0；原生 90.358516s，命令 91.49s）
- 首次 E2E 2.12s exit1：18181 端口被占用导致启动失败、0 用例执行；端口自行释放后补跑，未关闭未知进程
  （诊断未发现监听者）
- 其余门禁（lint/typecheck/build/check-api-types/openapi/providers/backend-format/backend-lint/format/agent-contract/agent-types）
  均 exit 0

旧断言核对：716 个原 matcher 调用中 715 个同文；唯一差异为已授权的 H1 旧测试选项参数 `[[webOptions]]` → `[[undefined]]`，
业务断言保留。

父受控完整 17 门禁命令（非隐藏绝对路径为唯一可见证据）：
`python3 /Users/sunpcm/code/EchoTalk/.review/reports/maintenance-next-wave-20261116/A18/tools/run-checks.py A18 /Users/sunpcm/code/EchoTalk/.review/worktrees/a18-startup-lifecycle-maintenance-20261116 r0full`
（补跑 E2E series `r0e2e`）。

代码验收阶段：`source_manifest_count` 413、`source_stable: true`。

## 实施自测（仅实施 Agent，与父 17 门禁分列）

R0 实施方亲跑 4 项（Node 22.13.1 + pnpm 10.26，经 `check.py` vitest/typecheck/lint/format）：

- 首轮 typecheck 失败：4 条 TS 错误（3× `AppStateSource` 找不到 + 1× `getLifecycleOptions` 返回类型不匹配），修复后通过。
- 首轮 format 失败：3 文件需 Prettier 格式化，`prettier --write` 后通过。
- 最终：vitest 57 文件 / 1270 tests、typecheck exit 0、format exit 0、lint 0 error / 132 warning（130
  `@typescript-eslint/no-explicit-any` / 2 `react-hooks/exhaustive-deps`，均为既有）。

自测证据在 `implementer/ev/ev-a18-{vitest,typecheck,format,lint}-r2.txt`（首失败 `-r0` / `-r1` 原样保留）。

## 首工具错误原记录

- 自测首 typecheck 4 TS 错误、首 format 3 文件失败如上；后续修正不混为首轮全绿。
- ev 头 `# cwd=/Users/sunpcm/code/EchoTalk head=c5675c1` 只是 ev.sh 的启动位置（主 checkout），不代表测试跑在主
  checkout；受控 runner 真实目录由 check.py `CHECK <step> cwd=.../a18-startup-lifecycle-maintenance-20261116` 给出，
  父受控全部 cwd 正确。
- 父首次 E2E 环境启动阻断（18181 端口占用）0 用例，端口自行释放后补跑；未关闭任何未知进程（诊断未发现监听者）。

## 计划外与关联纠错

- 关联 A19 retries 纠错：A19 作者原 R0 `configured_retries[0,0]` 正确；Harness 误把辅助汇总显示的 list 长度 2 当 retries 2，
  错误要求修改并用了「虚构」词，该反馈撤销。原生本机 JSON projects[0,0]（CLI --retries 0）、CI[2,2]、实际都 0；来源与责任
  准确，不归作者失误。PR190 已公开更正并 fresh 回读同文，代码/测试/CI 结论不受影响（详见旧 A19 history 尾追加纠错）。
- H1 当轮「两旧测试零改」为历史轮事实；A18 本轮迁移测试注入（3 个旧测试文件 setter → test-only fixture），旧业务断言
  715/716 同文，仅 1 处已删除测试参数断言改动态平台，二者不混淆。

## 未验证

- 三树全量、前端 10 项质量门禁、后端 Ruff/schema、build 由父 Harness 独立亲跑（本页验收结果为父亲跑计数）。
- 未跑 A18 的远端 CI（source/main/PR 未发布）；本作者未连 DB，Harness 完整 pytest 已连唯一指定 PG15.19 合成库；
  其他 DB/真实 Provider/LiveKit/IdP/iOS 设备未验，未读 `.env`，未执行迁移。
- 未新增依赖、未改锁文件/数据库/生成物。

停 Review；文档收口，不 commit / stage / push / merge。
