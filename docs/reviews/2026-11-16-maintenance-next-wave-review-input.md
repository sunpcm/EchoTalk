# 2026-11-16 维护下一波复核材料（SGECD 输入）

> 逐包完整 SHA/tree/PR/CI 与关键 CI 原行均直接列于本文件，不依赖本地 `.review/shared`；SGECD 自身为纯设计 MD 补充，
> 最终自身 source/CI/main 回执由 PR 正文，不往文件自引用。

## 冻结汇总

- 基线 `0a4b6fdf716d6925b4a1d6dab5114b6c90383267` → 终点 `9dbc7a8e210398d68c3562433b608ced76226bdd`，tree
  `78e12447ab488c38a2058633d8c2a5653740a570`，共 16 路径（9 非 MD + 7 MD）。
- 9 非 MD：A19 `RoomSession.tsx` + `RoomSessionOwnership.test.tsx`；A18 `conversationSlice.ts`、`conversation.ts`、
  `conversation.test.ts`、`navigation.test.ts`、`conversationStartup.test.ts`、`conversationLifecycle.test-support.ts`、
  `conversationPlatform.test.ts`。

## 逐包完整身份

### A19（Room 所有权收窄）

- baseline `0a4b6fdf716d6925b4a1d6dab5114b6c90383267`；source `d818ac362a77ff9f73f4dc5963c2d59e9a5f237a`；
  ci_merge `d70e384fe0523bf5565b84a46c001942634e4099`；main `0151223747008a0db14531411bf0a5018b6c629a`；tree `f9d3febfe6be20858cf0f6999abda2f98063a975`。
- [PR190](https://github.com/sunpcm/EchoTalk/pull/190) · [PRCI](https://github.com/sunpcm/EchoTalk/actions/runs/43787029589) · [Guard](https://github.com/sunpcm/EchoTalk/actions/runs/43787029674) · [mainCI](https://github.com/sunpcm/EchoTalk/actions/runs/43788320370)。

### A18（生命周期测试边界收窄）

- baseline `0151223747008a0db14531411bf0a5018b6c629a`；source `ae4b901775f47461f327e54e9a4b29fbf969cdb9`；
  ci_merge `ede14669428cd060d6938ce6f8e135962e7866be`；main `0422c9e9828c6e81bb474fccaf5c026727d30483`；tree `2bf51f38fdf63a446a46058412b38ed4e26ac62a`。
- [PR191](https://github.com/sunpcm/EchoTalk/pull/191) · [PRCI](https://github.com/sunpcm/EchoTalk/actions/runs/43798829866) · [Guard](https://github.com/sunpcm/EchoTalk/actions/runs/43798829964) · [mainCI](https://github.com/sunpcm/EchoTalk/actions/runs/43800300024)。

### WGGC（weekly/GC 有界取证）

- baseline `0422c9e9828c6e81bb474fccaf5c026727d30483`；source `b234b51ac21d2e4ade813574400f2ba6b49a14ba`；
  ci_merge `7fbfb58ffc40455dceff4b31830a49b643559cb4`；main `9dbc7a8e210398d68c3562433b608ced76226bdd`；tree `78e12447ab488c38a2058633d8c2a5653740a570`。
- [PR192](https://github.com/sunpcm/EchoTalk/pull/192) · [PRCI](https://github.com/sunpcm/EchoTalk/actions/runs/43803930628) · [Guard](https://github.com/sunpcm/EchoTalk/actions/runs/43803930558) · [mainCI](https://github.com/sunpcm/EchoTalk/actions/runs/43804969728)。

## 逐阶段实测实数

| 包 · 阶段           | Vitest  | E2E C/W · retry/skip/flaky | pytest 警告/覆盖率/秒 | 125/10/21 |
| ------------------- | ------- | -------------------------- | --------------------- | --------- |
| A19 · macOS 亲跑    | 1264/56 | 129/129 · 0/0/0            | 3/80.63%/69.25        | 125/10/21 |
| A19 · PR Linux      | 1264/56 | 129/129 · 0/0/0            | 3/80.63%/61.17        | 125/10/21 |
| A19 · main Linux    | 1264/56 | 129/129 · 0/0/0            | 3/80.63%/65.86        | 125/10/21 |
| A18 · macOS 亲跑    | 1270/57 | 129/129 · 0/0/0            | 3/80.63%/81.45        | 125/10/21 |
| A18 · PR Linux      | 1270/57 | 129/129 · 0/0/0            | 3/80.63%/74.86        | 125/10/21 |
| A18 · main Linux    | 1270/57 | 129/129 · 0/0/0            | 3/80.63%/72.53        | 125/10/21 |
| WGGC · macOS 亲跑   | 1270/57 | 129/129 · 0/0/0            | 3/80.63%/80.64        | 未运行    |
| WGGC · PR Linux     | 1270/57 | 128+1flaky/129 · 2/0/1     | 3/80.63%/46.95        | 125/10/21 |
| WGGC · main Linux   | 1270/57 | 129/129 · 0/0/0            | 3/80.63%/51.16        | 125/10/21 |
| SGECD · macOS fresh | 1270/57 | 129/129 · 0/0/0            | 3/80.63%/80.00        | 未运行    |

> WGGC 与 SGECD 的 macOS 亲跑仅 Vitest/pytest/E2E 三树 + format/Markdown，125/10/21 未运行（不借 CI 当亲跑；WGGC 同源 CI
> 为 125/10/21）。A19/A18 所有 Linux 通过 C129/W129 实际 retry/skip/flaky 均 0；WGGC PR 为 C128 expected + 1 flaky /
> W129 expected，实际 retry2/skip0/flaky1，257 pass。pytest 秒数：A19 69.25/61.17/65.86、A18 81.45/74.86/72.53、
> WGGC 80.64/46.95/51.16、SGECD 80.00。

## 关键 CI 原行（逐字，不改/不缩写）

### A19 PR（run 43787029589）

frontend：

```text
2026-11-16T01:35:01.1914990Z # tests 10
2026-11-16T01:36:09.1899457Z  Test Files  56 passed (56)
2026-11-16T01:36:09.1906110Z       Tests  1264 passed (1264)
2026-11-16T01:36:15.9841968Z # tests 21
2026-11-16T01:36:22.7027591Z # tests 125
2026-11-16T01:43:39.2200770Z   258 passed (7.1m)
```

backend：

```text
2026-11-16T01:35:51.9374211Z Required test coverage of 59.0% reached. Total coverage: 80.63%
2026-11-16T01:35:51.9374533Z ================== 962 passed, 3 warnings in 61.17s (0:01:01) ==================
```

### A19 main（run 43788320370）

frontend：

```text
2026-11-16T01:48:22.0080747Z # tests 10
2026-11-16T01:49:25.4189633Z  Test Files  56 passed (56)
2026-11-16T01:49:25.4194146Z       Tests  1264 passed (1264)
2026-11-16T01:49:32.3212253Z # tests 21
2026-11-16T01:49:38.9483475Z # tests 125
2026-11-16T01:56:49.4404571Z   258 passed (7.0m)
```

backend：

```text
2026-11-16T01:49:20.4173530Z Required test coverage of 59.0% reached. Total coverage: 80.63%
2026-11-16T01:49:20.4174451Z ================== 962 passed, 3 warnings in 65.86s (0:01:05) ==================
```

### A18 PR（run 43798829866）

frontend：

```text
2026-11-16T03:33:37.2277867Z # tests 10
2026-11-16T03:34:47.1233968Z  Test Files  57 passed (57)
2026-11-16T03:34:47.1240915Z       Tests  1270 passed (1270)
2026-11-16T03:34:53.5049570Z # tests 21
2026-11-16T03:35:00.2673274Z # tests 125
2026-11-16T03:42:29.1903256Z   258 passed (7.3m)
```

backend：

```text
2026-11-16T03:34:47.6675811Z Required test coverage of 59.0% reached. Total coverage: 80.63%
2026-11-16T03:34:47.6676226Z ================== 962 passed, 3 warnings in 74.86s (0:01:14) ==================
```

### A18 main（run 43800300024）

frontend：

```text
2026-11-16T03:48:53.5025135Z # tests 10
2026-11-16T03:49:35.6696356Z  Test Files  57 passed (57)
2026-11-16T03:49:35.6700382Z       Tests  1270 passed (1270)
2026-11-16T03:49:40.4088973Z # tests 21
2026-11-16T03:49:46.6067316Z # tests 125
2026-11-16T03:55:08.5761118Z   258 passed (5.2m)
```

backend：

```text
2026-11-16T03:49:56.1226244Z Required test coverage of 59.0% reached. Total coverage: 80.63%
2026-11-16T03:49:56.1226697Z ================== 962 passed, 3 warnings in 72.53s (0:01:12) ==================
```

### WGGC PR（run 43803930628）

frontend：

```text
2026-11-16T04:25:24.8404029Z # tests 10
2026-11-16T04:26:10.3565878Z  Test Files  57 passed (57)
2026-11-16T04:26:10.3569770Z       Tests  1270 passed (1270)
2026-11-16T04:26:14.9013733Z # tests 21
2026-11-16T04:26:21.1952518Z # tests 125
2026-11-16T04:31:51.6208818Z   1 flaky
2026-11-16T04:31:51.6210084Z   257 passed (5.4m)
```

backend：

```text
2026-11-16T04:25:56.8854221Z Required test coverage of 59.0% reached. Total coverage: 80.63%
2026-11-16T04:25:56.8854443Z ======================= 962 passed, 3 warnings in 46.95s =======================
```

### WGGC main（run 43804969728）

frontend：

```text
2026-11-16T04:35:44.1083805Z # tests 10
2026-11-16T04:36:30.4839942Z  Test Files  57 passed (57)
2026-11-16T04:36:30.4843819Z       Tests  1270 passed (1270)
2026-11-16T04:36:35.6620806Z # tests 21
2026-11-16T04:36:41.9419079Z # tests 125
2026-11-16T04:42:20.4720286Z   258 passed (5.5m)
```

backend：

```text
2026-11-16T04:36:23.7565804Z Required test coverage of 59.0% reached. Total coverage: 80.63%
2026-11-16T04:36:23.7566163Z ======================= 962 passed, 3 warnings in 51.16s =======================
```

## 六项有效变异（实际改法 + 目标断言）

- A19 `RoomSession.tsx:485`：`roomRef.current = room` → `void room`（render 绑定），目标
  `RoomSessionOwnership.test.tsx:252` 断言 roomRef.current 在 render 期至少一次（at least once）。
- A19 `RoomSession.tsx:491`：`stopRoomLocalTracks(room)` → `stopRoomLocalTracks(roomRef.current)`（wrongroom），目标
  `RoomSessionOwnership.test.tsx:196` 断言旧 Room 的 stop 应 1 次，变异后得 0。
- A19 `RoomSession.tsx:496`：`[room, roomRef]` → `[room, roomRef, {}]`（unstable 依赖），目标
  `RoomSessionOwnership.test.tsx:160` 断言不应 stop，变异后却 stop 2 次。
- A18 `conversationSlice.ts:47`：缓存首次平台，目标 `conversationPlatform.test.ts:214` 断言 idle 应为 connecting。
- A18 `conversationSlice.ts:305`：start 门禁 `isNativeIos` → `false`，目标 `conversationPlatform.test.ts:107` 断言 idle
  应为 checking_health。
- A18 `conversationSlice.ts:631`：resume 门禁 → `false`，目标 `conversationPlatform.test.ts:133` 断言同上（checking_health）。
- 均为目标 AssertionError RED 后磁盘/finally 逐字节恢复 GREEN（A19 恢复 90/90、A18 恢复 146/146）；正式 7/2 文件 SHA 未变；
  A19 R0「删 render 绑定存活 90/90」不计有效 kill。

## 首失败（测试 / 环境 / 工具）

- A18 自测首 typecheck 4 个 TS 错误、首 format 3 个文件失败，随后修复。
- A18 父 17 门禁 16 过；首次 E2E 因 18181 端口占用 exit1 0 用例，端口释放后补跑，未关闭未知进程。
- WGGC PR192 CI：六 success 但 E2E 257 pass/1 flaky/2 actual retry，Chromium `a11y-focus-touch.spec.ts:80` 首次/retry1 两次
  `page.evaluate: Resulting promise was garbage collected`，retry2 绿；两真实 trace 已留，因果未知。

## 计划外

- A19 R0 存活变异不计 kill；Harness 误读 retries（作者原 `configured_retries[0,0]` 正确）已撤销，非作者错误。
- WGGC 误选相邻 grammar-only（mixed60 旁证）与 corrected60 区分；本机 a11y repeat20 20/20 不证根因。
- 作者格式首失败缺独立 ev 证据：先前声明未单独留证，不冒充已重建原证（最终 6 MD prettier 已另经 ev.sh 落盘）。
- SGECD 旧 commit `9a9d6c10519e46880a20f5cb7112f3cde5170933` GitHub GET404，旧源码不作为云端可复核（本机 Git 冻结 + 逐文件 SHA256）。

## 未验证

- 真实 Provider/LiveKit/IdP/设备、迁移、部署。
- SGECD 本包 fresh 仅三树，其余源码门禁引用同源 CI，不冒称全 17。
- 真实 ZIP PR192 artifact 14197564029（trace2）与 main 14198137360（trace0）区分；GC 时序 error 后约 1ms 才发起结果请求。

## P2 澄清（尾追加，原前缀保全）

- 旧 10 行实测表各包 backend pytest 用例数均为 962（A19/A18/WGGC 同源；表内 pytest 列显示的是 warnings/coverage/time）。
- A19 变异 `:485` 的目标 `RoomSessionOwnership.test.tsx:252` 断言是 `replacementStop.toHaveBeenCalled`
  （替换后旧 Room 的 stop 被调用），不是统计 `roomRef.current = room` 赋值次数。

## 本阶段指针（SGEC-OFF）

- 2026-11-16 后续 SGEC 纯离线契约实施（SGEC-OFF）已完成、代码独立 APPROVED R1（未发布），见
  [history](../history/2026-11-16-sgec-offline-implementation.md)；设计见
  [SGEC_OFFLINE_DESIGN.md](../SGEC_OFFLINE_DESIGN.md)。
