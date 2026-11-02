# RF-11 API 错误消息解析边界抽离验证

> 实施日期：2026-10-29
> 代码分支：`codex/rf11-api-error-message`
> 对应任务：A62 / RF-11 Transport 统一错误解析纯计算边界抽离（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF-11“保留小型自定义 Transport，统一处理认证、超时、取消、错误解析和 API Origin”与 A62 实施指令规范：

1. **错误解析纯计算抽离为独立纯函数**：
   - 新建 `apps/vite-app/src/lib/apiErrorMessage.ts`，导出 `getApiErrorMessage(status: number, body: unknown): string` 纯计算函数。
   - 纯函数无外部副作用：零网络请求、零 DOM/React/store/全局可变状态依赖、不记录日志、不缓存响应体。
   - 模块零反向导入：不反向导入 `api.ts`、`auth.ts` 或任何业务服务，无反向依赖。
   - 原 `ApiError` 类型严格保留在 `api.ts` 中导出，其构造签名 `constructor(status: number, message: string, data?: any)` 及属性完全原样保留，不搬迁公共类型以防破坏现有调用方。

2. **行为与优先级逐项严格等价保持**：
   - 默认兜底文案：`请求失败: <status>`。
   - `detail` 字符串优先：非空字符串或合法空字符串 `""` 均优先采纳（包括空字符串优先于后项兜底）。
   - `detail` 数组验证异常分支：
     - 仅检查第一项 `firstError = body.detail[0]`；若首项非合法字典或缺失 `msg`，直接回退默认文案，绝不扫描后续元素。
     - 合法 `msg` 支持空字符串 `""`。
     - `loc` 安全守卫：仅当 `loc` 为数组且每一项均为 `string` 或 `number` 时安全拼接 `firstError.loc.join(".")`（空数组拼接为空字符串）；缺失或非法 `loc`（如 string、object、包含 null 等非法元素的数组）统一安全回退至 `"Unknown"`。
   - `detail` 对象嵌套错误分支：
     - `detail.errors`：使用 `getFirstTruthyString` 仅检查 `Object.values` 的首项，首项为有效非空字符串时采纳；首项为空字符串或非字符串时不采纳，绝不扫描后项。
     - `detail.message`：首项 `errors` 未匹配时，若 `detail.message` 为有效非空字符串则采纳。
     - `JSON.stringify` 兜底：无 `errors` 且（无 `message` 或 `message === ""`）时，对 `detail` 进行 `JSON.stringify` 兜底；若序列化遇到异常（如循环引用），安全回退至默认兜底文案。
   - 外层 `errors` 分支：未通过 `detail` 包装时，仅检查 `Object.values(body.errors)` 首项是否为有效非空字符串。
   - 外层 `message` 分支：仅在 `body.message` 为 `string` 时采纳（支持空字符串）。

3. **原请求链路真实委托与时序保全**：
   - 原 `apps/vite-app/src/lib/api.ts` 的 `request` 真正消费 `getApiErrorMessage`，彻底移除旧的冗余错误解析私有副本。
   - 认证 revision 获取、token 校验、Headers 合并、fetch 配置、诊断日志打点保持原样。
   - 401 在读取 JSON 响应前按原 revision 执行 `invalidateAuthSession(reqRevision)` 的时序完全不变。
   - 非 JSON 响应解析失败时安全回退 `{}` 的逻辑完全不变。
   - 只发送一次请求，写请求与错误链路绝不发生重放。
   - 原 `res.status` 与 `body` 对象身份完全保持并传给 `ApiError`。

## 2. 本地实现与测试覆盖

### 2.1 模块纯计算实现与客户端消费

- `apps/vite-app/src/lib/apiErrorMessage.ts`：
  - 实现纯函数守卫 `isRecord(value: unknown): value is Record<string, unknown>`。
  - 实现首项提取函数 `getFirstTruthyString(record: Record<string, unknown>): string | null`。
  - 实现并导出 `getApiErrorMessage(status: number, body: unknown): string`。
- `apps/vite-app/src/lib/api.ts`：
  - 导入并真实消费 `getApiErrorMessage`。
  - 移除原局部私有 `isRecord` 与 `getFirstTruthyString` 冗余代码。

### 2.2 自动化回归测试

- `apps/vite-app/src/lib/apiErrorMessage.test.ts`（新增直接单测）：
  1. `default message fallback`：覆盖 `null`、`undefined`、数字、布尔、字符串原始值及原始数组回退默认文案。
  2. `detail string branch`：覆盖非空 detail 字符串与合法空 detail 字符串优先。
  3. `detail array validation errors branch`：覆盖 string/number loc、空 loc 数组、空 string msg、缺失 loc（回退 Unknown）、非法 loc 结构（回退 Unknown）、空 detail 数组回退及首项非法不扫描第二项的严格行为。
  4. `detail object branch`：覆盖 `detail.errors` 有效首值提取、首值为空不扫描第二项、首值非 string 回退、`detail.message` 非空采纳、`detail.message` 为空回退 `JSON.stringify`、空字典 `{}` 序列化兜底、循环引用序列化异常安全回退默认文案。
  5. `top-level errors branch`：覆盖外层 errors 首项提取、首项为空不扫描第二项、非 record errors 忽略。
  6. `top-level message branch`：覆盖有效 message、合法空 message 与非 string message 忽略。
  7. `priority and immutability`：验证 detail 字符串 > detail.errors > detail.message > errors > message 优先级链路；使用 `Object.freeze` 验证入参及嵌套结构完全不被修改。

- `apps/vite-app/src/lib/api.test.ts`（消费回归与原断言保持）：
  1. 完整保留原有约 2088 行全部断言（含 401 撤销、迟到 401 防护、非 JSON 502、写请求单次调用防重放及表驱动异常形状测试）。
  2. 新增可证伪测试替身用例：通过 `vi.spyOn(apiErrorMessageModule, "getApiErrorMessage").mockReturnValue(...)`，验证公共客户端调用（如 `checkHealthReady`）在 HTTP 错误时确实委托 `getApiErrorMessage`，证明 `ApiError.message` 严格采纳委托返回值、`ApiError.status` 与原始 `body` 身份保持、fetch 恰好调用 1 次，并在 `finally` 完整恢复 spy。

### 2.3 携带 A61 文字 P2 修正

1. **`docs/verification/cross-platform/RF-11-SETTINGS-PAYLOAD.md`**：
   - §2.1 标题“纯纯计算”更正为“纯计算”。
   - §2.2 首行测试统计数由笔误的“新增 7 项”更正为实际清单与执行的“新增 8 项”。

## 3. 边界与未验界限

- 本轮仅完成 RF-11 Transport 层错误消息解析纯计算抽离子项，RF-11 整项保持未勾选。
- 前端 API 类型尚未由 OpenAPI 生成，会话状态模型重构尚未实施。
- 未连接真实第三方 Provider 或外部网络，未引入新的外部依赖。
