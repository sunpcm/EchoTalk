"""Readiness 只检查配置；全部输入为合成对象，不解密、不访问外部服务。"""

import socket
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from auth import CurrentUser
from models.user import SubscriptionTier
from routers import health


@pytest.fixture
def readiness(monkeypatch):
    cfg = SimpleNamespace(
        USE_MOCK_DB=False,
        USE_MOCK_LIVEKIT=False,
        USE_MOCK_STT=False,
        USE_MOCK_LLM=False,
        USE_MOCK_TTS=False,
        LIVEKIT_URL="wss://synthetic.invalid",
        LIVEKIT_API_KEY="synthetic-livekit",
        LIVEKIT_API_SECRET="synthetic-secret",
        DEFAULT_LLM_PROVIDER="siliconflow",
        DEFAULT_LLM_MODEL="synthetic-model",
        SILICONFLOW_API_KEY="synthetic-llm",
        OPENROUTER_API_KEY="",
        DEEPGRAM_API_KEY="synthetic-stt",
        CARTESIA_API_KEY="synthetic-tts",
    )
    us = SimpleNamespace(
        is_custom_mode=True,
        is_custom_verified=True,
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        encrypted_stt_key="synthetic-stt-ciphertext",
        encrypted_llm_key="synthetic-llm-ciphertext",
        encrypted_tts_key="synthetic-tts-ciphertext",
    )
    user = SimpleNamespace(settings=us, subscription_tier=SubscriptionTier.free)
    result = MagicMock()
    result.scalar_one_or_none.return_value = user
    db = AsyncMock()
    db.execute.return_value = result
    current = CurrentUser(
        id=uuid.uuid4(),
        email="synthetic@example.invalid",
        issuer="test",
        subject="test",
    )
    monkeypatch.setattr(health, "settings", cfg)

    def forbidden(*args, **kwargs):
        raise AssertionError("Readiness must not decrypt or connect")

    # Patch the lazy credential entry point and socket entry points; no Agent import.
    from livekit_agent import credential_resolver

    monkeypatch.setattr(credential_resolver, "decrypt_api_key", forbidden)
    monkeypatch.setattr(
        credential_resolver.CredentialResolver, "resolve_custom", forbidden
    )
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    return SimpleNamespace(
        cfg=cfg, us=us, user=user, result=result, db=db, current=current
    )


async def failure(r):
    with pytest.raises(HTTPException) as caught:
        await health.readiness_check(r.current, r.db)
    assert caught.value.status_code == 503
    detail = caught.value.detail
    assert detail["status"] == "not_ready"
    assert all(isinstance(value, str) for value in detail["errors"].values())
    return detail


@pytest.mark.asyncio
async def test_valid_custom_is_ready_without_decryption_or_network(readiness):
    assert await health.readiness_check(readiness.current, readiness.db) == {
        "status": "ready"
    }
    assert readiness.db.execute.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["user", "settings"])
async def test_missing_identity_configuration_fails_closed(readiness, missing):
    if missing == "user":
        readiness.result.scalar_one_or_none.return_value = None
    else:
        readiness.user.settings = None
    detail = await failure(readiness)
    assert detail["code"] == (
        "user_unavailable" if missing == "user" else "settings_required"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["stt", "llm", "tts"])
@pytest.mark.parametrize("field", ["provider", "key"])
@pytest.mark.parametrize("value", [None, "", "   "])
async def test_each_required_custom_field(readiness, role, field, value):
    name = f"{role}_provider" if field == "provider" else f"encrypted_{role}_key"
    setattr(readiness.us, name, value)
    detail = await failure(readiness)
    assert detail["code"] == "custom_incomplete"
    assert role in detail["errors"]


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["stt", "llm", "tts"])
async def test_unknown_custom_provider_is_rejected(readiness, role):
    setattr(readiness.us, f"{role}_provider", "unknown-sensitive-provider")
    detail = await failure(readiness)
    assert detail["code"] == "custom_incomplete"
    assert "unknown-sensitive-provider" not in str(detail)


@pytest.mark.asyncio
async def test_aggregate_verification_and_reason_priority(readiness):
    readiness.us.is_custom_verified = False
    readiness.us.encrypted_llm_key = None
    readiness.cfg.LIVEKIT_API_KEY = ""
    detail = await failure(readiness)
    assert detail["code"] == "custom_unverified"
    assert set(detail["errors"]) == {"config", "llm", "livekit"}


@pytest.mark.asyncio
async def test_database_exception_is_safe_and_not_misclassified(readiness, caplog):
    canary = "postgresql://secret@host/database?key=synthetic-canary"
    readiness.db.execute.side_effect = RuntimeError(canary)
    readiness.cfg.LIVEKIT_URL = ""
    detail = await failure(readiness)
    assert detail["code"] == "database_unavailable"
    assert set(detail["errors"]) == {"database", "livekit"}
    assert canary not in str(detail)
    assert canary not in caplog.text
    assert readiness.db.execute.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("real_role", ["stt", "llm", "tts"])
async def test_one_role_mock_never_bypasses_another(readiness, real_role):
    for role in ("stt", "llm", "tts"):
        setattr(readiness.cfg, f"USE_MOCK_{role.upper()}", role != real_role)
        setattr(readiness.us, f"encrypted_{role}_key", None)
    detail = await failure(readiness)
    assert detail["code"] == "custom_incomplete"
    assert set(detail["errors"]) == {real_role}
    setattr(readiness.us, f"encrypted_{real_role}_key", "synthetic-ciphertext")
    assert await health.readiness_check(readiness.current, readiness.db) == {
        "status": "ready"
    }


@pytest.mark.asyncio
async def test_database_mock_is_not_a_provider_bypass(readiness):
    readiness.cfg.USE_MOCK_DB = True
    assert (await failure(readiness))["code"] == "user_unavailable"
    readiness.db.execute.assert_not_awaited()
    for role in ("stt", "llm", "tts"):
        setattr(readiness.cfg, f"USE_MOCK_{role.upper()}", True)
    assert await health.readiness_check(readiness.current, readiness.db) == {
        "status": "ready"
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("tier", list(SubscriptionTier))
async def test_system_subscription_policy(readiness, tier):
    readiness.us.is_custom_mode = False
    readiness.user.subscription_tier = tier
    if tier == SubscriptionTier.free:
        assert (await failure(readiness))["code"] == "permission_denied"
    else:
        assert await health.readiness_check(readiness.current, readiness.db) == {
            "status": "ready"
        }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field",
    [
        "DEEPGRAM_API_KEY",
        "CARTESIA_API_KEY",
        "SILICONFLOW_API_KEY",
        "DEFAULT_LLM_PROVIDER",
        "DEFAULT_LLM_MODEL",
    ],
)
async def test_required_system_configuration(readiness, field):
    readiness.us.is_custom_mode = False
    readiness.user.subscription_tier = SubscriptionTier.pro
    setattr(readiness.cfg, field, "   ")
    readiness.cfg.OPENROUTER_API_KEY = "synthetic-other-provider"
    assert (await failure(readiness))["code"] == "provider_unconfigured"


@pytest.mark.asyncio
async def test_system_uses_selected_catalog_provider(readiness):
    readiness.us.is_custom_mode = False
    readiness.user.subscription_tier = SubscriptionTier.pro
    readiness.cfg.DEFAULT_LLM_PROVIDER = "openrouter"
    assert (await failure(readiness))["code"] == "provider_unconfigured"
    readiness.cfg.OPENROUTER_API_KEY = "synthetic-selected-provider"
    readiness.cfg.SILICONFLOW_API_KEY = ""
    assert await health.readiness_check(readiness.current, readiness.db) == {
        "status": "ready"
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field", ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]
)
async def test_livekit_config_and_explicit_mock(readiness, field):
    setattr(readiness.cfg, field, "   ")
    assert (await failure(readiness))["code"] == "livekit_unconfigured"
    readiness.cfg.USE_MOCK_LIVEKIT = True
    assert await health.readiness_check(readiness.current, readiness.db) == {
        "status": "ready"
    }
