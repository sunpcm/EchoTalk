"""Offline real-flow acceptance plan, evidence verification and future probe.

The default ``plan`` command emits the frozen checklist with every step
explicitly ``not_run``; it never reads credentials, environment secrets, the
database or the network.  ``verify`` strictly validates an evidence file and
reports only evidence structure/consistency.  ``probe`` exercises the
injectable-transport path with a fake transport that never performs network
I/O.  ``execute`` is the opt-in future live GET path: it requires an explicit
staging/dedicated account, target and session id, reads the bearer token only
from a fixed environment variable, refuses redirects, oversized bodies and any
non-GET/non-HTTPS target, and reports only whitelisted HTTP facts.  Even a
fully green ``execute`` stays partial: it cannot prove OIDC login, media
behaviour or the server-side ledger.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from scripts.acceptance_common import AcceptanceInputError, decode_json_object

PLAN_ID = "echotalk-real-flow-acceptance.v1"
PLAN_VERSION = 1
TOKEN_ENV = "ECHOTALK_ACCEPTANCE_BEARER_TOKEN"
DEFAULT_TIMEOUT_SECONDS = 10.0
MAX_RESPONSE_BYTES = 262144
SESSION_ID_TOKEN = "$session_id"
STATUS_SUCCEEDED_TOKEN = "$status:succeeded"
BOOL_TRUE_TOKEN = "$bool:true"
NONEMPTY_LIST_TOKEN = "$nonempty_list"

STEP_KINDS = frozenset(
    {"auto_http", "manual_media", "server_ledger", "teaching_quality"}
)
STEP_STATUSES = frozenset({"not_run", "observed_ok", "observed_fail", "manual_pending"})
STEP_SOURCES = frozenset({"real", "synthetic"})


@dataclass(frozen=True)
class PlanStep:
    id: str
    name: str
    kind: str
    required: bool
    source_requirement: str
    request: dict[str, Any] | None = None


def _step(
    step_id: str,
    name: str,
    kind: str,
    *,
    request: dict[str, Any] | None = None,
) -> PlanStep:
    return PlanStep(step_id, name, kind, True, "real", request)


DEFAULT_PLAN: tuple[PlanStep, ...] = (
    _step("login_staging", "Dedicated staging account login", "manual_media"),
    _step(
        "health_basic",
        "GET /api/health (no auth)",
        "auto_http",
        request={
            "method": "GET",
            "path": "/api/health",
            "auth": False,
            "expect_status": [200],
            "expect_body": {"status": "ok", "service": "echo-talk"},
        },
    ),
    _step(
        "system_ready",
        "GET /api/health/system-ready (no auth)",
        "auto_http",
        request={
            "method": "GET",
            "path": "/api/health/system-ready",
            "auth": False,
            "expect_status": [200],
            "expect_body": {"status": "ready"},
        },
    ),
    _step(
        "ready_auth",
        "GET /api/health/ready (with auth)",
        "auto_http",
        request={
            "method": "GET",
            "path": "/api/health/ready",
            "auth": True,
            "expect_status": [200],
            "expect_body": {"status": "ready"},
        },
    ),
    _step(
        "ready_unauth",
        "GET /api/health/ready (no auth, expect stable 401/403)",
        "auto_http",
        request={
            "method": "GET",
            "path": "/api/health/ready",
            "auth": False,
            "expect_status": [401, 403],
        },
    ),
    _step("session_create", "Create a scenario session in the app", "manual_media"),
    _step("user_speak_agent_reply", "User speaks and Agent replies", "manual_media"),
    _step("session_end", "End the session and queue analysis", "manual_media"),
    _step(
        "session_read",
        "GET /api/sessions/{session_id} (with auth)",
        "auto_http",
        request={
            "method": "GET",
            "path": "/api/sessions/{session_id}",
            "auth": True,
            "expect_status": [200],
            "expect_body": {"id": SESSION_ID_TOKEN},
        },
    ),
    _step(
        "analysis_status",
        "GET /api/sessions/{session_id}/analysis-status (with auth)",
        "auto_http",
        request={
            "method": "GET",
            "path": "/api/sessions/{session_id}/analysis-status",
            "auth": True,
            "expect_status": [200],
            "expect_body": {
                "session_id": SESSION_ID_TOKEN,
                "status": STATUS_SUCCEEDED_TOKEN,
            },
        },
    ),
    _step(
        "session_goals",
        "GET /api/sessions/{session_id}/goals (with auth)",
        "auto_http",
        request={
            "method": "GET",
            "path": "/api/sessions/{session_id}/goals",
            "auth": True,
            "expect_status": [200],
            "expect_body": {
                "session_id": SESSION_ID_TOKEN,
                "configured": BOOL_TRUE_TOKEN,
                "goals": NONEMPTY_LIST_TOKEN,
            },
        },
    ),
    _step("server_ledger", "Server-side learning-event ledger facts", "server_ledger"),
    _step(
        "teaching_quality",
        "Human review of grammar/pronunciation/goal quality",
        "teaching_quality",
    ),
)


class _RedirectRejected(Exception):
    """A fixed, safe marker raised when an HTTP redirect is refused."""


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        del req, fp, code, msg, headers, newurl
        raise _RedirectRejected()


class FakeTransport:
    """Injected transport that never performs network I/O."""

    def get(self, target: str, path: str, auth_token: str | None) -> dict[str, Any]:
        del target, path, auth_token
        return {"source": "synthetic"}


class HttpTransport:
    """Standard-library GET transport used only by the opt-in ``execute`` path."""

    def __init__(
        self,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_bytes: int = MAX_RESPONSE_BYTES,
    ) -> None:
        self.timeout = timeout
        self.max_bytes = max_bytes

    def get(self, target: str, path: str, auth_token: str | None) -> dict[str, Any]:
        url = target.rstrip("/") + path
        return _http_get_once(url, auth_token, self.timeout, self.max_bytes)


def _read_bounded(handle: Any, max_bytes: int) -> bytes | None:
    try:
        return handle.read(max_bytes + 1)
    except Exception:
        return None


def _close_quietly(handle: Any) -> None:
    """Close a response handle without ever leaking an internal exception."""
    try:
        close = getattr(handle, "close", None)
        if callable(close):
            close()
    except Exception:
        pass


def _http_get_once(
    url: str,
    auth_token: str | None,
    timeout: float,
    max_bytes: int,
) -> dict[str, Any]:
    headers = {"Accept": "application/json", "User-Agent": "echotalk-acceptance/1"}
    if auth_token is not None:
        headers["Authorization"] = "Bearer " + auth_token
    try:
        request = urllib.request.Request(url, headers=headers, method="GET")
        opener = urllib.request.build_opener(_NoRedirectHandler())
    except ValueError:
        return {"source": "real", "error_code": "request_error"}

    status: int | None = None
    raw: bytes | None = None
    try:
        with opener.open(request, timeout=timeout) as response:
            status = response.getcode()
            raw = _read_bounded(response, max_bytes)
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = _read_bounded(exc, max_bytes)
        _close_quietly(exc)
    except _RedirectRejected:
        return {"source": "real", "error_code": "redirect_rejected"}
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError):
        return {"source": "real", "error_code": "network_error"}
    if raw is None:
        return {"source": "real", "http_status": status, "error_code": "network_error"}
    assert status is not None
    return _sanitize_http_response(status, raw, max_bytes)


def _parse_json_body(raw: bytes) -> dict[str, Any] | None:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    try:
        return decode_json_object(text)
    except AcceptanceInputError:
        return None


def _sanitize_http_response(status: int, raw: bytes, max_bytes: int) -> dict[str, Any]:
    if len(raw) > max_bytes:
        return {
            "source": "real",
            "http_status": status,
            "error_code": "response_too_large",
        }
    body = _parse_json_body(raw)
    if body is None:
        return {"source": "real", "http_status": status, "error_code": "invalid_json"}
    return {"source": "real", "http_status": status, "body": body, "error_code": None}


def _validate_target(target: str) -> None:
    if target == "":
        raise AcceptanceInputError("probe target must be a non-empty HTTPS URL")
    try:
        parts = urlsplit(target)
    except ValueError as exc:
        raise AcceptanceInputError("probe target is not a valid URL") from exc
    if parts.scheme != "https" or not parts.netloc:
        raise AcceptanceInputError("probe target must be an absolute HTTPS URL")
    if parts.username is not None or parts.password is not None:
        raise AcceptanceInputError("probe target must not contain userinfo")
    if parts.query or parts.fragment:
        raise AcceptanceInputError("probe target must not contain query or fragment")


def _validate_session_id(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AcceptanceInputError("session id must be a non-empty string")
    try:
        return str(uuid.UUID(value.strip()))
    except ValueError as exc:
        raise AcceptanceInputError("session id must be a valid UUID") from exc


def _validate_account(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AcceptanceInputError("staging/dedicated test account is required")
    if len(value) > 200:
        raise AcceptanceInputError("account description is too long")
    return value.strip()


def render_plan() -> dict[str, Any]:
    """Serialize the default plan; every step is explicitly ``not_run``."""
    return {
        "plan_id": PLAN_ID,
        "plan_version": PLAN_VERSION,
        "steps": [
            {
                "step_id": step.id,
                "name": step.name,
                "kind": step.kind,
                "required": step.required,
                "source_requirement": step.source_requirement,
                "request": step.request,
                "status": "not_run",
            }
            for step in DEFAULT_PLAN
        ],
    }


def _plan_index() -> dict[str, PlanStep]:
    return {step.id: step for step in DEFAULT_PLAN}


def _bad(reason: str) -> int:
    print(f"[real_flow_acceptance] bad input: {reason}", file=sys.stderr)
    return 2


def _evidence_step(
    step_id: str,
    status: str,
    source: str | None,
    *,
    http_status: int | None = None,
    error_code: str | None = None,
) -> dict[str, Any]:
    return {
        "step_id": step_id,
        "status": status,
        "source": source,
        "http_status": http_status,
        "error_code": error_code,
    }


def _check_body_contract(
    body: Any,
    expect_body: dict[str, Any] | None,
    session_id: str | None,
) -> str | None:
    if expect_body is None:
        return None
    if not isinstance(body, dict):
        return "invalid_json"
    for field, expected in expect_body.items():
        actual = body.get(field)
        if expected == SESSION_ID_TOKEN:
            if type(actual) is not str or session_id is None or actual != session_id:
                return "session_id_mismatch"
        elif expected == STATUS_SUCCEEDED_TOKEN:
            if actual != "succeeded":
                return "body_field_mismatch"
        elif expected == BOOL_TRUE_TOKEN:
            if type(actual) is not bool or actual is not True:
                return "body_field_mismatch"
        elif expected == NONEMPTY_LIST_TOKEN:
            if not isinstance(actual, list) or not actual:
                return "body_field_mismatch"
        elif actual != expected:
            return "body_field_mismatch"
    return None


def _classify_http_step(
    step: PlanStep, facts: dict[str, Any], session_id: str | None
) -> dict[str, Any]:
    if facts.get("source") == "synthetic":
        return _evidence_step(step.id, "not_run", "synthetic")

    error_code = facts.get("error_code")
    http_status = facts.get("http_status")
    body = facts.get("body")
    if error_code is not None:
        return _evidence_step(
            step.id,
            "observed_fail",
            "real",
            http_status=http_status,
            error_code=error_code,
        )
    expect_status = frozenset(step.request.get("expect_status", []))
    if http_status is None or http_status not in expect_status:
        return _evidence_step(
            step.id,
            "observed_fail",
            "real",
            http_status=http_status,
            error_code="unexpected_http_status",
        )
    contract_error = _check_body_contract(
        body, step.request.get("expect_body"), session_id
    )
    if contract_error is not None:
        return _evidence_step(
            step.id,
            "observed_fail",
            "real",
            http_status=http_status,
            error_code=contract_error,
        )
    return _evidence_step(step.id, "observed_ok", "real", http_status=http_status)


def build_execution_evidence(
    *,
    transport: Any,
    target: str,
    session_id: str | None,
    token: str | None,
    account: str | None,
) -> dict[str, Any]:
    """Build evidence through an injected transport (real or fake)."""
    steps: list[dict[str, Any]] = []
    for step in DEFAULT_PLAN:
        if step.kind == "auto_http" and step.request is not None:
            auth = bool(step.request.get("auth"))
            if auth and token is None:
                steps.append(
                    _evidence_step(
                        step.id,
                        "manual_pending",
                        None,
                        error_code="bearer_token_env_not_set",
                    )
                )
                continue
            path = step.request["path"]
            if session_id is not None:
                path = path.replace("{session_id}", session_id)
            facts = transport.get(target, path, token if auth else None)
            steps.append(_classify_http_step(step, facts, session_id))
        else:
            steps.append(_evidence_step(step.id, "manual_pending", None))
    return {
        "plan_id": PLAN_ID,
        "plan_version": PLAN_VERSION,
        "account": account,
        "target": target,
        "session_id": session_id,
        "steps": steps,
    }


def execution_exit_code(evidence: dict[str, Any]) -> int:
    """Return 1 on an observed failure, else 3 (partial/incomplete by design)."""
    for step in evidence.get("steps", []):
        if step.get("status") == "observed_fail":
            return 1
    return 3


def _is_nonempty_str(value: Any) -> bool:
    return type(value) is str and bool(value.strip())


def verify_evidence(document: dict[str, Any]) -> int:
    """Strictly validate evidence and return one of the four exit codes."""
    if document.get("plan_id") != PLAN_ID:
        return _bad("plan_id does not match the frozen plan")
    if (
        type(document.get("plan_version")) is not int
        or document["plan_version"] != PLAN_VERSION
    ):
        return _bad("plan_version must be the integer 1")
    steps = document.get("steps")
    if not isinstance(steps, list):
        return _bad("steps must be a JSON array")
    if not steps:
        return 3

    index = _plan_index()
    seen: set[str] = set()
    has_fail = False
    has_incomplete = False
    for entry in steps:
        if not isinstance(entry, dict):
            return _bad("each evidence step must be an object")
        step_id = entry.get("step_id")
        if type(step_id) is not str or step_id not in index:
            return _bad("evidence contains an unknown or invalid step_id")
        if step_id in seen:
            return _bad("evidence contains a duplicate step_id")
        seen.add(step_id)

        status = entry.get("status")
        if type(status) is not str or status not in STEP_STATUSES:
            return _bad("evidence step has an invalid status")
        source = entry.get("source")
        if source is not None and (
            type(source) is not str or source not in STEP_SOURCES
        ):
            return _bad("evidence step has an invalid source")
        for field in ("environment", "version", "trace_id", "error_code"):
            value = entry.get(field)
            if value is not None and type(value) is not str:
                return _bad(f"evidence step field {field} must be a string or null")
        http_status = entry.get("http_status")
        if http_status is not None and type(http_status) is not int:
            return _bad("evidence step field http_status must be an integer or null")

        if status == "not_run" or status == "manual_pending":
            has_incomplete = True
        elif status == "observed_ok":
            if entry.get("error_code") is not None:
                return _bad("observed_ok must not carry an error_code")
            step = index[step_id]
            if (
                http_status is not None
                and step.request is not None
                and http_status not in step.request.get("expect_status", [])
            ):
                return _bad("observed_ok http_status does not match the step contract")
            if (
                source != "real"
                or not _is_nonempty_str(entry.get("environment"))
                or not _is_nonempty_str(entry.get("version"))
            ):
                has_incomplete = True
        elif status == "observed_fail":
            has_fail = True

    missing = [
        step.id for step in DEFAULT_PLAN if step.required and step.id not in seen
    ]
    if missing:
        has_incomplete = True

    if has_fail:
        return 1
    if has_incomplete:
        return 3
    return 0


def _read_json(path: str | None) -> dict[str, Any]:
    if path is None:
        raise AcceptanceInputError("an evidence file path is required")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as exc:
        raise AcceptanceInputError("evidence file is unreadable") from exc
    except UnicodeDecodeError as exc:
        raise AcceptanceInputError("evidence file is not valid UTF-8") from exc
    return decode_json_object(raw)


class _AcceptanceArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        del message
        raise AcceptanceInputError("invalid command-line arguments")


def _build_parser() -> argparse.ArgumentParser:
    parser = _AcceptanceArgumentParser(
        prog="python -m scripts.real_flow_acceptance",
        description="Offline real-flow acceptance plan, evidence verification and future probe.",
    )
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("plan", help="Emit the frozen real-flow checklist.")

    verify_parser = subparsers.add_parser("verify", help="Validate an evidence file.")
    verify_parser.add_argument("--evidence", required=True)

    probe_parser = subparsers.add_parser(
        "probe", help="Build offline evidence through an injected fake transport."
    )
    probe_parser.add_argument("--target", required=True)

    execute_parser = subparsers.add_parser(
        "execute", help="Opt-in live GET against an explicit staging target."
    )
    execute_parser.add_argument("--target", required=True)
    execute_parser.add_argument("--account", required=True)
    execute_parser.add_argument("--session-id", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = _build_parser().parse_args(argv)
    except AcceptanceInputError as exc:
        return _bad(str(exc))
    command = args.command or "plan"

    if command == "plan":
        print(json.dumps(render_plan(), ensure_ascii=False, indent=2))
        return 0

    if command == "verify":
        try:
            document = _read_json(args.evidence)
        except AcceptanceInputError as exc:
            print(f"[real_flow_acceptance] {exc}", file=sys.stderr)
            return 2
        code = verify_evidence(document)
        if code == 0:
            print(
                "[real_flow_acceptance] evidence structure/consistency verified "
                "(partial by definition; media, ledger and teaching quality are not certified)"
            )
        elif code == 1:
            print("[real_flow_acceptance] observation failed")
        elif code == 3:
            print("[real_flow_acceptance] evidence incomplete or not run")
        return code

    if command == "probe":
        try:
            _validate_target(args.target)
        except AcceptanceInputError as exc:
            print(f"[real_flow_acceptance] {exc}", file=sys.stderr)
            return 2
        evidence = build_execution_evidence(
            transport=FakeTransport(),
            target=args.target,
            session_id=None,
            token=None,
            account=None,
        )
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        return 3

    if command == "execute":
        try:
            _validate_target(args.target)
            session_id = _validate_session_id(args.session_id)
            account = _validate_account(args.account)
        except AcceptanceInputError as exc:
            print(f"[real_flow_acceptance] {exc}", file=sys.stderr)
            return 2
        token = os.environ.get(TOKEN_ENV)
        evidence = build_execution_evidence(
            transport=HttpTransport(),
            target=args.target,
            session_id=session_id,
            token=token,
            account=account,
        )
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        code = execution_exit_code(evidence)
        if code == 1:
            print(
                "[real_flow_acceptance] live HTTP observation failed", file=sys.stderr
            )
        else:
            print(
                "[real_flow_acceptance] live HTTP partial (media/ledger/teaching remain manual)",
                file=sys.stderr,
            )
        return code

    return _bad("unknown command")


if __name__ == "__main__":
    raise SystemExit(main())
