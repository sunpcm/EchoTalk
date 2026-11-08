"""Independent offline runner tests; no Docker, database, or Provider required."""

import base64
import json
import os
import signal
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import measure
from host_gateway import FixedUpstreamRelay
from runtime import (
    DATABASE,
    LEGACY_SCOPE,
    PG_NAME,
    USER_OBJECT_COUNT_SQL,
    Runtime,
    read_protected_env,
    validate_approval,
    validate_empty,
    validate_envs,
    validate_products,
)
from runtime_support import (
    Commands,
    Refused,
    check_snapshot,
    json_bytes,
    labels,
    refuse_conflicts,
    remove_container,
    sha256,
)

IMAGE = "sha256:" + "a" * 64
CONTAINER = "b" * 64


def empty_identity():
    return {
        "database": DATABASE,
        "user": DATABASE,
        "version": "150019",
        "database_oid": 16384,
        "system_identifier": "synthetic-only",
        "relations": 0,
        "types": 0,
        "routines": 0,
        "extra_schemas": 0,
    }


def env_fixture():
    password = "test-only-pg-credential-never-connected"
    pg = {
        "POSTGRES_USER": DATABASE,
        "POSTGRES_DB": DATABASE,
        "POSTGRES_PASSWORD": password,
    }
    app = {
        "DATABASE_URL": f"postgresql+asyncpg://{DATABASE}:{password}@{PG_NAME}:5432/{DATABASE}",
        "AUTH_MODE": "dev",
        "DEV_AUTH_TOKEN": "test-only-token-never-used-for-a-service",
        "CALL_LEASE_MODE": "disabled",
        "ANALYSIS_WORKER_POLL_SECONDS": "0.2",
        "CREDENTIAL_ENCRYPTION_KEYS": json.dumps(
            {"runtime-test": base64.urlsafe_b64encode(bytes(32)).decode()}
        ),
        "ACTIVE_CREDENTIAL_KEY_VERSION": "runtime-test",
    }
    for key in ("DB", "LLM", "TTS", "STT", "LIVEKIT", "ELSA"):
        app[f"USE_MOCK_{key}"] = "false"
    return pg, app


class BoundaryTests(unittest.TestCase):
    def runtime_fixture(self, transport="host-gateway"):
        runner = Runtime.__new__(Runtime)
        runner.database = DATABASE
        runner.scope = "echotalk-grammar-http-20261104"
        runner.run_id = "r0"
        runner.source = "c" * 64
        runner.manifest = {"http_transport": transport, "http_port": 18800}
        runner.network_name = f"{runner.scope}-runtime-r0-internal"
        runner.gateway_network_name = f"{runner.scope}-runtime-r0-gateway"
        runner.gateway_network_id = "e" * 64
        runner.upstream = "172.20.0.2:8000"
        runner.commands = Mock()
        runner.report = Path(tempfile.gettempdir())
        return runner

    def container_fixture(self, runner, role):
        networks = {runner.network_name: {"NetworkID": "f" * 64}}
        if role == "host-gateway":
            networks[runner.gateway_network_name] = {
                "NetworkID": runner.gateway_network_id
            }
        published = (
            runner.loopback_binding
            if role == "host-gateway" or (role == "api" and not runner.host_gateway)
            else None
        )
        return {
            "Id": CONTAINER,
            "Image": IMAGE,
            "Config": {
                "Labels": runner.expected(role),
                "Env": [f"FIXED_UPSTREAM={runner.upstream}"]
                if role == "host-gateway"
                else [],
            },
            "NetworkSettings": {"Networks": networks},
            "HostConfig": {
                "RestartPolicy": {"Name": "no"},
                "PortBindings": published,
                "Sysctls": {"net.ipv4.ip_forward": "0"}
                if role == "host-gateway"
                else {},
            },
        }

    def test_gateway_topology_allows_only_gateway_loopback_and_fixed_upstream(self):
        runner = self.runtime_fixture()
        for role in ("postgres", "api", "host-gateway"):
            with self.subTest(role=role):
                runner.commands.inspect.return_value = self.container_fixture(
                    runner, role
                )
                runner.check_container(CONTAINER, role, IMAGE, "f" * 64)
        for role in ("postgres", "api"):
            with self.subTest(role=role):
                changed = self.container_fixture(runner, role)
                changed["HostConfig"]["PortBindings"] = runner.loopback_binding
                runner.commands.inspect.return_value = changed
                with self.assertRaisesRegex(
                    Refused, "application_port_boundary|postgres_port_published"
                ):
                    runner.check_container(CONTAINER, role, IMAGE, "f" * 64)

    def test_gateway_rejects_wrong_network_upstream_and_inherited_credentials(self):
        runner = self.runtime_fixture()
        good = self.container_fixture(runner, "host-gateway")
        mutations = []
        changed = self.container_fixture(runner, "host-gateway")
        changed["NetworkSettings"]["Networks"][runner.gateway_network_name][
            "NetworkID"
        ] = "d" * 64
        mutations.append(("gateway_network_id_mismatch", changed))
        changed = self.container_fixture(runner, "host-gateway")
        changed["HostConfig"]["Sysctls"]["net.ipv4.ip_forward"] = "1"
        mutations.append(("gateway_ip_forward_enabled", changed))
        changed = self.container_fixture(runner, "host-gateway")
        changed["Config"]["Env"] = ["FIXED_UPSTREAM=8.8.8.8:8000"]
        mutations.append(("gateway_env_boundary", changed))
        changed = self.container_fixture(runner, "host-gateway")
        changed["Config"]["Env"] += ["DATABASE_URL=do-not-leak"]
        mutations.append(("gateway_inherited_credentials", changed))
        for expected, changed in mutations:
            with self.subTest(expected=expected):
                runner.commands.inspect.return_value = changed
                with self.assertRaisesRegex(Refused, expected) as error:
                    runner.check_container(CONTAINER, "host-gateway", IMAGE, "f" * 64)
                self.assertNotIn("do-not-leak", str(error.exception))
        self.assertTrue(good["HostConfig"]["PortBindings"])

    def test_container_http_keeps_legacy_api_publication(self):
        runner = self.runtime_fixture("container-http")
        runner.commands.inspect.return_value = self.container_fixture(runner, "api")
        runner.check_container(CONTAINER, "api", IMAGE, "f" * 64)

    def test_new_scope_derives_names_and_legacy_names_remain_stable(self):
        runner = self.runtime_fixture()
        self.assertEqual(runner.api_name(), "echotalk-grammar-http-20261104-api-r0")
        self.assertEqual(
            runner.gateway_name(), "echotalk-grammar-http-20261104-host-gateway-r0"
        )
        runner.scope = LEGACY_SCOPE
        self.assertEqual(runner.api_name(), "echotalk-overnight-20261103-api-r0")

    def test_scope_labels_cannot_cross_cleanup_boundary(self):
        with self.assertRaisesRegex(Refused, "invalid_scope"):
            labels("r0", "api", "c" * 64, "../other")

    def test_partial_failure_stops_only_owned_gateway(self):
        with tempfile.TemporaryDirectory() as temp:
            runner = self.runtime_fixture()
            runner.resources = []
            runner.intents = [
                {
                    "kind": "container",
                    "name": "foreign-name",
                    "role": "host-gateway",
                    "image": IMAGE,
                }
            ]
            runner.report = Path(temp)
            runner.commands.call.return_value = (
                b'{"ID":"%s","Names":"foreign-name"}\n' % CONTAINER.encode()
            )
            foreign = self.container_fixture(runner, "host-gateway")
            foreign["Config"]["Labels"]["codex.scope"] = "foreign"
            foreign["State"] = {"Running": True, "ExitCode": 0}
            runner.commands.inspect.return_value = foreign
            runner.stop_owned_on_failure()
            self.assertFalse(
                any(
                    event.args and event.args[0] == "stop"
                    for event in runner.commands.call.call_args_list
                )
            )
            receipt = json.loads((Path(temp) / "failure-processes.json").read_text())
            self.assertEqual(
                receipt["owned_processes"][0]["cleanup_error"],
                "resource_label_mismatch",
            )

    def test_stop_requires_running_then_stopped_with_zero_exit_for_every_role(self):
        roles = (
            "worker-missing",
            "worker-demo",
            "worker-restarted",
            "api",
            "host-gateway",
        )
        for role in roles:
            for before, after, code, refusal in (
                (True, False, 0, None),
                (True, False, 1, "long_process_exit_nonzero"),
                (True, False, 137, "long_process_exit_nonzero"),
                (True, False, None, "long_process_exit_nonzero"),
                (False, False, 0, "long_process_exited_early"),
                (False, False, 1, "long_process_exited_early"),
                (True, True, 0, "process_did_not_stop"),
            ):
                with self.subTest(role=role, before=before, after=after, code=code):
                    runner = self.runtime_fixture()
                    runner.manifest["api_image"] = IMAGE
                    info = self.container_fixture(runner, role)
                    runner.commands.inspect.side_effect = [
                        {**info, "State": {"Running": before, "ExitCode": 0}},
                        {**info, "State": {"Running": after, "ExitCode": code}},
                    ]
                    if refusal:
                        with self.assertRaisesRegex(Refused, refusal):
                            runner.stop(CONTAINER, role, "f" * 64)
                    else:
                        self.assertEqual(
                            runner.stop(CONTAINER, role, "f" * 64),
                            {
                                "id": CONTAINER,
                                "role": role,
                                "running": False,
                                "exit": 0,
                            },
                        )
                    if before:
                        runner.commands.call.assert_called_once_with(
                            "stop", "--time", "5", CONTAINER, timeout=15
                        )
                    else:
                        runner.commands.call.assert_not_called()

    def exercise_fixture(self, root, failure_role=None, failure_state=None):
        # Replace service I/O only: exercise, stop, approval and product guards run.
        runner = self.runtime_fixture()
        runner.report = root
        runner.manifest.update(
            api_image=IMAGE,
            postgres_image=IMAGE,
            migration_head="c06_transcript_events",
        )
        runner.manifest_path = root / "manifest.json"
        runner.manifest_path.write_text(json.dumps(runner.manifest))
        runner.files = {"alembic.ini": "e" * 64}
        provision = root / "provision.json"
        provision.write_text(
            json.dumps(
                {
                    "manifest_sha256": sha256(runner.manifest_path),
                    "network_id": "f" * 64,
                    "gateway_network_id": runner.gateway_network_id,
                    "postgres_id": CONTAINER,
                    "database_identity": empty_identity(),
                }
            )
        )
        approval = root / "approval.json"
        approval.write_text(
            json.dumps(
                {
                    "approved_for_execution": True,
                    "manifest_sha256": sha256(runner.manifest_path),
                    "provision_sha256": sha256(provision),
                    "reviewed_migration_files": runner.files,
                    "reviewed_empty_database": True,
                    "evidence_basis": "offline synthetic exercise fixture; no services",
                }
            )
        )
        completed = {
            "jobs": [{"session_id": "missing"}, {"session_id": "stale"}],
            "assessments": [{"is_synthetic": True, "source": "demo_mock"}],
            "grammar": [{"is_synthetic": True}],
            "knowledge_count": 0,
        }
        unsupported = {
            "jobs": [],
            "assessments": [],
            "grammar": [],
            "knowledge_count": 0,
        }
        stages = {
            "verify-source": {},
            "frozen-export": {},
            "migrate": {},
            "seed-missing": {"session_id": "missing"},
            "seed-stale": {"session_id": "stale"},
            "repeat-analysis": {},
            "state": completed,
        }
        stopped = set()

        def inspect(identity, role, image, network):
            state = {"Running": role not in stopped, "ExitCode": 0}
            if role == failure_role:
                if failure_state == "early":
                    state["Running"] = False
                elif role in stopped:
                    if failure_state == "running":
                        state["Running"] = True
                    else:
                        state["ExitCode"] = failure_state
            return {"State": state}

        def command(*args, **kwargs):
            if args[0] == "stop":
                stopped.add(args[-1])

        runner.check_images = Mock()
        runner.check_network = Mock()
        runner.check_container = Mock(side_effect=inspect)
        runner.sql = Mock(side_effect=[empty_identity(), "c06_transcript_events"])
        runner.oneshot = Mock(side_effect=lambda stage, *a, **k: stages[stage])
        runner.create_app = Mock(side_effect=lambda role, *a, **k: role)
        runner.create_host_gateway = Mock(return_value="host-gateway")
        runner.commands.call.side_effect = command
        runner.wait_state = Mock(side_effect=[unsupported, completed])

        def http(path, authenticated=False):
            if path == "/api/health":
                return 200, {"status": "ok", "service": "echo-talk"}
            if path == "/api/sessions":
                return 401, {}
            return 503, {
                "detail": {
                    "status": "not_ready",
                    "errors": dict.fromkeys(
                        ("livekit", "llm", "stt", "tts"), "missing"
                    ),
                }
            }

        runner.http = Mock(side_effect=http)
        runner.host_http = Mock(side_effect=http)
        return runner, provision, approval

    def test_exercise_refuses_every_bad_long_process_without_success_receipt(self):
        for role in (
            "worker-missing",
            "worker-demo",
            "worker-restarted",
            "api",
            "host-gateway",
        ):
            for state in (1, 137, "early", "running"):
                with (
                    self.subTest(role=role, state=state),
                    tempfile.TemporaryDirectory() as temp,
                ):
                    root = Path(temp)
                    runner, provision, approval = self.exercise_fixture(
                        root, role, state
                    )
                    with patch("runtime.time.sleep"), self.assertRaises(Refused):
                        runner.exercise(provision, approval)
                    self.assertFalse((root / "result.json").exists())

    def test_exercise_zero_exits_produce_complete_success_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner, provision, approval = self.exercise_fixture(root)
            with patch("runtime.time.sleep"):
                runner.exercise(provision, approval)
            result = json.loads((root / "result.json").read_text())
            self.assertEqual(result["status"], "passed")
            self.assertEqual(
                [entry["role"] for entry in result["process_exits"]],
                [
                    "worker-missing",
                    "worker-demo",
                    "worker-restarted",
                    "host-gateway",
                    "api",
                ],
            )
            self.assertTrue(
                all(entry["exit"] == 0 for entry in result["process_exits"])
            )

    def test_exercise_final_guard_rejects_nonzero_stop_result(self):
        for role in ("worker-missing", "worker-demo", "worker-restarted", "api"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                runner, provision, approval = self.exercise_fixture(root)
                stop = runner.stop

                def return_bad_exit(
                    identity, current_role, network, stop=stop, role=role
                ):
                    result = stop(identity, current_role, network)
                    return {**result, "exit": 1} if current_role == role else result

                runner.stop = return_bad_exit
                with (
                    patch("runtime.time.sleep"),
                    self.assertRaisesRegex(Refused, "process_exit_nonzero"),
                ):
                    runner.exercise(provision, approval)
                self.assertFalse((root / "result.json").exists())


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.relays = []

    def tearDown(self):
        for relay in self.relays:
            relay.shutdown()

    def new_relay(self, upstream, **kwargs):
        relay = FixedUpstreamRelay(("127.0.0.1", 0), upstream, **kwargs)
        self.relays.append(relay)
        relay.start()
        return relay

    def finish_relay(self, relay):
        relay.shutdown()
        self.relays.remove(relay)

    def test_fixed_upstream_relays_without_logging_request_data(self):
        received = []
        ready = threading.Event()
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()

        def upstream():
            ready.set()
            connection, _ = listener.accept()
            with connection:
                received.append(connection.recv(16384))
                connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")

        thread = threading.Thread(target=upstream)
        thread.start()
        ready.wait(1)
        relay = self.new_relay(
            listener.getsockname(), max_connections=2, idle_timeout=2
        )
        try:
            with socket.create_connection(relay.server_address, timeout=2) as client:
                client.sendall(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\n\r\n")
                response = bytearray()
                while chunk := client.recv(1024):
                    response.extend(chunk)
                self.assertTrue(response.endswith(b"OK"))
            self.assertEqual(relay.upstream, listener.getsockname())
        finally:
            self.finish_relay(relay)
            listener.close()
            thread.join(2)
            self.assertFalse(thread.is_alive())
        self.assertTrue(received and received[0].startswith(b"GET /api/health"))

    def test_gateway_accepts_legal_fragmented_header(self):
        # Three back-to-back sendall calls on a real TCP socket can be coalesced
        # by the kernel, which would hide the fragmentation path. Drive each
        # fragment into a distinct recv() return via an observable handshake on
        # a socketpair, then assert the full header is reassembled unchanged.
        class FragmentSocket:
            def __init__(self, sock):
                self._sock = sock
                self.fragments = 0
                self.received = threading.Event()

            def recv(self, size):
                chunk = self._sock.recv(size)
                if chunk:
                    self.fragments += 1
                    self.received.set()
                return chunk

            def settimeout(self, value):
                self._sock.settimeout(value)

        relay = FixedUpstreamRelay.__new__(FixedUpstreamRelay)
        relay.idle_timeout = 2
        relay.header_limit = 8192
        relay.stopping = threading.Event()
        left, right = socket.socketpair()
        tracked = FragmentSocket(right)
        result = {}

        def read():
            result["header"] = relay.read_headers(tracked)

        reader = threading.Thread(target=read)
        reader.start()
        try:
            for fragment in (
                b"GET / HTTP/1.1\r\n",
                b"Host: local",
                b"host\r\n\r\n",
            ):
                left.sendall(fragment)
                self.assertTrue(tracked.received.wait(2))
                tracked.received.clear()
            left.shutdown(socket.SHUT_WR)
            reader.join(2)
        finally:
            left.close()
            right.close()
        self.assertFalse(reader.is_alive())
        self.assertEqual(result["header"], b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        self.assertGreaterEqual(tracked.fragments, 3)

    def test_gateway_rejects_incomplete_or_oversized_header_without_upstream(self):
        relay = FixedUpstreamRelay.__new__(FixedUpstreamRelay)
        relay.idle_timeout = 1.0
        relay.header_limit = 8192
        relay.stopping = threading.Event()
        for payload in (b"GET / HTTP/1.1\r\n", b"X" * 8193):
            with self.subTest(size=len(payload)):
                left, right = socket.socketpair()
                result = []

                def read():
                    result.append(relay.read_headers(right))

                reader = threading.Thread(target=read)
                reader.start()
                try:
                    left.settimeout(2)
                    left.sendall(payload)
                    left.shutdown(socket.SHUT_WR)
                    reader.join(2)
                finally:
                    left.close()
                    right.close()
                self.assertFalse(reader.is_alive())
                self.assertTrue(result)
                self.assertIsNone(result[0])

    def test_shutdown_closes_active_connections_and_threads(self):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        threads_before = set(threading.enumerate())
        relay = self.new_relay(listener.getsockname(), idle_timeout=30)
        client = socket.create_connection(relay.server_address, timeout=2)
        client.sendall(b"GET / HTTP/1.1\r\nHost: local\r\n\r\n")
        deadline = time.monotonic() + 2
        while not any(upstream is not None for upstream in relay.active.values()):
            if time.monotonic() >= deadline:
                self.fail("gateway did not connect to fixed upstream in time")
        self.finish_relay(relay)
        client.close()
        listener.close()
        self.assertFalse(relay.acceptor.is_alive())
        self.assertFalse(relay.active)
        self.assertEqual(set(threading.enumerate()), threads_before)

    def test_bind_failure_starts_no_worker(self):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        try:
            with self.assertRaises(OSError):
                FixedUpstreamRelay(listener.getsockname(), ("127.0.0.1", 1))
        finally:
            listener.close()

    def test_manifest_initialization_preserves_host_loopback_legacy_defaults(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            snapshot = root / "snapshot"
            snapshot.mkdir()
            for name in ("Dockerfile", "uv.lock", "pyproject.toml", ".python-version"):
                (snapshot / name).write_text("fixture\n")
            inputs = root / "inputs.json"
            inputs.write_bytes(
                json_bytes(
                    {"files": {path.name: sha256(path) for path in snapshot.iterdir()}}
                )
            )
            protected = root / "protected"
            protected.mkdir(mode=0o700)
            pg, app = env_fixture()
            for name, values in (("pg.env", pg), ("app.env", app)):
                path = protected / name
                path.write_text(
                    "".join(f"{key}={value}\n" for key, value in values.items())
                )
                path.chmod(0o600)
            manifest_path = root / "manifest.json"
            manifest = {
                "schema": 1,
                "run_id": "legacy-r0",
                "snapshot": str(snapshot),
                "source_inputs": str(inputs),
                "source_inputs_sha256": sha256(inputs),
                "api_image": IMAGE,
                "postgres_image": IMAGE,
                "api_image_source_sha256": "a" * 64,
                "probe_sha256": sha256(Path(__file__).with_name("container_probe.py")),
                "report_root": str(root),
                "pg_env": str(protected / "pg.env"),
                "app_env": str(protected / "app.env"),
                "http_transport": "host-loopback",
                "http_port": 18800,
                "migration_head": "c06_transcript_events",
                "platform": "linux/arm64",
            }
            manifest_path.write_bytes(json_bytes(manifest))
            runner = Runtime(manifest_path, root / "report")
            self.assertEqual(runner.scope, LEGACY_SCOPE)
            self.assertEqual(runner.pg_name, PG_NAME)
            self.assertFalse(runner.host_gateway)
            self.assertEqual(
                runner.network_name,
                "echotalk-overnight-20261103-runtime-legacy-r0",
            )

    def test_existing_container_refuses_before_mutation(self):
        commands = Mock()
        commands.call.return_value = b"foreign\nreserved\n"
        with self.assertRaisesRegex(Refused, "container_name_conflict"):
            refuse_conflicts(commands, ["reserved"])
        self.assertEqual(commands.call.call_count, 1)
        self.assertEqual(commands.call.call_args.args[:2], ("container", "ls"))

    def test_existing_network_refuses_before_mutation(self):
        commands = Mock()
        commands.call.side_effect = [b"foreign\n", b"reserved-net\n"]
        with self.assertRaisesRegex(Refused, "network_name_conflict"):
            refuse_conflicts(commands, ["new-container"], "reserved-net")
        self.assertEqual(commands.call.call_count, 2)

    def test_cleanup_refuses_changed_id_label_or_image(self):
        expected = labels("unit-r0", "api", "c" * 64)
        good = {"Id": CONTAINER, "Image": IMAGE, "Config": {"Labels": expected}}
        for changed in (
            {**good, "Id": "d" * 64},
            {**good, "Image": "sha256:" + "e" * 64},
            {**good, "Config": {"Labels": {**expected, "codex.run": "other"}}},
        ):
            with self.subTest(changed=changed):
                commands = Mock()
                commands.inspect.return_value = changed
                with self.assertRaises(Refused):
                    remove_container(commands, CONTAINER, expected, IMAGE)
                commands.call.assert_not_called()

    def test_cleanup_removes_exact_id_only_after_verification(self):
        expected = labels("unit-r0", "api", "c" * 64)
        commands = Mock()
        commands.inspect.return_value = {
            "Id": CONTAINER,
            "Image": IMAGE,
            "Config": {"Labels": expected},
        }
        remove_container(commands, CONTAINER, expected, IMAGE)
        commands.inspect.assert_called_once_with("container", CONTAINER)
        commands.call.assert_called_once_with(
            "container", "rm", "--force", "--volumes", CONTAINER
        )

    def test_nonempty_database_refuses_all_user_object_classes(self):
        validate_empty(empty_identity())
        for field in ("relations", "types", "routines", "extra_schemas"):
            with self.subTest(field=field):
                with self.assertRaisesRegex(Refused, "database_not_empty"):
                    validate_empty({**empty_identity(), field: 1})

    def test_real_count_queries_include_pgx_schema_objects_and_rollback(self):
        # Execute the exact four production count queries in an offline catalog
        # fixture. PostgreSQL json_build_object/server identity is tested by main.
        with sqlite3.connect(":memory:") as catalog:
            catalog.executescript(
                """
                CREATE TABLE pg_namespace (oid integer, nspname text);
                CREATE TABLE pg_class (relnamespace integer);
                CREATE TABLE pg_type (typnamespace integer);
                CREATE TABLE pg_proc (pronamespace integer);
                INSERT INTO pg_namespace VALUES
                    (1,'pg_catalog'), (2,'pg_toast'), (3,'pg_temp_7'),
                    (4,'information_schema'), (5,'public');
                INSERT INTO pg_class VALUES (1),(2),(3),(4);
                INSERT INTO pg_type VALUES (1),(2),(3),(4);
                INSERT INTO pg_proc VALUES (1),(2),(3),(4);
                """
            )

            def counts():
                return {
                    name: catalog.execute(query).fetchone()[0]
                    for name, query in USER_OBJECT_COUNT_SQL.items()
                }

            baseline = counts()
            self.assertEqual(baseline, dict.fromkeys(USER_OBJECT_COUNT_SQL, 0))
            validate_empty({**empty_identity(), **baseline})
            catalog.execute("SAVEPOINT ordinary_schema")
            catalog.execute("INSERT INTO pg_namespace VALUES (6,'pgx_runtime_probe')")
            schema_only = counts()
            self.assertEqual(schema_only["extra_schemas"], 1)
            with self.assertRaisesRegex(Refused, "database_not_empty"):
                validate_empty({**empty_identity(), **schema_only})
            catalog.execute("INSERT INTO pg_class VALUES (6)")
            catalog.execute("INSERT INTO pg_type VALUES (6)")
            catalog.execute("INSERT INTO pg_proc VALUES (6)")
            populated = counts()
            self.assertEqual(populated, dict.fromkeys(USER_OBJECT_COUNT_SQL, 1))
            with self.assertRaisesRegex(Refused, "database_not_empty"):
                validate_empty({**empty_identity(), **populated})
            catalog.execute("ROLLBACK TO ordinary_schema")
            self.assertEqual(counts(), baseline)

    def test_public_objects_are_counted_without_counting_public_as_extra_schema(self):
        with sqlite3.connect(":memory:") as catalog:
            catalog.executescript(
                """
                CREATE TABLE pg_namespace (oid integer, nspname text);
                CREATE TABLE pg_class (relnamespace integer);
                CREATE TABLE pg_type (typnamespace integer);
                CREATE TABLE pg_proc (pronamespace integer);
                INSERT INTO pg_namespace VALUES (1,'public');
                INSERT INTO pg_class VALUES (1);
                INSERT INTO pg_type VALUES (1);
                INSERT INTO pg_proc VALUES (1);
                """
            )
            actual = {
                name: catalog.execute(query).fetchone()[0]
                for name, query in USER_OBJECT_COUNT_SQL.items()
            }
            self.assertEqual(
                actual, {"relations": 1, "types": 1, "routines": 1, "extra_schemas": 0}
            )
            with self.assertRaisesRegex(Refused, "database_not_empty"):
                validate_empty({**empty_identity(), **actual})

    def test_wrong_sql_identity_refused_even_when_empty(self):
        for field, value in (
            ("database", "echotalk"),
            ("user", "other"),
            ("version", "160000"),
        ):
            with self.subTest(field=field), self.assertRaises(Refused):
                validate_empty({**empty_identity(), field: value})

    def test_nonempty_pre_migration_gate_never_starts_helper(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            manifest = root / "manifest.json"
            manifest.write_text("{}")
            provision = root / "provision.json"
            identity = {**empty_identity(), "types": 1}
            provision.write_text(
                json.dumps(
                    {
                        "manifest_sha256": sha256(manifest),
                        "network_id": "f" * 64,
                        "postgres_id": CONTAINER,
                        "database_identity": identity,
                    }
                )
            )
            approval = root / "approval.json"
            approval.write_text(
                json.dumps(
                    {
                        "approved_for_execution": True,
                        "manifest_sha256": sha256(manifest),
                        "provision_sha256": sha256(provision),
                        "reviewed_migration_files": {"alembic.ini": "e" * 64},
                        "reviewed_empty_database": True,
                        "evidence_basis": "main independent unit fixture",
                    }
                )
            )
            runner = Runtime.__new__(Runtime)
            runner.manifest_path = manifest
            runner.files = {"alembic.ini": "e" * 64}
            runner.manifest = {"postgres_image": IMAGE}
            runner.database = DATABASE
            runner.check_images = Mock()
            runner.check_network = Mock()
            runner.check_container = Mock()
            runner.sql = Mock(return_value=identity)
            runner.oneshot = Mock()
            with self.assertRaisesRegex(Refused, "database_not_empty"):
                runner.exercise(provision, approval)
            runner.oneshot.assert_not_called()

    def test_approval_needs_separate_migration_review_and_frozen_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            manifest, provision = root / "manifest", root / "provision"
            manifest.write_text("{}")
            provision.write_text("{}")
            files = {"alembic.ini": "a" * 64, "main.py": "b" * 64}
            approval = {
                "approved_for_execution": True,
                "manifest_sha256": sha256(manifest),
                "provision_sha256": sha256(provision),
                "reviewed_migration_files": {"alembic.ini": "a" * 64},
                "reviewed_empty_database": True,
                "evidence_basis": "main review",
            }
            validate_approval(approval, manifest, provision, files)
            for key in approval:
                changed = dict(approval)
                changed.pop(key)
                with self.subTest(key=key), self.assertRaises(Refused):
                    validate_approval(changed, manifest, provision, files)
            manifest.write_text('{"changed": true}')
            with self.assertRaisesRegex(Refused, "approval_manifest_mismatch"):
                validate_approval(approval, manifest, provision, files)

    def test_env_refuses_provider_and_database_escape(self):
        pg, app = env_fixture()
        validate_envs(pg, app)
        for changed in (
            {**app, "OPENAI_API_KEY": "do-not-leak"},
            {**app, "DATABASE_URL": "postgresql+asyncpg://localhost/echotalk"},
            {**app, "USE_MOCK_DB": "true"},
            {**app, "AUTH_MODE": "oidc"},
        ):
            with (
                self.subTest(keys=sorted(changed)),
                self.assertRaises(Refused) as error,
            ):
                validate_envs(pg, changed)
            self.assertNotIn("do-not-leak", str(error.exception))

    def test_env_requires_private_owner_directory_and_file_mode(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            root.chmod(0o700)
            path = root / "protected.env"
            path.write_text("DEV_AUTH_TOKEN=never-connected\n")
            path.chmod(0o600)
            self.assertEqual(
                read_protected_env(path), {"DEV_AUTH_TOKEN": "never-connected"}
            )
            path.chmod(0o644)
            with self.assertRaisesRegex(Refused, "env_mode"):
                read_protected_env(path)
            path.chmod(0o600)
            root.chmod(0o755)
            with self.assertRaisesRegex(Refused, "env_parent_must_be_0700"):
                read_protected_env(path)
            root.chmod(0o700)
            with patch("runtime.os.getuid", return_value=os.getuid() + 1):
                with self.assertRaisesRegex(Refused, "env_owner_mismatch"):
                    read_protected_env(path)
            link = root / "link"
            link.symlink_to(path)
            with self.assertRaisesRegex(Refused, "env_symlink"):
                read_protected_env(link)

    def test_env_refuses_actual_ancestor_symlink(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            private = root / "private"
            private.mkdir(mode=0o700)
            path = private / "protected.env"
            path.write_text("DEV_AUTH_TOKEN=never-connected\n")
            path.chmod(0o600)
            (root / "linked").symlink_to(private, target_is_directory=True)
            with self.assertRaisesRegex(Refused, "env_symlink"):
                read_protected_env(root / "linked" / "protected.env")

    def test_snapshot_requires_exact_frozen_map_and_no_dotenv(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            snapshot = root / "source"
            snapshot.mkdir()
            for filename in (
                "Dockerfile",
                "uv.lock",
                "pyproject.toml",
                ".python-version",
            ):
                (snapshot / filename).write_text("public fixture\n")
            files = {p.name: sha256(p) for p in snapshot.iterdir()}
            inputs = root / "inputs.json"
            inputs.write_bytes(json_bytes({"files": files}))
            self.assertEqual(check_snapshot(snapshot, inputs)[0], files)
            (snapshot / "uv.lock").write_text("drift\n")
            with self.assertRaisesRegex(Refused, "snapshot_fingerprint_mismatch"):
                check_snapshot(snapshot, inputs)
            (snapshot / ".env.forbidden").write_text("do-not-read")
            with self.assertRaisesRegex(Refused, "snapshot_forbidden_path"):
                check_snapshot(snapshot, inputs)

    def test_measurement_requires_pinned_bases(self):
        text = (
            "FROM python:3.12-slim\nCOPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /uv\n"
        )
        with self.assertRaisesRegex(Refused, "base_requires_digest"):
            measure.pin_dockerfile(text, "python:3.12-slim", "uv:latest")
        changed = measure.pin_dockerfile(
            text, "python@" + IMAGE, "ghcr.io/astral-sh/uv@" + IMAGE
        )
        self.assertNotIn("python:3.12-slim", changed)
        self.assertIn("python@sha256:", changed)

    def test_synthetic_products_require_one_set_and_no_real_knowledge(self):
        state = {
            "jobs": [{}, {}],
            "assessments": [{"is_synthetic": True, "source": "demo_mock"}],
            "grammar": [{"is_synthetic": True}],
            "knowledge_count": 0,
        }
        validate_products(state)
        for changed in (
            {**state, "knowledge_count": 1},
            {**state, "grammar": state["grammar"] * 2},
            {**state, "assessments": [{"is_synthetic": False, "source": "demo_mock"}]},
        ):
            with self.subTest(changed=changed), self.assertRaises(Refused):
                validate_products(changed)


class ProcessTests(unittest.TestCase):
    def test_stdout_stderr_and_stdin_credentials_are_not_written_to_events(self):
        with tempfile.TemporaryDirectory() as temp:
            commands = Commands(Path(temp).resolve())
            sentinel = b"credential-sentinel-not-for-evidence"
            with self.assertRaisesRegex(Refused, "command_failed"):
                commands.run(
                    [
                        sys.executable,
                        "-c",
                        "import sys; s=sys.stdin.read(); print(s); print(s,file=sys.stderr); sys.exit(7)",
                    ],
                    stdin=sentinel,
                    timeout=3,
                )
            self.assertEqual(commands.events[-1]["process_exit_code"], 7)
            for path in Path(temp).resolve().iterdir():
                self.assertNotIn(sentinel, path.read_bytes())

    def test_command_timeout_records_exit_and_clears_process_group(self):
        with tempfile.TemporaryDirectory() as temp:
            commands = Commands(Path(temp).resolve())
            with self.assertRaisesRegex(Refused, "command_timeout"):
                commands.run(
                    [sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.1
                )
            event = commands.events[-1]
            self.assertTrue(event["timed_out"])
            self.assertNotEqual(event["process_exit_code"], 0)
            self.assertTrue(event["command_tree_cleared"])
            self.assertTrue(event["inherits_outer_process_group"])
            self.assertEqual(event["process_group_id"], os.getpgrp())

    def test_sigterm_reaps_group_and_restores_original_handler(self):
        with tempfile.TemporaryDirectory() as temp:
            commands = Commands(Path(temp).resolve())
            previous = signal.getsignal(signal.SIGTERM)
            timer = threading.Timer(0.3, lambda: os.kill(os.getpid(), signal.SIGTERM))
            timer.start()
            try:
                with self.assertRaisesRegex(Refused, "command_interrupted"):
                    commands.run(
                        [sys.executable, "-c", "import time; time.sleep(30)"], timeout=3
                    )
            finally:
                timer.cancel()
                timer.join()
            event = commands.events[-1]
            self.assertEqual(event["interrupted_signal"], signal.SIGTERM)
            self.assertTrue(event["command_tree_cleared"])
            self.assertNotEqual(event["process_exit_code"], 0)
            self.assertEqual(signal.getsignal(signal.SIGTERM), previous)


if __name__ == "__main__":
    unittest.main()
