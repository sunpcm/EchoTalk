"""
LLM 服务层：封装大语言模型调用。
使用 OpenAI SDK 兼容接口，支持 SiliconFlow 和 OpenRouter 两个 provider。
"""

import logging

from openai import APIError, AsyncOpenAI

from config import settings
from provider_catalog import LLM_PROVIDER_CATALOG
from services.agent_prompt import SYSTEM_PROMPT as SYSTEM_PROMPT
from services.agent_prompt import build_dynamic_prompt as build_dynamic_prompt

logger = logging.getLogger(__name__)

# Provider 配置：base_url + 对应的 settings 字段名（派生自不可变 catalog，保持变量名、类型与顺序）
PROVIDER_CONFIG = {
    k: {
        "base_url": v.base_url,
        "api_key_field": v.api_key_field,
    }
    for k, v in LLM_PROVIDER_CATALOG.items()
}


def _get_client() -> AsyncOpenAI:
    """根据 DEFAULT_LLM_PROVIDER 创建对应的 AsyncOpenAI 客户端。"""
    provider_name = settings.DEFAULT_LLM_PROVIDER
    provider = PROVIDER_CONFIG.get(provider_name)
    if provider is None:
        raise ValueError(
            f"未知的 LLM provider: '{provider_name}'。"
            f"支持的 provider: {list(PROVIDER_CONFIG.keys())}"
        )

    api_key = getattr(settings, provider["api_key_field"])
    if not api_key:
        raise ValueError(
            f"LLM provider '{provider_name}' 的 API Key 未配置。"
            f"请在 .env 中设置 {provider['api_key_field']}。"
        )

    return AsyncOpenAI(
        api_key=api_key,
        base_url=provider["base_url"],
    )


async def chat_completion(messages: list[dict]) -> str:
    """
    调用 LLM 获取对话回复。

    参数:
        messages: OpenAI Chat Completion 格式的消息列表，
                  如 [{"role": "system", "content": "..."}]

    返回:
        AI 助手的回复文本。

    异常:
        APIError: LLM 服务端错误（网络、鉴权、限流等）。
    """
    client = _get_client()

    provider_name = settings.DEFAULT_LLM_PROVIDER
    logger.info(
        "调用 LLM: provider=%s, messages=%d条",
        provider_name,
        len(messages),
    )

    try:
        response = await client.chat.completions.create(
            model=settings.DEFAULT_LLM_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=256,
        )
    except APIError as exc:
        logger.error(
            "LLM 调用失败: provider=%s, error_type=%s",
            provider_name,
            type(exc).__name__,
        )
        raise

    reply = response.choices[0].message.content or ""
    logger.info(
        "LLM 回复完成: provider=%s, chars=%d",
        provider_name,
        len(reply),
    )
    return reply
