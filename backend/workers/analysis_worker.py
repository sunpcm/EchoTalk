"""Small PostgreSQL-backed worker for durable session analysis jobs."""

import asyncio
import logging
import math
import os
import signal
from contextlib import contextmanager

from config import settings
from database import async_session_maker, engine
from services.analysis_jobs import claim_next_job, process_job, recover_stale_jobs

logger = logging.getLogger(__name__)

SHUTDOWN_GRACE_SECONDS = 2.0
CANCELLATION_TIMEOUT_SECONDS = 1.0
DISPOSE_TIMEOUT_SECONDS = 1.0


class WorkerShutdownTimeout(RuntimeError):
    """Owned asynchronous work did not finish within the shutdown budget."""


class _StopBeforeCommit(Exception):
    """Roll back a recovery/claim transaction when shutdown wins the race."""


async def _cancel_and_wait(task: asyncio.Task, timeout: float) -> None:
    requested = task.cancel()
    done, _ = await asyncio.wait({task}, timeout=timeout)
    if not done:
        raise WorkerShutdownTimeout("analysis worker cancellation timed out")
    if task.cancelled() and requested:
        return
    # Only our own requested cancellation is an expected shutdown result.
    task.result()


async def run_forever(
    stop_event: asyncio.Event | None = None,
    *,
    session_factory=None,
    poll_seconds: float | None = None,
    shutdown_grace_seconds: float = SHUTDOWN_GRACE_SECONDS,
    cancellation_timeout_seconds: float = CANCELLATION_TIMEOUT_SECONDS,
) -> None:
    """Stop claims immediately; drain one active job, then cancel its transaction.

    The caller owns signal handlers and the engine. Injected session factories
    keep tests and embedded callers from disposing a shared application engine.
    """
    stopping = stop_event if stop_event is not None else asyncio.Event()
    factory = session_factory if session_factory is not None else async_session_maker
    poll = (
        settings.ANALYSIS_WORKER_POLL_SECONDS if poll_seconds is None else poll_seconds
    )
    for duration in (poll, shutdown_grace_seconds, cancellation_timeout_seconds):
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("worker polling and shutdown budgets must be positive")
    if stopping.is_set():
        return

    processing = False

    async def poll_jobs():
        nonlocal processing
        while not stopping.is_set():
            processing = False
            try:
                async with factory() as db, db.begin():
                    if stopping.is_set():
                        raise _StopBeforeCommit
                    recovered = await recover_stale_jobs(db)
                    if stopping.is_set():
                        raise _StopBeforeCommit
                    job_id = await claim_next_job(db)
                    if stopping.is_set():
                        raise _StopBeforeCommit
            except _StopBeforeCommit:
                return

            # A signal can cross a commit already acknowledged by PostgreSQL.
            # Leave that durable running job for the existing stale recovery;
            # never start analysis or manufacture a retry after shutdown.
            if stopping.is_set():
                return
            if recovered:
                logger.warning("Recovered %d stale analysis job(s)", recovered)
            if job_id is None:
                try:
                    await asyncio.wait_for(stopping.wait(), timeout=poll)
                except TimeoutError:
                    pass
                continue
            processing = True
            await process_job(job_id, factory)

    worker = asyncio.create_task(poll_jobs(), name="analysis-worker-loop")
    stop_waiter = asyncio.create_task(stopping.wait(), name="analysis-worker-stop")
    cancellation_requested = False
    try:
        done, _ = await asyncio.wait(
            {worker, stop_waiter}, return_when=asyncio.FIRST_COMPLETED
        )
        if worker in done:
            await worker
            return
        if processing:
            done, _ = await asyncio.wait({worker}, timeout=shutdown_grace_seconds)
            if worker in done:
                await worker
                return
        cancellation_requested = True
        await _cancel_and_wait(worker, cancellation_timeout_seconds)
    finally:
        # This waiter is ours, so consuming its requested cancellation is safe.
        owner = asyncio.current_task()
        cancellations = owner.cancelling()
        stop_waiter.cancel()
        try:
            await stop_waiter
        except asyncio.CancelledError:
            if owner.cancelling() > cancellations:
                raise
        finally:
            if not worker.done() and not cancellation_requested:
                await _cancel_and_wait(worker, cancellation_timeout_seconds)


@contextmanager
def _stop_signals(stopping: asyncio.Event):
    """Install handlers only for this CLI invocation, restoring every handler."""
    loop = asyncio.get_running_loop()
    installed = []

    def request_stop():
        if not stopping.is_set():
            logger.info("Analysis worker shutdown requested")
            stopping.set()

    def fallback_handler(_signum, _frame):
        loop.call_soon_threadsafe(request_stop)

    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            previous = signal.getsignal(signum)
            try:
                loop.add_signal_handler(signum, request_stop)
                use_loop = True
            except (NotImplementedError, RuntimeError):
                # Supported only where signal.signal is allowed (main thread).
                # Failure propagates rather than silently running without stop.
                signal.signal(signum, fallback_handler)
                use_loop = False
            installed.append((signum, previous, use_loop))
        yield
    finally:
        for signum, previous, use_loop in reversed(installed):
            if use_loop:
                loop.remove_signal_handler(signum)
            signal.signal(signum, previous)


async def _dispose_engine() -> None:
    close = asyncio.create_task(engine.dispose(), name="analysis-worker-dispose")
    cancellation_requested = False
    try:
        done, _ = await asyncio.wait({close}, timeout=DISPOSE_TIMEOUT_SECONDS * 0.75)
        if not done:
            cancellation_requested = True
            await _cancel_and_wait(close, DISPOSE_TIMEOUT_SECONDS * 0.25)
            raise WorkerShutdownTimeout("analysis worker engine disposal timed out")
        close.result()
    finally:
        if not close.done() and not cancellation_requested:
            await _cancel_and_wait(close, DISPOSE_TIMEOUT_SECONDS * 0.25)


async def _run_cli() -> None:
    stopping = asyncio.Event()
    with _stop_signals(stopping):
        try:
            await run_forever(stopping)
        except WorkerShutdownTimeout:
            # asyncio.run otherwise waits without a bound for cancellation-
            # resistant tasks during loop.close. Only this owned CLI may force
            # a nonzero exit; a successful graceful exit never uses this path.
            logger.error("Analysis worker could not cancel owned work safely")
            os._exit(1)
        finally:
            try:
                await _dispose_engine()
            except WorkerShutdownTimeout:
                logger.error("Analysis worker could not release its engine safely")
                os._exit(1)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(_run_cli())
    except (Exception, asyncio.CancelledError, KeyboardInterrupt) as exc:
        # Driver/provider exceptions can contain credentials. Preserve failure
        # as nonzero without emitting their message or traceback.
        logger.error("Analysis worker exited with %s", type(exc).__name__)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
