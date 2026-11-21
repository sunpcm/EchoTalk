# SGEC API 验收边界与受控 smoke

> 状态：SGEC 默认关闭的离线接线、适配器与合成 PG 测试范围已完成到可评审交付；本地合成
> PG 定向回归 53 项通过，完整门禁见本 PR 验证。真实 SGEC API、真实密钥、真实模型身份、
> 实际费用、教学质量、准确率与人工 gold 仍未执行。
> 本文只列配置、受控验证命令、执行顺序和 NOT_RUN 边界，不包含任何真实密钥、费用结论、
> 准确率结论或“已通过真实外部依赖”的声明。

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
   confidence、重复 skill_tag 与空 `error_type` 门禁。
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
- 真实 API、真实密钥、真实模型身份、实际费用、教学准确率、人工 gold：全部
  `NOT_RUN`。人工 gold 保持 0，现有候选不改。
- PG 测试树：`backend/tests/test_sgec_pipeline.py` 的本地合成 PG 定向回归 53 项已实际通过；
  完整门禁见本 PR 验证。真实 API、教学质量、人工 gold 仍未执行。
