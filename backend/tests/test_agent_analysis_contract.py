"""Independent golden expectations and actual contract consumer compatibility."""

import ast
import json
import subprocess
import sys
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest
from pydantic import TypeAdapter

import agent_analysis_contract as contract
from schemas.session import AnalysisStatusResponse

BACKEND = Path(__file__).resolve().parents[1]
EXPECTED_MESSAGES = {
    "ERR_CUSTOM_KEY_INVALID": "自定义模式下 API Key 无效或未配置，请在设置页面检查密钥。",
    "ERR_UNSUPPORTED_STT_PROVIDER": "不支持的 STT 提供商配置，请在设置页面选择有效的提供商。",
    "ERR_UNSUPPORTED_LLM_PROVIDER": "不支持的 LLM 提供商配置，请在设置页面选择有效的提供商。",
    "ERR_UNSUPPORTED_TTS_PROVIDER": "不支持的 TTS 提供商配置，请在设置页面选择有效的提供商。",
    "ERR_SYSTEM_CONFIG": "系统配置错误，请稍后重试。",
    "ERR_SESSION_NOT_FOUND": "无法找到您的会话配置，请重新登录后再试。",
    "ERR_CUSTOM_RUNTIME_AUTH": "您的自定义 API Key 认证失败（HTTP 401/403），请检查密钥是否有效。",
    "ERR_CUSTOM_RUNTIME": "自定义 API 服务请求失败，请检查服务配置与网络连接。",
    "ERR_SYSTEM_RUNTIME": "语音管线启动失败，请稍后重试。",
}
EXPECTED_DIAGNOSTIC = (
    "ERR_CUSTOM_KEY_INVALID",
    "ERR_SESSION_NOT_FOUND",
    "ERR_CUSTOM_RUNTIME_AUTH",
    "ERR_CUSTOM_RUNTIME",
    "ERR_SYSTEM_RUNTIME",
)
EXPECTED_ANALYSIS = {
    "analysis_unsupported",
    "no_user_transcript",
    "session_missing",
    "worker_timeout",
    "analysis_failed",
}
EXPECTED_NON_RETRYABLE = {
    "analysis_unsupported",
    "no_user_transcript",
    "session_missing",
}


def test_independent_catalogs_messages_and_policy_only_code():
    assert dict(contract.SAFE_ERROR_MESSAGES) == EXPECTED_MESSAGES
    assert contract.KNOWN_ERROR_CODES == set(EXPECTED_MESSAGES)
    assert contract.DIAGNOSTIC_AGENT_CODES == EXPECTED_DIAGNOSTIC
    assert contract.KNOWN_ANALYSIS_ERROR_CODES == EXPECTED_ANALYSIS
    assert contract.NON_RETRYABLE_ERROR_CODES == EXPECTED_NON_RETRYABLE
    assert {
        code
        for code, policy in contract.ANALYSIS_CODE_POLICIES.items()
        if policy.current_producer
    } == EXPECTED_ANALYSIS - {"analysis_unsupported"}
    assert contract.ANALYSIS_UNKNOWN_LOG_CODE == "unknown_error"
    assert contract.DIAGNOSTIC_UNKNOWN_AGENT_CODE == "unknown"


def test_catalog_is_transitively_immutable():
    with pytest.raises(TypeError):
        contract.SAFE_ERROR_MESSAGES["ERR_SYSTEM_RUNTIME"] = "changed"
    with pytest.raises(TypeError):
        contract.ANALYSIS_CODE_POLICIES["new"] = contract.AnalysisCodePolicy(True, True)
    with pytest.raises(FrozenInstanceError):
        contract.ANALYSIS_CODE_POLICIES["analysis_failed"].manual_retryable = False
    with pytest.raises(AttributeError):
        contract.NON_RETRYABLE_ERROR_CODES.add("new")


@pytest.mark.parametrize("code", sorted(EXPECTED_MESSAGES))
def test_actual_mapper_and_safe_builder_exact_payload(code):
    from livekit_agent.error_mapper import AgentErrorMapper

    safe_code, message = AgentErrorMapper.map_error(code, "SECRET-CANARY")
    assert (safe_code, message) == (code, EXPECTED_MESSAGES[code])
    payload = contract.build_agent_error_payload(safe_code)
    assert list(payload) == ["type", "code", "message"]
    assert payload == {
        "type": "agent_error",
        "code": code,
        "message": EXPECTED_MESSAGES[code],
    }
    assert "SECRET-CANARY" not in json.dumps(payload)


@pytest.mark.parametrize("unknown", [None, {}, [], 4, "FUTURE-CANARY"])
def test_actual_mapper_unknown_and_fallback_preserve_safe_behavior(unknown):
    from livekit_agent.error_mapper import AgentErrorMapper

    assert AgentErrorMapper.map_error(
        unknown, "SECRET", fallback_code="ERR_CUSTOM_RUNTIME"
    ) == ("ERR_CUSTOM_RUNTIME", EXPECTED_MESSAGES["ERR_CUSTOM_RUNTIME"])
    assert AgentErrorMapper.map_error(unknown, "SECRET", fallback_code="INVALID") == (
        "ERR_SYSTEM_RUNTIME",
        EXPECTED_MESSAGES["ERR_SYSTEM_RUNTIME"],
    )


def test_open_analysis_alias_schema_and_real_http_optional_default():
    document = contract.build_contract_document()
    public_schema = document["components"]["schemas"]["AnalysisPublicErrorCode"]
    expected = {"anyOf": [{"type": "string"}, {"type": "null"}]}
    assert (
        public_schema
        == TypeAdapter(contract.AnalysisPublicErrorCode | None).json_schema()
        == expected
    )
    assert contract.AnalysisPublicErrorCode is str
    tracked = json.loads((BACKEND / "openapi.json").read_text())["components"][
        "schemas"
    ]["AnalysisStatusResponse"]
    actual = AnalysisStatusResponse.model_json_schema()
    assert {
        key: value
        for key, value in actual["properties"]["error_code"].items()
        if key not in {"title", "default"}
    } == {
        key: value
        for key, value in tracked["properties"]["error_code"].items()
        if key not in {"title", "default"}
    }
    assert actual["properties"]["error_code"]["anyOf"] == expected["anyOf"]
    assert "error_code" not in actual["required"]
    assert actual["required"] == tracked["required"]
    assert AnalysisStatusResponse.model_fields["error_code"].default is None
    for value in ["future-provider-code", "", "a" * 100, None]:
        model = AnalysisStatusResponse(
            session_id="00000000-0000-4000-8000-000000000001",
            status="failed",
            attempt_count=3,
            retryable=True,
            updated_at="2026-11-15T00:00:00Z",
            error_code=value,
        )
        assert model.model_dump()["error_code"] == value
        assert "last_error" not in model.model_dump()


def test_pure_source_import_in_clean_interpreter_without_config_sdk_or_network(
    tmp_path,
):
    script = f"""
import sys
sys.path.insert(0, {str(BACKEND)!r})
def fence(event, args):
    if event.startswith('socket.'):
        raise AssertionError('network attempted')
    if event == 'open' and isinstance(args[0], str) and args[0].rsplit('/',1)[-1].startswith('.env'):
        raise AssertionError('dotenv read')
sys.addaudithook(fence)
import agent_analysis_contract
for name in sys.modules:
    assert not name.split('.')[0] in {{'config','main','database','livekit','sqlalchemy','dotenv','pydantic_settings'}}, name
print('pure')
"""
    result = subprocess.run(
        [sys.executable, "-I", "-B", "-c", script],
        cwd=tmp_path,
        env={"LANG": "C"},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "pure"


def test_python_callers_do_not_redeclare_contract_literals():
    paths = [
        *(
            BACKEND / "livekit_agent" / f"{name}.py"
            for name in (
                "error_mapper",
                "error_delivery",
                "plugin_factory",
                "credential_resolver",
                "agent",
                "job_orchestrator",
            )
        ),
        BACKEND / "services/analysis_jobs.py",
        BACKEND / "services/analysis_observability.py",
    ]
    known = set(EXPECTED_MESSAGES) | EXPECTED_ANALYSIS
    for path in paths:
        nodes = ast.walk(ast.parse(path.read_text()))
        assert not [
            (node.lineno, node.value)
            for node in nodes
            if isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and node.value in known
        ], path
