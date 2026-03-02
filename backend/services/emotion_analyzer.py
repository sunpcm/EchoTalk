"""
情绪分析器：基于 STT 文本的轻量规则引擎。

从 Deepgram 转录文本中提取犹豫词频率和语速，计算焦虑指数。
纯 CPU 计算，单次调用 <0.1ms，适合在 LiveKit Agent 事件循环中直接执行。

Phase 3 本地轻量化方案——仅文本分析。
Pro/Premium 音频特征分析（librosa F0/能量）预留为后续扩展。
"""

import re
import time
from collections import deque
from dataclasses import asdict, dataclass

# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class EmotionState:
    """单次分析的情绪快照。"""

    anxiety_level: float = 0.3  # 0.0~1.0，默认中低焦虑
    cognitive_load: str = "normal"  # "normal" | "high"
    hesitation_rate: float = 0.0  # 犹豫词频率（次/分钟）
    wpm: float = 0.0  # 语速（词/分钟）

    def to_dict(self) -> dict:
        """序列化为可存入 JSON 列的字典。"""
        return asdict(self)


@dataclass
class _Utterance:
    """滑动窗口中的一条发言记录。"""

    timestamp: float  # time.time() 秒级时间戳
    word_count: int  # 有效词数（不含犹豫词）
    hesitation_count: int  # 犹豫词数


# ---------------------------------------------------------------------------
# 分析器
# ---------------------------------------------------------------------------


class EmotionAnalyzer:
    """
    基于文本的轻量情绪分析器。

    工作原理：
    1. 每次用户发言，提取犹豫词数量和总词数。
    2. 维护 2 分钟滑动窗口，计算窗口内的犹豫词频率和语速。
    3. 规则引擎判定 cognitive_load 和 anxiety_level。

    线程安全说明：
    该实例仅在 LiveKit Agent 的单一 asyncio 事件循环中使用，
    不需要锁。每个 AgentSession 创建独立的 EmotionAnalyzer。
    """

    # Deepgram 会将犹豫声转录为这些 filler words
    HESITATION_RE = re.compile(r"\b(uh|um|er|uhm|ah|hmm|erm|eh|huh)\b", re.IGNORECASE)

    # 滑动窗口时长（秒）
    WINDOW_SECONDS: float = 120.0

    # 最少发言数，低于此值返回保守默认值
    MIN_UTTERANCES: int = 2

    # 规则引擎阈值
    HESITATION_HIGH_THRESHOLD: float = 3.0  # 犹豫词 > 3次/分钟 → high
    WPM_LOW_THRESHOLD: float = 80.0  # 语速 < 80 WPM → 增加焦虑
    WPM_NORMAL_LOW: float = 100.0  # 正常语速下限
    WPM_NORMAL_HIGH: float = 160.0  # 正常语速上限

    def __init__(self) -> None:
        self._utterances: deque[_Utterance] = deque()
        self._latest = EmotionState()

    @property
    def latest(self) -> EmotionState:
        """最近一次分析结果。"""
        return self._latest

    def record_utterance(
        self,
        text: str,
        timestamp: float | None = None,
    ) -> EmotionState:
        """
        记录一条用户发言，返回更新后的情绪状态。

        参数:
            text: Deepgram STT 输出的原始文本
            timestamp: 秒级时间戳（默认取当前时间）

        返回:
            EmotionState —— 最新的情绪快照
        """
        if timestamp is None:
            timestamp = time.time()

        # 1. 提取犹豫词和词数
        hesitations = self.HESITATION_RE.findall(text)
        hesitation_count = len(hesitations)

        words = text.split()
        total_word_count = len(words)
        content_word_count = total_word_count - hesitation_count

        # 2. 加入滑动窗口
        self._utterances.append(
            _Utterance(
                timestamp=timestamp,
                word_count=max(content_word_count, 0),
                hesitation_count=hesitation_count,
            )
        )

        # 3. 清除窗口外的过期数据
        cutoff = timestamp - self.WINDOW_SECONDS
        while self._utterances and self._utterances[0].timestamp < cutoff:
            self._utterances.popleft()

        # 4. 计算窗口内统计量
        self._latest = self._compute_emotion(timestamp)
        return self._latest

    def _compute_emotion(self, now: float) -> EmotionState:
        """基于滑动窗口数据计算情绪状态。"""
        if len(self._utterances) < self.MIN_UTTERANCES:
            # 数据不足，返回保守默认值
            return EmotionState()

        total_words = sum(u.word_count for u in self._utterances)
        total_hesitations = sum(u.hesitation_count for u in self._utterances)

        # 窗口时间跨度（秒），至少 1 秒避免除零
        window_start = self._utterances[0].timestamp
        window_duration_sec = max(now - window_start, 1.0)
        window_duration_min = window_duration_sec / 60.0

        # 犹豫词频率（次/分钟）
        hesitation_rate = total_hesitations / window_duration_min

        # 语速（词/分钟）
        wpm = total_words / window_duration_min

        # 规则引擎：计算 anxiety_level
        anxiety = self._compute_anxiety(hesitation_rate, wpm)

        # cognitive_load 判定
        cognitive_load = (
            "high" if hesitation_rate > self.HESITATION_HIGH_THRESHOLD else "normal"
        )

        return EmotionState(
            anxiety_level=round(anxiety, 2),
            cognitive_load=cognitive_load,
            hesitation_rate=round(hesitation_rate, 2),
            wpm=round(wpm, 1),
        )

    def _compute_anxiety(self, hesitation_rate: float, wpm: float) -> float:
        """
        综合计算焦虑指数。

        犹豫词因子（0~0.4）：hesitation_rate / HIGH_THRESHOLD * 0.4
        语速因子（0~0.3）：语速越低于正常范围，因子越高
        基础值：0.3（中性起点）

        最终 clamp 到 [0.0, 1.0]。
        """
        base = 0.3

        # 犹豫词因子：线性映射到 [0, 0.4]
        hesitation_factor = min(
            hesitation_rate / self.HESITATION_HIGH_THRESHOLD * 0.4, 0.4
        )

        # 语速因子：低于正常下限时增加焦虑
        if wpm < self.WPM_LOW_THRESHOLD:
            speed_factor = 0.3
        elif wpm < self.WPM_NORMAL_LOW:
            # 80~100 WPM 线性插值
            ratio = (self.WPM_NORMAL_LOW - wpm) / (
                self.WPM_NORMAL_LOW - self.WPM_LOW_THRESHOLD
            )
            speed_factor = ratio * 0.3
        else:
            speed_factor = 0.0

        anxiety = base + hesitation_factor + speed_factor
        return max(0.0, min(1.0, anxiety))
