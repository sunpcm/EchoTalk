"""Open the real learning-event gate for PostgreSQL integration fixtures."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from services.learning_event_cutover import (
    CutoverState,
    enable_event_gate,
    prepare_cutover,
    resume_traffic,
    stop_legacy_writes,
    write_legacy_baselines,
)


async def open_learning_event_gate(
    factory: async_sessionmaker[AsyncSession],
    *,
    revision: str,
) -> CutoverState:
    """Run the approved five-step cutover before Job data is created."""
    async with factory() as db, db.begin():
        await prepare_cutover(db=db, revision=revision)
    async with factory() as db, db.begin():
        await stop_legacy_writes(
            db=db,
            revision=revision,
            confirmed_legacy_writers_stopped=True,
        )
    async with factory() as db, db.begin():
        await write_legacy_baselines(db=db, revision=revision)
    async with factory() as db, db.begin():
        await enable_event_gate(db=db, revision=revision)
    async with factory() as db, db.begin():
        return await resume_traffic(db=db, revision=revision)
