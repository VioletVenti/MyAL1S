# Session Log — 2026-06-21 — OTP login HTTP 500 diagnosis

**Branch:** MyAL1S `feat/p1-ui-redesign` (still on this branch).
**Skill:** diagnosing-bugs.

## Goal
User reports: entering OTP in the frontend login bar returns
`登录失败：Error: HTTP 500` from `POST /api/login`. Find and fix the root cause.

## Phase 1 (feedback loop) — INCOMPLETE, blocked on repro
Could NOT reproduce the 500 with a dummy OTP, even on the true cold path:
- Real cookie jar is at `~/.cache/pku3b/ua.json` (NOT `~/.config/` — first tried
  the wrong path). Deleted it + restarted backend for a true cold session.
- Cold path logs show: `portal_warm: MISS` (401) BUT `blackboard_warm=true` and
  `unprotected login is allowed` — **this account has portal 2FA DISABLED**, so
  the dummy OTP is never verified; portal logs in without OTP → 200. The 500 is
  on the 2FA-required path (the user's account), which I can't fabricate here.

## Static analysis (strong, but not a red-capable loop)
- `routes/session.py::login` is a thin pass-through to
  `gateway.call_tool("login", {otp})`.
- `mcp_gateway.py::call_tool` (line 121-133) catches ONLY `ModelRetry` and
  converts it to an `{status: error}` envelope. Any OTHER exception from
  `direct_call_tool` propagates → FastAPI 500.
- pydantic-ai `MCPServerStdio.direct_call_tool` (mcp.py:1028) raises
  `ModelRetry` for `McpError` (transport/JSON-RPC) and `isError:true` results;
  but a non-McpError (subprocess died, `async with self` context error,
  `_get_client` failure) is NOT caught by `call_tool` → 500.
- pku3b's `login` tool itself returns a graceful `{status:"error"}` envelope on
  login *failure* (isError:false), so a plain bad-OTP would NOT 500 — the 500 is
  a transport/subprocess-level failure, not a login-failure.

## Next — BLOCKED on the user's traceback
Asked the user to paste the backend Python traceback from their 500 (the exact
exception type + message is the root-cause evidence). Awaiting it. Per the skill,
not hypothesising further until I have the real error.

## Side effects this turn (cleanup note)
- Deleted `~/.cache/pku3b/ua.json` (real cookie jar) to force cold path — it was
  regenerated on the next successful login. No lasting effect.
- A backend (uvicorn) may be running on :8000 from the repro attempts.
