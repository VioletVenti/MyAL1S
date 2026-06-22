"""Session / login endpoint.

`POST /api/login {otp}` warms the teaching-network session **once** via the MCP
`login` tool (a direct call, no LLM). After this, the long-lived `pku3b mcp`
process reuses the session, so dashboard/chat calls need no further OTP until it
expires. Importantly this means the OTP is supplied by the *user*, not invented
by the agent.

On a successful login the route also kicks off a **background prefetch** that
warms every teaching-network source into the snapshot cache, so the dashboard's
directory modules are populated immediately regardless of which view the client
has mounted (the directory panels aren't rendered on the main view, so they'd
otherwise fetch on demand — see [`warm_snapshots`]). The prefetch runs as a
detached task so it never blocks the login response.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from .deterministic import _cached  # reuse the live-or-snapshot helper

router = APIRouter(prefix="/api", tags=["session"])
log = logging.getLogger("myal1s.session")

# (snapshot key, tool name) for every source warmed on login. Reused by the
# deterministic routes, so the prefetch and the per-route fallback stay in sync.
_WARM_SOURCES = [
    ("course_table", "get_course_table"),
    ("assignments", "list_assignments"),
    ("announcements", "get_announcements"),
    ("materials", "list_course_materials"),
    ("videos", "list_videos"),
    ("grades", "get_grades"),
]


class LoginIn(BaseModel):
    otp: str


async def warm_snapshots(request: Request) -> None:
    """Fetch every teaching-network source and write its snapshot. Best-effort:
    each source is independent; failures are logged and don't abort the rest.
    Safe to run as a detached background task."""
    # First warm the 6 deterministic (raw data) sources.
    for key, tool in _WARM_SOURCES:
        try:
            await _cached(request, key, tool)
        except Exception as e:  # a single source failing must not stop the rest
            log.warning("prefetch %s failed: %r", key, e)

    # Then warm the 3 composer-backed dashboard routes (todo / new-notices /
    # calendar) so the main-view panels are also cached on login.
    from .dashboard import _cached_route, _composer
    composer = _composer(request)

    async def _make_todo():
        return {"items": await composer.todo()}
    async def _make_notices():
        return await composer.new_notices()
    async def _make_calendar():
        return await composer.week(None)

    for key, factory in [("todo", _make_todo), ("new_notices", _make_notices)]:
        try:
            await _cached_route(request, key, factory)
        except Exception as e:
            log.warning("prefetch %s failed: %r", key, e)
    try:
        await _cached_route(request, "calendar:current", _make_calendar)
    except Exception as e:
        log.warning("prefetch calendar failed: %r", e)


@router.post("/login")
async def login(body: LoginIn, request: Request) -> dict:
    """Establish the session with a one-time password. Returns the tool envelope
    (`status: ok` with `{portal, blackboard}`, or `needs_otp` / `error`).
    On a fully-connected login, kicks off a background snapshot prefetch."""
    env = await request.app.state.gateway.call_tool("login", {"otp": body.otp})
    data = env.get("data") if isinstance(env.get("data"), dict) else {}
    if env.get("status") == "ok" and data.get("portal") and data.get("blackboard"):
        # Detached: don't block the login response on a 6-source crawl.
        asyncio.create_task(warm_snapshots(request))
    return env
