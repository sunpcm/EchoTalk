# RF-11 VoiceInterface 行为拆分验证

> 状态：独立 Review APPROVED，集成到本地单提交
> `0902aee45fc2de6d1050fd4610b8c9c9835108de`；main 标准门禁复验通过。未 push/部署。
> 日期：2026-11-01。

## 目标与非目标

本轮落实 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“按行为拆分 VoiceInterface”，
保持既有已验收行为、DOM、文案、资源所有权与公共导出。本轮不修改产品功能、HTTP 契约、
会话状态机、请求预算、分析重试政策、LiveKit SDK 或依赖；SettingsDrawer 随后进入 A69。

## 依赖方向

代码依赖严格向下，禁止反向导入 `VoiceInterface`：

```text
VoiceInterface
├── ConversationStatusViews
├── EndedConversation
└── RoomSession
    ├── ActiveConversation
    │   ├── ConversationStatusViews
    │   └── roomAudio
    ├── ConversationStatusViews
    └── roomAudio
```

`roomAudio` 只包含结构性 Room 类型与同步停轨函数，不依赖 React、LiveKit、store、认证、
平台或网络。`VoiceInterface` 原路径继续导出 `stopRoomLocalTracks`，外部导入路径不变。

## 行为边界

| 模块                      | 保留职责                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VoiceInterface`          | 消费内部判别 phase，按原顺序选择 idle、连接中、ending、end_failed、ended、dispatch_failed、connection_failed 或 Room；Room key 仍为 `lk-session-${sessionGen}-${sessionId}`，同名 props 不变                                                          |
| `RoomSession`             | 绑定 room 进入时的 issuer+subject principal 与 revision；保留原生 pending/ready/10 秒 timeout；Web 初始与 subscribe-before-snapshot 检查；hidden/offline 同步停轨后失败；LiveKit callbacks；dispatch 单次去重、同步 reentry 后复验、迟到成功/失败隔离 |
| `ActiveConversation`      | 保留 LiveKit connection/voice assistant hooks、bar visualizer、控制栏、消息区、agent_error DataChannel 解析、显式结束同步停轨、健康重渲染不误停及 Connected 到 active 转换                                                                            |
| `ConversationStatusViews` | 保留 idle 安全回退、connecting、ending、end_failed、dispatch_failed、无有效 WSS 地址及 connection_failed 的原 DOM、classes、文案、testid、按钮和 store action                                                                                         |
| `EndedConversation`       | 保留无 sessionId 本地取消、Agent 错误卡片、分析轮询、成功/失败、可重试策略、返回主页及 `resetAssessment`；不自动重连或重发旧任务                                                                                                                      |

样式副作用仍在公共入口按拆分前顺序求值：`@livekit/components-react` →
`@livekit/components-styles` → `livekit-client`。`RoomSession` 仍使用原 `LiveKitRoom`
key、连接参数、回调和 children 顺序。

## 回归策略

`VoiceInterface.test.tsx` 仍以真实生产入口渲染，不改为只测新叶子或 mock 新边界。现有
ROOM、DSP、CON、DIA 矩阵继续穿过拆分后的模块，覆盖：

- 显式结束、卸载、生命周期中断与 dispatch 失败均同步停止所属 Room 本地音轨；
- `RoomContextSync` 的 render/layout 绑定与稳定 cleanup，正常 store 重渲染不停止健康轨；
- 原生 pending/ready/失败/取消、10 秒超时及显式新会话恢复；
- Web 初始/订阅后 hidden/offline 空窗、SDK error/disconnect、旧回调与监听隔离；
- dispatch 单次、迟到成功/失败、来源认证 revision/principal 变化及 store 同步重入；
- 分析失败后返回主页、重试与无 sessionId 本地取消。

本轮只在真实入口测试中增加一项兼容断言，确认 `VoiceInterface` 的
`stopRoomLocalTracks` 与新纯 `roomAudio` 边界指向同一函数；没有为纯搬运新增镜像测试或
弱化既有负向断言。

## 验证状态

- 12 个交付文件经独立 Review APPROVED 后集成到本地单提交 `0902aee`。
- lane 私有验证完成 13 个迁移函数体与 Room 资源 effect 等价核验；两项 cleanup/reentry
  变异均 killed 且精确还原源码，恢复后 Vitest 908 项复验通过。
- main 标准全量复验执行 frontend10（Vitest 908 项/32 files、build-script 18、Fake API
  61、typegen 8、双浏览器 E2E 148）、OpenAPI schema、Ruff 与专用 PostgreSQL backend
  pytest（540 passed/3 warnings、79.41%）；正常 hook 通过且批准文件 hash 一致。
- main 未重跑 lane 私有等价核验或变异。

真实 IdP、Provider、LiveKit、设备、远端新 CI、部署与发布未验证。

## 剩余 RF-11 范围

SettingsDrawer 行为拆分已由 A69 完成独立 Review、main 标准全量复验与精确 fast-forward。RF-11
计划所要求的两大组件行为边界至此完成本地代码验收，整项可按“本地代码验收完成”勾选。
该勾选不覆盖 UI 主动 abort 全部 store、生成类型之外仍保留的 domain 适配，也不覆盖真实
IdP/Provider/LiveKit、设备或远端新 CI。
