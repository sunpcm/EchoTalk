# CP-06 Native Room 回归夹具就绪边界

> A82C 当前状态（2026-11-15）：`FINAL_READY`。本卡只核销 A82 的本地夹具就绪子项；
> 旧 A82 的 `APPROVED`、单提交、main 精确 fast-forward 与完整门禁仍是历史事实。主控当前的
> 13 项门禁分组均 `exit 0`，两条目标在 20 个独立进程中合计 40 次选中通过。完整数字、源码审计、
> 未证明的失败因果与外部边界见 §6，旧 §1～§5 保留原历史时点。
> 状态：A82 已由正常 hook 单提交、main 精确 fast-forward 与完整 15 项门禁核销；
> 本文由 A83 b/r0 校正失败归因边界，并保留 A82 实施交付时历史。
> 日期：2026-11-01。
> 基线：`codex/native-room-fixture-readiness@bbde1ff20ea961375401c714d36a65ffc268b1d7`。

## 1. 问题与权威边界

A80 的一次完整 Vitest 运行在“synchronously stops all owned local tracks BEFORE native
event callback returns when connected”用例中读取到尚未登记的
`capturedRoomCallbacks` 项，随后访问 `callbacks.trackStopMock` 时触发 `TypeError`。本次
已观察到的直接事实仅是 callback map 未就绪，已新增显式等待；触发该次失败的完整因果仍未
独立证明。同次运行中的真实目标 Hook 变异另有独立失败，因此该夹具异常不能计作目标效果或
产品缺陷证据。

`MockLiveKitRoom` 用被动 `useEffect` 写入 callback map，而 DOM 可在该被动 effect 执行前
出现。“LiveKitRoom 已挂载”和“当前实例 callback 已登记”是两个事实；本轮只修正测试对
后者的就绪判断。

## 2. 实施范围

- 先读取 DOM 的 `data-instance-id`，把实例归属保存为固定值，再等待该实例的
  `capturedRoomCallbacks` 项出现；不会改读后续实例或任意最新项。
- 仅修改现有两处真正跨越异步 native/DOM 就绪后立即读取 callback 的测试：目标同步停轨
  用例，以及 A77 native listener 轮换后读取旧 `onDisconnected` 的用例。
- 未把所有同步 `render` 读取机械改成等待，未修改被动 effect 为 layout effect，未新增
  callback 注入、retry wrapper、skip、timeout 放宽或 assertion 删除。
- 未修改产品源码、后端、SDK 政策、依赖、锁文件或真实服务配置。

## 3. 保留的对抗断言

目标用例仍在同一 native callback 返回前设置并读取 `stopCalledDuringCallback`，证明本地轨
停止是同步发生的；等待只发生在测试取得已登记 callback 之前，未延后或弱化该断言。原有
`callbacks.trackStopMock`、状态清理和 Room 卸载断言保留。

A77 用例继续保存刷新前 callback，验证业务 listener 轮换后旧函数保持惰性、健康保留，
StrictMode 资源与卸载断言未改。

## 4. 验证状态

- 实施方按授权只写文件，未执行 formatter、测试、build、安装、数据库、服务或 Git 写操作。
- 目标用例此前已在六个独立进程中通过。有限次通过不构成因果或概率证明；触发该次失败的
  完整因果仍未独立证明。
- A83 b/r0 的正式本地 receipt 随后核销 A82 Review APPROVED，并以正常 hook 单提交、
  `main@d8c9ff9d8f69ef0d55add4c955bb096b790f6e2c` 精确 fast-forward 和完整 15 项
  门禁通过。上一条保留为 A82 实施交付时状态，不追溯到交付前已执行的检查。
- A82 的本地单 commit、main 精确 fast-forward 与完整复验只在该轮独立 Review
  APPROVED 后执行；具体结果以上方 receipt 核销为准，本文件不预判 push、部署或外部验收。

## 5. 外部边界

真实 LiveKit/Provider、Linux/Docker 镜像、设备、远端 CI 与部署仍未验证。本夹具修复
不关闭 RF-07、RF-09、RF-12，也不改变产品停轨时序契约。

## 6. A82C 本地夹具就绪子项（FINAL_READY）

- 当前只核销 Native Room 本地夹具就绪子项。既有测试先保存当前 DOM 的
  `data-instance-id`，再等待同一实例的 callback map 项及所需字段登记；等待位于 native event
  之前，目标用例仍在同一 callback 返回前验证本地轨同步停止。
- A82C 不修改测试、产品、同步停轨断言、依赖、锁、迁移、服务或共享工具；当前唯一写集为四份
  文档。主控已独立复核旧 A82 `integration.json` 中 15 份 `main_checks` 原始日志的 SHA，全部匹配；
  旧提交 `d8c9ff9d8f69ef0d55add4c955bb096b790f6e2c` 与当时独立 `APPROVED`、集成状态均属于历史，
  不因本轮重新核验而失效。
- 主控已恢复隔离 worktree/依赖，并用本轮新建的 empty tmpfs PostgreSQL `15.19` 监听
  `127.0.0.1:55433`，18 份既有迁移均重放成功，`exit 0`。该 PG 当前仍由持续批次独占使用，
  整批结束才清理；本文不写已清理。
- 主控当前门禁回执中 13 项分组均 `exit 0`。两条 Native 目标在 20 个独立进程中以 `retry=0`
  执行，每次选中 2 项并全部通过，共 `40 passed`；每次另有 84 项未选，不计覆盖率，也不与 Vitest
  `1206` 相加。完整测试树、覆盖率、lint 与证据链接集中在
  [PROJECT_STATUS 的 A82C 小节](../../PROJECT_STATUS.md#a82c-native-room-夹具就绪证据与文档核销final_ready本地夹具就绪子项完成)。
- 独立源码审计确认当前两条目标与旧 A82 完整 callback 并非完全相同，差异仅为 `6` 处
  `useConversationStore → useAppStore` 的 typed store facade 标识；当前 `conversation.ts` 明确以
  同一物理容器提供 typed facade。除这些标识外，guards 与 callback 返回前同步停轨断言一致；
  不能写成“整段 AST 完全相同”。
- 本轮只移除或记录“callback 登记前读取”的测试就绪竞态边界。callback map 未就绪是已观察事实；
  旧失败的完整因果仍未独立证明，有限次通过不构成因果或概率保证。
- 真实 LiveKit/Provider、IdP、设备、远端新 CI、部署和生产链路仍未验证；本子项不勾选 RF 总项，
  不启动 A19/A18。当前停在 `FINAL_READY`，不推进产品或下一卡。
  独立Review/提交发布见主控同卡回执，用户Review待。
