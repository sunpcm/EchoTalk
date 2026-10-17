from unittest.mock import patch

import pytest

from livekit_agent.plugin_factory import (
    PluginFactory,
    PluginInitError,
    _validate_api_key,
)


def test_validate_api_key_valid():
    assert _validate_api_key("  valid_key_123  ", "Test Provider") == "valid_key_123"


def test_validate_api_key_invalid_types():
    with pytest.raises(PluginInitError) as exc_info:
        _validate_api_key(None, "Test Provider")  # type: ignore
    assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
    assert "必须为字符串类型" in exc_info.value.message

    with pytest.raises(PluginInitError) as exc_info:
        _validate_api_key(12345, "Test Provider")  # type: ignore
    assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
    assert "必须为字符串类型" in exc_info.value.message


def test_validate_api_key_empty():
    with pytest.raises(PluginInitError) as exc_info:
        _validate_api_key("", "Test Provider")
    assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
    assert "为空" in exc_info.value.message

    with pytest.raises(PluginInitError) as exc_info:
        _validate_api_key("   ", "Test Provider")
    assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
    assert "为空" in exc_info.value.message


def test_validate_api_key_unsafe_characters():
    unsafe_keys = [
        "key\nwith_newline",
        "key\rwith_return",
        "key\x00with_null",
    ]
    for key in unsafe_keys:
        with pytest.raises(PluginInitError) as exc_info:
            _validate_api_key(key, "Test Provider")
        assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
        assert "格式不安全" in exc_info.value.message


def test_create_stt_success():
    stt = PluginFactory.create_stt("deepgram", "  dg_test_key_123  ")
    assert stt is not None


def test_create_stt_unsupported_provider():
    with pytest.raises(PluginInitError) as exc_info:
        PluginFactory.create_stt("invalid_provider", "dg_key")
    assert exc_info.value.code == "ERR_UNSUPPORTED_STT_PROVIDER"


def test_create_stt_invalid_key():
    with pytest.raises(PluginInitError) as exc_info:
        PluginFactory.create_stt("deepgram", "   ")
    assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"


def test_create_llm_success():
    llm = PluginFactory.create_llm(
        provider="siliconflow",
        api_key="  sf_test_key_123  ",
        model="Qwen/Qwen2.5-7B-Instruct",
    )
    assert llm is not None


def test_create_llm_unsupported_provider():
    with pytest.raises(PluginInitError) as exc_info:
        PluginFactory.create_llm(
            provider="unknown_llm",
            api_key="key",
            model="some_model",
        )
    assert exc_info.value.code == "ERR_UNSUPPORTED_LLM_PROVIDER"


def test_create_llm_invalid_model():
    with pytest.raises(PluginInitError) as exc_info:
        PluginFactory.create_llm(
            provider="siliconflow",
            api_key="valid_key",
            model="   ",
        )
    assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
    assert "模型名称为空" in exc_info.value.message


def test_create_tts_success():
    tts = PluginFactory.create_tts("cartesia", "  cartesia_test_key  ")
    assert tts is not None


def test_create_tts_unsupported_provider():
    with pytest.raises(PluginInitError) as exc_info:
        PluginFactory.create_tts("unsupported_tts", "key")
    assert exc_info.value.code == "ERR_UNSUPPORTED_TTS_PROVIDER"


def test_create_vad_success():
    with patch("livekit.plugins.silero.VAD.load") as mock_load:
        mock_load.return_value = "mock_vad"
        vad = PluginFactory.create_vad()
        assert vad == "mock_vad"


def test_from_system_defaults_success():
    with (
        patch("config.settings.DEFAULT_LLM_PROVIDER", "siliconflow"),
        patch("config.settings.SILICONFLOW_API_KEY", "sf_sys_key"),
        patch("config.settings.DEEPGRAM_API_KEY", "dg_sys_key"),
        patch("config.settings.CARTESIA_API_KEY", "cartesia_sys_key"),
        patch("config.settings.DEFAULT_LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct"),
        patch("livekit.plugins.silero.VAD.load", return_value="mock_vad"),
    ):
        plugins = PluginFactory.from_system_defaults()
        assert "stt" in plugins
        assert "llm" in plugins
        assert "tts" in plugins
        assert plugins["vad"] == "mock_vad"


def test_from_system_defaults_unregistered_llm_provider():
    with patch("config.settings.DEFAULT_LLM_PROVIDER", "unregistered_provider"):
        with pytest.raises(PluginInitError) as exc_info:
            PluginFactory.from_system_defaults()
        assert exc_info.value.code == "ERR_SYSTEM_CONFIG"
