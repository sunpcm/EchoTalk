# RF-11 异常 HTTP 错误体健壮解析验证

> 实施日期：2026-10-26
> 代码分支：`codex/rf11-error-body-guards`
> 对应任务：A49 / RF-11 Transport 异常 HTTP 错误体健壮解析（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF11“保留小型自定义 Transport，统一处理认证、超时、取消、错误解析和 API Origin”与 A49 冻结契约：

1. **状态码与原始数据保全**：任何格式的异常错误响应体（包括 `detail: [null]`、非数组或非法 `loc`、非 string 的 `msg`/`errors`、原始非对象 JSON、非 JSON 响应体拒绝）均不得导致解析器抛出 `TypeError` 或将对象误赋为 `Error.message`。统一抛出 `ApiError`，准确保留 HTTP `status` 与原始 `data`。
2. **分支优先级与有效文案保持**：完整保持既有有效分支及其优先级：
   - 标准 FastAPI 字符串 `detail`（包括空字符串优先）。
   - FastAPI 校验异常 `detail[{loc:[string|number],msg:string}]`（支持数值索引及空数组 `loc`）。
   - 嵌套健康检查 `detail.errors`（首个有效非空字符串）。
   - `detail.message` 字符串（保留原 truthy 语义）。
   - 顶层未包装 `errors`（首个有效非空字符串）。
   - 顶层 `message` 字符串（包括空字符串）。
   - 无 `errors` 与 `message` 的合法 `detail` 字典对象 `JSON.stringify` 兜底。
   - 无法解析有效文案时安全回退至原默认文案 `请求失败: <status>`。
3. **loc 安全守卫**：缺省 `loc` 保持回退至 `"Unknown"`；未通过数组类型收窄的非法 `loc`（如字符串、字典、包含非 string/number 元素的数组）安全回退至 `"Unknown"`，禁止在非法 `loc` 上调用任何对象方法，正常 string/number 数组可安全 join。
4. **认证代际与写请求保护**：401 会话失效在响应体解析前绑定发起请求时的 `reqRevision`，迟到的 401 响应不得使更新的会话失效。请求仅发起一次，错误全流程不重放任何写请求。
5. **诊断脱敏白名单**：诊断日志严格遵循预设事件与脱敏规则，不记录任何响应体正文、URL、参数或凭据。

## 2. 本地实现与变更

### 2.1 改造前端 API 客户端 (`apps/vite-app/src/lib/api.ts`)

- 新增局部纯函数类型守卫 `isRecord` 与首值有效字符串提取辅助函数 `getFirstTruthyString`，不增加外部生产依赖。
- 在 `request` 错误处理流程中，改用 `isRecord(body)` 安全过滤非字典 JSON。
- 改造校验异常分支：确保 `firstError` 为字典且 `msg` 为字符串类型（空字符串合法透传），对 `firstError.loc` 进行数组类型与项类型（string/number）过滤，正常数组安全拼接 `validParts.join(".")`（空数组安全拼接为空字符串），未通过数组类型收窄的非法或缺失 `loc` 统一回退为 `"Unknown"`，消除非法 `loc` 调用方法导致的 `TypeError`。
- 改造 `detail.errors` 与顶层 `errors` 分支：保持原 errors 首空值 fallback 和 `detail.message` 原 truthy 语义，仅在首值为有效非空字符串时采纳，避免将字典对象误赋为 `Error.message`。
- 改造 `detail` 字典序列化兜底：严格要求 `detail` 为无 `errors` 且无 `message` 的字典对象，防止非法数组或畸形数据被错误序列化。
- 保持 `ApiError.data` 属性与原有签名，不改动全仓类型依赖。

### 2.2 扩展前端回归测试 (`apps/vite-app/src/lib/api.test.ts`)

- 保留原有 4 项错误处理测试用例与全部断言。
- 新增 `Robust error body guards (RF-11)` 测试分组，通过公共 API（如 `checkHealthReady`、`createSession`）执行真实 `request` 链路。
- 引入 34 项表驱动用例，全面覆盖 422 异常/有效 detail、非法/缺省 loc、空 loc 数组、空 msg 字符串、非 string msg、异常 errors、嵌套 detail 结构、空 detail 优先、顶层空 message 及原始非对象 body（null、number、array、boolean）。
- 新增非 JSON 响应（`res.json()` reject）用例，验证回退 `请求失败: <status>` 与原始空字典保持。
- 新增 401 异常错误体用例，验证会话失效逻辑在解析前触发且 `ApiError` 状态码保留。
- 新增迟到 401 保护用例，验证在途会话代际递增后迟到的 401 不清除新凭据。
- 新增写请求单次调用用例，验证失败时不发生重放。

## 3. 边界与未验界限

- 本轮仅针对 Transport 层异常错误体健壮解析与 401 代际保护（RF-11 子项），未勾选 RF-11 整体。
- OpenAPI 客户端/TypeScript 类型代码生成、会话状态模型收敛为判别联合/Reducer 及大组件拆分仍待后续完成。
- 所有前端测试均基于 Fetch Mock 环境，零真实后端或网络服务调用。
