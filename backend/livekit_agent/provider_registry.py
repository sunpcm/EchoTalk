"""
EchoTalk Provider 注册中心与插件集构造收口边界 (RF-09 ProviderRegistry)。

负责将已解析并解密的自定义凭据快照或系统默认设置组织构建为四个管线插件 (STT, LLM, TTS, VAD)：
1. from_custom: 仅接收 ResolvedCustomCredentials 不可变快照，不接触 ORM 模型、不解密、
   不修改系统环境变量、不自行兜底默认值。
2. 严格保持插件构造顺序（STT → LLM → TTS → VAD）与异常短路：若前序角色构造抛错，
   后续角色构造绝不执行。
3. 实际插件实例创建严格委托 PluginFactory.create_*。
4. from_system_defaults: 基础轨全套插件便捷构造入口，严格委托 PluginFactory.from_system_defaults()，
   不读取任何用户加密字段、不触发凭据解密或 CredentialResolver。
5. 返回结构严格为包含 {"stt": ..., "llm": ..., "tts": ..., "vad": ...} 的字典。
"""

from typing import Any

from livekit_agent.credential_resolver import ResolvedCustomCredentials
from livekit_agent.plugin_factory import PluginFactory


class ProviderRegistry:
    """LiveKit 语音管线 Provider 注册中心与插件集构造入口。"""

    @classmethod
    def from_custom(
        cls,
        resolved: ResolvedCustomCredentials,
    ) -> dict[str, Any]:
        """
        根据已解析凭据快照构建自定义轨插件集。

        构造顺序严格为 STT → LLM → TTS → VAD，任一角色失败立即短路中断。

        参数:
            resolved: ResolvedCustomCredentials 不可变凭据快照

        返回:
            {"stt": ..., "llm": ..., "tts": ..., "vad": ...}

        异常:
            TypeError: 当 resolved 并非 ResolvedCustomCredentials 实例时
            PluginInitError: 当 provider 不支持或 API Key 校验失败时
        """
        if not isinstance(resolved, ResolvedCustomCredentials):
            raise TypeError(
                f"resolved 必须为 ResolvedCustomCredentials 实例，收到: {type(resolved).__name__}"
            )

        stt = PluginFactory.create_stt(
            resolved.stt_provider,
            resolved.stt_key,
        )
        llm = PluginFactory.create_llm(
            resolved.llm_provider,
            resolved.llm_key,
            resolved.model,
        )
        tts = PluginFactory.create_tts(
            resolved.tts_provider,
            resolved.tts_key,
        )
        vad = PluginFactory.create_vad()

        return {
            "stt": stt,
            "llm": llm,
            "tts": tts,
            "vad": vad,
        }

    @classmethod
    def from_system_defaults(cls) -> dict[str, Any]:
        """
        构建基础轨插件集。

        直接委托 PluginFactory.from_system_defaults()，
        零用户加密字段读取、零解密操作、零 CredentialResolver 依赖。

        返回:
            {"stt": ..., "llm": ..., "tts": ..., "vad": ...}
        """
        return PluginFactory.from_system_defaults()
