"""
LLM 服务层：封装大语言模型调用。
使用 OpenAI SDK 兼容接口，支持 SiliconFlow 和 OpenRouter 两个 provider。
"""

import logging

from openai import AsyncOpenAI, APIError

from config import settings

logger = logging.getLogger(__name__)

# Provider 配置：base_url + 对应的 settings 字段名
PROVIDER_CONFIG = {
    "siliconflow": {
        "base_url": "https://api.siliconflow.cn/v1",
        "api_key_field": "SILICONFLOW_API_KEY",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_field": "OPENROUTER_API_KEY",
    },
}

# 默认 System Prompt（anxiety_level 未知时使用）
SYSTEM_PROMPT = (
    "You are a friendly and patient AI English speaking coach.\n\n"
    "[Role] Help the user practice spoken English through natural conversation.\n\n"
    "[Error Correction Strategy] Use implicit recasting (Recast): "
    "do NOT directly point out grammar or pronunciation mistakes. "
    "Instead, naturally repeat the correct form in your response.\n\n"
    "[Guidelines]\n"
    "- Keep responses concise (2-4 sentences) to maintain conversational flow\n"
    "- Adjust language complexity to match the user's level\n"
    "- Encourage the user and create a low-anxiety environment\n"
    "- If the user speaks in Chinese, gently guide them back to English\n"
    "- Ask follow-up questions to keep the conversation going"
)


def build_dynamic_prompt(
    anxiety_level: float,
    weak_skills: list[str] | None = None,
) -> str:
    """
    根据实时情绪和薄弱技能构建动态 System Prompt。

    Phase 3 新增：emotion-aware instructions。
    Agent 在 on_user_turn_completed 钩子中调用，仅当焦虑模式切换时更新。

    参数:
        anxiety_level: 0.0~1.0 的焦虑指数
        weak_skills: BKT 识别的薄弱技能列表（Phase 4 RAG 后扩展）
    """
    parts: list[str] = [
        "You are a friendly and patient AI English speaking coach.\n",
        "[Role] Help the user practice spoken English "
        "through natural conversation.\n",
        "[Error Correction Strategy] Use implicit recasting (Recast): "
        "do NOT directly point out grammar or pronunciation mistakes. "
        "Instead, naturally repeat the correct form in your response.\n",
    ]

    # 情绪指令
    parts.append(
        f"[Emotion Awareness] Current user anxiety index: " f"{anxiety_level:.2f}\n"
    )
    if anxiety_level > 0.6:
        parts.append(
            "- The user appears anxious or struggling. "
            "Switch to ENCOURAGEMENT MODE:\n"
            "  * Use simpler vocabulary and shorter sentences\n"
            "  * Give more positive feedback and affirmation\n"
            "  * Avoid complex grammar terminology\n"
            "  * Use recasting gently, do not overwhelm\n"
            "  * Slow down the pace of conversation\n"
        )
    else:
        parts.append(
            "- The user is comfortable. Use normal teaching mode:\n"
            "  * You may introduce moderate challenges\n"
            "  * Use recasting naturally in your responses\n"
        )

    # 薄弱技能（预留 Phase 4 RAG 使用）
    if weak_skills:
        skills_str = ", ".join(weak_skills)
        parts.append(f"[Weak Skills] Focus practice on: {skills_str}\n")

    # 通用指令
    parts.append(
        "[Guidelines]\n"
        "- Keep responses concise (2-4 sentences) "
        "to maintain conversational flow\n"
        "- Adjust language complexity to match the user's level\n"
        "- If the user speaks in Chinese, gently guide them "
        "back to English\n"
        "- Ask follow-up questions to keep the conversation going"
    )

    return "\n".join(parts)


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

    logger.info(
        "调用 LLM: provider=%s, model=%s, messages=%d条",
        settings.DEFAULT_LLM_PROVIDER,
        settings.DEFAULT_LLM_MODEL,
        len(messages),
    )

    try:
        response = await client.chat.completions.create(
            model=settings.DEFAULT_LLM_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=256,
        )
    except APIError as e:
        logger.error("LLM 调用失败: %s", e)
        raise

    reply = response.choices[0].message.content or ""
    logger.info("LLM 回复: %s...", reply[:80])
    return reply
