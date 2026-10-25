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
import os
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
    ErrorEvent,
    JobContext,
    WorkerOptions,
    cli,
    llm,
)
from sqlalchemy import select  # noqa: E402

from config import settings  # noqa: E402
from database import async_session_maker  # noqa: E402
from livekit_agent.error_mapper import AgentErrorMapper  # noqa: E402
from livekit_agent.plugin_factory import PluginFactory, PluginInitError  # noqa: E402
from livekit_agent.transcript_events import derive_transcript_event_id  # noqa: E402
from livekit_agent.transcript_sink import TranscriptSink  # noqa: E402
from models.session import Session, SessionContext  # noqa: E402
from models.user import UserSettings  # noqa: E402
from services.emotion_analyzer import EmotionAnalyzer  # noqa: E402
from services.llm_service import build_dynamic_prompt  # noqa: E402
from utils.crypto import decrypt_api_key  # noqa: E402

logger = logging.getLogger("echotalk-agent")

# 自定义轨模式下需要临时清除的系统环境变量，防止 SDK 使用系统密钥作为后备
_SENSITIVE_ENV_VARS: list[str] = [
    "DEEPGRAM_API_KEY",
    "SILICONFLOW_API_KEY",
    "OPENROUTER_API_KEY",
    "CARTESIA_API_KEY",
    "OPENAI_API_KEY",
]


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
            safe_sid = AgentErrorMapper.sanitize_session_id(session_id)
            logger.warning("Session 在数据库中不存在: session=%s", safe_sid)
            return None

        # user_id → UserSettings
        stmt = select(UserSettings).where(UserSettings.user_id == user_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()


async def _fetch_session_context(session_id: str) -> SessionContext | None:
    """
    根据 session_id 查询会话文档上下文。

    参数:
        session_id: 房间名，即 Session 表的 UUID 主键字符串

    返回:
        SessionContext 行，未找到则返回 None。
    """
    try:
        sid = uuid.UUID(session_id)
    except (ValueError, TypeError, AttributeError):
        logger.warning("无效的 session_id 格式")
        return None

    async with async_session_maker() as db:
        stmt = select(SessionContext).where(SessionContext.session_id == sid)
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
        stt_credential = decrypt_api_key(us.encrypted_stt_key, us.stt_key_version)
        llm_credential = decrypt_api_key(us.encrypted_llm_key, us.llm_key_version)
        tts_credential = decrypt_api_key(us.encrypted_tts_key, us.tts_key_version)
        stt_key = stt_credential.plaintext
        llm_key = llm_credential.plaintext
        tts_key = tts_credential.plaintext
    except Exception as e:
        raise PluginInitError(
            "ERR_CUSTOM_KEY_INVALID",
            "API Key 解密失败，请重新保存密钥。",
        ) from e

    # ── 通过 PluginFactory 构建（内部会再做一轮非空校验） ──
    model = us.llm_model or settings.DEFAULT_LLM_MODEL

    # ── 防御: 临时清除系统 API Key 环境变量 ──
    # 防止 SDK 构造器在显式 key 参数失败时回退读取 os.environ
    saved_env = {k: os.environ.pop(k) for k in _SENSITIVE_ENV_VARS if k in os.environ}
    try:
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
    finally:
        os.environ.update(saved_env)


async def _send_error_and_disconnect(
    ctx: JobContext,
    code: str,
    message: str | None = None,
    fallback_code: str = "ERR_SYSTEM_RUNTIME",
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
        message: 传入描述（将通过 AgentErrorMapper 强制转换为安全静态描述）
        fallback_code: code 不在白名单时的兜底错误码
    """
    safe_code, safe_message = AgentErrorMapper.map_error(
        code, message, fallback_code=fallback_code
    )
    safe_session_id = AgentErrorMapper.sanitize_session_id(
        getattr(getattr(ctx, "room", None), "name", None)
    )

    payload = json.dumps(
        {"type": "agent_error", "code": safe_code, "message": safe_message},
        ensure_ascii=False,
    )
    try:
        await ctx.room.local_participant.publish_data(
            payload=payload,
            reliable=True,
            topic="agent_error",
        )
        logger.info("已发送错误消息到客户端: code=%s", safe_code)
    except Exception:
        logger.warning("发送错误消息到客户端失败")

    await ctx.room.disconnect()
    logger.info("已断开房间连接: session=%s, code=%s", safe_session_id, safe_code)


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

    def __init__(
        self,
        session_id: str,
        custom_prompt: str | None = None,
        document_content: str | None = None,
        *,
        sink: TranscriptSink | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._session_id = session_id
        self._custom_prompt = custom_prompt
        self._document_content = document_content
        self._emotion_analyzer = EmotionAnalyzer()
        self._current_mode = "normal"  # "normal" | "encouragement"
        self._sink = sink

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
            await self.update_instructions(
                build_dynamic_prompt(
                    emotion.anxiety_level,
                    custom_prompt=self._custom_prompt,
                    document_content=self._document_content,
                )
            )

        # 3. 异步持久化用户转录 + 情绪状态（不阻塞 LLM 推理）
        source_item_id = getattr(new_message, "id", None)
        event_id = derive_transcript_event_id(self._session_id, "user", source_item_id)
        if event_id is None:
            logger.warning("用户消息缺少有效 item.id，丢弃转录持久化")
        elif self._sink is not None:
            self._sink.submit(
                "user",
                text,
                event_id=event_id,
                emotion_state=emotion.to_dict(),
            )
        else:
            logger.warning("未注入 TranscriptSink，丢弃转录持久化")


# ---------------------------------------------------------------------------
#  Agent 入口：双轨制路由
# ---------------------------------------------------------------------------


def _persist_assistant_conversation_item(
    event: ConversationItemAddedEvent,
    session_id: str,
    *,
    sink: TranscriptSink | None = None,
) -> bool:
    """Persist assistant text from a LiveKit conversation event, if present."""
    item = event.item
    if isinstance(item, llm.ChatMessage) and item.role == "assistant":
        text = item.text_content
        if text:
            source_item_id = getattr(item, "id", None)
            event_id = derive_transcript_event_id(
                session_id, "assistant", source_item_id
            )
            if event_id is None:
                logger.warning("AI 消息缺少有效 item.id，丢弃转录持久化")
                return False
            if sink is not None:
                return sink.submit(
                    "assistant",
                    text,
                    event_id=event_id,
                )
            logger.warning("未注入 TranscriptSink，丢弃转录持久化")
            return False
    return False


async def entrypoint(ctx: JobContext):
    """LiveKit Agent 入口：等待参与者 -> 查询双轨配置 -> 构建插件 -> 启动语音管线。"""
    safe_session_id = AgentErrorMapper.sanitize_session_id(
        getattr(getattr(ctx, "room", None), "name", None)
    )
    logger.info("Agent 收到任务，房间: %s", safe_session_id)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Agent 已连接到房间: %s", safe_session_id)

    await ctx.wait_for_participant()
    logger.info("参与者已加入房间: session=%s", safe_session_id)

    # 房间名即为 session_id（Token 端点使用 str(session.id) 作为房间名）
    session_id = ctx.room.name
    is_custom = False

    async def _on_sink_failure(reason: str | None = None) -> None:
        fallback_code = "ERR_CUSTOM_RUNTIME" if is_custom else "ERR_SYSTEM_RUNTIME"
        logger.error(
            "转录Sink故障，终止会话: session=%s, code=%s",
            safe_session_id,
            fallback_code,
        )
        await _send_error_and_disconnect(
            ctx,
            fallback_code,
            fallback_code=fallback_code,
        )

    sink = TranscriptSink(
        session_id=session_id,
        on_failure=_on_sink_failure,
    )
    started = False
    try:
        if hasattr(ctx, "add_shutdown_callback"):
            ctx.add_shutdown_callback(sink.close)

        # ── 1. 查询双轨制配置 ──────────────────────────────────────
        try:
            user_settings = await _fetch_user_settings(session_id)
        except Exception:
            logger.error("查询用户配置失败: session_id=%s", safe_session_id)
            await _send_error_and_disconnect(
                ctx,
                "ERR_SESSION_NOT_FOUND",
                fallback_code="ERR_SESSION_NOT_FOUND",
            )
            return

        # ── 1a. 安全校验: 必须查到用户配置 ────────────────────────
        if user_settings is None:
            logger.error("未找到用户配置: session_id=%s", safe_session_id)
            await _send_error_and_disconnect(
                ctx,
                "ERR_SESSION_NOT_FOUND",
                fallback_code="ERR_SESSION_NOT_FOUND",
            )
            return

        is_custom = user_settings.is_custom_mode

        # ── 1b. 查询文档上下文 ────────────────────────────────────
        session_context = await _fetch_session_context(session_id)
        custom_prompt = session_context.custom_prompt if session_context else None
        document_content = session_context.document_content if session_context else None

        # ── 2. 根据模式构建插件 ────────────────────────────────────
        if is_custom:
            logger.info("自定义轨模式: session_id=%s", safe_session_id)
            try:
                plugins = _build_custom_plugins(user_settings)
            except PluginInitError as e:
                safe_code, _ = AgentErrorMapper.map_error(
                    e.code,
                    fallback_code="ERR_CUSTOM_KEY_INVALID",
                )
                logger.error("自定义轨插件初始化失败: code=%s", safe_code)
                await _send_error_and_disconnect(
                    ctx,
                    safe_code,
                    fallback_code="ERR_CUSTOM_KEY_INVALID",
                )
                return
        else:
            logger.info("基础轨模式: session_id=%s", safe_session_id)
            plugins = PluginFactory.from_system_defaults()

        # ── 3. 创建情绪感知 Agent ──────────────────────────────────
        initial_prompt = build_dynamic_prompt(
            anxiety_level=0.0,
            custom_prompt=custom_prompt,
            document_content=document_content,
        )

        agent = EchoTalkAgent(
            session_id=session_id,
            custom_prompt=custom_prompt,
            document_content=document_content,
            instructions=initial_prompt,
            sink=sink,
            **plugins,
        )

        # ── 4. 创建会话并注册事件钩子 ─────────────────────────────
        agent_session = AgentSession()

        @agent_session.on("conversation_item_added")
        def on_conversation_item(event: ConversationItemAddedEvent):
            """
            AI 回复的转录回写。

            用户发言的转录已在 on_user_turn_completed 中处理（附带 emotion_state），
            此处仅负责 assistant 消息的持久化。
            """
            _persist_assistant_conversation_item(event, session_id, sink=sink)

        @agent_session.on("error")
        def on_agent_error(event: ErrorEvent):
            """
            捕获运行时错误（如 HTTP 401 认证失败）。
            仅在自定义轨模式下通知客户端并断连。
            """
            inner_error = event.error
            actual_exception = getattr(inner_error, "error", inner_error)

            err_type = AgentErrorMapper.sanitize_error_type(
                getattr(inner_error, "type", None)
            )
            recoverable = AgentErrorMapper.sanitize_bool(
                getattr(inner_error, "recoverable", None)
            )
            status_code = AgentErrorMapper.extract_status_code(actual_exception)

            logger.error(
                "运行时错误: session=%s, type=%s, recoverable=%s, status=%s",
                safe_session_id,
                err_type,
                recoverable if recoverable is not None else "unknown",
                status_code if status_code is not None else "none",
            )

            classification = AgentErrorMapper.classify_runtime_error(
                inner_error=inner_error,
                actual_exception=actual_exception,
                is_custom=is_custom,
            )
            if classification is not None:
                code, _ = classification
                logger.error(
                    "自定义轨运行时处理异常并通知断连: session=%s, code=%s",
                    safe_session_id,
                    code,
                )
                asyncio.ensure_future(
                    _send_error_and_disconnect(
                        ctx,
                        code,
                        fallback_code="ERR_CUSTOM_RUNTIME",
                    )
                )

        # ── 5. 启动语音管线 ───────────────────────────────────────
        try:
            await agent_session.start(agent, room=ctx.room)
            started = True
        except Exception:
            fallback_code = "ERR_CUSTOM_RUNTIME" if is_custom else "ERR_SYSTEM_RUNTIME"
            logger.error(
                "语音管线启动失败: session=%s, is_custom=%s",
                safe_session_id,
                is_custom,
            )
            await _send_error_and_disconnect(
                ctx,
                fallback_code,
                fallback_code=fallback_code,
            )
            return

        logger.info(
            "语音管线已启动，session_id=%s, custom=%s", safe_session_id, is_custom
        )
    finally:
        if not started:
            await sink.close()


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            num_idle_processes=1,  # 预热一个进程，减少首次任务启动延迟
        ),
    )
