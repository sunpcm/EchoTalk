"""通话协议能力发现接口契约测试 (CP-02 §7)。

验证只读 GET /api/call-capabilities：
1. disabled 与 livekit_cloud 两种模式的响应精确性与字段集合限制；
2. Cache-Control: no-store 响应头；
3. 移除 autouse 认证 override 时未认证与无效认证的真实 401 拒绝与恢复；
4. 严格只读契约：触发 Provider 媒体调用或数据库写入操作时测试必须失败；
5. 敏感信息隔离：绝不泄露 LiveKit URL、key/secret、Token、用户数据或配置。
"""

from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from livekit.api import LiveKitAPI
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from dependencies import get_current_user
from main import app


@pytest.mark.asyncio
async def test_call_capabilities_disabled_mode():
    """验证 disabled 模式下精确返回 protocol_version=1, call_lease_mode=disabled 与 no-store。"""
    with patch.object(settings, "CALL_LEASE_MODE", "disabled"):
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
        ) as client:
            res = await client.get("/api/call-capabilities")

    assert res.status_code == 200
    assert res.headers.get("cache-control") == "no-store"
    body = res.json()
    assert body == {"protocol_version": 1, "call_lease_mode": "disabled"}
    assert set(body.keys()) == {"protocol_version", "call_lease_mode"}
    # 敏感信息零泄露
    for forbidden_key in (
        "livekit_url",
        "url",
        "token",
        "key",
        "secret",
        "user_id",
        "email",
    ):
        assert forbidden_key not in body


@pytest.mark.asyncio
async def test_call_capabilities_livekit_cloud_mode():
    """验证 livekit_cloud 模式下精确返回 protocol_version=1, call_lease_mode=livekit_cloud 与 no-store。"""
    with patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"):
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
        ) as client:
            res = await client.get("/api/call-capabilities")

    assert res.status_code == 200
    assert res.headers.get("cache-control") == "no-store"
    body = res.json()
    assert body == {"protocol_version": 1, "call_lease_mode": "livekit_cloud"}
    assert set(body.keys()) == {"protocol_version", "call_lease_mode"}


@pytest.mark.asyncio
async def test_call_capabilities_unknown_mode_fallback():
    """验证未知或非法模式安全回退为 disabled 默认行为。"""
    with patch.object(settings, "CALL_LEASE_MODE", "unknown_mode"):
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
        ) as client:
            res = await client.get("/api/call-capabilities")

    assert res.status_code == 200
    assert res.json()["call_lease_mode"] == "disabled"


@pytest.mark.asyncio
async def test_call_capabilities_authentication_required_and_restore():
    """移除 autouse 认证 override，验证缺失与无效凭据均返回 401，并确保 override 恢复。"""
    saved_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides.pop(get_current_user, None)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
        ) as client:
            # 1. 缺失认证头 -> 401
            r_no_auth = await client.get("/api/call-capabilities")
            assert r_no_auth.status_code == 401
            assert r_no_auth.headers.get("www-authenticate") == "Bearer"

            # 2. 无效 Bearer Token -> 401
            r_invalid_token = await client.get(
                "/api/call-capabilities",
                headers={"Authorization": "Bearer invalid-token-string"},
            )
            assert r_invalid_token.status_code == 401

            # 3. 错误 Scheme -> 401
            r_wrong_scheme = await client.get(
                "/api/call-capabilities",
                headers={"Authorization": "Basic dXNlcjpwYXNz"},
            )
            assert r_wrong_scheme.status_code == 401
    finally:
        # 严格恢复 autouse override，确保不污染后续测试
        if saved_override is not None:
            app.dependency_overrides[get_current_user] = saved_override
        else:
            app.dependency_overrides.pop(get_current_user, None)

    # 验证恢复后在 autouse override 下请求正常成功
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://testserver",
    ) as client:
        res_restored = await client.get("/api/call-capabilities")
        assert res_restored.status_code == 200


@pytest.mark.asyncio
async def test_call_capabilities_triggers_no_db_write_or_provider_calls():
    """严格断言：若触发任何数据库写入（add/commit/flush）或 Provider 媒体调用，测试必须失败。"""
    fail_msg_db = (
        "DB write operation must not be called during call capabilities discovery"
    )
    fail_msg_provider = (
        "Provider media call must not be triggered during call capabilities discovery"
    )

    with (
        patch.object(AsyncSession, "add", side_effect=AssertionError(fail_msg_db)),
        patch.object(AsyncSession, "commit", side_effect=AssertionError(fail_msg_db)),
        patch.object(AsyncSession, "flush", side_effect=AssertionError(fail_msg_db)),
        patch(
            "services.call_leases.revoke_cloud_participant",
            side_effect=AssertionError(fail_msg_provider),
        ),
        patch.object(
            LiveKitAPI, "__init__", side_effect=AssertionError(fail_msg_provider)
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
        ) as client:
            res = await client.get("/api/call-capabilities")
            assert res.status_code == 200
            assert res.json()["protocol_version"] == 1
