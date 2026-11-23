"""SGEC OpenAI-compatible payload source.

This module is transport-only and configuration-free at import time: every
parameter is explicit, so pure offline tests can inject a fake client without
touching ``config``, ``.env`` or the network. The durable analysis worker
assembles it from trusted settings in ``services.analysis_service``.

Security invariants:

* A real API key only ever leaves over HTTPS. A locally injected fake client
  may use HTTP, but configuration can never authorize remote HTTP credential
  egress.
* Redirect following is disabled explicitly so credentials are never forwarded
  to a redirect target.
* ``max_retries=0`` leaves retry semantics to the durable analysis worker.
* The client is closed on every success, error and cancellation path.
* External output is parsed as one strict JSON object (no duplicate keys, no
  NaN/Infinity or overflowed numbers, no oversized integers, no deep nesting,
  no markdown repair, no top-level coercion) before the strict adapter runs.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import math
from collections.abc import Collection
from typing import Any
from urllib.parse import urlsplit

import httpx
from openai import AsyncOpenAI

from services.assessment_providers import TranscriptAssessmentInput


class SGECLLMError(RuntimeError):
    """A stable, non-sensitive SGEC transport rejection."""

    def __init__(self, code: str) -> None:
        super().__init__(f"SGEC LLM transport failed: code={code}")
        self.code = code

    def __str__(self) -> str:
        return self.code


_ALLOWED_BASE_URL_SCHEMES = frozenset({"https"})
_MAX_JSON_INT = 2**63 - 1
_MAX_JSON_DEPTH = 100


def _positive_int(value: object, *, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise SGECLLMError("sgec_llm_invalid_config")
    return value


def _positive_float(value: object, *, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SGECLLMError("sgec_llm_invalid_config")
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise SGECLLMError("sgec_llm_invalid_config")
    return number


def _system_prompt(allowed_skill_tags: Collection[str]) -> str:
    tags = ", ".join(sorted(allowed_skill_tags))
    return (
        "Detect grammar errors in the user sentence. Return one JSON object "
        'whose only key is "errors" and whose value is an array. Each array '
        'item must be an object containing exactly "skill_tag", "original", '
        '"corrected", "error_type" and optional numeric "confidence" in [0,1]. '
        "The error_type value must be at most 50 characters. "
        f"The allowed skill_tag values are: {tags}. "
        "Do not return markdown, explanations, or extra fields."
    )


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number is rejected: {value}")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _validate_parsed_number(value: Any, depth: int = 0) -> None:
    if depth > _MAX_JSON_DEPTH:
        raise ValueError("JSON nesting is too deep")
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite JSON number")
    elif isinstance(value, int):
        if value > _MAX_JSON_INT or value < -_MAX_JSON_INT:
            raise ValueError("JSON integer is out of range")
    elif isinstance(value, dict):
        for child in value.values():
            _validate_parsed_number(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _validate_parsed_number(child, depth + 1)


def parse_strict_json(text: object, *, max_chars: int) -> dict[str, Any]:
    """Parse transport output as one strict JSON object."""
    if not isinstance(text, str):
        raise SGECLLMError("sgec_llm_invalid_json")
    if len(text) > max_chars:
        raise SGECLLMError("sgec_llm_oversize")
    try:
        value = json.loads(
            text,
            parse_constant=_reject_json_constant,
            object_pairs_hook=_reject_duplicate_keys,
        )
        _validate_parsed_number(value)
    except (ValueError, TypeError, RecursionError) as exc:
        raise SGECLLMError("sgec_llm_invalid_json") from exc
    if not isinstance(value, dict):
        raise SGECLLMError("sgec_llm_not_object")
    return value


def validate_base_url(value: object) -> str:
    """Return an HTTPS base URL with no embedded credentials/query/fragment."""
    if not isinstance(value, str) or not value.strip():
        raise SGECLLMError("sgec_llm_invalid_base_url")
    url = value.strip()
    try:
        parsed = urlsplit(url)
        parsed.port
    except ValueError as exc:
        raise SGECLLMError("sgec_llm_invalid_base_url") from exc
    if (
        parsed.scheme not in _ALLOWED_BASE_URL_SCHEMES
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise SGECLLMError("sgec_llm_invalid_base_url")
    return url


class SGECLLMPayloadSource:
    """Configured OpenAI-compatible source with injectable client/transport."""

    def __init__(
        self,
        *,
        model: str,
        allowed_skill_tags: Collection[str],
        base_url: str = "",
        api_key: str = "",
        timeout_seconds: float = 30.0,
        max_tokens: int = 1024,
        max_output_chars: int = 65536,
        client: AsyncOpenAI | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        if not model or not model.strip():
            raise SGECLLMError("sgec_llm_not_configured")
        self._model = model
        self._allowed_skill_tags = tuple(allowed_skill_tags)
        self._timeout_seconds = _positive_float(timeout_seconds, name="timeout_seconds")
        self._max_tokens = _positive_int(max_tokens, name="max_tokens")
        self._max_output_chars = _positive_int(
            max_output_chars, name="max_output_chars"
        )
        self._closed = False

        if client is not None:
            # Injected client ownership transfers here; it is closed after the
            # first call and must not be reused by the caller.
            self._client = client
            return

        safe_base_url = validate_base_url(base_url)
        if not api_key or not api_key.strip():
            raise SGECLLMError("sgec_llm_not_configured")

        if http_client is None:
            http_client = httpx.AsyncClient(
                follow_redirects=False,
                timeout=httpx.Timeout(self._timeout_seconds),
            )
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=safe_base_url,
            http_client=http_client,
            max_retries=0,
        )

    async def _fetch_payload(self, value: TranscriptAssessmentInput) -> dict[str, Any]:
        """Call the transport and map every failure to a stable error code."""
        try:
            async with asyncio.timeout(self._timeout_seconds):
                response = await self._client.chat.completions.create(
                    model=self._model,
                    messages=[
                        {
                            "role": "system",
                            "content": _system_prompt(self._allowed_skill_tags),
                        },
                        {"role": "user", "content": value.text},
                    ],
                    temperature=0.0,
                    max_tokens=self._max_tokens,
                )
        except asyncio.TimeoutError:
            raise SGECLLMError("sgec_llm_timeout") from None
        return await self._parse_response(response)

    async def _parse_response(self, response: Any) -> dict[str, Any]:
        try:
            choice = response.choices[0]
            finish_reason = choice.finish_reason
            content = choice.message.content
        except (AttributeError, IndexError, KeyError, TypeError) as exc:
            raise SGECLLMError("sgec_llm_empty_response") from exc
        if finish_reason != "stop":
            raise SGECLLMError("sgec_llm_rejected_finish")
        if not isinstance(content, str) or not content.strip():
            raise SGECLLMError("sgec_llm_empty_response")

        return parse_strict_json(content, max_chars=self._max_output_chars)

    async def __call__(self, value: TranscriptAssessmentInput) -> dict[str, Any]:
        """Fetch one strict payload; transport failures map to a stable code."""
        try:
            try:
                return await self._fetch_payload(value)
            except asyncio.CancelledError:
                raise
            except SGECLLMError:
                raise
            except Exception as exc:
                raise SGECLLMError("sgec_llm_transport_failed") from exc
        finally:
            await self.close()

    async def close(self) -> None:
        """Close the owned client idempotently; never raises."""
        if self._closed:
            return
        self._closed = True
        client = getattr(self, "_client", None)
        if client is None:
            return
        closer = getattr(client, "close", None)
        if closer is None:
            return
        try:
            result = closer()
        except Exception:
            return
        if inspect.isawaitable(result):
            try:
                await result
            except Exception:
                return
