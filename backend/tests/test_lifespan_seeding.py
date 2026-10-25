"""应用生命周期测试：验证启动期仅执行安全配置校验，不连接或写入数据库。"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest

import database
import main
from config import Settings
from main import app, lifespan


@pytest.mark.asyncio
async def test_lifespan_executes_runtime_validation_and_no_db_access():
    """测试 lifespan 正常启动时执行 settings.validate_runtime()，且完全不连接数据库。"""
    mock_validate = MagicMock()
    with patch.object(Settings, "validate_runtime", mock_validate):
        with (
            patch.object(database, "engine") as mock_engine,
            patch.object(database, "async_session_maker") as mock_session_maker,
        ):
            entered = False
            async with lifespan(app):
                entered = True

            assert entered is True
            assert mock_validate.call_count == 1
            assert mock_engine.connect.call_count == 0
            assert mock_session_maker.call_count == 0


@pytest.mark.asyncio
async def test_lifespan_validation_failure_raises_and_never_yields():
    """测试安全验证失败时，lifespan 立即抛错且绝不 yield。"""
    with patch.object(
        Settings,
        "validate_runtime",
        side_effect=RuntimeError("安全验证失败"),
    ):
        yielded = False
        with pytest.raises(RuntimeError, match="安全验证失败"):
            async with lifespan(app):
                yielded = True

        assert yielded is False


@pytest.mark.asyncio
async def test_lifespan_real_security_check_fails_closed():
    """保留真实安全验证入口断言：dev 模式缺少 DEV_AUTH_TOKEN 时绝不 yield。"""
    with (
        patch.object(main.settings, "AUTH_MODE", "dev"),
        patch.object(main.settings, "DEV_AUTH_TOKEN", ""),
    ):
        yielded = False
        with pytest.raises(RuntimeError, match="dev 模式必须显式配置 DEV_AUTH_TOKEN"):
            async with lifespan(app):
                yielded = True
        assert yielded is False


@pytest.mark.asyncio
async def test_lifespan_concurrent_startup_no_db_access_or_write():
    """测试 4 个并发 startup 均无任何数据库连接、会话创建或写操作。"""
    with patch.object(Settings, "validate_runtime"):
        with (
            patch.object(database, "engine") as mock_engine,
            patch.object(database, "async_session_maker") as mock_session_maker,
        ):

            async def startup_worker():
                async with lifespan(app):
                    await asyncio.sleep(0.001)

            await asyncio.gather(*[startup_worker() for _ in range(4)])

            assert mock_engine.connect.call_count == 0
            assert mock_session_maker.call_count == 0
