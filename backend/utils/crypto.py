"""API Key 对称加密工具模块。使用 Fernet 对用户自定义密钥进行加密存储与解密读取。"""

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet

from config import settings


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    """从 JWT_SECRET_KEY 派生 Fernet 密钥（单例缓存）。"""
    raw = hashlib.sha256(settings.JWT_SECRET_KEY.encode()).digest()
    key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt_api_key(plaintext: str) -> str:
    """将明文 API Key 加密为 Fernet token 字符串。"""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """将 Fernet token 字符串解密为明文 API Key。"""
    return _get_fernet().decrypt(ciphertext.encode()).decode()
