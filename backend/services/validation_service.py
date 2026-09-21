"""Provider 凭据拨测，返回稳定错误分类且不记录敏感上游内容。"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Literal

import aiohttp

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
        logger.warning("Provider key validation failed: provider=%s code=%s", provider, code)
        return ProviderValidationResult(False, code)

    @classmethod
    async def validate_stt_key(
        cls, provider: str, api_key: str
    ) -> ProviderValidationResult:
        if provider != "deepgram":
            return ProviderValidationResult(False, "unsupported_provider")
        return await cls._validate(
            provider,
            api_key,
            url="https://api.deepgram.com/v1/projects",
            headers={"Authorization": f"Token {api_key}"},
        )

    @classmethod
    async def validate_llm_key(
        cls, provider: str, api_key: str
    ) -> ProviderValidationResult:
        endpoints = {
            "siliconflow": (
                "https://api.siliconflow.cn/v1/user/info",
                {"Authorization": f"Bearer {api_key}"},
            ),
            "openrouter": (
                "https://openrouter.ai/api/v1/auth/key",
                {"Authorization": f"Bearer {api_key}"},
            ),
        }
        endpoint = endpoints.get(provider)
        if endpoint is None:
            return ProviderValidationResult(False, "unsupported_provider")
        return await cls._validate(
            provider,
            api_key,
            url=endpoint[0],
            headers=endpoint[1],
        )

    @classmethod
    async def validate_tts_key(
        cls, provider: str, api_key: str
    ) -> ProviderValidationResult:
        if provider != "cartesia":
            return ProviderValidationResult(False, "unsupported_provider")
        return await cls._validate(
            provider,
            api_key,
            url="https://api.cartesia.ai/voices",
            headers={"X-API-Key": api_key, "Cartesia-Version": "2024-06-10"},
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
