"""Provider 凭据拨测，返回稳定错误分类且不记录敏感上游内容。"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Literal

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


class ProviderValidationService:
    REQUEST_TIMEOUT_SECONDS = 8.0

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
    async def validate_all(
        cls,
        stt_provider: str,
        stt_key: str,
        llm_provider: str,
        llm_key: str,
        tts_provider: str,
        tts_key: str,
    ) -> bool:
        """兼容旧调用方；RF-10 将把三路拨测改为并行、有总超时的 Registry。"""
        stt = await cls.validate_stt_key(stt_provider, stt_key)
        if not stt.ok:
            return False
        llm = await cls.validate_llm_key(llm_provider, llm_key)
        if not llm.ok:
            return False
        tts = await cls.validate_tts_key(tts_provider, tts_key)
        return tts.ok
