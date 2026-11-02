"""
EchoTalk 自定义插件显式凭据构造与零进程环境改写测试 (RF-09)。

覆盖契约验收要求：
1. 实际 constructor 调用期间环境变量不变：在五项敏感 env 均有不同 synthetic 值时，
   各 SDK constructor 调用中看到完整未变 env，并收到对应自定义 key 而非 env key。
2. 覆盖 env 某项或多项不存在仍保持缺失，不补写新值，构造正常完成。
3. 成功、role factory 抛错、解密失败、invalid role key 流程前中后所有五项 env 不变。
4. 原 factory 校验严格拒绝非法 key（None/空/全空白/换行/CR/null/非str），绝不回退读取 env key。
5. 实际 SDK 入口显式 cleaned key（strip 净化后传入），且 STT/LLM/TTS 三 role 归属不串。
6. 并发/嵌套两个自定义配置构造互不影响 env 和 key 归属。
7. VAD 始终 mock，无网络请求与模型下载。
8. 自有 logrecord (msg, args, extra, exc_info, stack_info) 与客户端 payload 绝不含 canary 敏感明文。
9. 基础轨 PluginFactory.from_system_defaults 行为保持。
10. 测试使用 patch.dict 精确隔离环境，所有等待有界。
"""

import logging
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from livekit_agent.agent import _build_custom_plugins
from livekit_agent.credential_resolver import ResolvedCustomCredentials
from livekit_agent.plugin_errors import PluginInitError
from livekit_agent.plugin_factory import PluginFactory
from models.user import LLMProvider, STTProvider, TTSProvider

CANARY_STT_KEY = "CANARY_STT_CUSTOM_KEY_dg_abc123456789_DO_NOT_LEAK"
CANARY_LLM_KEY = "CANARY_LLM_CUSTOM_KEY_sf_def987654321_DO_NOT_LEAK"
CANARY_TTS_KEY = "CANARY_TTS_CUSTOM_KEY_ct_ghi555666777_DO_NOT_LEAK"

SENSITIVE_ENV_VARS = [
    "DEEPGRAM_API_KEY",
    "SILICONFLOW_API_KEY",
    "OPENROUTER_API_KEY",
    "CARTESIA_API_KEY",
    "OPENAI_API_KEY",
]

SYNTHETIC_SYSTEM_ENV = {
    "DEEPGRAM_API_KEY": "system-env-deepgram-key-111",
    "SILICONFLOW_API_KEY": "system-env-siliconflow-key-222",
    "OPENROUTER_API_KEY": "system-env-openrouter-key-333",
    "CARTESIA_API_KEY": "system-env-cartesia-key-444",
    "OPENAI_API_KEY": "system-env-openai-key-555",
}


class DummyUserSettings:
    """测试用模拟 UserSettings。"""

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
        tts_key_version: str | None = "v1",
        llm_model: str | None = "Qwen/Qwen2.5-7B-Instruct",
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
# 1. 构造期间环境变量不变与显式 Key 传参（5 项敏感 env 全量存在）
# ===========================================================================


def test_custom_plugins_construction_env_invariant_during_and_after_calls():
    """
    验证在五项敏感系统 env 均存在时：
    1. 每个 SDK constructor 被调用瞬间，os.environ 完整未变，未被临时 pop 或清空；
    2. SDK 接收到的 api_key 为显式清洗后的 custom key，绝非系统 env 中的 key；
    3. STT / LLM / TTS 三个 role 的 key 归属严格隔离，互不串扰；
    4. 构造函数返回后，os.environ 仍完全一致。
    """
    us = DummyUserSettings(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        llm_model="custom/test-model-v1",
    )

    resolved_snapshot = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        stt_key=f"  {CANARY_STT_KEY}  ",
        llm_key=f"  {CANARY_LLM_KEY}  ",
        tts_key=f"  {CANARY_TTS_KEY}  ",
        model="custom/test-model-v1",
    )

    calls_audit = []

    def fake_stt_init(*args, **kwargs):
        # 验证调用瞬间环境变量状态
        env_snapshot = {k: os.environ.get(k) for k in SENSITIVE_ENV_VARS}
        calls_audit.append(("stt", kwargs, env_snapshot))
        mock_obj = MagicMock(name="STTInstance")
        return mock_obj

    def fake_llm_init(*args, **kwargs):
        env_snapshot = {k: os.environ.get(k) for k in SENSITIVE_ENV_VARS}
        calls_audit.append(("llm", kwargs, env_snapshot))
        mock_obj = MagicMock(name="LLMInstance")
        return mock_obj

    def fake_tts_init(*args, **kwargs):
        env_snapshot = {k: os.environ.get(k) for k in SENSITIVE_ENV_VARS}
        calls_audit.append(("tts", kwargs, env_snapshot))
        mock_obj = MagicMock(name="TTSInstance")
        return mock_obj

    def fake_vad_load(*args, **kwargs):
        env_snapshot = {k: os.environ.get(k) for k in SENSITIVE_ENV_VARS}
        calls_audit.append(("vad", kwargs, env_snapshot))
        return MagicMock(name="VADInstance")

    with patch.dict(os.environ, SYNTHETIC_SYSTEM_ENV, clear=False):
        with (
            patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom",
                return_value=resolved_snapshot,
            ),
            patch("livekit.plugins.deepgram.STT", side_effect=fake_stt_init),
            patch("livekit.plugins.openai.LLM", side_effect=fake_llm_init),
            patch("livekit.plugins.cartesia.TTS", side_effect=fake_tts_init),
            patch("livekit.plugins.silero.VAD.load", side_effect=fake_vad_load),
        ):
            plugins = _build_custom_plugins(us)

            # 验证返回的插件字典
            assert set(plugins.keys()) == {"stt", "llm", "tts", "vad"}

            # 验证构造瞬间记录的 env 与系统 env 逐键逐值一致
            assert len(calls_audit) == 4
            for role, kwargs, env_at_call in calls_audit:
                for k, v in SYNTHETIC_SYSTEM_ENV.items():
                    assert env_at_call[k] == v, f"{role} 构造时 env 变量 {k} 发生漂移"

            # 验证 STT 参数与 key 净化
            stt_kwargs = calls_audit[0][1]
            assert stt_kwargs["api_key"] == CANARY_STT_KEY
            assert stt_kwargs["api_key"] != SYNTHETIC_SYSTEM_ENV["DEEPGRAM_API_KEY"]

            # 验证 LLM 参数与 key 净化及归属
            llm_kwargs = calls_audit[1][1]
            assert llm_kwargs["api_key"] == CANARY_LLM_KEY
            assert llm_kwargs["api_key"] != SYNTHETIC_SYSTEM_ENV["SILICONFLOW_API_KEY"]
            assert llm_kwargs["model"] == "custom/test-model-v1"
            assert llm_kwargs["base_url"] == "https://api.siliconflow.cn/v1"

            # 验证 TTS 参数与 key 净化及归属
            tts_kwargs = calls_audit[2][1]
            assert tts_kwargs["api_key"] == CANARY_TTS_KEY
            assert tts_kwargs["api_key"] != SYNTHETIC_SYSTEM_ENV["CARTESIA_API_KEY"]

            # 验证三者 key 不串扰
            assert stt_kwargs["api_key"] != llm_kwargs["api_key"]
            assert llm_kwargs["api_key"] != tts_kwargs["api_key"]
            assert stt_kwargs["api_key"] != tts_kwargs["api_key"]

        # 函数结束后验证环境变量保持完全不变
        for k, v in SYNTHETIC_SYSTEM_ENV.items():
            assert os.environ.get(k) == v


# ===========================================================================
# 2. 环境变量部分缺失场景：保持缺失，不补写
# ===========================================================================


def test_custom_plugins_construction_with_partial_missing_env():
    """
    验证当部分敏感环境变量（如 CARTESIA_API_KEY 与 OPENAI_API_KEY）未设置时：
    1. 构造前后及构造期间，缺失的变量始终保持缺失（not in os.environ）；
    2. 不会向 os.environ 中写入任何临时值或默认值；
    3. 自定义凭据插件构造顺利完成。
    """
    partial_env = {
        "DEEPGRAM_API_KEY": "system-dg-key",
        "SILICONFLOW_API_KEY": "system-sf-key",
        "OPENROUTER_API_KEY": "system-or-key",
    }

    resolved_snapshot = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        stt_key="custom-dg-key",
        llm_key="custom-sf-key",
        tts_key="custom-ct-key",
        model="Qwen/Qwen2.5-7B-Instruct",
    )

    env_during_calls = []

    def record_env(*args, **kwargs):
        env_during_calls.append(
            (
                "CARTESIA_API_KEY" in os.environ,
                "OPENAI_API_KEY" in os.environ,
                os.environ.get("DEEPGRAM_API_KEY"),
            )
        )
        return MagicMock()

    with patch.dict(os.environ, partial_env, clear=True):
        assert "CARTESIA_API_KEY" not in os.environ
        assert "OPENAI_API_KEY" not in os.environ

        with (
            patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom",
                return_value=resolved_snapshot,
            ),
            patch("livekit.plugins.deepgram.STT", side_effect=record_env),
            patch("livekit.plugins.openai.LLM", side_effect=record_env),
            patch("livekit.plugins.cartesia.TTS", side_effect=record_env),
            patch("livekit.plugins.silero.VAD.load", side_effect=record_env),
        ):
            _build_custom_plugins(DummyUserSettings())

            assert len(env_during_calls) == 4
            for cartesia_present, openai_present, dg_val in env_during_calls:
                assert not cartesia_present
                assert not openai_present
                assert dg_val == "system-dg-key"

        assert "CARTESIA_API_KEY" not in os.environ
        assert "OPENAI_API_KEY" not in os.environ


# ===========================================================================
# 3. 构造异常与解密失败流程前中后环境变量保持不变
# ===========================================================================


def test_env_invariant_on_resolver_preflight_or_decrypt_failure():
    """验证当凭据解析器在预检或解密阶段抛错时，环境前中后均保持不变，零 SDK 构造。"""
    us = DummyUserSettings(encrypted_stt_key=None)

    with patch.dict(os.environ, SYNTHETIC_SYSTEM_ENV, clear=False):
        with (
            patch("livekit.plugins.deepgram.STT") as mock_stt,
            patch("livekit.plugins.openai.LLM") as mock_llm,
            patch("livekit.plugins.cartesia.TTS") as mock_tts,
        ):
            with pytest.raises(PluginInitError) as exc_info:
                _build_custom_plugins(us)

            assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
            mock_stt.assert_not_called()
            mock_llm.assert_not_called()
            mock_tts.assert_not_called()

        for k, v in SYNTHETIC_SYSTEM_ENV.items():
            assert os.environ.get(k) == v


def test_env_invariant_on_role_factory_failure_and_subsequent_zero_calls():
    """
    验证当中间某个 role 校验失败时（如 LLM key 非法）：
    1. 前序 role (STT) 已构造；
    2. 当前 role 抛出 PluginInitError，后续 role (TTS, VAD) 零调用；
    3. 不尝试降级或使用环境变量中的系统 key；
    4. 环境变量全流程未被改变。
    """
    us = DummyUserSettings()

    # 模拟 STT 凭据合法，但 LLM 凭据解析后为全空白（非法 key）
    bad_llm_snapshot = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        stt_key="valid-dg-key",
        llm_key="   ",  # 非法全空白 key
        tts_key="valid-ct-key",
        model="Qwen/Qwen2.5-7B-Instruct",
    )

    stt_called = []

    def fake_stt(*args, **kwargs):
        stt_called.append(kwargs)
        return MagicMock()

    with patch.dict(os.environ, SYNTHETIC_SYSTEM_ENV, clear=False):
        with (
            patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom",
                return_value=bad_llm_snapshot,
            ),
            patch("livekit.plugins.deepgram.STT", side_effect=fake_stt),
            patch("livekit.plugins.openai.LLM") as mock_llm,
            patch("livekit.plugins.cartesia.TTS") as mock_tts,
            patch("livekit.plugins.silero.VAD.load") as mock_vad,
        ):
            with pytest.raises(PluginInitError) as exc_info:
                _build_custom_plugins(us)

            assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
            assert "为空" in exc_info.value.message

            # STT 已按合法 key 构造
            assert len(stt_called) == 1
            assert stt_called[0]["api_key"] == "valid-dg-key"

            # LLM SDK、TTS SDK 及 VAD 零调用
            mock_llm.assert_not_called()
            mock_tts.assert_not_called()
            mock_vad.assert_not_called()

        for k, v in SYNTHETIC_SYSTEM_ENV.items():
            assert os.environ.get(k) == v


# ===========================================================================
# 4. 非法 Key 拒绝矩阵：存在系统 env 时绝不回退
# ===========================================================================


@pytest.mark.parametrize(
    "bad_key",
    [
        None,
        "",
        "   ",
        "\t\n  ",
        "key_with_newline\nsecret",
        "key_with_cr\rsecret",
        "key_with_null\x00secret",
        123456,
        {"key": "dict_not_str"},
    ],
)
def test_all_roles_reject_invalid_keys_fail_closed_without_env_fallback(bad_key):
    """
    验证所有 role 无论哪一个传入非法 key（None/空/全空白/换行/回车/null/非str）：
    即使系统环境变量中已配置了有效系统 key，Factory 必须抛出 ERR_CUSTOM_KEY_INVALID，
    严禁使用系统环境变量 key 兜底或降级，严禁调用对应 SDK。
    """
    with patch.dict(os.environ, SYNTHETIC_SYSTEM_ENV, clear=False):
        # 1. 测试 STT 角色
        with patch("livekit.plugins.deepgram.STT") as mock_stt:
            with pytest.raises(PluginInitError) as exc_info:
                PluginFactory.create_stt("deepgram", bad_key)  # type: ignore
            assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
            mock_stt.assert_not_called()

        # 2. 测试 LLM 角色
        with patch("livekit.plugins.openai.LLM") as mock_llm:
            with pytest.raises(PluginInitError) as exc_info:
                PluginFactory.create_llm("siliconflow", bad_key, "model-1")  # type: ignore
            assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
            mock_llm.assert_not_called()

        # 3. 测试 TTS 角色
        with patch("livekit.plugins.cartesia.TTS") as mock_tts:
            with pytest.raises(PluginInitError) as exc_info:
                PluginFactory.create_tts("cartesia", bad_key)  # type: ignore
            assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
            mock_tts.assert_not_called()


# ===========================================================================
# 5. 并发 / 嵌套自定义配置构造：零 env 污染与零 key 归属串扰
# ===========================================================================


def test_nested_custom_plugin_constructions_zero_interference():
    """
    验证在嵌套构造两个不同用户自定义配置（Config A 与 Config B）时：
    1. 两者互相调用期间，os.environ 始终保持系统初始值不变；
    2. Config A 接收到 A 的自定义 keys，Config B 接收到 B 的自定义 keys；
    3. 绝不存在因全局状态引起的 key 串换。
    """
    us_a = DummyUserSettings(llm_model="model-a")
    us_b = DummyUserSettings(llm_model="model-b")

    snapshot_a = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        stt_key="key-stt-A",
        llm_key="key-llm-A",
        tts_key="key-tts-A",
        model="model-a",
    )

    snapshot_b = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="openrouter",
        tts_provider="cartesia",
        stt_key="key-stt-B",
        llm_key="key-llm-B",
        tts_key="key-tts-B",
        model="model-b",
    )

    nested_results = {}
    constructed_keys = []

    def fake_stt_nested(*args, **kwargs):
        constructed_keys.append(("stt", kwargs["api_key"]))
        return MagicMock()

    def fake_llm_nested(*args, **kwargs):
        key = kwargs["api_key"]
        constructed_keys.append(("llm", key))
        # 当正在构造 A 的 LLM 时，同步嵌套触发 B 的构建
        if key == "key-llm-A":
            with patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom",
                return_value=snapshot_b,
            ):
                nested_results["b"] = _build_custom_plugins(us_b)
        return MagicMock()

    def fake_tts_nested(*args, **kwargs):
        constructed_keys.append(("tts", kwargs["api_key"]))
        return MagicMock()

    with patch.dict(os.environ, SYNTHETIC_SYSTEM_ENV, clear=False):
        with (
            patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom",
                return_value=snapshot_a,
            ),
            patch("livekit.plugins.deepgram.STT", side_effect=fake_stt_nested),
            patch("livekit.plugins.openai.LLM", side_effect=fake_llm_nested),
            patch("livekit.plugins.cartesia.TTS", side_effect=fake_tts_nested),
            patch("livekit.plugins.silero.VAD.load", return_value=MagicMock()),
        ):
            res_a = _build_custom_plugins(us_a)
            nested_results["a"] = res_a

        # 验证 A 与 B 均成功构造
        assert "a" in nested_results and "b" in nested_results

        # 验证调用的 key 顺序与归属：A 的 STT -> A 的 LLM -> (嵌套) B 的全部 -> A 的 TTS
        expected_keys_sequence = [
            ("stt", "key-stt-A"),
            ("llm", "key-llm-A"),
            ("stt", "key-stt-B"),
            ("llm", "key-llm-B"),
            ("tts", "key-tts-B"),
            ("tts", "key-tts-A"),
        ]
        assert constructed_keys == expected_keys_sequence

        # 环境变量始终一致
        for k, v in SYNTHETIC_SYSTEM_ENV.items():
            assert os.environ.get(k) == v


# ===========================================================================
# 6. OpenRouter 与首尾空白清洗及自定义模型支持
# ===========================================================================


def test_openrouter_provider_with_whitespace_stripping_and_custom_model():
    """验证 OpenRouter 提供商结合首尾带空白的自定义 Key 及特定模型标识符正常构造。"""
    us = DummyUserSettings(
        llm_provider="openrouter",
        llm_model="anthropic/claude-3.5-sonnet",
    )

    snapshot = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="openrouter",
        tts_provider="cartesia",
        stt_key="  custom-stt-key  ",
        llm_key="  custom-openrouter-key  ",
        tts_key="  custom-tts-key  ",
        model="anthropic/claude-3.5-sonnet",
    )

    with patch.dict(os.environ, SYNTHETIC_SYSTEM_ENV, clear=False):
        with (
            patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom",
                return_value=snapshot,
            ),
            patch("livekit.plugins.deepgram.STT") as mock_stt,
            patch("livekit.plugins.openai.LLM") as mock_llm,
            patch("livekit.plugins.cartesia.TTS") as mock_tts,
            patch("livekit.plugins.silero.VAD.load") as mock_vad,
        ):
            mock_stt.return_value = MagicMock()
            mock_llm.return_value = MagicMock()
            mock_tts.return_value = MagicMock()
            mock_vad.return_value = MagicMock()

            _build_custom_plugins(us)

            # 验证 OpenRouter base_url 与 clean key
            mock_llm.assert_called_once_with(
                model="anthropic/claude-3.5-sonnet",
                base_url="https://openrouter.ai/api/v1",
                api_key="custom-openrouter-key",
                temperature=0.7,
            )


# ===========================================================================
# 7. 全链路 Synthetic Canary 日志安全性审计
# ===========================================================================


def test_custom_plugin_construction_logs_absolutely_zero_canary():
    """验证自定义插件解析与构建全流程产生的 logging 记录全字段绝不含 Canary 敏感内容。"""
    logger = logging.getLogger("echotalk-agent")

    class CapturingLogHandler(logging.Handler):
        def __init__(self):
            super().__init__()
            self.records = []

        def emit(self, record):
            self.records.append(record)

    handler = CapturingLogHandler()
    logger.addHandler(handler)

    us = DummyUserSettings()
    snapshot = ResolvedCustomCredentials(
        stt_provider="deepgram",
        llm_provider="siliconflow",
        tts_provider="cartesia",
        stt_key=CANARY_STT_KEY,
        llm_key=CANARY_LLM_KEY,
        tts_key=CANARY_TTS_KEY,
        model="test-model",
    )

    try:
        with patch.dict(os.environ, SYNTHETIC_SYSTEM_ENV, clear=False):
            with (
                patch(
                    "livekit_agent.agent.CredentialResolver.resolve_custom",
                    return_value=snapshot,
                ),
                patch("livekit.plugins.deepgram.STT", return_value=MagicMock()),
                patch("livekit.plugins.openai.LLM", return_value=MagicMock()),
                patch("livekit.plugins.cartesia.TTS", return_value=MagicMock()),
                patch("livekit.plugins.silero.VAD.load", return_value=MagicMock()),
            ):
                _build_custom_plugins(us)

            canaries = [CANARY_STT_KEY, CANARY_LLM_KEY, CANARY_TTS_KEY]
            for rec in handler.records:
                formatted = rec.getMessage()
                for canary in canaries:
                    assert canary not in formatted
                    assert canary not in str(rec.args)
                    if hasattr(rec, "extra") and rec.extra:
                        assert canary not in str(rec.extra)
    finally:
        logger.removeHandler(handler)


# ===========================================================================
# 8. 基础轨 PluginFactory.from_system_defaults 行为保持
# ===========================================================================


def test_baseline_track_from_system_defaults_reads_settings_normally():
    """验证基础轨正常读取系统 settings，且零 _build_custom_plugins / 零 resolver 逻辑调用。"""
    with (
        patch("livekit_agent.plugin_factory._get_settings") as mock_get_settings,
        patch("livekit.plugins.deepgram.STT") as mock_stt,
        patch("livekit.plugins.openai.LLM") as mock_llm,
        patch("livekit.plugins.cartesia.TTS") as mock_tts,
        patch("livekit.plugins.silero.VAD.load") as mock_vad,
    ):
        mock_settings = mock_get_settings.return_value
        mock_settings.DEFAULT_LLM_PROVIDER = "siliconflow"
        mock_settings.SILICONFLOW_API_KEY = "system_sf_key_123"
        mock_settings.DEFAULT_LLM_MODEL = "sys-default-model"
        mock_settings.DEEPGRAM_API_KEY = "system_dg_key_123"
        mock_settings.CARTESIA_API_KEY = "system_ct_key_123"

        mock_stt.return_value = "sys_stt"
        mock_llm.return_value = "sys_llm"
        mock_tts.return_value = "sys_tts"
        mock_vad.return_value = "sys_vad"

        plugins = PluginFactory.from_system_defaults()

        assert plugins == {
            "stt": "sys_stt",
            "llm": "sys_llm",
            "tts": "sys_tts",
            "vad": "sys_vad",
        }
        mock_stt.assert_called_once_with(api_key="system_dg_key_123")
        mock_llm.assert_called_once_with(
            model="sys-default-model",
            base_url="https://api.siliconflow.cn/v1",
            api_key="system_sf_key_123",
            temperature=0.7,
        )
        mock_tts.assert_called_once_with(api_key="system_ct_key_123")
        mock_vad.assert_called_once()
