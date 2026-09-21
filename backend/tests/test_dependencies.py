import uuid
import pytest

from dependencies import MOCK_USER, MOCK_USER_ID, get_current_user


def test_mock_user_constants():
    assert isinstance(MOCK_USER_ID, str)
    # Check that MOCK_USER_ID is a valid UUID string
    val = uuid.UUID(MOCK_USER_ID)
    assert str(val) == MOCK_USER_ID

    assert isinstance(MOCK_USER, dict)
    assert MOCK_USER["id"] == MOCK_USER_ID
    assert "email" in MOCK_USER


@pytest.mark.asyncio
async def test_get_current_user_default():
    user = await get_current_user()
    assert user == MOCK_USER


@pytest.mark.asyncio
async def test_get_current_user_with_authorization_header():
    user = await get_current_user(authorization="Bearer test_token_123")
    assert user == MOCK_USER
