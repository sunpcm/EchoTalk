# RF-03 旧 LLM/dispatch 对外输出安全边界

> 状态：A81 b/r0 已完成文件实施，停在 Review；主 Agent 门禁、实际消费变异与独立评审
> 尚未执行。
> 日期：2026-11-01。
> 基线：`codex/external-output-safety@cbe252492f6997e2bba1f1eac1edcdc576d41c36`。

## 1. 目标与权威边界

本补漏遵循 RF-03“日志、异常、遥测和 API 响应禁止包含用户密钥明文”与统一验收模板
§8.3“日志中没有 Token、API Key、密文或用户文档正文泄露”，并落实 A81 派发单列出的四个
当前应用输出事实。prompt 只作为实施指令；产品或契约冲突仍以 PRD、跨系统契约、实施计划和
代码测试为准。

本轮只处理应用拥有的 LLM 成功/APIError 日志、conversation 502 错误体与 dispatch 异常
日志。未引入通用正则脱敏器、全局 logging filter、日志平台或依赖；未改变 Provider/model
选择、请求参数、重试、timeout、凭据、认证、租约、数据库或公开 HTTP schema/status。

## 2. 已修复输出

### 2.1 LLM 服务日志

`backend/services/llm_service.py` 的成功路径不再记录 provider 返回文本。原先的
`reply[:80]` 改为固定“回复完成”事件，只记录经 `LLM_PROVIDER_CATALOG` 验证的 provider
名称与回复字符数。调用开始事件不再记录任意 `DEFAULT_LLM_MODEL` 文本，只保留 provider 与
messages 数量。

`APIError` 分支不再格式化 SDK 异常对象，只记录固定事件、provider 名称和 Python 异常类型
名，不传 `exc_info`/`stack_info`。服务层继续以 `raise` 抛出同一个 `APIError` 对象，保持
既有异常语义。

### 2.2 Conversation 公开错误

`backend/routers/conversation.py` 的 502 保持既有字符串 detail 形状和
“LLM 服务调用失败”前缀，固定为：

```json
{ "detail": "LLM 服务调用失败: 请稍后重试" }
```

SDK 异常 message、body、request、URL、header 或正文不参与文案拼装。HTTPException 使用
`from None`，避免把已捕获的 SDK 异常继续作为可见上下文输出。

### 2.3 Dispatch 异常日志

`backend/routers/sessions.py` 的 `livekit_cloud` 与 `disabled` 分支均保持固定 502：

```json
{ "detail": "语音服务暂时不可用，请稍后重试" }
```

异常日志只包含固定 mode 与 `type(exc).__name__`。disabled 分支不再直接格式化异常对象，
cloud 分支原安全日志增加固定 mode 分类。两分支都以 `from None` 构造 HTTPException。
成功返回、`dispatched`、归属验证、活动会话拒绝、既有 dispatch 去重、cloud 3 秒超时包装
和 disabled 无 timeout 包装均未改动。

## 3. 回归设计

`backend/tests/test_llm_service.py` 直接消费真实 `chat_completion`，保留成功回复、`None`
到空串、temperature 0.7、max_tokens 256 与原异常对象断言，并扫描日志不含用户消息、回复
正文或 APIError 合成 canary。

新增 `backend/tests/test_external_output_safety.py`，直接消费真实 service 与实际 ASGI
router：

1. conversation 成功与 `None` 回复均返回原产品结果；用户消息、任意 model canary 与回复
   正文不出现在应用日志。
2. 合成 `APIError` 的 message/Authorization/URL/body/document/model canary 不出现在日志
   或固定 502 中；SDK 只调用一次，失败后不保存 assistant transcript。
3. disabled dispatch 成功路径返回 `{"dispatched": true}`，且原无 timeout 包装。
4. disabled dispatch 的 context-manager、list 与 create 异常均返回固定 502，并按发生位置
   断言 list/create 单次调用边界；日志与响应不含合成异常正文、header、URL、body 或文档。
5. cloud dispatch 异常保留 3.0 秒 timeout 调用和固定 502，list 失败后不重复 create。

测试恢复 `get_db` override，所有 Provider、LiveKit 与租约依赖均为本地合成替身，不访问真实
Provider、数据库秘密或网络。

## 4. 验证状态

- 实施方按授权只写文件，未执行 formatter、测试、build、安装、数据库、服务或 Git 写操作。
- 主 Agent 仍需在实施停写后通过固定入口执行完整 frontend10、backend 专用 PostgreSQL、
  schema/metadata 与 Ruff，并执行独立消费变异：恢复任一原不安全格式化必须使回归实际失败，
  随后精确还原源码并复验。
- 只有 Review APPROVED 后才进入正常 hook 单 commit、本地 main 精确 fast-forward 与 main
  全门禁复验；本文件不预判 commit、push、部署或外部验收结果。

## 5. 外部边界

真实 LLM/LiveKit Provider、Linux/Docker 镜像、设备、远端 CI 与部署仍未验证。本轮补漏
不关闭 RF-07、RF-09、RF-12，也不改变 RF-03 历史完成记录的产品范围。
