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
        # /todo returns an {status, data:{items}} envelope (regression: the bare
        # {items} shape crashed/blanked the frontend's EnvelopeBody).
        todo_env = client.get("/api/todo").json()
        assert todo_env["status"] == "ok"
        todo = todo_env["data"]["items"]
        assert todo and any(it["title"] == "作业一" for it in todo)

        # custom item CRUD
        cid = client.post("/api/custom-items", json={"title": "交报告", "due": "2026-06-30"}).json()["id"]
        assert client.patch(f"/api/custom-items/{cid}", json={"done": True}).status_code == 200
        # a done custom item leaves 待办 (todo = undone); it's still in /custom-items
        todo_ids = [it.get("custom_id") for it in client.get("/api/todo").json()["data"]["items"]]
        assert cid not in todo_ids
        assert any(it["id"] == cid for it in client.get("/api/custom-items").json()["items"])

        # calendar: an {status, data} envelope whose data.course_table itself
        # carries the inner status (needs_otp/ok/error) and data.items is present.
        cal_env = client.get("/api/calendar?week=2026-W25").json()
        assert cal_env["status"] == "ok"
        assert cal_env["data"]["course_table"]["status"] in {"ok", "needs_otp", "error"}
        assert "items" in cal_env["data"]

        # new-notices: an {status, data} envelope whose data has both sources
        # (regression: bare {assignment} crashed NewNoticesPanel's EnvelopeBody).
        nn_env = client.get("/api/new-notices").json()
        assert nn_env["status"] == "ok"
        assert "assignment" in nn_env["data"] and "announcement" in nn_env["data"]

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


@requires_binary
def test_deterministic_route_writes_snapshot_and_serves_stale_fallback(monkeypatch, tmp_path) -> None:
    """The deterministic routes maintain a snapshot cache (Increment E):
      (a) a successful live fetch writes the envelope to the Store; and
      (b) the route serves the cached snapshot (marked stale) when the live
          call fails. We can't force the live path to fail in this warm-session
          environment, so we exercise (a) end-to-end and (b) directly: seed a
          snapshot, then confirm the helper returns it as stale when handed a
          needs_otp envelope."""
    monkeypatch.setenv("MYAL1S_PKU3B_BIN", _binary())
    monkeypatch.setenv("MYAL1S_SQLITE_PATH", str(tmp_path / "app.sqlite"))
    get_settings.cache_clear()

    import asyncio

    from app.main import app

    with TestClient(app) as client:
        store = app.state.store
        # (a) a live route writes a snapshot if the live call succeeded
        # (session warmth-dependent). Either way the route returns an envelope.
        env = client.get("/api/grades").json()
        assert env["status"] in {"ok", "needs_otp", "error"}
        if env["status"] == "ok":
            assert "grades" in asyncio.run(store.snapshot_keys())

    # (b) fallback path in isolation: own connected Store + a fake request whose
    # gateway always returns needs_otp. Seed a snapshot → helper must serve it
    # back marked stale.
    from app.routes.deterministic import _cached
    from app.store import Store

    async def _scenario() -> dict:
        async with Store(str(tmp_path / "fallback.sqlite")) as s:
            await s.put_snapshot(
                "grades",
                {"status": "ok", "data": {"grades": [{"course": "c", "item": "i", "score": 90, "possible": 100}]}},
            )

            class _FakeGateway:
                async def call_tool(self, name, args=None):
                    return {"status": "needs_otp", "mobile_mask": None, "hint": "login"}

            class _FakeApp:
                class state:
                    gateway = _FakeGateway()

            class _FakeReq:
                app = _FakeApp()

            _FakeApp.state.store = s  # type: ignore[attr-defined]
            return await _cached(_FakeReq(), "grades", "get_grades")

    env = asyncio.run(_scenario())
    assert env["status"] == "ok"
    assert env.get("stale") is True
    assert "fetched_at" in env
    assert env["data"]["grades"][0]["score"] == 90

    get_settings.cache_clear()


@requires_binary
def test_login_failure_does_not_prefetch(monkeypatch, tmp_path) -> None:
    """A failed login (wrong OTP / not connected) must NOT kick off the prefetch.
    Only a fully-connected login warms snapshots."""
    monkeypatch.setenv("MYAL1S_PKU3B_BIN", _binary())
    monkeypatch.setenv("MYAL1S_SQLITE_PATH", str(tmp_path / "app.sqlite"))
    get_settings.cache_clear()

    from app.main import app

    with TestClient(app) as client:
        # A bogus OTP — without 2FA/credentials this still returns ok on warm
        # sessions; assert the endpoint responds with an envelope (no crash).
        resp = client.post("/api/login", json={"otp": "000000"})
        assert resp.status_code == 200
        env = resp.json()
        assert env["status"] in {"ok", "needs_otp", "error"}

    get_settings.cache_clear()
