"""
EchoTalk LiveKit 语音管线代理。
独立进程运行，使用 LiveKit Agents 框架处理实时语音对话。

Phase 3 新增：情绪感知——基于 STT 文本的犹豫词检测与语速追踪，
动态调整 LLM System Prompt（鼓励模式 / 正常教学模式）。

Phase 5 新增：双轨制路由——根据 is_custom_mode 开关决定使用系统默认
插件配置还是用户自定义 BYOK 密钥，失败时 DataChannel 报错并断连，
绝不静默降级。

启动方式:
    cd backend && python livekit_agent/agent.py dev
"""

import asyncio
import json
import logging
import sys
import time
import uuid
from pathlib import Path
from typing import Any

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
from sqlalchemy import select  # noqa: E402

from config import settings  # noqa: E402
from database import async_session_maker  # noqa: E402
from livekit_agent.plugin_factory import PluginFactory, PluginInitError  # noqa: E402
from models.session import Session  # noqa: E402
from models.user import UserSettings  # noqa: E402
from services.emotion_analyzer import EmotionAnalyzer  # noqa: E402
from services.llm_service import SYSTEM_PROMPT, build_dynamic_prompt  # noqa: E402
from services.transcript_service import save_transcript  # noqa: E402
from utils.crypto import decrypt_api_key  # noqa: E402

logger = logging.getLogger("echotalk-agent")


# ---------------------------------------------------------------------------
#  DB 查询与双轨制辅助函数
# ---------------------------------------------------------------------------


async def _fetch_user_settings(session_id: str) -> UserSettings | None:
    """
    根据 session_id 查询用户的双轨制配置。

    查询链路: session_id → Session.user_id → UserSettings。
    使用 async_session_maker 直接创建 DB 会话（Agent 运行在独立进程，不走 FastAPI DI）。

    参数:
        session_id: 房间名，即 Session 表的 UUID 主键字符串

    返回:
        UserSettings 行，若任一查询未命中则返回 None。
    """
    async with async_session_maker() as db:
        # session_id → user_id
        stmt = select(Session.user_id).where(Session.id == uuid.UUID(session_id))
        result = await db.execute(stmt)
        user_id = result.scalar_one_or_none()
        if user_id is None:
            logger.warning("Session '%s' 在数据库中不存在", session_id)
            return None

        # user_id → UserSettings
        stmt = select(UserSettings).where(UserSettings.user_id == user_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()


def _build_custom_plugins(user_settings: UserSettings) -> dict[str, Any]:
    """
    根据用户自定义配置解密 Key 并通过 PluginFactory 构建插件集。

    预检校验:
    1. 三组 provider 字段（stt/llm/tts）必须已设置
    2. 三组加密 Key 字段必须存在
    3. Fernet 解密必须成功

    参数:
        user_settings: 数据库中的 UserSettings 行（is_custom_mode 已确认为 True）

    返回:
        {"stt": ..., "llm": ..., "tts": ..., "vad": ...}

    异常:
        PluginInitError: 任何预检失败或 PluginFactory 校验失败
    """
    us = user_settings

    # ── 预检: provider 字段 ──
    if not us.stt_provider:
        raise PluginInitError(
            "ERR_CUSTOM_KEY_INVALID",
            "自定义模式下 STT provider 未配置。请在设置页面选择提供商。",
        )
    if not us.llm_provider:
        raise PluginInitError(
            "ERR_CUSTOM_KEY_INVALID",
            "自定义模式下 LLM provider 未配置。请在设置页面选择提供商。",
        )
    if not us.tts_provider:
        raise PluginInitError(
            "ERR_CUSTOM_KEY_INVALID",
            "自定义模式下 TTS provider 未配置。请在设置页面选择提供商。",
        )

    # ── 预检: 加密 Key 字段 ──
    if not us.encrypted_stt_key:
        raise PluginInitError(
            "ERR_CUSTOM_KEY_INVALID",
            "自定义模式下 STT API Key 未配置。请在设置页面输入密钥。",
        )
    if not us.encrypted_llm_key:
        raise PluginInitError(
            "ERR_CUSTOM_KEY_INVALID",
            "自定义模式下 LLM API Key 未配置。请在设置页面输入密钥。",
        )
    if not us.encrypted_tts_key:
        raise PluginInitError(
            "ERR_CUSTOM_KEY_INVALID",
            "自定义模式下 TTS API Key 未配置。请在设置页面输入密钥。",
        )

    # ── 解密 ──
    try:
        stt_key = decrypt_api_key(us.encrypted_stt_key)
        llm_key = decrypt_api_key(us.encrypted_llm_key)
        tts_key = decrypt_api_key(us.encrypted_tts_key)
    except Exception as e:
        raise PluginInitError(
            "ERR_CUSTOM_KEY_INVALID",
            f"API Key 解密失败: {e}",
        ) from e

    # ── 通过 PluginFactory 构建（内部会再做一轮非空校验） ──
    model = us.llm_model or settings.DEFAULT_LLM_MODEL

    return {
        "stt": PluginFactory.create_stt(us.stt_provider.value, stt_key),
        "llm": PluginFactory.create_llm(
            us.llm_provider.value,
            llm_key,
            model,
        ),
        "tts": PluginFactory.create_tts(us.tts_provider.value, tts_key),
        "vad": PluginFactory.create_vad(),
    }


async def _send_error_and_disconnect(
    ctx: JobContext,
    code: str,
    message: str,
) -> None:
    """
    通过 DataChannel 向客户端发送错误 JSON，然后断开房间连接。

    错误载荷格式:
        {"type": "agent_error", "code": "<CODE>", "message": "<描述>"}

    发送使用 reliable=True（TCP 语义保证送达）和 topic="agent_error"
    （前端可按 topic 过滤订阅）。

    参数:
        ctx: LiveKit JobContext（已连接到房间）
        code: 机器可读错误码，如 "ERR_CUSTOM_KEY_INVALID"
        message: 中文人类可读描述
    """
    payload = json.dumps(
        {"type": "agent_error", "code": code, "message": message},
        ensure_ascii=False,
    )
    try:
        await ctx.room.local_participant.publish_data(
            payload=payload,
            reliable=True,
            topic="agent_error",
        )
        logger.info("已发送错误消息到客户端: code=%s", code)
    except Exception:
        logger.warning("发送错误消息到客户端失败", exc_info=True)

    await ctx.room.disconnect()
    logger.info("已断开房间连接: session=%s, code=%s", ctx.room.name, code)


# ---------------------------------------------------------------------------
#  情绪感知 Agent（Phase 3，本次重构不改动）
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
#  Agent 入口：双轨制路由
# ---------------------------------------------------------------------------


async def entrypoint(ctx: JobContext):
    """LiveKit Agent 入口：等待参与者 -> 查询双轨配置 -> 构建插件 -> 启动语音管线。"""
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

    # ── 1. 查询双轨制配置 ──────────────────────────────────────
    user_settings = await _fetch_user_settings(session_id)
    is_custom = user_settings is not None and user_settings.is_custom_mode

    # ── 2. 根据模式构建插件 ────────────────────────────────────
    if is_custom:
        logger.info("自定义轨模式: session_id=%s", session_id)
        try:
            plugins = _build_custom_plugins(user_settings)
        except PluginInitError as e:
            logger.error("自定义轨插件初始化失败: [%s] %s", e.code, e.message)
            await _send_error_and_disconnect(ctx, e.code, e.message)
            return
    else:
        logger.info("基础轨模式: session_id=%s", session_id)
        plugins = PluginFactory.from_system_defaults()

    # ── 3. 创建情绪感知 Agent ──────────────────────────────────
    agent = EchoTalkAgent(
        session_id=session_id,
        instructions=SYSTEM_PROMPT,
        **plugins,
    )

    # ── 4. 创建会话并注册转录回写钩子 ─────────────────────────
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

    # ── 5. 启动语音管线 ───────────────────────────────────────
    await agent_session.start(agent, room=ctx.room)
    logger.info("语音管线已启动，session_id=%s, custom=%s", session_id, is_custom)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            num_idle_processes=1,  # 预热一个进程，减少首次任务启动延迟
        ),
    )
