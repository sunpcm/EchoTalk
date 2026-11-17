"""Transaction-scoped lifecycle coordination for learning-event writers."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Fixed two-key advisory namespace shared by analysis writers, goal execution,
# and account deletion.  The lock is released automatically at transaction end.
LIFECYCLE_LOCK_NAMESPACE = 150005340
LIFECYCLE_LOCK_KEY = 632828536


async def acquire_shared_lifecycle_barrier(db: AsyncSession) -> None:
    """Allow success-chain work while excluding account deletion."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock_shared(:namespace, :key)"),
        {
            "namespace": LIFECYCLE_LOCK_NAMESPACE,
            "key": LIFECYCLE_LOCK_KEY,
        },
    )


async def acquire_exclusive_lifecycle_barrier(db: AsyncSession) -> None:
    """Wait for success-chain work before account deletion takes row locks."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, :key)"),
        {
            "namespace": LIFECYCLE_LOCK_NAMESPACE,
            "key": LIFECYCLE_LOCK_KEY,
        },
    )
