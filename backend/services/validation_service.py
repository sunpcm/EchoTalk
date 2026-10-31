"""Provider 凭据拨测，返回稳定错误分类且不记录敏感上游内容。"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Literal, Sequence

import aiohttp

from provider_catalog import (
    LLM_PROVIDER_CATALOG,
    STT_PROVIDER_CATALOG,
    TTS_PROVIDER_CATALOG,
)

logger = logging.getLogger("echotalk.validation_service")

ValidationCode = Literal[
    "verified",
    "auth_error",
    "rate_limited",
    "timeout",
    "network_error",
    "provider_error",
    "unsupported_provider",
    "missing_key",
]


@dataclass(frozen=True)
class ProviderValidationResult:
    ok: bool
    code: ValidationCode


def _normalize_result(
    result: ProviderValidationResult | bool,
) -> ProviderValidationResult:
    if isinstance(result, ProviderValidationResult):
        return result
    return ProviderValidationResult(
        bool(result), "verified" if result else "provider_error"
    )


class ProviderValidationService:
    REQUEST_TIMEOUT_SECONDS = 8.0
    TOTAL_TIMEOUT_SECONDS = 10.0

    @classmethod
    async def _validate(
        cls,
        provider: str,
        api_key: str,
        *,
        url: str,
        headers: dict[str, str],
    ) -> ProviderValidationResult:
        if not api_key:
            return ProviderValidationResult(False, "missing_key")
        timeout = aiohttp.ClientTimeout(total=cls.REQUEST_TIMEOUT_SECONDS)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as response:
                    if response.status == 200:
                        return ProviderValidationResult(True, "verified")
                    if response.status in {401, 403}:
                        code: ValidationCode = "auth_error"
                    elif response.status == 429:
                        code = "rate_limited"
                    else:
                        code = "provider_error"
        except (asyncio.TimeoutError, TimeoutError):
            code = "timeout"
        except aiohttp.ClientError:
            code = "network_error"
        except Exception:  # 防御第三方客户端的非标准异常；不得记录异常正文
            code = "provider_error"
        logger.warning(
            "Provider key validation failed: provider=%s code=%s", provider, code
        )
        return ProviderValidationResult(False, code)

    @classmethod
    async def validate_stt_key(
        cls, provider: str, api_key: str
    ) -> ProviderValidationResult:
        meta = STT_PROVIDER_CATALOG.get(provider)
        if meta is None:
            return ProviderValidationResult(False, "unsupported_provider")
        return await cls._validate(
            provider,
            api_key,
            url=meta.validation_url,
            headers=meta.build_validation_headers(api_key),
        )

    @classmethod
    async def validate_llm_key(
        cls, provider: str, api_key: str
    ) -> ProviderValidationResult:
        meta = LLM_PROVIDER_CATALOG.get(provider)
        if meta is None:
            return ProviderValidationResult(False, "unsupported_provider")
        return await cls._validate(
            provider,
            api_key,
            url=meta.validation_url,
            headers={"Authorization": f"Bearer {api_key}"},
        )

    @classmethod
    async def validate_tts_key(
        cls, provider: str, api_key: str
    ) -> ProviderValidationResult:
        meta = TTS_PROVIDER_CATALOG.get(provider)
        if meta is None:
            return ProviderValidationResult(False, "unsupported_provider")
        return await cls._validate(
            provider,
            api_key,
            url=meta.validation_url,
            headers=meta.build_validation_headers(api_key),
        )

    @classmethod
    async def validate_parallel(
        cls,
        validations: Sequence[tuple[str, str, str]],
        *,
        total_timeout: float | None = None,
    ) -> dict[str, ProviderValidationResult]:
        """有界并行验证入口。

        输入按 STT、LLM、TTS 确定顺序组织，仅包含确实需要拨测的 role。
        输出按输入顺序稳定映射为 dict[role, ProviderValidationResult]。
        统一总预算固定为 TOTAL_TIMEOUT_SECONDS (10.0s)。
        """
        if not validations:
            return {}

        budget = cls.TOTAL_TIMEOUT_SECONDS if total_timeout is None else total_timeout

        async def _run_single(
            role: str, provider: str, key: str
        ) -> tuple[str, ProviderValidationResult]:
            if role == "stt":
                res = await cls.validate_stt_key(provider, key)
            elif role == "llm":
                res = await cls.validate_llm_key(provider, key)
            elif role == "tts":
                res = await cls.validate_tts_key(provider, key)
            else:
                res = ProviderValidationResult(False, "unsupported_provider")
            return role, _normalize_result(res)

        tasks: list[asyncio.Task[tuple[str, ProviderValidationResult]]] = [
            asyncio.create_task(_run_single(role, provider, key))
            for role, provider, key in validations
        ]

        try:
            done, pending = await asyncio.wait(
                tasks, timeout=budget, return_when=asyncio.FIRST_EXCEPTION
            )
        except BaseException:
            for t in tasks:
                if not t.done():
                    t.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            raise

        first_exception: BaseException | None = None
        for t in tasks:
            if t in done and not t.cancelled():
                exc = t.exception()
                if exc is not None and first_exception is None:
                    first_exception = exc

        if pending:
            for t in pending:
                t.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

        if first_exception is not None:
            raise first_exception

        results: dict[str, ProviderValidationResult] = {}
        for (role, _, _), t in zip(validations, tasks):
            if t in done and not t.cancelled() and t.exception() is None:
                _, res = t.result()
                results[role] = res
            else:
                results[role] = ProviderValidationResult(False, "timeout")

        return results

    @classmethod
    async def validate_all(
        cls,
        stt_provider: str,
        stt_key: str,
        llm_provider: str,
        llm_key: str,
        tts_provider: str,
        tts_key: str,
    ) -> bool:
        """兼容旧调用方；RF-10 有界并行验证，任一失败或超时返回 False。"""
        items = [
            ("stt", stt_provider, stt_key),
            ("llm", llm_provider, llm_key),
            ("tts", tts_provider, tts_key),
        ]
        results = await cls.validate_parallel(items)
        return len(results) == 3 and all(res.ok for res in results.values())
