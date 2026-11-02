"""参考数据显式播种模块契约与回归测试。

覆盖：
1. 空参考表原子插入 10 项技能
2. 重复执行完全幂等（新增 0 项）
3. 保留已有同 ID 自定义内容不变，仅补齐缺项
4. 至少 4 个独立 session 真实并发无键冲突（连接 PID 独立且屏障同步），最终 10 项唯一
5. 事务失败原子回滚
6. CLI 缺失 DATABASE_URL 拒绝且绝不连接数据库
7. CLI --help 不连接数据库
8. CLI 非法协议/URL 及缺失 database 名拒绝且脱敏，不创建 engine
9. 错误路径密码与凭据不出 stdout/stderr（Mock 异常，不连未授权地址）
10. 受控隔离 test schema 中 CLI 真实主流程成功播种与重复幂等
11. 异常路径 engine 必 dispose 且事务回滚
"""

import asyncio
import io
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from models.knowledge import SEED_SKILLS, Skill
from seed_reference_data import (
    _async_cli_main,
    parse_args,
    run_seed,
    seed_skills,
    validate_and_format_postgres_url,
)


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


@pytest.fixture
async def pg_schema():
    """提供完全隔离的测试 schema，并在测试完成后 cascade 清理。"""
    db_url = _test_database_url()
    if not db_url:
        pytest.skip("DATABASE_URL is required for PostgreSQL reference seeding tests")

    schema_name = f"test_seed_{uuid.uuid4().hex[:12]}"
    admin_engine = create_async_engine(db_url, pool_pre_ping=True)

    try:
        async with admin_engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema_name}"'))

        schema_engine = create_async_engine(
            db_url,
            execution_options={"schema_translate_map": {None: schema_name}},
            pool_pre_ping=True,
        )

        async with schema_engine.begin() as conn:
            await conn.run_sync(Skill.__table__.create)

        session_maker = async_sessionmaker(schema_engine, expire_on_commit=False)

        try:
            yield schema_name, schema_engine, session_maker
        finally:
            await schema_engine.dispose()
    finally:
        async with admin_engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
        await admin_engine.dispose()


# ---------------------------------------------------------------------------
# 1. 真实数据库回归测试
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seed_empty_table_inserts_10_skills(pg_schema):
    """验证空表初始播种得到全部 10 项技能。"""
    _, schema_engine, session_maker = pg_schema

    async with session_maker() as session:
        async with session.begin():
            inserted = await seed_skills(session)

    assert inserted == 10
    assert inserted == len(SEED_SKILLS)

    async with session_maker() as session:
        result = await session.execute(select(Skill.id))
        stored_ids = set(result.scalars().all())

    expected_ids = {s["id"] for s in SEED_SKILLS}
    assert stored_ids == expected_ids


@pytest.mark.asyncio
async def test_seed_idempotent_duplicate_call(pg_schema):
    """验证重复执行播种具有严格幂等性，第二次新增 0 项。"""
    _, schema_engine, session_maker = pg_schema

    async with session_maker() as session:
        async with session.begin():
            first_inserted = await seed_skills(session)
    assert first_inserted == 10

    async with session_maker() as session:
        async with session.begin():
            second_inserted = await seed_skills(session)
    assert second_inserted == 0

    async with session_maker() as session:
        result = await session.execute(select(Skill))
        all_skills = result.scalars().all()
    assert len(all_skills) == 10


@pytest.mark.asyncio
async def test_seed_preserves_existing_custom_content_and_fills_missing(pg_schema):
    """验证已有自定义同 ID 内容不被覆盖，且补齐其余 9 个缺项。"""
    _, schema_engine, session_maker = pg_schema

    target_id = "article_usage"
    custom_name = "Preserved Custom Name"
    custom_desc = "Preserved Custom Description"

    async with session_maker() as session:
        async with session.begin():
            existing = Skill(
                id=target_id,
                name=custom_name,
                category="grammar",
                description=custom_desc,
            )
            session.add(existing)

    async with session_maker() as session:
        async with session.begin():
            inserted = await seed_skills(session)

    assert inserted == 9

    async with session_maker() as session:
        stmt = select(Skill).where(Skill.id == target_id)
        result = await session.execute(stmt)
        preserved = result.scalar_one()

        assert preserved.name == custom_name
        assert preserved.description == custom_desc

        all_res = await session.execute(select(Skill))
        assert len(all_res.scalars().all()) == 10


@pytest.mark.asyncio
async def test_seed_concurrent_4_independent_sessions(pg_schema):
    """验证 4 个独立连接真实并发（连接 PID 互异并在写入前屏障同步），无唯一键冲突。"""
    _, schema_engine, session_maker = pg_schema

    barrier = asyncio.Barrier(4)
    backend_pids: list[int] = []

    async def worker():
        async with schema_engine.connect() as conn:
            # 1. 探针验证独立物理连接 PID
            res = await conn.execute(text("SELECT pg_backend_pid()"))
            pid = res.scalar_one()
            backend_pids.append(pid)
            await conn.rollback()

            # 2. 写入前屏障同步，证明 4 个独立连接全部就绪并同时发起写入
            await barrier.wait()

            # 3. 独立连接开启事务发起原子写入
            async with conn.begin():
                session = AsyncSession(bind=conn, expire_on_commit=False)
                return await seed_skills(session)

    results = await asyncio.gather(*[worker() for _ in range(4)])

    assert len(set(backend_pids)) == 4
    assert sum(results) == 10
    for r in results:
        assert isinstance(r, int)

    async with session_maker() as session:
        result = await session.execute(select(Skill))
        skills = result.scalars().all()
    assert len(skills) == 10


@pytest.mark.asyncio
async def test_seed_transaction_rollback_on_failure(pg_schema):
    """验证事务内发生异常时完整回滚，表内零残留。"""
    _, schema_engine, session_maker = pg_schema

    class CustomTestException(Exception):
        pass

    with pytest.raises(CustomTestException):
        async with session_maker() as session:
            async with session.begin():
                await seed_skills(session)
                raise CustomTestException("模拟中途异常")

    async with session_maker() as session:
        result = await session.execute(select(Skill))
        skills = result.scalars().all()
    assert len(skills) == 0


# ---------------------------------------------------------------------------
# 2. CLI 契约与安全测试
# ---------------------------------------------------------------------------


def test_cli_help_flag_does_not_connect():
    """验证 --help 参数通过标准机制退出，绝不发起数据库连接。"""
    with patch("seed_reference_data.create_async_engine") as mock_engine:
        with pytest.raises(SystemExit) as exc_info:
            parse_args(["--help"])
        assert exc_info.value.code == 0
        assert mock_engine.call_count == 0


@pytest.mark.asyncio
async def test_cli_missing_database_url_refuses_without_db_connection(monkeypatch):
    """验证缺少显式 DATABASE_URL 时拒绝并返回 1，且不连接数据库。"""
    monkeypatch.delenv("DATABASE_URL", raising=False)

    captured_stderr = io.StringIO()
    with (
        patch("sys.stderr", captured_stderr),
        patch("seed_reference_data.create_async_engine") as mock_engine,
    ):
        exit_code = await _async_cli_main([])

    assert exit_code == 1
    assert "必须显式设置环境变量 DATABASE_URL" in captured_stderr.getvalue()
    assert mock_engine.call_count == 0


@pytest.mark.asyncio
async def test_cli_invalid_database_url_refuses(monkeypatch):
    """验证非 PostgreSQL 协议被拒绝且错误路径安全脱敏。"""
    monkeypatch.setenv("DATABASE_URL", "sqlite:///test.db")

    captured_stderr = io.StringIO()
    with (
        patch("sys.stderr", captured_stderr),
        patch("seed_reference_data.create_async_engine") as mock_engine,
    ):
        exit_code = await _async_cli_main([])

    assert exit_code == 1
    assert "播种参考数据失败" in captured_stderr.getvalue()
    assert "sqlite" not in captured_stderr.getvalue()
    assert mock_engine.call_count == 0


def test_validate_and_format_postgres_url():
    """验证 URL 协议校验、asyncpg 驱动转换、别名支持与数据库名检查。"""
    # 空 URL 拒绝
    with pytest.raises(ValueError, match="DATABASE_URL 不能为空"):
        validate_and_format_postgres_url("")

    # 非 PG 协议拒绝
    with pytest.raises(ValueError, match="仅支持 PostgreSQL 数据库连接"):
        validate_and_format_postgres_url("mysql://root:pass@localhost:3306/db")

    with pytest.raises(ValueError, match="仅支持 PostgreSQL 数据库连接"):
        validate_and_format_postgres_url("sqlite:///foo.db")

    # 缺少显式数据库名拒绝
    with pytest.raises(ValueError, match="DATABASE_URL 必须包含显式数据库名称"):
        validate_and_format_postgres_url("postgresql://")

    with pytest.raises(ValueError, match="DATABASE_URL 必须包含显式数据库名称"):
        validate_and_format_postgres_url("postgresql://localhost:5432")

    with pytest.raises(ValueError, match="DATABASE_URL 必须包含显式数据库名称"):
        validate_and_format_postgres_url("postgresql://localhost:5432/")

    # 1. 标准 postgresql:// 形式
    pg_url = "postgresql://user:pass@localhost:5432/echotalk"
    formatted = validate_and_format_postgres_url(pg_url)
    assert formatted.startswith("postgresql+asyncpg://")
    assert "/echotalk" in formatted

    # 2. postgres:// 别名形式（无 NoSuchModuleError 且正确重定向）
    alias_url = "postgres://user:pass@localhost:5432/echotalk"
    formatted_alias = validate_and_format_postgres_url(alias_url)
    assert formatted_alias.startswith("postgresql+asyncpg://")
    assert "/echotalk" in formatted_alias

    # 3. postgresql+asyncpg:// 形式保持
    async_pg_url = "postgresql+asyncpg://user:pass@localhost:5432/echotalk"
    formatted2 = validate_and_format_postgres_url(async_pg_url)
    assert formatted2.startswith("postgresql+asyncpg://")

    # 4. 特殊密码字符原值保持
    special_pw_url = (
        "postgresql://app_user:p%40ss%3Aword%21@db.internal:5432/special_db"
    )
    formatted_sp = validate_and_format_postgres_url(special_pw_url)
    assert "p%40ss%3Aword%21" in formatted_sp or "p@ss:word!" in formatted_sp
    assert "/special_db" in formatted_sp


@pytest.mark.asyncio
async def test_cli_secrets_not_leaked_in_stdout_stderr(monkeypatch):
    """验证错误路径下，异常中的密码和敏感凭据绝不泄露到 stdout/stderr。"""
    secret_pass = "top_secret_auth_token_98765"
    db_url_with_secret = (
        f"postgresql://appuser:{secret_pass}@localhost:55432/echotalk_test"
    )
    monkeypatch.setenv("DATABASE_URL", db_url_with_secret)

    captured_stdout = io.StringIO()
    captured_stderr = io.StringIO()

    # 通过 Mock run_seed 注入包含敏感 secret 的内部异常，绝不发起外连或非 55432 假端口
    with patch(
        "seed_reference_data.run_seed",
        side_effect=Exception(f"Connection failed for user token {secret_pass}"),
    ):
        with patch("sys.stdout", captured_stdout), patch("sys.stderr", captured_stderr):
            exit_code = await _async_cli_main([])

    assert exit_code == 1
    out = captured_stdout.getvalue()
    err = captured_stderr.getvalue()

    assert secret_pass not in out
    assert secret_pass not in err
    assert "appuser" not in out
    assert "appuser" not in err


@pytest.mark.asyncio
async def test_cli_successful_run_and_repeat_in_test_schema(pg_schema, monkeypatch):
    """验证 CLI 主流程在受控隔离 test schema 中真实成功播种与重复幂等。"""
    schema_name, _, session_maker = pg_schema
    db_url = _test_database_url()
    monkeypatch.setenv("DATABASE_URL", db_url)

    # 第一次运行 CLI：通过 execution_options 将 skills 隔离到专属 test schema
    captured_stdout = io.StringIO()
    captured_stderr = io.StringIO()
    with patch("sys.stdout", captured_stdout), patch("sys.stderr", captured_stderr):
        exit_code = await _async_cli_main(
            [],
            execution_options={"schema_translate_map": {None: schema_name}},
        )

    assert exit_code == 0
    assert "新增 10 项" in captured_stdout.getvalue()
    assert captured_stderr.getvalue() == ""

    # 第二次运行 CLI（幂等验证）
    captured_stdout2 = io.StringIO()
    captured_stderr2 = io.StringIO()
    with patch("sys.stdout", captured_stdout2), patch("sys.stderr", captured_stderr2):
        exit_code2 = await _async_cli_main(
            [],
            execution_options={"schema_translate_map": {None: schema_name}},
        )

    assert exit_code2 == 0
    assert "新增 0 项" in captured_stdout2.getvalue()

    # 校验 schema 内确实有 10 项
    async with session_maker() as session:
        result = await session.execute(select(Skill))
        skills = result.scalars().all()
    assert len(skills) == 10


@pytest.mark.asyncio
async def test_cli_engine_disposed_on_error():
    """验证当事务发生异常时专有 engine 被正确 dispose。"""
    mock_engine = AsyncMock()

    class MockBeginContext:
        async def __aenter__(self):
            raise RuntimeError("模拟 DB 事务错误")

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    class MockSession:
        def begin(self):
            return MockBeginContext()

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    mock_maker = MagicMock(return_value=MockSession())

    with (
        patch("seed_reference_data.create_async_engine", return_value=mock_engine),
        patch("seed_reference_data.async_sessionmaker", return_value=mock_maker),
    ):
        with pytest.raises(RuntimeError, match="模拟 DB 事务错误"):
            await run_seed("postgresql://user:pass@localhost:55432/testdb")

        assert mock_engine.dispose.call_count == 1
