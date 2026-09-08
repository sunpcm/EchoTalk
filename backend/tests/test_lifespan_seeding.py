import pytest
from unittest.mock import AsyncMock, MagicMock, Mock
import uuid

import main
from main import lifespan, app
from models.knowledge import SEED_SKILLS
from models.user import User


@pytest.mark.asyncio
async def test_lifespan_seeding_with_mock_session():
    """测试 app lifespan 中的 mock 用户与 skill 种子数据的批量查询与插入。"""
    mock_session = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.add = Mock()  # synchronous method on SQLAlchemy AsyncSession

    # 1. 模拟数据库为空：get(User, ...) 返回 None, execute(stmt) 返回空 existing_ids
    mock_session.get = AsyncMock(return_value=None)

    mock_execute_result = MagicMock()
    mock_execute_result.scalars.return_value.all.return_value = []
    mock_session.execute = AsyncMock(return_value=mock_execute_result)

    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=None)

    orig_session_maker = main.async_session_maker
    main.async_session_maker = mock_session_factory

    try:
        async with lifespan(app):
            pass

        # 检查是否尝试创建 User 和 SEED_SKILLS
        # add 被调用的次数: 1 (User) + len(SEED_SKILLS) (Skill)
        assert mock_session.add.call_count == 1 + len(SEED_SKILLS)

        # 验证 execute 在 SEED_SKILLS 查询时被调用了 1 次 (批量 IN 查询)
        assert mock_session.execute.call_count == 1
    finally:
        main.async_session_maker = orig_session_maker


@pytest.mark.asyncio
async def test_lifespan_seeding_already_exists():
    """测试当 User 和 Skill 全部已存在时，不会再调用 session.add()。"""
    mock_session = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.add = Mock()

    # 模拟 User 已存在
    mock_user = User(id=uuid.UUID(main.MOCK_USER_ID), email="test@example.com")
    mock_session.get = AsyncMock(return_value=mock_user)

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
        async with lifespan(app):
            pass

        # 任何实体都不需要 add
        assert mock_session.add.call_count == 0
        # execute 仍仅调用 1 次进行批量 IN 查询
        assert mock_session.execute.call_count == 1
    finally:
        main.async_session_maker = orig_session_maker
