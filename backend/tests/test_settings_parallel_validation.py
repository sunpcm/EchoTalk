"""RF-10 有界并行验证测试：验证多 Provider 拨测并发执行、统一总超时与稳定契约。"""

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from database import get_db
from main import app
from models.user import LLMProvider, STTProvider, SubscriptionTier, TTSProvider
from services.validation_service import (
    ProviderValidationResult,
    ProviderValidationService,
)


class MockUser:
    def __init__(self, id, tier):
        self.id = id
        self.subscription_tier = tier


class MockUserSettings:
    def __init__(self, **kwargs):
        self.user_id = kwargs.get("user_id", uuid.uuid4())
        self.is_custom_mode = kwargs.get("is_custom_mode", True)
        self.is_custom_verified = kwargs.get("is_custom_verified", False)
        self.theme = kwargs.get("theme", "warm")
        self.stt_provider = kwargs.get("stt_provider", None)
        self.llm_provider = kwargs.get("llm_provider", None)
        self.llm_model = kwargs.get("llm_model", None)
        self.tts_provider = kwargs.get("tts_provider", None)
        self.encrypted_stt_key = kwargs.get("encrypted_stt_key", None)
        self.encrypted_llm_key = kwargs.get("encrypted_llm_key", None)
        self.encrypted_tts_key = kwargs.get("encrypted_tts_key", None)
        self.stt_key_version = kwargs.get("stt_key_version", "test-v1")
        self.llm_key_version = kwargs.get("llm_key_version", "test-v1")
        self.tts_key_version = kwargs.get("tts_key_version", "test-v1")
        self.stt_is_valid = kwargs.get("stt_is_valid", False)
        self.llm_is_valid = kwargs.get("llm_is_valid", False)
        self.tts_is_valid = kwargs.get("tts_is_valid", False)


@pytest.fixture
def mock_db_with_settings():
    def _setup(user_kwargs=None, settings_kwargs=None):
        mock_db = AsyncMock()
        user_kw = user_kwargs or {}
        settings_kw = settings_kwargs or {}

        mock_user = MockUser(
            id=user_kw.get("id", uuid.uuid4()),
            tier=user_kw.get("tier", SubscriptionTier.pro),
        )
        mock_settings = MockUserSettings(
            user_id=mock_user.id,
            **settings_kw,
        )

        user_result = MagicMock()
        user_result.scalar_one_or_none.return_value = mock_user

        settings_result = MagicMock()
        settings_result.scalar_one_or_none.return_value = mock_settings

        def _exec_side_effect(stmt):
            stmt_str = str(stmt).lower()
            if "users" in stmt_str:
                return user_result
            return settings_result

        mock_db.execute.side_effect = _exec_side_effect
        return mock_db, mock_user, mock_settings

    return _setup


@pytest.mark.asyncio
async def test_three_roles_enter_in_parallel_with_barrier(mock_db_with_settings):
    """三 role 在彼此等待全部启动的屏障下能并行进入，证明同时并发执行而非串行阻塞。"""
    mock_db, _, _ = mock_db_with_settings(
        settings_kwargs={
            "stt_provider": STTProvider.deepgram,
            "llm_provider": LLMProvider.siliconflow,
            "tts_provider": TTSProvider.cartesia,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    barrier = asyncio.Barrier(3)
    entered_roles = []

    async def mock_val_stt(provider, key):
        entered_roles.append("stt")
        await barrier.wait()
        return ProviderValidationResult(True, "verified")

    async def mock_val_llm(provider, key):
        entered_roles.append("llm")
        await barrier.wait()
        return ProviderValidationResult(True, "verified")

    async def mock_val_tts(provider, key):
        entered_roles.append("tts")
        await barrier.wait()
        return ProviderValidationResult(True, "verified")

    with (
        patch(
            "routers.user.ProviderValidationService.validate_stt_key",
            side_effect=mock_val_stt,
        ),
        patch(
            "routers.user.ProviderValidationService.validate_llm_key",
            side_effect=mock_val_llm,
        ),
        patch(
            "routers.user.ProviderValidationService.validate_tts_key",
            side_effect=mock_val_tts,
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/api/user/settings",
                json={
                    "stt_key": "stt-secret",
                    "llm_key": "llm-secret",
                    "tts_key": "tts-secret",
                },
            )

    assert response.status_code == 200
    data = response.json()
    assert data["stt_status"] == "verified"
    assert data["llm_status"] == "verified"
    assert data["tts_status"] == "verified"
    assert set(entered_roles) == {"stt", "llm", "tts"}

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_reverse_completion_order_preserves_failure_order(
    mock_db_with_settings,
):
    """逆序完成时（TTS -> LLM -> STT），422 failures 字段顺序仍严格按 STT/LLM/TTS 组织。"""
    mock_db, _, _ = mock_db_with_settings(
        settings_kwargs={
            "stt_provider": STTProvider.deepgram,
            "llm_provider": LLMProvider.siliconflow,
            "tts_provider": TTSProvider.cartesia,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    tts_finished = asyncio.Event()
    llm_finished = asyncio.Event()
    completion_order = []

    async def mock_val_stt(provider, key):
        await llm_finished.wait()
        completion_order.append("stt")
        return ProviderValidationResult(False, "auth_error")

    async def mock_val_llm(provider, key):
        await tts_finished.wait()
        completion_order.append("llm")
        llm_finished.set()
        return ProviderValidationResult(False, "rate_limited")

    async def mock_val_tts(provider, key):
        completion_order.append("tts")
        tts_finished.set()
        return ProviderValidationResult(False, "provider_error")

    with (
        patch(
            "routers.user.ProviderValidationService.validate_stt_key",
            side_effect=mock_val_stt,
        ),
        patch(
            "routers.user.ProviderValidationService.validate_llm_key",
            side_effect=mock_val_llm,
        ),
        patch(
            "routers.user.ProviderValidationService.validate_tts_key",
            side_effect=mock_val_tts,
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/api/user/settings",
                json={
                    "stt_key": "stt-val",
                    "llm_key": "llm-val",
                    "tts_key": "tts-val",
                },
            )

    assert response.status_code == 422
    assert completion_order == ["tts", "llm", "stt"]
    data = response.json()
    assert data["detail"]["code"] == "provider_key_validation_failed"
    providers_dict = data["detail"]["providers"]
    assert list(providers_dict.keys()) == ["stt", "llm", "tts"]
    assert providers_dict == {
        "stt": "auth_error",
        "llm": "rate_limited",
        "tts": "provider_error",
    }

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_total_timeout_preserves_completed_and_cancels_pending(
    mock_db_with_settings,
):
    """总预算超时时已完成结果被保留，pending role 标 timeout 且被取消/等待完成。"""
    mock_db, _, _ = mock_db_with_settings(
        settings_kwargs={
            "stt_provider": STTProvider.deepgram,
            "llm_provider": LLMProvider.siliconflow,
            "tts_provider": TTSProvider.cartesia,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    tts_cancelled = False
    never_event = asyncio.Event()

    async def mock_val_stt(provider, key):
        return ProviderValidationResult(True, "verified")

    async def mock_val_llm(provider, key):
        return ProviderValidationResult(True, "verified")

    async def mock_val_tts(provider, key):
        nonlocal tts_cancelled
        try:
            await never_event.wait()
            return ProviderValidationResult(True, "verified")
        except asyncio.CancelledError:
            tts_cancelled = True
            raise

    with (
        patch(
            "routers.user.ProviderValidationService.validate_stt_key",
            side_effect=mock_val_stt,
        ),
        patch(
            "routers.user.ProviderValidationService.validate_llm_key",
            side_effect=mock_val_llm,
        ),
        patch(
            "routers.user.ProviderValidationService.validate_tts_key",
            side_effect=mock_val_tts,
        ),
        patch.object(ProviderValidationService, "TOTAL_TIMEOUT_SECONDS", 0.05),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/api/user/settings",
                json={
                    "stt_key": "stt-secret",
                    "llm_key": "llm-secret",
                    "tts_key": "tts-secret",
                },
            )

    assert response.status_code == 422
    data = response.json()
    assert data["detail"]["code"] == "provider_key_validation_failed"
    # 成功 role 不进入 failures；未完成 role 使用 timeout
    assert data["detail"]["providers"] == {"tts": "timeout"}
    assert tts_cancelled is True

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_single_role_and_zero_role_no_extra_tasks(mock_db_with_settings):
    """单 role 与零 role 不产生额外任务；变化但缺 provider/key 的 role 不创建空拨测。"""
    mock_db, _, _ = mock_db_with_settings(
        settings_kwargs={
            "stt_provider": STTProvider.deepgram,
            "llm_provider": LLMProvider.siliconflow,
            "tts_provider": TTSProvider.cartesia,
            "stt_is_valid": True,
            "llm_is_valid": True,
            "tts_is_valid": True,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    mock_stt = AsyncMock(return_value=ProviderValidationResult(True, "verified"))
    mock_llm = AsyncMock(return_value=ProviderValidationResult(True, "verified"))
    mock_tts = AsyncMock(return_value=ProviderValidationResult(True, "verified"))

    with (
        patch("routers.user.ProviderValidationService.validate_stt_key", mock_stt),
        patch("routers.user.ProviderValidationService.validate_llm_key", mock_llm),
        patch("routers.user.ProviderValidationService.validate_tts_key", mock_tts),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # 1. 零 role 变更（仅改 theme）
            resp1 = await client.put("/api/user/settings", json={"theme": "dark"})
            assert resp1.status_code == 200
            mock_stt.assert_not_called()
            mock_llm.assert_not_called()
            mock_tts.assert_not_called()

            # 2. 单 role 变更（仅传 stt_key）
            resp2 = await client.put(
                "/api/user/settings", json={"stt_key": "new-stt-key"}
            )
            assert resp2.status_code == 200
            assert mock_stt.call_count == 1
            assert mock_llm.call_count == 0
            assert mock_tts.call_count == 0

            # 3. 变化但无 key（例如库中无 llm 密文，切换 provider 但未传 key）
            mock_stt.reset_mock()
            mock_llm.reset_mock()
            mock_tts.reset_mock()

            resp3 = await client.put(
                "/api/user/settings", json={"llm_provider": "openrouter"}
            )
            assert resp3.status_code == 200
            mock_stt.assert_not_called()
            mock_llm.assert_not_called()
            mock_tts.assert_not_called()

    app.dependency_overrides = {}
