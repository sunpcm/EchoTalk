# RF-11 VoiceInterface 行为拆分验证

> 状态：源码、测试与文档实施完成，停在 Review；实施方按受控执行分工未运行 formatter、测试、
> 类型检查、build 或 Git 写命令。固定 quality10、专用测试库 backend 与必要变异待主 Agent
> 在实施停写后通过 `cross-platform-local-check.py b` 代跑。
> 日期：2026-11-01。

## 目标与非目标

本轮落实 `docs/MVP_REFACTORING_REMEDIATION_PLAN.md` RF-11“按行为拆分 VoiceInterface”，
保持既有已验收行为、DOM、文案、资源所有权与公共导出。本轮不修改产品功能、HTTP 契约、
会话状态机、请求预算、分析重试政策、LiveKit SDK 或依赖；SettingsDrawer 留待下一轮。

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

## 当前验证状态

实施节点未执行，等待主 Agent 受控代跑：

- format-fix 后基线 format/lint/typecheck；
- 固定前端 quality10；
- 专用 PostgreSQL 测试库的完整 backend pytest；
- 针对资源所有权、认证代际门禁和行为视图选择的必要变异；
- 独立 Review。

上述未执行项不得由 receipt 或 baseline 推断为“实现后通过”。真实 IdP、Provider、LiveKit、
设备、远端 CI、部署与发布仍未验证。

## 剩余 RF-11 范围

VoiceInterface 行为拆分完成后，RF-11 仍需 SettingsDrawer 行为拆分及相应回归。整项保持
未勾选，直至两轮独立 Review 和完整门禁均通过。
