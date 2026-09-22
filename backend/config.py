"""
EchoTalk 后端配置模块。
使用 pydantic-settings 从项目根目录 .env 文件读取环境变量。
"""

from pathlib import Path

from cryptography.fernet import Fernet
from pydantic import field_validator
from pydantic_settings import BaseSettings

DEV_CREDENTIAL_KEY = "h42Fc91-ukjBVhrQWp6JsewfYSR41rKjGto4UscO4kc="


class Settings(BaseSettings):
    """全局配置，字段与 .env 中的变量名一一对应。"""

    # 数据库
    DATABASE_URL: str = "postgresql://localhost:5432/echotalk"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Mock 开关
    USE_MOCK_DB: bool = False
    USE_MOCK_LLM: bool = False
    USE_MOCK_TTS: bool = False
    USE_MOCK_STT: bool = False
    USE_MOCK_LIVEKIT: bool = False
    USE_MOCK_CELERY: bool = True
    USE_MOCK_ELSA: bool = True

    # PostgreSQL analysis worker
    ANALYSIS_WORKER_POLL_SECONDS: float = 1.0

    # Auth。dev 与 OIDC 是互斥模式；生产部署必须选择 oidc。
    AUTH_MODE: str = "dev"
    DEV_AUTH_TOKEN: str = ""
    OIDC_ISSUER: str = ""
    OIDC_AUDIENCE: str = ""
    OIDC_JWKS_URL: str = ""
    OIDC_JWKS_CACHE_SECONDS: int = 300

    # BYOK 凭据加密。与认证签名材料完全独立，支持多版本并行读取。
    CREDENTIAL_ENCRYPTION_KEYS: dict[str, str] = {"dev-v1": DEV_CREDENTIAL_KEY}
    ACTIVE_CREDENTIAL_KEY_VERSION: str = "dev-v1"
    LEGACY_CREDENTIAL_DECRYPTION_SECRET: str = ""

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "capacitor://localhost",
        "http://localhost",
        "https://localhost",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
    CORS_ALLOW_METHODS: list[str] = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    CORS_ALLOW_HEADERS: list[str] = [
        "Content-Type",
        "Authorization",
        "Accept",
        "X-Requested-With",
    ]

    # LLM
    SILICONFLOW_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    DEFAULT_LLM_PROVIDER: str = "siliconflow"
    DEFAULT_LLM_MODEL: str = "Qwen/Qwen2.5-7B-Instruct"

    # 语音服务
    DEEPGRAM_API_KEY: str = ""
    CARTESIA_API_KEY: str = ""

    # LiveKit
    LIVEKIT_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""

    @property
    def ASYNC_DATABASE_URL(self) -> str:
        """将 postgresql:// 转换为 postgresql+asyncpg:// 供异步引擎使用。"""
        url = self.DATABASE_URL
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url

    @field_validator("AUTH_MODE")
    @classmethod
    def validate_auth_mode(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"dev", "oidc"}:
            raise ValueError("AUTH_MODE 必须是 dev 或 oidc")
        return normalized

    def validate_runtime(self) -> None:
        """启动时检查安全配置，避免生产环境静默回退到开发鉴权。"""
        if self.AUTH_MODE == "dev" and not self.DEV_AUTH_TOKEN:
            raise RuntimeError("dev 模式必须显式配置 DEV_AUTH_TOKEN")
        if self.AUTH_MODE == "oidc":
            missing = [
                name
                for name in ("OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL")
                if not getattr(self, name)
            ]
            if missing:
                raise RuntimeError(f"OIDC 配置缺失: {', '.join(missing)}")
            if not self.OIDC_ISSUER.startswith(
                "https://"
            ) or not self.OIDC_JWKS_URL.startswith("https://"):
                raise RuntimeError("OIDC issuer 与 JWKS URL 必须使用 HTTPS")
            if self.CREDENTIAL_ENCRYPTION_KEYS == {"dev-v1": DEV_CREDENTIAL_KEY}:
                raise RuntimeError("OIDC 模式禁止使用默认开发凭据加密密钥")

        active_key = self.CREDENTIAL_ENCRYPTION_KEYS.get(
            self.ACTIVE_CREDENTIAL_KEY_VERSION
        )
        if not active_key:
            raise RuntimeError("ACTIVE_CREDENTIAL_KEY_VERSION 未出现在 keyring 中")
        for version, key in self.CREDENTIAL_ENCRYPTION_KEYS.items():
            try:
                Fernet(key.encode())
            except (TypeError, ValueError) as exc:
                raise RuntimeError(f"无效的凭据加密密钥版本: {version}") from exc

    model_config = {
        "env_file": str(Path(__file__).resolve().parent.parent / ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
