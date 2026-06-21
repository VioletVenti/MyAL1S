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
        │ GET /api/todo|calendar|stars…      │ (model picker, history)
        │ (no LLM)                           │
┌───────▼───────────────────────────────────▼───────────────┐
│ FastAPI backend (backend/)                                 │
│   routes/deterministic.py          routes/chat.py          │
│   routes/dashboard.py ──┐             │ gateway.agent.run  │
│        │                │             │ (message_history)  │
│        │ gateway.call_tool             └────────┬──────────┤
│        │                │                      │          │
│        │          Composer (Seam 6)            │          │
│        │           join + diff + week-math      │          │
│        │                │                      │          │
│        └──────────────┬─┴──────────────────────┤          │
│                  McpGateway (Seam 4)          │          │
│         one MCPServerStdio, shared by all paths│          │
│                        │                      │          │
│                   Store (Seam 5) ◀────────────┘          │
│         SQLite: stars / custom items / seen-ids /         │
│         conversations + messages                          │
└──────────────────────┬─────────────────────────────────────┘
                       │ newline JSON-RPC 2.0 over stdio
┌──────────────────────▼─────────────────────────────────────┐
│ pku3b mcp  (pku3b/src/mcp/, Rust + compio)                 │
│   transport (Seam 3) → ToolRegistry (Seam 1) → auth (Seam 2)│
│   tools: course_table · assignments · grades ·             │
│          announcements · materials · videos · login        │
└─────────────────────────────────────────────────────────────┘
```

> P1 added the **Store** (Seam 5) and the **Composer** (Seam 6) plus the
> `routes/dashboard.py` deterministic path. The Composer joins live MCP-tool
> data with persisted state (stars / custom items / seen-ids) into the 待办 /
> weekly-calendar / 新到通知 shapes — still never through the LLM. The Store
> also persists chat conversations + the pydantic-ai message slices so threads
> can be reopened exactly (that path *does* touch the agent, in `routes/chat.py`
> only).

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
| 5 | **Store** (P1) | `backend/app/store.py` | grouped methods: stars / custom-items / seen-ids / conversations | the entire SQLite lifecycle (aiosqlite connection, schema init, all SQL + row mapping, pydantic-ai message serialization) |
| 6 | **Composer** (P1) | `backend/app/composer.py` | `todo()`, `week(iso_week)`, `new_notices()`, `mark_seen()` | the multi-source join: merging live MCP-tool data with Store state into the dashboard shapes; seen-id diffing; ISO-week date-range filtering |

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
call (same catalog) → synthesizes a Chinese answer → `{reply}`. P1: `model`
overrides the agent's default (picker); `conversation_id` loads stored history
(`message_history=`) and the new turn is persisted; the reply carries a
`trace` of tool calls/results ("思考可见").

**Dashboard (deterministic, P1):**
`GET /api/todo` → `composer.todo()` returns the **undone-only** list: starred
assignments/announcements enriched with live data (a live-and-submitted starred
assignment is excluded) + custom items not marked done. `GET /api/calendar?week=`
→ `composer.week()` is the **star-retention** view: it shows **every** starred +
custom item whose anchor date falls in that ISO week, **regardless of
submitted/done status** (a completed item still appears on its day — the calendar
is distinct from 待办). `GET /api/new-notices` → `composer.new_notices()` diffs
live assignment/announcement ids against the Store's seen-id watermark; `POST
/api/new-notices/mark-seen` merges the current ids in. None of these touch the
LLM — `routes/dashboard.py` and `composer.py` import neither the agent nor
`pydantic_ai` (a structural test asserts it).

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
(P1), external forums (P3), credential encryption (P4), streaming chat — the
post-P0 roadmap. (P1 has since added the Store + Composer + dashboard routes;
the rest stands.)

## Deferred sources (P3) — interfaces designed, not yet built

The P1 dashboard renders placeholder "待接入 (P3)" panels for four data sources
pku3b / the backend cannot feed yet. Their **GUI + typed data contracts are in
place** (types in `frontend/src/api.ts`; the contract documented below) so P3
implements a scraper/endpoint against a fixed shape — no frontend rework. There
is deliberately **no dead backend route and no stub MCP tool** for these today.

| Source | P3 will be | Contract | Defined in |
|--------|-----------|----------|-----------|
| 教务通知 (dean's office) | a **future MCP tool** on `pku3b` | `get_dean_updates` → `DeanUpdate` | `docs/mcp-protocol.md` |
| 北大树洞 (treehole) | **future MCP tools** on `pku3b` (IAAA reuse) | `list_treehole_posts` / `get_treehole_post` → `TreeholePost` | `docs/mcp-protocol.md` |
| 文档库 (personal docs) | a **future backend feature** (not pku3b/MCP) | `GET /api/docs/search` → `DocResult` | here |
| 记忆 (long-term agent memory) | a **future backend feature** | `GET /api/memory` → `MemoryEntry` | here |

The doc-library and memory endpoints will be **new backend routes**, added
alongside `routes/dashboard.py` when P3 builds them (they are not teaching-network
data, so they do not belong on the `pku3b` MCP server).
