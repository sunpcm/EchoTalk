"""RF-10 用户设置业务服务单元与路由委托测试。"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

import routers.user as user_router
from database import get_db
from main import app
from models.user import (
    LLMProvider,
    STTProvider,
    SubscriptionTier,
    TTSProvider,
)
from schemas.user import UserSettingsUpdate
from services.user_settings_service import (
    UserSettingsService,
    apply_settings_update,
    as_validation_result,
    build_user_settings_response,
    decrypt_and_rotate,
    get_key_status,
    validate_custom_mode_permission,
    validate_provider_keys,
)
from services.validation_service import ProviderValidationResult
from utils.crypto import DecryptedCredential, EncryptedCredential


class DummyUserSettings:
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


class DummyUser:
    def __init__(self, tier: SubscriptionTier = SubscriptionTier.free):
        self.id = uuid.uuid4()
        self.subscription_tier = tier


# ---------------------------------------------------------------------------
# 1. 状态表与三态映射 (get_key_status)
# ---------------------------------------------------------------------------


def test_get_key_status_mapping():
    """验证三态映射规则与未配置/错误/校验通过状态矩阵。"""
    assert get_key_status(has_key=False, is_valid=True) == "unconfigured"
    assert get_key_status(has_key=False, is_valid=False) == "unconfigured"
    assert get_key_status(has_key=False, is_valid=None) == "unconfigured"
    assert get_key_status(has_key=True, is_valid=False) == "error"
    assert get_key_status(has_key=True, is_valid=True) == "verified"
    assert get_key_status(has_key=True, is_valid=None) == "unconfigured"


def test_as_validation_result_behavior():
    """验证 as_validation_result 对 ProviderValidationResult 和 bool 替身的转换。"""
    res_bool_true = as_validation_result(True)
    assert res_bool_true.ok is True
    assert res_bool_true.code == "verified"

    res_bool_false = as_validation_result(False)
    assert res_bool_false.ok is False
    assert res_bool_false.code == "provider_error"

    original = ProviderValidationResult(True, "verified")
    assert as_validation_result(original) is original


# ---------------------------------------------------------------------------
# 2. 响应构建与脱敏 (build_user_settings_response)
# ---------------------------------------------------------------------------


def test_build_user_settings_response_none_row():
    """当用户无 UserSettings 记录时返回默认结构并使用给定订阅等级。"""
    resp = build_user_settings_response(None, "pro")
    assert resp.subscription_tier == "pro"
    assert resp.theme == "warm"
    assert resp.is_custom_mode is True
    assert resp.is_custom_verified is False
    assert resp.has_stt_key is False
    assert resp.has_llm_key is False
    assert resp.has_tts_key is False
    assert resp.stt_status == "unconfigured"
    assert resp.llm_status == "unconfigured"
    assert resp.tts_status == "unconfigured"


def test_build_user_settings_response_redaction_and_defaults():
    """验证响应无明文、密文与版本暴露，has_key 严格基于 is not None，且默认 theme 回退。"""
    row = DummyUserSettings(
        encrypted_stt_key="cipher-stt",
        encrypted_llm_key="",  # 空字符串但非 None，仍视为 has_key=True
        encrypted_tts_key=None,
        stt_provider=STTProvider.deepgram,
        llm_provider=LLMProvider.siliconflow,
        tts_provider=TTSProvider.cartesia,
        llm_model="Qwen/Qwen2.5-7B-Instruct",
        stt_is_valid=True,
        llm_is_valid=False,
        tts_is_valid=None,
        theme=None,
    )
    resp = build_user_settings_response(row, "free")

    assert resp.subscription_tier == "free"
    assert resp.theme == "warm"
    assert resp.has_stt_key is True
    assert resp.has_llm_key is True
    assert resp.has_tts_key is False
    assert resp.stt_status == "verified"
    assert resp.llm_status == "error"
    assert resp.tts_status == "unconfigured"

    # 验证响应序列化中完全不含敏感凭据与密文/版本字段
    resp_dict = resp.model_dump()
    for sensitive_key in (
        "encrypted_stt_key",
        "encrypted_llm_key",
        "encrypted_tts_key",
        "stt_key",
        "llm_key",
        "tts_key",
        "stt_key_version",
        "llm_key_version",
        "tts_key_version",
    ):
        assert sensitive_key not in resp_dict


# ---------------------------------------------------------------------------
# 3. 权限判断 (validate_custom_mode_permission)
# ---------------------------------------------------------------------------


def test_validate_custom_mode_permission():
    """free 用户禁止关闭 custom mode (403)，pro/premium 用户或非关闭操作允许。"""
    free_user = DummyUser(SubscriptionTier.free)
    pro_user = DummyUser(SubscriptionTier.pro)
    premium_user = DummyUser(SubscriptionTier.premium)

    # free 用户尝试关闭 custom mode -> 403
    with pytest.raises(HTTPException) as exc_info:
        validate_custom_mode_permission(free_user, is_custom_mode=False)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Free tier users cannot disable custom mode."

    # free 用户开启或不传 -> 允许
    validate_custom_mode_permission(free_user, is_custom_mode=True)
    validate_custom_mode_permission(free_user, is_custom_mode=None)

    # pro/premium 用户关闭 -> 允许
    validate_custom_mode_permission(pro_user, is_custom_mode=False)
    validate_custom_mode_permission(premium_user, is_custom_mode=False)

    # user_obj 为 None -> 允许
    validate_custom_mode_permission(None, is_custom_mode=False)


# ---------------------------------------------------------------------------
# 4. 凭据读取、解密与按需旋转 (decrypt_and_rotate)
# ---------------------------------------------------------------------------


def test_decrypt_and_rotate_empty_or_none():
    """空密文或 None 密文直接返回 None，不调用解密函数。"""
    row = DummyUserSettings(encrypted_stt_key=None)
    mock_decrypt = MagicMock()
    result = decrypt_and_rotate(row, "stt", decrypt_fn=mock_decrypt)
    assert result is None
    mock_decrypt.assert_not_called()


def test_decrypt_and_rotate_without_rotation():
    """needs_rotation 为 False 时返回明文且不执行重加密。"""
    row = DummyUserSettings(encrypted_stt_key="cipher-v1", stt_key_version="v1")
    mock_decrypt = MagicMock(
        return_value=DecryptedCredential("plain-secret", needs_rotation=False)
    )
    mock_encrypt = MagicMock()

    result = decrypt_and_rotate(
        row, "stt", decrypt_fn=mock_decrypt, encrypt_fn=mock_encrypt
    )
    assert result == "plain-secret"
    mock_decrypt.assert_called_once_with("cipher-v1", "v1")
    mock_encrypt.assert_not_called()
    assert row.encrypted_stt_key == "cipher-v1"
    assert row.stt_key_version == "v1"


def test_decrypt_and_rotate_with_rotation():
    """needs_rotation 为 True 时重加密并改写行上密文与版本。"""
    row = DummyUserSettings(encrypted_llm_key="cipher-old", llm_key_version="v-old")
    mock_decrypt = MagicMock(
        return_value=DecryptedCredential("plain-llm", needs_rotation=True)
    )
    mock_encrypt = MagicMock(return_value=EncryptedCredential("cipher-new", "v-active"))

    result = decrypt_and_rotate(
        row, "llm", decrypt_fn=mock_decrypt, encrypt_fn=mock_encrypt
    )
    assert result == "plain-llm"
    mock_decrypt.assert_called_once_with("cipher-old", "v-old")
    mock_encrypt.assert_called_once_with("plain-llm")
    assert row.encrypted_llm_key == "cipher-new"
    assert row.llm_key_version == "v-active"


# ---------------------------------------------------------------------------
# 5. 凭据校验业务逻辑 (validate_provider_keys)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_provider_keys_no_change():
    """无变更更新零解密、零拨测，并保持既有有效性。"""
    row = DummyUserSettings(
        stt_provider=STTProvider.deepgram,
        stt_is_valid=True,
        llm_provider=LLMProvider.siliconflow,
        llm_is_valid=False,
    )
    body = UserSettingsUpdate(theme="dark")
    mock_decrypt = MagicMock()
    mock_val_service = AsyncMock()

    stt_v, llm_v, tts_v = await validate_provider_keys(
        row,
        body,
        decrypt_fn=mock_decrypt,
        validation_service=mock_val_service,
    )
    assert stt_v is True
    assert llm_v is False
    assert tts_v is False
    mock_decrypt.assert_not_called()
    mock_val_service.validate_parallel.assert_not_called()


@pytest.mark.asyncio
async def test_validate_provider_keys_explicit_new_key():
    """显式传入新 key 时直接拨测新 key，绝不解密旧密文。"""
    row = DummyUserSettings(
        stt_provider=STTProvider.deepgram,
        encrypted_stt_key="old-stt-cipher",
        stt_is_valid=False,
    )
    body = UserSettingsUpdate(stt_key="new-stt-secret")
    mock_decrypt = MagicMock()
    mock_val_service = MagicMock()
    mock_val_service.validate_parallel = AsyncMock(
        return_value={"stt": ProviderValidationResult(True, "verified")}
    )

    stt_v, llm_v, tts_v = await validate_provider_keys(
        row,
        body,
        decrypt_fn=mock_decrypt,
        validation_service=mock_val_service,
    )
    assert stt_v is True
    mock_decrypt.assert_not_called()
    mock_val_service.validate_parallel.assert_called_once_with(
        [("stt", "deepgram", "new-stt-secret")]
    )


@pytest.mark.asyncio
async def test_validate_provider_keys_failure_preserves_order():
    """多 role 校验失败时以 422 抛出，detail.providers 严格按 STT->LLM->TTS 顺序组织。"""
    row = DummyUserSettings(
        stt_provider=STTProvider.deepgram,
        llm_provider=LLMProvider.siliconflow,
        tts_provider=TTSProvider.cartesia,
    )
    body = UserSettingsUpdate(
        stt_key="k-stt",
        llm_key="k-llm",
        tts_key="k-tts",
    )
    mock_val_service = MagicMock()
    # 模拟并行返回（字典键无序或逆序返回）
    mock_val_service.validate_parallel = AsyncMock(
        return_value={
            "tts": ProviderValidationResult(False, "network_error"),
            "llm": ProviderValidationResult(False, "auth_error"),
            "stt": ProviderValidationResult(False, "rate_limited"),
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        await validate_provider_keys(
            row,
            body,
            validation_service=mock_val_service,
        )

    assert exc_info.value.status_code == 422
    detail = exc_info.value.detail
    assert detail["code"] == "provider_key_validation_failed"
    assert list(detail["providers"].keys()) == ["stt", "llm", "tts"]
    assert detail["providers"] == {
        "stt": "rate_limited",
        "llm": "auth_error",
        "tts": "network_error",
    }


# ---------------------------------------------------------------------------
# 6. 设置更新与加密写入 (apply_settings_update)
# ---------------------------------------------------------------------------


def test_apply_settings_update_field_writes_and_verified_flag():
    """验证各字段写入、API Key 加密写入及 is_custom_verified 仅在三路均 True 时成立。"""
    row = DummyUserSettings()
    body = UserSettingsUpdate(
        is_custom_mode=True,
        theme="cool",
        stt_provider="deepgram",
        llm_provider="siliconflow",
        llm_model="custom-model",
        tts_provider="cartesia",
        stt_key="stt-plain",
        llm_key="llm-plain",
        tts_key="tts-plain",
    )
    mock_encrypt = MagicMock(
        side_effect=lambda k: EncryptedCredential(f"enc-{k}", "v-active")
    )

    # 1) 部分 valid (STT=True, LLM=True, TTS=False) -> is_custom_verified 应为 False
    apply_settings_update(
        row,
        body,
        stt_valid=True,
        llm_valid=True,
        tts_valid=False,
        encrypt_fn=mock_encrypt,
    )
    assert row.is_custom_mode is True
    assert row.theme == "cool"
    assert row.stt_provider == STTProvider.deepgram
    assert row.llm_provider == LLMProvider.siliconflow
    assert row.llm_model == "custom-model"
    assert row.tts_provider == TTSProvider.cartesia
    assert row.encrypted_stt_key == "enc-stt-plain"
    assert row.stt_key_version == "v-active"
    assert row.stt_is_valid is True
    assert row.llm_is_valid is True
    assert row.tts_is_valid is False
    assert row.is_custom_verified is False

    # 2) 全 valid (STT=True, LLM=True, TTS=True) -> is_custom_verified 应为 True
    apply_settings_update(
        row,
        UserSettingsUpdate(),
        stt_valid=True,
        llm_valid=True,
        tts_valid=True,
        encrypt_fn=mock_encrypt,
    )
    assert row.is_custom_verified is True


# ---------------------------------------------------------------------------
# 7. 路由薄委托与 Patch 兼容回归
# ---------------------------------------------------------------------------


def test_router_delegates_to_service():
    """验证 routers.user 中的薄兼容函数逐一正确委托到 UserSettingsService。"""
    assert user_router.get_key_status(True, True) == "verified"
    res = user_router._as_validation_result(True)
    assert res.ok is True and res.code == "verified"

    # 测试 _build_user_settings_response 委托
    resp = user_router._build_user_settings_response(None, "pro")
    assert resp.subscription_tier == "pro"

    # 测试 _validate_custom_mode_permission 委托
    with pytest.raises(HTTPException):
        user_router._validate_custom_mode_permission(
            DummyUser(SubscriptionTier.free), False
        )

    # 测试 _decrypt_and_rotate 委托并验证路由级 patch
    row = DummyUserSettings(
        encrypted_stt_key="router-cipher", stt_key_version="v-router"
    )
    with patch(
        "routers.user.decrypt_api_key",
        return_value=DecryptedCredential("secret-router", needs_rotation=True),
    ) as m_dec:
        with patch(
            "routers.user.encrypt_api_key",
            return_value=EncryptedCredential("rotated-cipher", "v-new"),
        ) as m_enc:
            assert user_router._decrypt_and_rotate(row, "stt") == "secret-router"
            m_dec.assert_called_once_with("router-cipher", "v-router")
            m_enc.assert_called_once_with("secret-router")
            assert row.encrypted_stt_key == "rotated-cipher"
            assert row.stt_key_version == "v-new"


@pytest.mark.asyncio
async def test_production_router_consumes_service_directly():
    """证明生产 HTTP 路由入口直接消费 UserSettingsService。"""
    mock_db = AsyncMock()
    mock_user = DummyUser(tier=SubscriptionTier.pro)
    mock_settings = DummyUserSettings(
        user_id=mock_user.id,
        theme="warm",
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
    had_get_db = get_db in app.dependency_overrides
    original_get_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        # 1) GET /api/user/settings 证实消费 UserSettingsService.build_user_settings_response
        with patch.object(
            UserSettingsService,
            "build_user_settings_response",
            wraps=UserSettingsService.build_user_settings_response,
        ) as spy_build:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.get("/api/user/settings")
            assert resp.status_code == 200
            spy_build.assert_called_once()

        # 2) PUT /api/user/settings 证实消费 UserSettingsService 核心方法
        with (
            patch.object(
                UserSettingsService,
                "validate_custom_mode_permission",
                wraps=UserSettingsService.validate_custom_mode_permission,
            ) as spy_perm,
            patch.object(
                UserSettingsService,
                "validate_provider_keys",
                wraps=UserSettingsService.validate_provider_keys,
            ) as spy_val,
            patch.object(
                UserSettingsService,
                "apply_settings_update",
                wraps=UserSettingsService.apply_settings_update,
            ) as spy_apply,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.put(
                    "/api/user/settings",
                    json={"theme": "dark"},
                )
            assert resp.status_code == 200
            spy_perm.assert_called_once()
            spy_val.assert_called_once()
            spy_apply.assert_called_once()
    finally:
        if had_get_db:
            app.dependency_overrides[get_db] = original_get_db
        else:
            app.dependency_overrides.pop(get_db, None)
