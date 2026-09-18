from pytest import approx

from services.knowledge.bkt_model import (
    MASTERY_THRESHOLD,
    BKTParams,
    is_mastered,
    update_mastery,
)


def test_bkt_params_default():
    params = BKTParams()
    assert params.p_init == 0.1
    assert params.p_transit == 0.2
    assert params.p_slip == 0.1
    assert params.p_guess == 0.2


def test_bkt_params_custom():
    params = BKTParams(p_init=0.3, p_transit=0.15, p_slip=0.05, p_guess=0.25)
    assert params.p_init == 0.3
    assert params.p_transit == 0.15
    assert params.p_slip == 0.05
    assert params.p_guess == 0.25


def test_update_mastery_correct():
    params = BKTParams()
    p_mastery = 0.5
    updated = update_mastery(p_mastery, True, params)

    # p_correct = (1 - 0.1)*0.5 + 0.2*0.5 = 0.55
    # posterior = 0.45 / 0.55 = 0.8181818...
    # updated = posterior + (1 - posterior)*0.2 = 47 / 55
    expected = 47 / 55
    assert updated == approx(expected)
    assert updated > p_mastery


def test_update_mastery_incorrect():
    params = BKTParams()
    p_mastery = 0.5
    updated = update_mastery(p_mastery, False, params)

    # p_incorrect = 0.1*0.5 + (1 - 0.2)*0.5 = 0.45
    # posterior = 0.05 / 0.45 = 1 / 9
    expected = 1 / 9
    assert updated == approx(expected)
    assert updated < p_mastery


def test_update_mastery_boundary_zero():
    params = BKTParams()

    # When starting at 0.0 mastery and getting a correct answer,
    # posterior is 0.0, but learning transit adds p_transit (0.2).
    updated_correct = update_mastery(0.0, True, params)
    assert updated_correct == approx(params.p_transit)

    # When starting at 0.0 mastery and getting an incorrect answer,
    # posterior remains 0.0, and no transit occurs.
    updated_incorrect = update_mastery(0.0, False, params)
    assert updated_incorrect == approx(0.0)


def test_update_mastery_boundary_one():
    params = BKTParams()

    # When mastery is 1.0, both correct and incorrect answers keep posterior at 1.0.
    updated_correct = update_mastery(1.0, True, params)
    assert updated_correct == approx(1.0)

    updated_incorrect = update_mastery(1.0, False, params)
    assert updated_incorrect == approx(1.0)


def test_update_mastery_consecutive_correct():
    params = BKTParams()
    p_mastery = params.p_init

    for _ in range(5):
        new_mastery = update_mastery(p_mastery, True, params)
        assert new_mastery > p_mastery
        p_mastery = new_mastery

    assert p_mastery > 0.9


def test_update_mastery_consecutive_incorrect():
    params = BKTParams()
    p_mastery = 0.9

    for _ in range(5):
        new_mastery = update_mastery(p_mastery, False, params)
        assert new_mastery < p_mastery
        p_mastery = new_mastery

    assert p_mastery < 0.1


def test_update_mastery_custom_params():
    custom_params = BKTParams(p_init=0.2, p_transit=0.3, p_slip=0.05, p_guess=0.1)
    p_mastery = 0.4

    # p_correct = (1 - 0.05)*0.4 + 0.1*(0.6) = 0.38 + 0.06 = 0.44
    # posterior = 0.38 / 0.44 = 19 / 22
    # updated = 19/22 + (3/22)*0.3 = (19 + 0.9) / 22 = 19.9 / 22
    expected = 19.9 / 22
    updated = update_mastery(p_mastery, True, custom_params)
    assert updated == approx(expected)


def test_is_mastered_default_threshold():
    assert MASTERY_THRESHOLD == 0.95
    assert is_mastered(0.96) is True
    assert is_mastered(0.95) is False
    assert is_mastered(0.94) is False
    assert is_mastered(0.0) is False


def test_is_mastered_custom_threshold():
    assert is_mastered(0.8, threshold=0.75) is True
    assert is_mastered(0.75, threshold=0.75) is False
    assert is_mastered(0.70, threshold=0.75) is False
