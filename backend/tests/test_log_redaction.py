"""GHSA-q77r-q2p5-68vf：Agent 进程级日志脱敏回归。

用 Canary 凭据模拟 livekit-agents <1.6.10 插件握手失败时的泄露形态
（Cartesia ``?api_key=`` URL、Deepgram ``Authorization: Token`` 头、异常链 traceback），
断言经真实 handler/formatter 输出后不再出现明文。
"""

import io
import json
import logging
import pickle

import pytest

from livekit_agent import log_redaction
from livekit_agent.log_redaction import (
    REDACTED,
    install_log_redaction,
    redact_text,
    register_secret,
)

CANARY = "canary-ghsa-q77r-0123456789abcdef"


class _HandshakeError(Exception):
    """仿 aiohttp ``WSServerHandshakeError``：repr 中带请求 URL 与请求头。"""


def _capture_logger(name: str, formatter: logging.Formatter | None = None):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(formatter or logging.Formatter("%(name)s %(message)s"))
    logger = logging.getLogger(name)
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.DEBUG)
    return logger, stream


def _raise_chained_handshake_failure() -> None:
    try:
        raise _HandshakeError(
            "401, message='Invalid response status', "
            f"url='wss://api.cartesia.ai/tts/websocket?api_key={CANARY}"
            "&cartesia_version=2024-06-10', "
            f"headers=<CIMultiDictProxy('Authorization': 'Token {CANARY}')>"
        )
    except _HandshakeError as exc:
        raise RuntimeError("failed to connect to cartesia") from exc


@pytest.mark.parametrize(
    ("raw", "expected_fragment"),
    [
        (
            f"wss://api.cartesia.ai/tts/websocket?api_key={CANARY}&cartesia_version=1",
            f"?api_key={REDACTED}&cartesia_version=1",
        ),
        (f"'Authorization': 'Token {CANARY}'", f"'Authorization': '{REDACTED}'"),
        (f"Authorization: Bearer {CANARY}", f"Authorization: {REDACTED}"),
        (f"X-API-Key: {CANARY}", f"X-API-Key: {REDACTED}"),
        (f"STT(api_key='{CANARY}')", f"STT(api_key='{REDACTED}')"),
        (f"wss://example/ws?jwt_token={CANARY}", f"?jwt_token={REDACTED}"),
        (f"bearer {CANARY}", f"bearer {REDACTED}"),
    ],
)
def test_redact_text_masks_known_credential_shapes(raw, expected_fragment):
    redacted = redact_text(raw)
    assert CANARY not in redacted
    assert expected_fragment in redacted


def test_redact_text_is_idempotent_and_keeps_ordinary_text():
    once = redact_text(f"?api_key={CANARY} Authorization: Token {CANARY}")
    assert redact_text(once) == once
    assert redact_text("会话 abc 已连接，耗时 12ms") == "会话 abc 已连接，耗时 12ms"


def test_registered_secret_is_replaced_in_any_format():
    secret = "sk-or-v1-registered-secret-value"
    register_secret(f"  {secret}  ")
    assert (
        redact_text(f"opaque payload {{{secret}}}") == f"opaque payload {{{REDACTED}}}"
    )


def test_register_secret_ignores_short_and_non_string_values():
    register_secret("short")
    register_secret(None)
    register_secret(12345678)
    assert redact_text("short value 12345678") == "short value 12345678"


def test_register_secret_is_bounded():
    for index in range(log_redaction._MAX_SECRETS + 10):
        register_secret(f"bounded-secret-{index:04d}")
    assert len(log_redaction._secrets) == log_redaction._MAX_SECRETS
    assert redact_text("bounded-secret-0000") == "bounded-secret-0000"
    last = f"bounded-secret-{log_redaction._MAX_SECRETS + 9:04d}"
    assert redact_text(last) == REDACTED


def test_install_redacts_message_args_and_chained_traceback():
    install_log_redaction()
    logger, stream = _capture_logger("livekit.plugins.cartesia")

    logger.warning("connecting to %s", f"wss://api.cartesia.ai?api_key={CANARY}")
    try:
        _raise_chained_handshake_failure()
    except RuntimeError:
        logger.exception("failed to connect")

    output = stream.getvalue()
    assert CANARY not in output
    assert "failed to connect to cartesia" in output
    assert "_HandshakeError" in output
    assert output.count(REDACTED) >= 3


def test_install_redacts_through_livekit_json_formatter():
    from livekit.agents.cli.log import JsonFormatter

    install_log_redaction()
    logger, stream = _capture_logger("livekit.agents", JsonFormatter())
    try:
        _raise_chained_handshake_failure()
    except RuntimeError:
        logger.error(
            "plugin error",
            exc_info=True,
            extra={
                "url": f"wss://x?api_key={CANARY}",
                "cause": _HandshakeError(f"url=wss://x?api_key={CANARY}"),
            },
        )

    output = stream.getvalue()
    assert CANARY not in output
    payload = json.loads(output)
    assert "failed to connect to cartesia" in payload["exc_info"]
    assert payload["url"] == f"wss://x?api_key={REDACTED}"


def test_install_redacts_records_forwarded_by_livekit_ipc_handler():
    """Job 子进程经 LogQueueHandler 序列化记录；转发内容也不得含明文。"""
    install_log_redaction()
    logger = logging.getLogger("livekit.agents.ipc-probe")
    record = logger.makeRecord(
        logger.name,
        logging.ERROR,
        __file__,
        1,
        "handshake failed: %s",
        (f"Authorization: Token {CANARY}",),
        None,
    )
    forwarded = pickle.loads(pickle.dumps(record))
    assert CANARY not in logging.Formatter().format(forwarded)


def test_install_redacts_asyncio_unretrieved_task_exception_logs():
    """未取回的 Task 异常由 asyncio 记录 traceback，同样需要脱敏。"""
    install_log_redaction()
    logger, stream = _capture_logger("asyncio")
    try:
        _raise_chained_handshake_failure()
    except RuntimeError as exc:
        logger.error("Task exception was never retrieved", exc_info=exc)
    assert CANARY not in stream.getvalue()


def test_install_redacts_registered_plugin_factory_keys():
    from livekit_agent.plugin_factory import _validate_api_key

    install_log_redaction()
    logger, stream = _capture_logger("livekit.plugins.deepgram")
    cleaned = _validate_api_key(f" {CANARY} ", "STT provider 'deepgram'")
    logger.error("opaque provider failure %r", {"k": cleaned})
    assert cleaned == CANARY
    assert CANARY not in stream.getvalue()


def test_install_is_idempotent():
    install_log_redaction()
    installed = logging.Logger.makeRecord
    install_log_redaction()
    assert logging.Logger.makeRecord is installed
    assert log_redaction.is_log_redaction_installed()

    logger, stream = _capture_logger("idempotent-probe")
    logger.info("token ?api_key=%s", CANARY)
    assert stream.getvalue().count(REDACTED) == 1
    assert CANARY not in stream.getvalue()


def test_install_covers_loggers_created_before_installation():
    logger, stream = _capture_logger("livekit.plugins.preexisting-probe")
    install_log_redaction()
    logger.error("Authorization: Token %s", CANARY)
    assert CANARY not in stream.getvalue()


def test_redaction_failure_drops_record_content(monkeypatch):
    install_log_redaction()

    def broken(_record):
        raise ValueError("boom")

    monkeypatch.setattr(log_redaction, "_redact_record", broken)
    logger, stream = _capture_logger("failure-probe")
    logger.error("leak %s", CANARY, extra={"leaked_extra": CANARY})
    output = stream.getvalue()
    assert CANARY not in output
    assert "redaction failed" in output


def test_bootstrap_main_installs_redaction_before_loading_dotenv(tmp_path, monkeypatch):
    from livekit_agent import bootstrap

    observed: list[bool] = []

    def fake_load_dotenv(*_args, **_kwargs):
        observed.append(log_redaction.is_log_redaction_installed())
        raise RuntimeError("stop after dotenv")

    monkeypatch.setattr(bootstrap, "load_dotenv", fake_load_dotenv)
    with pytest.raises(RuntimeError, match="stop after dotenv"):
        bootstrap.main(dotenv_path=tmp_path / ".env")
    assert observed == [True]


async def test_entrypoint_installs_redaction_in_job_process(monkeypatch):
    from livekit_agent import agent

    class StopEntrypoint(Exception):
        pass

    observed: list[bool] = []

    class FakeOrchestrator:
        def __init__(self, *_args, **_kwargs):
            observed.append(log_redaction.is_log_redaction_installed())
            raise StopEntrypoint

    monkeypatch.setattr(agent, "AgentJobOrchestrator", FakeOrchestrator)
    with pytest.raises(StopEntrypoint):
        await agent.entrypoint(object())
    assert observed == [True]
