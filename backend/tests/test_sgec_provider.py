"""Pure tests for SGECGrammarProvider wrapping the strict adapter."""

import asyncio

import pytest

from services.assessment_providers import AssessmentMetadata, GrammarEvaluation
from services.sgec_llm import SGECLLMError
from services.sgec_provider import SGECGrammarProvider, SGECProviderError

TRUSTED_METADATA = AssessmentMetadata(
    source="sgec",
    provider="sgec-llm",
    model_version="sgec-v1",
    is_synthetic=False,
    confidence=None,
)


def _batch(errors):
    return {"errors": errors}


def _error(**overrides):
    return {
        "skill_tag": "article_usage",
        "original": "a elephant",
        "corrected": "an elephant",
        "error_type": "article",
        **overrides,
    }


@pytest.mark.asyncio
async def test_sync_payload_source_is_supported():
    async def provider():
        return SGECGrammarProvider(
            TRUSTED_METADATA,
            {"article_usage"},
            lambda _value: _batch([_error()]),
        )

    evaluation = await (await provider()).evaluate(
        type("Input", (), {"text": "a elephant"})()
    )
    assert isinstance(evaluation, GrammarEvaluation)
    assert evaluation.metadata is TRUSTED_METADATA
    assert evaluation.findings[0].skill_tag == "article_usage"


@pytest.mark.asyncio
async def test_async_payload_source_is_supported():
    async def payload(_value):
        return _batch([_error(confidence=1.0)])

    provider = SGECGrammarProvider(TRUSTED_METADATA, {"article_usage"}, payload)
    evaluation = await provider.evaluate(type("Input", (), {"text": "ignored"})())
    assert evaluation.findings[0].metadata.confidence == 1.0


@pytest.mark.asyncio
async def test_payload_transport_error_is_stable_and_safe():
    async def payload(_value):
        raise SGECLLMError("sgec_llm_transport_failed")

    provider = SGECGrammarProvider(TRUSTED_METADATA, {"article_usage"}, payload)
    with pytest.raises(SGECProviderError) as exc_info:
        await provider.evaluate(type("Input", (), {"text": "ignored"})())
    assert exc_info.value.code == "sgec_llm_transport_failed"


@pytest.mark.asyncio
async def test_adapter_rejection_is_stable():
    provider = SGECGrammarProvider(
        TRUSTED_METADATA,
        {"article_usage"},
        lambda _value: _batch([_error(skill_tag="other")]),
    )
    with pytest.raises(SGECProviderError) as exc_info:
        await provider.evaluate(type("Input", (), {"text": "ignored"})())
    assert exc_info.value.code == "invalid_sgec_batch"


@pytest.mark.asyncio
async def test_empty_batch_keeps_metadata():
    provider = SGECGrammarProvider(
        TRUSTED_METADATA, {"article_usage"}, lambda _value: _batch([])
    )
    evaluation = await provider.evaluate(type("Input", (), {"text": "ignored"})())
    assert evaluation.findings == ()
    assert evaluation.metadata is TRUSTED_METADATA


@pytest.mark.asyncio
async def test_cancellation_from_source_is_not_swallowed():
    async def payload(_value):
        await asyncio.sleep(10)

    provider = SGECGrammarProvider(TRUSTED_METADATA, {"article_usage"}, payload)
    task = asyncio.create_task(
        provider.evaluate(type("Input", (), {"text": "ignored"})())
    )
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_close_calls_sync_and_async_source_closers_once():
    async def payload(_value):
        return _batch([])

    close_calls = []

    def sync_close():
        close_calls.append("sync")

    payload.close = sync_close
    provider = SGECGrammarProvider(TRUSTED_METADATA, {"article_usage"}, payload)
    await provider.close()
    assert close_calls == ["sync"]

    async def async_close():
        close_calls.append("async")

    async def async_payload(_value):
        return _batch([])

    async_payload.close = async_close
    provider = SGECGrammarProvider(TRUSTED_METADATA, {"article_usage"}, async_payload)
    await provider.close()
    assert close_calls == ["sync", "async"]
