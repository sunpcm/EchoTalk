# 共享Web生命周期事件边界（2026-10-22）

## 1. 范围

本轮仅新增platform/webLifecycle.ts、对应测试并从platform/index.ts导出。提供无业务副作用的Web默认适配器，为CP-01/05后续接线准备。不接store/UI、媒体、认证或网络API，不新增依赖/原生插件，不把浏览器事件等同iOS/Tauri原生事件已支持。

## 2. 公开接口

`createWebLifecycleAdapter()`返回`capabilities: {webEvents:boolean,nativeAppState:false}`、`getSnapshot()`、`subscribe(listener):()=>void`、`dispose()`。snapshot为`{visibility:"visible"|"hidden"|"unknown",online:boolean|null}`。事件为`{type:"suspend"|"resume"|"connectivity",snapshot}`。snapshot/事件防御性拷贝，不向外暴露可修改内部状态的引用。

模块导入无副作用，工厂创建时捕获当前可用window/document/navigator，不访问storage。缺window或document事件接口时webEvents=false，subscribe安全no-op，未知可见性/在线能力分别unknown/null；不得伪装online或发起联网探测。navigator.onLine仅代表浏览器提示，不证明API/Provider可达。

## 3. 事件与清理

首次有效订阅才在document监听visibilitychange，在window监听online/offline/pageshow/pagehide；最后一个订阅解除即移除，重复unsubscribe无影响，再次订阅可重新挂载。subscribe不立即发事件，调用方用getSnapshot读初始状态。可见性/online/offline仅值变化才发对应resume/suspend/connectivity；pageshow每次真实事件发resume、pagehide每次真实事件发suspend（pagehide快照hidden，pageshow重新读取document）。不把focus/blur当生命周期。

dispose幂等、移除全部监听且永久拒绝后续订阅事件；即使外部仍持有回调/分发事件也不能通知。一个listener抛错不能阻止其他listener与清理。多个订阅（包括相同函数两次）独立解除；派发期间unsubscribe/dispose后不得继续通知已取消订阅。无计时器、poll、getUserMedia、API请求或后台恢复音频。

## 4. 必须验证

浏览器初始快照、状态变化与去重、pagehide/pageshow（包含visible时pageshow仍通知）、订阅独立解除和最后清理、再订阅、派发中取消/dispose、异常listener、快照隔离；SSR/缺navigator/缺window或document安全降级，无导入副作用。真实Capacitor/Tauri前后台、音频中断、联网恢复与业务去重另轮接入验证。

## 5. Dashboard活动会话列表接线

在ActiveSessions挂载effect内创建独立Web适配器，先订阅后读取当前快照；卸载/StrictMode清理退订并dispose，不使用模块级单例、不增加定时器。生命周期只驱动既有只读listActiveSessions，既有认证principal/revision与请求代际隔离继续保留。原生壳可消费其WebView DOM事件，不宣称具备原生App状态能力。

初始挂载及认证代际变化保持既有自动发现，但仅在visibility不是hidden且online不是false时请求；unknown/null代表未知而不是失败，允许原有发现。resume事件仅visibility为visible且online不是false时刷新；connectivity事件仅online为true且visibility不是hidden时刷新。当前有效请求在途时合并重复触发，不排队、不自动重放。无效认证、后台及离线不发列表请求；手动重试沿用相同认证/可见性/网络门禁。浏览器在线提示不证明API可达。

suspend或online=false立即作废当前请求并释放在途槽位、退出loading，保留同一账号已展示列表、不新增错误提示。恢复/在线时允许立即发新请求，即便旧请求尚未完成；旧成功/失败/finally不得改新结果、错误、loading或新请求归属。认证变化仍立即清空旧账号数据，后台/离线期间变化的账号在后续合格事件中读取当前身份再发现。卸载后不再响应任何事件。

单次列表失败沿用本地化错误与显式重试，不新增自动循环、不回显服务端正文。不得发创建、claim/heartbeat/release、Token、dispatch、结束请求，不触发媒体/存储，不解除Cloud门禁、不自动恢复或接管通话。本轮只修改ActiveSessions及其测试；后续恢复/接管入口另轮验收。

验收包含初始/认证变化、前后台和网络组合门禁、重复事件去重、挂起旧请求下恢复新请求、旧成功/失败及finally隔离、账号切换、StrictMode及卸载监听清理；浏览器真实DOM事件配Fake API验证只读请求次数和最终列表。原有发现契约与测试保持通过。
