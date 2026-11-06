"""Measure frozen role images. Main agent only; never reads an env file."""

import argparse
import hashlib
import json
import re
import signal
from pathlib import Path

from runtime_support import (
    IMAGE_ID,
    Commands,
    Refused,
    check_snapshot,
    label_args,
    labels,
    refuse_conflicts,
    remove_container,
    require,
    sha256,
    write_json,
)

DIRECTORIES = """import json, os, subprocess
paths = ['/root/.cache', '/opt/venv', '/usr', '/app']
result = {}
for path in paths:
    if os.path.exists(path):
        p = subprocess.run(['du', '-x', '-k', '-s', path], capture_output=True,
                           text=True, timeout=60, check=True)
        result[path] = int(p.stdout.split()[0])
cache = subprocess.run(['du', '-x', '-k', '--max-depth=2', '/root/.cache'],
                       capture_output=True, text=True, timeout=60)
packages = subprocess.run(['dpkg-query', '-W', '-f=${Installed-Size} ${Package}\\n'],
                          capture_output=True, text=True, timeout=30, check=True)
result['cache_detail'] = cache.stdout.splitlines()
result['largest_system_packages_kib'] = sorted(
    packages.stdout.splitlines(), key=lambda x: int(x.split()[0]), reverse=True)[:40]
print(json.dumps(result))
"""

NATIVE = """import glob, json, os, subprocess
files = ['/usr/local/bin/python3.12']
for package in ['asyncpg', 'cryptography', 'uvloop', 'livekit', 'av',
                'onnxruntime', 'numpy']:
    files += glob.glob('/opt/venv/lib/python3.12/site-packages/' + package +
                       '/**/*.so*', recursive=True)
results = []
for path in sorted(set(files)):
    if os.path.isfile(path):
        p = subprocess.run(['ldd', path], capture_output=True, text=True, timeout=10)
        results.append({'path': path, 'exit': p.returncode,
                        'output': p.stdout + p.stderr,
                        'missing': 'not found' in p.stdout + p.stderr})
ffmpeg = subprocess.run(['ffmpeg', '-version'], capture_output=True,
                        text=True, timeout=10, check=True)
print(json.dumps({'ldd': results, 'ffmpeg': ffmpeg.stdout.splitlines()[0]}))
"""

API_IMPORT = """import main, workers.analysis_worker, services.analysis_jobs
import asyncpg, cryptography, uvloop
print('ROLE_IMPORT_OK')
"""
AGENT_IMPORT = """import livekit.api, livekit.agents, livekit.rtc
from livekit.plugins import cartesia, deepgram, openai, silero
import livekit_agent.__main__, livekit_agent.agent, livekit_agent.plugin_factory
print('ROLE_IMPORT_OK')
"""


def pin_dockerfile(text, python_base, uv_base):
    for ref in (python_base, uv_base):
        require(
            re.fullmatch(r"[a-zA-Z0-9./:_-]+@sha256:[0-9a-f]{64}", ref),
            "base_requires_digest",
        )
    require("FROM python:3.12-slim" in text, "unexpected_python_base")
    require("ghcr.io/astral-sh/uv:0.9.18" in text, "unexpected_uv_base")
    return text.replace("python:3.12-slim", python_base).replace(
        "ghcr.io/astral-sh/uv:0.9.18", uv_base
    )


def probe(commands, image, name, expected, code, timeout):
    refuse_conflicts(commands, [name])
    identity = None
    write_json(
        commands.report / f"{name}-intent.json",
        {"name": name, "image": image, "labels": expected},
    )
    try:
        identity = (
            commands.call(
                "create",
                "--name",
                name,
                "--pull=never",
                "--network",
                "none",
                *label_args(expected),
                "--entrypoint",
                "python",
                image,
                "-B",
                "-c",
                code,
            )
            .decode()
            .strip()
        )
        write_json(
            commands.report / f"{name}-resource.json",
            {"id": identity, "image": image, "labels": expected},
        )
        output = commands.call("start", "--attach", identity, timeout=timeout)
        info = commands.inspect("container", identity)
        require(info["State"]["ExitCode"] == 0, "probe_exit_nonzero")
        return output.decode(), commands.events[-2]["elapsed_ms"], identity
    finally:
        handlers = {
            signum: signal.signal(signum, signal.SIG_IGN)
            for signum in (signal.SIGTERM, signal.SIGINT)
        }
        try:
            if identity is None:
                # A killed CLI can have already submitted docker create. Resolve
                # only this recorded name, then verify ID + labels + image.
                rows = commands.call(
                    "container", "ls", "--all", "--no-trunc", "--format", "{{json .}}"
                )
                matches = [
                    json.loads(row)
                    for row in rows.decode().splitlines()
                    if json.loads(row)["Names"] == name
                ]
                if matches:
                    identity = matches[0]["ID"]
                    write_json(
                        commands.report / f"{name}-recovered-id.json", {"id": identity}
                    )
            if identity is not None:
                remove_container(commands, identity, expected, image)
                write_json(
                    commands.report / f"{name}-cleanup.json",
                    {"id": identity, "removed": True},
                )
        finally:
            for signum, handler in handlers.items():
                signal.signal(signum, handler)


def measure(args):
    args.report.mkdir(parents=True, exist_ok=False)
    commands = Commands(args.report, args.docker_context)
    receipt = {"status": "started", "images": {}, "run_id": args.run_id}
    original_handlers = {}

    def interrupted(_signum, _frame):
        raise Refused("measurement_interrupted")

    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            original_handlers[signum] = signal.signal(signum, interrupted)
        files, source = check_snapshot(args.snapshot, args.inputs)
        receipt.update(
            source_files=files,
            source_sha256=source,
            inputs_sha256=sha256(args.inputs),
            platform=args.platform,
            python_base=args.python_base,
            uv_base=args.uv_base,
            cache_definition="build cache reused; no page-cache eviction; fresh containers; first sample separate",
            import_timing="host supervised docker start --attach through verified exit; excludes create; includes CLI/container launch/import and process-inventory overhead",
        )
        receipt["docker_version"] = json.loads(
            commands.call("version", "--format", "{{json .Server}}")
        )
        images = {"api": args.api_image, "agent": args.agent_image}
        if args.build:
            dockerfile = pin_dockerfile(
                (args.snapshot / "Dockerfile").read_text(),
                args.python_base,
                args.uv_base,
            )
            receipt["effective_dockerfile_sha256"] = hashlib.sha256(
                dockerfile.encode()
            ).hexdigest()
            for role in images:
                iidfile = args.report / f"{role}.iid"
                code, stdout, stderr = commands.run(
                    commands.docker
                    + [
                        "build",
                        "--platform",
                        args.platform,
                        "--progress=plain",
                        "--build-arg",
                        f"BACKEND_ROLE={role}",
                        *label_args(labels(args.run_id, role, source)),
                        "--iidfile",
                        str(iidfile),
                        "--file",
                        "-",
                        str(args.snapshot),
                    ],
                    timeout=args.build_timeout,
                    stdin=dockerfile.encode(),
                    check=False,
                )
                # Build input is the checked public snapshot; no env/secret args exist.
                (args.report / f"{role}-build.log").write_bytes(stdout + stderr)
                require(code == 0, "role_build_failed")
                images[role] = iidfile.read_text().strip()
        for role, image in images.items():
            require(image and IMAGE_ID.fullmatch(image), "image_requires_immutable_id")
            info = commands.inspect("image", image)
            require(info["Id"] == image, "image_id_mismatch")
            require(
                f"{info['Os']}/{info['Architecture']}" == args.platform,
                "image_platform_mismatch",
            )
            image_labels = info.get("Config", {}).get("Labels", {}) or {}
            require(
                image_labels.get("codex.source-sha256") == source,
                "image_source_mismatch",
            )
            require(image_labels.get("codex.role") == role, "image_role_mismatch")
            result = {
                "id": image,
                "bytes": info["Size"],
                "architecture": info["Architecture"],
                "os": info["Os"],
                "layers": info["RootFS"]["Layers"],
                "repo_digests": info.get("RepoDigests", []),
            }
            receipt["images"][role] = result
            history = commands.call(
                "history",
                "--no-trunc",
                "--human=false",
                "--format",
                "{{json .}}",
                image,
            )
            result["history"] = [
                json.loads(row) for row in history.decode().splitlines()
            ]
            expected = labels(args.run_id, f"measure-{role}", source)
            prefix = f"echotalk-overnight-{args.run_id}-{role}"
            output, _, _ = probe(
                commands, image, prefix + "-dirs", expected, DIRECTORIES, 180
            )
            result["directories_kib"] = json.loads(output)
            output, _, _ = probe(
                commands, image, prefix + "-native", expected, NATIVE, 180
            )
            result["native"] = json.loads(output)
            require(
                not any(row["missing"] for row in result["native"]["ldd"]),
                "native_library_missing",
            )
            result["import_samples"] = []
            for index in range(3):
                output, elapsed, identity = probe(
                    commands,
                    image,
                    prefix + f"-import-{index}",
                    expected,
                    API_IMPORT if role == "api" else AGENT_IMPORT,
                    120,
                )
                require(output.strip() == "ROLE_IMPORT_OK", "import_marker_missing")
                result["import_samples"].append(
                    {
                        "index": index,
                        "container_id": identity,
                        "elapsed_ms": elapsed,
                        "exit": 0,
                    }
                )
        receipt["status"] = "measured"
    except BaseException as exc:
        receipt["status"] = "failed"
        receipt["error"] = str(exc) if isinstance(exc, Refused) else type(exc).__name__
        raise
    finally:
        try:
            write_json(args.report / "receipt.json", receipt)
        finally:
            for signum, handler in original_handlers.items():
                signal.signal(signum, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument(
        "--platform", choices=["linux/arm64", "linux/amd64"], required=True
    )
    parser.add_argument("--python-base", required=True)
    parser.add_argument("--uv-base", required=True)
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--api-image")
    parser.add_argument("--agent-image")
    parser.add_argument("--docker-context")
    parser.add_argument("--build-timeout", type=int, default=1800)
    args = parser.parse_args()
    try:
        measure(args)
    except Exception:
        parser.exit(1, "measurement failed; inspect receipt and command records\n")


if __name__ == "__main__":
    main()
