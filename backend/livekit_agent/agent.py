"""
EchoTalk LiveKit 语音管线代理。
独立进程运行，使用 LiveKit Agents 框架处理实时语音对话。

Phase 3 新增：情绪感知——基于 STT 文本的犹豫词检测与语速追踪，
动态调整 LLM System Prompt（鼓励模式 / 正常教学模式）。

Phase 5 新增：双轨制路由——根据 is_custom_mode 开关决定使用系统默认
插件配置还是用户自定义 BYOK 密钥，失败时 DataChannel 报错并断连，
绝不静默降级。

启动方式:
    cd backend && python -m livekit_agent dev|start
"""

import logging
import time
import uuid
from typing import Any

from livekit.agents import (
    Agent,
    AgentSession,
    ConversationItemAddedEvent,
    JobContext,
    llm,
)
from sqlalchemy import select

from livekit_agent.credential_resolver import CredentialResolver
from livekit_agent.error_delivery import send_error_and_disconnect
from livekit_agent.error_mapper import AgentErrorMapper
from livekit_agent.job_orchestrator import AgentJobOrchestrator
from livekit_agent.plugin_errors import PluginInitError
from livekit_agent.provider_registry import ProviderRegistry
from livekit_agent.transcript_events import derive_transcript_event_id
from livekit_agent.transcript_sink import TranscriptSink
from models.session import Session, SessionContext
from models.user import UserSettings
from services.agent_prompt import build_dynamic_prompt
from services.emotion_analyzer import EmotionAnalyzer

logger = logging.getLogger("echotalk-agent")


def _get_async_session_maker() -> Any:
    """按需加载数据库模块，避免 Agent 模块导入时创建 engine。"""
    from database import async_session_maker

    return async_session_maker


def _get_runtime_settings() -> Any:
    """按需加载应用配置，避免 Agent 模块导入时读取 dotenv。"""
    from config import settings

    return settings


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
    session_factory = _get_async_session_maker()
    async with session_factory() as db:
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

    session_factory = _get_async_session_maker()
    async with session_factory() as db:
        stmt = select(SessionContext).where(SessionContext.session_id == sid)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()


def _build_custom_plugins(user_settings: UserSettings) -> dict[str, Any]:
    """
    根据用户自定义配置通过 CredentialResolver 解析凭据并由 ProviderRegistry 构建插件集。

    预检校验与解密由 CredentialResolver 统一处理：
    1. 三组 provider 字段（stt/llm/tts）必须已设置
    2. 三组加密 Key 字段必须存在
    3. Fernet 解密必须成功

    参数:
        user_settings: 数据库中的 UserSettings 行（is_custom_mode 已确认为 True）

    返回:
        {"stt": ..., "llm": ..., "tts": ..., "vad": ...}

    异常:
        PluginInitError: 任何预检失败、解密失败或 PluginFactory 校验失败
    """
    resolved = CredentialResolver.resolve_custom(
        user_settings,
        default_llm_model=_get_runtime_settings().DEFAULT_LLM_MODEL,
    )
    return ProviderRegistry.from_custom(resolved)


async def _send_error_and_disconnect(
    ctx: JobContext,
    code: str,
    message: str | None = None,
    fallback_code: str = "ERR_SYSTEM_RUNTIME",
) -> None:
    """
    通过 DataChannel 向客户端发送错误 JSON，然后断开房间连接。

    兼容包装函数，实际实现委托给 livekit_agent.error_delivery.send_error_and_disconnect。
    """
    await send_error_and_disconnect(
        ctx,
        code,
        message,
        fallback_code=fallback_code,
    )


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
    """
    LiveKit Agent 入口 (RF-09)。

    将连接、参与者等待、TranscriptSink 生命周期及 AgentSession 事件接线
    委托给 AgentJobOrchestrator；entrypoint 保留 DB 配置查询、双轨路由与 Agent 创建。
    """

    async def _setup_agent(
        session_id: str, sink: TranscriptSink
    ) -> tuple[EchoTalkAgent, bool] | None:
        safe_session_id = orchestrator.safe_session_id

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
            return None

        # ── 1a. 安全校验: 必须查到用户配置 ────────────────────────
        if user_settings is None:
            logger.error("未找到用户配置: session_id=%s", safe_session_id)
            await _send_error_and_disconnect(
                ctx,
                "ERR_SESSION_NOT_FOUND",
                fallback_code="ERR_SESSION_NOT_FOUND",
            )
            return None

        is_custom = user_settings.is_custom_mode
        orchestrator.set_custom_mode(is_custom)

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
                return None
        else:
            logger.info("基础轨模式: session_id=%s", safe_session_id)
            plugins = ProviderRegistry.from_system_defaults()

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
        return agent, is_custom

    orchestrator = AgentJobOrchestrator(
        ctx,
        session_factory=AgentSession,
        sink_factory=TranscriptSink,
        send_error_fn=_send_error_and_disconnect,
        persist_assistant_fn=_persist_assistant_conversation_item,
    )
    await orchestrator.run(_setup_agent)
