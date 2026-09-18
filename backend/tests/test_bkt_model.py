from services.knowledge.bkt_model import (
    BKTParams,
    is_mastered,
    update_mastery,
)


def test_is_mastered_default_threshold():
    """测试使用默认阈值的掌握判定（严格大于 MASTERY_THRESHOLD=0.95）。"""
    assert is_mastered(0.96) is True
    assert is_mastered(0.951) is True
    assert is_mastered(1.0) is True

    # 边界与低于阈值的情况
    assert is_mastered(0.95) is False
    assert is_mastered(0.94) is False
    assert is_mastered(0.0) is False


def test_is_mastered_custom_threshold():
    """测试使用自定义阈值的掌握判定。"""
    threshold = 0.80
    assert is_mastered(0.81, threshold=threshold) is True
    assert is_mastered(0.80, threshold=threshold) is False
    assert is_mastered(0.79, threshold=threshold) is False


def test_bkt_params_defaults():
    """测试 BKTParams 默认参数。"""
    params = BKTParams()
    assert params.p_init == 0.1
    assert params.p_transit == 0.2
    assert params.p_slip == 0.1
    assert params.p_guess == 0.2


def test_update_mastery_correct_answer():
    """测试答对时掌握概率增长。"""
    params = BKTParams()
    p_initial = 0.5
    p_updated = update_mastery(p_initial, correct=True, params=params)
    assert p_updated > p_initial
    assert 0.0 <= p_updated <= 1.0


def test_update_mastery_incorrect_answer():
    """测试答错时掌握概率下降。"""
    params = BKTParams()
    p_initial = 0.5
    p_updated = update_mastery(p_initial, correct=False, params=params)
    assert p_updated < p_initial
    assert 0.0 <= p_updated <= 1.0
