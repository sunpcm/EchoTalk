"""Provider Catalog 单一元数据来源与消费者接线测试。"""

import os
import subprocess
import sys
from dataclasses import FrozenInstanceError
from types import MappingProxyType
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from livekit_agent.plugin_factory import (
    _SYSTEM_LLM_KEY_FIELD,
    LLM_PROVIDER_BASE_URL,
    SUPPORTED_LLM_PROVIDERS,
    SUPPORTED_STT_PROVIDERS,
    SUPPORTED_TTS_PROVIDERS,
    PluginFactory,
    PluginInitError,
)
from provider_catalog import (
    LLM_CLIENT_POLICY,
    LLM_PROVIDER_CATALOG,
    PROVIDER_CATALOGS,
    STT_PROVIDER_CATALOG,
    TTS_PROVIDER_CATALOG,
    LLMClientPolicy,
    LLMProviderMetadata,
    STTProviderMetadata,
    TTSProviderMetadata,
    get_llm_provider,
    get_stt_provider,
    get_tts_provider,
)
from services.llm_service import PROVIDER_CONFIG
from services.validation_service import ProviderValidationService

TEST_PROCESS_TIMEOUT_SECONDS = 45.0


def test_catalog_structure_and_exact_values():
    """验证 Catalog 包含精确的 Provider 集合、顺序及各常量值。"""
    # 严格保持两家 LLM Provider 及插入顺序
    assert list(LLM_PROVIDER_CATALOG.keys()) == ["siliconflow", "openrouter"]

    sf = LLM_PROVIDER_CATALOG["siliconflow"]
    assert sf.id == "siliconflow"
    assert sf.base_url == "https://api.siliconflow.cn/v1"
    assert sf.api_key_field == "SILICONFLOW_API_KEY"
    assert sf.validation_url == "https://api.siliconflow.cn/v1/user/info"
    assert sf.role == "llm"
    assert sf.label == "SiliconFlow"
    assert sf.is_default is True

    or_meta = LLM_PROVIDER_CATALOG["openrouter"]
    assert or_meta.id == "openrouter"
    assert or_meta.base_url == "https://openrouter.ai/api/v1"
    assert or_meta.api_key_field == "OPENROUTER_API_KEY"
    assert or_meta.validation_url == "https://openrouter.ai/api/v1/auth/key"
    assert or_meta.role == "llm"
    assert or_meta.label == "OpenRouter"
    assert or_meta.is_default is False

    assert get_llm_provider("siliconflow") == sf
    assert get_llm_provider("openrouter") == or_meta
    assert get_llm_provider("unsupported_provider") is None

    # STT Provider：仅 deepgram
    assert list(STT_PROVIDER_CATALOG.keys()) == ["deepgram"]
    dg = STT_PROVIDER_CATALOG["deepgram"]
    assert dg.id == "deepgram"
    assert dg.api_key_field == "DEEPGRAM_API_KEY"
    assert dg.validation_url == "https://api.deepgram.com/v1/projects"
    assert dg.auth_header_name == "Authorization"
    assert dg.auth_header_prefix == "Token "
    assert dg.static_headers == MappingProxyType({})
    assert dg.role == "stt"
    assert dg.label == "Deepgram"
    assert dg.is_default is True
    assert get_stt_provider("deepgram") == dg
    assert get_stt_provider("unsupported_stt") is None

    # TTS Provider：仅 cartesia
    assert list(TTS_PROVIDER_CATALOG.keys()) == ["cartesia"]
    car = TTS_PROVIDER_CATALOG["cartesia"]
    assert car.id == "cartesia"
    assert car.api_key_field == "CARTESIA_API_KEY"
    assert car.validation_url == "https://api.cartesia.ai/voices"
    assert car.auth_header_name == "X-API-Key"
    assert car.auth_header_prefix == ""
    assert dict(car.static_headers) == {"Cartesia-Version": "2024-06-10"}
    assert car.role == "tts"
    assert car.label == "Cartesia"
    assert car.is_default is True
    assert get_tts_provider("cartesia") == car
    assert get_tts_provider("unsupported_tts") is None

    assert list(PROVIDER_CATALOGS) == ["stt", "llm", "tts"]
    assert PROVIDER_CATALOGS["stt"] is STT_PROVIDER_CATALOG
    assert PROVIDER_CATALOGS["llm"] is LLM_PROVIDER_CATALOG
    assert PROVIDER_CATALOGS["tts"] is TTS_PROVIDER_CATALOG


def test_display_fields_preserve_original_constructor_compatibility():
    """新增展示字段必须有默认值，旧构造调用无需提前触发 TypeError。"""
    llm = LLMProviderMetadata(
        id="legacy-llm",
        base_url="https://example.com/v1",
        api_key_field="LEGACY_LLM_KEY",
        validation_url="https://example.com/v1/validate",
    )
    stt = STTProviderMetadata(
        id="legacy-stt",
        api_key_field="LEGACY_STT_KEY",
        validation_url="https://example.com/stt",
    )
    tts = TTSProviderMetadata(
        id="legacy-tts",
        api_key_field="LEGACY_TTS_KEY",
        validation_url="https://example.com/tts",
    )

    assert (llm.role, llm.label, llm.is_default) == ("llm", "", False)
    assert (stt.role, stt.label, stt.is_default) == ("stt", "", False)
    assert (tts.role, tts.label, tts.is_default) == ("tts", "", False)


def test_llm_client_policy_defaults_are_frozen_catalog_values():
    """普通 OpenAI 兼容 HTTP 客户端的现有 timeout/retry 值仅收敛一处。"""
    policy = LLMClientPolicy()

    assert policy == LLM_CLIENT_POLICY
    assert policy.default_http_timeout_seconds == 600.0
    assert policy.connect_timeout_seconds == 5.0
    assert policy.max_retries == 2


def test_catalog_immutability():
    """验证 Catalog 映射与条目均为不可变结构。"""
    # 1. 映射不可篡改
    with pytest.raises(TypeError):
        LLM_PROVIDER_CATALOG["new_provider"] = LLMProviderMetadata(  # type: ignore
            id="new",
            base_url="https://example.com",
            api_key_field="NEW_KEY",
            validation_url="https://example.com/v1",
        )

    with pytest.raises(TypeError):
        del LLM_PROVIDER_CATALOG["siliconflow"]  # type: ignore

    with pytest.raises(TypeError):
        STT_PROVIDER_CATALOG["new_stt"] = STTProviderMetadata(  # type: ignore
            id="new",
            api_key_field="NEW_KEY",
            validation_url="https://example.com",
        )

    with pytest.raises(TypeError):
        del STT_PROVIDER_CATALOG["deepgram"]  # type: ignore

    with pytest.raises(TypeError):
        TTS_PROVIDER_CATALOG["new_tts"] = TTSProviderMetadata(  # type: ignore
            id="new",
            api_key_field="NEW_KEY",
            validation_url="https://example.com",
        )

    with pytest.raises(TypeError):
        del TTS_PROVIDER_CATALOG["cartesia"]  # type: ignore

    with pytest.raises(TypeError):
        PROVIDER_CATALOGS["new_role"] = {}  # type: ignore

    # 2. 条目本身不可篡改 (frozen dataclass)
    sf = LLM_PROVIDER_CATALOG["siliconflow"]
    with pytest.raises((FrozenInstanceError, AttributeError)):
        sf.base_url = "https://mutated.com"  # type: ignore
    with pytest.raises((FrozenInstanceError, AttributeError)):
        sf.label = "Mutated"  # type: ignore

    with pytest.raises((FrozenInstanceError, AttributeError)):
        LLM_CLIENT_POLICY.max_retries = 3  # type: ignore

    dg = STT_PROVIDER_CATALOG["deepgram"]
    with pytest.raises((FrozenInstanceError, AttributeError)):
        dg.validation_url = "https://mutated.com"  # type: ignore

    with pytest.raises(TypeError):
        dg.static_headers["Authorization"] = "mutated"  # type: ignore

    car = TTS_PROVIDER_CATALOG["cartesia"]
    with pytest.raises((FrozenInstanceError, AttributeError)):
        car.validation_url = "https://mutated.com"  # type: ignore

    with pytest.raises(TypeError):
        car.static_headers["Cartesia-Version"] = "mutated"  # type: ignore


def test_consumer_wiring_plugin_factory():
    """验证 livekit_agent.plugin_factory 严格从 Catalog 派生配置。"""
    # LLM 导出变量名、类型及顺序保持
    assert isinstance(LLM_PROVIDER_BASE_URL, dict)
    assert list(LLM_PROVIDER_BASE_URL.keys()) == ["siliconflow", "openrouter"]
    assert LLM_PROVIDER_BASE_URL == {
        k: v.base_url for k, v in LLM_PROVIDER_CATALOG.items()
    }

    assert isinstance(SUPPORTED_LLM_PROVIDERS, set)
    assert SUPPORTED_LLM_PROVIDERS == set(LLM_PROVIDER_CATALOG.keys())

    assert isinstance(_SYSTEM_LLM_KEY_FIELD, dict)
    assert list(_SYSTEM_LLM_KEY_FIELD.keys()) == ["siliconflow", "openrouter"]
    assert _SYSTEM_LLM_KEY_FIELD == {
        k: v.api_key_field for k, v in LLM_PROVIDER_CATALOG.items()
    }

    # STT & TTS 导出类型与值严格不变
    assert isinstance(SUPPORTED_STT_PROVIDERS, set)
    assert SUPPORTED_STT_PROVIDERS == {"deepgram"}
    assert SUPPORTED_STT_PROVIDERS == set(STT_PROVIDER_CATALOG.keys())

    assert isinstance(SUPPORTED_TTS_PROVIDERS, set)
    assert SUPPORTED_TTS_PROVIDERS == {"cartesia"}
    assert SUPPORTED_TTS_PROVIDERS == set(TTS_PROVIDER_CATALOG.keys())


def test_consumer_wiring_llm_service():
    """验证 services.llm_service 严格从 Catalog 派生 PROVIDER_CONFIG。"""
    assert isinstance(PROVIDER_CONFIG, dict)
    assert list(PROVIDER_CONFIG.keys()) == ["siliconflow", "openrouter"]
    assert PROVIDER_CONFIG == {
        k: {
            "base_url": v.base_url,
            "api_key_field": v.api_key_field,
        }
        for k, v in LLM_PROVIDER_CATALOG.items()
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["siliconflow", "openrouter"])
async def test_consumer_wiring_validation_service_llm(provider):
    """验证 services.validation_service 严格使用 Catalog 的 LLM validation_url 及 Bearer Header。"""
    meta = LLM_PROVIDER_CATALOG[provider]
    mock_response = MagicMock(status=200)
    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("aiohttp.ClientSession.get", return_value=mock_ctx) as mock_get:
        result = await ProviderValidationService.validate_llm_key(provider, "test-key")
        assert result.ok is True
        assert result.code == "verified"
        mock_get.assert_called_once_with(
            meta.validation_url,
            headers={"Authorization": "Bearer test-key"},
        )


@pytest.mark.asyncio
async def test_consumer_wiring_validation_service_speech():
    """验证 services.validation_service 严格使用 Catalog 的 STT/TTS 配置与独立 Headers。"""
    mock_response = MagicMock(status=200)
    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    # 1. STT Deepgram 验证
    dg_meta = STT_PROVIDER_CATALOG["deepgram"]
    with patch("aiohttp.ClientSession.get", return_value=mock_ctx) as mock_get:
        res_stt = await ProviderValidationService.validate_stt_key(
            "deepgram", "dg-secret-key"
        )
        assert res_stt.ok is True
        assert res_stt.code == "verified"
        mock_get.assert_called_once_with(
            dg_meta.validation_url,
            headers={"Authorization": "Token dg-secret-key"},
        )

    # 2. TTS Cartesia 验证
    car_meta = TTS_PROVIDER_CATALOG["cartesia"]
    with patch("aiohttp.ClientSession.get", return_value=mock_ctx) as mock_get:
        res_tts = await ProviderValidationService.validate_tts_key(
            "cartesia", "cartesia-secret-key"
        )
        assert res_tts.ok is True
        assert res_tts.code == "verified"
        mock_get.assert_called_once_with(
            car_meta.validation_url,
            headers={
                "X-API-Key": "cartesia-secret-key",
                "Cartesia-Version": "2024-06-10",
            },
        )


def test_header_generation_isolation_and_no_credential_leak():
    """验证 build_validation_headers 每次生成独立 dict，不污染 catalog，跨调用互不污染。"""
    dg = STT_PROVIDER_CATALOG["deepgram"]
    headers_dg1 = dg.build_validation_headers("key-1")
    headers_dg2 = dg.build_validation_headers("key-2")

    assert headers_dg1 == {"Authorization": "Token key-1"}
    assert headers_dg2 == {"Authorization": "Token key-2"}
    assert headers_dg1 is not headers_dg2

    # 篡改 headers_dg1 不影响 headers_dg2 或 catalog
    headers_dg1["Authorization"] = "tampered"
    headers_dg1["Extra-Header"] = "leak"
    assert headers_dg2 == {"Authorization": "Token key-2"}
    assert "Extra-Header" not in headers_dg2
    assert dg.static_headers == MappingProxyType({})
    assert "key-1" not in str(dg.__dict__)

    car = TTS_PROVIDER_CATALOG["cartesia"]
    headers_car1 = car.build_validation_headers("key-1")
    headers_car2 = car.build_validation_headers("key-2")

    assert headers_car1 == {
        "X-API-Key": "key-1",
        "Cartesia-Version": "2024-06-10",
    }
    assert headers_car2 == {
        "X-API-Key": "key-2",
        "Cartesia-Version": "2024-06-10",
    }
    assert headers_car1 is not headers_car2

    # 篡改 headers_car1 不影响 headers_car2 或 catalog 静态配置
    headers_car1["X-API-Key"] = "tampered"
    headers_car1["Cartesia-Version"] = "1999-01-01"
    assert headers_car2["X-API-Key"] == "key-2"
    assert headers_car2["Cartesia-Version"] == "2024-06-10"
    assert car.static_headers["Cartesia-Version"] == "2024-06-10"
    assert "key-1" not in str(car.__dict__)


@pytest.mark.asyncio
async def test_unsupported_provider_and_missing_key_zero_external_requests():
    """验证不支持的 provider 及缺失 key 时短路返回，零网络请求。"""
    with patch("aiohttp.ClientSession.get") as mock_get:
        # 不支持的 LLM provider
        res_unsupported = await ProviderValidationService.validate_llm_key(
            "unknown_provider", "some-key"
        )
        assert res_unsupported.ok is False
        assert res_unsupported.code == "unsupported_provider"
        mock_get.assert_not_called()

        # 缺失 key (LLM)
        res_missing = await ProviderValidationService.validate_llm_key(
            "siliconflow", ""
        )
        assert res_missing.ok is False
        assert res_missing.code == "missing_key"
        mock_get.assert_not_called()

        # 不支持的 STT provider
        res_stt_unsupported = await ProviderValidationService.validate_stt_key(
            "unknown_stt", "some-key"
        )
        assert res_stt_unsupported.ok is False
        assert res_stt_unsupported.code == "unsupported_provider"
        mock_get.assert_not_called()

        # 缺失 key (STT)
        res_stt_missing = await ProviderValidationService.validate_stt_key(
            "deepgram", ""
        )
        assert res_stt_missing.ok is False
        assert res_stt_missing.code == "missing_key"
        mock_get.assert_not_called()

        # 不支持的 TTS provider
        res_tts_unsupported = await ProviderValidationService.validate_tts_key(
            "unknown_tts", "some-key"
        )
        assert res_tts_unsupported.ok is False
        assert res_tts_unsupported.code == "unsupported_provider"
        mock_get.assert_not_called()

        # 缺失 key (TTS)
        res_tts_missing = await ProviderValidationService.validate_tts_key(
            "cartesia", ""
        )
        assert res_tts_missing.ok is False
        assert res_tts_missing.code == "missing_key"
        mock_get.assert_not_called()

    # plugin_factory 针对不支持 provider 及空 key 抛错且零插件构造
    with pytest.raises(PluginInitError) as exc_unsupported:
        PluginFactory.create_llm("unknown_provider", "key", "model")
    assert exc_unsupported.value.code == "ERR_UNSUPPORTED_LLM_PROVIDER"

    with pytest.raises(PluginInitError) as exc_missing:
        PluginFactory.create_llm("siliconflow", "", "model")
    assert exc_missing.value.code == "ERR_CUSTOM_KEY_INVALID"

    with pytest.raises(PluginInitError) as exc_stt_unsupported:
        PluginFactory.create_stt("unknown_stt", "key")
    assert exc_stt_unsupported.value.code == "ERR_UNSUPPORTED_STT_PROVIDER"

    with pytest.raises(PluginInitError) as exc_stt_missing:
        PluginFactory.create_stt("deepgram", "")
    assert exc_stt_missing.value.code == "ERR_CUSTOM_KEY_INVALID"

    with pytest.raises(PluginInitError) as exc_tts_unsupported:
        PluginFactory.create_tts("unknown_tts", "key")
    assert exc_tts_unsupported.value.code == "ERR_UNSUPPORTED_TTS_PROVIDER"

    with pytest.raises(PluginInitError) as exc_tts_missing:
        PluginFactory.create_tts("cartesia", "")
    assert exc_tts_missing.value.code == "ERR_CUSTOM_KEY_INVALID"


def test_pure_stdlib_isolated_subprocess_import():
    """在无凭据且隔离的最小子进程环境中导入 provider_catalog，确保零外部依赖与零 env 读取。"""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # 构建最小无凭据环境
    clean_env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "PYTHONPATH": backend_dir,
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),  # Windows 兼容
    }

    code = (
        "import sys\n"
        "import provider_catalog\n"
        "from provider_catalog import (\n"
        "    LLM_CLIENT_POLICY,\n"
        "    LLM_PROVIDER_CATALOG,\n"
        "    PROVIDER_CATALOGS,\n"
        "    STT_PROVIDER_CATALOG,\n"
        "    TTS_PROVIDER_CATALOG,\n"
        "    get_llm_provider,\n"
        "    get_stt_provider,\n"
        "    get_tts_provider,\n"
        ")\n"
        "assert LLM_CLIENT_POLICY.default_http_timeout_seconds == 600.0\n"
        "assert LLM_CLIENT_POLICY.connect_timeout_seconds == 5.0\n"
        "assert LLM_CLIENT_POLICY.max_retries == 2\n"
        "assert len(LLM_PROVIDER_CATALOG) == 2\n"
        "assert get_llm_provider('siliconflow').id == 'siliconflow'\n"
        "assert get_llm_provider('siliconflow').label == 'SiliconFlow'\n"
        "assert get_llm_provider('openrouter').id == 'openrouter'\n"
        "assert len(STT_PROVIDER_CATALOG) == 1\n"
        "assert get_stt_provider('deepgram').id == 'deepgram'\n"
        "assert len(TTS_PROVIDER_CATALOG) == 1\n"
        "assert get_tts_provider('cartesia').id == 'cartesia'\n"
        "assert list(PROVIDER_CATALOGS) == ['stt', 'llm', 'tts']\n"
        "# 确保未导入 SDK / 业务模块\n"
        "forbidden = [\n"
        "    'livekit', 'openai', 'httpx', 'aiohttp', 'config',\n"
        "    'sqlalchemy', 'deepgram', 'cartesia',\n"
        "]\n"
        "for mod in forbidden:\n"
        "    assert mod not in sys.modules, f'意外导入了 {mod}'\n"
        "print('ISOLATED_IMPORT_SUCCESS')\n"
    )

    result = subprocess.run(
        [sys.executable, "-c", code],
        env=clean_env,
        capture_output=True,
        text=True,
        check=False,
        timeout=TEST_PROCESS_TIMEOUT_SECONDS,
    )

    assert result.returncode == 0, f"Subprocess failed:\n{result.stderr}"
    assert "ISOLATED_IMPORT_SUCCESS" in result.stdout
