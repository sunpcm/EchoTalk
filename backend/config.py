"""
EchoTalk 后端配置模块。
使用 pydantic-settings 从项目根目录 .env 文件读取环境变量。
"""

from pathlib import Path

from pydantic_settings import BaseSettings


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

    # Auth
    JWT_SECRET_KEY: str = "dev-secret-key-change-in-production"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

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

    model_config = {
        "env_file": str(Path(__file__).resolve().parent.parent / ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
