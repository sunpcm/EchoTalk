"""
鉴权依赖。
包含真实 JWT 校验逻辑。
"""

from typing import Optional

from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

from config import settings

# Mock 测试用户（合法 UUID 格式），保留供 test / seed 脚本使用
MOCK_USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

ALGORITHM = "HS256"


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    JWT 认证依赖。
    从 Authorization header 中提取 Bearer Token，解码并验证用户身份。
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not authorization:
        raise credentials_exception

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise credentials_exception

    token = parts[1]

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[ALGORITHM],
        )
        user_id: Optional[str] = payload.get("sub") or payload.get("id")
        if user_id is None:
            raise credentials_exception
        email: Optional[str] = payload.get("email")
    except JWTError:
        raise credentials_exception

    return {
        "id": user_id,
        "email": email or "",
    }
