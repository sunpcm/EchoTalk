"""通话租约服务：单端通话互斥、状态管理与 Cloud 参与者撤销。"""

import asyncio
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from livekit.api import LiveKitAPI
from livekit.protocol.room import RoomParticipantIdentity
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.call_lease import CallLease, CallLeaseState
from models.session import Session, SessionStatus
from models.user import User

logger = logging.getLogger(__name__)

LEASE_TTL_SECONDS = 90
CLOUD_TIMEOUT_SECONDS = 3.0


def is_lock_not_available(exc: BaseException) -> bool:
    """检查异常是否为 PostgreSQL lock_not_available (SQLSTATE 55P03)。

    只接受 PostgreSQL lock_not_available (SQLSTATE 55P03)。
    沿着 orig, __cause__, __context__ 遍历检查结构化属性，严禁回退到宽泛文本匹配。
    """
    TARGET_SQLSTATE = "55P03"
    visited: set[int] = set()
    queue: list[Any] = [exc]

    while queue:
        curr = queue.pop(0)
        curr_id = id(curr)
        if curr_id in visited:
            continue
        visited.add(curr_id)

        sqlstate = getattr(curr, "sqlstate", None) or getattr(curr, "pgcode", None)
        if sqlstate == TARGET_SQLSTATE:
            return True

        for attr in ("orig", "__cause__", "__context__"):
            val = getattr(curr, attr, None)
            if val is not None and id(val) not in visited:
                queue.append(val)

    return False


async def lock_user_for_call_lease(db: AsyncSession, user_id: uuid.UUID) -> User:
    """以 FOR UPDATE NOWAIT 锁定当前 User 行，作为统一锁序的第一步。

    同账号并发快速失败并映射为 409 call_lease_busy，不同用户互不串行。
    """
    try:
        stmt = select(User).where(User.id == user_id).with_for_update(nowait=True)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=401, detail="User not found.")
        return user
    except (DBAPIError, OperationalError) as exc:
        if is_lock_not_available(exc):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "call_lease_busy",
                    "message": "Call lease is busy, retry later",
                },
            ) from exc
        raise


async def revoke_cloud_participant(
    room_name: str,
    identity: str,
    revoke_cutoff: int,
    timeout: float = CLOUD_TIMEOUT_SECONDS,
) -> None:
    """调用 LiveKitAPI 移除旧参与者并撤销其 Token。

    契约规定：
    RemoveParticipant(RoomParticipantIdentity(room=旧session UUID, identity=旧user:generation, revoke_token_ts=floor(UTC now)+30))。
    API 确认成功才继续；任何错误（含 not-found 或超时）都按撤销未确认处理并抛出 502 call_provider_unavailable。
    绝不回显 SDK 错误或凭据内容。
    """
    try:
        async with asyncio.timeout(timeout):
            async with LiveKitAPI(
                url=settings.LIVEKIT_URL,
                api_key=settings.LIVEKIT_API_KEY,
                api_secret=settings.LIVEKIT_API_SECRET,
            ) as lk_api:
                req = RoomParticipantIdentity(
                    room=room_name,
                    identity=identity,
                    revoke_token_ts=revoke_cutoff,
                )
                await lk_api.room.remove_participant(req)
    except Exception as exc:
        logger.warning(
            "Cloud revoke participant failed or timed out: %s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail={
                "code": "call_provider_unavailable",
                "message": "Failed to revoke participant on provider",
            },
        ) from exc


async def get_or_create_lease(db: AsyncSession, user_id: uuid.UUID) -> CallLease:
    """获取或初始化用户的 CallLease 记录（一用户一行）。"""
    stmt = select(CallLease).where(CallLease.user_id == user_id)
    lease = (await db.execute(stmt)).scalar_one_or_none()
    if lease is None:
        lease = CallLease(
            user_id=user_id,
            session_id=None,
            device_id=None,
            generation=0,
            state=CallLeaseState.free.value,
            expires_at=None,
        )
        db.add(lease)
        await db.flush()
    return lease


async def claim_call_lease(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    device_id: uuid.UUID,
    takeover: bool,
) -> CallLease:
    """请求分配或接管通话租约。"""
    # 1. 锁 User (NOWAIT)
    await lock_user_for_call_lease(db, user_id)

    # 2. 校验 session 必须属于当前用户且为 active
    session_stmt = select(Session).where(
        Session.id == session_id,
        Session.user_id == user_id,
    )
    session = (await db.execute(session_stmt)).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail="会话已结束，无法占用")

    # 3. 查 lease
    lease = await get_or_create_lease(db, user_id)
    now = datetime.now(timezone.utc)
    new_expires_at = now + timedelta(seconds=LEASE_TTL_SECONDS)

    # 若当前未被占用（或刚初始化的 free 状态）
    if lease.state != CallLeaseState.held.value:
        lease.session_id = session_id
        lease.device_id = device_id
        lease.generation += 1
        lease.state = CallLeaseState.held.value
        lease.expires_at = new_expires_at
        await db.flush()
        return lease

    # 若当前处于 held
    # 检查是否为同 session/device 的重复 claim（保持 generation 并续期）
    if lease.session_id == session_id and lease.device_id == device_id:
        lease.expires_at = new_expires_at
        await db.flush()
        return lease

    # 其他 held owner（含同设备不同 session、不同设备相同 session、过期 owner）
    if not takeover:
        expires_str = lease.expires_at.isoformat() if lease.expires_at else None
        raise HTTPException(
            status_code=409,
            detail={
                "code": "call_in_use",
                "message": "Call is in use by another session or device",
                "conflict_session_id": str(lease.session_id)
                if lease.session_id
                else None,
                "expires_at": expires_str,
            },
        )

    # takeover=True: 严格先成功撤销旧 owner 的 Cloud Token，再更新 DB 授予新 owner
    if lease.session_id is not None:
        old_room_name = str(lease.session_id)
        old_identity = f"{user_id}:{lease.generation}"
        revoke_cutoff = math.floor(now.timestamp()) + 30
        await revoke_cloud_participant(
            room_name=old_room_name,
            identity=old_identity,
            revoke_cutoff=revoke_cutoff,
        )

    # 撤销成功后更新 row
    lease.session_id = session_id
    lease.device_id = device_id
    lease.generation += 1
    lease.state = CallLeaseState.held.value
    lease.expires_at = new_expires_at
    await db.flush()
    return lease


async def heartbeat_call_lease(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    device_id: uuid.UUID,
    generation: int,
) -> CallLease:
    """心跳续期通话租约。"""
    await lock_user_for_call_lease(db, user_id)

    session_stmt = select(Session).where(
        Session.id == session_id,
        Session.user_id == user_id,
    )
    session = (await db.execute(session_stmt)).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail="会话已结束")

    lease = await get_or_create_lease(db, user_id)
    now = datetime.now(timezone.utc)

    if (
        lease.state != CallLeaseState.held.value
        or lease.session_id != session_id
        or lease.device_id != device_id
        or lease.generation != generation
    ):
        raise HTTPException(
            status_code=409,
            detail={"code": "call_lease_lost", "message": "Call lease lost"},
        )

    if lease.expires_at is None or lease.expires_at <= now:
        raise HTTPException(
            status_code=409,
            detail={"code": "call_lease_expired", "message": "Call lease expired"},
        )

    lease.expires_at = now + timedelta(seconds=LEASE_TTL_SECONDS)
    await db.flush()
    return lease


async def release_call_lease(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    device_id: uuid.UUID,
    generation: int,
) -> int:
    """释放通话租约。允许释放已过期或已结束的本用户会话。"""
    await lock_user_for_call_lease(db, user_id)

    session_stmt = select(Session).where(
        Session.id == session_id,
        Session.user_id == user_id,
    )
    session = (await db.execute(session_stmt)).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    lease = await get_or_create_lease(db, user_id)

    # 1. free 状态：仅完整相同 tuple 可幂等返回 200，其余均 409 lost 且不触发 Provider
    if lease.state == CallLeaseState.free.value:
        if (
            lease.session_id == session_id
            and lease.device_id == device_id
            and lease.generation == generation
        ):
            return lease.generation
        raise HTTPException(
            status_code=409,
            detail={"code": "call_lease_lost", "message": "Call lease lost"},
        )

    # 2. held 状态：不匹配当前 owner 则不可释放新 owner
    if (
        lease.session_id != session_id
        or lease.device_id != device_id
        or lease.generation != generation
    ):
        raise HTTPException(
            status_code=409,
            detail={"code": "call_lease_lost", "message": "Call lease lost"},
        )

    # 3. 匹配当前 held owner，先撤销 Cloud Token 再置 free
    now = datetime.now(timezone.utc)
    revoke_cutoff = math.floor(now.timestamp()) + 30
    identity = f"{user_id}:{generation}"

    await revoke_cloud_participant(
        room_name=str(session_id),
        identity=identity,
        revoke_cutoff=revoke_cutoff,
    )

    lease.state = CallLeaseState.free.value
    lease.expires_at = None
    await db.flush()
    return lease.generation


async def verify_call_lease_for_token_or_dispatch(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    device_id_raw: str | None,
    generation_raw: str | None,
) -> tuple[CallLease, Session]:
    """校验 Cloud 模式下的门禁：先锁 User 后读 lease/Session，先确认 Session 所有权再验头。"""
    # 1. 锁 User (NOWAIT)
    await lock_user_for_call_lease(db, user_id)

    # 2. 查 lease
    lease = await get_or_create_lease(db, user_id)

    # 3. 校验 Session 所有权与状态（他人或不存在保持 404，已结束保持 400）
    session_stmt = select(Session).where(
        Session.id == session_id,
        Session.user_id == user_id,
    )
    session = (await db.execute(session_stmt)).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail="会话已结束")

    # 4. 确认本用户有效会话后，再校验请求头
    if not device_id_raw or not generation_raw:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "call_lease_required",
                "message": "Call lease headers required",
            },
        )

    try:
        device_id = uuid.UUID(device_id_raw.strip())
        generation = int(generation_raw.strip())
        if generation <= 0:
            raise ValueError("generation 必须大于 0")
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=422,
            detail="Invalid X-Call-Device-Id or X-Call-Generation header",
        )

    # 5. 校验 lease 属于该 session/device/generation 且未过期
    if (
        lease.state != CallLeaseState.held.value
        or lease.session_id != session_id
        or lease.device_id != device_id
        or lease.generation != generation
    ):
        raise HTTPException(
            status_code=409,
            detail={"code": "call_lease_lost", "message": "Call lease lost"},
        )

    now = datetime.now(timezone.utc)
    if lease.expires_at is None or lease.expires_at <= now:
        raise HTTPException(
            status_code=409,
            detail={"code": "call_lease_expired", "message": "Call lease expired"},
        )

    return lease, session
