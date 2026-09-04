from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_cors_allowed_origins():
    allowed_origins = [
        "http://localhost:3000",
        "capacitor://localhost",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
    for origin in allowed_origins:
        response = client.options(
            "/api/health",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == origin


def test_cors_disallowed_origins():
    disallowed_origins = [
        "http://localhost",
        "https://localhost",
        "http://evil.com",
        "https://attacker.example.com",
    ]
    for origin in disallowed_origins:
        response = client.options(
            "/api/health",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") != origin
