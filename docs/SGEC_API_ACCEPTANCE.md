# SGEC API 验收边界与受控 smoke

> 本文只列 SGEC 默认关闭时的配置键、受控验证命令、执行顺序与 NOT_RUN 边界，不包含任何
> 真实密钥、费用结论、准确率结论或“已通过真实外部依赖”的声明。
> SGEC 接线与合成 PG 的当前进度、是否合入、真实 API 与人工 gold 评估的当前状态统一见根目录
> [TODO 总账](../TODO.md)，不在本文维护第二份进度。

## 1. 默认行为与配置键

SGEC 语法 Provider 开关默认 false，运行仍使用既有 `DemoRuleGrammarProvider`；默认路径
不选择 SGEC、不发 SGEC 请求，不会因为缺少配置、启动应用或导入模块而发起网络请求。

配置键均位于后端环境配置，沿用 `Settings` 的 `.env` 字段名：

- `SGEC_GRAMMAR_PROVIDER_ENABLED=false`
- `SGEC_LLM_BASE_URL=""`
- `SGEC_LLM_API_KEY=""`
- `SGEC_LLM_MODEL=""`
- `SGEC_LLM_MODEL_VERSION=""`
- `SGEC_LLM_TIMEOUT_SECONDS=30.0`
- `SGEC_LLM_MAX_TOKENS=1024`
- `SGEC_LLM_MAX_OUTPUT_CHARS=65536`

开启时必须显式提供 `SGEC_LLM_BASE_URL`、`SGEC_LLM_API_KEY`、`SGEC_LLM_MODEL` 和
`SGEC_LLM_MODEL_VERSION`；缺失时 fail closed；默认路径不选择 SGEC、不发 SGEC 请求，不在 import 或
构造阶段发请求。真实身份事实来自受信配置，不从模型响应中回读。

## 2. 纯模型 smoke 完整命令

以下命令只在显式执行时读取环境变量并发起一次受控请求。API key 用 `read -s` 导入当前
shell 环境，不写入命令、历史或仓库文件。命令走完整受信链路：

1. `SGECLLMPayloadSource` 配置显式 model、base_url、api_key 与 `SGEC_LLM_MODEL_VERSION`；
2. 响应必须严格 JSON 解析为对象且只含 `errors` 数组；
3. 结果必须再经 `SGECGrammarProvider` 与 `build_grammar_evaluation` 严格适配；
4. 成功输出 `SMOKE_OK finding_count=<n>`，失败只输出稳定错误码，不回显 key、原文或未知字段。

```bash
cd backend
printf '%s\n' '请通过受控配置设置以下变量，不要把 key 写入本命令。'
printf '%s' 'SGEC_LLM_BASE_URL=<你的 https base_url> SGEC_LLM_MODEL=<你的 model> '
printf '%s\n' 'SGEC_LLM_MODEL_VERSION=<你的受信 model_version>'
read -r -s -p 'SGEC_LLM_API_KEY: ' SGEC_LLM_API_KEY
export SGEC_LLM_API_KEY
export SGEC_LLM_BASE_URL='<你的 https base_url>'
export SGEC_LLM_MODEL='<你的 model>'
export SGEC_LLM_MODEL_VERSION='<你的受信 model_version>'
.venv/bin/python - <<'PY'
import asyncio
import os

from services.assessment_providers import AssessmentMetadata, TranscriptAssessmentInput
from services.sgec_llm import SGECLLMError, SGECLLMPayloadSource
from services.sgec_provider import SGECGrammarProvider


async def main():
    metadata = AssessmentMetadata(
        source="sgec",
        provider="sgec-llm",
        model_version=os.environ["SGEC_LLM_MODEL_VERSION"],
        is_synthetic=False,
        confidence=None,
    )
    allowed_skill_tags = frozenset(
        skill["id"]
        for skill in __import__("models.knowledge", fromlist=["SEED_SKILLS"]).SEED_SKILLS
        if skill["category"] == "grammar"
    )
    source = SGECLLMPayloadSource(
        model=os.environ["SGEC_LLM_MODEL"],
        allowed_skill_tags=allowed_skill_tags,
        base_url=os.environ["SGEC_LLM_BASE_URL"],
        api_key=os.environ["SGEC_LLM_API_KEY"],
        timeout_seconds=30.0,
        max_tokens=1024,
        max_output_chars=65536,
    )
    provider = SGECGrammarProvider(metadata, allowed_skill_tags, source)
    try:
        evaluation = await provider.evaluate(TranscriptAssessmentInput("I go yesterday"))
    except Exception as exc:
        code = getattr(exc, "code", type(exc).__name__)
        print("SMOKE_FAIL", code)
        return 1
    finally:
        await provider.close()

    if set(evaluation.metadata.__dict__) != {
        "source",
        "provider",
        "model_version",
        "is_synthetic",
        "confidence",
    }:
        print("SMOKE_FAIL", "unexpected_metadata")
        return 1
    print("SMOKE_OK", "finding_count=" + str(len(evaluation.findings)))
    return 0


raise SystemExit(asyncio.run(main()))
PY
```

命令只输出 `SMOKE_OK finding_count=<n>` 或 `SMOKE_FAIL <stable_code>`，不回显 key、完整响应
正文、模型返回的业务文本或未知字段。真实结果仍需按下一节顺序进入真实 API 隔离验证与人工
gold 验收；结构通过不等于教学质量通过。

## 3. 隔离环境联调顺序

1. 在专用测试库配置 `DATABASE_URL`，仅允许
   `postgresql+asyncpg://echotalk_b2_main_test@127.0.0.1:55446/echotalk_b2_main_test`
   或 CI `postgresql+asyncpg://echotalk@localhost:5432/echotalk_test`，
   `server_version_num=150019`，Alembic head 为 `b2_ledger_hardening`。
2. 保持 `SGEC_GRAMMAR_PROVIDER_ENABLED=false`，运行既有离线/纯测试确认默认路径无回归。
3. 运行上述纯模型 smoke，确认 OpenAI-compatible 响应被严格 JSON 解析为对象且只含 `errors`
   数组，并通过 `SGECGrammarProvider`/`build_grammar_evaluation` 的标签、字段类型、
   confidence、重复 skill_tag、空 `error_type` 与最多 50 字符的 `error_type` 门禁。
   语法 smoke 的 `allowed_skill_tags` 只取 `category == "grammar"` 的种子技能，发音技能不得
   进入语法 Provider 或其 prompt。
4. 再执行主控的 PG 测试树 `backend/tests/test_sgec_pipeline.py`，确认
   `process_job`、B2 事件、`knowledge_states`、replay、导出与删除在专用库通过。
5. 最后再做真实 API 的人工 gold 与外部验收，不把合成通过或结构通过当作真实质量通过。

## 4. 预期与 NOT_RUN 边界

- 默认关闭路径：预期保持既有 DemoRule 行为，不选择 SGEC、不发 SGEC 请求。
- 合成 mapped real：预期写入 `analysis_completed` + `grammar_observation`，并按冻结
  `bkt-v1` 更新 `knowledge_states`。
- 合成 unmapped：预期写入 `analysis_completed`，`details.unmapped.grammar` 为 1，
  不写语法观察或知识状态。
- 合成 `is_synthetic=True`：预期写事件但不读/建/改 `knowledge_states`。
- 真实 API、真实密钥、真实模型身份、实际费用、教学准确率、人工 gold 的当前状态见根目录
  [TODO 总账](../TODO.md)；本文只定义验收命令与预期，不维护进度。
- PG 测试树：`backend/tests/test_sgec_pipeline.py` 定义专用库合成集成用例；其通过计数与
  合入状态见根目录 [TODO 总账](../TODO.md)，本文不单独维护进度。

## 5. SGEC API 脱敏只读前检

`backend/scripts/siliconflow_preflight.py` 用于真实验收前的显式只读核验。默认 `plan`
完全离线，不读取环境变量、应用配置、数据库或网络；只有 `execute` 才读取固定
`SILICONFLOW_API_KEY`，并分别执行一次以下固定 HTTPS GET：

- `https://api.siliconflow.cn/v1/models?sub_type=chat`
- `https://api.siliconflow.cn/v1/user/info`

```bash
cd backend
.venv/bin/python -m scripts.siliconflow_preflight plan
op run --environment '<Environment ID>' -- \
  .venv/bin/python -m scripts.siliconflow_preflight execute \
  --model 'Qwen/Qwen3-30B-A3B-Instruct-2507'
```

`plan` 不读取凭据，可独立先行执行。受控 `execute` 示例只展示占位 Environment ID；实际运行时由
`op run` 将 Environment 中已有的 `SILICONFLOW_API_KEY` 注入子进程，不在命令、聊天、历史或仓库中
展示或粘贴 Key。

`--model` 只用于本地目录匹配，不会追加到请求 URL；默认模型为
`Qwen/Qwen3-30B-A3B-Instruct-2507`。两次请求均禁止重定向、不重试、单次 8 秒有界超时、
响应最多 2 MiB，并保留 Python 标准库默认的 HTTPS 证书校验。

退出码固定为：

- `0`：目录为 `200`，根 `object` 为官方 schema 的 `list`，`data` 数组中的字符串 `id`
  可验证，选定模型真实列出，且旧 `/v1/user/info` 门禁精确返回 `200`；
- `1`：前检已执行但目录/网络/模型/旧门禁任一核验失败；
- `2`：命令参数、Key 缺失或 Key 格式不合格；此时不创建 transport、不发请求。

Key 必须是非空的可打印 ASCII 值；`op://` 引用、未解析的 `{{...}}` 模板、控制字符和非 ASCII
值均按用法错误处理且不发请求。输出只包含固定检查 ID、公开模型名、目录状态码/固定错误类别/schema/数量/模型列出状态、
旧门禁状态及固定限制说明。目录非 `200`、响应格式不可验证或网络错误时，
`selected_model_listed` 为 `null` 且 `permission` 为 `NOT_VERIFIED`，不会把异常伪装成模型
未列出。`/v1/user/info` 返回 `410` 时明确输出 `LEGACY_GONE` 并使前检失败。

本命令不输出或保存请求 header、原始响应正文、Key、上游错误正文或异常正文；它不调用收费推理，
也不能证明余额、计费状态、实际推理能力或教学质量。
