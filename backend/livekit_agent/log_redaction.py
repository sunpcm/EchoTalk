"""Agent 进程级日志脱敏（GHSA-q77r-q2p5-68vf 纵深防御）。

``livekit-agents <1.6.10`` 的插件在 WebSocket 握手失败时，会把 aiohttp 原始异常
（其 ``RequestInfo`` 带鉴权头，Cartesia 的 URL 还带 ``?api_key=``）串进异常链，
最终随 traceback 进入 worker 日志。EchoTalk 自有日志已脱敏，泄露路径在框架内部，
因此这里在 **日志记录创建时**（``Logger.makeRecord``）统一脱敏，而不是依赖
某个 handler 或 formatter：

- LiveKit CLI 在 ``cli.run_app`` 内部才创建 root handler（JSON 或彩色），
  Job 子进程再经 ``LogQueueHandler`` 把已格式化的记录转发给主进程；
  只有在记录创建处脱敏才能同时覆盖这些路径。
- 记录的 ``msg/args`` 会被预先格式化并脱敏；``exc_info`` 会被格式化为 ``exc_text``
  后清空，避免 formatter 重新渲染出未脱敏的异常链。

本模块只依赖标准库，导入时没有副作用；需要显式调用 :func:`install_log_redaction`。
"""

from __future__ import annotations

import logging
import re
import threading
import traceback
from collections import OrderedDict
from typing import Any

REDACTED = "[REDACTED]"
_FAILURE_PLACEHOLDER = "[log record dropped: redaction failed]"

# 已知明文 Key 的精确替换（PluginFactory 校验 Key 时登记），有界、按最近使用淘汰。
_MIN_SECRET_LENGTH = 8
_MAX_SECRETS = 64
_secrets: OrderedDict[str, None] = OrderedDict()
_secrets_lock = threading.Lock()

_NOT_ALREADY_REDACTED = r"(?!\[REDACTED\])"
_VALUE_CHARS = r"[^\s'\",;&)>}\]]+"

# 按模式兜底：覆盖 URL 查询参数、Authorization 头、常见 Key 头/关键字参数与 Bearer 令牌。
_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"(?i)([?&;](?:api[_-]?key|access[_-]?token|jwt[_-]?token|token|key|secret)=)"
        + _NOT_ALREADY_REDACTED
        + r"[^&\s'\"<>#]+"
    ),
    re.compile(
        r"(?i)(\bauthorization['\"]?\s*[:=]\s*['\"]?)"
        + _NOT_ALREADY_REDACTED
        + r"(?:(?:token|bearer|basic)\s+)?"
        + _VALUE_CHARS
    ),
    re.compile(
        r"(?i)(\b(?:x-api-key|xi-api-key|api[-_]key)['\"]?\s*[:=]\s*['\"]?)"
        + _NOT_ALREADY_REDACTED
        + _VALUE_CHARS
    ),
    re.compile(
        r"(?i)(\bbearer\s+)" + _NOT_ALREADY_REDACTED + r"[A-Za-z0-9._~+/=-]{8,}"
    ),
)

# LogRecord 的标准属性；其余属性来自 ``extra=``，同样需要脱敏。
_STANDARD_RECORD_ATTRS = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
) | {"message", "asctime", "taskName"}

_FACTORY_MARKER = "_echotalk_log_redaction"
_install_lock = threading.Lock()


def register_secret(value: Any) -> None:
    """登记一个明文凭据，之后任何日志中出现该值都会被替换为 ``[REDACTED]``。"""
    if not isinstance(value, str):
        return
    secret = value.strip()
    if len(secret) < _MIN_SECRET_LENGTH:
        return
    with _secrets_lock:
        _secrets[secret] = None
        _secrets.move_to_end(secret)
        while len(_secrets) > _MAX_SECRETS:
            _secrets.popitem(last=False)


def _clear_registered_secrets() -> None:
    """仅供测试：清空已登记的明文凭据。"""
    with _secrets_lock:
        _secrets.clear()


def redact_text(text: str) -> str:
    """对任意文本做凭据脱敏：先精确替换已登记 Key，再按模式兜底。"""
    if not text:
        return text
    with _secrets_lock:
        known = sorted(_secrets, key=len, reverse=True)
    for secret in known:
        if secret in text:
            text = text.replace(secret, REDACTED)
    for pattern in _PATTERNS:
        text = pattern.sub(r"\1" + REDACTED, text)
    return text


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, BaseException):
        return redact_text(f"{type(value).__name__}: {value}")
    return value


def _redact_record(record: logging.LogRecord) -> None:
    if isinstance(record.msg, dict) and not record.args:
        # LiveKit JsonFormatter 支持 dict 消息，保持结构，仅脱敏取值。
        record.msg = {key: _redact_value(val) for key, val in record.msg.items()}
    else:
        record.msg = redact_text(record.getMessage())
        record.args = None

    if record.exc_info:
        if not record.exc_text:
            record.exc_text = "".join(
                traceback.format_exception(*record.exc_info)
            ).rstrip("\n")
        record.exc_info = None
    if record.exc_text:
        record.exc_text = redact_text(record.exc_text)
    if record.stack_info:
        record.stack_info = redact_text(record.stack_info)

    for key, value in list(record.__dict__.items()):
        if key not in _STANDARD_RECORD_ATTRS:
            record.__dict__[key] = _redact_value(value)


def is_log_redaction_installed() -> bool:
    """当前进程是否已安装脱敏钩子。"""
    return bool(getattr(logging.Logger.makeRecord, _FACTORY_MARKER, False))


def install_log_redaction() -> None:
    """为当前进程安装日志脱敏钩子；重复调用是幂等的。

    包装 ``logging.Logger.makeRecord``（而非 ``LogRecordFactory``）：``extra=`` 字段
    是在 factory 返回之后才由 ``makeRecord`` 写入记录的，只有包装 ``makeRecord``
    才能连同这些字段一起脱敏。所有已存在与之后创建的 logger 都经过该方法。

    Agent 主进程（``bootstrap.main``）与每个 Job 子进程（``entrypoint``）都要调用：
    LiveKit 在 macOS 用 spawn、在 Linux 用 forkserver 创建子进程，不会继承本设置。
    """
    with _install_lock:
        if is_log_redaction_installed():
            return
        original_make_record = logging.Logger.makeRecord

        def make_redacted_record(
            self: logging.Logger, *args: Any, **kwargs: Any
        ) -> logging.LogRecord:
            record = original_make_record(self, *args, **kwargs)
            try:
                _redact_record(record)
            except Exception:
                # 脱敏失败时失败即关闭：丢弃原文，绝不把未脱敏内容交给 handler。
                for key in list(record.__dict__):
                    if key not in _STANDARD_RECORD_ATTRS:
                        del record.__dict__[key]
                record.msg = _FAILURE_PLACEHOLDER
                record.args = None
                record.exc_info = None
                record.exc_text = None
                record.stack_info = None
            return record

        setattr(make_redacted_record, _FACTORY_MARKER, True)
        logging.Logger.makeRecord = make_redacted_record  # type: ignore[method-assign]
