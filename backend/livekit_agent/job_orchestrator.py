"""
EchoTalk Agent 任务编排器 (RF-09)。

管理单个 LiveKit 任务的连接、参与者等待、TranscriptSink 生命周期、
AgentSession 事件接线及启动与异常清理。
不直接读取数据库、用户配置或 Provider 凭据，不反向导入 agent 模块。
"""

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    ConversationItemAddedEvent,
    ErrorEvent,
    JobContext,
)

from livekit_agent.error_mapper import AgentErrorMapper
from livekit_agent.transcript_sink import TranscriptSink

logger = logging.getLogger("echotalk-agent")


async def _default_send_error(
    ctx: JobContext,
    code: str,
    message: str | None = None,
    fallback_code: str = "ERR_SYSTEM_RUNTIME",
) -> None:
    """默认安全错误通知与断连函数。"""
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


class AgentJobOrchestrator:
    """
    LiveKit 任务编排器 (RF-09)。

    负责单次 Job 的连接、等待参与者、TranscriptSink 生命周期管理、
    AgentSession 事件接线及启动与异常清理。
    每次任务实例化独立对象，不共享状态。
    """

    def __init__(
        self,
        ctx: JobContext,
        *,
        session_factory: Callable[[], AgentSession] | Any = AgentSession,
        sink_factory: Callable[..., TranscriptSink] | Any = TranscriptSink,
        send_error_fn: Callable[..., Awaitable[None]] | None = None,
        persist_assistant_fn: Callable[..., bool] | None = None,
    ):
        self.ctx = ctx
        self._session_factory = session_factory
        self._sink_factory = sink_factory
        self._send_error_fn = send_error_fn or _default_send_error
        self._persist_assistant_fn = persist_assistant_fn

        self.safe_session_id: str = "unknown"
        self.session_id: str | None = None
        self.is_custom: bool = False
        self.sink: TranscriptSink | None = None
        self.started: bool = False
        self.agent_session: AgentSession | None = None

    def set_custom_mode(self, is_custom: bool) -> None:
        """设置当前会话的轨模式（基础轨或自定义轨）。"""
        self.is_custom = bool(is_custom)

    async def _on_sink_failure(self, reason: str | None = None) -> None:
        """TranscriptSink 故障回调：通知客户端并终止会话。"""
        fallback_code = "ERR_CUSTOM_RUNTIME" if self.is_custom else "ERR_SYSTEM_RUNTIME"
        logger.error(
            "转录Sink故障，终止会话: session=%s, code=%s",
            self.safe_session_id,
            fallback_code,
        )
        await self._send_error_fn(
            self.ctx,
            fallback_code,
            fallback_code=fallback_code,
        )

    async def run(
        self,
        setup_fn: Callable[
            [str, TranscriptSink],
            Awaitable[Agent | tuple[Agent, bool] | None],
        ],
    ) -> None:
        """
        执行完整的 Job 生命周期编排。

        1. 连接房间并等待参与者
        2. 初始化 TranscriptSink 并挂载 shutdown callback
        3. 调用 setup_fn 获取已配置的 Agent
        4. 初始化 AgentSession 并接线事件监听器
        5. 启动语音管线；失败或取消时安全清理资源
        """
        self.safe_session_id = AgentErrorMapper.sanitize_session_id(
            getattr(getattr(self.ctx, "room", None), "name", None)
        )
        logger.info("Agent 收到任务，房间: %s", self.safe_session_id)

        await self.ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info("Agent 已连接到房间: %s", self.safe_session_id)

        await self.ctx.wait_for_participant()
        logger.info("参与者已加入房间: session=%s", self.safe_session_id)

        self.session_id = self.ctx.room.name
        self.sink = self._sink_factory(
            session_id=self.session_id,
            on_failure=self._on_sink_failure,
        )

        try:
            if hasattr(self.ctx, "add_shutdown_callback"):
                self.ctx.add_shutdown_callback(self.sink.close)

            # 调用外部 setup_fn 构建 Agent 及确认模式
            setup_result = await setup_fn(self.session_id, self.sink)
            if setup_result is None:
                # 业务设置失败，已由 setup_fn 触发错误通知
                return

            if isinstance(setup_result, tuple):
                agent, is_custom = setup_result
                self.is_custom = bool(is_custom)
            else:
                agent = setup_result

            # 创建会话并注册事件钩子
            agent_session = self._session_factory()
            self.agent_session = agent_session

            @agent_session.on("conversation_item_added")
            def on_conversation_item(event: ConversationItemAddedEvent):
                """
                AI 回复的转录回写。

                用户发言的转录已在 on_user_turn_completed 中处理（附带 emotion_state），
                此处仅负责 assistant 消息的持久化。
                """
                if self._persist_assistant_fn is not None:
                    self._persist_assistant_fn(event, self.session_id, sink=self.sink)

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
                    self.safe_session_id,
                    err_type,
                    recoverable if recoverable is not None else "unknown",
                    status_code if status_code is not None else "none",
                )

                classification = AgentErrorMapper.classify_runtime_error(
                    inner_error=inner_error,
                    actual_exception=actual_exception,
                    is_custom=self.is_custom,
                )
                if classification is not None:
                    code, _ = classification
                    logger.error(
                        "自定义轨运行时处理异常并通知断连: session=%s, code=%s",
                        self.safe_session_id,
                        code,
                    )
                    asyncio.ensure_future(
                        self._send_error_fn(
                            self.ctx,
                            code,
                            fallback_code="ERR_CUSTOM_RUNTIME",
                        )
                    )

            # 启动语音管线
            try:
                await agent_session.start(agent, room=self.ctx.room)
                self.started = True
            except Exception:
                fallback_code = (
                    "ERR_CUSTOM_RUNTIME" if self.is_custom else "ERR_SYSTEM_RUNTIME"
                )
                logger.error(
                    "语音管线启动失败: session=%s, is_custom=%s",
                    self.safe_session_id,
                    self.is_custom,
                )
                await self._send_error_fn(
                    self.ctx,
                    fallback_code,
                    fallback_code=fallback_code,
                )
                return

            logger.info(
                "语音管线已启动，session_id=%s, custom=%s",
                self.safe_session_id,
                self.is_custom,
            )
        finally:
            if self.sink is not None and not self.started:
                await self.sink.close()
