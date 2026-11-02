"""Load and validate the versioned, offline teaching-material catalog."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

CEFR_TO_NUM = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
NUM_TO_CEFR = {value: key for key, value in CEFR_TO_NUM.items()}

MATERIALS_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "teaching_materials.json"
)

_REQUIRED_FIELDS = {
    "id",
    "document",
    "scenario_name",
    "difficulty_cefr",
    "cefr_numeric",
    "category",
    "primary_skill",
    "skill_tags",
    "priority",
}


class MaterialCatalogError(ValueError):
    """Raised when the versioned teaching-material catalog is malformed."""


@dataclass(frozen=True, slots=True)
class CatalogMaterial:
    """One validated catalog entry with immutable tag storage."""

    id: str
    document: str
    scenario_name: str
    difficulty_cefr: str
    cefr_numeric: int
    category: str
    primary_skill: str
    skill_tags: tuple[str, ...]
    priority: int


def _require_text(record: dict[str, Any], key: str, location: str) -> str:
    value = record.get(key)
    if type(value) is not str or not value.strip():
        raise MaterialCatalogError(f"{location}: {key} must be a non-empty string")
    return value


def _validate_record(record: Any, location: str) -> CatalogMaterial:
    if type(record) is not dict:
        raise MaterialCatalogError(f"{location}: material must be an object")

    missing = sorted(_REQUIRED_FIELDS.difference(record))
    if missing:
        raise MaterialCatalogError(
            f"{location}: missing required fields: {', '.join(missing)}"
        )

    material_id = _require_text(record, "id", location)
    document = _require_text(record, "document", location)
    scenario_name = _require_text(record, "scenario_name", location)
    category = _require_text(record, "category", location)
    difficulty_cefr = _require_text(record, "difficulty_cefr", location)
    primary_skill = _require_text(record, "primary_skill", location)

    if difficulty_cefr not in CEFR_TO_NUM:
        raise MaterialCatalogError(
            f"{location}: difficulty_cefr must be one of {', '.join(CEFR_TO_NUM)}"
        )

    cefr_numeric = record.get("cefr_numeric")
    if type(cefr_numeric) is not int:
        raise MaterialCatalogError(f"{location}: cefr_numeric must be an integer")
    if cefr_numeric != CEFR_TO_NUM[difficulty_cefr]:
        raise MaterialCatalogError(
            f"{location}: cefr_numeric does not match difficulty_cefr"
        )

    raw_skill_tags = record.get("skill_tags")
    if type(raw_skill_tags) is not list or not raw_skill_tags:
        raise MaterialCatalogError(f"{location}: skill_tags must be a non-empty array")

    skill_tags: list[str] = []
    seen_skill_tags: set[str] = set()
    for tag_index, raw_tag in enumerate(raw_skill_tags):
        if type(raw_tag) is not str or not raw_tag.strip():
            raise MaterialCatalogError(
                f"{location}: skill_tags[{tag_index}] must be a non-empty string"
            )
        if raw_tag in seen_skill_tags:
            raise MaterialCatalogError(
                f"{location}: skill_tags contains duplicate {raw_tag!r}"
            )
        seen_skill_tags.add(raw_tag)
        skill_tags.append(raw_tag)

    if primary_skill not in seen_skill_tags:
        raise MaterialCatalogError(
            f"{location}: primary_skill must be present in skill_tags"
        )

    priority = record.get("priority")
    if type(priority) is not int or priority <= 0:
        raise MaterialCatalogError(f"{location}: priority must be a positive integer")

    return CatalogMaterial(
        id=material_id,
        document=document,
        scenario_name=scenario_name,
        difficulty_cefr=difficulty_cefr,
        cefr_numeric=cefr_numeric,
        category=category,
        primary_skill=primary_skill,
        skill_tags=tuple(skill_tags),
        priority=priority,
    )


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise MaterialCatalogError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_material_catalog(path: Path = MATERIALS_PATH) -> tuple[CatalogMaterial, ...]:
    """Read, validate, and return an immutable catalog from ``path``."""

    try:
        with path.open("r", encoding="utf-8") as handle:
            raw_catalog = json.load(
                handle,
                object_pairs_hook=_reject_duplicate_json_keys,
            )
    except MaterialCatalogError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise MaterialCatalogError(
            f"unable to load teaching-material catalog from {path}: {exc}"
        ) from exc

    if type(raw_catalog) is not list or not raw_catalog:
        raise MaterialCatalogError(
            f"{path}: catalog must be a non-empty array of materials"
        )

    materials: list[CatalogMaterial] = []
    seen_ids: set[str] = set()
    for index, record in enumerate(raw_catalog):
        location = f"{path}: material[{index}]"
        material = _validate_record(record, location)
        if material.id in seen_ids:
            raise MaterialCatalogError(
                f"{location}: duplicate teaching-material id {material.id!r}"
            )
        seen_ids.add(material.id)
        materials.append(material)

    return tuple(materials)


@lru_cache(maxsize=1)
def get_material_catalog() -> tuple[CatalogMaterial, ...]:
    """Return the validated process-wide catalog from the fixed source path."""

    return load_material_catalog(MATERIALS_PATH)
