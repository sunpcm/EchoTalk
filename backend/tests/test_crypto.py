import pytest
from cryptography.fernet import InvalidToken

from config import settings
from utils.crypto import _get_fernet, decrypt_api_key, encrypt_api_key


def test_encrypt_decrypt_roundtrip():
    """测试标准 API Key 的加密与解密往返。"""
    plaintext = "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz"
    ciphertext = encrypt_api_key(plaintext)

    assert isinstance(ciphertext, str)
    assert ciphertext != plaintext
    assert decrypt_api_key(ciphertext) == plaintext


def test_encrypt_produces_unique_ciphertexts():
    """测试对相同明文连续加密生成不同的 ciphertext（Fernet 随机 IV/时间戳）。"""
    plaintext = "sk-test-secret-key"
    c1 = encrypt_api_key(plaintext)
    c2 = encrypt_api_key(plaintext)

    assert c1 != c2
    assert decrypt_api_key(c1) == plaintext
    assert decrypt_api_key(c2) == plaintext


@pytest.mark.parametrize(
    "plaintext",
    [
        "",  # 空字符串
        "sk-测试密钥-🔑-123",  # Unicode / Emoji 字符
        "a" * 10000,  # 长字符串
    ],
)
def test_encrypt_decrypt_edge_cases(plaintext: str):
    """测试边界用例：空字符串、Unicode 字符、长字符串。"""
    ciphertext = encrypt_api_key(plaintext)
    assert decrypt_api_key(ciphertext) == plaintext


def test_decrypt_invalid_ciphertext():
    """测试解密无效或被篡改的 ciphertext 时抛出 InvalidToken 异常。"""
    with pytest.raises(InvalidToken):
        decrypt_api_key("invalid-token-string")

    valid_ciphertext = encrypt_api_key("sk-test")
    tampered_ciphertext = valid_ciphertext[:-4] + "XXXX"
    with pytest.raises(InvalidToken):
        decrypt_api_key(tampered_ciphertext)


def test_get_fernet_lru_cache():
    """测试 _get_fernet 的单例缓存行为。"""
    f1 = _get_fernet()
    f2 = _get_fernet()
    assert f1 is f2


def test_different_jwt_secret_key():
    """测试切换 JWT_SECRET_KEY 并清空缓存后生成的 Fernet 密钥不同。"""
    original_secret = settings.JWT_SECRET_KEY
    _get_fernet.cache_clear()

    try:
        ciphertext = encrypt_api_key("sk-secret-data")

        # 更改 secret 并清空缓存
        settings.JWT_SECRET_KEY = "different-secret-key-123"
        _get_fernet.cache_clear()

        # 使用新 secret 解密旧密文应该失败
        with pytest.raises(InvalidToken):
            decrypt_api_key(ciphertext)
    finally:
        # 恢复原始 settings
        settings.JWT_SECRET_KEY = original_secret
        _get_fernet.cache_clear()
