# CP-06 Native Room 回归夹具就绪边界

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
