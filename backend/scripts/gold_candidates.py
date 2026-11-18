"""Offline lint and annotation-template tooling for synthetic gold candidates.

This CLI never imports the application, its ORM, configuration, credentials,
environment variables or the network.  It lints a frozen candidate corpus,
generates a blind (or proposal-visible) annotation template, and validates a
filled template against the corpus content hash.  Structure validity is not a
human review; an unannotated template is explicitly ``incomplete`` with zero
human gold.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from scripts.acceptance_common import (
    AcceptanceInputError,
    canonical_json_bytes,
    decode_json_object,
    sha256_hex,
)

SGEC_CORPUS_ID = "sgec_candidates.v1"
GOAL_CORPUS_ID = "goal_candidates.v1"

SGEC_CATEGORIES = frozenset(
    {
        "no_error",
        "typical_correction",
        "same_skill_multi_error",
        "semantic_ambiguity",
        "negation",
        "dialect_variant",
        "multiple_acceptable",
        "prompt_injection",
        "bad_structure",
        "extra_field",
        "unknown_skill_tag",
        "invalid_confidence",
    }
)
GOAL_CATEGORIES = frozenset(
    {
        "direct_behavior",
        "refusal",
        "quotation",
        "hypothetical",
        "reported_speech",
        "self_report",
        "contradiction",
        "assistant_only",
        "no_student_evidence",
        "unknown_version",
    }
)

# Kept in sync with services/goal_rules.SUPPORTED_GOAL_IDS and its frozen
# evaluator version; the test suite asserts equality so drift fails loudly.
SUPPORTED_GOAL_IDS = frozenset(
    {
        "mat_biz_greet_b1:introduce_name_and_role",
        "mat_biz_greet_b1:ask_other_work_question",
        "mat_hotel_checkin_b1:express_checkin_reservation_status",
        "mat_hotel_checkin_b1:ask_checkout_time",
        "mat_restaurant_b1:order_one_dish_or_drink",
        "mat_restaurant_b1:state_preference_or_no_requirements",
    }
)
GOAL_EVALUATOR_VERSION = "deterministic-goal-v2"
GOAL_FOUR_STATES = frozenset({"achieved", "not_achieved", "unknown", "not_assessed"})

# Canonical SGEC skill tags for blind annotation, mirroring the ten frozen
# ``models.knowledge.SEED_SKILLS`` ids.  The annotation template exposes this
# set so an annotator never has to open a proposal-bearing file to learn which
# ``skill_tag`` values are valid.
SGEC_ALLOWED_SKILL_TAGS = frozenset(
    {
        "article_usage",
        "verb_tense_past",
        "verb_tense_present",
        "subject_verb_agreement",
        "preposition",
        "vowel_sounds",
        "consonant_clusters",
        "word_stress",
        "linking_sounds",
        "th_sounds",
    }
)

CORPUS_TASK_CONTEXT = {
    SGEC_CORPUS_ID: (
        "Judge the utterance independently: decide whether the SGEC task "
        "structure is acceptable and, when it is, provide the corrected "
        "fragments. Do not rely on any model proposal."
    ),
    GOAL_CORPUS_ID: (
        "Judge whether the student achieved the named scenario goal from the "
        "evidence. Choose exactly one of the four goal states."
    ),
}

# Human-readable, confirmed goal context shown in blind annotation templates so
# an annotator can judge a goal without opening any AI-proposal-bearing file.
# ``goal_version == 1`` is supported; any other version is explicitly unsupported.
GOAL_CONTEXT = {
    "mat_biz_greet_b1:introduce_name_and_role": {
        "label": "Introduce name and role",
        "criteria": (
            "achieved when the student states both a name and a job/role; "
            "not_achieved on a clear refusal; otherwise unknown."
        ),
    },
    "mat_biz_greet_b1:ask_other_work_question": {
        "label": "Ask about the other person's work",
        "criteria": (
            "achieved when the student asks the other person about their "
            "job/work; not_achieved on a clear refusal; otherwise unknown."
        ),
    },
    "mat_hotel_checkin_b1:express_checkin_reservation_status": {
        "label": "Check in and state reservation status",
        "criteria": (
            "achieved when the student both requests check-in and states "
            "whether they have a reservation; not_achieved on a clear refusal; "
            "otherwise unknown."
        ),
    },
    "mat_hotel_checkin_b1:ask_checkout_time": {
        "label": "Ask checkout time",
        "criteria": (
            "achieved when the student asks about checkout time; "
            "not_achieved on a clear refusal; otherwise unknown."
        ),
    },
    "mat_restaurant_b1:order_one_dish_or_drink": {
        "label": "Order one dish or drink",
        "criteria": (
            "achieved when the student orders a food or drink item; "
            "not_achieved on a clear refusal; otherwise unknown."
        ),
    },
    "mat_restaurant_b1:state_preference_or_no_requirements": {
        "label": "State preference or no requirements",
        "criteria": (
            "achieved when the student states a dietary preference or that "
            "they have no requirements; not_achieved on a clear refusal; "
            "otherwise unknown."
        ),
    },
}

ANNOTATION_FIELDS = (
    "annotator",
    "judgment",
    "evidence",
    "rationale",
    "dispute",
    "review_ruling",
    "annotation_version",
)


def compute_content_hash(document: dict[str, Any]) -> str:
    """Hash everything except the ``content_hash`` field itself."""
    payload = {key: value for key, value in document.items() if key != "content_hash"}
    return sha256_hex(payload)


def _issue(code: int, message: str) -> int:
    print(f"[gold_candidates] {message}", file=sys.stderr)
    return code


def _bad_input(exc: AcceptanceInputError) -> int:
    print(f"[gold_candidates] bad input: {exc}", file=sys.stderr)
    return 2


def _read_document(path: str) -> dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as exc:
        raise AcceptanceInputError("file is unreadable") from exc
    except UnicodeDecodeError as exc:
        raise AcceptanceInputError("file is not valid UTF-8") from exc
    return decode_json_object(raw)


def _is_int(value: Any) -> bool:
    return type(value) is int


def _is_str(value: Any) -> bool:
    return isinstance(value, str)


def _is_str_list(value: Any) -> bool:
    return isinstance(value, list) and all(type(item) is str for item in value)


def _categories_for(corpus_id: str) -> frozenset[str] | None:
    if corpus_id == SGEC_CORPUS_ID:
        return SGEC_CATEGORIES
    if corpus_id == GOAL_CORPUS_ID:
        return GOAL_CATEGORIES
    return None


def lint_corpus(document: dict[str, Any], corpus_id: str) -> int:
    """Validate one frozen candidate corpus; return 0, 1 or 2."""
    if not _is_int(document.get("schema_version")) or document["schema_version"] != 1:
        return _issue(1, "schema_version must be integer 1")
    if document.get("corpus_id") != corpus_id:
        return _issue(1, f"corpus_id must be {corpus_id}")
    if not _is_int(document.get("corpus_version")) or document["corpus_version"] != 1:
        return _issue(1, "corpus_version must be integer 1")
    if document.get("source") != "synthetic":
        return _issue(1, "corpus source must be synthetic")
    if not _is_str(document.get("content_hash")):
        return _issue(1, "content_hash must be a string")
    if document["content_hash"] != compute_content_hash(document):
        return _issue(1, "content_hash does not match canonical content")

    candidates = document.get("candidates")
    if not isinstance(candidates, list):
        return _issue(1, "candidates must be a JSON array")
    if not candidates:
        return _issue(3, "candidate set is empty")

    categories = _categories_for(corpus_id)
    if categories is None:
        return _issue(1, "corpus_id is not a known candidate corpus")
    seen: set[str] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            return _issue(1, "each candidate must be an object")
        candidate_id = candidate.get("id")
        if not _is_str(candidate_id) or not candidate_id:
            return _issue(1, "candidate id must be a non-empty string")
        if candidate_id in seen:
            return _issue(1, f"duplicate candidate id: {candidate_id}")
        seen.add(candidate_id)
        if not _is_int(candidate.get("version")):
            return _issue(1, "candidate version must be an integer")
        if candidate.get("source") != "synthetic":
            return _issue(1, "candidate source must be synthetic")
        if candidate.get("review_status") != "unreviewed":
            return _issue(1, "candidate review_status must be unreviewed")
        category = candidate.get("category")
        if not _is_str(category) or category not in categories:
            return _issue(1, "candidate has an unknown category")
        if not isinstance(candidate.get("input"), dict):
            return _issue(1, "candidate input must be an object")
        proposal = candidate.get("proposal")
        if proposal is not None and not isinstance(proposal, dict):
            return _issue(1, "candidate proposal must be an object or null")

        if corpus_id == GOAL_CORPUS_ID:
            code = _lint_goal_candidate(candidate)
            if code != 0:
                return code

    return 0


def _lint_goal_candidate(candidate: dict[str, Any]) -> int:
    goal_id = candidate.get("goal_id")
    if not _is_str(goal_id) or goal_id not in SUPPORTED_GOAL_IDS:
        return _issue(1, "candidate goal_id is not one of the six official goals")
    category = candidate.get("category")
    goal_version = candidate.get("goal_version")
    if not _is_int(goal_version) or goal_version < 1:
        return _issue(1, "candidate goal_version must be a positive integer")
    if category == "unknown_version":
        if goal_version != 2:
            return _issue(1, "unknown_version candidate must use goal_version 2")
    elif goal_version != 1:
        return _issue(1, "candidate goal_version must be integer 1")
    proposal = candidate.get("proposal")
    if proposal is not None:
        result = proposal.get("result")
        if not _is_str(result) or result not in GOAL_FOUR_STATES:
            return _issue(1, "candidate proposal result is not a valid four-state")
        if proposal.get("evaluator_version") != GOAL_EVALUATOR_VERSION:
            return _issue(1, "candidate proposal evaluator_version is not frozen")
        if category == "unknown_version" and proposal.get("result") != "not_assessed":
            return _issue(1, "unknown_version proposal result must be not_assessed")
    return 0


def generate_template(document: dict[str, Any], *, blind: bool) -> dict[str, Any]:
    """Generate an annotation template; blind omits the AI proposal."""
    corpus_id = document["corpus_id"]
    result: dict[str, Any] = {
        "schema_version": 1,
        "corpus_id": corpus_id,
        "corpus_content_hash": document["content_hash"],
        "blind": blind,
        "task_context": CORPUS_TASK_CONTEXT[corpus_id],
    }
    if corpus_id == SGEC_CORPUS_ID:
        result["allowed_skill_tags"] = sorted(SGEC_ALLOWED_SKILL_TAGS)
    else:
        result["goal_states"] = sorted(GOAL_FOUR_STATES)
    result["annotations"] = [
        _template_entry(candidate, blind=blind) for candidate in document["candidates"]
    ]
    return result


def _template_entry(candidate: dict[str, Any], *, blind: bool) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "candidate_id": candidate["id"],
        "version": candidate["version"],
        "category": candidate["category"],
        "input": candidate["input"],
    }
    if candidate.get("goal_id") is not None:
        entry["goal_id"] = candidate["goal_id"]
        entry["goal_version"] = candidate["goal_version"]
        entry.update(_goal_template_context(candidate))
    if not blind:
        entry["proposal"] = candidate.get("proposal")
    for field in ANNOTATION_FIELDS:
        entry[field] = None
    return entry


def _goal_template_context(candidate: dict[str, Any]) -> dict[str, Any]:
    """Return the canonical human context for one goal candidate."""
    goal_id = candidate["goal_id"]
    info = GOAL_CONTEXT.get(goal_id)
    supported = candidate["goal_version"] == 1
    if info is None:
        return {
            "goal_label": "unsupported",
            "goal_criteria": "unsupported goal id",
            "goal_supported": False,
        }
    criteria = info["criteria"]
    if not supported:
        criteria += " This version is unsupported; expect not_assessed."
    return {
        "goal_label": info["label"],
        "goal_criteria": criteria,
        "goal_supported": supported,
    }


def _valid_annotator(value: Any) -> bool:
    return value is None or (type(value) is str and bool(value.strip()))


def _valid_sgec_finding(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if set(value) != {
        "skill_tag",
        "original",
        "corrected",
        "error_type",
        "confidence",
    }:
        return False
    skill_tag = value.get("skill_tag")
    if not _is_str(skill_tag) or skill_tag not in SGEC_ALLOWED_SKILL_TAGS:
        return False
    for field in ("original", "corrected", "error_type"):
        if not _is_str(value.get(field)):
            return False
    confidence = value.get("confidence")
    if confidence is not None:
        if type(confidence) is bool:
            return False
        if type(confidence) not in (int, float):
            return False
        if not (0 <= confidence <= 1):
            return False
    return True


def _valid_sgec_judgment(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, dict):
        return False
    if set(value) != {"accepted", "findings"}:
        return False
    if type(value.get("accepted")) is not bool:
        return False
    findings = value.get("findings")
    if not isinstance(findings, list):
        return False
    return all(_valid_sgec_finding(finding) for finding in findings)


def _valid_judgment(value: Any, corpus_id: str) -> bool:
    if value is None:
        return True
    if corpus_id == GOAL_CORPUS_ID:
        return type(value) is str and value in GOAL_FOUR_STATES
    return _valid_sgec_judgment(value)


def _valid_evidence(value: Any) -> bool:
    if value is None:
        return True
    if type(value) is str:
        return bool(value.strip())
    if isinstance(value, list):
        return bool(value) and all(
            type(item) is str and bool(item.strip()) for item in value
        )
    return False


def _valid_text(value: Any) -> bool:
    return value is None or (type(value) is str and bool(value.strip()))


def _valid_annotation_version(value: Any) -> bool:
    return value is None or (type(value) is int and value >= 1)


_ANNOTATION_VALIDATORS = {
    "annotator": _valid_annotator,
    "evidence": _valid_evidence,
    "rationale": _valid_text,
    "dispute": _valid_text,
    "review_ruling": _valid_text,
    "annotation_version": _valid_annotation_version,
}
_REQUIRED_ANNOTATION_FIELDS = frozenset(
    {"annotator", "judgment", "evidence", "rationale", "annotation_version"}
)


def _check_template_context(
    entry: dict[str, Any], candidate: dict[str, Any], *, blind: bool
) -> int:
    if (
        type(entry.get("version")) is not int
        or entry["version"] != candidate["version"]
    ):
        return _issue(1, "annotation version does not match the corpus candidate")
    if entry.get("category") != candidate.get("category"):
        return _issue(1, "annotation category does not match the corpus candidate")
    if not isinstance(entry.get("input"), dict):
        return _issue(1, "annotation input must be an object")
    if canonical_json_bytes(entry["input"]) != canonical_json_bytes(candidate["input"]):
        return _issue(1, "annotation input does not match the corpus candidate")
    if candidate.get("goal_id") is not None:
        if entry.get("goal_id") != candidate["goal_id"]:
            return _issue(1, "annotation goal_id does not match the corpus candidate")
        if (
            type(entry.get("goal_version")) is not int
            or entry["goal_version"] != candidate["goal_version"]
        ):
            return _issue(
                1, "annotation goal_version does not match the corpus candidate"
            )
        expected_context = _goal_template_context(candidate)
        for field in ("goal_label", "goal_criteria", "goal_supported"):
            if field == "goal_supported":
                if (
                    type(entry.get(field)) is not bool
                    or entry[field] != expected_context[field]
                ):
                    return _issue(
                        1, f"annotation {field} does not match the corpus candidate"
                    )
            elif entry.get(field) != expected_context[field]:
                return _issue(
                    1, f"annotation {field} does not match the corpus candidate"
                )
    else:
        if any(
            field in entry
            for field in (
                "goal_id",
                "goal_version",
                "goal_label",
                "goal_criteria",
                "goal_supported",
            )
        ):
            return _issue(1, "annotation must not carry goal fields for this corpus")
    if blind:
        if "proposal" in entry:
            return _issue(1, "blind template must not carry a proposal")
    else:
        if canonical_json_bytes(entry.get("proposal")) != canonical_json_bytes(
            candidate.get("proposal")
        ):
            return _issue(1, "annotation proposal does not match the corpus candidate")
    return 0


def _check_corpus_context(document: dict[str, Any], corpus_id: str) -> int:
    if document.get("task_context") != CORPUS_TASK_CONTEXT.get(corpus_id):
        return _issue(1, "template task_context does not match the corpus")
    if corpus_id == SGEC_CORPUS_ID:
        tags = document.get("allowed_skill_tags")
        if (
            not _is_str_list(tags)
            or len(tags) != len(SGEC_ALLOWED_SKILL_TAGS)
            or set(tags) != SGEC_ALLOWED_SKILL_TAGS
        ):
            return _issue(1, "template allowed_skill_tags does not match the corpus")
        if "goal_states" in document:
            return _issue(1, "sgec template must not carry goal_states")
    else:
        states = document.get("goal_states")
        if (
            not _is_str_list(states)
            or len(states) != len(GOAL_FOUR_STATES)
            or set(states) != GOAL_FOUR_STATES
        ):
            return _issue(1, "template goal_states does not match the corpus")
        if "allowed_skill_tags" in document:
            return _issue(1, "goal template must not carry allowed_skill_tags")
    return 0


def validate_template(document: dict[str, Any], corpus: dict[str, Any]) -> int:
    """Validate a filled template against the corpus; return 0, 1, 2 or 3."""
    if not _is_int(document.get("schema_version")) or document["schema_version"] != 1:
        return _issue(1, "template schema_version must be integer 1")
    corpus_id = document.get("corpus_id")
    if corpus_id != corpus.get("corpus_id"):
        return _issue(1, "template corpus_id does not match corpus")
    if document.get("corpus_content_hash") != corpus.get("content_hash"):
        return _issue(1, "template corpus_content_hash does not match corpus")
    if type(document.get("blind")) is not bool:
        return _issue(1, "template blind must be a boolean")
    code = _check_corpus_context(document, corpus_id)
    if code != 0:
        return code

    annotations = document.get("annotations")
    if not isinstance(annotations, list):
        return _issue(1, "template annotations must be a JSON array")
    if not annotations:
        return _issue(3, "annotation set is empty")

    corpus_by_id = {candidate["id"]: candidate for candidate in corpus["candidates"]}
    seen: set[str] = set()
    filled = 0
    for entry in annotations:
        if not isinstance(entry, dict):
            return _issue(1, "each annotation must be an object")
        candidate_id = entry.get("candidate_id")
        if not _is_str(candidate_id) or candidate_id not in corpus_by_id:
            return _issue(1, "annotation references an unknown candidate_id")
        if candidate_id in seen:
            return _issue(1, "annotation contains a duplicate candidate_id")
        seen.add(candidate_id)
        candidate = corpus_by_id[candidate_id]

        code = _check_template_context(entry, candidate, blind=document["blind"])
        if code != 0:
            return code

        for field in ANNOTATION_FIELDS:
            if field not in entry:
                return _issue(1, f"annotation is missing field {field}")
            if field == "judgment":
                if not _valid_judgment(entry[field], corpus_id):
                    return _issue(1, "annotation field judgment is invalid")
            elif not _ANNOTATION_VALIDATORS[field](entry[field]):
                return _issue(1, f"annotation field {field} is invalid")

        if all(entry[field] is not None for field in _REQUIRED_ANNOTATION_FIELDS):
            filled += 1

    missing = set(corpus_by_id) - seen
    if missing:
        return _issue(1, "annotation set is missing corpus candidates")

    total = len(corpus_by_id)
    if filled < total:
        print(
            f"[gold_candidates] incomplete: filled={filled}/{total}",
            file=sys.stderr,
        )
        return 3
    print(
        f"[gold_candidates] structurally complete: filled={filled}/{total} "
        "(submitted structure only; not an approval of gold quality)",
        file=sys.stderr,
    )
    return 0


class _AcceptanceArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        del message
        raise AcceptanceInputError("invalid command-line arguments")


def _build_parser() -> argparse.ArgumentParser:
    parser = _AcceptanceArgumentParser(
        prog="python -m scripts.gold_candidates",
        description="Lint synthetic gold candidates and manage annotation templates.",
    )
    subparsers = parser.add_subparsers(dest="command")

    lint_parser = subparsers.add_parser("lint", help="Lint a candidate corpus.")
    lint_parser.add_argument("--corpus", required=True)

    template_parser = subparsers.add_parser(
        "template", help="Generate an annotation template."
    )
    template_parser.add_argument("--corpus", required=True)
    template_parser.add_argument("--blind", action="store_true")

    validate_parser = subparsers.add_parser(
        "validate-template", help="Validate a filled annotation template."
    )
    validate_parser.add_argument("--corpus", required=True)
    validate_parser.add_argument("--template", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = _build_parser().parse_args(argv)
    except AcceptanceInputError as exc:
        return _bad_input(exc)
    command = args.command

    if command == "lint":
        try:
            document = _read_document(args.corpus)
        except AcceptanceInputError as exc:
            return _bad_input(exc)
        return lint_corpus(document, document.get("corpus_id"))

    if command == "template":
        try:
            document = _read_document(args.corpus)
        except AcceptanceInputError as exc:
            return _bad_input(exc)
        if lint_corpus(document, document.get("corpus_id")) != 0:
            return 1
        print(json.dumps(generate_template(document, blind=args.blind), indent=2))
        return 0

    if command == "validate-template":
        try:
            corpus = _read_document(args.corpus)
            template = _read_document(args.template)
        except AcceptanceInputError as exc:
            return _bad_input(exc)
        if lint_corpus(corpus, corpus.get("corpus_id")) != 0:
            return 1
        return validate_template(template, corpus)

    print("[gold_candidates] bad input: unknown command", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
