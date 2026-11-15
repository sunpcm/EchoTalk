"""Single authored contract source. No settings, SDK, DB, dotenv or network imports."""

from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

CONTRACT_VERSION = 1
AgentErrorType = Literal["agent_error"]
AGENT_ERROR_TOPIC = get_args(AgentErrorType)[0]
AGENT_ERROR_RELIABLE = True
DIAGNOSTIC_UNKNOWN_AGENT_CODE = "unknown"
ANALYSIS_UNKNOWN_LOG_CODE = "unknown_error"
# Ordinary aliases preserve HTTP schema/typed exception openness (no PEP 695 defs).
AnalysisPublicErrorCode = str


class KnownAgentErrorCode(StrEnum):
    CUSTOM_KEY_INVALID = "ERR_CUSTOM_KEY_INVALID"
    UNSUPPORTED_STT_PROVIDER = "ERR_UNSUPPORTED_STT_PROVIDER"
    UNSUPPORTED_LLM_PROVIDER = "ERR_UNSUPPORTED_LLM_PROVIDER"
    UNSUPPORTED_TTS_PROVIDER = "ERR_UNSUPPORTED_TTS_PROVIDER"
    SYSTEM_CONFIG = "ERR_SYSTEM_CONFIG"
    SESSION_NOT_FOUND = "ERR_SESSION_NOT_FOUND"
    CUSTOM_RUNTIME_AUTH = "ERR_CUSTOM_RUNTIME_AUTH"
    CUSTOM_RUNTIME = "ERR_CUSTOM_RUNTIME"
    SYSTEM_RUNTIME = "ERR_SYSTEM_RUNTIME"


SAFE_ERROR_MESSAGES = MappingProxyType(
    {
        KnownAgentErrorCode.CUSTOM_KEY_INVALID.value: "自定义模式下 API Key 无效或未配置，请在设置页面检查密钥。",
        KnownAgentErrorCode.UNSUPPORTED_STT_PROVIDER.value: "不支持的 STT 提供商配置，请在设置页面选择有效的提供商。",
        KnownAgentErrorCode.UNSUPPORTED_LLM_PROVIDER.value: "不支持的 LLM 提供商配置，请在设置页面选择有效的提供商。",
        KnownAgentErrorCode.UNSUPPORTED_TTS_PROVIDER.value: "不支持的 TTS 提供商配置，请在设置页面选择有效的提供商。",
        KnownAgentErrorCode.SYSTEM_CONFIG.value: "系统配置错误，请稍后重试。",
        KnownAgentErrorCode.SESSION_NOT_FOUND.value: "无法找到您的会话配置，请重新登录后再试。",
        KnownAgentErrorCode.CUSTOM_RUNTIME_AUTH.value: "您的自定义 API Key 认证失败（HTTP 401/403），请检查密钥是否有效。",
        KnownAgentErrorCode.CUSTOM_RUNTIME.value: "自定义 API 服务请求失败，请检查服务配置与网络连接。",
        KnownAgentErrorCode.SYSTEM_RUNTIME.value: "语音管线启动失败，请稍后重试。",
    }
)
KNOWN_ERROR_CODES = frozenset(SAFE_ERROR_MESSAGES)
DIAGNOSTIC_AGENT_CODES = (
    KnownAgentErrorCode.CUSTOM_KEY_INVALID.value,
    KnownAgentErrorCode.SESSION_NOT_FOUND.value,
    KnownAgentErrorCode.CUSTOM_RUNTIME_AUTH.value,
    KnownAgentErrorCode.CUSTOM_RUNTIME.value,
    KnownAgentErrorCode.SYSTEM_RUNTIME.value,
)


class KnownAnalysisErrorCode(StrEnum):
    ANALYSIS_UNSUPPORTED = "analysis_unsupported"
    NO_USER_TRANSCRIPT = "no_user_transcript"
    SESSION_MISSING = "session_missing"
    WORKER_TIMEOUT = "worker_timeout"
    ANALYSIS_FAILED = "analysis_failed"


@dataclass(frozen=True)
class AnalysisCodePolicy:
    current_producer: bool
    manual_retryable: bool


ANALYSIS_CODE_POLICIES = MappingProxyType(
    {
        KnownAnalysisErrorCode.ANALYSIS_UNSUPPORTED.value: AnalysisCodePolicy(
            False, False
        ),
        KnownAnalysisErrorCode.NO_USER_TRANSCRIPT.value: AnalysisCodePolicy(
            True, False
        ),
        KnownAnalysisErrorCode.SESSION_MISSING.value: AnalysisCodePolicy(True, False),
        KnownAnalysisErrorCode.WORKER_TIMEOUT.value: AnalysisCodePolicy(True, True),
        KnownAnalysisErrorCode.ANALYSIS_FAILED.value: AnalysisCodePolicy(True, True),
    }
)
KNOWN_ANALYSIS_ERROR_CODES = frozenset(ANALYSIS_CODE_POLICIES)
NON_RETRYABLE_ERROR_CODES = frozenset(
    code
    for code, policy in ANALYSIS_CODE_POLICIES.items()
    if not policy.manual_retryable
)


class AgentErrorReceived(BaseModel):
    """Shape only; ECMAScript trim/nonblank and own-field checks remain in TS."""

    model_config = ConfigDict(extra="allow", strict=True, frozen=True)
    type: AgentErrorType
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)


class AgentErrorProduced(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    type: AgentErrorType
    code: KnownAgentErrorCode
    message: str


def map_agent_error(code: object, *, fallback_code: str) -> tuple[str, str]:
    """Keep the existing two-level fallback; never use external message text."""
    fallback = (
        fallback_code
        if fallback_code in KNOWN_ERROR_CODES
        else KnownAgentErrorCode.SYSTEM_RUNTIME.value
    )
    safe_code = (
        code if isinstance(code, str) and code in KNOWN_ERROR_CODES else fallback
    )
    return safe_code, SAFE_ERROR_MESSAGES[safe_code]


def build_agent_error_payload(code: str) -> dict[str, object]:
    """Called only after safe mapping; all public fields are locally constructed."""
    return AgentErrorProduced(
        type=AGENT_ERROR_TOPIC,
        code=KnownAgentErrorCode(code),
        message=SAFE_ERROR_MESSAGES[code],
    ).model_dump(mode="json")


def build_contract_document() -> dict[str, object]:
    """Fresh machine projection; caller owns offline isolation and validation."""
    schemas = {}
    for model in (AgentErrorReceived, AgentErrorProduced):
        schema = model.model_json_schema(ref_template="#/components/schemas/{model}")
        for name, definition in schema.pop("$defs", {}).items():
            if name in schemas and schemas[name] != definition:
                raise ValueError("Conflicting contract component")
            schemas[name] = definition
        schemas[model.__name__] = schema
    schemas["KnownAnalysisErrorCode"] = TypeAdapter(
        KnownAnalysisErrorCode
    ).json_schema()
    schemas["DiagnosticAgentErrorCode"] = {
        "type": "string",
        "enum": list(DIAGNOSTIC_AGENT_CODES),
    }
    schemas["AnalysisPublicErrorCode"] = TypeAdapter(
        AnalysisPublicErrorCode | None
    ).json_schema()
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "EchoTalk non-HTTP Agent and analysis contracts",
            "version": str(CONTRACT_VERSION),
        },
        "paths": {},
        "components": {"schemas": schemas},
        "x-echotalk-contract": {
            "schema_version": CONTRACT_VERSION,
            "topic": AGENT_ERROR_TOPIC,
            "reliable": AGENT_ERROR_RELIABLE,
            "receiver_string_policy": "ecmascript-trim-nonempty-preserve",
            "diagnostic_unknown_agent_code": DIAGNOSTIC_UNKNOWN_AGENT_CODE,
            "analysis_unknown_log_code": ANALYSIS_UNKNOWN_LOG_CODE,
            "agent_safe_messages": dict(SAFE_ERROR_MESSAGES),
            "diagnostic_agent_codes": list(DIAGNOSTIC_AGENT_CODES),
            "analysis_non_retryable_codes": sorted(NON_RETRYABLE_ERROR_CODES),
            "analysis_codes": {
                code.name: {
                    "code": code.value,
                    "current_producer": ANALYSIS_CODE_POLICIES[
                        code.value
                    ].current_producer,
                    "manual_retryable": ANALYSIS_CODE_POLICIES[
                        code.value
                    ].manual_retryable,
                }
                for code in KnownAnalysisErrorCode
            },
        },
    }
