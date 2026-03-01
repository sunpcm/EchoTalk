"""健康检查路由。"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """健康检查接口，用于验证服务是否正常运行。"""
    return {"status": "ok", "service": "echo-talk"}
