# A19 RoomSession 所有权收窄 — 维护候选实施与验收记录

> 日期：2026-11-16；任务包：A19（Room 初始 Web 快照与 RoomContextSync 引用所有权收窄，维护候选）；
> 分支 `codex/a19-room-ownership-maintenance-20261116`；开工与最终核验基线 `0a4b6fdf`（DOC 收口已发布 main，
> mainCI 43744058036，未因 A19 前进）。源码已独立 APPROVED R1，尚未发布；source/main/PR 与 CI 回执由 PR 正文
> 另给，本页不预填、不自引用。

## 范围与实施

A19 候选完成项（最小收窄，白名单两路径）：

- 移除未调用分支：`RoomContextSync` 的 `onRoom` prop、`onRoomRef` ref 及其读写，`roomRef` 由可选改必传，
  删冗余 `if (roomRef)` 守卫。
- 保留 ROOM-02 render 期同步绑定（`roomRef.current = room`）与 ROOM-03 稳定 `[room, roomRef]` effect 依赖，
  保留 Room 替换/卸载时 `stopRoomLocalTracks` 语义。
- 审计保留：初始 Web 快照门禁的临时 `createLifecycleAdapter()` 仅在 `subscribe` 时挂监听、非泄漏，
  保留每次 render 即时读取 hidden/offline 的语义，本轮未为整洁强改。
- 新增同层回归 `apps/vite-app/src/components/conversation/RoomSessionOwnership.test.tsx`（4 条）：
  健康重渲染不误停、StrictMode 挂载后再发布音轨不误停、SDK Room 身份替换 stop 语义、真实
  `startTransition`+`Suspense` 并发挂起下的 render 期绑定。

代码冻结 hash（frozen R1）：

- `apps/vite-app/src/components/conversation/RoomSession.tsx` =
  `81a24d8ad483a70f16708d28126fabed04c5bf83821936ac86da85ffbb138bb2`
- `apps/vite-app/src/components/conversation/RoomSessionOwnership.test.tsx` =
  `a97a4c64e9d3c5f4d6134163033d0f3d2c41c256217ecd04b39e8f17a33ac929`

## 事实时序（R0 测试缺口 → R1）

- R0 新增 4 条测试；第 4 条为同步 `act(forceRender)` 完成 commit 后检查与第 3 条相同的旧/新 stop 结果，
  名称不能证明 render 期绑定；删除 render 绑定后 90/90 仍绿，是非等价测试缺口。
- 父 Harness 私有真实并发反例（`startTransition`+`Suspense`，保持旧 UI 已 commit、新 render 已执行再发 suspend）：
  原实现 91/91 绿，删除 render 绑定后仅该反例 `replacementStop` 目标断言红（91 总、1 失败）。
- R1 只改新增测试文件：删除重复的第 4 条同步用例，替换为真实并发用例（挂起窗口内验证 render 期绑定已前进
  `roomRef`，suspend 同步停止新 Room 音轨）。产品代码未改。

## 变异证据（父私有副本，目标 AssertionError RED 后逐字节恢复 90/90）

| 变异      | 生产位置                                                     | 目标断言                                                                                                                                                                                               | 结果            |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| render    | `RoomSession.tsx:485`（render 期 `roomRef.current = room`）  | `RoomSessionOwnership.test.tsx:252`（stops the newly rendered replacement room via render-phase binding while a transition suspends）：expected "vi.fn()" to be called at least once                   | RED；恢复 GREEN |
| wrongroom | `RoomSession.tsx:491`（cleanup `stopRoomLocalTracks(room)`） | `RoomSessionOwnership.test.tsx:196`（stops the replaced SDK room's tracks...）：expected "vi.fn()" to be called 1 times, but got 0 times                                                               | RED；恢复 GREEN |
| unstable  | `RoomSession.tsx:496`（effect 依赖 `[room, roomRef]`）       | `RoomSessionOwnership.test.tsx:160`（keeps the room owned across healthy re-renders without stopping a published track）：expected "vi.fn()" to not be called at all, but actually been called 2 times | RED；恢复 GREEN |

R0 删 render 绑定存活 90/90，不计有效 kill；正式 lane 从未变异，三个私有副本均磁盘备份/finally 逐字节恢复，
formal source/test hash 不变。

## 验收结果（父 Harness macOS 亲跑，非 CI）

17 门禁全 success（以共享 `shared-validation-r1.json` 为事实依据，直接摘关键结果）：

- Vitest 1264 passed / 56 文件（命令用时 11.51s）
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 962 passed / 3 warnings / 80.63%（59% 门禁达标；原生 69.25s，命令 73.54s）
- 完整 E2E 258（expected 258 / skipped 0 / unexpected 0 / flaky 0；C129/W129；原配置 retries 2 保持，实际 max retry 0 / skip 0 / flaky 0；原生 68.864s，命令 70.05s）
- 其余门禁（lint/typecheck/build/check-api-types/openapi/providers/backend-format/backend-lint/format/agent-contract/agent-types）均 exit 0

父受控完整 17 门禁命令（非隐藏绝对路径为唯一可见证据）：
`python3 /Users/sunpcm/code/EchoTalk/.review/reports/maintenance-next-wave-20261116/A19/tools/run-checks.py A19 /Users/sunpcm/code/EchoTalk/.review/worktrees/a19-room-ownership-maintenance-20261116 r1full`

代码验收阶段：`all_old_tests_same_bytes: true`、`other715_tracked_files_unchanged: true`（715 个旧 tracked 同字节仅在该阶段成立，最终另有 5 个 MD 变化）；所有旧测试与 411 个 source manifest 始终同字节（含文档收口后）。

## 实施自测（仅实施 Agent，与父 17 门禁分列）

R0/R1 实施方亲跑两个指定测试文件（Node 22.13.1 + pnpm 10.26）：

```text
pnpm --filter vite-app test src/components/conversation/RoomSessionOwnership.test.tsx src/components/conversation/VoiceInterface.test.tsx
```

结果 2 files / 90 tests passed（exit 0）；`pnpm --filter vite-app typecheck`、`prettier --check`（本测试文件）、
`eslint`（本测试文件）均通过。此 90/2 仅为实施方自测，不替代父 Harness 完整 17 门禁（Vitest 1264/56 等）。

## 首工具错误原记录

本实施方 R0/R1 自测无 error 级工具失败。唯一工具侧提示为 `eslint` 既有 warning（`RoomSession.tsx:219`
在 effect cleanup 中对 `roomRef.current` 的 ref 提示，非本轮引入），以及 vitest 输出的 Browserslist 数据过期提示
（caniuse-lite 11 个月，非失败）。

## 计划外与措辞精确

- P2 措辞：R1 并发用例中 `Suspender` resolve 后仍可能再次 throw 新 Promise，测试未证明最终 commit 完成；
  验收只证明挂起窗口内 suspend 的同步停止，由 RTL 卸载清理。未在公开报告声称 resolve 证明 commit 已完成；
  不需改测试，不为措辞另开代码返修。

## 未验证

- 三树全量、前端 10 项质量门禁、后端 Ruff/schema、build 由父 Harness 独立亲跑（本页验收结果为父亲跑计数）。
- 未跑 A19 的远端 CI（source/main/PR 未发布）；本作者未连 DB，Harness 完整 pytest 已连唯一指定 PG15.19 合成库；其他 DB/真实 Provider/LiveKit/IdP/iOS 设备未验，未读 `.env`，未执行迁移。
- 未新增依赖、未改锁文件/数据库/生成物。

停 Review；文档收口，不 commit / stage / push / merge。

## 追加更正（2026-11-16 文档收口轮，不改旧前缀）

- 上文「验收结果」E2E 行写「原配置 retries 2 保持」有误，现更正：作者原 R0 `configured_retries[0,0]` 正确；
  Harness 误把辅助汇总显示的 list 长度 2 读成 retries 2，据此错误要求修改并使用了「虚构」词，该反馈撤销。
- 事实：原生本机 JSON projects 为 `[0,0]`（CLI `--retries 0`），CI 为 `[2,2]`，实际执行 retry/skip/flaky 均为 0。
- 旧记录与旧前缀保持不变，本更正仅尾追加；来源与责任准确，不把该误读归作者失误。
- PR190 已公开更正并 fresh 回读同文，代码/测试/CI 结论不受影响。
