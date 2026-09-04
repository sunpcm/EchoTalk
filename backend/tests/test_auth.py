import uuid
from datetime import timedelta
import pytest
from httpx import AsyncClient, ASGITransport
from jose import jwt

from main import app
from config import settings
from dependencies import create_access_token, MOCK_USER_ID, ALGORITHM


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
async def test_auth_missing_user_id_claim():
    token = jwt.encode(
        {"email": "test@example.com"}, settings.JWT_SECRET_KEY, algorithm=ALGORITHM
    )
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
async def test_auth_valid_token():
    user_id = str(uuid.uuid4())
    token = create_access_token({"sub": user_id, "email": "user@example.com"})

    # Use health route or settings route with dependency
    from dependencies import get_current_user

    user_dict = await get_current_user(authorization=f"Bearer {token}")
    assert user_dict["id"] == user_id
    assert user_dict["email"] == "user@example.com"
