"""Session / login endpoint.

`POST /api/login {otp}` warms the teaching-network session **once** via the MCP
`login` tool (a direct call, no LLM). After this, the long-lived `pku3b mcp`
process reuses the session, so dashboard/chat calls need no further OTP until it
expires. Importantly this means the OTP is supplied by the *user*, not invented
by the agent.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["session"])


class LoginIn(BaseModel):
    otp: str


@router.post("/login")
async def login(body: LoginIn, request: Request) -> dict:
    """Establish the session with a one-time password. Returns the tool envelope
    (`status: ok` with `{portal, blackboard}`, or `needs_otp` / `error`)."""
    return await request.app.state.gateway.call_tool("login", {"otp": body.otp})
