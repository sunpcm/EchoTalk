# 遗留维护批次最终对账 — 云端独立复核输入（DOC R2，自足材料）

> 本文件是可直接交给云端独立复核的**自足事实材料**：完整 40 位冻结身份、CI 回执原行、亲跑/CI 全计数、有效变异与首失败均内联，
> 不依赖本地 `.review/`、`R/shared/` 或 reviewer。云端复核者据本文件 + 版本化公开 history / PR 正文，出具 **APPROVED 或
> CHANGES REQUESTED**（本文件是输入，不含预判结论，不替代评审）。主比较 baseline `76d9d6ba8c3ad72cf2c0671344ff48b617faea0f`
> （I1/PR176 main）→ 最终 EV main `bf4becd750d3dd13363ad0001b8c0ba72076e6b4`（PR187）。
> DOC 自身为纯 9 份 MD 收口；DOC 的 source/CI/main 身份与 CI 回执在承载本材料的 PR 正文读取，不在本文件自填未来 SHA/PR/CI 编号（避免自 SHA 循环）。

## 1. 主链（squash 合并顺序，40 位完整 SHA）

`76d9d6ba8c3ad72cf2c0671344ff48b617faea0f` → LGR `5e02273093e6c993fd98c6c2be16299719bf02bd` →
TS `94037c0c10f1cbe798b25b05d03aebf9d682a0ce` → READ `c9f3131a0c7bfef85afe79702d848234c1cc8382` →
ST `f91515795becc3453e9004f6fef3c05d36f95e22` → A11Y `cf104bb9b71662f4d020911663333c35c70a24aa` →
READ2 `3d246c3281f8bff3652830ff0e51cff08f30c4d2` → ST2 `7780c718b5aa87ad286ed047f779d99876516b39` →
ACT `bb1ed292ae4a4975214d977ab945692ec15615f6` → DASH `543e2663465550862425c067eaa4eaae0e1f00f3` →
CPB `53d2a4098543601ab1c8d59da14cc7557f0103ea` → EV `bf4becd750d3dd13363ad0001b8c0ba72076e6b4`。

## 2. PR177–187 逐包 freeze（完整 SHA + 可点 CI）

`baseline` 为上一 main；`source`/`CI merge`/`main` 为提交 SHA；`tree` 为 source/CI merge/main 三者一致的树哈希；
`PR CI`/`Guard`/`mainCI` 为 GitHub Actions run 编号（点击直达）。

| PR                                                 | 包    | baseline                                   | source                                     | CI merge                                   | main                                       | tree                                       | PR CI                                                                      | Guard                                                                      | mainCI                                                                     |
| -------------------------------------------------- | ----- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [177](https://github.com/sunpcm/EchoTalk/pull/177) | LGR   | `76d9d6ba8c3ad72cf2c0671344ff48b617faea0f` | `540d56cb69eaf986052574f999b6a3b51b264336` | `becfca470c7bc392b63848331b14ba0b8515418d` | `5e02273093e6c993fd98c6c2be16299719bf02bd` | `df194a646ae06e9986fbf8f36aa18f5151b4a261` | [43695519586](https://github.com/sunpcm/EchoTalk/actions/runs/43695519586) | [43695519623](https://github.com/sunpcm/EchoTalk/actions/runs/43695519623) | [43697384103](https://github.com/sunpcm/EchoTalk/actions/runs/43697384103) |
| [178](https://github.com/sunpcm/EchoTalk/pull/178) | TS    | `5e02273093e6c993fd98c6c2be16299719bf02bd` | `109baa2c5af13bcc7da9a67f5fd5f982a30ddebc` | `85a1a38afb0c77d6e3a1f45a4ccb01058131db0f` | `94037c0c10f1cbe798b25b05d03aebf9d682a0ce` | `04126a76825caa984128a4dfbf238a84fbab74ac` | [43704920189](https://github.com/sunpcm/EchoTalk/actions/runs/43704920189) | [43704920061](https://github.com/sunpcm/EchoTalk/actions/runs/43704920061) | [43706220054](https://github.com/sunpcm/EchoTalk/actions/runs/43706220054) |
| [179](https://github.com/sunpcm/EchoTalk/pull/179) | READ  | `94037c0c10f1cbe798b25b05d03aebf9d682a0ce` | `c2ffce7ea8aa952cef5a22c6e6b1f0598a362082` | `f754a7c204c330d05d5d63bcdb1efaf8eb46510e` | `c9f3131a0c7bfef85afe79702d848234c1cc8382` | `46732fb3062e40d41397a1d7b0dee93356703a1d` | [43711155517](https://github.com/sunpcm/EchoTalk/actions/runs/43711155517) | [43711155525](https://github.com/sunpcm/EchoTalk/actions/runs/43711155525) | [43712362262](https://github.com/sunpcm/EchoTalk/actions/runs/43712362262) |
| [180](https://github.com/sunpcm/EchoTalk/pull/180) | ST    | `c9f3131a0c7bfef85afe79702d848234c1cc8382` | `068057187d834ed859a3de34e7b9cb114898de82` | `942fbc9702be8afddedb8a9e6cafd30809941844` | `f91515795becc3453e9004f6fef3c05d36f95e22` | `b0c087862d93e01a00bd0f0b72a78f0afa2763f3` | [43716155780](https://github.com/sunpcm/EchoTalk/actions/runs/43716155780) | [43716155789](https://github.com/sunpcm/EchoTalk/actions/runs/43716155789) | [43717223939](https://github.com/sunpcm/EchoTalk/actions/runs/43717223939) |
| [181](https://github.com/sunpcm/EchoTalk/pull/181) | A11Y  | `f91515795becc3453e9004f6fef3c05d36f95e22` | `75324e4c1e1451f4ae7970101bb6006b2a496ba0` | `af48a7adff328eef674befca0a8b4d61a5d0ba8f` | `cf104bb9b71662f4d020911663333c35c70a24aa` | `571ca6da54331d373f9895ac20dd54d51a64935b` | [43719682252](https://github.com/sunpcm/EchoTalk/actions/runs/43719682252) | [43719682165](https://github.com/sunpcm/EchoTalk/actions/runs/43719682165) | [43720667762](https://github.com/sunpcm/EchoTalk/actions/runs/43720667762) |
| [182](https://github.com/sunpcm/EchoTalk/pull/182) | READ2 | `cf104bb9b71662f4d020911663333c35c70a24aa` | `e23f4db29ab9301a480c91f17fd5cccc50820576` | `837db2bd85030d0ca01e13f4b3cfaf6198a63bb1` | `3d246c3281f8bff3652830ff0e51cff08f30c4d2` | `79218f0ad74bcc6afa9bde2cc042284b34b1668e` | [43723516574](https://github.com/sunpcm/EchoTalk/actions/runs/43723516574) | [43723516557](https://github.com/sunpcm/EchoTalk/actions/runs/43723516557) | [43725277315](https://github.com/sunpcm/EchoTalk/actions/runs/43725277315) |
| [183](https://github.com/sunpcm/EchoTalk/pull/183) | ST2   | `3d246c3281f8bff3652830ff0e51cff08f30c4d2` | `4980d2197789485c24b201af834dc11b8ef6c452` | `cbf435bab4d9711da223984b3c275a719193df40` | `7780c718b5aa87ad286ed047f779d99876516b39` | `199fe99a65f601f6c1755e81cf9f7abeafe3ba47` | [43728809132](https://github.com/sunpcm/EchoTalk/actions/runs/43728809132) | [43728809100](https://github.com/sunpcm/EchoTalk/actions/runs/43728809100) | [43729553370](https://github.com/sunpcm/EchoTalk/actions/runs/43729553370) |
| [184](https://github.com/sunpcm/EchoTalk/pull/184) | ACT   | `7780c718b5aa87ad286ed047f779d99876516b39` | `5e478b8c0e36af657b90ccca9d17348130e671a7` | `59f07d81c6260b6acd074c9fc46f4e8f21b1c24d` | `bb1ed292ae4a4975214d977ab945692ec15615f6` | `1b58ddf3209d9f0d0ffa4b718a1e398c0b4bf046` | [43731788773](https://github.com/sunpcm/EchoTalk/actions/runs/43731788773) | [43731788758](https://github.com/sunpcm/EchoTalk/actions/runs/43731788758) | [43732696365](https://github.com/sunpcm/EchoTalk/actions/runs/43732696365) |
| [185](https://github.com/sunpcm/EchoTalk/pull/185) | DASH  | `bb1ed292ae4a4975214d977ab945692ec15615f6` | `89421da78932b699f9ea0f272b943e05775eb591` | `3803c46fd5ca933f815289522a214412be6c33e0` | `543e2663465550862425c067eaa4eaae0e1f00f3` | `42d0123571b74569d8645c01e0d36ba2cc353e6f` | [43733406381](https://github.com/sunpcm/EchoTalk/actions/runs/43733406381) | [43733406421](https://github.com/sunpcm/EchoTalk/actions/runs/43733406421) | [43734407828](https://github.com/sunpcm/EchoTalk/actions/runs/43734407828) |
| [186](https://github.com/sunpcm/EchoTalk/pull/186) | CPB   | `543e2663465550862425c067eaa4eaae0e1f00f3` | `e0a6250149d8c52bafe4bd35d9fddd2183a0b434` | `1dfaa050e2fe966ec8b0e95201daefec08127ab2` | `53d2a4098543601ab1c8d59da14cc7557f0103ea` | `cec480de643cf176f0414b9ad39911ee540b7365` | [43736520898](https://github.com/sunpcm/EchoTalk/actions/runs/43736520898) | [43736520838](https://github.com/sunpcm/EchoTalk/actions/runs/43736520838) | [43737179366](https://github.com/sunpcm/EchoTalk/actions/runs/43737179366) |
| [187](https://github.com/sunpcm/EchoTalk/pull/187) | EV    | `53d2a4098543601ab1c8d59da14cc7557f0103ea` | `4c364ceacbe25ce9fc2f6ddfe91a5312e825c0b4` | `546090c616d1b6e8996a7ccdfab69e7d3c8795de` | `bf4becd750d3dd13363ad0001b8c0ba72076e6b4` | `c2e7ddfa9879f83d6058c07845d91f54882de0dd` | [43737757005](https://github.com/sunpcm/EchoTalk/actions/runs/43737757005) | [43737757038](https://github.com/sunpcm/EchoTalk/actions/runs/43737757038) | [43738720996](https://github.com/sunpcm/EchoTalk/actions/runs/43738720996) |

最终 EV 主链三项 source `4c364ceacbe25ce9fc2f6ddfe91a5312e825c0b4` / CI merge `546090c616d1b6e8996a7ccdfab69e7d3c8795de` /
main `bf4becd750d3dd13363ad0001b8c0ba72076e6b4` 的 tree 均为 `c2e7ddfa9879f83d6058c07845d91f54882de0dd`，完全一致。

## 3. main CI 关键原行（Linux 回读，非亲跑；原行内联）

各包 main CI 的 Vitest/E2E/pytest 原行摘入如下（每包 `# tests 10` = API 类型生成器、`# tests 21` = 构建脚本、
`# tests 125` = Fake API 契约，均为 pass 全量、fail 0、skipped 0，结构一致故仅列关键行；完整 17 行见各包版本化 history 与 PR 正文）。

```text
READ  mainCI 43712362262   Test Files 53 passed (53) / Tests 1249 passed (1249)
                           258 passed (5.4m)
                           Total coverage: 80.63% ; 957 passed, 3 warnings in 73.13s
ST    mainCI 43717223939   Test Files 53 passed (53) / Tests 1249 passed (1249) ; 258 passed (5.4m)
                           80.63% ; 957 passed, 3 warnings in 68.44s
A11Y  mainCI 43720667762   Test Files 53 passed (53) / Tests 1249 passed (1249) ; 258 passed (5.4m)
                           80.63% ; 957 passed, 3 warnings in 74.25s
READ2 mainCI 43725277315   Test Files 53 passed (53) / Tests 1249 passed (1249) ; 258 passed (4.5m)
                           80.63% ; 957 passed, 3 warnings in 57.81s
ST2   mainCI 43729553370   Test Files 53 passed (53) / Tests 1249 passed (1249) ; 258 passed (4.0m)
                           80.60% ; 957 passed, 3 warnings in 63.11s
ACT   mainCI 43732696365   Test Files 55 passed (55) / Tests 1260 passed (1260) ; 258 passed (5.4m)
                           80.63% ; 957 passed, 3 warnings in 48.99s
DASH  mainCI 43734407828   Test Files 55 passed (55) / Tests 1260 passed (1260) ; 258 passed (5.6m)
                           80.63% ; 957 passed, 3 warnings in 59.33s
CPB   mainCI 43737179366   Test Files 55 passed (55) / Tests 1260 passed (1260) ; 258 passed (4.7m)
                           80.63% ; 962 passed, 3 warnings in 50.50s
EV    mainCI 43738720996   Test Files 55 passed (55) / Tests 1260 passed (1260) ; 258 passed (5.4m)
                           80.63% ; 962 passed, 3 warnings in 60.64s
```

EV mainCI 43738720996 原始关键行（原始 CI 日志，原样摘录）：

```text
2026-11-15T17:02:47.7340092Z  Test Files  55 passed (55)
2026-11-15T17:02:47.7343738Z       Tests  1260 passed (1260)
2026-11-15T17:08:29.0293403Z   258 passed (5.4m)
2026-11-15T17:02:54.9863830Z Required test coverage of 59.0% reached. Total coverage: 80.63%
2026-11-15T17:02:54.9864292Z ================== 962 passed, 3 warnings in 60.64s (0:01:00) ==================
```

LGR mainCI 43697384103 原始关键行（原始 CI 日志，原样摘录；LGR 主线 E2E 4.9m、pytest 64.18s，5.2m 是 PR 回读而非 main）：

```text
2026-11-15T09:05:42.2012326Z  Test Files  53 passed (53)
2026-11-15T09:05:42.2017801Z       Tests  1249 passed (1249)
2026-11-15T09:11:04.7578483Z   234 passed (4.9m)
2026-11-15T09:05:16.9984825Z Required test coverage of 59.0% reached. Total coverage: 80.63%
2026-11-15T09:05:16.9985211Z ================== 957 passed, 3 warnings in 64.18s (0:01:04) ==================
```

## 4. 各包最终计数（Linux main CI 回读为主，macOS 亲跑分列）

| 包    | mainCI      | Vitest  | Fake | types | build | E2E（C/W；retry/skip/flaky） | pytest（passed/warnings/coverage/时） |
| ----- | ----------- | ------- | ---- | ----- | ----- | ---------------------------- | ------------------------------------- |
| LGR   | 43697384103 | 1249/53 | 125  | 10    | 21    | 234 C117/W117 0（4.9m）      | 957/3w/80.63%/64.18s                  |
| TS    | 43706220054 | 1249/53 | 125  | 10    | 21    | 234 C117/W117 0（3.8m）      | 957/3w/80.63%/60.31s                  |
| READ  | 43712362262 | 1249/53 | 125  | 10    | 21    | 258 C129/W129 0（5.4m）      | 957/3w/80.63%/73.13s                  |
| ST    | 43717223939 | 1249/53 | 125  | 10    | 21    | 258 C129/W129 0（5.4m）      | 957/3w/80.63%/68.44s                  |
| A11Y  | 43720667762 | 1249/53 | 125  | 10    | 21    | 258 C129/W129 0（5.4m）      | 957/3w/80.63%/74.25s                  |
| READ2 | 43725277315 | 1249/53 | 125  | 10    | 21    | 258 C129/W129 0（4.5m）      | 957/3w/80.63%/57.81s                  |
| ST2   | 43729553370 | 1249/53 | 125  | 10    | 21    | 258 C129/W129 0（4.0m）      | 957/3w/80.60%/63.11s                  |
| ACT   | 43732696365 | 1260/55 | 125  | 10    | 21    | 258 C129/W129 0（5.4m）      | 957/3w/80.63%/48.99s                  |
| DASH  | 43734407828 | 1260/55 | 125  | 10    | 21    | 258 C129/W129 0（5.6m）      | 957/3w/80.63%/59.33s                  |
| CPB   | 43737179366 | 1260/55 | 125  | 10    | 21    | 258 C129/W129 0（4.7m）      | 962/3w/80.63%/50.50s                  |
| EV    | 43738720996 | 1260/55 | 125  | 10    | 21    | 258 C129/W129 0（5.4m）      | 962/3w/80.63%/60.64s                  |

计数演进：E2E 自 READ（PR179）起 234→258（C117/W117→C129/W129）；Vitest 自 ACT（PR184）起 1249/53→1260/55；
backend pytest 自 CPB（PR186）起 957→962（新增 Compose 启动契约 5 用例）。所有 E2E 实际 retry/skip/flaky 均为 0。

ST2 coverage 严格区分平台：Linux main 为 80.60%（其余包 main 为 80.63%），父已再取 ST2 mainCI 43729553370 的 pytest job
`132858750941` 原始 log 确认，并在 [PR183](https://github.com/sunpcm/EchoTalk/pull/183) 正文追加更正、fresh 回读一致；
mac 亲跑为 80.63%（957/3warnings/68.35s，`ST2/reviewer/ev/ev-st2-r0full-13.txt`）。两者平台不同，不互相统一。

macOS 亲跑（父 Harness 分阶段，各包**原 lane**，实施者非本 DOC 作者；DOC 本 lane 三树见 §6）核心计数按包内联，时间非必抄：

| 包    | PR  | Vitest  | E2E（C/W；retry/skip/flaky） | pytest（passed/warnings/coverage） | macOS history（可点）                                                                                    |
| ----- | --- | ------- | ---------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| LGR   | 177 | 1249/53 | 234 C117/W117 0              | 957/3w/80.63%                      | [2026-11-15-legacy-reconciliation](../history/2026-11-15-legacy-reconciliation.md)                       |
| TS    | 178 | 1249/53 | 234 C117/W117 0              | 957/3w/80.63%                      | [2026-11-15-theme-storage-reliability](../history/2026-11-15-theme-storage-reliability.md)               |
| READ  | 179 | 1249/53 | 258 C129/W129 0              | 957/3w/80.63%                      | [2026-11-15-settings-readability](../history/2026-11-15-settings-readability.md)                         |
| ST    | 180 | 1249/53 | 258 C129/W129 0              | 957/3w/80.63%                      | [2026-11-15-session-start-test-barrier](../history/2026-11-15-session-start-test-barrier.md)             |
| A11Y  | 181 | 1249/53 | 258 C129/W129 0              | 957/3w/80.63%                      | [2026-11-15-dashboard-focus-test-reliability](../history/2026-11-15-dashboard-focus-test-reliability.md) |
| READ2 | 182 | 1249/53 | 258 C129/W129 0              | 957/3w/80.63%                      | [2026-11-15-theme-swatch-reflow](../history/2026-11-15-theme-swatch-reflow.md)                           |
| ST2   | 183 | 1249/53 | 258 C129/W129 0              | 957/3w/80.63%                      | [2026-11-15-session-token-error-test-barrier](../history/2026-11-15-session-token-error-test-barrier.md) |
| ACT   | 184 | 1260/55 | 258 C129/W129 0              | 957/3w/80.63%                      | [2026-11-15-legacy-product-polish](../history/2026-11-15-legacy-product-polish.md)                       |
| DASH  | 185 | 1260/55 | 258 C129/W129 0              | 957/3w/80.63%                      | [2026-11-15-dashboard-extraction](../history/2026-11-15-dashboard-extraction.md)                         |
| CPB   | 186 | 1260/55 | 258 C129/W129 0              | 962/3w/80.63%                      | [2026-11-15-compose-startup-gates](../history/2026-11-15-compose-startup-gates.md)                       |
| EV    | 187 | 1260/55 | 258 C129/W129 0              | 962/3w/80.63%                      | [2026-11-16-e2e-first-failure-evidence](../history/2026-11-16-e2e-first-failure-evidence.md)             |

各包 E2E 实际 retry/skip/flaky 均为 0；LGR/TS 尚在 READ 之前故 E2E 为 234（C117/W117），READ 起为 258（C129/W129）。

## 5. 有效变异分类（file:行 + 目标断言）

### 5.1 生产代码变异（真实生产源改动 → 目标 RED → 恢复 GREEN）

- **TS（PR178，theme-storage）**：`apps/vite-app/src/store/settings.ts:223` fallback warm→cool → spec:105 `data-theme=warm`；
  `:436` 强制 warm → spec:112 `data-theme=cool`；`:436` 插入 300ms PUT → spec:125 `themePutCount==0`。
- **READ（PR179）**：三项生产 UI 变异 `apps/vite-app/src/components/settings/SettingsProviderFields.tsx:51` opacity →
  spec:429 `disabledText.ratio >= required`；`:89` boundary → spec:466 `boundary.min >= 3`；`:89` focus →
  spec:474 `focus.ratio >= 3`。另 `apps/vite-app/e2e/settings-readability.spec.ts:76` font 是测试输入/前提变异（非生产代码）→
  spec:410 `font.root≈rootFontSize`。
- **READ2（PR182）**：`apps/vite-app/src/components/settings/SettingsAppearance.tsx:36` 重新加回 `flex-1`（候选移除它）→
  `apps/vite-app/e2e/settings-readability.spec.ts:504/505/506` 分别为 `swatchWithin` / `dotWithin` / `textWithin`；
  6 RED / 恢复 24 GREEN（formal 未变、private 恢复）。
- **ACT（PR184）**：`useActiveSessionsLifecycle.ts:49` 冻结快照 → 4 resume/connectivity RED；`SessionRow.tsx:53`
  恢复完整正文 → 前 8 位断言 RED；`useSessionEndFlow.ts:108` 截短 end 参数 → `ActiveSessions.test.tsx:1475/1642/1697`
  完整业务 ID 3 RED（wire 项是单元级契约，非真实网络变异，见 `2026-11-15-legacy-product-polish.md` 追加澄清）。
- **CPB（PR186）**：`docker-compose.yml:55` wrong-path → `test_api_healthcheck_is_anonymous_and_compiles`；
  `:73` barrier → `test_db_services_gate_on_migration_success`；`:139` web → `test_web_gates_on_api_health`。

### 5.2 受控时序反例（非生产代码变异，单列）

- **ST（PR180）**：旧 C/W 5s 连接断言 2 RED → 候选 6s 真实 GET 2 GREEN（改测试时序前提，非产品代码）。
- **A11Y（PR181）**：受控 6s 旧 C/W seen5 原断言 2 RED → R1 响应后 UI 2 GREEN。
- **ST2（PR183）**：call-capabilities / 自动 end 各延迟 6s → 原 generic 可见性断言 4 RED / 4 GREEN。

### 5.3 无变异（明列）

- **LGR（PR177）**：纯文档，无变异。
- **DASH（PR185）**：App/Dashboard 函数体跨文件搬运，byte/AST 同源，无行为变异。
- **DOC（本轮）**：纯文档，无变异。
- **EV（PR187）**：无代码变异；仅 trace/screenshot 证据保留配置的本机受控负例（负 2 trace2/PNG2/JSON，正 2 trace0/失败 PNG0，
  从未上传真实 PR/main 归档），非生产代码变异。

## 6. DOC 本包三树与最终 EV 归档（macOS 亲跑 / 远端 artifact）

DOC 三树（父 Harness 本 lane 亲跑，`HEAD 1ba4bf1ca8af2b06b39f8afba86faa2a2bf24179`，baseline `bf4becd…`）：
Vitest 1260/55（命令 13.40s）、pytest 962/3warnings/80.63%/74.48s（命令 85.21s）、E2E 258 C129/W129 retry/skip/flaky0
（原生 72.200548s，命令 73.54s），source 字节稳定。

EV PR 与 main 两份实际归档（均 MCP 实际下载核 SHA/CRC/原生 JSON/PNG，非只看日志元数据；不贴临时下载 URL）：

| 归档                | artifact_id | ZIP SHA256（前 12） | 字节     | 文件 | PNG | trace     | 原生 results.json               |
| ------------------- | ----------- | ------------------- | -------- | ---- | --- | --------- | ------------------------------- |
| PR（43737757005）   | 14171327756 | `60ae87e6a916`      | 14725526 | 143  | 142 | 0（全绿） | 258 C129/W129 retry/skip/flaky0 |
| main（43738720996） | 14171881434 | `45573d73a06d`      | 14705831 | 143  | 142 | 0（全绿） | 258 C129/W129 retry/skip/flaky0 |

完整 ZIP SHA256：PR `60ae87e6a91642cf3fb1ee352eb88eec051fe4a7358cf83b1210c83e9475772b`；
main `45573d73a06d575c3caa4617eb76002ee0d0a8edf94e54122096583f101b4ce0`。两份归档均为 143 文件 = 原生 `results.json` 1 + PNG 142，trace 均 0（两次真实 CI 全绿）；本机受控负例 2 的 trace2 从未上传这两份真实归档。保留至 2026-11-22。
PR 归档含 ACT 320px 200% 双浏览器截图（`test-results/activity-layout-Activity-S-ade78--pushing-buttons-off-screen-{chromium,webkit}/layout-320px-200pct-font.png`）。

## 7. 前批六冻结（PR171–176，公开表，不指本地文件）

| PR                                                 | 包               | baseline                                   | source                                     | CI merge                                   | tree                                       | main                                       | mainCI                                                                     |
| -------------------------------------------------- | ---------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------- |
| [171](https://github.com/sunpcm/EchoTalk/pull/171) | G3 契约设计      | `fcc9d6ed519196383d3b929da3a2a4f8d11e5dad` | `6339fadc0f7ca37bcd47a410fc1bad7953b262f2` | `9bc630a4f6d7a54bb68c2c4269d8cce695f2341b` | `9f904e0c9ec8724b73cf7e096df789c83bad8233` | `0e706801316ea0c529a5eb1098f5cf808a1a9d67` | [43621702202](https://github.com/sunpcm/EchoTalk/actions/runs/43621702202) |
| [172](https://github.com/sunpcm/EchoTalk/pull/172) | G3 契约实施      | `0e706801316ea0c529a5eb1098f5cf808a1a9d67` | `bc66054e668cd37a4b9136878d9e6b0c14ddf953` | `5bad2492ad31a22e0f74657758cce9cb9d267902` | `85982b79fd531819ecf0d3536f4719e91bbf06a9` | `1f06b03f8ad2abf8184a6491184f76165c226fd4` | [43670316486](https://github.com/sunpcm/EchoTalk/actions/runs/43670316486) |
| [173](https://github.com/sunpcm/EchoTalk/pull/173) | H1 启动设计      | `1f06b03f8ad2abf8184a6491184f76165c226fd4` | `22802645bd6b41a1ff4438e2df8fbb384e49c2ed` | `3efe344fac0431a774c28a47682d6b83efe52789` | `141e4ec2d5e8be13d9daaca4631bf21dbdc0784b` | `650b3c7d60eee081a32e7ff9170a7fc7d6a11d06` | [43673387467](https://github.com/sunpcm/EchoTalk/actions/runs/43673387467) |
| [174](https://github.com/sunpcm/EchoTalk/pull/174) | H1 启动实施      | `650b3c7d60eee081a32e7ff9170a7fc7d6a11d06` | `7f499f2a2e2292c59e3f2d33386cfb11781510cf` | `4166bde73332cbbf4f27206f887a8c2eec594bee` | `eeb37709c6e8802092eb8a25ba8fb5b799965d39` | `0f7a5e57f809f8566efc39ca582bdc95fc260dfc` | [43677877043](https://github.com/sunpcm/EchoTalk/actions/runs/43677877043) |
| [175](https://github.com/sunpcm/EchoTalk/pull/175) | I1 Provider 设计 | `0f7a5e57f809f8566efc39ca582bdc95fc260dfc` | `9196e218f13ec42d0739e44ba0c16b7b88f8e4df` | `be38f15587b86f550ce355c0237c8fb169d424d0` | `7e420c6fabac870f5b157ce483eb91ec07ed05d5` | `312a8f802b73f5fcb1e285a52c9dce2b1b497bad` | [43681402200](https://github.com/sunpcm/EchoTalk/actions/runs/43681402200) |
| [176](https://github.com/sunpcm/EchoTalk/pull/176) | I1 Provider 实施 | `312a8f802b73f5fcb1e285a52c9dce2b1b497bad` | `7f272cdb8845822010ae6658c8e1fc3a3913ec22` | `5e5c1f8466649248428ded72db979f73eb2172c7` | `019b24392f3c16ce5bfa34dff38b412935bfa938` | `76d9d6ba8c3ad72cf2c0671344ff48b617faea0f` | [43686992533](https://github.com/sunpcm/EchoTalk/actions/runs/43686992533) |

PR171–176 直达：[171](https://github.com/sunpcm/EchoTalk/pull/171)、[172](https://github.com/sunpcm/EchoTalk/pull/172)、[173](https://github.com/sunpcm/EchoTalk/pull/173)、[174](https://github.com/sunpcm/EchoTalk/pull/174)、[175](https://github.com/sunpcm/EchoTalk/pull/175)、[176](https://github.com/sunpcm/EchoTalk/pull/176)；其 PR CI/Guard run 编号见各 PR 正文（本表仅列 mainCI 可点）。

## 8. 首失败 / flaky / 重放 / 无根因（保留，不据后续绿追认）

- READ PR179 / ST PR180 首轮 CI 257pass/1flaky/retry1（旧 `a11y-focus-touch.spec.ts` seen>=6 得 5）；A11Y PR181 修正后
  其 PR/main 首轮 258/0，只修确定前提缺口、非证得根因。
- READ2 PR182 首轮 CI 257pass/1flaky/retry1（session-flow:109 helper4 `page.evaluate` Promise GC）；SF 只读调查无已证根因，
  CI 证据缺口已确认（原 on-first-retry/list、无前端 artifact），EV 只补证据保存、不修复。
- 本机重要首失败/存活记录（不据后续绿追认，也不只列 CI flaky）：
  - TS R1 首失败 GET 在途快进 60 秒触发真实 10s 请求超时（trace `api_request_timeout`）；R2 存活变异：trace.network 已记录
    实际 PUT、Node 计数仍为 0，坏 PUT 由 spec125 `themePutCount==0` 抓住（[PR178](https://github.com/sunpcm/EchoTalk/pull/178) /
    [history](../history/2026-11-15-theme-storage-reliability.md)）。
  - ACT 集成首轮完整 E2E 234 pass / 24 fail（全为旧 dialog 标题「自定义模型设置」定位失效），R2 对齐「设置」后 258/0
    （[PR184](https://github.com/sunpcm/EchoTalk/pull/184) / [history](../history/2026-11-15-legacy-product-polish.md)）。
  - DASH 历史首完整 E2E 233/1（token 启动超时）、baseline20/candidate20 双绿为历史事实，与 DASH 跨文件搬运无因果结论
    （[PR185](https://github.com/sunpcm/EchoTalk/pull/185) / [history](../history/2026-11-15-dashboard-extraction.md)）。
  - CPB R0 健康子串断言无法识别 wrong-path 存活；父在 merge 失败后仍启动的中间树 E2E 258 实际通过但不计最终门禁（已标中间树）
    （[PR186](https://github.com/sunpcm/EchoTalk/pull/186) / [history](../history/2026-11-15-compose-startup-gates.md)）。
- theme-storage 两次 233/1 warm/cool、weekly-grammar 5/1、启动视图测试前提（ST）历史根因未知，保持开放。

## 9. 亲跑 vs CI 分列与证据分级（统一口径）

- macOS 亲跑（父 Harness 各包原 lane 分阶段；DOC 本 lane 三树见 §6）：LGR 17 门禁、READ 24 矩阵、DOC 三树等，
  主体非实施 Agent（实施 Agent 仅写 MD + Prettier/链接自检）。
- Linux 回读（main CI，非亲跑）：§3/§4 所列 READ/ST/A11Y/READ2/ST2/ACT/DASH/CPB/EV。
- 证据分级（Roadmap §2）：「代码存在」「自动化通过」「真实环境验证」不混用；真实 Provider/LiveKit/IdP/设备/整栈/部署未验。
- 执行环境：各包原 lane 亲跑，本 DOC 三树本次另记；作者不连 DB，本机 Harness 指定专用 PG 已亲跑，CI 以空合成库 alembic 单列，
  不称所有环境零迁移。

## 10. 云端复核四行调用 prompt（须出结论）

1. 以 `76d9d6ba8c3ad72cf2c0671344ff48b617faea0f` 为 baseline，代码比较范围仅为 PR177–187（§1/§2）的完整 baseline/source/CI merge/main/tree
   及 PR CI/Guard/mainCI 回执，逐项验证 main CI 原行（§3）与逐包计数（§4）；PR171–176 为参考附录（§7），不纳入本次主代码 diff。
2. 核对生产代码变异（§5.1）与受控时序反例（§5.2）逐项 file:行 + 目标断言，确认 DASH/LGR/DOC 无变异（§5.3）。
3. 核对首失败/flaky/重放/无根因（§8）与亲跑/CI 分列、证据分级（§9），不据后续绿追认历史根因。
4. 综合上述给出 **APPROVED 或 CHANGES REQUESTED**；若 CHANGES REQUESTED，逐条列出具体缺口与要求，缺项明确标「待补」。
