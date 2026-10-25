"""
EchoTalk LiveKit Agent 安全错误映射与出口测试 (RF-09)。

覆盖：
1. AgentErrorMapper 纯映射函数、静态安全本地化文本、异常分类（typed APIStatusError
   与 legacy 文本线索严格互斥）与字段净化。
2. 真实 entrypoint / on_agent_error / _send_error_and_disconnect 离线 Mock 回归。
3. 全链路 Synthetic Canary 注入：错误 str/repr/cause、URL/Authorization、
   PluginInitError code/message、非法 session/participant 标识及 publish 异常。
4. 验证 echotalk-agent logger 自有日志记录全字段（包括 args/extra/exc_info/stack_info）
   和实际 publish payload 绝对不含 Canary，无 ctx._info.url 私有字段访问。
5. 验证 disconnect 失败与 CancelledError 取消异常正常向上传播，publish 失败仍尝试断连。
6. 使用确定性异步 Task 屏障，无任意 sleep。
"""

import asyncio
import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from livekit.agents import APIStatusError, ErrorEvent, JobContext

from livekit_agent.agent import _send_error_and_disconnect, entrypoint
from livekit_agent.error_mapper import (
    KNOWN_ERROR_CODES,
    SAFE_ERROR_MESSAGES,
    AgentErrorMapper,
)
from livekit_agent.plugin_factory import PluginInitError

CANARY = "SECRET_CANARY_BEARER_TOKEN_998877_DO_NOT_LEAK"


# ===========================================================================
# 1. AgentErrorMapper 纯单元测试
# ===========================================================================


class ExplodingStrException(Exception):
    """__str__ 会抛出异常的恶劣异常类，用于测试异常格式化防护。"""

    def __str__(self):
        raise RuntimeError("Explosion inside __str__!")


def test_known_error_codes_completeness():
    """验证全部 9 个既有错误码均已定义且具有静态安全本地化消息。"""
    expected_codes = {
        "ERR_CUSTOM_KEY_INVALID",
        "ERR_UNSUPPORTED_STT_PROVIDER",
        "ERR_UNSUPPORTED_LLM_PROVIDER",
        "ERR_UNSUPPORTED_TTS_PROVIDER",
        "ERR_SYSTEM_CONFIG",
        "ERR_SESSION_NOT_FOUND",
        "ERR_CUSTOM_RUNTIME_AUTH",
        "ERR_CUSTOM_RUNTIME",
        "ERR_SYSTEM_RUNTIME",
    }
    assert KNOWN_ERROR_CODES == expected_codes
    assert set(SAFE_ERROR_MESSAGES.keys()) == expected_codes

    for code, msg in SAFE_ERROR_MESSAGES.items():
        assert isinstance(msg, str) and len(msg) > 5
        assert "%s" not in msg
        assert "{" not in msg


def test_mapper_known_codes_mapping():
    """验证已知错误码返回其对应的静态安全本地化指引，忽略外部传入的任意 message。"""
    for code in KNOWN_ERROR_CODES:
        safe_code, safe_msg = AgentErrorMapper.map_error(
            code, message=f"dirty raw message with {CANARY}"
        )
        assert safe_code == code
        assert safe_msg == SAFE_ERROR_MESSAGES[code]
        assert CANARY not in safe_msg


def test_mapper_unknown_and_malicious_codes():
    """验证未知或恶意 code 降级为指定的 fallback_code，绝不回显 raw 片段。"""
    malicious_inputs = [
        f"MALICIOUS_INJECTION_{CANARY}",
        "",
        None,
        12345,
        "UNKNOWN_ERROR_CODE",
        "ERR_DIAGNOSTICS_FAKE",
    ]
    for bad_code in malicious_inputs:
        safe_code, safe_msg = AgentErrorMapper.map_error(
            bad_code,
            message=CANARY,
            fallback_code="ERR_CUSTOM_RUNTIME",
        )
        assert safe_code == "ERR_CUSTOM_RUNTIME"
        assert safe_msg == SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME"]
        assert CANARY not in safe_code
        assert CANARY not in safe_msg


def test_classify_runtime_error_custom_mode_typed_vs_legacy_mutex():
    """
    验证自定义轨下的运行时异常分类：
    1. typed APIStatusError 与 legacy 文本分支严格互斥。
    2. typed 429/500 正文即使出现 401/403/unauthorized 也绝不误判为 AUTH。
    3. typed 401/403 正常分类为 AUTH。
    4. 普通非 APIStatusError 异常才走文本线索。
    """
    # 1. typed 401 / 403 APIStatusError -> AUTH
    status_401 = APIStatusError(message=f"unauthorized {CANARY}", status_code=401)
    status_403 = APIStatusError(message=f"forbidden {CANARY}", status_code=403)
    res_401 = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=False),
        actual_exception=status_401,
        is_custom=True,
    )
    res_403 = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=False),
        actual_exception=status_403,
        is_custom=True,
    )
    assert res_401 == (
        "ERR_CUSTOM_RUNTIME_AUTH",
        SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME_AUTH"],
    )
    assert res_403 == (
        "ERR_CUSTOM_RUNTIME_AUTH",
        SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME_AUTH"],
    )

    # 2. typed 500 / 429 正文中包含 401/unauthorized 线索
    # recoverable=False 时应为 ERR_CUSTOM_RUNTIME，绝不能误判为 AUTH！
    status_500_with_401_body = APIStatusError(
        message=f"Upstream server error mentions 401 unauthorized {CANARY}",
        status_code=500,
    )
    res_500_nonrec = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=False),
        actual_exception=status_500_with_401_body,
        is_custom=True,
    )
    assert res_500_nonrec == (
        "ERR_CUSTOM_RUNTIME",
        SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME"],
    )

    # recoverable=True 时应返回 None（交由 SDK），绝不能断连！
    res_500_rec = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=True),
        actual_exception=status_500_with_401_body,
        is_custom=True,
    )
    assert res_500_rec is None

    # typed 429 含 401 文本
    status_429_with_401_body = APIStatusError(
        message=f"Rate limited: got 401 token {CANARY}",
        status_code=429,
    )
    res_429_nonrec = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=False),
        actual_exception=status_429_with_401_body,
        is_custom=True,
    )
    assert res_429_nonrec == (
        "ERR_CUSTOM_RUNTIME",
        SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME"],
    )
    res_429_rec = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=True),
        actual_exception=status_429_with_401_body,
        is_custom=True,
    )
    assert res_429_rec is None

    # 3. 普通非 APIStatusError Exception 包含 401 / 403 / unauthorized
    txt_auth_exc = Exception(f"Failed with 401 Unauthorized token={CANARY}")
    res_txt = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=False),
        actual_exception=txt_auth_exc,
        is_custom=True,
    )
    assert res_txt == (
        "ERR_CUSTOM_RUNTIME_AUTH",
        SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME_AUTH"],
    )

    # 4. 普通非 APIStatusError Exception 无 401/403 线索
    plain_exc = Exception(f"Connection timeout {CANARY}")
    res_plain_nonrec = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=False),
        actual_exception=plain_exc,
        is_custom=True,
    )
    assert res_plain_nonrec == (
        "ERR_CUSTOM_RUNTIME",
        SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME"],
    )

    res_plain_rec = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=True),
        actual_exception=plain_exc,
        is_custom=True,
    )
    assert res_plain_rec is None

    # 5. __str__ 抛出异常时的安全兜底
    exploding_exc = ExplodingStrException()
    res_exploding = AgentErrorMapper.classify_runtime_error(
        inner_error=MagicMock(recoverable=False),
        actual_exception=exploding_exc,
        is_custom=True,
    )
    assert res_exploding == (
        "ERR_CUSTOM_RUNTIME",
        SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME"],
    )


def test_classify_runtime_error_system_mode():
    """验证基础轨模式下任何运行时异常均返回 None（交由 SDK 既有逻辑处理）。"""
    inner = MagicMock(recoverable=False)
    exc_401 = APIStatusError(message="auth failed", status_code=401)
    res = AgentErrorMapper.classify_runtime_error(
        inner_error=inner,
        actual_exception=exc_401,
        is_custom=False,
    )
    assert res is None


def test_sanitize_helpers():
    """验证字段净化辅助函数（UUID、HTTP 状态码、布尔值、错误类型）。"""
    valid_uuid = "12345678-1234-5678-1234-567812345678"
    assert AgentErrorMapper.sanitize_session_id(valid_uuid) == valid_uuid
    assert AgentErrorMapper.sanitize_session_id(f"invalid-{CANARY}") == "unknown"
    assert AgentErrorMapper.sanitize_session_id(None) == "unknown"
    assert AgentErrorMapper.sanitize_session_id(12345) == "unknown"

    exc_with_code = MagicMock(status_code=404)
    assert AgentErrorMapper.extract_status_code(exc_with_code) == 404
    assert AgentErrorMapper.extract_status_code(MagicMock(status_code=99)) is None
    assert AgentErrorMapper.extract_status_code(MagicMock(status_code=600)) is None
    assert AgentErrorMapper.extract_status_code(MagicMock(status_code="404")) is None
    assert AgentErrorMapper.extract_status_code(Exception()) is None

    assert AgentErrorMapper.sanitize_bool(True) is True
    assert AgentErrorMapper.sanitize_bool(False) is False
    assert AgentErrorMapper.sanitize_bool("true") is None
    assert AgentErrorMapper.sanitize_bool(1) is None
    assert AgentErrorMapper.sanitize_bool(None) is None

    assert AgentErrorMapper.sanitize_error_type("RUNTIME") == "runtime"
    assert AgentErrorMapper.sanitize_error_type("connection") == "connection"
    assert AgentErrorMapper.sanitize_error_type(f"custom_{CANARY}") == "unknown"
    assert AgentErrorMapper.sanitize_error_type(None) == "unknown"


# ===========================================================================
# 2. 真实 entrypoint / error-handler / sender 离线回归测试
# ===========================================================================


class AssertNoCanaryHandler(logging.Handler):
    """
    断言所有记录的日志全字段均不包含 Canary 敏感数据的 Log Handler。
    不依赖在 emit 中直接 raise（防止被上层业务捕获），而是在测试后集中严格审查。
    """

    def __init__(self):
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord):
        self.records.append(record)

    def assert_records_clean(self):
        """严格审查捕获的所有 record 的每个字段。"""
        for r in self.records:
            msg = r.getMessage()
            assert CANARY not in msg, f"Canary found in formatted log: {msg}"
            assert CANARY not in str(r.msg), f"Canary found in raw msg: {r.msg}"
            if r.args:
                assert CANARY not in str(r.args), f"Canary found in log args: {r.args}"
            # 必须无未脱敏堆栈追踪
            assert r.exc_info is None, f"exc_info must be None, but got: {r.exc_info}"
            assert getattr(r, "stack_info", None) is None, (
                f"stack_info must be None, but got: {r.stack_info}"
            )

            # 审查 record 属性字典（如 extra 注入）
            for k, v in r.__dict__.items():
                if k in ("msg", "args", "exc_info", "stack_info"):
                    continue
                assert CANARY not in str(v), f"Canary found in record field '{k}': {v}"


@pytest.fixture
def agent_log_guard():
    """捕获并审查 echotalk-agent logger 日志的 fixture，临时提升为 DEBUG 级别。"""
    logger = logging.getLogger("echotalk-agent")
    old_level = logger.level
    handler = AssertNoCanaryHandler()
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        yield handler
        handler.assert_records_clean()
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)


class ExplodingPrivateInfo:
    """任何对私有字段的访问均直接抛出断言错误。"""

    @property
    def url(self):
        raise AssertionError("Violation: ctx._info.url private property was accessed!")


def create_mock_context(room_name: str = "12345678-1234-5678-1234-567812345678"):
    """构建完全 Mock 的 JobContext，挂载禁读私有 _info 探针。"""
    ctx = MagicMock(spec=JobContext)
    ctx._info = ExplodingPrivateInfo()
    ctx.room = MagicMock()
    ctx.room.name = room_name
    ctx.room.disconnect = AsyncMock()
    ctx.room.local_participant = MagicMock()
    ctx.room.local_participant.publish_data = AsyncMock()
    ctx.connect = AsyncMock()
    participant = MagicMock()
    participant.identity = f"identity-{CANARY}"
    ctx.wait_for_participant = AsyncMock(return_value=participant)
    return ctx


@pytest.mark.asyncio
async def test_send_error_and_disconnect_success_and_canary_sanitized(agent_log_guard):
    """测试 _send_error_and_disconnect：输入包含 canary 时映射为安全静态常量。"""
    ctx = create_mock_context()
    await _send_error_and_disconnect(
        ctx,
        code=f"MALICIOUS_CODE_{CANARY}",
        message=f"Malicious message {CANARY}",
        fallback_code="ERR_CUSTOM_RUNTIME",
    )

    assert ctx.room.local_participant.publish_data.await_count == 1
    call_kwargs = ctx.room.local_participant.publish_data.call_args.kwargs
    assert call_kwargs["reliable"] is True
    assert call_kwargs["topic"] == "agent_error"

    payload = json.loads(call_kwargs["payload"])
    assert payload["type"] == "agent_error"
    assert payload["code"] == "ERR_CUSTOM_RUNTIME"
    assert payload["message"] == SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME"]
    assert CANARY not in call_kwargs["payload"]
    assert ctx.room.disconnect.await_count == 1


@pytest.mark.asyncio
async def test_send_error_and_disconnect_publish_failure_still_disconnects(
    agent_log_guard,
):
    """测试 _send_error_and_disconnect：普通 publish 失败不吞后续 disconnect。"""
    ctx = create_mock_context()
    ctx.room.local_participant.publish_data.side_effect = RuntimeError(
        f"Publish socket broken {CANARY}"
    )

    await _send_error_and_disconnect(
        ctx,
        code="ERR_CUSTOM_KEY_INVALID",
    )

    assert ctx.room.local_participant.publish_data.await_count == 1
    assert ctx.room.disconnect.await_count == 1


@pytest.mark.asyncio
async def test_send_error_and_disconnect_propagates_disconnect_failure(
    agent_log_guard,
):
    """测试 _send_error_and_disconnect：disconnect 失败正常向上传播，不吞异常。"""
    ctx = create_mock_context()
    ctx.room.disconnect.side_effect = RuntimeError("Disconnect hard failure")

    with pytest.raises(RuntimeError, match="Disconnect hard failure"):
        await _send_error_and_disconnect(ctx, code="ERR_SYSTEM_CONFIG")


@pytest.mark.asyncio
async def test_send_error_and_disconnect_cancelled_error_propagation(agent_log_guard):
    """测试 _send_error_and_disconnect：CancelledError 正常传播，不被吞噬。"""
    ctx = create_mock_context()
    ctx.room.local_participant.publish_data.side_effect = asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await _send_error_and_disconnect(ctx, code="ERR_SYSTEM_RUNTIME")


@pytest.mark.asyncio
async def test_entrypoint_settings_fetch_exception_invalid_uuid(agent_log_guard):
    """测试 entrypoint：非法 UUID session_id 查库失败时安全记录日志并发送 ERR_SESSION_NOT_FOUND。"""
    ctx = create_mock_context(room_name=f"invalid-uuid-{CANARY}")

    with patch(
        "livekit_agent.agent._fetch_user_settings",
        side_effect=ValueError(f"Bad UUID format {CANARY}"),
    ):
        await entrypoint(ctx)

    assert ctx.room.local_participant.publish_data.await_count == 1
    payload = json.loads(
        ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert payload["code"] == "ERR_SESSION_NOT_FOUND"
    assert payload["message"] == SAFE_ERROR_MESSAGES["ERR_SESSION_NOT_FOUND"]
    assert ctx.room.disconnect.await_count == 1


@pytest.mark.asyncio
async def test_entrypoint_settings_none(agent_log_guard):
    """测试 entrypoint：未找到用户配置时返回 ERR_SESSION_NOT_FOUND。"""
    ctx = create_mock_context()

    with patch("livekit_agent.agent._fetch_user_settings", return_value=None):
        await entrypoint(ctx)

    assert ctx.room.local_participant.publish_data.await_count == 1
    payload = json.loads(
        ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert payload["code"] == "ERR_SESSION_NOT_FOUND"
    assert payload["message"] == SAFE_ERROR_MESSAGES["ERR_SESSION_NOT_FOUND"]
    assert ctx.room.disconnect.await_count == 1


@pytest.mark.asyncio
async def test_entrypoint_custom_plugin_init_error_known_and_unknown(agent_log_guard):
    """测试 entrypoint：自定义轨插件构建抛出已知与未知 PluginInitError 时安全发送。"""
    ctx = create_mock_context()
    mock_settings = MagicMock(is_custom_mode=True)

    # 1. 已知 code
    with (
        patch("livekit_agent.agent._fetch_user_settings", return_value=mock_settings),
        patch("livekit_agent.agent._fetch_session_context", return_value=None),
        patch(
            "livekit_agent.agent._build_custom_plugins",
            side_effect=PluginInitError(
                "ERR_CUSTOM_KEY_INVALID", f"Secret key leaked {CANARY}"
            ),
        ),
    ):
        await entrypoint(ctx)

    assert ctx.room.local_participant.publish_data.await_count == 1
    payload = json.loads(
        ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert payload["code"] == "ERR_CUSTOM_KEY_INVALID"
    assert payload["message"] == SAFE_ERROR_MESSAGES["ERR_CUSTOM_KEY_INVALID"]
    assert ctx.room.disconnect.await_count == 1

    # 2. 未知/恶意 code
    ctx2 = create_mock_context()
    with (
        patch("livekit_agent.agent._fetch_user_settings", return_value=mock_settings),
        patch("livekit_agent.agent._fetch_session_context", return_value=None),
        patch(
            "livekit_agent.agent._build_custom_plugins",
            side_effect=PluginInitError(
                f"UNKNOWN_MALICIOUS_CODE_{CANARY}", f"Bad secret {CANARY}"
            ),
        ),
    ):
        await entrypoint(ctx2)

    assert ctx2.room.local_participant.publish_data.await_count == 1
    payload2 = json.loads(
        ctx2.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert payload2["code"] == "ERR_CUSTOM_KEY_INVALID"
    assert payload2["message"] == SAFE_ERROR_MESSAGES["ERR_CUSTOM_KEY_INVALID"]
    assert ctx2.room.disconnect.await_count == 1


@pytest.mark.asyncio
async def test_entrypoint_start_failure_custom_and_system(agent_log_guard):
    """测试 entrypoint：语音管线启动失败分别返回 custom 与 system 对应安全错误码。"""
    mock_custom_settings = MagicMock(is_custom_mode=True)
    mock_system_settings = MagicMock(is_custom_mode=False)

    # 自定义轨启动失败
    ctx_custom = create_mock_context()
    with (
        patch(
            "livekit_agent.agent._fetch_user_settings",
            return_value=mock_custom_settings,
        ),
        patch("livekit_agent.agent._fetch_session_context", return_value=None),
        patch("livekit_agent.agent._build_custom_plugins", return_value={}),
        patch("livekit_agent.agent.EchoTalkAgent", return_value=MagicMock()),
        patch(
            "livekit_agent.agent.AgentSession.start",
            side_effect=Exception(f"Pipeline crashed with {CANARY}"),
        ),
    ):
        await entrypoint(ctx_custom)

    payload_custom = json.loads(
        ctx_custom.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert payload_custom["code"] == "ERR_CUSTOM_RUNTIME"
    assert payload_custom["message"] == SAFE_ERROR_MESSAGES["ERR_CUSTOM_RUNTIME"]
    assert ctx_custom.room.disconnect.await_count == 1

    # 基础轨启动失败
    ctx_system = create_mock_context()
    with (
        patch(
            "livekit_agent.agent._fetch_user_settings",
            return_value=mock_system_settings,
        ),
        patch("livekit_agent.agent._fetch_session_context", return_value=None),
        patch(
            "livekit_agent.plugin_factory.PluginFactory.from_system_defaults",
            return_value={},
        ),
        patch("livekit_agent.agent.EchoTalkAgent", return_value=MagicMock()),
        patch(
            "livekit_agent.agent.AgentSession.start",
            side_effect=Exception(f"Pipeline crashed with {CANARY}"),
        ),
    ):
        await entrypoint(ctx_system)

    payload_system = json.loads(
        ctx_system.room.local_participant.publish_data.call_args.kwargs["payload"]
    )
    assert payload_system["code"] == "ERR_SYSTEM_RUNTIME"
    assert payload_system["message"] == SAFE_ERROR_MESSAGES["ERR_SYSTEM_RUNTIME"]
    assert ctx_system.room.disconnect.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "api_error, recoverable, expected_code, expect_disconnect",
    [
        # typed 401 -> AUTH
        (
            APIStatusError(message=f"Auth error {CANARY}", status_code=401),
            False,
            "ERR_CUSTOM_RUNTIME_AUTH",
            True,
        ),
        # typed 403 -> AUTH
        (
            APIStatusError(message=f"Forbidden {CANARY}", status_code=403),
            False,
            "ERR_CUSTOM_RUNTIME_AUTH",
            True,
        ),
        # typed 500 含 401 文本 (recoverable=False) -> ERR_CUSTOM_RUNTIME，绝非 AUTH！
        (
            APIStatusError(
                message=f"500 Internal mentions 401 unauthorized {CANARY}",
                status_code=500,
            ),
            False,
            "ERR_CUSTOM_RUNTIME",
            True,
        ),
        # typed 500 含 401 文本 (recoverable=True) -> 零动作
        (
            APIStatusError(
                message=f"500 Internal mentions 401 unauthorized {CANARY}",
                status_code=500,
            ),
            True,
            None,
            False,
        ),
        # typed 429 含 401 文本 (recoverable=False) -> ERR_CUSTOM_RUNTIME
        (
            APIStatusError(message=f"429 Rate limit 401 {CANARY}", status_code=429),
            False,
            "ERR_CUSTOM_RUNTIME",
            True,
        ),
        # 普通 Exception 包含 401 文本 -> AUTH
        (
            Exception(f"Raw socket 401 unauthorized {CANARY}"),
            False,
            "ERR_CUSTOM_RUNTIME_AUTH",
            True,
        ),
        # 普通 Exception (recoverable=False) -> ERR_CUSTOM_RUNTIME
        (
            Exception(f"Unrecoverable network drop {CANARY}"),
            False,
            "ERR_CUSTOM_RUNTIME",
            True,
        ),
        # 普通 Exception (recoverable=True) -> 零动作
        (
            Exception(f"Recoverable warning {CANARY}"),
            True,
            None,
            False,
        ),
    ],
)
async def test_entrypoint_runtime_error_handler_matrix_custom_mode(
    agent_log_guard, api_error, recoverable, expected_code, expect_disconnect
):
    """测试 entrypoint 注册的 on_agent_error 在自定义轨下的矩阵行为（确定性 Task 等待）。"""
    ctx = create_mock_context()
    mock_settings = MagicMock(is_custom_mode=True)
    captured_handlers = {}

    def mock_on(event_name):
        def decorator(fn):
            captured_handlers[event_name] = fn
            return fn

        return decorator

    mock_session = MagicMock()
    mock_session.on = mock_on
    mock_session.start = AsyncMock()

    with (
        patch("livekit_agent.agent._fetch_user_settings", return_value=mock_settings),
        patch("livekit_agent.agent._fetch_session_context", return_value=None),
        patch("livekit_agent.agent._build_custom_plugins", return_value={}),
        patch("livekit_agent.agent.EchoTalkAgent", return_value=MagicMock()),
        patch("livekit_agent.agent.AgentSession", return_value=mock_session),
    ):
        await entrypoint(ctx)

    assert "error" in captured_handlers
    error_handler = captured_handlers["error"]

    err_event = MagicMock(spec=ErrorEvent)
    err_event.error = MagicMock()
    err_event.error.error = api_error
    err_event.error.type = "runtime"
    err_event.error.recoverable = recoverable

    # 确定性捕获 ensure_future 创建的任务
    created_tasks = []
    orig_ensure_future = asyncio.ensure_future

    def capturing_ensure_future(coro_or_future, *args, **kwargs):
        task = orig_ensure_future(coro_or_future, *args, **kwargs)
        created_tasks.append(task)
        return task

    with patch("asyncio.ensure_future", side_effect=capturing_ensure_future):
        error_handler(err_event)

    # 显式 await 确定性屏障
    if created_tasks:
        await asyncio.gather(*created_tasks)

    if expect_disconnect:
        assert ctx.room.local_participant.publish_data.await_count == 1
        payload = json.loads(
            ctx.room.local_participant.publish_data.call_args.kwargs["payload"]
        )
        assert payload["code"] == expected_code
        assert payload["message"] == SAFE_ERROR_MESSAGES[expected_code]
        assert ctx.room.disconnect.await_count == 1
    else:
        assert ctx.room.local_participant.publish_data.await_count == 0
        assert ctx.room.disconnect.await_count == 0


@pytest.mark.asyncio
async def test_entrypoint_runtime_error_handler_system_mode_zero_action(
    agent_log_guard,
):
    """测试 entrypoint 注册的 on_agent_error 在基础轨下对任何错误均零额外动作。"""
    ctx = create_mock_context()
    mock_settings = MagicMock(is_custom_mode=False)
    captured_handlers = {}

    def mock_on(event_name):
        def decorator(fn):
            captured_handlers[event_name] = fn
            return fn

        return decorator

    mock_session = MagicMock()
    mock_session.on = mock_on
    mock_session.start = AsyncMock()

    with (
        patch("livekit_agent.agent._fetch_user_settings", return_value=mock_settings),
        patch("livekit_agent.agent._fetch_session_context", return_value=None),
        patch(
            "livekit_agent.plugin_factory.PluginFactory.from_system_defaults",
            return_value={},
        ),
        patch("livekit_agent.agent.EchoTalkAgent", return_value=MagicMock()),
        patch("livekit_agent.agent.AgentSession", return_value=mock_session),
    ):
        await entrypoint(ctx)

    error_handler = captured_handlers["error"]

    # 即使是 401 也不断连
    api_err = APIStatusError(message=f"System upstream {CANARY}", status_code=401)
    err_event = MagicMock(spec=ErrorEvent)
    err_event.error = MagicMock()
    err_event.error.error = api_err
    err_event.error.type = "runtime"
    err_event.error.recoverable = False

    created_tasks = []
    orig_ensure_future = asyncio.ensure_future

    def capturing_ensure_future(coro_or_future, *args, **kwargs):
        task = orig_ensure_future(coro_or_future, *args, **kwargs)
        created_tasks.append(task)
        return task

    with patch("asyncio.ensure_future", side_effect=capturing_ensure_future):
        error_handler(err_event)

    if created_tasks:
        await asyncio.gather(*created_tasks)

    assert ctx.room.local_participant.publish_data.await_count == 0
    assert ctx.room.disconnect.await_count == 0
