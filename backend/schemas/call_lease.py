"""通话租约相关 Pydantic Schemas。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CallClaimRequest(BaseModel):
    """请求获得通话租约。"""

    device_id: uuid.UUID
    takeover: bool = False


class CallHeartbeatRequest(BaseModel):
    """心跳续期通话租约。"""

    device_id: uuid.UUID
    generation: int = Field(gt=0, description="必须为正整数代际")


class CallReleaseRequest(BaseModel):
    """主动释放通话租约。"""

    device_id: uuid.UUID
    generation: int = Field(gt=0, description="必须为正整数代际")


class CallLeaseResponse(BaseModel):
    """获得/续期通话租约成功响应。仅暴露最少必要字段。"""

    model_config = ConfigDict(from_attributes=True)

    session_id: uuid.UUID
    device_id: uuid.UUID
    generation: int
    state: str
    expires_at: datetime


class CallReleaseResponse(BaseModel):
    """释放通话租约成功响应。"""

    released: bool
    generation: int
