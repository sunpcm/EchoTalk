"""LLM Provider Catalog 单一元数据来源与消费者接线测试。"""

import os
import subprocess
import sys
from dataclasses import FrozenInstanceError
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from livekit_agent.plugin_factory import (
    _SYSTEM_LLM_KEY_FIELD,
    LLM_PROVIDER_BASE_URL,
    SUPPORTED_LLM_PROVIDERS,
    PluginFactory,
    PluginInitError,
)
from provider_catalog import (
    LLM_PROVIDER_CATALOG,
    LLMProviderMetadata,
    get_llm_provider,
)
from services.llm_service import PROVIDER_CONFIG
from services.validation_service import ProviderValidationService


def test_catalog_structure_and_exact_values():
    """验证 Catalog 包含精确的两家 Provider、顺序及各常量值。"""
    # 严格保持两家 Provider 及插入顺序
    assert list(LLM_PROVIDER_CATALOG.keys()) == ["siliconflow", "openrouter"]

    sf = LLM_PROVIDER_CATALOG["siliconflow"]
    assert sf.id == "siliconflow"
    assert sf.base_url == "https://api.siliconflow.cn/v1"
    assert sf.api_key_field == "SILICONFLOW_API_KEY"
    assert sf.validation_url == "https://api.siliconflow.cn/v1/user/info"

    or_meta = LLM_PROVIDER_CATALOG["openrouter"]
    assert or_meta.id == "openrouter"
    assert or_meta.base_url == "https://openrouter.ai/api/v1"
    assert or_meta.api_key_field == "OPENROUTER_API_KEY"
    assert or_meta.validation_url == "https://openrouter.ai/api/v1/auth/key"

    assert get_llm_provider("siliconflow") == sf
    assert get_llm_provider("openrouter") == or_meta
    assert get_llm_provider("unsupported_provider") is None


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

    # 2. 条目本身不可篡改 (frozen dataclass)
    sf = LLM_PROVIDER_CATALOG["siliconflow"]
    with pytest.raises((FrozenInstanceError, AttributeError)):
        sf.base_url = "https://mutated.com"  # type: ignore


def test_consumer_wiring_plugin_factory():
    """验证 livekit_agent.plugin_factory 严格从 Catalog 派生配置。"""
    # 导出变量名、类型及顺序保持
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
async def test_consumer_wiring_validation_service(provider):
    """验证 services.validation_service 严格使用 Catalog 的 validation_url 及 Bearer Header。"""
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

        # 缺失 key
        res_missing = await ProviderValidationService.validate_llm_key(
            "siliconflow", ""
        )
        assert res_missing.ok is False
        assert res_missing.code == "missing_key"
        mock_get.assert_not_called()

    # plugin_factory 针对不支持 provider 及空 key 抛错且零插件构造
    with pytest.raises(PluginInitError) as exc_unsupported:
        PluginFactory.create_llm("unknown_provider", "key", "model")
    assert exc_unsupported.value.code == "ERR_UNSUPPORTED_LLM_PROVIDER"

    with pytest.raises(PluginInitError) as exc_missing:
        PluginFactory.create_llm("siliconflow", "", "model")
    assert exc_missing.value.code == "ERR_CUSTOM_KEY_INVALID"


def test_pure_stdlib_isolated_subprocess_import():
    """在无凭据且隔离的最小子进程环境中导入 provider_catalog，确保零外部依赖与零 env 读取。"""
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # 构建最小无凭据环境
    clean_env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": backend_dir,
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),  # Windows 兼容
    }

    code = (
        "import sys\n"
        "import provider_catalog\n"
        "from provider_catalog import LLM_PROVIDER_CATALOG, get_llm_provider\n"
        "assert len(LLM_PROVIDER_CATALOG) == 2\n"
        "assert get_llm_provider('siliconflow').id == 'siliconflow'\n"
        "assert get_llm_provider('openrouter').id == 'openrouter'\n"
        "# 确保未导入 SDK / 业务模块\n"
        "forbidden = ['livekit', 'openai', 'aiohttp', 'config', 'sqlalchemy']\n"
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
    )

    assert result.returncode == 0, f"Subprocess failed:\n{result.stderr}"
    assert "ISOLATED_IMPORT_SUCCESS" in result.stdout
