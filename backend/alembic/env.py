"""
Alembic 异步迁移环境配置。
使用 asyncpg 异步引擎执行数据库迁移。
"""

import asyncio
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

# 确保 backend/ 在 sys.path 中，以便导入 models 和 config
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import settings  # noqa: E402
from models import Base  # noqa: E402

# Alembic Config 对象
config = context.config

# 从 settings 动态设置数据库 URL（% 需转义为 %% 以兼容 configparser）
config.set_main_option("sqlalchemy.url", settings.ASYNC_DATABASE_URL.replace("%", "%%"))

# 配置 Python 日志
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 注册所有模型的 metadata，供 autogenerate 使用
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """离线模式：仅生成 SQL 脚本，不连接数据库。"""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """在给定的同步连接上执行迁移。"""
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """异步在线模式：创建异步引擎并执行迁移。"""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    """在线模式入口：通过 asyncio.run 执行异步迁移。"""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
