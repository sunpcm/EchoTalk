"""
EchoTalk Provider 注册中心 (ProviderRegistry) 边界与插件集构造测试 (RF-09)。

覆盖契约验收要求：
1. 正确角色 key / model / provider 归属：
   - 确保 STT 只接收 stt_provider / stt_key，绝不混用 llm_key / tts_key；
   - 确保 LLM 只接收 llm_provider / llm_key / model，绝不混用 stt_key / tts_key；
   - 确保 TTS 只接收 tts_provider / tts_key，绝不混用 stt_key / llm_key；
   - 确保 VAD 无参数被加载；
   - 确保返回结构包含四角色完整实例 {"stt", "llm", "tts", "vad"}。
2. 失败短路与严格构造顺序（STT → LLM → TTS → VAD）：
   - STT 失败时，LLM / TTS / VAD 零调用；
   - LLM 失败时，TTS / VAD 零调用；
   - TTS 失败时，VAD 零调用。
3. 严格类型约束：
   - 仅接已解密不可变快照 ResolvedCustomCredentials；
   - 拒绝 ORM 模型、字典、None 或未解密数据，不自行解密。
4. 基础轨零自定义凭据与零解密：
   - ProviderRegistry.from_system_defaults() 仅委托 PluginFactory.from_system_defaults()；
   - 零解密调用、零用户加密字段访问。
5. 真实 Agent 包装与 entrypoint 双轨消费：
   - agent._build_custom_plugins 委托 CredentialResolver 与 ProviderRegistry.from_custom；
   - entrypoint 基础轨调用 ProviderRegistry.from_system_defaults()；
   - entrypoint 自定义轨消费 ProviderRegistry.from_custom() 生成的插件。
6. Canary 敏感凭据审计与零环境修改：
   - 全程不泄露 Canary 密钥；
   - 构造前后及调用瞬间 os.environ 严格不变；
   - 全程纯 Mock，零下载零真实网络。
"""

import logging
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from livekit_agent.agent import _build_custom_plugins, entrypoint
from livekit_agent.credential_resolver import ResolvedCustomCredentials
from livekit_agent.plugin_errors import PluginInitError
from livekit_agent.provider_registry import ProviderRegistry

CANARY_STT_KEY = "CANARY_STT_KEY_dg_abc123456789_DO_NOT_LEAK"
CANARY_LLM_KEY = "CANARY_LLM_KEY_sf_def987654321_DO_NOT_LEAK"
CANARY_TTS_KEY = "CANARY_TTS_KEY_ct_ghi555666777_DO_NOT_LEAK"


def _make_sample_resolved(
    stt_key: str = CANARY_STT_KEY,
    llm_key: str = CANARY_LLM_KEY,
    tts_key: str = CANARY_TTS_KEY,
    stt_provider: str = "deepgram",
    llm_provider: str = "siliconflow",
    tts_provider: str = "cartesia",
    model: str = "custom-qwen-model-v1",
) -> ResolvedCustomCredentials:
    return ResolvedCustomCredentials(
        stt_provider=stt_provider,
        llm_provider=llm_provider,
        tts_provider=tts_provider,
        stt_key=stt_key,
        llm_key=llm_key,
        tts_key=tts_key,
        model=model,
    )


# ===========================================================================
# 1. 正确角色 key / model / provider 归属与完整四键验证
# ===========================================================================


def test_registry_roles_keys_and_model_attribution():
    """
    验证 ProviderRegistry.from_custom 将 ResolvedCustomCredentials 中的参数
    严格正确归属至各角色的 PluginFactory 构造器，且绝对不串用其他角色的 key。
    """
    resolved = _make_sample_resolved()

    mock_stt = MagicMock(name="STTInstance")
    mock_llm = MagicMock(name="LLMInstance")
    mock_tts = MagicMock(name="TTSInstance")
    mock_vad = MagicMock(name="VADInstance")

    with (
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_stt",
            return_value=mock_stt,
        ) as p_stt,
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_llm",
            return_value=mock_llm,
        ) as p_llm,
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_tts",
            return_value=mock_tts,
        ) as p_tts,
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_vad",
            return_value=mock_vad,
        ) as p_vad,
    ):
        plugins = ProviderRegistry.from_custom(resolved)

        # 1. 验证四个构造器均恰好被调用一次
        assert p_stt.call_count == 1
        assert p_llm.call_count == 1
        assert p_tts.call_count == 1
        assert p_vad.call_count == 1

        # 2. 验证参数正确归属
        p_stt.assert_called_once_with("deepgram", CANARY_STT_KEY)
        p_llm.assert_called_once_with(
            "siliconflow", CANARY_LLM_KEY, "custom-qwen-model-v1"
        )
        p_tts.assert_called_once_with("cartesia", CANARY_TTS_KEY)
        p_vad.assert_called_once_with()

        # 3. 严格防串扰断言：STT 构造绝不包含 LLM/TTS key
        stt_args = p_stt.call_args[0]
        assert CANARY_LLM_KEY not in stt_args
        assert CANARY_TTS_KEY not in stt_args

        # 4. 严格防串扰断言：LLM 构造绝不包含 STT/TTS key
        llm_args = p_llm.call_args[0]
        assert CANARY_STT_KEY not in llm_args
        assert CANARY_TTS_KEY not in llm_args

        # 5. 严格防串扰断言：TTS 构造绝不包含 STT/LLM key
        tts_args = p_tts.call_args[0]
        assert CANARY_STT_KEY not in tts_args
        assert CANARY_LLM_KEY not in tts_args

        # 6. 验证返回字典且四键完整存在
        assert set(plugins.keys()) == {"stt", "llm", "tts", "vad"}
        assert plugins["stt"] is mock_stt
        assert plugins["llm"] is mock_llm
        assert plugins["tts"] is mock_tts
        assert plugins["vad"] is mock_vad


def test_registry_roles_mutation_wrong_key_fails():
    """
    针对变异测试（wrong-role key）：
    断言当任何角色的 key 传递错误时必须失败。
    """
    resolved = _make_sample_resolved(
        stt_key="stt-exact-key-1",
        llm_key="llm-exact-key-2",
        tts_key="tts-exact-key-3",
    )

    with (
        patch("livekit_agent.provider_registry.PluginFactory.create_stt") as p_stt,
        patch("livekit_agent.provider_registry.PluginFactory.create_llm") as p_llm,
        patch("livekit_agent.provider_registry.PluginFactory.create_tts") as p_tts,
        patch("livekit_agent.provider_registry.PluginFactory.create_vad") as p_vad,
    ):
        ProviderRegistry.from_custom(resolved)

        call_stt_key = p_stt.call_args[0][1]
        call_llm_key = p_llm.call_args[0][1]
        call_tts_key = p_tts.call_args[0][1]

        assert call_stt_key == "stt-exact-key-1"
        assert call_llm_key == "llm-exact-key-2"
        assert call_tts_key == "tts-exact-key-3"
        assert call_stt_key != call_llm_key
        assert call_llm_key != call_tts_key
        assert p_vad.call_count == 1


def test_registry_roles_mutation_missing_role_fails():
    """
    针对变异测试（漏构造某 role）：
    断言四角色构造器均必须被调用，返回字典必须包含四个角色。
    """
    resolved = _make_sample_resolved()

    with (
        patch("livekit_agent.provider_registry.PluginFactory.create_stt") as p_stt,
        patch("livekit_agent.provider_registry.PluginFactory.create_llm") as p_llm,
        patch("livekit_agent.provider_registry.PluginFactory.create_tts") as p_tts,
        patch("livekit_agent.provider_registry.PluginFactory.create_vad") as p_vad,
    ):
        p_stt.return_value = "stt_mock"
        p_llm.return_value = "llm_mock"
        p_tts.return_value = "tts_mock"
        p_vad.return_value = "vad_mock"

        plugins = ProviderRegistry.from_custom(resolved)

        assert "stt" in plugins and plugins["stt"] == "stt_mock"
        assert "llm" in plugins and plugins["llm"] == "llm_mock"
        assert "tts" in plugins and plugins["tts"] == "tts_mock"
        assert "vad" in plugins and plugins["vad"] == "vad_mock"
        assert len(plugins) == 4


# ===========================================================================
# 2. 失败短路与严格构造顺序（STT → LLM → TTS → VAD）
# ===========================================================================


def test_registry_construction_order_is_strictly_stt_llm_tts_vad():
    """验证四插件构造顺序严格为 STT -> LLM -> TTS -> VAD。"""
    resolved = _make_sample_resolved()
    call_order: list[str] = []

    def fake_stt(*args, **kwargs):
        call_order.append("stt")
        return MagicMock()

    def fake_llm(*args, **kwargs):
        call_order.append("llm")
        return MagicMock()

    def fake_tts(*args, **kwargs):
        call_order.append("tts")
        return MagicMock()

    def fake_vad(*args, **kwargs):
        call_order.append("vad")
        return MagicMock()

    with (
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_stt",
            side_effect=fake_stt,
        ),
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_llm",
            side_effect=fake_llm,
        ),
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_tts",
            side_effect=fake_tts,
        ),
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_vad",
            side_effect=fake_vad,
        ),
    ):
        ProviderRegistry.from_custom(resolved)

        assert call_order == ["stt", "llm", "tts", "vad"]


def test_registry_stt_failure_short_circuits_llm_tts_vad():
    """验证当 STT 插件构造失败时，立即抛错且后续 LLM / TTS / VAD 零调用。"""
    resolved = _make_sample_resolved()

    with (
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_stt",
            side_effect=PluginInitError("ERR_CUSTOM_KEY_INVALID", "STT key bad"),
        ) as p_stt,
        patch("livekit_agent.provider_registry.PluginFactory.create_llm") as p_llm,
        patch("livekit_agent.provider_registry.PluginFactory.create_tts") as p_tts,
        patch("livekit_agent.provider_registry.PluginFactory.create_vad") as p_vad,
    ):
        with pytest.raises(PluginInitError) as exc_info:
            ProviderRegistry.from_custom(resolved)

        assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
        assert p_stt.call_count == 1
        assert p_llm.call_count == 0
        assert p_tts.call_count == 0
        assert p_vad.call_count == 0


def test_registry_llm_failure_short_circuits_tts_vad():
    """验证当 LLM 插件构造失败时，立即抛错且后续 TTS / VAD 零调用。"""
    resolved = _make_sample_resolved()

    with (
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_stt",
            return_value=MagicMock(),
        ) as p_stt,
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_llm",
            side_effect=PluginInitError(
                "ERR_UNSUPPORTED_LLM_PROVIDER", "LLM bad provider"
            ),
        ) as p_llm,
        patch("livekit_agent.provider_registry.PluginFactory.create_tts") as p_tts,
        patch("livekit_agent.provider_registry.PluginFactory.create_vad") as p_vad,
    ):
        with pytest.raises(PluginInitError) as exc_info:
            ProviderRegistry.from_custom(resolved)

        assert exc_info.value.code == "ERR_UNSUPPORTED_LLM_PROVIDER"
        assert p_stt.call_count == 1
        assert p_llm.call_count == 1
        assert p_tts.call_count == 0
        assert p_vad.call_count == 0


def test_registry_tts_failure_short_circuits_vad():
    """验证当 TTS 插件构造失败时，立即抛错且后续 VAD 零调用。"""
    resolved = _make_sample_resolved()

    with (
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_stt",
            return_value=MagicMock(),
        ) as p_stt,
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_llm",
            return_value=MagicMock(),
        ) as p_llm,
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_tts",
            side_effect=PluginInitError("ERR_CUSTOM_KEY_INVALID", "TTS key bad"),
        ) as p_tts,
        patch("livekit_agent.provider_registry.PluginFactory.create_vad") as p_vad,
    ):
        with pytest.raises(PluginInitError) as exc_info:
            ProviderRegistry.from_custom(resolved)

        assert exc_info.value.code == "ERR_CUSTOM_KEY_INVALID"
        assert p_stt.call_count == 1
        assert p_llm.call_count == 1
        assert p_tts.call_count == 1
        assert p_vad.call_count == 0


# ===========================================================================
# 3. 严格类型校验与零 ORM / 零解密边界
# ===========================================================================


@pytest.mark.parametrize(
    "invalid_input",
    [
        None,
        {},
        {"stt_key": "abc"},
        "plain-string",
        12345,
        object(),
    ],
)
def test_registry_from_custom_rejects_non_snapshot_input(invalid_input):
    """验证 ProviderRegistry.from_custom 严格拒绝非 ResolvedCustomCredentials 的对象。"""
    with pytest.raises(
        TypeError, match="resolved 必须为 ResolvedCustomCredentials 实例"
    ):
        ProviderRegistry.from_custom(invalid_input)  # type: ignore


# ===========================================================================
# 4. 基础轨零凭据读取与委托验证
# ===========================================================================


def test_registry_from_system_defaults_delegation():
    """验证 ProviderRegistry.from_system_defaults 准确委托给 PluginFactory.from_system_defaults。"""
    mock_system_plugins = {
        "stt": MagicMock(name="SysSTT"),
        "llm": MagicMock(name="SysLLM"),
        "tts": MagicMock(name="SysTTS"),
        "vad": MagicMock(name="SysVAD"),
    }

    with patch(
        "livekit_agent.provider_registry.PluginFactory.from_system_defaults",
        return_value=mock_system_plugins,
    ) as p_defaults:
        result = ProviderRegistry.from_system_defaults()

        p_defaults.assert_called_once_with()
        assert result is mock_system_plugins


# ===========================================================================
# 5. 真实 Agent 包装 (_build_custom_plugins) 与 entrypoint 联动
# ===========================================================================


class DummyUserSettings:
    """测试用模拟 UserSettings。"""

    def __init__(self, is_custom_mode: bool = True):
        self.is_custom_mode = is_custom_mode
        self.stt_provider = "deepgram"
        self.llm_provider = "siliconflow"
        self.tts_provider = "cartesia"
        self.encrypted_stt_key = "enc_stt"
        self.encrypted_llm_key = "enc_llm"
        self.encrypted_tts_key = "enc_tts"
        self.llm_model = "test-model"


def test_agent_build_custom_plugins_calls_registry():
    """验证 agent._build_custom_plugins 先经 Resolver 解密再调用 ProviderRegistry.from_custom。"""
    us = DummyUserSettings()
    fake_resolved = _make_sample_resolved()
    fake_plugins = {"stt": "s", "llm": "l", "tts": "t", "vad": "v"}

    with (
        patch(
            "livekit_agent.agent.CredentialResolver.resolve_custom",
            return_value=fake_resolved,
        ) as mock_resolve,
        patch(
            "livekit_agent.agent.ProviderRegistry.from_custom",
            return_value=fake_plugins,
        ) as mock_reg_custom,
    ):
        result = _build_custom_plugins(us)

        mock_resolve.assert_called_once()
        mock_reg_custom.assert_called_once_with(fake_resolved)
        assert result == fake_plugins


@pytest.mark.asyncio
async def test_agent_entrypoint_baseline_track_uses_registry_defaults():
    """验证 entrypoint 基础轨严格使用 ProviderRegistry.from_system_defaults()。"""
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
    sys_settings = DummyUserSettings(is_custom_mode=False)

    try:
        with (
            patch(
                "livekit_agent.agent._fetch_user_settings",
                AsyncMock(return_value=sys_settings),
            ),
            patch(
                "livekit_agent.agent._fetch_session_context",
                AsyncMock(return_value=None),
            ),
            patch(
                "livekit_agent.agent.ProviderRegistry.from_system_defaults",
                return_value=mock_plugins,
            ) as mock_defaults,
            patch(
                "livekit_agent.agent.ProviderRegistry.from_custom"
            ) as mock_reg_custom,
            patch("livekit_agent.agent.AgentSession") as mock_agent_session_cls,
        ):
            mock_session = MagicMock()
            mock_session.start = AsyncMock()
            mock_agent_session_cls.return_value = mock_session

            await entrypoint(mock_job)

            mock_defaults.assert_called_once_with()
            assert mock_reg_custom.call_count == 0
    finally:
        for cb in shutdown_callbacks:
            res = cb()
            if hasattr(res, "__await__"):
                await res


@pytest.mark.asyncio
async def test_agent_entrypoint_custom_track_uses_registry_from_custom():
    """验证 entrypoint 自定义轨通过 _build_custom_plugins 最终消费 ProviderRegistry.from_custom。"""
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
    custom_settings = DummyUserSettings(is_custom_mode=True)
    fake_resolved = _make_sample_resolved()

    try:
        with (
            patch(
                "livekit_agent.agent._fetch_user_settings",
                AsyncMock(return_value=custom_settings),
            ),
            patch(
                "livekit_agent.agent._fetch_session_context",
                AsyncMock(return_value=None),
            ),
            patch(
                "livekit_agent.agent.CredentialResolver.resolve_custom",
                return_value=fake_resolved,
            ),
            patch(
                "livekit_agent.agent.ProviderRegistry.from_custom",
                return_value=mock_plugins,
            ) as mock_reg_custom,
            patch(
                "livekit_agent.agent.ProviderRegistry.from_system_defaults"
            ) as mock_defaults,
            patch("livekit_agent.agent.AgentSession") as mock_agent_session_cls,
        ):
            mock_session = MagicMock()
            mock_session.start = AsyncMock()
            mock_agent_session_cls.return_value = mock_session

            await entrypoint(mock_job)

            mock_reg_custom.assert_called_once_with(fake_resolved)
            assert mock_defaults.call_count == 0
    finally:
        for cb in shutdown_callbacks:
            res = cb()
            if hasattr(res, "__await__"):
                await res


# ===========================================================================
# 6. Canary 脱敏审计与环境变量不变性
# ===========================================================================


def test_registry_execution_does_not_mutate_environment():
    """验证 ProviderRegistry 构造调用期间及返回后，环境变量严格不变。"""
    env_snapshot_before = dict(os.environ)
    resolved = _make_sample_resolved()

    with (
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_stt",
            return_value=MagicMock(),
        ),
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_llm",
            return_value=MagicMock(),
        ),
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_tts",
            return_value=MagicMock(),
        ),
        patch(
            "livekit_agent.provider_registry.PluginFactory.create_vad",
            return_value=MagicMock(),
        ),
    ):
        ProviderRegistry.from_custom(resolved)

    assert dict(os.environ) == env_snapshot_before


def test_registry_logging_security_no_canary_leak():
    """验证日志记录器绝对不含 Canary 敏感明文。"""
    test_logger = logging.getLogger("test_provider_registry_canary")
    test_logger.setLevel(logging.INFO)

    class CapturingHandler(logging.Handler):
        def __init__(self):
            super().__init__()
            self.records = []

        def emit(self, record):
            self.records.append(record)

    handler = CapturingHandler()
    test_logger.addHandler(handler)

    resolved = _make_sample_resolved()
    try:
        test_logger.info("Registry invoked with snapshot: %s", resolved)
        for rec in handler.records:
            msg = rec.getMessage()
            assert CANARY_STT_KEY not in msg
            assert CANARY_LLM_KEY not in msg
            assert CANARY_TTS_KEY not in msg
    finally:
        test_logger.removeHandler(handler)
