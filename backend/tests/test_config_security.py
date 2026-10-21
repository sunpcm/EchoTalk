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


@pytest.mark.parametrize(
    "origin",
    [
        "app.example.test",
        "ftp://app.example.test",
        "https://app.example.test/path",
        "https://app.example.test?preview=1",
        "https://user@app.example.test",
        "https://app.example.test:invalid",
    ],
)
def test_cors_rejects_non_origin_urls(origin):
    with pytest.raises(ValueError, match="CORS_ORIGINS 包含无效 Origin"):
        Settings(CORS_ORIGINS=[origin])


def test_cors_normalizes_and_deduplicates_origins():
    config = Settings(
        CORS_ORIGINS=[" https://app.example.test/ ", "https://app.example.test"]
    )
    assert config.CORS_ORIGINS == ["https://app.example.test"]


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


def test_oidc_accepts_local_native_http_origins():
    config = Settings(
        AUTH_MODE="oidc",
        OIDC_ISSUER="https://identity.example.test",
        OIDC_AUDIENCE="echotalk",
        OIDC_JWKS_URL="https://identity.example.test/jwks",
        CREDENTIAL_ENCRYPTION_KEYS={"prod-v1": Fernet.generate_key().decode()},
        ACTIVE_CREDENTIAL_KEY_VERSION="prod-v1",
        CORS_ORIGINS=["http://localhost", "http://tauri.localhost"],
    )
    config.validate_runtime()


def test_oidc_rejects_lookalike_local_http_origin():
    config = Settings(
        AUTH_MODE="oidc",
        OIDC_ISSUER="https://identity.example.test",
        OIDC_AUDIENCE="echotalk",
        OIDC_JWKS_URL="https://identity.example.test/jwks",
        CREDENTIAL_ENCRYPTION_KEYS={"prod-v1": Fernet.generate_key().decode()},
        ACTIVE_CREDENTIAL_KEY_VERSION="prod-v1",
        CORS_ORIGINS=["http://localhost.evil.example.test"],
    )
    with pytest.raises(RuntimeError, match="不安全的 HTTP Origin"):
        config.validate_runtime()


def test_call_lease_mode_default_and_validation():
    default_config = Settings(AUTH_MODE="dev", DEV_AUTH_TOKEN="dummy")
    assert default_config.CALL_LEASE_MODE == "disabled"

    with pytest.raises(ValueError, match="CALL_LEASE_MODE 仅允许"):
        Settings(
            AUTH_MODE="dev",
            DEV_AUTH_TOKEN="dummy",
            CALL_LEASE_MODE="unsupported",
        )


def test_call_lease_cloud_mode_requires_keys_and_valid_url():
    # 缺少 API Key / Secret
    with pytest.raises(
        RuntimeError,
        match="CALL_LEASE_MODE=livekit_cloud 要求配置非空的 LIVEKIT_API_KEY 与 LIVEKIT_API_SECRET",
    ):
        Settings(
            AUTH_MODE="dev",
            DEV_AUTH_TOKEN="dummy",
            CALL_LEASE_MODE="livekit_cloud",
            LIVEKIT_URL="https://test.livekit.cloud",
            LIVEKIT_API_KEY="",
            LIVEKIT_API_SECRET="",
        ).validate_runtime()

    # 缺少 LIVEKIT_URL
    with pytest.raises(
        RuntimeError, match="CALL_LEASE_MODE=livekit_cloud 要求配置 LIVEKIT_URL"
    ):
        Settings(
            AUTH_MODE="dev",
            DEV_AUTH_TOKEN="dummy",
            CALL_LEASE_MODE="livekit_cloud",
            LIVEKIT_URL="",
            LIVEKIT_API_KEY="test_key",
            LIVEKIT_API_SECRET="test_secret",
        ).validate_runtime()

    # 拒绝自建 / 非 livekit.cloud 域名
    with pytest.raises(
        RuntimeError, match="要求 LIVEKIT_URL 为无凭据、无 query、无 fragment"
    ) as exc_info:
        Settings(
            AUTH_MODE="dev",
            DEV_AUTH_TOKEN="dummy",
            CALL_LEASE_MODE="livekit_cloud",
            LIVEKIT_URL="http://localhost:7880",
            LIVEKIT_API_KEY="test_key",
            LIVEKIT_API_SECRET="test_secret",
        ).validate_runtime()
    # 验证错误信息不回显 URL 或凭据值
    assert "localhost" not in str(exc_info.value)
    assert "test_key" not in str(exc_info.value)

    # 拒绝含 query 或凭据的 livekit.cloud URL
    with pytest.raises(
        RuntimeError, match="要求 LIVEKIT_URL 为无凭据、无 query、无 fragment"
    ):
        Settings(
            AUTH_MODE="dev",
            DEV_AUTH_TOKEN="dummy",
            CALL_LEASE_MODE="livekit_cloud",
            LIVEKIT_URL="https://user:pass@project.livekit.cloud/?debug=1",
            LIVEKIT_API_KEY="test_key",
            LIVEKIT_API_SECRET="test_secret",
        ).validate_runtime()

    # 合法 Cloud URL 及凭据放行
    valid_cloud = Settings(
        AUTH_MODE="dev",
        DEV_AUTH_TOKEN="dummy",
        CALL_LEASE_MODE="livekit_cloud",
        LIVEKIT_URL="https://my-demo.livekit.cloud",
        LIVEKIT_API_KEY="test_key",
        LIVEKIT_API_SECRET="test_secret",
    )
    valid_cloud.validate_runtime()
