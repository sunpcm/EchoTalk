import pytest
from services.pronunciation.phoneme_aligner import align_phonemes, compute_pronunciation_score


def test_align_phonemes_exact_match():
    ref = ["h", "ə", "l", "oʊ"]
    user = ["h", "ə", "l", "oʊ"]
    result = align_phonemes(ref, user)

    assert len(result) == 4
    for idx, item in enumerate(result):
        assert item["position"] == idx
        assert item["type"] == "correct"
        assert item["expected"] == ref[idx]
        assert item["actual"] == user[idx]
        assert item["phoneme"] == ref[idx]


def test_align_phonemes_substitution():
    ref = ["k", "æ", "t"]
    user = ["k", "ɛ", "t"]
    result = align_phonemes(ref, user)

    assert len(result) == 3
    assert result[0]["type"] == "correct"
    assert result[1]["type"] == "substitution"
    assert result[1]["expected"] == "æ"
    assert result[1]["actual"] == "ɛ"
    assert result[1]["phoneme"] == "æ"
    assert result[2]["type"] == "correct"


def test_align_phonemes_deletion():
    ref = ["k", "æ", "t"]
    user = ["k", "t"]
    result = align_phonemes(ref, user)

    assert len(result) == 3
    assert result[0]["type"] == "correct"
    assert result[1]["type"] == "deletion"
    assert result[1]["expected"] == "æ"
    assert result[1]["actual"] is None
    assert result[1]["phoneme"] == "æ"
    assert result[2]["type"] == "correct"


def test_align_phonemes_insertion():
    ref = ["k", "t"]
    user = ["k", "æ", "t"]
    result = align_phonemes(ref, user)

    assert len(result) == 3
    assert result[0]["type"] == "correct"
    assert result[1]["type"] == "insertion"
    assert result[1]["expected"] is None
    assert result[1]["actual"] == "æ"
    assert result[1]["phoneme"] == "æ"
    assert result[2]["type"] == "correct"


def test_align_phonemes_both_empty():
    result = align_phonemes([], [])
    assert result == []


def test_align_phonemes_ref_empty():
    user = ["a", "b"]
    result = align_phonemes([], user)

    assert len(result) == 2
    for idx, item in enumerate(result):
        assert item["position"] == idx
        assert item["type"] == "insertion"
        assert item["expected"] is None
        assert item["actual"] == user[idx]
        assert item["phoneme"] == user[idx]


def test_align_phonemes_user_empty():
    ref = ["a", "b"]
    result = align_phonemes(ref, [])

    assert len(result) == 2
    for idx, item in enumerate(result):
        assert item["position"] == idx
        assert item["type"] == "deletion"
        assert item["expected"] == ref[idx]
        assert item["actual"] is None
        assert item["phoneme"] == ref[idx]


def test_align_phonemes_complex_mixture():
    ref = ["b", "æ", "n", "æ", "n", "ə"]
    user = ["b", "ɛ", "n", "n", "ə"]
    result = align_phonemes(ref, user)

    assert len(result) > 0
    types = [r["type"] for r in result]
    assert "correct" in types


def test_compute_pronunciation_score():
    assert compute_pronunciation_score([]) == 0.0

    alignment_full = [
        {"type": "correct"},
        {"type": "correct"},
        {"type": "correct"},
    ]
    assert compute_pronunciation_score(alignment_full) == 100.0

    alignment_none = [
        {"type": "substitution"},
        {"type": "deletion"},
    ]
    assert compute_pronunciation_score(alignment_none) == 0.0

    alignment_partial = [
        {"type": "correct"},
        {"type": "substitution"},
        {"type": "correct"},
    ]
    # 2 / 3 * 100 = 66.666... -> 66.7
    assert compute_pronunciation_score(alignment_partial) == 66.7
