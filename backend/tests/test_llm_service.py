from unittest.mock import AsyncMock, MagicMock

import pytest
from openai import APIError, AsyncOpenAI

from services.agent_prompt import SYSTEM_PROMPT as AGENT_SYSTEM_PROMPT
from services.agent_prompt import build_dynamic_prompt as build_agent_dynamic_prompt
from services.llm_service import _get_client, build_dynamic_prompt, chat_completion


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

    assert (
        f"[Emotion Awareness] Current user anxiety index: {expected_index_str}"
        in prompt
    )

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
        assert (
            "[Custom Role Instruction]\nAct as an interviewer for a tech job." in prompt
        )
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
        assert (
            "<document>\nThis is the transcript of the news article.\n</document>"
            in prompt
        )
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


def test_get_client_unknown_provider(monkeypatch):
    monkeypatch.setattr(
        "services.llm_service.settings.DEFAULT_LLM_PROVIDER", "unknown_provider"
    )
    with pytest.raises(ValueError, match="未知的 LLM provider: 'unknown_provider'"):
        _get_client()


def test_get_client_missing_api_key(monkeypatch):
    monkeypatch.setattr(
        "services.llm_service.settings.DEFAULT_LLM_PROVIDER", "siliconflow"
    )
    monkeypatch.setattr("services.llm_service.settings.SILICONFLOW_API_KEY", "")
    with pytest.raises(
        ValueError, match="LLM provider 'siliconflow' 的 API Key 未配置"
    ):
        _get_client()


@pytest.mark.parametrize(
    "provider_name, api_key_field, expected_base_url",
    [
        ("siliconflow", "SILICONFLOW_API_KEY", "https://api.siliconflow.cn/v1"),
        ("openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1"),
    ],
)
def test_get_client_success(
    monkeypatch, provider_name, api_key_field, expected_base_url
):
    monkeypatch.setattr(
        "services.llm_service.settings.DEFAULT_LLM_PROVIDER", provider_name
    )
    monkeypatch.setattr(
        f"services.llm_service.settings.{api_key_field}", "test_api_key"
    )

    client = _get_client()
    assert isinstance(client, AsyncOpenAI)
    assert client.api_key == "test_api_key"
    assert str(client.base_url).rstrip("/") == expected_base_url


@pytest.mark.asyncio
async def test_chat_completion_success(monkeypatch):
    mock_client = MagicMock()
    mock_choice = MagicMock()
    mock_choice.message.content = "This is a response from AI."
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    mock_create = AsyncMock(return_value=mock_response)
    mock_client.chat.completions.create = mock_create
    monkeypatch.setattr("services.llm_service._get_client", lambda: mock_client)

    messages = [{"role": "user", "content": "Hello"}]
    reply = await chat_completion(messages)

    assert reply == "This is a response from AI."
    mock_create.assert_awaited_once()
    kwargs = mock_create.call_args.kwargs
    assert kwargs["messages"] == messages
    assert kwargs["temperature"] == 0.7
    assert kwargs["max_tokens"] == 256


@pytest.mark.asyncio
async def test_chat_completion_none_content(monkeypatch):
    mock_client = MagicMock()
    mock_choice = MagicMock()
    mock_choice.message.content = None
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    mock_create = AsyncMock(return_value=mock_response)
    mock_client.chat.completions.create = mock_create
    monkeypatch.setattr("services.llm_service._get_client", lambda: mock_client)

    reply = await chat_completion([{"role": "user", "content": "Test"}])
    assert reply == ""


@pytest.mark.asyncio
async def test_chat_completion_api_error(monkeypatch):
    mock_client = MagicMock()
    api_error = APIError(
        message="API rate limit exceeded", request=MagicMock(), body=None
    )
    mock_create = AsyncMock(side_effect=api_error)
    mock_client.chat.completions.create = mock_create
    monkeypatch.setattr("services.llm_service._get_client", lambda: mock_client)

    with pytest.raises(APIError, match="API rate limit exceeded"):
        await chat_completion([{"role": "user", "content": "Hello"}])


def test_provider_config_derived_from_catalog():
    """验证 services.llm_service.PROVIDER_CONFIG 完整派生自 provider_catalog。"""
    from provider_catalog import LLM_PROVIDER_CATALOG
    from services.llm_service import PROVIDER_CONFIG

    assert PROVIDER_CONFIG == {
        k: {
            "base_url": v.base_url,
            "api_key_field": v.api_key_field,
        }
        for k, v in LLM_PROVIDER_CATALOG.items()
    }


def test_agent_prompt_exports_are_compatibility_reexports():
    """Agent 专用 Prompt 模块是唯一实现，llm_service 仅兼容重导出。"""
    from services import llm_service

    assert build_dynamic_prompt is build_agent_dynamic_prompt
    assert llm_service.SYSTEM_PROMPT is AGENT_SYSTEM_PROMPT
