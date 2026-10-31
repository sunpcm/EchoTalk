"""Shared UTC-aware datetime response types for Pydantic models."""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator, AwareDatetime


def _normalize_to_utc(dt: datetime) -> datetime:
    """Ensure timezone-aware datetime is normalized to UTC."""
    if dt.tzinfo is None:
        raise ValueError("Datetime must be timezone-aware")
    return dt.astimezone(timezone.utc)


UtcDatetime = Annotated[AwareDatetime, AfterValidator(_normalize_to_utc)]
