"""纯标准库不可变 Provider Catalog（静态元数据单一来源）。"""

from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal, Mapping

ProviderRole = Literal["stt", "llm", "tts"]


@dataclass(frozen=True)
class LLMProviderMetadata:
    """不可变 LLM Provider 静态配置元数据。"""

    id: str
    base_url: str
    api_key_field: str
    validation_url: str
    role: ProviderRole = "llm"
    label: str = ""
    is_default: bool = False


@dataclass(frozen=True)
class STTProviderMetadata:
    """不可变 STT Provider 静态配置元数据。"""

    id: str
    api_key_field: str
    validation_url: str
    auth_header_name: str = "Authorization"
    auth_header_prefix: str = "Token "
    static_headers: Mapping[str, str] = MappingProxyType({})
    role: ProviderRole = "stt"
    label: str = ""
    is_default: bool = False

    def build_validation_headers(self, api_key: str) -> dict[str, str]:
        """生成单次校验所需的独立 Headers，不修改内部状态也不持久化凭据。"""
        headers = dict(self.static_headers)
        headers[self.auth_header_name] = f"{self.auth_header_prefix}{api_key}"
        return headers


@dataclass(frozen=True)
class TTSProviderMetadata:
    """不可变 TTS Provider 静态配置元数据。"""

    id: str
    api_key_field: str
    validation_url: str
    auth_header_name: str = "X-API-Key"
    auth_header_prefix: str = ""
    static_headers: Mapping[str, str] = MappingProxyType(
        {"Cartesia-Version": "2024-06-10"}
    )
    role: ProviderRole = "tts"
    label: str = ""
    is_default: bool = False

    def build_validation_headers(self, api_key: str) -> dict[str, str]:
        """生成单次校验所需的独立 Headers，不修改内部状态也不持久化凭据。"""
        headers = dict(self.static_headers)
        headers[self.auth_header_name] = f"{self.auth_header_prefix}{api_key}"
        return headers


_LLM_PROVIDERS: dict[str, LLMProviderMetadata] = {
    "siliconflow": LLMProviderMetadata(
        id="siliconflow",
        base_url="https://api.siliconflow.cn/v1",
        api_key_field="SILICONFLOW_API_KEY",
        validation_url="https://api.siliconflow.cn/v1/user/info",
        label="SiliconFlow",
        is_default=True,
    ),
    "openrouter": LLMProviderMetadata(
        id="openrouter",
        base_url="https://openrouter.ai/api/v1",
        api_key_field="OPENROUTER_API_KEY",
        validation_url="https://openrouter.ai/api/v1/auth/key",
        label="OpenRouter",
    ),
}

_STT_PROVIDERS: dict[str, STTProviderMetadata] = {
    "deepgram": STTProviderMetadata(
        id="deepgram",
        api_key_field="DEEPGRAM_API_KEY",
        validation_url="https://api.deepgram.com/v1/projects",
        auth_header_name="Authorization",
        auth_header_prefix="Token ",
        static_headers=MappingProxyType({}),
        label="Deepgram",
        is_default=True,
    ),
}

_TTS_PROVIDERS: dict[str, TTSProviderMetadata] = {
    "cartesia": TTSProviderMetadata(
        id="cartesia",
        api_key_field="CARTESIA_API_KEY",
        validation_url="https://api.cartesia.ai/voices",
        auth_header_name="X-API-Key",
        auth_header_prefix="",
        static_headers=MappingProxyType({"Cartesia-Version": "2024-06-10"}),
        label="Cartesia",
        is_default=True,
    ),
}

# 导出不可变映射：同时保护 mapping 与 entry 不可篡改
LLM_PROVIDER_CATALOG: Mapping[str, LLMProviderMetadata] = MappingProxyType(
    _LLM_PROVIDERS
)
STT_PROVIDER_CATALOG: Mapping[str, STTProviderMetadata] = MappingProxyType(
    _STT_PROVIDERS
)
TTS_PROVIDER_CATALOG: Mapping[str, TTSProviderMetadata] = MappingProxyType(
    _TTS_PROVIDERS
)
PROVIDER_CATALOGS: Mapping[
    ProviderRole,
    Mapping[
        str,
        LLMProviderMetadata | STTProviderMetadata | TTSProviderMetadata,
    ],
] = MappingProxyType(
    {
        "stt": STT_PROVIDER_CATALOG,
        "llm": LLM_PROVIDER_CATALOG,
        "tts": TTS_PROVIDER_CATALOG,
    }
)


def get_llm_provider(provider_id: str) -> LLMProviderMetadata | None:
    """获取指定 LLM Provider 元数据，未知 provider 返回 None。"""
    return LLM_PROVIDER_CATALOG.get(provider_id)


def get_stt_provider(provider_id: str) -> STTProviderMetadata | None:
    """获取指定 STT Provider 元数据，未知 provider 返回 None。"""
    return STT_PROVIDER_CATALOG.get(provider_id)


def get_tts_provider(provider_id: str) -> TTSProviderMetadata | None:
    """获取指定 TTS Provider 元数据，未知 provider 返回 None。"""
    return TTS_PROVIDER_CATALOG.get(provider_id)
