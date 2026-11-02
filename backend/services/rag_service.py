"""Deterministic, offline retrieval for adaptive curriculum recommendations."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from services.material_catalog import (
    CEFR_TO_NUM,
    NUM_TO_CEFR,
    CatalogMaterial,
    get_material_catalog,
)

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RetrievedMaterial:
    """One teaching material returned in the existing caller-facing shape."""

    id: str
    document: str
    scenario_name: str
    difficulty_cefr: str
    category: str
    primary_skill: str
    skill_tags: list[str]
    # Kept only for internal caller compatibility; this is not a similarity score.
    distance: float


def _rank_key(
    material: CatalogMaterial,
    weak_skills: frozenset[str],
) -> tuple[int, int, int, str]:
    primary_miss = 0 if material.primary_skill in weak_skills else 1
    overlap_count = len(weak_skills.intersection(material.skill_tags))
    return (primary_miss, -overlap_count, material.priority, material.id)


def retrieve_materials(
    weak_skills: list[str],
    target_level: str = "B1",
    top_k: int = 3,
) -> list[RetrievedMaterial]:
    """
    Return deterministic materials within Krashen's ``target`` to ``target + 1`` range.

    Primary-skill matches rank first, followed by the number of distinct matching
    skill tags, explicit catalog priority, and id. If no skill matches, the same
    ordering still provides a stable priority/id fallback within the CEFR range.
    """

    if type(top_k) is not int:
        raise ValueError("top_k must be an integer")
    if top_k <= 0:
        return []

    target = target_level.upper() if type(target_level) is str else "B1"
    current_numeric = CEFR_TO_NUM.get(target, CEFR_TO_NUM["B1"])
    upper_numeric = min(current_numeric + 1, CEFR_TO_NUM["C2"])
    unique_weak_skills = frozenset(
        skill for skill in weak_skills if type(skill) is str and skill
    )

    candidates = [
        material
        for material in get_material_catalog()
        if current_numeric <= material.cefr_numeric <= upper_numeric
    ]
    ranked = sorted(candidates, key=lambda item: _rank_key(item, unique_weak_skills))
    selected = ranked[:top_k]

    logger.info(
        "Catalog retrieve: weak_skills=%s, cefr_range=[%s~%s], top_k=%d, found=%d",
        sorted(unique_weak_skills),
        NUM_TO_CEFR[current_numeric],
        NUM_TO_CEFR[upper_numeric],
        top_k,
        len(selected),
    )

    return [
        RetrievedMaterial(
            id=material.id,
            document=material.document,
            scenario_name=material.scenario_name,
            difficulty_cefr=material.difficulty_cefr,
            category=material.category,
            primary_skill=material.primary_skill,
            skill_tags=list(material.skill_tags),
            distance=0.0,
        )
        for material in selected
    ]
