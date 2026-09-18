import pytest
from routers.curriculum import _build_system_prompt_template


def test_build_system_prompt_template_standard():
    scenario_name = "Coffee Shop Order"
    focus_skills = ["ordering", "polite_requests"]
    difficulty = "B1"
    material_description = "Ordering coffee at a busy cafe"

    prompt = _build_system_prompt_template(
        scenario_name=scenario_name,
        focus_skills=focus_skills,
        difficulty=difficulty,
        material_description=material_description,
    )

    expected_role_str = (
        "You are a friendly AI English coach running a "
        "'Coffee Shop Order' practice scenario."
    )
    assert expected_role_str in prompt
    assert "[Scenario] Ordering coffee at a busy cafe" in prompt
    assert "[Target Level] CEFR B1" in prompt
    assert "[Focus Skills] ordering, polite_requests" in prompt
    assert "[Instructions]" in prompt
    assert "- Adjust complexity to B1 level" in prompt


@pytest.mark.parametrize(
    "focus_skills, expected_skills_str",
    [
        ([], ""),
        (["grammar"], "grammar"),
        (
            ["fluency", "vocabulary", "pronunciation"],
            "fluency, vocabulary, pronunciation",
        ),
    ],
)
def test_build_system_prompt_template_focus_skills_variations(
    focus_skills: list[str], expected_skills_str: str
):
    prompt = _build_system_prompt_template(
        scenario_name="Job Interview",
        focus_skills=focus_skills,
        difficulty="B2",
        material_description="Answering common behavioral questions.",
    )

    assert f"[Focus Skills] {expected_skills_str}" in prompt


def test_build_system_prompt_template_multiline_and_special_chars():
    scenario_name = "Doctor's Appointment & Check-up"
    focus_skills = ["symptoms_description", "asking_questions"]
    difficulty = "A2"
    material_description = (
        "Line 1: Describing health issues.\nLine 2: Asking for prescription details."
    )

    prompt = _build_system_prompt_template(
        scenario_name=scenario_name,
        focus_skills=focus_skills,
        difficulty=difficulty,
        material_description=material_description,
    )

    assert "Doctor's Appointment & Check-up" in prompt
    assert material_description in prompt
    assert "[Target Level] CEFR A2" in prompt
    assert "- Adjust complexity to A2 level" in prompt
