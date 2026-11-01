"""
EchoTalk LiveKit Agent 安全错误映射器 (RF-09 AgentErrorMapper)。

提供集中、单一的安全边界：
1. 错误码与静态安全本地化文本映射，阻断异常文本或凭据向客户端回显。
2. 异常分类逻辑（运行时认证、不可恢复、可恢复、启动失败等）。
3. 严格字段净化辅助函数（session_id UUID 校验、安全 HTTP 状态码、安全布尔值等）。
4. 纯函数优先 stdlib，零网络/数据库/dotenv/插件构建副作用。
"""

import uuid
from typing import Any

from livekit.agents import APIStatusError

# 协议支持的全部既有错误码白名单
KNOWN_ERROR_CODES: set[str] = {
    "ERR_CUSTOM_KEY_INVALID",
    "ERR_UNSUPPORTED_STT_PROVIDER",
    "ERR_UNSUPPORTED_LLM_PROVIDER",
    "ERR_UNSUPPORTED_TTS_PROVIDER",
    "ERR_SYSTEM_CONFIG",
    "ERR_SESSION_NOT_FOUND",
    "ERR_CUSTOM_RUNTIME_AUTH",
    "ERR_CUSTOM_RUNTIME",
    "ERR_SYSTEM_RUNTIME",
}

# 静态安全本地化指引消息（严禁使用插值拼接动态异常正文）
SAFE_ERROR_MESSAGES: dict[str, str] = {
    "ERR_CUSTOM_KEY_INVALID": "自定义模式下 API Key 无效或未配置，请在设置页面检查密钥。",
    "ERR_UNSUPPORTED_STT_PROVIDER": "不支持的 STT 提供商配置，请在设置页面选择有效的提供商。",
    "ERR_UNSUPPORTED_LLM_PROVIDER": "不支持的 LLM 提供商配置，请在设置页面选择有效的提供商。",
    "ERR_UNSUPPORTED_TTS_PROVIDER": "不支持的 TTS 提供商配置，请在设置页面选择有效的提供商。",
    "ERR_SYSTEM_CONFIG": "系统配置错误，请稍后重试。",
    "ERR_SESSION_NOT_FOUND": "无法找到您的会话配置，请重新登录后再试。",
    "ERR_CUSTOM_RUNTIME_AUTH": "您的自定义 API Key 认证失败（HTTP 401/403），请检查密钥是否有效。",
    "ERR_CUSTOM_RUNTIME": "自定义 API 服务请求失败，请检查服务配置与网络连接。",
    "ERR_SYSTEM_RUNTIME": "语音管线启动失败，请稍后重试。",
}

# 允许记录的安全错误类型白名单（小写）
SAFE_ERROR_TYPES: set[str] = {
    "unknown",
    "connection",
    "runtime",
    "audio",
    "stt",
    "llm",
    "tts",
    "vad",
}


class AgentErrorMapper:
    """LiveKit Agent 安全错误映射单一入口。"""

    @classmethod
    def map_error(
        cls,
        code: Any,
        message: Any = None,
        *,
        fallback_code: str = "ERR_SYSTEM_RUNTIME",
    ) -> tuple[str, str]:
        """
        将任意 code 和 message 映射为安全白名单中的 (code, message) 元组。

        若 code 不在已知白名单中，降级为 fallback_code。
        message 始终强制使用白名单静态本地化指引，绝不回显外部传入的 raw 片段。
        """
        target_fallback = (
            fallback_code
            if fallback_code in KNOWN_ERROR_CODES
            else "ERR_SYSTEM_RUNTIME"
        )
        if isinstance(code, str) and code in KNOWN_ERROR_CODES:
            safe_code = code
        else:
            safe_code = target_fallback

        return safe_code, SAFE_ERROR_MESSAGES[safe_code]

    @classmethod
    def classify_runtime_error(
        cls,
        inner_error: Any,
        actual_exception: Any,
        *,
        is_custom: bool,
    ) -> tuple[str, str] | None:
        """
        根据运行时错误对象分类为安全错误元组，或返回 None（交由 SDK 默认处理）。

        规则：
        - 基础轨 (is_custom=False): 始终返回 None，交由 SDK 默认处理。
        - 自定义轨 (is_custom=True):
          - isinstance(actual_exception, APIStatusError):
            - status_code in (401, 403): 映射为 ERR_CUSTOM_RUNTIME_AUTH
            - 其他 status_code (如 429, 500): 即使正文提及 401/unauthorized，也绝不误判为 AUTH！
              若 recoverable is False 映射为 ERR_CUSTOM_RUNTIME；若 recoverable is True 返回 None。
          - isinstance(actual_exception, Exception) (非 APIStatusError):
            - 检查文本线索 "401", "403", "unauthorized": 命中则映射为 ERR_CUSTOM_RUNTIME_AUTH
            - 未命中: 若 recoverable is False 映射为 ERR_CUSTOM_RUNTIME；若 recoverable is True 返回 None。
        """
        if not is_custom:
            return None

        # 检查是否为认证错误：typed APIStatusError 与 legacy 文本分支严格互斥
        is_auth = False
        if isinstance(actual_exception, APIStatusError):
            is_auth = actual_exception.status_code in (401, 403)
        elif isinstance(actual_exception, Exception):
            try:
                err_text = str(actual_exception).lower()
                if "401" in err_text or "403" in err_text or "unauthorized" in err_text:
                    is_auth = True
            except Exception:
                # 异常 __str__ 失败时安全兜底，不扩散异常
                pass

        if is_auth:
            return cls.map_error(
                "ERR_CUSTOM_RUNTIME_AUTH", fallback_code="ERR_CUSTOM_RUNTIME_AUTH"
            )

        # 检查可恢复性
        recoverable = getattr(inner_error, "recoverable", True)
        if recoverable is False:
            return cls.map_error(
                "ERR_CUSTOM_RUNTIME", fallback_code="ERR_CUSTOM_RUNTIME"
            )

        return None

    @staticmethod
    def sanitize_session_id(session_id: Any) -> str:
        """验证 session_id 是否为安全合法的 UUID 格式，否则返回 'unknown'。"""
        if not isinstance(session_id, str):
            return "unknown"
        try:
            val = uuid.UUID(session_id.strip())
            return str(val)
        except Exception:
            return "unknown"

    @staticmethod
    def extract_status_code(exc: Any) -> int | None:
        """安全提取 HTTP 状态码 (100..599)，否则返回 None。"""
        code = getattr(exc, "status_code", None)
        if isinstance(code, int) and 100 <= code <= 599:
            return code
        return None

    @staticmethod
    def sanitize_bool(val: Any) -> bool | None:
        """安全验证布尔值，非法返回 None。"""
        if isinstance(val, bool):
            return val
        return None

    @staticmethod
    def sanitize_error_type(val: Any) -> str:
        """安全验证错误类型字段，防止恶意类型注入。"""
        if isinstance(val, str):
            clean = val.strip().lower()
            if clean in SAFE_ERROR_TYPES:
                return clean
        return "unknown"
