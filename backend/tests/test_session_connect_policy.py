"""LiveKit AgentSession 连接策略适配与生产构造边界回归。"""

from unittest.mock import MagicMock

from livekit.agents import APIConnectOptions
from livekit.agents.voice.agent_session import SessionConnectOptions

import livekit_agent.agent as agent_module
from livekit_agent.session_policy import build_session_connect_options
from provider_catalog import (
    SESSION_CONNECT_POLICY,
    SessionConnectPolicy,
    SessionConnectRolePolicy,
)


def test_sdk_session_connect_options_defaults_match_catalog_policy():
    """真实 SDK dataclass 默认值必须与 Catalog 冻结的当前行为一致。"""
    sdk_defaults = SessionConnectOptions()

    for role, options in (
        ("stt", sdk_defaults.stt_conn_options),
        ("llm", sdk_defaults.llm_conn_options),
        ("tts", sdk_defaults.tts_conn_options),
    ):
        catalog_role = getattr(SESSION_CONNECT_POLICY, role)
        assert options.timeout == catalog_role.timeout
        assert options.max_retry == catalog_role.max_retry
        assert options.retry_interval == catalog_role.retry_interval

    assert (
        sdk_defaults.max_unrecoverable_errors
        == SESSION_CONNECT_POLICY.max_unrecoverable_errors
    )


def test_build_session_connect_options_consumes_each_role_policy():
    """合法替代策略必须分别进入 STT/LLM/TTS 与独立不可恢复错误阈值。"""
    replacement = SessionConnectPolicy(
        stt=SessionConnectRolePolicy(
            timeout=15.0,
            max_retry=1,
            retry_interval=1.25,
        ),
        llm=SessionConnectRolePolicy(
            timeout=25.0,
            max_retry=2,
            retry_interval=2.5,
        ),
        tts=SessionConnectRolePolicy(
            timeout=35.0,
            max_retry=4,
            retry_interval=3.75,
        ),
        max_unrecoverable_errors=7,
    )

    options = build_session_connect_options(replacement)

    assert (
        options.stt_conn_options.timeout,
        options.stt_conn_options.max_retry,
        options.stt_conn_options.retry_interval,
    ) == (15.0, 1, 1.25)
    assert (
        options.llm_conn_options.timeout,
        options.llm_conn_options.max_retry,
        options.llm_conn_options.retry_interval,
    ) == (25.0, 2, 2.5)
    assert (
        options.tts_conn_options.timeout,
        options.tts_conn_options.max_retry,
        options.tts_conn_options.retry_interval,
    ) == (35.0, 4, 3.75)
    assert options.max_unrecoverable_errors == 7


def test_build_session_connect_options_allocates_fresh_objects_per_job():
    """每次 Job 的 SDK 选项和三个 role 选项均不得跨调用共享。"""
    first = build_session_connect_options()
    second = build_session_connect_options()

    assert first is not second
    assert first.stt_conn_options is not second.stt_conn_options
    assert first.llm_conn_options is not second.llm_conn_options
    assert first.tts_conn_options is not second.tts_conn_options

    second.llm_conn_options = APIConnectOptions(
        max_retry=0,
        retry_interval=0.25,
        timeout=3.0,
    )
    second.max_unrecoverable_errors = 99

    assert first.llm_conn_options.max_retry == 3
    assert first.llm_conn_options.retry_interval == 2.0
    assert first.llm_conn_options.timeout == 10.0
    assert first.max_unrecoverable_errors == 3


def test_agent_session_factory_reads_current_binding_at_call_time(monkeypatch):
    """窄 factory 必须在调用时读取当前 AgentSession 绑定并按 Job 新建选项。"""
    construction_calls: list[dict[str, SessionConnectOptions]] = []

    def current_session_constructor(
        *, conn_options: SessionConnectOptions
    ) -> MagicMock:
        construction_calls.append({"conn_options": conn_options})
        return MagicMock()

    monkeypatch.setattr(
        agent_module,
        "AgentSession",
        current_session_constructor,
    )

    first = agent_module._create_agent_session()
    second = agent_module._create_agent_session()

    assert first is not second
    assert len(construction_calls) == 2
    first_options = construction_calls[0]["conn_options"]
    second_options = construction_calls[1]["conn_options"]
    assert first_options is not second_options
    assert (
        first_options.llm_conn_options.max_retry == SESSION_CONNECT_POLICY.llm.max_retry
    )
    assert (
        second_options.max_unrecoverable_errors
        == SESSION_CONNECT_POLICY.max_unrecoverable_errors
    )
