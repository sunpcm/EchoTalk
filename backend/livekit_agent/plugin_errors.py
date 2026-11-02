"""
LiveKit 插件与凭据异常定义 (RF-09)。
纯标准库定义，无 SDK / 网络 / 外部依赖。
"""


class PluginInitError(Exception):
    """插件初始化失败异常。用于自定义轨模式下的 fail-fast 报错。"""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")
