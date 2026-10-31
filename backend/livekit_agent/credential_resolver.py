"""
EchoTalk 自定义凭据解析器 (RF-09 CredentialResolver)。

负责自定义轨 (BYOK) 用户凭据的预检、解密与结构化安全封装：
1. 保持严格 6 项预检顺序（stt_provider -> llm_provider -> tts_provider ->
   encrypted_stt_key -> encrypted_llm_key -> encrypted_tts_key）。
2. 全部预检齐备前零解密；任一解密失败后续零解密。
3. 解密失败固定安全错误码与脱敏消息，不泄露原始异常正文或密钥。
4. 返回不可变 ResolvedCustomCredentials 快照，密钥字段完全排除在 repr/str 之外。
5. 独立纯净边界：不导入 LiveKit SDK、不导入 PluginFactory、不构造插件实例、不修改环境变量。
"""

from dataclasses import dataclass, field
from typing import Any

from livekit_agent.plugin_errors import PluginInitError
from utils.crypto import decrypt_api_key


@dataclass(frozen=True)
class ResolvedCustomCredentials:
    """
    已解析并解密的自定义凭据不可变快照。

    注意：stt_key, llm_key, tts_key 为敏感明文，
    显式标记 repr=False，并在 __repr__ 与 __str__ 中严格隐藏。
    """

    stt_provider: str
    llm_provider: str
    tts_provider: str
    stt_key: str = field(repr=False)
    llm_key: str = field(repr=False)
    tts_key: str = field(repr=False)
    model: str

    def __repr__(self) -> str:
        return (
            f"ResolvedCustomCredentials("
            f"stt_provider={self.stt_provider!r}, "
            f"llm_provider={self.llm_provider!r}, "
            f"tts_provider={self.tts_provider!r}, "
            f"stt_key='***', "
            f"llm_key='***', "
            f"tts_key='***', "
            f"model={self.model!r})"
        )

    def __str__(self) -> str:
        return self.__repr__()


class CredentialResolver:
    """自定义轨凭据预检与解密解析器。"""

    @classmethod
    def resolve_custom(
        cls,
        user_settings: Any,
        default_llm_model: str,
    ) -> ResolvedCustomCredentials:
        """
        根据用户配置进行 6 项预检并按顺序解密自定义 Key。

        参数:
            user_settings: UserSettings ORM 对象或具备同名字段的对象
            default_llm_model: 默认 LLM 模型标识符（当 user_settings.llm_model 未设置时使用）

        返回:
            ResolvedCustomCredentials 不可变凭据快照

        异常:
            PluginInitError: 任一预检缺失或任一密钥解密失败
        """
        us = user_settings

        # ── 1. 严格 6 项必填预检（3 providers -> 3 encrypted keys） ──
        if not getattr(us, "stt_provider", None):
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "自定义模式下 STT provider 未配置。请在设置页面选择提供商。",
            )
        if not getattr(us, "llm_provider", None):
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "自定义模式下 LLM provider 未配置。请在设置页面选择提供商。",
            )
        if not getattr(us, "tts_provider", None):
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "自定义模式下 TTS provider 未配置。请在设置页面选择提供商。",
            )

        encrypted_stt = getattr(us, "encrypted_stt_key", None)
        if not encrypted_stt:
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "自定义模式下 STT API Key 未配置。请在设置页面输入密钥。",
            )
        encrypted_llm = getattr(us, "encrypted_llm_key", None)
        if not encrypted_llm:
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "自定义模式下 LLM API Key 未配置。请在设置页面输入密钥。",
            )
        encrypted_tts = getattr(us, "encrypted_tts_key", None)
        if not encrypted_tts:
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "自定义模式下 TTS API Key 未配置。请在设置页面输入密钥。",
            )

        # ── 2. 依次解密（严格保证失败时零后续解密，不泄露异常正文） ──
        try:
            stt_credential = decrypt_api_key(
                encrypted_stt, getattr(us, "stt_key_version", None)
            )
        except Exception:
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "API Key 解密失败，请重新保存密钥。",
            ) from None

        try:
            llm_credential = decrypt_api_key(
                encrypted_llm, getattr(us, "llm_key_version", None)
            )
        except Exception:
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "API Key 解密失败，请重新保存密钥。",
            ) from None

        try:
            tts_credential = decrypt_api_key(
                encrypted_tts, getattr(us, "tts_key_version", None)
            )
        except Exception:
            raise PluginInitError(
                "ERR_CUSTOM_KEY_INVALID",
                "API Key 解密失败，请重新保存密钥。",
            ) from None

        # ── 3. 提取 provider 字符串与 model ──
        stt_p = getattr(us, "stt_provider", None)
        llm_p = getattr(us, "llm_provider", None)
        tts_p = getattr(us, "tts_provider", None)

        stt_provider_str = getattr(stt_p, "value", stt_p)
        llm_provider_str = getattr(llm_p, "value", llm_p)
        tts_provider_str = getattr(tts_p, "value", tts_p)

        user_model = getattr(us, "llm_model", None)
        model = user_model or default_llm_model

        return ResolvedCustomCredentials(
            stt_provider=str(stt_provider_str),
            llm_provider=str(llm_provider_str),
            tts_provider=str(tts_provider_str),
            stt_key=stt_credential.plaintext,
            llm_key=llm_credential.plaintext,
            tts_key=tts_credential.plaintext,
            model=model,
        )
