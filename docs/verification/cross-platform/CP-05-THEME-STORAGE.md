# CP-05 主题缓存异常容错与持久化恢复（A31）

本轮实施基于 TODO.md P2“主题保存后端支持跨设备水合”与既有 CP-05-THEME-SYNC 的本地优先、后端水合与账号隔离契约。重点解决浏览器在隐私模式、跨域受限或存储配额已满时，`localStorage` 抛出 `SecurityError` 或 `QuotaExceededError` 导致 store 冷导入崩溃、UI 状态阻断或后端水合被误判为 API 失败的问题。

## 实现细节

1. **Storage 读取容错与安全回退**：
   - 在 `readStoredTheme` 中，对访问 `window.localStorage` 及其 `getItem(THEME_STORAGE_KEY)` 的 I/O 操作实施窄范围 `try/catch` 保护。
   - 当属性 getter 抛出 `SecurityError` 或读取过程发生异常时，安全回退默认 `"warm"` 主题，消除对 store 模块冷加载和页面初始渲染的阻断。
   - 保持原 SSR 条件守卫（`typeof window === "undefined"` 回退 `"warm"`）及非法值（非 `"cool"` / `"dark"`）安全回退。

2. **Storage 写入容错与本地优先体验保持**：
   - 封装内部 `safeSetStoredTheme`，对 `window.localStorage.setItem` 执行窄范围 `try/catch`。
   - 用户显式切换主题时，写缓存失败不抛出异常，不阻断即时 store 状态更新、`<html data-theme>` 属性设置与 300ms 防抖同步调度。
   - 匿名/未认证状态下仅保持本地 UI 更新且零网络请求；认证状态下后台主题 PUT 同步正常调度并发送末值。

3. **后端水合写缓存隔离保护**：
   - 成功通过 `getUserSettings()` 完成水合后，写入 `localStorage` 失败被内部安全捕获，绝不冒泡到外部的 API 错误处理分支。
   - 页面与 store 正常水合为后端主题并清除 `loading`，`error` 保持为 `null`，绝不因缓存写失败将成功的 GET 水合误判为 API 错误，且绝不触发任何额外的 PUT 请求。
   - 真正的后端 API 失败（HTTP 500、网络超时等）原有捕获与错误报告行为完全保留。

4. **恢复持久化能力**：
   - 缓存机制定位为性能优化而非权威依赖；当浏览器存储配额释放或安全策略解除恢复可用后，下一次显式的主题选择操作能够正常完成本地持久化。
   - 隔离性保证：仅拦截与处理 `localStorage`，严格避免干扰用于 OIDC 认证状态的 `sessionStorage`。

## 验证与门禁结果

- **单元测试覆盖**（`apps/vite-app/src/store/settings.test.ts`）：
  - 覆盖 `readStoredTheme` 在 `window.localStorage` getter 抛出 `SecurityError`、`getItem` 抛出 `SecurityError`、非法值/空值回退、合法值读取及初始化所用读取函数的安全回退。
  - 覆盖 `setTheme` 在 `QuotaExceededError` 与 `SecurityError` 下正常更新 store 与 DOM 且不崩溃。
  - 覆盖匿名用户在 Storage 故障下本地更新正常且零网络请求。
  - 覆盖认证用户在 Storage 故障下 300ms 防抖后依然能发出并完成精确主题 PUT 同步。
  - 覆盖后端 GET 水合成功时写缓存失败依然水合并清除 loading、无错误且无自动 PUT。
  - 覆盖真实 API 失败时原始错误信息正常报告，不被缓存逻辑吞没。
  - 覆盖 Storage 故障恢复后下一次显式选择成功持久化。

- **双浏览器 E2E 覆盖**（`apps/vite-app/e2e/theme-storage.spec.ts`）：
  - Chromium 与 WebKit 双浏览器环境下，通过 `page.addInitScript` 模拟真实浏览器 Storage 异常（严格限定于 localStorage，不影响 sessionStorage 认证凭据）。
  - 验证冷启动属性 getter 抛错时页面安全回退默认暖色主题，全流程 0 pageerror。
  - 验证切主题写配额超限时 UI 即时更新、精确发送末值 PUT 请求，且在配额恢复后再次切换能成功写入 localStorage。
  - 验证后端 GET 水合成功但写缓存失败时，页面正常水合主题且不产生 UI 报错或误发 PUT。

## 边界与约束

- 严格遵循最小修改原则：仅修改 `settings.ts` 的主题 Storage 读写与调用点，保留所有既有代际、串行占用与防抖状态机逻辑。
- 零新增生产依赖，零全局注入，不影响后端代码或主 checkout。

## Codex 独立验收（2026-10-25）

APPROVED。完整8项质量门禁通过：660 Vitest、18构建脚本、53 Fake API Node、126双浏览器，0skip；专用库269 pytest、73.72%覆盖率与Ruff通过。35独立探针包含真正冷模块导入、异常getter/getItem/setItem、匿名零请求、认证300ms精确PUT、成功GET不误报以及A28的20时序回归。4项独立双浏览器验证冷读取错误与缓存恢复后实际reload，即使后续GET失败仍保留本地选择。去掉读/写保护分别导致3/6项产品测试失败，逐字节与整树指纹恢复后完整门禁通过。

原报告Fake API计数应以Node日志53 tests/10 suites为准。新增fixture将localStorage恢复为value属性而非原accessor descriptor，以及单测命名误称冷初始化，作为低影响P2记录；真正冷启动已有浏览器和独立模块探针覆盖，不将该单测计入冷导入证据。真实设备/Provider/远端CI仍分别待验。
