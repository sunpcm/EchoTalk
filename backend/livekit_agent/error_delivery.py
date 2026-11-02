"""
EchoTalk LiveKit Agent 安全错误发送与断连共享出口 (RF-09)。

单一职责：
1. 调用 AgentErrorMapper 将错误码与消息映射为白名单静态安全文案，清洗 session_id。
2. 通过 DataChannel (reliable=True, topic="agent_error") 向客户端发送 UTF-8 JSON 错误载荷。
3. 普通 publish 异常仅记录静态安全警告，随后继续执行房间断连。
4. publish 阶段 CancelledError 与 disconnect 阶段异常原样向上传播。
5. 仅依赖 Python 标准库与 AgentErrorMapper，不读取配置、数据库或凭据，不反向导入 agent 或 orchestrator。
"""

import json
import logging
from typing import Any

from livekit_agent.error_mapper import AgentErrorMapper

logger = logging.getLogger("echotalk-agent")


async def send_error_and_disconnect(
    ctx: Any,
    code: str,
    message: str | None = None,
    fallback_code: str = "ERR_SYSTEM_RUNTIME",
) -> None:
    """
    通过 DataChannel 向客户端发送安全错误 JSON，然后断开房间连接。

    错误载荷格式:
        {"type": "agent_error", "code": "<CODE>", "message": "<描述>"}

    发送使用 reliable=True（TCP 语义保证送达）和 topic="agent_error"
    （前端可按 topic 过滤订阅）。

    参数:
        ctx: LiveKit JobContext（已连接到房间）
        code: 机器可读错误码，如 "ERR_CUSTOM_KEY_INVALID"
        message: 传入描述（将通过 AgentErrorMapper 强制转换为安全静态描述）
        fallback_code: code 不在白名单时的兜底错误码
    """
    safe_code, safe_message = AgentErrorMapper.map_error(
        code, message, fallback_code=fallback_code
    )
    safe_session_id = AgentErrorMapper.sanitize_session_id(
        getattr(getattr(ctx, "room", None), "name", None)
    )

    payload = json.dumps(
        {"type": "agent_error", "code": safe_code, "message": safe_message},
        ensure_ascii=False,
    )
    try:
        await ctx.room.local_participant.publish_data(
            payload=payload,
            reliable=True,
            topic="agent_error",
        )
        logger.info("已发送错误消息到客户端: code=%s", safe_code)
    except Exception:
        logger.warning("发送错误消息到客户端失败")

    await ctx.room.disconnect()
    logger.info("已断开房间连接: session=%s, code=%s", safe_session_id, safe_code)
