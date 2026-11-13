"""健康检查相关 Pydantic 响应模型。"""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """基础健康检查成功响应。"""

    status: str
    service: str


class ReadinessResponse(BaseModel):
    """深度就绪检查成功响应。"""

    status: str
