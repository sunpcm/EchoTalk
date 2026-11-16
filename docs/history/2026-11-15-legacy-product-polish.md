# 遗留产品润色（ACT）— 本机验收与边界记录

> 日期：2026-11-15；任务包：ACT（遗留产品润色，三处已确认产品修复 + R2-10 剩余 UI 收口）；
> 分支 `codex/legacy-product-polish-20261115`；基线 main `5e02273093e6c993fd98c6c2be16299719bf02bd`；
> 源码提交 `2695bca847a612cddd0dd4e0e0fe9321535fc206`，R2 集成提交 `47325354eb74ce6a37c00e54b7d11522fc6dcced`；
> 最终核验基线 main `7780c718b5aa87ad286ed047f779d99876516b39`（ST2 PR183 之后，非发布快照）。
> 本文件记录源码范围、本机 17 门禁、首失败/三处有效变异、集成 R2 一处标题定位修正与未验证边界；不冒充已发布 main/CI，不预填 ACT PR 编号或发布终点 SHA。

## 范围与最终改动

用户 2026-11-15 已确认三处全部按推荐实施，ACT 包在同一 lane 落地三处产品修复与 R2-10 剩余 UI 收口：

1. 实时 isStarting：`useActiveSessionsLifecycle.ts` 在 `handleLifecycleEvent` 读实时 `isStarting`
   （`isStartingRef.current` 每次渲染同步），覆盖挂载后 false→true、true→false 的 resume/connectivity 门禁；
   认证/在途/可见性/网络门禁与订阅语义不变。
2. 设置抽屉标题：新增 i18n key `settings.drawerTitle: "设置"`，`SettingsDrawer.tsx` 标题 `{t.title}` → `{t.drawerTitle}`；
   `settings.title` 保持「自定义模型设置」，入口按钮 `App.tsx` 原文案保留。
3. SessionRow 可见 ID 前 8 位：`{session.id}` → `{session.id.slice(0, 8)}`；`title`/`data-testid`/key/详情/恢复/结束按钮/HTTP/store
   全用完整 ID；错误恢复页仍完整 UUID。

R2-10 剩余 UI（设置抽屉标题改为「设置」、活动会话行不展示完整 UUID）由 2、3 同轮覆盖；`src/i18n/` 硬编码文案收口
（`SettingsAppearance.tsx`、`SettingsProviderFields.tsx`）为前序已合工作，非本 ACT 变更，本包仅含 `settings.drawerTitle`
与 SessionRow 行摘要。

R2 集成（只一处）：`settings-readability.spec.ts:79` dialog 可访问名 `自定义模型设置` → `设置`，按钮入口名（78 行）保留。

## 事实时序

- 实施 R0（report-r0）：三处产品修复落地，15 个文件（4 源码 / 4 测试 / 7 E2E 标题断言）；首失败保留。
- 实施 R1（report-r1，CHANGES REQUESTED）：2 文件返修——`session-start.spec.ts` 活动行可见 ID 旧断言同步
  （L107–109、L147）、`SessionRow.test.tsx` 第三用例补真实点击回调；其余 R0 文件原字节不动。
- 集成 R2（report-r2-integration）：Harness 首次完整 E2E 234 pass / 24 fail（全为旧 dialog 标题定位失效），
  只把该 spec 的 dialog 名对齐新标题；亲跑该 spec Prettier exit 0。
- 父 Harness 受控 17 门禁全 success；3 处有效变异 RED / 恢复 GREEN；backend 字节未变（R1 阶段证据，非本轮重跑）。

## 验收结果（本机 Harness，未发布）

17 门禁全 success：

- Vitest 1260 passed / 55 文件
- Fake API 契约 125 passed
- API 类型生成器 10 passed
- 构建脚本 21 passed
- backend pytest 957 passed / 3 warnings / 80.63%（原 R1 backend 字节未变）
- 完整 E2E：原 234/0 → 集成首轮 234 pass / 24 fail（全为旧 dialog 标题）→ R2 修复后 258/0（C129/W129，
  retry/skip/flaky 0，52.392509s / 命令 53.39s）
- 新 ST2/ACT 启动文件组合 6/0（C3/W3，retry/skip/flaky 0，23.6s）

三处有效变异（父 Harness 私有，均目标 RED + 逐字节恢复 GREEN）：

- live（实时 isStarting）：`useActiveSessionsLifecycle.ts` → 挂载后启动态变化 resume 用例；RED 4 failed / GREEN 8 passed。
- row（SessionRow 可见 ID 前 8 位）：`SessionRow.tsx` → 前 8 位断言；RED 1 failed / GREEN 3 passed。
- wire（`useSessionEndFlow.ts:108`，R1 P1）：把真实 end 调用短 ID 化，被真实请求完整 UUID 断言
  （ActiveSessions.test.tsx:1475/1642/1697）抓到 RED（3 failed），恢复 116/0 GREEN。

标题（②）为纯 i18n 文案变更，由既有 `SettingsDrawer.test.tsx` 与 E2E 覆盖，无独立新门禁 RED。

命令见 [Agent 评审手册 §2](../agent-review-loop.md)。三树/门禁/变异由父 Harness 在本 lane 实际执行；实施 Agent 未运行浏览器/PG/三树/受控变异。

## 首失败（如实保留）

- R0 首失败：① 4 条 live isStarting 用例 RED（false→true 与 true→false 的 resume/connectivity）、
  ③ 1 条前 8 位可见 ID 断言 RED（收到完整 UUID）；修复后分别 GREEN。
- 集成首轮 E2E 234 pass / 24 fail：全部为 ACT 把抽屉标题改「设置」后，`settings-readability.spec.ts`
  旧 dialog 名「自定义模型设置」定位失效（READ 仅贡献新增 24 例测试）；非产品回归，R2 一处对齐后 258/0。

## 输入因果界限与未验证

- 本包为产品修复（用户已裁定三处），非测试前提审计；历史首次失败与因果未知（如 theme-storage 两次 233/1 warm/cool、
  weekly-grammar 5/1、a11y-focus-touch 根因未知）不因本包绿而追认或抹除。
- 未验证真实设备、真实 Provider/LiveKit/IdP、整栈与部署；ACT PR/CI 待建，不预填编号或发布终点 SHA。
- 其他设备/媒体/B2/目录/Compose 卡保持未勾。

## 回读（非亲跑）：已发布 main 7780（ST2 PR183）

- ST2 PR183 源码 `4980d219` → main `7780c718`（tree `199fe99`）。
- PR CI 43728809132 / Guard 43728809100：六 first success。
- main CI 43729553370：首五 success（Linux 回读 Vitest 1249/53、Fake 125、types 10、build 21、
  E2E 258 C129/W129 0retry/skip/flaky 4.0m、pytest 957/3warnings/80.63%/63.11s）。

停 Review；本文件为文档收口，不 commit / push / merge。

## ACT wire 精度澄清（2026-11-16 追加，旧正文保全）

上文「三处有效变异」的 wire 项为私有变异，须精确化以免误读为真实网络变异：该变异实际是把
`useSessionEndFlow.ts` 中产品 `endSession` 调用的参数截短（短 ID 化），并非改动真实 HTTP 请求或网络层；
它被 `ActiveSessions.test.tsx` 的三处 API spy 断言（`:1475` / `:1642` / `:1697`）用完整合成业务 ID
（`sess-end-1` 等）拦截而目标 RED，恢复 116/0 GREEN。因此它只证明「产品把完整业务 ID 原样传给 end 调用」
的单元级契约，不构成真实网络变异证据；真实 Fake HTTP 端到端行为由完整 Playwright E2E 覆盖，真实 Provider
不在此列。
