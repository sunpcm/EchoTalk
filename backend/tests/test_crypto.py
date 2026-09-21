from unittest.mock import patch

import pytest
from cryptography.fernet import InvalidToken

from utils.crypto import _get_fernet, decrypt_api_key, encrypt_api_key


def test_encrypt_and_decrypt_api_key_round_trip():
    """测试标准 API Key 的加密与解密 Round-trip。"""
    raw_key = "sk-proj-1234567890abcdefABCDEF123456"
    encrypted = encrypt_api_key(raw_key)
    decrypted = decrypt_api_key(encrypted)
    assert decrypted == raw_key


@pytest.mark.parametrize(
    "input_text",
    [
        "",  # 空字符串
        "   ",  # 纯空格
        "sk-test-!@#$%^&*()_+-=[]{}|;:',.<>?/",  # 包含各种特殊字符
        "中文API密钥测试-123456",  # Unicode/多字节字符
        "a" * 1000,  # 超长字符串
    ],
)
def test_encrypt_decrypt_edge_case_inputs(input_text):
    """测试不同类型的输入（空串、特殊字符、Unicode、超长串）的加密与解密。"""
    encrypted = encrypt_api_key(input_text)
    decrypted = decrypt_api_key(encrypted)
    assert decrypted == input_text


def test_ciphertext_is_encrypted_and_nondeterministic():
    """测试密文不等于明文，且多次加密相同明文生成的 Fernet Token 不同（但均可正确解密）。"""
    raw_key = "sk-secret-key-123"
    enc1 = encrypt_api_key(raw_key)
    enc2 = encrypt_api_key(raw_key)

    assert enc1 != raw_key
    assert enc2 != raw_key
    assert enc1 != enc2  # Fernet token 包含随机 IV 和时间戳

    assert decrypt_api_key(enc1) == raw_key
    assert decrypt_api_key(enc2) == raw_key


def test_decrypt_invalid_ciphertext_raises_invalid_token():
    """测试传入无效或被篡改的密文时，decrypt_api_key 抛出 InvalidToken 异常。"""
    invalid_ciphertexts = [
        "not-a-fernet-token",
        "gAAAAABm...",  # 损坏的 token
        "12345",
    ]
    for invalid_ct in invalid_ciphertexts:
        with pytest.raises(InvalidToken):
            decrypt_api_key(invalid_ct)


def test_decrypt_with_different_jwt_secret_key_raises_invalid_token():
    """测试使用不同 JWT_SECRET_KEY 加密的密文在解密时引发 InvalidToken。"""
    raw_key = "sk-secret-key-456"

    _get_fernet.cache_clear()
    with patch("config.settings.JWT_SECRET_KEY", "secret-key-a"):
        enc = encrypt_api_key(raw_key)

    _get_fernet.cache_clear()
    with patch("config.settings.JWT_SECRET_KEY", "secret-key-b"):
        with pytest.raises(InvalidToken):
            decrypt_api_key(enc)

    _get_fernet.cache_clear()


def test_get_fernet_lru_cache():
    """测试 _get_fernet 拥有单例 LRU 缓存。"""
    _get_fernet.cache_clear()
    fernet1 = _get_fernet()
    fernet2 = _get_fernet()
    assert fernet1 is fernet2
