from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

import main
from main import app, lifespan
from models.knowledge import SEED_SKILLS


@pytest.mark.asyncio
async def test_lifespan_seeding_with_mock_session():
    """测试 lifespan 只写入显式参考数据，不创建隐式 Mock 用户。"""
    mock_session = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.add = Mock()  # synchronous method on SQLAlchemy AsyncSession

    mock_execute_result = MagicMock()
    mock_execute_result.scalars.return_value.all.return_value = []
    mock_session.execute = AsyncMock(return_value=mock_execute_result)

    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=None)

    orig_session_maker = main.async_session_maker
    main.async_session_maker = mock_session_factory

    try:
        with patch("main.settings.DEV_AUTH_TOKEN", "test-dev-token"):
            async with lifespan(app):
                pass

        assert mock_session.add.call_count == len(SEED_SKILLS)

        # 验证 execute 在 SEED_SKILLS 查询时被调用了 1 次 (批量 IN 查询)
        assert mock_session.execute.call_count == 1
    finally:
        main.async_session_maker = orig_session_maker


@pytest.mark.asyncio
async def test_lifespan_seeding_already_exists():
    """测试 Skill 全部已存在时，不会再调用 session.add()。"""
    mock_session = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.add = Mock()

    # 模拟所有 SEED_SKILLS 已存在
    mock_execute_result = MagicMock()
    existing_skill_ids = [s["id"] for s in SEED_SKILLS]
    mock_execute_result.scalars.return_value.all.return_value = existing_skill_ids
    mock_session.execute = AsyncMock(return_value=mock_execute_result)

    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=None)

    orig_session_maker = main.async_session_maker
    main.async_session_maker = mock_session_factory

    try:
        with patch("main.settings.DEV_AUTH_TOKEN", "test-dev-token"):
            async with lifespan(app):
                pass

        # 任何实体都不需要 add
        assert mock_session.add.call_count == 0
        # execute 仍仅调用 1 次进行批量 IN 查询
        assert mock_session.execute.call_count == 1
    finally:
        main.async_session_maker = orig_session_maker
