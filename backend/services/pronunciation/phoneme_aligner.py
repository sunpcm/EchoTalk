"""
Needleman-Wunsch 音素对齐算法。
比较用户实际音素和标准参考音素，输出含错误类型标记的对齐数组。
"""

# 打分参数
MATCH_SCORE = 2
MISMATCH_PENALTY = -1
GAP_PENALTY = -1


def align_phonemes(ref_phonemes: list[str], user_phonemes: list[str]) -> list[dict]:
    """
    Needleman-Wunsch 全局序列对齐。

    参数:
        ref_phonemes: 标准参考音素序列
        user_phonemes: 用户实际音素序列

    返回:
        对齐结果数组，每个元素包含:
        - position: 对齐位置索引
        - phoneme: 显示用音素（优先取 expected）
        - expected: 参考音素（deletion/insertion 时可能为 None）
        - actual: 用户音素（deletion 时可能为 None）
        - type: "correct" | "substitution" | "deletion" | "insertion"
    """
    m = len(ref_phonemes)
    n = len(user_phonemes)

    # 初始化 DP 矩阵
    dp = [[0] * (n + 1) for _ in range(m + 1)]

    # 第一列：ref 全部缺失 = 全 deletion
    for i in range(1, m + 1):
        dp[i][0] = i * GAP_PENALTY

    # 第一行：user 全部多余 = 全 insertion
    for j in range(1, n + 1):
        dp[0][j] = j * GAP_PENALTY

    # 填充 DP 矩阵
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if ref_phonemes[i - 1] == user_phonemes[j - 1]:
                diag = dp[i - 1][j - 1] + MATCH_SCORE
            else:
                diag = dp[i - 1][j - 1] + MISMATCH_PENALTY

            up = dp[i - 1][j] + GAP_PENALTY  # gap in user → deletion
            left = dp[i][j - 1] + GAP_PENALTY  # gap in ref → insertion

            dp[i][j] = max(diag, up, left)

    # 回溯：从右下角回到左上角
    alignment: list[dict] = []
    i, j = m, n

    while i > 0 or j > 0:
        if i > 0 and j > 0:
            if ref_phonemes[i - 1] == user_phonemes[j - 1]:
                score = MATCH_SCORE
            else:
                score = MISMATCH_PENALTY

            if dp[i][j] == dp[i - 1][j - 1] + score:
                # 对角线移动：match 或 substitution
                if ref_phonemes[i - 1] == user_phonemes[j - 1]:
                    alignment.append(
                        {
                            "type": "correct",
                            "expected": ref_phonemes[i - 1],
                            "actual": user_phonemes[j - 1],
                        }
                    )
                else:
                    alignment.append(
                        {
                            "type": "substitution",
                            "expected": ref_phonemes[i - 1],
                            "actual": user_phonemes[j - 1],
                        }
                    )
                i -= 1
                j -= 1
                continue

        if i > 0 and dp[i][j] == dp[i - 1][j] + GAP_PENALTY:
            # 上方移动：ref 音素在 user 中缺失 = deletion
            alignment.append(
                {
                    "type": "deletion",
                    "expected": ref_phonemes[i - 1],
                    "actual": None,
                }
            )
            i -= 1
            continue

        if j > 0 and dp[i][j] == dp[i][j - 1] + GAP_PENALTY:
            # 左方移动：user 多出音素 = insertion
            alignment.append(
                {
                    "type": "insertion",
                    "expected": None,
                    "actual": user_phonemes[j - 1],
                }
            )
            j -= 1
            continue

    # 反转得到正序，并添加 position 和 phoneme 字段
    alignment.reverse()
    for idx, entry in enumerate(alignment):
        entry["position"] = idx
        # phoneme: 优先取 expected，insertion 时取 actual
        entry["phoneme"] = (
            entry["expected"] if entry["expected"] is not None else entry["actual"]
        )

    return alignment


def compute_pronunciation_score(alignment: list[dict]) -> float:
    """
    计算发音得分：正确音素占比 × 100。

    参数:
        alignment: align_phonemes 返回的对齐数组

    返回:
        0.0 ~ 100.0 的得分
    """
    if not alignment:
        return 0.0
    correct_count = sum(1 for a in alignment if a["type"] == "correct")
    return round(correct_count / len(alignment) * 100, 1)
