"""LiveKit Agent 使用的纯 Prompt 构建模块。"""

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
    custom_prompt: str | None = None,
    document_content: str | None = None,
) -> str:
    """
    根据实时情绪和薄弱技能构建动态 System Prompt（三层架构）。

    Phase 3 新增：emotion-aware instructions。
    Phase 7 新增：custom_prompt / document_content 支持文档对话模式。
    Agent 在 on_user_turn_completed 钩子中调用，仅当焦虑模式切换时更新。

    三层架构:
        Layer 1 — 角色与情绪: 基础角色定义 + 情绪模式 + 薄弱技能 + 自定义指令
        Layer 2 — 文档上下文: 用户上传的文档（不受情绪切换影响）
        Layer 3 — 通用指令: 对话风格与语言规范

    参数:
        anxiety_level: 0.0~1.0 的焦虑指数
        weak_skills: BKT 识别的薄弱技能列表（Phase 4 RAG 后扩展）
        custom_prompt: 用户自定义角色指令（doc_chat 模式）
        document_content: 用户上传的文档原文（doc_chat 模式）
    """
    parts: list[str] = [
        "You are a friendly and patient AI English speaking coach.\n",
        "[Role] Help the user practice spoken English through natural conversation.\n",
        "[Error Correction Strategy] Use implicit recasting (Recast): "
        "do NOT directly point out grammar or pronunciation mistakes. "
        "Instead, naturally repeat the correct form in your response.\n",
    ]

    # 情绪指令
    parts.append(
        f"[Emotion Awareness] Current user anxiety index: {anxiety_level:.2f}\n"
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

    # Layer 1 补充: 用户自定义角色指令
    if custom_prompt:
        parts.append(f"[Custom Role Instruction]\n{custom_prompt}\n")

    # Layer 2: 文档上下文（持久层，不受情绪切换影响）
    if document_content:
        parts.append(
            "[Reference Document] 以下文档是本次对话的核心上下文，"
            "请基于此文档进行提问和回应：\n"
            "<document>\n" + document_content + "\n</document>\n"
        )

    # Layer 3: 通用指令
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
