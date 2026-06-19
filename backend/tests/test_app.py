"""App-level test: lifespan boots the gateway, deterministic endpoint responds.

Uses Starlette's TestClient, whose context manager runs the FastAPI lifespan
(spawning the real `pku3b mcp` subprocess). No PKU credentials needed — the
endpoint returns a status envelope regardless.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.settings import get_settings
from tests.test_mcp_gateway import _binary, requires_binary


@requires_binary
def test_health_and_course_table_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("MYAL1S_PKU3B_BIN", _binary())
    get_settings.cache_clear()  # pick up the patched binary path

    from app.main import app

    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}

        resp = client.get("/api/course-table")
        assert resp.status_code == 200
        assert resp.json().get("status") in {"ok", "needs_otp", "error"}

    get_settings.cache_clear()
