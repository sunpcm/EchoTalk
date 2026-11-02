# RF-11 API 请求 Header 合并边界抽离验证

> 实施日期：2026-10-31
> 代码分支：`codex/rf11-request-headers`
> 对应任务：A63 / RF-11 Transport 请求 Header 合并纯计算边界（本地单轮实施，停 Review）

## 1. 契约与设计依据

依据 [MVP 重构方案](../../MVP_REFACTORING_REMEDIATION_PLAN.md) §RF-11“保留小型自定义 Transport，统一处理认证、超时、取消、错误解析和 API Origin”及“合并 `RequestInit.headers` 时保留默认 Header，不允许调用方无意覆盖认证信息”实施。

`apps/vite-app/src/lib/apiRequestHeaders.ts` 提供同步纯函数：

```ts
buildApiRequestHeaders(inputHeaders: HeadersInit | undefined, accessToken: string | null): Headers
```

模块仅使用标准 `Headers` 初始化行为，零网络、异步、DOM 节点、store、日志与全局可变状态，且不反向导入 `api.ts`、`auth.ts` 或业务服务。函数不修改输入对象，每次返回独立的新 `Headers`。

## 2. 原 Header 合并语义对照

| 输入/条件           | 原 `request` 行为                                | 新模块行为 |
| ------------------- | ------------------------------------------------ | ---------- |
| 无调用方 Header     | 新 Headers；补 `Content-Type: application/json`  | 保持       |
| 已有 `Content-Type` | 使用标准 Headers 的大小写不敏感检查，原值不覆盖  | 保持       |
| 有 token            | `Authorization: Bearer <token>` 覆盖调用方认证值 | 保持       |
| 无 token            | 不主动设置或删除 `Authorization`                 | 保持       |
| 自定义 Header       | 保留调用方值                                     | 保持       |
| 数组或多值 Header   | 由标准 `Headers` 构造/合并，不手工拼接           | 保持       |
| 输入隔离            | 构造新 Headers，后续修改不影响输入               | 保持       |

## 3. 真实消费与请求时序

- `apps/vite-app/src/lib/api.ts` 通过模块命名空间真实调用 `buildApiRequestHeaders(options?.headers, accessToken)`，旧私有合并表达式已移除。
- 调用点位于 `getBaseUrl()`、`getAuthRevision()`、`await getAccessToken()` 和 revision 二次校验之后，早于唯一一次 `fetch`；认证读取与检查顺序未改变。
- `baseUrl/path`、`...options`、最终 `headers`、网络与 HTTP 诊断、`ApiError`、401 按请求 revision 失效、非 JSON 回退和单请求行为均保持原实现。
- `api.test.ts` 使用可证伪 spy 替换新模块，通过公共 API `getSessionToken` 调用 `request`；断言委托实参、返回 Header 身份、最终 fetch 的 `Content-Type`、`Authorization`、通话租约自定义 Header、额外 Header 与一次 fetch。恢复替身后，既有公共 API 测试继续验证真实行为。

## 4. 自动化覆盖

`apps/vite-app/src/lib/apiRequestHeaders.test.ts` 直接覆盖：

1. 空入参只补默认 `Content-Type`，无 token 不设置认证。
2. 原始对象 Header、原值保留及冻结输入不变。
3. 数组重复 Header 的标准多值合并语义。
4. `Headers` 实例被复制且返回与输入不共享可变状态。
5. 无 token 时保留调用方显式 `Authorization`。
6. 有 token 时设置 Bearer 认证并保留自定义 Header。
7. 冻结数组及嵌套 entry 不被修改。
8. 多次调用返回独立 `Headers`。

`apps/vite-app/src/lib/api.test.ts` 原有断言保留，并新增公共消费者委托回归；认证 revision 读取期间变化的既有用例继续证明请求会在 `fetch` 前停止。

## 5. 门禁与证据

本轮只通过固定入口
`python3 /Users/sunpcm/code/EchoTalk/.review/reports/tools/cross-platform-local-check.py b STEP`
执行后端格式、后端 Lint、后端测试和完整 quality 门禁；实际退出码与证据路径以实施交付报告为准。

## 6. 边界与未验界限

- 本轮仅完成 RF-11 Transport 的本地 Header 合并边界，RF-11 整项保持未勾选。
- 未生成 OpenAPI TypeScript 类型或客户端，未完成会话状态模型重构，未实现超时与取消。
- 未访问真实后端、第三方 Provider、LiveKit 或其他业务服务；公共 API 回归只使用 Fetch 替身。
- 未提交、推送、合并、部署或发布。
