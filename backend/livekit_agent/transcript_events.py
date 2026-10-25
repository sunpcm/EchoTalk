"""LiveKit Agent 转录事件 ID 稳定派生工具 (RF-09)。

纯标准库实现，无 DB、无 SDK、无网络副作用。
以 SDK ChatMessage.id 稳定派生 UUID5，确保同 item 重发 eventID 相同，
不同 item/session/role 域隔离。
"""

import logging
import uuid

logger = logging.getLogger("echotalk-agent")

# 专用于转录事件 UUID5 派生的命名空间 UUID
TRANSCRIPT_EVENT_NAMESPACE = uuid.UUID("a4300000-0000-5000-a000-000000000001")


def derive_transcript_event_id(
    session_id: str | uuid.UUID | None,
    role: str | None,
    source_item_id: str | None,
) -> uuid.UUID | None:
    """根据 session_id、role 与 SDK ChatMessage.id 稳定派生 UUID5 事件标识符。

    约束:
    1. source_item_id 必须为非空非全空白字符串，非法或缺失时返回 None，不降级为无 key 写入。
    2. session_id 必须能成功解析为 UUID，非法时返回 None。
    3. role 必须在 ("user", "assistant") 中，非法时返回 None。
    4. 编码为 session_uuid:role:source_item_id，实现 session 与 role 严格域隔离。
    5. 安全日志: 错误时不打印未知正文、原始 source_item_id 或敏感参数。
    """
    if (
        not source_item_id
        or not isinstance(source_item_id, str)
        or not source_item_id.strip()
    ):
        logger.warning("转录事件缺少有效 source_item_id，拒绝写入")
        return None

    if not role or role not in ("user", "assistant"):
        logger.warning("转录事件 role 非法，拒绝写入")
        return None

    try:
        if isinstance(session_id, uuid.UUID):
            sid = session_id
        elif isinstance(session_id, str):
            sid = uuid.UUID(session_id.strip())
        else:
            logger.warning("转录事件 session_id 类型非法")
            return None
    except Exception:
        logger.warning("转录事件 session_id 格式非法")
        return None

    name = f"{sid}:{role}:{source_item_id}"
    return uuid.uuid5(TRANSCRIPT_EVENT_NAMESPACE, name)
