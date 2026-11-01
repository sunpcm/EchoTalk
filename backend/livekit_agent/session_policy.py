"""LiveKit AgentSession 连接策略到公开 SDK 选项的窄适配边界。"""

from livekit.agents import APIConnectOptions
from livekit.agents.voice.agent_session import SessionConnectOptions

from provider_catalog import (
    SESSION_CONNECT_POLICY,
    SessionConnectPolicy,
    SessionConnectRolePolicy,
)


def _build_role_options(policy: SessionConnectRolePolicy) -> APIConnectOptions:
    """按单个 role 的冻结策略创建全新的 SDK 连接选项。"""
    return APIConnectOptions(
        max_retry=policy.max_retry,
        retry_interval=policy.retry_interval,
        timeout=policy.timeout,
    )


def build_session_connect_options(
    policy: SessionConnectPolicy = SESSION_CONNECT_POLICY,
) -> SessionConnectOptions:
    """从 Catalog 策略创建每次会话独立的全新 SDK 选项对象。"""
    return SessionConnectOptions(
        stt_conn_options=_build_role_options(policy.stt),
        llm_conn_options=_build_role_options(policy.llm),
        tts_conn_options=_build_role_options(policy.tts),
        max_unrecoverable_errors=policy.max_unrecoverable_errors,
    )
