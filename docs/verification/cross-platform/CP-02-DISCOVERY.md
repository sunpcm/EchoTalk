# CP-02 活动会话发现：本地增量验证报告

## 1. 范围与契约定义

本增量依据 `docs/CROSS_PLATFORM_SESSION_DISCOVERY.md` 规范，实现并验证前端共享 Dashboard 上的活动会话本地发现流程：

1. **接口消费**：
   - 消费后端既有 `GET /api/sessions/active` 只读端点，响应为 `SessionListItem[]`。
   - 严格保留后端已排定的 `started_at/id` 降序顺序。
   - API 封装 `listActiveSessions()` 沿用 `request`，401 触发按代际 session 失效（`invalidateAuthSession(reqRevision)`）。

2. **Dashboard 组件展示**：
   - 在应用 Dashboard 渲染 `<ActiveSessions />`。
   - 包含明确说明文案：“尚未结束的记录不代表正在通话；恢复与接管暂未开放”。
   - 列表仅包含：会话 ID、开始时间、已知模式的本地化标签（未知模式显示通用标签）。
   - 状态分支：加载中态、空列表态、成功列表态、失败态及显式重试。
   - 绝不回显任意服务端错误详情或正文。
   - 无恢复、接管或结束按钮；不自动轮询、签 Token、dispatch、结束、claim 或请求麦克风。
   - 不持久化列表、Token 或本地提示，不改变既有开始练习入口。

3. **认证隔离与并发时序**：
   - 认证处于 `loading`、`anonymous`、`misconfigured` 时不发请求，清空并隐藏记录。
   - 基于精确的 `issuer + subject` 及 `authRevision` 进行账户隔离。
   - 换号或退出立即作废在途请求并清空界面；旧请求的迟到响应（成功/失败/finally）均被拦截，绝不覆盖新请求。
   - 同账号退出重登（revision 递增）同样能阻断旧请求回填。
   - 卸载后不更新组件状态；兼容 React StrictMode。
   - 同一挂载实例同时最多一个在途请求，重试期间禁用重复提交。
   - 未改动既有 `auth.ts` 安全底座。

---

## 2. 自动化验证矩阵

### 2.1 API 客户端测试 (`apps/vite-app/src/lib/api.test.ts`)

- `listActiveSessions preserving backend order and passing auth token`: 校验请求路径 `${getBaseUrl()}/sessions/active`、`Authorization: Bearer <token>` 头部，以及保持返回数组元素顺序。
- `handles 401 on listActiveSessions by invalidating session`: 校验 401 触发 `invalidateAuthSession(reqRevision)`。

### 2.2 组件行为与时序测试 (`apps/vite-app/src/components/conversation/ActiveSessions.test.tsx`)

- **基础渲染与文案**：加载态、免责声明、标题、会话ID、格式化开始时间、已知模式本地化标签、无多余恢复/结束/接管按钮。
- **空列表**：列表为空时展示本地化空文案。
- **未知模式与原型安全**：非已知模式显示通用标签（`其他模式`）；对 `constructor`、`toString`、`__proto__` 等原型属性具备自有属性隔离，安全回退至通用标签，杜绝 React 渲染异常。
- **保留顺序**：严格按后端数组顺序渲染列表项。
- **错误处理与重试**：服务端 500 报错时仅显示通用错误文案，绝不泄露内部报错信息；重试按钮发起重新获取；重试在途期间禁止重复提交。
- **未认证边界**：`loading`、`anonymous`、`misconfigured` 状态下均不发起请求，且 DOM 为空。
- **退出与换号隔离**：在途请求遇到退出立即清空 DOM，旧请求迟到返回不回填；换号到新账号发起新请求，旧账号迟到数据被丢弃。
- **同账号退出重登**：旧 revision 下的失败或成功响应绝不冲掉新 revision 下的新请求状态。
- **乱序响应（Race Condition）**：较新请求先返回，较旧请求后返回时，旧请求被废弃，保留新数据。
- **卸载保护**：请求在途期间卸载组件，不触发报错或已卸载组件状态更新。
- **React StrictMode**：在严格模式下双重挂载仍能正确完成数据获取并渲染。

### 2.3 应用集成测试 (`apps/vite-app/src/App.test.tsx`)

- 验证 `<ActiveSessions />` 挂载接入 `Dashboard`，原有设置水合与视图切换逻辑不受影响。

---

## 3. 未验证边界声明

依据契约第 5 条，本增量仅证明共享客户端本地发现逻辑与时序隔离，以下内容属于跨端演进后续阶段，仍未验收：

- 真实 IdP / OIDC 登录回跳与服务端 Token 交换；
- WebKit / iOS 原生容器与真机环境；
- 原生 URL Scheme / Universal Link 回跳；
- 媒体层真实恢复、房间接管与音视频重连；
- 后端心跳与租约机制；
- CP-02 跨平台完整端到端链路。

## 4. 独立评审与本地集成

2026-10-21独立评审APPROVED，代码提交`5a60333`快进本地隔离集成分支；未推送、未部署。最终独立执行228项产品测试、18项构建隔离测试、5项私有边界探针、既有6项与新增2项Chromium/Fake API E2E、全部前端质量与双构建；后端269项专用PostgreSQL测试、覆盖率73.72%通过。390px窄屏截图已检查。未知模式原型属性碰撞缺陷已修复，产品回归覆盖5个原型名及6个已知模式。原始失败报告保留，全部证据在本地`.review/reports/workflow-discovery/`。上述外部/原生边界仍未验收。
