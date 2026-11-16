"""Read-only PostgreSQL readiness check for the API container."""

import asyncio

from sqlalchemy import text

import database

# Leave room for the asyncpg driver's bounded graceful close before the API
# response target of three seconds.
READINESS_TIMEOUT_SECONDS = 0.5


class SystemReadinessError(RuntimeError):
    """Expected database-backed readiness failure with no public detail."""


async def check_system_readiness() -> None:
    """Verify the shared database with a bounded, read-only SELECT 1."""

    try:
        async with asyncio.timeout(READINESS_TIMEOUT_SECONDS):
            async with database.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
    except Exception:
        raise SystemReadinessError("Database readiness check failed") from None
