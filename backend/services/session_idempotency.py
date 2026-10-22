"""会话创建幂等服务。

提供 Idempotency-Key 解析、请求体指纹计算及相关辅助逻辑。
"""

import hashlib
import json
import uuid
from typing import Any

from fastapi import HTTPException
from fastapi.params import Header as HeaderParam

from schemas.session import SessionCreate


def is_idempotency_unique_violation(exc: BaseException) -> bool:
    """检查异常是否为 sessions.uq_sessions_user_idempotency_key 的唯一冲突。

    只接受 PostgreSQL unique_violation (SQLSTATE 23505) 且 constraint_name
    精确等于 'uq_sessions_user_idempotency_key'。
    沿着 orig, __cause__, __context__ 遍历检查结构化属性，严禁回退到宽泛文本匹配。
    """
    TARGET_CONSTRAINT = "uq_sessions_user_idempotency_key"
    TARGET_SQLSTATE = "23505"

    visited: set[int] = set()
    queue: list[Any] = [exc]

    while queue:
        curr = queue.pop(0)
        curr_id = id(curr)
        if curr_id in visited:
            continue
        visited.add(curr_id)

        sqlstate = getattr(curr, "sqlstate", None) or getattr(curr, "pgcode", None)
        constraint = getattr(curr, "constraint_name", None)
        if sqlstate == TARGET_SQLSTATE and constraint == TARGET_CONSTRAINT:
            return True

        for attr in ("orig", "__cause__", "__context__"):
            val = getattr(curr, attr, None)
            if val is not None and id(val) not in visited:
                queue.append(val)

    return False


def parse_idempotency_key(key: Any) -> uuid.UUID | None:
    """解析并校验可选的 Idempotency-Key。

    - 若为 None 或 FastAPI 默认 Header 对象，返回 None（表示不启用幂等）；
    - 若为有效 UUID 字符串或 uuid.UUID 对象，返回规范化的 uuid.UUID；
    - 若为非法值，抛出 400 异常。
    """
    if key is None or isinstance(key, HeaderParam):
        return None
    if isinstance(key, uuid.UUID):
        return key
    if isinstance(key, str):
        val = key.strip()
        if not val:
            raise HTTPException(
                status_code=400,
                detail="Idempotency-Key 格式无效，必须为有效 UUID",
            )
        try:
            return uuid.UUID(val)
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=400,
                detail="Idempotency-Key 格式无效，必须为有效 UUID",
            )
    raise HTTPException(
        status_code=400,
        detail="Idempotency-Key 格式无效，必须为有效 UUID",
    )


def compute_session_fingerprint(body: SessionCreate) -> str:
    """基于规范化请求体计算 SHA-256 指纹。

    保证 mode 以及 doc_context 默认字段（content_type 等）参与序列化，
    通过稳定排序的 JSON 字符串进行哈希。
    """
    doc_ctx_dict = None
    if body.doc_context is not None:
        doc_ctx_dict = {
            "content_type": body.doc_context.content_type,
            "prompt": body.doc_context.prompt,
            "raw_text": body.doc_context.raw_text,
        }

    canonical_data = {
        "doc_context": doc_ctx_dict,
        "mode": body.mode,
    }
    canonical_json = json.dumps(
        canonical_data,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
