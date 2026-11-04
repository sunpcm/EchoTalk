"""Independent offline runner tests; no Docker, database, or Provider required."""

import base64
import json
import os
import signal
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import measure
from runtime import (
    DATABASE,
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
