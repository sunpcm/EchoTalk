"""Validate the versioned teaching-material catalog and print its digest."""

from __future__ import annotations

import hashlib
import json
import sys

from services.material_catalog import (
    CatalogMaterial,
    MaterialCatalogError,
    get_material_catalog,
)


def _material_payload(material: CatalogMaterial) -> dict[str, object]:
    return {
        "id": material.id,
        "document": material.document,
        "scenario_name": material.scenario_name,
        "difficulty_cefr": material.difficulty_cefr,
        "cefr_numeric": material.cefr_numeric,
        "category": material.category,
        "primary_skill": material.primary_skill,
        "skill_tags": list(material.skill_tags),
        "priority": material.priority,
    }


def catalog_digest(
    materials: tuple[CatalogMaterial, ...] | None = None,
) -> str:
    """Return a deterministic SHA-256 digest of validated catalog content."""

    selected = materials if materials is not None else get_material_catalog()
    payload = [_material_payload(material) for material in selected]
    canonical_json = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def validate_catalog() -> tuple[int, str]:
    """Load the fixed catalog and return its material count and digest."""

    materials = get_material_catalog()
    return len(materials), catalog_digest(materials)


def main() -> int:
    try:
        materials = get_material_catalog()
        digest = catalog_digest(materials)
    except MaterialCatalogError as exc:
        print(f"[seed_corpus] Catalog validation failed: {exc}", file=sys.stderr)
        return 1

    print(f"[seed_corpus] Validated {len(materials)} offline teaching materials.")
    print(f"[seed_corpus] Catalog SHA-256: {digest}")
    for material in materials:
        print(
            f"  - {material.scenario_name:40s} "
            f"CEFR={material.difficulty_cefr} "
            f"skill={material.primary_skill} "
            f"priority={material.priority}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
