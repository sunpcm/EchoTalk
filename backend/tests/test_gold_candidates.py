"""Pure-offline tests for the gold-candidate lint and template CLI.

Run with ``--noconftest -o addopts= --no-cov`` from the backend directory so the
default ``tests/conftest.py`` (which imports the application and database) is
never loaded.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.acceptance_common import AcceptanceInputError, decode_json_object
from scripts.gold_candidates import (
    ANNOTATION_FIELDS,
    GOAL_CORPUS_ID,
    SGEC_CORPUS_ID,
    SUPPORTED_GOAL_IDS,
    compute_content_hash,
    generate_template,
    lint_corpus,
    validate_template,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "scripts.gold_candidates", *args],
        cwd=BACKEND_DIR,
        env=dict(os.environ),
        capture_output=True,
        text=True,
    )


def _sgec_candidate(cid: str, category: str = "no_error") -> dict:
    return {
        "id": cid,
        "version": 1,
        "source": "synthetic",
        "review_status": "unreviewed",
        "category": category,
        "input": {"utterance": "I am fine."},
        "proposal": {"findings": []},
    }


def _goal_candidate(
    cid: str,
    category: str = "direct_behavior",
    *,
    goal_id: str = "mat_biz_greet_b1:introduce_name_and_role",
    goal_version: int = 1,
    result: str = "achieved",
) -> dict:
    return {
        "id": cid,
        "version": 1,
        "source": "synthetic",
        "review_status": "unreviewed",
        "category": category,
        "goal_id": goal_id,
        "goal_version": goal_version,
        "input": {"student_utterances": ["My name is Alice."], "agent_utterances": []},
        "proposal": {
            "result": result,
            "rationale": "r",
            "evaluator_version": "deterministic-goal-v2",
        },
    }


def _sgec_doc(candidates: list) -> dict:
    doc = {
        "schema_version": 1,
        "corpus_id": SGEC_CORPUS_ID,
        "corpus_version": 1,
        "source": "synthetic",
        "content_hash": "",
        "candidates": candidates,
    }
    doc["content_hash"] = compute_content_hash(doc)
    return doc


def _goal_doc(candidates: list) -> dict:
    doc = {
        "schema_version": 1,
        "corpus_id": GOAL_CORPUS_ID,
        "corpus_version": 1,
        "source": "synthetic",
        "content_hash": "",
        "candidates": candidates,
    }
    doc["content_hash"] = compute_content_hash(doc)
    return doc


def test_lint_shipped_corpora_pass():
    for name in ("sgec_candidates.v1.json", "goal_candidates.v1.json"):
        result = _run_cli("lint", "--corpus", str(REPO_ROOT / "docs/evaluation" / name))
        assert result.returncode == 0, result.stderr


def test_shipped_corpora_have_24_candidates_each():
    for name in ("sgec_candidates.v1.json", "goal_candidates.v1.json"):
        doc = json.loads((REPO_ROOT / "docs/evaluation" / name).read_text())
        assert len(doc["candidates"]) >= 24


def test_shipped_goal_corpus_covers_six_official_ids():
    doc = json.loads(
        (REPO_ROOT / "docs/evaluation/goal_candidates.v1.json").read_text()
    )
    assert {c["goal_id"] for c in doc["candidates"]} == set(SUPPORTED_GOAL_IDS)


def test_lint_duplicate_id():
    doc = _sgec_doc([_sgec_candidate("a"), _sgec_candidate("a")])
    assert lint_corpus(doc, SGEC_CORPUS_ID) == 1


def test_lint_hash_mismatch():
    doc = _sgec_doc([_sgec_candidate("a")])
    doc["content_hash"] = "deadbeef"
    assert lint_corpus(doc, SGEC_CORPUS_ID) == 1


def test_lint_false_reviewed():
    candidate = _sgec_candidate("a")
    candidate["review_status"] = "approved"
    assert lint_corpus(_sgec_doc([candidate]), SGEC_CORPUS_ID) == 1


def test_lint_empty_set():
    assert lint_corpus(_sgec_doc([]), SGEC_CORPUS_ID) == 3


def test_lint_unknown_category():
    assert (
        lint_corpus(_sgec_doc([_sgec_candidate("a", category="bogus")]), SGEC_CORPUS_ID)
        == 1
    )


def test_lint_unknown_corpus_id_does_not_assert():
    doc = _sgec_doc([_sgec_candidate("a")])
    doc.pop("corpus_id")
    doc["content_hash"] = compute_content_hash(doc)
    assert lint_corpus(doc, None) == 1


def test_lint_unknown_goal_id():
    doc = _goal_doc([_goal_candidate("g", goal_id="mat_bogus:goal")])
    assert lint_corpus(doc, GOAL_CORPUS_ID) == 1


def test_lint_goal_version_2_rejected_outside_unknown_version():
    doc = _goal_doc([_goal_candidate("g", category="direct_behavior", goal_version=2)])
    assert lint_corpus(doc, GOAL_CORPUS_ID) == 1


def test_lint_unknown_version_valid():
    doc = _goal_doc(
        [
            _goal_candidate(
                "g", category="unknown_version", goal_version=2, result="not_assessed"
            )
        ]
    )
    assert lint_corpus(doc, GOAL_CORPUS_ID) == 0


def test_lint_unknown_version_wrong_result():
    doc = _goal_doc(
        [
            _goal_candidate(
                "g", category="unknown_version", goal_version=2, result="achieved"
            )
        ]
    )
    assert lint_corpus(doc, GOAL_CORPUS_ID) == 1


def test_template_blind_omits_proposal():
    template = generate_template(_sgec_doc([_sgec_candidate("a")]), blind=True)
    assert template["blind"] is True
    entry = template["annotations"][0]
    assert "proposal" not in entry
    for field in ANNOTATION_FIELDS:
        assert entry[field] is None


def test_template_visible_includes_proposal():
    template = generate_template(_sgec_doc([_sgec_candidate("a")]), blind=False)
    assert template["annotations"][0]["proposal"] == {"findings": []}


def test_goal_template_includes_human_context_without_proposal():
    doc = _goal_doc([_goal_candidate("g")])
    template = generate_template(doc, blind=True)
    entry = template["annotations"][0]
    assert entry["goal_id"] == "mat_biz_greet_b1:introduce_name_and_role"
    assert entry["goal_version"] == 1
    assert entry["goal_label"]
    assert entry["goal_criteria"]
    assert entry["goal_supported"] is True
    assert "proposal" not in entry


def test_goal_template_unknown_version_marks_unsupported():
    doc = _goal_doc(
        [
            _goal_candidate(
                "g",
                category="unknown_version",
                goal_version=2,
                result="not_assessed",
            )
        ]
    )
    template = generate_template(doc, blind=True)
    entry = template["annotations"][0]
    assert entry["goal_supported"] is False
    assert "unsupported" in entry["goal_criteria"].lower()
    assert "proposal" not in entry


def test_validate_template_rejects_goal_context_tamper():
    doc = _goal_doc([_goal_candidate("g")])
    template = generate_template(doc, blind=True)
    template["annotations"][0]["goal_label"] = "tampered"
    assert validate_template(template, doc) == 1


def test_validate_template_unannotated_is_incomplete():
    doc = _sgec_doc([_sgec_candidate("a"), _sgec_candidate("b")])
    template = generate_template(doc, blind=True)
    assert validate_template(template, doc) == 3


def test_validate_template_full_gold():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    entry = template["annotations"][0]
    entry.update(
        {
            "annotator": "reviewer-1",
            "judgment": {"accepted": True, "findings": []},
            "evidence": "I am fine.",
            "rationale": "r",
            "dispute": None,
            "review_ruling": None,
            "annotation_version": 1,
        }
    )
    assert validate_template(template, doc) == 0


def test_validate_template_hash_mismatch():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    template["corpus_content_hash"] = "deadbeef"
    assert validate_template(template, doc) == 1


def test_validate_template_partial_fill_is_incomplete():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    template["annotations"][0]["judgment"] = {"accepted": True, "findings": []}
    assert validate_template(template, doc) == 3


def test_validate_template_rejects_false_boolean_fields():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    entry = template["annotations"][0]
    entry["judgment"] = False
    entry["annotator"] = False
    assert validate_template(template, doc) == 1


def test_validate_template_rejects_invalid_judgment_domain():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    entry = template["annotations"][0]
    entry.update(
        {
            "annotator": "reviewer-1",
            "judgment": "bogus",
            "evidence": "e",
            "rationale": "r",
            "dispute": None,
            "review_ruling": None,
            "annotation_version": 1,
        }
    )
    assert validate_template(template, doc) == 1


def test_validate_template_rejects_swapped_input():
    doc = _sgec_doc([_sgec_candidate("a"), _sgec_candidate("b")])
    template = generate_template(doc, blind=True)
    template["annotations"][0]["input"] = {"utterance": "tampered"}
    assert validate_template(template, doc) == 1


def test_validate_template_rejects_goal_id_swap():
    doc = _goal_doc(
        [_goal_candidate("g", goal_id="mat_biz_greet_b1:introduce_name_and_role")]
    )
    template = generate_template(doc, blind=True)
    template["annotations"][0]["goal_id"] = "mat_hotel_checkin_b1:ask_checkout_time"
    assert validate_template(template, doc) == 1


def test_validate_template_rejects_goal_version_swap():
    doc = _goal_doc([_goal_candidate("g", goal_version=1)])
    template = generate_template(doc, blind=True)
    template["annotations"][0]["goal_version"] = 2
    assert validate_template(template, doc) == 1


def test_validate_template_duplicate_candidate():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    template["annotations"].append(dict(template["annotations"][0]))
    assert validate_template(template, doc) == 1


def test_validate_template_blind_rejects_proposal():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    template["annotations"][0]["proposal"] = {"findings": []}
    assert validate_template(template, doc) == 1


def test_validate_template_visible_binds_proposal():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=False)
    assert template["annotations"][0]["proposal"] == {"findings": []}
    assert validate_template(template, doc) == 3

    template["annotations"][0]["proposal"] = {"findings": [{"skill_tag": "x"}]}
    assert validate_template(template, doc) == 1


def test_validate_template_rejects_unhashable_context():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    template["allowed_skill_tags"] = [["article_usage"]] * len(
        template["allowed_skill_tags"]
    )
    assert validate_template(template, doc) == 1

    goal = _goal_doc([_goal_candidate("g")])
    goal_template = generate_template(goal, blind=True)
    goal_template["goal_states"] = [["achieved"]] * len(goal_template["goal_states"])
    assert validate_template(goal_template, goal) == 1


def test_decode_rejects_nan_and_duplicate_keys():
    with pytest.raises(AcceptanceInputError):
        decode_json_object('{"x": NaN}')
    with pytest.raises(AcceptanceInputError):
        decode_json_object('{"x": 1, "x": 2}')


def test_cli_bad_utf8_returns_2(tmp_path: Path):
    corpus_path = tmp_path / "corpus.json"
    corpus_path.write_bytes(b'{"schema_version": 1, "corpus_id": "\xff\xfe"}')
    result = _run_cli("lint", "--corpus", str(corpus_path))
    assert result.returncode == 2


def test_template_and_validate_cli_exit_codes(tmp_path: Path):
    corpus_path = tmp_path / "corpus.json"
    corpus_path.write_text(json.dumps(_sgec_doc([_sgec_candidate("a")])))

    result = _run_cli("template", "--corpus", str(corpus_path), "--blind")
    assert result.returncode == 0
    template = json.loads(result.stdout)
    assert template["blind"] is True
    assert "proposal" not in template["annotations"][0]

    template_path = tmp_path / "template.json"
    template_path.write_text(result.stdout)
    result = _run_cli(
        "validate-template",
        "--corpus",
        str(corpus_path),
        "--template",
        str(template_path),
    )
    assert result.returncode == 3
    assert "filled=0/1" in result.stderr


def _fill_annotation(entry: dict, *, judgment) -> dict:
    entry.update(
        {
            "annotator": "reviewer-1",
            "judgment": judgment,
            "evidence": "I am fine.",
            "rationale": "r",
            "dispute": None,
            "review_ruling": None,
            "annotation_version": 1,
        }
    )
    return entry


def test_sgec_judgment_accept_and_reject_are_valid():
    doc = _sgec_doc([_sgec_candidate("a")])
    valid = [
        {"accepted": True, "findings": []},
        {"accepted": False, "findings": []},
        {
            "accepted": True,
            "findings": [
                {
                    "skill_tag": "article_usage",
                    "original": "a elephant",
                    "corrected": "an elephant",
                    "error_type": "article",
                    "confidence": None,
                }
            ],
        },
    ]
    for judgment in valid:
        template = generate_template(doc, blind=True)
        _fill_annotation(template["annotations"][0], judgment=judgment)
        assert validate_template(template, doc) == 0


def test_sgec_judgment_rejects_bad_shapes():
    doc = _sgec_doc([_sgec_candidate("a")])
    bad = [
        {"accepted": 1, "findings": []},
        {"accepted": True, "findings": "not-a-list"},
        {
            "accepted": True,
            "findings": [
                {
                    "skill_tag": "made_up_tag",
                    "original": "a",
                    "corrected": "an",
                    "error_type": "article",
                    "confidence": None,
                }
            ],
        },
        {
            "accepted": True,
            "findings": [
                {
                    "skill_tag": "article_usage",
                    "original": "a",
                    "corrected": "an",
                    "error_type": "article",
                    "confidence": True,
                }
            ],
        },
        {
            "accepted": True,
            "findings": [
                {
                    "skill_tag": "article_usage",
                    "original": "a",
                    "corrected": "an",
                    "error_type": "article",
                    "confidence": 1.5,
                }
            ],
        },
        {
            "accepted": True,
            "findings": [
                {
                    "skill_tag": "article_usage",
                    "original": "a",
                    "corrected": "an",
                    "error_type": "article",
                    "confidence": None,
                    "extra": 1,
                }
            ],
        },
    ]
    for judgment in bad:
        template = generate_template(doc, blind=True)
        _fill_annotation(template["annotations"][0], judgment=judgment)
        assert validate_template(template, doc) == 1


def test_goal_judgment_requires_four_state():
    doc = _goal_doc([_goal_candidate("g")])
    valid = ["achieved", "not_achieved", "unknown", "not_assessed"]
    for judgment in valid:
        template = generate_template(doc, blind=True)
        _fill_annotation(template["annotations"][0], judgment=judgment)
        assert validate_template(template, doc) == 0
    for judgment in ("accept", "reject", False, True, 0, 1, []):
        template = generate_template(doc, blind=True)
        _fill_annotation(template["annotations"][0], judgment=judgment)
        assert validate_template(template, doc) == 1


def test_goal_template_rejects_bool_goal_version():
    doc = _goal_doc([_goal_candidate("g", goal_version=1)])
    template = generate_template(doc, blind=True)
    template["annotations"][0]["goal_version"] = True
    assert validate_template(template, doc) == 1


def test_lint_enum_membership_does_not_crash_on_unhashable():
    doc = _sgec_doc([_sgec_candidate("a")])
    doc["candidates"][0]["category"] = ["no_error"]
    doc["content_hash"] = compute_content_hash(doc)
    assert lint_corpus(doc, SGEC_CORPUS_ID) == 1

    goal = _goal_doc([_goal_candidate("g")])
    goal["candidates"][0]["goal_id"] = {
        "id": "mat_biz_greet_b1:introduce_name_and_role"
    }
    goal["content_hash"] = compute_content_hash(goal)
    assert lint_corpus(goal, GOAL_CORPUS_ID) == 1


def test_validate_template_rejects_tampered_corpus_context():
    doc = _sgec_doc([_sgec_candidate("a")])
    template = generate_template(doc, blind=True)
    template["task_context"] = "tampered"
    assert validate_template(template, doc) == 1

    template = generate_template(doc, blind=True)
    template["allowed_skill_tags"] = ["article_usage"]
    assert validate_template(template, doc) == 1
