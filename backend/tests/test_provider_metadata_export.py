"""Offline integration tests for the tracked Provider display metadata export."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
EXPORT_SCRIPT = BACKEND_ROOT / "export_provider_metadata.py"
TEST_PROCESS_TIMEOUT_SECONDS = 45.0


def _minimal_environment(**extra: str) -> dict[str, str]:
    return {
        "LANG": "C",
        "LC_ALL": "C",
        "PYTHONHASHSEED": "0",
        **extra,
    }


def _run_export(
    *arguments: str,
    cwd: Path = BACKEND_ROOT,
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-I", "-B", str(EXPORT_SCRIPT), *arguments],
        cwd=cwd,
        env=_minimal_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=TEST_PROCESS_TIMEOUT_SECONDS,
    )


def _run_probe(source: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-I", "-B", "-c", source],
        cwd=BACKEND_ROOT,
        env=_minimal_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=TEST_PROCESS_TIMEOUT_SECONDS,
    )


def _assert_probe_passed(completed: subprocess.CompletedProcess[bytes]) -> None:
    assert completed.returncode == 0, completed.stderr.decode("utf-8", errors="replace")


def test_import_and_help_load_no_business_modules() -> None:
    probe = f"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("export_provider_metadata_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

forbidden = {{
    "aiohttp",
    "config",
    "fastapi",
    "livekit",
    "main",
    "openai",
    "provider_catalog",
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


def test_real_catalog_export_is_deterministic_and_public_only(
    tmp_path: Path,
) -> None:
    first = tmp_path / "providers-first.json"
    second = tmp_path / "providers-second.json"
    first_result = _run_export("--output", str(first))
    second_result = _run_export("--output", str(second))

    assert first_result.returncode == 0, first_result.stderr.decode(
        "utf-8", errors="replace"
    )
    assert second_result.returncode == 0, second_result.stderr.decode(
        "utf-8", errors="replace"
    )
    assert first.read_bytes() == second.read_bytes()
    assert (
        first.read_text(encoding="utf-8")
        == """{
  "defaults": {
    "llm": "siliconflow",
    "stt": "deepgram",
    "tts": "cartesia"
  },
  "providers": [
    {
      "id": "deepgram",
      "label": "Deepgram",
      "role": "stt"
    },
    {
      "id": "siliconflow",
      "label": "SiliconFlow",
      "role": "llm"
    },
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "role": "llm"
    },
    {
      "id": "cartesia",
      "label": "Cartesia",
      "role": "tts"
    }
  ]
}
"""
    )

    payload = json.loads(first.read_text(encoding="utf-8"))
    assert set(payload) == {"defaults", "providers"}
    for provider in payload["providers"]:
        assert set(provider) == {"role", "id", "label"}
    serialized = first.read_text(encoding="utf-8")
    for forbidden in (
        "api_key",
        "base_url",
        "credential",
        "headers",
        "https://",
        "validation_url",
    ):
        assert forbidden not in serialized

    check_result = _run_export("--check", "--output", str(first))
    assert check_result.returncode == 0, check_result.stderr.decode(
        "utf-8", errors="replace"
    )
    assert first.read_text(encoding="utf-8") == serialized


def test_synthetic_child_environment_is_complete_and_scoped(tmp_path: Path) -> None:
    probe = f"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("export_provider_metadata_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

environment = module._synthetic_child_environment(Path({str(tmp_path)!r}))
assert set(environment) == {{
    "LANG",
    "LC_ALL",
    "PYTHONHASHSEED",
    "TEMP",
    "TMP",
    "TMPDIR",
}}
assert environment["TEMP"] == {str(tmp_path / "tmp")!r}
assert environment["TMP"] == {str(tmp_path / "tmp")!r}
assert environment["TMPDIR"] == {str(tmp_path / "tmp")!r}
"""
    _assert_probe_passed(_run_probe(probe))


def test_projection_is_fresh_and_does_not_mutate_catalog() -> None:
    probe = f"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("export_provider_metadata_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)
sys.path.insert(0, {str(BACKEND_ROOT)!r})

first = module.build_provider_metadata()
first["defaults"]["stt"] = "mutated"
first["providers"][0]["label"] = "Mutated"

second = module.build_provider_metadata()
assert second["defaults"]["stt"] == "deepgram"
assert second["providers"][0]["label"] == "Deepgram"
assert first is not second
assert first["defaults"] is not second["defaults"]
assert first["providers"] is not second["providers"]
"""
    _assert_probe_passed(_run_probe(probe))


def test_check_rejects_stale_and_missing_metadata_without_writing(
    tmp_path: Path,
) -> None:
    stale_output = tmp_path / "stale-providers.json"
    stale_output.write_text("stale\n", encoding="utf-8")
    stale_result = _run_export("--check", "--output", str(stale_output))
    assert stale_result.returncode != 0
    assert stale_output.read_text(encoding="utf-8") == "stale\n"

    missing_parent = tmp_path / "missing-parent"
    missing_output = missing_parent / "providers.json"
    missing_result = _run_export("--check", "--output", str(missing_output))
    assert missing_result.returncode != 0
    assert not missing_parent.exists()


def test_atomic_replace_failure_preserves_existing_metadata(tmp_path: Path) -> None:
    output = tmp_path / "providers.generated.json"
    output.write_text("previous-reviewed-metadata\n", encoding="utf-8")
    canary = "provider-metadata-replace-canary-58f1"
    probe = f"""
import contextlib
import importlib.util
import io
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("export_provider_metadata_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

with patch.object(module.os, "replace", side_effect=OSError({canary!r})):
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        result = module.main(["--output", {str(output)!r}])

assert result != 0
assert stdout.getvalue() == ""
error = stderr.getvalue()
assert {canary!r} not in error
assert "filesystem error_type=OSError" in error
"""
    _assert_probe_passed(_run_probe(probe))
    assert output.read_text(encoding="utf-8") == "previous-reviewed-metadata\n"
    assert not list(tmp_path.glob(".providers.generated.json.*.tmp"))


def test_timeout_is_safe_and_preserves_existing_metadata(tmp_path: Path) -> None:
    output = tmp_path / "providers.generated.json"
    output.write_text("previous-reviewed-metadata\n", encoding="utf-8")
    canary = "provider-metadata-timeout-canary-5b2e"
    probe = f"""
import contextlib
import importlib.util
import io
import subprocess

spec = importlib.util.spec_from_file_location("export_provider_metadata_probe", {str(EXPORT_SCRIPT)!r})
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
assert "isolated export timed out after 30 seconds" in error
"""
    _assert_probe_passed(_run_probe(probe))
    assert output.read_text(encoding="utf-8") == "previous-reviewed-metadata\n"


def test_parent_rejects_unstructured_child_stderr(tmp_path: Path) -> None:
    output = tmp_path / "providers.json"
    canary = "provider-metadata-child-stderr-canary-9d44"
    probe = f"""
import contextlib
import importlib.util
import io

spec = importlib.util.spec_from_file_location("export_provider_metadata_probe", {str(EXPORT_SCRIPT)!r})
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


def test_child_exception_output_has_no_exception_value() -> None:
    canary = "provider-metadata-exception-canary-c7aa"
    probe = f"""
import contextlib
import importlib.util
import io

spec = importlib.util.spec_from_file_location("export_provider_metadata_probe", {str(EXPORT_SCRIPT)!r})
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

def fail_barrier():
    raise RuntimeError({canary!r})

module._install_network_barrier = fail_barrier
stdout = io.StringIO()
stderr = io.StringIO()
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    result = module._export_in_child()

assert result != 0
assert stdout.getvalue() == ""
error = stderr.getvalue()
assert {canary!r} not in error
assert "stage=network-barrier" in error
assert "error_type=RuntimeError" in error
"""
    _assert_probe_passed(_run_probe(probe))
