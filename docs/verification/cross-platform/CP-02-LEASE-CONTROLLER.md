# CP-02 独立占用控制器本地验证

日期：2026-10-22。A代码deacf3e，B代码418d2cd，共同契约基线fc9540e，组合提交8c38a01；仅本地集成，未push/deploy。

## 行为与边界

按[CROSS_PLATFORM_CALL_LEASE.md §10](../../CROSS_PLATFORM_CALL_LEASE.md)新增可依赖注入的callLeaseController工厂：显式claim、20秒串行heartbeat、独立expires_at watchdog、释放失败保留tuple并仅显式重试、认证/操作代际检查、快照隔离及dispose。没有默认自动接管/重试/补偿，不导入单例、不获取媒体Token、不采音、不持久化设备ID。

独立评审首轮发现并返工CC-01/02：旧heartbeat挂起的共享在途标记阻塞新owner；旧finally无归属清除新Promise指针；release身份失效与observer取消后仍发写。第二轮按操作代际绑定在途标记与清理，在实际transport之前（包括notify后）核验有效性，29项私有探针通过；旧请求保持pending也能显式恢复新owner续期。

## 独立本地证据

| 检查                | 结果                                                     |
| ------------------- | -------------------------------------------------------- |
| A产品测试           | 320通过，基线280                                         |
| 私有控制器探针      | 29通过；首轮真实4失败原证据保留                          |
| 构建隔离            | 18通过                                                   |
| 关键变异            | 3个被产品断言杀死；1个行为冗余候选未杀，不计入通过       |
| A Chromium/Fake API | 既有6+能力门禁6通过                                      |
| A+B组合             | 336产品、18构建测试、格式/lint/类型/双构建及6项E2E通过   |
| 后端                | 269通过，73.72%；专用库身份/ready/schema检查通过，未迁移 |

变异覆盖默认不接管、旧claim finally不清新指针、observer取消前写入检查；恢复原字节/指纹后完整质量与私有探针复验。先前私有探针错误await去重Promise导致2超时，已修正夹具，不误报产品Bug。

## 并行与未完成项

与Web生命周期模块在不同worktree并行实施，文件所有权无重叠；各自review，B先集成、A后串行merge，组合再次验收。实现/返工由agy同会话完成，Codex独立review，未代写产品补丁。原始证据只留本地`.review/reports/workflow-parallel-a8/`。

本增量是前置模块：未接conversation/UI、Cloud开始门禁未解除，默认disabled保持。真实Cloud撤销/重连、原生前后台/媒体、稳定设备ID、恢复/显式接管UI仍待后续，不把模块验收当CP-02整体完成。控制器时间保护依赖本机时钟，本地保守失败关闭不替代服务端权威与真机时钟验收。
