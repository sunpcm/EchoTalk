import logging
import uuid

import pytest

from auth import CurrentUser
from dependencies import MOCK_USER_ID, get_current_user
from livekit_agent import log_redaction
from main import app


@pytest.fixture(autouse=True)
def isolated_log_redaction():
    """Agent 启动/entrypoint 会安装进程级脱敏钩子，逐用例恢复，避免跨用例泄漏。"""
    original_make_record = logging.Logger.__dict__["makeRecord"]
    yield
    logging.Logger.makeRecord = original_make_record
    log_redaction._clear_registered_secrets()


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
