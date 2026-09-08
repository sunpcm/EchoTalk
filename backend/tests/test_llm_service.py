import pytest
from services.llm_service import build_dynamic_prompt


@pytest.mark.parametrize(
    "anxiety_level, expect_encouragement, expected_index_str",
    [
        (0.0, False, "0.00"),
        (0.3, False, "0.30"),
        (0.6, False, "0.60"),
        (0.6001, True, "0.60"),
        (0.75, True, "0.75"),
        (1.0, True, "1.00"),
    ],
)
def test_build_dynamic_prompt_anxiety_levels(
    anxiety_level: float, expect_encouragement: bool, expected_index_str: str
):
    prompt = build_dynamic_prompt(anxiety_level=anxiety_level)

    assert f"[Emotion Awareness] Current user anxiety index: {expected_index_str}" in prompt

    if expect_encouragement:
        assert "Switch to ENCOURAGEMENT MODE:" in prompt
        assert "Use normal teaching mode:" not in prompt
    else:
        assert "Use normal teaching mode:" in prompt
        assert "Switch to ENCOURAGEMENT MODE:" not in prompt


@pytest.mark.parametrize(
    "weak_skills, expected_in_prompt, expected_text",
    [
        (None, False, None),
        ([], False, None),
        (["grammar"], True, "[Weak Skills] Focus practice on: grammar"),
        (
            ["pronunciation", "vocabulary"],
            True,
            "[Weak Skills] Focus practice on: pronunciation, vocabulary",
        ),
    ],
)
def test_build_dynamic_prompt_weak_skills(
    weak_skills: list[str] | None, expected_in_prompt: bool, expected_text: str | None
):
    prompt = build_dynamic_prompt(anxiety_level=0.2, weak_skills=weak_skills)

    if expected_in_prompt:
        assert expected_text in prompt
    else:
        assert "[Weak Skills]" not in prompt


@pytest.mark.parametrize(
    "custom_prompt, expected_in_prompt",
    [
        (None, False),
        ("", False),
        ("Act as an interviewer for a tech job.", True),
    ],
)
def test_build_dynamic_prompt_custom_prompt(
    custom_prompt: str | None, expected_in_prompt: bool
):
    prompt = build_dynamic_prompt(anxiety_level=0.2, custom_prompt=custom_prompt)

    if expected_in_prompt:
        assert "[Custom Role Instruction]\nAct as an interviewer for a tech job." in prompt
    else:
        assert "[Custom Role Instruction]" not in prompt


@pytest.mark.parametrize(
    "document_content, expected_in_prompt",
    [
        (None, False),
        ("", False),
        ("This is the transcript of the news article.", True),
    ],
)
def test_build_dynamic_prompt_document_content(
    document_content: str | None, expected_in_prompt: bool
):
    prompt = build_dynamic_prompt(anxiety_level=0.2, document_content=document_content)

    if expected_in_prompt:
        assert "[Reference Document]" in prompt
        assert "<document>\nThis is the transcript of the news article.\n</document>" in prompt
    else:
        assert "[Reference Document]" not in prompt


def test_build_dynamic_prompt_full_combination():
    prompt = build_dynamic_prompt(
        anxiety_level=0.8,
        weak_skills=["fluency", "listening"],
        custom_prompt="Roleplay as a cafe barista.",
        document_content="Menu: Coffee $3, Tea $2.",
    )

    # Check all sections exist
    assert "[Emotion Awareness] Current user anxiety index: 0.80" in prompt
    assert "Switch to ENCOURAGEMENT MODE:" in prompt
    assert "[Weak Skills] Focus practice on: fluency, listening" in prompt
    assert "[Custom Role Instruction]\nRoleplay as a cafe barista." in prompt
    assert "[Reference Document]" in prompt
    assert "<document>\nMenu: Coffee $3, Tea $2.\n</document>" in prompt
    assert "[Guidelines]" in prompt

    # Verify structural order of layers
    pos_role = prompt.index("You are a friendly and patient AI English speaking coach.")
    pos_emotion = prompt.index("[Emotion Awareness]")
    pos_weak = prompt.index("[Weak Skills]")
    pos_custom = prompt.index("[Custom Role Instruction]")
    pos_doc = prompt.index("[Reference Document]")
    pos_guidelines = prompt.index("[Guidelines]")

    assert pos_role < pos_emotion < pos_weak < pos_custom < pos_doc < pos_guidelines
