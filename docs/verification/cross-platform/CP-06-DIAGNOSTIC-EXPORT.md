# CP-06 用户主动复制安全诊断

本轮在现有本地控制台诊断上增加内存预览、复制和清空入口。2026-11-03 主控已完成 A 局部
Vitest 1034、Chromium/WebKit 合计 166 回归，均通过；`auth-buffer` / `copy-order` 两个
真实变异均 killed，源码已还原。实现节点没有自行运行测试或服务。

本次验证记录（2026-11-03）：主控 `checks/combined-r1` 完整 frontend10/backend5 已通过；补充 format、
B r2 Node 28 和 4 个双浏览器几何场景通过，独立隐私 4 项通过；本页下方先前待组合口径以此为准。
记录时最终 A 尚未正式交付；正式交付与 [PR #119](https://github.com/sunpcm/EchoTalk/pull/119) 最终 head CI
以主控报告为准；B 子集五 jobs 全绿不等于最终 A head，不声明外部语音验收完成。

## 1. 依据与范围

- [TODO CP-06](../../../TODO.md)：按版本、平台关联 API、LiveKit、Agent 错误，不采集
  Token、密钥或默认上传文档、对话正文。整项是否完成仍由主控统一收口。
- [本地安全诊断一期](./CP-06-SAFE-DIAGNOSTICS.md)：复用从零构造的严格白名单 record，
  保留 console.warn/log/error 分级与错误隔离。当前源码含 timeout/aborted 增量，共
  10 个允许事件；一期文档中的 8 个事件是当时的历史范围。
- [认证与账号清理](../../CROSS_PLATFORM_AUTH_LIFECYCLE.md) §2–§4：复用认证 revision
  和 `clearUserSessionData()`，不改认证模块、账号判定或业务 store 的原有清理语义。
- [原生生命周期](../../CROSS_PLATFORM_NATIVE_LIFECYCLE.md)：本轮不新增原生监听、
  麦克风、Room 连接或后台恢复行为。

## 2. 数据边界

缓冲直接放在 `lib/diagnostics.ts` 的模块私有内存，只有现有 `logDiagnostic()` 能写入，
不提供外部 payload/record 的追加入口。最多保留最近 50 条，按产生顺序展示，满时淘汰最旧
记录；没有持久化、遥测、自动复制或新网络请求。

允许字段保持为 `schema_version`、`app_version`、`platform`、`event`，以及仅属于对应
事件的合法 `status` 或白名单 `agent_code`。版本来自静态 package.json，平台与事件按
既有枚举校验。未知字段从不展开或遍历；非白名单错误码只保留 `unknown`。不增加时间戳、
URL/path、账号/会话标识、异常/响应正文、对话或文档正文。

record 与快照数组都冻结；已取得的快照不会随后变化，也不能反向污染内部缓冲。
新日志生成新数组；空快照在没有新操作时保持引用稳定，供 `useSyncExternalStore` 消费。
控制台 sink 和各订阅者抛错局部隔离，同步重入不递归通知或回写旧快照。

公开接口仅有读取快照、读取清空代际、清空和订阅。订阅者各自拥有认证监听并幂等释放；
注册/释放失败不向业务传播，后续读取/写入仍强制复核认证 revision。

## 3. 清理与反馈归属

`clearUserSessionData()` 先清空诊断数据并递增清空代际，再执行原 conversation/settings/
assessment 清理。AuthGate 原有退出、不同 principal 切换、初始化失败和卸载链自然复用，
即使设置页从未打开也生效。

每次读取、写入和查询清空代际都核对当前认证 revision；发生变化即清空旧记录。存在活跃
订阅时，认证事件同步触发该清理；不存在订阅时，退出/切换账号仍通过既有清理链立即清理，
同 principal 认证刷新则在下一次访问前清理。revision 和清空代际都不写入导出内容。

`SettingsDiagnostics` 只随设置页实际可见子树挂载。用户点击复制后调用标准
`navigator.clipboard.writeText`；反馈绑定本次挂载、操作序号及清空/认证代际。清空、认证
变化、卸载或新操作会作废旧 Promise 的成功/失败反馈。复制失败或不支持时，保留可选择的
只读 textarea 供手动复制；不输出原异常或使用 `execCommand`。

已经交给系统的剪贴板调用无法撤销；清空与账号变化会阻止旧 UI 反馈回写，不宣称能撤回用户
此前主动发起的系统写入或已经复制出去的内容。

诊断区在设置加载期间也可使用。诊断按钮均为 `type="button"`，不调用设置保存、Provider
验证、主题更新或网络 API。`useSettingsForm` 和 `useSettingsDialog` 未修改：同一 settings
引用下草稿按原规则保留，新服务端 settings 引用仍按原 hook 水合。

## 4. 回归覆盖与 A 局部验证

| 位置                             | 用例设计                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/diagnostics.test.ts`        | 真实日志入缓冲、冻结输入及不可读未知字段、全部事件精确字段、canary 缺失、50 条容量/顺序、冻结快照及返回值隔离、读/写认证代际、空清理代际、订阅失败/重入/幂等释放、控制台失败与构造期间失效            |
| `lib/user-state.test.ts`         | 无诊断 UI 时共享清理、订阅异常不阻断 store、真实 AuthGate 退出/直接换账号/卸载清理                                                                                                                    |
| `SettingsDiagnostics.test.tsx`   | 空态、只读可选预览、主动复制与零网络/存储写、缺失/同步抛错/异步拒绝与恢复、清空/认证/卸载重开后的 resolve/reject 迟到、新操作归属、访问剪贴板时重入清理、StrictMode 监听回收                          |
| `SettingsDrawer.test.tsx`        | 真实组件组合：复制/清空不保存、不重开 dialog、不清草稿，设置加载期间可用，关闭重开仅清局部反馈                                                                                                        |
| `e2e/diagnostics-export.spec.ts` | Fake API 真实 HTTP 503 入口、完整预览与剪贴板内容精确对照、响应/草稿 canary 缺失、复制/清空/空态、失败/不支持手动选择及恢复、关闭重开后的迟到结果、诊断操作期间零 fetch/xhr、全程零业务写与 pageerror |
| `e2e/settings-drawer.spec.ts`    | 自定义关闭时按正反向每步具体控件验证诊断预览/复制/清空的焦点顺序；保留初始 Close、Save 精确命中、闭环、Escape 恢复与 disabled Provider 跳过检查                                                       |

主控确认上述 A 局部回归计数为 1034 Vitest、166 双浏览器；认证缓冲清理与复制操作顺序的
两个真实变异均 killed 后还原。实施 r0/r1 当时的未执行声明及首次 E2E 164 通过/2 失败
保留于本地交付记录，最新结果不覆盖或抹掉失败历史。

本地运行回执保留于 `.review/reports/keyfree-delivery-20261103/`，不虚构缺失的精确日志名或
CI run 编号。本次只刷新文档，没有重跑测试；最终组合 frontend10/backend5 与独立评审
仍待主控，不能把尚未执行的组合、真实设备或外部链路计为通过。

## 5. 主控收口事项

现有 `apps/vite-app/e2e/settings-drawer.spec.ts` 原先写死从 Close 按 5 次 Tab 到 Save。
主控已审候选补丁并在首次交付前明确增量范围，本轮已改为正反向逐步验证具体控件，
保留 Close/Save 精确命中、闭环、Escape 和焦点恢复。r1 根据主控实测修正 fieldset 匹配器
语义：检查真实 disabled 属性及全部 7 个实际 Provider 控件逐一禁用，没有改产品 fieldset。
未放宽焦点标准，也没有只检查“最终到达 Save”。自定义开启用例的 20 次遍历上限保留原样；
主控后续 A 双浏览器 166 已通过，这不外推为 B/C 新组合的浏览器或原生验收。

真实 Clipboard 权限/设备、IdP、LiveKit、Provider、OS、采音、服务端和发布均未验。
本次文档收口不改诊断实现、依赖、后端、原生工程或全局工具；不 commit/push。
