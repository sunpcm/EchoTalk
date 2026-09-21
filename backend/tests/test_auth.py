import base64
import time
from unittest.mock import AsyncMock, patch

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from jose import jwt

from auth import OIDCVerifier
from dependencies import get_current_user
from main import app


def _b64(value: int) -> str:
    size = (value.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(value.to_bytes(size, "big")).rstrip(b"=").decode()


def _keypair(kid: str = "test-key"):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = private.public_key().public_numbers()
    jwk = {
        "kty": "RSA",
        "kid": kid,
        "use": "sig",
        "n": _b64(public.n),
        "e": _b64(public.e),
    }
    return private, jwk


@pytest.mark.asyncio
async def test_oidc_verifier_accepts_valid_token_and_rejects_expired_or_forged():
    private, public_jwk = _keypair()
    attacker, _ = _keypair()
    claims = {
        "iss": "https://id.example.test",
        "aud": "echotalk",
        "sub": "subject-123",
        "email": "person@example.test",
        "exp": int(time.time()) + 300,
    }
    valid = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "test-key"})
    expired = jwt.encode(
        {**claims, "exp": int(time.time()) - 1},
        private,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )
    forged = jwt.encode(claims, attacker, algorithm="RS256", headers={"kid": "test-key"})
    verifier = OIDCVerifier()
    verifier._get_jwks = AsyncMock(return_value={"keys": [public_jwk]})

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
    ):
        identity = await verifier.verify(valid)
        assert identity.subject == "subject-123"
        assert identity.email == "person@example.test"
        for token in (expired, forged):
            with pytest.raises(HTTPException) as error:
                await verifier.verify(token)
            assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_protected_http_route_rejects_missing_token():
    app.dependency_overrides.pop(get_current_user, None)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/sessions")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
