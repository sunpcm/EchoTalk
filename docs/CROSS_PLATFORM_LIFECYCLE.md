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
