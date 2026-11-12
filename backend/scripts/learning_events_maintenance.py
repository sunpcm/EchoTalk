"""Validate or baseline the learning-event ledger on an approved test database."""

import argparse
import asyncio
import json
import os
import sys
from typing import Any

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from services.learning_event_cutover import (
    CutoverError,
    preview_legacy_baselines,
    write_legacy_baselines,
)
from services.learning_event_replay import validate_learning_event_replay

_FROZEN_BKT_VERSION = "bkt-v1"
_FROZEN_BKT_PARAMS = {
    "p_init": 0.1,
    "p_transit": 0.2,
    "p_slip": 0.1,
    "p_guess": 0.2,
}
_APPROVED_DATABASES = {
    ("127.0.0.1", 55433, "echotalk_b1_test"),
    ("localhost", 5432, "echotalk_test"),
}


class MaintenanceUsageError(RuntimeError):
    """A safe, user-facing CLI validation error."""


def _database_url():
    raw = os.environ.get("DATABASE_URL")
    if raw is None or not raw.strip():
        raise MaintenanceUsageError("必须显式设置环境变量 DATABASE_URL")

    try:
        parsed = make_url(raw)
        target = (parsed.host, parsed.port, parsed.database)
        valid = (
            parsed.drivername in {"postgresql", "postgresql+asyncpg"}
            and target in _APPROVED_DATABASES
            and bool(parsed.username and parsed.username.strip())
            and not parsed.query
        )
    except Exception as exc:
        raise MaintenanceUsageError(
            "DATABASE_URL 不是受支持的合成 PostgreSQL 测试地址"
        ) from exc
    if not valid:
        raise MaintenanceUsageError("DATABASE_URL 不是受支持的合成 PostgreSQL 测试地址")
    return parsed.set(drivername="postgresql+asyncpg")


def _safe_issue(issue) -> dict[str, Any]:
    return {
        "code": issue.code,
        "user_id": str(issue.user_id) if issue.user_id is not None else None,
        "skill_id": issue.skill_id,
    }


async def _validate(factory) -> tuple[dict[str, Any], int]:
    report = await validate_learning_event_replay(
        factory,
        algorithm_versions={
            _FROZEN_BKT_VERSION: dict(_FROZEN_BKT_PARAMS),
        },
    )
    issues = [_safe_issue(issue) for issue in report.issues]
    return (
        {
            "command": "validate",
            "ok": not issues,
            "watermark": report.watermark,
            "isolation_level": report.isolation_level,
            "read_only": report.read_only,
            "issues": issues,
        },
        0 if not issues else 1,
    )


async def _baseline(
    factory,
    *,
    revision: str,
    dry_run: bool,
) -> tuple[dict[str, Any], int]:
    async with factory() as db, db.begin():
        if dry_run:
            preview = await preview_legacy_baselines(
                db=db,
                revision=revision,
            )
            payload = {
                "command": "baseline",
                "ok": True,
                "dry_run": True,
                "revision": preview.revision,
                "count": preview.count,
                "digest": preview.digest,
            }
        else:
            result = await write_legacy_baselines(
                db=db,
                revision=revision,
            )
            payload = {
                "command": "baseline",
                "ok": True,
                "dry_run": False,
                "revision": result.revision,
                "count": result.count,
                "digest": result.digest,
                "cutover_at": result.cutover_at.isoformat(),
            }
    return payload, 0


async def _run(args) -> tuple[dict[str, Any] | None, int, str | None]:
    try:
        database_url = _database_url()
    except MaintenanceUsageError as exc:
        return None, 2, str(exc)

    engine = create_async_engine(database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        if args.command == "validate":
            return (*await _validate(factory), None)
        return (
            *await _baseline(
                factory,
                revision=args.revision,
                dry_run=not args.confirm_write,
            ),
            None,
        )
    except CutoverError as exc:
        return (
            {
                "command": args.command,
                "ok": False,
                "error": {"code": exc.code},
            },
            1,
            None,
        )
    except Exception:
        return (
            {
                "command": args.command,
                "ok": False,
                "error": {"code": "maintenance_failed"},
            },
            1,
            None,
        )
    finally:
        await engine.dispose()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate or baseline EchoTalk learning events."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser(
        "validate",
        help="run the read-only replay validator",
    )
    baseline = subparsers.add_parser(
        "baseline",
        help="preview or write the stopped-cutover legacy baselines",
    )
    baseline.add_argument("--revision", required=True)
    baseline.add_argument(
        "--confirm-write",
        action="store_true",
        help="persist baselines; omitted means a zero-write preview",
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    payload, exit_code, error = asyncio.run(_run(args))
    if error is not None:
        print(f"ERROR: {error}", file=sys.stderr)
    if payload is not None:
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
