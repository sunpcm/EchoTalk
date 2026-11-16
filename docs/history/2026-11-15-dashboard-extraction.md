# Dashboard 抽取（DASH，源码阶段）

> 日期：2026-11-15；范围：仅原样抽出既有 `Dashboard` 组件到独立模块，`App.tsx` 以 import 接回，不做全量目录重排。
> 裁决：用户已明确 R2-13 采用推荐 A——只抽 Dashboard，允许既有函数体原样跨文件搬运，旧测试与三树计数不变，其余目录随以后分层迁移。

## 核验基线

- lane：`.review/worktrees/dashboard-extraction-20261115`
- branch：`codex/dashboard-extraction-20261115`
- 文档开工时 HEAD：`0b4561f75fde93d4bfaf471eca387fd76b9ad2b2`（父已把 ACT 已发布 source
  `5e478b8c0e36af657b90ccca9d17348130e671a7` 合入 DASH 分支；原 prompt 基线 `5e02273` 已前移）
- 最后核验 head：DASH `902749c9785d3909de6d81d20de09144bb3baeba`、已合 main
  `bb1ed292ae4a4975214d977ab945692ec15615f6`（非发布终点，DASH 不预填未来 PR/主线 SHA）
- 工作树干净；未 pull/stash/reset/rebase/切分支/commit/push/merge。
- 依赖：`238222454adb013abf4c96db4515c6faada85da2`（已冻结不可变 ACT 代码；已核全部产品/测试字节与 17 门禁均与
  `238222` 相同）。

## 变更范围（仅 2 源码路径，已独立 APPROVED，本轮文档收口不改源码）

- 改 `apps/vite-app/src/App.tsx`：移除内联模块级 `function Dashboard`，新增
  `import { Dashboard } from "@/components/dashboard/Dashboard";`，`App` 函数体逐字节不变。
- 新增 `apps/vite-app/src/components/dashboard/Dashboard.tsx`（162 行）：函数体 = 原 `App.tsx` 内联 Dashboard，
  仅函数头 `function` → `export function`。

## 函数体 / props / App 自由绑定同源（byte / AST）

- 原 `App.tsx` 内联 Dashboard 函数体（约 140 行）与新 `Dashboard.tsx` 函数体逐字节一致（仅函数头 `function` →
  `export function`）。
- props 签名 `{ onOpenSettings }: { onOpenSettings: () => void }`、`useAssessmentStore`/`useConversationStore`/
  `useAppStore` 的 selector、`useEffect` 副作用与依赖数组、`onOpenSettings` 回调、
  `useAppStore.getState().openDocChatSetup()`、`{tConv/tAssess/tDocChat/zhCN}` 文案引用与依赖数组均原样保留。
- `App` 自身函数体逐字节不变，`export default App` 不变；组件 props/副作用/文案自由绑定同源，未改业务逻辑/错误口径/
  新 wrapper/新增能力。
- 字节：原 `App.tsx` blob `da240459cae9b7758894e2fbccfcf38b1f9a5d12` → 新 `App.tsx` blob
  `493ba8d0eb2eee3cbea0a11164771733b7c7e103`；新 `Dashboard.tsx` blob `8379edc777829243d99a74d0339859a69930dd87`。

## 旧测试零字节 / 三树计数相对 ACT 零变化

- 旧测试严格原字节，未新增/删除测试；未改 CSS、i18n、store/data/API/认证/配置/依赖/锁/数据库/生成物。
- 三树计数相对 ACT 基线零变化：Vitest 1260/55、Playwright E2E 258（C129/W129，retry/skip/flaky 0）、
  backend pytest 957/3 warnings/80.63%；Fake API 125、API 类型生成器 10、构建脚本 21；17 门禁全 success。

## 历史首失败与因果边界（保留，不追认因果）

- 历史首完整 E2E 233/1（token 启动超时）、baseline20/candidate20 双绿为历史事实，与本轮 Dashboard 抽取无因果结论。
- 后来独立 ST（PR180）做的是测试前提的受控修复，只证明前置缺口已修，不据此声称证明了原历史原因。

## 未验证 / 边界

- 本轮实施 Agent 仅写 MD，未启动浏览器/服务器/PostgreSQL；Vitest/E2E/pytest 三树与专用 PG 由 Harness 实际亲跑。
- ACT PR184 已合 main `bb1ed292ae4a4975214d977ab945692ec15615f6`：PR CI 43731788773 / Guard 43731788758 首六 success
  （Linux Vitest1260/55、Fake125/type10/build21、E2E258 C129/W129 0retry/skip/flaky 5.6m、pytest957/3warnings/80.63%/48.53s）；
  最终 mainCI 43732696365 运行中，不计绿。DASH 不预填未来 PR/主线 SHA。
- 真实 IdP/LiveKit、设备、整栈、部署仍未验。

停 Review；本文件为文档收口，不 commit / push / merge。
