"""LiveKit Agent 显式启动边界。

本模块导入时不读取 dotenv、不加载应用配置，也不启动 SDK CLI。所有启动副作用
仅在调用 :func:`main` 后按固定顺序发生。
"""

from pathlib import Path

from dotenv import load_dotenv


def _project_root() -> Path:
    """返回 backend/livekit_agent/bootstrap.py 对应的仓库根目录。"""
    return Path(__file__).resolve().parents[2]


def main(*, dotenv_path: Path | None = None) -> None:
    """加载项目 dotenv 与真实配置后启动 LiveKit Agent CLI。"""
    effective_dotenv_path = dotenv_path or (_project_root() / ".env")
    load_dotenv(effective_dotenv_path, override=False)

    from config import settings

    settings.validate_runtime()

    from livekit.agents import WorkerOptions, cli

    from livekit_agent.agent import entrypoint

    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            num_idle_processes=1,  # 预热一个进程，减少首次任务启动延迟
        ),
    )
