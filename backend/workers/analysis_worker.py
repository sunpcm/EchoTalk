"""Small PostgreSQL-backed worker for durable session analysis jobs."""

import asyncio
import logging

from config import settings
from database import async_session_maker
from services.analysis_jobs import claim_next_job, process_job, recover_stale_jobs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def run_forever() -> None:
    """Recover stale jobs and process due jobs until the process is stopped."""
    while True:
        async with async_session_maker() as db, db.begin():
            recovered = await recover_stale_jobs(db)
            job_id = await claim_next_job(db)

        if recovered:
            logger.warning("Recovered %d stale analysis job(s)", recovered)
        if job_id is None:
            await asyncio.sleep(settings.ANALYSIS_WORKER_POLL_SECONDS)
            continue

        await process_job(job_id, async_session_maker)


if __name__ == "__main__":
    asyncio.run(run_forever())
