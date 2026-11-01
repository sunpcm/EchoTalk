import json
import os
import subprocess
import sys
from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import Any

import pytest

from services.material_catalog import (
    MATERIALS_PATH,
    CatalogMaterial,
    MaterialCatalogError,
    get_material_catalog,
    load_material_catalog,
)
from services.rag_service import retrieve_materials

BACKEND_ROOT = Path(__file__).resolve().parents[1]

EXPECTED_CATALOG = [
    (
        "mat_biz_greet_b1",
        "business_meeting_greetings",
        "B1",
        3,
        "conversation",
        "word_stress",
        ("word_stress", "linking_sounds"),
        1,
    ),
    (
        "mat_past_perfect_b2",
        "past_perfect_explanation",
        "B2",
        4,
        "grammar",
        "verb_tense_past",
        ("verb_tense_past",),
        2,
    ),
    (
        "mat_th_minimal_a2",
        "th_minimal_pairs",
        "A2",
        2,
        "pronunciation",
        "th_sounds",
        ("th_sounds", "consonant_clusters"),
        3,
    ),
    (
        "mat_hotel_checkin_b1",
        "hotel_checkin_roleplay",
        "B1",
        3,
        "conversation",
        "preposition",
        ("preposition", "linking_sounds"),
        4,
    ),
    (
        "mat_svagree_a2",
        "subject_verb_agreement_drill",
        "A2",
        2,
        "grammar",
        "subject_verb_agreement",
        ("subject_verb_agreement", "verb_tense_present"),
        5,
    ),
    (
        "mat_restaurant_b1",
        "restaurant_ordering",
        "B1",
        3,
        "conversation",
        "vowel_sounds",
        ("vowel_sounds", "article_usage"),
        6,
    ),
    (
        "mat_articles_b2",
        "advanced_articles",
        "B2",
        4,
        "grammar",
        "article_usage",
        ("article_usage",),
        7,
    ),
    (
        "mat_presentation_b2",
        "business_presentation",
        "B2",
        4,
        "conversation",
        "word_stress",
        ("word_stress", "consonant_clusters"),
        8,
    ),
    (
        "mat_vowel_contrast_a2",
        "vowel_contrast_drill",
        "A2",
        2,
        "pronunciation",
        "vowel_sounds",
        ("vowel_sounds",),
        9,
    ),
    (
        "mat_job_interview_c1",
        "job_interview_simulation",
        "C1",
        5,
        "conversation",
        "verb_tense_past",
        ("verb_tense_past", "word_stress"),
        10,
    ),
]


def _catalog_records() -> list[dict[str, Any]]:
    return json.loads(MATERIALS_PATH.read_text(encoding="utf-8"))


def _write_catalog(path: Path, records: list[dict[str, Any]]) -> None:
    path.write_text(json.dumps(records), encoding="utf-8")


def _material(
    material_id: str,
    primary_skill: str,
    skill_tags: tuple[str, ...],
    priority: int,
) -> CatalogMaterial:
    return CatalogMaterial(
        id=material_id,
        document=f"Document for {material_id}",
        scenario_name=material_id,
        difficulty_cefr="B1",
        cefr_numeric=3,
        category="conversation",
        primary_skill=primary_skill,
        skill_tags=skill_tags,
        priority=priority,
    )


def test_versioned_catalog_matches_all_ten_seed_materials():
    catalog = get_material_catalog()
    actual = [
        (
            item.id,
            item.scenario_name,
            item.difficulty_cefr,
            item.cefr_numeric,
            item.category,
            item.primary_skill,
            item.skill_tags,
            item.priority,
        )
        for item in catalog
    ]

    assert isinstance(catalog, tuple)
    assert actual == EXPECTED_CATALOG
    assert all(item.document.strip() for item in catalog)
    assert len({item.id for item in catalog}) == 10


@pytest.mark.parametrize(
    ("mutator", "message"),
    [
        (
            lambda records: records[1].update({"id": records[0]["id"]}),
            "duplicate teaching-material id",
        ),
        (lambda records: records[0].update({"id": " "}), "id must be"),
        (
            lambda records: records[0].update({"difficulty_cefr": "D1"}),
            "difficulty_cefr must be one of",
        ),
        (
            lambda records: records[0].update({"cefr_numeric": 4}),
            "cefr_numeric does not match",
        ),
        (
            lambda records: records[0].update({"cefr_numeric": "3"}),
            "cefr_numeric must be an integer",
        ),
        (
            lambda records: records[0].update({"priority": 0}),
            "priority must be a positive integer",
        ),
        (
            lambda records: records[0].update({"priority": True}),
            "priority must be a positive integer",
        ),
        (
            lambda records: records[0].update({"skill_tags": "word_stress"}),
            "skill_tags must be a non-empty array",
        ),
        (
            lambda records: records[0].update({"skill_tags": [1]}),
            r"skill_tags\[0\] must be a non-empty string",
        ),
        (
            lambda records: records[0].update(
                {"skill_tags": ["word_stress", "word_stress"]}
            ),
            "skill_tags contains duplicate",
        ),
        (
            lambda records: records[0].update({"primary_skill": "not_in_tags"}),
            "primary_skill must be present in skill_tags",
        ),
        (
            lambda records: records[0].update({"scenario_name": 1}),
            "scenario_name must be a non-empty string",
        ),
        (
            lambda records: records[0].update({"document": ""}),
            "document must be a non-empty string",
        ),
        (lambda records: records[0].pop("document"), "missing required fields"),
        (lambda records: records.clear(), "catalog must be a non-empty array"),
    ],
)
def test_bad_catalog_data_fails_closed(tmp_path, mutator, message):
    records = _catalog_records()
    mutator(records)
    path = tmp_path / "teaching_materials.json"
    _write_catalog(path, records)

    with pytest.raises(MaterialCatalogError, match=message):
        load_material_catalog(path)


def test_catalog_cache_and_retrieval_results_cannot_pollute_later_calls():
    first_catalog = get_material_catalog()
    second_catalog = get_material_catalog()
    assert first_catalog is second_catalog

    with pytest.raises(FrozenInstanceError):
        first_catalog[0].id = "mutated"
    assert isinstance(first_catalog[0].skill_tags, tuple)

    first_result = retrieve_materials(["word_stress"], "B1", 1)
    second_result = retrieve_materials(["word_stress"], "B1", 1)
    assert first_result[0] is not second_result[0]
    assert first_result[0].skill_tags is not second_result[0].skill_tags

    first_result[0].skill_tags.append("polluted")
    assert "polluted" not in second_result[0].skill_tags
    assert first_result[0].distance == 0.0
    assert second_result[0].distance == 0.0


def test_cefr_boundaries_case_fallback_and_top_k_behaviour():
    lowercase_b1 = retrieve_materials(["article_usage"], "b1", 10)
    lowercase_b2 = retrieve_materials(["article_usage"], "b2", 10)
    invalid_level = retrieve_materials(["article_usage"], "not-a-level", 10)
    whitespace_b2 = retrieve_materials(["article_usage"], " B2 ", 10)
    c1 = retrieve_materials(["verb_tense_past"], "C1", 10)
    c2 = retrieve_materials(["verb_tense_past"], "C2", 10)

    assert [item.id for item in lowercase_b1] == [
        "mat_articles_b2",
        "mat_restaurant_b1",
        "mat_biz_greet_b1",
        "mat_past_perfect_b2",
        "mat_hotel_checkin_b1",
        "mat_presentation_b2",
    ]
    assert [item.id for item in lowercase_b2] == [
        "mat_articles_b2",
        "mat_past_perfect_b2",
        "mat_presentation_b2",
        "mat_job_interview_c1",
    ]
    assert [item.id for item in invalid_level] == [item.id for item in lowercase_b1]
    assert [item.id for item in whitespace_b2] == [item.id for item in lowercase_b1]
    assert [item.id for item in c1] == ["mat_job_interview_c1"]
    assert c2 == []
    assert retrieve_materials([], "B1", 0) == []
    assert retrieve_materials([], "B1", -2) == []


@pytest.mark.parametrize("top_k", [1.5, "3", True, None])
def test_non_integer_top_k_is_rejected(top_k):
    with pytest.raises(ValueError, match="top_k must be an integer"):
        retrieve_materials([], "B1", top_k)


def test_empty_or_unmatched_skills_use_priority_and_id_fallback():
    empty = retrieve_materials([], "B1", 100)
    unmatched = retrieve_materials(["unknown_skill"], "B1", 100)

    assert [item.id for item in empty] == [
        "mat_biz_greet_b1",
        "mat_past_perfect_b2",
        "mat_hotel_checkin_b1",
        "mat_restaurant_b1",
        "mat_articles_b2",
        "mat_presentation_b2",
    ]
    assert [item.id for item in unmatched] == [item.id for item in empty]
    assert all(item.difficulty_cefr in {"B1", "B2"} for item in empty)
    assert len({item.id for item in empty}) == len(empty)


def test_primary_overlap_priority_and_id_are_stable(monkeypatch):
    custom_catalog = (
        _material("primary", "alpha", ("alpha",), 20),
        _material("overlap_two", "unused", ("alpha", "beta"), 15),
        _material("single_beta", "unused", ("beta",), 2),
        _material("tie_z", "unused", ("beta",), 4),
        _material("tie_a", "unused", ("beta",), 4),
        _material("duplicate_alpha", "unused", ("alpha",), 9),
        _material("fallback", "unused", ("gamma",), 1),
    )
    monkeypatch.setattr(
        "services.rag_service.get_material_catalog",
        lambda: custom_catalog,
    )

    results = retrieve_materials(
        weak_skills=["alpha", "alpha", "beta"],
        target_level="B1",
        top_k=100,
    )

    assert [item.id for item in results] == [
        "primary",
        "overlap_two",
        "single_beta",
        "tie_a",
        "tie_z",
        "duplicate_alpha",
        "fallback",
    ]


def _offline_sitecustomize() -> str:
    return """
import socket
import sys

class BlockedImports:
    blocked = {
        "chromadb",
        "librosa",
        "scikit_learn",
        "sentence_transformers",
        "sklearn",
        "soundfile",
    }

    @classmethod
    def find_spec(cls, fullname, path=None, target=None):
        root_name = fullname.partition(".")[0]
        if root_name in cls.blocked:
            raise RuntimeError(f"offline import attempted: {root_name}")
        return None

def blocked_network(*args, **kwargs):
    raise RuntimeError("offline network access attempted")

sys.meta_path.insert(0, BlockedImports)
socket.create_connection = blocked_network
socket.socket.connect = blocked_network
socket.socket.connect_ex = blocked_network
"""


def test_seed_module_is_offline_deterministic_and_cwd_independent(tmp_path):
    blocker_dir = tmp_path / "blocker"
    blocker_dir.mkdir()
    (blocker_dir / "sitecustomize.py").write_text(
        _offline_sitecustomize(),
        encoding="utf-8",
    )

    environment = os.environ.copy()
    existing_pythonpath = environment.get("PYTHONPATH")
    pythonpath = [str(BACKEND_ROOT), str(blocker_dir)]
    if existing_pythonpath:
        pythonpath.append(existing_pythonpath)
    environment["PYTHONPATH"] = os.pathsep.join(pythonpath)

    command = [sys.executable, "-B", "-m", "scripts.seed_corpus"]
    first = subprocess.run(
        command,
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )
    second = subprocess.run(
        command,
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert first.stdout == second.stdout
    assert first.stderr == ""
    assert second.stderr == ""
    assert "Validated 10 offline teaching materials." in first.stdout
    assert "Catalog SHA-256:" in first.stdout
