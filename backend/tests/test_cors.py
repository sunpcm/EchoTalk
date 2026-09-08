from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_cors_preflight_allowed():
    headers = {
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
    }
    response = client.options("/api/sessions", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"

    # Verify exact allowed methods are returned, not wildcard '*'
    allowed_methods = response.headers.get("access-control-allow-methods", "")
    assert "*" not in allowed_methods
    assert "POST" in allowed_methods

    # Verify exact allowed headers are returned, not wildcard '*'
    allowed_headers = response.headers.get("access-control-allow-headers", "")
    assert "*" not in allowed_headers
    assert "authorization" in allowed_headers.lower()
    assert "content-type" in allowed_headers.lower()


def test_cors_preflight_disallowed_header():
    headers = {
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Disallowed-Header",
    }
    response = client.options("/api/sessions", headers=headers)

    # Starlette CORSMiddleware excludes disallowed headers from Access-Control-Allow-Headers
    allowed_headers = response.headers.get("access-control-allow-headers", "")
    assert "x-disallowed-header" not in allowed_headers.lower()
