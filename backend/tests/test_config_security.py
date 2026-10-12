import pytest
from cryptography.fernet import Fernet

from config import DEV_CREDENTIAL_KEY, Settings


def test_dev_auth_requires_explicit_token():
    config = Settings(AUTH_MODE="dev", DEV_AUTH_TOKEN="")
    with pytest.raises(RuntimeError, match="DEV_AUTH_TOKEN"):
        config.validate_runtime()


def test_oidc_rejects_missing_insecure_or_default_security_material():
    with pytest.raises(RuntimeError, match="OIDC 配置缺失"):
        Settings(AUTH_MODE="oidc").validate_runtime()

    insecure = Settings(
        AUTH_MODE="oidc",
        OIDC_ISSUER="http://identity.example.test",
        OIDC_AUDIENCE="echotalk",
        OIDC_JWKS_URL="http://identity.example.test/jwks",
        CREDENTIAL_ENCRYPTION_KEYS={"prod-v1": Fernet.generate_key().decode()},
        ACTIVE_CREDENTIAL_KEY_VERSION="prod-v1",
    )
    with pytest.raises(RuntimeError, match="HTTPS"):
        insecure.validate_runtime()

    default_key = Settings(
        AUTH_MODE="oidc",
        OIDC_ISSUER="https://identity.example.test",
        OIDC_AUDIENCE="echotalk",
        OIDC_JWKS_URL="https://identity.example.test/jwks",
        CREDENTIAL_ENCRYPTION_KEYS={"dev-v1": DEV_CREDENTIAL_KEY},
        ACTIVE_CREDENTIAL_KEY_VERSION="dev-v1",
    )
    with pytest.raises(RuntimeError, match="默认开发"):
        default_key.validate_runtime()


def test_oidc_accepts_complete_independent_keyring():
    config = Settings(
        AUTH_MODE="oidc",
        OIDC_ISSUER="https://identity.example.test",
        OIDC_AUDIENCE="echotalk",
        OIDC_JWKS_URL="https://identity.example.test/jwks",
        CREDENTIAL_ENCRYPTION_KEYS={"prod-v1": Fernet.generate_key().decode()},
        ACTIVE_CREDENTIAL_KEY_VERSION="prod-v1",
        CORS_ORIGINS=["https://app.example.test"],
    )
    config.validate_runtime()


def test_cors_rejects_wildcard():
    with pytest.raises(ValueError, match="CORS_ORIGINS 不可包含通配符"):
        Settings(CORS_ORIGINS=["*"])


def test_cors_rejects_empty_origins():
    with pytest.raises(ValueError, match="CORS_ORIGINS 不能为空"):
        Settings(CORS_ORIGINS=["   "])


def test_oidc_rejects_default_dev_cors_origins():
    config = Settings(
        AUTH_MODE="oidc",
        OIDC_ISSUER="https://identity.example.test",
        OIDC_AUDIENCE="echotalk",
        OIDC_JWKS_URL="https://identity.example.test/jwks",
        CREDENTIAL_ENCRYPTION_KEYS={"prod-v1": Fernet.generate_key().decode()},
        ACTIVE_CREDENTIAL_KEY_VERSION="prod-v1",
    )
    with pytest.raises(RuntimeError, match="默认开发 CORS 配置"):
        config.validate_runtime()


def test_oidc_rejects_insecure_http_cors_origins():
    config = Settings(
        AUTH_MODE="oidc",
        OIDC_ISSUER="https://identity.example.test",
        OIDC_AUDIENCE="echotalk",
        OIDC_JWKS_URL="https://identity.example.test/jwks",
        CREDENTIAL_ENCRYPTION_KEYS={"prod-v1": Fernet.generate_key().decode()},
        ACTIVE_CREDENTIAL_KEY_VERSION="prod-v1",
        CORS_ORIGINS=["http://insecure.example.test"],
    )
    with pytest.raises(RuntimeError, match="不安全的 HTTP Origin"):
        config.validate_runtime()
