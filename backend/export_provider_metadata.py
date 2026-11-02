"""Export public Provider display metadata from the immutable backend catalog."""

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
REPOSITORY_ROOT = BACKEND_ROOT.parent
DEFAULT_OUTPUT = (
    REPOSITORY_ROOT / "apps" / "vite-app" / "src" / "lib" / "providers.generated.json"
)
_INTERNAL_EXPORT_ARG = "--_isolated-export"
_EXPORT_TIMEOUT_SECONDS = 30.0
_CHILD_FAILURE_PREFIX = "Provider metadata export failed stage="
_EXPORT_PHASES = frozenset(
    {
        "network-barrier",
        "projection",
        "serialization",
    }
)
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


class ProviderMetadataExportError(RuntimeError):
    """Raised when an offline Provider metadata export invariant fails."""


def _deny_network(*_args: object, **_kwargs: object) -> NoReturn:
    global _NETWORK_ATTEMPTED
    _NETWORK_ATTEMPTED = True
    raise ProviderMetadataExportError(
        "Provider metadata export attempted network access"
    )


def _audit_network_event(event: str, _args: tuple[object, ...]) -> None:
    if event in _NETWORK_AUDIT_EVENTS:
        _deny_network()


def _install_network_barrier() -> None:
    """Block DNS and outbound socket operations before importing the catalog."""

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


def build_provider_metadata() -> dict[str, object]:
    """Build a fresh public-only projection from the backend Provider catalogs."""

    from provider_catalog import PROVIDER_CATALOGS

    providers: list[dict[str, str]] = []
    defaults: dict[str, str] = {}
    seen_ids: set[str] = set()

    for role, catalog in PROVIDER_CATALOGS.items():
        role_defaults: list[str] = []
        for catalog_key, metadata in catalog.items():
            if metadata.role != role:
                raise ProviderMetadataExportError(
                    f"Provider {catalog_key!r} has a mismatched role"
                )
            if metadata.id != catalog_key:
                raise ProviderMetadataExportError(
                    f"Provider catalog key {catalog_key!r} does not match its id"
                )
            if metadata.id in seen_ids:
                raise ProviderMetadataExportError(
                    f"Provider id {metadata.id!r} is duplicated across roles"
                )
            if not metadata.label or metadata.label != metadata.label.strip():
                raise ProviderMetadataExportError(
                    f"Provider {metadata.id!r} has an empty or untrimmed label"
                )

            seen_ids.add(metadata.id)
            providers.append(
                {
                    "role": metadata.role,
                    "id": metadata.id,
                    "label": metadata.label,
                }
            )
            if metadata.is_default:
                role_defaults.append(metadata.id)

        if len(role_defaults) != 1:
            raise ProviderMetadataExportError(
                f"Provider role {role!r} must have exactly one default"
            )
        defaults[role] = role_defaults[0]

    return {
        "providers": providers,
        "defaults": defaults,
    }


def render_provider_metadata(metadata: dict[str, object]) -> bytes:
    """Serialize Provider display metadata to canonical tracked JSON bytes."""

    rendered = json.dumps(
        metadata,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    return f"{rendered}\n".encode("utf-8")


def _synthetic_child_environment(isolation_root: Path) -> dict[str, str]:
    """Return the complete non-secret environment for the export subprocess."""

    return {
        "LANG": "C",
        "LC_ALL": "C",
        "PYTHONHASHSEED": "0",
        "TEMP": str(isolation_root / "tmp"),
        "TMP": str(isolation_root / "tmp"),
        "TMPDIR": str(isolation_root / "tmp"),
    }


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


def _export_in_child() -> int:
    """Internal subprocess entry point; never import the catalog in the parent."""

    phase = "network-barrier"
    try:
        _install_network_barrier()
        sys.path.insert(0, str(BACKEND_ROOT))

        phase = "projection"
        metadata = build_provider_metadata()
        if _NETWORK_ATTEMPTED:
            raise ProviderMetadataExportError(
                "Provider metadata export attempted network access"
            )

        phase = "serialization"
        payload = render_provider_metadata(metadata)
    except BaseException as exc:
        print(_child_failure_message(phase, exc), file=sys.stderr)
        return 1

    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()
    return 0


def _subprocess_export() -> bytes:
    """Run the catalog projection in a clean isolated interpreter."""

    try:
        with tempfile.TemporaryDirectory(
            prefix="echotalk-provider-metadata-export-"
        ) as temporary_root:
            isolation_root = Path(temporary_root)
            (isolation_root / "tmp").mkdir()
            completed = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    "-B",
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
        raise ProviderMetadataExportError(
            "isolated export timed out after "
            f"{_EXPORT_TIMEOUT_SECONDS:g} seconds; no output was written"
        ) from None
    if completed.returncode != 0:
        detail = _safe_child_failure_detail(completed.stderr)
        raise ProviderMetadataExportError(
            detail or f"isolated export exited with code {completed.returncode}"
        )
    return completed.stdout


def _write_atomic(path: Path, payload: bytes) -> None:
    """Replace the target only after a complete payload is durable."""

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
        description="Export EchoTalk's public Provider display metadata offline."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the tracked generated JSON without writing it",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=(
            "generated metadata path "
            "(default: apps/vite-app/src/lib/providers.generated.json)"
        ),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    if args_list == [_INTERNAL_EXPORT_ARG]:
        return _export_in_child()

    args = _parse_args(args_list)
    output_path = args.output.resolve()
    try:
        payload = _subprocess_export()
        if args.check:
            try:
                current = output_path.read_bytes()
            except FileNotFoundError as exc:
                raise ProviderMetadataExportError(
                    f"tracked Provider metadata is missing: {output_path}"
                ) from exc
            if current != payload:
                raise ProviderMetadataExportError(
                    "Provider metadata is stale; run "
                    f"`python {Path(__file__).name}` from backend/"
                )
            print(f"Provider metadata is current: {output_path}")
            return 0

        _write_atomic(output_path, payload)
        print(f"Wrote Provider metadata: {output_path}")
        return 0
    except ProviderMetadataExportError as exc:
        print(f"Provider metadata command failed: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(
            "Provider metadata command failed: "
            f"filesystem error_type={type(exc).__name__}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
