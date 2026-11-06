"""HTTP compatibility for readiness; all configuration is synthetic and restored."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from database import get_db
from main import app
from routers import health


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_user", [False, True])
async def test_readiness_http_contract(monkeypatch, missing_user):
    cfg = SimpleNamespace(
        USE_MOCK_DB=False,
        USE_MOCK_LIVEKIT=True,
        USE_MOCK_STT=False,
        USE_MOCK_LLM=False,
        USE_MOCK_TTS=False,
    )
    monkeypatch.setattr(health, "settings", cfg)
    result = MagicMock()
    result.scalar_one_or_none.return_value = (
        None if missing_user else SimpleNamespace(settings=None)
    )
    db = AsyncMock()
    db.execute.return_value = result
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            basic = await client.get("/api/health")
            response = await client.get("/api/health/ready")
        assert basic.json() == {"status": "ok", "service": "echo-talk"}
        assert response.status_code == 503
        assert response.json() == {
            "detail": {
                "status": "not_ready",
                "code": "user_unavailable" if missing_user else "settings_required",
                "errors": (
                    {"user": "User configuration is unavailable"}
                    if missing_user
                    else {"config": "Practice settings are required"}
                ),
            }
        }
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
