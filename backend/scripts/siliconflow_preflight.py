"""Offline-first SiliconFlow acceptance preflight.

The default ``plan`` command is pure offline: it does not read environment
variables, application configuration, the database, or the network.  The
explicit ``execute`` command reads ``SILICONFLOW_API_KEY``, performs exactly two
fixed HTTPS GETs, and emits only whitelisted facts.  It does not exercise paid
inference and cannot establish balance, billing, or teaching quality.
"""

from __future__ import annotations

import http.client
import json
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from scripts.acceptance_common import AcceptanceInputError, decode_json_object

CHECK_ID = "siliconflow-preflight.v1"
BASE_URL = "https://api.siliconflow.cn"
MODELS_URL = BASE_URL + "/v1/models?sub_type=chat"
LEGACY_VALIDATION_URL = BASE_URL + "/v1/user/info"
API_KEY_ENV = "SILICONFLOW_API_KEY"
DEFAULT_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"
REQUEST_TIMEOUT_SECONDS = 8.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_MODEL_LENGTH = 200

EXIT_OK = 0
EXIT_VERIFICATION_FAILED = 1
EXIT_USAGE = 2

_SUPPORTED_URLS = frozenset({MODELS_URL, LEGACY_VALIDATION_URL})
_TRANSPORT_ERRORS = frozenset(
    {
        "invalid_request",
        "network_error",
        "redirect_rejected",
        "response_too_large",
        "timeout",
    }
)
_PLACEHOLDER_KEYS = frozenset(
    {
        "api-key",
        "changeme",
        "change-me",
        "placeholder",
        "replace-me",
        "your-api-key",
    }
)


@dataclass(frozen=True)
class TransportResponse:
    """One raw HTTP result kept private to the preflight implementation."""

    http_status: int | None = None
    body: bytes | None = None
    error_category: str | None = None


class _RedirectRejected(Exception):
    """A fixed marker raised instead of following an HTTP redirect."""


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    handler_order = 100

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        del req, fp, code, msg, headers, newurl
        raise _RedirectRejected()


class HttpTransport:
    """Standard-library transport with one attempt and default TLS checks."""

    def get(self, url: str, api_key: str) -> TransportResponse:
        return _http_get_once(url, api_key)


def _read_bounded(handle: Any) -> bytes | None:
    try:
        raw = handle.read(MAX_RESPONSE_BYTES + 1)
    except Exception:
        return None
    return raw if isinstance(raw, bytes) else None


def _close_quietly(handle: Any) -> None:
    try:
        close = getattr(handle, "close", None)
        if callable(close):
            close()
    except Exception:
        pass


def _timeout_is_nested(exc: urllib.error.URLError) -> bool:
    reason = exc.reason
    return isinstance(reason, TimeoutError) or "timed out" in str(reason).lower()


def _http_get_once(url: str, api_key: str) -> TransportResponse:
    """Issue one bounded GET; the caller can supply a fake transport instead."""
    if url not in _SUPPORTED_URLS:
        return TransportResponse(error_category="invalid_request")

    headers = {
        "Accept": "application/json",
        "Authorization": "Bearer " + api_key,
        "User-Agent": "echotalk-siliconflow-preflight/1",
    }
    try:
        request = urllib.request.Request(url, headers=headers, method="GET")
        opener = urllib.request.build_opener(_NoRedirectHandler())
    except ValueError:
        return TransportResponse(error_category="invalid_request")

    status: int | None = None
    raw: bytes | None = None
    try:
        with opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            status = response.getcode()
            raw = _read_bounded(response)
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = _read_bounded(exc)
        _close_quietly(exc)
    except _RedirectRejected:
        return TransportResponse(error_category="redirect_rejected")
    except urllib.error.URLError as exc:
        category = "timeout" if _timeout_is_nested(exc) else "network_error"
        return TransportResponse(error_category=category)
    except TimeoutError:
        return TransportResponse(error_category="timeout")
    except (http.client.HTTPException, OSError, ValueError):
        return TransportResponse(error_category="network_error")

    if raw is None:
        return TransportResponse(http_status=status, error_category="network_error")
    if type(status) is not int:
        return TransportResponse(error_category="network_error")
    return TransportResponse(http_status=status, body=raw)


def _validate_model(model: str) -> str:
    if type(model) is not str:
        raise AcceptanceInputError("model must be a string")
    if model != model.strip() or not model:
        raise AcceptanceInputError("model must be non-empty without outer whitespace")
    if len(model) > MAX_MODEL_LENGTH or any(
        character.isspace() or ord(character) < 32 for character in model
    ):
        raise AcceptanceInputError("model has an invalid format")
    return model


def _validate_api_key(api_key: str | None) -> str:
    if api_key is None or api_key == "":
        raise AcceptanceInputError("api_key_not_set")
    if api_key != api_key.strip() or not 8 <= len(api_key) <= 512:
        raise AcceptanceInputError("api_key_invalid")

    normalized = api_key.lower()
    if (
        normalized in _PLACEHOLDER_KEYS
        or (api_key.startswith("<") and api_key.endswith(">"))
        or "op://" in normalized
        or "{" in api_key
        or "}" in api_key
        or any(not 0x21 <= ord(character) <= 0x7E for character in api_key)
    ):
        raise AcceptanceInputError("api_key_invalid")
    return api_key


def render_plan(model: str = DEFAULT_MODEL) -> dict[str, Any]:
    """Return a static plan without reading secrets or opening a transport."""
    selected_model = _validate_model(model)
    return {
        "check_id": CHECK_ID,
        "mode": "plan",
        "offline": True,
        "selected_model": selected_model,
        "requests": [
            {
                "method": "GET",
                "url": MODELS_URL,
                "auth": API_KEY_ENV,
                "timeout_seconds": REQUEST_TIMEOUT_SECONDS,
                "max_response_bytes": MAX_RESPONSE_BYTES,
                "redirects": "rejected",
                "retries": 0,
            },
            {
                "method": "GET",
                "url": LEGACY_VALIDATION_URL,
                "auth": API_KEY_ENV,
                "timeout_seconds": REQUEST_TIMEOUT_SECONDS,
                "max_response_bytes": MAX_RESPONSE_BYTES,
                "redirects": "rejected",
                "retries": 0,
            },
        ],
        "limitations": [
            "model_listing_does_not_prove_paid_inference",
            "model_listing_does_not_prove_balance",
            "no_inference_or_teaching_quality_was_evaluated",
        ],
    }


def _safe_transport_response(value: Any) -> TransportResponse:
    try:
        status = getattr(value, "http_status", None)
        body = getattr(value, "body", None)
        error = getattr(value, "error_category", None)
    except Exception:
        return TransportResponse(error_category="network_error")

    if status is not None and type(status) is not int:
        status = None
    if body is not None and not isinstance(body, bytes):
        body = None
    if error is not None and error not in _TRANSPORT_ERRORS:
        error = "network_error"
    return TransportResponse(http_status=status, body=body, error_category=error)


def _call_transport(transport: Any, url: str, api_key: str) -> TransportResponse:
    try:
        return _safe_transport_response(transport.get(url, api_key))
    except Exception:
        return TransportResponse(error_category="network_error")


def _status_error(status: int) -> str | None:
    if 200 <= status < 300:
        return None
    if status in (401, 403):
        return "auth_rejected"
    if status == 429:
        return "rate_limited"
    return "http_error"


def _directory_facts(response: TransportResponse) -> dict[str, Any]:
    status = response.http_status
    empty = {
        "http_status": status,
        "error_category": None,
        "schema": None,
        "count": None,
        "selected_model_listed": None,
    }
    if response.error_category is not None:
        empty["error_category"] = response.error_category
        return empty
    if status != 200:
        empty["error_category"] = (
            _status_error(status) if status is not None else "network_error"
        )
        return empty

    raw = response.body
    if raw is None:
        empty["error_category"] = "network_error"
        return empty
    if len(raw) > MAX_RESPONSE_BYTES:
        empty["error_category"] = "response_too_large"
        return empty
    try:
        document = decode_json_object(raw.decode("utf-8"))
    except (UnicodeDecodeError, AcceptanceInputError):
        empty["error_category"] = "invalid_json"
        return empty

    models = document.get("data")
    if (
        document.get("object") != "list"
        or not isinstance(models, list)
        or any(
            not isinstance(item, dict)
            or type(item.get("id")) is not str
            or not item["id"]
            for item in models
        )
    ):
        empty["error_category"] = "unexpected_schema"
        return empty

    model_ids = [item["id"] for item in models]
    return {
        "http_status": status,
        "error_category": None,
        "schema": "chat_models_v1",
        "count": len(model_ids),
        "selected_model_listed": None,
        "_model_ids": frozenset(model_ids),
    }


def _legacy_facts(response: TransportResponse) -> dict[str, Any]:
    status = response.http_status
    facts: dict[str, Any] = {
        "http_status": status,
        "error_category": None,
        "gate": "NOT_VERIFIED",
    }
    if response.error_category is not None:
        facts["error_category"] = response.error_category
        return facts
    raw = response.body
    if raw is None:
        facts["error_category"] = "network_error"
        return facts
    if len(raw) > MAX_RESPONSE_BYTES:
        facts["error_category"] = "response_too_large"
        return facts
    if status is None:
        facts["error_category"] = "network_error"
        return facts
    if status == 200:
        facts["gate"] = "HTTP_200"
    elif status in (401, 403):
        facts["gate"] = "AUTH_REJECTED"
        facts["error_category"] = "auth_rejected"
    elif status == 429:
        facts["gate"] = "RATE_LIMITED"
        facts["error_category"] = "rate_limited"
    elif status == 410:
        facts["gate"] = "LEGACY_GONE"
        facts["error_category"] = "legacy_gone"
    else:
        facts["gate"] = "HTTP_ERROR"
        facts["error_category"] = "http_error"
    return facts


def execute_preflight(
    *,
    api_key: str,
    model: str = DEFAULT_MODEL,
    transport: Any,
) -> dict[str, Any]:
    """Perform exactly two fixed GETs through an injected transport."""
    selected_model = _validate_model(model)
    validated_key = _validate_api_key(api_key)
    models_response = _call_transport(transport, MODELS_URL, validated_key)
    legacy_response = _call_transport(transport, LEGACY_VALIDATION_URL, validated_key)

    directory = _directory_facts(models_response)
    model_ids = directory.pop("_model_ids", None)
    if model_ids is None:
        permission = "NOT_VERIFIED"
    elif selected_model in model_ids:
        directory["selected_model_listed"] = True
        permission = "MODEL_LISTED"
    else:
        directory["selected_model_listed"] = False
        permission = "MODEL_NOT_LISTED"

    legacy = _legacy_facts(legacy_response)
    passed = (
        directory["error_category"] is None
        and directory["selected_model_listed"] is True
        and legacy["error_category"] is None
        and legacy["gate"] == "HTTP_200"
    )
    return {
        "check_id": CHECK_ID,
        "mode": "execute",
        "selected_model": selected_model,
        "result": "PREFLIGHT_OK" if passed else "PREFLIGHT_FAILED",
        "permission": permission,
        "directory": directory,
        "legacy_validation": legacy,
        "limitations": [
            "model_listing_does_not_prove_paid_inference",
            "model_listing_does_not_prove_balance",
            "no_inference_or_teaching_quality_was_evaluated",
        ],
    }


def execution_exit_code(document: Mapping[str, Any]) -> int:
    return EXIT_OK if document.get("result") == "PREFLIGHT_OK" else 1


_USAGE = """\
usage: python -m scripts.siliconflow_preflight [plan|execute] [--model MODEL]

commands:
  plan     emit the offline request plan (default)
  execute  run exactly two fixed HTTPS GETs

options:
  --help   show this help
"""


def _parse_argv(argv: list[str] | None) -> tuple[str, str]:
    raw_args = sys.argv[1:] if argv is None else argv
    try:
        args = list(raw_args)
    except Exception:
        raise AcceptanceInputError("invalid_command_line_arguments") from None

    if not args:
        return "plan", DEFAULT_MODEL
    if args == ["--help"]:
        return "help", DEFAULT_MODEL

    command = args[0]
    if command not in {"plan", "execute"}:
        raise AcceptanceInputError("invalid_command_line_arguments")
    if len(args) == 1:
        return command, DEFAULT_MODEL
    if args[1:] == ["--help"]:
        return "help", DEFAULT_MODEL
    if len(args) == 3 and args[1] == "--model":
        return command, args[2]
    raise AcceptanceInputError("invalid_command_line_arguments")


def _diagnostic(code: str) -> None:
    print(f"[siliconflow_preflight] {code}", file=sys.stderr)


def main(
    argv: list[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    transport_factory: Callable[[], Any] | None = None,
) -> int:
    try:
        command, model = _parse_argv(argv)
    except AcceptanceInputError as exc:
        _diagnostic(str(exc))
        return EXIT_USAGE

    if command == "help":
        print(_USAGE, end="")
        return EXIT_OK

    try:
        if command == "plan":
            document = render_plan(model)
            print(json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True))
            return EXIT_OK

        source = os.environ if environ is None else environ
        api_key = _validate_api_key(source.get(API_KEY_ENV))
        selected_model = _validate_model(model)
        factory = HttpTransport if transport_factory is None else transport_factory
        try:
            transport = factory()
        except Exception:
            _diagnostic("transport_unavailable")
            return EXIT_VERIFICATION_FAILED
        document = execute_preflight(
            api_key=api_key,
            model=selected_model,
            transport=transport,
        )
    except AcceptanceInputError as exc:
        _diagnostic(str(exc))
        return EXIT_USAGE

    print(json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True))
    return execution_exit_code(document)


if __name__ == "__main__":
    raise SystemExit(main())
