# 真实链路验收脚本与手册

> 状态：本包仅交付离线验收脚本与未来 probe 入口，不实拨、不接真实服务/DB/Docker、不读
> `.env`/凭据。真实执行留待后续单独授权。当前所有 live 证据均为 NOT_RUN。

## 1. 脚本与退出码

实现：`backend/scripts/real_flow_acceptance.py`（共用 `acceptance_common.py`）。
从 `backend/` 目录运行：

```bash
.venv/bin/python -m scripts.real_flow_acceptance <subcommand>
```

子命令：`plan`、`verify`、`probe`、`execute`。退出码固定为：

| 码  | 含义                                                           |
| --- | -------------------------------------------------------------- |
| 0   | `plan`/`verify` 命令成功（只证明 schema/语义，不证明真实性）   |
| 1   | 观察到失败                                                     |
| 2   | 坏输入（坏 JSON/参数/target/UTF-8 等，固定诊断，不回显未知值） |
| 3   | 未运行/不完整/partial                                          |

`plan` 或 `probe` 的 partial 绝不当作端到端 live 通过；HTTP 全绿也只能 exit 3。

## 2. 默认 plan（离线）

`plan` 不读 token、环境秘密、DB 或网络，只输出冻结清单，且每步显式 `status: "not_run"`：

```bash
.venv/bin/python -m scripts.real_flow_acceptance plan
```

清单包含 13 步，覆盖自动 HTTP、人工媒体、服务侧账本与教学质量四类：

| 步骤                     | 类型             | 目标/合同                                                                                                  |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `login_staging`          | manual_media     | 专用测试账号登录（隔离 IdP tenant）                                                                        |
| `health_basic`           | auto_http        | `GET /api/health` → 200 + `{"status":"ok","service":"echo-talk"}`                                          |
| `system_ready`           | auto_http        | `GET /api/health/system-ready` → 200 + `{"status":"ready"}`                                                |
| `ready_auth`             | auto_http        | `GET /api/health/ready`（带认证）→ 200 + `{"status":"ready"}`                                              |
| `ready_unauth`           | auto_http        | `GET /api/health/ready`（无认证）→ 稳定 401/403                                                            |
| `session_create`         | manual_media     | 在应用内创建场景会话                                                                                       |
| `user_speak_agent_reply` | manual_media     | 用户说话、Agent 回复                                                                                       |
| `session_end`            | manual_media     | 结束会话并排队分析                                                                                         |
| `session_read`           | auto_http        | `GET /api/sessions/{session_id}` → 200 + `{"id":<该 UUID>}`                                                |
| `analysis_status`        | auto_http        | `GET /api/sessions/{session_id}/analysis-status` → 200 + `{"session_id":<该 UUID>,"status":"succeeded"}`   |
| `session_goals`          | auto_http        | `GET /api/sessions/{session_id}/goals` → 200 + `{"session_id":<该 UUID>,"configured":true,"goals":[非空]}` |
| `server_ledger`          | server_ledger    | 服务侧 learning-event 账本事实                                                                             |
| `teaching_quality`       | teaching_quality | 人工复核语法/发音/goal 质量                                                                                |

HTTP 步对 session 类端点强制 session-id 关联，并核验实际最小响应 schema：`analysis_status`
必须终态 `status=succeeded`（`failed`/`running`/缺失均判失败）；`session_goals` 必须
`configured=true` 且 `goals` 非空（空对象、`configured=false`、空列表、缺失均判失败）。
任意 JSON 对象或 `body_keys` 存在都不构成响应合同。

## 3. probe（当前唯一可用，fake transport）

`probe` 只用可注入的 `FakeTransport`，绝不发起网络：

```bash
.venv/bin/python -m scripts.real_flow_acceptance probe --target https://example.com
```

用于离线验证 transport 注入与分类路径，返回 exit 3（partial）。

## 4. verify

```bash
.venv/bin/python -m scripts.real_flow_acceptance verify --evidence evidence.json
```

严格校验：`plan_version` 必须是整数 1（拒绝 `True`/`1.0`）、status/source 枚举、required 步骤
完整集合、重复/未知步骤、先完整扫描后再汇总（`observed_fail` 优先于未运行，不因首个
`manual_pending` 提前 return）。`observed_ok` 必须 `source=real` 且带非空 `environment`/`version`。

### 4.1 verify 所需最小 evidence JSON 示例与字段含义

```json
{
  "plan_id": "echotalk-real-flow-acceptance.v1",
  "plan_version": 1,
  "steps": [
    {
      "step_id": "health_basic",
      "status": "observed_ok",
      "source": "real",
      "environment": "staging",
      "version": "v1",
      "http_status": 200,
      "trace_id": null,
      "error_code": null
    }
  ]
}
```

字段含义：

| 字段                    | 含义与约束                                                                      |
| ----------------------- | ------------------------------------------------------------------------------- |
| `plan_id`               | 固定 `echotalk-real-flow-acceptance.v1`，不符 exit 2                            |
| `plan_version`          | 严格整数 `1`，`True`/`1.0` 拒绝（exit 2）                                       |
| `steps`                 | 必须是非空数组，覆盖全部 required 步骤且 step_id 唯一                           |
| `step_id`               | 13 个冻结步骤之一；未知/重复/缺项按坏输入或 incomplete                          |
| `status`                | `not_run`/`observed_ok`/`observed_fail`/`manual_pending`；非法枚举 exit 2       |
| `source`                | `real`/`synthetic`/null；`observed_ok` 必须 `real`                              |
| `environment`,`version` | `observed_ok` 时必须是非空且去空白后非空的字符串，否则 incomplete               |
| `http_status`           | 整数或 null；`observed_ok` 且对应步骤有 `expect_status` 时必须匹配，否则 exit 2 |
| `trace_id`,`error_code` | 字符串或 null；类型错误 exit 2                                                  |

### 4.2 失败/未运行判据与负例矩阵

判据：任一 `observed_fail` 使整体 exit 1；`observed_ok` 带非空 `error_code` 属自相矛盾（exit 2）；
`observed_ok` 的 `http_status` 若已提供必须是整数且匹配该步骤 `expect_status`（否则 exit 2）；
无失败但存在 `not_run`/`manual_pending`/缺项/`source=synthetic` 的 `observed_ok`/缺或空白
`environment`/`version` 使整体 exit 3（incomplete）。

| 负例                                                       | 结果                         |
| ---------------------------------------------------------- | ---------------------------- |
| `plan_version` 为 `1.0` 或 `True`                          | exit 2，固定诊断             |
| `status`/`source` 为数组或对象                             | exit 2，不 Traceback         |
| 重复/未知 step_id                                          | exit 2                       |
| 缺一个 required 步骤                                       | exit 3                       |
| `observed_ok` 但 `source=synthetic`                        | exit 3                       |
| `observed_ok` 但缺或空白 `environment`/`version`           | exit 3                       |
| `observed_ok` 带非空 `error_code`（如 `network_error`）    | exit 2，自相矛盾             |
| `observed_ok` 的 `http_status` 为 `True`/`"200"`（非 int） | exit 2                       |
| `health_basic` 的 `observed_ok` 给 `http_status=503`       | exit 2，不在 `expect_status` |
| `ready_unauth` 的 `observed_ok` 给 `http_status=401`/`403` | exit 0（保留负控）           |
| 某步 `observed_fail`（其余 `manual_pending`）              | exit 1，失败不被隐藏         |
| `analysis_status` body 为 `status=failed`/`running`/缺失   | `observed_fail`              |
| `session_goals` body 为 `configured=false`/`goals=[]`/缺失 | `observed_fail`              |
| 未授权 ready 返回 200（而非 401/403）                      | `observed_fail`              |

## 5. execute（未来，需显式授权）

`execute` 是唯一真实 GET 入口，但本轮绝不启用：

```bash
ECHOTALK_ACCEPTANCE_BEARER_TOKEN=... \
.venv/bin/python -m scripts.real_flow_acceptance execute \
  --target https://staging.example.com --account <专用测试账号> --session-id <uuid>
```

- 必须显式给 `--target`、`--account`、`--session-id`；`--session-id` 必须是合法 UUID。
- token 只从固定环境变量 `ECHOTALK_ACCEPTANCE_BEARER_TOKEN` 读取，禁止命令行 token。
- target 必须 HTTPS、无 userinfo/query/fragment；拒绝 redirect；超时/响应大小有界；只 GET。
- 输出只含白名单事实（HTTP 状态、契约判定、错误码），不回显正文/headers/secret/未知参数。
- 未授权 ready 的 401 负控必须不带 Bearer；带认证检查与它分开。
- HTTP 全绿仍 partial（exit 3），不能证明 OIDC 登录、媒体、账本或教学质量。

token 只通过受保护环境变量注入（`ECHOTALK_ACCEPTANCE_BEARER_TOKEN`）；本文与命令示例
只写环境变量名，不写任何裸 token 值或历史明文，也不把 token 放入命令行参数。

## 6. 真实语音验收前置（recording 已核，只文档、不改 runtime）

已核：`backend/livekit_agent/job_orchestrator.py:414` 为
`agent_session.start(agent, room=self.ctx.room)`，未传 `record`；本 lane 已安装 livekit-agents
`1.6.10` 的 `voice/agent_session.py:889-895` 在 `record=NOT_GIVEN` 时采用
`job_ctx.job.enable_recording`；`job.py:248` 也按 `enable_recording` 决定日志缓冲上传。

因此**不能写「没有指定 record 所以默认不录音/不上传」**。真实语音验收前置必须核对服务端
recording、报告上传与保留配置；未知即 NOT_RUN/待确认。新音频切片/采集/保留政策不在本轮批准范围。

## 7. 未来真实操作与证据矩阵

真实执行顺序：专用账号登录 → 用户说话 → Agent 回复 → 结束会话 → Job → 反馈。证据区分四类：

- 自动 HTTP：由脚本 `execute` 记录白名单事实。
- 人工媒体：录音/回放/进房证据，人工核对。
- 服务侧账本：learning-events 成功批次、七键 coverage、BKT 更新。
- 教学质量：人工审定，非脚本结论。

当前 live 全部 NOT_RUN。配置就绪不证明 Provider 可用；Bearer 成功不证明 OIDC 登录；Job
succeeded 不证明真实模型/媒体。

## 8. 边界

脚本只报告证据结构与一致性核验，不冒充真实性或教学质量认证。GET 不等于数据库无副作用。
默认 plan、verify 在输入校验失败前不读 token、不联网。
