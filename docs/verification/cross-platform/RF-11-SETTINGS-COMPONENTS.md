# RF-11 SettingsDrawer 行为拆分验证

> 状态：r1 返修完成，停在 Review；实施方按受控执行分工未运行 formatter、baseline、Vitest、
> typecheck、build、backend pytest 或变异。固定 quality10、专用测试库 backend 与必要变异待
> 主 Agent 在实施停写后通过 `cross-platform-local-check.py b` 代跑。
> 日期：2026-11-01。

## 目标与非目标

本轮落实 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“按行为拆分 SettingsDrawer”，
保持既有文案、DOM、classes、label、id、Provider 选择、payload 裁剪、store 行为和网络语义。
同时关闭已复现的本地提示 timer 与打开周期所有权问题。

本轮不修改 store/API/认证/Provider/主题持久化契约，不新增全局状态框架或运行时依赖，不取消或
重发 PUT，不以 abort 替代本地所有权，也不扩展 E2E 的既有断言。

## 依赖与模块边界

```text
SettingsDrawer
├── useSettingsDialog
├── useSettingsForm
│   ├── settingsPayload
│   └── auth.beginLogout
├── SettingsAppearance
└── SettingsProviderFields
```

`SettingsDrawer` 保留公共 props/导出、打开时 fetch、loading/saving/store error、公共外壳及
模块组装。依赖只从入口流向行为模块，不存在反向 import。

| 模块                     | 所有权                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `useSettingsDialog`      | 原生 dialog、背景滚动锁、打开前焦点记录/关闭后恢复、关闭按钮初始聚焦、focusin、Tab 双向循环、Escape/backdrop 与清理           |
| `useSettingsForm`        | 本地 draft、后端设置引用水合、内存 key、显式保存、免费账号 custom 约束、保存成功/错误 timer、持久 logout 失败提示及操作所有权 |
| `SettingsAppearance`     | 三分支主题色板、`aria-checked`、原 DOM/classes 与 local-first `setTheme` 回调                                                 |
| `SettingsProviderFields` | STT/LLM/TTS 选项和顺序、回退值展示、LLM model、API Key、状态 badge、fieldset disabled 与精确布局                              |

## 资源与异步所有权

dialog effect 只随真实 `open` 变化。`onClose`、主题、草稿或 store action 的新引用更新 ref，
不会清理并重开 dialog；正常重渲染不抢焦点、不重复加 focusin，也不重复释放滚动锁。小视口和
移动端始终先聚焦关闭按钮，不自动聚焦 password/key 输入框。

`useSettingsForm` 位于 `SettingsDrawer` 的 early return 之前，因此在 `open=false` 时仍持续调用。
草稿只按后端 `settings` 对象引用水合；同一引用下主题或 open 变化不会重置草稿，也不会从后端
回填明文 key。

每条本地提示有唯一 timer，并绑定当前打开周期与操作序号：

- 新保存、新提示、关闭、重开和卸载都会取消或作废旧 timer；
- 旧回调即使被捕获并迟到完成，也不能清除新提示、写入新打开周期或安排新 timer；
- 保存错误提示保持 3 秒，保存成功提示保持 2 秒；
- logout 失败提示保持到关闭或下一当前操作，不创建自动隐藏 timer；
- store 返回 `{ success: false, error: "stale" }` 时静默，不回退为通用错误文案；
- close/reopen 只作废旧 UI 回调，不取消、不撤销、不重发已发出的 PUT；
- 若 logout 被抽离触及，失败提示遵守同一打开周期与操作所有权。

## 行为保持

- `buildSettingsUpdate` 仍是唯一 payload 构造入口；custom 关闭时仅发
  `{ is_custom_mode: false }`，custom 开启时按既有顺序和 trim 规则裁剪字段。
- Provider ID、选项顺序、SiliconFlow/OpenRouter 顺序、默认 Deepgram/SiliconFlow/Cartesia、
  badge 文案和 has-key placeholder 均保持。
- 免费账号已有 custom 模式仍不能通过开关关闭；既有 `alert` 产品约束原样保留。
- 主题仍由 settings store local-first 更新；拆分没有新增全设置 PUT，也没有改变 300ms 独立主题
  防抖持久化。
- `loading` 只替换设置主体区域，外观始终可用；`saving` 继续控制保存按钮；store `error`
  继续显示在原底部错误位置。

## 回归设计

`SettingsDrawer.test.tsx` 继续渲染真实生产入口，真实消费 hooks、视图、`settingsPayload` 和
store action 替身，不以 mock 新 hook 绕开实现。新增覆盖：

- 重复保存失败各自拥有完整 3 秒，旧 timer 不提前清除新错误；
- 当前成功提示保持完整 2 秒；
- 旧成功和旧失败分别在 close/reopen 后静默，新周期保存仍能显示成功或失败；
- 卸载后的迟到成功/失败零本地副作用、零残留 timer；
- 当前 `stale` 静默，后续保存可正常恢复；
- 当前 logout 失败在远超 3 秒后仍可见，下一当前操作清除；旧打开周期的 logout 失败不污染新周期；
- 主题/回调重渲染不重开 dialog，关闭/重开保留同引用下的本地草稿；
- Provider 默认/顺序与三种真实 badge 状态、免费账号约束、主题 local-first 与 custom payload
  精确保持；
- 原生 dialog、滚动锁清理与 store 底部错误继续存在。

既有 Playwright 双浏览器可访问性、焦点循环、320px/667x320 视口和零隐式业务 PUT 断言不做
弱化；本轮无需新增 E2E。

## 当前验证状态

实施节点未执行以下项目，不能由 r0 native 预检或 baseline3 推断为实现后通过：

- format-fix 后 baseline format/lint/typecheck；
- 固定前端 quality10；
- 专用 PostgreSQL 测试库完整 backend pytest；
- 针对 timer/打开周期所有权、dialog 资源与行为拆分的必要变异；
- 独立 Review。

独立评审已报告 r0 format/lint/typecheck 通过；完整 Vitest 为 915 passed、2 failed、917 total，
两项失败均为测试夹具装配错误，产品 assertion 未放宽。r1 已修正 `installStore` 实际 action
所有权与 Provider 三种状态 fixture，并恢复 logout 失败提示的持久语义。修复后的完整门禁尚待
主 Agent 代跑；既有真实组件 + 真实 store 的重复错误 timer、close/reopen 迟到失败和成功水合
后 2 秒提示三个消费者行为未改为 mock hook。

真实 IdP、Provider、LiveKit、设备、远端 CI、部署与发布仍未验证。RF-11 整项在 A69 独立
Review 通过前继续保持未勾选。
