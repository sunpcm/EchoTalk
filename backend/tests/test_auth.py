import pytest
from fastapi import HTTPException
from jose import jwt

from config import settings
from dependencies import get_current_user


@pytest.mark.asyncio
async def test_get_current_user_valid_token():
    payload = {"sub": "user-123", "email": "user@example.com"}
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    header = f"Bearer {token}"

    user = await get_current_user(authorization=header)

    assert user == {"id": "user-123", "email": "user@example.com"}


@pytest.mark.asyncio
async def test_get_current_user_missing_header():
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(authorization=None)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Could not validate credentials"


@pytest.mark.asyncio
async def test_get_current_user_invalid_header_format():
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(authorization="InvalidHeaderFormat")

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_invalid_signature():
    payload = {"sub": "user-123", "email": "user@example.com"}
    token = jwt.encode(payload, "wrong-secret-key", algorithm="HS256")
    header = f"Bearer {token}"

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(authorization=header)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_missing_sub_and_id():
    payload = {"email": "user@example.com"}
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    header = f"Bearer {token}"

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(authorization=header)

    assert exc_info.value.status_code == 401
