"""SGEC 严格离线校验纯模块与 CLI runner 的测试。"""

import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

from services.sgec_offline import validate_sgec_batch

ALLOWED_TAGS = ("article_usage", "verb_tense", "preposition")
BACKEND_DIR = Path(__file__).resolve().parents[1]


def _error(**overrides):
    item = {
        "skill_tag": "article_usage",
        "original": "I saw a elephant.",
        "corrected": "I saw an elephant.",
        "error_type": "article",
    }
    item.update(overrides)
    return item


def _batch(*errors):
    return {"errors": list(errors)}


def test_empty_errors_is_valid():
    result = validate_sgec_batch({"errors": []}, ALLOWED_TAGS)
    assert result.ok is True
    assert result.accepted == ()
    assert result.issues == ()


def test_valid_batch_preserves_confidence_variants():
    batch = _batch(
        _error(confidence=0.82),
        _error(confidence=None),
        _error(),
        _error(confidence=0),
        _error(confidence=1),
    )
    result = validate_sgec_batch(batch, ALLOWED_TAGS)
    assert result.ok is True
    assert len(result.accepted) == 5
    assert result.issues == ()

    assert result.accepted[0].confidence == 0.82
    assert isinstance(result.accepted[0].confidence, float)
    assert result.accepted[1].confidence is None
    assert result.accepted[2].confidence is None
    assert result.accepted[3].confidence == 0
    assert isinstance(result.accepted[3].confidence, int)
    assert result.accepted[4].confidence == 1
    assert isinstance(result.accepted[4].confidence, int)


def test_valid_batch_preserves_core_values_and_types():
    item = _error(confidence=0.5)
    result = validate_sgec_batch(_batch(item), ALLOWED_TAGS)
    assert result.ok is True
    accepted = result.accepted[0]
    assert accepted.skill_tag == "article_usage"
    assert isinstance(accepted.skill_tag, str)
    assert accepted.original == "I saw a elephant."
    assert isinstance(accepted.original, str)
    assert accepted.corrected == "I saw an elephant."
    assert isinstance(accepted.corrected, str)
    assert accepted.error_type == "article"
    assert isinstance(accepted.error_type, str)
    assert accepted.confidence == 0.5


def test_accepted_item_controlled_metadata_fixed():
    result = validate_sgec_batch(_batch(_error(confidence=0.82)), ALLOWED_TAGS)
    item = result.accepted[0]
    assert item.source == "offline_synthetic"
    assert item.provider is None
    assert item.model_version is None
    assert item.is_synthetic is True


def test_caller_custom_set_supported():
    custom = {"my_tag", "another_tag"}
    result = validate_sgec_batch(_batch(_error(skill_tag="my_tag")), custom)
    assert result.ok is True

    result = validate_sgec_batch(_batch(_error(skill_tag="article_usage")), custom)
    assert result.ok is False
    assert result.issues[0].code == "unknown_skill_tag"


def test_bare_string_allowed_tags_is_rejected():
    result = validate_sgec_batch(_batch(_error(skill_tag="a")), "article_usage")
    assert result.ok is False
    assert result.accepted == ()
    assert result.issues[0].code == "invalid_allowed_tags"

    result = validate_sgec_batch(
        _batch(_error(skill_tag="article_usage")), "article_usage"
    )
    assert result.ok is False
    assert result.accepted == ()
    assert result.issues[0].code == "invalid_allowed_tags"

    # 同 tag 单字符裸字符串也不能拆字符或当单标签集合便利接受
    result = validate_sgec_batch(_batch(_error(skill_tag="a")), "a")
    assert result.ok is False
    assert result.accepted == ()
    assert result.issues[0].code == "invalid_allowed_tags"


@pytest.mark.parametrize(
    "tags",
    [
        pytest.param(["article_usage"], id="list"),
        pytest.param(("article_usage",), id="tuple"),
        pytest.param({"article_usage"}, id="set"),
        pytest.param(frozenset({"article_usage"}), id="frozenset"),
    ],
)
def test_allowed_tags_collection_types_supported(tags):
    result = validate_sgec_batch(_batch(_error(skill_tag="article_usage")), tags)
    assert result.ok is True
    assert len(result.accepted) == 1
    assert result.issues == ()


def test_unknown_tag_with_other_allowed_still_rejected():
    result = validate_sgec_batch(
        _batch(_error(skill_tag="unknown_tag")),
        ("article_usage", "other"),
    )
    assert result.ok is False
    assert result.accepted == ()
    assert result.issues[0].code == "unknown_skill_tag"


def test_empty_string_fields_allowed():
    result = validate_sgec_batch(
        _batch(_error(original="", corrected="", error_type="")),
        ALLOWED_TAGS,
    )
    assert result.ok is True
    assert result.accepted[0].original == ""
    assert result.accepted[0].corrected == ""
    assert result.accepted[0].error_type == ""


def test_unknown_skill_tag_has_stable_error():
    result = validate_sgec_batch(_batch(_error(skill_tag="unknown_tag")), ALLOWED_TAGS)
    assert result.ok is False
    assert result.accepted == ()
    assert result.issues[0].code == "unknown_skill_tag"
    assert result.issues[0].field == "skill_tag"


def test_other_only_valid_when_explicitly_allowed():
    result = validate_sgec_batch(_batch(_error(skill_tag="other")), ALLOWED_TAGS)
    assert result.ok is False
    assert result.issues[0].code == "unknown_skill_tag"

    result = validate_sgec_batch(
        _batch(_error(skill_tag="other")),
        ("article_usage", "other"),
    )
    assert result.ok is True


def test_empty_allowed_set_rejects_any_tag():
    result = validate_sgec_batch(_batch(_error(skill_tag="article_usage")), ())
    assert result.ok is False
    assert result.issues[0].code == "unknown_skill_tag"


@pytest.mark.parametrize(
    "field_name", ["skill_tag", "original", "corrected", "error_type"]
)
def test_missing_required_string_rejected(field_name):
    item = _error()
    del item[field_name]
    result = validate_sgec_batch(_batch(item), ALLOWED_TAGS)
    assert result.ok is False
    assert result.issues[0].code == "missing_required_field"


@pytest.mark.parametrize(
    "field_name", ["skill_tag", "original", "corrected", "error_type"]
)
def test_null_required_string_rejected(field_name):
    result = validate_sgec_batch(_batch(_error(**{field_name: None})), ALLOWED_TAGS)
    assert result.ok is False
    assert result.issues[0].code == "missing_required_field"


@pytest.mark.parametrize(
    "field_name", ["skill_tag", "original", "corrected", "error_type"]
)
@pytest.mark.parametrize("bad_value", [0, True, [], {}])
def test_wrong_type_required_string_rejected(field_name, bad_value):
    result = validate_sgec_batch(
        _batch(_error(**{field_name: bad_value})), ALLOWED_TAGS
    )
    assert result.ok is False
    assert result.issues[0].code == "invalid_field_type"


@pytest.mark.parametrize("bad_confidence", [True, False, "0.82", 1.5, -0.1, 10**1000])
def test_invalid_confidence_rejected(bad_confidence):
    result = validate_sgec_batch(
        _batch(_error(confidence=bad_confidence)),
        ALLOWED_TAGS,
    )
    assert result.ok is False
    assert result.issues[0].code == "invalid_confidence"


@pytest.mark.parametrize("bad_confidence", [math.nan, math.inf, -math.inf])
def test_non_finite_confidence_rejected(bad_confidence):
    result = validate_sgec_batch(
        _batch(_error(confidence=bad_confidence)),
        ALLOWED_TAGS,
    )
    assert result.ok is False
    assert result.issues[0].code == "invalid_confidence"


@pytest.mark.parametrize(
    "extra_key",
    [
        "id",
        "session_id",
        "source",
        "provider",
        "model_version",
        "is_synthetic",
        "created_at",
        "explanation",
        "suggestion",
    ],
)
def test_extra_or_forged_field_rejected(extra_key):
    result = validate_sgec_batch(_batch(_error(**{extra_key: "x"})), ALLOWED_TAGS)
    assert result.ok is False
    assert result.issues[0].code == "unknown_field"


def test_unknown_key_not_echoed_in_issue():
    result = validate_sgec_batch(_batch(_error(secret_extra="leaked")), ALLOWED_TAGS)
    issue = result.issues[0]
    assert issue.code == "unknown_field"
    assert "secret_extra" not in issue.field
    assert "secret_extra" not in issue.path
    assert "leaked" not in issue.field
    assert "leaked" not in issue.path


def test_single_bad_record_rejects_whole_batch():
    batch = _batch(
        _error(confidence=0.9),
        _error(skill_tag="not_allowed"),
        _error(),
    )
    result = validate_sgec_batch(batch, ALLOWED_TAGS)
    assert result.ok is False
    assert result.accepted == ()
    assert result.issues[0].code == "unknown_skill_tag"


@pytest.mark.parametrize("raw", [[], "text", 1, None, True])
def test_top_level_not_object_rejected(raw):
    result = validate_sgec_batch(raw, ALLOWED_TAGS)
    assert result.ok is False
    assert result.accepted == ()
    assert result.issues[0].code == "invalid_top_level"


def test_top_level_missing_errors_rejected():
    result = validate_sgec_batch({}, ALLOWED_TAGS)
    assert result.ok is False
    assert result.issues[0].code == "invalid_top_level"


def test_top_level_errors_not_array_rejected():
    result = validate_sgec_batch({"errors": "not-an-array"}, ALLOWED_TAGS)
    assert result.ok is False
    assert result.issues[0].code == "invalid_top_level"


def test_top_level_extra_field_rejected():
    result = validate_sgec_batch({"errors": [], "extra": 1}, ALLOWED_TAGS)
    assert result.ok is False
    assert result.issues[0].code == "unknown_field"


def test_serialize_returns_fresh_copy_each_time():
    result = validate_sgec_batch(_batch(_error(confidence=0.82)), ALLOWED_TAGS)
    first = result.to_dict()
    second = result.to_dict()
    assert first is not second

    first["ok"] = False
    first["accepted"][0]["source"] = "tampered"

    assert result.ok is True
    assert result.accepted[0].source == "offline_synthetic"
    assert result.to_dict()["ok"] is True
    assert result.to_dict()["accepted"][0]["source"] == "offline_synthetic"


def test_result_and_items_are_frozen():
    result = validate_sgec_batch(_batch(_error(confidence=0.82)), ALLOWED_TAGS)
    item = result.accepted[0]
    with pytest.raises(AttributeError):
        item.source = "tampered"
    with pytest.raises(AttributeError):
        result.ok = False


def test_cli_default_fixture_exits_zero():
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline"],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_cli_bad_json_exits_nonzero_and_safe_output(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{ not valid json", encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline", str(bad)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "fixture: invalid json" in result.stderr
    assert "Traceback" not in result.stderr


def test_cli_mismatch_exits_nonzero(tmp_path):
    fixture = tmp_path / "mismatch.json"
    fixture.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "name": "mismatch",
                        "allowed_skill_tags": ["article_usage"],
                        "expect_accept": True,
                        "payload": {
                            "errors": [
                                {
                                    "skill_tag": "unknown",
                                    "original": "x",
                                    "corrected": "y",
                                    "error_type": "z",
                                }
                            ]
                        },
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline", str(fixture)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert result.returncode == 1
    assert "mismatched=1" in result.stdout
    assert "Traceback" not in result.stderr


def test_cli_output_has_no_raw_business_text():
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline"],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert "elephant" not in result.stdout
    assert "elephant" not in result.stderr


@pytest.mark.parametrize("bad_expect", ["false", "true", 0, 1, None])
def test_cli_non_bool_expect_accept_is_bad_material(tmp_path, bad_expect):
    fixture = tmp_path / "bad_expect.json"
    fixture.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "name": "bad_expect",
                        "allowed_skill_tags": ["article_usage"],
                        "expect_accept": bad_expect,
                        "payload": {"errors": [_error()]},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline", str(fixture)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "fixture: bad expect_accept" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    "bad_tags",
    [
        None,
        "article_usage",
        123,
        [["article_usage"]],
        ["article_usage", 123],
        [123],
    ],
)
def test_cli_bad_allowed_skill_tags_rejected(tmp_path, bad_tags):
    fixture = tmp_path / "bad_tags.json"
    fixture.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "name": "bad_tags",
                        "allowed_skill_tags": bad_tags,
                        "expect_accept": True,
                        "payload": {"errors": [_error()]},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline", str(fixture)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "fixture: bad allowed_skill_tags" in result.stderr
    assert "Traceback" not in result.stderr


def test_cli_bad_utf8_rejected(tmp_path):
    fixture = tmp_path / "bad_utf8.json"
    fixture.write_bytes(b'{"cases": [], "annotation": "\xff\xfe"}')
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline", str(fixture)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "fixture: invalid utf8" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
def test_cli_non_standard_json_number_rejected(tmp_path, token):
    fixture = tmp_path / "nonstandard.json"
    fixture.write_text(
        '{"cases": [], "annotation": ' + token + "}",
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline", str(fixture)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "fixture: invalid json" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    "payload",
    [
        {},
        None,
        [],
        {"errors": "bad"},
        {"errors": [], "extra": 1},
    ],
)
def test_cli_payload_structural_reject_is_legal_case(tmp_path, payload):
    fixture = tmp_path / "payload_reject.json"
    fixture.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "name": "structural_reject",
                        "allowed_skill_tags": ["article_usage"],
                        "expect_accept": False,
                        "payload": payload,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline", str(fixture)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "matched=1" in result.stdout
    assert "Traceback" not in result.stderr


def test_cli_payload_valid_positive(tmp_path):
    fixture = tmp_path / "payload_ok.json"
    fixture.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "name": "valid_payload",
                        "allowed_skill_tags": ["article_usage"],
                        "expect_accept": True,
                        "payload": {"errors": [_error()]},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, "-m", "scripts.evaluate_sgec_offline", str(fixture)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "matched=1" in result.stdout
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    "bad_tags",
    [
        pytest.param(b"", id="empty_bytes"),
        pytest.param(bytearray(), id="empty_bytearray"),
        pytest.param(b"article_usage", id="bytes"),
        pytest.param(bytearray(b"article_usage"), id="bytearray"),
    ],
)
def test_bytes_and_bytearray_allowed_tags_rejected(bad_tags):
    result = validate_sgec_batch({"errors": []}, bad_tags)
    assert result.ok is False
    assert result.accepted == ()
    assert result.issues[0].code == "invalid_allowed_tags"


def test_one_shot_iterator_and_generator_rejected_without_consumption():
    factories = (
        lambda: iter(["article_usage"]),
        lambda: (tag for tag in ["article_usage"]),
    )
    for make_tags in factories:
        tags = make_tags()
        result = validate_sgec_batch(_batch(_error(skill_tag="article_usage")), tags)
        assert result.ok is False
        assert result.accepted == ()
        assert result.issues[0].code == "invalid_allowed_tags"

        result = validate_sgec_batch(_batch(_error(skill_tag="article_usage")), tags)
        assert result.ok is False
        assert result.accepted == ()
        assert result.issues[0].code == "invalid_allowed_tags"

        assert next(tags) == "article_usage"


@pytest.mark.parametrize(
    "tags",
    [
        pytest.param([], id="empty_list"),
        pytest.param((), id="empty_tuple"),
        pytest.param(set(), id="empty_set"),
        pytest.param(frozenset(), id="empty_frozenset"),
    ],
)
def test_empty_collection_with_empty_errors_still_valid(tags):
    result = validate_sgec_batch({"errors": []}, tags)
    assert result.ok is True
    assert result.accepted == ()
    assert result.issues == ()
