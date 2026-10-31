import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.validation_service import ProviderValidationService


def mock_aiohttp_get(status=200, exception=None):
    response = MagicMock(status=status)
    context = MagicMock()
    context.__aenter__ = AsyncMock(
        side_effect=exception,
        return_value=None if exception else response,
    )
    context.__aexit__ = AsyncMock(return_value=None)
    return patch("aiohttp.ClientSession.get", return_value=context)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "provider"),
    [
        ("validate_stt_key", "deepgram"),
        ("validate_llm_key", "siliconflow"),
        ("validate_tts_key", "cartesia"),
    ],
)
async def test_missing_key_has_stable_error(method, provider):
    result = await getattr(ProviderValidationService, method)(provider, "")
    assert result.ok is False
    assert result.code == "missing_key"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "provider"),
    [
        ("validate_stt_key", "unsupported-stt"),
        ("validate_llm_key", "unsupported-llm"),
        ("validate_tts_key", "unsupported-tts"),
    ],
)
async def test_unsupported_provider_has_stable_error(method, provider):
    result = await getattr(ProviderValidationService, method)(provider, "key")
    assert result.ok is False
    assert result.code == "unsupported_provider"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "provider", "expected_url", "expected_headers"),
    [
        (
            "validate_stt_key",
            "deepgram",
            "https://api.deepgram.com/v1/projects",
            {"Authorization": "Token secret-value"},
        ),
        (
            "validate_llm_key",
            "siliconflow",
            "https://api.siliconflow.cn/v1/user/info",
            {"Authorization": "Bearer secret-value"},
        ),
        (
            "validate_llm_key",
            "openrouter",
            "https://openrouter.ai/api/v1/auth/key",
            {"Authorization": "Bearer secret-value"},
        ),
        (
            "validate_tts_key",
            "cartesia",
            "https://api.cartesia.ai/voices",
            {"X-API-Key": "secret-value", "Cartesia-Version": "2024-06-10"},
        ),
    ],
)
async def test_successful_provider_validation(
    method, provider, expected_url, expected_headers
):
    with mock_aiohttp_get(status=200) as request:
        result = await getattr(ProviderValidationService, method)(
            provider, "secret-value"
        )
    assert result.ok is True
    assert result.code == "verified"
    request.assert_called_once_with(expected_url, headers=expected_headers)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "auth_error"),
        (403, "auth_error"),
        (429, "rate_limited"),
        (500, "provider_error"),
    ],
)
async def test_http_failures_are_classified(status, code):
    with mock_aiohttp_get(status=status):
        result = await ProviderValidationService.validate_llm_key(
            "openrouter", "secret-value"
        )
    assert result.ok is False
    assert result.code == code


@pytest.mark.asyncio
async def test_unknown_client_exception_is_sanitized(caplog):
    secret = "never-log-this-key"
    with mock_aiohttp_get(exception=Exception("raw upstream body with secret")):
        result = await ProviderValidationService.validate_stt_key("deepgram", secret)
    assert result.code == "provider_error"
    assert secret not in caplog.text
    assert "raw upstream body" not in caplog.text


@pytest.mark.asyncio
async def test_validate_all_preserves_boolean_compatibility():
    with mock_aiohttp_get(status=200):
        result = await ProviderValidationService.validate_all(
            "deepgram",
            "stt-key",
            "siliconflow",
            "llm-key",
            "cartesia",
            "tts-key",
        )
    assert result is True


@pytest.mark.asyncio
async def test_validate_llm_key_derived_from_catalog():
    """验证 validate_llm_key 调用的 URL 与 Bearer Header 严格匹配 catalog 定义。"""
    from provider_catalog import LLM_PROVIDER_CATALOG

    for provider, meta in LLM_PROVIDER_CATALOG.items():
        with mock_aiohttp_get(status=200) as request:
            res = await ProviderValidationService.validate_llm_key(
                provider, "catalog-secret"
            )
            assert res.ok is True
            assert res.code == "verified"
            request.assert_called_once_with(
                meta.validation_url,
                headers={"Authorization": "Bearer catalog-secret"},
            )


@pytest.mark.asyncio
async def test_validate_speech_keys_derived_from_catalog():
    """验证 validate_stt_key/validate_tts_key 调用的 URL 与 Headers 严格匹配 catalog 定义且防跨请求污染。"""
    from provider_catalog import STT_PROVIDER_CATALOG, TTS_PROVIDER_CATALOG

    # STT Deepgram 匹配 catalog 定义
    for provider, meta in STT_PROVIDER_CATALOG.items():
        with mock_aiohttp_get(status=200) as request:
            res = await ProviderValidationService.validate_stt_key(
                provider, "stt-catalog-secret"
            )
            assert res.ok is True
            assert res.code == "verified"
            expected_headers = meta.build_validation_headers("stt-catalog-secret")
            request.assert_called_once_with(
                meta.validation_url,
                headers=expected_headers,
            )

    # TTS Cartesia 匹配 catalog 定义
    for provider, meta in TTS_PROVIDER_CATALOG.items():
        with mock_aiohttp_get(status=200) as request:
            res = await ProviderValidationService.validate_tts_key(
                provider, "tts-catalog-secret"
            )
            assert res.ok is True
            assert res.code == "verified"
            expected_headers = meta.build_validation_headers("tts-catalog-secret")
            request.assert_called_once_with(
                meta.validation_url,
                headers=expected_headers,
            )

    # 验证两次不同 key 的校验调用生成的 headers 独立，不发生凭据残留或交叉污染
    with mock_aiohttp_get(status=200) as req1:
        await ProviderValidationService.validate_tts_key("cartesia", "key-alpha")
        h1 = req1.call_args.kwargs["headers"]

    with mock_aiohttp_get(status=200) as req2:
        await ProviderValidationService.validate_tts_key("cartesia", "key-beta")
        h2 = req2.call_args.kwargs["headers"]

    assert h1["X-API-Key"] == "key-alpha"
    assert h2["X-API-Key"] == "key-beta"
    assert h1 is not h2


@pytest.mark.asyncio
async def test_validate_parallel_empty_input():
    """空输入返回空字典，零 task 创建。"""
    results = await ProviderValidationService.validate_parallel([])
    assert results == {}


@pytest.mark.asyncio
async def test_validate_parallel_stable_order():
    """输出字典严格按输入的 role 顺序组织，不受底层完成先后影响。"""
    from services.validation_service import ProviderValidationResult

    tts_done = asyncio.Event()
    llm_done = asyncio.Event()
    completion_order: list[str] = []

    # TTS 最先完成，LLM 次之，STT 最后完成，全部通过事件同步无 sleep
    async def fake_stt(provider, key):
        await llm_done.wait()
        completion_order.append("stt")
        return ProviderValidationResult(True, "verified")

    async def fake_llm(provider, key):
        await tts_done.wait()
        completion_order.append("llm")
        llm_done.set()
        return ProviderValidationResult(True, "verified")

    async def fake_tts(provider, key):
        completion_order.append("tts")
        tts_done.set()
        return ProviderValidationResult(True, "verified")

    with (
        patch.object(
            ProviderValidationService, "validate_stt_key", side_effect=fake_stt
        ),
        patch.object(
            ProviderValidationService, "validate_llm_key", side_effect=fake_llm
        ),
        patch.object(
            ProviderValidationService, "validate_tts_key", side_effect=fake_tts
        ),
    ):
        items = [
            ("stt", "deepgram", "k1"),
            ("llm", "siliconflow", "k2"),
            ("tts", "cartesia", "k3"),
        ]
        results = await ProviderValidationService.validate_parallel(items)

    assert completion_order == ["tts", "llm", "stt"]
    assert list(results.keys()) == ["stt", "llm", "tts"]
    assert all(r.ok for r in results.values())


@pytest.mark.asyncio
async def test_validate_parallel_total_timeout_and_pending_cleanup():
    """总超时时已完成的保留结果，pending 的标记为 timeout 并被 cancel 与 await 清理。"""
    from services.validation_service import ProviderValidationResult

    stt_done = ProviderValidationResult(True, "verified")
    tts_cancelled = False
    never_event = asyncio.Event()

    async def fake_stt(provider, key):
        return stt_done

    async def fake_tts(provider, key):
        nonlocal tts_cancelled
        try:
            await never_event.wait()
            return ProviderValidationResult(True, "verified")
        except asyncio.CancelledError:
            tts_cancelled = True
            raise

    with (
        patch.object(
            ProviderValidationService, "validate_stt_key", side_effect=fake_stt
        ),
        patch.object(
            ProviderValidationService, "validate_tts_key", side_effect=fake_tts
        ),
    ):
        items = [
            ("stt", "deepgram", "k1"),
            ("tts", "cartesia", "k2"),
        ]
        results = await ProviderValidationService.validate_parallel(
            items, total_timeout=0.03
        )

    assert results["stt"] == stt_done
    assert results["tts"].ok is False
    assert results["tts"].code == "timeout"
    assert tts_cancelled is True


@pytest.mark.asyncio
async def test_validate_parallel_unexpected_exception_cleanup_and_reraise():
    """未被捕获的底层异常先收束 pending 任务，随后原样抛出，不吞掉异常。"""
    tts_cancelled = False
    never_event = asyncio.Event()

    async def fake_stt(provider, key):
        raise TypeError("Unexpected programming error in STT")

    async def fake_tts(provider, key):
        nonlocal tts_cancelled
        try:
            await never_event.wait()
        except asyncio.CancelledError:
            tts_cancelled = True
            raise

    with (
        patch.object(
            ProviderValidationService, "validate_stt_key", side_effect=fake_stt
        ),
        patch.object(
            ProviderValidationService, "validate_tts_key", side_effect=fake_tts
        ),
    ):
        items = [
            ("stt", "deepgram", "k1"),
            ("tts", "cartesia", "k2"),
        ]
        with pytest.raises(TypeError, match="Unexpected programming error in STT"):
            await ProviderValidationService.validate_parallel(items, total_timeout=1.0)

    assert tts_cancelled is True


@pytest.mark.asyncio
async def test_validate_all_parallel_boolean_compatibility():
    """validate_all 保持 bool 兼容，复用 validate_parallel 并实际并发执行三路拨测。"""
    from services.validation_service import ProviderValidationResult

    barrier = asyncio.Barrier(3)

    async def fake_ok(provider, key):
        await barrier.wait()
        return ProviderValidationResult(True, "verified")

    with (
        patch.object(
            ProviderValidationService, "validate_stt_key", side_effect=fake_ok
        ),
        patch.object(
            ProviderValidationService, "validate_llm_key", side_effect=fake_ok
        ),
        patch.object(
            ProviderValidationService, "validate_tts_key", side_effect=fake_ok
        ),
    ):
        res = await ProviderValidationService.validate_all(
            "deepgram", "k1", "siliconflow", "k2", "cartesia", "k3"
        )
        assert res is True

    # 全部成功返回 True（验证委托给 validate_parallel 的精确参数）
    with patch.object(
        ProviderValidationService,
        "validate_parallel",
        new_callable=AsyncMock,
        return_value={
            "stt": ProviderValidationResult(True, "verified"),
            "llm": ProviderValidationResult(True, "verified"),
            "tts": ProviderValidationResult(True, "verified"),
        },
    ) as mock_parallel:
        res = await ProviderValidationService.validate_all(
            "deepgram", "k1", "siliconflow", "k2", "cartesia", "k3"
        )
        assert res is True
        mock_parallel.assert_called_once_with(
            [
                ("stt", "deepgram", "k1"),
                ("llm", "siliconflow", "k2"),
                ("tts", "cartesia", "k3"),
            ]
        )

    # 任一失败返回 False
    with patch.object(
        ProviderValidationService,
        "validate_parallel",
        new_callable=AsyncMock,
        return_value={
            "stt": ProviderValidationResult(True, "verified"),
            "llm": ProviderValidationResult(False, "auth_error"),
            "tts": ProviderValidationResult(True, "verified"),
        },
    ):
        res = await ProviderValidationService.validate_all(
            "deepgram", "k1", "siliconflow", "k2", "cartesia", "k3"
        )
        assert res is False

    # 超时返回 False
    with patch.object(
        ProviderValidationService,
        "validate_parallel",
        new_callable=AsyncMock,
        return_value={
            "stt": ProviderValidationResult(True, "verified"),
            "llm": ProviderValidationResult(True, "verified"),
            "tts": ProviderValidationResult(False, "timeout"),
        },
    ):
        res = await ProviderValidationService.validate_all(
            "deepgram", "k1", "siliconflow", "k2", "cartesia", "k3"
        )
        assert res is False
