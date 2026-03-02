"""
EchoTalk LiveKit 语音管线代理。
独立进程运行，使用 LiveKit Agents 框架处理实时语音对话。

启动方式:
    cd backend && python livekit_agent/agent.py dev
"""

import asyncio
import logging
import sys
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
)
from livekit.plugins import cartesia, deepgram, silero  # noqa: E402
from livekit.plugins import openai as lk_openai  # noqa: E402

from config import settings  # noqa: E402
from services.llm_service import PROVIDER_CONFIG, SYSTEM_PROMPT  # noqa: E402
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

    # 创建 Agent（包含 System Prompt 和各插件配置）
    agent = Agent(
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
        """当用户或 AI 的对话内容被提交时，异步写入数据库。"""
        item = event.item
        if item.role in ("user", "assistant"):
            text = item.text_content
            if text:
                asyncio.ensure_future(save_transcript(session_id, item.role, text))

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
