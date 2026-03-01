"""对话相关 Pydantic 请求/响应模型。"""

from uuid import UUID

from pydantic import BaseModel


class ChatRequest(BaseModel):
    """发送消息请求体。"""

    session_id: UUID
    message: str


class ChatResponse(BaseModel):
    """发送消息响应体。"""

    reply: str
    transcript_id: int
    audio_base64: str | None = None
