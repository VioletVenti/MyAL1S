# Architecture (P0)

MyAL1S is an LLM-agent + web campus assistant built on the `pku3b` teaching-network
crawler. This document is the maintainer's map: the seams, the two data paths, and
the one invariant that must never break.

```
┌───────────────────────────────────────────────────────────┐
│ Browser — Vite + React (frontend/)                         │
│   Dashboard (deterministic)        ChatBox (agent)         │
└───────┬───────────────────────────────────┬───────────────┘
        │ GET /api/course-table…             │ POST /api/chat
        │ (no LLM)                           │
┌───────▼───────────────────────────────────▼───────────────┐
│ FastAPI backend (backend/)                                 │
│   routes/deterministic.py          routes/chat.py          │
│        │ gateway.call_tool(...)         │ gateway.agent.run │
│        └──────────────┬─────────────────┘                  │
│                  McpGateway (Seam 4)                       │
│         one MCPServerStdio, shared by both paths           │
└──────────────────────┬─────────────────────────────────────┘
                       │ newline JSON-RPC 2.0 over stdio
┌──────────────────────▼─────────────────────────────────────┐
│ pku3b mcp  (pku3b/src/mcp/, Rust + compio)                 │
│   transport (Seam 3) → ToolRegistry (Seam 1) → auth (Seam 2)│
│   tools: get_course_table · list_assignments · get_grades  │
└─────────────────────────────────────────────────────────────┘
```

## The invariant

**Deterministic data never passes through the LLM.** Course table, assignments,
and grades shown on the dashboard are fetched by calling MCP tools *directly*
(`McpGateway.call_tool`). The agent (`/api/chat`) is the *only* LLM path. This is
enforced structurally: `routes/deterministic.py` imports neither the agent nor
`pydantic_ai` (a test asserts this — see `backend/tests/test_mcp_gateway.py`).

## The seams (deep modules behind small interfaces)

| # | Seam | Where | Interface | Hides |
|---|------|-------|-----------|-------|
| 1 | **Tool registry** | `pku3b/src/mcp/tools.rs` | `list_mcp()`, `call(name, args)` | all pku3b `api::*` orchestration, serialization, the assignment crawl |
| 2 | **Prompt-free auth** | `pku3b/src/mcp/auth.rs` + `tools.rs::login` | `login_*() -> LoginOutcome::{Ready, NeedsOtp}`; `login(otp)` | cookie reuse, IAAA OAuth, OTP detection (returns `NeedsOtp` as **data**, never blocks), and the **one-OTP** orchestration (see below) |
| 3 | **Transport** | `pku3b/src/mcp/transport.rs` | `serve(registry)` | newline JSON-RPC framing + method routing; a thin adapter with no domain logic |
| 4 | **McpGateway** | `backend/app/mcp_gateway.py` | `call_tool(name, args)`, `agent` | the `pku3b mcp` subprocess lifecycle, MCP handshake, result unwrapping |

Why these are *real* seams (not speculative): each has two adapters across it.
Seam 1 is driven by the stdio transport **and** by in-process unit tests (and
later by the Python deterministic path). Seam 2 serves the MCP server (wants
`NeedsOtp` data) **and** leaves the CLI's interactive `inquire` flow untouched.

## Request lifecycles

**Deterministic (dashboard):**
`GET /api/assignments` → `gateway.call_tool("list_assignments", …)` →
`direct_call_tool` over MCP → registry crawls Blackboard → `{status:"ok", data}`
envelope back to the browser. No tokens spent.

**Agent (chat):**
`POST /api/chat` → `agent.run(message)` → the LLM decides which MCP tool(s) to
call (same catalog) → synthesizes a Chinese answer → `{reply}`.

## Login: one OTP for both services

`login(otp)` (`tools.rs`) spends the single OTP on the **portal**; that login
also sends IAAA's `remTrustChk=true` (`iaaa_oauth_login`), marking the device
trusted in the shared cookie jar. **Blackboard** then logs in with an *empty*
OTP and is verified by listing courses (`blackboard_courses_ok` — a real
`get_courses`, not a `bb_homepage` GET, which 200s on an unauthenticated guest
page). The trusted-device cookie persists in `ua.json`, so later runs reuse the
session — often with no OTP at all.

## The result envelope

Every tool returns one of:

```jsonc
{ "status": "ok",        "data": { /* payload */ } }
{ "status": "needs_otp", "mobile_mask": "135****1234", "hint": "log in once with an OTP…" }
```

The gateway adds a third for the deterministic path when a tool reports `isError`
(e.g. pku3b not configured): `{ "status": "error", "message": "…" }`. The
frontend branches on `status`.

## Process & runtime boundary

`pku3b` uses the `compio` async runtime; the backend uses asyncio. They never
share a runtime — they communicate over stdio across a process boundary. This is
why pku3b is a *separate MCP server subprocess*, not a linked library.

## What P0 deliberately omits

Write tools / permission matrix / OTP UI round-trip (P2), SQLite persistence
(P1), external forums (P3), credential encryption (P4), streaming chat. See
`Plan/2026-06-19_campus-assistant-architecture-plan.md` for the roadmap.
