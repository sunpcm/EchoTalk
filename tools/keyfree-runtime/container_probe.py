"""Fixed operations inside an immutable API image; never replace app entrypoints."""

import asyncio
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, "/app")


def no_dotenv():
    if Path("/.env").exists() or any(Path("/app").glob(".env*")):
        raise RuntimeError("dotenv_present")


async def database_operation(stage):
    from database import async_session_maker, engine
    from dependencies import DEV_ISSUER, DEV_SUBJECT, MOCK_USER_ID
    from models.analysis import AnalysisJob, AnalysisJobStatus
    from models.exercise import GrammarError, PronunciationAssessment
    from models.knowledge import KnowledgeState
    from models.session import (
        Session,
        SessionMode,
        SessionStatus,
        Transcript,
        TranscriptRole,
    )
    from models.user import SubscriptionTier, User, UserSettings
    from services.analysis_jobs import STALE_AFTER
    from sqlalchemy import func, select
    from time_utils import utc_now

    user_id = uuid.UUID(MOCK_USER_ID)
    missing_id = uuid.uuid5(user_id, "isolated-missing-provider")
    recovered_id = uuid.uuid5(user_id, "isolated-stale-synthetic")
    try:
        async with async_session_maker() as db, db.begin():
            if stage == "seed-missing":
                # The independent empty-database gate and migrations ran first.
                if await db.scalar(select(func.count()).select_from(User)) != 0:
                    raise RuntimeError("fixture_database_not_empty")
                db.add(
                    User(
                        id=user_id,
                        email="runtime-smoke@example.invalid",
                        auth_issuer=DEV_ISSUER,
                        auth_subject=DEV_SUBJECT,
                        subscription_tier=SubscriptionTier.pro,
                    )
                )
                await db.flush()
                db.add(UserSettings(user_id=user_id, is_custom_mode=False))
                db.add(
                    Session(
                        id=missing_id,
                        user_id=user_id,
                        mode=SessionMode.pronunciation,
                        status=SessionStatus.completed,
                        started_at=utc_now() - timedelta(minutes=2),
                        ended_at=utc_now(),
                    )
                )
                await db.flush()
                db.add(AnalysisJob(session_id=missing_id))
                return {"fixture": "missing", "session_id": str(missing_id)}
            if stage == "seed-stale":
                # Explicit prepared expiry, not a simulation of arbitrary crashes.
                db.add(
                    Session(
                        id=recovered_id,
                        user_id=user_id,
                        mode=SessionMode.pronunciation,
                        status=SessionStatus.completed,
                        started_at=utc_now() - timedelta(minutes=10),
                        ended_at=utc_now() - timedelta(minutes=8),
                    )
                )
                await db.flush()
                db.add(
                    Transcript(
                        session_id=recovered_id,
                        role=TranscriptRole.user,
                        content="I go yesterday. This is a test",
                        timestamp_ms=1,
                    )
                )
                expired_at = utc_now() - STALE_AFTER - timedelta(minutes=1)
                db.add(
                    AnalysisJob(
                        session_id=recovered_id,
                        status=AnalysisJobStatus.running,
                        attempt_count=1,
                        started_at=expired_at,
                    )
                )
                return {
                    "fixture": "prepared_expired_running",
                    "session_id": str(recovered_id),
                    "started_at": expired_at.isoformat(),
                    "stale_after_seconds": STALE_AFTER.total_seconds(),
                }
            if stage == "repeat-analysis":
                from services.analysis_service import analyze_session

                first = await analyze_session(recovered_id, db)
                second = await analyze_session(recovered_id, db)
                if first is None or second is None or first.id != second.id:
                    raise RuntimeError("analysis_not_idempotent")
                return {"same_assessment_id": str(first.id)}
            if stage != "state":
                raise RuntimeError("unknown_database_operation")
            jobs = (
                await db.execute(
                    select(
                        AnalysisJob.session_id,
                        AnalysisJob.status,
                        AnalysisJob.attempt_count,
                        AnalysisJob.last_error_code,
                    ).order_by(AnalysisJob.session_id)
                )
            ).all()
            assessments = (
                await db.execute(
                    select(
                        PronunciationAssessment.id,
                        PronunciationAssessment.session_id,
                        PronunciationAssessment.is_synthetic,
                        PronunciationAssessment.source,
                    ).order_by(PronunciationAssessment.id)
                )
            ).all()
            grammar_ids = (
                await db.execute(
                    select(GrammarError.id, GrammarError.is_synthetic).order_by(
                        GrammarError.id
                    )
                )
            ).all()
            return {
                "jobs": [
                    {
                        "session_id": str(row[0]),
                        "status": row[1].value,
                        "attempt_count": row[2],
                        "last_error_code": row[3],
                    }
                    for row in jobs
                ],
                "assessments": [
                    {
                        "id": str(row[0]),
                        "session_id": str(row[1]),
                        "is_synthetic": row[2],
                        "source": row[3],
                    }
                    for row in assessments
                ],
                "grammar": [
                    {"id": str(row[0]), "is_synthetic": row[1]} for row in grammar_ids
                ],
                "knowledge_count": await db.scalar(
                    select(func.count()).select_from(KnowledgeState)
                ),
            }
    finally:
        await engine.dispose()


def main():
    no_dotenv()
    stage = sys.argv[1]
    if stage.startswith("http-"):
        paths = {
            "http-health": "/api/health",
            "http-anonymous": "/api/sessions",
            "http-ready": "/api/health/ready",
        }
        headers = {}
        if stage == "http-ready":
            headers["Authorization"] = "Bearer " + os.environ["DEV_AUTH_TOKEN"]
        request = urllib.request.Request(
            "http://127.0.0.1:8000" + paths[stage], headers=headers
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=1) as response:
                result = {"status": response.status, "body": json.load(response)}
        except urllib.error.HTTPError as exc:
            result = {"status": exc.code, "body": json.load(exc)}
        except (OSError, urllib.error.URLError):
            result = {"transport_error": True}
    elif stage == "verify-source":
        files = json.load(sys.stdin)
        for relative, expected in files.items():
            path = Path("/app") / relative
            if (
                not path.is_file()
                or path.is_symlink()
                or hashlib.sha256(path.read_bytes()).hexdigest() != expected
            ):
                raise RuntimeError("image_source_mismatch")
        result = {"verified_files": len(files)}
    elif stage == "migrate":
        process = subprocess.run(
            [sys.executable, "-B", "-m", "alembic", "upgrade", "head"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
            check=False,
        )
        if process.returncode != 0:
            # Do not emit Alembic/driver exceptions containing DATABASE_URL.
            raise RuntimeError("migration_failed")
        result = {"alembic_process_exit_code": process.returncode}
    elif stage == "frozen-export":
        process = subprocess.run(
            [
                "uv",
                "export",
                "--frozen",
                "--no-dev",
                "--no-emit-project",
                "--no-header",
                "--no-annotate",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
            check=False,
        )
        if (
            process.returncode
            or process.stdout != Path("requirements.txt").read_bytes()
        ):
            raise RuntimeError("frozen_export_mismatch")
        result = {"frozen_export_matches": True}
    else:
        result = asyncio.run(database_operation(stage))
    print("KEYFREE_RESULT=" + json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Even unexpected dependency/config errors must not echo env values.
        print("KEYFREE_FAILURE=" + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
