"""RF-09 Agent 显式启动与无导入副作用回归。"""

import os
import subprocess
import sys
import textwrap
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from livekit_agent import bootstrap

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent


def _child_environment() -> dict[str, str]:
    """只向子进程传递运行 Python 所需的本机环境，不继承应用凭据。"""
    inherited_names = ("PATH", "LANG", "LC_ALL", "TMPDIR")
    child_env = {
        name: os.environ[name] for name in inherited_names if name in os.environ
    }
    child_env.update(
        {
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONIOENCODING": "utf-8",
        }
    )
    return child_env


def _run_child(script: str, *, timeout: float = 30.0) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-B", "-c", textwrap.dedent(script)],
        cwd=BACKEND_DIR,
        env=_child_environment(),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def test_project_root_resolves_repository_dotenv_location():
    """默认启动路径必须以仓根为基准，与旧 backend/livekit_agent 布局保持一致。"""
    assert bootstrap._project_root() == REPO_ROOT


def test_agent_runtime_dependency_wrappers_reach_current_modules(monkeypatch):
    """Agent 窄 wrapper 在调用时不缓存旧模块对象。"""
    from livekit_agent.agent import (
        _get_async_session_maker,
        _get_runtime_settings,
    )

    session_factory = object()
    runtime_settings = object()
    database_module = types.ModuleType("database")
    database_module.async_session_maker = session_factory
    config_module = types.ModuleType("config")
    config_module.settings = runtime_settings

    with monkeypatch.context() as module_patch:
        module_patch.setitem(sys.modules, "database", database_module)
        module_patch.setitem(sys.modules, "config", config_module)
        assert _get_async_session_maker() is session_factory
        assert _get_runtime_settings() is runtime_settings


def test_agent_module_tree_import_has_no_dotenv_config_database_or_network_effects():
    """真实新进程导入全套 Agent 模块，SDK 必须真实且无启动副作用。"""
    result = _run_child(
        """
        import importlib
        import os
        import sys
        from pathlib import Path

        root = Path.cwd().parent
        env_before = dict(os.environ)
        path_before = tuple(sys.path)

        import dotenv

        load_calls = []

        def forbidden_load_dotenv(*args, **kwargs):
            load_calls.append((args, kwargs))
            raise AssertionError("dotenv loader must not run during imports")

        dotenv.load_dotenv = forbidden_load_dotenv

        def guard(event, args):
            if event in {"socket.connect", "socket.getaddrinfo"}:
                raise AssertionError(f"network access blocked during import: {event}")
            if event != "open" or not args:
                return
            try:
                opened = os.path.normpath(os.fspath(args[0]))
            except TypeError:
                return
            if os.path.basename(opened) == ".env":
                raise AssertionError(
                    f"dotenv file access blocked during import: {opened}"
                )

        sys.addaudithook(guard)

        module_names = sorted(
            path.stem for path in Path("livekit_agent").glob("*.py")
        )
        for name in module_names:
            importlib.import_module(f"livekit_agent.{name}")

        forbidden_modules = {
            "config",
            "database",
            "services.llm_service",
            "services.transcript_service",
            "utils.crypto",
        }
        loaded = sorted(forbidden_modules.intersection(sys.modules))
        assert loaded == [], loaded
        assert load_calls == []
        assert dict(os.environ) == env_before
        assert tuple(sys.path) == path_before

        sdk_file = Path(sys.modules["livekit.agents"].__file__).resolve()
        assert "site-packages/livekit/agents" in sdk_file.as_posix()
        print("agent-import-boundary-ok")
        """
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "agent-import-boundary-ok"


def test_importing_module_entrypoint_does_not_call_bootstrap_main():
    """导入 ``livekit_agent.__main__`` 只绑定函数，不执行启动链路。"""
    result = _run_child(
        """
        import sys

        import dotenv

        calls = []

        def record_load(*args, **kwargs):
            calls.append((args, kwargs))

        dotenv.load_dotenv = record_load
        import livekit_agent.__main__

        assert calls == []
        assert "config" not in sys.modules
        assert "database" not in sys.modules
        print("module-import-ok")
        """,
        timeout=15.0,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "module-import-ok"


class _RecordingModule(types.ModuleType):
    def __init__(self, name: str, event: str, events: list[str], **exports):
        super().__init__(name)
        self._event = event
        self._events = events
        self._exports = exports

    def __getattr__(self, name: str):
        if name not in self._exports:
            raise AttributeError(name)
        self._events.append(self._event)
        return self._exports[name]


def test_main_loads_dotenv_then_config_sdk_and_cli_with_process_env_precedence(
    tmp_path, monkeypatch
):
    """显式启动顺序固定，且进程注入值优先于合成 dotenv 文件。"""
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text("A75_ENV_PROBE=dotenv-value\n", encoding="utf-8")
    monkeypatch.setenv("A75_ENV_PROBE", "process-value")

    events: list[str] = []
    real_load_dotenv = bootstrap.load_dotenv

    def recording_load_dotenv(*args, **kwargs):
        events.append("dotenv")
        return real_load_dotenv(*args, **kwargs)

    monkeypatch.setattr(bootstrap, "load_dotenv", recording_load_dotenv)

    runtime_settings = MagicMock()
    runtime_settings.validate_runtime.side_effect = lambda: events.append("validate")
    config_module = _RecordingModule(
        "config",
        "config",
        events,
        settings=runtime_settings,
    )

    worker_calls: list[dict] = []

    class WorkerOptions:
        def __init__(self, **kwargs):
            events.append("worker-options")
            worker_calls.append(kwargs)
            self.__dict__.update(kwargs)

    cli = MagicMock()
    cli.run_app.side_effect = lambda server: events.append("run-app")
    agents_module = _RecordingModule(
        "livekit.agents",
        "sdk",
        events,
        WorkerOptions=WorkerOptions,
        cli=cli,
    )

    entrypoint = object()
    agent_module = _RecordingModule(
        "livekit_agent.agent",
        "agent",
        events,
        entrypoint=entrypoint,
    )

    with monkeypatch.context() as module_patch:
        module_patch.setitem(sys.modules, "config", config_module)
        module_patch.setitem(sys.modules, "livekit.agents", agents_module)
        module_patch.setitem(sys.modules, "livekit_agent.agent", agent_module)
        bootstrap.main(dotenv_path=dotenv_path)

    assert os.environ["A75_ENV_PROBE"] == "process-value"
    assert events.index("dotenv") < events.index("validate")
    assert events.index("validate") < events.index("sdk")
    assert events.index("sdk") < events.index("agent")
    assert events.index("agent") < events.index("worker-options")
    assert events.index("worker-options") < events.index("run-app")
    assert worker_calls == [
        {
            "entrypoint_fnc": entrypoint,
            "num_idle_processes": 1,
        }
    ]
    cli.run_app.assert_called_once()


def test_main_does_not_start_cli_when_runtime_config_validation_fails(
    tmp_path, monkeypatch
):
    """真实配置验证失败时不得导入或启动 Agent SDK CLI。"""
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text("A75_FAILURE_PROBE=loaded\n", encoding="utf-8")

    events: list[str] = []
    monkeypatch.setattr(
        bootstrap,
        "load_dotenv",
        lambda *args, **kwargs: events.append("dotenv"),
    )
    runtime_settings = MagicMock()
    runtime_settings.validate_runtime.side_effect = RuntimeError("invalid runtime")
    config_module = _RecordingModule(
        "config",
        "config",
        events,
        settings=runtime_settings,
    )
    agents_module = _RecordingModule("livekit.agents", "sdk", events)
    agent_module = _RecordingModule("livekit_agent.agent", "agent", events)

    with monkeypatch.context() as module_patch:
        module_patch.setitem(sys.modules, "config", config_module)
        module_patch.setitem(sys.modules, "livekit.agents", agents_module)
        module_patch.setitem(sys.modules, "livekit_agent.agent", agent_module)
        with pytest.raises(RuntimeError, match="invalid runtime"):
            bootstrap.main(dotenv_path=dotenv_path)

    assert "sdk" not in events
    assert "agent" not in events
