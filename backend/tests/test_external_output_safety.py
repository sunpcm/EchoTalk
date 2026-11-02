"""真实 service/router 边界的对外输出安全回归。"""

import logging
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from openai import APIError

from config import settings
from database import get_db
from main import app
from models.session import SessionStatus, Transcript, TranscriptRole
from services.agent_prompt import SYSTEM_PROMPT


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _ScalarsResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self

    def all(self):
        return self._values


class _PassthroughAsyncContext:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


@asynccontextmanager
async def _asgi_client_with_db(db):
    saved_override = app.dependency_overrides.get(get_db)

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
        ) as client:
            yield client
    finally:
        if saved_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = saved_override


def _conversation_db(session_id: uuid.UUID, user_content: str):
    session = SimpleNamespace(id=session_id, status=SessionStatus.active)
    history = [
        Transcript(
            session_id=session_id,
            role=TranscriptRole.user,
            content=user_content,
            timestamp_ms=1,
        )
    ]
    added: list[Transcript] = []

    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _ScalarResult(session),
            _ScalarsResult(history),
        ]
    )
    db.add = MagicMock(side_effect=added.append)

    async def flush():
        if len(added) == 2:
            added[-1].id = 2468

    db.flush = AsyncMock(side_effect=flush)
    db.refresh = AsyncMock()
    return db


def _llm_client(content: str | None = None, error: Exception | None = None):
    if error is not None:
        create = AsyncMock(side_effect=error)
    else:
        choice = SimpleNamespace(message=SimpleNamespace(content=content))
        create = AsyncMock(return_value=SimpleNamespace(choices=[choice]))

    client = MagicMock()
    client.chat.completions.create = create
    return client, create


def _app_log_records(caplog):
    return [
        record
        for record in caplog.records
        if record.name in {"services.llm_service", "routers.sessions"}
    ]


def _record_values(record: logging.LogRecord) -> list[str]:
    values = [
        record.getMessage(),
        str(record.msg),
        str(record.args),
        str(record.exc_info),
        str(getattr(record, "stack_info", None)),
    ]
    values.extend(
        str(value)
        for key, value in record.__dict__.items()
        if key
        not in {
            "name",
            "msg",
            "args",
            "levelname",
            "levelno",
            "pathname",
            "filename",
            "module",
            "exc_info",
            "exc_text",
            "stack_info",
            "lineno",
            "funcName",
            "created",
            "msecs",
            "relativeCreated",
            "thread",
            "threadName",
            "processName",
            "process",
        }
    )
    return values


def _assert_safe_records(records, canaries):
    assert records
    for record in records:
        assert record.exc_info is None
        assert getattr(record, "stack_info", None) is None
        values = _record_values(record)
        for canary in canaries:
            assert all(canary not in value for value in values)


def _assert_response_has_no_canaries(response, canaries):
    for canary in canaries:
        assert canary not in response.text


def _dispatch_harness(failure: str | None = None):
    exception = RuntimeError(
        "SYNTHETIC_DISPATCH_MESSAGE_CANARY "
        "Authorization=SYNTHETIC_DISPATCH_AUTH_CANARY "
        "url=SYNTHETIC_DISPATCH_URL_CANARY "
        "body=SYNTHETIC_DISPATCH_BODY_CANARY "
        "document=SYNTHETIC_DISPATCH_DOCUMENT_CANARY"
    )
    exception.headers = {"Authorization": "Bearer SYNTHETIC_DISPATCH_AUTH_CANARY"}
    exception.url = "https://provider.test/SYNTHETIC_DISPATCH_URL_CANARY"
    exception.body = "SYNTHETIC_DISPATCH_BODY_CANARY"

    list_dispatch = AsyncMock(return_value=[])
    create_dispatch = AsyncMock()
    if failure == "list":
        list_dispatch.side_effect = exception
    elif failure == "create":
        create_dispatch.side_effect = exception

    dispatch_api = MagicMock()
    dispatch_api.list_dispatch = list_dispatch
    dispatch_api.create_dispatch = create_dispatch
    api = MagicMock()
    api.agent_dispatch = dispatch_api

    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=api)
    context.__aexit__ = AsyncMock(return_value=False)
    if failure == "context":
        context.__aenter__.side_effect = exception

    api_factory = MagicMock(return_value=context)
    return api_factory, list_dispatch, create_dispatch, exception


def _dispatch_db(session):
    db = MagicMock()
    db.execute = AsyncMock(return_value=_ScalarResult(session))
    return db


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sdk_reply", "expected_reply"),
    [
        ("SYNTHETIC_SUCCESS_REPLY_CANARY_37ae", "SYNTHETIC_SUCCESS_REPLY_CANARY_37ae"),
        (None, ""),
    ],
)
async def test_conversation_success_contract_and_safe_logs(
    monkeypatch, caplog, sdk_reply, expected_reply
):
    session_id = uuid.uuid4()
    user_canary = "SYNTHETIC_PROMPT_CANARY_c690"
    model_canary = "SYNTHETIC_MODEL_CANARY_45f1"
    monkeypatch.setattr(settings, "DEFAULT_LLM_MODEL", model_canary)
    db = _conversation_db(session_id, user_canary)
    client, create = _llm_client(content=sdk_reply)

    with (
        caplog.at_level(logging.DEBUG),
        patch("services.llm_service._get_client", return_value=client),
    ):
        async with _asgi_client_with_db(db) as http:
            response = await http.post(
                "/api/conversation/chat",
                json={"session_id": str(session_id), "message": user_canary},
            )

    assert response.status_code == 200
    assert response.json() == {
        "reply": expected_reply,
        "transcript_id": 2468,
        "audio_base64": None,
    }
    create.assert_awaited_once()
    create_kwargs = create.await_args.kwargs
    assert create_kwargs["model"] == model_canary
    assert create_kwargs["messages"] == [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_canary},
    ]
    assert create_kwargs["temperature"] == 0.7
    assert create_kwargs["max_tokens"] == 256
    assert db.flush.await_count == 2
    assert db.refresh.await_count == 1

    records = _app_log_records(caplog)
    canaries = [user_canary, model_canary]
    if expected_reply:
        canaries.append(expected_reply)
    _assert_safe_records(records, canaries)
    _assert_safe_records(caplog.records, canaries)
    assert any("LLM 回复完成" in record.getMessage() for record in records)


@pytest.mark.asyncio
async def test_conversation_api_error_is_fixed_502_and_safe(caplog, monkeypatch):
    session_id = uuid.uuid4()
    user_canary = "SYNTHETIC_ERROR_PROMPT_CANARY_a75d"
    message_canary = "SYNTHETIC_ERROR_MESSAGE_CANARY_457f"
    authorization_canary = "SYNTHETIC_ERROR_AUTHORIZATION_CANARY_a8a1"
    url_canary = "SYNTHETIC_ERROR_URL_CANARY_7a12"
    body_canary = "SYNTHETIC_ERROR_BODY_CANARY_6b8e"
    document_canary = "SYNTHETIC_ERROR_DOCUMENT_CANARY_25fa"
    model_canary = "SYNTHETIC_ERROR_MODEL_CANARY_833c"
    monkeypatch.setattr(settings, "DEFAULT_LLM_MODEL", model_canary)
    db = _conversation_db(session_id, user_canary)

    request = MagicMock()
    request.headers = {"Authorization": f"Bearer {authorization_canary}"}
    request.url = f"https://provider.test/v1?token={url_canary}"
    request.content = body_canary.encode()
    api_error = APIError(
        message=f"provider response: {message_canary}",
        request=request,
        body={
            "authorization": f"Bearer {authorization_canary}",
            "url": url_canary,
            "body": body_canary,
            "document": document_canary,
        },
    )
    client, create = _llm_client(error=api_error)

    with (
        caplog.at_level(logging.DEBUG),
        patch("services.llm_service._get_client", return_value=client),
    ):
        async with _asgi_client_with_db(db) as http:
            response = await http.post(
                "/api/conversation/chat",
                json={"session_id": str(session_id), "message": user_canary},
            )

    assert message_canary in str(api_error)
    assert response.status_code == 502
    assert response.json() == {"detail": "LLM 服务调用失败: 请稍后重试"}
    canaries = [
        user_canary,
        message_canary,
        authorization_canary,
        url_canary,
        body_canary,
        document_canary,
        model_canary,
    ]
    _assert_response_has_no_canaries(response, canaries)
    create.assert_awaited_once()
    assert db.flush.await_count == 1
    assert db.refresh.await_count == 0
    records = _app_log_records(caplog)
    _assert_safe_records(records, canaries)
    _assert_safe_records(caplog.records, canaries)
    assert any("error_type=APIError" in record.getMessage() for record in records)


@pytest.mark.asyncio
async def test_disabled_dispatch_success_keeps_contract_without_timeout_wrapper():
    session_id = uuid.uuid4()
    session = SimpleNamespace(id=session_id, status=SessionStatus.active)
    api_factory, list_dispatch, create_dispatch, _ = _dispatch_harness()
    timeout_probe = MagicMock()

    with (
        patch.object(settings, "CALL_LEASE_MODE", "disabled"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "unit-test-livekit-key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "unit-test-livekit-secret"),
        patch("routers.sessions.LiveKitAPI", api_factory),
        patch(
            "routers.sessions.asyncio",
            SimpleNamespace(timeout=timeout_probe),
        ),
    ):
        async with _asgi_client_with_db(_dispatch_db(session)) as http:
            response = await http.post(f"/api/sessions/{session_id}/dispatch")

    assert response.status_code == 200
    assert response.json() == {"dispatched": True}
    list_dispatch.assert_awaited_once()
    create_dispatch.assert_awaited_once()
    timeout_probe.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failure", "expected_list_calls", "expected_create_calls"),
    [
        ("context", 0, 0),
        ("list", 1, 0),
        ("create", 1, 1),
    ],
)
async def test_disabled_dispatch_failures_are_fixed_502_and_safe(
    caplog,
    failure,
    expected_list_calls,
    expected_create_calls,
):
    session_id = uuid.uuid4()
    session = SimpleNamespace(id=session_id, status=SessionStatus.active)
    api_factory, list_dispatch, create_dispatch, _ = _dispatch_harness(failure)
    timeout_probe = MagicMock()

    with (
        caplog.at_level(logging.DEBUG),
        patch.object(settings, "CALL_LEASE_MODE", "disabled"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "unit-test-livekit-key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "unit-test-livekit-secret"),
        patch("routers.sessions.LiveKitAPI", api_factory),
        patch(
            "routers.sessions.asyncio",
            SimpleNamespace(timeout=timeout_probe),
        ),
    ):
        async with _asgi_client_with_db(_dispatch_db(session)) as http:
            response = await http.post(f"/api/sessions/{session_id}/dispatch")

    assert response.status_code == 502
    assert response.json() == {"detail": "语音服务暂时不可用，请稍后重试"}
    assert list_dispatch.await_count == expected_list_calls
    assert create_dispatch.await_count == expected_create_calls
    timeout_probe.assert_not_called()

    canaries = [
        "SYNTHETIC_DISPATCH_MESSAGE_CANARY",
        "SYNTHETIC_DISPATCH_AUTH_CANARY",
        "SYNTHETIC_DISPATCH_URL_CANARY",
        "SYNTHETIC_DISPATCH_BODY_CANARY",
        "SYNTHETIC_DISPATCH_DOCUMENT_CANARY",
    ]
    _assert_response_has_no_canaries(response, canaries)
    records = _app_log_records(caplog)
    _assert_safe_records(records, canaries)
    _assert_safe_records(caplog.records, canaries)
    assert any(
        "mode=disabled, error_type=RuntimeError" in record.getMessage()
        for record in records
    )


@pytest.mark.asyncio
async def test_cloud_dispatch_failure_keeps_three_second_bound_and_fixed_502(
    caplog,
):
    session_id = uuid.uuid4()
    session = SimpleNamespace(id=session_id, status=SessionStatus.active)
    api_factory, list_dispatch, create_dispatch, _ = _dispatch_harness("list")
    timeout_probe = MagicMock(return_value=_PassthroughAsyncContext())
    verify_lease = AsyncMock(return_value=(MagicMock(), session))

    with (
        caplog.at_level(logging.DEBUG),
        patch.object(settings, "CALL_LEASE_MODE", "livekit_cloud"),
        patch.object(settings, "LIVEKIT_URL", "https://test.livekit.cloud"),
        patch.object(settings, "LIVEKIT_API_KEY", "unit-test-livekit-key"),
        patch.object(settings, "LIVEKIT_API_SECRET", "unit-test-livekit-secret"),
        patch("routers.sessions.LiveKitAPI", api_factory),
        patch(
            "routers.sessions.verify_call_lease_for_token_or_dispatch",
            verify_lease,
        ),
        patch(
            "routers.sessions.asyncio",
            SimpleNamespace(timeout=timeout_probe),
        ),
    ):
        async with _asgi_client_with_db(_dispatch_db(session)) as http:
            response = await http.post(f"/api/sessions/{session_id}/dispatch")

    assert response.status_code == 502
    assert response.json() == {"detail": "语音服务暂时不可用，请稍后重试"}
    verify_lease.assert_awaited_once()
    timeout_probe.assert_called_once_with(3.0)
    list_dispatch.assert_awaited_once()
    create_dispatch.assert_not_awaited()

    canaries = [
        "SYNTHETIC_DISPATCH_MESSAGE_CANARY",
        "SYNTHETIC_DISPATCH_AUTH_CANARY",
        "SYNTHETIC_DISPATCH_URL_CANARY",
        "SYNTHETIC_DISPATCH_BODY_CANARY",
        "SYNTHETIC_DISPATCH_DOCUMENT_CANARY",
    ]
    _assert_response_has_no_canaries(response, canaries)
    records = _app_log_records(caplog)
    _assert_safe_records(records, canaries)
    _assert_safe_records(caplog.records, canaries)
    assert any(
        "mode=livekit_cloud, error_type=RuntimeError" in record.getMessage()
        for record in records
    )
