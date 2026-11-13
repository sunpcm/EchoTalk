"""Hard-delete one local account and all of its owned business data."""

import uuid

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.analysis import AnalysisJob
from models.call_lease import CallLease
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState
from models.learning_event import LearningEvent
from models.session import Session, SessionContext, Transcript
from models.user import User, UserProfile, UserSettings
from services.learning_event_cutover import (
    CutoverError,
    lock_cutover_control_for_update,
    refresh_baseline_control_after_account_deletion,
    validate_baseline_control_for_account_deletion,
)


class UserAccountDeletionError(RuntimeError):
    """A stable failure code for an unsafe or inconsistent account deletion."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _fail(code: str, message: str) -> UserAccountDeletionError:
    return UserAccountDeletionError(code, message)


async def _lock_user_id(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> uuid.UUID | None:
    return await db.scalar(select(User.id).where(User.id == user_id).with_for_update())


async def _lock_session_ids(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> set[uuid.UUID]:
    result = await db.execute(
        select(Session.id)
        .where(Session.user_id == user_id)
        .order_by(Session.id)
        .with_for_update()
    )
    return set(result.scalars().all())


async def _lock_job_sessions(
    db: AsyncSession,
    session_ids: set[uuid.UUID],
) -> dict[uuid.UUID, uuid.UUID]:
    if not session_ids:
        return {}
    result = await db.execute(
        select(AnalysisJob.id, AnalysisJob.session_id)
        .where(AnalysisJob.session_id.in_(session_ids))
        .order_by(AnalysisJob.id)
        .with_for_update()
    )
    return {row[0]: row[1] for row in result.all()}


async def _lock_assessment_sessions(
    db: AsyncSession,
    session_ids: set[uuid.UUID],
) -> dict[uuid.UUID, uuid.UUID]:
    if not session_ids:
        return {}
    result = await db.execute(
        select(PronunciationAssessment.id, PronunciationAssessment.session_id)
        .where(PronunciationAssessment.session_id.in_(session_ids))
        .order_by(PronunciationAssessment.id)
        .with_for_update()
    )
    return {row[0]: row[1] for row in result.all()}


async def _lock_grammar_sessions(
    db: AsyncSession,
    session_ids: set[uuid.UUID],
) -> dict[uuid.UUID, uuid.UUID]:
    if not session_ids:
        return {}
    result = await db.execute(
        select(GrammarError.id, GrammarError.session_id)
        .where(GrammarError.session_id.in_(session_ids))
        .order_by(GrammarError.id)
        .with_for_update()
    )
    return {row[0]: row[1] for row in result.all()}


async def _lock_related_events(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_ids: set[uuid.UUID],
    job_ids: set[uuid.UUID],
    assessment_ids: set[uuid.UUID],
    grammar_ids: set[uuid.UUID],
) -> list[LearningEvent]:
    clauses = [LearningEvent.user_id == user_id]
    if session_ids:
        clauses.append(LearningEvent.session_id.in_(session_ids))
    if job_ids:
        clauses.append(LearningEvent.analysis_job_id.in_(job_ids))
    if assessment_ids:
        clauses.append(LearningEvent.pronunciation_assessment_id.in_(assessment_ids))
    if grammar_ids:
        clauses.append(LearningEvent.grammar_error_id.in_(grammar_ids))
    result = await db.execute(
        select(LearningEvent)
        .where(or_(*clauses))
        .order_by(LearningEvent.apply_seq)
        .with_for_update()
    )
    return list(result.scalars().all())


def _validate_event_ownership(
    *,
    user_id: uuid.UUID,
    events: list[LearningEvent],
    session_ids: set[uuid.UUID],
    job_sessions: dict[uuid.UUID, uuid.UUID],
    assessment_sessions: dict[uuid.UUID, uuid.UUID],
    grammar_sessions: dict[uuid.UUID, uuid.UUID],
) -> None:
    for event in events:
        if event.user_id != user_id:
            raise _fail(
                "cross_user_event",
                "another user's learning event references account data",
            )
        if event.session_id is None:
            continue
        if event.session_id not in session_ids:
            raise _fail(
                "cross_user_event",
                "account learning event references another user's session",
            )
        if job_sessions.get(event.analysis_job_id) != event.session_id:
            raise _fail(
                "cross_user_event",
                "account learning event job does not match its session",
            )
        if (
            event.pronunciation_assessment_id is not None
            and assessment_sessions.get(event.pronunciation_assessment_id)
            != event.session_id
        ):
            raise _fail(
                "cross_user_event",
                "account learning event assessment does not match its session",
            )
        if (
            event.grammar_error_id is not None
            and grammar_sessions.get(event.grammar_error_id) != event.session_id
        ):
            raise _fail(
                "cross_user_event",
                "account learning event grammar does not match its session",
            )


async def _lock_related_call_leases(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_ids: set[uuid.UUID],
) -> list[CallLease]:
    clauses = [CallLease.user_id == user_id]
    if session_ids:
        clauses.append(CallLease.session_id.in_(session_ids))
    result = await db.execute(
        select(CallLease)
        .where(or_(*clauses))
        .order_by(CallLease.user_id)
        .with_for_update()
    )
    return list(result.scalars().all())


def _validate_call_lease_ownership(
    *,
    user_id: uuid.UUID,
    leases: list[CallLease],
    session_ids: set[uuid.UUID],
) -> None:
    for lease in leases:
        if lease.user_id != user_id or (
            lease.session_id is not None and lease.session_id not in session_ids
        ):
            raise _fail(
                "cross_user_call_lease",
                "call lease ownership does not match the account",
            )


async def delete_user_account(
    *,
    db: AsyncSession,
    user_id: uuid.UUID,
) -> None:
    """Delete one account in the caller's transaction without committing it."""
    control = await lock_cutover_control_for_update(db)
    if control is None:
        existing_baseline = await db.scalar(
            select(LearningEvent.apply_seq)
            .where(LearningEvent.event_type == "baseline_snapshot")
            .limit(1)
        )
        if existing_baseline is not None:
            raise _fail(
                "baseline_control_missing",
                "baseline events exist without a cutover control row",
            )
    else:
        try:
            await validate_baseline_control_for_account_deletion(
                db,
                row=control,
            )
        except CutoverError as exc:
            raise _fail(exc.code, str(exc)) from exc

    if await _lock_user_id(db, user_id) is None:
        return

    session_ids = await _lock_session_ids(db, user_id)
    job_sessions = await _lock_job_sessions(db, session_ids)
    assessment_sessions = await _lock_assessment_sessions(db, session_ids)
    grammar_sessions = await _lock_grammar_sessions(db, session_ids)

    events = await _lock_related_events(
        db,
        user_id=user_id,
        session_ids=session_ids,
        job_ids=set(job_sessions),
        assessment_ids=set(assessment_sessions),
        grammar_ids=set(grammar_sessions),
    )
    _validate_event_ownership(
        user_id=user_id,
        events=events,
        session_ids=session_ids,
        job_sessions=job_sessions,
        assessment_sessions=assessment_sessions,
        grammar_sessions=grammar_sessions,
    )

    leases = await _lock_related_call_leases(
        db,
        user_id=user_id,
        session_ids=session_ids,
    )
    _validate_call_lease_ownership(
        user_id=user_id,
        leases=leases,
        session_ids=session_ids,
    )

    await db.execute(delete(LearningEvent).where(LearningEvent.user_id == user_id))
    if control is not None:
        try:
            await refresh_baseline_control_after_account_deletion(
                db,
                row=control,
            )
        except CutoverError as exc:
            raise _fail(exc.code, str(exc)) from exc

    if session_ids:
        await db.execute(
            delete(PronunciationAssessment).where(
                PronunciationAssessment.session_id.in_(session_ids)
            )
        )
        await db.execute(
            delete(GrammarError).where(GrammarError.session_id.in_(session_ids))
        )
        await db.execute(
            delete(Transcript).where(Transcript.session_id.in_(session_ids))
        )
        await db.execute(
            delete(SessionContext).where(SessionContext.session_id.in_(session_ids))
        )
        await db.execute(
            delete(AnalysisJob).where(AnalysisJob.session_id.in_(session_ids))
        )
    await db.execute(delete(CallLease).where(CallLease.user_id == user_id))
    await db.execute(delete(KnowledgeState).where(KnowledgeState.user_id == user_id))
    if session_ids:
        await db.execute(delete(Session).where(Session.id.in_(session_ids)))
    await db.execute(delete(UserProfile).where(UserProfile.user_id == user_id))
    await db.execute(delete(UserSettings).where(UserSettings.user_id == user_id))
    await db.execute(delete(User).where(User.id == user_id))
    await db.flush()
