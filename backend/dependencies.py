"""认证与本地用户映射依赖。"""

import hashlib
import secrets
import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import AuthIdentity, CurrentUser, oidc_verifier
from config import settings
from database import get_db
from models.user import User

MOCK_USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
DEV_ISSUER = "urn:echotalk:dev"
DEV_SUBJECT = "local-developer"


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise _unauthorized()
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized()
    return token.strip()


async def _verified_identity(token: str) -> AuthIdentity:
    if settings.AUTH_MODE == "dev":
        if not settings.DEV_AUTH_TOKEN or not secrets.compare_digest(
            token, settings.DEV_AUTH_TOKEN
        ):
            raise _unauthorized()
        return AuthIdentity(
            issuer=DEV_ISSUER,
            subject=DEV_SUBJECT,
            email="test@example.com",
        )
    return await oidc_verifier.verify(token)


def _fallback_email(identity: AuthIdentity) -> str:
    digest = hashlib.sha256(
        f"{identity.issuer}\0{identity.subject}".encode()
    ).hexdigest()[:24]
    return f"oidc-{digest}@users.invalid"


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """校验 Bearer token，并仅按不可变 issuer/sub 映射或创建本地用户。"""
    identity = await _verified_identity(_extract_bearer(authorization))
    stmt = select(User).where(
        User.auth_issuer == identity.issuer,
        User.auth_subject == identity.subject,
    )
    user = (await db.execute(stmt)).scalar_one_or_none()
    if user is None:
        if settings.AUTH_MODE == "dev":
            user = await db.get(User, uuid.UUID(MOCK_USER_ID))
        if user is None:
            candidate_email = identity.email or _fallback_email(identity)
            email_exists = await db.scalar(
                select(User.id).where(User.email == candidate_email)
            )
            if email_exists:
                candidate_email = _fallback_email(identity)
            user = User(
                id=(
                    uuid.UUID(MOCK_USER_ID)
                    if settings.AUTH_MODE == "dev"
                    else uuid.uuid4()
                ),
                email=candidate_email,
                password_hash=None,
                auth_issuer=identity.issuer,
                auth_subject=identity.subject,
            )
            db.add(user)
            await db.flush()
        elif user.auth_subject is None:
            user.auth_issuer = identity.issuer
            user.auth_subject = identity.subject
            await db.flush()

    return CurrentUser(
        id=user.id,
        email=user.email,
        issuer=identity.issuer,
        subject=identity.subject,
    )
