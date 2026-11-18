"""Pure-offline tests for the real-flow acceptance script.

Run with ``--noconftest -o addopts= --no-cov`` from the backend directory so
the default ``tests/conftest.py`` (which imports the application and database)
is never loaded.  These tests exercise subprocess exit codes and the offline
transport/classification helpers without performing any network I/O.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

from scripts.acceptance_common import AcceptanceInputError, decode_json_object
from scripts.real_flow_acceptance import (
    DEFAULT_PLAN,
    PLAN_ID,
    PLAN_VERSION,
    TOKEN_ENV,
    FakeTransport,
    _check_body_contract,
    _classify_http_step,
    _http_get_once,
    _NoRedirectHandler,
    _parse_json_body,
    _read_bounded,
    _RedirectRejected,
    _sanitize_http_response,
    _validate_account,
    _validate_session_id,
    _validate_target,
    build_execution_evidence,
    execution_exit_code,
    verify_evidence,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _run_cli(*args: str, token: str | None = None) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env.pop(TOKEN_ENV, None)
    if token is not None:
        env[TOKEN_ENV] = token
    return subprocess.run(
        [sys.executable, "-m", "scripts.real_flow_acceptance", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


def _full_evidence(
    status: str = "observed_ok",
    *,
    source: str | None = "real",
    environment: str | None = "staging",
    version: str | None = "v1",
) -> dict:
    steps = [
        {
            "step_id": step.id,
            "status": status,
            "source": source,
            "environment": environment,
            "version": version,
            "trace_id": None,
            "error_code": None,
        }
        for step in DEFAULT_PLAN
    ]
    return {"plan_id": PLAN_ID, "plan_version": PLAN_VERSION, "steps": steps}


def test_plan_command_is_offline_and_never_reads_token():
    result = _run_cli("plan", token="SENTINEL-TOKEN")
    assert result.returncode == 0
    doc = json.loads(result.stdout)
    assert doc["plan_id"] == PLAN_ID
    assert doc["plan_version"] == PLAN_VERSION
    assert len(doc["steps"]) == len(DEFAULT_PLAN)
    assert "SENTINEL-TOKEN" not in result.stdout
    assert "SENTINEL-TOKEN" not in result.stderr


def test_probe_stays_partial_and_never_reads_token():
    result = _run_cli(
        "probe", "--target", "https://example.com", token="SENTINEL-TOKEN"
    )
    assert result.returncode == 3
    doc = json.loads(result.stdout)
    statuses = {s["status"] for s in doc["steps"]}
    assert "observed_ok" not in statuses
    assert statuses <= {"not_run", "manual_pending"}
    assert "SENTINEL-TOKEN" not in result.stdout
    assert "SENTINEL-TOKEN" not in result.stderr


@pytest.mark.parametrize(
    "target",
    [
        "",
        "http://example.com",
        "https://user:pw@example.com",
        "https://example.com/?q=1",
        "https://example.com/#frag",
    ],
)
def test_probe_bad_target_rejected(target: str):
    result = _run_cli("probe", "--target", target)
    assert result.returncode == 2


def test_execute_requires_account_and_session():
    result = _run_cli("execute", "--target", "https://example.com")
    assert result.returncode == 2
    assert "invalid command-line arguments" in result.stderr


def test_execute_rejects_bad_session_id_without_echo():
    result = _run_cli(
        "execute",
        "--target",
        "https://example.com",
        "--account",
        "staging",
        "--session-id",
        "not-a-uuid",
    )
    assert result.returncode == 2
    assert "not-a-uuid" not in result.stderr
    assert "not-a-uuid" not in result.stdout


def test_execute_forbids_cli_token_and_does_not_echo_it():
    result = _run_cli(
        "execute",
        "--target",
        "https://example.com",
        "--account",
        "staging",
        "--session-id",
        "00000000-0000-0000-0000-000000000000",
        "--token",
        "SUPERSECRET",
    )
    assert result.returncode == 2
    assert "SUPERSECRET" not in result.stderr
    assert "SUPERSECRET" not in result.stdout


def test_verify_complete_ok():
    assert verify_evidence(_full_evidence("observed_ok")) == 0


def test_verify_observed_fail():
    assert verify_evidence(_full_evidence("observed_fail")) == 1


def test_verify_empty_steps():
    doc = {"plan_id": PLAN_ID, "plan_version": PLAN_VERSION, "steps": []}
    assert verify_evidence(doc) == 3


def test_verify_missing_step():
    doc = _full_evidence("observed_ok")
    doc["steps"] = doc["steps"][:-1]
    assert verify_evidence(doc) == 3


def test_verify_unknown_step():
    doc = _full_evidence("observed_ok")
    doc["steps"][0]["step_id"] = "bogus_step"
    assert verify_evidence(doc) == 2


def test_verify_duplicate_step():
    doc = _full_evidence("observed_ok")
    doc["steps"].append(dict(doc["steps"][0]))
    assert verify_evidence(doc) == 2


def test_verify_not_run_and_manual_pending():
    assert verify_evidence(_full_evidence("not_run")) == 3
    assert verify_evidence(_full_evidence("manual_pending")) == 3


def test_verify_observed_ok_requires_real_source():
    doc = _full_evidence("observed_ok", source="synthetic")
    assert verify_evidence(doc) == 3


def test_verify_observed_ok_requires_environment():
    doc = _full_evidence("observed_ok", environment=None)
    assert verify_evidence(doc) == 3


def test_verify_observed_ok_with_error_code_rejected():
    doc = _full_evidence("observed_ok")
    doc["steps"][0]["error_code"] = "network_error"
    assert verify_evidence(doc) == 2


def test_verify_observed_ok_requires_nonwhitespace_context():
    doc = _full_evidence("observed_ok", environment="   ", version="\t")
    assert verify_evidence(doc) == 3


def test_verify_observed_ok_http_status_consistency():
    health = _step_by_id("health_basic")

    def _with_http_status(value):
        doc = _full_evidence("observed_ok")
        for entry in doc["steps"]:
            if entry["step_id"] == health.id:
                entry["http_status"] = value
        return doc

    assert verify_evidence(_with_http_status(200)) == 0
    assert verify_evidence(_with_http_status(503)) == 2
    assert verify_evidence(_with_http_status(True)) == 2
    assert verify_evidence(_with_http_status("200")) == 2


def test_verify_ready_unauth_allows_401_and_403():
    ready = _step_by_id("ready_unauth")

    def _with_http_status(value):
        doc = _full_evidence("observed_ok")
        for entry in doc["steps"]:
            if entry["step_id"] == ready.id:
                entry["http_status"] = value
        return doc

    assert verify_evidence(_with_http_status(401)) == 0
    assert verify_evidence(_with_http_status(403)) == 0
    assert verify_evidence(_with_http_status(200)) == 2


def test_decode_json_rejects_nonfinite_and_deep():
    assert _parse_json_body(b"1e999") is None
    assert _parse_json_body(b"[" * 2000 + b"]" * 2000) is None
    with pytest.raises(AcceptanceInputError):
        decode_json_object("1e999")
    with pytest.raises(AcceptanceInputError):
        decode_json_object("[" * 2000 + "]" * 2000)


def test_read_bounded_returns_none_on_any_read_exception():
    class _BadReader:
        def read(self, _n: int) -> bytes:
            raise ValueError("boom")

    assert _read_bounded(_BadReader(), 10) is None


def test_http_get_once_transport_valueerror_is_safe(monkeypatch):
    import urllib.request as urlreq

    class _RaisingOpener:
        def open(self, request, timeout=None):
            raise ValueError("boom with Bearer SECRET")

    monkeypatch.setattr(urlreq, "build_opener", lambda *a, **k: _RaisingOpener())
    result = _http_get_once("https://example.com/x", "SECRET", 1.0, 100)
    assert result == {"source": "real", "error_code": "network_error"}
    assert "SECRET" not in json.dumps(result)


def test_http_get_once_closes_httperror(monkeypatch):
    import io
    import urllib.request as urlreq
    from urllib.error import HTTPError

    closed: list[bool] = []

    class _TrackingBytes(io.BytesIO):
        def close(self) -> None:
            closed.append(True)
            super().close()

    fp = _TrackingBytes(b'{"status":"ready"}')
    err = HTTPError("https://example.com/x", 404, "Not Found", {}, fp)

    class _RaisingOpener:
        def open(self, request, timeout=None):
            raise err

    monkeypatch.setattr(urlreq, "build_opener", lambda *a, **k: _RaisingOpener())
    result = _http_get_once("https://example.com/x", None, 1.0, 100)
    assert result["http_status"] == 404
    assert closed == [True]


def test_verify_cli_exit_codes(tmp_path: Path):
    ok_path = tmp_path / "ok.json"
    ok_path.write_text(json.dumps(_full_evidence("observed_ok")))
    assert _run_cli("verify", "--evidence", str(ok_path)).returncode == 0

    empty_path = tmp_path / "empty.json"
    empty_path.write_text(
        json.dumps({"plan_id": PLAN_ID, "plan_version": PLAN_VERSION, "steps": []})
    )
    assert _run_cli("verify", "--evidence", str(empty_path)).returncode == 3


def test_validate_target():
    _validate_target("https://example.com")
    for target in (
        "",
        "http://example.com",
        "https://user:pw@example.com",
        "https://example.com/?q=1",
        "https://example.com/#f",
    ):
        with pytest.raises(AcceptanceInputError):
            _validate_target(target)


def test_validate_session_id():
    sid = "00000000-0000-0000-0000-000000000000"
    assert _validate_session_id(sid) == sid
    for bad in ("", "not-a-uuid"):
        with pytest.raises(AcceptanceInputError):
            _validate_session_id(bad)


def test_validate_account():
    assert _validate_account("staging") == "staging"
    with pytest.raises(AcceptanceInputError):
        _validate_account("")
    with pytest.raises(AcceptanceInputError):
        _validate_account("x" * 201)


def test_parse_json_body():
    assert _parse_json_body(b'{"status": "ok"}') == {"status": "ok"}
    assert _parse_json_body(b"not json") is None
    assert _parse_json_body(b'["list"]') is None


def test_sanitize_http_response_bounds_and_whitelist():
    assert (
        _sanitize_http_response(200, b"x" * 100, 50)["error_code"]
        == "response_too_large"
    )
    assert (
        _sanitize_http_response(200, b"not json", 100)["error_code"] == "invalid_json"
    )
    result = _sanitize_http_response(200, b'{"status":"ok","service":"echo-talk"}', 100)
    assert result["source"] == "real"
    assert result["http_status"] == 200
    assert result["body"] == {"status": "ok", "service": "echo-talk"}
    assert result["error_code"] is None


def test_parse_json_body_rejects_duplicate_keys_and_non_object():
    assert _parse_json_body(b'{"status": "ok", "status": "ok"}') is None
    assert _parse_json_body(b'{"status": NaN}') is None


def test_no_redirect_handler_rejects():
    with pytest.raises(_RedirectRejected):
        _NoRedirectHandler().redirect_request(
            None, None, 302, "Found", {}, "https://elsewhere"
        )


def _step_by_id(step_id: str):
    return next(s for s in DEFAULT_PLAN if s.id == step_id)


def test_classify_synthetic_and_status_bounds():
    health = _step_by_id("health_basic")
    assert (
        _classify_http_step(health, {"source": "synthetic"}, None)["status"]
        == "not_run"
    )

    fail = _classify_http_step(
        health,
        {
            "source": "real",
            "http_status": 500,
            "body": {"status": "ok", "service": "echo-talk"},
            "error_code": None,
        },
        None,
    )
    assert fail["status"] == "observed_fail"
    assert fail["error_code"] == "unexpected_http_status"

    bad_body = _classify_http_step(
        health,
        {
            "source": "real",
            "http_status": 200,
            "body": {"status": "not_ready", "service": "echo-talk"},
            "error_code": None,
        },
        None,
    )
    assert bad_body["status"] == "observed_fail"
    assert bad_body["error_code"] == "body_field_mismatch"

    ok = _classify_http_step(
        health,
        {
            "source": "real",
            "http_status": 200,
            "body": {"status": "ok", "service": "echo-talk"},
            "error_code": None,
        },
        None,
    )
    assert ok["status"] == "observed_ok"


def test_check_body_contract_whitelists_only_and_binds_session_id():
    sid = str(uuid.uuid4())
    assert (
        _check_body_contract(
            {"status": "ok", "service": "echo-talk"},
            {"status": "ok", "service": "echo-talk"},
            sid,
        )
        is None
    )
    assert _check_body_contract({"id": sid}, {"id": "$session_id"}, sid) is None
    assert (
        _check_body_contract({"id": "not-the-session"}, {"id": "$session_id"}, sid)
        == "session_id_mismatch"
    )
    assert (
        _check_body_contract({"status": "not_ready"}, {"status": "ready"}, sid)
        == "body_field_mismatch"
    )
    assert _check_body_contract([], {"status": "ok"}, sid) == "invalid_json"


class _GreenTransport:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.calls: list[tuple[str, str | None]] = []

    def get(self, target: str, path: str, auth_token: str | None):
        self.calls.append((path, auth_token))
        sid = self.session_id
        if path == "/api/health":
            return {
                "source": "real",
                "http_status": 200,
                "body": {"status": "ok", "service": "echo-talk"},
                "error_code": None,
            }
        if path == "/api/health/system-ready":
            return {
                "source": "real",
                "http_status": 200,
                "body": {"status": "ready"},
                "error_code": None,
            }
        if path == "/api/health/ready":
            if auth_token is None:
                return {
                    "source": "real",
                    "http_status": 401,
                    "body": {"detail": "missing bearer"},
                    "error_code": None,
                }
            return {
                "source": "real",
                "http_status": 200,
                "body": {"status": "ready"},
                "error_code": None,
            }
        if path == f"/api/sessions/{sid}":
            return {
                "source": "real",
                "http_status": 200,
                "body": {"id": sid},
                "error_code": None,
            }
        if path == f"/api/sessions/{sid}/analysis-status":
            return {
                "source": "real",
                "http_status": 200,
                "body": {
                    "session_id": sid,
                    "status": "succeeded",
                    "attempt_count": 1,
                    "retryable": False,
                },
                "error_code": None,
            }
        if path == f"/api/sessions/{sid}/goals":
            return {
                "source": "real",
                "http_status": 200,
                "body": {
                    "session_id": sid,
                    "configured": True,
                    "goals": [
                        {
                            "goal_id": "mat_biz_greet_b1:introduce_name_and_role",
                            "goal_version": 1,
                            "result": "achieved",
                        }
                    ],
                },
                "error_code": None,
            }
        return {
            "source": "real",
            "http_status": 200,
            "body": {"status": "ok", "service": "echo-talk"},
            "error_code": None,
        }


def test_execute_green_stays_partial_and_enforces_negative_control():
    sid = str(uuid.uuid4())
    transport = _GreenTransport(sid)
    evidence = build_execution_evidence(
        transport=transport,
        target="https://example.com",
        session_id=sid,
        token="tok",
        account="staging",
    )
    by_id = {s["step_id"]: s for s in evidence["steps"]}
    for step in DEFAULT_PLAN:
        if step.kind == "auto_http":
            assert by_id[step.id]["status"] == "observed_ok", step.id
        else:
            assert by_id[step.id]["status"] == "manual_pending", step.id

    ready_calls = [t for p, t in transport.calls if p == "/api/health/ready"]
    assert None in ready_calls and "tok" in ready_calls
    assert any(p.startswith(f"/api/sessions/{sid}") for p, _ in transport.calls)
    assert execution_exit_code(evidence) == 3


def test_execute_missing_token_marks_auth_steps_pending():
    sid = str(uuid.uuid4())
    transport = _GreenTransport(sid)
    evidence = build_execution_evidence(
        transport=transport,
        target="https://example.com",
        session_id=sid,
        token=None,
        account="staging",
    )
    by_id = {s["step_id"]: s for s in evidence["steps"]}
    for auth_step in ("ready_auth", "session_read", "analysis_status", "session_goals"):
        assert by_id[auth_step]["status"] == "manual_pending"
        assert by_id[auth_step]["error_code"] == "bearer_token_env_not_set"
    assert by_id["ready_unauth"]["status"] != "manual_pending"


def test_fake_transport_never_observes_ok():
    evidence = build_execution_evidence(
        transport=FakeTransport(),
        target="https://example.com",
        session_id=None,
        token=None,
        account=None,
    )
    statuses = {s["status"] for s in evidence["steps"]}
    assert statuses == {"not_run", "manual_pending"}


def test_execution_exit_code_partial_vs_fail():
    assert (
        execution_exit_code(
            {"steps": [{"status": "observed_ok"}, {"status": "manual_pending"}]}
        )
        == 3
    )
    assert execution_exit_code({"steps": [{"status": "observed_fail"}]}) == 1


def _http_facts(status: int, body: dict, error_code: str | None = None) -> dict:
    return {
        "source": "real",
        "http_status": status,
        "body": body,
        "error_code": error_code,
    }


def test_analysis_status_requires_terminal_succeeded():
    step = _step_by_id("analysis_status")
    sid = str(uuid.uuid4())
    ok = _classify_http_step(
        step,
        _http_facts(200, {"session_id": sid, "status": "succeeded"}),
        sid,
    )
    assert ok["status"] == "observed_ok"
    for body in (
        {"session_id": sid, "status": "failed"},
        {"session_id": sid, "status": "running"},
        {"session_id": sid},
    ):
        result = _classify_http_step(step, _http_facts(200, body), sid)
        assert result["status"] == "observed_fail"
        assert result["error_code"] == "body_field_mismatch"


def test_session_goals_requires_configured_and_nonempty():
    step = _step_by_id("session_goals")
    sid = str(uuid.uuid4())
    ok = _classify_http_step(
        step,
        _http_facts(
            200,
            {
                "session_id": sid,
                "configured": True,
                "goals": [{"goal_id": "mat_biz_greet_b1:introduce_name_and_role"}],
            },
        ),
        sid,
    )
    assert ok["status"] == "observed_ok"
    for body in (
        {"session_id": sid, "configured": True, "goals": []},
        {"session_id": sid, "configured": False, "goals": [{"goal_id": "x"}]},
        {"session_id": sid, "configured": 1, "goals": [{"goal_id": "x"}]},
        {"session_id": sid, "configured": True},
    ):
        result = _classify_http_step(step, _http_facts(200, body), sid)
        assert result["status"] == "observed_fail"
