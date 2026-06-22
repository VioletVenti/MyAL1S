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
    for key, tool in _WARM_SOURCES:
        try:
            await _cached(request, key, tool)
        except Exception as e:  # a single source failing must not stop the rest
            log.warning("prefetch %s failed: %r", key, e)


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
