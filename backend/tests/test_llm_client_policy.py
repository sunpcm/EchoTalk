"""普通 OpenAI 兼容 HTTP 客户端的冻结策略与真实 SDK 消费回归。"""

import pytest
from openai import AsyncOpenAI

from provider_catalog import LLMClientPolicy
from services import llm_service

OFFLINE_BASE_URL = "http://127.0.0.1:9/v1"
SYNTHETIC_API_KEY = "{{SECRET_yqfihxbs}}"


def _assert_client_policy(
    client: AsyncOpenAI,
    *,
    default_timeout_seconds: float,
    connect_timeout_seconds: float,
    max_retries: int,
) -> None:
    assert client.timeout.connect == connect_timeout_seconds
    assert client.timeout.read == default_timeout_seconds
    assert client.timeout.write == default_timeout_seconds
    assert client.timeout.pool == default_timeout_seconds
    assert client.max_retries == max_retries


def _configure_offline_siliconflow(monkeypatch) -> None:
    monkeypatch.setattr(
        "services.llm_service.settings.DEFAULT_LLM_PROVIDER", "siliconflow"
    )
    monkeypatch.setattr(
        "services.llm_service.settings.SILICONFLOW_API_KEY", SYNTHETIC_API_KEY
    )
    monkeypatch.setitem(
        llm_service.PROVIDER_CONFIG["siliconflow"],
        "base_url",
        OFFLINE_BASE_URL,
    )


@pytest.mark.asyncio
async def test_real_sdk_defaults_match_explicit_catalog_policy():
    """真实 SDK 默认属性与冻结 Catalog 策略一致。"""
    client = AsyncOpenAI(
        api_key=SYNTHETIC_API_KEY,
        base_url=OFFLINE_BASE_URL,
    )
    try:
        _assert_client_policy(
            client,
            default_timeout_seconds=600.0,
            connect_timeout_seconds=5.0,
            max_retries=2,
        )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_get_client_uses_frozen_default_policy(monkeypatch):
    """真实 _get_client 默认消费 Catalog 冻结值。"""
    _configure_offline_siliconflow(monkeypatch)

    client = llm_service._get_client()
    try:
        _assert_client_policy(
            client,
            default_timeout_seconds=600.0,
            connect_timeout_seconds=5.0,
            max_retries=2,
        )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_get_client_consumes_injected_catalog_policy(monkeypatch):
    """真实 _get_client 必须把合法替代策略消费到 SDK 客户端。"""
    alternative_policy = LLMClientPolicy(
        default_http_timeout_seconds=37.0,
        connect_timeout_seconds=3.0,
        max_retries=0,
    )
    _configure_offline_siliconflow(monkeypatch)

    client = llm_service._get_client(policy=alternative_policy)
    try:
        assert isinstance(client, AsyncOpenAI)
        assert client.api_key == SYNTHETIC_API_KEY
        assert str(client.base_url).rstrip("/") == OFFLINE_BASE_URL
        _assert_client_policy(
            client,
            default_timeout_seconds=37.0,
            connect_timeout_seconds=3.0,
            max_retries=0,
        )
    finally:
        await client.close()
