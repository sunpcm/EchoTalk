"""用户设置相关 Pydantic 请求/响应模型。"""

from typing import Literal

from pydantic import BaseModel, field_validator


class UserSettingsUpdate(BaseModel):
    """PUT /api/user/settings 请求体。所有字段可选，仅更新提供的字段。"""

    is_custom_mode: bool | None = None

    stt_provider: Literal["deepgram"] | None = None
    llm_provider: Literal["siliconflow", "openrouter"] | None = None
    llm_model: str | None = None
    tts_provider: Literal["cartesia"] | None = None

    # 明文 Key，后端加密后入库
    stt_key: str | None = None
    llm_key: str | None = None
    tts_key: str | None = None

    @field_validator("stt_key", "llm_key", "tts_key")
    @classmethod
    def key_must_not_be_empty(cls, v: str | None) -> str | None:
        """校验 Key 不为空字符串（允许 None 表示不更新）。"""
        if v is not None and len(v.strip()) == 0:
            raise ValueError("API Key 不能为空字符串")
        return v.strip() if v is not None else None

    @field_validator("llm_model")
    @classmethod
    def model_must_not_be_empty(cls, v: str | None) -> str | None:
        """校验模型名不为空字符串。"""
        if v is not None and len(v.strip()) == 0:
            raise ValueError("模型名称不能为空字符串")
        return v.strip() if v is not None else None


class UserSettingsResponse(BaseModel):
    """GET /api/user/settings 响应体。密钥仅返回布尔标识，绝不暴露明文。"""

    is_custom_mode: bool = False

    stt_provider: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    tts_provider: str | None = None

    has_stt_key: bool = False
    has_llm_key: bool = False
    has_tts_key: bool = False

    model_config = {"from_attributes": True}
