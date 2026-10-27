"""
EchoTalk Agent 任务编排器 (RF-09)。

管理单个 LiveKit 任务的连接、参与者等待、TranscriptSink 生命周期、
自有运行时错误通知任务追踪与收束、AgentSession 事件接线及启动与异常清理。
不直接读取数据库、用户配置或 Provider 凭据，不反向导入 agent 模块。
"""

import asyncio
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

from livekit_agent.error_delivery import send_error_and_disconnect
from livekit_agent.error_mapper import AgentErrorMapper
from livekit_agent.transcript_sink import TranscriptSink

logger = logging.getLogger("echotalk-agent")


async def _default_send_error(
    ctx: JobContext,
    code: str,
    message: str | None = None,
    fallback_code: str = "ERR_SYSTEM_RUNTIME",
) -> None:
    """默认安全错误通知与断连函数，委托给共享出口 send_error_and_disconnect。"""
    await send_error_and_disconnect(
        ctx,
        code,
        message,
        fallback_code=fallback_code,
    )


class AgentJobOrchestrator:
    """
    LiveKit 任务编排器 (RF-09)。

    负责单次 Job 的连接、等待参与者、TranscriptSink 生命周期管理、
    自有运行时错误通知任务追踪与收束、AgentSession 事件接线及启动与异常清理。
    每次任务实例化独立对象，不共享状态。
    """

    ERROR_TASK_DRAIN_TIMEOUT_SECONDS: float = 2.0

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

        self._error_tasks: set[asyncio.Task[Any]] = set()
        self._in_close_tasks: set[asyncio.Task[Any]] = set()
        self._closing: bool = False
        self._closed: bool = False
        self._drain_deadline: float | None = None
        self._sink_close_task: asyncio.Task[bool] | None = None

    @property
    def error_tasks(self) -> frozenset[asyncio.Task[Any]]:
        """返回当前仍在途的自有运行时错误通知任务只读集合。"""
        return frozenset(self._error_tasks)

    @property
    def closing(self) -> bool:
        """返回编排器是否已进入关闭阶段。"""
        return self._closing

    @property
    def closed(self) -> bool:
        """返回编排器是否已完成关闭。"""
        return self._closed

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

    async def _deliver_runtime_error(self, code: str) -> None:
        """执行单次运行时错误通知协程。"""
        await self._send_error_fn(
            self.ctx,
            code,
            fallback_code="ERR_CUSTOM_RUNTIME",
        )

    def _on_error_task_done(self, task: asyncio.Task[Any]) -> None:
        """完成回调：移除已完成的错误通知任务并安全检索异常，不泄露异常正文或堆栈。"""
        was_tracked = task in self._error_tasks
        self._error_tasks.discard(task)
        self._in_close_tasks.discard(task)
        try:
            if task.cancelled():
                return
            exc = task.exception()
        except asyncio.CancelledError:
            return
        except Exception:
            if was_tracked:
                logger.warning(
                    "运行时错误通知任务异常检索失败: session=%s",
                    self.safe_session_id,
                )
            return

        if exc is not None and was_tracked:
            logger.warning(
                "运行时错误通知任务执行失败: session=%s",
                self.safe_session_id,
            )

    def _spawn_error_task(self, code: str) -> asyncio.Task[None] | None:
        """在未进入关闭态时创建并追踪自有运行时错误通知任务。"""
        if self._closing or self._closed:
            return None

        task = asyncio.create_task(self._deliver_runtime_error(code))
        self._error_tasks.add(task)
        task.add_done_callback(self._on_error_task_done)
        return task

    def on_agent_error(self, event: ErrorEvent) -> None:
        """
        捕获运行时错误（如 HTTP 401 认证失败）。
        仅在活动阶段且自定义轨不可恢复错误下创建受追踪通知任务。
        """
        if self._closing or self._closed:
            return

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

        if self._closing or self._closed:
            return

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
            self._spawn_error_task(code)

    async def _drain_error_tasks(self, deadline: float) -> None:
        """
        在给定截止时间前合作式排空自有运行时错误通知任务（排除当前任务与重入任务）。
        预算到期或调用方被取消时取消并等待剩余任务完成。
        """
        current = asyncio.current_task()
        targets = {
            t
            for t in list(self._error_tasks)
            if t is not current and t not in self._in_close_tasks and not t.done()
        }
        if not targets:
            for t in list(self._error_tasks):
                if t is not current and t.done():
                    self._on_error_task_done(t)
            return

        was_cancelled = False
        try:
            loop = asyncio.get_running_loop()
            rem = max(0.0, deadline - loop.time())
            if rem > 0:
                _, pending = await asyncio.wait(targets, timeout=rem)
            else:
                pending = {t for t in targets if not t.done()}

            if pending:
                logger.warning(
                    "运行时错误通知任务排空超时，执行取消: session=%s, pending=%d",
                    self.safe_session_id,
                    len(pending),
                )
                for t in pending:
                    if not t.done():
                        t.cancel()
                while any(not t.done() for t in pending):
                    try:
                        await asyncio.wait(pending)
                    except asyncio.CancelledError:
                        was_cancelled = True
        except asyncio.CancelledError:
            was_cancelled = True
            pending = {t for t in targets if not t.done()}
            for t in pending:
                t.cancel()
            while any(not t.done() for t in pending):
                try:
                    await asyncio.wait(pending)
                except asyncio.CancelledError:
                    pass
        finally:
            for t in list(targets):
                if t.done():
                    self._on_error_task_done(t)

        if was_cancelled:
            raise asyncio.CancelledError()

    @staticmethod
    def _silence_task_exception(task: asyncio.Task[Any]) -> None:
        """确保内部共享任务异常被检索，不触发 unretrieved warning。"""
        try:
            if not task.cancelled():
                task.exception()
        except (asyncio.CancelledError, Exception):
            pass

    async def _close_sink(self) -> bool:
        """幂等、并发安全地关闭自有 TranscriptSink，保留原返回值与异常传播语义。"""
        if self.sink is None:
            return True

        notify_task = getattr(self.sink, "_notify_task", None)
        if notify_task is not None and asyncio.current_task() is notify_task:
            return await self.sink.close()

        if self._sink_close_task is None:
            self._sink_close_task = asyncio.create_task(self.sink.close())
            self._sink_close_task.add_done_callback(self._silence_task_exception)

        was_cancelled = False
        while not self._sink_close_task.done():
            try:
                await asyncio.shield(self._sink_close_task)
            except asyncio.CancelledError:
                was_cancelled = True

        if was_cancelled:
            raise asyncio.CancelledError()
        return self._sink_close_task.result()

    async def close(self) -> bool:
        """
        组合关闭入口（挂载为单一 Job shutdown callback）：
        1. 同步标记 closing，阻止迟到 error 回调创建新通知任务。
        2. 以 ERROR_TASK_DRAIN_TIMEOUT_SECONDS (默认 2.0s) 合作式排空自有错误通知任务，
           排除当前任务自身以防 disconnect 重入自锁；超时或被取消时取消并等待 pending 任务。
        3. 关闭 TranscriptSink（保留其自有 8.0s 排空预算与 bool 返回值语义）。
        """
        self._closing = True
        loop = asyncio.get_running_loop()
        if self._drain_deadline is None:
            self._drain_deadline = loop.time() + max(
                0.0, float(self.ERROR_TASK_DRAIN_TIMEOUT_SECONDS)
            )
        deadline = self._drain_deadline

        current = asyncio.current_task()
        is_reentrant_error_task = current is not None and current in self._error_tasks
        if is_reentrant_error_task and current is not None:
            self._in_close_tasks.add(current)

        try:
            await self._drain_error_tasks(deadline)
        finally:
            try:
                sink_result = await self._close_sink()
                if not is_reentrant_error_task and self._error_tasks:
                    await asyncio.sleep(0)
                    await self._drain_error_tasks(deadline)
            finally:
                if is_reentrant_error_task and current is not None:
                    self._in_close_tasks.discard(current)
                self._closed = True

        return sink_result

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
        2. 初始化 TranscriptSink 并挂载单一组合 shutdown callback (self.close)
        3. 调用 setup_fn 获取已配置的 Agent
        4. 初始化 AgentSession 并接线事件监听器
        5. 启动语音管线；失败或取消时收束通知任务并安全关闭 Sink
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
                self.ctx.add_shutdown_callback(self.close)

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
                self.on_agent_error(event)

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
            if not self.started:
                await self.close()
