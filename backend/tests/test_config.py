import os
from unittest.mock import patch
from config import Settings


def test_jwt_secret_key_default_is_secure():
    # Ensure JWT_SECRET_KEY is not in env during default test
    with patch.dict(os.environ, {}, clear=True):
        s1 = Settings(_env_file=None)
        s2 = Settings(_env_file=None)

        assert len(s1.JWT_SECRET_KEY) >= 32
        assert s1.JWT_SECRET_KEY != "dev-secret-key-change-in-production"
        # Verify unique keys are generated for different instances when not specified in env
        assert s1.JWT_SECRET_KEY != s2.JWT_SECRET_KEY


def test_jwt_secret_key_env_override():
    custom_secret = "custom-secure-secret-key-for-testing-1234"
    with patch.dict(os.environ, {"JWT_SECRET_KEY": custom_secret}):
        s = Settings(_env_file=None)
        assert s.JWT_SECRET_KEY == custom_secret
