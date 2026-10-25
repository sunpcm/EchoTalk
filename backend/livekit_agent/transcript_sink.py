"""
EchoTalk 转录有界内存 Sink 与故障终止 (RF-09 / A44)。

提供会话级独立有界队列、异步重试、优雅排空与单次安全故障通知：
1. 内存有界缓冲：容量 256 pending + 1 inflight，同步非阻塞提交，拒绝空白/非法事件。
2. 尝试与失败收束：最多 3 次写入（首次 + 2 重试），单次 2.0s 超时，0.25s / 1.0s 退避。
3. 满队列或重试耗尽：立即停止接纳，至多触发一次异步故障回调通知房间断连。
4. 优雅关闭与排空：8.0s 总排空预算，超时或取消强制收束自有 worker/writer/notify 任务，精确记账。
5. 观测快照：提供 accepted = succeeded + failed + pending + inflight 恒等式与状态快照。
"""

import asyncio
import copy
import inspect
import logging
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Callable

from livekit_agent.error_mapper import AgentErrorMapper
from services.transcript_service import save_transcript

logger = logging.getLogger("echotalk-agent")

_SENTINEL = object()


@dataclass(frozen=True)
class SinkSnapshot:
    """Sink 状态与精确记账快照。"""

    accepted: int
    succeeded: int
    failed: int
    pending: int
    inflight: int
    rejected: int
    status: str
    closed: bool
    failure_reason: str | None = None

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class TranscriptSink:
    """会话级有界内存转录持久化 Sink。"""

    def __init__(
        self,
        session_id: str | uuid.UUID,
        on_failure: Callable[..., Any] | None = None,
        *,
        writer: Callable[..., Any] | None = None,
        capacity: int = 256,
        max_attempts: int = 3,
        attempt_timeout: float = 2.0,
        backoff: tuple[float, ...] = (0.25, 1.0),
        drain_timeout: float = 8.0,
    ):
        self._session_id = str(session_id).strip() if session_id is not None else ""
        self._safe_session_id = AgentErrorMapper.sanitize_session_id(self._session_id)
        self._on_failure = on_failure
        self._writer = writer if writer is not None else save_transcript
        self._capacity = max(1, int(capacity))
        self._max_attempts = max(1, int(max_attempts))
        self._attempt_timeout = max(0.01, float(attempt_timeout))
        self._backoff = tuple(float(b) for b in backoff)
        self._drain_timeout = max(0.01, float(drain_timeout))

        self._queue: asyncio.Queue[Any] = asyncio.Queue()
        self._worker_task: asyncio.Task[None] | None = None
        self._notify_task: asyncio.Task[None] | None = None
        self._close_task: asyncio.Task[bool] | None = None

        self._accepting: bool = True
        self._closed: bool = False
        self._failure_triggered: bool = False
        self._failure_reason: str | None = None
        self._status: str = "active"

        self._accepted: int = 0
        self._succeeded: int = 0
        self._failed: int = 0
        self._rejected: int = 0
        self._pending: int = 0
        self._inflight: int = 0

        self._ensure_worker()

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def accepting(self) -> bool:
        return self._accepting and not self._closed

    @property
    def closed(self) -> bool:
        return self._closed

    def _ensure_worker(self) -> None:
        """确保单一自有 worker 任务处于运行状态。"""
        if self._closed or not self._accepting:
            return
        if self._worker_task is None or self._worker_task.done():
            try:
                loop = asyncio.get_running_loop()
                self._worker_task = loop.create_task(self._run_worker())
            except RuntimeError:
                pass

    def submit(
        self,
        role: str,
        content: str,
        *,
        event_id: uuid.UUID | str | None,
        emotion_state: dict[str, Any] | None = None,
        timestamp_ms: int | None = None,
    ) -> bool:
        """同步非阻塞提交转录事件。

        返回:
            True 表示成功接纳进入有界队列；
            False 表示拒绝接纳（关闭中、参数非法或队列已满）。
        """
        # 1. 关停/故障后拒绝接收新事件
        if not self._accepting or self._closed:
            self._rejected += 1
            return False

        # 2. 文本非空检查
        if not isinstance(content, str) or not content.strip():
            self._rejected += 1
            return False

        # 3. 角色合法性检查
        if role not in ("user", "assistant"):
            self._rejected += 1
            return False

        # 4. event_id 必须为合法 UUID
        parsed_event_id: uuid.UUID | None = None
        if isinstance(event_id, uuid.UUID):
            parsed_event_id = event_id
        elif isinstance(event_id, str) and event_id.strip():
            try:
                parsed_event_id = uuid.UUID(event_id.strip())
            except (ValueError, AttributeError):
                self._rejected += 1
                return False
        else:
            self._rejected += 1
            return False

        # 5. session_id 必须为合法 UUID
        try:
            uuid.UUID(self._session_id)
        except (ValueError, AttributeError):
            self._rejected += 1
            return False

        # 6. timestamp_ms 若传入必须为 int
        if timestamp_ms is not None and not isinstance(timestamp_ms, int):
            self._rejected += 1
            return False

        # 7. 队列容量检查（256 pending 边界）
        if self._pending >= self._capacity:
            self._rejected += 1
            self._accepting = False
            logger.error(
                "转录Sink队列已满，停止接纳: session=%s, rejected=%d",
                self._safe_session_id,
                self._rejected,
            )
            self._trigger_failure("capacity_exceeded")
            return False

        # 8. 成功接纳：深拷贝快照，未显式传入的时间戳严格保留 None
        item = {
            "session_id": self._session_id,
            "role": str(role),
            "content": copy.deepcopy(content),
            "event_id": parsed_event_id,
            "emotion_state": (
                copy.deepcopy(emotion_state) if emotion_state is not None else None
            ),
            "timestamp_ms": timestamp_ms,
        }

        self._accepted += 1
        self._pending += 1
        self._queue.put_nowait(item)
        self._ensure_worker()
        return True

    def _invoke_failure_callback(self, reason: str) -> Any:
        """调用故障回调，先检查签名参数，绝不通过捕获 TypeError 猜参数重复执行。"""
        if self._on_failure is None:
            return None
        takes_arg = True
        try:
            sig = inspect.signature(self._on_failure)
            takes_arg = any(
                p.kind
                in (
                    inspect.Parameter.POSITIONAL_ONLY,
                    inspect.Parameter.POSITIONAL_OR_KEYWORD,
                    inspect.Parameter.VAR_POSITIONAL,
                )
                for p in sig.parameters.values()
            )
        except (ValueError, TypeError):
            takes_arg = True

        if takes_arg:
            return self._on_failure(reason)
        return self._on_failure()

    def _trigger_failure(self, reason: str) -> None:
        """记录故障原因并至多触发一次异步故障通知。"""
        if self._failure_triggered:
            return
        self._failure_triggered = True
        self._failure_reason = reason
        self._accepting = False
        self._status = "failed"

        if self._on_failure is not None:

            async def _notify_wrapper():
                try:
                    res = self._invoke_failure_callback(reason)
                    if inspect.isawaitable(res):
                        await res
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.warning("转录Sink故障通知执行失败")

            try:
                loop = asyncio.get_running_loop()
                self._notify_task = loop.create_task(_notify_wrapper())

                def _retrieve_task_exc(t: asyncio.Task[None]):
                    try:
                        if not t.cancelled():
                            t.exception()
                    except Exception:
                        pass

                self._notify_task.add_done_callback(_retrieve_task_exc)
            except RuntimeError:
                pass

    async def _process_item(self, item: dict[str, Any]) -> None:
        """对单一事件执行合作式写入与最多 3 次带退避重试，支持通用 Awaitable。"""
        for attempt in range(1, self._max_attempts + 1):
            try:
                writer_res = self._writer(
                    item["session_id"],
                    item["role"],
                    item["content"],
                    timestamp_ms=item["timestamp_ms"],
                    emotion_state=item["emotion_state"],
                    event_id=item["event_id"],
                )
                if inspect.isawaitable(writer_res):
                    res = await asyncio.wait_for(
                        writer_res, timeout=self._attempt_timeout
                    )
                else:
                    res = writer_res

                if isinstance(res, bool):
                    if res:
                        self._succeeded += 1
                        return
                    logger.warning(
                        "转录写入返回失败 (尝试 %d/%d)",
                        attempt,
                        self._max_attempts,
                    )
                elif res is not None:
                    self._succeeded += 1
                    return
            except asyncio.CancelledError:
                raise
            except (TimeoutError, asyncio.TimeoutError):
                logger.warning(
                    "转录写入超时 (尝试 %d/%d)",
                    attempt,
                    self._max_attempts,
                )
            except Exception:
                logger.warning(
                    "转录写入失败 (尝试 %d/%d)",
                    attempt,
                    self._max_attempts,
                )

            if attempt < self._max_attempts:
                backoff_idx = attempt - 1
                delay = (
                    self._backoff[backoff_idx]
                    if backoff_idx < len(self._backoff)
                    else self._backoff[-1]
                )
                await asyncio.sleep(delay)

        # 重试耗尽
        self._failed += 1
        self._accepting = False
        logger.error(
            "转录Sink重试耗尽，停止接纳: session=%s, failed=%d",
            self._safe_session_id,
            self._failed,
        )
        self._trigger_failure("max_attempts_exceeded")

    def _drain_remaining_queue_as_failed(self) -> None:
        """物理清空队列中所有剩余项目并精确记为 failed。"""
        while not self._queue.empty():
            try:
                item = self._queue.get_nowait()
                if item is not _SENTINEL:
                    self._failed += 1
                    self._pending = max(0, self._pending - 1)
                self._queue.task_done()
            except (asyncio.QueueEmpty, ValueError):
                break
        if self._inflight > 0:
            self._failed += self._inflight
            self._inflight = 0
        if self._pending > 0:
            self._failed += self._pending
            self._pending = 0

    async def _run_worker(self) -> None:
        """单一自有 worker 主循环。"""
        try:
            while True:
                try:
                    item = await self._queue.get()
                except asyncio.CancelledError:
                    break

                if item is _SENTINEL:
                    self._queue.task_done()
                    break

                self._pending -= 1
                self._inflight = 1
                try:
                    await self._process_item(item)
                except asyncio.CancelledError:
                    self._failed += 1
                    raise
                finally:
                    self._inflight = 0
                    self._queue.task_done()
        except asyncio.CancelledError:
            if not self._closed and self._status != "closing":
                self._accepting = False
                self._status = "failed"
                self._drain_remaining_queue_as_failed()
                self._trigger_failure("worker_cancelled")
        except Exception:
            logger.warning("转录Sink worker 遇到异常退出")
            if not self._closed and self._status != "closing":
                self._accepting = False
                self._status = "failed"
                self._drain_remaining_queue_as_failed()
                self._trigger_failure("worker_crashed")

    async def _drain_worker(self, deadline: float) -> None:
        """投送 SENTINEL 并等待 worker 在截止时间前处理完剩余队列。"""
        # 唤醒 worker 处理剩余队列
        self._queue.put_nowait(_SENTINEL)

        try:
            if self._worker_task is not None and not self._worker_task.done():
                loop = asyncio.get_running_loop()
                rem = max(0.01, deadline - loop.time())
                done, pending = await asyncio.wait({self._worker_task}, timeout=rem)
                if pending:
                    logger.warning(
                        "转录Sink排空超时: session=%s", self._safe_session_id
                    )
                    self._worker_task.cancel()
                    await asyncio.wait({self._worker_task}, timeout=0.5)
        except asyncio.CancelledError:
            if self._worker_task is not None and not self._worker_task.done():
                self._worker_task.cancel()
                await asyncio.wait({self._worker_task}, timeout=0.5)
            raise
        finally:
            # 无论超时、取消或正常结束，物理清空队列并将未处理项目一律记入 failed
            self._drain_remaining_queue_as_failed()

    async def _do_shared_close(self) -> bool:
        """共享的关闭与资源清理执行体，在单一总预算 (drain_timeout) 内收束所有任务。"""
        self._accepting = False
        if self._status != "failed":
            self._status = "closing"

        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._drain_timeout

        try:
            await self._drain_worker(deadline)
        finally:
            # 在同一总预算内收束通知任务（若存在且当前任务不是通知任务自身）
            # 采用 asyncio.wait 隔离子任务异常与取消，防止子任务自身的 CancelledError 污染共享 close 终态
            if self._notify_task is not None and not self._notify_task.done():
                if asyncio.current_task() is not self._notify_task:
                    rem = max(0.01, deadline - loop.time())
                    done, pending = await asyncio.wait({self._notify_task}, timeout=rem)
                    if pending:
                        self._notify_task.cancel()
                        await asyncio.wait({self._notify_task}, timeout=0.5)

            self._closed = True
            self._status = "closed"
            logger.info(
                "转录Sink关闭完成: session=%s, accepted=%d, succeeded=%d, failed=%d",
                self._safe_session_id,
                self._accepted,
                self._succeeded,
                self._failed,
            )

        return self._accepted == self._succeeded and self._failed == 0

    async def close(self) -> bool:
        """幂等优雅关闭 Sink。

        返回:
            True 表示所有已接纳事件均成功落库；
            False 表示存在失败、排空超时或丢弃事件。
        """
        self._accepting = False

        if self._close_task is None:
            self._close_task = asyncio.create_task(self._do_shared_close())

        # 重入检测：若调用者是故障通知任务自身，不能等待整体 _close_task（后者第二阶段在等待该通知任务结束），
        # 否则形成自死锁。通知任务只需等待 worker 排空即可得到确定的布尔结果返回。
        if (
            self._notify_task is not None
            and asyncio.current_task() is self._notify_task
        ):
            loop = asyncio.get_running_loop()
            deadline = loop.time() + self._drain_timeout
            await self._drain_worker(deadline)
            return self._accepted == self._succeeded and self._failed == 0

        # 外部调用者：等待底层共享任务完成。若调用者被取消，先等待底层收束完成再重抛 CancelledError
        was_cancelled = False
        while not self._close_task.done():
            try:
                await asyncio.shield(self._close_task)
            except asyncio.CancelledError:
                was_cancelled = True

        result = self._close_task.result()
        if was_cancelled:
            raise asyncio.CancelledError()
        return result

    def snapshot(self) -> SinkSnapshot:
        """返回当前的记账与状态快照。"""
        return SinkSnapshot(
            accepted=self._accepted,
            succeeded=self._succeeded,
            failed=self._failed,
            pending=self._pending,
            inflight=self._inflight,
            rejected=self._rejected,
            status=self._status,
            closed=self._closed,
            failure_reason=self._failure_reason,
        )
