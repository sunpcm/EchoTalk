"""Offline exporter checks; all writes/negative cases use pytest-owned copies."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import export_agent_analysis_contract as exporter


def cli(output, *args):
    return subprocess.run(
        [
            sys.executable,
            "-I",
            "-B",
            str(Path(exporter.__file__).resolve()),
            "--output",
            str(output),
            *args,
        ],
        env={"LANG": "C"},
        capture_output=True,
    )


def test_clean_export_determinism_check_and_stale_preservation(tmp_path, monkeypatch):
    monkeypatch.setenv("G3_SECRET_CANARY", "DO_NOT_EXPORT_ME")
    outputs = [tmp_path / name / "contract.json" for name in ("first", "second")]
    for output in outputs:
        output.parent.mkdir()
        result = cli(output)
        assert result.returncode == 0, result.stderr
        assert cli(output, "--check").returncode == 0
    raw = outputs[0].read_bytes()
    assert raw == outputs[1].read_bytes()
    assert raw.endswith(b"\n") and b"\r" not in raw
    assert "自定义".encode() in raw and b"DO_NOT_EXPORT_ME" not in raw
    outputs[0].write_bytes(b"stale\n")
    assert cli(outputs[0], "--check").returncode != 0
    assert outputs[0].read_bytes() == b"stale\n"
    missing = tmp_path / "absent.json"
    assert cli(missing, "--check").returncode != 0
    assert not missing.exists()
    unwritable = tmp_path / "no-parent" / "artifact.json"
    assert cli(unwritable).returncode != 0
    assert not unwritable.exists()


@pytest.mark.parametrize(
    "kind", ["version", "metadata", "keyword", "nested-keyword", "remote", "dangling"]
)
def test_invalid_check_inputs_fail_without_overwriting(tmp_path, kind):
    document = exporter.build_agent_analysis_contract()
    metadata = document["x-echotalk-contract"]
    received = document["components"]["schemas"]["AgentErrorReceived"]
    if kind == "version":
        metadata["schema_version"] = 2
    elif kind == "metadata":
        metadata["unsupported"] = "must-not-be-ignored"
    elif kind == "keyword":
        received["unsupported"] = True
    elif kind == "nested-keyword":
        received["properties"]["message"]["anyOf"] = [
            {"type": "string", "maxLength": 10}
        ]
    else:
        received["properties"]["message"] = {
            "$ref": "https://example.invalid/schema.json"
            if kind == "remote"
            else "#/components/schemas/Missing"
        }
    with pytest.raises(exporter.AgentAnalysisContractExportError):
        exporter.validate_contract_document(document)
    output = tmp_path / "invalid.json"
    raw = json.dumps(document).encode()
    output.write_bytes(raw)
    result = cli(output, "--check")
    assert result.returncode != 0
    assert output.read_bytes() == raw


def test_fresh_projection_and_business_property_names_are_not_keywords():
    first = exporter.build_agent_analysis_contract()
    second = exporter.build_agent_analysis_contract()
    exporter.validate_contract_document(first)
    # 'code' and 'message' are business properties, not JSON Schema keywords.
    assert {"type", "code", "message"} == set(
        first["components"]["schemas"]["AgentErrorReceived"]["properties"]
    )
    first["x-echotalk-contract"]["agent_safe_messages"].clear()
    assert second["x-echotalk-contract"]["agent_safe_messages"]
    exporter.validate_contract_document(second)


def test_environment_is_explicit_and_empty_of_parent_values(tmp_path):
    environment = exporter._synthetic_child_environment(tmp_path)
    assert (
        not {"HOME", "DATABASE_URL", "DEV_AUTH_TOKEN", "PYTHONPATH", "G3_SECRET_CANARY"}
        & environment.keys()
    )
    assert environment["PYTHONHASHSEED"] == "0"


def test_real_child_network_barrier_blocks_dns_and_socket_before_any_connect():
    backend = Path(exporter.__file__).parent
    script = f"""
import sys
sys.path.insert(0, {str(backend)!r})
import export_agent_analysis_contract as e
import socket
e._install_network_barrier()
for operation in (lambda: socket.getaddrinfo('example.invalid',443), lambda: socket.create_connection(('127.0.0.1',9))):
    try:
        operation()
    except e.AgentAnalysisContractExportError:
        pass
    else:
        raise AssertionError('barrier did not reject')
assert e._NETWORK_ATTEMPTED
print('blocked')
"""
    result = subprocess.run(
        [sys.executable, "-I", "-B", "-c", script],
        env={"LANG": "C"},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "blocked"


def test_atomic_replace_failure_preserves_existing_file_and_cleans_temp(
    tmp_path, monkeypatch
):
    output = tmp_path / "artifact.json"
    output.write_bytes(b"original")

    def reject(*_args):
        raise OSError("injected write failure")

    monkeypatch.setattr(os, "replace", reject)
    with pytest.raises(OSError):
        exporter._write_atomic(output, b"new")
    assert output.read_bytes() == b"original"
    assert list(tmp_path.iterdir()) == [output]


@pytest.mark.parametrize(
    "kind,reason",
    [
        ("duplicate-agent", "known Agent enum must not contain duplicates"),
        ("duplicate-analysis", "known analysis enum must not contain duplicates"),
        ("duplicate-diagnostic", "diagnostic metadata must not contain duplicates"),
        ("duplicate-diagnostic-enum", "diagnostic enum must not contain duplicates"),
        ("duplicate-non-retryable", "manual retry projection must be unique"),
        ("duplicate-required", "receiver required fields must be unique"),
        ("missing-message", "every known Agent code must have a safe message"),
        ("extra-message", "safe messages must not introduce an unknown Agent code"),
        ("unknown-diagnostic", "diagnostic codes must belong to the known Agent enum"),
        ("mismatched-diagnostic", "diagnostic enum and metadata must agree"),
        ("unknown-non-retryable", "manual retry projection must have a policy"),
        ("mismatched-non-retryable", "manual retry projection must match policies"),
    ],
)
def test_invalid_catalog_projections_fail_validator_and_preserve_cli_input(
    tmp_path, kind, reason
):
    document = exporter.build_agent_analysis_contract()
    schemas = document["components"]["schemas"]
    metadata = document["x-echotalk-contract"]
    duplicate_targets = {
        "duplicate-agent": schemas["KnownAgentErrorCode"]["enum"],
        "duplicate-analysis": schemas["KnownAnalysisErrorCode"]["enum"],
        "duplicate-diagnostic": metadata["diagnostic_agent_codes"],
        "duplicate-diagnostic-enum": schemas["DiagnosticAgentErrorCode"]["enum"],
        "duplicate-non-retryable": metadata["analysis_non_retryable_codes"],
        "duplicate-required": schemas["AgentErrorReceived"]["required"],
    }
    # Each fresh document changes one otherwise-valid catalog/projection only.
    if kind in duplicate_targets:
        values = duplicate_targets[kind]
        values.append(values[0])
    elif kind == "missing-message":
        del metadata["agent_safe_messages"]["ERR_SYSTEM_RUNTIME"]
    elif kind == "extra-message":
        metadata["agent_safe_messages"]["ERR_FUTURE_CODE"] = "safe static message"
    elif kind == "unknown-diagnostic":
        metadata["diagnostic_agent_codes"].append("ERR_FUTURE_CODE")
    elif kind == "mismatched-diagnostic":
        metadata["diagnostic_agent_codes"].remove("ERR_CUSTOM_RUNTIME")
    elif kind == "unknown-non-retryable":
        metadata["analysis_non_retryable_codes"].append("future_code")
    elif kind == "mismatched-non-retryable":
        metadata["analysis_non_retryable_codes"].remove("session_missing")
    else:
        raise AssertionError(f"Unhandled negative case: {kind}")

    # This must reject before the CLI's separate stale-byte comparison can run.
    with pytest.raises(
        exporter.AgentAnalysisContractExportError,
        match="unsupported or invalid contract document",
    ):
        exporter.validate_contract_document(document)

    output = tmp_path / "invalid.json"
    raw = json.dumps(document).encode()
    output.write_bytes(raw)
    result = cli(output, "--check")
    assert result.returncode != 0, reason
    assert b"unsupported or invalid contract document" in result.stderr, (
        reason,
        result.stderr,
    )
    assert output.read_bytes() == raw, reason
