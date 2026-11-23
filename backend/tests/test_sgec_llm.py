"""Pure offline tests for the SGEC OpenAI-compatible payload source."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from services.assessment_providers import TranscriptAssessmentInput
from services.sgec_llm import (
    SGECLLMError,
    SGECLLMPayloadSource,
    parse_strict_json,
    validate_base_url,
)


def _payload(error=None):
    return json.dumps(
        {
            "errors": [
                {
                    "skill_tag": "article_usage",
                    "original": "a elephant",
                    "corrected": "an elephant",
                    "error_type": "article",
                    "confidence": error if error is not None else 0.9,
                }
            ]
        }
    )


def _response(content, finish_reason="stop"):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                finish_reason=finish_reason,
                message=SimpleNamespace(content=content),
            )
        ]
    )


class _FakeClient:
    def __init__(self, response):
        self.response = response
        self.closed = False
        self.calls = []

    async def close(self):
        self.closed = True

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def test_parse_strict_json_accepts_clean_object():
    parsed = parse_strict_json('{"errors":[]}', max_chars=100)
    assert parsed == {"errors": []}


@pytest.mark.parametrize(
    "text",
    [
        '{"errors": 1, "errors": 2}',
        '{"errors": NaN}',
        '{"errors": Infinity}',
        '{"errors": -Infinity}',
        '{"errors": [{"x": 9223372036854775808}]}',
        '```json\n{"errors":[]}\n```',
        "[]",
        '"errors"',
        "null",
    ],
)
def test_parse_strict_json_rejects_invalid_values(text):
    with pytest.raises(SGECLLMError) as exc_info:
        parse_strict_json(text, max_chars=1000)
    assert exc_info.value.code in {
        "sgec_llm_invalid_json",
        "sgec_llm_not_object",
    }


def test_parse_strict_json_rejects_oversize_output():
    with pytest.raises(SGECLLMError) as exc_info:
        parse_strict_json('{"errors":[]}', max_chars=1)
    assert exc_info.value.code == "sgec_llm_oversize"


@pytest.mark.parametrize(
    "url",
    [
        "",
        "http://api.example.test/v1",
        "https://user:pass@api.example.test/v1",
        "https://api.example.test/v1?debug=1",
        "https://api.example.test/v1#frag",
        "not a url",
    ],
)
def test_validate_base_url_rejects_unsafe_values(url):
    with pytest.raises(SGECLLMError) as exc_info:
        validate_base_url(url)
    assert exc_info.value.code == "sgec_llm_invalid_base_url"


def test_validate_base_url_accepts_https_no_query_or_fragment():
    assert validate_base_url("https://api.example.test/v1/") == (
        "https://api.example.test/v1/"
    )


def test_constructor_rejects_missing_model_and_blank_api_key():
    with pytest.raises(SGECLLMError) as exc_info:
        SGECLLMPayloadSource(model="", allowed_skill_tags={"article_usage"})
    assert exc_info.value.code == "sgec_llm_not_configured"

    with pytest.raises(SGECLLMError) as exc_info:
        SGECLLMPayloadSource(
            model="model",
            allowed_skill_tags={"article_usage"},
            base_url="https://api.example.test/v1",
            api_key="",
        )
    assert exc_info.value.code == "sgec_llm_not_configured"


@pytest.mark.asyncio
async def test_fake_client_receives_explicit_sdk_arguments():
    fake = _FakeClient(_response(_payload()))
    source = SGECLLMPayloadSource(
        model="sgec-model",
        allowed_skill_tags={"article_usage"},
        timeout_seconds=7.5,
        max_tokens=123,
        max_output_chars=10000,
        client=fake,
    )

    result = await source(TranscriptAssessmentInput("a elephant"))

    assert result["errors"][0]["skill_tag"] == "article_usage"
    assert fake.closed is True
    assert len(fake.calls) == 1
    kwargs = fake.calls[0]
    assert kwargs["model"] == "sgec-model"
    assert kwargs["temperature"] == 0.0
    assert kwargs["max_tokens"] == 123
    assert kwargs["messages"][0]["role"] == "system"
    assert (
        "error_type value must be at most 50 characters"
        in kwargs["messages"][0]["content"]
    )
    assert kwargs["messages"][1] == {"role": "user", "content": "a elephant"}


@pytest.mark.asyncio
@pytest.mark.parametrize("finish_reason", ["length", "content_filter"])
async def test_rejected_finish_reason_is_stable_error(finish_reason):
    fake = _FakeClient(_response(_payload(), finish_reason=finish_reason))
    source = SGECLLMPayloadSource(
        model="model", allowed_skill_tags={"article_usage"}, client=fake
    )

    with pytest.raises(SGECLLMError) as exc_info:
        await source(TranscriptAssessmentInput("a elephant"))

    assert exc_info.value.code == "sgec_llm_rejected_finish"
    assert fake.closed is True


@pytest.mark.asyncio
@pytest.mark.parametrize("finish_reason", [None, "tool_calls", "unknown"])
async def test_non_stop_finish_reason_is_rejected(finish_reason):
    fake = _FakeClient(_response(_payload(), finish_reason=finish_reason))
    source = SGECLLMPayloadSource(
        model="model", allowed_skill_tags={"article_usage"}, client=fake
    )

    with pytest.raises(SGECLLMError) as exc_info:
        await source(TranscriptAssessmentInput("a elephant"))

    assert exc_info.value.code == "sgec_llm_rejected_finish"


@pytest.mark.asyncio
async def test_stop_finish_reason_is_accepted():
    fake = _FakeClient(_response(_payload(), finish_reason="stop"))
    source = SGECLLMPayloadSource(
        model="model", allowed_skill_tags={"article_usage"}, client=fake
    )

    result = await source(TranscriptAssessmentInput("a elephant"))

    assert result["errors"][0]["skill_tag"] == "article_usage"


@pytest.mark.asyncio
async def test_transport_exception_maps_to_stable_code_without_leak():
    async def fail(**kwargs):
        raise RuntimeError("provider secret detail")

    fake = SimpleNamespace(
        closed=False,
        chat=SimpleNamespace(completions=SimpleNamespace(create=fail)),
    )

    async def close():
        fake.closed = True

    fake.close = close
    source = SGECLLMPayloadSource(
        model="model", allowed_skill_tags={"article_usage"}, client=fake
    )

    with pytest.raises(SGECLLMError) as exc_info:
        await source(TranscriptAssessmentInput("a elephant"))

    assert exc_info.value.code == "sgec_llm_transport_failed"
    assert "secret detail" not in str(exc_info.value)
    assert fake.closed is True


@pytest.mark.asyncio
async def test_cancellation_is_not_swallowed_and_client_closes():
    async def held(**kwargs):
        await asyncio.sleep(10)

    fake = SimpleNamespace(
        closed=False,
        chat=SimpleNamespace(completions=SimpleNamespace(create=held)),
    )

    async def close():
        fake.closed = True

    fake.close = close
    source = SGECLLMPayloadSource(
        model="model", allowed_skill_tags={"article_usage"}, client=fake
    )
    task = asyncio.create_task(source(TranscriptAssessmentInput("a elephant")))
    await asyncio.sleep(0)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    assert fake.closed is True


@pytest.mark.asyncio
async def test_timeout_covers_entire_sdk_call():
    async def held(**kwargs):
        await asyncio.sleep(0.05)
        return _response(_payload())

    fake = SimpleNamespace(
        closed=False,
        chat=SimpleNamespace(completions=SimpleNamespace(create=held)),
    )

    async def close():
        fake.closed = True

    fake.close = close
    source = SGECLLMPayloadSource(
        model="model",
        allowed_skill_tags={"article_usage"},
        timeout_seconds=0.001,
        client=fake,
    )

    with pytest.raises(SGECLLMError) as exc_info:
        await source(TranscriptAssessmentInput("a elephant"))

    assert exc_info.value.code == "sgec_llm_timeout"
    assert fake.closed is True


@pytest.mark.asyncio
async def test_empty_and_invalid_response_are_stable_errors():
    fake = _FakeClient(_response(""))
    source = SGECLLMPayloadSource(
        model="model", allowed_skill_tags={"article_usage"}, client=fake
    )
    with pytest.raises(SGECLLMError) as exc_info:
        await source(TranscriptAssessmentInput("a elephant"))
    assert exc_info.value.code == "sgec_llm_empty_response"

    fake = _FakeClient(_response('{"errors":'))
    source = SGECLLMPayloadSource(
        model="model", allowed_skill_tags={"article_usage"}, client=fake
    )
    with pytest.raises(SGECLLMError) as exc_info:
        await source(TranscriptAssessmentInput("a elephant"))
    assert exc_info.value.code == "sgec_llm_invalid_json"
