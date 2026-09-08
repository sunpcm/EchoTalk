import time
from services.emotion_analyzer import EmotionAnalyzer, EmotionState


def test_emotion_state_default_and_to_dict():
    state = EmotionState()
    assert state.anxiety_level == 0.3
    assert state.cognitive_load == "normal"
    assert state.hesitation_rate == 0.0
    assert state.wpm == 0.0

    expected_dict = {
        "anxiety_level": 0.3,
        "cognitive_load": "normal",
        "hesitation_rate": 0.0,
        "wpm": 0.0,
    }
    assert state.to_dict() == expected_dict


def test_emotion_analyzer_initial_state():
    analyzer = EmotionAnalyzer()
    assert analyzer.latest == EmotionState()


def test_record_utterance_below_min_utterances():
    analyzer = EmotionAnalyzer()
    state = analyzer.record_utterance("Hello world", timestamp=100.0)
    assert state == EmotionState()
    assert analyzer.latest == EmotionState()


def test_record_utterance_default_timestamp():
    analyzer = EmotionAnalyzer()
    t_before = time.time()
    state1 = analyzer.record_utterance("First utterance")
    t_after = time.time()

    assert len(analyzer._utterances) == 1
    recorded_ts = analyzer._utterances[0].timestamp
    assert t_before <= recorded_ts <= t_after
    assert state1 == EmotionState()


def test_record_utterance_hesitation_extraction():
    analyzer = EmotionAnalyzer()
    text = "Uh um ER UHM ah HMM erm EH HUH normal words here"
    state = analyzer.record_utterance(text, timestamp=100.0)
    assert state == EmotionState()

    last_utt = analyzer._utterances[0]
    # hesitations: uh, um, ER, UHM, ah, HMM, erm, EH, HUH -> 9 hesitations
    # total words: 12 words ('Uh', 'um', 'ER', 'UHM', 'ah', 'HMM',
    # 'erm', 'EH', 'HUH', 'normal', 'words', 'here')
    # content words: 12 - 9 = 3
    assert last_utt.hesitation_count == 9
    assert last_utt.word_count == 3


def test_emotion_analyzer_stats_and_cognitive_load_normal():
    analyzer = EmotionAnalyzer()
    # 2 utterances over 60 seconds (1 minute window duration)
    # Each utterance has 1 hesitation and 30 content words -> 60 total
    analyzer.record_utterance("uh " + ("word " * 30).strip(), timestamp=0.0)
    state = analyzer.record_utterance("um " + ("word " * 30).strip(), timestamp=60.0)

    assert state.hesitation_rate == 2.0
    assert state.wpm == 60.0
    assert state.cognitive_load == "normal"


def test_emotion_analyzer_cognitive_load_high():
    analyzer = EmotionAnalyzer()
    # 2 utterances over 60 seconds (1 minute window duration)
    # 4 hesitations total -> 4 hesitation rate / min (> 3.0 -> "high")
    analyzer.record_utterance("uh um " + ("word " * 20).strip(), timestamp=0.0)
    state = analyzer.record_utterance("er ah " + ("word " * 20).strip(), timestamp=60.0)

    assert state.hesitation_rate == 4.0
    assert state.cognitive_load == "high"


def test_emotion_analyzer_anxiety_levels():
    # Case 1: Fast speech (>= 100 WPM) and zero hesitations
    # Base: 0.3, Hesitation factor: 0, Speed factor: 0 -> Anxiety: 0.3
    analyzer1 = EmotionAnalyzer()
    analyzer1.record_utterance("word " * 100, timestamp=0.0)
    state1 = analyzer1.record_utterance("word " * 100, timestamp=60.0)
    assert state1.anxiety_level == 0.3

    # Case 2: Medium speed (80 < WPM < 100) and zero hesitations
    # 90 WPM over 1 min -> ratio = (100 - 90)/20 = 0.5. Speed factor = 0.15
    # Base: 0.3, Hesitation factor: 0, Speed factor: 0.15 -> Anxiety: 0.45
    analyzer2 = EmotionAnalyzer()
    analyzer2.record_utterance("word " * 45, timestamp=0.0)
    state2 = analyzer2.record_utterance("word " * 45, timestamp=60.0)
    assert state2.wpm == 90.0
    assert state2.anxiety_level == 0.45

    # Case 3: Slow speech (< 80 WPM) and high hesitation rate (> 3.0)
    # Hesitation rate = 3.0 / min -> hesitation_factor = min(3/3 * 0.4, 0.4) = 0.4
    # Speed factor = 0.3 (WPM < 80)
    # Base: 0.3 + 0.4 + 0.3 = 1.0
    analyzer3 = EmotionAnalyzer()
    analyzer3.record_utterance("uh um " + ("word " * 10).strip(), timestamp=0.0)
    state3 = analyzer3.record_utterance("er " + ("word " * 10).strip(), timestamp=60.0)
    assert state3.anxiety_level == 1.0

    # Case 4: Extreme high hesitation rate to test upper clamp (1.0)
    analyzer4 = EmotionAnalyzer()
    analyzer4.record_utterance("uh um er uhm ah hmm erm eh huh " * 5, timestamp=0.0)
    state4 = analyzer4.record_utterance(
        "uh um er uhm ah hmm erm eh huh " * 5, timestamp=60.0
    )
    assert state4.anxiety_level == 1.0


def test_sliding_window_pruning():
    analyzer = EmotionAnalyzer()

    # t = 0.0: utterance 1
    analyzer.record_utterance("hello world", timestamp=0.0)
    # t = 100.0: utterance 2 (window has 2 utterances: t=0 and t=100)
    state2 = analyzer.record_utterance("this is a test", timestamp=100.0)
    assert state2.wpm > 0

    # t = 130.0: utterance 3
    # Cutoff is 130 - 120 = 10. Utterance 1 at t=0 is expired and removed
    # Window now has 2 utterances: t=100 and t=130
    analyzer.record_utterance("third sentence here", timestamp=130.0)
    assert len(analyzer._utterances) == 2
    assert analyzer._utterances[0].timestamp == 100.0
    assert analyzer._utterances[1].timestamp == 130.0

    # t = 230.0: utterance 4
    # Cutoff is 230 - 120 = 110. Utterance 2 at t=100 is expired
    # Window now has 2 utterances: t=130 and t=230
    analyzer.record_utterance("fourth sentence here", timestamp=230.0)
    assert len(analyzer._utterances) == 2
    assert analyzer._utterances[0].timestamp == 130.0
    assert analyzer._utterances[1].timestamp == 230.0

    # t = 400.0: utterance 5
    # Cutoff is 400 - 120 = 280. Utterance 3 at t=130 and 4 at t=230 expired
    # Window now has 1 utterance (t=400), which is < MIN_UTTERANCES (2),
    # returning default EmotionState()
    state5 = analyzer.record_utterance("fifth sentence here", timestamp=400.0)
    assert len(analyzer._utterances) == 1
    assert state5 == EmotionState()


def test_edge_cases():
    analyzer = EmotionAnalyzer()

    # Edge case 1: utterance with only hesitations
    # content_word_count should be 0, not negative
    analyzer.record_utterance("uh um er", timestamp=0.0)
    last_utt = analyzer._utterances[0]
    assert last_utt.word_count == 0
    assert last_utt.hesitation_count == 3

    # Edge case 2: zero window duration (two utterances at the same timestamp)
    # window_duration_sec = max(0.0, 1.0) = 1.0s, preventing div by zero
    # Utterance 1 (2 words) + Utterance 2 (3 words) = 5 words across 1s
    # WPM = 5 / (1 / 60) = 300 WPM
    analyzer.record_utterance("hello world", timestamp=0.0)
    state = analyzer.record_utterance("hello world again", timestamp=0.0)
    assert state.wpm == 300.0
