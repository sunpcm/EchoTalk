"""纯标准库不可变 LLM Provider Catalog（静态元数据单一来源）。"""

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping


@dataclass(frozen=True)
class LLMProviderMetadata:
    """不可变 LLM Provider 静态配置元数据。"""

    id: str
    base_url: str
    api_key_field: str
    validation_url: str


_LLM_PROVIDERS: dict[str, LLMProviderMetadata] = {
    "siliconflow": LLMProviderMetadata(
        id="siliconflow",
        base_url="https://api.siliconflow.cn/v1",
        api_key_field="SILICONFLOW_API_KEY",
        validation_url="https://api.siliconflow.cn/v1/user/info",
    ),
    "openrouter": LLMProviderMetadata(
        id="openrouter",
        base_url="https://openrouter.ai/api/v1",
        api_key_field="OPENROUTER_API_KEY",
        validation_url="https://openrouter.ai/api/v1/auth/key",
    ),
}

# 导出不可变映射：同时保护 mapping 与 entry 不可篡改
LLM_PROVIDER_CATALOG: Mapping[str, LLMProviderMetadata] = MappingProxyType(
    _LLM_PROVIDERS
)


def get_llm_provider(provider_id: str) -> LLMProviderMetadata | None:
    """获取指定 LLM Provider 元数据，未知 provider 返回 None。"""
    return LLM_PROVIDER_CATALOG.get(provider_id)
