"""
EchoTalk 自定义凭据解析器 (CredentialResolver) 测试 (RF-09)。

覆盖契约验收要求：
1. 必填 6 种缺失零 decrypt（3 providers + 3 encrypted keys 严格顺序校验，未齐备前零解密）。
2. 解密失败位置 3 种（STT / LLM / TTS），任一失败立即抛出 ERR_CUSTOM_KEY_INVALID，
   后续零解密、零 factory 构造，且异常与日志中绝对不含原始异常信息。
3. 3 版本 / None legacy key_version 透传。
4. default / custom model、providers 转换、不可变 snapshot 与原 UserSettings 未改。
5. repr / str 与日志安全性：对含有 synthetic canary 的 resolved 凭据，
   repr / str 与 logging 输出绝对不含 canary 明文，不得输出 plaintext。
6. 实际 _build_custom_plugins 联动测试：
   - 证明 3 key / model / provider 正确传参给 PluginFactory；
   - resolver 失败时 PluginFactory 零调用；
   - factory 构造异常时原环境变量全部恢复且异常仍可 catch。
7. 基础轨 entrypoint 隔离测试：
   - 基础轨使用拒绝读取 encrypted 字段的防御对象，证实零 resolver、零 decrypt；
   - 自定义轨 entrypoint 接入真实 resolver，错误出口安全码保持不变。
8. 模块独立性：导入 credential_resolver 与 plugin_errors 不引入 livekit SDK 或 plugin_factory。
"""

import copy
import dataclasses
import logging
import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.fernet import InvalidToken

from livekit_agent.credential_resolver import (
    CredentialResolver,
    ResolvedCustomCredentials,
)
from livekit_agent.plugin_errors import PluginInitError
from models.user import LLMProvider, STTProvider, TTSProvider
from utils.crypto import DecryptedCredential

CANARY_KEY = "CANARY_SECRET_API_KEY_xyz987654321_DO_NOT_LEAK"


class DummyUserSettings:
    """用于测试的模拟 UserSettings 结构。"""

    def __init__(
        self,
        stt_provider: Any = STTProvider.deepgram,
        llm_provider: Any = LLMProvider.siliconflow,
        tts_provider: Any = TTSProvider.cartesia,
        encrypted_stt_key: str | None = "enc_stt",
        stt_key_version: str | None = "v1",
        encrypted_llm_key: str | None = "enc_llm",
        llm_key_version: str | None = "v2",
        encrypted_tts_key: str | None = "enc_tts",
        tts_key_version: str | None = "legacy-v0",
        llm_model: str | None = "custom-llm-model",
        is_custom_mode: bool = True,
    ):
        self.stt_provider = stt_provider
        self.llm_provider = llm_provider
        self.tts_provider = tts_provider
        self.encrypted_stt_key = encrypted_stt_key
        self.stt_key_version = stt_key_version
        self.encrypted_llm_key = encrypted_llm_key
        self.llm_key_version = llm_key_version
        self.encrypted_tts_key = encrypted_tts_key
        self.tts_key_version = tts_key_version
        self.llm_model = llm_model
        self.is_custom_mode = is_custom_mode


# ===========================================================================
# 1. 必填 6 种缺失零 decrypt 严格顺序校验
# ===========================================================================


@pytest.mark.parametrize(
    "missing_field,expected_msg_fragment",
    [
        ("stt_provider", "STT provider 未配置"),
        ("llm_provider", "LLM provider 未配置"),
        ("tts_provider", "TTS provider 未配置"),
        ("encrypted_stt_key", "STT API Key 未配置"),
        ("encrypted_llm_key", "LLM API Key 未配置"),
        ("encrypted_tts_key", "TTS API Key 未配置"),
    ],
)
def test_six_required_fields_missing_fails_fast_zero_decrypt(
    missing_field: str, expected_msg_fragment: str
):
    """验证 6 项缺失任意一项均快速抛错，且在此之前或之后零 decrypt 调用。"""
    us = DummyUserSettings()
    setattr(us, missing_field, None)

    with patch("livekit_agent.credential_resolver.decrypt_api_key") as mock_decrypt:
        with pytest.raises(PluginInitError) as exc_info:
            CredentialResolver.resolve_custom(us, default_llm_model="default-model")

        assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
        assert expected_msg_fragment in exc_info.value.message
        assert mock_decrypt.call_count == 0


def test_order_of_preflight_checks():
    """验证预检顺序严格为 stt_p -> llm_p -> tts_p -> stt_k -> llm_k -> tts_k。"""
    # 同时缺少 stt_provider 和 encrypted_stt_key，应先报 stt_provider
    us = DummyUserSettings(stt_provider=None, encrypted_stt_key=None)
    with patch("livekit_agent.credential_resolver.decrypt_api_key") as mock_decrypt:
        with pytest.raises(PluginInitError) as exc_info:
            CredentialResolver.resolve_custom(us, default_llm_model="default-model")
        assert "STT provider 未配置" in exc_info.value.message
        assert mock_decrypt.call_count == 0

    # 同时缺少 llm_provider 和 encrypted_llm_key，应先报 llm_provider
    us2 = DummyUserSettings(llm_provider=None, encrypted_llm_key=None)
    with patch("livekit_agent.credential_resolver.decrypt_api_key") as mock_decrypt:
        with pytest.raises(PluginInitError) as exc_info:
            CredentialResolver.resolve_custom(us2, default_llm_model="default-model")
        assert "LLM provider 未配置" in exc_info.value.message
        assert mock_decrypt.call_count == 0


# ===========================================================================
# 2. 解密失败位置 3 种零后续解密与安全脱敏
# ===========================================================================


def test_stt_decrypt_failure_stops_llm_and_tts_decrypt():
    """STT 解密失败时立即抛错，LLM 与 TTS 零解密，不泄露原始异常正文。"""
    us = DummyUserSettings()
    with patch(
        "livekit_agent.credential_resolver.decrypt_api_key",
        side_effect=InvalidToken("RAW_SENSITIVE_CRYPTO_ERROR"),
    ) as mock_decrypt:
        with pytest.raises(PluginInitError) as exc_info:
            CredentialResolver.resolve_custom(us, default_llm_model="default-model")

        assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
        assert exc_info.value.message == "API Key 解密失败，请重新保存密钥。"
        assert "RAW_SENSITIVE_CRYPTO_ERROR" not in str(exc_info.value)
        assert mock_decrypt.call_count == 1  # 仅调用 STT 一次后即退出


def test_llm_decrypt_failure_stops_tts_decrypt():
    """LLM 解密失败时立即抛错，TTS 零解密。"""
    us = DummyUserSettings()

    def side_effect(ciphertext, version):
        if ciphertext == "enc_stt":
            return DecryptedCredential(plaintext="stt_key_val", needs_rotation=False)
        raise ValueError("RAW_LLM_KEY_DECRYPT_CRASH")

    with patch(
        "livekit_agent.credential_resolver.decrypt_api_key",
        side_effect=side_effect,
    ) as mock_decrypt:
        with pytest.raises(PluginInitError) as exc_info:
            CredentialResolver.resolve_custom(us, default_llm_model="default-model")

        assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
        assert exc_info.value.message == "API Key 解密失败，请重新保存密钥。"
        assert "RAW_LLM_KEY_DECRYPT_CRASH" not in str(exc_info.value)
        assert mock_decrypt.call_count == 2  # STT 成功, LLM 失败, TTS 未调用


def test_tts_decrypt_failure():
    """TTS 解密失败时抛出安全错误码与消息。"""
    us = DummyUserSettings()

    def side_effect(ciphertext, version):
        if ciphertext in ("enc_stt", "enc_llm"):
            return DecryptedCredential(plaintext="valid_key", needs_rotation=False)
        raise RuntimeError("RAW_TTS_KEY_FAILURE")

    with patch(
        "livekit_agent.credential_resolver.decrypt_api_key",
        side_effect=side_effect,
    ) as mock_decrypt:
        with pytest.raises(PluginInitError) as exc_info:
            CredentialResolver.resolve_custom(us, default_llm_model="default-model")

        assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
        assert exc_info.value.message == "API Key 解密失败，请重新保存密钥。"
        assert "RAW_TTS_KEY_FAILURE" not in str(exc_info.value)
        assert mock_decrypt.call_count == 3


# ===========================================================================
# 3. 3 版本与 None legacy key_version 透传
# ===========================================================================


def test_key_versions_and_legacy_none_passthrough():
    """验证各 provider 的 key_version（包括 None legacy）被原样透传给 decrypt_api_key。"""
    us = DummyUserSettings(
        stt_key_version="stt-version-custom",
        llm_key_version=None,  # legacy None
        tts_key_version="tts-version-v2",
    )

    recorded_calls = []

    def fake_decrypt(ciphertext, key_version):
        recorded_calls.append((ciphertext, key_version))
        return DecryptedCredential(
            plaintext=f"plain_{ciphertext}", needs_rotation=False
        )

    with patch(
        "livekit_agent.credential_resolver.decrypt_api_key",
        side_effect=fake_decrypt,
    ):
        resolved = CredentialResolver.resolve_custom(
            us, default_llm_model="default-model"
        )

    assert recorded_calls == [
        ("enc_stt", "stt-version-custom"),
        ("enc_llm", None),
        ("enc_tts", "tts-version-v2"),
    ]
    assert resolved.stt_key == "plain_enc_stt"
    assert resolved.llm_key == "plain_enc_llm"
    assert resolved.tts_key == "plain_enc_tts"


# ===========================================================================
# 4. default / custom model、providers 转换与不可变快照
# ===========================================================================


def test_model_selection_custom_vs_default():
    """验证 llm_model 存在时优先使用，为空或 None 时使用 default_llm_model。"""
    # 场景 1: 用户指定了自定义 model
    us1 = DummyUserSettings(llm_model="custom/my-model-v1")
    with patch(
        "livekit_agent.credential_resolver.decrypt_api_key",
        return_value=DecryptedCredential(plaintext="k", needs_rotation=False),
    ):
        r1 = CredentialResolver.resolve_custom(us1, default_llm_model="sys-default")
    assert r1.model == "custom/my-model-v1"

    # 场景 2: 用户 llm_model 为 None
    us2 = DummyUserSettings(llm_model=None)
    with patch(
        "livekit_agent.credential_resolver.decrypt_api_key",
        return_value=DecryptedCredential(plaintext="k", needs_rotation=False),
    ):
        r2 = CredentialResolver.resolve_custom(us2, default_llm_model="sys-default")
    assert r2.model == "sys-default"

    # 场景 3: 用户 llm_model 为空字符串 ""
    us3 = DummyUserSettings(llm_model="")
    with patch(
        "livekit_agent.credential_resolver.decrypt_api_key",
        return_value=DecryptedCredential(plaintext="k", needs_rotation=False),
    ):
        r3 = CredentialResolver.resolve_custom(us3, default_llm_model="sys-default")
    assert r3.model == "sys-default"


def test_providers_string_value_extraction_and_immutability():
    """验证 Enum 或纯字符串 provider 统一提取为字符串，返回不可变快照，且原配置对象无改动。"""
    us = DummyUserSettings(
        stt_provider=STTProvider.deepgram,
        llm_provider=LLMProvider.siliconflow,
        tts_provider=TTSProvider.cartesia,
    )
    original_dict = copy.deepcopy(us.__dict__)

    with patch(
        "livekit_agent.credential_resolver.decrypt_api_key",
        return_value=DecryptedCredential(plaintext="test_key", needs_rotation=False),
    ):
        resolved = CredentialResolver.resolve_custom(
            us, default_llm_model="default-model"
        )

    # 验证字段类型为字符串
    assert resolved.stt_provider == "deepgram"
    assert resolved.llm_provider == "siliconflow"
    assert resolved.tts_provider == "cartesia"

    # 验证原配置对象未被修改
    assert us.__dict__ == original_dict

    # 验证不可变性 (Frozen dataclass)
    with pytest.raises(dataclasses.FrozenInstanceError):
        resolved.model = "hacked-model"  # type: ignore

    with pytest.raises(dataclasses.FrozenInstanceError):
        resolved.stt_key = "hacked-key"  # type: ignore


# ===========================================================================
# 5. repr / str 与日志脱敏安全性（Synthetic Canary 审计）
# ===========================================================================


def test_repr_str_and_logging_absolutely_no_canary():
    """验证含有 Canary 敏感密钥的 ResolvedCustomCredentials 不会在 repr/str/log 中泄露。"""
    resolved = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        stt_key=f"stt_{CANARY_KEY}",
        llm_key=f"llm_{CANARY_KEY}",
        tts_key=f"tts_{CANARY_KEY}",
        model="test-model",
    )

    # 1. repr 与 str 审计
    repr_str = repr(resolved)
    str_str = str(resolved)
    assert CANARY_KEY not in repr_str
    assert CANARY_KEY not in str_str
    assert "***" in repr_str
    assert "***" in str_str

    # 2. logging 审计
    test_logger = logging.getLogger("test_credential_resolver_security")
    test_logger.setLevel(logging.INFO)

    class CapturingHandler(logging.Handler):
        def __init__(self):
            super().__init__()
            self.records = []

        def emit(self, record):
            self.records.append(record)

    handler = CapturingHandler()
    test_logger.addHandler(handler)

    try:
        test_logger.info("Credentials snapshot: %s, repr=%r", resolved, resolved)
        for rec in handler.records:
            msg = rec.getMessage()
            # 格式化文本中绝对不含明文 canary
            assert CANARY_KEY not in msg
            assert CANARY_KEY not in repr_str
            assert CANARY_KEY not in str_str
    finally:
        test_logger.removeHandler(handler)


# ===========================================================================
# 6. 实际 _build_custom_plugins 联动与环境安全测试
# ===========================================================================


def test_build_custom_plugins_success_and_factory_call_contract():
    """验证 _build_custom_plugins 调用 CredentialResolver 并将解密凭据正确传给 PluginFactory。"""
    from livekit_agent.agent import _build_custom_plugins

    us = DummyUserSettings(llm_model="custom/qwen-7b")

    fake_resolved = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        stt_key="stt_plain_key",
        llm_key="llm_plain_key",
        tts_key="tts_plain_key",
        model="custom/qwen-7b",
    )

    with (
        patch(
            "livekit_agent.agent.CredentialResolver.resolve_custom",
            return_value=fake_resolved,
        ) as mock_resolve,
        patch("livekit_agent.agent.PluginFactory.create_stt") as mock_stt,
        patch("livekit_agent.agent.PluginFactory.create_llm") as mock_llm,
        patch("livekit_agent.agent.PluginFactory.create_tts") as mock_tts,
        patch("livekit_agent.agent.PluginFactory.create_vad") as mock_vad,
    ):
        mock_stt.return_value = "mock_stt_instance"
        mock_llm.return_value = "mock_llm_instance"
        mock_tts.return_value = "mock_tts_instance"
        mock_vad.return_value = "mock_vad_instance"

        plugins = _build_custom_plugins(us)

        mock_resolve.assert_called_once()
        mock_stt.assert_called_once_with("deepgram", "stt_plain_key")
        mock_llm.assert_called_once_with(
            "siliconflow", "llm_plain_key", "custom/qwen-7b"
        )
        mock_tts.assert_called_once_with("cartesia", "tts_plain_key")
        mock_vad.assert_called_once()

        assert plugins == {
            "stt": "mock_stt_instance",
            "llm": "mock_llm_instance",
            "tts": "mock_tts_instance",
            "vad": "mock_vad_instance",
        }


def test_build_custom_plugins_resolver_failure_zero_factory_calls():
    """验证当 resolver 抛出异常时，PluginFactory 零调用。"""
    from livekit_agent.agent import _build_custom_plugins

    us = DummyUserSettings(stt_provider=None)

    with (
        patch("livekit_agent.agent.PluginFactory.create_stt") as mock_stt,
        patch("livekit_agent.agent.PluginFactory.create_llm") as mock_llm,
        patch("livekit_agent.agent.PluginFactory.create_tts") as mock_tts,
    ):
        with pytest.raises(PluginInitError) as exc_info:
            _build_custom_plugins(us)

        assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
        assert mock_stt.call_count == 0
        assert mock_llm.call_count == 0
        assert mock_tts.call_count == 0


def test_build_custom_plugins_factory_exception_restores_env():
    """验证当 PluginFactory 构造器抛错时，临时清除的环境变量在 finally 块中完整恢复。"""
    from livekit_agent.agent import _SENSITIVE_ENV_VARS, _build_custom_plugins

    us = DummyUserSettings()

    # 先注入测试环境变量
    test_env = {k: f"val_{k}" for k in _SENSITIVE_ENV_VARS}
    for k, v in test_env.items():
        os.environ[k] = v

    fake_resolved = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        stt_key="stt_key",
        llm_key="llm_key",
        tts_key="tts_key",
        model="model",
    )

    try:
        with (
            patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom",
                return_value=fake_resolved,
            ),
            patch(
                "livekit_agent.agent.PluginFactory.create_stt",
                side_effect=RuntimeError("SDK_CREATION_FAILED"),
            ),
        ):
            with pytest.raises(RuntimeError) as exc_info:
                _build_custom_plugins(us)
            assert "SDK_CREATION_FAILED" in str(exc_info.value)

        # 验证环境变量全部恢复
        for k, v in test_env.items():
            assert os.environ.get(k) == v
    finally:
        for k in _SENSITIVE_ENV_VARS:
            os.environ.pop(k, None)


# ===========================================================================
# 7. 基础轨 entrypoint 零访问 / 自定义轨 entrypoint 真实接入
# ===========================================================================


class ExplodingEncryptedSettings:
    """任何尝试读取加密凭据或自定义 key version 均自爆的对象，用于严格验证基础轨隔离。"""

    def __init__(self):
        self.is_custom_mode = False
        self.user_id = "test-user-id"

    def __getattr__(self, name: str):
        if "encrypted" in name or "key_version" in name:
            raise AssertionError(f"基础轨严禁读取敏感加密字段: {name}")
        return super().__getattribute__(name)


@pytest.mark.asyncio
async def test_entrypoint_baseline_track_zero_resolver_zero_encrypted_read():
    """验证基础轨 entrypoint 零 resolver、零 decrypt、且绝不读取 encrypted 字段。"""
    from livekit_agent.agent import entrypoint

    exploding_settings = ExplodingEncryptedSettings()

    mock_job = MagicMock()
    mock_job.room = MagicMock()
    mock_job.room.name = "11111111-2222-3333-4444-555555555555"
    mock_job.room.disconnect = AsyncMock()
    mock_job.connect = AsyncMock()
    mock_job.wait_for_participant = AsyncMock()
    shutdown_callbacks = []
    mock_job.add_shutdown_callback = MagicMock(side_effect=shutdown_callbacks.append)

    mock_plugins = {
        "stt": MagicMock(),
        "llm": MagicMock(),
        "tts": MagicMock(),
        "vad": MagicMock(),
    }

    try:
        with (
            patch(
                "livekit_agent.agent._fetch_user_settings",
                AsyncMock(return_value=exploding_settings),
            ),
            patch(
                "livekit_agent.agent._fetch_session_context",
                AsyncMock(return_value=None),
            ),
            patch(
                "livekit_agent.agent.PluginFactory.from_system_defaults",
                return_value=mock_plugins,
            ) as mock_defaults,
            patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom"
            ) as mock_resolve,
            patch("livekit_agent.agent.AgentSession") as mock_agent_session_cls,
        ):
            mock_agent_session = MagicMock()
            mock_agent_session.start = AsyncMock()
            mock_agent_session_cls.return_value = mock_agent_session

            await entrypoint(mock_job)

            mock_defaults.assert_called_once()
            assert mock_resolve.call_count == 0
    finally:
        for cb in shutdown_callbacks:
            res = cb()
            if hasattr(res, "__await__"):
                await res


@pytest.mark.asyncio
async def test_entrypoint_custom_track_resolver_failure_emits_safe_error():
    """验证自定义轨 entrypoint 在凭据解析失败时，向客户端发送安全的 ERR_CUSTOM_KEY_INVALID 并断连。"""
    from livekit_agent.agent import entrypoint

    us = DummyUserSettings(is_custom_mode=True, stt_provider=None)

    mock_job = MagicMock()
    mock_job.room = MagicMock()
    mock_job.room.name = "11111111-2222-3333-4444-555555555555"
    mock_job.room.disconnect = AsyncMock()
    mock_job.room.local_participant = MagicMock()
    mock_job.room.local_participant.publish_data = AsyncMock()
    mock_job.connect = AsyncMock()
    mock_job.wait_for_participant = AsyncMock()
    shutdown_callbacks = []
    mock_job.add_shutdown_callback = MagicMock(side_effect=shutdown_callbacks.append)

    try:
        with (
            patch(
                "livekit_agent.agent._fetch_user_settings", AsyncMock(return_value=us)
            ),
            patch(
                "livekit_agent.agent._fetch_session_context",
                AsyncMock(return_value=None),
            ),
            patch(
                "livekit_agent.agent._send_error_and_disconnect", AsyncMock()
            ) as mock_disconnect,
        ):
            await entrypoint(mock_job)

            mock_disconnect.assert_called_once()
            call_args = mock_disconnect.call_args[0]
            # 校验 safe code 为 ERR_CUSTOM_KEY_INVALID
            assert call_args[1] == "ERR_CUSTOM_KEY_INVALID"
    finally:
        for cb in shutdown_callbacks:
            res = cb()
            if hasattr(res, "__await__"):
                await res


# ===========================================================================
# 8. 模块独立性：无 SDK 或 PluginFactory 依赖
# ===========================================================================


def test_resolver_and_errors_module_independence():
    """验证 credential_resolver 与 plugin_errors 模块没有导入 livekit SDK 或 PluginFactory。"""
    import livekit_agent.credential_resolver as cr_mod
    import livekit_agent.plugin_errors as pe_mod

    # 检查模块命名空间中未直接引入 livekit 或 PluginFactory
    assert "livekit" not in cr_mod.__dict__
    assert "PluginFactory" not in cr_mod.__dict__

    assert "livekit" not in pe_mod.__dict__
    assert "config" not in pe_mod.__dict__
    assert "PluginFactory" not in pe_mod.__dict__
