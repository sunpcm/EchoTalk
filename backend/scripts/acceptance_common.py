"""Shared pure helpers for offline acceptance tooling.

The real-flow acceptance script and the gold-candidate CLI share strict JSON
decoding and canonical hashing.  This module is deliberately dependency-free and
side-effect-free: it never reads environment variables, credentials, the
network, the database or application configuration.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


class AcceptanceInputError(ValueError):
    """A fixed, safe diagnostic for malformed acceptance input."""


def _reject_nonstandard_constant(value: str) -> Any:
    del value
    raise ValueError("non-standard JSON constant")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate object key")
        result[key] = value
    return result


def _reject_nonfinite_float(value: str) -> float:
    """Reject floats that Python would represent as inf/nan (for example 1e999)."""
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("non-finite number")
    return result


def decode_json_object(text: str) -> dict[str, Any]:
    """Decode strict JSON into an object with a fixed, safe diagnostic."""
    try:
        value = json.loads(
            text,
            parse_constant=_reject_nonstandard_constant,
            parse_float=_reject_nonfinite_float,
            object_pairs_hook=_reject_duplicate_keys,
        )
    except (ValueError, RecursionError):
        raise AcceptanceInputError("invalid json") from None
    if not isinstance(value, dict):
        raise AcceptanceInputError("input must be a JSON object")
    return value


def canonical_json_bytes(value: Any) -> bytes:
    """Serialize one value to canonical bytes for content hashing."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def sha256_hex(value: Any) -> str:
    """Return the SHA-256 hex digest of a value's canonical JSON encoding."""
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()
