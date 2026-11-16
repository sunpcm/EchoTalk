# CP-05 设置抽屉动态可见性

## 状态与范围

本说明覆盖设置抽屉已打开且输入已聚焦时，普通窗口 resize、根字号 200% 后再 resize，以及聚焦后
仅改变根字号三种动态可用空间场景。目标是保持当前焦点、草稿和既有初始焦点语义，同时让活动输入
通过中间滚动区的 `nearest` 滚动重新完整可见。

当前状态为 `FINAL_READY`。全量 E2E 为 `262 = Chromium 131 + WebKit 131`，全部 passed；每项
single passed，skip/flaky/unexpected/retry 均为 `0`，命令 `exit 0`。新增场景在 Chromium/WebKit
各重复 `20` 次，机器核验为 `6` 组、共 `120` 次；每项均为单 passed result，
skip/flaky/unexpected/retry 均为 `0`，`workers=1`，命令 `exit 0`。两份测试完整行为 AST 与有效
RED 一致；独立 Review、正常 commit/当前分支 push 以主控同卡最终回执为准，用户 Review 待。

## RCA 边界

- 既有静态布局用例通过；该静态矩阵未复现固有尺寸裁切，本卡不修改布局或控件尺寸。
- “控件固有尺寸被裁切”的猜想已被证伪，不作为回归依据。
- 未先建立 input 的 focus/value/完整可见前置的早期诊断不作为正式回归证据。
- 正式单测 RED 证明实际 Drawer 挂载后缺少 viewport reveal 资源；浏览器 RED 在严格初始
  focus/value/完整可见成立后只改变 factor，目标场景仍出现不可见。原已通过的 WebKit 场景保持
  通过，未以放宽断言制造 GREEN。精确失败计数与 ratio 集中在 PROJECT_STATUS。
- WebKit 200% 与 font-only 原通过。显式 Save 恰 `1 PUT` 已走通；resize、font-only 与 Close
  保持零 PUT。

## 最小实现

- 既有中间 `overflow-y-auto` 容器暴露 ref，open 周期监听 `window.resize`、可用
  `visualViewport.resize`，并特征守卫地观察该滚动区。
- 全部信号合并到一个 rAF；帧执行时重新读取当前 `document.activeElement`，只对 connected 且
  属于当前滚动区的活动元素做 `scrollIntoView({ block: "nearest", inline: "nearest" })`。
- 不主动 focus、不修改草稿/store、不新增业务写请求，也不改变既有 focus trap、Tab 与初始 Close
  聚焦语义。
- Close、卸载与 StrictMode 重放会取消 rAF、移除监听并断开 Observer；缺失
  `visualViewport`/`ResizeObserver` 时安全退化，迟到回调不作用于新周期。

## 验收口径

- 真实 `SettingsDrawer` 先建立焦点、草稿和完整初始可见，再单独改变视口或字号；factor 后禁止用手动
  focus/scroll 帮助产品通过，要求最终完整可见、焦点和值保持。
- 完整合法合成 settings 用于验证显式 Save 恰一次 PUT；resize/font/Close 零 PUT。
- 资源单测覆盖帧合并、帧执行时当前 active 元素归属、关闭/卸载迟到回调及特性缺失回退。
- 三项私有 load 变异分别验证不滚动、帧内捕获旧焦点和 Observer 泄漏，均须被目标断言杀死；
  未选用例不计覆盖。

详细最终门禁数字与边界集中在
[PROJECT_STATUS 的 CP05D 小节](../../PROJECT_STATUS.md#cp05d-设置抽屉动态可见性)。

真实 OS 键盘、非零 safe-area、设备、Media/Provider、IdP 与生产未验；本说明不勾选 CP-05 手机
动态视口/键盘/safe-area 父项。所有数据库验证已完成；本批自有合成 PG 已 `stop_exit0`、
`auto_removed=true`，精确 container ID、双 owner、loopback 与合成身份均核验，其他资源未动。
