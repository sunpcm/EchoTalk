"""会话管理路由：创建、列表、详情、结束、令牌签发。"""

import asyncio
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from livekit.api import (
    AccessToken,
    CreateAgentDispatchRequest,
    LiveKitAPI,
    VideoGrants,
)
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import CurrentUser
from config import settings
from database import get_db
from dependencies import get_current_user
from models.analysis import AnalysisJob
from models.call_lease import CallLease, CallLeaseState
from models.goal_evaluation import GoalEvaluationResult, GoalRun, GoalRunStatus
from models.scenario_goals import GoalCatalogVersion, SessionGoalSnapshot
from models.session import Session, SessionContext, SessionMode, SessionStatus
from schemas.call_lease import (
    CallClaimRequest,
    CallHeartbeatRequest,
    CallLeaseResponse,
    CallReleaseRequest,
    CallReleaseResponse,
)
from schemas.goal_evaluation import (
    GoalExecution,
    GoalSummary,
    GoalViewEntry,
    GoalViewResponse,
)
from schemas.scenario_goals import GoalDefinition
from schemas.session import (
    AgentDispatchResponse,
    AnalysisStatusResponse,
    DailyProgressResponse,
    SessionCreate,
    SessionListResponse,
    SessionResponse,
    SessionTokenResponse,
    WeeklyProgressResponse,
)
from services.analysis_jobs import (
    STALE_AFTER,
    InvalidAnalysisTransition,
    can_retry_job,
    create_analysis_job,
    retry_job,
)
from services.call_leases import (
    claim_call_lease,
    heartbeat_call_lease,
    lock_user_for_call_lease,
    release_call_lease,
    revoke_cloud_participant,
    verify_call_lease_for_token_or_dispatch,
)
from services.goal_evaluation import create_goal_run
from services.session_admission import (
    get_active_session_or_raise,
    verify_session_admission,
)
from services.session_goal_binding import (
    GoalBindingValidationError,
    ResolvedGoalBinding,
    bind_session_goal,
    lock_user_for_goal_session,
    resolve_goal_binding,
)
from services.session_idempotency import (
    compute_session_fingerprint,
    is_idempotency_unique_violation,
    parse_idempotency_key,
)
from services.session_queries import (
    paginate_sessions,
    query_daily_progress,
    query_weekly_progress,
    validate_window,
)
from time_utils import utc_now

logger = logging.getLogger(__name__)

router = APIRouter()


def _resolve_requested_goal_binding(
    body: SessionCreate,
) -> ResolvedGoalBinding | None:
    if body.goal_binding is None:
        return None
    try:
        return resolve_goal_binding(
            body.goal_binding.material_id,
            body.goal_binding.material_version,
        )
    except GoalBindingValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _lock_user_for_bound_session(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    binding: ResolvedGoalBinding | None,
) -> None:
    if binding is None:
        return
    try:
        await lock_user_for_goal_session(db, user_id=user_id)
    except GoalBindingValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _persist_bound_session_goal(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    binding: ResolvedGoalBinding | None,
) -> None:
    if binding is None:
        return
    await bind_session_goal(
        db,
        user_id=user_id,
        session_id=session_id,
        binding=binding,
    )


@router.post("/sessions", response_model=SessionResponse)
async def create_session(
    body: SessionCreate,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建新的练习会话（支持可选 Idempotency-Key 头幂等）。"""
    parsed_key = parse_idempotency_key(idempotency_key)

    # 校验 mode 值是否合法
    try:
        mode = SessionMode(body.mode)
    except ValueError:
        valid_modes = [m.value for m in SessionMode]
        raise HTTPException(
            status_code=400,
            detail=f"无效的 mode 值: '{body.mode}'。有效值: {valid_modes}",
        )

    # doc_chat 模式校验
    if mode == SessionMode.doc_chat:
        if not body.doc_context or not body.doc_context.raw_text.strip():
            raise HTTPException(
                status_code=400,
                detail="doc_chat 模式必须提供文档内容",
            )
        if len(body.doc_context.raw_text) > 50000:
            raise HTTPException(
                status_code=400,
                detail="文档内容超过 50,000 字符限制",
            )

    # 1. 未提供 Idempotency-Key：保持原有每次新建行为
    if parsed_key is None:
        goal_binding = _resolve_requested_goal_binding(body)
        await _lock_user_for_bound_session(
            db,
            user_id=current_user.id,
            binding=goal_binding,
        )
        session = Session(
            id=uuid.uuid4(),
            user_id=current_user.id,
            mode=mode,
            status=SessionStatus.active,
            started_at=utc_now(),
            request_idempotency_key=None,
            request_fingerprint=None,
        )
        db.add(session)
        await db.flush()

        if mode == SessionMode.doc_chat and body.doc_context:
            ctx = SessionContext(
                session_id=session.id,
                custom_prompt=body.doc_context.prompt,
                document_content=body.doc_context.raw_text,
                content_type=body.doc_context.content_type,
            )
            db.add(ctx)
            await db.flush()

        await _persist_bound_session_goal(
            db,
            user_id=current_user.id,
            session_id=session.id,
            binding=goal_binding,
        )
        await db.refresh(session)
        return session

    # 2. 提供 Idempotency-Key：执行幂等逻辑
    fingerprint = compute_session_fingerprint(body)

    stmt = (
        select(Session)
        .where(
            Session.user_id == current_user.id,
            Session.request_idempotency_key == parsed_key,
        )
        .options(selectinload(Session.transcripts))
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="Idempotency-Key 已被不同参数的请求使用",
            )
        return existing

    goal_binding = _resolve_requested_goal_binding(body)
    await _lock_user_for_bound_session(
        db,
        user_id=current_user.id,
        binding=goal_binding,
    )

    # 不存在则尝试插入（通过 Savepoint 隔离并发冲突）
    try:
        async with db.begin_nested():
            session = Session(
                id=uuid.uuid4(),
                user_id=current_user.id,
                mode=mode,
                status=SessionStatus.active,
                started_at=utc_now(),
                request_idempotency_key=parsed_key,
                request_fingerprint=fingerprint,
            )
            db.add(session)
            await db.flush()

            if mode == SessionMode.doc_chat and body.doc_context:
                ctx = SessionContext(
                    session_id=session.id,
                    custom_prompt=body.doc_context.prompt,
                    document_content=body.doc_context.raw_text,
                    content_type=body.doc_context.content_type,
                )
                db.add(ctx)
                await db.flush()

            await _persist_bound_session_goal(
                db,
                user_id=current_user.id,
                session_id=session.id,
                binding=goal_binding,
            )
    except IntegrityError as exc:
        if not is_idempotency_unique_violation(exc):
            raise

        # 并发冲突：重新查询先提交的会话
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing is None:
            raise
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="Idempotency-Key 已被不同参数的请求使用",
            )
        return existing

    await db.refresh(session)
    return session


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    status: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(50, ge=1, le=100),
    cursor: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出当前用户的会话（支持 keyset 游标分页、状态过滤与成对时间窗口）。"""
    start_utc, end_utc = validate_window(start, end, required=False)
    return await paginate_sessions(
        db,
        user_id=current_user.id,
        endpoint="history",
        status=status,
        start=start_utc,
        end=end_utc,
        limit=limit,
        cursor=cursor,
    )


@router.get("/sessions/active", response_model=SessionListResponse)
async def list_active_sessions(
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(50, ge=1, le=100),
    cursor: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询当前已认证用户的活跃会话记录（支持 keyset 游标分页与成对时间窗口）。

    仅返回 status=active 的记录，按 started_at 降序、id 降序排序。
    不包含 Token、转录或文档正文，不更新状态、不签 Token、不 dispatch。
    注意：此接口仅发现数据库活动记录，不证明 LiveKit 仍连接或租约占用。
    """
    start_utc, end_utc = validate_window(start, end, required=False)
    return await paginate_sessions(
        db,
        user_id=current_user.id,
        endpoint="active",
        status="active",
        start=start_utc,
        end=end_utc,
        limit=limit,
        cursor=cursor,
    )


@router.get("/sessions/daily-progress", response_model=DailyProgressResponse)
async def get_daily_progress(
    start: datetime,
    end: datetime,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """单次服务端聚合当前用户指定窗口内已完成会话数及全部转录条数。

    必须定义在动态 /sessions/{session_id} 之前以防路由碰撞。
    """
    start_utc, end_utc = validate_window(start, end, required=True)
    assert start_utc is not None and end_utc is not None
    return await query_daily_progress(
        db,
        user_id=current_user.id,
        start=start_utc,
        end=end_utc,
    )


@router.get(
    "/sessions/weekly-progress",
    response_model=WeeklyProgressResponse,
    response_model_exclude_none=True,
)
async def get_weekly_progress(
    end_date: str = Query(..., pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"),
    timezone: str = Query(..., min_length=1, max_length=128),
    include_recorded_duration: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回七个本地自然日已完成会话数，并可按显式请求聚合时长。"""
    return await query_weekly_progress(
        db,
        user_id=current_user.id,
        end_date=end_date,
        timezone_name=timezone,
        include_recorded_duration=include_recorded_duration,
    )


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询会话详情（含转录记录）。"""
    stmt = (
        select(Session)
        .where(
            Session.id == session_id,
            Session.user_id == current_user.id,
        )
        .options(selectinload(Session.transcripts))
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    return session


@router.post("/sessions/{session_id}/call/claim", response_model=CallLeaseResponse)
async def claim_session_call_lease(
    session_id: uuid.UUID,
    body: CallClaimRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """分配或接管通话租约。"""
    if settings.CALL_LEASE_MODE == "disabled":
        raise HTTPException(
            status_code=503,
            detail={
                "code": "call_leases_disabled",
                "message": "Call lease service is disabled",
            },
        )
    lease = await claim_call_lease(
        db,
        user_id=current_user.id,
        session_id=session_id,
        device_id=body.device_id,
        takeover=body.takeover,
    )
    await db.commit()
    return lease


@router.post(
    "/sessions/{session_id}/call/heartbeat",
    response_model=CallLeaseResponse,
)
async def heartbeat_session_call_lease(
    session_id: uuid.UUID,
    body: CallHeartbeatRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """心跳续期通话租约。"""
    if settings.CALL_LEASE_MODE == "disabled":
        raise HTTPException(
            status_code=503,
            detail={
                "code": "call_leases_disabled",
                "message": "Call lease service is disabled",
            },
        )
    lease = await heartbeat_call_lease(
        db,
        user_id=current_user.id,
        session_id=session_id,
        device_id=body.device_id,
        generation=body.generation,
    )
    await db.commit()
    return lease


@router.post(
    "/sessions/{session_id}/call/release",
    response_model=CallReleaseResponse,
)
async def release_session_call_lease(
    session_id: uuid.UUID,
    body: CallReleaseRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """释放通话租约。"""
    if settings.CALL_LEASE_MODE == "disabled":
        raise HTTPException(
            status_code=503,
            detail={
                "code": "call_leases_disabled",
                "message": "Call lease service is disabled",
            },
        )
    gen = await release_call_lease(
        db,
        user_id=current_user.id,
        session_id=session_id,
        device_id=body.device_id,
        generation=body.generation,
    )
    await db.commit()
    return CallReleaseResponse(released=True, generation=gen)


@router.post("/sessions/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """结束会话：将状态更新为 completed 并记录结束时间。"""
    if settings.CALL_LEASE_MODE == "livekit_cloud":
        # 1. 锁 User (NOWAIT)
        await lock_user_for_call_lease(db, current_user.id)

        # 2. 锁 Session (按 User -> Session 顺序)
        stmt = (
            select(Session)
            .where(
                Session.id == session_id,
                Session.user_id == current_user.id,
            )
            .options(selectinload(Session.transcripts))
            .with_for_update()
        )
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()

        if session is None:
            raise HTTPException(status_code=404, detail="会话不存在")
        if session.status == SessionStatus.completed:
            # 重复 end completed 直接返回，不创建或修改 lease 记录
            return session
        if session.status == SessionStatus.cancelled:
            raise HTTPException(status_code=400, detail="会话已取消，无法结束")
        if session.status != SessionStatus.active:
            raise HTTPException(status_code=400, detail="会话状态不支持结束操作")

        # 3. 查 lease（若存在且持有本 session，先撤销 Cloud Token 再置 free）
        lease_stmt = select(CallLease).where(CallLease.user_id == current_user.id)
        lease = (await db.execute(lease_stmt)).scalar_one_or_none()
        if (
            lease is not None
            and lease.state == CallLeaseState.held.value
            and lease.session_id == session_id
        ):
            now = datetime.now(timezone.utc)
            revoke_cutoff = math.floor(now.timestamp()) + 30
            await revoke_cloud_participant(
                room_name=str(session_id),
                identity=f"{current_user.id}:{lease.generation}",
                revoke_cutoff=revoke_cutoff,
            )
            lease.state = CallLeaseState.free.value
            lease.expires_at = None
            await db.flush()

        session.status = SessionStatus.completed
        session.ended_at = utc_now()
        await create_analysis_job(session.id, db)
        await create_goal_run(db, session_id=session.id, user_id=current_user.id)
        await db.flush()
        await db.commit()
        await db.refresh(session)
        return session

    # 禁用模式保持原行为
    stmt = (
        select(Session)
        .where(
            Session.id == session_id,
            Session.user_id == current_user.id,
        )
        .options(selectinload(Session.transcripts))
        .with_for_update()
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.status == SessionStatus.completed:
        return session
    if session.status == SessionStatus.cancelled:
        raise HTTPException(status_code=400, detail="会话已取消，无法结束")
    if session.status != SessionStatus.active:
        raise HTTPException(status_code=400, detail="会话状态不支持结束操作")

    session.status = SessionStatus.completed
    session.ended_at = utc_now()
    await create_analysis_job(session.id, db)
    await create_goal_run(db, session_id=session.id, user_id=current_user.id)
    await db.flush()
    await db.refresh(session)

    return session


@router.get(
    "/sessions/{session_id}/goals",
    response_model=GoalViewResponse,
)
async def get_session_goals(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the frozen goal definitions, execution and summary (read-only).

    Uses one outer-join select for a consistent snapshot; it never issues
    ``SET TRANSACTION`` so it stays safe on the shared authentication session.
    """
    rows = (
        await db.execute(
            select(
                Session.id,
                Session.user_id,
                SessionGoalSnapshot.material_id,
                SessionGoalSnapshot.material_version,
                GoalCatalogVersion.goals,
                GoalRun.id,
                GoalRun.status,
                GoalRun.revision,
                GoalRun.evaluator_version,
                GoalEvaluationResult.goal_id,
                GoalEvaluationResult.goal_version,
                GoalEvaluationResult.result,
            )
            .select_from(Session)
            .outerjoin(
                SessionGoalSnapshot,
                SessionGoalSnapshot.session_id == Session.id,
            )
            .outerjoin(
                GoalCatalogVersion,
                and_(
                    GoalCatalogVersion.material_id == SessionGoalSnapshot.material_id,
                    GoalCatalogVersion.material_version
                    == SessionGoalSnapshot.material_version,
                ),
            )
            .outerjoin(GoalRun, GoalRun.session_id == Session.id)
            .outerjoin(
                GoalEvaluationResult,
                GoalEvaluationResult.run_id == GoalRun.id,
            )
            .where(Session.id == session_id)
        )
    ).all()

    if not rows or rows[0][1] != current_user.id:
        raise HTTPException(status_code=404, detail="会话不存在")

    material_id = rows[0][2]
    material_version = rows[0][3]
    goals_json = rows[0][4]
    run_id = rows[0][5]
    run_status = rows[0][6]
    run_revision = rows[0][7]
    run_evaluator_version = rows[0][8]

    if material_id is None:
        return GoalViewResponse(
            session_id=session_id,
            configured=False,
            material_id=None,
            material_version=None,
            goals=[],
            execution=None,
            summary=None,
        )

    goals = [GoalDefinition.model_validate(raw) for raw in goals_json]

    def entry(goal: GoalDefinition, result: str | None) -> GoalViewEntry:
        return GoalViewEntry(
            goal_id=goal.goal_id,
            goal_version=goal.goal_version,
            description_en=goal.description_en,
            description_zh=goal.description_zh,
            criteria=goal.criteria,
            evidence_types=goal.evidence_types,
            result=result,
        )

    if run_id is None:
        return GoalViewResponse(
            session_id=session_id,
            configured=True,
            material_id=material_id,
            material_version=material_version,
            goals=[entry(goal, "not_assessed") for goal in goals],
            execution=None,
            summary=GoalSummary(
                total=len(goals),
                achieved=0,
                not_achieved=0,
                assessed=0,
                unknown=0,
                not_assessed=len(goals),
            ),
        )

    result_by_goal = {
        row[9]: (row[10], row[11].value) for row in rows if row[9] is not None
    }

    execution = GoalExecution(
        status=run_status.value,
        revision=run_revision,
        evaluator_version=run_evaluator_version,
    )
    if run_status in (GoalRunStatus.pending, GoalRunStatus.running):
        if result_by_goal:
            raise HTTPException(
                status_code=500,
                detail="goal evaluation inconsistent: progress state has results",
            )
        summary = None
        view_entries = [entry(goal, None) for goal in goals]
    else:
        goal_ids = {goal.goal_id for goal in goals}
        if set(result_by_goal) != goal_ids:
            raise HTTPException(
                status_code=500,
                detail="goal evaluation inconsistent: result set mismatch",
            )
        for goal in goals:
            if result_by_goal[goal.goal_id][0] != goal.goal_version:
                raise HTTPException(
                    status_code=500,
                    detail="goal evaluation inconsistent: goal version mismatch",
                )
        achieved = sum(
            1 for _version, value in result_by_goal.values() if value == "achieved"
        )
        not_achieved = sum(
            1 for _version, value in result_by_goal.values() if value == "not_achieved"
        )
        unknown = sum(
            1 for _version, value in result_by_goal.values() if value == "unknown"
        )
        not_assessed = sum(
            1 for _version, value in result_by_goal.values() if value == "not_assessed"
        )
        if achieved + not_achieved + unknown + not_assessed != len(goals):
            raise HTTPException(
                status_code=500,
                detail="goal evaluation count invariant violated",
            )
        view_entries = [entry(goal, result_by_goal[goal.goal_id][1]) for goal in goals]
        summary = GoalSummary(
            total=len(goals),
            achieved=achieved,
            not_achieved=not_achieved,
            assessed=achieved + not_achieved,
            unknown=unknown,
            not_assessed=not_assessed,
        )

    return GoalViewResponse(
        session_id=session_id,
        configured=True,
        material_id=material_id,
        material_version=material_version,
        goals=view_entries,
        execution=execution,
        summary=summary,
    )


def _analysis_status_response(job: AnalysisJob) -> AnalysisStatusResponse:
    return AnalysisStatusResponse(
        session_id=job.session_id,
        status=job.status.value,
        attempt_count=job.attempt_count,
        error_code=job.last_error_code,
        retryable=can_retry_job(job),
        started_at=job.started_at,
        finished_at=job.finished_at,
        updated_at=job.updated_at,
    )


@router.get(
    "/sessions/{session_id}/analysis-status",
    response_model=AnalysisStatusResponse,
)
async def get_analysis_status(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return an explicit analysis state instead of using assessment 404s."""
    stmt = (
        select(AnalysisJob)
        .join(Session, AnalysisJob.session_id == Session.id)
        .where(
            AnalysisJob.session_id == session_id,
            Session.user_id == current_user.id,
        )
    )
    job = (await db.execute(stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="分析任务不存在")
    return _analysis_status_response(job)


@router.post(
    "/sessions/{session_id}/analysis-retry",
    response_model=AnalysisStatusResponse,
)
async def retry_analysis(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Requeue only a failed job or a running job past its stale deadline."""
    stmt = (
        select(AnalysisJob)
        .join(Session, AnalysisJob.session_id == Session.id)
        .where(
            AnalysisJob.session_id == session_id,
            Session.user_id == current_user.id,
        )
        .with_for_update()
    )
    job = (await db.execute(stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="分析任务不存在")
    try:
        retry_job(job, now=utc_now(), stale_after=STALE_AFTER)
    except InvalidAnalysisTransition as exc:
        raise HTTPException(status_code=409, detail="当前分析状态不可重试") from exc
    await db.flush()
    return _analysis_status_response(job)


@router.get("/sessions/{session_id}/token", response_model=SessionTokenResponse)
async def get_session_token(
    session_id: uuid.UUID,
    device_id: str | None = Header(None, alias="X-Call-Device-Id"),
    generation: str | None = Header(None, alias="X-Call-Generation"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """为指定会话生成加入房间的 LiveKit 令牌。并在签发前校验鉴权与连通状态。"""
    user_id = current_user.id

    token_ttl: timedelta | None = None
    if settings.CALL_LEASE_MODE == "livekit_cloud":
        # 严格按 §2 统一锁序：User (NOWAIT) -> lease -> Session
        lease, session = await verify_call_lease_for_token_or_dispatch(
            db,
            user_id=user_id,
            session_id=session_id,
            device_id_raw=device_id,
            generation_raw=generation,
        )

        # 校验 lease 有效期
        now = datetime.now(timezone.utc)
        if lease.expires_at is None:
            raise HTTPException(
                status_code=409,
                detail={"code": "call_lease_expired", "message": "Call lease expired"},
            )
        remaining_seconds = (lease.expires_at - now).total_seconds()
        if remaining_seconds < 1.0:
            raise HTTPException(
                status_code=409,
                detail={"code": "call_lease_expired", "message": "Call lease expired"},
            )
        ttl_seconds = min(60, int(remaining_seconds))
        token_ttl = timedelta(seconds=ttl_seconds)
        participant_identity = f"{user_id}:{lease.generation}"

        await verify_session_admission(db, user_id=user_id)
    else:
        # disabled 模式严格保持原有逻辑与顺序
        await verify_session_admission(db, user_id=user_id)

        session = await get_active_session_or_raise(
            db,
            session_id=session_id,
            user_id=user_id,
            ended_detail="会话已结束，无法生成令牌",
        )

        participant_identity = str(current_user.id)

    # 生成 LiveKit Token
    # room 名直接使用 session_id 字符串
    room_name = str(session.id)
    participant_name = getattr(current_user, "email", "Participant")

    grant = VideoGrants(room_join=True, room=room_name)
    access_token = AccessToken(
        settings.LIVEKIT_API_KEY,
        settings.LIVEKIT_API_SECRET,
    )
    if token_ttl is not None:
        access_token.with_ttl(token_ttl)
    access_token.with_identity(participant_identity)
    access_token.with_name(participant_name)
    access_token.with_grants(grant)

    token = access_token.to_jwt()

    return {"token": token, "ws_url": settings.LIVEKIT_URL}


@router.post("/sessions/{session_id}/dispatch", response_model=AgentDispatchResponse)
async def dispatch_agent(
    session_id: uuid.UUID,
    device_id: str | None = Header(None, alias="X-Call-Device-Id"),
    generation: str | None = Header(None, alias="X-Call-Generation"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """前端已连接房间后调用，调度 Agent 加入。"""
    if settings.CALL_LEASE_MODE == "livekit_cloud":
        # 严格按 §2 统一锁序：User (NOWAIT) -> lease -> Session
        _lease, session = await verify_call_lease_for_token_or_dispatch(
            db,
            user_id=current_user.id,
            session_id=session_id,
            device_id_raw=device_id,
            generation_raw=generation,
        )

        room_name = str(session.id)

        try:
            async with asyncio.timeout(3.0):
                async with LiveKitAPI(
                    url=settings.LIVEKIT_URL,
                    api_key=settings.LIVEKIT_API_KEY,
                    api_secret=settings.LIVEKIT_API_SECRET,
                ) as lk_api:
                    existing = await lk_api.agent_dispatch.list_dispatch(room_name)
                    if not existing:
                        await lk_api.agent_dispatch.create_dispatch(
                            CreateAgentDispatchRequest(room=room_name, agent_name="")
                        )
        except Exception as exc:
            logger.error(
                "Agent 调度失败: mode=livekit_cloud, error_type=%s",
                type(exc).__name__,
            )
            raise HTTPException(
                status_code=502, detail="语音服务暂时不可用，请稍后重试"
            ) from None

        return {"dispatched": True}

    # disabled 模式保持原行为（先查 Session，无 3 秒超时包装）
    session = await get_active_session_or_raise(
        db,
        session_id=session_id,
        user_id=current_user.id,
        ended_detail="会话已结束",
    )

    room_name = str(session.id)

    try:
        async with LiveKitAPI(
            url=settings.LIVEKIT_URL,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        ) as lk_api:
            existing = await lk_api.agent_dispatch.list_dispatch(room_name)
            if not existing:
                await lk_api.agent_dispatch.create_dispatch(
                    CreateAgentDispatchRequest(room=room_name, agent_name="")
                )
    except Exception as exc:
        logger.error(
            "Agent 调度失败: mode=disabled, error_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502, detail="语音服务暂时不可用，请稍后重试"
        ) from None

    return {"dispatched": True}
