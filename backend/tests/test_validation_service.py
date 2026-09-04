import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from services.validation_service import ProviderValidationService


def mock_aiohttp_get(status=200, exception=None):
    mock_resp = MagicMock()
    mock_resp.status = status

    mock_cm = MagicMock()
    if exception:
        mock_cm.__aenter__ = AsyncMock(side_effect=exception)
    else:
        mock_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_cm.__aexit__ = AsyncMock(return_value=None)

    return patch("aiohttp.ClientSession.get", return_value=mock_cm)


@pytest.mark.asyncio
async def test_validate_stt_key_empty():
    assert await ProviderValidationService.validate_stt_key("deepgram", "") is False
    assert await ProviderValidationService.validate_stt_key("deepgram", None) is False


@pytest.mark.asyncio
async def test_validate_stt_key_deepgram_success():
    with mock_aiohttp_get(status=200) as mock_get:
        result = await ProviderValidationService.validate_stt_key(
            "deepgram", "valid-key"
        )
        assert result is True
        mock_get.assert_called_once_with(
            "https://api.deepgram.com/v1/projects",
            headers={"Authorization": "Token valid-key"},
        )


@pytest.mark.asyncio
async def test_validate_stt_key_deepgram_failure_status():
    with mock_aiohttp_get(status=401):
        result = await ProviderValidationService.validate_stt_key(
            "deepgram", "invalid-key"
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_stt_key_deepgram_exception():
    with mock_aiohttp_get(exception=Exception("Connection error")):
        result = await ProviderValidationService.validate_stt_key(
            "deepgram", "any-key"
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_stt_key_unsupported_provider():
    result = await ProviderValidationService.validate_stt_key(
        "unsupported_stt", "some-key"
    )
    assert result is False


@pytest.mark.asyncio
async def test_validate_llm_key_empty():
    assert await ProviderValidationService.validate_llm_key("siliconflow", "") is False
    assert await ProviderValidationService.validate_llm_key("openrouter", None) is False


@pytest.mark.asyncio
async def test_validate_llm_key_siliconflow_success():
    with mock_aiohttp_get(status=200) as mock_get:
        result = await ProviderValidationService.validate_llm_key(
            "siliconflow", "valid-key"
        )
        assert result is True
        mock_get.assert_called_once_with(
            "https://api.siliconflow.cn/v1/user/info",
            headers={"Authorization": "Bearer valid-key"},
        )


@pytest.mark.asyncio
async def test_validate_llm_key_siliconflow_failure_status():
    with mock_aiohttp_get(status=403):
        result = await ProviderValidationService.validate_llm_key(
            "siliconflow", "invalid-key"
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_llm_key_siliconflow_exception():
    with mock_aiohttp_get(exception=Exception("Timeout")):
        result = await ProviderValidationService.validate_llm_key(
            "siliconflow", "any-key"
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_llm_key_openrouter_success():
    with mock_aiohttp_get(status=200) as mock_get:
        result = await ProviderValidationService.validate_llm_key(
            "openrouter", "valid-key"
        )
        assert result is True
        mock_get.assert_called_once_with(
            "https://openrouter.ai/api/v1/auth/key",
            headers={"Authorization": "Bearer valid-key"},
        )


@pytest.mark.asyncio
async def test_validate_llm_key_openrouter_failure_status():
    with mock_aiohttp_get(status=401):
        result = await ProviderValidationService.validate_llm_key(
            "openrouter", "invalid-key"
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_llm_key_openrouter_exception():
    with mock_aiohttp_get(exception=Exception("DNS failure")):
        result = await ProviderValidationService.validate_llm_key(
            "openrouter", "any-key"
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_llm_key_unsupported_provider():
    result = await ProviderValidationService.validate_llm_key(
        "unsupported_llm", "some-key"
    )
    assert result is False


@pytest.mark.asyncio
async def test_validate_tts_key_empty():
    assert await ProviderValidationService.validate_tts_key("cartesia", "") is False
    assert await ProviderValidationService.validate_tts_key("cartesia", None) is False


@pytest.mark.asyncio
async def test_validate_tts_key_cartesia_success():
    with mock_aiohttp_get(status=200) as mock_get:
        result = await ProviderValidationService.validate_tts_key(
            "cartesia", "valid-key"
        )
        assert result is True
        mock_get.assert_called_once_with(
            "https://api.cartesia.ai/voices",
            headers={
                "X-API-Key": "valid-key",
                "Cartesia-Version": "2024-06-10",
            },
        )


@pytest.mark.asyncio
async def test_validate_tts_key_cartesia_failure_status():
    with mock_aiohttp_get(status=500):
        result = await ProviderValidationService.validate_tts_key(
            "cartesia", "invalid-key"
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_tts_key_cartesia_exception():
    with mock_aiohttp_get(exception=Exception("Network error")):
        result = await ProviderValidationService.validate_tts_key(
            "cartesia", "any-key"
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_tts_key_unsupported_provider():
    result = await ProviderValidationService.validate_tts_key(
        "unsupported_tts", "some-key"
    )
    assert result is False


@pytest.mark.asyncio
async def test_validate_all_success():
    with mock_aiohttp_get(status=200):
        result = await ProviderValidationService.validate_all(
            stt_provider="deepgram",
            stt_key="stt-key",
            llm_provider="siliconflow",
            llm_key="llm-key",
            tts_provider="cartesia",
            tts_key="tts-key",
        )
        assert result is True


@pytest.mark.asyncio
async def test_validate_all_stt_fails():
    with mock_aiohttp_get(status=401):
        result = await ProviderValidationService.validate_all(
            stt_provider="deepgram",
            stt_key="bad-stt-key",
            llm_provider="siliconflow",
            llm_key="llm-key",
            tts_provider="cartesia",
            tts_key="tts-key",
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_all_llm_fails():
    # First call (STT) succeeds, second call (LLM) fails
    responses = [200, 401]

    def side_effect(*args, **kwargs):
        st = responses.pop(0) if responses else 200
        mock_resp = MagicMock()
        mock_resp.status = st
        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_cm.__aexit__ = AsyncMock(return_value=None)
        return mock_cm

    with patch("aiohttp.ClientSession.get", side_effect=side_effect):
        result = await ProviderValidationService.validate_all(
            stt_provider="deepgram",
            stt_key="stt-key",
            llm_provider="siliconflow",
            llm_key="bad-llm-key",
            tts_provider="cartesia",
            tts_key="tts-key",
        )
        assert result is False


@pytest.mark.asyncio
async def test_validate_all_tts_fails():
    # First call (STT) succeeds, second call (LLM) succeeds, third call (TTS) fails
    responses = [200, 200, 401]

    def side_effect(*args, **kwargs):
        st = responses.pop(0) if responses else 200
        mock_resp = MagicMock()
        mock_resp.status = st
        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_cm.__aexit__ = AsyncMock(return_value=None)
        return mock_cm

    with patch("aiohttp.ClientSession.get", side_effect=side_effect):
        result = await ProviderValidationService.validate_all(
            stt_provider="deepgram",
            stt_key="stt-key",
            llm_provider="siliconflow",
            llm_key="llm-key",
            tts_provider="cartesia",
            tts_key="bad-tts-key",
        )
        assert result is False
