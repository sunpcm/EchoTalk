"""Small stdlib helpers shared by the isolated, main-controlled runners."""

import hashlib
import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path

SCOPE = "echotalk-overnight-20261103"
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
RESOURCE_ID = re.compile(r"[0-9a-f]{64}\Z")
RUN_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,39}\Z")


class Refused(RuntimeError):
    """Safe, constant diagnostic; never include process output or env values."""


def require(condition, code):
    if not condition:
        raise Refused(code)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def write_json(path, value):
    with Path(path).open("xb") as stream:
        stream.write(json_bytes(value))


def snapshot_files(snapshot):
    root = Path(snapshot).resolve(strict=True)
    files = {}
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), "snapshot_symlink")
        relative = path.relative_to(root)
        require(
            not any(
                part.startswith(".env")
                or part in {".git", ".review", ".venv", "__pycache__"}
                for part in relative.parts
            ),
            "snapshot_forbidden_path",
        )
        if path.is_file():
            files[relative.as_posix()] = sha256(path)
    return files


def check_snapshot(snapshot, inputs):
    approved = json.loads(Path(inputs).read_text())
    files = snapshot_files(snapshot)
    require(files == approved["files"], "snapshot_fingerprint_mismatch")
    for filename in ("Dockerfile", "uv.lock", "pyproject.toml", ".python-version"):
        require(filename in files, "snapshot_missing_required_input")
    return files, hashlib.sha256(json_bytes(files)).hexdigest()


class Commands:
    """Keep CLIs in the outer controller's group and reap on every exit path."""

    def __init__(self, report, docker_context=None):
        self.report = Path(report)
        self.events = []
        self.docker = ["docker"]
        if docker_context:
            self.docker += ["--context", docker_context]

    def run(self, argv, *, timeout=60, stdin=None, check=True):
        env = {
            key: os.environ[key]
            for key in ("PATH", "HOME", "TMPDIR", "DOCKER_CONFIG")
            if key in os.environ
        }
        # No inherited dotenv, Provider keys, DATABASE_URL, proxy, or shell.
        require(timeout > 0, "invalid_command_timeout")
        started = time.monotonic()
        process = None
        timed_out = False
        interrupted_signal = None
        failure = None
        stdout, stderr = b"", b""
        tracked = {}
        original_handlers = {}
        group = os.getpgrp()
        initial_group = set()
        remaining, unexpected = [], []
        supervision_error = None

        def interrupted(signum, _frame):
            nonlocal interrupted_signal
            interrupted_signal = signum
            raise Refused("command_interrupted")

        def snapshot():
            # Metadata only. No argv/env or user data is collected.
            listing = subprocess.Popen(
                ["ps", "-axo", "pid=,ppid=,pgid=,lstart="],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                start_new_session=False,
            )
            try:
                output, _ = listing.communicate(timeout=2)
            except BaseException:
                listing.kill()
                listing.communicate(timeout=2)
                raise
            require(listing.returncode == 0, "process_inventory_failed")
            rows = {}
            for line in output.decode().splitlines():
                fields = line.split(maxsplit=3)
                if len(fields) == 4:
                    pid, parent, pgid = map(int, fields[:3])
                    if pid != listing.pid:
                        rows[pid] = (parent, pgid, fields[3])
            return rows

        def observe(rows):
            if process is None:
                return
            parents = {
                pid
                for pid, identity in tracked.items()
                if pid in rows and rows[pid][1:] == identity
            }
            if process.poll() is None:
                parents.add(process.pid)
            while True:
                children = {
                    pid
                    for pid, row in rows.items()
                    if pid == process.pid or row[0] in parents
                }
                if children <= parents:
                    break
                parents.update(children)
            for pid in parents:
                if pid in rows:
                    # Start time + group prevents signalling a reused PID.
                    tracked.setdefault(pid, rows[pid][1:])

        def live_tracked(rows):
            return [
                pid
                for pid, identity in tracked.items()
                if pid in rows and rows[pid][1:] == identity
            ]

        try:
            for signum in (signal.SIGTERM, signal.SIGINT):
                original_handlers[signum] = signal.signal(signum, interrupted)
            initial = snapshot()
            initial_group = {pid for pid, row in initial.items() if row[1] == group}
            process = subprocess.Popen(
                argv,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                start_new_session=False,
            )
            # An outer killpg (including SIGKILL) now includes this CLI and its
            # normally inherited children. Never create a detached session.
            observe(snapshot())
            first_input = stdin
            while True:
                remaining_seconds = timeout - (time.monotonic() - started)
                if remaining_seconds <= 0:
                    timed_out = True
                    raise Refused("command_timeout")
                try:
                    stdout, stderr = process.communicate(
                        first_input, timeout=min(0.2, remaining_seconds)
                    )
                    break
                except subprocess.TimeoutExpired:
                    first_input = None
                    observe(snapshot())
        except BaseException as exc:
            failure = exc
        finally:
            # A second TERM/INT must not interrupt the bounded reap sequence.
            for signum in original_handlers:
                signal.signal(signum, signal.SIG_IGN)
            try:
                if process is not None:
                    rows = snapshot()
                    observe(rows)
                    live = live_tracked(rows)
                    if process.poll() is None and process.pid not in live:
                        process.terminate()
                    for pid in live:
                        try:
                            os.kill(pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                    try:
                        stdout, stderr = process.communicate(timeout=1)
                    except subprocess.TimeoutExpired:
                        pass
                    rows = snapshot()
                    observe(rows)
                    for pid in live_tracked(rows):
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    if process.poll() is None:
                        process.kill()
                    stdout, stderr = process.communicate(timeout=2)
                    deadline = time.monotonic() + 2
                    while True:
                        rows = snapshot()
                        remaining = live_tracked(rows)
                        unexpected = sorted(
                            pid
                            for pid, row in rows.items()
                            if row[1] == group
                            and pid not in initial_group
                            and pid not in tracked
                        )
                        if not remaining or time.monotonic() >= deadline:
                            break
                        time.sleep(0.02)
            except BaseException as exc:
                supervision_error = type(exc).__name__
                if process is not None and process.poll() is None:
                    process.kill()
                    try:
                        stdout, stderr = process.communicate(timeout=2)
                    except BaseException:
                        pass
            finally:
                for signum, handler in original_handlers.items():
                    signal.signal(signum, handler)
                event = {
                    "argv": argv,
                    "process_exit_code": process.returncode if process else None,
                    "timed_out": timed_out,
                    "interrupted_signal": interrupted_signal,
                    "process_group_id": group,
                    "inherits_outer_process_group": True,
                    "tracked_process_count": len(tracked),
                    "observed_child_process_groups": sorted(
                        {row[0] for row in tracked.values()}
                    ),
                    "remaining_tracked_pids": remaining,
                    "unexpected_group_pids": unexpected,
                    "supervision_error": supervision_error,
                    "command_tree_cleared": process is not None
                    and process.returncode is not None
                    and not remaining
                    and not unexpected
                    and supervision_error is None,
                    "elapsed_ms": round((time.monotonic() - started) * 1000, 3),
                }
                self.events.append(event)
                write_json(self.report / f"command-{len(self.events):04d}.json", event)
        if failure is not None:
            raise failure
        require(self.events[-1]["command_tree_cleared"], "command_tree_not_cleared")
        if timed_out:
            raise Refused("command_timeout")
        if check:
            require(process.returncode == 0, "command_failed")
        return process.returncode, stdout, stderr

    def call(self, *args, **kwargs):
        return self.run(self.docker + list(args), **kwargs)[1]

    def inspect(self, kind, identity):
        return json.loads(self.call(kind, "inspect", identity))[0]


def labels(run_id, role, source):
    require(RUN_ID.fullmatch(run_id), "invalid_run_id")
    result = {
        "codex.scope": SCOPE,
        "codex.run": run_id,
        "codex.role": role,
        "codex.source-sha256": source,
    }
    return result


def label_args(expected):
    return [
        arg for key, value in expected.items() for arg in ("--label", f"{key}={value}")
    ]


def assert_owned(info, identity, expected, image=None):
    actual = info.get("Config", {}).get("Labels", info.get("Labels", {})) or {}
    require(info.get("Id") == identity, "resource_id_mismatch")
    require(
        all(actual.get(k) == v for k, v in expected.items()), "resource_label_mismatch"
    )
    if image:
        require(info.get("Image") == image, "container_image_mismatch")


def remove_container(commands, identity, expected, image):
    require(RESOURCE_ID.fullmatch(identity), "invalid_container_id")
    assert_owned(commands.inspect("container", identity), identity, expected, image)
    commands.call("container", "rm", "--force", "--volumes", identity)


def refuse_conflicts(commands, names, network=None):
    rows = commands.call("container", "ls", "--all", "--format", "{{.Names}}")
    require(
        not set(rows.decode().splitlines()).intersection(names),
        "container_name_conflict",
    )
    if network:
        rows = commands.call("network", "ls", "--format", "{{.Name}}")
        require(network not in rows.decode().splitlines(), "network_name_conflict")
