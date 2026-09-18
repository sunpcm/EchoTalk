import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport
from main import app
from routers.health import health_check

client = TestClient(app)


def test_read_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "echo-talk"}


@pytest.mark.asyncio
async def test_health_check_function_direct():
    """测试 health_check 函数直接调用的返回值。"""
    res = await health_check()
    assert res == {"status": "ok", "service": "echo-talk"}


@pytest.mark.asyncio
async def test_health_check_async_client():
    """测试通过 AsyncClient 异步调用 /api/health 接口。"""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "echo-talk"}


def test_health_check_method_not_allowed():
    """测试对 /api/health 发送不支持的 POST 请求，应返回 405 Method Not Allowed。"""
    response = client.post("/api/health")
    assert response.status_code == 405
