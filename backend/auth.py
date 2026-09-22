"""OIDC token 校验与统一认证身份模型。"""

import asyncio
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import HTTPException, status
from jose import JWTError, jwt

from config import settings


@dataclass(frozen=True)
class AuthIdentity:
    """已验证但尚未映射到本地用户的外部身份。"""

    issuer: str
    subject: str
    email: str | None


@dataclass(frozen=True)
class CurrentUser:
    """路由层唯一使用的当前用户类型。"""

    id: uuid.UUID
    email: str
    issuer: str
    subject: str


class OIDCVerifier:
    """按 TTL 缓存 JWKS，并严格校验 OIDC issuer/audience/签名/时效。"""

    def __init__(self) -> None:
        self._jwks: dict[str, Any] | None = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    async def _get_jwks(self, *, force_refresh: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        if not force_refresh and self._jwks is not None and now < self._expires_at:
            return self._jwks

        async with self._lock:
            now = time.monotonic()
            if not force_refresh and self._jwks is not None and now < self._expires_at:
                return self._jwks
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    response = await client.get(settings.OIDC_JWKS_URL)
                    response.raise_for_status()
                    payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication provider is unavailable.",
                ) from exc
            if not isinstance(payload, dict) or not isinstance(
                payload.get("keys"), list
            ):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication provider returned invalid JWKS.",
                )
            self._jwks = payload
            self._expires_at = now + settings.OIDC_JWKS_CACHE_SECONDS
            return payload

    async def verify(self, token: str) -> AuthIdentity:
        try:
            header = jwt.get_unverified_header(token)
        except JWTError as exc:
            raise _unauthorized() from exc
        algorithm = header.get("alg")
        key_id = header.get("kid")
        if algorithm not in {"RS256", "ES256"} or not isinstance(key_id, str):
            raise _unauthorized()

        jwks = await self._get_jwks()
        key = _find_key(jwks, key_id)
        if key is None:
            jwks = await self._get_jwks(force_refresh=True)
            key = _find_key(jwks, key_id)
        if key is None:
            raise _unauthorized()

        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                audience=settings.OIDC_AUDIENCE,
                issuer=settings.OIDC_ISSUER,
                options={"require_sub": True, "require_exp": True},
            )
        except JWTError as exc:
            raise _unauthorized() from exc

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise _unauthorized()
        email = claims.get("email")
        return AuthIdentity(
            issuer=settings.OIDC_ISSUER,
            subject=subject,
            email=email if isinstance(email, str) and email else None,
        )


def _find_key(jwks: dict[str, Any], key_id: str) -> dict[str, Any] | None:
    return next(
        (key for key in jwks.get("keys", []) if key.get("kid") == key_id),
        None,
    )


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired access token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


oidc_verifier = OIDCVerifier()
