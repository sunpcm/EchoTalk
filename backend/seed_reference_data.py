"""显式参考数据播种模块。

提供原子幂等播种函数与独立 CLI 入口，不连接默认应用库，不读取 .env。
"""

import argparse
import os
import sys
from typing import Sequence

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from models.knowledge import SEED_SKILLS, Skill


def validate_and_format_postgres_url(raw_url: str) -> str:
    """校验并转换 PostgreSQL 异步连接串，拒绝非 PostgreSQL 协议与不完整目标。"""
    if not raw_url or not raw_url.strip():
        raise ValueError("DATABASE_URL 不能为空")

    cleaned = raw_url.strip()
    try:
        url_obj = make_url(cleaned)
    except Exception as exc:
        raise ValueError("无效的数据库 URL 格式") from exc

    raw_drivername = (url_obj.drivername or "").lower()
    if "+" in raw_drivername:
        backend_part, _ = raw_drivername.split("+", 1)
    else:
        backend_part = raw_drivername

    if backend_part not in ("postgresql", "postgres"):
        raise ValueError("仅支持 PostgreSQL 数据库连接")

    database_name = (url_obj.database or "").strip().lstrip("/")
    if not database_name:
        raise ValueError("DATABASE_URL 必须包含显式数据库名称")

    url_obj = url_obj.set(drivername="postgresql+asyncpg")
    return url_obj.render_as_string(hide_password=False)


async def seed_skills(session: AsyncSession) -> int:
    """在给定 AsyncSession 中原子写入参考技能。

    使用 INSERT ... ON CONFLICT (id) DO NOTHING，保留已有记录内容不变。
    返回新插入的记录数。
    调用方负责事务边界管理。
    """
    if not SEED_SKILLS:
        return 0

    stmt = (
        insert(Skill)
        .values(SEED_SKILLS)
        .on_conflict_do_nothing(index_elements=["id"])
        .returning(Skill.id)
    )
    result = await session.execute(stmt)
    inserted = len(result.scalars().all())
    return inserted


async def run_seed(
    database_url: str,
    execution_options: dict | None = None,
) -> int:
    """使用专有 engine 执行参考数据写入并在单个事务中提交。

    返回新插入记录数。
    """
    async_url = validate_and_format_postgres_url(database_url)
    engine = create_async_engine(
        async_url,
        echo=False,
        execution_options=execution_options or {},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with session_factory() as session:
            async with session.begin():
                inserted = await seed_skills(session)
        return inserted
    finally:
        await engine.dispose()


def parse_args(args: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m seed_reference_data",
        description="显式播种参考数据（技能等）到指定的 PostgreSQL 数据库",
    )
    return parser.parse_args(args)


async def _async_cli_main(
    args: Sequence[str] | None = None,
    execution_options: dict | None = None,
) -> int:
    parse_args(args)

    raw_url = os.environ.get("DATABASE_URL")
    if not raw_url or not raw_url.strip():
        sys.stderr.write("错误: 必须显式设置环境变量 DATABASE_URL\n")
        return 1

    try:
        inserted = await run_seed(raw_url, execution_options=execution_options)
    except Exception:
        # 错误路径严格脱敏：不输出原异常、URL、密码或其它凭据
        sys.stderr.write("错误: 播种参考数据失败\n")
        return 1

    sys.stdout.write(
        f"成功播种参考技能: 新增 {inserted} 项，总计 {len(SEED_SKILLS)} 项\n"
    )
    return 0


def main(args: Sequence[str] | None = None) -> None:
    import asyncio

    exit_code = asyncio.run(_async_cli_main(args))
    if exit_code != 0:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
