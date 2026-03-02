"""
BKT（贝叶斯知识追踪）模型。
根据学生的答题表现，实时更新每个技能的掌握概率。
"""

from dataclasses import dataclass

# 掌握判定阈值
MASTERY_THRESHOLD = 0.95


@dataclass
class BKTParams:
    """BKT 模型参数。"""

    p_init: float = 0.1  # 初始掌握概率（保守估计）
    p_transit: float = 0.2  # 单次练习后新学会的概率
    p_slip: float = 0.1  # 已掌握但答错的概率（失误率）
    p_guess: float = 0.2  # 未掌握但猜对的概率


def update_mastery(p_mastery: float, correct: bool, params: BKTParams) -> float:
    """
    标准 BKT 贝叶斯知识追踪更新公式。

    步骤:
    1. 观察步骤 (Observation)：根据答对/答错更新后验概率
    2. 学习步骤 (Transit)：仅在答对时触发知识迁移

    参数:
        p_mastery: 当前掌握概率
        correct: 本次是否答对
        params: BKT 参数

    返回:
        更新后的掌握概率
    """
    if correct:
        # P(correct) = P(correct|mastered)*P(mastered) + P(guess)*P(not mastered)
        p_correct = (1 - params.p_slip) * p_mastery + params.p_guess * (1 - p_mastery)
        # 后验：P(mastered | correct)
        posterior = (1 - params.p_slip) * p_mastery / p_correct
        # 学习迁移：正确练习触发知识迁移
        return posterior + (1 - posterior) * params.p_transit
    else:
        # P(incorrect) = P(slip)*P(mastered) + P(not guess)*P(not mastered)
        p_incorrect = params.p_slip * p_mastery + (1 - params.p_guess) * (1 - p_mastery)
        # 后验：P(mastered | incorrect)
        posterior = params.p_slip * p_mastery / p_incorrect
        # 答错不触发学习迁移
        return posterior


def is_mastered(p_mastery: float, threshold: float = MASTERY_THRESHOLD) -> bool:
    """判断技能是否已掌握。"""
    return p_mastery > threshold
