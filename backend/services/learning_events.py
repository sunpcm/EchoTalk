"""B1-2 same-transaction learning event ledger writes.

The production analysis path funnels one successful job's pronunciation
assessment and grammar errors through :func:`write_learning_events` inside the
caller's transaction.  The writer serializes per-user writes with a
``SELECT ... FOR UPDATE`` on the owning ``users.id`` row, validates that the
job/session/user and every candidate source belong to the same session, writes
the ``analysis_completed`` event and canonical observations idempotently, and
applies the frozen ``bkt-v1`` update only for newly inserted non-synthetic
observations in ``apply_seq`` order.

Idempotency compares the *complete* canonical payload for the completed marker
and every observation, then verifies the persisted batch key set.  A half batch
or an unexpected observation cannot prove a fully committed write, so the
writer fails closed without repairing or re-applying BKT.
"""

import logging
import uuid
from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.analysis import AnalysisJob
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import Skill
from models.learning_event import LearningEvent
from models.session import Session
from models.user import User
from services.analysis_jobs import AnalysisExecutionError
from services.analysis_service import (
    FROZEN_BKT_PARAMS,
    FROZEN_BKT_VERSION,
    _apply_bkt_updates,
)
from services.knowledge.skill_updater import phoneme_error_to_skill

logger = logging.getLogger(__name__)

_COMPLETED_SOURCE = "analysis"
_SCHEMA_VERSION = 1


def _fail(code: str, message: str) -> AnalysisExecutionError:
    return AnalysisExecutionError(code, message)


def _event_matches(existing: LearningEvent, values: dict[str, Any]) -> bool:
    """Compare a persisted ledger row against its canonical payload."""
    for key, expected in values.items():
        if key in {"apply_seq", "recorded_at", "idempotency_key"}:
            continue
        if getattr(existing, key) != expected:
            return False
    return True


async def _insert_event(
    db: AsyncSession,
    values: dict[str, Any],
) -> int | None:
    """Insert idempotently and verify the complete row on conflict."""
    stmt = (
        pg_insert(LearningEvent)
        .values(**values)
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
        .returning(LearningEvent.apply_seq)
    )
    result = await db.execute(stmt)
    inserted_seq = result.scalar_one_or_none()
    if inserted_seq is not None:
        return inserted_seq

    existing = await db.scalar(
        select(LearningEvent).where(
            LearningEvent.idempotency_key == values["idempotency_key"]
        )
    )
    if existing is None or not _event_matches(existing, values):
        raise _fail(
            "idempotency_conflict",
            "idempotent insert conflict does not match canonical payload",
        )
    return None


async def _read_skill_ids(db: AsyncSession, skill_ids: set[str]) -> set[str]:
    if not skill_ids:
        return set()
    result = await db.execute(select(Skill.id).where(Skill.id.in_(skill_ids)))
    return {row[0] for row in result.all()}


async def _existing_job_events(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> list[LearningEvent]:
    result = await db.execute(
        select(LearningEvent)
        .where(LearningEvent.analysis_job_id == job_id)
        .order_by(LearningEvent.apply_seq)
    )
    return list(result.scalars().all())


def _completed_values(
    *,
    job_id: uuid.UUID,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    occurred_at: Any,
    coverage: dict[str, Any],
    unmapped_pronunciation: int,
    unmapped_grammar: int,
) -> dict[str, Any]:
    return {
        "idempotency_key": f"job:{job_id}:completed",
        "event_type": "analysis_completed",
        "user_id": user_id,
        "session_id": session_id,
        "analysis_job_id": job_id,
        "pronunciation_assessment_id": None,
        "grammar_error_id": None,
        "skill_id": None,
        "source_ordinal": None,
        "observation_correct": None,
        "observation_code": None,
        "source": _COMPLETED_SOURCE,
        "provider": None,
        "model_version": None,
        "confidence": None,
        "is_synthetic": None,
        "algorithm_version": FROZEN_BKT_VERSION,
        "algorithm_params": FROZEN_BKT_PARAMS,
        "p_mastery_snapshot": None,
        "cutover_revision": None,
        "occurred_at": occurred_at,
        "details": {
            "schema_version": _SCHEMA_VERSION,
            "coverage": coverage,
            "unmapped": {
                "pronunciation": unmapped_pronunciation,
                "grammar": unmapped_grammar,
            },
        },
    }


async def write_learning_events(
    *,
    job: AnalysisJob,
    session: Session,
    user_id: uuid.UUID,
    assessment: PronunciationAssessment | None,
    grammar_errors: Sequence[GrammarError],
    coverage: dict[str, Any],
    db: AsyncSession,
) -> None:
    """Persist one completed analysis batch inside the caller's transaction."""
    # Serialize per-user writes until commit.  This is the lock that makes both
    # idempotent inserts and first-time ``knowledge_states`` creation race-safe.
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())

    # Fail closed on any relationship that a bare FK would not prove.
    if job.session_id != session.id:
        raise _fail(
            "session_ownership_mismatch",
            "analysis job does not belong to the target session",
        )
    if session.user_id != user_id:
        raise _fail(
            "session_ownership_mismatch",
            "session does not belong to the locked user",
        )
    if assessment is not None and assessment.session_id != session.id:
        raise _fail(
            "source_ownership_mismatch",
            "pronunciation assessment belongs to a different session",
        )
    for error in grammar_errors:
        if error.session_id != session.id:
            raise _fail(
                "source_ownership_mismatch",
                "grammar error belongs to a different session",
            )

    if session.ended_at is None:
        raise _fail("session_incomplete", "session ended_at is missing")

    occurred_at = session.ended_at

    # Canonicalize observations.  Pronunciation keeps source array order;
    # grammar is sorted by (skill_id, error_type) for a deterministic ordinal.
    pron_candidates: list[tuple[dict, str | None, int]] = []
    if assessment is not None and assessment.phoneme_alignment:
        for ordinal, entry in enumerate(assessment.phoneme_alignment):
            pron_candidates.append((entry, phoneme_error_to_skill(entry), ordinal))

    sorted_grammar = sorted(
        grammar_errors, key=lambda error: (error.skill_tag, error.error_type)
    )

    candidate_skill_ids = {
        skill for _, skill, _ in pron_candidates if skill is not None
    }
    candidate_skill_ids.update(error.skill_tag for error in sorted_grammar)
    valid_skills = await _read_skill_ids(db, candidate_skill_ids)

    unmapped_pronunciation = 0
    pronunciation_observations: list[dict[str, Any]] = []
    for entry, skill_id, ordinal in pron_candidates:
        if skill_id is None or skill_id not in valid_skills:
            unmapped_pronunciation += 1
            continue
        pronunciation_observations.append(
            {
                "skill_id": skill_id,
                "source_ordinal": ordinal,
                "correct": entry.get("type") == "correct",
                "code": entry.get("type"),
                "assessment_id": assessment.id,
                "source": assessment.source,
                "provider": assessment.provider,
                "model_version": assessment.model_version,
                "confidence": assessment.confidence,
                "is_synthetic": assessment.is_synthetic,
            }
        )

    unmapped_grammar = 0
    grammar_observations: list[dict[str, Any]] = []
    for ordinal, error in enumerate(sorted_grammar):
        if error.skill_tag not in valid_skills:
            unmapped_grammar += 1
            continue
        grammar_observations.append(
            {
                "skill_id": error.skill_tag,
                "source_ordinal": ordinal,
                "code": error.error_type,
                "error_id": error.id,
                "source": error.source,
                "provider": error.provider,
                "model_version": error.model_version,
                "confidence": error.confidence,
                "is_synthetic": error.is_synthetic,
            }
        )

    completed_values = _completed_values(
        job_id=job.id,
        user_id=user_id,
        session_id=session.id,
        occurred_at=occurred_at,
        coverage=coverage,
        unmapped_pronunciation=unmapped_pronunciation,
        unmapped_grammar=unmapped_grammar,
    )

    existing = await _existing_job_events(db, job.id)
    existing_completed = [e for e in existing if e.event_type == "analysis_completed"]
    existing_observations = {
        e.idempotency_key: e for e in existing if e.event_type != "analysis_completed"
    }

    if len(existing_completed) > 1:
        raise _fail(
            "idempotency_conflict",
            "multiple completed events for a single analysis job",
        )
    if existing_completed and not _event_matches(
        existing_completed[0], completed_values
    ):
        raise _fail(
            "idempotency_conflict",
            "existing completed event conflicts with canonical payload",
        )

    observation_values: dict[str, dict[str, Any]] = {}
    for obs in pronunciation_observations:
        key = f"job:{job.id}:pron:{obs['source_ordinal']}"
        observation_values[key] = {
            "idempotency_key": key,
            "event_type": "pronunciation_observation",
            "user_id": user_id,
            "session_id": session.id,
            "analysis_job_id": job.id,
            "pronunciation_assessment_id": obs["assessment_id"],
            "grammar_error_id": None,
            "skill_id": obs["skill_id"],
            "source_ordinal": obs["source_ordinal"],
            "observation_correct": obs["correct"],
            "observation_code": obs["code"],
            "source": obs["source"],
            "provider": obs["provider"],
            "model_version": obs["model_version"],
            "confidence": obs["confidence"],
            "is_synthetic": obs["is_synthetic"],
            "algorithm_version": None,
            "algorithm_params": None,
            "p_mastery_snapshot": None,
            "cutover_revision": None,
            "occurred_at": occurred_at,
            "details": {"schema_version": _SCHEMA_VERSION},
        }

    for obs in grammar_observations:
        key = f"job:{job.id}:grammar:{obs['source_ordinal']}"
        observation_values[key] = {
            "idempotency_key": key,
            "event_type": "grammar_observation",
            "user_id": user_id,
            "session_id": session.id,
            "analysis_job_id": job.id,
            "pronunciation_assessment_id": None,
            "grammar_error_id": obs["error_id"],
            "skill_id": obs["skill_id"],
            "source_ordinal": obs["source_ordinal"],
            "observation_correct": False,
            "observation_code": obs["code"],
            "source": obs["source"],
            "provider": obs["provider"],
            "model_version": obs["model_version"],
            "confidence": obs["confidence"],
            "is_synthetic": obs["is_synthetic"],
            "algorithm_version": None,
            "algorithm_params": None,
            "p_mastery_snapshot": None,
            "cutover_revision": None,
            "occurred_at": occurred_at,
            "details": {"schema_version": _SCHEMA_VERSION},
        }

    expected_keys = set(observation_values)
    persisted_keys = set(existing_observations)
    if existing_observations:
        # A residual batch must prove the whole canonical batch is present and
        # identical.  A fresh job has no prior observations and writes all of
        # them for the first time; that is the only case where a mismatch
        # between an empty ``persisted_keys`` and a non-empty ``expected_keys``
        # is legitimate.
        if persisted_keys != expected_keys:
            raise _fail(
                "idempotency_conflict",
                "persisted observation batch does not match the canonical batch",
            )

        for key, row in existing_observations.items():
            if not _event_matches(row, observation_values[key]):
                raise _fail(
                    "idempotency_conflict",
                    "existing observation conflicts with canonical payload",
                )

    completed_is_new = await _insert_event(db, completed_values) is not None

    new_bkt_observations: list[dict[str, Any]] = []
    for key, values in observation_values.items():
        if key in persisted_keys:
            continue
        inserted_seq = await _insert_event(db, values)
        if inserted_seq is None:
            continue
        new_bkt_observations.append(
            {
                "skill_id": values["skill_id"],
                "correct": values["observation_correct"],
                "is_synthetic": values["is_synthetic"],
            }
        )

    # The completed marker and its observations must be all new or all present.
    if completed_is_new:
        if len(new_bkt_observations) != len(observation_values):
            raise _fail(
                "idempotency_conflict",
                "partial residual batch cannot prove full commit",
            )
    elif new_bkt_observations:
        raise _fail(
            "idempotency_conflict",
            "completed event exists but observations were missing",
        )

    await _apply_bkt_updates(
        user_id=user_id,
        observations=new_bkt_observations,
        db=db,
    )
