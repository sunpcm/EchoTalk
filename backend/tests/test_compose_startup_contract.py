"""Compose 启动门禁契约测试（方案 B，纯静态配置验证）。

验证 docker-compose.yml 归一化后的编排语义：
- 一次性迁移服务 echotalk-migrate 使用 API 角色镜像（含 alembic），restart=no，
  先等 echotalk-postgres healthy，命令 alembic upgrade head；
- API / analysis-worker / 需要 DB 的 agent 在迁移成功（service_completed_successfully）后启动；
- echotalk-api 的匿名 healthcheck 使用公开 /api/health（Python 标准库、有限 timeout）；
- echotalk-web 依赖 echotalk-api service_healthy。

只调用真实 `docker compose config`（--format json + --no-env-resolution），显式
--env-file 指向自己生成的 synthetic-vars.txt（非 .env 名）并清理环境，绝不执行
up/build/run/start、alembic 迁移、连接数据库或任何容器。healthcheck 脚本仅 compile
静态验证，绝不 exec 或发起网络连接。
"""

import ast
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

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


def _is_urlopen(func: ast.expr) -> bool:
    """识别标准库 `urllib.request.urlopen(...)` 调用（非其他同名函数）。"""
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "urlopen"
        and isinstance(func.value, ast.Attribute)
        and func.value.attr == "request"
        and isinstance(func.value.value, ast.Name)
        and func.value.value.id == "urllib"
    )


def _find_urlopen_calls(script: str) -> list[ast.Call]:
    tree = ast.parse(script, mode="exec")
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and _is_urlopen(node.func)
    ]


def _literal_str(node: ast.expr | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _literal_number(node: ast.expr | None) -> int | float | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    return None


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


def test_api_healthcheck_is_anonymous_and_compiles() -> None:
    services = _config()["services"]
    hc = services["echotalk-api"].get("healthcheck", {})
    assert hc, "echotalk-api 缺少 healthcheck"
    test_cmd = hc.get("test")
    assert isinstance(test_cmd, list) and test_cmd and test_cmd[0] == "CMD", test_cmd
    assert test_cmd[1] == "python" and test_cmd[2] == "-c", test_cmd
    script = test_cmd[3]

    # 仅静态 compile/AST，绝不 exec 或发起网络连接。
    compile(script, "<echotalk-api-healthcheck>", "exec")

    calls = _find_urlopen_calls(script)
    assert calls, "healthcheck 未使用标准库 urllib.request.urlopen"
    assert len(calls) == 1, "healthcheck 应只调用一次 urlopen，实际 {}".format(
        len(calls)
    )
    call = calls[0]

    # 匿名请求：第一个位置参数必须是普通字符串 URL，而非携带认证头的 Request 对象。
    assert call.args, "urlopen 缺少目标参数"
    url = _literal_str(call.args[0])
    assert url is not None, "urlopen 目标必须是字符串常量，实际 {}".format(
        ast.dump(call.args[0])
    )

    # 精确解析实际 health 目标，避免 `/api/health` 子串误判（如 health-missing-endpoint）。
    parsed = urlsplit(url)
    assert parsed.scheme == "http", url
    assert parsed.hostname == "localhost", url
    assert parsed.port == 8000, url
    assert parsed.path == "/api/health", url
    assert parsed.query == "" and parsed.fragment == "", url

    # HTTP timeout 必须为正有限数值。
    timeout: int | float | None = None
    for kw in call.keywords:
        if kw.arg == "timeout":
            timeout = _literal_number(kw.value)
            break
    assert timeout is not None, "healthcheck 缺少显式 HTTP timeout"
    assert timeout > 0 and math.isfinite(float(timeout)), timeout

    assert hc.get("timeout"), hc


def test_interpolation_uses_synthetic_env_file_not_default_dotenv() -> None:
    services = _config()["services"]
    web_args = services[WEB]["build"]["args"]
    assert web_args["VITE_AUTH_MODE"] == "oidc", web_args
