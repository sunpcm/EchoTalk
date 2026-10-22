# CP-01/05 Web生命周期薄适配器本地验证

日期：2026-10-22。B代码418d2cd，本地独立APPROVED并集成；未push/deploy。

依据[CROSS_PLATFORM_LIFECYCLE.md](../../CROSS_PLATFORM_LIFECYCLE.md)新增Web默认工厂与platform导出：初始可见性/online提示、visibility/online/offline去重、pagehide/pageshow事件、防御快照、独立订阅解除、最后退订清理及永久dispose；listener异常隔离。模块导入无计时/DOM订阅副作用，不发请求、不采音、不接UI/store，nativeAppState明确false；SSR缺DOM安全降级，onLine不代表服务可达。

独立首轮在常规294产品绿后发现LC-01：未监听时环境变化未同步，重订阅继续旧visible/online并可能抑制恢复事件。已由原会话返工增加未订阅getSnapshot/首次重新监听时同步，保留无初始通知和pagehide语义。

本地验收：B产品296、构建隔离18、私有探针11、既有6与私有真实DOM3项Chromium通过；3个关键变异被产品断言拦截，原字节恢复后全质量再验。与A组合336产品/7项固定门禁通过。前后源码fingerprint一致，临时端口4173/18181释放。

实际Capacitor/Tauri App事件、音频中断/休眠、业务恢复控制器接线与真机均未验收，CP-01薄适配整体和CP-05整体不勾选。原始证据仅在本地`.review/reports/workflow-parallel-a8/b/`。
