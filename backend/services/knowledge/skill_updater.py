"""
音素→技能映射工具。
将音素对齐结果中的错误映射到对应的技能 ID。
"""

# ARPAbet 元音音素集
VOWEL_PHONEMES = {
    "AA",
    "AE",
    "AH",
    "AO",
    "AW",
    "AY",
    "EH",
    "ER",
    "EY",
    "IH",
    "IY",
    "OW",
    "OY",
    "UH",
    "UW",
}

# TH 相关音素
TH_PHONEMES = {"TH", "DH"}

# ARPAbet 辅音音素集（不含 TH/DH）
CONSONANT_PHONEMES = {
    "B",
    "CH",
    "D",
    "F",
    "G",
    "HH",
    "JH",
    "K",
    "L",
    "M",
    "N",
    "NG",
    "P",
    "R",
    "S",
    "SH",
    "T",
    "V",
    "W",
    "Y",
    "Z",
    "ZH",
}


def phoneme_error_to_skill(entry: dict) -> str | None:
    """
    将单个音素对齐条目映射到技能 ID。

    参数:
        entry: align_phonemes 返回的单个对齐元素

    返回:
        技能 ID 字符串，无法映射时返回 None
    """
    error_type = entry.get("type")

    if error_type in ("correct", "substitution", "deletion"):
        phoneme = entry.get("expected")
        if phoneme is None:
            return None
        if phoneme in TH_PHONEMES:
            return "th_sounds"
        if phoneme in VOWEL_PHONEMES:
            return "vowel_sounds"
        if phoneme in CONSONANT_PHONEMES:
            return "consonant_clusters"
        return None

    if error_type == "insertion":
        # 多余音素映射到辅音连缀问题
        return "consonant_clusters"

    return None
