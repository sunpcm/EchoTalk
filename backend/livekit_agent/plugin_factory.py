"""双轨制插件工厂：STT / LLM / TTS / VAD 插件的统一构建入口与预检校验。"""

import logging
from typing import Any

from livekit.plugins import cartesia, deepgram, silero
from livekit.plugins import openai as lk_openai

from config import settings

logger = logging.getLogger("echotalk-agent")

# LLM provider → base_url 映射（自包含，不依赖 llm_service.py）
LLM_PROVIDER_BASE_URL: dict[str, str] = {
    "siliconflow": "https://api.siliconflow.cn/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}

# 支持的 provider 集合（用于预检校验）
SUPPORTED_STT_PROVIDERS: set[str] = {"deepgram"}
SUPPORTED_LLM_PROVIDERS: set[str] = set(LLM_PROVIDER_BASE_URL.keys())
SUPPORTED_TTS_PROVIDERS: set[str] = {"cartesia"}

# 系统 LLM provider 名 → settings 字段名的映射（仅基础轨使用）
_SYSTEM_LLM_KEY_FIELD: dict[str, str] = {
    "siliconflow": "SILICONFLOW_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


class PluginInitError(Exception):
    """插件初始化失败异常。用于自定义轨模式下的 fail-fast 报错。"""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")


class PluginFactory:
    """
    双轨制插件工厂。

    提供静态方法，根据显式传入的 provider 名称和 API Key 构建各管线插件。
    所有 create_* 方法执行预检校验：拒绝空 Key、不支持的 provider。
    插件构造器本身不发起网络请求，仅保存对应的配置。

    用法:
    - 基础轨: PluginFactory.from_system_defaults()
    - 自定义轨: 逐个调用 create_stt / create_llm / create_tts + create_vad
    """

    @staticmethod
    def create_stt(provider: str, api_key: str) -> deepgram.STT:
        """
        构建 STT 插件实例。

        参数:
            provider: STT 提供商名称（当前仅支持 "deepgram"）
            api_key: 明文 API Key

        异常:
            PluginInitError: provider 不支持或 api_key 为空
        """
        if provider not in SUPPORTED_STT_PROVIDERS:
            raise PluginInitError(
                "ERR_UNSUPPORTED_STT_PROVIDER",
                f"不支持的 STT provider: '{provider}'。"
                f"支持: {sorted(SUPPORTED_STT_PROVIDERS)}",
            )
        if not api_key or not api_key.strip():
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                f"STT provider '{provider}' 的 API Key 为空。",
            )
        return deepgram.STT(api_key=api_key.strip())

    @staticmethod
    def create_llm(
        provider: str,
        api_key: str,
        model: str,
        temperature: float = 0.7,
    ) -> lk_openai.LLM:
        """
        构建 LLM 插件实例。根据 provider 自动查找 base_url。

        参数:
            provider: LLM 提供商名称（"siliconflow" 或 "openrouter"）
            api_key: 明文 API Key
            model: 模型标识符，如 "Qwen/Qwen2.5-7B-Instruct"
            temperature: 采样温度，默认 0.7

        异常:
            PluginInitError: provider 不支持、api_key 为空或 model 为空
        """
        if provider not in SUPPORTED_LLM_PROVIDERS:
            raise PluginInitError(
                "ERR_UNSUPPORTED_LLM_PROVIDER",
                f"不支持的 LLM provider: '{provider}'。"
                f"支持: {sorted(SUPPORTED_LLM_PROVIDERS)}",
            )
        if not api_key or not api_key.strip():
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                f"LLM provider '{provider}' 的 API Key 为空。",
            )
        if not model or not model.strip():
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "LLM 模型名称为空。",
            )
        base_url = LLM_PROVIDER_BASE_URL[provider]
        return lk_openai.LLM(
            model=model.strip(),
            base_url=base_url,
            api_key=api_key.strip(),
            temperature=temperature,
        )

    @staticmethod
    def create_tts(provider: str, api_key: str) -> cartesia.TTS:
        """
        构建 TTS 插件实例。

        参数:
            provider: TTS 提供商名称（当前仅支持 "cartesia"）
            api_key: 明文 API Key

        异常:
            PluginInitError: provider 不支持或 api_key 为空
        """
        if provider not in SUPPORTED_TTS_PROVIDERS:
            raise PluginInitError(
                "ERR_UNSUPPORTED_TTS_PROVIDER",
                f"不支持的 TTS provider: '{provider}'。"
                f"支持: {sorted(SUPPORTED_TTS_PROVIDERS)}",
            )
        if not api_key or not api_key.strip():
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                f"TTS provider '{provider}' 的 API Key 为空。",
            )
        return cartesia.TTS(api_key=api_key.strip())

    @staticmethod
    def create_vad() -> silero.VAD:
        """构建 VAD 插件实例（始终使用系统内置 Silero 模型，无 BYOK）。"""
        return silero.VAD.load()

    @classmethod
    def from_system_defaults(cls) -> dict[str, Any]:
        """
        基础轨便捷方法：从系统 .env 配置构建全套插件。

        读取 settings.DEFAULT_LLM_PROVIDER 确定 LLM 提供商，
        然后从 settings 获取对应的 API Key。

        返回:
            {"stt": deepgram.STT, "llm": lk_openai.LLM,
             "tts": cartesia.TTS, "vad": silero.VAD}

        异常:
            PluginInitError: 系统配置缺失或无效
        """
        provider_name = settings.DEFAULT_LLM_PROVIDER
        llm_key_field = _SYSTEM_LLM_KEY_FIELD.get(provider_name)
        if not llm_key_field:
            raise PluginInitError(
                "ERR_SYSTEM_CONFIG",
                f"系统 LLM provider '{provider_name}' 未在 "
                f"_SYSTEM_LLM_KEY_FIELD 中注册。",
            )
        llm_api_key = getattr(settings, llm_key_field, "")

        return {
            "stt": cls.create_stt("deepgram", settings.DEEPGRAM_API_KEY),
            "llm": cls.create_llm(
                provider=provider_name,
                api_key=llm_api_key,
                model=settings.DEFAULT_LLM_MODEL,
            ),
            "tts": cls.create_tts("cartesia", settings.CARTESIA_API_KEY),
            "vad": cls.create_vad(),
        }
