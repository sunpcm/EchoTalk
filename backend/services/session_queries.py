"""会话查询服务：游标分页、时间窗口校验与每日练习聚合。"""

import base64
import json
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.session import Session, SessionStatus, Transcript
from schemas.session import (
    DailyProgressResponse,
    SessionListItem,
    SessionListResponse,
)

_URLSAFE_B64_RE = re.compile(r"^[A-Za-z0-9_-]+={0,2}$")
_REQUIRED_CURSOR_KEYS = {"v", "u", "ep", "st", "s", "e", "t", "id"}


def validate_window(
    start: datetime | None,
    end: datetime | None,
    *,
    required: bool = False,
) -> tuple[datetime | None, datetime | None]:
    """严格校验并归一化时间窗口 (start <= started_at < end)。

    要求：
    - 成对提供（若非必填，要么同时为 None，要么同时提供）
    - 必须带有明确时区信息 (timezone-aware)
    - 归一化至 UTC
    - start < end
    - 窗口跨度 <= 48 小时以包容 DST 本地日
    """
    if required and (start is None or end is None):
        raise HTTPException(
            status_code=422,
            detail="start 和 end 时间窗口参数必填",
        )
    if (start is None) != (end is None):
        raise HTTPException(
            status_code=422,
            detail="start 和 end 必须成对提供",
        )
    if start is None and end is None:
        return None, None

    assert start is not None and end is not None

    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="时间窗口必须包含明确时区信息",
        )

    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)

    if start_utc >= end_utc:
        raise HTTPException(
            status_code=422,
            detail="start 时间必须早于 end 时间",
        )

    if end_utc - start_utc > timedelta(hours=48):
        raise HTTPException(
            status_code=422,
            detail="时间窗口跨度不能超过 48 小时",
        )

    return start_utc, end_utc


def encode_cursor(
    *,
    user_id: uuid.UUID,
    endpoint: str,
    status: str | None,
    start: datetime | None,
    end: datetime | None,
    started_at: datetime,
    session_id: uuid.UUID,
) -> str:
    """生成严格版本化 URL-safe base64 游标。长度严格 <= 1024。"""
    if started_at.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="started_at 必须包含明确时区信息",
        )
    started_at_utc = started_at.astimezone(timezone.utc)

    payload = {
        "v": 1,
        "u": str(user_id),
        "ep": endpoint,
        "st": status,
        "s": start.isoformat() if start else None,
        "e": end.isoformat() if end else None,
        "t": started_at_utc.isoformat(),
        "id": str(session_id),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(raw).decode("ascii")
    if len(encoded) > 1024:
        raise HTTPException(
            status_code=422,
            detail="Pagination cursor length exceeds limit",
        )
    return encoded


def decode_cursor(
    cursor: str,
    *,
    expected_user_id: uuid.UUID,
    expected_endpoint: str,
    expected_status: str | None,
    expected_start: datetime | None,
    expected_end: datetime | None,
) -> tuple[datetime, uuid.UUID]:
    """严格解码并验证游标。坏游标或上下文不匹配统一返回 422 安全错误。"""
    if not isinstance(cursor, str) or len(cursor) == 0 or len(cursor) > 1024:
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    # 严格验证 URL-safe base64 字符集与结构，防止宽松解码接受非法字符（如 !!）
    if not _URLSAFE_B64_RE.fullmatch(cursor):
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    # 规范化 padding 并解码
    padding = len(cursor) % 4
    padded_cursor = cursor + ("=" * (4 - padding) if padding != 0 else "")

    try:
        raw = base64.urlsafe_b64decode(padded_cursor.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    # 严格检查 JSON 键集合
    if set(payload.keys()) != _REQUIRED_CURSOR_KEYS:
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    # 严格验证版本必须是非 bool 的整数 1
    v = payload.get("v")
    if not (type(v) is int and not isinstance(v, bool) and v == 1):
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    if payload.get("u") != str(expected_user_id):
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    if payload.get("ep") != expected_endpoint:
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    if payload.get("st") != expected_status:
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    exp_s = expected_start.isoformat() if expected_start else None
    exp_e = expected_end.isoformat() if expected_end else None
    if payload.get("s") != exp_s or payload.get("e") != exp_e:
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    raw_t = payload.get("t")
    raw_id = payload.get("id")
    if not isinstance(raw_t, str) or not isinstance(raw_id, str):
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    try:
        dt = datetime.fromisoformat(raw_t)
        if dt.tzinfo is None:
            raise ValueError("Naive datetime in cursor")
        cursor_time = dt.astimezone(timezone.utc)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    try:
        cursor_id = uuid.UUID(raw_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")

    return cursor_time, cursor_id


async def paginate_sessions(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    endpoint: str,
    status: str | None,
    start: datetime | None,
    end: datetime | None,
    limit: int,
    cursor: str | None,
) -> SessionListResponse:
    """基于 started_at DESC, id DESC 执行稳定 keyset 分页查询。

    严格仅查询 SessionListItem 必要列 (id, mode, status, started_at, ended_at)，
    杜绝 selectin 级联触发 transcripts、context、analysis_job 关联查询。
    """
    stmt = select(
        Session.id,
        Session.mode,
        Session.status,
        Session.started_at,
        Session.ended_at,
    ).where(Session.user_id == user_id)

    if status is not None:
        try:
            status_enum = SessionStatus(status)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail=f"无效的 status 值: '{status}'",
            )
        stmt = stmt.where(Session.status == status_enum)

    if start is not None and end is not None:
        stmt = stmt.where(
            Session.started_at >= start,
            Session.started_at < end,
        )

    if cursor is not None:
        cursor_time, cursor_id = decode_cursor(
            cursor,
            expected_user_id=user_id,
            expected_endpoint=endpoint,
            expected_status=status,
            expected_start=start,
            expected_end=end,
        )
        seek_condition = or_(
            Session.started_at < cursor_time,
            and_(Session.started_at == cursor_time, Session.id < cursor_id),
        )
        stmt = stmt.where(seek_condition)

    stmt = stmt.order_by(Session.started_at.desc(), Session.id.desc()).limit(limit + 1)

    result = await db.execute(stmt)
    records = list(result.all())

    if len(records) > limit:
        items = records[:limit]
        last_item = items[-1]
        next_cursor = encode_cursor(
            user_id=user_id,
            endpoint=endpoint,
            status=status,
            start=start,
            end=end,
            started_at=last_item.started_at,
            session_id=last_item.id,
        )
    else:
        items = records
        next_cursor = None

    return SessionListResponse(
        items=[
            SessionListItem(
                id=r.id,
                mode=r.mode,
                status=r.status,
                started_at=r.started_at,
                ended_at=r.ended_at,
            )
            for r in items
        ],
        next_cursor=next_cursor,
    )


async def query_daily_progress(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    start: datetime,
    end: datetime,
) -> DailyProgressResponse:
    """单次服务端聚合指定窗口内已完成会话数及转录条数。

    - 仅统计 status=completed
    - 仅统计 start <= started_at < end
    - 含 0 条转录的 completed 会话计 1 会话、0 转录
    - 使用 distinct(Session.id) 防止因 join 多条转录导致会话数虚高
    - 统计所有角色的 transcript 条数
    - 零正文、零 N+1、不分页
    """
    stmt = (
        select(
            func.count(distinct(Session.id)).label("completed_sessions"),
            func.count(Transcript.id).label("total_turns"),
        )
        .select_from(Session)
        .outerjoin(Transcript, Transcript.session_id == Session.id)
        .where(
            Session.user_id == user_id,
            Session.status == SessionStatus.completed,
            Session.started_at >= start,
            Session.started_at < end,
        )
    )

    result = await db.execute(stmt)
    row = result.one()
    completed_sessions = int(row[0] or 0)
    total_turns = int(row[1] or 0)

    return DailyProgressResponse(
        completed_sessions=completed_sessions,
        total_turns=total_turns,
    )
