import uuid

import pytest

from auth import CurrentUser
from dependencies import MOCK_USER_ID, get_current_user
from main import app


@pytest.fixture(autouse=True)
def authenticated_route_user():
    """既有路由测试聚焦业务；认证拒绝路径由专门的 auth 测试覆盖。"""

    async def override_current_user() -> CurrentUser:
        return CurrentUser(
            id=uuid.UUID(MOCK_USER_ID),
            email="test@example.com",
            issuer="urn:echotalk:test",
            subject="route-test-user",
        )

    app.dependency_overrides[get_current_user] = override_current_user
    yield
    app.dependency_overrides.pop(get_current_user, None)
