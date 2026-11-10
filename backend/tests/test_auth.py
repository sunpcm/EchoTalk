import base64
import time
from unittest.mock import AsyncMock, call, patch

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from auth import OIDCVerifier
from dependencies import get_current_user
from main import app


def _b64(value: int, size: int | None = None) -> str:
    size = size if size is not None else (value.bit_length() + 7) // 8
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


def _ec_keypair(kid: str = "ec-key"):
    private = ec.generate_private_key(ec.SECP256R1())
    public = private.public_key().public_numbers()
    jwk = {
        "kty": "EC",
        "crv": "P-256",
        "kid": kid,
        "use": "sig",
        "x": _b64(public.x, size=32),
        "y": _b64(public.y, size=32),
    }
    return private, jwk


def _claims(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "iss": "https://id.example.test",
        "aud": "echotalk",
        "sub": "subject-123",
        "email": "person@example.test",
        "exp": int(time.time()) + 300,
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_oidc_verifier_accepts_valid_token_and_rejects_expired_or_forged():
    private, public_jwk = _keypair()
    attacker, _ = _keypair()
    claims = _claims()
    valid = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "test-key"})
    expired = jwt.encode(
        {**claims, "exp": int(time.time()) - 1},
        private,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )
    forged = jwt.encode(
        claims, attacker, algorithm="RS256", headers={"kid": "test-key"}
    )
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


@pytest.mark.asyncio
async def test_oidc_verifier_rejects_hs256_forged_token_without_fetching_jwks():
    _, public_jwk = _keypair()
    hs256_forged = jwt.encode(
        _claims(),
        public_jwk["n"],
        algorithm="HS256",
        headers={"kid": "test-key"},
    )
    verifier = OIDCVerifier()
    verifier._get_jwks = AsyncMock(return_value={"keys": [public_jwk]})

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
    ):
        with pytest.raises(HTTPException) as error:
            await verifier.verify(hs256_forged)
        assert error.value.status_code == 401
        verifier._get_jwks.assert_not_called()


@pytest.mark.asyncio
async def test_oidc_verifier_rejects_none_algorithm_without_fetching_jwks():
    _, public_jwk = _keypair()
    none_token = jwt.encode(
        _claims(),
        None,
        algorithm="none",
        headers={"kid": "test-key"},
    )
    verifier = OIDCVerifier()
    verifier._get_jwks = AsyncMock(return_value={"keys": [public_jwk]})

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
    ):
        with pytest.raises(HTTPException) as error:
            await verifier.verify(none_token)
        assert error.value.status_code == 401
        verifier._get_jwks.assert_not_called()


@pytest.mark.asyncio
async def test_oidc_verifier_refreshes_jwks_once_on_unknown_kid_and_accepts_rotated():
    private, public_jwk = _keypair(kid="test-key")
    rotated_private, rotated_jwk = _keypair(kid="rotated-key")
    unknown_token = jwt.encode(
        _claims(),
        private,
        algorithm="RS256",
        headers={"kid": "missing-key"},
    )
    rotated_token = jwt.encode(
        _claims(),
        rotated_private,
        algorithm="RS256",
        headers={"kid": "rotated-key"},
    )
    verifier = OIDCVerifier()

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
    ):
        verifier._get_jwks = AsyncMock(return_value={"keys": [public_jwk]})
        with pytest.raises(HTTPException) as error:
            await verifier.verify(unknown_token)
        assert error.value.status_code == 401
        assert verifier._get_jwks.call_args_list == [call(), call(force_refresh=True)]

        verifier._get_jwks = AsyncMock(
            side_effect=[
                {"keys": [public_jwk]},
                {"keys": [public_jwk, rotated_jwk]},
            ],
        )
        identity = await verifier.verify(rotated_token)
        assert identity.subject == "subject-123"
        assert verifier._get_jwks.call_args_list == [call(), call(force_refresh=True)]


@pytest.mark.asyncio
async def test_oidc_verifier_rejects_invalid_aud_iss_and_missing_sub_or_exp():
    private, public_jwk = _keypair()
    base_claims = _claims()
    invalid_payloads = [
        {**base_claims, "aud": "wrong-audience"},
        {**base_claims, "iss": "https://wrong.example.test"},
        {k: v for k, v in base_claims.items() if k != "sub"},
        {k: v for k, v in base_claims.items() if k != "exp"},
    ]
    verifier = OIDCVerifier()
    verifier._get_jwks = AsyncMock(return_value={"keys": [public_jwk]})

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
    ):
        for payload in invalid_payloads:
            token = jwt.encode(
                payload,
                private,
                algorithm="RS256",
                headers={"kid": "test-key"},
            )
            with pytest.raises(HTTPException) as error:
                await verifier.verify(token)
            assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_oidc_verifier_accepts_es256_and_rejects_es256_with_rsa_jwk():
    ec_private, ec_jwk = _ec_keypair(kid="shared-key")
    _, rsa_jwk = _keypair(kid="shared-key")
    es256_token = jwt.encode(
        _claims(),
        ec_private,
        algorithm="ES256",
        headers={"kid": "shared-key"},
    )
    verifier = OIDCVerifier()

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
    ):
        verifier._get_jwks = AsyncMock(return_value={"keys": [ec_jwk]})
        identity = await verifier.verify(es256_token)
        assert identity.subject == "subject-123"
        assert identity.email == "person@example.test"

        verifier._get_jwks = AsyncMock(return_value={"keys": [rsa_jwk]})
        with pytest.raises(HTTPException) as error:
            await verifier.verify(es256_token)
        assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_oidc_verifier_rejects_malformed_jwk_and_malformed_token_strings():
    private, public_jwk = _keypair(kid="malformed-key")
    valid_token = jwt.encode(
        _claims(),
        private,
        algorithm="RS256",
        headers={"kid": "malformed-key"},
    )
    malformed_jwk = {k: v for k, v in public_jwk.items() if k != "n"}
    verifier = OIDCVerifier()

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
    ):
        verifier._get_jwks = AsyncMock(return_value={"keys": [malformed_jwk]})
        with pytest.raises(HTTPException) as error:
            await verifier.verify(valid_token)
        assert error.value.status_code == 401

        verifier._get_jwks = AsyncMock(return_value={"keys": [public_jwk]})
        for raw_token in ("not-a-jwt", "a.b.c", ""):
            with pytest.raises(HTTPException) as error:
                await verifier.verify(raw_token)
            assert error.value.status_code == 401
        verifier._get_jwks.assert_not_called()


@pytest.mark.asyncio
async def test_oidc_verifier_returns_503_when_jwks_fetch_fails():
    private, _ = _keypair()
    token = jwt.encode(
        _claims(),
        private,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )
    verifier = OIDCVerifier()

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
        patch(
            "auth.httpx.AsyncClient.get",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("jwks endpoint unreachable"),
        ),
    ):
        with pytest.raises(HTTPException) as error:
            await verifier.verify(token)
        assert error.value.status_code == 503


@pytest.mark.asyncio
async def test_oidc_verifier_maps_unexpected_key_errors_to_401():
    private, public_jwk = _keypair()
    token = jwt.encode(
        _claims(),
        private,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )
    verifier = OIDCVerifier()
    verifier._get_jwks = AsyncMock(return_value={"keys": [public_jwk]})

    with (
        patch("auth.settings.OIDC_ISSUER", "https://id.example.test"),
        patch("auth.settings.OIDC_AUDIENCE", "echotalk"),
    ):
        with patch("auth.PyJWK.from_dict", side_effect=ValueError("x")):
            with pytest.raises(HTTPException) as error:
                await verifier.verify(token)
            assert error.value.status_code == 401

        with patch("auth.PyJWK.from_dict", side_effect=TypeError("x")):
            with pytest.raises(HTTPException) as error:
                await verifier.verify(token)
            assert error.value.status_code == 401
