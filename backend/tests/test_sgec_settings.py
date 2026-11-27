"""Configuration gate tests for the SGEC provider wiring."""

import pytest

from config import Settings
from services import analysis_service


def test_sgec_defaults_are_disabled_and_empty():
    config = Settings(AUTH_MODE="dev", DEV_AUTH_TOKEN="dummy")
    assert config.SGEC_GRAMMAR_PROVIDER_ENABLED is False
    assert config.SGEC_LLM_BASE_URL == ""
    assert config.SGEC_LLM_API_KEY == ""
    assert config.SGEC_LLM_MODEL == ""
    assert config.SGEC_LLM_MODEL_VERSION == ""


@pytest.mark.parametrize(
    "value",
    [
        0,
        -1,
        float("nan"),
        float("inf"),
        float("-inf"),
        True,
        False,
        "0",
        "nan",
        "inf",
    ],
)
def test_sgec_positive_numeric_validation_rejects_invalid_values(value):
    for field in (
        "SGEC_LLM_TIMEOUT_SECONDS",
        "SGEC_LLM_MAX_TOKENS",
        "SGEC_LLM_MAX_OUTPUT_CHARS",
    ):
        with pytest.raises(ValueError, match="SGEC 数值配置必须是有限正数"):
            Settings(AUTH_MODE="dev", DEV_AUTH_TOKEN="dummy", **{field: value})


def test_sgec_positive_numeric_validation_rejects_oversized_integer():
    huge = 10**10000
    for field in (
        "SGEC_LLM_TIMEOUT_SECONDS",
        "SGEC_LLM_MAX_TOKENS",
        "SGEC_LLM_MAX_OUTPUT_CHARS",
    ):
        with pytest.raises(ValueError, match="SGEC 数值配置必须是有限正数"):
            Settings(AUTH_MODE="dev", DEV_AUTH_TOKEN="dummy", **{field: huge})


@pytest.mark.parametrize("model_version", ["", "   "])
def test_enabled_sgec_rejects_only_missing_version_before_source_creation(
    monkeypatch, model_version
):
    created = []
    monkeypatch.setattr(
        analysis_service.settings,
        "SGEC_GRAMMAR_PROVIDER_ENABLED",
        True,
    )
    monkeypatch.setattr(
        analysis_service.settings,
        "SGEC_LLM_BASE_URL",
        "https://api.example.test/v1",
    )
    monkeypatch.setattr(
        analysis_service.settings,
        "SGEC_LLM_API_KEY",
        "not-real-key",
    )
    monkeypatch.setattr(
        analysis_service.settings,
        "SGEC_LLM_MODEL",
        "sgec-model",
    )
    monkeypatch.setattr(
        analysis_service.settings,
        "SGEC_LLM_MODEL_VERSION",
        model_version,
    )
    monkeypatch.setattr(
        analysis_service,
        "_build_sgec_payload_source",
        lambda seed_skill_tags: created.append(seed_skill_tags) or object(),
    )

    with pytest.raises(analysis_service.AnalysisServiceError) as exc_info:
        analysis_service._select_grammar_provider()

    assert exc_info.value.code == "analysis_failed"
    assert exc_info.value.retryable is False
    assert created == []


def test_default_grammar_provider_remains_demo():
    provider = analysis_service._select_grammar_provider()
    assert isinstance(provider, analysis_service.DemoRuleGrammarProvider)
