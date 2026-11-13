"""Structured JSON observability for the analysis job lifecycle.

Lifecycle events (claim / success / retryable failure / exhausted /
non-retryable failure / stale recovery) are buffered inside the owning
transaction and emitted as single-line JSON records only after that transaction
commits. A rolled back or cancelled transaction discards its buffer, so a result
is never reported before it is durable.

Only a fixed whitelist of fields and controlled values is emitted. Provider
error codes outside the known set are collapsed to a fixed safe category;
transcripts, document text, credentials, exception bodies and tracebacks are
never included. Logging is best-effort: a handler failure never changes the
already committed job outcome.
"""

import json
import logging
import uuid
from contextlib import contextmanager
from contextvars import ContextVar

logger = logging.getLogger(__name__)

# Stable, non-sensitive error codes that can flow through the analysis job
# pipeline. Any other code is collapsed to ``unknown_error`` so an injectable
# provider string is never replayed verbatim into logs.
SAFE_ERROR_CODES = frozenset(
    {
        "analysis_unsupported",
        "no_user_transcript",
        "session_missing",
        "worker_timeout",
        "analysis_failed",
    }
)
UNKNOWN_ERROR_CODE = "unknown_error"

_event_buffer: ContextVar["_EventBuffer | None"] = ContextVar(
    "analysis_event_buffer", default=None
)


def safe_error_code(code: str | None) -> str:
    """Return a whitelisted error code or a fixed safe fallback."""
    if code in SAFE_ERROR_CODES:
        return code
    return UNKNOWN_ERROR_CODE


class _EventBuffer:
    """Accumulates events for one transaction and emits or discards them."""

    __slots__ = ("_events",)

    def __init__(self) -> None:
        self._events: list[dict] = []

    def record(self, event: dict) -> None:
        self._events.append(event)

    def emit(self, log: logging.Logger) -> None:
        for event in self._events:
            try:
                log.info(json.dumps(event, sort_keys=True))
            except Exception:
                # Observability must never affect the committed job outcome.
                continue
        self._events.clear()

    def discard(self) -> None:
        self._events.clear()


@contextmanager
def transaction_events(log: logging.Logger = logger):
    """Buffer lifecycle events until the surrounding transaction commits.

    On normal exit the buffered events are emitted (best-effort); on any
    exception, including cancellation, they are discarded and the exception is
    re-raised.
    """
    token = _event_buffer.set(_EventBuffer())
    buffer = _event_buffer.get()
    try:
        yield buffer
    except BaseException:
        buffer.discard()
        raise
    else:
        buffer.emit(log)
    finally:
        _event_buffer.reset(token)


def record_event(
    event: str,
    *,
    job_id: uuid.UUID | None = None,
    session_id: uuid.UUID | None = None,
    attempt_count: int | None = None,
    error_code: str | None = None,
    retryable: bool | None = None,
    outcome: str | None = None,
) -> None:
    """Record one whitelisted event into the current transaction buffer.

    This is a no-op when no buffer is active, for example when the pure service
    functions are exercised directly by unit tests without a transaction scope.
    """
    buffer = _event_buffer.get()
    if buffer is None:
        return
    payload: dict = {"event": event}
    if job_id is not None:
        payload["job_id"] = str(job_id)
    if session_id is not None:
        payload["session_id"] = str(session_id)
    if attempt_count is not None:
        payload["attempt_count"] = int(attempt_count)
    if error_code is not None:
        payload["error_code"] = safe_error_code(error_code)
    if retryable is not None:
        payload["retryable"] = bool(retryable)
    if outcome is not None:
        payload["outcome"] = outcome
    buffer.record(payload)
