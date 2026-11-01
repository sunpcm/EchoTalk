"""Offline integration tests for the tracked FastAPI OpenAPI export."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
EXPORT_SCRIPT = BACKEND_ROOT / "export_openapi.py"
_TEST_PROCESS_TIMEOUT_SECONDS = 150.0


def _minimal_environment(**extra: str) -> dict[str, str]:
    return {
        "LANG": "C",
        "LC_ALL": "C",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "PYTHONIOENCODING": "utf-8",
        **extra,
    }


def _run_export(
    *arguments: str,
    cwd: Path = BACKEND_ROOT,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-I", str(EXPORT_SCRIPT), *arguments],
        cwd=cwd,
        env=env or _minimal_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=_TEST_PROCESS_TIMEOUT_SECONDS,
    )


def _run_probe(source: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-I", "-c", source],
        cwd=BACKEND_ROOT,
        env=_minimal_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=_TEST_PROCESS_TIMEOUT_SECONDS,
    )


def _assert_probe_passed(completed: subprocess.CompletedProcess[bytes]) -> None:
    assert completed.returncode == 0, completed.stderr.decode("utf-8", errors="replace")


def test_import_and_help_load_no_business_modules() -> None:
    probe = f"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("export_openapi_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

forbidden = {{
    "auth",
    "config",
    "database",
    "dependencies",
    "fastapi",
    "livekit",
    "main",
    "openai",
    "routers",
    "sqlalchemy",
}}
loaded = sorted(name for name in forbidden if name in sys.modules)
assert not loaded, loaded
try:
    module.main(["--help"])
except SystemExit as exc:
    assert exc.code == 0, exc.code
else:
    raise AssertionError("--help did not exit through argparse")
"""
    _assert_probe_passed(_run_probe(probe))


def test_real_app_export_is_deterministic_and_registers_contracts(
    tmp_path: Path,
) -> None:
    first = tmp_path / "openapi-first.json"
    second = tmp_path / "openapi-second.json"
    first_result = _run_export("--output", str(first))
    second_result = _run_export("--output", str(second))

    assert first_result.returncode == 0, first_result.stderr.decode(
        "utf-8", errors="replace"
    )
    assert second_result.returncode == 0, second_result.stderr.decode(
        "utf-8", errors="replace"
    )
    assert first.read_bytes() == second.read_bytes()

    schema = json.loads(first.read_text(encoding="utf-8"))
    assert schema["openapi"].startswith("3.1.")
    assert "/api/call-capabilities" in schema["paths"]
    for component in (
        "DailyProgressResponse",
        "SessionListItem",
        "SessionListResponse",
        "CallCapabilitiesResponse",
        "CallLeaseResponse",
        "CallReleaseResponse",
    ):
        assert component in schema["components"]["schemas"]


def test_parent_environment_is_not_forwarded_to_schema(tmp_path: Path) -> None:
    output = tmp_path / "openapi.json"
    canary = "parent-environment-canary-1f9c"
    result = _run_export(
        "--output",
        str(output),
        env=_minimal_environment(
            OPENAPI_PARENT_SECRET_CANARY=canary,
            DEV_AUTH_TOKEN=canary,
            DATABASE_URL=f"postgresql://{canary}@127.0.0.1:1/{canary}",
            OPENAI_API_KEY=canary,
        ),
    )

    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    assert canary.encode() not in output.read_bytes()


def test_synthetic_child_environment_is_complete_and_scoped(tmp_path: Path) -> None:
    probe = f"""
import base64
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("export_openapi_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

root = Path({str(tmp_path)!r})
environment = module._synthetic_child_environment(root)
expected_keys = {{
    "ACTIVE_CREDENTIAL_KEY_VERSION",
    "AUTH_MODE",
    "CALL_LEASE_MODE",
    "CREDENTIAL_ENCRYPTION_KEYS",
    "DATABASE_URL",
    "DEV_AUTH_TOKEN",
    "LANG",
    "LC_ALL",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONHASHSEED",
    "PYTHONIOENCODING",
    "TEMP",
    "TMP",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
}}
assert set(environment) == expected_keys, set(environment)
for variable, directory in (
    ("TEMP", "tmp"),
    ("TMP", "tmp"),
    ("TMPDIR", "tmp"),
    ("XDG_CACHE_HOME", "cache"),
    ("XDG_CONFIG_HOME", "config"),
    ("XDG_DATA_HOME", "data"),
):
    assert Path(environment[variable]) == root / directory

keyring = json.loads(environment["CREDENTIAL_ENCRYPTION_KEYS"])
key = keyring["synthetic-test-key-" "v1"]
assert len(base64.urlsafe_b64decode(key)) == 32
assert base64.urlsafe_b64decode(key) == b"0" * 32
assert "openapi.invalid" in environment["DATABASE_URL"]
"""
    _assert_probe_passed(_run_probe(probe))


def test_child_exception_output_has_no_exception_value() -> None:
    canary = "openapi-exception-canary-8d4e"
    probe = f"""
import contextlib
import importlib.util
import io

spec = importlib.util.spec_from_file_location("export_openapi_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

def fail_barrier():
    raise RuntimeError({canary!r})

module._install_network_barrier = fail_barrier
stdout = io.StringIO()
stderr = io.StringIO()
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    result = module._export_schema_in_child()

assert result != 0
assert stdout.getvalue() == ""
error = stderr.getvalue()
assert {canary!r} not in error
assert "stage=network-barrier" in error
assert "error_type=RuntimeError" in error
"""
    _assert_probe_passed(_run_probe(probe))


def test_parent_does_not_echo_unstructured_child_stderr(tmp_path: Path) -> None:
    output = tmp_path / "openapi.json"
    canary = "openapi-parent-stderr-canary-31b7"
    probe = f"""
import contextlib
import importlib.util
import io

spec = importlib.util.spec_from_file_location("export_openapi_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

class FailedProcess:
    returncode = 1
    stdout = {canary.encode()!r}
    stderr = {canary.encode()!r}

def fake_run(*args, **kwargs):
    assert kwargs["timeout"] == module._EXPORT_TIMEOUT_SECONDS
    return FailedProcess()

module.subprocess.run = fake_run
stdout = io.StringIO()
stderr = io.StringIO()
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    result = module.main(["--output", {str(output)!r}])

assert result != 0
assert stdout.getvalue() == ""
error = stderr.getvalue()
assert {canary!r} not in error
assert "isolated export exited with code 1" in error
"""
    _assert_probe_passed(_run_probe(probe))
    assert not output.exists()


def test_timeout_is_nonzero_safe_and_preserves_existing_output(
    tmp_path: Path,
) -> None:
    output = tmp_path / "openapi.json"
    output.write_text("previous-reviewed-schema\n", encoding="utf-8")
    canary = "openapi-timeout-canary-b95a"
    probe = f"""
import contextlib
import importlib.util
import io
import subprocess

spec = importlib.util.spec_from_file_location("export_openapi_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

def timeout_run(*args, **kwargs):
    assert kwargs["timeout"] == module._EXPORT_TIMEOUT_SECONDS
    raise subprocess.TimeoutExpired(
        [{canary!r}],
        kwargs["timeout"],
        output={canary.encode()!r},
        stderr={canary.encode()!r},
    )

module.subprocess.run = timeout_run
stdout = io.StringIO()
stderr = io.StringIO()
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    result = module.main(["--output", {str(output)!r}])

assert result != 0
assert stdout.getvalue() == ""
error = stderr.getvalue()
assert {canary!r} not in error
assert "isolated export timed out after 120 seconds" in error
"""
    _assert_probe_passed(_run_probe(probe))
    assert output.read_text(encoding="utf-8") == "previous-reviewed-schema\n"


def test_check_rejects_stale_and_missing_schema_without_writing(
    tmp_path: Path,
) -> None:
    stale_output = tmp_path / "stale-openapi.json"
    stale_output.write_text("stale\n", encoding="utf-8")

    stale_result = _run_export("--check", "--output", str(stale_output))
    assert stale_result.returncode != 0
    assert stale_output.read_text(encoding="utf-8") == "stale\n"

    missing_output = tmp_path / "missing-openapi.json"
    missing_result = _run_export("--check", "--output", str(missing_output))
    assert missing_result.returncode != 0
    assert not missing_output.exists()


def test_output_failure_is_nonzero_and_leaves_no_artifact(tmp_path: Path) -> None:
    missing_parent = tmp_path / "missing-parent" / "openapi.json"
    result = _run_export("--output", str(missing_parent))

    assert result.returncode != 0
    assert not missing_parent.exists()
    assert not list(tmp_path.glob(".openapi.json.*.tmp"))


def test_settings_isolation_skips_dotenv_and_file_secret_reads(
    tmp_path: Path,
) -> None:
    dotenv_file = tmp_path / ".env"
    dotenv_file.write_text("EXPORT_DOTENV_ONLY=from-dotenv\n", encoding="utf-8")
    secrets_dir = tmp_path / "secrets"
    secrets_dir.mkdir()
    (secrets_dir / "export_file_secret_only").write_text(
        "from-file-secret\n",
        encoding="utf-8",
    )
    probe = f"""
import importlib.util
import os
import sys

spec = importlib.util.spec_from_file_location("export_openapi_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)
module._install_settings_isolation()

blocked_files = {{os.path.abspath({str(dotenv_file)!r})}}
blocked_directories = {{os.path.abspath({str(secrets_dir)!r})}}

def deny_sensitive_file_access(event, args):
    if event not in {{"open", "os.listdir", "os.scandir"}} or not args:
        return
    try:
        candidate = os.path.abspath(os.fspath(args[0]))
    except TypeError:
        return
    if candidate in blocked_files or any(
        candidate == directory or candidate.startswith(directory + os.sep)
        for directory in blocked_directories
    ):
        raise AssertionError(f"unexpected sensitive file access: {{candidate}}")

sys.addaudithook(deny_sensitive_file_access)

from pydantic_settings import BaseSettings, SettingsConfigDict

class ProbeSettings(BaseSettings):
    export_dotenv_only: str = "default"
    export_file_secret_only: str = "default"
    model_config = SettingsConfigDict(
        env_file={str(dotenv_file)!r},
        secrets_dir={str(secrets_dir)!r},
        extra="ignore",
    )

assert ProbeSettings.model_config["env_file"] == {str(dotenv_file)!r}
assert ProbeSettings.model_config["secrets_dir"] == {str(secrets_dir)!r}
settings = ProbeSettings()
assert settings.export_dotenv_only == "default"
assert settings.export_file_secret_only == "default"

class PlainSettings(BaseSettings):
    plain_value: str = "default"

assert PlainSettings().plain_value == "default"
"""
    _assert_probe_passed(_run_probe(probe))


def test_network_barrier_blocks_dns_and_connections() -> None:
    probe = f"""
import _socket
import importlib.util
import socket

spec = importlib.util.spec_from_file_location("export_openapi_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)
module._install_network_barrier()

for operation in (
    lambda: socket.getaddrinfo("example.invalid", 443),
    lambda: socket.create_connection(("127.0.0.1", 1), timeout=0.01),
):
    try:
        operation()
    except module.OpenApiExportError:
        pass
    else:
        raise AssertionError("network operation was not blocked")

try:
    _socket.getaddrinfo("example.invalid", 443)
except module.OpenApiExportError:
    pass
else:
    raise AssertionError("low-level DNS operation was not blocked")

direct_socket = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
try:
    try:
        direct_socket.connect(("127.0.0.1", 1))
    except module.OpenApiExportError:
        pass
    else:
        raise AssertionError("low-level socket connection was not blocked")
finally:
    direct_socket.close()
"""
    _assert_probe_passed(_run_probe(probe))
