# R2-11 会话中界面本地模块桩验证说明

## 范围与边界

- 本说明覆盖 R2-11 本地子卡交付：LiveKit 容器默认主题映射到 EchoTalk 主题 token、场景名与
  墙钟计时页头、移动端字幕优先、`thinking` 独立文案、单实例回答推荐展开，以及 store 内内存
  只读 `sessionPresentation` 展示对象。
- 页头计时是既有 `started_at` 到当前墙钟时间的经过时间，只用于界面展示。它不是有效说话时长、
  练习时长、周报时长或计费依据，也不会写回后端。
- 恢复会话只用服务器 `getSessionDetail` 返回的 `mode` 作为当前场景；本地残留的
  `selectedScenario` 不作为恢复场景展示，也不冒称服务端确认了具体场景。
- E2E 夹具只在浏览器侧替换 `@livekit/components-react` 的 hooks/展示组件，挂载的是真实
  `ActiveConversation` 与产品样式。SDK 模块桩不等于真实 LiveKit 媒体链路；真实设备/真实
  信令/真实音频人工验收未做，父项 R2-11 因此保持未勾。
- 夹具保留生产 `RoomSession` 已有的 `data-lk-theme="default"` 属性，主题断言比较真实容器的
  computed background，不是给伪容器单独涂色。

## RED 与返修事实（诚实保留）

- 有效 RED：unit `22 failed / 4 passed / 26 total / 0 pending / exit 1`，22 项均为缺失展示功能
  或目标顺序；browser RED 1 例失败（旧 Listening 挂载后页头缺失）。
- R0 主控实跑：全量 Vitest `1254 passed / 1 failed`，唯一失败是 logout 新用例在裸 slice 上期待
  auth 监听自动清元信息（真实清理链为 AuthGate → clearUserSessionData → goHome →
  resetWithShellCoordination）；quality `2` 为新测试两处非法 `AuthState` 字面量；format `1` 为
  三份新 TDD 文件；E2E `252 passed / 4 failed`，四个新布局用例在 body 250ms 主题过渡未结束时
  过早比较背景色。这些原始失败记录保留，不并入产品回归。
- R1 修正：logout 用例接真实 `AuthGate` + 物理 store + 真实清理函数；两处字面量改合法
  `"anonymous"`；背景比较改 `expect.poll` 等待过渡结束后的真实最终色（精确相等保留，不禁动画、
  不固定 sleep、不放宽值）；并移除 start 完成处本卡误加的外壳补丁，仅附加
  `sessionPresentation`。
- R1 修正后：quality `0`、Vitest `1255 passed / 54 files / 0 skip`、format `0`；25 个完整 callback
  按 AST 与 RED 相同（仅合法 `anonymous` 统一）；四新增布局 E2E 在 Chromium/WebKit 的 390/1280
  全 `4` 通过，覆盖精确主题背景、单实例回答推荐、状态→字幕→推荐的视觉顺序、390 移动单栏与
  1280 左右栏几何、无横向溢出和零 API 写请求。

## 最终验收与状态

- 最终 13 项门禁机器验收全部 `exit 0`：Vitest `1255 passed / 54 files / 0 skip`、E2E
  `256 = Chromium 128 + WebKit 128`（single passed / retry 0 / 0 skip / flaky / unexpected）、
  backend `1044 passed / 3 warnings / 0 skip`、lint `132 warning / 0 error / 0 new`，三项有效私有
  load 变异均 killed 且默认 26 项复核 `0` 失败。完整机器数字集中在
  [PROJECT_STATUS 的 R2-11 小节](../../PROJECT_STATUS.md#r2-11-会话中界面本地子卡final_ready)。
- 独立 Review、正常 commit/当前分支 push 以主控同卡最终回执为准，用户 Review 待。父项 R2-11
  保持未勾：真实 LiveKit 人工媒体验收未做。截图存于主控证据目录；截图 CLI 前置不支持不是
  产品失败。

## 历史运行边界

- 实施端在主控 GO 之外未运行 Vitest、E2E、lint、build 或服务；上述数字均来自主控机器回执。
  实施端仅执行主控授权的 Node22 prettier 精确格式化（R1 时代码 9 路径、文档收口 4 文档）。
- 本批独占合成 PostgreSQL 由 R2-11/CP05 等共用，仍运行中，待本批末尾统一清理。
