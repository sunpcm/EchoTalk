"""
EchoTalk LiveKit Agent 安全错误发送与断连共享出口测试 (RF-09)。

覆盖：
1. 模块纯净边界：error_delivery 仅依赖 Python 标准库与 AgentErrorMapper，
   不读取配置/DB/凭据，不反向导入 agent 或 job_orchestrator。
2. 签名与兼容包装：send_error_and_disconnect、agent._send_error_and_disconnect、
   job_orchestrator._default_send_error 保持一致的参数顺序与默认值。
3. 三个真实入口（共享函数 + 两个包装函数）不通过 mock 共享函数，直接端到端验证：
   - 已知错误码映射与静态本地化消息
   - 自定义轨 (ERR_CUSTOM_RUNTIME) 与基础轨 (ERR_SYSTEM_RUNTIME) fallback 降级
   - 非法 fallback_code 安全回退至 ERR_SYSTEM_RUNTIME
   - 恶意 code / message / session_id Canary 全链路脱敏
   - 精确 JSON payload (type/code/message, ensure_ascii=False 中文非转义)、
     publish_data 参数 (reliable=True, topic="agent_error") 与 echotalk-agent 日志文本
   - 普通 publish_data 异常只记录静态安全警告，随后仍执行 disconnect
   - disconnect 异常原样向上传播
   - publish_data 阶段 CancelledError 原样传播且不擅自调用 disconnect
4. 两个包装入口确定性委托给同一共享实现，且各自模块属性仍支持独立 patch。
"""

import ast
import asyncio
import inspect
import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from livekit.agents import JobContext

import livekit_agent.error_delivery as error_delivery_mod
from livekit_agent.agent import _send_error_and_disconnect
from livekit_agent.error_delivery import send_error_and_disconnect
from livekit_agent.error_mapper import KNOWN_ERROR_CODES, SAFE_ERROR_MESSAGES
from livekit_agent.job_orchestrator import AgentJobOrchestrator, _default_send_error

CANARY = "SECRET_CANARY_DELIVERY_887766_DO_NOT_LEAK"
VALID_SESSION_UUID = "12345678-1234-5678-1234-567812345678"

DELIVERY_ENTRYPOINTS = [
    pytest.param(send_error_and_disconnect, id="shared_send_error_and_disconnect"),
    pytest.param(_send_error_and_disconnect, id="agent_wrapper"),
    pytest.param(_default_send_error, id="orchestrator_wrapper"),
]


class _CanaryLogGuard(logging.Handler):
    """捕获 echotalk-agent 日志并校验无任何 Canary 泄露或堆栈附加。"""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)

    def assert_clean(self) -> None:
        for record in self.records:
            msg = record.getMessage()
            assert CANARY not in msg
            assert CANARY not in str(record.msg)
            if record.args:
                assert CANARY not in str(record.args)
            assert record.exc_info is None
            assert getattr(record, "stack_info", None) is None
            for key, val in record.__dict__.items():
                if key in ("msg", "args", "exc_info", "stack_info"):
                    continue
                assert CANARY not in str(val)


@pytest.fixture
def log_guard():
    logger = logging.getLogger("echotalk-agent")
    old_level = logger.level
    handler = _CanaryLogGuard()
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        yield handler
        handler.assert_clean()
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)


def _make_ctx(room_name: object = VALID_SESSION_UUID) -> MagicMock:
    ctx = MagicMock(spec=JobContext)
    ctx.room = MagicMock()
    ctx.room.name = room_name
    ctx.room.disconnect = AsyncMock()
    ctx.room.local_participant = MagicMock()
    ctx.room.local_participant.publish_data = AsyncMock()
    return ctx


def test_error_delivery_module_purity_and_logger():
    """验证 error_delivery.py 仅依赖标准库与 error_mapper，无反向导入与副作用依赖。"""
    source_path = Path(error_delivery_mod.__file__).resolve()
    tree = ast.parse(source_path.read_text(encoding="utf-8"))

    imported_Targets: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported_Targets.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported_Targets.add(node.module)

    assert imported_Targets == {
        "json",
        "logging",
        "typing",
        "livekit_agent.error_mapper",
    }
    assert error_delivery_mod.logger.name == "echotalk-agent"


def test_signatures_and_defaults_preserved():
    """验证共享函数与两个旧包装函数的参数名称、顺序与默认值完全一致。"""
    sig_shared = inspect.signature(send_error_and_disconnect)
    sig_agent = inspect.signature(_send_error_and_disconnect)
    sig_orch = inspect.signature(_default_send_error)

    for sig in (sig_shared, sig_agent, sig_orch):
        params = list(sig.parameters.values())
        assert [p.name for p in params] == [
            "ctx",
            "code",
            "message",
            "fallback_code",
        ]
        assert params[2].default is None
        assert params[3].default == "ERR_SYSTEM_RUNTIME"


@pytest.mark.asyncio
@pytest.mark.parametrize("deliver_fn", DELIVERY_ENTRYPOINTS)
async def test_real_delivery_known_codes_exact_payload_and_logs(deliver_fn, log_guard):
    """直接验证共享函数与两个真实包装：已知错误码发送精确非转义 UTF-8 JSON、日志并断连。"""
    for known_code in sorted(KNOWN_ERROR_CODES):
        log_guard.records.clear()
        ctx = _make_ctx(room_name=VALID_SESSION_UUID)

        await deliver_fn(
            ctx,
            known_code,
            f"raw message with {CANARY}",
            fallback_code="ERR_CUSTOM_RUNTIME",
        )

        ctx.room.local_participant.publish_data.assert_awaited_once()
        call_kwargs = ctx.room.local_participant.publish_data.call_args.kwargs
        assert set(call_kwargs.keys()) == {"payload", "reliable", "topic"}
        assert call_kwargs["reliable"] is True
        assert call_kwargs["topic"] == "agent_error"

        raw_payload = call_kwargs["payload"]
        expected_msg = SAFE_ERROR_MESSAGES[known_code]
        # 验证 ensure_ascii=False（中文字符直接存在于 JSON 文本中，非 \uXXXX 转义）
        assert expected_msg in raw_payload
        assert "\\u" not in raw_payload
        assert CANARY not in raw_payload

        parsed = json.loads(raw_payload)
        assert parsed == {
            "type": "agent_error",
            "code": known_code,
            "message": expected_msg,
        }

        ctx.room.disconnect.assert_awaited_once_with()

        messages = [r.getMessage() for r in log_guard.records]
        assert messages == [
            f"已发送错误消息到客户端: code={known_code}",
            f"已断开房间连接: session={VALID_SESSION_UUID}, code={known_code}",
        ]


@pytest.mark.asyncio
@pytest.mark.parametrize("deliver_fn", DELIVERY_ENTRYPOINTS)
@pytest.mark.parametrize(
    "fallback_code,expected_code",
    [
        ("ERR_CUSTOM_RUNTIME", "ERR_CUSTOM_RUNTIME"),
        ("ERR_SYSTEM_RUNTIME", "ERR_SYSTEM_RUNTIME"),
        ("ERR_CUSTOM_KEY_INVALID", "ERR_CUSTOM_KEY_INVALID"),
        (f"INVALID_FALLBACK_{CANARY}", "ERR_SYSTEM_RUNTIME"),
    ],
)
async def test_real_delivery_fallbacks_and_canary_sanitization(
    deliver_fn, fallback_code, expected_code, log_guard
):
    """直接验证三个真实入口：恶意 code/message/session_id Canary 脱敏及自定义/系统 fallback。"""
    ctx = _make_ctx(room_name=f"malicious-room-{CANARY}")

    await deliver_fn(
        ctx,
        f"UNTRUSTED_CODE_{CANARY}",
        f"Untrusted exception detail {CANARY}",
        fallback_code=fallback_code,
    )

    ctx.room.local_participant.publish_data.assert_awaited_once()
    raw_payload = ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
    assert CANARY not in raw_payload
    parsed = json.loads(raw_payload)
    assert parsed == {
        "type": "agent_error",
        "code": expected_code,
        "message": SAFE_ERROR_MESSAGES[expected_code],
    }

    ctx.room.disconnect.assert_awaited_once_with()
    messages = [r.getMessage() for r in log_guard.records]
    assert messages == [
        f"已发送错误消息到客户端: code={expected_code}",
        f"已断开房间连接: session=unknown, code={expected_code}",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("deliver_fn", DELIVERY_ENTRYPOINTS)
async def test_real_delivery_publish_exception_logs_warning_and_still_disconnects(
    deliver_fn, log_guard
):
    """直接验证三个真实入口：普通 publish 异常仅记录静态安全警告，随后仍执行 disconnect。"""
    ctx = _make_ctx(room_name=VALID_SESSION_UUID)
    ctx.room.local_participant.publish_data.side_effect = RuntimeError(
        f"DataChannel broken {CANARY}"
    )

    await deliver_fn(ctx, "ERR_CUSTOM_RUNTIME_AUTH")

    ctx.room.local_participant.publish_data.assert_awaited_once()
    ctx.room.disconnect.assert_awaited_once_with()

    assert [(r.levelname, r.getMessage()) for r in log_guard.records] == [
        ("WARNING", "发送错误消息到客户端失败"),
        (
            "INFO",
            f"已断开房间连接: session={VALID_SESSION_UUID}, code=ERR_CUSTOM_RUNTIME_AUTH",
        ),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("deliver_fn", DELIVERY_ENTRYPOINTS)
async def test_real_delivery_disconnect_exception_propagates(deliver_fn, log_guard):
    """直接验证三个真实入口：disconnect 异常原样向上传播，不记录已断开日志。"""
    ctx = _make_ctx(room_name=VALID_SESSION_UUID)
    disconnect_err = RuntimeError("Room disconnect failed")
    ctx.room.disconnect.side_effect = disconnect_err

    with pytest.raises(RuntimeError) as exc_info:
        await deliver_fn(ctx, "ERR_SYSTEM_CONFIG")

    assert exc_info.value is disconnect_err
    ctx.room.local_participant.publish_data.assert_awaited_once()
    ctx.room.disconnect.assert_awaited_once_with()
    assert [r.getMessage() for r in log_guard.records] == [
        "已发送错误消息到客户端: code=ERR_SYSTEM_CONFIG"
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("deliver_fn", DELIVERY_ENTRYPOINTS)
async def test_real_delivery_publish_cancelled_error_propagates_without_disconnect(
    deliver_fn, log_guard
):
    """直接验证三个真实入口：publish 阶段 CancelledError 原样传播且绝不擅自调用 disconnect。"""
    ctx = _make_ctx(room_name=VALID_SESSION_UUID)
    ctx.room.local_participant.publish_data.side_effect = asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await deliver_fn(ctx, "ERR_SYSTEM_RUNTIME")

    ctx.room.local_participant.publish_data.assert_awaited_once()
    ctx.room.disconnect.assert_not_awaited()
    assert log_guard.records == []


@pytest.mark.asyncio
async def test_both_wrappers_delegate_to_shared_implementation_and_remain_patchable():
    """验证 agent._send_error_and_disconnect 与 job_orchestrator._default_send_error 均委托同一共享实现。"""
    ctx1 = _make_ctx()
    ctx2 = _make_ctx()

    calls: list[tuple[object, str, str | None, str]] = []
    real_shared = error_delivery_mod.send_error_and_disconnect

    async def spy_shared(
        ctx,
        code: str,
        message: str | None = None,
        fallback_code: str = "ERR_SYSTEM_RUNTIME",
    ) -> None:
        calls.append((ctx, code, message, fallback_code))
        await real_shared(ctx, code, message, fallback_code=fallback_code)

    with (
        patch("livekit_agent.agent.send_error_and_disconnect", side_effect=spy_shared),
        patch(
            "livekit_agent.job_orchestrator.send_error_and_disconnect",
            side_effect=spy_shared,
        ),
    ):
        await _send_error_and_disconnect(
            ctx1, "ERR_SESSION_NOT_FOUND", "msg1", fallback_code="ERR_SESSION_NOT_FOUND"
        )
        await _default_send_error(
            ctx2, "ERR_CUSTOM_RUNTIME", "msg2", fallback_code="ERR_CUSTOM_RUNTIME"
        )

    assert calls == [
        (ctx1, "ERR_SESSION_NOT_FOUND", "msg1", "ERR_SESSION_NOT_FOUND"),
        (ctx2, "ERR_CUSTOM_RUNTIME", "msg2", "ERR_CUSTOM_RUNTIME"),
    ]
    ctx1.room.disconnect.assert_awaited_once()
    ctx2.room.disconnect.assert_awaited_once()

    # 验证 AgentJobOrchestrator 默认回调绑定为 _default_send_error
    orch = AgentJobOrchestrator(ctx1)
    assert orch._send_error_fn is _default_send_error
