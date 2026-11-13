"""公开 OpenAPI 成功响应契约测试。

四个曾经为空 schema 的成功响应（健康检查、就绪检查、会话令牌、Agent 调度）现在必须
携带带 `$ref` 的模型化 schema。本测试从每个 operation 的 200 响应跟随 `$ref` 断言
公开字段集合、`required` 与基本 JSON 类型，避免只写空 object 仍蒙混过关；不导入私有
Pydantic class 名，也不重复既有 HTTP 成功用例。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
OPENAPI_PATH = BACKEND_ROOT / "openapi.json"

# (path, method, {公开字段: OpenAPI `type` 关键字})
SUCCESS_CONTRACTS = [
    ("/api/health", "get", {"status": "string", "service": "string"}),
    ("/api/health/ready", "get", {"status": "string"}),
    (
        "/api/sessions/{session_id}/token",
        "get",
        {"token": "string", "ws_url": "string"},
    ),
    ("/api/sessions/{session_id}/dispatch", "post", {"dispatched": "boolean"}),
]


@pytest.fixture(scope="module")
def openapi_document() -> dict:
    return json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    ("path", "method", "expected_fields"),
    SUCCESS_CONTRACTS,
    ids=[f"{method.upper()} {path}" for path, method, _ in SUCCESS_CONTRACTS],
)
def test_success_response_is_modeled(
    openapi_document: dict,
    path: str,
    method: str,
    expected_fields: dict[str, str],
) -> None:
    response_schema = openapi_document["paths"][path][method]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]
    ref = response_schema.get("$ref")
    assert ref, f"{method.upper()} {path} 200 响应仍为空 schema（缺 $ref）"

    component_name = ref.rsplit("/", 1)[-1]
    component = openapi_document["components"]["schemas"][component_name]
    properties = component.get("properties", {})
    required = component.get("required", [])

    assert set(properties) == set(expected_fields), (
        f"{component_name} 字段集合不符：{sorted(properties)}"
    )
    assert set(required) == set(expected_fields), (
        f"{component_name} required 不符：{sorted(required)}"
    )
    for field, json_type in expected_fields.items():
        assert properties[field].get("type") == json_type, (
            f"{component_name}.{field} 类型应为 {json_type}，"
            f"实际 {properties[field].get('type')}"
        )
