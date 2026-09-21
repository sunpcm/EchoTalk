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
    )
    config.validate_runtime()
