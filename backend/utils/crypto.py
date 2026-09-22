"""版本化 API Key 加密；认证密钥与凭据加密密钥不共享生命周期。"""

import base64
import hashlib
from dataclasses import dataclass
from functools import lru_cache

from cryptography.fernet import Fernet

from config import settings

LEGACY_KEY_VERSION = "legacy-jwt-derived-v1"


@dataclass(frozen=True)
class EncryptedCredential:
    ciphertext: str
    key_version: str


@dataclass(frozen=True)
class DecryptedCredential:
    plaintext: str
    needs_rotation: bool


@lru_cache(maxsize=32)
def _get_fernet(version: str) -> Fernet:
    """按版本构造 Fernet；legacy 仅用于迁移期读取。"""
    if version == LEGACY_KEY_VERSION:
        secret = settings.LEGACY_CREDENTIAL_DECRYPTION_SECRET
        if not secret:
            raise ValueError("旧凭据需要配置 LEGACY_CREDENTIAL_DECRYPTION_SECRET")
        raw = hashlib.sha256(secret.encode()).digest()
        return Fernet(base64.urlsafe_b64encode(raw))
    key = settings.CREDENTIAL_ENCRYPTION_KEYS.get(version)
    if not key:
        raise ValueError(f"未知的凭据加密密钥版本: {version}")
    return Fernet(key.encode())


def encrypt_api_key(plaintext: str) -> EncryptedCredential:
    """使用 active key 加密，并将 key version 与密文一起返回。"""
    version = settings.ACTIVE_CREDENTIAL_KEY_VERSION
    ciphertext = _get_fernet(version).encrypt(plaintext.encode()).decode()
    return EncryptedCredential(ciphertext=ciphertext, key_version=version)


def decrypt_api_key(ciphertext: str, key_version: str | None) -> DecryptedCredential:
    """按记录版本解密，并提示调用者是否应惰性重加密。"""
    version = key_version or LEGACY_KEY_VERSION
    plaintext = _get_fernet(version).decrypt(ciphertext.encode()).decode()
    return DecryptedCredential(
        plaintext=plaintext,
        needs_rotation=version != settings.ACTIVE_CREDENTIAL_KEY_VERSION,
    )
