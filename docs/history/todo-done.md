# EchoTalk 已完成事项归档

> 已勾选事项与纯历史段落自根目录 `TODO.md` 搬运（2026-11-10），保留原标题分组与原文，除相对链接改为从本目录出发外未改动内容。未完成事项仍只在 [TODO.md](../../TODO.md)。
>
> 本文各条数字和“未启动”“未来协调”等状态均绑定写入时的历史快照，后续完成不改写旧值；当前状态以
> [PROJECT_STATUS.md](../PROJECT_STATUS.md)、[LEARNING_EVENTS_DESIGN.md](../LEARNING_EVENTS_DESIGN.md)
> 和 [TODO.md](../../TODO.md) 为准。

## 2026-11-16 WD-API 周报“已记录会话时长”opt-in 聚合与兼容解析（FINAL_READY）

- **状态：`FINAL_READY`，正式返修 `1/2`，TDD 中间修正 `1`**：唯一工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD
  `9d3ab32da3469d87b29340d35106cfa0cd126128`。本轮从主控提供的真实 RED 继续；PG 目标文件为
  `35 pass / 10 fail`，新 frontend 文件为 `7 pass / 15 fail`，失败均命中尚未实现的目标行为。
  中间修正只纠正两个测试 oracle，分别绑定逐条 floor 后的 `2ms` 与 Singapore 跨午夜开始日。
- **实现锚点**：`backend/schemas/session.py` 为日桶增加两个 optional/nullable 非负整数字段；
  `backend/services/session_queries.py` 仅在显式 opt-in 时增加一次有界三聚合 SQL；
  `backend/routers/sessions.py` 仅本路由接收 flag 并排除默认 null；`apps/vite-app/src/lib/api.ts`
  只在 weekly parser 中接受两个明确扩展键，非法关系同时降级未知。
- **兼容与请求边界**：省略/false 仍返回顶层及日桶旧形状，SQL 不读取 `ended_at`；true 的七个
  固定桶显式返回 `0/0` 或整数聚合。单条合法时长先 floor 到毫秒再求和，缺失/负结束只增加不可计算
  计数。`getWeeklyProgress` 仍不发送 `include_recorded_duration`，WD-UI 尚未实施。
- **R1 与最终验收**：首轮 quality 的 5 个不同 TS `unknown` 收窄诊断为 `exit 2`，build 重复同一组
  问题；R1 以两个 const 原始值捕获和现有类型守卫修正后，quality、完整 Vitest 与全量 E2E 均
  重新执行并 `exit 0`。主控最终 13 项门禁全部 `exit 0`，OpenAPI/types 已原生生成，新目标
  PG/前端/独立混合 PG 验证为 GREEN；三个私有加载变异均被原具体断言杀死。完整数字和保护、
  AST、编排诊断记录只集中在
  [PROJECT_STATUS 的 WD-API 小节](../PROJECT_STATUS.md#wd-api-周报已记录会话时长opt-in-聚合与兼容解析final_readyui-未实施)，
  不在此重复或改写原始证据。
- **终态边界**：实施节点没有自跑测试、服务、数据库、构建或生成。最终格式、Review、正常
  commit/当前分支 push 以主控同卡回执为准，用户 Review 待，本文件不自批 APPROVED；真实外部
  链路未验收。本批合成 PG 仍活动供 WD-UI 验证，尚未清理。时长父项仍不勾，WD-UI 未实施。

## 2026-11-15 WD-DESIGN 周报“已记录会话时长”设计合同（历史快照；后续 APPROVED@9d3ab32）

- **状态：原时点设计合同 `FINAL_READY`，正式返修 `0/2`，已停写**：唯一工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD
  `caa409a9f36f8e4b28c221800930c1f3ec94cef2`，开工 clean。用户已确认业务方案 A，不再等待时长
  业务口径裁定。
- **确认口径**：API 继续接受既有任意合法 `end_date`，返回截至该日并包含该日的最近七个本地自然日；
  历史日期请求可处理，不宣称任意合法 `end_date` 都含今天。UI 默认以本地今天作为 `end_date`，默认
  视图因此含今天。现有 completed 会话按 `started_at` 归日，沿用 IANA 时区和 UTC 半开窗口。时长取
  `ended_at - started_at`，单条先截去不足 1 毫秒再求和；跨日整段归开始日，等待、静音与暂停均
  包含。UI 只称“已记录会话时长”，不称有效说话或成功练习。
- **兼容性 r1**：接口新增 `include_recorded_duration: bool = false`。省略/false 保持顶层恰 `days`、
  每桶恰四字段、count-only SQL 且默认路径继续禁止读取 `ended_at`；路由
  `response_model_exclude_none` 避免默认响应出现扩展 null。仅 true 才返回
  `recorded_duration_ms` 与 `duration_unavailable_count` 并读取 `ended_at`。
- **客户端跨版本**：WD-API 扩展 `parseWeeklyProgressResponse` 和测试，允许并保留两个明确扩展键，
  四基础键严格校验、其他未知键继续拒绝；扩展缺失/null/非法只降级未知，不伪 0，尚不请求 flag。
  WD-UI 才固定传 true；旧服务忽略未知 query 返回四字段时，新客户端降级未知。
- **缺失与完整性语义**：ended 缺失或为负的 completed 会话另计不可计算，不伪 0。令
  `computable_count = completed - unavailable`；两个扩展都可信且 `unavailable <= completed` 才可显示
  时长。有 completed 但 `computable_count = 0` 时显示“暂无可用时长”，不显示 0；
  `computable_count > 0` 且时长为 0 才显示合法 0；`computable_count = 0` 与时长为正同时出现时按关系
  不一致处理。parser 可独立保留合法扩展，但任一桶缺扩展信息或关系不完整时周总未知；不新增顶层
  字段。
- **实施与验收边界**：本卡只新增设计合同并更新 `TODO.md`、`docs/PROJECT_STATUS.md` 与本文件；
  产品源码、测试、OpenAPI、生成类型、依赖和迁移未改。实施节点未自跑测试、服务或 PG；主控已独立
  完成本卡三测试树、13 项门禁和合成 PG 新建/迁移核验；详细机器数字、保护文件/旧迁移状态与
  PG 保留状态只集中在
  [PROJECT_STATUS](../PROJECT_STATUS.md#wd-design-已确认周报时长合同设计-final_readyapiui-未实施)。
  WD-API 与 WD-UI 仍未实施，时长父项、完整周报、三端和真实学习质量均不提前勾选。
- **后续三卡**：WD-API 随后已完成并进入 `FINAL_READY`，当前状态见上方本文件新条目；WD-UI 仍未实施。
  WD-DESIGN 的后续独立 Review 已 `APPROVED`，并随 `9d3ab32` 推送；上方旧条目中的等待状态只描述
  原时点，当前以本说明和 PROJECT_STATUS 为准。
  合同全文见[周报“已记录会话时长”合同](../WEEKLY_RECORDED_DURATION_CONTRACT.md)。

## 2026-11-15 CP04E 认证退出与活动 Room 组合补验（FINAL_READY）

- **状态：`FINAL_READY`（主控最终验收完成，CP-04 父项不勾）**：唯一实施工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD
  `a75223aa38419c07b3786465ea3fade9c930469f`。新增
  `apps/vite-app/src/components/session/auth-exit.integration.test.tsx` 并更新四份文档；
  产品、旧测试、helper、配置、依赖和迁移未改。
- **独立覆盖**：只新增活动 Room 中真实 logout 与当前请求经真实 `api.ts` 收到 401 两条组合
  场景，不重复 CP04I 的 Dashboard 换号与迟到响应三例。两场景共用同一终态断言：真实
  `AuthGate → App → VoiceInterface → RoomSession/RoomContextSync` 卸载、owned track 由产品
  `stopRoomLocalTracks()` 实际停止、conversation/settings/assessment 用户数据清理，并验证无
  业务写、无 401 重放、无媒体获取与无 Room 重建。
- **真假边界**：离线 OIDC、LiveKit 组件/Room/Track、严格 fetch/Response 与必要 OS 为测试
  边界；真实认证状态机、用户 store、API 401 失效、Room 清理调用与默认 Web 平台适配保留。
  SDK mock 不主动停止 track，不代替产品清理逻辑。
- **R1 夹具修正**：Room 由 render 次数改按真实挂载/卸载 effect 周期计数，并在退出前合法
  rerender 后断言仍单挂载、track 仍 live 且未 stop；严格 fetch 在来源、认证和路由拒绝前记录
  全部尝试，最终断言拒绝为空、尝试数等于允许记录数，保留 logout 零新增与 401 只一次且不重放。
- **R1 检查与 R2 修正**：R0 的 target `2/2`、完整 Vitest `1270/58`、E2E `272/0 retry` 与
  backend `1044 passed / 3 warnings / 0 skip` 均为历史事实；R1 target `2/2` 与完整 Vitest
  `1270/58` 也通过，外部两探针正确翻转。但 quality/build/typecheck 因 TS18047 为 `exit 2`，
  且同一 React 元素引用 rerender 可 bail out。R2 改用稳定非空局部 render 结果和 fresh
  elements 同一树工厂，准备期断言 render 调用数严格增加但不设固定上限，Room 挂载仍 `1`、
  卸载仍 `0`，同一 Room/track 仍 live 且未 stop。
- **最终验收**：主控独立核验目标 `2/2`、target-final `2/2`；停轨 disabled 与 user-clear
  disabled 两项核心负对照均命中具体断言。严格请求探针拒绝未知尝试，fresh-tree 重渲染通过，
  独立观察者确认发布用例真的 rerender 且未重挂载。最终 13 项同源字节门禁全 `exit 0`，正式
  实施返修 `2/2`。详细数字与证据复用边界统一见
  [PROJECT_STATUS](../PROJECT_STATUS.md#cp04e-认证退出与活动-room-组合补验final_ready)。
- **收口边界**：代码与测试停写，1268 个旧测试身份保留、新增 2 例，715 个保护文件字节未变。
  SDK 均为模拟，本地断言证明产品调用 stop、卸载与清空，不宣称真实 `MediaStreamTrack` 或 SDK
  网络断开已验；真实外部、原生/设备、CI 与生产未验。此次 next-local 新批合成 PG 已清理：
  `CP04E-stop-pg` `exit0`，在精确 ID、双 owner、loopback 与合成库身份核验后 `stop0`、
  `auto_removed=true`，名称和 ID 均不存在，其他资源未动；本批清理与旧批独立。
  Review/commit/push 见主控同卡回执，用户 Review 待，本文不自批 APPROVED。

## 2026-11-15 CP04I 真实入口换号与迟到响应组合（FINAL_READY）

- **状态：`FINAL_READY`（本地子卡完成，CP-04 父项不勾）**：唯一实施工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，基线
  `dacf7b3337b3e4640b040ad6ce048c8ee7f9a92e`。新增
  `apps/vite-app/src/App.identity-integration.test.tsx`；产品、旧测试、helper、配置、依赖和
  迁移未改。
- **真实接线与覆盖**：保留真实 `auth.ts`、根 `AuthGate`、`App`、四类 Dashboard 消费者、
  `SettingsDrawer`、store 与 `api.ts`；认证边界使用真实 `oidc-client-ts` 的离线
  `UserManager`/`User`，注入合成用户、metadata、Storage，不连接真实 SSO。覆盖换号后的旧树
  清理、迟到成功/失败隔离，以及同 principal token/revision 续期保活。
- **最终验收与历史**：主控最终 target、13 门禁和两个私有负对照均通过，本次合成 PG 已精确
  清理；R0 的夹具/类型/格式失败历史未抹除，正式实施返修 `1/2`。精确机器数字、逐项断言、
  R0/R1 修正和 PG 清理细节统一见
  [PROJECT_STATUS](../PROJECT_STATUS.md#cp04i-真实入口换号与迟到响应组合final_ready)，
  本节不重复大段计数。
- **边界**：真实 SSO/IdP、Keychain、设备、媒体、Provider、LiveKit、外部依赖与生产未验。
  Review/commit/push 以主控最终同卡回执为准，用户 Review 待，本文不写 APPROVED。

## 2026-11-15 CP05L Dashboard 生命周期实际组合缺口（FINAL_READY）

- **状态：`FINAL_READY`（本地子卡完成归档）**：唯一实施工作树为
  `/Users/sunpcm/code/EchoTalk/.review/worktrees/b1-continuation-20261115`，分支
  `codex/B1-learning-events-20261112`，冻结 HEAD
  `9a7ec847e36b3187f03076eb280f6b0bc78c7a4e`。新增真实 Dashboard 的四类消费者组合测试与
  验证说明；认证、Capacitor App 外部状态及 fake `fetch`/`Response` 仅为测试隔离，产品源码、
  默认工厂、四组件、query/hook 与 `api.ts` 均未 mock 或修改。正式实施返修 `1/2`。
  测试停写后的 SHA-256 为
  `4f46f3ecba0529df2fa99390989bf0fcd3504de59a6971890237f819bfa51a35`。
- **覆盖差集**：iOS pending→active；Web 真实 `online`→`pageshow` 的 AS/WP/WG ignore、DP
  override、旧响应丢弃和 WeeklyProgress 选日；整页 unmount 后迟到事件零新增请求、零业务写、
  零采音。iOS active 后首波为 5 条受管 GET；周概览 settle 默认选日另发 1 条 history，手动
  选日再增 1 条，不能混写为一次首波。
- **请求基址**：iOS 通过 `vi.stubEnv` 使用安全合成绝对 `VITE_API_BASE_URL` 并恢复，完整经过
  真实 `getApiBaseUrl()` 与 API 封装；Web 场景只证明生命周期组合接线，Web 默认 `/api` 与
  native fail-fast 的独立证据仍由既有 URL/API 测试承担；`api.ts` 的首个基址缓存限制如实
  保留。
- **最终机器验收**：R0 target `3/3 exit 0`，恢复默认源后的 target-final 亦为 `3/3 exit 0`，
  R1 后最终 13 门禁全部 `exit 0`。1262 个旧测试身份逐条保持，713 个保护文件字节不变。其余
  完整机器数字集中在
  [PROJECT_STATUS 的 CP05L 小节](../PROJECT_STATUS.md#cp05l-dashboard-生命周期实际组合缺口final_ready)。
- **负对照与返修**：WG 与 DP 两项有效私有加载期负对照均命中各自目标断言，均非通用超时；
  每项仅选中的一个 failure 可计负对照，各另有 2 个未选用例不计通过。精确 expected/actual
  集中在 PROJECT_STATUS。R1 仅在第一例 finally 的 unmount 后幂等释放 `getStateDeferred`，
  其余断言、事件、计数与超时不变。
- **边界**：三个 UI 场景本身不连接 PG；本批真实合成 PG 已实际承载 backend 全量测试。真实
  OS、真机 iOS 网络/恢复、SSO、Cloud、LiveKit、媒体与生产未验。本批三卡共用 PG 已按精确
  container ID、双 owner、`127.0.0.1` 与合成身份核验后
  `stop_exit0`、`auto_removed=true`。最终 format、独立 Review、正常 commit/当前分支 push
  以主控同卡回执为准，用户 Review 待，本归档不写 APPROVED。

## 2026-11-15 CP02I 通话占用本地组合补验（FINAL_READY）

- **状态：`FINAL_READY`（主控最终验收全过）**：
  新增 stdio 传输桥、
  6 场景组合 spec 与专用 vitest config，补齐真实 controller + 实际 `api.ts` 封装 +
  stdio fetch 薄桥 + 真实 ASGI + 真实合成 PG 的覆盖差集；Cloud 撤销仅经
  `LiveKitAPI.room` 显式模拟。
- **安全闭环**：桥在导入 backend 前完成 strict DATABASE_URL/`ECHOTALK_CALL_LEASE_LOCAL_PG=1`
  校验（精确 `127.0.0.1:55433`、`echotalk_b1_test` 用户/库、非空密码、无 query/fragment、
  `postgresql+asyncpg://` 接纳并归一）与进程级出站硬拦截（仅放行该 PG 连接）；HTTP 身份取
  请求 Bearer 合成 UUID 且限 owned 用户；仅接受本地相对 `/api/` 路径；内部失败发
  `bridge_error`，不伪造服务端响应、不回显敏感错误。
- **确定性晚到门**：请求先真实 commit，桥再 hold 响应；测试经 PG 确认后按 invalidate 与
  authRevision 两个独立 case 放行迟到成功，均不覆盖、不自动回写，全程无 sleep。
- **边界**：主 checkout 与其他 lane 只读；唯一写集为
  `apps/vite-app/integration/call-lease/`（3 文件）、`apps/vite-app/package.json`、
  `apps/vite-app/vitest.config.ts`、`docs/verification/cross-platform/CP-02-LOCAL-COMBINATION.md`、
  `TODO.md`、`docs/PROJECT_STATUS.md` 与本文件。本卡未自跑测试/服务/构建；最终数字与
  返修历史集中在
  [PROJECT_STATUS 的 CP02I 小节](../PROJECT_STATUS.md#cp02i-通话占用本地组合补验final_ready)，
  正式实施返修 `2/2`（产品源码未改）。完整事实见
  [CP-02 本地组合补验](../verification/cross-platform/CP-02-LOCAL-COMBINATION.md)。

## 2026-11-15 CP05K 会话界面动态桌面与键盘覆盖（FINAL_READY）

- **状态：`FINAL_READY`（本地子卡完成归档）**：新增 5 个浏览器 E2E 场景，补齐固定
  390/1280 静态矩阵未覆盖的跨断点、200% 根字号、键盘激活、缩放后焦点/展开状态保持和动态交互
  零 API 写。本卡是覆盖补证，无需产品修复，未制造 RED，正式产品返修 `0/2`；产品、旧测试和
  夹具未改，新 E2E SHA-256 保持
  `f46318553488ee3f0f2ed5f935398db6c0383b68b409ad9cad7fbc578e8a2d51`。
- **最终机器验收**：12 行为门禁及 iOS 仅 Node `37` 项均 `exit 0`。Vitest
  `1262 passed / 55 files`；E2E `272 = Chromium 136 + WebKit 136`，single passed，
  `retry / skip / flaky` 均为 `0`；backend `1044 passed / 3 warnings / 0 skip`，raw coverage
  `81.85846835618335%`；build `47`、Fake API `116`、API 类型 `8`；quality `0`。
- **重复补验**：`200 passed = 5 × Chromium/WebKit × 各 20`；10 组每组 20 次，每次执行恰有
  一个 passed result，retry/skip/flaky/unexpected 均为 `0`、`exit 0`。
- **负对照与恢复**：移除 layout class 后几何 `toBeLessThanOrEqual` 目标断言失败 `1`；禁用
  toggle 后 `aria-expanded` 目标断言失败 `1`。两项各 `exit 1`，变异未修改物理源码；恢复原响应
  后的正向 200 次重复再次全部通过。初次私有配置 `cwd` 前置错误保留为非产品执行错误，不计
  产品失败。
- **数据库批次**：旧 CP05D 所属批次已完成 `stop_exit0`/`auto_removed=true`。该卡当时仍在
  运行的 `cp05k-cp02i-cp05l-20261115` 三卡共用 PG，后续已在本批 CP05L 最终收口时按精确 ID
  停止并核验移除；两个批次均已有各自完成回执。
- **边界**：CP05D、R2-11 均为历史交付；原生 desktop 关闭会话、真实 Media/设备、Provider、
  IdP、真实数据与生产未验。最终 format、独立 Review、commit 与 push 以主控同卡回执为准，
  用户 Review 待，本归档不写 APPROVED。完整事实见
  [PROJECT_STATUS 的 CP05K 小节](../PROJECT_STATUS.md#cp05k-会话界面动态桌面与键盘覆盖final_ready)。

## 2026-11-15 CP05D 设置抽屉动态可见性

- **状态：`FINAL_READY`（本地子卡完成归档）**：设置抽屉已打开且输入聚焦后，普通 resize、
  根字号 200% 后 resize 与聚焦后仅改字号三种动态空间场景，通过当前活动元素归属、单帧合并和
  `nearest` 滚动保持输入可见，同时保留焦点、草稿和既有焦点语义。
- **有效 RED**：单测先证明实际 Drawer 挂载后缺少 viewport reveal 资源；浏览器在严格初始
  focus/value/完整可见成立后只改变 factor，目标场景仍出现不可见。静态布局通过；该静态矩阵未
  复现固有尺寸裁切，本卡不修改布局或控件尺寸；早期未建立初始可见性的诊断不作为回归。精确失败
  计数与 ratio 集中在 PROJECT_STATUS。
- **实现边界**：`window.resize`、可用 `visualViewport.resize` 与特征守卫的滚动区
  `ResizeObserver` 合并到一个 rAF；帧执行时只滚当前 connected 且归属滚动区的 active 元素。
  不主动 focus、不改草稿/store、不发业务写，不改变既有 focus trap/Tab；关闭、卸载与 StrictMode
  清理资源，特性缺失安全退化。
- **最终验收**：quality、Vitest、backend、build、Fake API、API 类型与 iOS Node runner 已通过；
  全量 E2E 为 Chromium/WebKit 各 `131`、共 `262`，全部 passed，skip/flaky/unexpected/retry 均为
  `0`、`exit 0`。新增三场景双浏览器各重复 `20` 次、共 `120` 次，机器确认六组各 `20` 次，
  每次执行恰有一个 passed result，skip/flaky/unexpected/retry 均为 `0`、`workers=1`、`exit 0`。三项有效私有 load 变异均
  杀死目标断言，恢复后冻结目标测试为 `7 passed / 0 failed`；未选用例不计覆盖。其余精确机器计数
  集中在 PROJECT_STATUS。
- **收口边界**：两份测试完整行为 AST 与有效 RED 一致；Node22 Prettier 仅纯格式化新 E2E 与四份
  仓内文档，产品与 unit 测试未改动，既有断言未改。**旧 CP05D 所属批次**的数据库验证已完成，
  该旧批自有合成 PG 已 `stop_exit0`、`auto_removed=true`，精确 container ID、双 owner、
  loopback 与合成身份均核验，其他资源未动；`cp05k-cp02i-cp05l-20261115` 新批三卡共用 PG
  后续也已在同批 CP05L 最终收口时按精确 ID 完成 `stop_exit0`/`auto_removed=true`。独立
  Review、正常 commit/当前分支 push 以主控同卡最终回执为准，用户 Review 待，本归档不写
  APPROVED。真实 OS 键盘、非零 safe-area、设备、
  Media/Provider、IdP、真实数据与生产未验；CP-05 手机动态视口/键盘/safe-area 父项继续保留
  `[ ]`。
- 完整机器数字集中在
  [PROJECT_STATUS 的 CP05D 小节](../PROJECT_STATUS.md#cp05d-设置抽屉动态可见性)，验证口径见
  [CP-05 设置抽屉动态可见性](../verification/cross-platform/CP-05-SETTINGS-FOCUS-VIEWPORT.md)。
  下方 R2-11/R2-10 等条目均为各自历史时点，与本卡不合并计数。

## 2026-11-15 R2-11 会话中界面本地子卡（FINAL_READY）

- [x] **R2-11 会话中界面本地子卡（FINAL_READY，本地实现）**：LiveKit 容器背景映射主题
      token、场景名与墙钟计时页头、移动字幕优先、`thinking` 独立文案、单实例回答推荐展开与
      `sessionPresentation` 内存展示对象（归属 `(sessionId, sessionGen)`，代际/失败/reset 清空）。
      两份单测与 3 个 E2E 模块桩文件随卡交付；页头墙钟只是 `started_at` 到当前时间的经过时间，
      不是有效说话/练习/周报/计费时长。
- [x] **TDD 与历史失败保留**：有效 RED 为 unit `22 failed / 4 passed / 26 total` 与 browser 1 例
      （旧 Listening 挂载后页头缺失）。R0 全量 Vitest `1254/1`、quality `2`（新测试非法
      `AuthState`）、format `1`、E2E `252/4`（过早取 body 250ms 过渡中的主题色）均保留，不并入
      产品回归。R1 修正 logout 用例接真实 `AuthGate` 清理链、字面量改合法 `anonymous`、背景比较
      改 `expect.poll` 等待最终色，并移除 start 完成处误加的外壳补丁。
- [x] **最终机器验收**：13 项门禁全部 `exit 0`，含 Vitest `1255 passed / 54 files / 0 skip`、
      E2E `256 = Chromium 128 + WebKit 128`（single passed / retry 0 / 0 skip / flaky / unexpected）、
      lint `132 warning / 0 error / 0 new` 与三项有效私有 load 变异均 killed。完整机器数字集中在
      [PROJECT_STATUS 的 R2-11 小节](../PROJECT_STATUS.md#r2-11-会话中界面本地子卡final_ready)，
      边界与口径见
      [R2-11 验证说明](../verification/cross-platform/R2-11-SESSION-LAYOUT.md)。独立 Review 与
      正常 commit/当前分支 push 以主控同卡最终回执为准，用户 Review 待，不写 APPROVED。父项
      R2-11 保持未勾：真实 LiveKit 人工媒体验收未做，SDK 模块桩不等于真实媒体。

## 2026-11-15 R2-10 硬编码文案收口（FINAL_READY）

- [x] **R2-10 硬编码文案收口（FINAL_READY，本地实现）**：父项原验收完整保留：store/lib/组件中
      14 处中文字面量与 `goalReached` 英文迁入 `src/i18n/`；`Goal reached!` 按已确认文案改为
      “已达成今日目标！”，其余既有文案内容不变；设置抽屉标题为“设置”；推荐卡片与语法提示复用
      真实技能中文映射；扫描测试要求 `src/` 非 i18n、非测试文件无中文字符串字面量。
- [x] **父项既有回执未被新工作覆盖**：设置入口/dialog 标题和活动行、结束/恢复确认面板去完整 UUID
      已由 R2-UI 按方案 A 完成并留档；用户可见正文、`title` 与最终可访问名称均无 UUID，完整 ID
      只保留内部 key、稳定定位、API 参数与精确目标归属。R2-10 承接该既有回执，没有重复实现或
      改写其历史数字。
- [x] **本卡新增收口**：10 个后端真实技能共用中文标签目录，推荐卡已知标签与语法提示扩展标签均
      命中中文；未知标签分别维持原 `formatTitle` / 原 `skill_tag` 回退，原型属性使用 own-property
      安全判断。`platform/url.ts` 的 20 条 `[EchoTalk]` 配置错误原文迁入语言包，21 处抛错原位保留，
      异常类型、校验顺序与全部 URL 安全行为不变；中文扫描撤除该文件豁免。
- [x] **TDD 与历史失败保留**：冻结测试先为
      `3 failed / 18 passed / 21 total / 0 skip / exit 1`，三项有效失败对应推荐已知标签、语法提示
      扩展标签和 URL 中文扫描。首轮 `toString -> To String` 是测试夹具对 `formatTitle` 的误判，
      正确回退为 `ToString`，不混作产品回归。初始完整 format `exit 1`、R0/R1 两次 quality
      `exit 2` 均保留；R2 只补齐生成类型要求的 `target_level` 与 `weakest_skill_mastery`，并格式化
      同一测试，断言、API 类型和产品字节未改。
- [x] **最终机器验收**：主控确认 13 项门禁全部 `exit 0`，R2 修正后的 quality、Vitest、E2E、
      backend、format、build 与 lint 均全绿；全部私有加载变异均被目标断言杀死，独立 AST、URL
      顺序/归一化 AST 与保护文件字节核对通过。完整机器数字集中在
      [PROJECT_STATUS 的 R2-10 小节](../PROJECT_STATUS.md#r2-10-硬编码文案收口final_ready)。
      独立 Review、正常 commit/当前分支 push 以主控同卡回执为准，用户 Review 待；本归档不写
      APPROVED。该历史时点，本批独占合成 PG 仍供 R2-10/R2-11/CP05 使用；**旧 CP05D 所属
      批次**后已停止并确认自动移除，不涉及当前 `cp05k-cp02i-cp05l-20261115` 新批资源。

## 2026-11-15 SGEC-OFF 严格离线校验与合成评测

- [x] **SGEC-OFF 严格离线校验与合成评测（FINAL_READY，本地实现）**：新增纯模块
      `services/sgec_offline.py`、CLI runner `scripts/evaluate_sgec_offline.py`、固定合成
      `tests/fixtures/sgec_offline_cases.json` 与结构化单测 `tests/test_sgec_offline.py`。纯模块只做
      五核心字段全批次严格结构校验、调用方合法 `skill_tag` 集合与受控合成元数据，`run_offline` 的
      fixture 读取归位到 scripts runner，纯模块导入/调用/序列化零副作用。完整数字、5 有效变异、
      纯模块冷进程边界、runner 真实 CLI 与边界见
      [PROJECT_STATUS 的 SGEC-OFF 小节](../PROJECT_STATUS.md#sgec-off-严格离线校验与合成评测final_ready)，
      本归档不重复抄录。SGEC 总项、真实 Provider、人工 gold、BKT/learning events 接线与生产未验，
      不称准确率。精确合同见 [SGEC_OFFLINE_CONTRACT.md](../SGEC_OFFLINE_CONTRACT.md)。独立技术
      Review、最终文档 format、正常 Husky commit/当前分支 API 发布以主控同卡回执为准，用户 Review
      待，不写 APPROVED。

## 2026-11-15 R2-UI 设置标题与活动记录去 UUID

- [x] **R2-UI 设置标题与活动记录去 UUID（FINAL_READY，本地实现）**：设置入口/dialog 使用“设置”，
      活动行与结束/恢复面板使用既有模式和开始时间，用户可见正文、`title` 与最终计算可访问名称均无完整
      UUID；内部 key、稳定定位、API 目标与业务行为保持。阶段链由历史 `DRAFT_READY` 快照进入
      `FINAL_READY`；首轮完整 Vitest 与 E2E 的失败来自旧显示定位迁移不全，不是产品、信令或行为回归。
      31 处旧定位、两处既有 E2E 同类依赖、私有 overlay 变异、最终 `allowed=24 / protected=672`、截图边界
      和最终门禁的完整事实见
      [PROJECT_STATUS 的 R2-UI 小节](../PROJECT_STATUS.md#r2-ui-设置标题与活动记录去-uuidfinal_ready)。
      独立技术 Review、最终 format、commit/push 以主控同卡回执为准，用户 Review 待，不写 APPROVED。
      生产、真实 Provider/IdP/LiveKit、设备、部署和真实数据未验收；SGEC-OFF 当时待实施（原时点），
      本批独占合成 PG 当时待 SGEC 后清理，现已完成清理。

## 2026-11-15 R2-LIVE 活动会话生命周期实时门禁

- [x] **R2-LIVE 活动会话生命周期实时门禁（FINAL_READY，本地实现）**：生命周期事件现从同一
      conversation store 实时读取启动状态并复用 `isStartingConversationSession`，移除了挂载快照
      门禁与 hook 多余参数；未改 data/auth/store/platform 或旧测试。有效 TDD 链
      `2 failed / 1 passed → 3 passed → 2 failed / 1 passed` 保留；`act` 安排修正后新 3 测试
      `3 passed / exit 0` 且无警告，冻结 RED 的全部 26 个 `expect` 经 AST 核验保持。挂载快照与
      render 快照两项私有变异均使两正向 DOM 失败、反向通过并 `exit 1`，未改跟踪源。
      主控新鲜 13 门禁全部 `exit 0`；完整数字、保护文件与边界集中在
      [PROJECT_STATUS 的 R2-LIVE 小节](../PROJECT_STATUS.md#r2-live-活动会话生命周期实时门禁final_ready)，
      本归档不重复抄录。
      本轮 GO 只授权本地实现；生产、真实 Provider/IdP/LiveKit、设备与部署从未验收。独立技术
      Review、最终文档 format、正常 Husky、提交和推送以主控同卡回执为准，用户 Review 待，不能
      自行写成 APPROVED。R2-UI 与 SGEC-OFF 当时仍未实施（原时点）；本批独占合成 PG 当时留待后两卡
      且尚未清理，现已完成清理。正式返修为 `0/2`。

## 2026-11-15 DEC-A R2 与 SGEC 设计口径回写

- [x] **DEC-A 设计确认回写与正式返修 1/2（FINAL_READY）**：按用户已确认的 R2 与 SGEC 推荐 A，新增
      [R2 活动会话生命周期与显示合同](../R2_FOLLOWUP_CONTRACT.md)与
      [SGEC 严格离线校验与合成评测合同](../SGEC_OFFLINE_CONTRACT.md)，并回写
      [前端 Data 层合同](../FRONTEND_DATA_LAYER_CONTRACT.md) §8/§9、[TODO.md](../../TODO.md)、
      [PROJECT_STATUS.md](../PROJECT_STATUS.md) 和本归档。R2 拆为 R2-LIVE 与 R2-UI 两张未勾实施卡；
      活动行和结束/恢复确认面板均不得向用户显示完整 UUID。SGEC 总项仍未勾，只确认严格离线设计，
      未产生真实质量或准确率结论。正式返修 1/2 已修正空 `errors`、标准 JSON fixture、旧挂载快照
      持续抑制事实、共享设置标题来源及最终可访问名称边界。主控 12 项与附加脚本的已回传证据和细
      数字集中记录在 [PROJECT_STATUS 的 DEC-A 小节](../PROJECT_STATUS.md#dec-a-r2-与-sgec-设计口径回写final_ready)，
      本归档不重复抄录。
      本卡为纯文档修改，没有改代码、测试、API、数据库、迁移、依赖或 CI；实施节点不跑测试、服务、
      PG 或真实外部依赖，只允许对精确六文档执行现有 Prettier。最终 13 组合（含 format）、独立
      Review、DEC-A 当时任务分支提交发布与用户 Review 状态以该卡主控同卡回执为准。DEC-A 写入时
      R2-LIVE、R2-UI 和 SGEC-OFF 三张实施卡均未完成；R2-LIVE 后续已另行完成，R2-UI 和
      SGEC-OFF 当时也均未完成（原时点），后续均已分别完成。

## 2026-11-15 RDOC 路线图历史快照口径修正

- [x] **RDOC 路线图历史快照口径修正（FINAL_READY）**：RDOC 当时只修正
      [架构演进规划](../ARCHITECTURE_ROADMAP.md) §3.4 与 B1 实施顺序中的三处时点标签、当时的
      验证索引和旧暂停边界。R2-14 的 `941 / 81.57% / 246` 等历史数字，B1/WPH 的失败与证据，
      A18P2 细节，路线图架构、业务政策、范围及阶段退出条件均保持原样。RDOC 当时实现/验证指向
      [PROJECT_STATUS 的当前验证基线](../PROJECT_STATUS.md#当前验证基线)；旧“停在此卡、不启动
      下一卡”注明为历史暂停，RDOC 之后下一卡以其后用户授权与 [TODO.md](../../TODO.md) 为准。
      本卡为纯文档修改，实施节点未跑测试、服务或 PG，未读取 runtime 或凭据。完整机器门禁数字、
      技术 Review、最终 format、RDOC 当时任务分支提交发布与用户 Review 状态见
      [PROJECT_STATUS 的 RDOC 小节](../PROJECT_STATUS.md#rdoc-路线图历史快照口径修正final_ready)。
      本归档不复制细数字。

## 2026-11-15 A18P2 启动/恢复生命周期减重与实例隔离

- [x] **A18P2 启动/恢复生命周期减重与实例隔离（FINAL_READY）**：移除模块级 `currentStartupTracker`、
      `testingLifecycleOptions` 与全局测试注入 `_setLifecycleOptionsForTesting`，`createConversationSlice`
      工厂只拥有自己的 tracker/adapter/监听/计时器；start/resume 重复生命周期编排抽成实例内公共
      `runStartupLifecycle`。R1 将 helper 由 async 改为同步返回（`awaitNativeReady` 仅 native 分支异步
      等待 ready），恢复 Web 零额外 await，并修新 fixture 类型。新增
      `conversationLifecycleIsolation.test.ts` 覆盖 start/start、start/resume、resume/start、
      resume/resume 与 cancel/late 跨实例隔离，两旧测试文件迁移到局部 platform mock。最终 13 项门禁
      组合均 `exit 0`，Vitest `1216 passed / 50 files / 0 skip`，三项有效私有行为变异均被对应断言杀死。
      A18P2 当时详细数字、TDD/R1 历史与证据边界见
      [PROJECT_STATUS 的 A18P2 小节](../PROJECT_STATUS.md#a18p2-启动恢复生命周期减重与实例隔离final_ready)和
      [CP-05 原生启动与显式恢复](../../docs/verification/cross-platform/CP-05-NATIVE-STARTUP.md)。
      A18P2 当时最终文档 format、独立 Review、当时任务分支提交和推送以该卡主控同卡回执为准，
      用户 Review 待；不开 PR、不合并、不部署，真实设备与真实外部链路仍未验收。

## 2026-11-15 A19 P2 Room 快照与引用所有权

- [x] **A19 P2 Room 快照与引用所有权（FINAL_READY）**：Room 初次 Web 门禁改为每次实际读取的
      无订阅纯快照，hidden/offline 继续失败关闭，unknown/null 保持兼容；RoomContextSync 移除
      无人消费的可选 `onRoom`/`roomRef`，只在已提交的 layout effect 中发布所需 Room，替换或卸载
      时仍同步停止所属本地音轨。并发 render、SDK Room commit 替换、StrictMode 与健康重渲染已有
      A19P2 行为回归。首轮 TESTS RED 为 `2 passed / 3 failed`；R1 只迁移既有 CON-04 的非断言
      夹具 setup，所有旧 `expect` 保持不变。最终 13 项门禁组合均 `exit 0`，Vitest 为
      `1211 passed / 49 files / 0 skip`，三项有效私有行为变异均被对应断言杀死。详细当前数字、
      TDD/首轮 GREEN/R1 历史与证据边界见
      [PROJECT_STATUS 的 A19 P2 小节](../PROJECT_STATUS.md#a19-p2-room-快照与引用所有权final_ready)和
      [CP-05 Native Room](../../docs/verification/cross-platform/CP-05-NATIVE-ROOM.md)。A82 旧完整失败
      因果仍未证明，A82C 历史计数不得复用。最终文档 format、独立 Review、当前任务分支提交和推送
      以主控同卡回执为准，用户 Review 待；不开 PR、不合并、不部署，真实外部链路仍未验收。

## 2026-11-15 A82C Native Room 本地夹具就绪

- [x] **Native Room 回归夹具就绪（仅 A82 本地子项）**：当前两条 native/DOM 交叉异步用例先保存
      当前 DOM 实例，再等待同一实例的 callback map 项及所需字段登记；目标断言仍在 native
      callback 返回前验证本地轨同步停止。主控当前 13 项门禁分组均 `exit 0`，两条目标在 20 个
      独立进程中按零重试执行并通过。详细计数、覆盖率、源码审计与边界见
      [PROJECT_STATUS 的 A82C 小节](../PROJECT_STATUS.md)。
      本归档仅关闭本地夹具就绪子项；旧 A82 的 15 份 main 回执 SHA 匹配只属于历史证据，且当前
      两条目标与旧 A82 完整 callback 存在 6 处 typed store facade 标识差异，不能写成整段 AST
      完全相同。旧失败完整因果、真实设备/Provider/IdP/LiveKit、远端 CI、部署与 RF 总项仍未关闭。
      独立Review/提交发布见主控同卡回执，用户Review待。

## 2026-11-14 A84C 文档收口（历史快照）

- [x] **A84 历史状态校正**：旧 A84 r0 交付记录“待 Review”只是交付时点；后续旧快照已在
      `42c251b3470aa5f7e9cfe5a1fb2655dc8f9b5aa9` 完成独立 APPROVED、7 个有效变异及
      lane/main 15 项复验。该结论绑定 2026-11-01 的
      `fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d` 快照，不表示 A84C 的 `44cb125…` base
      在当时已通过。A84C 于 2026-11-14 达到 `FINAL_READY`：该历史快照的 13 项门禁分组执行均为
      `exit 0`，目标三文件 `29 passed`，专用 PG 迁移和两项入口变异完成，PG 已核验精确 ID/
      双 owner/loopback 后 stop `exit 0` 并验证 auto-remove，SDK 实际版本为 `1.6.10`；旧
      `1.4.3` 与旧 `37` 目标仍是更早历史，不与 A84C 快照结果混算。所有数字均不作为 A82C
      当前结果。独立Review/提交发布见主控同卡回执，用户Review待。详细证据与外部未验边界见
      [PROJECT_STATUS 的 A84C 小节](../PROJECT_STATUS.md)。

## 2026-11-14 RF04E 已有远端 CI 证据核对

- [x] **RF04E 已有远端 CI 证据核对**：完成 `42c61bb`、`6bda2cd`、`ef6cb53` 历史 main push
      与 `5c28e1b` iOS failure/aggregate failure 的只读证据核对，完整 run/job/契约矩阵见
      [CP-06 CI 质量门禁验证](../../docs/verification/cross-platform/CP-06-CI-QUALITY-GATES.md)。
      本归档只表示证据文档子卡完成；RF-04 总项、iOS 有限重试、required check、真实链路和本轮核对
      时的起始树 `4ec1a4d` 的 CI 仍未通过或未验。

## 2026-11-14 CF20 Chromium 焦点就绪竞态回归

- [x] **CF20 本地实现**：仅改原 Playwright spec，以共享 `weekly-progress` 就绪 helper 和
      held/release 门控绑定原焦点断言；产品字节、原共享 `openDashboard` 与 Fake API 数据未改，
      weekly-progress route gate 为明确新增回归。
- [x] **CF20 定向验证**：删除 helper 唯一等待的私有 mutation 被 Chromium/WebKit 各 3 次杀死；
      正式定向复验为 `80 passed / 0 failed / 0 skip / 0 flaky / 0 retry / exit 0`。详细门禁数字与
      边界见 [PROJECT_STATUS 的 CF20 小节](../PROJECT_STATUS.md)。
- [x] **RF04E 全量 E2E 焦点可达性**：CF20 历史快照 base
      `c5f9c7274ac85f6fb77212b8944c97e6edae41df` 上的完整双浏览器 E2E 为
      `248 passed = Chromium 124 + WebKit 124`，失败/跳过/flaky/retry 均为 0；原焦点用例已在
      这两个 project 中完成本地实现验证。
- 本归档只表示本地实现与机器核验完成；最终完整门禁与 Review/提交/发布见主控同卡回执，
  用户 Review 待。

## 2026-11-13 WG20 WebKit 周语法补验

- [x] **WG20 周语法 WebKit 重复稳定性补验**：主控实跑完整 13 项门禁及聚合均 `exit 0`；
      WebKit 零重试重复补验达到当时门槛，完整数字与证据见
      [PROJECT_STATUS 的 WG20 小节](../PROJECT_STATUS.md)。历史“无重试 5 次失败 1 次”保留；
      旧“认证刷新耗掉唯一一次 503”假说仍未证实，该历史快照夹具为持续返回 503 直到测试显式放行。
      该轮仅文档收口，无产品修改或源码修复。最终回执与用户 Review 待主控处理。

## 2026-11-13 R2-13 组件目录按页面边界归位

- [x] **R2-13 组件目录按页面边界归位**：抽出 `Dashboard` 并按页面边界 `git mv` 38 个文件，其中
      29 个内容不变、9 个仅修改模块路径或目录注释，12 个测试文件随之移动；三测试树计数不变。
      独立代码 Review 为 APPROVED，用户 Review 待。详细门禁和边界见
      [PROJECT_STATUS](../PROJECT_STATUS.md)。

## 2026-11-13 R2-12 macOS 构建产物与同步前校验

- [x] **R2-12 macOS 构建产物与同步脚本**：完成共享 Vite 的 macOS 纯静态构建产物
      `dist/macos/<mode>`、manifest、外部工具启动前的来源/平台/mode 校验，以及将 `ANALYZE`
      纳入 Turbo 缓存输入的任务。独立代码 Review 为 APPROVED，本地验收完成，用户 Review 待；
      正式壳、Tauri 选型、native 认证、真实设备、签名、公证与发布均未创建或验收。详细门禁和
      边界见 [PROJECT_STATUS](../PROJECT_STATUS.md)。

## 2026-11-13 R2-14 Compose 系统就绪与一次性迁移

- [x] **R2-14 Compose 系统就绪与一次性迁移**：本文记录的本地验证为在 `b744e63` 父提交上完成
      本地合成实施。新增公开、无用户身份的 `GET /api/health/system-ready`，只使用共享
      PostgreSQL 连接执行 `SELECT 1`；成功返回 typed `200 {"status":"ready"}`，连接、查询、超时
      或资源释放失败统一返回 typed `503 {"status":"not_ready"}`，不返回底层异常、地址或配置。
      readiness 只在连接 Context 完整释放后响应；最终数据库操作预算为 `0.5s`，为当次快照中的 asyncpg
      约 `2s` 的 shielded graceful close 留余量，完整响应目标 `<3s`。旧 `/api/health/ready` 的
      函数、认证和用户配置判断未改；真实路由无 Bearer/错误 Bearer 均 `200`，旧 ready 错误
      Bearer 仍 `401`。
      Compose 新增使用 API 角色、同一 `DATABASE_URL` 和既有环境边界的一次性
      `echotalk-migrate`，执行 `alembic upgrade head`，设置 `restart: "no"` 并依赖 PostgreSQL
      `service_healthy`；API、Agent、analysis-worker 依赖迁移
      `service_completed_successfully`，Web 依赖 API `service_healthy`。API healthcheck 使用镜像
      已有 Python 标准库和 `ProxyHandler({})` 请求 loopback，显式绕过 `HTTP_PROXY` 等环境代理，
      HTTP timeout 为 `4`、容器 timeout 为 `5s`，不嵌入用户 Token。合同见
      [Compose 启动与系统就绪合同](../COMPOSE_STARTUP_CONTRACT.md)。18 份既有迁移 SHA 未变，
      本卡新增 migration 为 0；B1 人工切换期间全部新旧 worker 仍须保持停止到
      `traffic_resumed`，Compose schema 升级不代表生产数据切换。
      验证结果：完整 13 项门禁及聚合 `exit 0`；backend
      `941 passed / 3 warnings / 0 skip / 81.57% raw Total coverage`，Vitest
      `1206 passed / 49 files`，Fake API
      `116 passed / 0 skip`，双浏览器 `246 passed / 0 failed / 0 skip / 0 retry / exit 0`
      （`--retries=0 --workers=1`），build-script `21`、API 类型 runner `8`、非 native iOS 脚本
      runner `37` 均 `exit 0`。lint 为 `132 warning / 0 error`，逐诊断与父基线相同。Compose
      原生 `config` 与迁移依赖图 `exit 0`，未解析 `env_file`、镜像或启动原整栈。健康探针实际
      Python 命令在自有 HTTP fixture 的 ready/unready/wrong-body/timeout/HTTP proxy trap 五类中
      符合预期；ready `exit 0`；unready、wrong-body、timeout 各 `exit 1`；proxy trap 被绕过且代理
      收到 0 请求。
      主控 R0 真实自有 PG pause 在 4.5s 外层请求超时且未返回 `503`，是有效产品失败证据；R1 新增
      的约 2s-cleanup 模拟用例在 3.5s 硬期限命中，是模拟回归 RED。随后 R1 真实自有 PG pause 返回
      通用 `503`，耗时 `2.518465s`、checkedout 为 0；unpause 后返回 `200`，用户数不变。真实连接
      释放后再注入异常仍返回 `503`。R1 同一正式返修轮确认并修复两个 P1：其一，等待查询预算再叠加
      asyncpg 约 2 秒取消清理，导致 3.5 秒硬期限先命中，最终改为服务内 0.5 秒操作预算；其二，
      环境代理会截获 loopback healthcheck，最终只在当次探针使用 `ProxyHandler({})`。FastAPI
      延迟 `IncludedRouter` 曾使 OpenAPI 测试直接读取 `app.routes` 时 `StopIteration`，属另一项夹具
      修正，改为从公开 `routers.health.router` 枚举相对 route，未改产品语义。两个 P1 同属 R1，
      正式产品返修仍使用 `1/2`。
      源码 10 文件与主控 `R214-R1-code-frozen-sha256.json` 逐项一致；缺 route 的初始 backend
      `6 failed / 0 skip / exit 1` 是功能实施前的有效 TDD RED（当时新功能尚未实现，尚未进入真实
      PG 故障验证）；`ModuleNotFound` 导入错误、延迟 `IncludedRouter` 的 route 枚举及 format
      问题属于夹具/格式。主控独立代码 Review 为 APPROVED，正式返修 `1/2` 闭环；最终 Review/发布
      见同卡回执，用户 Review 待。生产发布、原 Compose 整栈、真实 Provider/IdP/LiveKit、设备、
      模式切换和未来卡均未勾选。

## 2026-11-12 B1 学习事件实施（B1-1）

- [x] **B1-1 模型、新增迁移与约束**（依赖 B1-0）：新增 `LearningEvent` ORM 并注册，新增以
      `c06_transcript_events` 为父 revision 的 `b1_learning_events` 迁移，落实 identity
      `apply_seq`、事件形状 CHECK、幂等键唯一、完成 Job 唯一、来源外键 `ON DELETE RESTRICT`
      和四个查询索引；16 个旧迁移未改动。pronunciation/grammar observation 允许
      `model_version=NULL`，兼容既有 `legacy_mock`/`legacy_rule` 回填与旧 pending 来源，不写伪版本。
      主控 RED 实跑为 4 failed/0 skipped、exit 1，失败均对应缺失 ORM/迁移/表。实现节点未连接
      PG、未执行迁移或测试。随后主控在本轮专用合成 PostgreSQL 完成空库 upgrade 至 b1、PG schema
      GREEN `4 passed / 0 skip / exit 0`、current/downgrade 回 c06 后清除表/索引/identity、
      reupgrade 至 b1 exit 0，以及独立真实 PG 与 ORM 元数据 compare 零差异 exit 0。ORM 的
      `idempotency_key` 唯一约束与 migration 同名一致；`JSONB(none_as_null=True)` 将 Python
      `None` 绑定为 SQL `NULL`。既有 worker PostgreSQL fixture 原固定 `c06_transcript_events`，
      主控实跑得到 `1 error` RED 后，已改为读取仓库 Alembic 源码 `get_current_head()` 并严格比较
      数据库 `alembic_version`；原 DB/user/PG15.19/DSN guard 不变。本轮最终门禁、backend 813、
      本机 E2E `233 passed / 1 failed / exit 1` 及唯一既有 WebKit 失败见
      [PROJECT_STATUS B1 小节](../../docs/PROJECT_STATUS.md)，不能称本机全树全绿。生产库未执行。
      无业务写入、切换、导出、删除、依赖或 UI 变更。

## 2026-11-12 B1 学习事件实施（B1-2）

- [x] **B1-2 同事务事件写入、幂等、用户锁与 BKT 隔离**（依赖 B1-1）：成功 Job 在同一事务写
      `analysis_completed`、mapped observation、评估结果、BKT 状态和 `succeeded`；用户行锁覆盖
      幂等校验、事件插入、状态读取与更新。切换后旧 `pending` 和按现有重试规则可处理的 `failed`
      Job 走同一新事务，成功旧 Job 不回填；`occurred_at=sessions.ended_at`，BKT 按 `apply_seq`。
      验收覆盖重复/并发重试、跨用户/Session 来源交叉、全合成隔离、失败回滚和旧状态路由；并发
      事务只产生一次观察和一次 BKT 更新，`bkt-v1` 四参数冻结；本版不开放成功后重新分析。失败
      重试仍可用；只读重算的政策保留，工具由尚未实施的 B1-3 交付。
      结果：专用合成 PostgreSQL 目标套件 `116 passed / 0 skip / exit 0`；完整 backend
      `844 passed / 3 warnings / 0 skip`、覆盖率 `80.82%`。用户锁、实际 `apply_seq` 相反观察、
      原始 ordinal、缺观察拒绝、未知模型 `NULL`、不复制 alignment、三类完成冲突，以及 10 条观察/
      3 个技能/知识状态单次读取/unmapped 计数探针均 `exit 0`。15 项完整门禁中 14 项 `exit 0`，
      E2E 为 `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败是与历史基线相同的
      WebKit Provider select `336×23 < 44px`，DocTalk 通过，不能称本机全树全绿。独立代码 Review
      结论为 APPROVED。当前停在 B1-2 Review（用户审阅待），提交/推送结果见本次交付回执；不创建
      PR、不合并。

## 2026-11-13 B1 学习事件实施（B1-3）

- [x] **B1-3 基线切换工具与只读一致快照重算校验**（依赖 B1-1、B1-2）：为既有
      `(user_id, skill_id)` 幂等写入 `baseline_snapshot(source=legacy_unknown)`，以数据库单例控制行
      串行化五阶段切换，并要求维护人员从停旧 worker 起维持停写到 `traffic_resumed`。事件 writer 与
      已领取 Job 的执行入口统一经过持久门控；实际领取函数 `claim_next_job` 本身没有 gate，因此全部
      新旧 worker 必须保持停止到 `traffic_resumed`。旧历史趋势不可恢复。只读校验在单一
      `REPEATABLE READ READ ONLY` 快照首查固定 `MAX(apply_seq)` watermark，按基线、observation、
      冻结算法版本与参数重建状态，失败只报告而不修改产品状态。
      结果：主控独立代码/测试 Review 为 APPROVED；目标套件为
      `147 passed / 0 failed / 0 skip / exit 0`；完整 backend 为
      `878 passed / 3 warnings / 0 skip`、覆盖率 `80.51%`、exit 0。
      Vitest 保持 `1206 passed / 49 files`，Fake API `108`、构建脚本 `21`、API 类型测试 `8`，
      lint 为 `132 warning / 0 error / 0 new warning`，前端自 `f6007a2` 未改。除 E2E 外的完整
      门禁均为 exit 0。E2E 首轮为 `232 passed / 2 failed / 0 skip / 0 retry / exit 1`，失败为
      WebKit Provider select 几何与 readiness 引导 textarea 超时；DocTalk 定向为
      `3 passed / 0 failed / 0 skip / 0 retry / exit 0`；再次全量为
      `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，DocTalk 通过、只剩同一 WebKit Provider
      select 实测失败。首轮失败及 DocTalk 定向结果均保留；仅 DocTalk 首轮失败原因未确认，不能
      归因于环境、历史基线或回归，也不能称全树全绿。
      新增迁移 `b1_learning_event_cutover` 在专用合成 PostgreSQL upgrade、downgrade 回
      `b1_learning_events`、reupgrade 与 roundtrip 均 exit 0，既有事件保留，ORM 与真实 PG schema
      零差异；既有 17 份迁移与 18 份迁移 pin 未变。独立门控、整包快照、只读、CLI 导入隔离和八项
      回归缺口探针退出符合预期，READ COMMITTED 反例 mutation 被杀死。
      运维边界：实际 Job 领取函数 `claim_next_job` 本身没有 gate，全部新旧 worker 必须保持停止到
      `traffic_resumed`。部署代码不会启动 worker；显式停写声明、数据库锁和表锁都不能证明未知旧进程
      已退出。CLI 只接受已批准的合成库白名单，不隐式读取 `.env`；结果码/用法按 0/1/2 区分，
      baseline 默认 preview 零写，只有显式确认参数才写。零语法错误没有持久来源行，校验只能检查
      coverage 结构与类型，并在来源存在时比对事实，不能虚构 Provider 事实或独证“零错误”。
      B1-5 未来必须协调合法删除本人 `baseline_snapshot` 事件后的全局控制数量/摘要，保留控制行
      `learning_event_cutover.revision`、`learning_event_cutover.cutover_at` 和既有门控，不得删除
      单例控制行或重新锚定；本卡不实现。
      B1-4/B1-5 未启动。本卡停在 Review 等待用户审阅；提交/推送状态以同卡交付回执为准，不开 PR、
      不合并。生产 DDL/切换/部署、真实数据、真实 Provider/LiveKit/IdP/设备均未执行；任务分支 push
      不触发远端 CI，远端 CI 未执行。

> **历史时点说明：** 上述 B1-5 未启动、未来协调口径属于 B1-3 当时快照；B1-5 后续完成记录见
> [本平台整账号硬删除](#2026-11-13-b1-学习事件实施b1-5)。

## 2026-11-13 B1 学习事件实施（B1-4）

- [x] **B1-4 本人数据结构化 JSON 导出**（依赖 B1-1、B1-2）：新增只读
      `GET /api/user/data-export`、13 个 schema、导出 service 和薄路由，返回固定
      `schema_version=1` 的 JSON 附件。顶层仅含 `schema_version`、`exported_at`、sessions、
      transcripts、pronunciation assessments、grammar assessments、learning events 与 knowledge
      states；Session 只含解释子记录所需的最小元数据。各节采用显式白名单投影，排除 API Key、
      认证身份、内部 prompt/文档、音频、Provider 完整原始响应/引用、幂等键及未列明字段。
      独立导出会话使用单一 `REPEATABLE READ READ ONLY` 快照，不复用认证调用方事务，也不通过强制
      提交 auth 事务解决首次用户映射；本人空导出返回空数组。查询后校验 Session/Event、
      AnalysisJob/来源评估以及 Skill 关系，只读取本人数据；部分数据不补造，未知版本保留 `null`。
      顺序固定且带稳定标识兜底；完整模型构造后整体缓冲序列化，成功响应仅带 JSON、`no-store`、
      固定附件名和 `nosniff`，失败返回无成功/下载头的通用 500。全部同类 float 边界拒绝 NaN/±Inf，
      合法 `None` 保留 `null`。Fake API 成功响应 fixture、Node 契约测试、A3 operation 审计、
      OpenAPI 和 TypeScript 生成物均同卡完成，A3 固定 missing/unmodeled/deviation 清单逐字未改。
      结果：主控独立代码/测试 Review 为 APPROVED，产品返修使用 `1/2`；主控代跑初始 backend 基线
      `878 passed / 3 warnings / 0 skip / 80.51% / exit 0`，首轮 RED backend
      `10 failed / 0 skip / exit 1`、Fake API `106 passed / 4 failed / 0 skip / exit 1`，R1 非有限值
      RED `9 failed / 11 passed / 0 skip / exit 1`。修后目标 `20 passed / 0 skip / exit 0`，完整
      backend `898 passed / 3 warnings / 0 skip / 80.86% / exit 0`；20 项目标是 898 项的子集。
      Vitest `1206 passed / 49 files`、Fake API `110 passed / 0 skip`、构建脚本 21、API 类型测试 8
      均 exit 0；format、lint、typecheck、build、backend Ruff、OpenAPI schema、provider metadata
      与 TS 漂移检查均 exit 0，lint 为 132 warnings/0 errors 且无新增。完整双浏览器 E2E 为
      `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败是
      `[webkit] e2e/a11y-focus-touch.spec.ts:94:5` 的设置抽屉三个 Provider select
      `336x23 < 44px`，断言位于第 127 行；UI/样式/E2E/配置相对父提交未改，按同名范围外遗留保留，
      不能称全树全绿。`run-gates.py` 聚合 exit 0 不覆盖真实 `e2e=1`。
      专用合成 PostgreSQL 15.19 从空库重放 18 份既有迁移成功，迁移字节不变且无新增 DDL；旧
      OpenAPI path/schema 逐值未变。独立探针确认六类跨归属失败关闭、真实 SQL 列白名单、服务端
      只读事务拒写、事件与 knowledge state 同快照、后段失败无成功头、首次映射用户空导出及
      NaN/±Inf 均为 500 且无下载头；READ COMMITTED mutation 被真实并发后提交事件泄漏断言杀死。
      累计同步内存缓冲带来随账户数据增长的快照时长与内存风险，本卡不新增阈值、分页、异步任务、
      UI、依赖或限额。用户 Review 待；文档收口时尚未提交/推送，最终状态以同卡回执为准；不开 PR、
      不合并、不部署。生产/真实数据、Provider、LiveKit、IdP、设备与远端 CI 未执行；B1-5 未启动。

> **历史时点说明：** 上述 B1-5 未启动为 B1-4 当时快照；后续完成记录见
> [本平台整账号硬删除](#2026-11-13-b1-学习事件实施b1-5)。

## 2026-11-13 B1 学习事件实施（B1-5）

- [x] **B1-5 本平台整账号硬删除**（依赖 B1-1、B1-2、B1-4）：新增
      `DELETE /api/user/account`、薄路由和专用 schema/service，仅使用经 Bearer 验证并映射的本人 ID。
      路由先完成不读业务库的 Bearer 验签，再取得 learning-event control gate，最后复用同一已验证
      身份完成本地 User 映射/flush；缺失或错误 Bearer 不执行业务 SQL，也不等待 control gate。服务在
      调用方同一事务显式删除 `users`、`user_profiles`、`user_settings`（含加密 Key 副本）、
      `sessions`、`transcripts`、`session_contexts`、`analysis_jobs`、`pronunciation_assessments`、
      `grammar_errors`、`learning_events`、`knowledge_states` 和 `call_leases`，保留全局 `skills`、
      control 行和他人数据。成功固定返回 `200 {"status":"deleted"}` 且只在 commit 完成后发送；
      异常整体 rollback 并返回通用 500，重复删除幂等，旧 Job、stale recovery、worker 和晚到写入
      不会复活数据。
      删除前校验原控制数量/摘要、canonical baseline 和跨归属关系，坏 baseline 或跨 user lease 失败
      关闭，不通过删除、`SET NULL` 或重算漂白坏数据。合法删除本人 `baseline_snapshot` 后按剩余真实
      事件更新全局数量/摘要，保留 singleton、revision、cutover_at、phase 和既有 gate；无 control 时
      用 SREX 表锁重读并封闭 prepare 窗口，不删除单例或重新锚定。实际 `claim_next_job` 仍无 gate，
      全部新旧 worker 必须保持停止到 `traffic_resumed`；数据库锁和部署代码不能证明未知旧进程已退出。
      Fake API 最小真实成功 fixture 与 Node 契约覆盖 Session/Job 删除后失效、重复删除幂等和随后导出
      六业务数组为空；A3 固定 missing/unmodeled/deviation 清单未扩大。OpenAPI/TypeScript 只新增
      DELETE path 和一个响应 schema，旧 path/schema 逐值未变；18 份既有迁移字节不变，无新 DDL、
      依赖、产品 UI 或 workflow。
      结果：fixture native 前置为 `1 passed / exit 0`；初始 RED backend 为
      `32 failed / 1 passed / 0 skip / exit 1`，Fake API 为
      `108 passed / 4 failed / 0 skip / exit 1`，删除语义增量 RED 为
      `108 passed / 5 failed / 0 skip / exit 1`。R0 主控目标为 `34 passed`，但独立 Review
      CHANGES REQUESTED，匿名/错误 Bearer 会在认证前取得全局 control `FOR UPDATE`；R1 新增真实
      Bearer 回归 RED 为 `2 failed / 34 deselected / 0 skip / exit 1`，修复身份验证顺序后保留原 34
      项并达到目标 `36 passed / 0 skip / exit 0`。完整 backend 为
      `934 passed / 3 warnings / 0 skip / 81.64% / exit 0`，36 项是完整树子集；Vitest
      `1206 passed / 49 files`、Fake API `113 passed / 0 skip / exit 0`、build-script 21、API 类型
      8、iOS 脚本 Node runner 37 均 exit 0。lint 为 `132 warning / 0 error`，warning 行清单与
      B1-4 逐行相同。
      独立合成 PostgreSQL 正常探针全为 exit 0，覆盖 12 表本人数据无残留、他人数据逐值保留、两项
      并发删除、坏 baseline、跨 user lease、双删除、首次 cutover、真实 Bearer、未链接旧 User 与
      worker 锁序；两项运行时变异各被真实 count/死锁断言杀死 1 次。临时 PG 已停止并自动移除。
      完整双浏览器 E2E 保留 `233 passed / 1 failed / 0 skip / 0 retry / exit 1`，唯一失败是
      `[webkit] e2e/a11y-focus-touch.spec.ts:94:5` 的设置抽屉三 Provider select
      `336x23 < 44px`，断言位于第 127 行；本轮 UI/样式/E2E 未改，不能写成全树全绿或未经证据归因
      环境。第一次完整 format 按实测 `exit 1` 保留，唯一问题是 Node `fake-api-test.mjs`；本卡随后以
      现有 Prettier 对该 Node 文件和六份收口 MD 做纯格式化，最终完整 format 由主控补跑并以回执为准。
      主控代码/测试 Review 为 APPROVED，产品返修使用 `1/2`；用户 Review 仍待。B1-0～B1-5 已完成
      本地实施、主控代码/测试 Review 与完成项归档，当前停在 B1-5 用户 Review，不启动下一卡。提交/
      推送尚未执行，最终状态以同卡交付回执为准，不预填 SHA；不开 PR、不合并、不部署。生产发布/
      DDL/切换、真实数据、生产级不可恢复删除、真实 Provider/IdP/LiveKit、设备、原生 iOS、远端 CI、
      生产备份及法定/特殊保留均未验收；外部身份后续可按原机制重新创建空账号，本卡无 tombstone。

## 2026-11-13 B1 WPH WebKit 设置控件修复

- [x] **WPH 恢复 Provider select 的 44px 触控高度与可见焦点**：仅调整
      `SettingsProviderFields.tsx` 的共享 select 一行 class，使用显式 `44px` 高度、移除会压掉焦点
      轮廓的 `outline-none`，并恢复既有 accent 主题的 2px focus outline；保留原生
      `appearance:auto`、上下箭头、选项、值和 `onChange`，未改 `styles.css`、业务或其他生成物。
      测试文件冻结为 SHA-256
      `f7da11d15b608113ce7d5d94ee33a24c5ea7205e642442b30a36e01dd55b65c5`，产品最终文件为
      `55762d586f8279bf316c4eaff135ab8d980f9fe897d348b9305a8e559361814d`。
      主控真实 RED 为 Chromium `7 passed`、WebKit `7 failed / 0 skip / 0 retry / exit 1`，新增六个
      用例均在高度 23 与可见焦点 false 处失败；定向 GREEN 为 `14 passed / exit 0`。修复后完整
      Chromium/WebKit E2E 为 `246 passed / 0 failed / 0 skip / 0 retry / exit 0`，完整 backend 为
      `934 passed / 3 warnings / 0 skip / 81.45% / exit 0`；Vitest 1206/49 files、Fake API 113、
      build-script 21、API 类型 8、iOS 脚本 37 均 `exit 0`，全部 13 项完整门禁及聚合均 `exit 0`。
      最终真实浏览器检查为 Chromium/WebKit 三控件各 `336x44`、`appearance:auto`、2px solid
      outline，原生箭头与选中值保留。主控代码/测试 Review 与真实截图 Review 均 APPROVED，P0/P1
      未关闭为 0，正式返修 `0/2`；文档收口时整卡 MD 终审与用户 Review 待，WPH 尚未 commit/push，
      最终状态以同卡最终回执为准。生产、真实数据、Provider/IdP/LiveKit、设备、远端 CI 与部署未
      执行。

## 2026-11-12 架构演进 A6（分层依赖 lint 规则）

- [x] **A6 分层依赖的 lint 规则**（Sonnet；依赖 A4 完成）：用 ESLint 限制 `platform` 不得依赖
      `lib`/`store`/`components`，`lib` 不得依赖 `store`/`components`，data 层不得依赖 `components`。
      验收：规则为 error 级；现有代码零违规或逐条修正；故意加一条反向 import 时 lint 失败。
      结果：零依赖error规则覆盖既定三组禁止边，清理入口移至store且顺序/断言不变；
      现有7违规归零，主控22项/补充19项分层检查、真实逆向import失败并恢复，
      四份AST与144份保护文件保全；代码`87e0fd5`（PR #155）六CI确认
      Vitest1206/49、Linux E2E234、pytest809/80.19%、Fake108/gen8/build21。
      追加本机首轮232/2、后续旧新完整各233/1与Linux234分开记录；
      DocTalk80次及完整对照未复现，P2待查观察保留，不计本机通过，详见当前状态及PR。

## 2026-11-12 架构演进 A4e（ActiveSessions 只读列表迁移）

- [x] **A4e ActiveSessions 只读列表迁移到 data 层**（Sonnet；依赖 A4a 已确认）：迁移
      `active-sessions/useActiveSessionList.ts`，结束/恢复写操作归属与互锁保持。验收：原
      `ActiveSessions.test.tsx` 与相关 E2E **零改动**通过；读侧不再自行维护请求 id、认证订阅与
      生命周期门禁；关键防线做 3 处以上真实变异并列出是否被原测试捕获。
      结果：真实Data controller持有请求归属/分页/去重/tombstone，6份UI/写流程/订阅中枢逐字不变；
      146份原测试/fixture/config零改。R1修复取消/失败后的旧cursor复用；主控9项与补充独立13项
      对照通过，原AS116三处变异均被捕获，额外cursor私有变异抓到两项回归。代码head
      `fb47cf4`（PR #154）六CI原始日志确认1206/49、Linux234（0 skip/retry）、
      pytest809/80.19%、Fake108/gen8/build21；无依赖/HTTP/数据库变化，真实服务/设备未验。

## 2026-11-12 架构演进 A4d（DailyProgress 数据查询迁移）

- [x] **A4d DailyProgress 单组件迁移**：专用Data hook实际消费controller，首屏summary+rows
      原子Page、单套认证/lifecycle/午夜+100ms，保留原读取时点、非物理取消和挂起错误策略。
      原DP23/data45、146份测试/fixture/config及全渲染分支AST不变；代码head `05e76fe`（PR #153）
      六项CI原始日志确认Vitest1206/49、Linux E2E234（0 skip/retry）、pytest809/80.19%、
      Fake108/gen8/build21。四处真实变异均被原DP断言捕获，私有行为8/8、重入4/4通过。
      无用户可见行为、依赖或数据库变化，真实外部服务与设备未验证。

## 2026-11-12 架构演进 A4c（WeeklyProgress 数据查询迁移）

- [x] **A4c WeeklyProgress 单组件迁移**：两个真实 controller 共享单套 auth/lifecycle/focus/clock，
      上游 weekly 提交后才允许 history，组件只渲染与事件转发。原 WP31/data45、146份
      测试/fixture/config和界面AST不变；代码 head `a350dd5`（PR #152）六项CI原始日志确认
      Vitest1206/49、Linux E2E234（0 skip/retry）、pytest809/80.19%、Fake108/gen8/build21。
      auth revision、重复cursor、日窗口下界三处真实变异均被原WP捕获；额外行为探针6/6。
      无用户可见行为、依赖或数据库变化，真实外部服务与设备未验证。

## 2026-11-12 架构演进 A4b（WeeklyGrammar 数据查询迁移）

- [x] **A4b WeeklyGrammar 单组件迁移**：组件只渲染/转发 retry，认证、生命周期、请求槽、timer
      与过期响应判断由 data controller/hook 承担。原 JSX/文案/ARIA/class 保持；146 个
      测试/fixture/config 文件 SHA256 不变。代码 head `496326c`（PR #151）六项 CI 与原始日志已核实：
      Vitest1206/49、E2E234（0 skip/retry）、pytest809/80.19%、Fake108/gen8/build21。
      auth revision、suspend 门禁、分钟检查三处真实变异均被原 WG14 项测试捕获；R1 分钟相位
      探针真实 RED→GREEN，源码恢复。未新增依赖、未改变产品行为或数据库；真实服务/设备未验。

## 2026-11-12 架构演进 A4a（只读 data 层本地收口）

> 本节的完成指契约、最小 controller/hook、契约测试、本地门禁与独立评审已收口；最终仍以交付
> PR 的 Linux 检查为准。

- [x] **A4a 前端 data 层契约与契约测试**：新增最小只读查询 controller、React hook、契约文档
      与 45 项不依赖业务组件的契约测试。按用户确认的方案 A 保留四区块 per-query 差异；未新增
      依赖、未迁移组件。GitHub P2 的官方 RED 为新增 3 项失败、原 42 项通过，无显式 key 策略的
      默认键补充纠错后，45 项契约、全量 Vitest 1206/49 与独立探针 7/7 通过；
      lint/typecheck/build 强制执行、0 cache 通过，原 42 项测试内容逐字保留。五个
      `prefer-const` 机械修正和 Prettier 前后 555 个断言/行为调用 AST 相同；契约中的 93 个
      `a7841b7` 永久链接保留。A4a 尚无最终合并回执，Linux/PR CI 未覆盖本次纠错；该本地收口
      不替代 CI 或真实外部环境验收。

## 2026-11-12 架构演进 B1（学习事件台账设计交付）

> 本节的完成只指设计文档已获主控 APPROVED 并完成归档。建表、代码、迁移执行及删除政策均未开始。

- [x] **B1 学习事件台账设计**：新增 [学习事件台账设计](../../docs/LEARNING_EVENTS_DESIGN.md)，
      定义只追加 `learning_events`、分析 Job 写入时机与幂等键、合成标记与派生排除、
      `knowledge_states` 重算校验、现有评估结果关系、保留选项和单条线性 Alembic 草案。
      草案父 revision `c06_transcript_events` 已核对存在，唯一 Python Markdown 草案经
      `ast.parse` 成功。结果：无表、无迁移文件、无 DDL 或代码/测试/依赖变更；legacy 基线、
      旧 pending/failed Job、retention、未来重分析身份和 `bkt-v1` 参数仍待用户政策确认，
      A4a 方案 A 不属于 B1 授权。

## 2026-11-12 架构演进 A5（导航切片收口）

> 本节的完成指本地实施、机械测试归属与文档已收口；最终仍以交付 PR 的 Linux 检查为准。

- [x] **A5 导航状态移出会话 store**：`appView` 已迁入独立导航切片，并与会话切片组合在同一
      物理原子容器，不引入 Router。本轮 Vitest 1161/45 通过；lint 与 typecheck `--force`
      成功且 0 cache（132 warnings / 0 errors）。8 份既有测试的 340 个 case 与 1624 个 expect
      相关调用 AST 保持不变，DocChatSetup 仅拆 `store` mock 与 `beforeEach` 所有权，契约和
      行为未改变。新交付 PR 尚未创建，E2E、backend 与 Linux CI 以该 PR 最终检查为准，旧
      PR #145 的 Fake API 75 等结果只属于历史。

## 2026-11-12 架构演进 A3（最终合入收口）

> 下方 2026-11-12 补充说明是合入前快照；A3 最终状态以本节为准。

- [x] **A3 Fake API 接受 OpenAPI 契约校验**：PR #141 最终 head
      `b1d375611d10f0380bc30f42af486c404b1c21c0` 已通过 Linux CI run `43134694256` 与
      PR Guard run `43134694336`，记录 Vitest 1156（44 个文件）、Fake API 108、E2E 234
      （0 skip/retry）、生成器 8、构建脚本 21、pytest 809/80.19%。随后以 squash commit
      `a7841b7486b14af01e535e5e3f4e0472c621d198` 合入 main，整卡已从 `TODO.md` 移出。
      真实 Provider、IdP、LiveKit、设备、语音链路与生产部署仍未验收；下方原 A3 条目及
      Fake API 103、本机 E2E 233/1 等失败历史保持原样。

> 2026-11-12 补充：下方 A3 条目保留原 head `437f6ff` 的当时记录。独立 Review 发现 Unicode 长度边界问题，
> 修正候选与最新 main 的整合尚待目标 CI，当前状态以 [TODO.md](../../TODO.md) 未勾选项为准。

## 2026-11-11 架构演进 A1（会话准入纯抽取）

- [x] **A1 后端会话准入规则收拢**：将 `backend/routers/sessions.py` 中 `get_session_token`
      两分支重复的「用户不存在/未配置密钥/密钥未验证/套餐限制」准入，与
      `get_session_token`/`dispatch_agent` disabled 分支两处「已结束会话」状态校验，收拢到
      `backend/services/session_admission.py`（`verify_session_admission`、
      `get_active_session_or_raise`），路由仅编排，HTTP 码与 detail 逐字不变，`dispatch_agent`
      沿用原有准入范围。结果：收敛既有重复检查，保留检查顺序及两条路由不同的已结束文案；
      验证记录见 [2026-11 实施记录](./2026-11.md)。

## 2026-11-11 架构演进 A2（前端 API 类型统一由 OpenAPI 派生）

- [x] **A2 前端 API 类型收口**：将 `apps/vite-app/src/lib/api.ts` 中已有 OpenAPI schema
      的业务类型改为 `ApiSchemas[...]` 派生，保留既有 required、nullable 与 union 收窄；
      `TokenResponse`、`HealthReadyResponse`、`ApiRequestOptions` 及未建模端点响应维持原声明。
      结果：Node 22 类型检查与生成类型字节检查通过，运行时、生成文件、后端、测试、fixture、
      依赖和锁文件零改动；验证记录见 [2026-11 实施记录](./2026-11.md)。

## 2026-11-11 架构演进 A3（Fake API 成功响应契约核对）

- [x] **A3 Fake API 成功响应契约核对**：在 `apps/vite-app/scripts/fake-api-test.mjs`
      保留既有 75 项行为断言，新增真实子进程 HTTP 成功响应套件，并以
      `backend/openapi.json` 对当前 26 个 operation 做覆盖分类和字段校验；新增零依赖、
      测试侧 OpenAPI 子集校验器，未知关键字、断链 `$ref` 与无法校验的约束失败关闭。
      结果：固定列出 5 个 Fake API 缺失 operation、4 个空 schema 成功响应与 3 个精确偏差；
      缺失项由真实 Fake fallback 守护，并补齐全部标准 HTTP 方法、自有属性、日期和未知能力
      回归；主审实跑 103 passed（75 既有 + 28 新增，0 skip/cancel），独立边界探针
      10/10 通过，四处真实变异全部被新增用例抓到并逐字恢复源码。
      未改 Fake API、产品运行时代码、OpenAPI、生成文件、依赖或锁文件；完整记录见
      [2026-11 实施记录](./2026-11.md)。

## 2026-11-06 候选任务（无 Provider Key 前提，未开工）

- [x] **会后分析按来源门控**（方案 C-1，#120；2026-11-09 本地验收：pytest 809、Vitest 1142、E2E 180，变异 7/7 被杀；
      语法仍为 demo 规则，BKT 需 SGEC 落地后才有真实信号；无发音且无语法错误时的文案已于 2026-11-10 定为中性空态，见 [云端评审](../../docs/reviews/2026-11-cloud-review.md) §3.1）：BKT 只吃 `is_synthetic=False` 的观察；
      `USE_MOCK_ELSA=False` 时发音标为不可用、语法独立完成，不再整个 Job 失败；须同时处理
      发音缺失时 assessment 接口 404、前端 `Promise.all` 整体报错与纯语法重跑幂等。验收：
      pytest 覆盖全合成、两种方向的混合来源、两路真实、无发音、无转录、重跑，前端覆盖部分结果。
- [x] **livekit-agents 安全升级到 1.6.10**（方案 A-2，GHSA-q77r-q2p5-68vf；2026-11-09 本地验收：
      uv 0.9.18 重锁 107 包、export 一致，pytest 794 passed / 78.88%，脱敏变异 7 例被杀；
      错误 Key 握手冒烟与真实语音未验，远端 CI 待跑）：agents 与四个
      插件 `==1.6.10`、`livekit==1.1.14`、`livekit-api>=1.2.0`，uv 重生成 lock 与 export，
      不混入 OpenAI 3、Turn Detector 或模型更换；保留 #125 脱敏钩子；验收：三测试树通过；
      本地 LiveKit dev + 故意错误的 Key 触发 Deepgram/Cartesia 握手失败，日志无 Canary 明文
      （无需真实 Key，外网访问与服务启动需用户另行授权）；离线回归、错误 Key 冒烟、真实语音分开报告。
- [x] **python-jose 迁移 PyJWT**（方案 B；2026-11-09 本地验收：lock 107→102 移除 python-jose/ecdsa/rsa/pyasn1/six，
      pytest 801 passed，auth 变异 4/5 被杀、1 例等价；遗留两项已于同日补齐：下限上调至 2.13.0（PyJWK alg 绑定起始版本）、防御分支回归）：改 `auth.py` 与测试，并在 API 依赖组显式声明 PyJWT、
      删除 `python-jose`，同步 lock/export；与 1.6.10 升级共用依赖文件，须顺序生成。验收：补伪造
      HS256 + RSA `kid` 回归，401/503 语义不变。
- [x] **核销 LiveKit 消息路径 SDK 类型忽略**（P2 既有项；2026-11-09 按 1.6.10 源码取证：消息路径只用公开类型字段
      `ConversationItemAddedEvent.item`→`ChatMessage.role/text_content: str | None`，无 type: ignore；未跑类型检查器）：当前消息路径已用公开属性和类型收窄，
      唯一命中 `log_redaction.py` 的 `method-assign` 不在范围内；待 1.6.10 固定后取得类型证据再勾选。

## 2026-11-07 遗留问题（已核实，未修复）

- [x] **无 Key 运行时验收忽略长期进程退出码**（#128 Codex P2，已在 #128 修复：`stop()` 断言
      `long_process_exit_nonzero`，`exercise()` 断言 `process_exit_nonzero`，`test_runtime.py` 已覆盖）：
      `tools/keyfree-runtime/runtime.py` 的 `stop()` 只断言 `Running is False`，
      `exercise()` 只把三个 Worker 与 API 的退出码追加到 `process_exits`，仍写
      `status: "passed"`；只有 gateway 与 oneshot 校验退出码。验收：生成成功回执前统一要求
      全部长期进程 `ExitCode == 0`，补 runtime unittest：任一进程非零退出时回执不为 passed。

## 2026-11-04 补充轮：WebKit 首导航与 Worker 停机

- [x] 修复 macOS WebKit 首导航停滞：现场确认 AppKit 原生窗口动画线程累积、dispatch
      队列饱和；仅 Darwin WebKit 通过可执行包装器转发同锁 SDK 默认参数并追加进程偏好。
      未改 HTTPS/H2、load/30s、retry、排序或页面动画，未持久化系统偏好。见 `ui/REVIEW-r1.md`。
- [x] 设置零隐式写保护监听真实 `/api/user/settings`，原零写断言后由真实 UI Save 作正对照；
      隐式保存变异两浏览器 Expected0/Received1。重新启用原生窗口动画的变异也真实复现
      WebKit 第64例 goto 超时；两项均完整恢复，恢复后 WebKit87 无重试通过，首次失败与 trace 保留。
- [x] Worker 有界优雅停机：新程序三个 Worker 与 API 均 exit0；真 PID1 的 SIGINT、在途
      drain、超时取消/回滚及停止后不再领取均已验。旧过期恢复与幂等保持，范围见 `worker/REVIEW-runtime-r1.md`。
- [x] 新 integration 实跑完整19项全部 process/gate0：frontend10、backend5、runtime3 加
      wrapper 语法；1098 Vitest、21 build-script、69 Fake API、8 types、730 pytest/3 warnings，
      覆盖率78.43%、59%门禁保持，runtime 单测19项。UI lane 与最终集成两轮双浏览器均
      174全过、retries0，见 `final-quality-checks-r1/summary.json`与 `ui/root-fix-quality-checks-r1/summary.json`。
- [x] 本轮 runtime 与最后产品测试 PG/网络已按归属清理：
      `product-cleanup-checks-r1/summary.json`为 exit0，`setup/product-pg-cleanup.json`为 removed=true；
      `resource-cleanup-final.json`中本轮剩余容器/网络为空，镜像、证据与 worktree 保留。

## 2026-11-04 至 11-05 七天语法与宿主 HTTP（本地收口，停在 Review）

Dashboard 已实现截至 `end_date` 的滚动七个本地自然日真实语法记录卡片。该窗口不是
从周一开始的 ISO/自然周；服务端按认证用户、completed 会话的 `started_at` 半开区间及
既有非合成、非 demo 语法记录一次性有界聚合，客户端展示总记录数、固定六类中的最多三项、
固定复习提示和合法空态。未接分析触发、写请求、Token、采音或个性化生成。

本地实测为 1133 Vitest、21 build-script、72 Fake API、8 types runner、178
Chromium/WebKit（retries 0）、773 pytest（3 warnings、覆盖率 78.48%、59% 门禁）和
31 runtime unittest；frontend10、backend5、runtime3 与 wrapper 语法均通过。宿主
`host-gateway` 精确隔离拓扑下 health 200、匿名 401、缺 Key readiness 503，16 次实际
HTTP 得到 21 条语法记录及 Top 3 `other:7`、`article_usage:5`、`verb_tense_past:5`，
历史 55 行分 4 页，25 小时 DST 日通过。旧 internal-only 拓扑的宿主 18800 不可达历史
保留，新网关结果不外推到原 Compose。API/UI/runtime 三个范围 Review 均 APPROVED；
本节点停在 Review，后续以主控最终报告为准。当前仍为未提交 dirty 候选，无
commit/push/pull/rebase/merge/部署，当前候选远端 CI、真实 Provider/IdP/LiveKit、语音、
设备、签名与 native 编译均未验，next2 未融合。完整分项见
[RF-08 七天语法 Top 3 验收手册](../../docs/verification/cross-platform/RF-08-WEEKLY-GRAMMAR.md)。

## 2026-11-04 七天概览与隔离运行时收口（上一轮历史）

- [x] 七天概览与按日历史代码独立 Review APPROVED；14 份前端文件与主控原生生成的
      schema 已机械组合，槽位守卫变异被真实 deferred 断言杀死并完整恢复，详见 `ui/REVIEW-r1.md`。
- [x] 最终功能检查 16 项通过：前端除 format/E2E 的 8 项、backend5、runtime3；
      1098 Vitest、21 build-script、69 Fake API、8 types、678 pytest/3 warnings，
      后端覆盖率 78.67%，59% 门禁不变；runtime 单测 19 项，见 `final-functional-checks-r1/summary.json`。
- [x] 最终 Chromium/WebKit 共 174 cases：173 clean + 1 flaky 后重试通过，process/gate
      均为 0；8 条新增 weekly 用例在两引擎全过。多轮首次超时和 trace 保留，见
      `final-e2e-checks-r1/summary.json`及对应 `01-e2e/command.log`，不称 174 clean。
- [x] C1/C2 及最终 154 份后端输入的新 API/Agent 镜像完整性、隔离服务与真实 HTTP
      已验；最终镜像与配对测量分开。配对收益仅来自 `runtime/paired-comparison-r1.json`：
      API 0.1803%、Agent 0.2728%，不外推冷启动收益。详细分项见 `docs/PROJECT_STATUS.md`。
- [x] C1/C2/final 自建运行资源清理通过；文档读取时产品 PG 清理也已通过，
      `setup/product-pg-cleanup.json`为 removed=true，`resource-cleanup-final.json`中本轮
      containers/networks 均为空。清理按本轮资源归属，不表示全机无其他任务。
- [x] 最终 root format 与 `git diff --check`已真实通过，见 `final-format-checks-r1/summary.json`；
      与 16 项功能检查及 E2E 构成原 15 项 + runtime3 全部通过，仍保留 1 flaky。
      此次状态文字由主控复制后还会最后 format 复核，最新文字与回执以总报告为准。
      `final-quality-checks-r1`首次仅 `docs/agent-review-loop.md`与
      `docs/verification/cross-platform/RF-08-WEEKLY-PROGRESS.md`格式失败，历史保留。
- [x] **P2：settings WebKit 首次导航超时已在补充轮关闭**：上一轮首个用例的
      beforeEach `page.goto('/')`首试30秒超时、retry通过，当时根因未定；现已有本机
      动画线程阻塞、进程偏好正负对照及两轮174无重试通过证据，见顶部补充轮。旧失败与 trace 全部保留，未弱化断言。
- [x] 补验 Worker 优雅 SIGTERM 停机：上一轮三个 Worker exit137、API exit0 的历史保留；
      补充轮新程序三个 Worker exit0及在途/超时取消均已验证，见顶部补充轮。

## 2026-11-03 无 Key 工作与当时验收边界（历史）

- [x] A 诊断局部验证：最近 50 条内存白名单记录、账号清理、用户主动预览/复制/清空，
      无上传或持久化；主控 Vitest 1034、Chromium/WebKit 合计 166 通过，
      `auth-buffer` / `copy-order` 两个真实变异均 killed 且已还原。详见
      [诊断导出验证](../../docs/verification/cross-platform/CP-06-DIAGNOSTIC-EXPORT.md)。
- [x] C 后端无 Key 验收：真实 Linux arm64 API/Agent 角色镜像、frozen export、ASGI
      health/无 Key 拒绝、全新 PostgreSQL 空库迁移、合成 `c03 → c06` 的 UTC 微秒/
      索引/event/seed、真实分析 Worker 无 Key 安全失败均通过。镜像约 API 1.545 GB、
      Agent 1.936 GB；没有旧版同环境 before，不计算优化百分比或冷启动收益，不代表
      原 Compose 整栈已验。详见 [Linux 运行时记录](../../docs/verification/cross-platform/RF-07-LINUX-RUNTIME.md)。
- [x] Web Docker production guard 真实复验：P1 绕过入口已最小修复；主控三构建结果为
      OIDC exit0、dev/oidc-token exit1，两个负向均命中 production guard，原坏 dev exit0
      记录保留。这不代替缺 OIDC 运行态或原 Compose 整栈验收。
- [x] B r1 本地四项检查：修复 Node runner 被 Vitest 误收集，文件已改名
      `ios-ci-test.mjs`；主控格式、actionlint、Node 28 项、macOS 聚合检查通过，B 已停写。
- [x] B 子集无签名 arm64 Simulator 真实编译及静态产物校验通过，见
      [CI 41581791010 / job 125738079003](https://github.com/sunpcm/EchoTalk/actions/runs/41581791010/job/125738079003)；
      frontend/backend/macOS/iOS/CI 五 jobs 已全绿；built-not-run，不代表最终 A head，旧 r0/r1 失败保留。
- [x] 主控最终组合完整 frontend10/backend5 已通过，补充 format/Node 28/双浏览器几何验证通过。

## 2026-11-02 练习前置检查与探针 CI（最终组合检查通过）

- [x] 完整 frontend10/backend5：Vitest 1003、Chromium/WebKit 全 E2E 160、pytest 644
      全部通过；后端覆盖率 78.61%、3 warnings，59% 门禁保持。
- [x] 组合探针 actionlint、assets、Node 240 通过；54 份源/SDK/静态输入与 B 线实际编译
      输入完全一致。B 线真实 Rust 57、无签名 arm64 `.app` 及 Mach-O/plist 通过的证据
      继续有效，本次未在 A 重编译，原生 App 未运行。
- [x] 独立 HTTP 9 场景及浏览器初始化 2 个控制场景通过；HTTP 检查零解密、零外网。
      此前两项关键变异均被真实断言杀死，源码已还原。
- [x] 该轮远端 CI：2026-11-03 主控确认 PR #117 已合并，旧 PR 及对应 main 运行均已全绿。

## MVP 产品化修复（RF-01～RF-12）

### Phase 1：分析可靠性

- [x] **RF-01 持久化分析状态机**：PostgreSQL Job 支持原子领取、幂等、超时恢复、
      有限重试和人工重试；状态 API 与前端明确展示四种状态；任意状态均可返回主页；
      重复消费、Worker 崩溃和最终失败均有测试。

### Phase 2：模拟结果隔离

- [x] **RF-02 评估来源可信**：评估带来源、Provider、模型版本、Synthetic 与置信度；
      Synthetic 不更新真实知识状态；生产缺 Provider 时返回 `unsupported`；API、迁移、
      前端和测试同步。

### Phase 3：鉴权与密钥生命周期

- [x] **RF-03 真实鉴权和版本化密钥**：采用单一明确的 AuthProvider 方案；移除生产
      Mock 用户和固定 Token；资源归属、过期/伪造 Token、认证密钥与凭据加密密钥分离、
      旧密文读取/重加密、Provider 错误分类和日志脱敏均有测试。
      2026-11-01 A81 b/r0 对该已完成项补漏：停止在 LLM 成功日志记录回复正文、停止把
      SDK `APIError` 原文写入日志或 502，停止在 disabled dispatch 日志格式化异常对象；
      为真实 service/router 增加合成 canary 回归。A81 已独立 Review APPROVED，以正常
      hook 单提交 `bbde1ff20ea961375401c714d36a65ffc268b1d7` 精确 fast-forward 本地 main，
      完成完整 15 项门禁；四类实际输出变异均由新增回归杀死并精确还原。

### Phase 6：内部边界

- [x] **RF-11 前端 API 与状态模型**：OpenAPI 生成类型/客户端；Transport 统一认证、
      超时、取消、Header 合并和错误解析；会话使用判别联合/Reducer；大组件按行为拆分。
      以下 A49–A64 条目保留各轮当时的“仍待完成/未勾选”边界；最终完成状态以上方勾选、
      A65–A69 验收结果及本节末“本地代码验收完成”边界为准。
      本地已完成异常 HTTP 错误体健壮解析（A49）：修复 request 对 detail:[null]、非数组/非法 loc 及非 string msg/errors 引发 TypeError 与 HTTP status 丢失缺陷；实现局部健壮类型守卫（isRecord/getFirstTruthyString），严格保护 ApiError.status 与原始 data 结构；未通过数组类型收窄的非法或缺省 loc 安全回退 Unknown，杜绝调用任何对象方法，正常 string/number 数组安全 join；保持 detail 字符串、空字符串与 detail.message 原 truthy 语义，完整保持既有有效分支优先级；401 在解析前严格按原 reqRevision 失效，迟到 401 保护生效，请求仅发送一次无重放；诊断日志零正文/密钥泄露；覆盖 422/401/500/502 异常形状、空值边界与非 JSON 表驱动回归通过（见 [RF-11 异常 HTTP 错误体健壮解析验证](../../docs/verification/cross-platform/RF-11-ERROR-BODY-GUARDS.md)）；
      本地已完成设置保存载荷行为抽取（A61）：将 `SettingsDrawer.handleSave` 中构建 `UserSettingsUpdate` 请求体的纯计算抽取为独立纯函数 `buildSettingsUpdate`（`settingsPayload.ts`）；模块仅 import type，零 React/DOM/store 依赖，零网络/日志/持久化与明文密钥保存；严格保证 `is_custom_mode: false` 时仅输出该字段且不包含任何 provider/model/key 字段；`is_custom_mode: true` 时按原顺序携带 `stt_provider`/`llm_provider`/`tts_provider`，`llmModel.trim()` 非空才携带 `llm_model`，三路 key 仅 trim 后非空才携带，不引入清空语义且不带额外字段；`SettingsDrawer` 真实消费新模块并验证完整更新 payload；直接单测覆盖开/关、单/多 key、空白截断、冻结入参不变性与独立实例隔离，修复 `test_user_settings_service` 遗留的 overrides 清理及 RF-10 文档笔误（见 [RF-11 设置保存载荷行为抽取验证](../../docs/verification/cross-platform/RF-11-SETTINGS-PAYLOAD.md)）；
      本地已完成 API 错误消息解析纯计算边界抽离（A62）：将 `apps/vite-app/src/lib/api.ts` 中错误响应体解析为错误消息的纯计算抽离为独立纯函数 `getApiErrorMessage`（`apiErrorMessage.ts`）；模块零网络/DOM/store/全局可变状态依赖，零反向依赖；原 `ApiError` 导出与构造签名 100% 保持；原 `request` 移除旧错误解析私有副本并真实消费新函数；逐项严格保持 FastAPI detail 字符串（含合法空字符串）、422 验证异常首项判定与 loc 安全拼接（缺失/非法安全回退 Unknown）、detail.errors 首项非空采纳（首项空不扫描后项）、detail.message 非空采纳、合法空嵌套 message/空对象回退 JSON.stringify 兜底及序列化异常安全回退默认文案；外层 errors/message 保持原优先级与语义；401 在读取 JSON 前按原 revision 失效、非 JSON 解析回退 `{}` 及写请求单次调用防重放等时序完全不改；直接单测全面覆盖有效/异常结构、合法空值与冻结入参不变性，通过 spy 与可证伪替身证实公共 API 消费者出错时真正委托新模块且保持 status/data（见 [RF-11 API 错误消息解析边界抽离验证](../../docs/verification/cross-platform/RF-11-API-ERROR-MESSAGE.md)）；关闭 A61 文字 P2 两项笔误；前端 API 类型生成与会话状态模型重构仍待完成，整项保持未勾选。
      本地已完成 API 请求 Header 合并边界抽离（A63）：将 `apps/vite-app/src/lib/api.ts` 的 `request` 内默认 `Content-Type`、认证 `Authorization` 与调用方 Header 合并逻辑原样抽为同步纯函数 `buildApiRequestHeaders`（`apiRequestHeaders.ts`）；模块无网络/异步/DOM/store/日志/全局可变状态与反向依赖，直接单测覆盖空入参、对象、数组、`Headers`、既有 `Content-Type`、显式 `Authorization`、无 token、自定义 Header 保留、冻结输入不变性、多值语义与实例隔离；原 `request` 真实消费新模块，认证 revision/token 校验、baseUrl/path、请求选项、错误处理、401 时序及单请求行为保持不变，并通过公共消费者 spy 回归证明 Header 构造委托、最终 Headers 与一次 fetch；前端 API 类型生成、会话状态模型、超时与取消仍待完成，整项保持未勾选（见 [RF-11 API 请求 Header 合并边界抽离验证](../../docs/verification/cross-platform/RF-11-REQUEST-HEADERS.md)）。
      本地已完成 Transport 请求超时与取消边界（A64）：新增纯计算模块 `apps/vite-app/src/lib/apiRequestTimeout.ts`，以既有前端 10s 门禁为普通请求默认预算，对会触发后端最多 10s 并行 Provider 校验的 `updateUserSettings` 显式采用 15s；运行时非法预算安全回退 10s；组合调用方 `AbortSignal` 与内部超时，已取消 signal 在 fetch 前零网络短路，超时与调用方取消使用独立的 `ApiRequestTimeoutError` / `ApiRequestAbortedError`、稳定错误分类与无正文诊断事件；外部取消优先，不自动重试或重放写请求；认证 revision/token/revision 二次校验、Header 构造、HTTP 错误/ApiError、401 失效、非 JSON 回退与单请求时序保持不变；直接单测与公共 API 消费回归覆盖预算、组合 signal、两类失败、非法值、隔离性及一次 fetch；前端 API 类型生成、会话状态模型与其他 Transport 收敛仍待完成，整项保持未勾选（见 [RF-11 Transport 请求超时与取消边界验证](../../docs/verification/cross-platform/RF-11-REQUEST-TIMEOUT.md)）。
      本地已完成会话状态判别联合与 Reducer 边界（A65，独立 Review APPROVED）：新增纯 `conversationState.ts`，以 `checking_health`、`creating_session`、`fetching_token`、`credentials_ready`、`active`、`ending`、结束与失败 phase 收敛会话真值，旧 `connecting + null token` 启动过渡态保留为明确内部阶段并兼容投影为原扁平字段；生产 store 的真实创建/取令牌/激活/结束/失败/重置迁移统一消费纯构造、守卫、Reducer 与原子投影，公开 `setState` 测试夹具经同一归一化层处理，完整凭据才可进入连接就绪或 active；`VoiceInterface` 改为类型收窄渲染并保持 Room key/props、文案和 DOM，`ActiveSessions` 启动判定复用同一模型；既有 sessionGen、认证 revision/principal、生命周期所有权与迟到结果隔离保留。A65 定格于本地单提交 `356f69e9ceecf8868b6f11db7b53d566032bb2f6`；三项有效变异是 lane 私有验证，均在提交前被真实断言杀死并完整还原源码，main 未重跑。该提交精确 fast-forward 后，main 按 A65 当时范围完成原 8 项前端门禁与 529 backend pytest，其中 Vitest 876、双浏览器 E2E 148；当时尚无 A67 才新增的 OpenAPI schema 门禁，也不把其他轮次或 lane 的 Ruff 结果追加为本次 main 事实（见 [RF-11 会话状态模型验证](../../docs/verification/cross-platform/RF-11-STATE-MODEL.md)）。
      本地已完成公共网络函数取消入口（A66，独立 Review APPROVED）：新增只含末位可选 `readonly signal?: AbortSignal | null` 的 `ApiRequestOptions`，为实际 22 个网络函数补齐 options，同时保留 owner、docContext、takeover、params 等原参数位置与默认值；仅把 signal 写入单请求 `RequestInit`，不扩展 headers/timeout/RequestInit，也不把 options 混入 body 或 owner 判定；继续复用 A64 组合 signal、普通请求 10s 与设置更新 15s 预算，预取消零 fetch、在途取消至多一次且不重放，认证 revision、HTTP/401、错误解析与并发请求隔离保持。A66 定格于本地单提交 `fedc5f39d659bf591a7c8b42b087d46a13eb4349`；22 个公开 API/24 个 request 分支由 907 Vitest 与 148 双浏览器 E2E 覆盖，两项有效变异仅由 lane 私有验证执行并已完整还原，main 未重跑。该提交精确 fast-forward 后，main 按 A66 当时范围完成原 8 项前端门禁与 529 backend pytest；当时尚无 A67 才新增的 OpenAPI schema 门禁，也不把其他轮次或 lane 的 Ruff 结果追加为本次 main 事实。UI 生命周期主动 abort 全部 store 不在本交付中（见 [RF-11 公共 API 取消入口验证](../../docs/verification/cross-platform/RF-11-PUBLIC-CANCELLATION.md)）。
      本地已实现并验证离线 OpenAPI 导出与 TypeScript 类型生成（A67，独立 Review APPROVED）：新增真实 `main.app.openapi()` 隔离子进程导出；导入 config 前以 Pydantic 文档化 `_env_file=None`/`_secrets_dir=None` 构造控制禁用 dotenv/file-secret 读取，再按真实 settings source hook 签名仅保留 init/env；TMP/TEMP 与 XDG 受控但不重设 `HOME`，DNS/socket 失败关闭；真实子进程 120 秒超时，异常仅输出阶段/类型，确定性 JSON 原子写入。真实 schema 当前含 22 条路径、27 个模型且 `--check` 通过；`openapi-typescript@7.13.0` 已从该 schema 真实生成 `api.generated.ts`，Node 生成器 8 项、离线导出 pytest 11 项及完整前端 quality10 均通过；Vitest 为 907/32 files、Node 构建测试 18 项、Fake API 61 项、Chromium+WebKit E2E 148 项。后端专用测试库全量 pytest 为 540 passed/3 warnings、覆盖率 79.41%；新增导出工具主要在隔离子进程中执行，不计入父 pytest coverage，既有 59% 门禁不变。lock 已按精确 override 受控重生成并通过冻结安装：既有 packages 的 version/integrity 与既有 resolved snapshots/importer 不变，新增 17 个 packages、18 个 snapshots 及 vite-app 的精确 devDependency；唯一既有 package 元数据变化是已批准的 Webpack 插件 peer range 原生记录为 `0.21.3`。六类生产 DTO 已消费 generated component；两项 schema/types stale 变异是 lane 私有验证，均在合并前被真实断言杀死并完整还原源码，main 只重跑 frontend10、OpenAPI schema、Ruff 与 backend 标准门禁；正常 hook 通过且批准文件 hash 一致，六 DTO 精确键、双向兼容及 `api.ts` 去类型 JS 字节等同基线通过。A67 定格于本地单提交 `1321bbe43ac540cacb75ea3845ac381076a7c637`，main 精确 fast-forward；未 push/部署，远端 CI、真实 IdP/Provider/LiveKit/设备未验（见 [RF-11 OpenAPI 类型生成验证](../../docs/verification/cross-platform/RF-11-OPENAPI-TYPES.md)）。
      本地已完成 VoiceInterface 行为拆分（A68-B，独立 Review APPROVED）：主入口只保留 phase 选择与 Room key/props；`RoomSession` 承接 principal/revision 绑定、原生 pending/ready/timeout、Web 初始/订阅后快照、`RoomContextSync` 稳定 cleanup、LiveKit callbacks 与 dispatch 迟到/重入核验；`ActiveConversation` 承接活动 UI、LiveKit hooks、agent_error 和显式结束停轨；`EndedConversation` 承接本地取消、分析轮询/失败/重试及 assessment reset；状态视图保留原文案、classes、DOM、testid 与 store action，`stopRoomLocalTracks` 移入纯 `roomAudio` 并从原入口兼容导出。12 个交付文件独立 APPROVED，本地单提交 `0902aee45fc2de6d1050fd4610b8c9c9835108de`；lane 私有验证完成 13 个迁移函数体与 Room 资源 effect 等价核验、两项 cleanup/reentry 变异并精确还原；恢复后 908 项 Vitest 复验通过。main 标准全量复验执行 frontend10、OpenAPI schema、Ruff 与 backend，正常 hook 通过且批准文件 hash 一致；私有等价核验与变异未在 main 重跑（见 [RF-11 VoiceInterface 行为拆分验证](../../docs/verification/cross-platform/RF-11-VOICE-COMPONENTS.md)）。
      本地已完成 SettingsDrawer 行为拆分（A69-B，独立 Review APPROVED）：公共入口只保留公共 props、打开 fetch、loading/saving/store error、外壳和模块组装；新增 `useSettingsDialog` 独占原生 dialog/焦点/滚动/键盘/backdrop 清理，`useSettingsForm` 在 `open=false` 仍挂载并独占草稿、后端对象引用水合、内存 key、显式保存及本地提示，`SettingsAppearance` 与 `SettingsProviderFields` 承接稳定视图。既有 `buildSettingsUpdate`、Provider 选项/顺序/默认、免费账号 custom 约束、主题 local-first、原文案/DOM/classes/label/id 与网络语义保持；本地 toast timer 绑定打开周期和操作序号，重复错误各享完整 3 秒、成功 2 秒，close/reopen/卸载后的旧成功/失败及 stale 结果静默，新周期保存可恢复，且不自动取消/重发 PUT。r1 修复 `installStore` 实际 action 所有权、Provider 三种真实 fixture，并恢复 logout 失败提示持久语义。A69 定格于本地单提交 `0936ea335dff8fdce8d307da10461ed2b8dec6a5`；lane 私有验证执行 4 项真实组件/store 消费探针及两项有效通知变异，源码已还原。main 标准全量复验执行 frontend10（Vitest 917/32 files、build-script 18、Fake API 61、typegen 8、双浏览器 E2E 148）、OpenAPI schema、Ruff 与 backend（540 passed/3 warnings/79.41%），正常 hook 通过且批准文件 hash 一致；main 未重跑私有探针/变异（见 [RF-11 SettingsDrawer 行为拆分验证](../../docs/verification/cross-platform/RF-11-SETTINGS-COMPONENTS.md)）。
      RF-11 计划中的 schema 生成链路、统一 Transport（认证/超时/取消/Header/错误/origin）、state 模型及 VoiceInterface/SettingsDrawer 行为边界均已完成本地代码验收，故整项勾选为“本地代码验收完成”。该勾选不表示 UI 主动 abort 已接入全部 store，也不表示生成类型已替代其余手写 domain 适配，或真实 IdP/Provider/LiveKit/设备/远端新 CI 已验收；这些边界继续独立保留。

## P0 — 安全边界

- [x] 独立 Vite 7.x 安全补丁（[#92](https://github.com/sunpcm/EchoTalk/pull/92)）：
      声明和所有锁定实例统一为 7.3.7，冻结安装和 CI 通过；不代表 RF-12 整体完成。
- [x] 后端用真实 JWT 校验替换 `get_current_user` Mock；验收：无效或过期 Token 返回 401。
- [x] 前端从 Auth 模块获取 Bearer Token，移除固定的 `mock-token`；验收：登录态变化能正确影响 API 请求。

## P1 — 功能完整性

- [x] 统计最近七个本地自然日的 completed 会话次数：按既有 `started_at` 半开区间分桶，
      含零值桶、认证用户隔离和时区/DST；支持按日显式分页只读历史，不产生新评分。
- [x] 统计截至 `end_date` 的滚动七个本地自然日语法错误记录 Top 3 并展示固定改善提示
      （非个性化生成）：按错误记录条数计数，固定六类且未知项合并为 `other`，以 count
      降序、规范 tag 升序稳定排序后最多返回三项；当前生产分析链仍为 demo，真实记录为空
      时返回合法空态，不声称零错误或分析完成。

## P2 — 质量与维护

- [x] 每日进度与技能掌握度进度条提供可访问名称、范围和值（[#90](https://github.com/sunpcm/EchoTalk/pull/90)）；
      回归覆盖每日 0/5/20/25 完成量，超目标时数值封顶、文本保留实际总量。
- [x] 清点主题 token：保留 Webpack 正在使用的 `brand-*`，处理未使用的 `scrollbar-thumb`、`header-bg`（A32 本地独立评审通过）；
      删除无运行时引用的 2 个主题 token 并修复 ActiveSessions 确认面板背景透明与边框继承缺陷，双浏览器逐主题 computed 变量解析验证通过，见 [主题 token 审计与确认面板验证](../../docs/verification/cross-platform/CP-05-THEME-TOKENS.md)。
- [x] 将 Vite 入口的 `<html lang="en">` 改为 `zh-CN`。
- [x] 将主题保存到后端 `user_settings.theme`，支持跨设备水合（A28 本地独立评审通过）；
      客户端 local-first、认证与代际绑定、单在途意图串行合并与水合竞争防护经本地回归通过；
      不代表真实双物理设备验收，见 [主题同步验证](../../docs/verification/cross-platform/CP-05-THEME-SYNC.md)。
      A31 补充浏览器 localStorage 异常容错（SecurityError/QuotaExceededError 读写安全回退、
      不阻断 UI/store 与后台 PUT 同步、成功水合不误判 API 失败、恢复后正常持久化），
      见 [主题缓存容错验证](../../docs/verification/cross-platform/CP-05-THEME-STORAGE.md)。
- [x] 统一主题按钮边框宽度，消除选中时 1px 布局抖动（A28 本地独立评审通过）；
      主题单选按钮统一使用 2px 固定边框，窄屏、默认与 200% 字号下选择前后内容位移为 0，见 [验证](../../docs/verification/cross-platform/CP-05-THEME-SYNC.md)。
- [x] 为颜色过渡和抽屉动画支持 `prefers-reduced-motion`（A27 本地独立评审通过）；
      CSS 媒体查询支持 reduce 与 no-preference 真实浏览器 computed、抽屉动画消除与
      loading spinner 保留，零 JS 注入与零隐式业务写。见 [验证](../../docs/verification/cross-platform/CP-05-REDUCED-MOTION.md)。
- [x] 按主要容器补齐主题颜色过渡，避免子元素瞬间切色（A35 本地独立评审通过）；
      为 #root 注入 theme-transitions 作用域，补齐主要容器、卡片、设置抽屉及显式文本 250ms ease 颜色过渡，
      保持 box-shadow 150ms 与 hover 能力，兼容 reduce 偏好与 WAAPI 插值中间态验证，见 [主要容器主题过渡验证](../../docs/verification/cross-platform/CP-05-THEME-TRANSITIONS.md)。
- [x] 移除生产 LiveKit SDK 消息访问路径的 SDK 类型忽略（2026-11-09 核销，证据同上方候选项），改用类型收窄或兼容适配层；
      验收只限定真实生产消息读取及消费路径，并取得当前 SDK 类型与调用证据。无关测试文件中的
      类型忽略不构成本项产品缺陷，也不能据此勾选本项。

## 三端交付计划（Web / macOS / iOS）

### CP-00：基线与验收准备

- [x] 记录当前前后端检查结果、iOS 运行方式和设备/OS；验收：区分既有失败、本轮回归、模拟器与真机证据。
- [x] 建立三端验收矩阵和证据目录；验收：覆盖登录、语音、结束、分析、报告、设置、DocTalk 与异常恢复，记录结果及复现步骤，不记录凭据或用户原始音频。
- [x] 核实测试数据库隔离；验收：后端集成测试仅连接明确的独立测试库，设备测试使用专用测试账号。

### CP-01：平台边界与配置（首个代码阶段）

- [x] Web生命周期事件薄适配器：无副作用工厂、订阅清理/恢复快照、SSR降级与原生能力不可用经独立验收；未接业务与原生事件，见[验证](../../docs/verification/cross-platform/CP-01-WEB-LIFECYCLE.md)。
- [x] 集中 API/LiveKit 地址选择，修正 `/api/api`，生产原生配置限制 HTTPS/WSS；验收：Origin 与含 `/api` 地址、尾斜杠、非法配置、Web 同源、原生直连/代理均有回归覆盖。
- [x] 增加可复现的 iOS build + sync 命令，隔离平台/环境产物并校验 Turbo 缓存输入；验收：Web/iOS 连续切换构建不会复用错误配置，Release 不含开发 Token 或开发 API 地址。
- [x] Dashboard生命周期只读发现接线：恢复前台/网络时刷新，后台离线门禁、旧请求与账号隔离通过本地独立验收；不代表恢复通话，见[验证](../../docs/verification/cross-platform/CP-01-LIFECYCLE-DISCOVERY.md)。

### CP-02：会话可靠性与恢复契约

- [x] 结束接口幂等，客户端结束时立即停止采音；验收：响应丢失后重试、重复点击和并发结束均返回一致最终状态，不重复创建分析任务。
- [x] 创建会话支持请求幂等标识；验收：同一用户同一请求重试返回原会话，不同请求正常创建，复用标识但请求体不同被拒绝。
- [x] 共享 Dashboard 只读活动会话发现增量；验收：加载/空/列表/失败重试、精确账号与代际隔离及未知模式回退通过本地独立评审。仅发现记录，不代表房间在线或可恢复，见 [发现验证](../../docs/verification/cross-platform/CP-02-DISCOVERY.md)。
- [x] 客户端通话能力发现与开始门禁；验收：严格协议/no-store、失败及Cloud不可用时不创建会话，认证失效释放旧启动且可显式重试，本地回归通过；尚未支持Cloud占用客户端/恢复/接管。
- [x] 客户端占用API原语：claim/heartbeat/release及token/dispatch可选owner头；精确schema/关联校验、默认不接管和不重放经本地独立验收。仅API层，Cloud开始门禁保留，见[验证](../../docs/verification/cross-platform/CP-02-LEASE-API.md)。
- [x] 独立客户端占用控制器：显式claim、心跳/到期watchdog、同tuple释放重试、代际/身份隔离与清理通过本地独立验收；未接UI/媒体/Cloud门禁，见[验证](../../docs/verification/cross-platform/CP-02-LEASE-CONTROLLER.md)。
- [x] Dashboard显式结束已发现的活动记录：确认/取消、失败同ID重试、认证意图代际与在途保护通过本地独立验收；不表示其他端媒体停止，见[验证](../../docs/verification/cross-platform/CP-02-DISCOVERY-END.md)。
- [x] ActiveSessions文件头已随显式恢复开发同步更新为发现/结束/恢复，关闭P2过期注释。
- [x] disabled模式已有会话显式恢复：确认后重新核验身份/能力/详情/Token且零create，store及UI取消/代际隔离经本地独立验收，见[验证](../../docs/verification/cross-platform/CP-02-EXPLICIT-RECOVERY.md)。
- [x] Agent调度HTTP失败本地闭环：当前失败停止本地音轨、清Token/卸载房间并展示安全提示；单次调度、来源/代际隔离及失败后显式操作经独立验收，见[验证](../../docs/verification/cross-platform/CP-02-AGENT-DISPATCH.md)。真实媒体、连接离线及Token过期恢复仍待下项。
- [x] 连接失败与Web中断本地闭环：SDK错误/断开、后台离线同步停止音轨，旧回调与监听隔离、无自动重连和显式新操作经独立验收，见[验证](../../docs/verification/cross-platform/CP-02-CONNECTION-FAILURE.md)。

### CP-04：三端真实登录与凭据生命周期

- [x] 共享客户端本地认证生命周期：账号清理、迟到响应/401隔离、StrictMode在途callback单次交换和来源归属通过独立评审及隔离集成；详见 [CP-04 本地验证规范](../../docs/verification/cross-platform/CP-04.md)。仅此本地增量完成，以下真实三端验收项仍待完成。

### CP-05：生命周期与响应式体验

- [x] 回答推荐全文换行、44px触控及复制反馈归属：620产品/18构建脚本/104默认双浏览器、8独立时序/12独立浏览器及两有效变异通过；见[验证](../../docs/verification/cross-platform/CP-05-ANSWER-RECOMMENDATIONS.md)。真实系统剪贴板权限仍待验。
- [x] DocTalk设置页标题/返回重排、44px触控及窄屏大字号：606产品/18构建脚本/82默认双浏览器、22独立浏览器和两有效变异通过，见[验证](../../docs/verification/cross-platform/CP-05-DOC-LAYOUT.md)。OS键盘与硬件safe-area仍待验。
- [x] DocTalk本地文件导入保稿、UTF-8/长度校验与迟到读取隔离：606产品/18构建脚本/62默认双浏览器、11独立时序+18浏览器探针及两有效变异通过，见[验证](../../docs/verification/cross-platform/CP-05-DOC-IMPORT.md)。真机文件选择器验收项继续保留。
- [x] 活动列表响应式、完整确认ID与44px触控：578产品/18构建脚本/56默认双浏览器、22独立布局探针和两有效变异通过；见[验证](../../docs/verification/cross-platform/CP-05-ACTIVITY-LAYOUT.md)。
- [x] 恢复失败与真正取消按会话代际区分，专用错误/完整目标/显式重试恢复；588产品/18构建脚本/60默认双浏览器、12独立失败路径+2时序探针及两有效变异通过，见[验证](../../docs/verification/cross-platform/CP-05-RESUME-ERROR.md)。
- [x] 设置抽屉命名模态、完整键盘到达/焦点恢复、44px触控与窄屏横屏大字号：578产品/26浏览器探针+3资源单测/38默认E2E通过；见[验证](../../docs/verification/cross-platform/CP-05-SETTINGS-DRAWER.md)。真实OS键盘和非零safe-area仍待验，全局布局项继续保留。
- [x] 活动列表区分尚未查询与确认空，精确身份查询事实及迟到隔离：574产品/14独立探针/22双浏览器通过；同步修正分析hook旧Web注释，见[验证](../../docs/verification/cross-platform/CP-05-DISCOVERY-QUERY-STATE.md)。
- [x] Room原生就绪挂载门禁、10秒安全退出、后台同步停轨与健康渲染保护：565产品/20独立探针/双浏览器22项及iOS build+sync通过；见[验证](../../docs/verification/cross-platform/CP-05-NATIVE-ROOM.md)，真实系统音频中断/路由仍待验。
- [x] 开始/显式恢复原生就绪门禁、10秒安全退出与旧意图隔离：547产品/30独立探针/双浏览器22项；见[验证](../../docs/verification/cross-platform/CP-05-NATIVE-STARTUP.md)。Room后续已由A19本地接线，真实OS仍待验。
- [x] 活动列表与分析页消费iOS原生生命周期：525产品、35独立探针、双浏览器22项通过；见[验证](../../docs/verification/cross-platform/CP-05-NATIVE-CONSUMERS.md)，通话启动/Room仍待接线。
- [x] iOS原生生命周期薄适配器与统一工厂：509产品/22独立探针/双浏览器22项、本地iOS build+sync通过，见[验证](../../docs/verification/cross-platform/CP-05-NATIVE-ADAPTER.md)；业务消费者仍待接线。
- [x] 分析页Web后台/离线暂停与恢复安全轮询：472产品、27独立探针、双浏览器22项通过；见[本地验证](../../docs/verification/cross-platform/CP-05-ANALYSIS.md)，原生OS仍待验。

### CP-06：自动化与真实链路回归

- [x] 本地双浏览器门禁：保留完整质量检查，Chromium/WebKit各11项，覆盖分析/恢复/401边界、0skip；CI安装接线已更新，见[验证](../../docs/verification/cross-platform/CP-06-WEBKIT.md)。

### 后续候选（不阻断本轮）

- [x] 在回归保护下减少 start/resume 重复生命周期逻辑及全局测试注入入口（A18P2 本地独立完成，见
      [CP-05 原生启动与显式恢复](../../docs/verification/cross-platform/CP-05-NATIVE-STARTUP.md)）：
      移除模块级 `currentStartupTracker`、`testingLifecycleOptions` 与全局测试注入
      `_setLifecycleOptionsForTesting`，`createConversationSlice` 工厂只拥有自己的
      tracker/adapter/监听/计时器，start/resume 复用实例内公共 `runStartupLifecycle`；新增
      `conversationLifecycleIsolation.test.ts` 覆盖 start/start、start/resume、resume/start、
      resume/resume 与 cancel/late 跨实例隔离，两旧测试文件迁移到局部 platform mock。公共动作签名/
      返回值/状态机、原生 10 秒 deadline、同步重入/取消与请求顺序不变。R1 恢复 Web 同步 setup +
      仅 native 等待 ready 并修新 fixture 类型。13 项门禁全 `exit 0`，Vitest `1216 passed / 50 files /
0 skip`，三项有效私有行为变异均被对应断言杀死；详细门禁与变异计数见
      [PROJECT_STATUS.md](../PROJECT_STATUS.md) A18P2 小节。
- [x] 将回答推荐scope键的id/text直接拼接替换为无歧义元组编码，并覆盖分隔符外部ID（A33 本地独立完成，见 [回答推荐作用域编码验证](../../docs/verification/cross-platform/CP-05-ANSWER-SCOPE.md)）；消除冒号等外部ID边界碰撞。
- [x] 强化 `SettingsDrawer`/`useSettingsForm` 的 LLM 模型水合回归：真实组件与 Hook 必须先
      断言初始缺省值，再覆盖 `llm_model: null` 到既有默认值、`null` 后切到合法自定义模型文本
      的实际水合与消费断言；另需证明合法默认值切换会被真实读取路径消费。不得只断言配置文档
      字符串或静态映射。A80 b/r0 已补齐真实组件与 Hook 消费回归，并在隔离测试文件用合法
      替代 LLM 默认证明初始草稿和空值水合确实读取 metadata 来源；生产行为未改，当前停在
      Review，主 Agent 受控检查与 main 复验结果尚不在本项冒认。
- [x] 修正分析hook头部旧Web措辞；列表原生状态未就绪区分尚未查询与已确认空，A20已关闭A17 P2。
- [x] Fake API严格解析带项目后缀的analysis-success/failure与grammar路径并补真实Node子进程回归（test:fake-api），同时修复Fake API缺失必需theme字段的schema问题（A29本地独立评审通过）。

## RESTORE-20261107 文档收口

本段替换 delivery r0 候选追加，不改写上方从
`42c61bb08f5e234989198ef46ed7534a80c70796` 恢复的原文。上方历史 CI 与已验记录只属于
当时提交。本候选没有 push，也没有本轮远端 CI。这里的 Node 回归不能代替 native
App、Xcode、Rust 构建或设备验收。真实 Provider、IdP、LiveKit、语音、生产部署和原
Compose 整栈未验。根格式与保全回执见主控交付报告，这里不预告根格式通过。

本段不关闭上面尚未勾选的 Android、Windows、后台持续语音及其他需求，也不写入主
checkout 未提交的 TODO 候选或 `docs/triage/`。

本轮只收口被误回退后已恢复的交付记录。主控在 `echotalk_restore_test` 上迁移到
`c06_transcript_events` 后，backend pytest 为 794 passed、3 warnings、覆盖率
78.84%，59% 门禁保持。资源身份和验收见 `docs/agent-review-loop.md` §19。
