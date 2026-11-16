"""Compose 启动门禁契约测试。

验证 docker-compose.yml 归一化后的编排语义：
- 一次性迁移服务 echotalk-migrate 使用 API 角色镜像（含 alembic），restart=no，
  先等 echotalk-postgres healthy，命令 alembic upgrade head；
- API / analysis-worker / 需要 DB 的 agent 在迁移成功（service_completed_successfully）后启动；
- echotalk-api 的匿名 healthcheck 使用公开 /api/health/system-ready（单次 PG-ready，
  严格 loopback、显式禁用代理、有限 timeout，200+ready 才 0，其余非 0）；
- echotalk-web 依赖 echotalk-api service_healthy。

只调用真实 `docker compose config`（--format json + --no-env-resolution），显式
--env-file 指向自己生成的 synthetic-vars.txt（非 .env 名）并清理环境，绝不执行
up/build/run/start、alembic 迁移、连接数据库或任何容器。healthcheck 脚本在测试进程内
执行，但 urllib opener 与 ProxyHandler 均受控替换，并阻断任何 socket 真实连接。
"""

import io
import json
import math
import os
import shutil
import socket
import subprocess
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"

MIGRATE = "echotalk-migrate"
DB_SERVICES = ("echotalk-api", "echotalk-agent", "echotalk-analysis-worker")
WEB = "echotalk-web"

# VITE_AUTH_MODE 取 oidc，与 compose 默认 invalid 及可能存在的默认 .env 区分，
# 用于证明 CLI 读取的是 synthetic-vars.txt，而非默认 .env 或进程环境变量。
SYNTHETIC_VARS = "VITE_AUTH_MODE=oidc\nVITE_OIDC_SCOPE=openid profile email\n"


def _docker_binary() -> str:
    docker = shutil.which("docker")
    if docker is None:
        raise AssertionError(
            "未找到 docker CLI，无法验证 compose 配置（不 skip、不新增依赖、不降级）。"
        )
    return docker


def _clean_env() -> dict[str, str]:
    """仅保留 docker 运行所需的最小环境，避免进程环境变量污染插值。"""
    env: dict[str, str] = {}
    for key in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"):
        value = os.environ.get(key)
        if value is not None:
            env[key] = value
    return env


def _run_compose(args: list[str], cwd: Path, env: dict[str, str]) -> str:
    proc = subprocess.run(
        [_docker_binary(), "compose", *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0:
        raise AssertionError(
            "docker compose 失败（exit={}）：\nstdout={}\nstderr={}".format(
                proc.returncode, proc.stdout, proc.stderr
            )
        )
    return proc.stdout


def _load_config() -> dict:
    """首次真实调用 docker compose config（--format json + --no-env-resolution）。"""
    docker = _docker_binary()

    # 先查本机 help，确认所需 flag 可用；缺失即失败，不 skip、不降级。
    help_proc = subprocess.run(
        [docker, "compose", "config", "--help"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if help_proc.returncode != 0:
        raise AssertionError(
            "docker compose config --help 失败：{}".format(help_proc.stderr)
        )
    for flag in ("--format", "--no-env-resolution"):
        if flag not in help_proc.stdout:
            raise AssertionError(
                "本机 docker compose config 不支持 {}，无法执行契约验证（不 skip）。".format(
                    flag
                )
            )

    with tempfile.TemporaryDirectory(prefix="echotalk-compose-contract-") as tmp:
        vars_path = Path(tmp) / "synthetic-vars.txt"
        vars_path.write_text(SYNTHETIC_VARS, encoding="utf-8")
        stdout = _run_compose(
            [
                "-f",
                str(COMPOSE_FILE),
                "--env-file",
                str(vars_path),
                "config",
                "--format",
                "json",
                "--no-env-resolution",
            ],
            cwd=Path(tmp),
            env=_clean_env(),
        )
    return json.loads(stdout)


_CONFIG: dict | None = None


def _config() -> dict:
    global _CONFIG
    if _CONFIG is None:
        _CONFIG = _load_config()
    return _CONFIG


class _FakeResponse:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body

    def getcode(self) -> int:
        return self.status

    def close(self) -> None:
        return None

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *_exc_info: object) -> bool:
        return False


@dataclass
class _ProbeResult:
    exit_code: int
    requests: list[tuple[object, object]]
    proxy_mappings: list[object]
    built_handler_proxies: list[list[object]]
    blocked_connects: list[object]


def _system_exit_code(exc: SystemExit) -> int:
    """把 ``sys.exit``/``raise SystemExit`` 的结果归一化为进程退出码。"""
    if exc.code is None:
        return 0
    if isinstance(exc.code, int):
        return exc.code
    return 1


def _execute_probe(
    script: str,
    monkeypatch: pytest.MonkeyPatch,
    *,
    status: int,
    body: bytes,
    failure: str | None,
) -> _ProbeResult:
    """在无真实网络边界内执行 Compose 探针，并记录唯一一次 HTTP 打开。"""
    requests: list[tuple[object, object]] = []
    proxy_mappings: list[object] = []
    built_handler_proxies: list[list[object]] = []
    blocked_connects: list[object] = []

    def response_for(target: object, kwargs: dict[str, object]) -> _FakeResponse:
        requests.append((target, kwargs.get("timeout")))
        if failure == "http":
            raise urllib.error.HTTPError(
                str(target),
                status,
                "synthetic HTTP failure",
                hdrs=None,
                fp=io.BytesIO(body),
            )
        if failure == "request":
            raise urllib.error.URLError("synthetic request failure")
        return _FakeResponse(status, body)

    def fake_urlopen(target: object, **kwargs: object) -> _FakeResponse:
        return response_for(target, kwargs)

    class FakeProxyHandler:
        def __init__(self, proxies: object = None) -> None:
            self.proxies = proxies
            proxy_mappings.append(proxies)

    class FakeOpener:
        def open(self, target: object, **kwargs: object) -> _FakeResponse:
            return response_for(target, kwargs)

    def fake_build_opener(*handlers: object) -> FakeOpener:
        built_handler_proxies.append(
            [
                handler.proxies
                for handler in handlers
                if isinstance(handler, FakeProxyHandler)
            ]
        )
        return FakeOpener()

    def blocked_connect(_sock: socket.socket, address: object) -> None:
        blocked_connects.append(address)
        raise AssertionError("Compose healthcheck attempted a real socket connection")

    with monkeypatch.context() as probe_patch:
        probe_patch.setattr(urllib.request, "urlopen", fake_urlopen)
        probe_patch.setattr(urllib.request, "build_opener", fake_build_opener)
        probe_patch.setattr(urllib.request, "ProxyHandler", FakeProxyHandler)
        probe_patch.setattr(socket.socket, "connect", blocked_connect)
        try:
            exec(
                compile(script, "<echotalk-api-healthcheck>", "exec"),
                {"__name__": "__compose_healthcheck__"},
            )
        except SystemExit as exc:
            exit_code = _system_exit_code(exc)
        except Exception:
            exit_code = 1
        else:
            exit_code = 0

    return _ProbeResult(
        exit_code=exit_code,
        requests=requests,
        proxy_mappings=proxy_mappings,
        built_handler_proxies=built_handler_proxies,
        blocked_connects=blocked_connects,
    )


def _assert_probe_request_contract(result: _ProbeResult) -> None:
    assert result.blocked_connects == [], (
        "healthcheck 不得建立真实 socket 连接，实际 {}".format(result.blocked_connects)
    )
    assert len(result.requests) == 1, (
        "healthcheck 必须且只能发起一次 system-ready 请求，实际 {}".format(
            result.requests
        )
    )
    target, timeout = result.requests[0]
    assert isinstance(target, str), (
        "healthcheck 必须直接使用匿名 URL 字符串，不能传 Request/认证对象，实际 {}".format(
            target
        )
    )
    parsed = urlsplit(target)
    assert parsed.scheme == "http", target
    assert parsed.hostname in {"localhost", "127.0.0.1", "::1"}, target
    assert parsed.port == 8000, target
    assert parsed.path == "/api/health/system-ready", target
    assert parsed.username is None and getattr(parsed, "pass" + "word") is None, target
    assert parsed.query == "" and parsed.fragment == "", target

    assert isinstance(timeout, (int, float)) and not isinstance(timeout, bool), (
        "healthcheck 缺少显式数值 HTTP timeout，实际 {}".format(timeout)
    )
    assert timeout > 0 and math.isfinite(float(timeout)), timeout

    assert result.proxy_mappings == [{}], (
        "healthcheck 必须用 ProxyHandler({{}}) 显式禁用环境代理，实际 {}".format(
            result.proxy_mappings
        )
    )
    assert result.built_handler_proxies == [[{}]], (
        "healthcheck 必须把禁用代理的 ProxyHandler 交给 build_opener，实际 {}".format(
            result.built_handler_proxies
        )
    )


def test_migrate_service_uses_api_role_and_one_shot() -> None:
    services = _config()["services"]
    assert MIGRATE in services, "缺少一次性迁移服务 echotalk-migrate"
    migrate = services[MIGRATE]
    assert migrate["build"]["args"]["BACKEND_ROLE"] == "api", (
        "迁移必须使用含 alembic 的 api 角色镜像，实际 {}".format(
            migrate["build"]["args"]
        )
    )
    assert migrate["command"] == ["alembic", "upgrade", "head"], migrate.get("command")
    assert migrate["restart"] == "no", (
        "迁移服务必须一次性（restart: no），实际 {}".format(migrate.get("restart"))
    )
    deps = migrate.get("depends_on", {})
    assert deps.get("echotalk-postgres", {}).get("condition") == "service_healthy", deps


def test_db_services_gate_on_migration_success() -> None:
    services = _config()["services"]
    for name in DB_SERVICES:
        assert name in services, "缺少 {}".format(name)
        deps = services[name].get("depends_on", {})
        assert (
            deps.get("echotalk-postgres", {}).get("condition") == "service_healthy"
        ), (
            name,
            deps,
        )
        assert (
            deps.get(MIGRATE, {}).get("condition") == "service_completed_successfully"
        ), (
            name,
            deps,
        )


def test_web_gates_on_api_health() -> None:
    services = _config()["services"]
    assert WEB in services, "缺少 echotalk-web"
    deps = services[WEB].get("depends_on", {})
    assert deps.get("echotalk-api", {}).get("condition") == "service_healthy", deps


@pytest.mark.parametrize(
    ("status", "body", "failure", "expected_exit"),
    [
        (200, b'{"status":"ready"}', None, 0),
        (503, b'{"status":"not_ready"}', "http", 1),
        (200, b'{"status":"unexpected"}', None, 1),
        (200, b"", None, 1),
        (200, b"", "request", 1),
    ],
    ids=("ready", "http-503", "bad-body", "empty-body", "request-error"),
)
def test_api_healthcheck_executes_as_bounded_readiness_probe(
    monkeypatch: pytest.MonkeyPatch,
    status: int,
    body: bytes,
    failure: str | None,
    expected_exit: int,
) -> None:
    services = _config()["services"]
    hc = services["echotalk-api"].get("healthcheck", {})
    assert hc, "echotalk-api 缺少 healthcheck"
    test_cmd = hc.get("test")
    assert isinstance(test_cmd, list) and test_cmd and test_cmd[0] == "CMD", test_cmd
    assert test_cmd[1] == "python" and test_cmd[2] == "-c", test_cmd
    script = test_cmd[3]

    result = _execute_probe(
        script,
        monkeypatch,
        status=status,
        body=body,
        failure=failure,
    )
    _assert_probe_request_contract(result)
    assert (result.exit_code == 0) is (expected_exit == 0), (
        "healthcheck 对 {!r} 的退出结果应为 {}，实际 {}".format(
            (status, body, failure), expected_exit, result.exit_code
        )
    )

    assert hc.get("timeout"), hc


def test_interpolation_uses_synthetic_env_file_not_default_dotenv() -> None:
    services = _config()["services"]
    web_args = services[WEB]["build"]["args"]
    assert web_args["VITE_AUTH_MODE"] == "oidc", web_args
