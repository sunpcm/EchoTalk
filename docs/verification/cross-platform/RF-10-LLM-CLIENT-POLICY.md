# RF-10 普通 OpenAI 兼容客户端策略验证

> 状态：A83 b/r0 已 Review APPROVED，以正常 hook 单提交、本地 main 精确
> fast-forward 与完整 main 门禁核销；未 push/部署。
> 日期：2026-11-01。
> 基线：`codex/rf10-llm-client-policy@d8c9ff9d8f69ef0d55add4c955bb096b790f6e2c`。
> 定格：`fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d`。

## 1. 问题与 SDK 事实

`services.llm_service._get_client()` 原先只传 `api_key` 与 `base_url`，普通聊天 HTTP
客户端因此沿用 OpenAI SDK 隐式 timeout/retry。A83 b/r0 公开正式本地 receipt 独立实测锁定的
依赖版本为 OpenAI `2.54.0`、httpx `0.28.1`，常量源码 SHA-256 为
`ace7e06c293099027477a40f94cad2f9d761ca9b5c4f8e62b874972c3dd70fa0`。

当前有效行为为：

- connect timeout 5 秒；
- read、write、pool timeout 各 600 秒；
- OpenAI 兼容 HTTP SDK `max_retries=2`。

600 秒是 HTTP 客户端未单独指定阶段时的默认配置，不是一次完整聊天请求的总 deadline。
该策略只服务普通 OpenAI 兼容聊天 HTTP 客户端，不用于 LiveKit 语音连接或 Provider key
验证。OpenAI HTTP 的 2 次重试也不是 LiveKit `APIConnectOptions` 的 3 次。

## 2. 实施契约

- `backend/provider_catalog.py` 新增冻结值对象 `LLMClientPolicy` 与
  `LLM_CLIENT_POLICY`。该类仅使用纯标准库，明确标注默认 HTTP timeout 与 connect
  timeout 的语义，并保留 `max_retries`。
- `backend/services/llm_service.py::_get_client()` 读取该策略，显式构造
  `httpx.Timeout(timeout=..., connect=...)` 并传 `max_retries`。未传策略时继续使用
  Catalog 冻结值；合法替代策略可注入以证明真实消费者读取策略。
- `PROVIDER_CONFIG` 的派生结构、键名、插入顺序和既有 monkeypatch 路径不变。未知
  Provider、缺少 key、raw model 传参、错误对象、安全日志与 API 契约均不改。
- Catalog 不导入 httpx、OpenAI SDK、应用 config、环境或凭据，也不把该策略放入 Provider
  metadata、前端生成 JSON、OpenAPI、LiveKit 或 Provider key 验证配置。

## 3. 回归覆盖

- `backend/tests/test_provider_catalog.py` 扩展策略默认值、不可变性与旧 metadata 构造
  兼容断言；纯净隔离子进程导入继续断言未加载 SDK、config 或业务依赖，并新增 httpx
  零导入保护。
- 新 `backend/tests/test_llm_client_policy.py` 直接构造真实 SDK 客户端，断言其默认
  connect/read/write/pool 分量与重试值同冻结策略一致。另一个用例将合法替代策略注入真实
  `_get_client()`，直接断言返回 SDK 的属性随策略变化。
- 真实客户端只使用合成 key 与 loopback 断网 base URL，构造阶段不调用 Provider；每个
  返回客户端都在测试 `finally` 中显式 `await close()`。
- 既有 `_get_client` 成功回归也改为在 `finally` 中关闭客户端。OpenAI Provider metadata
  JSON、OpenAPI schema 与前端类型预期逐字节不变，由主 Agent 在实施停写后执行
  metadata/OpenAPI 检查。

## 4. 未执行与边界

- A83 b/r0 文件实施阶段按授权只写文件，未运行 formatter、lint、类型检查、测试、build、
  安装、数据库、服务或 Git 写操作。
- 后续独立 Review APPROVED；正常 hook 生成单提交
  `fc9b5f6d57fe15ae730b83c5f8b9a50f54a8c56d` 并精确 fast-forward 本地 main。完整
  15 项 main 门禁为 972 Vitest/36 files、18 build-script、61 Fake API、8 类型生成器、
  148 E2E、598 backend/78.14% coverage，以及 OpenAPI/Provider metadata schema、
  Ruff 等相关门禁通过。私有消费变异只在对应 lane 验证，main 未冒认重复。
- 本轮未 push、部署或调用真实 Provider；远端 CI、真实 Provider 与生产链路仍未验证。
- RF-10 的 Provider Registry 整体范围仍包含能力、模型、凭据、验证、超时、重试与错误映射
  的统一，以及真实外部链路验收；本子项显式化普通 LLM HTTP 策略不关闭 RF-10 整项。
