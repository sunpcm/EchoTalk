"""Pure-offline tests for the SiliconFlow acceptance preflight.

Run with ``--noconftest -o addopts= --no-cov`` from the backend directory so
the application/database test configuration is never loaded.
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import urllib.request
from email.message import Message
from pathlib import Path
from typing import Any

import pytest

from scripts.acceptance_common import AcceptanceInputError
from scripts.siliconflow_preflight import (
    API_KEY_ENV,
    DEFAULT_MODEL,
    EXIT_OK,
    EXIT_USAGE,
    EXIT_VERIFICATION_FAILED,
    LEGACY_VALIDATION_URL,
    MAX_RESPONSE_BYTES,
    MODELS_URL,
    HttpTransport,
    TransportResponse,
    _http_get_once,
    _NoRedirectHandler,
    _RedirectRejected,
    _validate_api_key,
    execute_preflight,
    execution_exit_code,
    main,
    render_plan,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_API_KEY = "-".join(("offline", "test", "credential"))


def _model_document(*model_ids: str) -> bytes:
    return json.dumps(
        {
            "object": "list",
            "data": [{"id": model_id, "object": "model"} for model_id in model_ids],
        }
    ).encode()


class _FakeTransport:
    def __init__(self, *responses: TransportResponse) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str]] = []

    def get(self, url: str, api_key: str) -> TransportResponse:
        self.calls.append((url, api_key))
        return self.responses.pop(0)


class _ExplodingEnvironment(dict):
    def get(self, key, default=None):
        del key, default
        raise AssertionError("environment must not be read")


def _execute(
    directory: TransportResponse,
    legacy: TransportResponse,
    *,
    model: str = DEFAULT_MODEL,
    api_key: str = "sk-offline-test-key",
) -> tuple[dict[str, Any], _FakeTransport]:
    transport = _FakeTransport(directory, legacy)
    document = execute_preflight(api_key=api_key, model=model, transport=transport)
    return document, transport


def test_plan_is_pure_offline_and_does_not_read_environment(capsys):
    assert main([], environ=_ExplodingEnvironment()) == EXIT_OK
    output = capsys.readouterr()
    document = json.loads(output.out)
    assert document["offline"] is True
    assert document["selected_model"] == DEFAULT_MODEL
    assert [request["method"] for request in document["requests"]] == ["GET", "GET"]
    assert document["requests"][0]["timeout_seconds"] == 8.0
    assert document["requests"][0]["max_response_bytes"] == MAX_RESPONSE_BYTES
    assert document["requests"][0]["retries"] == 0
    assert document["requests"][0]["redirects"] == "rejected"
    assert output.err == ""


def test_import_is_environment_pure():
    code = "\n".join(
        [
            "import os",
            "class Boom(dict):",
            "    def get(self, key, default=None):",
            "        raise RuntimeError('environment read')",
            "os.environ = Boom()",
            "import scripts.siliconflow_preflight",
        ]
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert result.stderr == ""


def test_plan_does_not_read_os_environ_after_import():
    code = "\n".join(
        [
            "import io",
            "import os",
            "from contextlib import redirect_stdout",
            "import scripts.siliconflow_preflight as preflight",
            "class Guard(dict):",
            "    def get(self, key, default=None):",
            "        raise RuntimeError('environment get')",
            "    def __getitem__(self, key):",
            "        raise RuntimeError('environment item')",
            "os.environ = Guard()",
            "with redirect_stdout(io.StringIO()) as output:",
            "    assert preflight.main([]) == 0",
            "    assert preflight.main(['plan']) == 0",
            'assert output.getvalue().count(\'"mode": "plan"\') == 2',
        ]
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert result.stderr == ""


def test_execute_still_reads_environment_for_missing_key_without_transport():
    code = "\n".join(
        [
            "import io",
            "import os",
            "from contextlib import redirect_stderr, redirect_stdout",
            "import scripts.siliconflow_preflight as preflight",
            "class CountingEnvironment(dict):",
            "    reads = 0",
            "    def get(self, key, default=None):",
            "        self.reads += 1",
            "        return super().get(key, default)",
            "environment = CountingEnvironment()",
            "os.environ = environment",
            "def unexpected_transport():",
            "    raise RuntimeError('transport must not be created')",
            "with redirect_stdout(io.StringIO()) as stdout:",
            "    with redirect_stderr(io.StringIO()) as stderr:",
            "        assert preflight.main(",
            "            ['execute'], transport_factory=unexpected_transport",
            "        ) == 2",
            "assert stdout.getvalue() == ''",
            "assert stderr.getvalue() == '[siliconflow_preflight] api_key_not_set\\n'",
            "assert environment.reads == 1",
        ]
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert result.stderr == ""


def test_model_override_is_not_added_to_either_request_url():
    model = "Qwen/Custom-Model:free"
    plan = render_plan(model)
    assert plan["selected_model"] == model
    assert model not in plan["requests"][0]["url"]
    assert model not in plan["requests"][1]["url"]

    document, transport = _execute(
        TransportResponse(http_status=200, body=_model_document(model)),
        TransportResponse(http_status=200, body=b"{}"),
        model=model,
    )
    assert document["result"] == "PREFLIGHT_OK"
    assert [call[0] for call in transport.calls] == [
        MODELS_URL,
        LEGACY_VALIDATION_URL,
    ]
    assert all(model not in url for url, _ in transport.calls)


def test_directory_200_listed_and_legacy_200_pass():
    document, transport = _execute(
        TransportResponse(
            http_status=200,
            body=_model_document("other/model", DEFAULT_MODEL),
        ),
        TransportResponse(http_status=200, body=b'{"balance":"not-whitelisted"}'),
    )
    assert document["result"] == "PREFLIGHT_OK"
    assert document["current_gate"] == "PASS"
    assert document["permission"] == "MODEL_LISTED"
    assert document["directory"] == {
        "http_status": 200,
        "error_category": None,
        "schema": "chat_models_v1",
        "count": 2,
        "selected_model_listed": True,
    }
    assert document["legacy_validation"] == {
        "http_status": 200,
        "error_category": None,
        "gate": "HTTP_200",
    }
    assert execution_exit_code(document) == EXIT_OK
    assert len(transport.calls) == 2


def test_directory_200_unlisted_is_verified_failure():
    document, _ = _execute(
        TransportResponse(http_status=200, body=_model_document("other/model")),
        TransportResponse(http_status=200, body=b"{}"),
    )
    assert document["result"] == "PREFLIGHT_FAILED"
    assert document["current_gate"] == "FAIL"
    assert document["permission"] == "MODEL_NOT_LISTED"
    assert document["directory"]["selected_model_listed"] is False
    assert execution_exit_code(document) == EXIT_VERIFICATION_FAILED


@pytest.mark.parametrize(
    ("status", "category"),
    [(401, "auth_rejected"), (403, "auth_rejected"), (429, "rate_limited")],
)
def test_directory_http_failures_never_claim_unlisted(status: int, category: str):
    document, _ = _execute(
        TransportResponse(http_status=status, body=b'{"error":"must-not-leak"}'),
        TransportResponse(http_status=200, body=b"{}"),
    )
    assert document["result"] == "PREFLIGHT_FAILED"
    assert document["current_gate"] == "NOT_VERIFIED"
    assert document["permission"] == "NOT_VERIFIED"
    assert document["directory"] == {
        "http_status": status,
        "error_category": category,
        "schema": None,
        "count": None,
        "selected_model_listed": None,
    }


def test_directory_200_and_legacy_410_pass_current_gate():
    document, _ = _execute(
        TransportResponse(
            http_status=200,
            body=_model_document(DEFAULT_MODEL),
        ),
        TransportResponse(http_status=410, body=b"upstream body"),
    )
    assert document["result"] == "PREFLIGHT_OK"
    assert document["current_gate"] == "PASS"
    assert document["legacy_validation"] == {
        "http_status": 410,
        "error_category": "legacy_gone",
        "gate": "LEGACY_GONE",
    }
    assert execution_exit_code(document) == EXIT_OK


@pytest.mark.parametrize(
    ("legacy", "error_category"),
    [
        (TransportResponse(http_status=401, body=b"{}"), "auth_rejected"),
        (TransportResponse(http_status=403, body=b"{}"), "auth_rejected"),
        (TransportResponse(http_status=429, body=b"{}"), "rate_limited"),
        (TransportResponse(http_status=201, body=b"{}"), "http_error"),
        (TransportResponse(http_status=204, body=b"{}"), "http_error"),
        (
            TransportResponse(error_category="network_error"),
            "network_error",
        ),
    ],
)
def test_legacy_status_is_diagnostic_only(
    legacy: TransportResponse,
    error_category: str | None,
):
    document, _ = _execute(
        TransportResponse(
            http_status=200,
            body=_model_document(DEFAULT_MODEL),
        ),
        legacy,
    )
    assert document["result"] == "PREFLIGHT_OK"
    assert document["current_gate"] == "PASS"
    assert document["legacy_validation"]["error_category"] == error_category
    assert execution_exit_code(document) == EXIT_OK


def test_transport_errors_are_fixed_and_selected_state_is_null():
    for category in ("redirect_rejected", "timeout", "network_error"):
        document, _ = _execute(
            TransportResponse(error_category=category),
            TransportResponse(error_category=category),
        )
        assert document["permission"] == "NOT_VERIFIED"
        assert document["current_gate"] == "NOT_VERIFIED"
        assert document["directory"]["selected_model_listed"] is None
        assert document["directory"]["error_category"] == category
        assert document["legacy_validation"]["gate"] == "NOT_VERIFIED"


def test_oversized_response_is_rejected_without_exposing_body():
    canary = b"BODY-CANARY"
    body = canary + b"x" * (MAX_RESPONSE_BYTES + 1 - len(canary))
    document, _ = _execute(
        TransportResponse(http_status=200, body=body),
        TransportResponse(http_status=200, body=b"{}"),
    )
    assert document["directory"]["error_category"] == "response_too_large"
    assert document["directory"]["selected_model_listed"] is None
    assert "BODY-CANARY" not in json.dumps(document)


@pytest.mark.parametrize(
    "body",
    [
        b"not-json",
        b'{"object":"list","data":[],"data":[]}',
        b'{"object":"wrong","data":[]}',
        b'{"object":"list","data":[{"id":1}]}',
    ],
)
def test_malformed_or_duplicate_directory_is_not_verified(body: bytes):
    document, _ = _execute(
        TransportResponse(http_status=200, body=body),
        TransportResponse(http_status=200, body=b"{}"),
    )
    assert document["directory"]["selected_model_listed"] is None
    assert document["current_gate"] == "NOT_VERIFIED"
    assert document["permission"] == "NOT_VERIFIED"
    assert document["directory"]["error_category"] in {
        "invalid_json",
        "unexpected_schema",
    }


@pytest.mark.parametrize(
    "api_key",
    [
        None,
        "",
        "   ",
        "<placeholder>",
        "short",
        "nonascii-key-\N{SNOWMAN}",
        "control-key-\x7f",
        "op://vault/item/credential",
        "{{UNRESOLVED_SILICONFLOW_API_KEY}}",
    ],
)
def test_missing_or_invalid_key_is_usage_error_without_request(api_key, capsys):
    calls: list[str] = []

    def transport_factory():
        calls.append("called")
        raise AssertionError("transport must not be created")

    environ = {} if api_key is None else {API_KEY_ENV: api_key}
    assert (
        main(
            ["execute"],
            environ=environ,
            transport_factory=transport_factory,
        )
        == EXIT_USAGE
    )
    output = capsys.readouterr()
    assert calls == []
    assert output.out == ""
    assert "api_key" in output.err
    if api_key:
        assert api_key not in output.err


def test_cli_output_never_leaks_key_or_raw_bodies(capsys):
    key_canary = "sk-CANARY-KEY-123456"
    body_canary = "UPSTREAM-BODY-CANARY"
    directory_body = _model_document(DEFAULT_MODEL).replace(
        b'"object": "model"',
        ('"object":"model","owner":"' + body_canary + '"').encode(),
    )
    transport = _FakeTransport(
        TransportResponse(http_status=200, body=directory_body),
        TransportResponse(http_status=200, body=body_canary.encode()),
    )
    code = main(
        ["execute"],
        environ={API_KEY_ENV: key_canary},
        transport_factory=lambda: transport,
    )
    output = capsys.readouterr()
    assert code == EXIT_OK
    assert key_canary not in output.out
    assert key_canary not in output.err
    assert body_canary not in output.out
    assert body_canary not in output.err
    assert "Authorization" not in output.out
    assert "Authorization" not in output.err


def test_401_cli_exit_is_failure_not_success(capsys):
    transport = _FakeTransport(
        TransportResponse(http_status=401, body=b"invalid key"),
        TransportResponse(http_status=401, body=b"invalid key"),
    )
    code = main(
        ["execute"],
        environ={API_KEY_ENV: TEST_API_KEY},
        transport_factory=lambda: transport,
    )
    output = capsys.readouterr()
    document = json.loads(output.out)
    assert code == EXIT_VERIFICATION_FAILED
    assert document["directory"]["error_category"] == "auth_rejected"
    assert "invalid key" not in output.out
    assert "invalid key" not in output.err


def test_actual_stdlib_opener_rejects_redirect_without_network():
    request = urllib.request.Request(MODELS_URL)
    headers = Message()
    headers["Location"] = "https://redirect.example/not-followed"
    opener = urllib.request.build_opener(_NoRedirectHandler())
    with pytest.raises(_RedirectRejected):
        opener.error(
            "http",
            request,
            io.BytesIO(b"redirect-body"),
            302,
            "Found",
            headers,
        )


def test_http_get_once_maps_redirect_to_fixed_category(monkeypatch):
    class RedirectingOpener:
        def open(self, request, timeout=None):
            del request, timeout
            raise _RedirectRejected()

    monkeypatch.setattr(
        urllib.request,
        "build_opener",
        lambda *args, **kwargs: RedirectingOpener(),
    )
    response = _http_get_once(MODELS_URL, "sk-offline-test-key")
    assert response == TransportResponse(error_category="redirect_rejected")


def test_http_get_once_uses_default_transport_and_fixed_configuration():
    transport = HttpTransport()
    assertion_key = "sk-offline-test-key"
    response = transport.get("https://example.com/not-allowed", assertion_key)
    assert response == TransportResponse(error_category="invalid_request")


def test_api_key_validation_does_not_echo_value():
    with pytest.raises(AcceptanceInputError) as exc_info:
        _validate_api_key("CANARY WITH SPACES")
    assert "CANARY" not in str(exc_info.value)


def test_directory_contract_accepts_official_object_list_with_extra_fields():
    body = json.dumps(
        {
            "object": "list",
            "request_id": "ignored-public-field",
            "data": [
                {
                    "id": DEFAULT_MODEL,
                    "display_name": "ignored extra field",
                }
            ],
        }
    ).encode()
    document, _ = _execute(
        TransportResponse(http_status=200, body=body),
        TransportResponse(http_status=200, body=b"{}"),
    )
    assert document["directory"] == {
        "http_status": 200,
        "error_category": None,
        "schema": "chat_models_v1",
        "count": 1,
        "selected_model_listed": True,
    }
    assert document["result"] == "PREFLIGHT_OK"


def test_directory_contract_rejects_missing_or_wrong_root_object():
    for body in (
        json.dumps({"data": [{"id": DEFAULT_MODEL}]}).encode(),
        json.dumps({"object": "collection", "data": [{"id": DEFAULT_MODEL}]}).encode(),
    ):
        document, _ = _execute(
            TransportResponse(http_status=200, body=body),
            TransportResponse(http_status=200, body=b"{}"),
        )
        assert document["directory"]["error_category"] == "unexpected_schema"
        assert document["directory"]["selected_model_listed"] is None
        assert document["current_gate"] == "NOT_VERIFIED"
        assert document["permission"] == "NOT_VERIFIED"


def test_cli_plan_json_contains_only_request_metadata(capsys):
    assert main(["plan"], environ=_ExplodingEnvironment()) == EXIT_OK
    document = json.loads(capsys.readouterr().out)
    serialized = json.dumps(document)
    assert "Authorization" not in serialized
    assert "Bearer" not in serialized
    assert API_KEY_ENV in serialized


@pytest.mark.parametrize(
    "argv",
    [
        ["--unknown", "ARGUMENT-CANARY"],
        ["plan", "--model"],
        ["execute", "--model", DEFAULT_MODEL, "ARGUMENT-CANARY"],
    ],
)
def test_invalid_cli_arguments_use_fixed_diagnostic_without_echo(argv, capsys):
    assert main(argv, environ=_ExplodingEnvironment()) == EXIT_USAGE
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err == "[siliconflow_preflight] invalid_command_line_arguments\n"
    assert "ARGUMENT-CANARY" not in output.err


@pytest.mark.parametrize(
    "argv", [["--help"], ["plan", "--help"], ["execute", "--help"]]
)
def test_help_is_environment_pure(argv, capsys):
    assert main(argv, environ=_ExplodingEnvironment()) == EXIT_OK
    output = capsys.readouterr()
    assert output.out.startswith("usage: python -m scripts.siliconflow_preflight")
    assert output.err == ""


def test_http_get_once_rejects_non_https_or_model_appended_url():
    for url in (
        "http://api.siliconflow.cn/v1/models?sub_type=chat",
        MODELS_URL + "&model=" + DEFAULT_MODEL,
        "https://example.com/v1/user/info",
    ):
        assert _http_get_once(url, "sk-offline-test-key") == TransportResponse(
            error_category="invalid_request"
        )


def test_unknown_transport_error_is_normalized(capsys):
    transport = _FakeTransport(
        TransportResponse(
            http_status=200,
            body=_model_document(DEFAULT_MODEL),
            error_category="CANARY-ERROR-CATEGORY",
        ),
        TransportResponse(http_status=200, body=b"{}"),
    )
    code = main(
        ["execute"],
        environ={API_KEY_ENV: TEST_API_KEY},
        transport_factory=lambda: transport,
    )
    output = capsys.readouterr()
    document = json.loads(output.out)
    assert code == EXIT_VERIFICATION_FAILED
    assert document["directory"]["error_category"] == "network_error"
    assert "CANARY-ERROR-CATEGORY" not in output.out
