"""Isolated service acceptance. Only the main agent may execute these stages."""

import argparse
import base64
import ipaddress
import json
import os
import re
import signal
import socket
import stat
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from runtime_support import (
    IMAGE_ID,
    RESOURCE_ID,
    Commands,
    Refused,
    assert_owned,
    check_snapshot,
    json_bytes,
    label_args,
    labels,
    refuse_conflicts,
    remove_container,
    require,
    sha256,
    write_json,
)

DATABASE = "echotalk_overnight_runtime"
PG_NAME = "echotalk-overnight-20261103-runtime-pg"
LEGACY_SCOPE = "echotalk-overnight-20261103"
USER_OBJECT_COUNT_SQL = {
    "relations": """SELECT count(*) FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE substr(n.nspname,1,3) <> 'pg_' AND n.nspname <> 'information_schema'""",
    "types": """SELECT count(*) FROM pg_type t
JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE substr(n.nspname,1,3) <> 'pg_' AND n.nspname <> 'information_schema'""",
    "routines": """SELECT count(*) FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE substr(n.nspname,1,3) <> 'pg_' AND n.nspname <> 'information_schema'""",
    "extra_schemas": """SELECT count(*) FROM pg_namespace
WHERE substr(nspname,1,3) <> 'pg_'
AND nspname NOT IN ('information_schema','public')""",
}
IDENTITY_SQL = (
    """
SELECT json_build_object(
 'database', current_database(), 'user', current_user,
 'version', current_setting('server_version_num'),
 'database_oid', (SELECT oid FROM pg_database WHERE datname=current_database()),
 'system_identifier', (SELECT system_identifier::text FROM pg_control_system()),
"""
    + ",\n".join(
        f" '{name}', ({query})" for name, query in USER_OBJECT_COUNT_SQL.items()
    )
    + "\n);\n"
)


def read_protected_env(path):
    path = Path(path).absolute()
    require(path.resolve(strict=True) == path, "env_symlink")
    require(stat.S_IMODE(path.stat().st_mode) == 0o600, "env_mode_must_be_0600")
    require(
        stat.S_IMODE(path.parent.stat().st_mode) == 0o700, "env_parent_must_be_0700"
    )
    require(path.stat().st_uid == os.getuid(), "env_owner_mismatch")
    result = {}
    for row in path.read_text().splitlines():
        if not row or row.startswith("#"):
            continue
        key, separator, value = row.partition("=")
        require(separator and re.fullmatch(r"[A-Z][A-Z0-9_]*", key), "invalid_env_line")
        require(key not in result and "\x00" not in value, "invalid_env_value")
        result[key] = value
    return result


def validate_envs(pg, app, *, database=DATABASE, pg_name=PG_NAME):
    require(
        set(pg) == {"POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"}, "pg_env_keys"
    )
    require(pg["POSTGRES_DB"] == pg["POSTGRES_USER"] == database, "pg_env_identity")
    require(
        re.fullmatch(r"[A-Za-z0-9_-]{24,128}", pg["POSTGRES_PASSWORD"]),
        "pg_password_format",
    )
    required = {
        "DATABASE_URL",
        "AUTH_MODE",
        "DEV_AUTH_TOKEN",
        "CALL_LEASE_MODE",
        "USE_MOCK_DB",
        "USE_MOCK_LLM",
        "USE_MOCK_TTS",
        "USE_MOCK_STT",
        "USE_MOCK_LIVEKIT",
        "USE_MOCK_ELSA",
        "ANALYSIS_WORKER_POLL_SECONDS",
        "CREDENTIAL_ENCRYPTION_KEYS",
        "ACTIVE_CREDENTIAL_KEY_VERSION",
    }
    require(set(app) == required, "app_env_keys")
    require(app["AUTH_MODE"] == "dev", "auth_mode_requires_isolated_dev")
    require(
        re.fullmatch(r"[A-Za-z0-9_-]{24,128}", app["DEV_AUTH_TOKEN"]),
        "dev_token_format",
    )
    require(app["CALL_LEASE_MODE"] == "disabled", "call_lease_disabled_required")
    for key in required:
        if key.startswith("USE_MOCK_"):
            require(app[key] == "false", "base_mock_flags_must_be_false")
    require(app["ANALYSIS_WORKER_POLL_SECONDS"] == "0.2", "worker_poll_value")
    url = urllib.parse.urlsplit(app["DATABASE_URL"])
    require(
        url.scheme == "postgresql+asyncpg"
        and url.hostname == pg_name
        and url.port == 5432
        and url.path == f"/{database}"
        and url.username == database
        and url.password == pg["POSTGRES_PASSWORD"]
        and not url.query
        and not url.fragment,
        "database_url_boundary",
    )
    keyring = json.loads(app["CREDENTIAL_ENCRYPTION_KEYS"])
    require(set(keyring) == {"runtime-test"}, "credential_keyring_boundary")
    require(
        app["ACTIVE_CREDENTIAL_KEY_VERSION"] == "runtime-test", "credential_key_version"
    )
    require(
        len(base64.urlsafe_b64decode(keyring["runtime-test"])) == 32,
        "credential_key_format",
    )


def validate_empty(identity, database=DATABASE):
    require(
        identity["database"] == identity["user"] == database, "sql_database_identity"
    )
    require(identity["version"] == "150019", "sql_server_version")
    require(
        all(
            identity[key] == 0
            for key in ("relations", "types", "routines", "extra_schemas")
        ),
        "database_not_empty",
    )


def validate_approval(approval, manifest_path, provision_path, files):
    require(approval.get("approved_for_execution") is True, "execution_not_approved")
    require(
        approval.get("manifest_sha256") == sha256(manifest_path),
        "approval_manifest_mismatch",
    )
    require(
        approval.get("provision_sha256") == sha256(provision_path),
        "approval_provision_mismatch",
    )
    expected = {
        path: value
        for path, value in files.items()
        if path.startswith("alembic/") or path == "alembic.ini"
    }
    require(
        approval.get("reviewed_migration_files") == expected,
        "migration_review_mismatch",
    )
    require(
        approval.get("reviewed_empty_database") is True, "empty_database_not_reviewed"
    )
    require(bool(approval.get("evidence_basis")), "approval_evidence_missing")


class Runtime:
    def __init__(self, manifest_path, report, docker_context=None):
        self.manifest_path = Path(manifest_path)
        self.manifest = json.loads(self.manifest_path.read_text())
        m = self.manifest
        require(m.get("schema") == 1, "manifest_schema")
        require(
            sha256(m["source_inputs"]) == m["source_inputs_sha256"],
            "source_inputs_changed",
        )
        self.files, self.source = check_snapshot(m["snapshot"], m["source_inputs"])
        self.run_id = m["run_id"]
        self.scope = m.get("scope", LEGACY_SCOPE)
        require(
            self.scope in {LEGACY_SCOPE, "echotalk-grammar-http-20261104"},
            "scope_boundary",
        )
        labels(self.run_id, "validation", self.source, self.scope)
        self.database = m.get("database", DATABASE)
        require(self.database == DATABASE, "runtime_database_boundary")
        self.pg_name = m.get("postgres_name", f"{self.scope}-runtime-pg")
        if self.scope == LEGACY_SCOPE:
            require(self.pg_name == PG_NAME, "legacy_pg_name_boundary")
        else:
            require(
                m.get("database") == DATABASE
                and m.get("postgres_name") == f"{self.scope}-runtime-pg",
                "explicit_scope_identity_required",
            )
        self.root = Path(m["report_root"])
        require(self.root.is_absolute(), "report_root_absolute_required")
        require(18800 <= m["http_port"] <= 18809, "http_port_boundary")
        require(
            m.get("http_transport")
            in {"host-gateway", "host-loopback", "container-http"},
            "explicit_http_transport_required",
        )
        require(
            m["migration_head"] == "c06_transcript_events", "migration_head_boundary"
        )
        for key in ("api_image", "postgres_image"):
            require(IMAGE_ID.fullmatch(m[key]), "immutable_image_required")
        require(
            re.fullmatch(r"[0-9a-f]{64}", m["api_image_source_sha256"]),
            "image_source_label_required",
        )
        self.probe = Path(__file__).with_name("container_probe.py").resolve()
        require(sha256(self.probe) == m["probe_sha256"], "probe_changed")
        self.gateway = Path(__file__).with_name("host_gateway.py").resolve()
        if m["http_transport"] == "host-gateway":
            require(sha256(self.gateway) == m["gateway_sha256"], "gateway_changed")
        self.pg_env = read_protected_env(m["pg_env"])
        self.app_env = read_protected_env(m["app_env"])
        validate_envs(
            self.pg_env, self.app_env, database=self.database, pg_name=self.pg_name
        )
        self.report = Path(report)
        self.commands = Commands(self.report, docker_context)
        self.network_name = f"{self.scope}-runtime-{self.run_id}"
        self.gateway_network_name = f"{self.network_name}-gateway"
        if self.scope != LEGACY_SCOPE:
            self.network_name += "-internal"
        self.resources = []
        self.intents = []

    def expected(self, role):
        return labels(self.run_id, role, self.source, self.scope)

    def record(self, kind, identity, role, image=None):
        resource = {
            "kind": kind,
            "id": identity,
            "labels": self.expected(role),
            "image": image,
        }
        self.resources.append(resource)
        write_json(self.report / f"resource-{len(self.resources):04d}.json", resource)
        return identity

    def intent(self, kind, name, role, image=None):
        value = {"kind": kind, "name": name, "role": role, "image": image}
        self.intents.append(value)
        write_json(self.report / f"intent-{len(self.intents):04d}.json", value)

    def stop_owned_on_failure(self):
        results = []
        for intent in reversed(self.intents):
            try:
                kind = intent["kind"]
                rows = self.commands.call(
                    kind,
                    "ls",
                    *(["--all"] if kind == "container" else []),
                    "--no-trunc",
                    "--format",
                    "{{json .}}",
                )
                matches = [
                    json.loads(row)
                    for row in rows.decode().splitlines()
                    if json.loads(row).get("Names", json.loads(row).get("Name"))
                    == intent["name"]
                ]
                if not matches:
                    continue
                identity = matches[0]["ID"]
                info = self.commands.inspect(kind, identity)
                assert_owned(
                    info, identity, self.expected(intent["role"]), intent["image"]
                )
                if not any(r["id"] == identity for r in self.resources):
                    self.record(kind, identity, intent["role"], intent["image"])
                if kind == "container":
                    if info["State"]["Running"]:
                        self.commands.call("stop", "--time", "5", identity, timeout=15)
                    info = self.commands.inspect(kind, identity)
                    assert_owned(
                        info, identity, self.expected(intent["role"]), intent["image"]
                    )
                    require(
                        info["State"]["Running"] is False,
                        "failure_service_still_running",
                    )
                    results.append(
                        {
                            "id": identity,
                            "running": False,
                            "exit": info["State"]["ExitCode"],
                        }
                    )
            except BaseException as exc:
                results.append(
                    {
                        "intent": intent["name"],
                        "cleanup_error": str(exc)
                        if isinstance(exc, Refused)
                        else type(exc).__name__,
                    }
                )
        write_json(
            self.report / "failure-processes.json",
            {
                "owned_processes": results,
                "provisioned_pg_from_prior_stage_remains_main_owned": True,
            },
        )

    def check_images(self):
        for role, key in (("api", "api_image"), ("postgres", "postgres_image")):
            info = self.commands.inspect("image", self.manifest[key])
            require(info["Id"] == self.manifest[key], "image_id_mismatch")
            require(
                f"{info['Os']}/{info['Architecture']}" == self.manifest["platform"],
                "image_platform_mismatch",
            )
            if role == "api":
                actual = info.get("Config", {}).get("Labels", {}) or {}
                require(
                    actual.get("codex.source-sha256")
                    == self.manifest["api_image_source_sha256"],
                    "api_image_source_mismatch",
                )
                require(actual.get("codex.role") == "api", "api_image_role_mismatch")

    def check_network(self, identity, role="network"):
        info = self.commands.inspect("network", identity)
        assert_owned(info, identity, self.expected(role))
        require(info["Internal"] is (role == "network"), "network_internal_boundary")
        return info

    def check_container(self, identity, role, image, network):
        info = self.commands.inspect("container", identity)
        assert_owned(info, identity, self.expected(role), image)
        networks = {self.network_name}
        if role == "host-gateway":
            networks.add(self.gateway_network_name)
        require(
            set(info["NetworkSettings"]["Networks"]) == networks,
            "container_network_boundary",
        )
        require(
            info["NetworkSettings"]["Networks"][self.network_name]["NetworkID"]
            == network,
            "network_id_mismatch",
        )
        if role == "host-gateway":
            require(
                info["NetworkSettings"]["Networks"][self.gateway_network_name][
                    "NetworkID"
                ]
                == self.gateway_network_id,
                "gateway_network_id_mismatch",
            )
        require(
            info["HostConfig"]["RestartPolicy"]["Name"] in {"", "no"},
            "restart_policy_boundary",
        )
        if role == "postgres":
            require(
                not info["HostConfig"].get("PortBindings"), "postgres_port_published"
            )
        elif role == "host-gateway":
            require(
                info["HostConfig"].get("PortBindings") == self.loopback_binding,
                "gateway_port_boundary",
            )
            require(
                info["HostConfig"].get("Sysctls", {}).get("net.ipv4.ip_forward") == "0",
                "gateway_ip_forward_enabled",
            )
            gateway_env = dict(
                row.split("=", 1) for row in info["Config"].get("Env", [])
            )
            require(
                gateway_env.get("FIXED_UPSTREAM") == self.upstream,
                "gateway_env_boundary",
            )
            require(
                not any(
                    key == "DATABASE_URL"
                    or key == "DEV_AUTH_TOKEN"
                    or "PASSWORD" in key
                    or "CREDENTIAL" in key
                    or key.startswith(("OPENAI_", "LIVEKIT_", "ANTHROPIC_"))
                    for key in gateway_env
                ),
                "gateway_inherited_credentials",
            )
        else:
            expected = (
                self.loopback_binding
                if role == "api" and not self.host_gateway
                else None
            )
            require(
                (info["HostConfig"].get("PortBindings") or None) == expected,
                "application_port_boundary",
            )
        return info

    @property
    def host_gateway(self):
        return self.manifest.get("http_transport") == "host-gateway"

    @property
    def loopback_binding(self):
        return {
            "8000/tcp": [
                {"HostIp": "127.0.0.1", "HostPort": str(self.manifest["http_port"])}
            ]
        }

    def sql(self, pg_id, query):
        output = self.commands.call(
            "exec",
            pg_id,
            "psql",
            "-X",
            "-A",
            "-t",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            self.database,
            "-d",
            self.database,
            "-c",
            query,
        )
        return json.loads(output)

    def provision(self):
        self.check_images()
        refuse_conflicts(
            self.commands,
            [self.pg_name, self.api_name()]
            + ([self.gateway_name()] if self.host_gateway else []),
            self.network_name,
            [self.gateway_network_name] if self.host_gateway else [],
        )
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", self.manifest["http_port"]))
        self.intent("network", self.network_name, "network")
        network = (
            self.commands.call(
                "network",
                "create",
                "--internal",
                *label_args(self.expected("network")),
                self.network_name,
            )
            .decode()
            .strip()
        )
        self.record("network", network, "network")
        self.check_network(network)
        if self.host_gateway:
            self.intent("network", self.gateway_network_name, "gateway-network")
            gateway_network = (
                self.commands.call(
                    "network",
                    "create",
                    *label_args(self.expected("gateway-network")),
                    self.gateway_network_name,
                )
                .decode()
                .strip()
            )
            self.record("network", gateway_network, "gateway-network")
            self.check_network(gateway_network, "gateway-network")
            self.gateway_network_id = gateway_network
        self.intent(
            "container", self.pg_name, "postgres", self.manifest["postgres_image"]
        )
        pg_id = (
            self.commands.call(
                "create",
                "--name",
                self.pg_name,
                "--pull=never",
                "--restart=no",
                "--network",
                network,
                "--network-alias",
                self.pg_name,
                "--tmpfs",
                "/var/lib/postgresql/data:rw,nosuid,noexec,size=512m",
                "--env-file",
                self.manifest["pg_env"],
                *label_args(self.expected("postgres")),
                self.manifest["postgres_image"],
            )
            .decode()
            .strip()
        )
        self.record("container", pg_id, "postgres", self.manifest["postgres_image"])
        self.commands.call("start", pg_id)
        self.check_container(
            pg_id, "postgres", self.manifest["postgres_image"], network
        )
        deadline = time.monotonic() + 45
        while True:
            code, _, _ = self.commands.run(
                self.commands.docker
                + [
                    "exec",
                    pg_id,
                    "pg_isready",
                    "-U",
                    self.database,
                    "-d",
                    self.database,
                ],
                check=False,
                timeout=5,
            )
            if code == 0:
                break
            require(time.monotonic() < deadline, "postgres_not_ready")
            time.sleep(0.2)
        identity = self.sql(pg_id, IDENTITY_SQL)
        write_json(self.report / "empty-database.json", identity)
        validate_empty(identity)
        result = {
            "status": "awaiting_independent_migration_approval",
            "manifest_sha256": sha256(self.manifest_path),
            "source_sha256": self.source,
            "network_id": network,
            "postgres_id": pg_id,
            "gateway_network_id": getattr(self, "gateway_network_id", None),
            "database_identity": identity,
            "resources": self.resources,
        }
        write_json(self.report / "provision.json", result)

    def api_name(self):
        return f"{self.scope}-api-{self.run_id}"

    def gateway_name(self):
        return f"{self.scope}-host-gateway-{self.run_id}"

    def create_app(self, role, network, command, *, synthetic=False, interactive=False):
        name = f"{self.scope}-{role}-{self.run_id}"
        refuse_conflicts(self.commands, [name])
        args = [
            "create",
            "--name",
            name,
            "--pull=never",
            "--restart=no",
            "--sysctl",
            "net.ipv4.ip_forward=0",
            "--network",
            network,
            "--env-file",
            self.manifest["app_env"],
            "--env",
            "PYTHONDONTWRITEBYTECODE=1",
            *label_args(self.expected(role)),
            "--mount",
            f"type=bind,src={self.probe},dst=/opt/echotalk-probe.py,readonly",
        ]
        if synthetic:
            args += ["--env", "USE_MOCK_ELSA=true"]
        if interactive:
            args += ["--interactive"]
        if role == "api" and not self.host_gateway:
            args += ["--publish", f"127.0.0.1:{self.manifest['http_port']}:8000"]
        args += ["--entrypoint", command[0], self.manifest["api_image"], *command[1:]]
        self.intent("container", name, role, self.manifest["api_image"])
        identity = self.commands.call(*args).decode().strip()
        return self.record("container", identity, role, self.manifest["api_image"])

    def oneshot(self, stage, network, *, synthetic=False, stdin=None):
        identity = self.create_app(
            f"probe-{stage}-{len(self.resources)}",
            network,
            ["python", "-B", "/opt/echotalk-probe.py", stage],
            synthetic=synthetic,
            interactive=stdin is not None,
        )
        role = self.resources[-1]["labels"]["codex.role"]
        try:
            args = ["start", "--attach"]
            if stdin is not None:
                args += ["--interactive"]
            _, output, _ = self.commands.run(
                self.commands.docker + args + [identity],
                stdin=stdin,
                timeout=150,
                check=False,
            )
            info = self.check_container(
                identity, role, self.manifest["api_image"], network
            )
            require(info["State"]["Running"] is False, "oneshot_still_running")
            write_json(
                self.report / f"exit-{identity}.json",
                {"id": identity, "exit": info["State"]["ExitCode"]},
            )
            require(info["State"]["ExitCode"] == 0, "oneshot_failed")
            lines = [
                row
                for row in output.decode().splitlines()
                if row.startswith("KEYFREE_RESULT=")
            ]
            require(len(lines) == 1, "probe_result_missing")
            return json.loads(lines[0].partition("=")[2])
        finally:
            remove_container(
                self.commands, identity, self.expected(role), self.manifest["api_image"]
            )

    def create_host_gateway(self, network):
        api_info = self.check_container(
            self.api_id, "api", self.manifest["api_image"], network
        )
        address = api_info["NetworkSettings"]["Networks"][self.network_name][
            "IPAddress"
        ]
        parsed = ipaddress.ip_address(address)
        require(
            parsed.version == 4 and parsed.is_private and not parsed.is_loopback,
            "gateway_upstream_boundary",
        )
        self.upstream = f"{address}:8000"
        refuse_conflicts(self.commands, [self.gateway_name()])
        args = [
            "create",
            "--name",
            self.gateway_name(),
            "--pull=never",
            "--restart=no",
            "--sysctl",
            "net.ipv4.ip_forward=0",
            "--network",
            self.gateway_network_name,
            "--env",
            f"FIXED_UPSTREAM={self.upstream}",
            "--publish",
            f"127.0.0.1:{self.manifest['http_port']}:8000",
            "--mount",
            f"type=bind,src={self.gateway},dst=/opt/echotalk-host-gateway.py,readonly",
            *label_args(self.expected("host-gateway")),
            "--entrypoint",
            "python",
            self.manifest["api_image"],
            "-B",
            "/opt/echotalk-host-gateway.py",
        ]
        self.intent(
            "container",
            self.gateway_name(),
            "host-gateway",
            self.manifest["api_image"],
        )
        identity = self.commands.call(*args).decode().strip()
        self.record("container", identity, "host-gateway", self.manifest["api_image"])
        self.commands.call("network", "connect", network, identity)
        self.commands.call("start", identity)
        self.check_container(
            identity, "host-gateway", self.manifest["api_image"], network
        )
        return identity

    def http(self, path, authenticated=False):
        if self.manifest["http_transport"] == "container-http":
            stage = {
                "/api/health": "http-health",
                "/api/sessions": "http-anonymous",
                "/api/health/ready": "http-ready",
            }[path]
            output = self.commands.call(
                "exec",
                self.api_id,
                "python",
                "-B",
                "/opt/echotalk-probe.py",
                stage,
                timeout=10,
            )
            lines = [
                row
                for row in output.decode().splitlines()
                if row.startswith("KEYFREE_RESULT=")
            ]
            require(len(lines) == 1, "http_probe_result_missing")
            result = json.loads(lines[0].partition("=")[2])
            if result.get("transport_error"):
                raise OSError("container_http_not_reachable")
            return result["status"], result["body"]
        return self.host_http(path, authenticated)

    def host_http(self, path, authenticated=False):
        headers = {}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.app_env["DEV_AUTH_TOKEN"]
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.manifest['http_port']}{path}",
            headers=headers,
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=1) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    def stop(self, identity, role, network):
        info = self.check_container(identity, role, self.manifest["api_image"], network)
        require(info["State"]["Running"] is True, "long_process_exited_early")
        self.commands.call("stop", "--time", "5", identity, timeout=15)
        info = self.check_container(identity, role, self.manifest["api_image"], network)
        require(info["State"]["Running"] is False, "process_did_not_stop")
        return {
            "id": identity,
            "role": role,
            "running": False,
            "exit": info["State"]["ExitCode"],
        }

    def wait_state(self, network, predicate, worker, role):
        deadline = time.monotonic() + 30
        while True:
            info = self.check_container(
                worker, role, self.manifest["api_image"], network
            )
            require(info["State"]["Running"] is True, "worker_exited_early")
            result = self.oneshot("state", network)
            if predicate(result):
                return result
            require(time.monotonic() < deadline, "worker_state_timeout")
            time.sleep(0.2)

    def exercise(self, provision_path, approval_path):
        provision = json.loads(Path(provision_path).read_text())
        approval = json.loads(Path(approval_path).read_text())
        validate_approval(approval, self.manifest_path, provision_path, self.files)
        require(
            provision["manifest_sha256"] == sha256(self.manifest_path),
            "provision_manifest_changed",
        )
        self.check_images()
        network, pg_id = provision["network_id"], provision["postgres_id"]
        self.gateway_network_id = provision.get("gateway_network_id")
        require(
            (self.gateway_network_id is not None) == self.host_gateway,
            "gateway_network_provision_boundary",
        )
        self.check_network(network)
        if self.host_gateway:
            self.check_network(self.gateway_network_id, "gateway-network")
        self.check_container(
            pg_id, "postgres", self.manifest["postgres_image"], network
        )
        identity = self.sql(pg_id, IDENTITY_SQL)
        require(identity == provision["database_identity"], "database_identity_changed")
        validate_empty(identity, self.database)
        write_json(self.report / "empty-before-migration.json", identity)
        self.oneshot("verify-source", network, stdin=json_bytes(self.files))
        self.oneshot("frozen-export", network)
        migration = self.oneshot("migrate", network)
        version = self.sql(pg_id, "SELECT to_json(version_num) FROM alembic_version;")
        require(version == self.manifest["migration_head"], "migration_head_mismatch")
        write_json(self.report / "migration.json", {"revision": version, **migration})
        missing = self.oneshot("seed-missing", network)
        api = self.create_app(
            "api",
            network,
            ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"],
        )
        self.api_id = api
        self.upstream = None
        started = time.monotonic()
        self.commands.call("start", api)
        self.check_container(api, "api", self.manifest["api_image"], network)
        gateway = self.create_host_gateway(network) if self.host_gateway else None
        deadline = time.monotonic() + 30
        while True:
            try:
                status, body = self.http("/api/health")
                if status == 200 and body == {"status": "ok", "service": "echo-talk"}:
                    break
            except (OSError, urllib.error.URLError):
                pass
            require(time.monotonic() < deadline, "api_health_timeout")
            time.sleep(0.2)
        health_ms = round((time.monotonic() - started) * 1000, 3)
        anonymous, _ = self.http("/api/sessions")
        require(anonymous == 401, "anonymous_auth_not_rejected")
        ready, body = self.http("/api/health/ready", authenticated=True)
        detail = body.get("detail", {})
        require(
            ready == 503 and detail.get("status") == "not_ready",
            "missing_key_not_rejected",
        )
        errors = detail.get("errors", {})
        require(
            set(errors) == {"livekit", "llm", "stt", "tts"}, "missing_key_wrong_failure"
        )
        try:
            host_status, host_body = self.host_http("/api/health")
            host_reachable = host_status == 200 and host_body == {
                "status": "ok",
                "service": "echo-talk",
            }
        except (OSError, urllib.error.URLError):
            host_reachable = False
        write_json(
            self.report / "http.json",
            {
                "health": 200,
                "anonymous": anonymous,
                "ready": ready,
                "ready_code": detail.get("code"),
                "error_fields": sorted(errors),
                "start_to_health_ms": health_ms,
                "http_transport": self.manifest["http_transport"],
                "host_loopback_health_verified": host_reachable,
                "host_loopback_limit": None
                if host_reachable
                else "internal network publication unavailable or unverified; no external bridge added",
                "gateway_id": gateway,
            },
        )
        worker = self.create_app(
            "worker-missing", network, ["python", "-B", "-m", "workers.analysis_worker"]
        )
        self.commands.call("start", worker)
        unsupported = self.wait_state(
            network,
            lambda state: any(
                j["session_id"] == missing["session_id"]
                and j["status"] == "failed"
                and j["last_error_code"] == "analysis_unsupported"
                and j["attempt_count"] == 1
                for j in state["jobs"]
            ),
            worker,
            "worker-missing",
        )
        require(
            not unsupported["assessments"]
            and not unsupported["grammar"]
            and unsupported["knowledge_count"] == 0,
            "unsupported_created_products",
        )
        exits = [self.stop(worker, "worker-missing", network)]
        stale = self.oneshot("seed-stale", network)
        write_json(self.report / "prepared-stale.json", stale)
        worker = self.create_app(
            "worker-demo",
            network,
            ["python", "-B", "-m", "workers.analysis_worker"],
            synthetic=True,
        )
        self.commands.call("start", worker)
        completed = self.wait_state(
            network,
            lambda state: any(
                j["session_id"] == stale["session_id"]
                and j["status"] == "succeeded"
                and j["attempt_count"] == 2
                for j in state["jobs"]
            ),
            worker,
            "worker-demo",
        )
        validate_products(completed)
        exits.append(self.stop(worker, "worker-demo", network))
        restarted = self.create_app(
            "worker-restarted",
            network,
            ["python", "-B", "-m", "workers.analysis_worker"],
            synthetic=True,
        )
        self.commands.call("start", restarted)
        time.sleep(2)
        repeated = self.oneshot("repeat-analysis", network, synthetic=True)
        final = self.oneshot("state", network)
        require(final == completed, "restart_or_repeat_changed_products")
        validate_products(final)
        exits.append(self.stop(restarted, "worker-restarted", network))
        if gateway is not None:
            gateway_exit = self.stop(gateway, "host-gateway", network)
            exits.append(gateway_exit)
            require(gateway_exit["exit"] == 0, "gateway_exit_nonzero")
        exits.append(self.stop(api, "api", network))
        write_json(
            self.report / "result.json",
            {
                "status": "passed",
                "scope": "prepared_expired_job_only",
                "unsupported": unsupported,
                "final_database": final,
                "repeat_analysis": repeated,
                "process_exits": exits,
                "postgres_left_for_owned_cleanup": pg_id,
            },
        )

    def cleanup(self):
        # Only explicit journal IDs from this manifest's two known directories.
        resources = []
        for directory in (self.root / "provision", self.root / "exercise"):
            for path in sorted(directory.glob("resource-*.json")):
                require(not path.is_symlink(), "journal_symlink")
                resources.append(json.loads(path.read_text()))
        existing = set(
            self.commands.call(
                "container", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"
            )
            .decode()
            .splitlines()
        )
        removed = []
        for resource in reversed(resources):
            require(
                resource["labels"] == self.expected(resource["labels"]["codex.role"]),
                "cleanup_label_boundary",
            )
            identity = resource["id"]
            require(RESOURCE_ID.fullmatch(identity), "cleanup_id_invalid")
            if resource["kind"] == "container" and identity in existing:
                require(
                    resource["image"]
                    in {self.manifest["api_image"], self.manifest["postgres_image"]},
                    "cleanup_image_boundary",
                )
                remove_container(
                    self.commands, identity, resource["labels"], resource["image"]
                )
                removed.append(identity)
            elif resource["kind"] == "network":
                info = self.check_network(identity, resource["labels"]["codex.role"])
                require(not info.get("Containers"), "network_has_remaining_members")
                self.commands.call("network", "rm", identity)
                removed.append(identity)
        write_json(self.report / "cleanup.json", {"removed_ids": removed})


def validate_products(state):
    require(len(state["jobs"]) == 2, "unexpected_jobs")
    require(
        len(state["assessments"]) == len(state["grammar"]) == 1,
        "duplicate_or_missing_products",
    )
    require(
        all(row["is_synthetic"] for row in state["assessments"] + state["grammar"]),
        "non_synthetic_product",
    )
    require(
        state["assessments"][0]["source"] == "demo_mock", "unexpected_assessment_source"
    )
    require(state["knowledge_count"] == 0, "synthetic_updated_real_knowledge")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["provision", "exercise", "cleanup"])
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--provision", type=Path)
    parser.add_argument("--approval", type=Path)
    parser.add_argument("--docker-context")
    args = parser.parse_args()
    report = None
    runtime = None
    report_created = False
    handlers = {}

    def interrupted(_signum, _frame):
        raise Refused("runtime_interrupted")

    try:
        manifest = json.loads(args.manifest.read_text())
        report = Path(manifest["report_root"]) / args.stage
        report.mkdir(parents=True, exist_ok=False)
        report_created = True
        for signum in (signal.SIGTERM, signal.SIGINT):
            handlers[signum] = signal.signal(signum, interrupted)
        runtime = Runtime(args.manifest, report, args.docker_context)
        if args.stage == "exercise":
            require(
                args.provision is not None and args.approval is not None,
                "approval_arguments_required",
            )
            runtime.exercise(args.provision, args.approval)
        else:
            getattr(runtime, args.stage)()
    except BaseException as exc:
        for signum in handlers:
            signal.signal(signum, signal.SIG_IGN)
        if runtime is not None:
            runtime.stop_owned_on_failure()
        if report_created:
            write_json(
                report / "failure.json",
                {
                    "error": str(exc)
                    if isinstance(exc, Refused)
                    else type(exc).__name__,
                    "services_may_remain": True,
                    "follow_up": "main must inspect explicit resource journals and run owned cleanup",
                },
            )
        parser.exit(
            1, "isolated runtime failed; inspect safe receipt and resource journals\n"
        )
    finally:
        for signum, handler in handlers.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    main()
