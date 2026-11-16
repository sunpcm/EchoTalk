"""G-EVAL RED: deterministic scenario-goal rule engine (pure, no DB/worker).

The rule module is resolved at runtime so a missing implementation fails with an
explicit pytest.fail instead of breaking collection.  This file only freezes
observable behavior for the six official pilot goals at goal_version=1; it does
not fix private rule internals and does not depend on any G-WIRE function.
"""

from __future__ import annotations

import importlib
from collections.abc import Sequence
from typing import Any

import pytest

RULES_MODULE = "services.goal_rules"

OFFICIAL_GOAL_IDS = frozenset(
    {
        "mat_biz_greet_b1:introduce_name_and_role",
        "mat_biz_greet_b1:ask_other_work_question",
        "mat_hotel_checkin_b1:express_checkin_reservation_status",
        "mat_hotel_checkin_b1:ask_checkout_time",
        "mat_restaurant_b1:order_one_dish_or_drink",
        "mat_restaurant_b1:state_preference_or_no_requirements",
    }
)


def _rules_api() -> Any:
    try:
        return importlib.import_module(RULES_MODULE)
    except ModuleNotFoundError as exc:
        if exc.name == RULES_MODULE:
            pytest.fail(
                f"{RULES_MODULE} is not implemented (G-EVAL RED)", pytrace=False
            )
        raise


def _evaluate(goal_id: str, goal_version: int, utterances: Sequence[str]) -> str:
    api = _rules_api()
    missing = [
        name
        for name in ("evaluate_goal", "SUPPORTED_GOAL_IDS", "EVALUATOR_VERSION")
        if not hasattr(api, name)
    ]
    if missing:
        pytest.fail(
            f"{RULES_MODULE} is missing: {', '.join(missing)} (G-EVAL RED)",
            pytrace=False,
        )
    result = api.evaluate_goal(goal_id, goal_version, list(utterances))
    return getattr(result, "value", result)


def test_evaluator_version_is_frozen_and_six_goals_are_supported() -> None:
    api = _rules_api()
    version = api.EVALUATOR_VERSION
    assert isinstance(version, str) and version.strip()
    assert api.SUPPORTED_GOAL_IDS == OFFICIAL_GOAL_IDS


@pytest.mark.parametrize(
    ("goal_id", "utterances"),
    [
        (
            "mat_biz_greet_b1:introduce_name_and_role",
            ["My name is Anna and I am a product manager."],
        ),
        (
            "mat_biz_greet_b1:ask_other_work_question",
            ["What do you do for work?"],
        ),
        (
            "mat_hotel_checkin_b1:express_checkin_reservation_status",
            ["I'd like to check in. I have a reservation."],
        ),
        (
            "mat_hotel_checkin_b1:express_checkin_reservation_status",
            ["I'd like to check in, but I do not have a reservation."],
        ),
        (
            "mat_hotel_checkin_b1:ask_checkout_time",
            ["What time is checkout?"],
        ),
        (
            "mat_restaurant_b1:order_one_dish_or_drink",
            ["I'll have the pasta, please."],
        ),
        (
            "mat_restaurant_b1:state_preference_or_no_requirements",
            ["No onions, please."],
        ),
        (
            "mat_restaurant_b1:state_preference_or_no_requirements",
            ["I have no special requirements."],
        ),
    ],
)
def test_clear_student_evidence_is_achieved(
    goal_id: str, utterances: Sequence[str]
) -> None:
    assert _evaluate(goal_id, 1, utterances) == "achieved"


@pytest.mark.parametrize(
    ("goal_id", "utterances"),
    [
        (
            "mat_biz_greet_b1:introduce_name_and_role",
            ["I refuse to tell you my name or my job."],
        ),
        (
            "mat_biz_greet_b1:ask_other_work_question",
            ["I do not want to ask about your job."],
        ),
        (
            "mat_hotel_checkin_b1:express_checkin_reservation_status",
            ["I do not want to check in at all."],
        ),
        (
            "mat_hotel_checkin_b1:ask_checkout_time",
            ["I will not ask about checkout time."],
        ),
        (
            "mat_restaurant_b1:order_one_dish_or_drink",
            ["I do not want to order anything."],
        ),
        (
            "mat_restaurant_b1:state_preference_or_no_requirements",
            ["I won't tell you about any preferences."],
        ),
    ],
)
def test_explicit_refusal_is_not_achieved(
    goal_id: str, utterances: Sequence[str]
) -> None:
    assert _evaluate(goal_id, 1, utterances) == "not_achieved"


@pytest.mark.parametrize(
    ("goal_id", "utterances"),
    [
        ("mat_biz_greet_b1:introduce_name_and_role", ["My name is Anna."]),
        ("mat_biz_greet_b1:ask_other_work_question", ["I work in marketing."]),
        (
            "mat_hotel_checkin_b1:express_checkin_reservation_status",
            ["I have a reservation."],
        ),
        ("mat_hotel_checkin_b1:ask_checkout_time", ["Checkout is at eleven."]),
        ("mat_restaurant_b1:order_one_dish_or_drink", ["I am hungry."]),
        (
            "mat_restaurant_b1:state_preference_or_no_requirements",
            ["The menu looks good."],
        ),
    ],
)
def test_incomplete_or_ambiguous_evidence_is_unknown(
    goal_id: str, utterances: Sequence[str]
) -> None:
    assert _evaluate(goal_id, 1, utterances) == "unknown"


@pytest.mark.parametrize(
    ("goal_id", "utterances"),
    [
        (
            "mat_biz_greet_b1:ask_other_work_question",
            ["My teacher said to ask about your job."],
        ),
        (
            "mat_biz_greet_b1:introduce_name_and_role",
            ["I cannot introduce myself properly."],
        ),
        (
            "mat_biz_greet_b1:introduce_name_and_role",
            ["My friend said, 'My name is Anna and I am a product manager.'"],
        ),
    ],
)
def test_quoted_teacher_or_other_speech_and_self_denial_are_not_achieved(
    goal_id: str, utterances: Sequence[str]
) -> None:
    assert _evaluate(goal_id, 1, utterances) != "achieved"


@pytest.mark.parametrize(
    ("goal_id", "utterances"),
    [
        (
            "mat_hotel_checkin_b1:express_checkin_reservation_status",
            ["I'd like to check in.", "I do not want to check in."],
        ),
        (
            "mat_restaurant_b1:order_one_dish_or_drink",
            ["I'll have the pasta.", "I do not want to order anything."],
        ),
    ],
)
def test_contradictory_evidence_is_unknown(
    goal_id: str, utterances: Sequence[str]
) -> None:
    assert _evaluate(goal_id, 1, utterances) == "unknown"


def test_unsupported_goal_id_is_not_assessed() -> None:
    assert _evaluate("mat_unknown_x:not_a_goal", 1, ["anything"]) == "not_assessed"


@pytest.mark.parametrize("goal_version", [0, 2, 99])
def test_unsupported_goal_version_is_not_assessed(goal_version: int) -> None:
    assert (
        _evaluate(
            "mat_biz_greet_b1:introduce_name_and_role",
            goal_version,
            ["My name is Anna."],
        )
        == "not_assessed"
    )


def test_rules_are_deterministic() -> None:
    goal_id = "mat_biz_greet_b1:introduce_name_and_role"
    utterances = ["My name is Anna and I am a product manager."]
    first = _evaluate(goal_id, 1, utterances)
    second = _evaluate(goal_id, 1, utterances)
    assert first == second == "achieved"


@pytest.mark.parametrize(
    ("goal_id", "utterances"),
    [
        (
            "mat_biz_greet_b1:ask_other_work_question",
            ["What do you do on weekends?"],
        ),
        (
            "mat_restaurant_b1:order_one_dish_or_drink",
            ["I'd like to check in at the hotel."],
        ),
        (
            "mat_restaurant_b1:order_one_dish_or_drink",
            ["Can I have a moment?"],
        ),
        (
            "mat_restaurant_b1:state_preference_or_no_requirements",
            ["I am without my wallet."],
        ),
        (
            "mat_biz_greet_b1:introduce_name_and_role",
            ["My name is Anna and I work out every morning."],
        ),
        (
            "mat_biz_greet_b1:introduce_name_and_role",
            ["My name is Anna and I am a little tired."],
        ),
        (
            "mat_hotel_checkin_b1:ask_checkout_time",
            ["I did not ask what time is checkout."],
        ),
        (
            "mat_restaurant_b1:order_one_dish_or_drink",
            ["I didn't say I'll have the pasta."],
        ),
    ],
)
def test_ambiguous_general_keywords_are_unknown(
    goal_id: str, utterances: Sequence[str]
) -> None:
    assert _evaluate(goal_id, 1, utterances) == "unknown"


@pytest.mark.parametrize(
    ("goal_id", "utterances"),
    [
        (
            "mat_restaurant_b1:order_one_dish_or_drink",
            ['The textbook says: "I\'ll have the pasta, please."'],
        ),
        (
            "mat_biz_greet_b1:introduce_name_and_role",
            ["Please repeat the example: My name is Anna and I am a manager."],
        ),
        (
            "mat_restaurant_b1:state_preference_or_no_requirements",
            ['Does the phrase "no onions, please" mean the same thing?'],
        ),
        (
            "mat_biz_greet_b1:introduce_name_and_role",
            ["'My name is Anna and I am a manager.'"],
        ),
    ],
)
def test_quoted_or_referenced_examples_are_unknown(
    goal_id: str, utterances: Sequence[str]
) -> None:
    assert _evaluate(goal_id, 1, utterances) == "unknown"
