"""通话协议能力发现路由。

实现 CP-02 §7 客户端协议发现接口：
已认证只读 GET /api/call-capabilities
返回服务端 protocol_version 与 call_lease_mode。
"""

from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict

from auth import CurrentUser
from config import settings
from dependencies import get_current_user

router = APIRouter()


class CallCapabilitiesResponse(BaseModel):
    """通话协议能力响应模型，精确两字段，禁止额外字段。"""

    model_config = ConfigDict(extra="forbid")

    protocol_version: Literal[1] = 1
    call_lease_mode: Literal["disabled", "livekit_cloud"]


@router.get(
    "/call-capabilities",
    response_model=CallCapabilitiesResponse,
    summary="获取通话协议能力",
)
async def get_call_capabilities(
    response: Response,
    _current_user: CurrentUser = Depends(get_current_user),
) -> CallCapabilitiesResponse:
    """返回服务端通话协议版本与租约模式，Cache-Control 设为 no-store。"""
    response.headers["Cache-Control"] = "no-store"
    mode = settings.CALL_LEASE_MODE
    if mode not in ("disabled", "livekit_cloud"):
        mode = "disabled"
    return CallCapabilitiesResponse(
        protocol_version=1,
        call_lease_mode=mode,
    )
