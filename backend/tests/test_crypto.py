import base64
import hashlib
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet, InvalidToken

from utils.crypto import (
    LEGACY_KEY_VERSION,
    _get_fernet,
    decrypt_api_key,
    encrypt_api_key,
)


def test_encrypt_and_decrypt_api_key_round_trip():
    encrypted = encrypt_api_key("sk-secret")
    decrypted = decrypt_api_key(encrypted.ciphertext, encrypted.key_version)
    assert decrypted.plaintext == "sk-secret"
    assert decrypted.needs_rotation is False
    assert encrypted.key_version == "dev-v1"


def test_ciphertext_is_nondeterministic():
    first = encrypt_api_key("same")
    second = encrypt_api_key("same")
    assert first.ciphertext != second.ciphertext


def test_unknown_version_and_invalid_ciphertext_fail_closed():
    with pytest.raises(ValueError):
        decrypt_api_key("anything", "unknown")
    with pytest.raises(InvalidToken):
        decrypt_api_key("not-a-token", "dev-v1")


def test_old_keyring_version_reads_and_requests_lazy_rotation():
    old_key = Fernet.generate_key().decode()
    active_key = Fernet.generate_key().decode()
    ciphertext = Fernet(old_key.encode()).encrypt(b"old-secret").decode()
    with (
        patch(
            "utils.crypto.settings.CREDENTIAL_ENCRYPTION_KEYS",
            {"old-v1": old_key, "new-v2": active_key},
        ),
        patch("utils.crypto.settings.ACTIVE_CREDENTIAL_KEY_VERSION", "new-v2"),
    ):
        _get_fernet.cache_clear()
        decrypted = decrypt_api_key(ciphertext, "old-v1")
        assert decrypted.plaintext == "old-secret"
        assert decrypted.needs_rotation is True
        rotated = encrypt_api_key(decrypted.plaintext)
        assert rotated.key_version == "new-v2"
        assert decrypt_api_key(rotated.ciphertext, "new-v2").plaintext == "old-secret"
    _get_fernet.cache_clear()


def test_legacy_jwt_derived_ciphertext_requires_explicit_migration_secret():
    secret = "old-auth-secret"
    legacy_key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    ciphertext = Fernet(legacy_key).encrypt(b"legacy-secret").decode()
    _get_fernet.cache_clear()
    with patch("utils.crypto.settings.LEGACY_CREDENTIAL_DECRYPTION_SECRET", ""):
        with pytest.raises(ValueError):
            decrypt_api_key(ciphertext, LEGACY_KEY_VERSION)
    _get_fernet.cache_clear()
    with patch("utils.crypto.settings.LEGACY_CREDENTIAL_DECRYPTION_SECRET", secret):
        result = decrypt_api_key(ciphertext, LEGACY_KEY_VERSION)
        assert result.plaintext == "legacy-secret"
        assert result.needs_rotation is True
    _get_fernet.cache_clear()
