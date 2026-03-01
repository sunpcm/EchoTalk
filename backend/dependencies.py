"""
Mock 鉴权依赖。
当前阶段返回固定测试用户，绕过真实 Auth 系统。
"""

from typing import Optional

from fastapi import Header

# Mock 测试用户（合法 UUID 格式）
MOCK_USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
MOCK_USER = {
    "id": MOCK_USER_ID,
    "email": "test@example.com",
}


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    Mock 认证依赖。
    忽略 Authorization header，直接返回固定测试用户。

    TODO: 后续接入真实 JWT 校验逻辑：
    1. 从 Authorization header 提取 Bearer token
    2. 使用 python-jose + JWT_SECRET_KEY 解码验证 JWT
    3. 从数据库查询用户信息
    4. 返回用户对象或抛出 401 异常
    """
    return MOCK_USER
