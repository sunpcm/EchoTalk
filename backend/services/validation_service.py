import logging
import aiohttp

logger = logging.getLogger("echotalk.validation_service")


class ProviderValidationService:
    @staticmethod
    async def validate_stt_key(provider: str, api_key: str) -> bool:
        if not api_key:
            return False
        if provider == "deepgram":
            # 拨测 Deepgram API
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        "https://api.deepgram.com/v1/projects",
                        headers={"Authorization": f"Token {api_key}"},
                    ) as resp:
                        return resp.status == 200
            except Exception as e:
                logger.error(f"Deepgram 验证异常: {e}")
                return False
        return False

    @staticmethod
    async def validate_llm_key(provider: str, api_key: str) -> bool:
        if not api_key:
            return False
        if provider == "siliconflow":
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        "https://api.siliconflow.cn/v1/user/info",
                        headers={"Authorization": f"Bearer {api_key}"},
                    ) as resp:
                        return resp.status == 200
            except Exception as e:
                logger.error(f"SiliconFlow 验证异常: {e}")
                return False
        elif provider == "openrouter":
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        "https://openrouter.ai/api/v1/auth/key",
                        headers={"Authorization": f"Bearer {api_key}"},
                    ) as resp:
                        return resp.status == 200
            except Exception as e:
                logger.error(f"OpenRouter 验证异常: {e}")
                return False
        return False

    @staticmethod
    async def validate_tts_key(provider: str, api_key: str) -> bool:
        if not api_key:
            return False
        if provider == "cartesia":
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        "https://api.cartesia.ai/voices",
                        headers={
                            "X-API-Key": api_key,
                            "Cartesia-Version": "2024-06-10",
                        },
                    ) as resp:
                        return resp.status == 200
            except Exception as e:
                logger.error(f"Cartesia 验证异常: {e}")
                return False
        return False

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
        """只有全量验证通过才返回 True"""
        stt_ok = await cls.validate_stt_key(stt_provider, stt_key)
        if not stt_ok:
            return False
        llm_ok = await cls.validate_llm_key(llm_provider, llm_key)
        if not llm_ok:
            return False
        tts_ok = await cls.validate_tts_key(tts_provider, tts_key)
        if not tts_ok:
            return False
        return True
