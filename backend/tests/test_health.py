import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from main import app
from routers.health import health_check

client = TestClient(app)


AUTH_HEADERS = {"Authorization": "Bearer test-dev-token"}


def test_read_health_unauthorized():
    """测试未传递 Authorization 头请求 /api/health 应返回 401 Unauthorized。"""
    from dependencies import get_current_user

    # conftest中有autouse的override，这里暂时pop以测试未授权逻辑
    override = app.dependency_overrides.pop(get_current_user, None)
    try:
        response = client.get("/api/health")
        assert response.status_code == 401
    finally:
        if override:
            app.dependency_overrides[get_current_user] = override


def test_read_health():
    response = client.get("/api/health", headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "echo-talk"}


@pytest.mark.asyncio
async def test_health_check_function_direct():
    """测试 health_check 函数直接调用的返回值。"""
    res = await health_check(current_user=None)
    assert res == {"status": "ok", "service": "echo-talk"}


@pytest.mark.asyncio
async def test_health_check_async_client():
    """测试通过 AsyncClient 异步调用 /api/health 接口。"""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.get("/api/health", headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "echo-talk"}


def test_health_check_method_not_allowed():
    """测试对 /api/health 发送不支持的 POST 请求，应返回 405 Method Not Allowed。"""
    response = client.post("/api/health", headers=AUTH_HEADERS)
    assert response.status_code == 405
