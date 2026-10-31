"""RF-10 凭据惰性解密回归测试：验证用户设置更新仅在必要时解密凭据。"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from database import get_db
from main import app
from models.user import LLMProvider, STTProvider, SubscriptionTier, TTSProvider
from utils.crypto import DecryptedCredential, EncryptedCredential


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
    """提供带有预设 User 与 UserSettings 的 Mock DB fixture。"""

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

        mock_db.execute.side_effect = [user_result, settings_result]
        return mock_db, mock_user, mock_settings

    return _setup


@pytest.mark.asyncio
async def test_non_sensitive_update_does_not_decrypt_corrupted_keys(
    mock_db_with_settings,
):
    """非敏感设置更新（theme/llm_model/is_custom_mode）不触碰旧密文，即便密文损坏也能成功更新。"""
    mock_db, _, mock_settings = mock_db_with_settings(
        settings_kwargs={
            "encrypted_stt_key": "corrupted_stt_ciphertext",
            "encrypted_llm_key": "corrupted_llm_ciphertext",
            "encrypted_tts_key": "corrupted_tts_ciphertext",
            "stt_is_valid": True,
            "llm_is_valid": True,
            "tts_is_valid": True,
            "is_custom_verified": True,
            "theme": "warm",
            "llm_model": "old-model",
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    # 如果调用了解密，抛出解密损坏异常
    with patch(
        "routers.user.decrypt_api_key",
        side_effect=ValueError("Corrupted key payload"),
    ) as mock_decrypt:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/api/user/settings",
                json={
                    "theme": "dark",
                    "llm_model": "new-qwen-model",
                },
            )

    assert response.status_code == 200
    data = response.json()
    assert data["theme"] == "dark"
    assert data["llm_model"] == "new-qwen-model"
    assert data["stt_status"] == "verified"
    assert data["llm_status"] == "verified"
    assert data["tts_status"] == "verified"
    assert data["is_custom_verified"] is True
    # 核心断言：decrypt_api_key 零调用
    mock_decrypt.assert_not_called()

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_empty_update_does_not_decrypt_or_validate(mock_db_with_settings):
    """空更新请求 {} 零解密、零拨测，并完整保留当前配置状态。"""
    mock_db, _, _ = mock_db_with_settings(
        settings_kwargs={
            "encrypted_stt_key": "some_ciphertext",
            "stt_is_valid": True,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    with (
        patch("routers.user.decrypt_api_key") as mock_decrypt,
        patch(
            "routers.user.ProviderValidationService.validate_stt_key",
            new_callable=AsyncMock,
        ) as mock_val_stt,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put("/api/user/settings", json={})

    assert response.status_code == 200
    mock_decrypt.assert_not_called()
    mock_val_stt.assert_not_called()

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_same_provider_resubmission_does_not_decrypt_or_revalidate(
    mock_db_with_settings,
):
    """同 provider 原值重复提交不构成变化，不读取/解密旧密文，不调用拨测。"""
    mock_db, _, _ = mock_db_with_settings(
        settings_kwargs={
            "stt_provider": STTProvider.deepgram,
            "encrypted_stt_key": "existing_stt_ciphertext",
            "stt_is_valid": True,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    with (
        patch("routers.user.decrypt_api_key") as mock_decrypt,
        patch(
            "routers.user.ProviderValidationService.validate_stt_key",
            new_callable=AsyncMock,
        ) as mock_val_stt,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/api/user/settings",
                json={"stt_provider": "deepgram"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["stt_provider"] == "deepgram"
    assert data["stt_status"] == "verified"
    mock_decrypt.assert_not_called()
    mock_val_stt.assert_not_called()

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_explicit_new_key_does_not_decrypt_own_or_other_roles_old_keys(
    mock_db_with_settings,
):
    """单 role 显式提供新 key 时只校验新 key，绝不解密本 role 及其他 role 的旧密文。"""
    mock_db, _, mock_settings = mock_db_with_settings(
        settings_kwargs={
            "stt_provider": STTProvider.deepgram,
            "encrypted_stt_key": "stt_old_ciphertext",
            "llm_provider": LLMProvider.siliconflow,
            "encrypted_llm_key": "corrupted_llm_ciphertext",
            "tts_provider": TTSProvider.cartesia,
            "encrypted_tts_key": "corrupted_tts_ciphertext",
            "stt_is_valid": False,
            "llm_is_valid": True,
            "tts_is_valid": True,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    with (
        patch(
            "routers.user.decrypt_api_key",
            side_effect=ValueError("Should never decrypt"),
        ) as mock_decrypt,
        patch(
            "routers.user.ProviderValidationService.validate_stt_key",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_val_stt,
        patch(
            "routers.user.encrypt_api_key",
            return_value=EncryptedCredential("stt_new_ciphertext", "active-v2"),
        ) as mock_encrypt,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/api/user/settings",
                json={
                    "stt_key": "brand-new-stt-key",
                },
            )

    assert response.status_code == 200
    data = response.json()
    assert data["has_stt_key"] is True
    assert data["stt_status"] == "verified"
    # llm / tts 保持原有效性
    assert data["llm_status"] == "verified"
    assert data["tts_status"] == "verified"
    assert data["is_custom_verified"] is True

    mock_decrypt.assert_not_called()
    mock_val_stt.assert_called_once_with("deepgram", "brand-new-stt-key")
    mock_encrypt.assert_called_once_with("brand-new-stt-key")
    assert mock_settings.encrypted_stt_key == "stt_new_ciphertext"

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_provider_change_without_new_key_decrypts_only_that_role(
    mock_db_with_settings,
):
    """切换 provider 但未给 key 时，仅需沿用旧 key 的该 role 解密一次，其他 role 零解密。"""
    mock_db, _, mock_settings = mock_db_with_settings(
        settings_kwargs={
            "stt_provider": STTProvider.deepgram,
            "encrypted_stt_key": "corrupted_stt_ciphertext",
            "llm_provider": LLMProvider.siliconflow,
            "encrypted_llm_key": "old_llm_ciphertext",
            "llm_key_version": "v1",
            "tts_provider": TTSProvider.cartesia,
            "encrypted_tts_key": "corrupted_tts_ciphertext",
            "stt_is_valid": True,
            "llm_is_valid": True,
            "tts_is_valid": True,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    # 模拟仅 llm 密文解密成功且触发轮换
    def fake_decrypt(ciphertext, key_version):
        if ciphertext == "old_llm_ciphertext":
            return DecryptedCredential("decrypted-llm-secret", needs_rotation=True)
        raise ValueError(f"Unexpected decrypt call for {ciphertext}")

    with (
        patch("routers.user.decrypt_api_key", side_effect=fake_decrypt) as mock_decrypt,
        patch(
            "routers.user.encrypt_api_key",
            return_value=EncryptedCredential("rotated_llm_ciphertext", "active-v2"),
        ) as mock_encrypt,
        patch(
            "routers.user.ProviderValidationService.validate_llm_key",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_val_llm,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/api/user/settings",
                json={"llm_provider": "openrouter"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["llm_provider"] == "openrouter"
    assert data["llm_status"] == "verified"
    # stt 和 tts 未被触碰，保持原 valid
    assert data["stt_status"] == "verified"
    assert data["tts_status"] == "verified"

    # 断言 decrypt 仅调用了 llm 密文一次
    mock_decrypt.assert_called_once_with("old_llm_ciphertext", "v1")
    # 断言 rotate 写入了 active key
    mock_encrypt.assert_called_once_with("decrypted-llm-secret")
    assert mock_settings.encrypted_llm_key == "rotated_llm_ciphertext"
    # 断言 validate_llm_key 使用了新 provider 和旧解密 key
    mock_val_llm.assert_called_once_with("openrouter", "decrypted-llm-secret")

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_provider_change_fails_if_required_old_key_cannot_be_decrypted(
    mock_db_with_settings,
):
    """当某 role 变更 provider 需要沿用旧 key 时，如果该 role 旧密文解密失败，异常不被吞掉。"""
    mock_db, _, _ = mock_db_with_settings(
        settings_kwargs={
            "llm_provider": LLMProvider.siliconflow,
            "encrypted_llm_key": "bad_ciphertext",
            "llm_key_version": "unknown-version",
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    with patch(
        "routers.user.decrypt_api_key",
        side_effect=ValueError("未知的凭据加密密钥版本: unknown-version"),
    ):
        with pytest.raises(ValueError, match="未知的凭据加密密钥版本"):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                await client.put(
                    "/api/user/settings",
                    json={"llm_provider": "openrouter"},
                )

    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_validation_failure_ordering_and_shape_preserved(
    mock_db_with_settings,
):
    """多 role 变更且失败时，调度按 STT -> LLM -> TTS 顺序组织，422 providers 响应严格保持 STT -> LLM -> TTS。

    注：A55 引入有界并行验证后，底层网络等待并行执行，不再要求串行完成；
    此处验证其按确定顺序调度启动，且无论完成快慢，响应字典的键顺序与 422 结构稳定保持。
    """
    from services.validation_service import ProviderValidationResult

    mock_db, _, _ = mock_db_with_settings(
        settings_kwargs={
            "stt_provider": STTProvider.deepgram,
            "llm_provider": LLMProvider.siliconflow,
            "tts_provider": TTSProvider.cartesia,
        }
    )
    app.dependency_overrides[get_db] = lambda: mock_db

    call_order = []

    async def mock_val_stt(provider, key):
        call_order.append("stt")
        return ProviderValidationResult(False, "auth_error")

    async def mock_val_llm(provider, key):
        call_order.append("llm")
        return ProviderValidationResult(False, "rate_limited")

    async def mock_val_tts(provider, key):
        call_order.append("tts")
        return ProviderValidationResult(False, "timeout")

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
                    "stt_key": "stt-k",
                    "llm_key": "llm-k",
                    "tts_key": "tts-k",
                },
            )

    assert response.status_code == 422
    assert call_order == ["stt", "llm", "tts"]
    data = response.json()
    assert data["detail"]["code"] == "provider_key_validation_failed"
    assert data["detail"]["providers"] == {
        "stt": "auth_error",
        "llm": "rate_limited",
        "tts": "timeout",
    }

    app.dependency_overrides = {}
