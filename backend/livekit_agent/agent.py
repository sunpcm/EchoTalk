"""
EchoTalk LiveKit 语音管线代理。
独立进程运行，使用 LiveKit Agents 框架处理实时语音对话。

Phase 3 新增：情绪感知——基于 STT 文本的犹豫词检测与语速追踪，
动态调整 LLM System Prompt（鼓励模式 / 正常教学模式）。

启动方式:
    cd backend && python livekit_agent/agent.py dev
"""

import asyncio
import logging
import sys
import time
from pathlib import Path

# 确保 backend/ 在 sys.path 中，以复用 config / database / services
_backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_backend_dir))

# 将项目根 .env 加载为环境变量，供 LiveKit SDK 读取 LIVEKIT_URL 等配置
from dotenv import load_dotenv  # noqa: E402

load_dotenv(_backend_dir.parent / ".env", override=False)

from livekit.agents import (  # noqa: E402
    Agent,
    AgentSession,
    AutoSubscribe,
    ConversationItemAddedEvent,
    JobContext,
    WorkerOptions,
    cli,
    llm,
)
from livekit.plugins import cartesia, deepgram, silero  # noqa: E402
from livekit.plugins import openai as lk_openai  # noqa: E402

from config import settings  # noqa: E402
from services.emotion_analyzer import EmotionAnalyzer  # noqa: E402
from services.llm_service import (  # noqa: E402
    PROVIDER_CONFIG,
    SYSTEM_PROMPT,
    build_dynamic_prompt,
)
from services.transcript_service import save_transcript  # noqa: E402

logger = logging.getLogger("echotalk-agent")


def _build_llm() -> lk_openai.LLM:
    """构建 LLM 实例，复用 llm_service.py 中的 provider 配置。"""
    provider_name = settings.DEFAULT_LLM_PROVIDER
    provider = PROVIDER_CONFIG.get(provider_name)
    if provider is None:
        raise ValueError(
            f"未知的 LLM provider: '{provider_name}'。"
            f"支持: {list(PROVIDER_CONFIG.keys())}"
        )

    api_key = getattr(settings, provider["api_key_field"])
    if not api_key:
        raise ValueError(f"LLM provider '{provider_name}' 的 API Key 未配置。")

    return lk_openai.LLM(
        model=settings.DEFAULT_LLM_MODEL,
        base_url=provider["base_url"],
        api_key=api_key,
        temperature=0.7,
    )


class EchoTalkAgent(Agent):
    """
    情绪感知口语教练 Agent。

    继承 LiveKit Agent，重写 on_user_turn_completed 钩子：
    1. 对用户发言做文本情绪分析（犹豫词 + 语速），<0.1ms 纯 CPU 计算
    2. 焦虑模式切换时动态更新 System Prompt
    3. 将带 emotion_state 的转录异步写入数据库
    """

    def __init__(self, session_id: str, **kwargs):
        super().__init__(**kwargs)
        self._session_id = session_id
        self._emotion_analyzer = EmotionAnalyzer()
        self._current_mode = "normal"  # "normal" | "encouragement"

    async def on_user_turn_completed(
        self,
        turn_ctx: llm.ChatContext,
        new_message: llm.ChatMessage,
    ) -> None:
        """
        用户说完话、LLM 推理前的钩子。

        在此执行情绪分析并按需切换 Prompt 模式。
        文本分析耗时 <0.1ms，不阻塞事件循环。
        """
        text = new_message.text_content
        if not text:
            return

        # 1. 纯文本情绪分析
        emotion = self._emotion_analyzer.record_utterance(text, time.time())
        logger.info(
            "情绪分析: anxiety=%.2f, load=%s, hesitation=%.1f/min, wpm=%.0f",
            emotion.anxiety_level,
            emotion.cognitive_load,
            emotion.hesitation_rate,
            emotion.wpm,
        )

        # 2. 仅在模式切换时更新 instructions（避免上下文膨胀）
        new_mode = "encouragement" if emotion.anxiety_level > 0.6 else "normal"
        if new_mode != self._current_mode:
            logger.info("教学模式切换: %s → %s", self._current_mode, new_mode)
            self._current_mode = new_mode
            await self.update_instructions(build_dynamic_prompt(emotion.anxiety_level))

        # 3. 异步持久化用户转录 + 情绪状态（不阻塞 LLM 推理）
        asyncio.ensure_future(
            save_transcript(
                self._session_id,
                "user",
                text,
                emotion_state=emotion.to_dict(),
            )
        )


async def entrypoint(ctx: JobContext):
    """LiveKit Agent 入口：等待参与者 -> 启动语音管线。"""
    logger.info(
        "Agent 收到任务，房间: %s，连接地址: %s",
        ctx.room.name,
        ctx._info.url,
    )

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Agent 已连接到房间: %s", ctx.room.name)

    participant = await ctx.wait_for_participant()
    logger.info("参与者加入: %s", participant.identity)

    # 房间名即为 session_id（Token 端点使用 str(session.id) 作为房间名）
    session_id = ctx.room.name

    # 创建情绪感知 Agent（包含 System Prompt 和各插件配置）
    agent = EchoTalkAgent(
        session_id=session_id,
        instructions=SYSTEM_PROMPT,
        stt=deepgram.STT(api_key=settings.DEEPGRAM_API_KEY),
        llm=_build_llm(),
        tts=cartesia.TTS(api_key=settings.CARTESIA_API_KEY),
        vad=silero.VAD.load(),
    )

    # 创建会话并注册转录回写钩子
    agent_session = AgentSession()

    @agent_session.on("conversation_item_added")
    def on_conversation_item(event: ConversationItemAddedEvent):
        """
        AI 回复的转录回写。

        用户发言的转录已在 on_user_turn_completed 中处理（附带 emotion_state），
        此处仅负责 assistant 消息的持久化。
        """
        item = event.item
        if item.role == "assistant":
            text = item.text_content
            if text:
                asyncio.ensure_future(save_transcript(session_id, "assistant", text))

    # 启动语音管线
    await agent_session.start(agent, room=ctx.room)
    logger.info("语音管线已启动，session_id=%s", session_id)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            num_idle_processes=1,  # 预热一个进程，减少首次任务启动延迟
        ),
    )
