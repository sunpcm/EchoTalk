import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport
import uuid
from pydantic import ValidationError

from main import app
from models.user import SubscriptionTier
from database import get_db
from schemas.user import UserSettingsUpdate


class MockUser:
    def __init__(self, id, tier):
        self.id = id
        self.subscription_tier = tier


class MockUserSettings:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
        self.encrypted_stt_key = None
        self.encrypted_llm_key = None
        self.encrypted_tts_key = None
        self.stt_provider = None
        self.llm_provider = None
        self.tts_provider = None
        self.llm_model = None
        self.stt_is_valid = False
        self.llm_is_valid = False
        self.tts_is_valid = False


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
@patch(
    "routers.user.ProviderValidationService.validate_stt_key", new_callable=AsyncMock
)
@patch(
    "routers.user.ProviderValidationService.validate_llm_key", new_callable=AsyncMock
)
@patch(
    "routers.user.ProviderValidationService.validate_tts_key", new_callable=AsyncMock
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


def test_key_must_not_be_empty_valid():
    """测试 stt_key, llm_key, tts_key 传入有效值及前后空格拆分。"""
    update = UserSettingsUpdate(
        stt_key="  stt_secret_123  ",
        llm_key="llm_secret_456",
        tts_key="  tts_secret_789",
    )
    assert update.stt_key == "stt_secret_123"
    assert update.llm_key == "llm_secret_456"
    assert update.tts_key == "tts_secret_789"


def test_key_must_not_be_empty_none():
    """测试 API Key 为 None 时校验通过。"""
    update = UserSettingsUpdate(stt_key=None, llm_key=None, tts_key=None)
    assert update.stt_key is None
    assert update.llm_key is None
    assert update.tts_key is None

    # 默认未传字段也为 None
    default_update = UserSettingsUpdate()
    assert default_update.stt_key is None
    assert default_update.llm_key is None
    assert default_update.tts_key is None


@pytest.mark.parametrize("key_field", ["stt_key", "llm_key", "tts_key"])
@pytest.mark.parametrize("invalid_value", ["", "   ", "\t\n  "])
def test_key_must_not_be_empty_invalid(key_field, invalid_value):
    """测试 API Key 为空字符串或全空格字符串时抛出 ValidationError。"""
    with pytest.raises(ValidationError) as exc_info:
        UserSettingsUpdate(**{key_field: invalid_value})

    assert "API Key 不能为空字符串" in str(exc_info.value)
