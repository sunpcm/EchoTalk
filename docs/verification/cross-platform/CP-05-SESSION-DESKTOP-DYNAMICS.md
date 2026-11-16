# CP-05 会话界面动态桌面与键盘验证

## 状态与范围

- 当前状态：`FINAL_READY`。实施端只新增 5 场景浏览器 E2E，未修改真实产品组件、既有
  `session-active-layout.spec.ts`、既有夹具或其他旧测试。本卡是覆盖补证，无需产品修复，
  未制造 RED，正式产品返修 `0/2`；新 E2E SHA-256 保持
  `f46318553488ee3f0f2ed5f935398db6c0383b68b409ad9cad7fbc578e8a2d51`。
- 唯一实施工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支为
  `codex/B1-learning-events-20261112`，冻结 HEAD 为
  `816e6adf740a476fb450580efb2681e2b6791775`。
- 本卡继续使用真实 `ActiveConversation`、`AnswerRecommendations`、`ChatSubtitles`、产品
  store 与 CSS，只沿用既有 `session-active-stubbed.tsx` 对 LiveKit 模块的本地替换。它不连接
  真实 Media、Provider、IdP、SDK 信令或后端，因此不构成真实媒体、设备或生产验收。
- 全部 12 项行为门禁及 iOS 仅 Node `37` 项均 `exit 0`：Vitest `1262 passed / 55 files`；
  E2E `272 = Chromium 136 + WebKit 136`，全部 single passed，`retry / skip / flaky` 均为 `0`；
  backend `1044 passed / 3 warnings / 0 skip`，raw coverage `81.85846835618335%`；build
  `47`、Fake API `116`、API 类型 `8`；quality `0`。
- 新增 5 场景的 200 次重复补验为 `5 × Chromium/WebKit × 各 20 = 200 passed`。机器确认
  10 组、每组 20 次，每次执行恰有一个 passed result；retry、skip、flaky、unexpected 均为
  `0`，命令 `exit 0`。
- 两项私有产品响应负对照均有效命中：移除 layout class 后几何
  `toBeLessThanOrEqual` 目标断言失败 `1`；禁用 toggle 后 `aria-expanded` 目标断言失败 `1`。
  两项各 `exit 1`，变异未修改物理源码；恢复原响应后的正向 200 次重复再次全部通过。初次私有
  配置的 `cwd` 前置错误属于执行前置问题，保留原始错误但不计产品失败或负对照成功统计。
- 数据库按批次严格区分：旧 CP05D 所属批次的合成 PG 已完成
  `stop_exit0`/`auto_removed=true`；当前 `cp05k-cp02i-cp05l-20261115` 新建的三卡共用合成 PG
  仍在运行，待三卡全部收口时统一精确停止并核验移除。旧批清理回执不能转作当前批结果。

## 覆盖差集

既有 `session-active-layout.spec.ts` 在固定 390 与 1280 两个起点分别证明主题背景、场景/计时
页头、字幕优先、回答推荐单实例、移动端展开、桌面左右栏、无横向溢出与零 API 写。该静态矩阵
不能证明同一页面跨断点后的布局切换、200% 根字号下的重新布局、会话控件的真实键盘路径，以及
缩放后仍可见控件是否保留焦点和推荐展开状态。

新增 `apps/vite-app/e2e/session-desktop-dynamics.spec.ts`，提供 5 个场景：

1. 从 1280 宽屏切到 1023/1024 紧邻断点及 390/1280，核对单栏/双栏、推荐开关可见性、推荐
   展开状态、视觉顺序与无横向溢出。
2. 运行时将根元素字号设为 `200%`，核验实际 computed font size 为 `32px`，再在宽屏、800
   与 390 之间缩放；检查无横向溢出及可见按钮的水平可达性与 44px 底线。
3. 在窄屏通过 Chromium `Tab`/WebKit `Alt+Tab` 到达结束与推荐开关，键盘展开推荐后到达并激活
   第一条推荐；浏览器 clipboard 仅在测试页替换为内存捕获，以验证 activation 结果。
4. 键盘打开推荐并聚焦第一条推荐后，在 390、1280、1023 之间缩放；只要推荐按钮仍可见，焦点和
   `aria-expanded="true"` 应保持。
5. 连续跨断点、修改根字号和展开推荐期间记录 `/api/` 的 POST/PUT/PATCH/DELETE，要求零写请求。

## 断言口径

- “200%”只指通过 `document.documentElement.style.fontSize = "200%"` 改变根字号，不冒称
  Chromium/WebKit 浏览器 zoom、OS 缩放或设备缩放。
- 断点断言在 1023 与 1024 两个相邻宽度执行，直接对应现有 `64rem` 媒体查询边界。
- 键盘路径沿用仓库既有 WebKit 约定，即 macOS WebKit 使用 `Alt+Tab`；不新增快捷键。
- 缩放焦点场景只要求仍可见控件的既有焦点保持，不要求焦点跨入隐藏控件，也不主动恢复焦点。
- 零写请求只观察测试页生命周期内的 `/api/` 写方法；只读请求、真实后端结果和隐式网络时序由
  主控既有门禁另行判断。
- 测试不新增业务规则、自动恢复、采音、推荐逻辑或 API 请求；未建立 RED 的产品缺陷前不改源码。

## 验收结论与边界

- 5 个新增场景、双浏览器重复、两项响应负对照及恢复后的正向 200 次重复均已有实际回执；
  本卡达到 `FINAL_READY`。最终 format、独立 Review、commit 与 push 仍以主控同卡回执为准，
  用户 Review 待，本验证说明不写 APPROVED。
- CP05D 与 R2-11 保持各自历史时点，不并入本卡结果。原生 desktop 关闭会话、真实 Media/设备、
  Provider、IdP、真实数据与生产仍未验收。
