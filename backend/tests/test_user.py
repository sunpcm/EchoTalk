import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport
import uuid

from main import app
from models.user import SubscriptionTier, STTProvider, LLMProvider, TTSProvider
from database import get_db
from routers.user import get_key_status


def test_get_key_status():
    assert get_key_status(has_key=False, is_valid=True) == "unconfigured"
    assert get_key_status(has_key=False, is_valid=False) == "unconfigured"
    assert get_key_status(has_key=False, is_valid=None) == "unconfigured"
    assert get_key_status(has_key=True, is_valid=False) == "error"
    assert get_key_status(has_key=True, is_valid=True) == "verified"
    assert get_key_status(has_key=True, is_valid=None) == "unconfigured"


class MockUser:
    def __init__(self, id, tier):
        self.id = id
        self.subscription_tier = tier


class MockUserSettings:
    def __init__(self, **kwargs):
        self.is_custom_mode = kwargs.get("is_custom_mode", False)
        self.is_custom_verified = kwargs.get("is_custom_verified", False)
        self.encrypted_stt_key = kwargs.get("encrypted_stt_key", None)
        self.encrypted_llm_key = kwargs.get("encrypted_llm_key", None)
        self.encrypted_tts_key = kwargs.get("encrypted_tts_key", None)
        self.stt_provider = kwargs.get("stt_provider", None)
        self.llm_provider = kwargs.get("llm_provider", None)
        self.tts_provider = kwargs.get("tts_provider", None)
        self.llm_model = kwargs.get("llm_model", None)
        self.stt_is_valid = kwargs.get("stt_is_valid", False)
        self.llm_is_valid = kwargs.get("llm_is_valid", False)
        self.tts_is_valid = kwargs.get("tts_is_valid", False)


@pytest.mark.asyncio
@patch("routers.user.select")
async def test_get_user_settings(mock_select):
    mock_db = AsyncMock()

    mock_user_result = MagicMock()
    mock_user = MockUser(id=uuid.uuid4(), tier=SubscriptionTier.free)
    mock_user_result.scalar_one_or_none.return_value = mock_user

    mock_settings_result = MagicMock()
    mock_settings = MockUserSettings(is_custom_mode=False, is_custom_verified=False)
    mock_settings_result.scalar_one_or_none.return_value = mock_settings

    mock_db.execute.side_effect = [mock_user_result, mock_settings_result]

    app.dependency_overrides[get_db] = lambda: mock_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/user/settings")

    assert response.status_code == 200
    data = response.json()
    assert data["subscription_tier"] == "free"
    assert data["is_custom_mode"] is False
    assert data["is_custom_verified"] is False

    app.dependency_overrides = {}


@pytest.mark.asyncio
@patch("routers.user.select")
async def test_get_user_settings_no_row_exists(mock_select):
    mock_db = AsyncMock()

    mock_user_result = MagicMock()
    mock_user = MockUser(id=uuid.uuid4(), tier=SubscriptionTier.pro)
    mock_user_result.scalar_one_or_none.return_value = mock_user

    mock_settings_result = MagicMock()
    mock_settings_result.scalar_one_or_none.return_value = None

    mock_db.execute.side_effect = [mock_user_result, mock_settings_result]

    app.dependency_overrides[get_db] = lambda: mock_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/user/settings")

    assert response.status_code == 200
    data = response.json()
    assert data["subscription_tier"] == "pro"
    assert data["is_custom_mode"] is True
    assert data["has_stt_key"] is False
    assert data["has_llm_key"] is False
    assert data["has_tts_key"] is False

    app.dependency_overrides = {}


@pytest.mark.asyncio
@patch("routers.user.select")
async def test_get_user_settings_user_not_found(mock_select):
    mock_db = AsyncMock()

    mock_user_result = MagicMock()
    mock_user_result.scalar_one_or_none.return_value = None

    mock_settings_result = MagicMock()
    mock_settings_result.scalar_one_or_none.return_value = None

    mock_db.execute.side_effect = [mock_user_result, mock_settings_result]

    app.dependency_overrides[get_db] = lambda: mock_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/user/settings")

    assert response.status_code == 200
    data = response.json()
    assert data["subscription_tier"] == "free"

    app.dependency_overrides = {}


@pytest.mark.asyncio
@patch("routers.user.select")
async def test_get_user_settings_with_configured_keys(mock_select):
    mock_db = AsyncMock()

    mock_user_result = MagicMock()
    mock_user = MockUser(id=uuid.uuid4(), tier=SubscriptionTier.pro)
    mock_user_result.scalar_one_or_none.return_value = mock_user

    mock_settings_result = MagicMock()
    mock_settings = MockUserSettings(
        is_custom_mode=True,
        is_custom_verified=True,
        stt_provider=STTProvider.deepgram,
        llm_provider=LLMProvider.siliconflow,
        tts_provider=TTSProvider.cartesia,
        llm_model="Qwen/Qwen2.5-7B-Instruct",
        encrypted_stt_key="enc_stt",
        encrypted_llm_key="enc_llm",
        encrypted_tts_key="enc_tts",
        stt_is_valid=True,
        llm_is_valid=False,
        tts_is_valid=None,
    )
    mock_settings_result.scalar_one_or_none.return_value = mock_settings

    mock_db.execute.side_effect = [mock_user_result, mock_settings_result]

    app.dependency_overrides[get_db] = lambda: mock_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/user/settings")

    assert response.status_code == 200
    data = response.json()
    assert data["subscription_tier"] == "pro"
    assert data["is_custom_mode"] is True
    assert data["is_custom_verified"] is True
    assert data["stt_provider"] == "deepgram"
    assert data["llm_provider"] == "siliconflow"
    assert data["tts_provider"] == "cartesia"
    assert data["llm_model"] == "Qwen/Qwen2.5-7B-Instruct"
    assert data["has_stt_key"] is True
    assert data["has_llm_key"] is True
    assert data["has_tts_key"] is True
    assert data["stt_status"] == "verified"
    assert data["llm_status"] == "error"
    assert data["tts_status"] == "unconfigured"

    app.dependency_overrides = {}


@pytest.mark.asyncio
@patch("routers.user.select")
@patch(
    "routers.user.ProviderValidationService.validate_stt_key",
    new_callable=AsyncMock,
)
@patch(
    "routers.user.ProviderValidationService.validate_llm_key",
    new_callable=AsyncMock,
)
@patch(
    "routers.user.ProviderValidationService.validate_tts_key",
    new_callable=AsyncMock,
)
async def test_update_user_settings(
    mock_val_tts, mock_val_llm, mock_val_stt, mock_select
):
    mock_db = AsyncMock()

    mock_settings_result = MagicMock()
    mock_settings = MockUserSettings(is_custom_mode=False, is_custom_verified=False)

    mock_settings_result.scalar_one_or_none.return_value = mock_settings

    mock_user_result = MagicMock()
    mock_user = MockUser(id=uuid.uuid4(), tier=SubscriptionTier.free)
    mock_user_result.scalar_one_or_none.return_value = mock_user

    mock_db.execute.side_effect = [mock_settings_result, mock_user_result]

    app.dependency_overrides[get_db] = lambda: mock_db

    mock_val_stt.return_value = True
    mock_val_llm.return_value = True
    mock_val_tts.return_value = True

    with patch("routers.user.encrypt_api_key", return_value="encrypted_key"):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/api/user/settings",
                json={
                    "stt_provider": "deepgram",
                    "stt_key": "new_key",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["stt_provider"] == "deepgram"
        assert data["has_stt_key"] is True

    app.dependency_overrides = {}


@pytest.mark.asyncio
@patch("routers.user.select")
async def test_update_user_settings_cannot_disable_custom_mode_on_free_tier(
    mock_select,
):
    mock_db = AsyncMock()

    mock_user_result = MagicMock()
    mock_user = MockUser(id=uuid.uuid4(), tier=SubscriptionTier.free)
    mock_user_result.scalar_one_or_none.return_value = mock_user

    mock_db.execute.return_value = mock_user_result

    app.dependency_overrides[get_db] = lambda: mock_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.put(
            "/api/user/settings", json={"is_custom_mode": False}
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "Free tier users cannot disable custom mode."

    app.dependency_overrides = {}
