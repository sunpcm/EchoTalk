"""Export public Agent and analysis contract from the immutable backend catalog."""

from __future__ import annotations

import argparse
import json
import os
import re
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
    REPOSITORY_ROOT
    / "apps"
    / "vite-app"
    / "src"
    / "lib"
    / "agent-analysis.contract.generated.json"
)
_INTERNAL_EXPORT_ARG = "--_isolated-export"
_EXPORT_TIMEOUT_SECONDS = 30.0
_CHILD_FAILURE_PREFIX = "Agent analysis contract export failed stage="
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


class AgentAnalysisContractExportError(RuntimeError):
    """Raised when an offline Agent analysis contract export invariant fails."""


def _deny_network(*_args: object, **_kwargs: object) -> NoReturn:
    global _NETWORK_ATTEMPTED
    _NETWORK_ATTEMPTED = True
    raise AgentAnalysisContractExportError(
        "Agent analysis contract export attempted network access"
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


_SCHEMA_KEYWORDS = frozenset(
    {
        "type",
        "const",
        "enum",
        "properties",
        "required",
        "additionalProperties",
        "$ref",
        "anyOf",
        "oneOf",
        "title",
        "description",
        "default",
        "minLength",
    }
)
_METADATA_FIELDS = frozenset(
    {
        "schema_version",
        "topic",
        "reliable",
        "receiver_string_policy",
        "diagnostic_unknown_agent_code",
        "analysis_unknown_log_code",
        "agent_safe_messages",
        "diagnostic_agent_codes",
        "analysis_non_retryable_codes",
        "analysis_codes",
    }
)
_COMPONENT_NAMES = frozenset(
    {
        "AgentErrorReceived",
        "AgentErrorProduced",
        "KnownAgentErrorCode",
        "DiagnosticAgentErrorCode",
        "KnownAnalysisErrorCode",
        "AnalysisPublicErrorCode",
    }
)


def _require(condition: bool) -> None:
    if not condition:
        raise AgentAnalysisContractExportError(
            "unsupported or invalid contract document"
        )


def _string_list(value: object) -> set[str]:
    _require(isinstance(value, list) and all(isinstance(item, str) for item in value))
    _require(len(value) == len(set(value)))
    return set(value)


def validate_contract_document(document: object) -> None:
    """Validate schema positions, references and metadata; never access remote refs."""
    _require(isinstance(document, dict))
    _require(
        set(document)
        == {"openapi", "info", "paths", "components", "x-echotalk-contract"}
    )
    _require(document["openapi"] == "3.1.0" and document["paths"] == {})
    _require(
        isinstance(document["info"], dict) and document["info"].get("version") == "1"
    )
    components = document["components"]
    _require(isinstance(components, dict) and set(components) == {"schemas"})
    schemas = components["schemas"]
    _require(isinstance(schemas, dict) and set(schemas) == _COMPONENT_NAMES)

    def walk(schema: object) -> None:
        _require(isinstance(schema, dict) and set(schema) <= _SCHEMA_KEYWORDS)
        for key, value in schema.items():
            if key == "properties":
                _require(isinstance(value, dict))
                # Property names are data, not schema keywords.
                for child in value.values():
                    walk(child)
            elif key == "additionalProperties":
                if type(value) is not bool:
                    walk(value)
            elif key in {"anyOf", "oneOf"}:
                _require(isinstance(value, list) and len(value) > 0)
                for child in value:
                    walk(child)
            elif key == "$ref":
                prefix = "#/components/schemas/"
                _require(isinstance(value, str) and value.startswith(prefix))
                _require(value[len(prefix) :] in schemas)
            elif key in {"required", "enum"}:
                _string_list(value)
            elif key == "minLength":
                _require(type(value) is int and value >= 0)
            elif key == "type":
                _require(value in {"object", "string", "null"})
            elif key in {"const", "title", "description"}:
                _require(isinstance(value, str))
        if "required" in schema:
            _require(set(schema["required"]) <= set(schema.get("properties", {})))

    for schema in schemas.values():
        walk(schema)
    metadata = document["x-echotalk-contract"]
    _require(isinstance(metadata, dict) and set(metadata) == _METADATA_FIELDS)
    _require(
        type(metadata["schema_version"]) is int and metadata["schema_version"] == 1
    )
    _require(metadata["topic"] == "agent_error" and metadata["reliable"] is True)
    _require(metadata["receiver_string_policy"] == "ecmascript-trim-nonempty-preserve")
    _require(metadata["diagnostic_unknown_agent_code"] == "unknown")
    _require(metadata["analysis_unknown_log_code"] == "unknown_error")
    agent_codes = _string_list(schemas["KnownAgentErrorCode"].get("enum"))
    analysis_codes = _string_list(schemas["KnownAnalysisErrorCode"].get("enum"))
    messages = metadata["agent_safe_messages"]
    _require(isinstance(messages, dict) and set(messages) == agent_codes)
    _require(
        all(isinstance(value, str) and value.strip() for value in messages.values())
    )
    diagnostic = _string_list(metadata["diagnostic_agent_codes"])
    _require(diagnostic <= agent_codes)
    _require(
        diagnostic == _string_list(schemas["DiagnosticAgentErrorCode"].get("enum"))
    )
    non_retryable = _string_list(metadata["analysis_non_retryable_codes"])
    policies = metadata["analysis_codes"]
    _require(isinstance(policies, dict))
    projected = {}
    for policy in policies.values():
        _require(
            isinstance(policy, dict)
            and set(policy) == {"code", "current_producer", "manual_retryable"}
        )
        _require(isinstance(policy["code"], str) and policy["code"] not in projected)
        _require(
            type(policy["current_producer"]) is bool
            and type(policy["manual_retryable"]) is bool
        )
        projected[policy["code"]] = policy
    _require(set(projected) == analysis_codes)
    _require(
        non_retryable
        == {
            code for code, policy in projected.items() if not policy["manual_retryable"]
        }
    )
    _require(
        schemas["AnalysisPublicErrorCode"]
        == {"anyOf": [{"type": "string"}, {"type": "null"}]}
    )
    for name, extras in (("AgentErrorReceived", True), ("AgentErrorProduced", False)):
        schema = schemas[name]
        _require(
            schema.get("type") == "object"
            and schema.get("additionalProperties") is extras
        )
        _require(set(schema.get("properties", {})) == {"type", "code", "message"})
        _require(set(schema.get("required", [])) == {"type", "code", "message"})
        _require(schema["properties"]["type"].get("const") == metadata["topic"])


def build_agent_analysis_contract() -> dict[str, object]:
    from agent_analysis_contract import build_contract_document

    return build_contract_document()


def render_agent_analysis_contract(metadata: dict[str, object]) -> bytes:
    """Serialize Agent and analysis contract to canonical tracked JSON bytes."""

    validate_contract_document(metadata)
    rendered = json.dumps(
        metadata,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
        allow_nan=False,
    )

    # Match repository JSON formatting without a Node dependency in the backend
    # exporter. Only primitive string arrays are compacted; objects stay expanded.
    def compact_strings(match: re.Match[str]) -> str:
        compact = json.dumps(json.loads(match.group()), ensure_ascii=False)
        line_start = rendered.rfind("\n", 0, match.start()) + 1
        return (
            compact
            if match.start() - line_start + len(compact) <= 100
            else match.group()
        )

    rendered = re.sub(
        r'\[\n(?:\s+"(?:[^"\\]|\\.)*",?\n)+\s*\]', compact_strings, rendered
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
        metadata = build_agent_analysis_contract()
        if _NETWORK_ATTEMPTED:
            raise AgentAnalysisContractExportError(
                "Agent analysis contract export attempted network access"
            )

        phase = "serialization"
        payload = render_agent_analysis_contract(metadata)
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
            prefix="echotalk-agent-analysis-contract-export-"
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
        raise AgentAnalysisContractExportError(
            "isolated export timed out after "
            f"{_EXPORT_TIMEOUT_SECONDS:g} seconds; no output was written"
        ) from None
    if completed.returncode != 0:
        detail = _safe_child_failure_detail(completed.stderr)
        raise AgentAnalysisContractExportError(
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
        description="Export EchoTalk's public Agent and analysis contract offline."
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
            "(default: apps/vite-app/src/lib/agent-analysis.contract.generated.json)"
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
                raise AgentAnalysisContractExportError(
                    f"tracked Agent analysis contract is missing: {output_path}"
                ) from exc
            try:
                validate_contract_document(json.loads(current))
            except (ValueError, TypeError, UnicodeError) as exc:
                raise AgentAnalysisContractExportError(
                    "invalid tracked contract"
                ) from exc
            if current != payload:
                raise AgentAnalysisContractExportError(
                    "Agent analysis contract is stale; run "
                    f"`python {Path(__file__).name}` from backend/"
                )
            print(f"Agent analysis contract is current: {output_path}")
            return 0

        _write_atomic(output_path, payload)
        print(f"Wrote Agent analysis contract: {output_path}")
        return 0
    except AgentAnalysisContractExportError as exc:
        print(f"Agent analysis contract command failed: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(
            "Agent analysis contract command failed: "
            f"filesystem error_type={type(exc).__name__}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
