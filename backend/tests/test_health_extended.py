import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from database import get_db
from models.user import SubscriptionTier
from unittest.mock import AsyncMock, patch, MagicMock
from config import settings
from dependencies import MOCK_USER_ID
from jose import jwt
import uuid

TEST_USER_ID = MOCK_USER_ID
TEST_TOKEN = jwt.encode({"sub": TEST_USER_ID, "email": "test@example.com"}, settings.JWT_SECRET_KEY, algorithm="HS256")
AUTH_HEADERS = {"Authorization": f"Bearer {TEST_TOKEN}"}

class MockUser:
    def __init__(self, id, tier):
        self.id = id
        self.subscription_tier = tier
        self.settings = None

class MockUserSettings:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

@pytest.mark.asyncio
async def test_health_ready_success():
    mock_db = AsyncMock()

    mock_user_result = MagicMock()
    mock_user = MockUser(id=uuid.UUID(TEST_USER_ID), tier=SubscriptionTier.premium)
    mock_settings = MockUserSettings(is_custom_mode=False)
    mock_user.settings = mock_settings
    mock_user_result.scalar_one_or_none.return_value = mock_user

    mock_db.execute.return_value = mock_user_result

    app.dependency_overrides[get_db] = lambda: mock_db

    orig_mock_db = settings.USE_MOCK_DB
    orig_mock_livekit = settings.USE_MOCK_LIVEKIT
    orig_mock_llm = settings.USE_MOCK_LLM

    try:
        settings.USE_MOCK_DB = False
        settings.USE_MOCK_LIVEKIT = False
        settings.USE_MOCK_LLM = False
        settings.LIVEKIT_URL = "test"
        settings.LIVEKIT_API_KEY = "test"
        settings.LIVEKIT_API_SECRET = "test"
        settings.SILICONFLOW_API_KEY = "test"

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/health/ready", headers=AUTH_HEADERS)

        assert response.status_code == 200
    finally:
        settings.USE_MOCK_DB = orig_mock_db
        settings.USE_MOCK_LIVEKIT = orig_mock_livekit
        settings.USE_MOCK_LLM = orig_mock_llm
        app.dependency_overrides = {}

@pytest.mark.asyncio
async def test_health_ready_fail_custom_mode_not_verified():
    mock_db = AsyncMock()

    mock_user_result = MagicMock()
    mock_user = MockUser(id=uuid.UUID(TEST_USER_ID), tier=SubscriptionTier.free)
    mock_settings = MockUserSettings(
        is_custom_mode=True,
        is_custom_verified=False,
        encrypted_llm_key=None
    )
    mock_user.settings = mock_settings
    mock_user_result.scalar_one_or_none.return_value = mock_user

    mock_db.execute.return_value = mock_user_result

    app.dependency_overrides[get_db] = lambda: mock_db

    orig_mock_db = settings.USE_MOCK_DB
    orig_mock_livekit = settings.USE_MOCK_LIVEKIT
    orig_mock_llm = settings.USE_MOCK_LLM

    try:
        settings.USE_MOCK_DB = False
        settings.USE_MOCK_LIVEKIT = False
        settings.USE_MOCK_LLM = False
        settings.LIVEKIT_URL = "test"
        settings.LIVEKIT_API_KEY = "test"
        settings.LIVEKIT_API_SECRET = "test"

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/health/ready", headers=AUTH_HEADERS)

        assert response.status_code == 503
        data = response.json()
        assert "errors" in data["detail"]
        assert "config" in data["detail"]["errors"]
    finally:
        settings.USE_MOCK_DB = orig_mock_db
        settings.USE_MOCK_LIVEKIT = orig_mock_livekit
        settings.USE_MOCK_LLM = orig_mock_llm
        app.dependency_overrides = {}

@pytest.mark.asyncio
async def test_health_ready_fail_free_user_no_custom_mode():
    mock_db = AsyncMock()

    mock_user_result = MagicMock()
    mock_user = MockUser(id=uuid.UUID(TEST_USER_ID), tier=SubscriptionTier.free)
    mock_settings = MockUserSettings(
        is_custom_mode=False
    )
    mock_user.settings = mock_settings
    mock_user_result.scalar_one_or_none.return_value = mock_user

    mock_db.execute.return_value = mock_user_result

    app.dependency_overrides[get_db] = lambda: mock_db

    orig_mock_db = settings.USE_MOCK_DB
    orig_mock_livekit = settings.USE_MOCK_LIVEKIT
    orig_mock_llm = settings.USE_MOCK_LLM

    try:
        settings.USE_MOCK_DB = False
        settings.USE_MOCK_LIVEKIT = False
        settings.USE_MOCK_LLM = False
        settings.LIVEKIT_URL = "test"
        settings.LIVEKIT_API_KEY = "test"
        settings.LIVEKIT_API_SECRET = "test"

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/health/ready", headers=AUTH_HEADERS)

        assert response.status_code == 503
        data = response.json()
        assert "errors" in data["detail"]
        assert "auth" in data["detail"]["errors"]
    finally:
        settings.USE_MOCK_DB = orig_mock_db
        settings.USE_MOCK_LIVEKIT = orig_mock_livekit
        settings.USE_MOCK_LLM = orig_mock_llm
        app.dependency_overrides = {}
