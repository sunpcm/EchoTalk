import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from auth import CurrentUser
from dependencies import MOCK_USER_ID, get_current_user


def test_dev_user_id_is_stable_uuid():
    assert str(uuid.UUID(MOCK_USER_ID)) == MOCK_USER_ID


@pytest.mark.asyncio
@pytest.mark.parametrize("authorization", [None, "", "Basic value", "Bearer "])
async def test_missing_or_malformed_authorization_is_rejected(authorization):
    with pytest.raises(HTTPException) as error:
        await get_current_user(authorization=authorization, db=AsyncMock())
    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_invalid_dev_token_is_rejected():
    with pytest.raises(HTTPException) as error:
        await get_current_user(authorization="Bearer forged", db=AsyncMock())
    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_explicit_dev_token_provisions_typed_current_user():
    db = AsyncMock()
    db.add = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute.return_value = result
    db.get.return_value = None
    db.scalar.return_value = None

    with (
        patch("dependencies.settings.AUTH_MODE", "dev"),
        patch("dependencies.settings.DEV_AUTH_TOKEN", "mock-token"),
    ):
        user = await get_current_user(authorization="Bearer mock-token", db=db)

    assert isinstance(user, CurrentUser)
    assert str(user.id) == MOCK_USER_ID
    assert user.subject == "local-developer"
    db.add.assert_called_once()
    db.flush.assert_awaited_once()
