import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock
import pytest
from httpx import AsyncClient, ASGITransport
from jose import jwt

from main import app
from config import settings
from database import get_db
from dependencies import create_access_token, MOCK_USER_ID, MOCK_USER, ALGORITHM


@pytest.mark.asyncio
async def test_auth_missing_header():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/user/settings")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.asyncio
async def test_auth_invalid_scheme():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/user/settings", headers={"Authorization": "Basic invalidtoken123"}
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_invalid_token_string():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/user/settings",
            headers={"Authorization": "Bearer not-a-valid-jwt-token"},
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_expired_token():
    token = create_access_token(
        {"sub": MOCK_USER_ID, "email": "test@example.com"},
        expires_delta=timedelta(seconds=-10),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/user/settings", headers={"Authorization": f"Bearer {token}"}
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_missing_exp_claim():
    token = jwt.encode(
        {"sub": MOCK_USER_ID, "email": "test@example.com"},
        settings.JWT_SECRET_KEY,
        algorithm=ALGORITHM,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/user/settings", headers={"Authorization": f"Bearer {token}"}
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_missing_user_id_claim():
    token = create_access_token({"email": "test@example.com"})
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/user/settings", headers={"Authorization": f"Bearer {token}"}
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_invalid_uuid_claim():
    token = create_access_token({"sub": "not-a-uuid", "email": "test@example.com"})
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/user/settings", headers={"Authorization": f"Bearer {token}"}
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_mock_token_fallback():
    mock_db = AsyncMock()
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        from dependencies import get_current_user

        user = await get_current_user(authorization="Bearer mock-token", db=mock_db)
        assert user == MOCK_USER
    finally:
        app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_auth_user_not_found_in_db():
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = mock_result

    app.dependency_overrides[get_db] = lambda: mock_db

    orig_mock_db = settings.USE_MOCK_DB
    user_id = str(uuid.uuid4())
    token = create_access_token({"sub": user_id, "email": "nonexistent@example.com"})

    try:
        settings.USE_MOCK_DB = False
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/api/user/settings", headers={"Authorization": f"Bearer {token}"}
            )
        assert response.status_code == 401
    finally:
        settings.USE_MOCK_DB = orig_mock_db
        app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_auth_valid_token():
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_user = MagicMock()
    mock_user.id = uuid.uuid4()
    mock_result.scalar_one_or_none.return_value = mock_user
    mock_db.execute.return_value = mock_result

    user_id = str(uuid.uuid4())
    token = create_access_token({"sub": user_id, "email": "user@example.com"})

    from dependencies import get_current_user

    user_dict = await get_current_user(authorization=f"Bearer {token}", db=mock_db)
    assert user_dict["id"] == user_id
    assert user_dict["email"] == "user@example.com"
