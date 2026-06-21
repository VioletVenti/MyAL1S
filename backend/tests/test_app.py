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


@requires_binary
def test_dashboard_persistence_and_composition_endpoints(monkeypatch, tmp_path) -> None:
    """The P1 dashboard endpoints (stars / custom-items / todo / calendar /
    new-notices) round-trip against a real Store + real (spawning) gateway.
    Live tools degrade to needs_otp/error without credentials; the Store-backed
    endpoints must still work."""
    monkeypatch.setenv("MYAL1S_PKU3B_BIN", _binary())
    monkeypatch.setenv("MYAL1S_SQLITE_PATH", str(tmp_path / "app.sqlite"))
    get_settings.cache_clear()

    from app.main import app

    with TestClient(app) as client:
        # star an assignment, then it appears in todo + stars list
        assert client.post("/api/stars", json={
            "source": "assignment", "item_id": "a1", "title": "作业一", "date": "2026-06-27"
        }).json()["starred"] is True
        assert len(client.get("/api/stars").json()["stars"]) == 1
        todo = client.get("/api/todo").json()["items"]
        assert todo and todo[0]["title"] == "作业一"

        # custom item CRUD
        cid = client.post("/api/custom-items", json={"title": "交报告", "due": "2026-06-30"}).json()["id"]
        assert client.patch(f"/api/custom-items/{cid}", json={"done": True}).status_code == 200
        assert client.get("/api/todo").json()["items"][-1]["done"] is True

        # calendar: course-table status propagates; items list is present
        cal = client.get("/api/calendar?week=2026-W25").json()
        assert cal["course_table"]["status"] in {"ok", "needs_otp", "error"}
        assert "items" in cal

        # new-notices degrades gracefully (no credentials -> empty per source)
        nn = client.get("/api/new-notices").json()
        assert "assignment" in nn and "announcement" in nn

        # unstar + delete item clean up
        assert client.delete("/api/stars/assignment/a1").json()["starred"] is False
        assert client.delete(f"/api/custom-items/{cid}").status_code == 200

    get_settings.cache_clear()


def test_models_picker_registry_parses_in_order() -> None:
    """The /models endpoint exposes `Settings.chat_model_entries`; verify the
    parsing directly (the endpoint is a thin pass-through, and this needs no
    subprocess/lifespan)."""
    from app.settings import Settings

    entries = Settings(chat_models="Claude:anthropic:claude-opus-4-8, Kimi:openai:kimi-k2.6").chat_model_entries
    assert entries == [
        ("Claude", "anthropic:claude-opus-4-8"),
        ("Kimi", "openai:kimi-k2.6"),
    ]
    # default registry is non-empty
    assert Settings().chat_model_entries
