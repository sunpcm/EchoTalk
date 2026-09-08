"""
JWT 鉴权依赖模块。
提取 Authorization header 中的 Bearer token 并使用 JWT_SECRET_KEY 进行解密与校验。
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models.user import User

ALGORITHM = "HS256"

# Mock 测试用户 ID（供开发/测试备用）
MOCK_USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
MOCK_USER = {
    "id": MOCK_USER_ID,
    "email": "test@example.com",
}


def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None,
    issuer: Optional[str] = None,
    audience: Optional[str] = None,
) -> str:
    """生成 JWT 访问令牌。"""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(days=1)
    to_encode.update({"exp": expire})
    if issuer and "iss" not in to_encode:
        to_encode["iss"] = issuer
    if audience and "aud" not in to_encode:
        to_encode["aud"] = audience

    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    JWT 认证依赖。
    1. 从 Authorization header 提取 Bearer token
    2. 支持 mock-token 兼容兜底（避免前端纯 JWT 接入前 API 全部 401 中断）
    3. 使用 python-jose + JWT_SECRET_KEY 解码验证 JWT（强制要求 exp 字段）
    4. 校验 user id 格式及数据库用户存在性（USE_MOCK_DB 为 False 时）
    5. 返回用户字典或抛出 401 异常
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

    token = parts[1].strip()
    if not token:
        raise credentials_exception

    # 兼容前端当前硬编码的 mock-token，避免破坏性中断
    if token == "mock-token":
        return MOCK_USER

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"require_exp": True},
        )
    except JWTError:
        raise credentials_exception

    user_id = payload.get("sub") or payload.get("id")
    if not user_id:
        raise credentials_exception

    try:
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        raise credentials_exception

    # 若未开启 Mock DB 模式，进行用户存在性校验
    if not settings.USE_MOCK_DB:
        stmt = select(User).where(User.id == user_uuid)
        result = await db.execute(stmt)
        user_obj = result.scalar_one_or_none()
        if user_obj is None:
            raise credentials_exception

    email = payload.get("email", "")

    return {
        "id": str(user_id),
        "email": email,
        **{
            k: v
            for k, v in payload.items()
            if k not in ("sub", "id", "email", "exp", "iss", "aud")
        },
    }
