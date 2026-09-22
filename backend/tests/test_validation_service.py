from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.validation_service import ProviderValidationService


def mock_aiohttp_get(status=200, exception=None):
    response = MagicMock(status=status)
    context = MagicMock()
    context.__aenter__ = AsyncMock(
        side_effect=exception,
        return_value=None if exception else response,
    )
    context.__aexit__ = AsyncMock(return_value=None)
    return patch("aiohttp.ClientSession.get", return_value=context)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "provider"),
    [
        ("validate_stt_key", "deepgram"),
        ("validate_llm_key", "siliconflow"),
        ("validate_tts_key", "cartesia"),
    ],
)
async def test_missing_key_has_stable_error(method, provider):
    result = await getattr(ProviderValidationService, method)(provider, "")
    assert result.ok is False
    assert result.code == "missing_key"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "provider"),
    [
        ("validate_stt_key", "unsupported-stt"),
        ("validate_llm_key", "unsupported-llm"),
        ("validate_tts_key", "unsupported-tts"),
    ],
)
async def test_unsupported_provider_has_stable_error(method, provider):
    result = await getattr(ProviderValidationService, method)(provider, "key")
    assert result.ok is False
    assert result.code == "unsupported_provider"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "provider", "expected_url", "expected_headers"),
    [
        (
            "validate_stt_key",
            "deepgram",
            "https://api.deepgram.com/v1/projects",
            {"Authorization": "Token secret-value"},
        ),
        (
            "validate_llm_key",
            "siliconflow",
            "https://api.siliconflow.cn/v1/user/info",
            {"Authorization": "Bearer secret-value"},
        ),
        (
            "validate_llm_key",
            "openrouter",
            "https://openrouter.ai/api/v1/auth/key",
            {"Authorization": "Bearer secret-value"},
        ),
        (
            "validate_tts_key",
            "cartesia",
            "https://api.cartesia.ai/voices",
            {"X-API-Key": "secret-value", "Cartesia-Version": "2024-06-10"},
        ),
    ],
)
async def test_successful_provider_validation(
    method, provider, expected_url, expected_headers
):
    with mock_aiohttp_get(status=200) as request:
        result = await getattr(ProviderValidationService, method)(
            provider, "secret-value"
        )
    assert result.ok is True
    assert result.code == "verified"
    request.assert_called_once_with(expected_url, headers=expected_headers)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "auth_error"),
        (403, "auth_error"),
        (429, "rate_limited"),
        (500, "provider_error"),
    ],
)
async def test_http_failures_are_classified(status, code):
    with mock_aiohttp_get(status=status):
        result = await ProviderValidationService.validate_llm_key(
            "openrouter", "secret-value"
        )
    assert result.ok is False
    assert result.code == code


@pytest.mark.asyncio
async def test_unknown_client_exception_is_sanitized(caplog):
    secret = "never-log-this-key"
    with mock_aiohttp_get(exception=Exception("raw upstream body with secret")):
        result = await ProviderValidationService.validate_stt_key("deepgram", secret)
    assert result.code == "provider_error"
    assert secret not in caplog.text
    assert "raw upstream body" not in caplog.text


@pytest.mark.asyncio
async def test_validate_all_preserves_boolean_compatibility():
    with mock_aiohttp_get(status=200):
        result = await ProviderValidationService.validate_all(
            "deepgram",
            "stt-key",
            "siliconflow",
            "llm-key",
            "cartesia",
            "tts-key",
        )
    assert result is True
