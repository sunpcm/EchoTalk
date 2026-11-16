"""Deterministic scenario-goal rule engine for the six official pilot goals.

Pure standard-library function with no database, worker, generator or LLM
dependency. The caller guarantees ``user_utterances`` contains only student
speech.

Each goal resolves to one of four terminal states:

* ``achieved``: evidence clearly and affirmatively satisfies the goal.
* ``not_achieved``: the student clearly refuses to perform the goal action.
* ``unknown``: evidence is missing, ambiguous, quoted, negated, hypothetical
  or contradictory.
* ``not_assessed``: unsupported goal id or version.

The rules use narrow template patterns with local grammatical constraints
between an action verb and its object (for example an order verb followed
immediately by a food/drink noun), plus small closed vocabularies. They stay
conservative: phrasing that cannot be matched reliably falls back to
``unknown``.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

from models.goal_evaluation import GoalResult

EVALUATOR_VERSION = "deterministic-goal-v2"

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


def _norm(text: str) -> str:
    text = text.replace("\u2019", "'").replace("\u2018", "'")
    return re.sub(r"\s+", " ", text.lower()).strip()


_REFUSAL_MARKER_RES = (
    re.compile(r"\bi refuse\b"),
    re.compile(r"\bi (?:don't|do not) want\b"),
    re.compile(r"\bi (?:won't|will not)\b"),
    re.compile(r"\bi(?:'m| am) not going to\b"),
    re.compile(r"\bi(?:'d| would) rather not\b"),
)


def _has_refusal_marker(text: str) -> bool:
    return any(pattern.search(text) for pattern in _REFUSAL_MARKER_RES)


def _refusal(text: str, action_words: tuple[str, ...]) -> bool:
    if not _has_refusal_marker(text):
        return False
    return any(word in text for word in action_words)


_REPORTED_SPEECH_RE = re.compile(
    r"\b(?:my|your|his|her|their|our|the)?\s*"
    r"(?:friend|teacher|professor|boss|manager|colleague|classmate|"
    r"co-worker|coworker|sister|brother|mother|mom|father|dad|"
    r"he|she|they|customer|client|person|guy|man|woman|someone|somebody|"
    r"receptionist|waiter|waitress|partner|wife|husband|child|kid|"
    r"doctor|nurse)\b"
    r"\s+(?:said|says|told|tells|asked|asks|mentioned|quoted|"
    r"explained|replied)\b"
)


def _is_reported_speech(text: str) -> bool:
    return bool(_REPORTED_SPEECH_RE.search(text))


_HYPOTHETICAL_RE = re.compile(
    r"(?:if|what if|suppose|imagine|what would|would you|should i)\b",
    re.IGNORECASE,
)


def _is_hypothetical(text: str) -> bool:
    return bool(_HYPOTHETICAL_RE.match(text.strip()))


_QUOTATION_RE = re.compile(r'["\u201c\u201d\u00ab\u00bb]')

_REPORTING_VERB_RE = re.compile(
    r"\b(?:says|said|states|stated|writes|wrote|reads|read|"
    r"quotes|quoted|according to|mentions|mentioned|reports|reported)\b",
    re.IGNORECASE,
)

_INSTRUCTION_VERB_RE = re.compile(
    r"\b(?:repeat|recite|copy|echo|read out|read aloud)\b",
    re.IGNORECASE,
)

_META_REFERENCE_RE = re.compile(
    r"\b(?:the\s+)?(?:example|phrase|sentence|word|question|"
    r"dialogue|quotation|quote|line)\b",
    re.IGNORECASE,
)

_MEANING_VERB_RE = re.compile(
    r"\b(?:mean|means|meaning|synonym|translate|translation)\b",
    re.IGNORECASE,
)


def _has_paired_single_quote(text: str) -> bool:
    """True when one whole utterance is wrapped in a pair of single quotes.

    Straight and curly single quotes are both normalized to ``'`` upstream, so
    this checks the segment boundary (leading ``'`` and trailing ``'``) only.
    Internal apostrophes such as ``I'll``, ``I'm`` or ``don't`` never sit at the
    start of the stripped utterance, so they are not mistaken for quotation.
    """
    stripped = text.strip()
    if not stripped.startswith("'"):
        return False
    end = stripped.rstrip(".?!")
    return len(end) >= 2 and end.endswith("'")


def _is_quoted_or_meta(text: str) -> bool:
    """Reject quoted, reported, demonstration or metalinguistic framing.

    A goal counts only when the student directly performs the action, so an
    utterance that quotes someone else, reports speech, instructs someone to
    repeat an example, or asks what a phrase/word means is not direct evidence.
    """
    if _QUOTATION_RE.search(text):
        return True
    if _has_paired_single_quote(text):
        return True
    if _REPORTING_VERB_RE.search(text):
        return True
    if _INSTRUCTION_VERB_RE.search(text):
        return True
    return bool(_META_REFERENCE_RE.search(text) and _MEANING_VERB_RE.search(text))


def _is_non_direct(text: str) -> bool:
    return (
        _is_reported_speech(text) or _is_hypothetical(text) or _is_quoted_or_meta(text)
    )


_NEGATED_MENTION_RES = (
    re.compile(
        r"\b(?:did not|didn't|do not|don't|does not|doesn't)\s+"
        r"(?:ask|say|mention|tell|order|request|state|introduce|give|offer)\b"
    ),
    re.compile(
        r"\b(?:i am not|i'm not)\s+"
        r"(?:asking|saying|mentioning|telling|ordering|requesting|stating|"
        r"introducing)\b"
    ),
)


def _is_negated_mention(text: str) -> bool:
    return any(pattern.search(text) for pattern in _NEGATED_MENTION_RES)


_ROLE_NOUNS = frozenset(
    {
        "accountant",
        "actor",
        "actress",
        "administrator",
        "analyst",
        "architect",
        "artist",
        "assistant",
        "attorney",
        "banker",
        "barista",
        "businessman",
        "businesswoman",
        "cashier",
        "ceo",
        "chef",
        "clerk",
        "consultant",
        "coordinator",
        "cook",
        "cfo",
        "cto",
        "dancer",
        "data scientist",
        "dentist",
        "designer",
        "developer",
        "director",
        "doctor",
        "driver",
        "editor",
        "electrician",
        "engineer",
        "entrepreneur",
        "farmer",
        "founder",
        "graphic designer",
        "journalist",
        "lawyer",
        "librarian",
        "manager",
        "marketer",
        "mechanic",
        "musician",
        "nurse",
        "officer",
        "owner",
        "pharmacist",
        "photographer",
        "pilot",
        "plumber",
        "product manager",
        "product owner",
        "professor",
        "programmer",
        "project manager",
        "receptionist",
        "reporter",
        "researcher",
        "salesperson",
        "sales",
        "scientist",
        "secretary",
        "singer",
        "software engineer",
        "specialist",
        "student",
        "supervisor",
        "teacher",
        "technician",
        "trader",
        "translator",
        "writer",
        "waiter",
        "waitress",
    }
)


_DIRECT_SELF_CLAUSE_PREFIX = r"(?:^|[.!?;,]\s*|\b(?:and|but)\s+)"
_NAME_EXPLICIT_RE = re.compile(
    rf"{_DIRECT_SELF_CLAUSE_PREFIX}(?:my name (?:is|'s)\s+"
    r"['\"]?([a-z][a-z'-]*))",
    re.IGNORECASE,
)
_NAME_SELF_RE = re.compile(
    rf"{_DIRECT_SELF_CLAUSE_PREFIX}(?:(?:i am|i'm)\s+"
    r"['\"]?([a-z][a-z'-]*))",
    re.IGNORECASE,
)
_NEGATED_NAME_RE = re.compile(
    r"\bmy name (?:is|'s)\s+not\b|\bmy name isn't\b",
    re.IGNORECASE,
)


def _has_name(raw: str) -> bool:
    stripped = raw.strip()
    text = _norm(stripped)
    if _is_negated_mention(text) or _NEGATED_NAME_RE.search(text):
        return False
    match = _NAME_EXPLICIT_RE.search(stripped)
    if match and match.group(1):
        return match.group(1).casefold() != "not"
    match = _NAME_SELF_RE.search(stripped)
    return bool(
        match
        and match.group(1)
        and match.group(1).casefold() != "not"
        and match.group(1)[0].isupper()
    )


_ROLE_ARTICLE_RE = re.compile(
    rf"{_DIRECT_SELF_CLAUSE_PREFIX}(?:(?:i am|i'm)\s+(?:a|an)\s+"
    r"([a-z][a-z\- ]*?)"
    r"(?=\s+(?:and|but|or|so|because|which|who|that|where|when|if|"
    r"although|though|while|on)\b|[,.!?;]|$))",
    re.IGNORECASE,
)


def _is_role_phrase(phrase: str) -> bool:
    words = [word for word in phrase.split() if word]
    if not words:
        return False
    if " ".join(words) in _ROLE_NOUNS:
        return True
    return words[-1] in _ROLE_NOUNS


def _has_role(text: str) -> bool:
    if _is_negated_mention(text):
        return False
    match = _ROLE_ARTICLE_RE.search(text)
    if match:
        return _is_role_phrase(match.group(1).strip(" ,.-"))
    return False


_INTRODUCE_ACTION = (
    "name",
    "job",
    "role",
    "work",
    "introduce",
    "myself",
    "occupation",
    "profession",
)


def _introduce_name_and_role(utterances: Sequence[str]) -> GoalResult:
    has_name = False
    has_role = False
    refusal = False
    for raw in utterances:
        low = _norm(raw)
        if _is_non_direct(low):
            continue
        if _refusal(low, _INTRODUCE_ACTION):
            refusal = True
        if not has_name and _has_name(raw):
            has_name = True
        if not has_role and _has_role(low):
            has_role = True
    if refusal and (has_name or has_role):
        return GoalResult.unknown
    if refusal:
        return GoalResult.not_achieved
    if has_name and has_role:
        return GoalResult.achieved
    return GoalResult.unknown


_ASK_WORK_RES = (
    re.compile(r"\bwhat (?:do|did) you do for (?:work|a living)\b", re.IGNORECASE),
    re.compile(
        r"\bwhat is your (?:job|occupation|profession|role|work)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bwhere do you work\b", re.IGNORECASE),
    re.compile(r"\bwhat (?:kind|type|sort) of work do you do\b", re.IGNORECASE),
)


def _ask_other_work_positive(text: str) -> bool:
    if _is_negated_mention(text):
        return False
    return any(pattern.search(text) for pattern in _ASK_WORK_RES)


_ASK_WORK_ACTION = ("ask", "job", "work", "role", "question")


def _ask_other_work_question(utterances: Sequence[str]) -> GoalResult:
    return _single_condition(
        utterances,
        _ask_other_work_positive,
        lambda text: _refusal(text, _ASK_WORK_ACTION),
    )


_CHECKIN_RES = (
    re.compile(
        r"\b(?:i'd like|i would like|i want|i need|i'd love)\s+to\s+"
        r"check[\s-]?in\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:i'm|i am)\s+(?:here\s+to\s+)?check(?:ing)?[\s-]?in\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bcheck\s+me\s+in\b", re.IGNORECASE),
)


def _checkin_request(text: str) -> bool:
    if _is_negated_mention(text):
        return False
    return any(pattern.search(text) for pattern in _CHECKIN_RES)


_RESERVATION_RES = (
    re.compile(
        r"\b(?:i have|i've got|i made|i booked)\s+(?:a\s+)?"
        r"(?:reservation|booking)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:i have|i've got|i made|i booked)\s+no\s+"
        r"(?:reservation|booking)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:i don't have|i do not have|i haven't made|i have not made)\s+"
        r"(?:a\s+)?(?:reservation|booking)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b(?:no|without)\s+(?:a\s+)?(?:reservation|booking)\b", re.IGNORECASE),
)


def _reservation_status(text: str) -> bool:
    if _is_negated_mention(text):
        return False
    return any(pattern.search(text) for pattern in _RESERVATION_RES)


_CHECKIN_ACTION = ("check in", "checkin", "check")


def _express_checkin_reservation(utterances: Sequence[str]) -> GoalResult:
    has_checkin = False
    has_reservation = False
    refusal = False
    for raw in utterances:
        low = _norm(raw)
        if _is_non_direct(low):
            continue
        if _refusal(low, _CHECKIN_ACTION):
            refusal = True
        if not has_checkin and _checkin_request(low):
            has_checkin = True
        if not has_reservation and _reservation_status(low):
            has_reservation = True
    if refusal and (has_checkin or has_reservation):
        return GoalResult.unknown
    if refusal:
        return GoalResult.not_achieved
    if has_checkin and has_reservation:
        return GoalResult.achieved
    return GoalResult.unknown


_CHECKOUT_QUESTION_RES = (
    re.compile(r"\bwhat time is check[\s-]?out\b", re.IGNORECASE),
    re.compile(r"\bwhen is check[\s-]?out\b", re.IGNORECASE),
    re.compile(r"\bwhat is the checkout time\b", re.IGNORECASE),
    re.compile(r"\bwhat time (?:do|should) i check[\s-]?out\b", re.IGNORECASE),
    re.compile(r"\bwhen (?:do|should) i check[\s-]?out\b", re.IGNORECASE),
)


def _ask_checkout_positive(text: str) -> bool:
    if _is_negated_mention(text):
        return False
    return any(pattern.search(text) for pattern in _CHECKOUT_QUESTION_RES)


_ASK_CHECKOUT_ACTION = ("ask", "checkout", "check out", "time")


def _ask_checkout_time(utterances: Sequence[str]) -> GoalResult:
    return _single_condition(
        utterances,
        _ask_checkout_positive,
        lambda text: _refusal(text, _ASK_CHECKOUT_ACTION),
    )


_ORDER_DETERMINERS = (
    r"a cup of|a glass of|a bottle of|a plate of|a bowl of|"
    r"a slice of|a piece of|a|an|the|some|one|two|three"
)
_ORDER_VERBS = (
    r"i'd like to order|i want to order|"
    r"i'll have|i will have|i'd like|i would like|i'll take|i will take|"
    r"i'd love|i want|i'll get|i will get|i'll order|"
    r"can i have|could i have|may i have|can i get|could i get|give me"
)
_ORDER_RE = re.compile(
    rf"\b(?:{_ORDER_VERBS})\s+(?:(?:{_ORDER_DETERMINERS})\s+)?([a-z]+)"
)


_FOOD_DRINK_WORDS = frozenset(
    {
        "apple",
        "appetizer",
        "bacon",
        "banana",
        "beer",
        "beef",
        "beverage",
        "bread",
        "burger",
        "burrito",
        "cake",
        "cappuccino",
        "cheese",
        "chicken",
        "chips",
        "chocolate",
        "cocktail",
        "coffee",
        "coke",
        "cookie",
        "cookies",
        "crab",
        "curry",
        "dessert",
        "drink",
        "dumplings",
        "egg",
        "eggs",
        "entree",
        "espresso",
        "fish",
        "fries",
        "fruit",
        "ham",
        "hamburger",
        "juice",
        "lamb",
        "lasagna",
        "latte",
        "lemonade",
        "lobster",
        "meat",
        "milk",
        "milkshake",
        "noodles",
        "omelet",
        "omelette",
        "orange",
        "pancake",
        "pancakes",
        "pasta",
        "pie",
        "pizza",
        "pork",
        "ravioli",
        "rice",
        "salad",
        "salmon",
        "sandwich",
        "sausage",
        "shrimp",
        "smoothie",
        "soda",
        "soup",
        "spaghetti",
        "starter",
        "steak",
        "sushi",
        "tacos",
        "tea",
        "toast",
        "tuna",
        "vegetable",
        "vegetables",
        "waffle",
        "waffles",
        "water",
        "wine",
    }
)


def _order_positive(text: str) -> bool:
    if _is_negated_mention(text):
        return False
    match = _ORDER_RE.search(text)
    if not match:
        return False
    return match.group(1) in _FOOD_DRINK_WORDS


_ORDER_ACTION = ("order", "anything", "meal", "food", "drink")


def _order_one_dish_or_drink(utterances: Sequence[str]) -> GoalResult:
    return _single_condition(
        utterances,
        _order_positive,
        lambda text: _refusal(text, _ORDER_ACTION),
    )


_NO_REQUIREMENT_RE = re.compile(
    r"\bno\s+(?:special\s+|dietary\s+)?"
    r"(?:requirements?|restrictions?|preferences?|requests?)\b",
    re.IGNORECASE,
)

_INGREDIENTS = frozenset(
    {
        "butter",
        "cilantro",
        "dairy",
        "garlic",
        "gluten",
        "nuts",
        "onion",
        "onions",
        "peanut",
        "peanuts",
        "pepper",
        "salt",
        "sugar",
        "shellfish",
        "soy",
        "spice",
        "spices",
    }
)

_ALLERGY_RE = re.compile(r"\b(?:allergic|allergy)\s+to\s+([a-z]+)", re.IGNORECASE)
_DIETARY_RE = re.compile(
    r"\b(?:don't|do not|can't|cannot)\s+(?:eat|drink)\s+"
    r"(?:a|an|the|some|any)?\s*([a-z]+)",
    re.IGNORECASE,
)
_NO_FOOD_RE = re.compile(r"\bno\s+([a-z]+)", re.IGNORECASE)


def _preference_positive(text: str) -> bool:
    if _is_negated_mention(text):
        return False
    if _NO_REQUIREMENT_RE.search(text):
        return True
    food_or_ingredient = _FOOD_DRINK_WORDS | _INGREDIENTS
    for pattern in (_ALLERGY_RE, _DIETARY_RE, _NO_FOOD_RE):
        match = pattern.search(text)
        if match and match.group(1) in food_or_ingredient:
            return True
    return False


_PREFERENCE_ACTION = (
    "preference",
    "requirement",
    "allergy",
    "allergic",
    "dietary",
    "tell",
    "restriction",
)


def _state_preference_or_no_requirements(
    utterances: Sequence[str],
) -> GoalResult:
    return _single_condition(
        utterances,
        _preference_positive,
        lambda text: _refusal(text, _PREFERENCE_ACTION),
    )


def _single_condition(
    utterances: Sequence[str],
    positive_fn: Callable[[str], bool],
    refusal_fn: Callable[[str], bool],
) -> GoalResult:
    has_positive = False
    has_refusal = False
    for raw in utterances:
        low = _norm(raw)
        if _is_non_direct(low):
            continue
        if refusal_fn(low):
            has_refusal = True
        if positive_fn(low):
            has_positive = True
    if has_refusal and has_positive:
        return GoalResult.unknown
    if has_refusal:
        return GoalResult.not_achieved
    if has_positive:
        return GoalResult.achieved
    return GoalResult.unknown


_GOAL_HANDLERS = {
    "mat_biz_greet_b1:introduce_name_and_role": _introduce_name_and_role,
    "mat_biz_greet_b1:ask_other_work_question": _ask_other_work_question,
    "mat_hotel_checkin_b1:express_checkin_reservation_status": (
        _express_checkin_reservation
    ),
    "mat_hotel_checkin_b1:ask_checkout_time": _ask_checkout_time,
    "mat_restaurant_b1:order_one_dish_or_drink": _order_one_dish_or_drink,
    "mat_restaurant_b1:state_preference_or_no_requirements": (
        _state_preference_or_no_requirements
    ),
}


def evaluate_goal(
    goal_id: str,
    goal_version: int,
    user_utterances: Sequence[str],
) -> GoalResult:
    """Adjudicate one goal from its student-only utterance evidence."""
    if goal_id not in SUPPORTED_GOAL_IDS:
        return GoalResult.not_assessed
    if goal_version != 1:
        return GoalResult.not_assessed
    return _GOAL_HANDLERS[goal_id](list(user_utterances))
