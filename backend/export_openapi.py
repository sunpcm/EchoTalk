"""Export the FastAPI OpenAPI document without application dependencies.

The public command only performs argument handling and atomic file I/O. A fresh
isolated interpreter imports the real ``main.app`` after installing network and
settings isolation barriers.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import NoReturn

BACKEND_ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = BACKEND_ROOT / "openapi.json"
_INTERNAL_EXPORT_ARG = "--_isolated-export"
_EXPORT_TIMEOUT_SECONDS = 120.0
_CHILD_FAILURE_PREFIX = "OpenAPI export failed stage="
_EXPORT_PHASES = frozenset(
    {
        "app-import",
        "network-barrier",
        "schema-generation",
        "schema-serialization",
        "settings-isolation",
    }
)
_SYNTHETIC_DATABASE_URL = "postgresql+asyncpg://openapi.invalid/echotalk_openapi_export"
# Public, deterministic material for the disposable export process only.
_SYNTHETIC_KEY_VERSION = "synthetic-test-key-v1"
_SYNTHETIC_FERNET_KEY = "MDAw" * 10 + "MDA="
_NETWORK_ATTEMPTED = False
_NETWORK_AUDIT_EVENTS = frozenset(
    {
        "socket.connect",
        "socket.getaddrinfo",
        "socket.gethostbyaddr",
        "socket.gethostbyname",
        "socket.getnameinfo",
        "socket.sendto",
    }
)


class OpenApiExportError(RuntimeError):
    """Raised when an offline export invariant is violated."""


def _deny_network(*_args: object, **_kwargs: object) -> NoReturn:
    global _NETWORK_ATTEMPTED
    _NETWORK_ATTEMPTED = True
    raise OpenApiExportError("OpenAPI export attempted network access")


def _audit_network_event(event: str, _args: tuple[object, ...]) -> None:
    if event in _NETWORK_AUDIT_EVENTS:
        _deny_network()


def _install_network_barrier() -> None:
    """Block DNS and outbound socket operations before importing the app."""

    global _NETWORK_ATTEMPTED
    _NETWORK_ATTEMPTED = False
    sys.addaudithook(_audit_network_event)
    socket.getaddrinfo = _deny_network
    socket.gethostbyname = _deny_network
    socket.gethostbyname_ex = _deny_network
    socket.gethostbyaddr = _deny_network
    socket.create_connection = _deny_network
    socket.socket.connect = _deny_network
    socket.socket.connect_ex = _deny_network
    socket.socket.send = _deny_network
    socket.socket.sendall = _deny_network
    socket.socket.sendmsg = _deny_network
    socket.socket.sendto = _deny_network


def _install_settings_isolation() -> None:
    """Disable documented file settings controls before sources are constructed."""

    from pydantic_settings import BaseSettings

    original_init = BaseSettings.__init__

    def isolated_init(
        settings_instance: BaseSettings,
        **values: object,
    ) -> None:
        values["_env_file"] = None
        values["_secrets_dir"] = None
        original_init(settings_instance, **values)

    BaseSettings.__init__ = isolated_init

    def isolated_sources(
        cls: type[BaseSettings],
        settings_cls: type[BaseSettings],
        init_settings: object,
        env_settings: object,
        dotenv_settings: object,
        file_secret_settings: object,
    ) -> tuple[object, object]:
        del cls, settings_cls, dotenv_settings, file_secret_settings
        return init_settings, env_settings

    BaseSettings.settings_customise_sources = classmethod(isolated_sources)


def _synthetic_child_environment(isolation_root: Path) -> dict[str, str]:
    """Return the complete, non-secret environment for the export subprocess."""

    return {
        "ACTIVE_CREDENTIAL_KEY_VERSION": _SYNTHETIC_KEY_VERSION,
        "AUTH_MODE": "dev",
        "CALL_LEASE_MODE": "disabled",
        "CREDENTIAL_ENCRYPTION_KEYS": json.dumps(
            {_SYNTHETIC_KEY_VERSION: _SYNTHETIC_FERNET_KEY},
            separators=(",", ":"),
        ),
        "DATABASE_URL": _SYNTHETIC_DATABASE_URL,
        "DEV_AUTH_TOKEN": "openapi-export-only",
        "LANG": "C",
        "LC_ALL": "C",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "PYTHONIOENCODING": "utf-8",
        "TEMP": str(isolation_root / "tmp"),
        "TMP": str(isolation_root / "tmp"),
        "TMPDIR": str(isolation_root / "tmp"),
        "XDG_CACHE_HOME": str(isolation_root / "cache"),
        "XDG_CONFIG_HOME": str(isolation_root / "config"),
        "XDG_DATA_HOME": str(isolation_root / "data"),
    }


def render_schema(schema: dict[str, object]) -> bytes:
    """Serialize an OpenAPI document to the canonical tracked representation."""

    rendered = json.dumps(
        schema,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    return f"{rendered}\n".encode("utf-8")


def _export_schema_in_child() -> int:
    """Internal subprocess entry point; never import this path in the parent."""

    phase = "network-barrier"
    try:
        _install_network_barrier()
        phase = "settings-isolation"
        _install_settings_isolation()
        sys.path.insert(0, str(BACKEND_ROOT))

        phase = "app-import"
        from main import app

        phase = "schema-generation"
        schema = app.openapi()
        if _NETWORK_ATTEMPTED:
            raise OpenApiExportError("OpenAPI export attempted network access")
        phase = "schema-serialization"
        payload = render_schema(schema)
    except BaseException as exc:
        print(_child_failure_message(phase, exc), file=sys.stderr)
        return 1

    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()
    return 0


def _child_failure_message(phase: str, exc: BaseException) -> str:
    """Return a safe failure summary without arbitrary exception text."""

    return f"{_CHILD_FAILURE_PREFIX}{phase} error_type={type(exc).__name__}"


def _safe_child_failure_detail(stderr: bytes) -> str | None:
    """Accept only the child's bounded stage/type failure protocol."""

    detail = stderr.decode("utf-8", errors="replace").strip()
    if (
        not detail.startswith(_CHILD_FAILURE_PREFIX)
        or "\n" in detail
        or len(detail) > 256
    ):
        return None
    phase_and_type = detail.removeprefix(_CHILD_FAILURE_PREFIX).split(
        " error_type=", maxsplit=1
    )
    if len(phase_and_type) != 2:
        return None
    phase, error_type = phase_and_type
    if (
        phase not in _EXPORT_PHASES
        or not error_type.isidentifier()
        or len(error_type) > 128
    ):
        return None
    return detail


def _subprocess_export() -> bytes:
    """Run the real-app export in a clean isolated interpreter."""

    try:
        with tempfile.TemporaryDirectory(
            prefix="echotalk-openapi-export-"
        ) as temporary_root:
            isolation_root = Path(temporary_root)
            for directory in ("tmp", "cache", "config", "data"):
                (isolation_root / directory).mkdir()
            completed = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    str(Path(__file__).resolve()),
                    _INTERNAL_EXPORT_ARG,
                ],
                cwd=BACKEND_ROOT,
                env=_synthetic_child_environment(isolation_root),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=_EXPORT_TIMEOUT_SECONDS,
            )
    except subprocess.TimeoutExpired:
        raise OpenApiExportError(
            "isolated export timed out after "
            f"{_EXPORT_TIMEOUT_SECONDS:g} seconds; no output was written"
        ) from None
    if completed.returncode != 0:
        detail = _safe_child_failure_detail(completed.stderr)
        raise OpenApiExportError(
            detail or f"isolated export exited with code {completed.returncode}"
        )
    return completed.stdout


def _write_atomic(path: Path, payload: bytes) -> None:
    """Replace the target only after the isolated export completed."""

    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export EchoTalk's FastAPI OpenAPI schema offline.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the tracked schema without writing it",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="schema path (default: backend/openapi.json)",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    if args_list == [_INTERNAL_EXPORT_ARG]:
        return _export_schema_in_child()

    args = _parse_args(args_list)
    output_path = args.output.resolve()
    try:
        payload = _subprocess_export()
        if args.check:
            try:
                current = output_path.read_bytes()
            except FileNotFoundError as exc:
                raise OpenApiExportError(
                    f"tracked OpenAPI schema is missing: {output_path}"
                ) from exc
            if current != payload:
                raise OpenApiExportError(
                    "OpenAPI schema is stale; run "
                    f"`python {Path(__file__).name}` from backend/"
                )
            print(f"OpenAPI schema is current: {output_path}")
            return 0

        _write_atomic(output_path, payload)
        print(f"Wrote OpenAPI schema: {output_path}")
        return 0
    except (OSError, OpenApiExportError) as exc:
        print(f"OpenAPI schema command failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
